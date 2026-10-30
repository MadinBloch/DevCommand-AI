import { prisma } from "../db.js";
import { scanRepository, type RepoScan } from "./scanner.js";
import { createFeaturePlan } from "./planner.js";
import { getPersistedGithubToken, getUserLlmKeys } from "./userKeys.js";
import {
  buildPrBody,
  ensureFeatureBranch,
  openPullRequest,
  resolveDeployUrl,
  mergePullRequest,
  checkBranchDiff,
  hasReviewableChanges,
} from "./deploy.js";
import { enqueueSchedule, enqueueSubTask } from "./queue.js";
import { writeAudit } from "./audit.js";
import { getPrCiStatus } from "./ciStatus.js";

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

async function resolveToken(userId: string): Promise<string | undefined> {
  return tokenStore.get(userId) || (await getPersistedGithubToken(userId)) || undefined;
}

let ticking = false;

export async function startFeatureRun(runId: string) {
  const run = await prisma.featureRun.findUnique({ where: { id: runId }, include: { subTasks: true } });
  if (!run) throw new Error("Feature run not found");
  if (!["queued", "failed"].includes(run.status) && run.subTasks.length) {
    if (["scanning", "planning", "running", "testing", "reviewing"].includes(run.status)) {
      await enqueueSchedule({ featureRunId: runId, userId: run.userId });
      return run;
    }
  }

  await prisma.featureRun.update({
    where: { id: runId },
    data: { status: "queued", errorMessage: null },
  });

  void processRun(runId);
  return prisma.featureRun.findUnique({
    where: { id: runId },
    include: { subTasks: { orderBy: { orderIndex: "asc" } } },
  });
}

export async function processRun(runId: string) {
  const run = await prisma.featureRun.findUnique({ where: { id: runId } });
  if (!run) return;
  const token = await resolveToken(run.userId);
  if (!token) {
    await prisma.featureRun.update({
      where: { id: runId },
      data: {
        status: "failed",
        errorMessage: "No GitHub token. Sign in again and restart the run.",
      },
    });
    return;
  }
  setUserToken(run.userId, token);

  try {
    const llmKeys = await getUserLlmKeys(run.userId);

    await prisma.featureRun.update({ where: { id: runId }, data: { status: "scanning" } });
    const scan = await scanRepository(token, run.repoFullName, run.goal);
    const branchName = run.branchName || `devcommand/${runId.slice(0, 8)}`;
    await ensureFeatureBranch(token, run.repoFullName, scan.defaultBranch, branchName);
    await prisma.featureRun.update({
      where: { id: runId },
      data: { scanJson: scan as any, branchName, status: "planning" },
    });

    const existing = await prisma.subTask.count({ where: { featureRunId: runId } });
    if (!existing) {
      const plan = await createFeaturePlan(run.goal, scan, llmKeys);
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
          status: "queued",
        })),
      });
      await writeAudit({
        userId: run.userId,
        featureRunId: runId,
        action: "run.planned",
        detail: `${plan.length} sub-tasks`,
      });
    }

    await prisma.featureRun.update({ where: { id: runId }, data: { status: "running" } });
    await scheduleReadySubTasks(runId);
  } catch (e: any) {
    await prisma.featureRun.update({
      where: { id: runId },
      data: { status: "failed", errorMessage: String(e?.message || e) },
    });
  }
}

/**
 * Dependency-aware scheduler: unlock ready tasks and enqueue independent ones in parallel.
 */
