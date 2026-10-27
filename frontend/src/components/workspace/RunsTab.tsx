import { Card } from "../ui";
import type { FeatureRun } from "../../api";
import { STATUS_LABEL, statusClass } from "./status";

export function RunsList({ runs, onOpen }: { runs: FeatureRun[]; onOpen: (id: string) => void }) {
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
