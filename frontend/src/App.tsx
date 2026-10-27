import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Badge, Button, Card, Input, Textarea } from "./components/ui";
import {
  Bot,
  CheckCircle2,
  ClipboardList,
  Copy,
  GitBranch,
  Github,
  LayoutDashboard,
  Loader2,
  Menu,
  LogOut,
  Play,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import {
  api,
  type AgentInfo,
  type FeatureRun,
  type FeatureRunDetail,
  type Repo,
  type SubTask,
  type User,
} from "./api";

type View = "home" | "runs" | "run" | "agents" | "repos";

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  scanning: "Scanning repo",
  planning: "Planning",
  running: "Running agents",
  reviewing: "Opening PR",
  testing: "Testing",
  awaiting_approval: "Awaiting approval",
  deploying: "Deploying",
  done: "Done",
  failed: "Failed",
  ready: "Ready",
  needs_followup: "Needs follow-up",
  skipped: "Skipped",
};

function statusClass(s: string) {
  if (s === "done") return "ok";
  if (s === "failed") return "bad";
  if (s === "awaiting_approval" || s === "needs_followup") return "warn";
  if (["running", "scanning", "planning", "testing", "deploying", "reviewing"].includes(s)) return "live";
  return "mute";
}

export default function App() {
  const [view, setView] = useState<View>("home");
  const [user, setUser] = useState<User | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [runs, setRuns] = useState<FeatureRun[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [agentMode, setAgentMode] = useState("manual");
  const [llmPlanner, setLlmPlanner] = useState(false);
  const [activeRun, setActiveRun] = useState<FeatureRunDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [repo, setRepo] = useState("");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");

  async function bootstrap() {
    setLoading(true);
    setError("");
    try {
      const [{ user: u }, ag] = await Promise.all([api.me(), api.agents()]);
      setUser(u);
      setAgents(ag.agents);
      setAgentMode(ag.mode);
      setLlmPlanner(ag.llmPlanner);
      if (u) {
        const [rr, rn] = await Promise.all([api.repos(), api.runs()]);
        setRepos(rr);
        setRuns(rn);
        if (!repo && rr[0]) setRepo(rr[0].fullName);
      }
    } catch (e: any) {
      setError(e.message || "API unavailable");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!activeRun || !["queued", "scanning", "planning", "running", "testing", "reviewing", "deploying"].includes(activeRun.status))
      return;
    const t = setInterval(async () => {
      try {
        const r = await api.run(activeRun.id);
        setActiveRun(r);
        setRuns((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...r } : x)));
      } catch {
        /* ignore poll errors */
      }
    }, 2500);
    return () => clearInterval(t);
  }, [activeRun?.id, activeRun?.status]);

  async function openRun(id: string) {
    setBusy(true);
    setError("");
    try {
      const r = await api.run(id);
      setActiveRun(r);
      setView("run");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function createRun(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { run } = await api.createRun({ repoFullName: repo, title, goal, autoStart: true });
      setTitle("");
      setGoal("");
      setRuns((prev) => [run, ...prev]);
      setActiveRun(run);
      setView("run");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api.logout();
    setUser(null);
    setRepos([]);
    setRuns([]);
    setActiveRun(null);
    setView("home");
  }

  if (loading) {
    return (
      <div className="boot">
        <Loader2 className="spin" size={28} />
        <p>Loading DevCommand… </p>
      </div>
    );
  }

  if (!user) {
    return <LoginPage error={error} onRetry={bootstrap} />;
  }

  return (
    <div className="shell">
      <aside className={`side ${mobileNavOpen ? "side-open" : ""}`}>
        <div className="brand">
          <span className="mark" aria-hidden="true">DC</span>
          <div>
            <strong>DevCommand</strong>
            <em>DEVELOPER WORKSPACE</em>
          </div>
        </div>

        <p className="eyebrow">Workspace</p>
        <nav aria-label="Workspace navigation">
          <NavBtn active={view === "home"} onClick={() => { setView("home"); setMobileNavOpen(false); }} icon={<LayoutDashboard size={16} />} label="Command center" />
          <NavBtn active={view === "runs" || view === "run"} onClick={() => { setView("runs"); setMobileNavOpen(false); }} icon={<Workflow size={16} />} label="Feature runs" />
          <NavBtn active={view === "repos"} onClick={() => { setView("repos"); setMobileNavOpen(false); }} icon={<GitBranch size={16} />} label="Repositories" />
          <NavBtn active={view === "agents"} onClick={() => { setView("agents"); setMobileNavOpen(false); }} icon={<Bot size={16} />} label="Agents" />
        </nav>

        <div className="side-card">
          <ShieldCheck size={18} />
          <div>
            <b>Human gate</b>
            <p>Merge & deploy only after your approval.</p>
          </div>
        </div>

        <div className="user-chip">
          {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span className="av">{user.login[0]}</span>}
          <div>
            <b>{user.name || user.login}</b>
            <span>@{user.login}</span>
          </div>
          <button className="ghost icon" aria-label="Sign out" title="Sign out" onClick={logout}>
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="top">
          <div>
            <p className="eyebrow">Workspace / {view === "run" ? "Feature detail" : view === "home" ? "Overview" : view}</p>
            <h1>
              {view === "home" && "Command center"}
              {view === "runs" && "Feature runs"}
              {view === "run" && (activeRun?.title || "Run detail")}
              {view === "repos" && "Repositories"}
              {view === "agents" && "Agent registry"}
            </h1>
          </div>
          <div className="top-actions">
            <Button variant="outline" size="icon" className="mobile-toggle" aria-label="Toggle navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((value) => !value)}><Menu size={18}/></Button>
            <Badge variant={agentMode === "simulate" ? "outline" : "default"}>Agent mode: {agentMode}{agentMode === "simulate" ? " (demo)" : ""}</Badge>
            <Button variant="outline" onClick={bootstrap} disabled={loading}>
              <RefreshCw size={15} /> Refresh
            </Button>
          </div>
        </header>

        {error && <div className="banner bad">{error}</div>}

        {view === "home" && (
          <HomeView
            user={user}
            runs={runs}
            repos={repos}
            repo={repo}
            setRepo={setRepo}
            title={title}
            setTitle={setTitle}
            goal={goal}
            setGoal={setGoal}
            busy={busy}
            llmPlanner={llmPlanner}
            onCreate={createRun}
            onOpen={openRun}
          />
        )}
        {view === "runs" && <RunsList runs={runs} onOpen={openRun} />}
        {view === "run" && activeRun && (
          <RunDetail
            run={activeRun}
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            onUpdate={(r) => {
              setActiveRun(r);
              setRuns((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...r } : x)));
            }}
          />
        )}
        {view === "repos" && <ReposView repos={repos} />}
        {view === "agents" && <AgentsView agents={agents} mode={agentMode} llmPlanner={llmPlanner} />}
      </main>
    </div>
  );
}

