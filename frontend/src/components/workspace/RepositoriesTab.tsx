import { useMemo, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { Input } from "../ui";
import type { Repo } from "../../api";

export function ReposView({ repos }: { repos: Repo[] }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const writable = repos.filter((r) => r.permissions.push || r.permissions.admin);
    const query = q.trim().toLowerCase();
    if (!query) return writable;
    return writable.filter(
      (r) =>
        r.fullName.toLowerCase().includes(query) ||
        (r.description || "").toLowerCase().includes(query) ||
        (r.language || "").toLowerCase().includes(query)
    );
  }, [repos, q]);

  return (
    <div className="surface rise">
      <p className="eyebrow">Connected GitHub</p>
      <h3>{list.length} repos you can orchestrate</h3>
      <p className="hint" style={{ marginTop: -6, marginBottom: 16 }}>
        Only repositories with push or admin access appear here. History of runs stays linked by repo name.
      </p>

      <div className="toolbar">
        <div className="search">
          <Search size={15} />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter repositories…"
            aria-label="Filter repositories"
          />
        </div>
      </div>

      {!list.length ? (
        <p className="empty">No matching writable repositories.</p>
      ) : (
        <ul className="repo-grid">
          {list.map((r) => (
            <li key={r.id}>
              <a href={r.htmlUrl} target="_blank" rel="noreferrer">
                <b>{r.fullName}</b>
                <span>
                  {r.language || "n/a"} · {r.defaultBranch}
                  {r.private ? " · private" : " · public"}
                </span>
                <p>{r.description || "No description"}</p>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12, color: "var(--signal)" }}>
                  Open on GitHub <ExternalLink size={13} />
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
