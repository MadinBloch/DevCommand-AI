import { prisma } from "../db.js";
import { runAgent } from "../agents/registry.js";
import { buildFollowUpPrompt } from "./planner.js";
import type { RepoScan } from "./scanner.js";
import { getUserLlmKeys, getPersistedGithubToken } from "./userKeys.js";
import { getUserToken } from "./supervisor.js";
import { enqueueSchedule, getBoss, QUEUE_SCHEDULE, QUEUE_SUBTASK, QUEUE_VERIFY, type ScheduleJob, type SubTaskJob, type VerifyJob } from "./queue.js";
import { writeAudit } from "./audit.js";
import { redactSecrets } from "./secretRedact.js";
import { runVerificationInClone } from "./verify.js";

function appendLog(prev: string | null | undefined, next: string) {
  return [prev, redactSecrets(next)].filter(Boolean).join("\n---\n");
}

async function resolveToken(userId: string): Promise<string | undefined> {
  return getUserToken(userId) || (await getPersistedGithubToken(userId)) || undefined;
}

export async function executeSubTaskJob(job: SubTaskJob) {
  const st = await prisma.subTask.findUnique({ where: { id: job.subTaskId } });
  const run = await prisma.featureRun.findUnique({ where: { id: job.featureRunId } });
  if (!st || !run) return;
  if (["done", "skipped", "cancelled"].includes(st.status)) return;

  const token = await resolveToken(job.userId);
  if (!token) {
    await prisma.subTask.update({
      where: { id: st.id },
      data: {
        status: "needs_followup",
        logs: appendLog(st.logs, "No GitHub token available. Sign in again."),
      },
    });
    await prisma.featureRun.update({
      where: { id: run.id },
      data: { status: "failed", errorMessage: "No GitHub token. Sign in again and restart." },
    });
    return;
  }

  const keys = await getUserLlmKeys(job.userId);
  const scan = (run.scanJson as unknown as RepoScan) || null;

  await prisma.subTask.update({
    where: { id: st.id },
    data: { status: "running", startedAt: new Date(), attempt: { increment: 1 } },
  });
  await writeAudit({
    userId: job.userId,
    featureRunId: run.id,
    action: "subtask.start",
    detail: `${st.agent}: ${st.title}`,
  });

  const prompt =
    st.status === "needs_followup" && st.followUpPrompt ? st.followUpPrompt : st.generatedPrompt;

  const result = await runAgent({
    agent: st.agent,
    prompt,
    repoFullName: run.repoFullName,
    branchName: run.branchName || "devcommand/local",
    title: st.title,
    goal: run.goal,
    token,
    attempt: st.attempt + 1,
    relevantFiles: Array.isArray(scan?.relevantFiles) ? scan!.relevantFiles : [],
    openaiApiKey: keys.openaiApiKey,
    anthropicApiKey: keys.anthropicApiKey,
    geminiApiKey: keys.geminiApiKey,
    subTaskId: st.id,
    featureRunId: run.id,
  });

  if (result.needsHuman) {
    await prisma.subTask.update({
      where: { id: st.id },
      data: {
        status: "needs_followup",
        logs: appendLog(st.logs, result.logs),
        resultJson: (result.result || {}) as object,
      },
    });
    await enqueueSchedule({ featureRunId: run.id, userId: job.userId });
    return;
  }

  if (!result.available) {
    await prisma.subTask.update({
      where: { id: st.id },
      data: {
        status: "needs_followup",
        logs: appendLog(st.logs, result.logs + "\nAgent not connected — manual execution required."),
        resultJson: { ...(result.result || {}), manualPromptReady: true } as object,
      },
    });
    await prisma.featureRun.update({
      where: { id: run.id },
      data: {
        status: "awaiting_approval",
        errorMessage:
          "Agent not connected: manual execution required. No code was committed by a simulated connection.",
      },
    });
    await writeAudit({
      userId: job.userId,
      featureRunId: run.id,
      action: "subtask.unavailable",
      detail: st.agent,
    });
    return;
  }

  if (result.success) {
    await prisma.subTask.update({
      where: { id: st.id },
      data: {
        status: "done",
        completedAt: new Date(),
        logs: appendLog(st.logs, result.logs),
        resultJson: (result.result || { summary: result.summary }) as object,
      },
    });
    if (/test|verif/i.test(st.title) || st.agent === "testing") {
      await prisma.featureRun.update({
        where: { id: run.id },
        data: {
          status: "testing",
          testSummary: result.summary || result.logs.slice(0, 1000),
          verifyReport: (result.result as any)?.verifyReport || undefined,
        },
      });
    } else {
      await prisma.featureRun.update({ where: { id: run.id }, data: { status: "running" } });
    }
    await writeAudit({
      userId: job.userId,
      featureRunId: run.id,
      action: "subtask.done",
      detail: st.title,
    });
    await enqueueSchedule({ featureRunId: run.id, userId: job.userId });
    return;
  }

  const attempt = st.attempt + 1;
  if (attempt >= st.maxAttempts) {
    await prisma.subTask.update({
      where: { id: st.id },
      data: {
        status: "failed",
        logs: appendLog(st.logs, result.logs),
        resultJson: (result.result || {}) as object,
      },
    });
    await prisma.featureRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        errorMessage: result.followUpReason || `Sub-task failed: ${st.title}`,
      },
    });
    await writeAudit({
      userId: job.userId,
      featureRunId: run.id,
      action: "subtask.failed",
      detail: result.followUpReason || st.title,
    });
    return;
  }

  const follow = buildFollowUpPrompt(
    st.generatedPrompt,
    result.logs,
    result.followUpReason || "Agent reported failure"
  );
  await prisma.subTask.update({
    where: { id: st.id },
    data: {
      status: "needs_followup",
      followUpPrompt: follow,
      logs: appendLog(st.logs, result.logs),
    },
  });
  await enqueueSchedule({ featureRunId: run.id, userId: job.userId });
}

