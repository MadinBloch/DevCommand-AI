import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { runCli } from "./cliRunner.js";
import { redactSecrets } from "./secretRedact.js";

export type WorkspaceHandle = {
  rootDir: string;
  worktreeDir: string;
  branchName: string;
  taskBranch: string;
  mode: "worktree" | "docker";
  containerId?: string;
};

function workspaceRoot() {
  return process.env.WORKSPACE_ROOT || path.join(process.cwd(), ".workspaces");
}

function safeRepoSlug(fullName: string) {
  return fullName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
}

function mirrorUrl(token: string, fullName: string) {
  // HTTPS clone with token — never write token into remotes that get logged
  return `https://x-access-token:${token}@github.com/${fullName}.git`;
}

async function git(cwd: string, args: string[], token?: string) {
  const env: Record<string, string> = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "echo",
  };
  if (token) {
    // Prefer credential via URL for one-shot ops; avoid credential helper files.
  }
  const { stdout, stderr, code, timedOut } = await runCli({
    command: "git",
    args,
    cwd,
    env,
    timeoutMs: 120_000,
  });
  if (timedOut || (code !== 0 && code !== null)) {
    throw new Error(redactSecrets(`git ${args.join(" ")} failed: ${stderr || stdout}`));
  }
  return stdout.trim();
}

export async function ensureRepoMirror(token: string, fullName: string): Promise<string> {
  const root = workspaceRoot();
  await fs.mkdir(root, { recursive: true });
  const mirrorDir = path.join(root, "mirrors", safeRepoSlug(fullName));
  const url = mirrorUrl(token, fullName);

  try {
    await fs.access(path.join(mirrorDir, ".git"));
    await git(mirrorDir, ["remote", "set-url", "origin", url]);
    await git(mirrorDir, ["fetch", "--all", "--prune"]);
  } catch {
    await fs.rm(mirrorDir, { recursive: true, force: true });
    await fs.mkdir(path.dirname(mirrorDir), { recursive: true });
    await git(path.dirname(mirrorDir), ["clone", "--filter=blob:none", url, mirrorDir]);
  }

  // Scrub token from remote URL after fetch
  await git(mirrorDir, ["remote", "set-url", "origin", `https://github.com/${fullName}.git`]);
  return mirrorDir;
}

export async function createTaskWorkspace(opts: {
  token: string;
  fullName: string;
  featureBranch: string;
  subTaskId: string;
  baseBranch?: string;
}): Promise<WorkspaceHandle> {
  const useDocker = process.env.DOCKER_WORKER === "1" || process.env.DOCKER_WORKER === "true";
  const mirror = await ensureRepoMirror(opts.token, opts.fullName);
  const taskBranch = `dc/${opts.subTaskId.slice(0, 10)}-${createHash("sha1")
    .update(opts.subTaskId)
    .digest("hex")
    .slice(0, 6)}`;
  const worktreesRoot = path.join(workspaceRoot(), "worktrees", safeRepoSlug(opts.fullName));
  await fs.mkdir(worktreesRoot, { recursive: true });
  const worktreeDir = path.join(worktreesRoot, opts.subTaskId);

  await fs.rm(worktreeDir, { recursive: true, force: true });

  // Ensure feature branch exists locally
  try {
    await git(mirror, ["fetch", "origin", opts.featureBranch]);
  } catch {
    /* may not exist remotely yet */
  }

  const startPoint = opts.featureBranch;
  try {
    await git(mirror, ["rev-parse", "--verify", `origin/${opts.featureBranch}`]);
  } catch {
    // Fall back to default
    if (opts.baseBranch) {
      await git(mirror, ["fetch", "origin", opts.baseBranch]);
    }
  }

  try {
    await git(mirror, [
      "worktree",
      "add",
      "-B",
      taskBranch,
      worktreeDir,
      `origin/${startPoint}`,
    ]);
  } catch {
    const base = opts.baseBranch || "main";
    await git(mirror, ["worktree", "add", "-B", taskBranch, worktreeDir, `origin/${base}`]);
  }

  // Configure push remote with ephemeral URL via env during push only
  await git(worktreeDir, ["config", "user.email", "devcommand@local"]);
  await git(worktreeDir, ["config", "user.name", "DevCommand Agent"]);

  if (useDocker) {
    const image = process.env.DOCKER_WORKER_IMAGE || "node:20-bookworm";
    const name = `dc-worker-${opts.subTaskId.slice(0, 8)}-${randomBytes(3).toString("hex")}`;
    const result = await runCli({
      command: "docker",
      args: [
        "run",
        "-d",
        "--network", "none",
        "--read-only",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--pids-limit", "128",
        "--memory", "1g",
        "--cpus", "1",
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m",
        "--name",
        name,
        "-v",
        `${worktreeDir}:/workspace`,
        "-w",
        "/workspace",
        image,
        "sleep",
        "infinity",
      ],
      cwd: worktreeDir,
      timeoutMs: 120_000,
    });
    if (result.code !== 0) {
      throw new Error(redactSecrets(`Docker worker failed: ${result.stderr || result.stdout}`));
    }
    return {
      rootDir: mirror,
      worktreeDir,
      branchName: opts.featureBranch,
      taskBranch,
      mode: "docker",
      containerId: name,
    };
  }

  return {
    rootDir: mirror,
    worktreeDir,
    branchName: opts.featureBranch,
    taskBranch,
    mode: "worktree",
  };
}

