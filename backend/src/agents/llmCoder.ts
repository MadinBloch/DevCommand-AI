import { gh } from "../github.js";
import { commitFilesToBranch, sanitizeChanges, type FileChange } from "../services/gitWriter.js";
import type { AgentRunInput, AgentRunResult } from "./types.js";

type LlmPatchResponse = {
  summary?: string;
  commitMessage?: string;
  files?: Array<{ path: string; content: string; action?: "create" | "update" | "delete" }>;
  notes?: string;
};

async function readFile(token: string, fullName: string, path: string, ref: string): Promise<string | null> {
  try {
    const data = (await gh(
      `/repos/${fullName}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
      token
    )) as { content?: string; encoding?: string; type?: string };
    if (!data.content || data.type === "dir") return null;
    return Buffer.from(data.content, (data.encoding as BufferEncoding) || "base64").toString("utf8").slice(0, 14000);
  } catch {
    return null;
  }
}

async function gatherContext(input: AgentRunInput, paths: string[]) {
  const chunks: string[] = [];
  for (const path of paths.slice(0, 10)) {
    const body = await readFile(input.token, input.repoFullName, path, input.branchName);
    if (body != null) chunks.push(`### FILE: ${path}\n\`\`\`\n${body}\n\`\`\``);
  }
  return chunks.join("\n\n").slice(0, 60000);
}

function extractJson(text: string): LlmPatchResponse | null {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

async function callOpenAI(system: string, user: string, apiKey?: string | null): Promise<string | null> {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) return null;
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(body || `OpenAI HTTP ${r.status}`);
  }
  const data = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content || null;
}

async function callAnthropic(system: string, user: string, apiKey?: string | null): Promise<string | null> {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest",
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(body || `Anthropic HTTP ${r.status}`);
  }
  const data = (await r.json()) as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text || null;
}

export function llmCoderAvailable(userKeys?: { openaiApiKey?: string | null; anthropicApiKey?: string | null }) {
  return Boolean(
    userKeys?.openaiApiKey ||
      userKeys?.anthropicApiKey ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY
  );
}

/** Heuristic demo commit so PRs open without an LLM key (AGENT_MODE=simulate). */
export async function simulateCommit(input: AgentRunInput): Promise<AgentRunResult> {
  const stamp = new Date().toISOString();
  const path = `.devcommand/runs/${input.branchName.replace(/\//g, "-")}.md`;
  const existing = (await readFile(input.token, input.repoFullName, path, input.branchName)) || "";
  const content =
    existing +
    [
      ``,
      `## ${stamp} — ${input.title}`,
      ``,
      `- Agent: ${input.agent}`,
      `- Goal: ${input.goal}`,
      `- Attempt: ${input.attempt}`,
      ``,
      `### Prompt excerpt`,
      ``,
      "```",
      input.prompt.slice(0, 1200),
      "```",
      ``,
    ].join("\n");

  try {
    const { commitSha, filesChanged } = await commitFilesToBranch({
      token: input.token,
      fullName: input.repoFullName,
      branchName: input.branchName,
      message: `chore(devcommand): ${input.title}`,
      files: [{ path, content, action: existing ? "update" : "create" }],
    });
    return {
      success: true,
      available: true,
      logs: [`[simulate] Committed demo artifact to ${path}`, `commit ${commitSha}`, `${filesChanged} file(s)`].join("\n"),
      summary: `Simulated commit for "${input.title}"`,
      result: { mode: "simulate", commitSha, files: [path] },
    };
  } catch (e: any) {
    return {
      success: false,
      available: true,
      logs: String(e?.message || e),
      followUpReason: "Simulate commit failed",
    };
  }
}

