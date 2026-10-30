import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Trash2 } from "lucide-react";
import { Button, Input } from "../ui";
import { api } from "../../api";

export function SettingsView({ onSaved }: { onSaved?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [hasOpenAiKey, setHasOpenAiKey] = useState(false);
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false);
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [maskedOpenAi, setMaskedOpenAi] = useState<string | null>(null);
  const [maskedAnthropic, setMaskedAnthropic] = useState<string | null>(null);
  const [maskedGemini, setMaskedGemini] = useState<string | null>(null);
  const [serverHas, setServerHas] = useState(false);
  const [dockerWorker, setDockerWorker] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [show, setShow] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const s = await api.settings();
      setHasOpenAiKey(s.hasOpenAiKey);
      setHasAnthropicKey(s.hasAnthropicKey);
      setHasGeminiKey(s.hasGeminiKey);
      setMaskedOpenAi(s.openaiApiKeyMasked);
      setMaskedAnthropic(s.anthropicApiKeyMasked);
      setMaskedGemini(s.geminiApiKeyMasked);
      setServerHas(s.serverHasOpenAiKey);
      setDockerWorker(Boolean(s.dockerWorker));
    } catch (e: any) {
      setError(e.message || "Could not load settings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setOk("");
    try {
      const body: Record<string, string> = {};
      if (openaiKey.trim()) body.openaiApiKey = openaiKey.trim();
      if (anthropicKey.trim()) body.anthropicApiKey = anthropicKey.trim();
      if (geminiKey.trim()) body.geminiApiKey = geminiKey.trim();
      if (!Object.keys(body).length) {
        setError("Enter at least one key to save");
        return;
      }
      const r = await api.saveSettings(body);
      setHasOpenAiKey(r.hasOpenAiKey);
      setHasAnthropicKey(r.hasAnthropicKey);
      setHasGeminiKey(r.hasGeminiKey);
      setMaskedOpenAi(r.openaiApiKeyMasked);
      setMaskedAnthropic(r.anthropicApiKeyMasked);
      setMaskedGemini(r.geminiApiKeyMasked);
      setOpenaiKey("");
      setAnthropicKey("");
      setGeminiKey("");
      setOk("Keys saved (encrypted). CLI agents still require their binaries on the worker.");
      onSaved?.();
    } catch (err: any) {
      setError(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function clearKey(which: "openai" | "anthropic" | "gemini") {
    setSaving(true);
    setError("");
    setOk("");
    try {
      const r = await api.saveSettings(
        which === "openai"
          ? { clearOpenAiKey: true }
          : which === "anthropic"
            ? { clearAnthropicKey: true }
            : { clearGeminiKey: true }
      );
      setHasOpenAiKey(r.hasOpenAiKey);
      setHasAnthropicKey(r.hasAnthropicKey);
      setHasGeminiKey(r.hasGeminiKey);
      setMaskedOpenAi(r.openaiApiKeyMasked);
      setMaskedAnthropic(r.anthropicApiKeyMasked);
      setMaskedGemini(r.geminiApiKeyMasked);
      setOk("Key removed.");
      onSaved?.();
    } catch (err: any) {
      setError(err.message || "Could not clear key");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="surface rise" style={{ display: "grid", placeItems: "center", minHeight: 180 }}>
        <Loader2 className="spin" size={22} />
      </div>
    );
  }

  return (
    <div className="stack rise">
      <section className="surface">
        <p className="eyebrow">
          <KeyRound size={12} style={{ display: "inline", verticalAlign: -1, marginRight: 6 }} />
          Provider credentials
        </p>
        <h3>API keys &amp; worker settings</h3>
        <p className="hint">
          Keys are encrypted at rest. They do not automatically connect coding CLIs — install{" "}
          <code>codex</code>, <code>claude</code>, <code>gemini</code>, or <code>agy</code> on the worker host.
          Isolation: <b>{dockerWorker ? "Docker containers" : "git worktrees (default)"}</b>
          {dockerWorker ? "" : " — set DOCKER_WORKER=1 for containers"}.
        </p>

        <div className="key-status-grid">
          <div className={`banner ${hasOpenAiKey ? "ok" : "mute"}`}>
            OpenAI {hasOpenAiKey ? <b>{maskedOpenAi}</b> : "not set"}
            {serverHas && !hasOpenAiKey ? " (server env fallback)" : ""}
          </div>
          <div className={`banner ${hasAnthropicKey ? "ok" : "mute"}`}>
            Anthropic {hasAnthropicKey ? <b>{maskedAnthropic}</b> : "not set"}
          </div>
          <div className={`banner ${hasGeminiKey ? "ok" : "mute"}`}>
            Gemini {hasGeminiKey ? <b>{maskedGemini}</b> : "not set"}
          </div>
        </div>

        {error && <div className="banner bad">{error}</div>}
        {ok && (
          <div className="banner ok">
            <CheckCircle2 size={15} style={{ verticalAlign: -2, marginRight: 6 }} />
            {ok}
          </div>
        )}

        <form className="form" onSubmit={save} style={{ marginTop: 8 }}>
          <label htmlFor="openai-key">OpenAI API key</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Input
              id="openai-key"
              type={show ? "text" : "password"}
              autoComplete="off"
              placeholder="sk-…"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
            />
            <Button type="button" variant="outline" size="icon" aria-label={show ? "Hide" : "Show"} onClick={() => setShow((v) => !v)}>
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </Button>
            {hasOpenAiKey && (
              <Button type="button" variant="outline" disabled={saving} onClick={() => clearKey("openai")}>
                <Trash2 size={16} />
              </Button>
            )}
          </div>

          <label htmlFor="anthropic-key">Anthropic API key</label>
          <Input
            id="anthropic-key"
            type={show ? "text" : "password"}
            autoComplete="off"
            placeholder="sk-ant-…"
            value={anthropicKey}
            onChange={(e) => setAnthropicKey(e.target.value)}
          />
          {hasAnthropicKey && (
            <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => clearKey("anthropic")}>
              <Trash2 size={16} /> Remove Anthropic key
            </Button>
          )}

          <label htmlFor="gemini-key">Gemini API key</label>
          <Input
            id="gemini-key"
            type={show ? "text" : "password"}
            autoComplete="off"
            placeholder="AIza…"
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
          />
          {hasGeminiKey && (
            <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => clearKey("gemini")}>
              <Trash2 size={16} /> Remove Gemini key
            </Button>
          )}

          <div className="row" style={{ marginTop: 12 }}>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
              Save keys
            </Button>
          </div>
        </form>
      </section>

      <section className="surface">
        <p className="eyebrow">Privacy</p>
        <h3>How keys are handled</h3>
        <ul className="connection-steps">
          <li>Encrypted at rest (AES-256-GCM) with SESSION_SECRET or SECRETS_KEY.</li>
          <li>GitHub OAuth tokens are encrypted for worker recovery and never sent to agent CLIs.</li>
          <li>API responses return masked previews only.</li>
        </ul>
      </section>
    </div>
  );
}
