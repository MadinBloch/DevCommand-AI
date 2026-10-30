import type { AgentAdapter, AgentName, AgentRunInput, AgentRunResult } from "./types.js";
import { llmCoderAvailable, runLlmCoder, simulateCommit } from "./llmCoder.js";
import {
  getProviderStatuses,
  runAntigravityCli,
  runClaudeCli,
  runCodexCli,
  runGeminiCli,
  type ProviderStatus,
} from "./cliAgents.js";

async function maybeExternal(
  baseUrl: string | undefined,
  apiKey: string | undefined,
  input: AgentRunInput
): Promise<AgentRunResult | null> {
  if (!baseUrl) return null;
  try {
    // Never forward GitHub token to untrusted adapters unless explicitly allowed
    const payload = {
      ...input,
      token: process.env.ADAPTER_FORWARD_GITHUB_TOKEN === "1" ? input.token : undefined,
    };
    const r = await fetch(baseUrl.replace(/\/$/, "") + "/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}),
      },
      body: JSON.stringify(payload),
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
  return {
    openaiApiKey: input.openaiApiKey,
    anthropicApiKey: input.anthropicApiKey,
    geminiApiKey: input.geminiApiKey,
  };
}

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
  available: process.env.AGENT_MODE === "simulate",
  async run(input) {
    if (process.env.AGENT_MODE !== "simulate") {
      return {
        success: false,
        available: false,
        logs: "Simulation disabled. AGENT_MODE=simulate is required for the simulated agent.",
        followUpReason: "Simulation not enabled",
      };
    }
    return simulateCommit(input);
  },
};

const llm: AgentAdapter = {
  name: "llm",
  available: llmCoderAvailable(),
  reason: undefined,
  run: (input) => runLlmCoder(input, { relevantFiles: input.relevantFiles }),
};

const testing: AgentAdapter = {
  name: "testing",
  available: true,
  async run(input) {
    const { runVerificationInClone } = await import("../services/verify.js");
    return runVerificationInClone(input);
  },
};

const adapters: Partial<Record<AgentName, AgentAdapter>> = {
  human,
  simulated,
  llm,
  testing,
};

export async function listAgentsDetailed(userKeys?: {
  openaiApiKey?: string | null;
  anthropicApiKey?: string | null;
  geminiApiKey?: string | null;
}) {
  const providers = await getProviderStatuses();
  const byName = new Map(providers.map((p) => [p.provider, p]));
  const canLlm = llmCoderAvailable(userKeys);

  const names: AgentName[] = ["codex", "claude", "gemini", "antigravity", "llm", "testing", "human", "simulated"];

  return names.map((name) => {
    if (name === "human") {
      return {
        name,
        displayName: "Human reviewer",
        available: true,
        connected: true,
        enabled: true,
        mode: "human",
        reason: "Approval gate in UI",
        executionState: "idle",
      };
    }
    if (name === "simulated") {
      const on = process.env.AGENT_MODE === "simulate";
      return {
        name,
        displayName: "Simulated (demo)",
        available: on,
        connected: false,
        enabled: on,
        mode: "simulate",
        reason: on
          ? "Demo commits under .devcommand/ only — never shown as a real coding agent"
          : "Disabled unless AGENT_MODE=simulate",
        executionState: "idle",
      };
    }
    if (name === "llm") {
      return {
        name,
        displayName: "LLM patch coder",
        available: canLlm,
        connected: canLlm,
        enabled: canLlm,
        mode: "llm-api",
        reason: canLlm
          ? "OpenAI/Anthropic chat API file patches (not a coding CLI)"
          : "Add OpenAI or Anthropic key in Settings",
        executionState: "idle",
      };
    }
    if (name === "testing") {
      return {
        name,
        displayName: "Verification worker",
        available: true,
        connected: true,
        enabled: true,
        mode: "worker",
        reason: "Runs project test/lint/typecheck/build in an isolated worktree",
        executionState: "idle",
      };
    }

    const p = byName.get(name as ProviderStatus["provider"]);
    const external =
      (name === "codex" && process.env.CODEX_API_URL) ||
      (name === "antigravity" && process.env.ANTIGRAVITY_API_URL);

    const connected = Boolean(p?.connected || external);
    return {
      name,
      displayName: p?.displayName || name,
      available: connected,
      connected,
      enabled: connected,
      mode: external ? "http-adapter" : p?.mode || "unavailable",
      reason: external
        ? `HTTP adapter at ${name === "codex" ? "CODEX_API_URL" : "ANTIGRAVITY_API_URL"}`
        : p?.reason || "Not connected",
      version: p?.version,
      requires: p?.requires || [],
      executionState: "idle",
    };
  });
}

