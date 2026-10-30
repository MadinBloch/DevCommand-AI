const API = ((import.meta as any).env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") || "";

function apiPath(path: string): string {
  if (API.endsWith("/api") && path.startsWith("/api/")) {
    return API + path.slice(4);
  }
  return API + path;
}

async function req<T = any>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(apiPath(path), {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data as T;
}

export const api = {
  base: API,
  loginUrl: () => apiPath("/api/auth/github"),
  me: () => req<{ user: User | null }>("/api/auth/me"),
  logout: () => req("/api/auth/logout", { method: "POST" }),
  repos: () => req<Repo[]>("/api/github/repos"),
  verifyGeminiCli: () => req<{ authenticated: boolean; message: string }>("/api/agents/verify-gemini-cli", { method: "POST" }),
  accountLoginStatus: () => req<{ statuses: Array<{ provider: string; installed: boolean; authenticated: boolean | null; message: string }>; scope: string; accountLoginInBrowser: boolean }>("/api/agents/account-login-status"),
  agents: () =>
    req<{
      agents: AgentInfo[];
      mode: string;
      llmPlanner: boolean;
      llmCoder?: boolean;
      canCommit?: boolean;
      hasUserOpenAiKey?: boolean;
      dockerWorker?: boolean;
    }>("/api/agents"),
  overview: () =>
    req<{
      stats: {
        runs: number;
        active: number;
        awaitingApproval: number;
        failed: number;
        agentsConnected: number;
      };
      recentRuns: FeatureRun[];
      agents: AgentInfo[];
    }>("/api/overview"),
  activity: () => req<{ logs: ActivityLog[] }>("/api/activity"),
  settings: () =>
    req<{
      openaiApiKeyMasked: string | null;
      hasOpenAiKey: boolean;
      anthropicApiKeyMasked: string | null;
      hasAnthropicKey: boolean;
      geminiApiKeyMasked: string | null;
      hasGeminiKey: boolean;
      serverHasOpenAiKey: boolean;
      dockerWorker?: boolean;
      login: string;
    }>("/api/settings"),
  saveSettings: (body: {
    openaiApiKey?: string | null;
    anthropicApiKey?: string | null;
    geminiApiKey?: string | null;
    clearOpenAiKey?: boolean;
    clearAnthropicKey?: boolean;
    clearGeminiKey?: boolean;
  }) =>
    req<{
      ok: boolean;
      hasOpenAiKey: boolean;
      openaiApiKeyMasked: string | null;
      hasAnthropicKey: boolean;
      anthropicApiKeyMasked: string | null;
      hasGeminiKey: boolean;
      geminiApiKeyMasked: string | null;
    }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  testProviderConnection: (provider: "openai" | "anthropic" | "gemini") =>
    req<{ connected: boolean; provider: string; message: string }>("/api/settings/test-connection", { method: "POST", body: JSON.stringify({ provider }) }),
  setAgentEnabled: (provider: string, enabled: boolean, model?: string) =>
    req(`/api/agents/${provider}`, { method: "PUT", body: JSON.stringify({ provider, enabled, ...(model ? { configJson: { model } } : {}) }) }),
  runs: () => req<FeatureRun[]>("/api/runs"),
  run: (id: string) => req<FeatureRunDetail>(`/api/runs/${id}`),
  runCi: (id: string) => req<{ ci: { state: string; summary: string }; prUrl: string | null }>(`/api/runs/${id}/ci`),
  createRun: (body: { repoFullName: string; title: string; goal: string; autoStart?: boolean }) =>
    req<{ run: FeatureRunDetail }>("/api/runs", { method: "POST", body: JSON.stringify(body) }),
  startRun: (id: string) => req<{ run: FeatureRunDetail }>(`/api/runs/${id}/start`, { method: "POST" }),
  approveRun: (id: string, merge = false) =>
    req<{ run: FeatureRunDetail }>(`/api/runs/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ merge }),
    }),
  retrySubTask: (id: string) =>
    req<{ run: FeatureRunDetail }>(`/api/subtasks/${id}/retry`, { method: "POST" }),
  completeManual: (id: string) =>
    req<{ run: FeatureRunDetail }>(`/api/subtasks/${id}/complete-manual`, { method: "POST" }),
};

export type User = {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  email: string | null;
};

export type Repo = {
  id: number;
  fullName: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  htmlUrl: string;
  language: string | null;
  permissions: { push: boolean; admin: boolean };
};

export type AgentInfo = {
  name: string;
  displayName?: string;
  available: boolean;
  connected?: boolean;
  enabled?: boolean;
  mode?: string;
  reason: string | null;
  version?: string;
  requires?: string[];
  executionState?: string;
  selectedModel?: string;
};

export type ActivityLog = {
  id: string;
  action: string;
  detail: string | null;
  featureRunId: string | null;
  createdAt: string;
};

export type SubTask = {
  id: string;
  orderIndex: number;
  title: string;
  objective: string;
  agent: string;
  generatedPrompt: string;
  criteria: string[];
  dependsOn: number[];
  status: string;
  attempt: number;
  maxAttempts: number;
  logs: string | null;
  followUpPrompt: string | null;
  resultJson: unknown;
  startedAt: string | null;
  completedAt: string | null;
};

export type FeatureRun = {
  id: string;
  repoFullName: string;
  title: string;
  goal: string;
  status: string;
  branchName: string | null;
  prUrl: string | null;
  deployUrl: string | null;
  testSummary: string | null;
  errorMessage: string | null;
  approvedAt: string | null;
  createdAt: string;
  subTasks?: Array<{ id: string; status: string; agent: string; title: string }>;
};

export type FeatureRunDetail = Omit<FeatureRun, "subTasks"> & {
  scanJson: Record<string, unknown> | null;
  subTasks: SubTask[];
};
