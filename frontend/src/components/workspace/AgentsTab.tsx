import { Bot, Cable, Container, Shield } from "lucide-react";
import { useState } from "react";
import { api, type AgentInfo } from "../../api";
import { Button } from "../ui";

export function AgentsView({
  agents,
  mode,
  llmPlanner,
  llmCoder,
  canCommit,
  dockerWorker,
  onChanged,
}: {
  agents: AgentInfo[];
  mode: string;
  llmPlanner: boolean;
  llmCoder?: boolean;
  canCommit?: boolean;
  dockerWorker?: boolean;
  onChanged?: () => void;
}) {
  const connected = agents.filter((a) => a.connected).length;
  const [busy, setBusy] = useState<string | null>(null);
  const [models, setModels] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState("");
  const [loginStatuses, setLoginStatuses] = useState<Array<{ provider: string; installed: boolean; authenticated: boolean | null; message: string }>>([]);
  const [checkingLogin, setCheckingLogin] = useState(false);

  async function checkLogins() {
    setCheckingLogin(true);
    try {
      const response = await api.accountLoginStatus();
      setLoginStatuses(response.statuses);
    } catch (e: any) {
      setFeedback(e.message || "Login status lookup failed");
    } finally {
      setCheckingLogin(false);
    }
  }
  const modelOptions: Record<string, string[]> = {
    codex: ["default", "gpt-5-codex"],
    claude: ["default", "claude-sonnet-4-5"],
    gemini: ["default", "gemini-2.5-pro"],
    antigravity: ["default"],
    llm: ["default"],
  };

  async function toggle(a: AgentInfo) {
    if (["human", "simulated", "testing"].includes(a.name)) return;
    setBusy(a.name);
    try {
      await api.setAgentEnabled(a.name, !(a.enabled ?? a.connected));
      onChanged?.();
    } catch (e: any) {
      setFeedback(e.message || "Could not update agent");
    } finally {
      setBusy(null);
    }
  }

  async function saveModel(agent: AgentInfo) {
    setBusy(agent.name);
    setFeedback("");
    try {
      await api.setAgentEnabled(agent.name, agent.enabled !== false, models[agent.name] || "default");
      setFeedback(`Model preference saved for ${agent.displayName || agent.name}. Worker support must be verified separately.`);
      onChanged?.();
    } catch (e: any) {
      setFeedback(e.message || "Could not save preference");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack rise">
      <div className="surface">
        <p className="eyebrow">Runtime</p>
        <h3>AI agent connections</h3>
        <div className="stat-inline">
          <div>
            <b>{mode}</b>
            <span>Agent mode</span>
          </div>
          <div>
            <b>{llmPlanner ? "on" : "off"}</b>
            <span>LLM planner</span>
          </div>
          <div>
            <b>{llmCoder ? "on" : "off"}</b>
            <span>LLM patch coder</span>
          </div>
          <div>
            <b>{canCommit ? "yes" : "no"}</b>
            <span>Can commit</span>
          </div>
          <div>
            <b>
              {connected}/{agents.length}
            </b>
            <span>Connected</span>
          </div>
          <div>
            <b>{dockerWorker ? "docker" : "worktree"}</b>
            <span>Isolation</span>
          </div>
        </div>
        <p className="hint" style={{ marginTop: 16 }}>
          <Cable size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
          Live status probes CLI binaries on the worker. An API key alone does <b>not</b> mark Codex / Claude Code /
          Gemini / Antigravity as connected.
        </p>
      </div>

      <section className="surface" aria-label="Execution model">
        <p className="eyebrow">
          <Container size={12} style={{ display: "inline", verticalAlign: -1, marginRight: 6 }} />
          How execution works
        </p>
        <h3>Real CLIs in isolated workspaces</h3>
        <ol className="connection-steps">
          <li>Planner scans the repo and builds dependency-aware tasks.</li>
          <li>pg-boss queues independent tasks in parallel (separate git worktrees; optional Docker).</li>
          <li>Codex / Claude Code / Gemini / Antigravity CLIs edit code; DevCommand commits &amp; pushes.</li>
          <li>Verification worker runs tests/lint/typecheck; PR opens only with a non-empty diff.</li>
          <li>You approve; merge is blocked while CI is red.</li>
        </ol>
        <p className="hint" style={{ marginTop: 14, display: "flex", alignItems: "flex-start", gap: 8 }}>
          <Shield size={15} style={{ flexShrink: 0, marginTop: 2 }} />
          GitHub tokens are never sent to agent CLIs. Simulated mode never appears as a connected coding agent.
        </p>
      </section>

      <section className="surface" aria-label="Account login options">
        <p className="eyebrow">Account authentication</p>
        <h3>Connect using an account</h3>
        <p className="hint">Supported account sign-in happens through the official CLI on the assigned worker. This page cannot access your ChatGPT, Claude or Google session directly. Never paste passwords or browser session tokens here.</p>
        <Button variant="outline" disabled={checkingLogin} onClick={() => void checkLogins()}>
          {checkingLogin ? "Checking…" : "Check worker login status"}
        </Button>
        <div className="agent-grid" style={{ marginTop: 12 }}>
          {([
            { provider: "codex", title: "ChatGPT / Codex", command: "codex login --device-auth", link: "https://learn.chatgpt.com/docs/auth", detail: "Device-code login is supported where enabled. Complete it for the worker identity." },
            { provider: "claude", title: "Claude Code", command: "claude auth login", link: "https://code.claude.com/docs/en/authentication", detail: "Use Claude Code's supported interactive login on the worker." },
            { provider: "gemini", title: "Google / Gemini", command: "gemini", link: "https://geminicli.com/docs/get-started/authentication/", detail: "Select Sign in with Google in the CLI; remote/headless workers may require API credentials." },
          ] as const).map((item) => {
            const state = loginStatuses.find((s) => s.provider === item.provider);
            return <div className="agent" key={item.provider}>
              <b>{item.title}</b>
              <span className={`pill ${state?.authenticated === true ? "ok" : "mute"}`}>{state?.authenticated === true ? "Worker signed in" : state?.authenticated === false ? "Not signed in" : "Not verified"}</span>
              <p className="hint">{state?.message || item.detail}</p>
              <p className="hint">Worker setup: <code>{item.command}</code></p>
              <a href={item.link} target="_blank" rel="noopener noreferrer">Official login instructions</a>
            </div>;
          })}
        </div>
        <p className="hint">For a browser-only connection without a configured worker account, use Settings → API keys → Test Connection. Provider web login alone does not grant DevCommand coding-agent access.</p>
        <p className="hint">Login status is scoped to the backend worker host, not your GitHub user account. Personal account linking requires a per-user credential boundary and supported provider authorization.</p>
      </section>
      {feedback && <div className="banner">{feedback}</div>}
      <div className="agent-grid">
        {agents.map((a) => {
          const live = Boolean(a.connected);
          return (
            <div key={a.name} className={`agent ${live ? "ok" : "mute"}`}>
              <Bot size={22} color={live ? "var(--signal)" : "var(--faint)"} />
              <b>{a.displayName || a.name}</b>
              <span className={`pill ${live ? "ok" : a.mode === "manual" ? "warn" : "mute"}`}>
                {live ? "connected" : a.mode === "manual" ? "manual worker" : a.mode === "unavailable" ? "unavailable" : "not connected"}
              </span>
              {a.mode && <p className="hint">mode: {a.mode}{a.version ? ` · ${a.version}` : ""}</p>}
              {a.reason && <p>{a.reason}</p>}
              {a.requires?.length ? (
                <p className="hint">requires: {a.requires.join(", ")}</p>
              ) : null}
              {modelOptions[a.name] && (
                <div className="form" style={{ marginTop: 10 }}>
                  <label htmlFor={`model-${a.name}`}>Model preference</label>
                  <select id={`model-${a.name}`} className="ui-input"
                    value={models[a.name] ?? a.selectedModel ?? "default"}
                    onChange={(e) => setModels((prev) => ({ ...prev, [a.name]: e.target.value }))}>
                    {modelOptions[a.name].map((model) => <option key={model} value={model}>{model}</option>)}
                  </select>
                  <Button variant="outline" size="sm" disabled={busy === a.name} onClick={() => void saveModel(a)}>Save preference</Button>
                  <p className="hint">Preference is stored; agent CLI model selection requires worker integration.</p>
                </div>
              )}
              {!["human", "simulated", "testing"].includes(a.name) && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy === a.name}
                  onClick={() => void toggle(a)}
                  style={{ marginTop: 8 }}
                >
                  {a.enabled === false ? "Enable" : "Disable preference"}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
