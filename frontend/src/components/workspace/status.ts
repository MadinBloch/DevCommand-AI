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