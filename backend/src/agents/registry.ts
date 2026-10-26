import type { AgentAdapter, AgentName, AgentRunInput, AgentRunResult } from "./types.js";

function simulateWork(input: AgentRunInput): AgentRunResult {
  const lines = [
    `[${input.agent}] Starting step: ${input.title}`,
    `[${input.agent}] Repo: ${input.repoFullName} @ ${input.branchName}`,
    `[${input.agent}] Attempt ${input.attempt}`,
    `[${input.agent}] Prompt length: ${input.prompt.length} chars`,
    `[${input.agent}] Simulated execution completed with checklist verified.`,
  ];
  return {
    success: true,
    available: true,
    logs: lines.join("\n"),
    summary: `Simulated ${input.agent} completed "${input.title}".`,
    result: { mode: "simulate", agent: input.agent },
  };
}

const antigravity: AgentAdapter = {
  name: "antigravity",
  available: Boolean(process.env.ANTIGRAVITY_API_URL || process.env.AGENT_MODE === "simulate"),
  reason: process.env.ANTIGRAVITY_API_URL
    ? undefined
    : process.env.AGENT_MODE === "simulate"
      ? undefined
      : "Set ANTIGRAVITY_API_URL or AGENT_MODE=simulate",
  async run(input) {
    if (process.env.ANTIGRAVITY_API_URL) {
      try {
        const r = await fetch(process.env.ANTIGRAVITY_API_URL.replace(/\/$/, "") + "/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.ANTIGRAVITY_API_KEY
              ? { Authorization: "Bearer " + process.env.ANTIGRAVITY_API_KEY }
              : {}),
          },
          body: JSON.stringify(input),
        });
        if (!r.ok) {
          return {
            success: false,
            available: true,
            logs: await r.text(),
            followUpReason: "Antigravity adapter returned non-OK status",
          };
        }
        const data = (await r.json()) as AgentRunResult;
        return { ...data, available: true };
      } catch (e: any) {
        return {
          success: false,
          available: true,
          logs: String(e?.message || e),
          followUpReason: "Antigravity request failed",
        };
      }
    }
    if (process.env.AGENT_MODE === "simulate") return simulateWork({ ...input, agent: "antigravity" });
    return {
      success: false,
      available: false,
      logs: "Antigravity adapter not configured.",
      followUpReason: "Adapter unavailable",
    };
  },
};

const codex: AgentAdapter = {
  name: "codex",
  available: Boolean(process.env.CODEX_API_URL || process.env.AGENT_MODE === "simulate"),
  reason: process.env.CODEX_API_URL
    ? undefined
    : process.env.AGENT_MODE === "simulate"
      ? undefined
      : "Set CODEX_API_URL or AGENT_MODE=simulate",
  async run(input) {
    if (process.env.CODEX_API_URL) {
      try {
        const r = await fetch(process.env.CODEX_API_URL.replace(/\/$/, "") + "/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.CODEX_API_KEY ? { Authorization: "Bearer " + process.env.CODEX_API_KEY } : {}),
          },
          body: JSON.stringify(input),
        });
        if (!r.ok) {
          return {
            success: false,
            available: true,
            logs: await r.text(),
            followUpReason: "Codex adapter returned non-OK status",
          };
        }
        const data = (await r.json()) as AgentRunResult;
        return { ...data, available: true };
      } catch (e: any) {
        return {
          success: false,
          available: true,
          logs: String(e?.message || e),
          followUpReason: "Codex request failed",
        };
      }
    }
    if (process.env.AGENT_MODE === "simulate") return simulateWork({ ...input, agent: "codex" });
    return {
      success: false,
      available: false,
      logs: "Codex adapter not configured. Prompt is ready to copy into Codex manually.",
      followUpReason: "Adapter unavailable — use generated prompt manually",
      result: { manualPromptReady: true },
    };
  },
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
    return simulateWork(input);
  },
};

const adapters: Record<AgentName, AgentAdapter> = {
  antigravity,
  codex,
  human,
  simulated,
};

export function listAgents() {
  return (Object.keys(adapters) as AgentName[]).map((name) => {
    const a = adapters[name];
    return { name: a.name, available: a.available, reason: a.reason || null };
  });
}

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const key = (input.agent as AgentName) in adapters ? (input.agent as AgentName) : "codex";
  const adapter = adapters[key] || adapters.codex;

  if (key === "human") return human.run(input);

  // If specific adapter unavailable but simulate mode on, fall back
  if (!adapter.available && process.env.AGENT_MODE === "simulate") {
    return simulateWork({ ...input, agent: key });
  }

  return adapter.run(input);
}
