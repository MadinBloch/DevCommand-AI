import { useEffect, useState, type ReactNode } from "react";
import {
  Bot,
  GitBranch,
  Github,
  KeyRound,
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
import { api, type AgentInfo, type FeatureRun, type Repo, type User } from "./api";
import { RepoChat } from "./chat/RepoChat";
import { RunsList } from "./components/workspace/RunsTab";
import { SettingsView } from "./components/workspace/SettingsTab";
import { AgentsView } from "./components/workspace/AgentsTab";

type Page = "repos" | "chat" | "history" | "agents" | "settings";

const NAV: Array<{ id: Exclude<Page, "chat">; label: string; icon: typeof GitBranch }> = [
  { id: "repos", label: "Repositories", icon: GitBranch },
  { id: "history", label: "History", icon: Workflow },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "settings", label: "Settings", icon: KeyRound },
];

export default function App() {
  const [page, setPage] = useState<Page>("repos");
  const [user, setUser] = useState<User | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [runs, setRuns] = useState<FeatureRun[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [agentMode, setAgentMode] = useState("manual");
  const [llmPlanner, setLlmPlanner] = useState(false);
  const [llmCoder, setLlmCoder] = useState(false);
  const [canCommit, setCanCommit] = useState(false);
  const [activeRepo, setActiveRepo] = useState<Repo | null>(null);
  const [chatRunId, setChatRunId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [repoQuery, setRepoQuery] = useState("");

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

  function go(next: Page) {
    setPage(next);
    setNavOpen(false);
  }

  function openRepo(r: Repo, runId?: string) {
    setActiveRepo(r);
    setChatRunId(runId || null);
    setPage("chat");
    setNavOpen(false);
    setError("");
  }

  async function logout() {
    await api.logout();
    setUser(null);
    setRepos([]);
    setRuns([]);
    setActiveRepo(null);
    setPage("repos");
  }

  const writable = repos.filter((r) => r.permissions.push || r.permissions.admin);
  const filtered = writable.filter((r) => {
    const q = repoQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      r.fullName.toLowerCase().includes(q) ||
      (r.description || "").toLowerCase().includes(q) ||
      (r.language || "").toLowerCase().includes(q)
    );
  });

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
              <em>CHAT WORKSPACE</em>
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
              active={page === item.id || (item.id === "repos" && page === "chat")}
              icon={<item.icon size={17} />}
              label={item.label}
              badge={item.id === "history" ? runs.length : undefined}
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
            <h1>
              {page === "repos" && "Repositories"}
              {page === "chat" && (activeRepo?.fullName || "Chat")}
              {page === "history" && "History"}
              {page === "agents" && "Agents"}
              {page === "settings" && "Settings"}
            </h1>
          </div>
          <div className="app-topbar-right">
            <Badge variant={canCommit ? "default" : "outline"}>
              {canCommit ? "API ready" : "add OpenAI key"} · {agentMode}
            </Badge>
            <Button variant="outline" onClick={bootstrap}>
              <RefreshCw size={15} /> Refresh
            </Button>
          </div>
        </header>

        <div className={`app-content ${page === "chat" ? "app-content-flush" : ""}`}>
          {error && <div className="banner bad">{error}</div>}

          {page === "repos" && (
            <div className="repo-home rise">
              <div className="dash-welcome">
                <div>
                  <p className="eyebrow">Start here</p>
                  <h1>Pick a repository</h1>
                  <p className="dash-sub">
                    Repo pe click karo → chat khulegi. Wahan task likho, plan + AI assignment live dikhega, phir aap
                    Approve karke merge karoge.
                  </p>
                </div>
              </div>

              {!canCommit && (
                <div className="dash-alert">
                  <KeyRound size={18} />
                  <div>
                    <b>Pehle OpenAI key connect karo</b>
                    <p>
                      Bina key ke task start nahi hoga. Pehle jo PR bani thi woh simulate/demo mode ki wajah se thi —
                      asli coding agent nahi.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => go("settings")}>
                    Settings
                  </Button>
                </div>
              )}

              <div className="toolbar">
                <div className="search" style={{ position: "relative", flex: 1 }}>
                  <input
                    className="ui-input"
                    style={{ paddingLeft: 12 }}
                    value={repoQuery}
                    onChange={(e) => setRepoQuery(e.target.value)}
                    placeholder="Search repos…"
                    aria-label="Search repositories"
                  />
                </div>
              </div>

              {!filtered.length ? (
                <div className="dash-empty">
                  <h3>No writable repos</h3>
                  <p>GitHub pe aise repos chahiye jahan aapke paas push access ho.</p>
                </div>
              ) : (
                <ul className="repo-pick-grid">
                  {filtered.map((r) => (
                    <li key={r.id}>
                      <button type="button" className="repo-pick" onClick={() => openRepo(r)}>
                        <b>{r.fullName}</b>
                        <span>
                          {r.language || "n/a"} · {r.defaultBranch}
                          {r.private ? " · private" : ""}
                        </span>
                        <p>{r.description || "Open chat workspace"}</p>
                        <em>Open chat →</em>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {page === "chat" && activeRepo && (
            <RepoChat
              key={activeRepo.fullName + ":" + (chatRunId || "new")}
              repo={activeRepo}
              runs={runs}
              canCommit={canCommit}
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              onBack={() => go("repos")}
              onOpenSettings={() => go("settings")}
              onRunsChange={setRuns}
              initialRunId={chatRunId}
            />
          )}

          {page === "history" && (
            <RunsList
              runs={runs}
              onOpen={async (id) => {
                try {
                  const run = await api.run(id);
                  const match = repos.find((r) => r.fullName === run.repoFullName);
                  if (match) openRepo(match, id);
                  else setError("Repo not in your writable list: " + run.repoFullName);
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            />
          )}

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
            <em>REPO · CHAT · SHIP</em>
          </div>
        </div>
        <div>
          <h1>
            Chat with your <span>repo</span>
          </h1>
          <p>Repo select karo, task chat mein likho, plan + multi-AI assign dekho, phir Approve karke merge.</p>
          <div className="login-orbit">
            <span>Pick repo</span>
            <span>Chat task</span>
            <span>See plan</span>
            <span>Approve</span>
          </div>
        </div>
      </div>
      <div className="login-panel">
        <h2>Sign in</h2>
        <p>GitHub se writable repos load hongi. OpenAI key Settings se lagegi.</p>
        <ul className="login-steps">
          <li>
            <Sparkles size={16} /> Repo chat workspace
          </li>
          <li>
            <Bot size={16} /> Auto plan + agent assignment
          </li>
          <li>
            <Rocket size={16} /> Approve before merge
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
