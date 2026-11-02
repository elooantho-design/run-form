const compare = (a, b) => String(a).localeCompare(String(b), "fr", { numeric: true, sensitivity: "base" });

export function projectRosterSimulation(data) {
  const active = new Map((data.activeGuilds || []).map(g => [g.id, g]));
  const guilds = new Map((data.simulation.guilds || []).map(g => [g.id, { ...g, ...(active.get(g.id) || {}), active: active.has(g.id) }]));
  for (const g of active.values()) if (!guilds.has(g.id)) guilds.set(g.id, { ...g, active: true });
  const entries = (data.entries || []).map(e => ({ ...e, name: e.current?.name || e.origin.name,
    moved: e.targetGuildId !== e.initialGuildId,
    sourceLabel: guilds.get(e.initialGuildId)?.code || "Communautaire",
    targetLabel: guilds.get(e.targetGuildId)?.code || "A integrer" })).sort((a, b) => compare(a.name, b.name));
  const ids = new Set();
  for (const e of entries) { if (ids.has(e.memberId)) throw Error("Compte duplique dans la simulation."); ids.add(e.memberId); }
  const rows = [...guilds.values()].map(g => {
    const players = entries.filter(e => e.targetGuildId === g.id);
    return { ...g, players, count: players.length, remaining: g.capacity - players.length,
      departures: entries.filter(e => e.initialGuildId === g.id && e.moved).length,
      arrivals: players.filter(e => e.moved).length };
  }).sort((a, b) => compare(a.code, b.code));
  return { guilds: rows, entries, external: entries.filter(e => !e.targetGuildId), movements: entries.filter(e => e.moved),
    conflicts: entries.filter(e => e.conflict), overCapacity: rows.filter(g => g.remaining < 0) };
}

export function rosterSimulationText(data) {
  const view = projectRosterSimulation(data);
  const lines = [`${data.simulation.status === "applied" ? "REPARTITION APPLIQUEE" : "SIMULATION - NON APPLIQUEE"} : ${data.simulation.name}`, ""];
  for (const g of view.guilds) lines.push(`${g.code} - ${g.name} : ${g.count}/${g.capacity} (${g.remaining} places restantes)`,
    ...g.players.map(p => `- ${p.name}`), "");
  lines.push("MOUVEMENTS PREVUS", ...view.movements.map(p => `- ${p.name} : ${p.sourceLabel} -> ${p.targetLabel}`), "", "JOUEURS A INTEGRER", ...view.external.map(p => `- ${p.name}`));
  if (view.conflicts.length) lines.push("", "ECARTS A VERIFIER", ...view.conflicts.map(p => `- ${p.name} : ${p.conflict}`));
  return lines.join("\n");
}

export async function requestRosterSimulation(action, { simulationId, expectedRevision, payload = {} } = {}) {
  const read = ["list", "detail", "search"].includes(action);
  const base = (import.meta.env?.VITE_API_BASE_URL || "").replace(/\/$/, "");
  const query = new URLSearchParams({ action, ...(simulationId ? { simulationId } : {}), ...(action === "search" ? { query: payload.query || "" } : {}) });
  const response = await fetch(`${base}/api/portal-roster-simulations${read ? `?${query}` : ""}`, { method: read ? "GET" : "POST", credentials: "include", cache: "no-store",
    ...(read ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, simulationId, expectedRevision, payload }) }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok !== true) { const e = new Error(data.error || "Simulation indisponible."); e.status = response.status; throw e; }
  return data;
}