export async function runLlmCoder(
  input: AgentRunInput,
  opts?: { relevantFiles?: string[] }
): Promise<AgentRunResult> {
  const userKeys = { openaiApiKey: input.openaiApiKey, anthropicApiKey: input.anthropicApiKey };
  if (!llmCoderAvailable(userKeys)) {
    return {
      success: false,
      available: false,
      logs: "No OpenAI/Anthropic key. Add one in Settings or set server env OPENAI_API_KEY.",
      followUpReason: "LLM coder unavailable",
    };
  }

  const paths = opts?.relevantFiles?.length
    ? opts.relevantFiles
    : ["README.md", "package.json", "composer.json"].filter(Boolean);

  const context = await gatherContext(input, paths);
  const system = `You are DevCommand's coding agent. Return ONLY valid JSON:
{
  "summary": "short summary",
  "commitMessage": "conventional commit message",
  "files": [{ "path": "relative/path", "content": "full file contents", "action": "create"|"update"|"delete" }],
  "notes": "optional"
}
Rules:
- Implement ONLY this step's objective; keep scope small.
- Prefer updating existing files from context; create new files only when needed.
- Never touch secrets (.env, keys, credentials).
- Provide FULL file content for updates (not diffs).
- Max 8 files. If inspection-only with no code change needed, return files: [] and explain in notes.`;

  const user = [
    `Repository: ${input.repoFullName}`,
    `Branch: ${input.branchName}`,
    `Step title: ${input.title}`,
    `Agent role: ${input.agent}`,
    `Feature goal: ${input.goal}`,
    ``,
    `### Step prompt`,
    input.prompt,
    ``,
    `### Repo file context`,
    context || "(no files loaded)",
  ].join("\n");

  let raw: string | null = null;
  try {
    raw =
      (await callOpenAI(system, user, input.openaiApiKey)) ||
      (await callAnthropic(system, user, input.anthropicApiKey));
  } catch (e: any) {
    return {
      success: false,
      available: true,
      logs: String(e?.message || e),
      followUpReason: "LLM request failed",
    };
  }

  if (!raw) {
    return {
      success: false,
      available: true,
      logs: "LLM returned empty response",
      followUpReason: "Empty LLM response",
    };
  }

  const parsed = extractJson(raw);
  if (!parsed) {
    return {
      success: false,
      available: true,
      logs: "Could not parse LLM JSON:\n" + raw.slice(0, 2000),
      followUpReason: "Invalid LLM JSON",
    };
  }

  const files = sanitizeChanges((parsed.files || []) as FileChange[]);
  if (!files.length) {
    // Inspection / no-op step — still record a tiny progress note so pipeline can proceed,
    // but only when AGENT_MODE allows soft commits
    if (process.env.ALLOW_EMPTY_STEP_COMMIT === "true" || /inspect|scan|review|map/i.test(input.title)) {
      const notePath = `.devcommand/notes/${input.branchName.replace(/\//g, "-")}-${input.attempt}.md`;
      const note = `# ${input.title}\n\n${parsed.summary || parsed.notes || "No file changes for this step."}\n`;
      try {
        const { commitSha } = await commitFilesToBranch({
          token: input.token,
          fullName: input.repoFullName,
          branchName: input.branchName,
          message: parsed.commitMessage || `docs(devcommand): ${input.title}`,
          files: [{ path: notePath, content: note, action: "create" }],
        });
        return {
          success: true,
          available: true,
          logs: `No code files changed. Wrote note ${notePath}\ncommit ${commitSha}\n${parsed.notes || ""}`,
          summary: parsed.summary || "Note-only step",
          result: { mode: "llm", commitSha, files: [notePath], noop: true },
        };
      } catch (e: any) {
        return {
          success: true,
          available: true,
          logs: `No file changes. ${parsed.notes || parsed.summary || ""}\n(note commit skipped: ${e?.message || e})`,
          summary: parsed.summary || "No changes",
          result: { mode: "llm", files: [], noop: true },
        };
      }
    }
    return {
      success: false,
      available: true,
      logs: `LLM proposed no files. notes: ${parsed.notes || parsed.summary || ""}`,
      followUpReason: "LLM returned zero file changes",
    };
  }

  try {
    const { commitSha, filesChanged } = await commitFilesToBranch({
      token: input.token,
      fullName: input.repoFullName,
      branchName: input.branchName,
      message: parsed.commitMessage || `feat(devcommand): ${input.title}`,
      files,
    });
    const list = files.map((f) => `- ${f.action || "update"} ${f.path}`).join("\n");
    return {
      success: true,
      available: true,
      logs: [`[llm-coder] ${parsed.summary || "Committed changes"}`, `commit ${commitSha}`, list].join("\n"),
      summary: parsed.summary || `Committed ${filesChanged} file(s)`,
      result: {
        mode: "llm",
        commitSha,
        files: files.map((f) => f.path),
        filesChanged,
      },
    };
  } catch (e: any) {
    return {
      success: false,
      available: true,
      logs: String(e?.message || e),
      followUpReason: "GitHub commit failed",
    };
  }
}
