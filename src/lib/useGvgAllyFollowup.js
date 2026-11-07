import { useCallback, useEffect, useRef, useState } from "react";

export function useGvgAllyFollowup({ guild, apiBase, canEdit, refreshKey }) {
  const [stored, setStored] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
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
  return { data, error, busy, save, load, previewOpen, setPreviewOpen, canEdit };
}
