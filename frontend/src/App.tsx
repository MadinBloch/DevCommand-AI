import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Badge, Button } from "./components/ui";
import { Bot, GitBranch, Github, LayoutDashboard, Loader2, Menu, LogOut, RefreshCw, Rocket, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { api, type AgentInfo, type FeatureRun, type FeatureRunDetail, type Repo, type User } from "./api";
import { HomeView } from "./components/workspace/HomeTab";
import { RunsList } from "./components/workspace/RunsTab";
import { RunDetail } from "./components/workspace/RunDetailTab";
import { ReposView } from "./components/workspace/RepositoriesTab";
import { AgentsView } from "./components/workspace/AgentsTab";

type View = "home" | "runs" | "run" | "agents" | "repos";

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

        <nav className="workspace-tabs" aria-label="Workspace sections">
          {([
            ["home", "Command Center", LayoutDashboard],
            ["runs", "Feature Runs", Workflow],
            ["repos", "Repositories", GitBranch],
            ["agents", "AI Agents", Bot]
          ] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" className={`workspace-tab ${(view === id || (id === "runs" && view === "run")) ? "active" : ""}`}
              aria-current={view === id || (id === "runs" && view === "run") ? "page" : undefined}
              onClick={() => { setView(id); setMobileNavOpen(false); }}>
              <Icon size={16} /><span>{label}</span>
              {id === "runs" && <span className="tab-counter">{runs.length}</span>}
            </button>
          ))}
        </nav>
        {view === "run" && activeRun && <div className="detail-breadcrumb"><button type="button" onClick={() => setView("runs")}>Feature Runs</button><span>/</span><strong>{activeRun.title}</strong></div>}

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

