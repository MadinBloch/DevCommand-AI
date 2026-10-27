import { Bot } from "lucide-react";
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
  return (
    <div className="stack">
      <div className="surface">
        <p className="eyebrow">Runtime</p>
        <h3>Orchestration settings</h3>
        <p>
          Agent mode: <b>{mode}</b>. LLM planner: <b>{llmPlanner ? "on" : "off"}</b>.
        </p>
        <p className="hint">
          GitHub login does not connect coding agents. Simulation is for demos only and never creates commits.\n          Set <code>AGENT_MODE=manual</code> until real adapters are configured.
        </p>
      </div>
      <section className="surface" aria-label="Connect coding agents">
        <p className="eyebrow">Agent connections</p>
        <h3>Connect a real coding agent</h3>
        <p className="hint">Codex and Antigravity are not automatically connected through GitHub OAuth. DevCommand expects a trusted adapter server for each agent.</p>
        <ol className="connection-steps">
          <li>Run an adapter bridge you control that exposes a secure <code>POST /run</code> endpoint.</li>
          <li>Set <code>CODEX_API_URL</code> or <code>ANTIGRAVITY_API_URL</code> on the backend server, plus private adapter credentials when required.</li>
          <li>Restart the backend, refresh this tab, and verify agent availability. Do not enter access tokens in this page.</li>
          <li>For manual use, copy the generated prompt into your coding tool, commit and push the changes, then mark the task complete.</li>
        </ol>
        <p className="hint">The PR gate checks GitHub for real changed files. An empty branch cannot be approved or merged.</p>
      </section>
      <div className="agent-grid">
        {agents.map((a) => (
          <div key={a.name} className={`surface agent ${a.available ? "ok" : "mute"}`}>
            <Bot size={22} />
            <b>{a.name}</b>
            <span className={`pill ${a.available ? "ok" : "mute"}`}>{a.available ? "available" : "not connected"}</span>
            {a.reason && <p>{a.reason}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