export async function scheduleReadySubTasks(runId: string) {
  const fresh = await prisma.featureRun.findUnique({
    where: { id: runId },
    include: { subTasks: { orderBy: { orderIndex: "asc" } } },
  });
  if (!fresh) return;
  if (["awaiting_approval", "deploying", "done", "failed"].includes(fresh.status)) return;

  const token = await resolveToken(fresh.userId);
  if (!token) return;
  const scan = (fresh.scanJson as unknown as RepoScan) || null;

  // Unlock deps
  for (const st of fresh.subTasks) {
    if (st.status !== "queued") continue;
    const deps = (st.dependsOn as number[]) || [];
    const ok = deps.every(
      (idx: number) =>
        fresh.subTasks.find((x) => x.orderIndex === idx)?.status === "done"
    );
    if (ok) {
      await prisma.subTask.update({ where: { id: st.id }, data: { status: "ready" } });
      st.status = "ready";
    }
  }

  const runningCount = fresh.subTasks.filter((s) => s.status === "running").length;
  const maxParallel = Math.max(1, Number(process.env.MAX_PARALLEL_SUBTASKS || 3));
  const slots = Math.max(0, maxParallel - runningCount);

  const ready = fresh.subTasks.filter((s) => s.status === "ready" || s.status === "needs_followup");

  // Human gate: if a human task is ready and no coding tasks remain ready/running, open PR
  const humanReady = ready.find((s) => s.agent === "human");
  const codingReady = ready.filter((s) => s.agent !== "human");
  if (humanReady && !codingReady.length && runningCount === 0) {
    if (scan) await finishWithPr(runId, token, scan);
    return;
  }

  let enqueued = 0;
  for (const st of codingReady) {
    if (enqueued >= slots) break;
    if (st.status === "running") continue;

    const jobId = await enqueueSubTask(
      { subTaskId: st.id, featureRunId: runId, userId: fresh.userId },
      { singletonKey: st.id }
    );
    await prisma.subTask.update({
      where: { id: st.id },
      data: {
        status: "ready",
        jobId: jobId || st.jobId,
      },
    });
    enqueued++;
  }

  if (!enqueued && runningCount === 0) {
    const remaining = fresh.subTasks.filter((s) => !["done", "skipped"].includes(s.status));
    if (!remaining.length && scan) {
      await finishWithPr(runId, token, scan);
    }
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
        errorMessage:
          "No code changes between " +
          scan.defaultBranch +
          " and " +
          run.branchName +
          ". Connect a real coding agent or push commits before retrying. No PR was attempted.",
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
          run.subTasks.map((s) => ({
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
      await writeAudit({
        userId: run.userId,
        featureRunId: runId,
        action: "pr.opened",
        detail: pr.prUrl,
      });
      return;
    } catch (e: any) {
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

  const token = await resolveToken(run.userId);
  if (!token)
    throw Object.assign(new Error("GitHub session expired. Sign in again before approval."), {
      status: 401,
    });
  if (!run.branchName || !run.prNumber || !run.prUrl) {
    throw Object.assign(new Error("No PR exists. Push real code changes before approving."), {
      status: 409,
    });
  }
  const base = ((run.scanJson as unknown as RepoScan | null)?.defaultBranch) || "main";
  const diff = await checkBranchDiff(token, run.repoFullName, base, run.branchName);
  if (!hasReviewableChanges(diff)) {
    throw Object.assign(new Error("Feature branch has no code changes. Approval blocked."), {
      status: 409,
    });
  }

  // Never auto-merge when CI is red
  if (merge) {
    const ci = await getPrCiStatus(token, run.repoFullName, run.branchName);
    if (ci.state === "failure" || ci.state === "error") {
      throw Object.assign(new Error(`Merge blocked: ${ci.summary}`), { status: 409 });
    }
    if (ci.state === "pending" && process.env.ALLOW_MERGE_PENDING_CI !== "1") {
      throw Object.assign(new Error(`Merge blocked while CI is pending: ${ci.summary}`), {
        status: 409,
      });
    }
  }

  await prisma.subTask.updateMany({
    where: {
      featureRunId: runId,
      agent: "human",
      status: { in: ["needs_followup", "ready", "queued", "running"] },
    },
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
  await writeAudit({
    userId: run.userId,
    featureRunId: runId,
    action: merge ? "run.approve_merge" : "run.approve",
    detail: approver,
  });

  if (merge && run.prNumber) {
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

  const pending = await prisma.subTask.findMany({
    where: { featureRunId: runId, status: { in: ["queued", "ready", "needs_followup"] } },
    orderBy: { orderIndex: "asc" },
  });

  if (pending.length) {
    await prisma.featureRun.update({ where: { id: runId }, data: { status: "running" } });
    await scheduleReadySubTasks(runId);
  }

  const after = await prisma.featureRun.findUnique({
    where: { id: runId },
    include: { subTasks: true },
  });
  if (after && !["failed", "awaiting_approval", "running"].includes(after.status)) {
    const left = after.subTasks.filter((s) => !["done", "skipped"].includes(s.status));
    if (!left.length) {
      await prisma.featureRun.update({
        where: { id: runId },
        data: {
          status: "done",
          deployUrl:
            after.deployUrl ||
            resolveDeployUrl(after.repoFullName, (after.scanJson as any) || { hasCi: false, topFiles: [] }),
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
  const run = await prisma.featureRun.findUnique({ where: { id: st.featureRunId } });
  await prisma.subTask.update({
    where: { id: subTaskId },
    data: { status: "ready", followUpPrompt: null },
  });
  await prisma.featureRun.update({
    where: { id: st.featureRunId },
    data: { status: "running", errorMessage: null },
  });
  if (run) await enqueueSchedule({ featureRunId: st.featureRunId, userId: run.userId });
}

/** Background tick — recovers stuck runs into the queue */
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
        const token = await resolveToken(run.userId);
        if (!token) continue;
        setUserToken(run.userId, token);
        if (run.status === "queued") void processRun(run.id);
        else if (run.status === "running" || run.status === "testing") {
          await enqueueSchedule({ featureRunId: run.id, userId: run.userId });
        }
      }
    } catch {
      /* ignore tick errors */
    } finally {
      ticking = false;
    }
  }, intervalMs);
}
