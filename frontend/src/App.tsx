import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Bot,
  GitBranch,
  Github,
  KeyRound,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  RefreshCw,
  Rocket,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";
import { Badge, Button } from "./components/ui";
import { api, type AgentInfo, type FeatureRun, type FeatureRunDetail, type Repo, type User } from "./api";
import { DashboardHome } from "./dashboard/DashboardHome";
import { RunsList } from "./components/workspace/RunsTab";
import { RunDetail } from "./components/workspace/RunDetailTab";
import { ReposView } from "./components/workspace/RepositoriesTab";
import { AgentsView } from "./components/workspace/AgentsTab";
import { SettingsView } from "./components/workspace/SettingsTab";

type Page = "dashboard" | "runs" | "run" | "repos" | "agents" | "settings";

const NAV: Array<{ id: Page; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "runs", label: "Runs", icon: Workflow },
  { id: "repos", label: "Repositories", icon: GitBranch },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "settings", label: "Settings", icon: KeyRound },
];

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [user, setUser] = useState<User | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [runs, setRuns] = useState<FeatureRun[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [agentMode, setAgentMode] = useState("manual");
  const [llmPlanner, setLlmPlanner] = useState(false);
  const [llmCoder, setLlmCoder] = useState(false);
  const [canCommit, setCanCommit] = useState(false);
  const [activeRun, setActiveRun] = useState<FeatureRunDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

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
      setLlmCoder(Boolean(ag.llmCoder));
      setCanCommit(Boolean(ag.canCommit));
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
    if (
      !activeRun ||
      !["queued", "scanning", "planning", "running", "testing", "reviewing", "deploying"].includes(activeRun.status)
    )
      return;
    const t = setInterval(async () => {
      try {
        const r = await api.run(activeRun.id);
        setActiveRun(r);
        setRuns((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...r } : x)));
      } catch {
        /* ignore */
      }
    }, 2500);
    return () => clearInterval(t);
  }, [activeRun?.id, activeRun?.status]);

  function go(next: Page) {
    setPage(next);
    setNavOpen(false);
  }

  async function openRun(id: string) {
    setBusy(true);
    setError("");
    try {
      const r = await api.run(id);
      setActiveRun(r);
      go("run");
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
      go("run");
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
    setPage("dashboard");
  }

  const titles: Record<Page, string> = {
    dashboard: "Dashboard",
    runs: "Runs",
    run: activeRun?.title || "Run detail",
    repos: "Repositories",
    agents: "Agents",
    settings: "Settings",
  };

  if (loading) {
    return (
      <div className="boot">
        <div className="boot-mark">DC</div>
        <Loader2 className="spin" size={22} />
        <p>Loading workspace…</p>
      </div>
    );
  }

  if (!user) {
    return <LoginPage error={error} onRetry={bootstrap} />;
  }

  return (
    <div className={`app-shell ${navOpen ? "nav-open" : ""}`}>
      {navOpen && <button type="button" className="nav-backdrop" aria-label="Close menu" onClick={() => setNavOpen(false)} />}

      <aside className="app-nav" aria-label="Main">
        <div className="app-nav-top">
          <div className="brand">
            <span className="mark">DC</span>
            <div>
              <strong>DevCommand</strong>
              <em>WORKSPACE</em>
            </div>
          </div>
          <button type="button" className="nav-close ghost icon" onClick={() => setNavOpen(false)} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <nav className="app-nav-links">
          {NAV.map((item) => (
            <NavItem
              key={item.id}
              active={page === item.id || (item.id === "runs" && page === "run")}
              icon={<item.icon size={17} />}
              label={item.label}
              badge={item.id === "runs" ? runs.length : undefined}
              onClick={() => go(item.id)}
            />
          ))}
        </nav>

        <div className="app-nav-foot">
          <div className="user-chip">
            {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span className="av">{user.login[0]}</span>}
            <div>
              <b>{user.name || user.login}</b>
              <span>@{user.login}</span>
            </div>
            <button type="button" className="ghost icon" aria-label="Sign out" onClick={logout}>
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      <div className="app-body">
        <header className="app-topbar">
          <div className="app-topbar-left">
            <Button variant="outline" size="icon" className="mobile-toggle" aria-label="Open menu" onClick={() => setNavOpen(true)}>
              <Menu size={18} />
            </Button>
            <div>
              {page === "run" && activeRun ? (
                <div className="crumb">
                  <button type="button" onClick={() => go("runs")}>
                    Runs
                  </button>
                  <span>/</span>
                  <strong>{activeRun.title}</strong>
                </div>
              ) : (
                <h1>{titles[page]}</h1>
              )}
            </div>
          </div>
          <div className="app-topbar-right">
            <Badge variant={canCommit ? "default" : "outline"}>
              {canCommit ? "ready" : "setup needed"} · {agentMode}
            </Badge>
            <Button variant="outline" onClick={bootstrap}>
              <RefreshCw size={15} /> Refresh
            </Button>
          </div>
        </header>

        <div className="app-content">
          {error && <div className="banner bad">{error}</div>}

          {page === "dashboard" && (
            <DashboardHome
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
              canCommit={canCommit}
              llmCoder={llmCoder}
              agentMode={agentMode}
              onCreate={createRun}
              onOpen={openRun}
              onNavigate={(p) => go(p)}
            />
          )}
          {page === "runs" && <RunsList runs={runs} onOpen={openRun} />}
          {page === "run" && activeRun && (
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
          {page === "repos" && <ReposView repos={repos} />}
          {page === "agents" && (
            <AgentsView agents={agents} mode={agentMode} llmPlanner={llmPlanner} llmCoder={llmCoder} canCommit={canCommit} />
          )}
          {page === "settings" && <SettingsView onSaved={() => void bootstrap()} />}
        </div>
      </div>
    </div>
  );
}

function NavItem({
  active,
  icon,
  label,
  badge,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`app-nav-item ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} onClick={onClick}>
      {icon}
      <span>{label}</span>
      {typeof badge === "number" && <em className="nav-badge">{badge}</em>}
    </button>
  );
}

function LoginPage({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="login">
      <div className="login-visual">
        <div className="brand">
          <span className="mark">DC</span>
          <div>
            <strong>DevCommand AI</strong>
            <em>BUILD · REVIEW · SHIP</em>
          </div>
        </div>
        <div>
          <h1>
            Your AI coding <span>control plane</span>
          </h1>
          <p>One goal in. Multi-agent plan, commits, PR, and approval — with full run history.</p>
          <div className="login-orbit">
            <span>Scan</span>
            <span>Assign</span>
            <span>Commit</span>
            <span>Approve</span>
          </div>
        </div>
      </div>
      <div className="login-panel">
        <h2>Sign in to your workspace</h2>
        <p>Connect GitHub to load repos and continue where you left off.</p>
        <ul className="login-steps">
          <li>
            <Sparkles size={16} /> Plan work from a single goal
          </li>
          <li>
            <Bot size={16} /> Assign coding agents automatically
          </li>
          <li>
            <Rocket size={16} /> Review PRs before merge
          </li>
        </ul>
        {error && <div className="banner bad">{error}</div>}
        <div className="login-actions">
          <Button className="primary lg" onClick={() => (location.href = api.loginUrl())}>
            <Github size={18} /> Continue with GitHub
          </Button>
          <Button variant="outline" onClick={onRetry}>
            Check API connection
          </Button>
        </div>
      </div>
    </div>
  );
}
