import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets } from "../src/services/secretRedact.js";

describe("redactSecrets", () => {
  it("redacts github and openai tokens", () => {
    const out = redactSecrets("tok ghp_abcdefghijklmnopqrstuvwx openai sk-abcdefghijklmnopqrstuvwxyz1234");
    assert.match(out, /REDACTED_GITHUB_TOKEN/);
    assert.match(out, /REDACTED_OPENAI_KEY/);
    assert.doesNotMatch(out, /ghp_abcdefgh/);
  });

  it("redacts bearer headers", () => {
    const out = redactSecrets("Authorization: Bearer super-secret-token-value");
    assert.match(out, /\[REDACTED\]/);
  });
});
