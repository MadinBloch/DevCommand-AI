import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "../ui";
import type { FeatureRun } from "../../api";
import {
  STATUS_LABEL,
  formatWhen,
  matchesHistoryFilter,
  runProgress,
  statusClass,
  type HistoryFilter,
} from "./status";

const FILTERS: Array<{ id: HistoryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "approval", label: "Needs approval" },
  { id: "done", label: "Done" },
  { id: "failed", label: "Failed" },
];

export function RunsList({ runs, onOpen }: { runs: FeatureRun[]; onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<HistoryFilter>("all");

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return runs.filter((r) => {
      if (!matchesHistoryFilter(r.status, filter)) return false;
      if (!query) return true;
      return (
        r.title.toLowerCase().includes(query) ||
        r.repoFullName.toLowerCase().includes(query) ||
        r.goal.toLowerCase().includes(query) ||
        (r.branchName || "").toLowerCase().includes(query)
      );
    });
  }, [runs, q, filter]);

  const counts = useMemo(
    () => ({
      all: runs.length,
      active: runs.filter((r) => matchesHistoryFilter(r.status, "active")).length,
      approval: runs.filter((r) => matchesHistoryFilter(r.status, "approval")).length,
      done: runs.filter((r) => matchesHistoryFilter(r.status, "done")).length,
      failed: runs.filter((r) => matchesHistoryFilter(r.status, "failed")).length,
    }),
    [runs]
  );

  return (
    <div className="surface rise">
      <p className="eyebrow">Orchestration archive</p>
      <h3>Feature run history</h3>
      <p className="hint" style={{ marginTop: -6, marginBottom: 16 }}>
        Every run you create is kept here — search, filter, and reopen any past orchestration.
      </p>

      <div className="toolbar">
        <div className="search">
          <Search size={15} />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, repo, goal, branch…"
            aria-label="Search run history"
          />
        </div>
        <div className="filter-chips" role="tablist" aria-label="Filter history">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`filter-chip ${filter === f.id ? "active" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              <span style={{ opacity: 0.7, marginLeft: 4 }}>{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {!runs.length ? (
        <p className="empty">Nothing in history yet. Create a feature run from Command Center.</p>
      ) : !filtered.length ? (
        <p className="empty">No runs match this search / filter.</p>
      ) : (
        <ul className="run-list dense">
          {filtered.map((r) => {
            const prog = runProgress(r);
            return (
              <li key={r.id}>
                <button type="button" className="run-row" onClick={() => onOpen(r.id)}>
                  <div>
                    <b>{r.title}</b>
                    <span className="run-meta">
                      {r.repoFullName} · {STATUS_LABEL[r.status] || r.status}
                      {prog.total ? ` · ${prog.done}/${prog.total} tasks` : ""} · {formatWhen(r.createdAt)}
                    </span>
                  </div>
                  <div className="run-side">
                    <span className={`pill ${statusClass(r.status)}`}>{STATUS_LABEL[r.status] || r.status}</span>
                    {prog.total > 0 && (
                      <div className="progress-track" title={`${prog.pct}%`}>
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
    </div>
  );
}
