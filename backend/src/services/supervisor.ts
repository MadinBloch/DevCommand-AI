import { prisma } from "../db.js";
import { runAgent } from "../agents/registry.js";
import { scanRepository, type RepoScan } from "./scanner.js";
import { buildFollowUpPrompt, createFeaturePlan } from "./planner.js";
import {
  buildPrBody,
  ensureFeatureBranch,
  openPullRequest,
  resolveDeployUrl,
  mergePullRequest,
  checkBranchDiff,
  hasReviewableChanges,
} from "./deploy.js";

type TokenProvider = (userId: string) => string | undefined;

const tokenStore = new Map<string, string>();

export function setUserToken(userId: string, token: string) {
  tokenStore.set(userId, token);
}

export function clearUserToken(userId: string) {
  tokenStore.delete(userId);
}

export function getUserToken(userId: string) {
  return tokenStore.get(userId);
}

const getToken: TokenProvider = (userId) => tokenStore.get(userId);

let ticking = false;

export async function startFeatureRun(runId: string) {
  const run = await prisma.featureRun.findUnique({ where: { id: runId }, include: { subTasks: true } });
  if (!run) throw new Error("Feature run not found");
  if (!["queued", "failed"].includes(run.status) && run.subTasks.length) {
    // Resume running pipeline
    if (["scanning", "planning", "running", "testing", "reviewing"].includes(run.status)) return run;
  }

  await prisma.featureRun.update({
    where: { id: runId },
    data: { status: "queued", errorMessage: null },
  });

  // Kick async pipeline (don't block HTTP)
  void processRun(runId);
  return prisma.featureRun.findUnique({
    where: { id: runId },
    include: { subTasks: { orderBy: { orderIndex: "asc" } } },
  });
}

export async function processRun(runId: string) {
  const run = await prisma.featureRun.findUnique({ where: { id: runId } });
  if (!run) return;
  const token = getToken(run.userId);
  if (!token) {
    await prisma.featureRun.update({
      where: { id: runId },
      data: { status: "failed", errorMessage: "No GitHub token in session memory. Sign in again and restart the run." },
    });
    return;
  }

  try {
    // Phase 1–2: scan
    await prisma.featureRun.update({ where: { id: runId }, data: { status: "scanning" } });
    const scan = await scanRepository(token, run.repoFullName, run.goal);
    const branchName = run.branchName || `devcommand/${runId.slice(0, 8)}`;
    await ensureFeatureBranch(token, run.repoFullName, scan.defaultBranch, branchName);
    await prisma.featureRun.update({
      where: { id: runId },
      data: { scanJson: scan as any, branchName, status: "planning" },
    });

    // Phase 3: plan + prompts
    const existing = await prisma.subTask.count({ where: { featureRunId: runId } });
    if (!existing) {
      const plan = await createFeaturePlan(run.goal, scan);
      await prisma.subTask.createMany({
        data: plan.map((step, i) => ({
          featureRunId: runId,
          orderIndex: i,
          title: step.title,
          objective: step.objective,
          agent: step.agent,
          generatedPrompt: step.generatedPrompt,
          criteria: step.criteria,
          dependsOn: step.dependsOnOrders,
          status: i === 0 ? "ready" : "queued",
        })),
      });
    }

    await prisma.featureRun.update({ where: { id: runId }, data: { status: "running" } });
    await drainSubTasks(runId, token, scan);
  } catch (e: any) {
    await prisma.featureRun.update({
      where: { id: runId },
      data: { status: "failed", errorMessage: String(e?.message || e) },
    });
  }
}

