import test from "node:test";
import assert from "node:assert/strict";
import { checkBranchDiff, hasReviewableChanges } from "../src/services/deploy.js";

test("PR gating requires both new commits and actual changed files", () => {
  assert.equal(hasReviewableChanges({ aheadBy: 0, changedFiles: 0, headSha: "abc" }), false);
  assert.equal(hasReviewableChanges({ aheadBy: 2, changedFiles: 0, headSha: "abc" }), false);
  assert.equal(hasReviewableChanges({ aheadBy: 2, changedFiles: 1, headSha: "" }), false);
  assert.equal(hasReviewableChanges({ aheadBy: 2, changedFiles: 1, headSha: "abc" }), true);
});

test("GitHub compare API checks the actual devcommand feature branch without paid services", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({
      ahead_by: 0,
      files: [],
      commits: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const diff = await checkBranchDiff("fixture-only-token", "example/repository", "main", "devcommand/cmvqkh74");
  assert.deepEqual(diff, { aheadBy: 0, changedFiles: 0, headSha: "" });
  assert.equal(hasReviewableChanges(diff), false);
  assert.match(calls[0], /compare\/main\.\.\.devcommand%2Fcmvqkh74/);
});

test("GitHub compare API recognizes a branch with a genuine file diff", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    ahead_by: 1,
    files: [{ filename: "src/fix.ts" }],
    commits: [{ sha: "new-commit" }],
  }), { status: 200 }));
  const diff = await checkBranchDiff("fixture-only-token", "example/repository", "main", "feature/fix");
  assert.equal(hasReviewableChanges(diff), true);
});
