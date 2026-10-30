import { spawn } from "node:child_process";
import { redactSecrets } from "./secretRedact.js";

export type CliRunOptions = {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  input?: string;
};

export type CliRunResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
};

/**
 * Spawn a CLI with timeout. Never log raw env. stdout/stderr are redacted.
 * Command and args must be controlled by DevCommand — never pass unsanitized repo content as the executable.
 */
export function runCli(opts: CliRunOptions): Promise<CliRunResult> {
  const timeoutMs = opts.timeoutMs ?? Number(process.env.AGENT_CLI_TIMEOUT_MS || 900_000);
  const started = Date.now();

  return new Promise((resolve) => {
    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env || {}) } as NodeJS.ProcessEnv,
      windowsHide: true,
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 5000);
    }, timeoutMs);

    child.stdout?.on("data", (buf: Buffer) => {
      stdout += buf.toString("utf8");
      if (stdout.length > 2_000_000) stdout = stdout.slice(-1_500_000);
    });
    child.stderr?.on("data", (buf: Buffer) => {
      stderr += buf.toString("utf8");
      if (stderr.length > 1_000_000) stderr = stderr.slice(-750_000);
    });

    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        signal,
        stdout: redactSecrets(stdout),
        stderr: redactSecrets(stderr),
        timedOut,
        durationMs: Date.now() - started,
      });
    };

    child.on("error", (err) => {
      stderr += `\n[spawn error] ${err.message}`;
      finish(1, null);
    });
    child.on("close", (code, signal) => finish(code, signal));

    if (opts.input) {
      child.stdin?.write(opts.input);
      child.stdin?.end();
    }
  });
}
