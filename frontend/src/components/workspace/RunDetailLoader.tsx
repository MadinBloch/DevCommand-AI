import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, MessageSquare } from "lucide-react";
import { api, type FeatureRunDetail } from "../../api";
import { Button } from "../ui";
import { RunDetail } from "./RunDetailTab";

export function RunDetailView({
  runId,
  onBack,
  onOpenChat,
}: {
  runId: string;
  onBack: () => void;
  onOpenChat?: () => void;
}) {
  const [run, setRun] = useState<FeatureRunDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    try {
      const r = await api.run(runId);
      setRun(r);
    } catch (e: any) {
      setError(e.message || "Failed to load run");
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [runId]);

  if (!run) {
    return (
      <div className="surface rise" style={{ display: "grid", placeItems: "center", minHeight: 200 }}>
        {error ? <div className="banner bad">{error}</div> : <Loader2 className="spin" size={22} />}
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row" style={{ gap: 8 }}>
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft size={15} /> Back
        </Button>
        {onOpenChat && (
          <Button variant="outline" size="sm" onClick={onOpenChat}>
            <MessageSquare size={15} /> Open in chat
          </Button>
        )}
      </div>
      {error && <div className="banner bad">{error}</div>}
      <RunDetail run={run} busy={busy} setBusy={setBusy} setError={setError} onUpdate={setRun} />
    </div>
  );
}