/** Backward-compatible shape for existing frontend */
export function listAgents(userKeys?: { openaiApiKey?: string | null; anthropicApiKey?: string | null }) {
  // Sync fallback used only if caller cannot await — prefer listAgentsDetailed
  const canLlm = llmCoderAvailable(userKeys);
  return [
    {
      name: "codex",
      available: Boolean(process.env.CODEX_API_URL) || canLlm,
      reason: process.env.CODEX_API_URL ? "HTTP adapter" : canLlm ? "LLM fallback (not Codex CLI)" : "Codex CLI not probed (use /api/agents)",
    },
    {
      name: "claude",
      available: false,
      reason: "Use GET /api/agents for live Claude Code status",
    },
    {
      name: "gemini",
      available: false,
      reason: "Use GET /api/agents for live Gemini CLI status",
    },
    {
      name: "antigravity",
      available: Boolean(process.env.ANTIGRAVITY_API_URL),
      reason: process.env.ANTIGRAVITY_API_URL ? "HTTP adapter" : "agy CLI not probed",
    },
    {
      name: "llm",
      available: canLlm,
      reason: canLlm ? "LLM coder ready" : "Add OpenAI key in Settings",
    },
    { name: "testing", available: true, reason: "Verification worker" },
    { name: "human", available: true, reason: null },
    {
      name: "simulated",
      available: process.env.AGENT_MODE === "simulate",
      reason: process.env.AGENT_MODE === "simulate" ? "Demo only" : "Disabled",
    },
  ];
}

export function executionCapability(userKeys?: {
  openaiApiKey?: string | null;
  anthropicApiKey?: string | null;
  geminiApiKey?: string | null;
}) {
  return {
    mode: process.env.AGENT_MODE || "manual",
    llmCoder: llmCoderAvailable(userKeys),
    // Real commit path: LLM coder OR any CLI may be present (checked async) OR adapters
    canCommit:
      llmCoderAvailable(userKeys) ||
      Boolean(process.env.CODEX_API_URL) ||
      Boolean(process.env.ANTIGRAVITY_API_URL) ||
      process.env.ALLOW_CLI_AGENTS === "1" ||
      process.env.AGENT_MODE === "simulate",
    dockerWorker: process.env.DOCKER_WORKER === "1" || process.env.DOCKER_WORKER === "true",
  };
}

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const key = String(input.agent || "codex") as AgentName;

  if (key === "human") return human.run(input);
  if (key === "simulated") return simulated.run(input);
  if (key === "testing") return testing.run(input);
  if (key === "llm") return llm.run(input);

  if (key === "codex") {
    const external = await maybeExternal(process.env.CODEX_API_URL, process.env.CODEX_API_KEY, input);
    if (external) {
      if (external.success && Array.isArray((external.result as any)?.files)) {
        const files = (external.result as any).files;
        if (files[0]?.content != null) {
          const { commitFilesToBranch } = await import("../services/gitWriter.js");
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
        }
      }
      return external;
    }
    const cli = await runCodexCli(input);
    if (cli.available) return cli;
    // Fallback: LLM patch coder only if explicitly allowed — never claim it is Codex
    if (llmCoderAvailable(userKeysFrom(input)) && process.env.CODEX_LLM_FALLBACK === "1") {
      const r = await runLlmCoder(input, { relevantFiles: input.relevantFiles });
      return {
        ...r,
        logs: `[codex] CLI unavailable; CODEX_LLM_FALLBACK=1 using LLM patch coder\n` + r.logs,
        result: { ...(r.result || {}), provider: "llm-fallback", requested: "codex" },
      };
    }
    return cli;
  }

  if (key === "claude") {
    return runClaudeCli(input);
  }

  if (key === "gemini") {
    return runGeminiCli(input);
  }

  if (key === "antigravity") {
    const external = await maybeExternal(
      process.env.ANTIGRAVITY_API_URL,
      process.env.ANTIGRAVITY_API_KEY,
      input
    );
    if (external) return external;
    return runAntigravityCli(input);
  }

  // Unknown agent name → try codex path
  return runAgent({ ...input, agent: "codex" });
}

export { adapters };
