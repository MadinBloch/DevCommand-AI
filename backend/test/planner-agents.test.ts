import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFeaturePlan } from "../src/services/planner.js";
import type { RepoScan } from "../src/services/scanner.js";

const scan: RepoScan = {
  fullName: "acme/app",
  defaultBranch: "main",
  description: null,
  language: "TypeScript",
  stack: ["node", "typescript", "react"],
  packageManager: "npm",
  testCommand: "npm test",
  buildCommand: "npm run build",
  hasCi: true,
  frameworks: ["react"],
  topFiles: ["package.json", "src/App.tsx"],
  relevantFiles: ["src/App.tsx", "backend/src/server.ts"],
  readmeExcerpt: null,
  summary: "Node + React app",
};

describe("heuristic planner agents", () => {
  it("assigns multi-agent roles for auth feature", async () => {
    const plan = await createFeaturePlan(
      "Build a complete authentication module with frontend login pages and backend APIs",
      scan
    );
    const agents = plan.map((p) => p.agent);
    assert.ok(agents.includes("codex"));
    assert.ok(agents.includes("gemini") || agents.includes("antigravity"));
    assert.ok(agents.includes("claude") || agents.includes("testing"));
    assert.ok(agents.includes("human"));
    assert.ok(agents.includes("testing"));
  });

  it("allows parallel backend/frontend deps on scan step", async () => {
    const plan = await createFeaturePlan(
      "Build fullstack auth with API endpoints and login UI pages",
      scan
    );
    const backend = plan.find((p) => /backend/i.test(p.title));
    const frontend = plan.find((p) => /frontend|UI/i.test(p.title));
    assert.ok(backend);
    assert.ok(frontend);
    assert.deepEqual(backend!.dependsOnOrders, [0]);
    assert.deepEqual(frontend!.dependsOnOrders, [0]);
  });
});
