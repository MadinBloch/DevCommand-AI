export type AgentName =
  | "codex"
  | "claude"
  | "gemini"
  | "antigravity"
  | "human"
  | "simulated"
  | "llm"
  | "testing";

export type AgentRunInput = {
  agent: AgentName | string;
  prompt: string;
  repoFullName: string;
  branchName: string;
  title: string;
  goal: string;
  token: string;
  attempt: number;
  relevantFiles?: string[];
  /** Per-user keys from Settings UI (preferred over server env). */
  openaiApiKey?: string | null;
  anthropicApiKey?: string | null;
  geminiApiKey?: string | null;
  subTaskId?: string;
  featureRunId?: string;
  workspacePath?: string | null;
};

export type AgentRunResult = {
  success: boolean;
  available: boolean;
  logs: string;
  summary?: string;
  needsHuman?: boolean;
  followUpReason?: string;
  result?: Record<string, unknown>;
};

export interface AgentAdapter {
  name: AgentName;
  available: boolean;
  reason?: string;
  run(input: AgentRunInput): Promise<AgentRunResult>;
}
