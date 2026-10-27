const API = ((import.meta as any).env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") || "";

// Avoid duplicating "/api" when the configured base URL already includes it.
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
  agents: () => req<{ agents: AgentInfo[]; mode: string; llmPlanner: boolean }>("/api/agents"),
  runs: () => req<FeatureRun[]>("/api/runs"),
  run: (id: string) => req<FeatureRunDetail>(`/api/runs/${id}`),
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

export type AgentInfo = { name: string; available: boolean; reason: string | null };

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
