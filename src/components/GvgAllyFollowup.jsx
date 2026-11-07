import React, { useEffect, useRef, useState } from "react";
import { ClipboardCheck, RefreshCw, X } from "lucide-react";
import { normalizeAllyAssignment } from "@/lib/gvgAllyFollowup";

function Modal({ title, onClose, children }) {
  const closeRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = closeRef.current?.closest('[role="dialog"]');
    closeRef.current?.focus();
    const keydown = event => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialog) return;
      const targets = [...dialog.querySelectorAll('button:not(:disabled), select:not(:disabled), input:not(:disabled), a[href]')];
      const first = targets[0], last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus?.(); };
  }, [onClose]);
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-3" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label={title} className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-md border border-zinc-700 bg-zinc-950 p-4 text-zinc-100 shadow-xl">
      <header className="mb-4 flex items-center justify-between gap-3"><h2 className="text-base font-semibold">{title}</h2>
        <button type="button" ref={closeRef} onClick={onClose} aria-label="Fermer" title="Fermer" className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-zinc-700"><X size={17}/></button>
      </header>{children}
    </section>
  </div>;
}

export function GvgAllyFollowupRow({ defense, controller }) {
  const [choice, setChoice] = useState("");
  const { data, busy, save } = controller;
  const row = data?.preview.rows.find(item => item.defense_id === defense.id);
  const group = data?.ally_groups.find(item => item.ids.includes(defense.id));
  const selected = data?.members.find(member => member.id === choice);
  if (!row) return null;
  return <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-xs" data-ally-followup={defense.id}>
    {group ? <span title="Defenses alliees identiques" className="flex h-5 min-w-5 items-center justify-center rounded-full border border-pink-300/70 bg-pink-500/20 px-1 font-bold text-pink-100">{group.num}</span> : null}
    <label className="inline-flex shrink-0 items-center gap-1.5"><input type="checkbox" checked={row.opened} disabled={busy}
      onChange={event => void save(defense.id, "opened", { opened: event.target.checked })} aria-label={`Ouverte - ${row.label}`} className="accent-rose-500"/>Ouverte</label>
    <select value={row.owner?.id || ""} disabled={busy} aria-label={`Joueur - ${row.label}`} title={row.owner_confirmed ? "Joueur confirme" : "Affectation a verifier"}
      onChange={event => setChoice(event.target.value)} className={`h-8 min-w-0 max-w-full flex-1 rounded border bg-zinc-900 px-2 sm:max-w-44 ${row.owner_confirmed ? "border-emerald-700" : "border-amber-600"}`}>
      <option value="" disabled>Non identifie</option>
      {data.members.map(member => <option key={member.id} value={member.id}>{member.watcher_name || "Joueur"}</option>)}
    </select>
    {row.owner_provisional ? <span className="text-amber-300">Provisoire</span> : null}
    {row.owner && !row.owner_confirmed ? <button type="button" title="Confirmer le joueur affiche" aria-label={`Confirmer ${row.owner.watcher_name}`} disabled={busy}
      onClick={() => setChoice(row.owner.id)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-amber-700 text-amber-200"><ClipboardCheck size={16}/></button> : null}
    {row.opened && !defense.youtube_url && row.candidates.length > 1 ? <select
      aria-label={`Video - ${row.label}`} value={row.state.video_defense_id || ""} disabled={busy}
      onChange={event => void save(defense.id, "video", { video_defense_id: event.target.value || null })}
      className="h-8 min-w-0 max-w-full flex-1 rounded border border-zinc-600 bg-zinc-900 px-2 sm:max-w-56">
      <option value="">Choisir le replay</option>{row.candidates.map(video => <option key={video.id} value={video.defense_id}>{video.label}</option>)}
    </select> : null}
    {choice && selected ? <Modal title="Confirmer l'affectation" onClose={() => setChoice("")}>
      <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3 text-sm">
        <dt className="text-zinc-400">Emplacement</dt><dd>{row.position}</dd>
        <dt className="text-zinc-400">Joueur choisi</dt><dd className="break-words">{selected.watcher_name}</dd>
        <dt className="text-zinc-400">Ancien emplacement</dt><dd>{normalizeAllyAssignment(selected.assignment) || "Non renseigne"}</dd>
        {row.owner && row.owner.id !== selected.id ? <><dt className="text-zinc-400">{row.owner.watcher_name}</dt><dd>{normalizeAllyAssignment(selected.assignment) || "Place libre provisoire, sinon non affecte"}</dd></> : null}
      </dl>
      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setChoice("")} className="rounded border border-zinc-600 px-3 py-2">Annuler</button>
        <button type="button" disabled={busy} onClick={() => { void save(defense.id, "owner", { member_id: choice }); setChoice(""); }} className="rounded bg-emerald-700 px-3 py-2">Confirmer</button></div>
    </Modal> : null}
  </div>;
}

export function GvgAllyFollowupToolbar({ controller }) {
  const { data, error, busy, load, previewOpen, setPreviewOpen } = controller;
  return <>
    <button type="button" disabled={!data || busy} onClick={() => { setPreviewOpen(true); void load(true); }}
      className="inline-flex items-center gap-2 rounded border border-rose-700 px-3 py-1 text-sm text-rose-100 disabled:opacity-50"><ClipboardCheck size={15}/>Retours allies</button>
    {error ? <span role="alert" className="text-sm text-red-300">{error}</span> : null}
    {previewOpen && data ? <Modal title="Retours allies - previsualisation" onClose={() => setPreviewOpen(false)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm"><span>{data.preview.opened} ouvertes / {data.preview.ready} pretes</span>
        <span className="text-amber-300">Envois desactives</span><button type="button" onClick={() => void load(true)} title="Actualiser l'apercu" aria-label="Actualiser l'apercu" className="flex h-8 w-8 items-center justify-center rounded border border-zinc-700"><RefreshCw size={16}/></button></div>
      {data.history_warnings?.map((warning, index) => <p key={index} role="alert" className="mb-3 text-sm text-amber-300">{warning}</p>)}
      <div className="divide-y divide-zinc-800">{data.preview.rows.filter(row => row.opened).map(row => <section key={row.defense_id} className="py-3">
        <h3 className="text-sm font-semibold">{row.owner?.watcher_name || "Joueur non identifie"} - {row.label}</h3>
        {row.reasons.length ? <ul className="my-2 list-inside list-disc text-xs text-amber-300">{row.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul> : <p className="my-2 text-xs text-emerald-300">Pret</p>}
        {row.message ? <p className="whitespace-pre-wrap break-words text-sm text-zinc-300">{row.message}</p> : null}
        {row.video ? <a href={row.video.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-cyan-300 underline">Voir le replay</a> : null}
      </section>)}</div>
      {!data.preview.opened ? <p className="text-sm text-zinc-400">Aucune defense signalee ouverte.</p> : null}
    </Modal> : null}
  </>;
}
