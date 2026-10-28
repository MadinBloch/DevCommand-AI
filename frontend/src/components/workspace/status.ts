export const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  scanning: "Scanning repo",
  planning: "Planning",
  running: "Running agents",
  reviewing: "Opening PR",
  testing: "Testing",
  awaiting_approval: "Awaiting approval",
  deploying: "Deploying",
  done: "Done",
  failed: "Failed",
  ready: "Ready",
  needs_followup: "Needs follow-up",
  skipped: "Skipped",
};

export function statusClass(s: string) {
  if (s === "done") return "ok";
  if (s === "failed") return "bad";
  if (s === "awaiting_approval" || s === "needs_followup") return "warn";
  if (["running", "scanning", "planning", "testing", "deploying", "reviewing"].includes(s)) return "live";
  return "mute";
}

export function runProgress(run: {
  subTasks?: Array<{ status: string }>;
}) {
  const total = run.subTasks?.length || 0;
  const done = run.subTasks?.filter((s) => s.status === "done" || s.status === "skipped").length || 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return { done, total, pct };
}

export function formatWhen(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export type HistoryFilter = "all" | "active" | "approval" | "done" | "failed";

export function matchesHistoryFilter(status: string, filter: HistoryFilter) {
  if (filter === "all") return true;
  if (filter === "done") return status === "done";
  if (filter === "failed") return status === "failed";
  if (filter === "approval") return status === "awaiting_approval";
  return ["queued", "scanning", "planning", "running", "testing", "reviewing", "deploying"].includes(status);
}
