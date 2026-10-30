import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CliProbeResult = {
  binary: string;
  installed: boolean;
  version?: string;
  error?: string;
};

const cache = new Map<string, { at: number; result: CliProbeResult }>();
const TTL_MS = 30_000;

async function which(cmd: string): Promise<string | null> {
  const isWin = process.platform === "win32";
  try {
    const { stdout } = await execFileAsync(isWin ? "where" : "which", [cmd], {
      timeout: 5000,
      windowsHide: true,
    });
    const line = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return line || null;
  } catch {
    return null;
  }
}

export async function probeCli(binary: string, versionArgs: string[] = ["--version"]): Promise<CliProbeResult> {
  const cached = cache.get(binary);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.result;

  const path = await which(binary);
  if (!path) {
    const result: CliProbeResult = {
      binary,
      installed: false,
      error: `${binary} not found on PATH`,
    };
    cache.set(binary, { at: Date.now(), result });
    return result;
  }

  try {
    const { stdout, stderr } = await execFileAsync(path, versionArgs, {
      timeout: 8000,
      windowsHide: true,
      env: process.env,
    });
    const version = (stdout || stderr).trim().split(/\r?\n/)[0]?.slice(0, 120);
    const result: CliProbeResult = { binary, installed: true, version };
    cache.set(binary, { at: Date.now(), result });
    return result;
  } catch (e: any) {
    // Binary exists but version failed — still treat as installed
    const result: CliProbeResult = {
      binary,
      installed: true,
      error: String(e?.message || e).slice(0, 200),
    };
    cache.set(binary, { at: Date.now(), result });
    return result;
  }
}

export function clearCliProbeCache() {
  cache.clear();
}
