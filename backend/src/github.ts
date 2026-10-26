export async function gh(path: string, token: string, init?: RequestInit) {
  const r = await fetch("https://api.github.com" + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "DevCommand-AI",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw Object.assign(
      new Error(
        r.status === 401
          ? "GitHub session expired."
          : r.status === 403
            ? "GitHub permission or rate-limit error."
            : body || "GitHub request failed."
      ),
      { status: r.status, body }
    );
  }
  if (r.status === 204) return null;
  return r.json();
}
