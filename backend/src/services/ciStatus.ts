import { gh } from "../github.js";

export type CiStatus = {
  state: "success" | "pending" | "failure" | "error" | "unknown";
  statuses: Array<{ context: string; state: string; description?: string; targetUrl?: string }>;
  checkRuns: Array<{ name: string; status: string; conclusion: string | null }>;
  summary: string;
};

export async function getPrCiStatus(token: string, fullName: string, ref: string): Promise<CiStatus> {
  try {
    const combined = (await gh(
      `/repos/${fullName}/commits/${encodeURIComponent(ref)}/status`,
      token
    )) as {
      state?: string;
      statuses?: Array<{ context: string; state: string; description?: string; target_url?: string }>;
    };

    let checkRuns: CiStatus["checkRuns"] = [];
    try {
      const checks = (await gh(
        `/repos/${fullName}/commits/${encodeURIComponent(ref)}/check-runs`,
        token
      )) as {
        check_runs?: Array<{ name: string; status: string; conclusion: string | null }>;
      };
      checkRuns = (checks.check_runs || []).map((c) => ({
        name: c.name,
        status: c.status,
        conclusion: c.conclusion,
      }));
    } catch {
      /* checks API may be unavailable */
    }

    const state = (combined.state || "unknown") as CiStatus["state"];
    const failingChecks = checkRuns.filter((c) => c.conclusion === "failure" || c.conclusion === "timed_out");
    const pendingChecks = checkRuns.filter((c) => c.status !== "completed");

    let effective: CiStatus["state"] = state;
    if (failingChecks.length) effective = "failure";
    else if (pendingChecks.length && state === "success") effective = "pending";

    return {
      state: effective,
      statuses: (combined.statuses || []).map((s) => ({
        context: s.context,
        state: s.state,
        description: s.description,
        targetUrl: s.target_url,
      })),
      checkRuns,
      summary:
        effective === "success"
          ? "CI green"
          : effective === "pending"
            ? "CI pending"
            : effective === "failure"
              ? "CI failing"
              : "CI status unknown",
    };
  } catch (e: any) {
    return {
      state: "unknown",
      statuses: [],
      checkRuns: [],
      summary: `CI lookup failed: ${e?.message || e}`,
    };
  }
}
