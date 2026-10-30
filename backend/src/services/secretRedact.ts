const PATTERNS: Array<[RegExp, string]> = [
  [/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]"],
  [/\bghp_[A-Za-z0-9]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]"],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_OPENAI_KEY]"],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_ANTHROPIC_KEY]"],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED_GOOGLE_KEY]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED_TOKEN]"],
  [/(Authorization:\s*Bearer\s+)[^\s]+/gi, "$1[REDACTED]"],
  [/(token[=:\s]+)[A-Za-z0-9._-]{16,}/gi, "$1[REDACTED]"],
];

export function redactSecrets(input: string | null | undefined): string {
  let out = String(input || "");
  for (const [re, replacement] of PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}
