import { gh } from "../github.js";
import type { RepoScan } from "./scanner.js";

export async function ensureFeatureBranch(
  token: string,
  fullName: string,
  defaultBranch: string,
  branchName: string
) {
  const ref = (await gh(`/repos/${fullName}/git/ref/heads/${encodeURIComponent(defaultBranch)}`, token)) as {
    object: { sha: string };
  };
  const sha = ref.object.sha;
  try {
    await gh(`/repos/${fullName}/git/refs`, token, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
    });
  } catch (e: any) {
    // Branch may already exist
    if (e?.status !== 422) throw e;
  }
  return { sha, branchName };
}

export type BranchDiff = { aheadBy: number; changedFiles: number; headSha: string };

export async function checkBranchDiff(token: string, fullName: string, base: string, head: string): Promise<BranchDiff> {
  // GitHub's compare API reports the actual file diff, not merely branch existence.
  const data = (await gh(
    `/repos/${fullName}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    token
  )) as { ahead_by?: number; files?: unknown[]; commits?: Array<{ sha?: string }>; head_commit?: { sha?: string } };
  return {
    aheadBy: Number(data.ahead_by || 0),
    changedFiles: Array.isArray(data.files) ? data.files.length : 0,
    headSha: data.commits?.at(-1)?.sha || data.head_commit?.sha || "",
  };
}

export function hasReviewableChanges(diff: BranchDiff): boolean {
  return diff.aheadBy > 0 && diff.changedFiles > 0 && Boolean(diff.headSha);
}

export async function openPullRequest(opts: {
  token: string;
  fullName: string;
  title: string;
  body: string;
  head: string;
  base: string;
}) {
  const pr = (await gh(`/repos/${opts.fullName}/pulls`, opts.token, {
    method: "POST",
    body: JSON.stringify({
      title: opts.title,
      body: opts.body,
      head: opts.head,
      base: opts.base,
      draft: false,
    }),
  })) as { html_url: string; number: number };

  return { prUrl: pr.html_url, prNumber: pr.number };
}

export async function mergePullRequest(opts: {
  token: string;
  fullName: string;
  prNumber: number;
}) {
  const data = (await gh(`/repos/${opts.fullName}/pulls/${opts.prNumber}/merge`, opts.token, {
    method: "PUT",
    body: JSON.stringify({ merge_method: "squash", commit_title: "DevCommand approved merge" }),
  })) as { merged?: boolean; message?: string; sha?: string };
  return data;
}

export function buildPrBody(goal: string, scan: RepoScan, subTasks: Array<{ title: string; agent: string; status: string }>) {
  return [
    `## DevCommand feature run`,
    ``,
    goal,
    ``,
    `### Repo scan`,
    scan.summary,
    ``,
    `### Sub-tasks`,
    ...subTasks.map((s, i) => `${i + 1}. **${s.title}** (${s.agent}) — \`${s.status}\``),
    ``,
    `### Safety`,
    `- Merge requires human approval in DevCommand.`,
    `- Do not deploy until checks pass.`,
  ].join("\n");
}

export function resolveDeployUrl(fullName: string, scan: RepoScan) {
  if (process.env.DEPLOY_BASE_URL) return process.env.DEPLOY_BASE_URL;
  // Best-effort hint for Render-style apps
  if (scan.topFiles.includes("render.yaml") || scan.hasCi) {
    return `https://dashboard.render.com`;
  }
  return `https://github.com/${fullName}/actions`;
}
