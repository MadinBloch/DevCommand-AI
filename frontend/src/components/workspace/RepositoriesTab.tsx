import type { Repo } from "../../api";

export function ReposView({ repos }: { repos: Repo[] }) {
  const list = repos.filter((r) => r.permissions.push || r.permissions.admin);
  return (
    <div className="surface">
      <p className="eyebrow">Writable repositories</p>
      <h3>{list.length} repos you can orchestrate</h3>
      <ul className="repo-grid">
        {list.map((r) => (
          <li key={r.id}>
            <a href={r.htmlUrl} target="_blank" rel="noreferrer">
              <b>{r.fullName}</b>
              <span>
                {r.language || "n/a"} · {r.defaultBranch}
                {r.private ? " · private" : ""}
              </span>
              <p>{r.description || "No description"}</p>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
