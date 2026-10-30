import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listAgentsDetailed, executionCapability } from "../src/agents/registry.js";

describe("agent connection honesty", () => {
  it("never marks simulated as a connected coding CLI", async () => {
    const prev = process.env.AGENT_MODE;
    process.env.AGENT_MODE = "simulate";
    try {
      const agents = await listAgentsDetailed();
      const sim = agents.find((a) => a.name === "simulated");
      assert.ok(sim);
      assert.equal(sim!.connected, false);
      assert.match(String(sim!.reason), /demo|simulate/i);
    } finally {
      if (prev === undefined) delete process.env.AGENT_MODE;
      else process.env.AGENT_MODE = prev;
    }
  });

  it("reports llm separately from codex CLI", async () => {
    const agents = await listAgentsDetailed();
    const codex = agents.find((a) => a.name === "codex");
    const llm = agents.find((a) => a.name === "llm");
    assert.ok(codex);
    assert.ok(llm);
    assert.notEqual(codex!.displayName, llm!.displayName);
  });

  it("exposes dockerWorker flag in capability", () => {
    const prev = process.env.DOCKER_WORKER;
    process.env.DOCKER_WORKER = "1";
    try {
      assert.equal(executionCapability().dockerWorker, true);
    } finally {
      if (prev === undefined) delete process.env.DOCKER_WORKER;
      else process.env.DOCKER_WORKER = prev;
    }
  });
});
