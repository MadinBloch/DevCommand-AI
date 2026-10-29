import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  Rocket,
  Send,
  Sparkles,
  User,
} from "lucide-react";
import { Button } from "../components/ui";
import { api, type FeatureRun, type FeatureRunDetail, type Repo } from "../api";
import { STATUS_LABEL, formatWhen, statusClass } from "../components/workspace/status";

type ChatMsg = {
  id: string;
  role: "user" | "system" | "assistant";
  body: string;
  kind?: "text" | "plan" | "agents" | "status" | "pr";
};

export function RepoChat({
  repo,
  runs,
  canCommit,
  busy,
  setBusy,
  setError,
  onBack,
  onOpenSettings,
  onRunsChange,
  initialRunId,
}: {
  repo: Repo;
  runs: FeatureRun[];
  canCommit: boolean;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setError: (v: string) => void;
  onBack: () => void;
  onOpenSettings: () => void;
  onRunsChange: (runs: FeatureRun[]) => void;
  initialRunId?: string | null;
}) {
  const [input, setInput] = useState("");
  const [activeRun, setActiveRun] = useState<FeatureRunDetail | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!initialRunId) return;
    void (async () => {
      try {
        setActiveRun(await api.run(initialRunId));
      } catch (e: any) {
        setError(e.message || "Could not open run");
      }
    })();
  }, [initialRunId, repo.fullName]);

  const repoRuns = useMemo(
    () => runs.filter((r) => r.repoFullName === repo.fullName).slice(0, 12),
    [runs, repo.fullName]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeRun?.status, activeRun?.subTasks, input]);

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
        onRunsChange(await api.runs());
      } catch {
        /* ignore */
      }
    }, 2200);
    return () => clearInterval(t);
  }, [activeRun?.id, activeRun?.status]);

  const messages = useMemo(() => buildMessages(repo, activeRun, canCommit), [repo, activeRun, canCommit]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const goal = input.trim();
    if (goal.length < 10) {
      setError("Task thoda detail mein likho (kam se kam 10 characters).");
      return;
    }
    if (!canCommit) {
      setError("Pehle Settings mein OpenAI API key add karo — bina key ke real coding/commit nahi hoga.");
      return;
    }
    setLocalBusy(true);
    setBusy(true);
    setError("");
    try {
      const title = goal.length > 80 ? goal.slice(0, 77) + "…" : goal;
      const { run } = await api.createRun({
        repoFullName: repo.fullName,
        title,
        goal,
        autoStart: true,
      });
      setInput("");
      setActiveRun(run);
      onRunsChange(await api.runs());
    } catch (err: any) {
      setError(err.message || "Could not start run");
    } finally {
      setLocalBusy(false);
      setBusy(false);
    }
  }

  async function loadRun(id: string) {
    setLocalBusy(true);
    try {
      setActiveRun(await api.run(id));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLocalBusy(false);
    }
  }

  async function approve(merge: boolean) {
    if (!activeRun) return;
    setBusy(true);
    setError("");
    try {
      const { run } = await api.approveRun(activeRun.id, merge);
      setActiveRun(run);
      onRunsChange(await api.runs());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const awaiting = activeRun?.status === "awaiting_approval" && Boolean(activeRun.prUrl);

  return (
    <div className="chat-layout">
      <header className="chat-header">
        <button type="button" className="chat-back" onClick={onBack}>
          <ArrowLeft size={16} /> Repos
        </button>
        <div className="chat-repo">
          <b>{repo.fullName}</b>
          <span>
            {repo.language || "repo"} · {repo.defaultBranch}
            {repo.private ? " · private" : ""}
          </span>
        </div>
        <a className="pill mute" href={repo.htmlUrl} target="_blank" rel="noreferrer">
          GitHub <ExternalLink size={12} />
        </a>
      </header>

      <div className="chat-main">
        <aside className="chat-history">
          <p className="eyebrow">This repo</p>
          <h3>Past chats</h3>
          {!repoRuns.length ? (
            <p className="hint">Abhi koi run nahi. Neeche task likho.</p>
          ) : (
            <ul>
              {repoRuns.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className={activeRun?.id === r.id ? "active" : ""}
                    onClick={() => void loadRun(r.id)}
                  >
                    <b>{r.title}</b>
                    <span>
                      {STATUS_LABEL[r.status] || r.status} · {formatWhen(r.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="chat-thread">
          <div className="chat-scroll">
            {messages.map((m) => (
              <article key={m.id} className={`chat-bubble ${m.role}`}>
                <div className="chat-avatar">
                  {m.role === "user" ? <User size={14} /> : m.role === "system" ? <Sparkles size={14} /> : <Bot size={14} />}
                </div>
                <div className="chat-body">
                  {m.kind === "plan" || m.kind === "agents" ? (
                    <div dangerouslySetInnerHTML={{ __html: m.body }} />
                  ) : (
                    <p>{m.body}</p>
                  )}
                </div>
              </article>
            ))}

            {activeRun?.subTasks?.length ? (
              <article className="chat-bubble assistant">
                <div className="chat-avatar">
                  <Bot size={14} />
                </div>
                <div className="chat-body">
                  <p className="chat-label">Live agent board</p>
                  <ul className="chat-agents">
                    {activeRun.subTasks.map((st) => (
                      <li key={st.id}>
                        <span className={`pill ${statusClass(st.status)}`}>{STATUS_LABEL[st.status] || st.status}</span>
                        <div>
                          <b>
                            {st.orderIndex + 1}. {st.title}
                          </b>
                          <em>Assigned to · {st.agent}</em>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="hint">
                    Pipeline: <b>{STATUS_LABEL[activeRun.status] || activeRun.status}</b>
                    {activeRun.branchName ? ` · ${activeRun.branchName}` : ""}
                  </p>
                  {activeRun.prUrl && (
                    <p>
                      <a className="pill live" href={activeRun.prUrl} target="_blank" rel="noreferrer">
                        Open PR <ExternalLink size={12} />
                      </a>
                    </p>
                  )}
                  {activeRun.errorMessage && <div className="banner warn">{activeRun.errorMessage}</div>}
                  {awaiting && (
                    <div className="chat-approve">
                      <p>Plan + commits ready. Approve tab merge hoga.</p>
                      <div className="row">
                        <Button disabled={busy} onClick={() => void approve(false)}>
                          <CheckCircle2 size={16} /> Approve (no merge)
                        </Button>
                        <Button variant="outline" disabled={busy} onClick={() => void approve(true)}>
                          <Rocket size={16} /> Approve & merge
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            ) : null}

            <div ref={bottomRef} />
          </div>

          <form className="chat-composer" onSubmit={send}>
            {!canCommit && (
              <div className="chat-key-hint">
                <KeyRound size={14} />
                <span>OpenAI key Settings mein add karo — warna task start nahi hoga.</span>
                <button type="button" onClick={onOpenSettings}>
                  Settings
                </button>
              </div>
            )}
            <div className="chat-input-row">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={`Task likho for ${repo.name}… e.g. "Add dark mode toggle on settings page"`}
                rows={2}
                disabled={localBusy || busy}
              />
              <Button type="submit" disabled={localBusy || busy || input.trim().length < 10 || !canCommit}>
                {localBusy || busy ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
                Send
              </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildMessages(repo: Repo, run: FeatureRunDetail | null, canCommit: boolean): ChatMsg[] {
  const msgs: ChatMsg[] = [
    {
      id: "welcome",
      role: "system",
      body: `${repo.fullName} open hai. Yahan ChatGPT/Cursor jaisa task likho — main plan banaunga, agents assign karunga, aur progress isi chat mein dikhaunga. Merge sirf aapke Approve ke baad.`,
    },
  ];

  if (!canCommit) {
    msgs.push({
      id: "nokey",
      role: "assistant",
      body: "Abhi OpenAI API key connect nahi hai. Settings → key save karo, phir task bhejo. Pehle bina key ke jo PR bani thi woh demo/simulate mode thi — asli code changes nahi.",
    });
  }

  if (!run) return msgs;

  msgs.push({
    id: `u-${run.id}`,
    role: "user",
    body: run.goal,
  });

  const scan = run.scanJson as any;
  if (scan?.summary || run.status !== "queued") {
    msgs.push({
      id: `scan-${run.id}`,
      role: "assistant",
      kind: "plan",
      body: `<p><b>Repo scan</b></p><p>${escapeHtml(scan?.summary || "Scanning…")}</p>`,
    });
  }

  if (run.subTasks?.length) {
    const rows = run.subTasks
      .map(
        (st) =>
          `<li><b>${escapeHtml(st.title)}</b> → <code>${escapeHtml(st.agent)}</code> · ${escapeHtml(
            STATUS_LABEL[st.status] || st.status
          )}</li>`
      )
      .join("");
    msgs.push({
      id: `plan-${run.id}`,
      role: "assistant",
      kind: "agents",
      body: `<p><b>Automatic plan + AI assignment</b></p><ol>${rows}</ol>`,
    });
  }

  if (run.status === "done") {
    msgs.push({
      id: `done-${run.id}`,
      role: "assistant",
      body: "Run complete. Agar merge Approve & merge se ho chuka hai to branch main mein aa chuki hogi.",
    });
  }

  return msgs;
}
