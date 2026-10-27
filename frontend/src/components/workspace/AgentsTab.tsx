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
          Use <code>AGENT_MODE=simulate</code> for local end-to-end demos. Point{" "}
          <code>ANTIGRAVITY_API_URL</code> / <code>CODEX_API_URL</code> at real adapters when ready.
        </p>
      </div>
      <div className="agent-grid">
        {agents.map((a) => (
          <div key={a.name} className={`surface agent ${a.available ? "ok" : "mute"}`}>
            <Bot size={22} />
            <b>{a.name}</b>
            <span className={`pill ${a.available ? "ok" : "mute"}`}>{a.available ? "available" : "unavailable"}</span>
            {a.reason && <p>{a.reason}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
