import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowLeft, ArrowRightLeft, Check, Copy, Download, Pencil, Plus, RefreshCw, RotateCcw, Search, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { projectRosterSimulation, requestRosterSimulation, rosterSimulationText } from "@/lib/rosterSimulation";

const button = "h-auto min-h-9 max-w-full whitespace-normal rounded border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800";
const input = "min-h-10 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100";
const states = { draft: "Brouillon", applied: "Appliquee", archived: "Archivee" };
const actions = { create: "Creation", move: "Transfert virtuel", restore: "Retour a l'origine", undo: "Annulation", reset: "Reinitialisation",
  sync: "Synchronisation", add: "Ajout d'un joueur", visibility: "Guildes visibles", rename: "Renommage", archive: "Archivage" };

export default function RosterSimulationWorkspace({ request = requestRosterSimulation }) {
  const [list, setList] = useState([]);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selection, setSelection] = useState(new Set());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [highlight, setHighlight] = useState("");
  const [searchEpoch, setSearchEpoch] = useState(0);
  const current = useRef(null);
  const creationId = useRef(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const view = useMemo(() => data ? projectRosterSimulation(data) : null, [data]);
  const editable = data?.simulation.status === "draft";
  const canUndo = data?.events.some(e => ["move", "restore", "reset", "add"].includes(e.kind) && !e.undone_at);

  const accept = useCallback(next => {
    current.current = next;
    if (mounted.current) {
      setData(next);
      const ids = new Set(next?.entries.map(e => e.memberId));
      setSelection(prev => new Set([...prev].filter(id => ids.has(id))));
    }
  }, []);
  const run = useCallback(async work => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try { await work(); }
    catch (cause) { if (mounted.current) setError(cause.message || "Action impossible."); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }, []);
  const loadList = useCallback(async () => {
    const next = await request("list");
    if (mounted.current) setList(next.simulations);
  }, [request]);
  useEffect(() => {
    mounted.current = true;
    void run(loadList);
    return () => { mounted.current = false; };
  }, [run, loadList]);

  const refresh = useCallback(async () => {
    const previous = current.current;
    if (!previous) { await loadList(); return; }
    const next = await request(previous.simulation.status === "draft" ? "sync" : "detail", { simulationId: previous.simulation.id });
    if (current.current?.simulation.id === previous.simulation.id) {
      accept(next);
      if (mounted.current) setSearchEpoch(value => value + 1);
    }
  }, [accept, loadList, request]);
  useEffect(() => {
    const sync = () => { if (!document.hidden) void run(refresh); };
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    const timer = window.setInterval(sync, 30000);
    return () => { window.removeEventListener("focus", sync); document.removeEventListener("visibilitychange", sync); window.clearInterval(timer); };
  }, [refresh, run]);
  useEffect(() => {
    let active = true;
    if (!query.trim() || !editable) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const next = await request("search", { payload: { query: query.trim() } });
        if (active) setResults(next.results);
      } catch (cause) { if (active) { setResults([]); setError(cause.message); } }
      finally { if (active) setSearching(false); }
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, editable, request, searchEpoch]);

  async function mutate(action, payload = {}) {
    const previous = current.current;
    try {
      const next = await request(action, { simulationId: previous.simulation.id, expectedRevision: previous.simulation.revision, payload });
      accept(next); setDialog(null); return next;
    } catch (cause) {
      if (cause.status === 409) await refresh();
      throw cause;
    }
  }
  async function open(id) {
    await run(async () => {
      const next = await request("sync", { simulationId: id });
      accept(next); setSelection(new Set()); setQuery(""); setHighlight("");
    });
  }
  async function saveName(event) {
    event.preventDefault();
    await run(async () => {
      if (dialog === "create") {
        const next = await request("create", { simulationId: creationId.current, payload: { name: name.trim() } });
        accept(next); setSelection(new Set()); setQuery(""); setDialog(null);
      } else await mutate("rename", { name: name.trim() });
    });
  }
  async function choose(result) {
    if (data.entries.some(e => e.memberId === result.id)) {
      const entry = data.entries.find(e => e.memberId === result.id);
      await run(async () => {
        if (entry.targetGuildId && !current.current.simulation.visible_guilds.includes(entry.targetGuildId)) {
          await mutate("visibility", { guilds: [...current.current.simulation.visible_guilds, entry.targetGuildId] });
        }
        setSelection(new Set([result.id])); setHighlight(result.id); setQuery("");
      });
    } else await run(async () => { await mutate("add", { memberId: result.id }); setQuery(""); setSelection(new Set([result.id])); setHighlight(result.id); });
    window.setTimeout(() => document.getElementById(`simulation-${result.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 0);
  }
  function toggle(id) {
    setSelection(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  async function exportText(copy) {
    await run(async () => {
      const text = rosterSimulationText(data);
      if (copy) { await navigator.clipboard.writeText(text); setNotice("Repartition copiee."); }
      else {
        const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
        const a = document.createElement("a"); a.href = url; a.download = `simulation-${data.simulation.id}.txt`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    });
  }
  function playersTable(players, label) {
    const allSelected = players.length > 0 && players.every(p => selection.has(p.memberId));
    return <table className="w-full table-fixed text-left text-sm" aria-label={label}>
      <thead className="sticky top-0 bg-zinc-950 text-xs text-zinc-400"><tr>
        <th className="w-10 p-2"><input type="checkbox" aria-label={`Selectionner ${label}`} checked={allSelected} disabled={!editable || busy || !players.length}
          onChange={() => setSelection(prev => { const next = new Set(prev); for (const p of players) { if (allSelected) next.delete(p.memberId); else next.add(p.memberId); } return next; })} /></th>
        <th className="px-1 py-2">Joueur / origine</th><th className="w-20 px-1 py-2">Etat</th></tr></thead>
      <tbody className="divide-y divide-zinc-800">{players.map(p => <tr key={p.memberId} id={`simulation-${p.memberId}`}
        className={highlight === p.memberId || selection.has(p.memberId) ? "bg-sky-950/60" : ""}>
        <td className="p-2 align-top"><input type="checkbox" aria-label={`Selectionner ${p.name}`} checked={selection.has(p.memberId)} disabled={!editable || busy} onChange={() => toggle(p.memberId)} /></td>
        <td className="min-w-0 px-1 py-2"><span className="block break-words text-zinc-100">{p.name}</span>
          <span className="block break-words text-xs text-zinc-400">{p.sourceLabel}{p.origin.primary_member_id ? " / compte lie" : ""}</span>
          {p.conflict ? <span className="block break-words text-xs text-amber-300">{p.conflict}</span> : null}</td>
        <td className="px-1 py-2 align-top text-xs">{p.moved ? <span className="text-sky-300">Deplace</span> : <span className="text-zinc-500">Initial</span>}</td>
      </tr>)}</tbody>
    </table>;
  }

  return <section className="min-w-0 space-y-4" aria-label="Simulation des effectifs">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 className="break-words text-xl font-semibold text-zinc-100">{data?.simulation.name || "Simulation des effectifs"}</h2>
        {data ? <p className="mt-1 text-xs text-zinc-400">{states[data.simulation.status]} / Version {data.simulation.revision} / Enregistre le {new Date(data.simulation.updated_at).toLocaleString("fr-FR")}</p> : null}</div>
      <div className="flex flex-wrap gap-2">{data ? <Button type="button" variant="outline" className={button} disabled={busy} onClick={() => run(async () => { await loadList(); accept(null); setQuery(""); setSelection(new Set()); })}><ArrowLeft size={16} /> Simulations</Button> : null}
        <Button type="button" variant="outline" className={button} disabled={busy} onClick={() => run(refresh)} title="Actualiser" aria-label="Actualiser"><RefreshCw size={16} className={busy ? "animate-spin" : ""} /></Button>
        {!data ? <Button type="button" className="bg-emerald-700 text-white hover:bg-emerald-600" disabled={busy} onClick={() => { creationId.current = crypto.randomUUID(); setName(""); setDialog("create"); }}><Plus size={16} /> Nouvelle simulation</Button> : null}</div>
    </div>
    {error ? <p role="alert" className="break-words border-l-2 border-red-500 pl-3 text-sm text-red-200">{error}</p> : null}
    {notice ? <p role="status" className="text-sm text-emerald-300">{notice}</p> : null}
    {!data ? <div className="divide-y divide-zinc-800 border-y border-zinc-800">{list.length ? list.map(s => <button type="button" key={s.id} disabled={busy}
      className="flex w-full flex-wrap items-center justify-between gap-2 py-4 text-left hover:bg-zinc-900" onClick={() => open(s.id)}>
      <span className="min-w-0 break-words font-medium text-zinc-100">{s.name}</span><span className="text-xs text-zinc-400">{states[s.status]} / {s.created_by_name} / {new Date(s.created_at).toLocaleDateString("fr-FR")}</span>
    </button>) : <p className="py-6 text-sm text-zinc-400">{busy ? "Chargement..." : "Aucune simulation."}</p>}</div> : <>
      <div className="flex flex-wrap items-center gap-2 border-y border-zinc-800 py-3">
        <span className="mr-auto text-sm text-zinc-300">{view.entries.length} comptes / {view.movements.length} mouvements / <span className={view.conflicts.length ? "text-amber-300" : ""}>{view.conflicts.length} ecarts</span></span>
        <Button type="button" variant="outline" className={button} disabled={busy} onClick={() => exportText(false)}><Download size={16} /> Exporter la repartition</Button>
        <Button type="button" variant="outline" className={button} disabled={busy} onClick={() => exportText(true)} title="Copier pour Discord" aria-label="Copier pour Discord"><Copy size={16} /></Button>
        {editable ? <><Button type="button" variant="outline" className={button} disabled={busy} title="Renommer" aria-label="Renommer" onClick={() => { setName(data.simulation.name); setDialog("rename"); }}><Pencil size={16} /></Button>
          <Button type="button" variant="outline" className={button} disabled={busy} title="Archiver" aria-label="Archiver" onClick={() => setDialog("archive")}><Archive size={16} /></Button></> : null}
      </div>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-2" disabled={busy || !editable}><legend className="mb-2 text-sm text-zinc-400">Guildes visibles</legend>
        {view.guilds.map(g => <label key={g.id} className="flex items-center gap-2 text-sm text-zinc-200"><input type="checkbox" checked={data.simulation.visible_guilds.includes(g.id)}
          onChange={() => run(() => mutate("visibility", { guilds: data.simulation.visible_guilds.includes(g.id) ? data.simulation.visible_guilds.filter(id => id !== g.id) : [...data.simulation.visible_guilds, g.id] }))} />{g.code}</label>)}
      </fieldset>
      {editable ? <div className="relative max-w-xl">
        <label htmlFor="simulation-player-search" className="mb-2 block text-sm text-zinc-200">Ajouter un joueur a la simulation</label>
        <div className="relative"><Search size={16} className="pointer-events-none absolute left-3 top-3 text-zinc-500" />
          <input id="simulation-player-search" className={`${input} pl-9`} value={query} autoComplete="off" role="combobox" aria-expanded={Boolean(query.trim())} aria-controls="simulation-search-results"
            disabled={busy} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setQuery(""); if (e.key === "ArrowDown") { e.preventDefault(); document.querySelector("#simulation-search-results button")?.focus(); } }} /></div>
        {query.trim() ? <div id="simulation-search-results" role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded border border-zinc-700 bg-zinc-950 shadow-lg">
          {searching ? <p className="p-3 text-sm text-zinc-400">Recherche...</p> : results.length ? results.map(r => <button type="button" role="option" aria-selected={selection.has(r.id)} key={r.id} disabled={busy}
            className="block w-full break-words px-3 py-3 text-left text-sm text-zinc-100 hover:bg-zinc-800 focus:bg-zinc-800" onClick={() => choose(r)}>
            {r.name} / {r.community ? "Communautaire" : `${view.guilds.find(g => g.id === r.guild_id)?.name || r.guild_code} (${r.guild_code})`}{data.entries.some(e => e.memberId === r.id) ? " / Deja present" : ""}
          </button>) : <p className="p-3 text-sm text-zinc-400">Aucun joueur.</p>}
        </div> : null}
      </div> : null}
      {editable ? <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-y border-zinc-700 bg-zinc-950 py-3">
        <span className="mr-2 text-sm text-zinc-200">{selection.size} selectionne(s)</span>
        <Button type="button" className="h-auto min-h-9 whitespace-normal bg-emerald-700 text-white hover:bg-emerald-600" disabled={busy || !selection.size} onClick={() => { setDestination(""); setDialog("move"); }}><ArrowRightLeft size={16} /> Transferer la selection</Button>
        <Button type="button" variant="outline" className={button} disabled={busy || !selection.size} title="Annuler les transferts selectionnes" aria-label="Annuler les transferts selectionnes" onClick={() => run(() => mutate("restore", { members: [...selection] }))}><RotateCcw size={16} /></Button>
        <Button type="button" variant="outline" className={button} disabled={busy || !canUndo} title="Annuler la derniere operation" aria-label="Annuler la derniere operation" onClick={() => run(() => mutate("undo"))}><Undo2 size={16} /></Button>
        <Button type="button" variant="outline" className={button} disabled={busy || !selection.size} title="Deselectionner" aria-label="Deselectionner" onClick={() => setSelection(new Set())}><X size={16} /></Button>
        <Button type="button" variant="outline" className={`${button} ml-auto`} disabled={busy} onClick={() => setDialog("reset")}>Reinitialiser le scenario</Button>
      </div> : null}
      {view.overCapacity.length ? <p role="alert" className="text-sm text-red-300">Capacite depassee : {view.overCapacity.map(g => `${g.code} (${g.count}/${g.capacity})`).join(", ")}</p> : null}
      <div className="grid min-w-0 gap-x-6 gap-y-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}>
        {view.guilds.filter(g => data.simulation.visible_guilds.includes(g.id)).map(g => <section key={g.id} className="min-w-0" aria-label={`Effectif ${g.code}`}>
          <div className="mb-2 flex flex-wrap items-start justify-between gap-2 border-t-2 border-zinc-700 pt-3">
            <h3 className="min-w-0 break-words text-sm font-semibold text-zinc-100">{g.code} / {g.name}{!g.active ? " / Inactive" : ""}</h3>
            <span className={`shrink-0 text-sm font-semibold ${g.remaining < 0 ? "text-red-300" : g.remaining === 0 ? "text-amber-300" : "text-emerald-300"}`}>{g.count}/{g.capacity}</span>
          </div><p className="mb-2 text-xs text-zinc-400">{g.remaining} places / +{g.arrivals} / -{g.departures}</p>
          <div className="max-h-[60dvh] overflow-y-auto">{playersTable(g.players, g.code)}</div>
        </section>)}
      </div>
      <section className="min-w-0 border-t border-zinc-700 pt-4" aria-label="Joueurs externes / a integrer"><h3 className="mb-3 font-semibold text-zinc-100">Joueurs externes / a integrer ({view.external.length})</h3>{playersTable(view.external, "Joueurs externes")}</section>
      <details className="border-t border-zinc-800 py-3 text-sm text-zinc-400"><summary>Recapitulatif des mouvements ({view.movements.length})</summary>
        <ul className="mt-3 space-y-1">{view.movements.map(p => <li className="break-words" key={p.memberId}>{p.name} : {p.sourceLabel} &rarr; {p.targetLabel}</li>)}</ul></details>
      <details className="border-t border-zinc-800 py-3 text-sm text-zinc-400"><summary>Historique ({data.events.length})</summary>
        <ul className="mt-3 space-y-1">{data.events.map(e => <li key={e.id} className="break-words">V{e.revision} / {e.actor_name} / {actions[e.kind] || e.kind}{e.undone_at ? " / annule" : ""} / {new Date(e.created_at).toLocaleString("fr-FR")}</li>)}</ul></details>
    </>}
    <Dialog open={Boolean(dialog)} onOpenChange={open => { if (!open && !busy) setDialog(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto rounded-lg border-zinc-700 bg-zinc-950 text-zinc-100">
      <DialogHeader><DialogTitle>{dialog === "create" ? "Nouvelle simulation" : dialog === "rename" ? "Renommer la simulation" : dialog === "move" ? `Transferer ${selection.size} compte(s)` : dialog === "archive" ? "Archiver la simulation" : "Reinitialiser le scenario"}</DialogTitle>
        <DialogDescription>{dialog === "reset" ? "Annuler tous les deplacements virtuels ? Les joueurs ajoutes restent presents. Aucun effectif reel ne sera modifie."
          : dialog === "archive" ? "La simulation deviendra accessible en lecture seule. Aucun effectif reel ne sera modifie." : "Simulation uniquement. Aucun transfert reel."}</DialogDescription></DialogHeader>
      {error ? <p role="alert" className="break-words text-sm text-red-200">{error}</p> : null}
      {dialog === "create" || dialog === "rename" ? <form onSubmit={saveName} className="space-y-4"><label className="block text-sm">Nom<input autoFocus required maxLength={160} className={`${input} mt-2`} value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label>
        <Button type="submit" disabled={busy || !name.trim()}><Check size={16} /> Enregistrer</Button></form> : dialog === "move" ? <form className="space-y-4" onSubmit={e => { e.preventDefault(); void run(() => mutate("move", { members: [...selection], destination: destination || null })); }}>
        <label className="block text-sm">Destination<select aria-label="Destination" autoFocus value={destination} className={`${input} mt-2`} disabled={busy} onChange={e => setDestination(e.target.value)}><option value="">Joueurs externes / a integrer</option>
          {view?.guilds.filter(g => g.active).map(g => <option key={g.id} value={g.id}>{g.code} / {g.name} ({g.remaining} places)</option>)}</select></label>
        <Button type="submit" disabled={busy}><ArrowRightLeft size={16} /> Confirmer le transfert virtuel</Button></form> : <Button type="button" disabled={busy} onClick={() => run(() => mutate(dialog, { confirmed: true }))}><Check size={16} /> Confirmer</Button>}
    </DialogContent></Dialog>
  </section>;
}
