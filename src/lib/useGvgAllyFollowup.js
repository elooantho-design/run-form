import { useCallback, useEffect, useRef, useState } from "react";

export function useGvgAllyFollowup({ guild, apiBase, canEdit, refreshKey }) {
  const [stored, setStored] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sendReport, setSendReport] = useState(null);
  const activeGuild = useRef(guild);
  const inFlight = useRef(false);
  const generation = useRef(0);
  activeGuild.current = guild;
  const invalidate = useCallback(() => { generation.current++; }, []);
  const load = useCallback(async (preview = false) => {
    if (!canEdit) return;
    const sequence = ++generation.current;
    try {
      const endpoint = preview ? "" : `?guild=${encodeURIComponent(guild)}`;
      const response = await fetch(`${apiBase}/api/gvg-ally-followup${endpoint}`, {
        method: preview ? "POST" : "GET", credentials: "include",
        ...(preview ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guild, action: "preview" }) } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Chargement des retours allies impossible.");
      if (activeGuild.current === guild && sequence === generation.current) {
        setStored({ guild, data: result });
        setError("");
      }
    } catch (failure) {
      if (activeGuild.current === guild && sequence === generation.current) {
        setStored(null);
        setError(failure.message);
      }
    }
  }, [apiBase, guild, canEdit]);
  useEffect(() => {
    setPreviewOpen(false);
    setSendReport(null);
    if (canEdit) void load();
    return invalidate;
  }, [load, refreshKey, canEdit, invalidate]);
  const data = stored?.guild === guild ? stored.data : null;
  const save = async (defenseId, action, value) => {
    if (!data || inFlight.current || !canEdit) return;
    const row = data.preview.rows.find(item => item.defense_id === defenseId);
    if (!row) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch(`${apiBase}/api/gvg-ally-followup`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guild, defense_id: defenseId, action, ...value,
          revision: Number(row.state.revision || 0), roster_version: data.roster_version }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Modification impossible.");
      if (activeGuild.current === guild) { setStored({ guild, data: result }); setError(""); }
      if (previewOpen) await load(true);
    } catch (failure) {
      await load(previewOpen);
      if (activeGuild.current === guild) setError(failure.message);
    } finally { inFlight.current = false; setBusy(false); }
  };
  const sendReady = async () => {
    if (!data?.delivery_enabled || !data.snapshot_version || inFlight.current || !canEdit) return null;
    const targets = data.preview.rows.filter(row => row.sendable);
    const report = { sent: 0, failed: 0, uncertain: 0, already: 0, errors: [] };
    inFlight.current = true;
    setBusy(true);
    setSendReport(null);
    let currentLabel = "";
    try {
      for (const row of targets) {
        if (activeGuild.current !== guild) break;
        currentLabel = `${row.owner?.watcher_name || "Joueur non identifie"} - ${row.label}`;
        const response = await fetch(`${apiBase}/api/gvg-ally-followup`, {
          method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guild, action: "send", confirm: true, defense_id: row.defense_id,
            snapshot_version: data.snapshot_version, message_version: row.message_version }),
        });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || "Envoi interrompu. Actualisez les retours avant de reprendre.");
        const delivery = result.delivery_result;
        if (delivery?.attempted === false) report.already++;
        else if (delivery?.status === "sent") report.sent++;
        else if (delivery?.status === "failed") report.failed++;
        else report.uncertain++;
        if (delivery?.error) report.errors.push(`${row.owner?.watcher_name || row.label} : ${delivery.error}`);
        if (activeGuild.current === guild) { setStored({ guild, data: result }); setSendReport({ ...report }); }
      }
    } catch (failure) {
      report.errors.push(`${currentLabel} : ${failure.message}`);
      await load(true);
      if (activeGuild.current === guild) setError(failure.message);
    } finally {
      inFlight.current = false;
      if (activeGuild.current === guild) { setSendReport({ ...report }); setBusy(false); }
    }
    return report;
  };
  return { data, error, busy, save, load, previewOpen, setPreviewOpen, canEdit, sendReady, sendReport };
}
