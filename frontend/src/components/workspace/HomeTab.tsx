import type { FormEvent } from "react";
import { ArrowRight, Loader2, Play } from "lucide-react";
import { Button, Input, Textarea } from "../ui";
import type { FeatureRun, Repo, User } from "../../api";
import { STATUS_LABEL, formatWhen, runProgress, statusClass } from "./status";

export function HomeView(props: {
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
  llmPlanner: boolean;
  onCreate: (e: FormEvent) => void;
  onOpen: (id: string) => void;
}) {
  const writable = props.repos.filter((r) => r.permissions.push || r.permissions.admin);
  const active = props.runs.filter((r) =>
    ["running", "scanning", "planning", "testing", "reviewing", "deploying", "queued"].includes(r.status)
  ).length;
  const needsApproval = props.runs.filter((r) => r.status === "awaiting_approval").length;
  const done = props.runs.filter((r) => r.status === "done").length;

  return (
    <div className="stack">
      <section className="hero-band rise">
        <div>
          <p className="eyebrow">Signed in as @{props.user.login}</p>
          <h2>
            One goal in. <span>Full orchestration out.</span>
          </h2>
          <p>
            Scan the repo, split the work, generate agent prompts, supervise progress, then wait for your
            approval before merge or deploy — history stays intact.
          </p>
        </div>
        <div className="phase-rail">
          {["Scan", "Plan", "Assign", "Supervise", "Test", "Deploy"].map((p, i) => (
            <div key={p} className="phase">
              <b>0{i + 1}</b>
              <span>{p}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="metrics-grid rise rise-d1" aria-label="Workspace statistics">
        <div className="metric-card">
          <span>Repositories</span>
          <strong>{props.repos.length}</strong>
          <small>{writable.length} writable</small>
        </div>
        <div className="metric-card">
          <span>Run history</span>
          <strong>{props.runs.length}</strong>
          <small>{done} completed</small>
        </div>
        <div className="metric-card">
          <span>In flight</span>
          <strong>{active}</strong>
          <small>Currently orchestrating</small>
        </div>
        <div className="metric-card">
          <span>Needs you</span>
          <strong>{needsApproval}</strong>
          <small>Awaiting approval</small>
        </div>
      </section>

      <div className="split rise rise-d2">
        <form className="surface form" onSubmit={props.onCreate}>
          <p className="eyebrow">New feature run</p>
          <h3>Launch orchestration</h3>
          <label htmlFor="run-repo">Repository</label>
          <select id="run-repo" value={props.repo} onChange={(e) => props.setRepo(e.target.value)} required>
            {writable.length === 0 && <option value="">No writable repos</option>}
            {writable.map((r) => (
              <option key={r.id} value={r.fullName}>
                {r.fullName}
                {r.language ? ` · ${r.language}` : ""}
              </option>
            ))}
          </select>
          <label htmlFor="run-title">Title</label>
          <Input
            id="run-title"
            aria-label="Feature title"
            value={props.title}
            onChange={(e) => props.setTitle(e.target.value)}
            minLength={3}
            maxLength={120}
            required
            placeholder="Add team invites to settings"
          />
          <label htmlFor="run-goal">Goal (plain language)</label>
          <Textarea
            id="run-goal"
            aria-label="Feature goal"
            value={props.goal}
            onChange={(e) => props.setGoal(e.target.value)}
            minLength={10}
            maxLength={12000}
            required
            rows={5}
            placeholder="In this repo, update the feature so users can invite teammates from settings. Keep existing auth. Add tests."
          />
          <p className="hint">
            {props.llmPlanner
              ? "LLM planner enabled — smarter plans when your API key is configured."
              : "Heuristic planner active. Optional: set OPENAI_API_KEY for smarter plans."}
          </p>
          <Button type="submit" disabled={props.busy || !writable.length}>
            {props.busy ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
            Scan, plan & assign
          </Button>
        </form>

        <div className="surface">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <div>
              <p className="eyebrow">History pulse</p>
              <h3>Recent runs</h3>
            </div>
            <span className="pill mute">{props.runs.length} total</span>
          </div>
          {props.runs.length === 0 ? (
            <p className="empty">No feature runs yet. Launch your first goal on the left — it will appear here forever in history.</p>
          ) : (
            <ul className="run-list">
              {props.runs.slice(0, 7).map((r) => {
                const prog = runProgress(r);
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => props.onOpen(r.id)}>
                      <div>
                        <b>{r.title}</b>
                        <span>
                          {r.repoFullName} · {STATUS_LABEL[r.status] || r.status} · {formatWhen(r.createdAt)}
                        </span>
                      </div>
                      <div className="run-side">
                        <em className={`dot ${statusClass(r.status)}`} />
                        {prog.total > 0 && (
                          <div className="progress-track" title={`${prog.done}/${prog.total}`}>
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
          {props.runs.length > 7 && (
            <p className="hint" style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 6 }}>
              Open Feature Runs for full history <ArrowRight size={14} />
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
