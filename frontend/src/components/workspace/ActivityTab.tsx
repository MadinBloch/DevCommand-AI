import { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { api, type ActivityLog } from "../../api";

export function ActivityView() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const r = await api.activity();
      setLogs(r.logs);
    } catch (e: any) {
      setError(e.message || "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="stack rise">
      <div className="surface">
        <p className="eyebrow">
          <ScrollText size={12} style={{ display: "inline", marginRight: 6 }} />
          Activity logs
        </p>
        <h3>Audit trail</h3>
        <p className="hint">Secrets are redacted. Actions include auth, planning, agent runs, and PR events.</p>
      </div>
      {error && <div className="banner bad">{error}</div>}
      <div className="surface">
        {loading && !logs.length ? (
          <p className="hint">Loading…</p>
        ) : !logs.length ? (
          <p className="hint">No activity yet.</p>
        ) : (
          <ul className="activity-list">
            {logs.map((l) => (
              <li key={l.id}>
                <code>{new Date(l.createdAt).toLocaleString()}</code>
                <b>{l.action}</b>
                <span>{l.detail || "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