export async function collectWorkspaceDiff(worktreeDir: string): Promise<{
  dirty: boolean;
  status: string;
  changedFiles: string[];
}> {
  const status = await git(worktreeDir, ["status", "--porcelain"]);
  const changedFiles = status
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^\S+\s+/, ""));
  return { dirty: changedFiles.length > 0, status, changedFiles };
}

export async function commitAndPushWorkspace(opts: {
  token: string;
  fullName: string;
  worktreeDir: string;
  taskBranch: string;
  featureBranch: string;
  message: string;
}): Promise<{ commitSha: string; pushed: boolean }> {
  const { dirty } = await collectWorkspaceDiff(opts.worktreeDir);
  if (!dirty) {
    // Maybe agent already committed
    const log = await git(opts.worktreeDir, ["log", "-1", "--pretty=%H"]);
    return { commitSha: log, pushed: false };
  }

  await git(opts.worktreeDir, ["add", "-A"]);
  // Avoid committing secrets
  try {
    await git(opts.worktreeDir, ["reset", "HEAD", "--", ".env", ".env.*", "**/.env"]);
  } catch {
    /* ignore */
  }

  const commitResult = await runCli({
    command: "git",
    args: ["commit", "-m", opts.message.slice(0, 200)],
    cwd: opts.worktreeDir,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    timeoutMs: 60_000,
  });
  if (commitResult.code !== 0 || commitResult.timedOut) throw new Error(redactSecrets("Git commit failed: " + commitResult.stderr));

  const sha = await git(opts.worktreeDir, ["rev-parse", "HEAD"]);
  const url = mirrorUrl(opts.token, opts.fullName);

  // Push task branch, then merge into feature branch on remote via push of feature tip
  const taskPush = await runCli({
    command: "git",
    args: ["push", url, `HEAD:refs/heads/${opts.taskBranch}`],
    cwd: opts.worktreeDir,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    timeoutMs: 180_000,
  });
  if (taskPush.code !== 0 || taskPush.timedOut) throw new Error(redactSecrets("Task branch push failed: " + taskPush.stderr));

  // Also update feature branch tip when fast-forwardable: push task branch as feature if first commits,
  // otherwise attempt merge locally onto feature and push.
  await runCli({
    command: "git",
    args: ["fetch", url, opts.featureBranch],
    cwd: opts.worktreeDir,
    timeoutMs: 120_000,
  }).catch(() => undefined);

  const mergeTry = await runCli({
    command: "git",
    args: ["merge", "--no-edit", `FETCH_HEAD`],
    cwd: opts.worktreeDir,
    timeoutMs: 60_000,
  });

  if (mergeTry.code !== 0 && !String(mergeTry.stderr).includes("Already up to date")) {
    // Conflict: preserve the task branch but never report feature integration as successful.
    throw new Error(redactSecrets("Feature branch merge failed; task branch preserved for manual integration: " + mergeTry.stderr));
  }

  const featurePush = await runCli({
    command: "git",
    args: ["push", url, `HEAD:refs/heads/${opts.featureBranch}`],
    cwd: opts.worktreeDir,
    timeoutMs: 180_000,
  });
  if (featurePush.code !== 0 || featurePush.timedOut) {
    throw new Error(redactSecrets("Feature branch integration push failed; task branch preserved: " + featurePush.stderr));
  }
  return { commitSha: sha, pushed: true };
}

export async function destroyWorkspace(handle: WorkspaceHandle | null | undefined) {
  if (!handle) return;
  if (handle.containerId) {
    await runCli({
      command: "docker",
      args: ["rm", "-f", handle.containerId],
      cwd: handle.worktreeDir,
      timeoutMs: 60_000,
    }).catch(() => undefined);
  }
  try {
    await git(handle.rootDir, ["worktree", "remove", "--force", handle.worktreeDir]);
  } catch {
    await fs.rm(handle.worktreeDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function dockerWorkerEnabled() {
  return process.env.DOCKER_WORKER === "1" || process.env.DOCKER_WORKER === "true";
}

export async function dockerAvailable(): Promise<boolean> {
  try {
    const { code } = await runCli({
      command: "docker",
      args: ["version", "--format", "{{.Server.Version}}"],
      cwd: process.cwd(),
      timeoutMs: 8000,
    });
    return code === 0;
  } catch {
    return false;
  }
}
