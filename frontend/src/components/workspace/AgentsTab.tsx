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

  async function toggle(a: AgentInfo) {
    if (["human", "simulated", "testing"].includes(a.name)) return;
    setBusy(a.name);
    try {
      await api.setAgentEnabled(a.name, !(a.enabled ?? a.connected));
      onChanged?.();
    } catch {
      /* parent refresh will show state */
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
