import PgBoss from "pg-boss";

export const QUEUE_SUBTASK = "agent-subtask";
export const QUEUE_VERIFY = "run-verify";
export const QUEUE_SCHEDULE = "run-schedule";

let boss: InstanceType<typeof PgBoss> | null = null;
let started = false;

export type SubTaskJob = {
  subTaskId: string;
  featureRunId: string;
  userId: string;
};

export type ScheduleJob = {
  featureRunId: string;
  userId: string;
};

export type VerifyJob = {
  featureRunId: string;
  userId: string;
};

export async function getBoss(): Promise<InstanceType<typeof PgBoss>> {
  if (boss && started) return boss;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL required for pg-boss");

  boss = new PgBoss({
    connectionString,
    // Keep schema separate from Prisma tables
    schema: process.env.PGBOSS_SCHEMA || "pgboss",
    application_name: "devcommand-ai",
  });

  boss.on("error", (err: Error) => {
    console.error("[pg-boss]", err.message || err);
  });

  await boss.start();
  await boss.createQueue(QUEUE_SUBTASK, {
    name: QUEUE_SUBTASK,
    retryLimit: 0, // retries owned by SubTask.maxAttempts
    expireInSeconds: Number(process.env.AGENT_JOB_TIMEOUT_SEC || 1800),
  });
  await boss.createQueue(QUEUE_VERIFY, {
    name: QUEUE_VERIFY,
    retryLimit: 1,
    expireInSeconds: 900,
  });
  await boss.createQueue(QUEUE_SCHEDULE, {
    name: QUEUE_SCHEDULE,
    retryLimit: 2,
    expireInSeconds: 300,
  });
  started = true;
  return boss;
}

export async function enqueueSubTask(job: SubTaskJob, opts?: { singletonKey?: string }) {
  const b = await getBoss();
  const id = await b.send(QUEUE_SUBTASK, job, {
    singletonKey: opts?.singletonKey || job.subTaskId,
    retryLimit: 0,
    expireInSeconds: Number(process.env.AGENT_JOB_TIMEOUT_SEC || 1800),
  });
  return id;
}

export async function enqueueSchedule(job: ScheduleJob) {
  const b = await getBoss();
  return b.send(QUEUE_SCHEDULE, job, {
    singletonKey: `schedule:${job.featureRunId}`,
    singletonSeconds: 5,
  });
}

export async function enqueueVerify(job: VerifyJob) {
  const b = await getBoss();
  return b.send(QUEUE_VERIFY, job, {
    singletonKey: `verify:${job.featureRunId}`,
    singletonSeconds: 30,
  });
}

export async function cancelSubTaskJob(jobId: string | null | undefined) {
  if (!jobId || !boss) return;
  try {
    await boss.cancel(QUEUE_SUBTASK, jobId);
  } catch {
    /* ignore */
  }
}

export async function stopQueue() {
  if (boss) {
    await boss.stop({ graceful: true, timeout: 10000 });
    boss = null;
    started = false;
  }
}
