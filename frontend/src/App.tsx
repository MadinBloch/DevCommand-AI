import { useCallback, useEffect, useState } from "react";
import { Github, ShieldCheck, GitBranch, Bot, ClipboardList, LogOut, RefreshCw, ExternalLink } from "lucide-react";

const API = (import.meta as any).env.VITE_API_BASE_URL || "http://localhost:4000";

async function apiJson(path: string, init: RequestInit = {}) {
  const response = await fetch(API + path, { credentials: "include", ...init });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data;
}

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [repo, setRepo] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [user, setUser] = useState<any>(null);
  const [repos, setRepos] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const me = await apiJson("/api/auth/me");
      setUser(me?.user || null);
      if (me?.user) {
        const [repoData, taskData] = await Promise.all([
          apiJson("/api/github/repos"),
          apiJson("/api/tasks")
        ]);
        if (!Array.isArray(repoData)) throw new Error(repoData?.error || "Could not load GitHub repositories.");
        setRepos(repoData);
        setTasks(Array.isArray(taskData) ? taskData : []);
        setRepo(current => current && repoData.some((r: any) => r.fullName === current) ? current : (repoData[0]?.fullName || ""));
      } else {
        setRepos([]);
        setTasks([]);
        setRepo("");
      }
    } catch (e: any) {
      setError(e?.message || "Could not connect to the DevCommand API.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function login() {
    setError("");
    window.location.href = API + "/api/auth/github";
  }

  async function logout() {
    try {
      await apiJson("/api/auth/logout", { method: "POST" });
      setUser(null);
      setRepos([]);
      setTasks([]);
      setRepo("");
      setNotice("You have signed out of GitHub.");
    } catch (e: any) {
      setError(e?.message || "Could not sign out.");
    }
  }

  async function create(e: any) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const data = await apiJson("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoFullName: repo, title, prompt })
      });
      setTasks(current => [data.task, ...current]);
      setPrompt("");
      setTitle("");
      setNotice("Task plan created successfully.");
    } catch (e: any) {
      setError(e?.message || "Could not create task.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="app">
    <aside>
      <div className="brand"><span className="logo">DC</span><div><b>DevCommand AI</b><small>CODING MANAGER</small></div></div>
      {user && <div className="account">
        {user.avatar_url ? <img className="avatar" src={user.avatar_url} alt="" /> : <span className="avatar avatarFallback"><Github size={18}/></span>}
        <div className="accountText"><b>{user.name || user.login}</b><small>@{user.login}</small></div>
        <button className="iconButton" onClick={logout} title="Sign out of GitHub" aria-label="Sign out"><LogOut size={16}/></button>
      </div>}
      <p className="label">WORKSPACE</p>
      <a className="nav active" href="#tasks"><ClipboardList size={17}/> Task manager</a>
      <a className="nav" href="#repositories"><GitBranch size={17}/> Repositories <span className="navCount">{user ? repos.length : "—"}</span></a>
      <a className="nav" href="#agents"><Bot size={17}/> Agent orchestration</a>
      <div className="guard"><ShieldCheck size={18}/><div><b>Human approval required</b><p>No automatic merges to main.</p></div></div>
      <div className="bottom">MVP · No paid AI API configured</div>
    </aside>
    <main>
      <header><div><small>YOUR ENGINEERING WORKSPACE</small><h1>Build with a plan.</h1><p className="subhead">{user ? `Signed in as @${user.login}` : "Connect your GitHub account to get started."}</p></div><button className="outline" onClick={() => void load()} disabled={loading}><RefreshCw size={15}/>{loading ? "Loading…" : "Refresh"}</button></header>
      {error && <div className="error" role="alert">{error}</div>}
      {notice && <div className="success" role="status">{notice}</div>}
      {loading && <div className="panel loadingPanel">Checking your GitHub session and loading your workspace…</div>}
      <section className="hero"><div><small>REPOSITORY-AWARE WORKFLOW</small><h2>Turn ideas into <em>reviewable work.</em></h2><p>Describe the change. DevCommand creates a structured plan while keeping execution and merge approval under your control.</p>{user ? <div className="connected"><ShieldCheck size={17}/> GitHub connected <span>·</span> {repos.length} repositories available</div> : <button onClick={login}><Github size={17}/> Continue with GitHub</button>}</div><div className="heroIcon"><Bot size={58}/><span>PLAN → REVIEW → APPROVE</span></div></section>
      <section className="grid" id="tasks">
        <article className="panel"><small>NEW WORK ITEM</small><h2>Create a task</h2><p>Choose a repository and describe the result you want.</p>
          {user ? (repos.length ? <form onSubmit={create}><label htmlFor="repo">Repository</label><select id="repo" value={repo} onChange={e => setRepo(e.target.value)} required>{repos.map(r => <option key={r.id} value={r.fullName}>{r.fullName}{r.private ? " · private" : ""}</option>)}</select><label htmlFor="title">Task title</label><input id="title" value={title} onChange={e => setTitle(e.target.value)} minLength={3} maxLength={120} required placeholder="Improve authentication flow"/><label htmlFor="prompt">What should change?</label><textarea id="prompt" value={prompt} onChange={e => setPrompt(e.target.value)} minLength={10} maxLength={12000} required rows={5} placeholder="Describe goals, constraints, acceptance criteria…"/><button type="submit" disabled={busy || !repo}>{busy ? "Creating plan…" : "Generate plan"}</button></form> : <p>No repositories were returned for this GitHub account. Check that the OAuth app has the required repository access.</p>) : <button onClick={login}><Github size={16}/> Sign in to start</button>}
        </article>
        <article className="panel" id="agents"><small>SAFE DEFAULTS</small><h2>Human-led, agent-ready</h2>{[["01","Inspect before editing"],["02","Bounded implementation plan"],["03","Regression tests and evidence"],["04","Independent review + approval"]].map(x => <div className="step" key={x[0]}><b>{x[0]}</b><span>{x[1]}</span></div>)}<div className="warning">Agent execution adapters are not connected yet. Task creation currently generates a plan only; it does not edit code or open pull requests.</div></article>
      </section>
      <section className="panel" id="repositories"><div className="sectionHeading"><div><small>GITHUB</small><h2>Your repositories</h2></div>{user && <a href="https://github.com" target="_blank" rel="noreferrer">Open GitHub <ExternalLink size={14}/></a>}</div>{!user ? <p>Sign in with GitHub to see your repositories here.</p> : repos.length ? <div className="repoList">{repos.map(r => <a className="repoItem" key={r.id} href={r.htmlUrl} target="_blank" rel="noreferrer"><GitBranch size={17}/><span><b>{r.fullName}</b><small>{r.description || (r.private ? "Private repository" : "GitHub repository")}</small></span><span className="repoVisibility">{r.private ? "Private" : "Public"} ↗</span></a>)}</div> : <p>No repositories to show.</p>}</section>
      <section className="panel"><small>RECENT TASKS</small><h2>Task history</h2>{tasks.length ? tasks.map(t => <div className="task" key={t.id}><b>{t.title}</b><span>{t.repoFullName} · {t.status}</span></div>) : <p>{user ? "No tasks created yet. Create your first task above." : "Sign in with GitHub to view task history."}</p>}</section>
      <footer>DEVCOMMAND AI · HUMAN APPROVAL ALWAYS <span>● SAFE MERGE POLICY</span></footer>
    </main>
  </div>;
}
