import type { FormEvent } from "react";
import { ArrowUpRight, CircleAlert, Loader2, Play, Plus } from "lucide-react";
import { Button, Input, Textarea } from "../components/ui";
import type { FeatureRun, Repo, User } from "../api";
import { STATUS_LABEL, formatWhen, runProgress, statusClass } from "../components/workspace/status";

export function DashboardHome(props: {
  user: User;
  runs: FeatureRun[];
  repos: Repo[];
  repo: string;
  setRepo: (v: string) => void;
  title: string;
  setTitle: (v: string) => void;
  goal: string;
  setGoal: (v: string) => void;
  busy: boolean;
  canCommit: boolean;
  llmCoder: boolean;
  agentMode: string;
  onCreate: (e: FormEvent) => void;
  onOpen: (id: string) => void;
  onNavigate: (page: "runs" | "settings" | "repos") => void;
}) {
  const writable = props.repos.filter((r) => r.permissions.push || r.permissions.admin);
  const active = props.runs.filter((r) =>
    ["running", "scanning", "planning", "testing", "reviewing", "deploying", "queued"].includes(r.status)
  ).length;
  const needsApproval = props.runs.filter((r) => r.status === "awaiting_approval").length;
  const done = props.runs.filter((r) => r.status === "done").length;

  return (
    <div className="dash">
      <div className="dash-welcome">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Welcome back, {props.user.name || props.user.login}</h1>
          <p className="dash-sub">
            Start a feature run, track history, and approve PRs — all from one place.
          </p>
        </div>
        <Button onClick={() => document.getElementById("new-run")?.scrollIntoView({ behavior: "smooth" })}>
          <Plus size={16} /> New run
        </Button>
      </div>

      {!props.canCommit && (
        <div className="dash-alert">
          <CircleAlert size={18} />
          <div>
            <b>OpenAI key required for real commits</b>
            <p>Without a key (or simulate mode), agents cannot push code and PRs stay empty.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => props.onNavigate("settings")}>
            Settings
          </Button>
        </div>
      )}

      <div className="dash-kpis">
        <button type="button" className="dash-kpi" onClick={() => props.onNavigate("repos")}>
          <span>Repos</span>
          <strong>{writable.length}</strong>
          <em>writable</em>
        </button>
        <button type="button" className="dash-kpi" onClick={() => props.onNavigate("runs")}>
          <span>Total runs</span>
          <strong>{props.runs.length}</strong>
          <em>{done} done</em>
        </button>
        <div className="dash-kpi">
          <span>In progress</span>
          <strong>{active}</strong>
          <em>live pipelines</em>
        </div>
        <div className="dash-kpi warn">
          <span>Needs approval</span>
          <strong>{needsApproval}</strong>
          <em>waiting on you</em>
        </div>
      </div>

      <div className="dash-grid">
        <section className="dash-panel" id="new-run">
          <div className="dash-panel-head">
            <div>
              <p className="eyebrow">Compose</p>
              <h2>New feature run</h2>
            </div>
            <span className={`pill ${props.canCommit ? "ok" : "mute"}`}>
              {props.canCommit ? (props.llmCoder ? "LLM coder" : props.agentMode) : "no commit engine"}
            </span>
          </div>

          <form className="dash-form" onSubmit={props.onCreate}>
            <label htmlFor="dash-repo">Repository</label>
            <select id="dash-repo" value={props.repo} onChange={(e) => props.setRepo(e.target.value)} required>
              {writable.length === 0 && <option value="">No writable repos</option>}
              {writable.map((r) => (
                <option key={r.id} value={r.fullName}>
                  {r.fullName}
                  {r.language ? ` · ${r.language}` : ""}
                </option>
              ))}
            </select>

            <label htmlFor="dash-title">Title</label>
            <Input
              id="dash-title"
              value={props.title}
              onChange={(e) => props.setTitle(e.target.value)}
              minLength={3}
              maxLength={120}
              required
              placeholder="e.g. Add invite teammates flow"
            />

            <label htmlFor="dash-goal">Goal</label>
            <Textarea
              id="dash-goal"
              value={props.goal}
              onChange={(e) => props.setGoal(e.target.value)}
              minLength={10}
              maxLength={12000}
              required
              rows={6}
              placeholder="Describe the feature in plain language. Include constraints and acceptance criteria."
            />

            <Button type="submit" disabled={props.busy || !writable.length}>
              {props.busy ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
              Start orchestration
            </Button>
          </form>
        </section>

        <section className="dash-panel">
          <div className="dash-panel-head">
            <div>
              <p className="eyebrow">Activity</p>
              <h2>Recent runs</h2>
            </div>
            <button type="button" className="dash-link" onClick={() => props.onNavigate("runs")}>
              View all <ArrowUpRight size={14} />
            </button>
          </div>

          {props.runs.length === 0 ? (
            <div className="dash-empty">
              <h3>No history yet</h3>
              <p>Your first feature run will show up here with live status and progress.</p>
            </div>
          ) : (
            <ul className="dash-activity">
              {props.runs.slice(0, 8).map((r) => {
                const prog = runProgress(r);
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => props.onOpen(r.id)}>
                      <div className="dash-activity-main">
                        <b>{r.title}</b>
                        <span>
                          {r.repoFullName} · {STATUS_LABEL[r.status] || r.status} · {formatWhen(r.createdAt)}
                        </span>
                      </div>
                      <div className="dash-activity-side">
                        <span className={`pill ${statusClass(r.status)}`}>{STATUS_LABEL[r.status] || r.status}</span>
                        {prog.total > 0 && (
                          <div className="progress-track">
                            <div className="progress-fill" style={{ width: `${prog.pct}%` }} />
                          </div>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