export async function startWorkers() {
  const boss = await getBoss();
  const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY || 2));

  type JobBatch<T> = Array<{ id: string; name: string; data: T }>;

  // Register multiple workers for parallel subtasks
  for (let i = 0; i < concurrency; i++) {
    await boss.work(QUEUE_SUBTASK, { batchSize: 1 }, async (jobs: JobBatch<SubTaskJob>) => {
      for (const job of jobs) {
        await executeSubTaskJob(job.data);
      }
    });
  }

  await boss.work(QUEUE_SCHEDULE, { batchSize: 1 }, async (jobs: JobBatch<ScheduleJob>) => {
    const { scheduleReadySubTasks } = await import("./supervisor.js");
    for (const job of jobs) {
      await scheduleReadySubTasks(job.data.featureRunId);
    }
  });

  await boss.work(QUEUE_VERIFY, { batchSize: 1 }, async (jobs: JobBatch<VerifyJob>) => {
    for (const job of jobs) {
      const run = await prisma.featureRun.findUnique({ where: { id: job.data.featureRunId } });
      if (!run?.branchName) continue;
      const token = await resolveToken(job.data.userId);
      if (!token) continue;
      const keys = await getUserLlmKeys(job.data.userId);
      await runVerificationInClone({
        agent: "testing",
        prompt: "Verify the feature branch",
        repoFullName: run.repoFullName,
        branchName: run.branchName,
        title: "Verification",
        goal: run.goal,
        token,
        attempt: 1,
        featureRunId: run.id,
        openaiApiKey: keys.openaiApiKey,
        anthropicApiKey: keys.anthropicApiKey,
        geminiApiKey: keys.geminiApiKey,
      });
    }
  });

  console.log(`[worker] pg-boss listening concurrency=${concurrency}`);
}
