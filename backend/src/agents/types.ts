export type AgentName = "codex" | "antigravity" | "human" | "simulated";

export type AgentRunInput = {
  agent: AgentName | string;
  prompt: string;
  repoFullName: string;
  branchName: string;
  title: string;
  goal: string;
  token: string;
  attempt: number;
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
