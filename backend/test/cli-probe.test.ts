import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { probeCli } from "../src/services/cliProbe.js";

describe("cliProbe", () => {
  it("finds git on PATH", async () => {
    const r = await probeCli("git", ["--version"]);
    assert.equal(r.installed, true);
    assert.ok(r.version || r.error === undefined || r.installed);
  });

  it("reports missing binary as not installed", async () => {
    const r = await probeCli("devcommand-nonexistent-cli-xyz", ["--version"]);
    assert.equal(r.installed, false);
  });
});
