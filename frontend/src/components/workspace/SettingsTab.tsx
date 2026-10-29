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
  const [masked, setMasked] = useState<string | null>(null);
  const [serverHas, setServerHas] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");
  const [show, setShow] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const s = await api.settings();
      setHasOpenAiKey(s.hasOpenAiKey);
      setMasked(s.openaiApiKeyMasked);
      setServerHas(s.serverHasOpenAiKey);
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
      const r = await api.saveSettings({ openaiApiKey: openaiKey.trim() });
      setHasOpenAiKey(r.hasOpenAiKey);
      setMasked(r.openaiApiKeyMasked);
      setOpenaiKey("");
      setOk("OpenAI key saved. It will be used for planning and coding commits.");
      onSaved?.();
    } catch (err: any) {
      setError(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function clearKey() {
    setSaving(true);
    setError("");
    setOk("");
    try {
      const r = await api.saveSettings({ clearOpenAiKey: true });
      setHasOpenAiKey(r.hasOpenAiKey);
      setMasked(r.openaiApiKeyMasked);
      setOk("OpenAI key removed from your account.");
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
          API keys
        </p>
        <h3>OpenAI key</h3>
        <p className="hint">
          Stored encrypted on the server for your GitHub account only. Never shown in full again after save. Used for
          smarter plans and the built-in LLM coder that commits to your feature branch.
        </p>

        {hasOpenAiKey ? (
          <div className="banner ok" style={{ marginTop: 14 }}>
            <CheckCircle2 size={15} style={{ verticalAlign: -2, marginRight: 6 }} />
            Key on file: <b>{masked}</b>
          </div>
        ) : (
          <div className="banner mute" style={{ marginTop: 14 }}>
            No personal OpenAI key yet.
            {serverHas ? " Server env key may still be used as fallback." : " Add a key to enable LLM coding."}
          </div>
        )}

        {error && <div className="banner bad">{error}</div>}
        {ok && <div className="banner ok">{ok}</div>}

        <form className="form" onSubmit={save} style={{ marginTop: 8 }}>
          <label htmlFor="openai-key">New OpenAI API key</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Input
              id="openai-key"
              type={show ? "text" : "password"}
              autoComplete="off"
              placeholder="sk-…"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              minLength={20}
              required
            />
            <Button type="button" variant="outline" size="icon" aria-label={show ? "Hide" : "Show"} onClick={() => setShow((v) => !v)}>
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </Button>
          </div>
          <p className="hint">Create a key at platform.openai.com — never commit it to git.</p>
          <div className="row" style={{ marginTop: 12 }}>
            <Button type="submit" disabled={saving || openaiKey.trim().length < 20}>
              {saving ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
              Save key
            </Button>
            {hasOpenAiKey && (
              <Button type="button" variant="outline" disabled={saving} onClick={clearKey}>
                <Trash2 size={16} /> Remove key
              </Button>
            )}
          </div>
        </form>
      </section>

      <section className="surface">
        <p className="eyebrow">Privacy</p>
        <h3>How keys are handled</h3>
        <ul className="connection-steps">
          <li>Encrypted at rest with the server session secret (AES-256-GCM).</li>
          <li>Only your user record stores the ciphertext — other accounts cannot read it.</li>
          <li>API responses return a masked preview only (never the full key).</li>
        </ul>
      </section>
    </div>
  );
}
