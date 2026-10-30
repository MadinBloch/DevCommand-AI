import type { AgentRunInput, AgentRunResult } from "../agents/types.js";
import { runCli } from "./cliRunner.js";
import {
  collectWorkspaceDiff,
  commitAndPushWorkspace,
  createTaskWorkspace,
  destroyWorkspace,
} from "./workspace.js";
import { redactSecrets } from "./secretRedact.js";
import type { RepoScan } from "./scanner.js";
import { prisma } from "../db.js";

export type VerifyStepResult = {
  name: string;
  command: string;
  ok: boolean;
  exitCode: number | null;
  output: string;
  durationMs: number;
};

export type VerifyReport = {
  ok: boolean;
  steps: VerifyStepResult[];
  summary: string;
};

function detectCommands(scan: RepoScan | null | undefined, worktreeHint?: { hasPackageJson?: boolean }) {
  const steps: Array<{ name: string; command: string; args: string[] }> = [];
  const testCmd = scan?.testCommand;
  const buildCmd = scan?.buildCommand;
  const pm = scan?.packageManager || "npm";

  if (testCmd) {
    const parts = testCmd.split(/\s+/);
    steps.push({ name: "test", command: parts[0], args: parts.slice(1) });
  } else if (worktreeHint?.hasPackageJson || scan?.stack?.includes("node")) {
    steps.push({ name: "test", command: pm === "pnpm" ? "pnpm" : pm === "yarn" ? "yarn" : "npm", args: ["test", "--if-present"] });
  }

  if (scan?.stack?.some((s) => /typescript|node/i.test(s))) {
    steps.push({
      name: "typecheck",
      command: pm === "pnpm" ? "pnpm" : pm === "yarn" ? "yarn" : "npx",
      args: pm === "npm" || !pm ? ["tsc", "-p", ".", "--noEmit"] : ["exec", "tsc", "-p", ".", "--noEmit"],
    });
  }

  steps.push({
    name: "lint",
    command: pm === "pnpm" ? "pnpm" : pm === "yarn" ? "yarn" : "npm",
    args: ["run", "lint", "--if-present"],
  });

  if (buildCmd) {
    const parts = buildCmd.split(/\s+/);
    steps.push({ name: "build", command: parts[0], args: parts.slice(1) });
  } else if (scan?.stack?.includes("node")) {
    steps.push({
      name: "build",
      command: pm === "pnpm" ? "pnpm" : pm === "yarn" ? "yarn" : "npm",
      args: ["run", "build", "--if-present"],
    });
  }

  return steps.slice(0, 4);
}

export async function runVerificationCommands(
  cwd: string,
  scan: RepoScan | null | undefined
): Promise<VerifyReport> {
  const stepsSpec = detectCommands(scan, { hasPackageJson: true });
  const steps: VerifyStepResult[] = [];

  for (const spec of stepsSpec) {
    const result = await runCli({
      command: spec.command,
      args: spec.args,
      cwd,
      timeoutMs: Number(process.env.VERIFY_TIMEOUT_MS || 600_000),
    });
    steps.push({
      name: spec.name,
      command: [spec.command, ...spec.args].join(" "),
      ok: result.code === 0 && !result.timedOut,
      exitCode: result.code,
      output: redactSecrets((result.stdout + "\n" + result.stderr).slice(0, 12000)),
      durationMs: result.durationMs,
    });
    // Stop early on hard test failure
    if (spec.name === "test" && !steps[steps.length - 1].ok) break;
  }

  const ok = steps.length === 0 ? true : steps.every((s) => s.ok || s.name === "lint");
  const failed = steps.filter((s) => !s.ok).map((s) => s.name);
  return {
    ok: failed.length === 0,
    steps,
    summary: failed.length ? `Failed: ${failed.join(", ")}` : steps.length ? "All verification steps passed" : "No verification commands detected",
  };
}

export async function runVerificationInClone(input: AgentRunInput): Promise<AgentRunResult> {
  let handle = null as Awaited<ReturnType<typeof createTaskWorkspace>> | null;
  try {
    const run = input.featureRunId
      ? await prisma.featureRun.findUnique({ where: { id: input.featureRunId } })
      : null;
    const scan = (run?.scanJson as unknown as RepoScan) || null;

    handle = await createTaskWorkspace({
      token: input.token,
      fullName: input.repoFullName,
      featureBranch: input.branchName,
      subTaskId: input.subTaskId || `verify-${Date.now()}`,
    });

    const report = await runVerificationCommands(handle.worktreeDir, scan);
    if (run) {
      await prisma.featureRun.update({
        where: { id: run.id },
        data: {
          testSummary: report.summary,
          verifyReport: report as object,
          status: report.ok ? "reviewing" : "running",
        },
      });
    }

    if (!report.ok) {
      return {
        success: false,
        available: true,
        logs: report.steps.map((s) => `## ${s.name}\n$ ${s.command}\nexit=${s.exitCode}\n${s.output}`).join("\n\n"),
        followUpReason: report.summary,
        summary: report.summary,
        result: { verifyReport: report },
      };
    }

    return {
      success: true,
      available: true,
      logs: report.steps.map((s) => `## ${s.name} OK (${s.durationMs}ms)`).join("\n"),
      summary: report.summary,
      result: { verifyReport: report },
    };
  } catch (e: any) {
    return {
      success: false,
      available: true,
      logs: String(e?.message || e),
      followUpReason: "Verification worker failed",
    };
  } finally {
    await destroyWorkspace(handle).catch(() => undefined);
  }
}

export async function integrateTaskBranches(opts: {
  token: string;
  fullName: string;
  featureBranch: string;
  worktreeDir: string;
}): Promise<{ conflicts: string[]; ok: boolean }> {
  const diff = await collectWorkspaceDiff(opts.worktreeDir);
  if (diff.dirty) {
    await commitAndPushWorkspace({
      token: opts.token,
      fullName: opts.fullName,
      worktreeDir: opts.worktreeDir,
      taskBranch: "tmp-integrate",
      featureBranch: opts.featureBranch,
      message: "chore(devcommand): integrate agent changes",
    });
  }
  return { conflicts: [], ok: true };
}
