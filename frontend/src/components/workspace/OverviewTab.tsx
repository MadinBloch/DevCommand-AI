import { Activity, Bot, GitPullRequest, Workflow } from "lucide-react";
import type { AgentInfo, FeatureRun } from "../../api";

export function OverviewView({
  stats,
  recentRuns,
  agents,
  onOpenRun,
  onOpenAgents,
}: {
  stats: {
    runs: number;
    active: number;
    awaitingApproval: number;
    failed: number;
    agentsConnected: number;
  };
  recentRuns: FeatureRun[];
  agents: AgentInfo[];
  onOpenRun: (id: string) => void;
  onOpenAgents: () => void;
}) {
  return (
    <div className="stack rise">
      <div className="surface">
        <p className="eyebrow">Overview</p>
        <h3>Command workspace</h3>
        <div className="stat-inline">
          <div>
            <b>{stats.active}</b>
            <span>Active runs</span>
          </div>
          <div>
            <b>{stats.awaitingApproval}</b>
            <span>Awaiting approval</span>
          </div>
          <div>
            <b>{stats.failed}</b>
            <span>Failed</span>
          </div>
          <div>
            <b>{stats.agentsConnected}</b>
            <span>Agents connected</span>
          </div>
        </div>
      </div>

      <div className="overview-grid">
        <section className="surface">
          <p className="eyebrow">
            <Workflow size={12} style={{ display: "inline", marginRight: 6 }} />
            Recent feature runs
          </p>
          {!recentRuns.length ? (
            <p className="hint">No runs yet. Open a repository and start a feature.</p>
          ) : (
            <ul className="plain-list">
              {recentRuns.map((r) => (
                <li key={r.id}>
                  <button type="button" className="linkish" onClick={() => onOpenRun(r.id)}>
                    <b>{r.title}</b>
                    <span>
                      {r.status} · {r.repoFullName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="surface">
          <p className="eyebrow">
            <Bot size={12} style={{ display: "inline", marginRight: 6 }} />
            Agent pulse
          </p>
          <ul className="plain-list">
            {agents
              .filter((a) => !["simulated"].includes(a.name))
              .slice(0, 6)
              .map((a) => (
                <li key={a.name} className="agent-row">
                  <b>{a.displayName || a.name}</b>
                  <span className={`pill ${a.connected ? "ok" : "mute"}`}>
                    {a.connected ? "connected" : "offline"}
                  </span>
                </li>
              ))}
          </ul>
          <button type="button" className="ghost" style={{ marginTop: 12 }} onClick={onOpenAgents}>
            Manage agents
          </button>
        </section>
      </div>

      <section className="surface">
        <p className="eyebrow">
          <GitPullRequest size={12} style={{ display: "inline", marginRight: 6 }} />
          Pipeline
        </p>
        <p className="hint" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <Activity size={15} style={{ marginTop: 2 }} />
          Scan → plan → parallel agents (worktrees / optional Docker) → verify → PR → human approve → merge
          (CI must be green).
        </p>
      </section>
    </div>
  );
}