async function drainSubTasks(runId: string, token: string, scan: RepoScan) {
  const run = await prisma.featureRun.findUnique({ where: { id: runId } });
  if (!run) return;

  for (let guard = 0; guard < 40; guard++) {
    const fresh = await prisma.featureRun.findUnique({
      where: { id: runId },
      include: { subTasks: { orderBy: { orderIndex: "asc" } } },
    });
    if (!fresh) return;
    if (["awaiting_approval", "deploying", "done", "failed"].includes(fresh.status)) return;

    // Unlock ready tasks whose deps are done
    for (const st of fresh.subTasks) {
      if (st.status !== "queued") continue;
      const deps = (st.dependsOn as number[]) || [];
      const ok = deps.every(
        (idx: number) =>
          fresh.subTasks.find((x: { orderIndex: number; status: string }) => x.orderIndex === idx)?.status === "done"
      );
      if (ok) {
        await prisma.subTask.update({ where: { id: st.id }, data: { status: "ready" } });
      }
    }

    const current = await prisma.subTask.findFirst({
      where: { featureRunId: runId, status: { in: ["ready", "needs_followup"] } },
      orderBy: { orderIndex: "asc" },
    });

    if (!current) {
      const remaining = await prisma.subTask.count({
        where: { featureRunId: runId, status: { notIn: ["done", "skipped"] } },
      });
      if (remaining === 0) {
        await finishWithPr(runId, token, scan);
      }
      return;
    }

    if (current.agent === "human") {
      // Review happens only after a real PR exists. Do not expose approval
      // actions for an empty branch or before a PR is created.
      await finishWithPr(runId, token, scan);
      return;
    }

    await prisma.subTask.update({
      where: { id: current.id },
      data: { status: "running", startedAt: new Date(), attempt: { increment: 1 } },
    });

    const prompt =
      current.status === "needs_followup" && current.followUpPrompt
        ? current.followUpPrompt
        : current.generatedPrompt;

    const result = await runAgent({
      agent: current.agent,
      prompt,
      repoFullName: fresh.repoFullName,
      branchName: fresh.branchName || "devcommand/local",
      title: current.title,
      goal: fresh.goal,
      token,
      attempt: current.attempt + 1,
    });

    if (result.needsHuman) {
      await prisma.subTask.update({
        where: { id: current.id },
        data: {
          status: "needs_followup",
          logs: appendLog(current.logs, result.logs),
          resultJson: (result.result || {}) as object,
        },
      });
      await prisma.featureRun.update({ where: { id: runId }, data: { status: "awaiting_approval" } });
      return;
    }

    if (!result.available) {
      // An unconnected agent has not executed or committed any code.
      await prisma.subTask.update({
        where: { id: current.id },
        data: {
          status: "needs_followup",
          logs: appendLog(current.logs, result.logs + "\nRun the prompt with a real agent and push the feature branch."),
          resultJson: { ...(result.result || {}), manualPromptReady: true } as object,
        },
      });
      await prisma.featureRun.update({
        where: { id: runId },
        data: {
          status: "awaiting_approval",
          errorMessage: "Agent not connected: manual execution required. No code was committed. Connect an agent or run the prompt, then push changes before approval.",
        },
      });
      return;
    }

    if (result.success) {
      await prisma.subTask.update({
        where: { id: current.id },
        data: {
          status: "done",
          completedAt: new Date(),
          logs: appendLog(current.logs, result.logs),
          resultJson: (result.result || { summary: result.summary }) as object,
        },
      });

      // Testing phase marker
      if (/test/i.test(current.title)) {
        await prisma.featureRun.update({
          where: { id: runId },
          data: {
            status: "testing",
            testSummary: result.summary || result.logs.slice(0, 1000),
          },
        });
      } else {
        await prisma.featureRun.update({ where: { id: runId }, data: { status: "running" } });
      }
      continue;
    }

    // Failure / follow-up
    const attempt = current.attempt + 1;
    if (attempt >= current.maxAttempts) {
      await prisma.subTask.update({
        where: { id: current.id },
        data: {
          status: "failed",
          logs: appendLog(current.logs, result.logs),
          resultJson: (result.result || {}) as object,
        },
      });
      await prisma.featureRun.update({
        where: { id: runId },
        data: {
          status: "failed",
          errorMessage: result.followUpReason || `Sub-task failed: ${current.title}`,
        },
      });
      return;
    }

    const follow = buildFollowUpPrompt(
      current.generatedPrompt,
      result.logs,
      result.followUpReason || "Agent reported failure"
    );
    await prisma.subTask.update({
      where: { id: current.id },
      data: {
        status: "needs_followup",
        followUpPrompt: follow,
        logs: appendLog(current.logs, result.logs),
      },
    });
  }
}

async function finishWithPr(runId: string, token: string, scan: RepoScan) {
  const run = await prisma.featureRun.findUnique({
    where: { id: runId },
    include: { subTasks: { orderBy: { orderIndex: "asc" } } },
  });
  if (!run || !run.branchName) return;

  const diff = await checkBranchDiff(token, run.repoFullName, scan.defaultBranch, run.branchName);
  if (!hasReviewableChanges(diff)) {
    await prisma.featureRun.update({
      where: { id: runId },
      data: {
        status: "failed",
        prUrl: null,
        prNumber: null,
        errorMessage: "No code changes between " + scan.defaultBranch + " and " + run.branchName + ". Connect an agent or push your actual commits before retrying. No PR was attempted.",
      },
    });
    return;
  }
  await prisma.featureRun.update({ where: { id: runId }, data: { status: "reviewing" } });

  if (!run.prUrl) {
    try {
      const pr = await openPullRequest({
        token,
        fullName: run.repoFullName,
        title: `[DevCommand] ${run.title}`,
        body: buildPrBody(
          run.goal,
          scan,
          run.subTasks.map((s: { title: string; agent: string; status: string }) => ({
            title: s.title,
            agent: s.agent,
            status: s.status,
          }))
        ),
        head: run.branchName,
        base: scan.defaultBranch,
      });
      await prisma.featureRun.update({
        where: { id: runId },
        data: {
          prUrl: pr.prUrl,
          prNumber: pr.prNumber,
          status: "awaiting_approval",
          deployUrl: resolveDeployUrl(run.repoFullName, scan),
        },
      });
      return;
    } catch (e: any) {
      // GitHub failure must not become a misleading approval-ready state
      await prisma.featureRun.update({
        where: { id: runId },
        data: {
          status: "failed",
          errorMessage: `PR creation failed: ${e?.message || e}. Fix the branch or permissions and retry.`,
          deployUrl: resolveDeployUrl(run.repoFullName, scan),
        },
      });
      return;
    }
  }

  await prisma.featureRun.update({ where: { id: runId }, data: { status: "awaiting_approval" } });
}

