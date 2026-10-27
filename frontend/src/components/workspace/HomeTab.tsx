import type { FormEvent } from "react";
import { Loader2, Play } from "lucide-react";
import { Button, Card, Input, Textarea } from "../ui";
import type { FeatureRun, Repo, User } from "../../api";
import { STATUS_LABEL, statusClass } from "./status";

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
  return (
    <div className="stack">
      <section className="hero-band">
        <div>
          <p className="eyebrow">Signed in as @{props.user.login}</p>
          <h2>
            Describe the feature. <span>We orchestrate the rest.</span>
          </h2>
          <p>
            Repo scan → task split → auto prompts → multi-agent assign → follow-ups → tests → human approve →
            deploy gate.
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

      <section className="metrics-grid" aria-label="Workspace statistics">
        <Card className="metric-card"><span>Connected repositories</span><strong>{props.repos.length}</strong><small>{writable.length} with write permission</small></Card>
        <Card className="metric-card"><span>Total feature runs</span><strong>{props.runs.length}</strong><small>From your workspace</small></Card>
        <Card className="metric-card"><span>Running</span><strong>{props.runs.filter((r) => ["running", "scanning", "planning", "testing", "reviewing"].includes(r.status)).length}</strong><small>Currently in progress</small></Card>
        <Card className="metric-card"><span>Needs approval</span><strong>{props.runs.filter((r) => r.status === "awaiting_approval").length}</strong><small>Waiting for your decision</small></Card>
      </section>
      <div className="split">
        <form className="surface form" onSubmit={props.onCreate}>
          <p className="eyebrow">New feature run</p>
          <h3>Start orchestration</h3>
          <label htmlFor="run-repo">Repository</label>
          <select id="run-repo" value={props.repo} onChange={(e) => props.setRepo(e.target.value)} required>
            {writable.map((r) => (
              <option key={r.id} value={r.fullName}>
                {r.fullName}
                {r.language ? ` · ${r.language}` : ""}
              </option>
            ))}
          </select>
          <label htmlFor="run-title">Title</label>
          <Input
            id="run-title" aria-label="Feature title"
            value={props.title}
            onChange={(e) => props.setTitle(e.target.value)}
            minLength={3}
            maxLength={120}
            required
            placeholder="Add team invites to settings"
          />
          <label htmlFor="run-goal">Goal (plain language)</label>
          <Textarea
            id="run-goal" aria-label="Feature goal"
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
              ? "LLM planner enabled — plans use your API key when available."
              : "Heuristic planner active (optional: set OPENAI_API_KEY for smarter plans)."}
          </p>
          <Button type="submit" disabled={props.busy || !writable.length}>
            {props.busy ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
            Scan, plan & assign
          </Button>
        </form>

        <Card className="surface">
          <p className="eyebrow">Recent runs</p>
          <h3>Activity</h3>
          {props.runs.length === 0 ? (
            <p className="empty">No feature runs yet. Create your first goal on the left.</p>
          ) : (
            <ul className="run-list">
              {props.runs.slice(0, 6).map((r) => (
                <li key={r.id}>
                  <button onClick={() => props.onOpen(r.id)}>
                    <div>
                      <b>{r.title}</b>
                      <span>
                        {r.repoFullName} · {STATUS_LABEL[r.status] || r.status}
                      </span>
                    </div>
                    <em className={`dot ${statusClass(r.status)}`} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
