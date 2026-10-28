import { useState } from "react";
import { CheckCircle2, ClipboardList, Copy, Play, RefreshCw, Rocket } from "lucide-react";
import { Button } from "../ui";
import { api, type FeatureRunDetail, type SubTask } from "../../api";
import { STATUS_LABEL, formatWhen, runProgress, statusClass } from "./status";

export function RunDetail({
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
  const prog = runProgress(run);

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
    <div className="stack rise">
      <section className="surface run-head">
        <div>
          <p className="eyebrow">{run.repoFullName}</p>
          <h2>{run.title}</h2>
          <p className="goal">{run.goal}</p>
          <div className="meta-row">
            <span className={`pill ${statusClass(run.status)}`}>{STATUS_LABEL[run.status] || run.status}</span>
            <span className="pill mute">created · {formatWhen(run.createdAt)}</span>
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
            {prog.total > 0 && (
              <span className="pill mute">
                {prog.done}/{prog.total} tasks · {prog.pct}%
              </span>
            )}
          </div>
          {prog.total > 0 && (
            <div className="progress-track" style={{ width: "100%", maxWidth: 360, height: 6, marginTop: 14 }}>
              <div className="progress-fill" style={{ width: `${prog.pct}%` }} />
            </div>
          )}
          {run.errorMessage && <div className="banner warn" style={{ marginTop: 14 }}>{run.errorMessage}</div>}
          {run.testSummary && (
            <div className="banner mute" style={{ marginTop: 14 }}>
              <b>Test summary</b>
              <pre>{run.testSummary}</pre>
            </div>
          )}
        </div>
        <div className="run-actions">
          {["queued", "failed"].includes(run.status) && (
            <Button disabled={busy} onClick={() => act(() => api.startRun(run.id))}>
              <Play size={16} /> Restart pipeline
            </Button>
          )}
          {run.status === "awaiting_approval" && !run.prUrl && (
            <p className="hint" role="status">
              Coding work is pending. Connect an agent or push commits to your feature branch; PR approval is
              unavailable until a real PR exists.
            </p>
          )}
          {run.status === "awaiting_approval" && Boolean(run.prUrl) && (
            <>
              <Button disabled={busy} onClick={() => act(() => api.approveRun(run.id, false))}>
                <CheckCircle2 size={16} /> Approve (no merge)
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => act(() => api.approveRun(run.id, true))}>
                <Rocket size={16} /> Approve & merge PR
              </Button>
            </>
          )}
        </div>
      </section>

      {scan?.summary && (
        <section className="surface">
          <p className="eyebrow">Repo scan</p>
          <h3>Context used for planning</h3>
          <p className="hint">{scan.summary}</p>
          {!!scan.relevantFiles?.length && (
            <div className="chips">
              {scan.relevantFiles.slice(0, 14).map((f: string) => (
                <span key={f}>{f}</span>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="surface">
        <p className="eyebrow">Pipeline timeline</p>
        <h3>Assigned workboard</h3>
        <div className="timeline" style={{ marginBottom: 18 }}>
          {run.subTasks.map((st) => (
            <div key={st.id} className={`timeline-item ${statusClass(st.status)}`}>
              <span className="node" />
              <div>
                <b style={{ fontSize: "0.9rem" }}>
                  {st.orderIndex + 1}. {st.title}
                </b>
                <div className="run-meta">
                  {st.agent} · {STATUS_LABEL[st.status] || st.status}
                  {st.completedAt ? ` · finished ${formatWhen(st.completedAt)}` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>

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
      <button type="button" className="task-head" onClick={onToggle}>
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
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => navigator.clipboard.writeText(st.followUpPrompt || st.generatedPrompt)}
            >
              <Copy size={14} /> Copy prompt
            </Button>
            {["failed", "needs_followup"].includes(st.status) && (
              <Button variant="outline" size="sm" disabled={busy} onClick={onRetry}>
                <RefreshCw size={14} /> Retry
              </Button>
            )}
            {st.status !== "done" && (
              <Button variant="outline" size="sm" disabled={busy} onClick={onComplete}>
                <ClipboardList size={14} /> Mark done
              </Button>
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