export async function approveRun(runId: string, approver: string, merge: boolean) {
  const run = await prisma.featureRun.findUnique({
    where: { id: runId },
    include: { subTasks: true },
  });
  if (!run) throw new Error("Run not found");
  if (run.status !== "awaiting_approval" && run.status !== "reviewing") {
    throw Object.assign(new Error("Run is not awaiting approval"), { status: 400 });
  }

  const token = getToken(run.userId);
  if (!token) throw Object.assign(new Error("GitHub session expired. Sign in again before approval."), { status: 401 });
  if (!run.branchName || !run.prNumber || !run.prUrl) {
    throw Object.assign(new Error("No PR exists. Push real code changes before approving."), { status: 409 });
  }
  const base = ((run.scanJson as unknown as RepoScan | null)?.defaultBranch) || "main";
  const diff = await checkBranchDiff(token, run.repoFullName, base, run.branchName);
  if (!hasReviewableChanges(diff)) {
    throw Object.assign(new Error("Feature branch has no code changes. Approval blocked."), { status: 409 });
  }

  // Complete any human subtasks
  await prisma.subTask.updateMany({
    where: { featureRunId: runId, agent: "human", status: { in: ["needs_followup", "ready", "queued", "running"] } },
    data: { status: "done", completedAt: new Date(), logs: "Approved by " + approver },
  });

  await prisma.featureRun.update({
    where: { id: runId },
    data: {
      approvedAt: new Date(),
      approvedBy: approver,
      status: "deploying",
      errorMessage: null,
    },
  });

  if (merge && token && run.prNumber) {
    try {
      await mergePullRequest({ token, fullName: run.repoFullName, prNumber: run.prNumber });
    } catch (e: any) {
      await prisma.featureRun.update({
        where: { id: runId },
        data: {
          status: "awaiting_approval",
          errorMessage: `Approved but merge failed: ${e?.message || e}`,
        },
      });
      throw e;
    }
  }

  // Remaining non-human tasks after approval (e.g. deploy prep)
  const pending = await prisma.subTask.findMany({
    where: { featureRunId: runId, status: { in: ["queued", "ready", "needs_followup"] } },
    orderBy: { orderIndex: "asc" },
  });

  if (pending.length && token) {
    const scan = (run.scanJson as unknown as RepoScan) || {
      fullName: run.repoFullName,
      defaultBranch: "main",
      description: null,
      language: null,
      stack: [],
      packageManager: null,
      testCommand: null,
      buildCommand: null,
      hasCi: false,
      frameworks: [],
      topFiles: [],
      relevantFiles: [],
      readmeExcerpt: null,
      summary: "",
    };
    await prisma.featureRun.update({ where: { id: runId }, data: { status: "running" } });
    await drainSubTasks(runId, token, scan);
  }

  const after = await prisma.featureRun.findUnique({ where: { id: runId }, include: { subTasks: true } });
  if (after && !["failed", "awaiting_approval"].includes(after.status)) {
    const left = after.subTasks.filter((s: { status: string }) => !["done", "skipped"].includes(s.status));
    if (!left.length) {
      await prisma.featureRun.update({
        where: { id: runId },
        data: {
          status: "done",
          deployUrl: after.deployUrl || resolveDeployUrl(after.repoFullName, (after.scanJson as any) || { hasCi: false, topFiles: [] }),
        },
      });
    }
  }

  return prisma.featureRun.findUnique({
    where: { id: runId },
    include: { subTasks: { orderBy: { orderIndex: "asc" } } },
  });
}

export async function retrySubTask(subTaskId: string) {
  const st = await prisma.subTask.findUnique({ where: { id: subTaskId } });
  if (!st) throw new Error("Sub-task not found");
  await prisma.subTask.update({
    where: { id: subTaskId },
    data: { status: "ready", followUpPrompt: null },
  });
  await prisma.featureRun.update({
    where: { id: st.featureRunId },
    data: { status: "running", errorMessage: null },
  });
  void processRun(st.featureRunId);
}

function appendLog(prev: string | null | undefined, next: string) {
  return [prev, next].filter(Boolean).join("\n---\n");
}

/** Background tick for stuck ready tasks */
export function startSupervisorLoop(intervalMs = 8000) {
  setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      const runs = await prisma.featureRun.findMany({
        where: { status: { in: ["queued", "scanning", "planning", "running", "testing"] } },
        take: 5,
        orderBy: { updatedAt: "asc" },
      });
      for (const run of runs) {
        if (!getToken(run.userId)) continue;
        if (run.status === "queued") void processRun(run.id);
        else if (run.status === "running" || run.status === "testing") {
          const scan = run.scanJson as unknown as RepoScan | null;
          if (scan) {
            const token = getToken(run.userId)!;
            void drainSubTasks(run.id, token, scan);
          }
        }
      }
    } catch {
      /* ignore tick errors */
    } finally {
      ticking = false;
    }
  }, intervalMs);
}
