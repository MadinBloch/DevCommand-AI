import { Bot, Cable, Shield } from "lucide-react";
import type { AgentInfo } from "../../api";

export function AgentsView({
  agents,
  mode,
  llmPlanner,
}: {
  agents: AgentInfo[];
  mode: string;
  llmPlanner: boolean;
}) {
  const available = agents.filter((a) => a.available).length;

  return (
    <div className="stack rise">
      <div className="surface">
        <p className="eyebrow">Runtime</p>
        <h3>Orchestration settings</h3>
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
            <b>
              {available}/{agents.length}
            </b>
            <span>Agents ready</span>
          </div>
        </div>
        <p className="hint" style={{ marginTop: 16 }}>
          GitHub login does not connect coding agents. Simulation is for demos only and never creates commits.
          Set <code>AGENT_MODE=manual</code> until real adapters are configured.
        </p>
      </div>

      <section className="surface" aria-label="Connect coding agents">
        <p className="eyebrow">
          <Cable size={12} style={{ display: "inline", verticalAlign: -1, marginRight: 6 }} />
          Agent connections
        </p>
        <h3>Connect a real coding agent</h3>
        <p className="hint">
          Codex and Antigravity are not automatically connected through GitHub OAuth. DevCommand expects a trusted
          adapter server for each agent.
        </p>
        <ol className="connection-steps">
          <li>
            Run an adapter bridge you control that exposes a secure <code>POST /run</code> endpoint.
          </li>
          <li>
            Set <code>CODEX_API_URL</code> or <code>ANTIGRAVITY_API_URL</code> on the backend, plus private adapter
            credentials when required.
          </li>
          <li>Restart the backend, refresh this tab, and verify agent availability. Do not enter tokens here.</li>
          <li>
            For manual use, copy the generated prompt into your coding tool, commit and push, then mark the task
            complete.
          </li>
        </ol>
        <p className="hint" style={{ marginTop: 14, display: "flex", alignItems: "flex-start", gap: 8 }}>
          <Shield size={15} style={{ flexShrink: 0, marginTop: 2 }} />
          The PR gate checks GitHub for real changed files. An empty branch cannot be approved or merged.
        </p>
      </section>

      <div className="agent-grid">
        {agents.map((a) => (
          <div key={a.name} className={`agent ${a.available ? "ok" : "mute"}`}>
            <Bot size={22} color={a.available ? "var(--signal)" : "var(--text-faint)"} />
            <b>{a.name}</b>
            <span className={`pill ${a.available ? "ok" : "mute"}`}>
              {a.available ? "available" : "not connected"}
            </span>
            {a.reason && <p>{a.reason}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
