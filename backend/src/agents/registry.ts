import type { AgentAdapter, AgentName, AgentRunInput, AgentRunResult } from "./types.js";
import { llmCoderAvailable, runLlmCoder, simulateCommit } from "./llmCoder.js";

async function maybeExternal(
  baseUrl: string | undefined,
  apiKey: string | undefined,
  input: AgentRunInput
): Promise<AgentRunResult | null> {
  if (!baseUrl) return null;
  try {
    const r = await fetch(baseUrl.replace(/\/$/, "") + "/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}),
      },
      body: JSON.stringify(input),
    });
    if (!r.ok) {
      return {
        success: false,
        available: true,
        logs: await r.text(),
        followUpReason: "External adapter returned non-OK status",
      };
    }
    const data = (await r.json()) as AgentRunResult;
    return { ...data, available: true };
  } catch (e: any) {
    return {
      success: false,
      available: true,
      logs: String(e?.message || e),
      followUpReason: "External adapter request failed",
    };
  }
}

function userKeysFrom(input: AgentRunInput) {
  return { openaiApiKey: input.openaiApiKey, anthropicApiKey: input.anthropicApiKey };
}

async function executeCodingAgent(input: AgentRunInput, kind: "codex" | "antigravity"): Promise<AgentRunResult> {
  const url = kind === "codex" ? process.env.CODEX_API_URL : process.env.ANTIGRAVITY_API_URL;
  const key = kind === "codex" ? process.env.CODEX_API_KEY : process.env.ANTIGRAVITY_API_KEY;
  const external = await maybeExternal(url, key, input);
  if (external) {
    const files = (external.result as any)?.files;
    if (external.success && Array.isArray(files) && files[0]?.content != null) {
      const { commitFilesToBranch } = await import("../services/gitWriter.js");
      try {
        const committed = await commitFilesToBranch({
          token: input.token,
          fullName: input.repoFullName,
          branchName: input.branchName,
          message: String((external.result as any)?.commitMessage || `feat(devcommand): ${input.title}`),
          files,
        });
        return {
          ...external,
          logs: external.logs + `\n[devcommand] committed ${committed.commitSha}`,
          result: { ...(external.result || {}), commitSha: committed.commitSha },
        };
      } catch (e: any) {
        return {
          success: false,
          available: true,
          logs: external.logs + "\nCommit failed: " + (e?.message || e),
          followUpReason: "Adapter succeeded but GitHub commit failed",
        };
      }
    }
    return external;
  }

  if (llmCoderAvailable(userKeysFrom(input))) {
    return runLlmCoder(input, { relevantFiles: input.relevantFiles });
  }

  if (process.env.AGENT_MODE === "simulate") {
    return simulateCommit({ ...input, agent: kind });
  }

  return {
    success: false,
    available: false,
    logs:
      "No coding engine. Add your OpenAI key in Settings, set OPENAI_API_KEY on the server, connect an adapter, or use AGENT_MODE=simulate.",
    followUpReason: "Adapter unavailable",
    result: { manualPromptReady: true },
  };
}

function codingAvailable(userKeys?: { openaiApiKey?: string | null; anthropicApiKey?: string | null }) {
  // Real execution only: user/server LLM key or external adapter.
  // AGENT_MODE=simulate alone does NOT count — it only writes .devcommand demo files.
  return Boolean(
    process.env.CODEX_API_URL || process.env.ANTIGRAVITY_API_URL || llmCoderAvailable(userKeys)
  );
}

const antigravity: AgentAdapter = {
  name: "antigravity",
  available: codingAvailable(),
  reason: undefined,
  run: (input) => executeCodingAgent(input, "antigravity"),
};

const codex: AgentAdapter = {
  name: "codex",
  available: codingAvailable(),
  reason: undefined,
  run: (input) => executeCodingAgent(input, "codex"),
};

const llm: AgentAdapter = {
  name: "llm",
  available: llmCoderAvailable(),
  reason: undefined,
  run: (input) => runLlmCoder(input, { relevantFiles: input.relevantFiles }),
};

const human: AgentAdapter = {
  name: "human",
  available: true,
  async run(input) {
    return {
      success: false,
      available: true,
      needsHuman: true,
      logs: `Human review required for: ${input.title}`,
      summary: "Waiting for human approval in DevCommand UI.",
      result: { awaitingHuman: true },
    };
  },
};

const simulated: AgentAdapter = {
  name: "simulated",
  available: true,
  async run(input) {
    return simulateCommit(input);
  },
};

const adapters: Record<AgentName, AgentAdapter> = {
  antigravity,
  codex,
  human,
  simulated,
  llm,
};

export function listAgents(userKeys?: { openaiApiKey?: string | null; anthropicApiKey?: string | null }) {
  const canLlm = llmCoderAvailable(userKeys);
  const canCode = codingAvailable(userKeys);
  return (Object.keys(adapters) as AgentName[]).map((name) => {
    if (name === "human" || name === "simulated") {
      return { name, available: true, reason: null as string | null };
    }
    if (name === "llm") {
      return {
        name,
        available: canLlm,
        reason: canLlm ? "LLM coder ready" : "Add OpenAI key in Settings",
      };
    }
    return {
      name,
      available: canCode,
      reason: canCode
        ? canLlm
          ? "Using LLM coder / adapter"
          : process.env.AGENT_MODE === "simulate"
            ? "Simulation commits"
            : "Adapter connected"
        : "Add OpenAI key in Settings or connect adapter",
    };
  });
}

export function executionCapability(userKeys?: { openaiApiKey?: string | null; anthropicApiKey?: string | null }) {
  return {
    mode: process.env.AGENT_MODE || "manual",
    llmCoder: llmCoderAvailable(userKeys),
    canCommit: codingAvailable(userKeys),
  };
}

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const key = (input.agent as AgentName) in adapters ? (input.agent as AgentName) : "codex";
  if (key === "human") return human.run(input);
  const adapter = adapters[key] || adapters.codex;
  return adapter.run(input);
}
