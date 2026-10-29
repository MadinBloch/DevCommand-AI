import { gh } from "../github.js";

export type FileChange = {
  path: string;
  content: string;
  action?: "create" | "update" | "delete";
};

const BLOCKED = /(^|\/)(\.env|\.env\..+|credentials\.json|id_rsa|\.pem)$/i;

export function sanitizeChanges(files: FileChange[]): FileChange[] {
  const out: FileChange[] = [];
  for (const f of files) {
    const path = String(f.path || "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .trim();
    if (!path || path.includes("..") || BLOCKED.test(path)) continue;
    // MVP: create/update only (deletes skipped for safety)
    if ((f.action || "update") === "delete") continue;
    const content = String(f.content ?? "");
    if (content.length > 400_000) continue;
    out.push({ path, content, action: f.action || "update" });
  }
  const map = new Map<string, FileChange>();
  for (const f of out) map.set(f.path, f);
  return [...map.values()].slice(0, 40);
}

export async function commitFilesToBranch(opts: {
  token: string;
  fullName: string;
  branchName: string;
  message: string;
  files: FileChange[];
  authorName?: string;
  authorEmail?: string;
}): Promise<{ commitSha: string; filesChanged: number }> {
  const files = sanitizeChanges(opts.files);
  if (!files.length) throw new Error("No valid files to commit.");

  const ref = (await gh(
    `/repos/${opts.fullName}/git/ref/heads/${encodeURIComponent(opts.branchName)}`,
    opts.token
  )) as { object: { sha: string } };
  const headSha = ref.object.sha;

  const parent = (await gh(`/repos/${opts.fullName}/git/commits/${headSha}`, opts.token)) as {
    tree: { sha: string };
  };

  const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];
  for (const f of files) {
    const blob = (await gh(`/repos/${opts.fullName}/git/blobs`, opts.token, {
      method: "POST",
      body: JSON.stringify({
        content: Buffer.from(f.content, "utf8").toString("base64"),
        encoding: "base64",
      }),
    })) as { sha: string };
    treeItems.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
  }

  const tree = (await gh(`/repos/${opts.fullName}/git/trees`, opts.token, {
    method: "POST",
    body: JSON.stringify({ base_tree: parent.tree.sha, tree: treeItems }),
  })) as { sha: string };

  const commit = (await gh(`/repos/${opts.fullName}/git/commits`, opts.token, {
    method: "POST",
    body: JSON.stringify({
      message: opts.message,
      tree: tree.sha,
      parents: [headSha],
      author: {
        name: opts.authorName || "DevCommand AI",
        email: opts.authorEmail || "devcommand@users.noreply.github.com",
      },
    }),
  })) as { sha: string };

  await gh(`/repos/${opts.fullName}/git/refs/heads/${encodeURIComponent(opts.branchName)}`, opts.token, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });

  return { commitSha: commit.sha, filesChanged: files.length };
}
