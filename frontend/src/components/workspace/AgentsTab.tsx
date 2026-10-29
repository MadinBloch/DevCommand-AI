import { Bot, Cable, GitCommit, Shield } from "lucide-react";
import type { AgentInfo } from "../../api";

export function AgentsView({
  agents,
  mode,
  llmPlanner,
  llmCoder,
  canCommit,
}: {
  agents: AgentInfo[];
  mode: string;
  llmPlanner: boolean;
  llmCoder?: boolean;
  canCommit?: boolean;
}) {
  const available = agents.filter((a) => a.available).length;

  return (
    <div className="stack rise">
      <div className="surface">
        <p className="eyebrow">Runtime</p>
        <h3>Execution capability</h3>
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
            <span>LLM coder</span>
          </div>
          <div>
            <b>{canCommit ? "yes" : "no"}</b>
            <span>Can commit</span>
          </div>
          <div>
            <b>
              {available}/{agents.length}
            </b>
            <span>Agents ready</span>
          </div>
        </div>
        <p className="hint" style={{ marginTop: 16 }}>
          {canCommit ? (
            <>
              <GitCommit size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
              Agents can write commits to the feature branch. PR opens only after real diffs exist.
            </>
          ) : (
            <>
              No commit engine yet. Add <code>OPENAI_API_KEY</code> or <code>ANTHROPIC_API_KEY</code>, set{" "}
              <code>AGENT_MODE=simulate</code>, or connect <code>CODEX_API_URL</code> /{" "}
              <code>ANTIGRAVITY_API_URL</code>.
            </>
          )}
        </p>
      </div>

      <section className="surface" aria-label="Connect coding agents">
        <p className="eyebrow">
          <Cable size={12} style={{ display: "inline", verticalAlign: -1, marginRight: 6 }} />
          How execution works
        </p>
        <h3>One goal → many agents → commit → PR</h3>
        <ol className="connection-steps">
          <li>Planner splits your goal into sub-tasks with agent-specific prompts (Codex / Antigravity / human).</li>
          <li>
            Built-in LLM coder (or external adapter) edits files and DevCommand commits them to{" "}
            <code>devcommand/…</code>.
          </li>
          <li>When the branch has commits, a pull request is opened automatically.</li>
          <li>You approve (and optionally merge) from the run detail page.</li>
        </ol>
        <p className="hint" style={{ marginTop: 14, display: "flex", alignItems: "flex-start", gap: 8 }}>
          <Shield size={15} style={{ flexShrink: 0, marginTop: 2 }} />
          Secrets files are blocked from commits. Human approval is still required before merge.
        </p>
      </section>

      <div className="agent-grid">
        {agents.map((a) => (
          <div key={a.name} className={`agent ${a.available ? "ok" : "mute"}`}>
            <Bot size={22} color={a.available ? "var(--signal)" : "var(--faint)"} />
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