function LoginPage({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="login">
      <div className="login-bg" />
      <div className="login-panel">
        <div className="brand big">
          <span className="mark">DC</span>
          <div>
            <strong>DevCommand AI</strong>
            <em>ORCHESTRATE · ASSIGN · SHIP</em>
          </div>
        </div>
        <h1>One goal. Multiple agents. Your approval.</h1>
        <p>
          Sign in with GitHub, pick a repo, describe the feature. DevCommand scans the codebase, splits work,
          generates agent prompts, supervises progress, then waits for you before deploy.
        </p>
        <ul className="login-steps">
          <li>
            <Sparkles size={16} /> Scan repo & plan
          </li>
          <li>
            <Bot size={16} /> Assign Codex / Antigravity
          </li>
          <li>
            <Rocket size={16} /> Test, approve, deploy
          </li>
        </ul>
        {error && <div className="banner bad">{error}</div>}
        <Button className="primary lg" onClick={() => (location.href = api.loginUrl())}>
          <Github size={18} /> Continue with GitHub
        </Button>
        <Button variant="outline" onClick={onRetry}>
          Check API connection
        </Button>
      </div>
    </div>
  );
}

function NavBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button type="button" aria-current={active ? "page" : undefined} className={`nav ${active ? "active" : ""}`} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function HomeView(props: {
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

function RunsList({ runs, onOpen }: { runs: FeatureRun[]; onOpen: (id: string) => void }) {
  return (
    <Card className="surface">
      <p className="eyebrow">All runs</p>
      <h3>Feature orchestration history</h3>
      {!runs.length ? (
        <p className="empty">Nothing here yet.</p>
      ) : (
        <ul className="run-list dense">
          {runs.map((r) => {
            const done = r.subTasks?.filter((s) => s.status === "done").length || 0;
            const total = r.subTasks?.length || 0;
            return (
              <li key={r.id}>
                <button onClick={() => onOpen(r.id)}>
                  <div>
                    <b>{r.title}</b>
                    <span>
                      {r.repoFullName} · {done}/{total} tasks · {STATUS_LABEL[r.status] || r.status}
                    </span>
                  </div>
                  <em className={`dot ${statusClass(r.status)}`} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function RunDetail({
  run,
  busy,
  setBusy,
  setError,
  onUpdate,
}: {
  run: FeatureRunDetail;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setError: (v: string) => void;
  onUpdate: (r: FeatureRunDetail) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(run.subTasks[0]?.id || null);
  const scan = run.scanJson as any;

  async function act(fn: () => Promise<{ run: FeatureRunDetail }>) {
    setBusy(true);
    setError("");
    try {
      const { run: next } = await fn();
      onUpdate(next);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <section className="surface run-head">
        <div>
          <p className="eyebrow">{run.repoFullName}</p>
          <h2>{run.title}</h2>
          <p className="goal">{run.goal}</p>
          <div className="meta-row">
            <span className={`pill ${statusClass(run.status)}`}>{STATUS_LABEL[run.status] || run.status}</span>
            {run.branchName && <span className="pill mute">branch · {run.branchName}</span>}
            {run.prUrl && (
              <a className="pill live" href={run.prUrl} target="_blank" rel="noreferrer">
                Pull request
              </a>
            )}
            {run.deployUrl && (
              <a className="pill mute" href={run.deployUrl} target="_blank" rel="noreferrer">
                Deploy target
              </a>
            )}
          </div>
          {run.errorMessage && <div className="banner warn">{run.errorMessage}</div>}
          {run.testSummary && (
            <div className="banner mute">
              <b>Test summary</b>
              <pre>{run.testSummary}</pre>
            </div>
          )}
        </div>
        <div className="run-actions">
          {["queued", "failed"].includes(run.status) && (
            <button className="primary" disabled={busy} onClick={() => act(() => api.startRun(run.id))}>
              <Play size={16} /> Restart pipeline
            </button>
          )}
          {run.status === "awaiting_approval" && (
            <>
              <button className="primary" disabled={busy} onClick={() => act(() => api.approveRun(run.id, false))}>
                <CheckCircle2 size={16} /> Approve (no merge)
              </button>
              <button className="ghost" disabled={busy} onClick={() => act(() => api.approveRun(run.id, true))}>
                <Rocket size={16} /> Approve & merge PR
              </button>
            </>
          )}
        </div>
      </section>

      {scan?.summary && (
        <section className="surface">
          <p className="eyebrow">Repo scan</p>
          <h3>Context used for planning</h3>
          <p>{scan.summary}</p>
          {!!scan.relevantFiles?.length && (
            <div className="chips">
              {scan.relevantFiles.slice(0, 12).map((f: string) => (
                <span key={f}>{f}</span>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="surface">
        <p className="eyebrow">Sub-tasks</p>
        <h3>Assigned workboard</h3>
        <div className="board">
          {run.subTasks.map((st) => (
            <SubTaskCard
              key={st.id}
              st={st}
              open={expanded === st.id}
              onToggle={() => setExpanded(expanded === st.id ? null : st.id)}
              busy={busy}
              onRetry={() => act(() => api.retrySubTask(st.id))}
              onComplete={() => act(() => api.completeManual(st.id))}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function SubTaskCard({
  st,
  open,
  onToggle,
  busy,
  onRetry,
  onComplete,
}: {
  st: SubTask;
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  onRetry: () => void;
  onComplete: () => void;
}) {
  return (
    <article className={`task-card ${statusClass(st.status)}`}>
      <button className="task-head" onClick={onToggle}>
        <div>
          <span className="agent-tag">{st.agent}</span>
          <b>
            {st.orderIndex + 1}. {st.title}
          </b>
          <span>{STATUS_LABEL[st.status] || st.status}</span>
        </div>
        <em className={`dot ${statusClass(st.status)}`} />
      </button>
      {open && (
        <div className="task-body">
          <p>{st.objective}</p>
          <p className="eyebrow">Generated prompt</p>
          <pre className="prompt">{st.generatedPrompt}</pre>
          <div className="row">
            <button
              className="ghost"
              type="button"
              onClick={() => navigator.clipboard.writeText(st.followUpPrompt || st.generatedPrompt)}
            >
              <Copy size={14} /> Copy prompt
            </button>
            {["failed", "needs_followup"].includes(st.status) && (
              <button className="ghost" disabled={busy} onClick={onRetry}>
                <RefreshCw size={14} /> Retry
              </button>
            )}
            {st.status !== "done" && (
              <button className="ghost" disabled={busy} onClick={onComplete}>
                <ClipboardList size={14} /> Mark done
              </button>
            )}
          </div>
          {st.logs && (
            <>
              <p className="eyebrow">Logs</p>
              <pre className="logs">{st.logs}</pre>
            </>
          )}
        </div>
      )}
    </article>
  );
}

function ReposView({ repos }: { repos: Repo[] }) {
  const list = repos.filter((r) => r.permissions.push || r.permissions.admin);
  return (
    <div className="surface">
      <p className="eyebrow">Writable repositories</p>
      <h3>{list.length} repos you can orchestrate</h3>
      <ul className="repo-grid">
        {list.map((r) => (
          <li key={r.id}>
            <a href={r.htmlUrl} target="_blank" rel="noreferrer">
              <b>{r.fullName}</b>
              <span>
                {r.language || "n/a"} · {r.defaultBranch}
                {r.private ? " · private" : ""}
              </span>
              <p>{r.description || "No description"}</p>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AgentsView({
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
