import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Bell, Download, Plus, RefreshCw, Save, Send, Trash2, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { requestGuildSurvey } from "@/lib/guildSurveyApi";
import { displaySurveyAnswer, guildSurveyCsv, newGuildSurvey, newSurveyQuestion, reorganizationSurvey, surveyStats, SURVEY_STATUS_LABELS, validateSurveyDraft } from "@/lib/guildSurveys";
import GuildSurveyQuestions from "@/components/GuildSurveyQuestions";

const inputClass = "w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100";
const reasons = { eligible: "Eligible", missing_discord: "Discord absent ou invalide", ambiguous_identity: "Identite a verifier",
  responded: "Deja repondu", pending: "Envoi deja en attente", outside_organization: "Compte sorti de l'organisation", identity_changed: "Identite Discord modifiee",
  permanent_or_uncertain_failure: "Erreur permanente ou livraison incertaine", recent_invitation: "Invitation ou relance de moins d'une heure",
  cancelled: "Envoi annule", not_delivered: "Invitation non transmise", queued: "En attente", sending: "En cours", sent: "Envoye", confirmed: "Envoye", failed: "Echec" };
const date = value => value ? new Date(value).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "-";
const guildLabel = g => `${g.guild_code}${g.display_name ? ` - ${g.display_name}` : ""}`;

function DraftEditor({ draft, setDraft, guilds, busy, onSave }) {
  const question = (index, patch) => setDraft(current => ({ ...current, questions: current.questions.map((q, i) => i === index ? { ...q, ...patch } : q) }));
  const move = (index, delta) => setDraft(current => {
    const questions = [...current.questions];
    [questions[index], questions[index + delta]] = [questions[index + delta], questions[index]];
    return { ...current, questions };
  });
  const count = guilds.filter(g => draft.target_guild_ids.includes(g.id)).reduce((sum, g) => sum + Number(g.active_members || 0), 0);
  return <form onSubmit={event => { event.preventDefault(); onSave(); }} className="space-y-6">
    <fieldset disabled={busy} className="min-w-0 space-y-4">
      <label className="block space-y-1 text-sm">Titre<input autoFocus required maxLength={160} aria-label="Titre du sondage" className={inputClass} value={draft.title}
        onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
      <label className="block space-y-1 text-sm">Introduction<textarea aria-label="Introduction" maxLength={6000} className={`${inputClass} min-h-32`} value={draft.introduction}
        onChange={e => setDraft({ ...draft, introduction: e.target.value })} /></label>
      <label className="block max-w-sm space-y-1 text-sm">Date limite (facultative)<input aria-label="Date limite" type="datetime-local" className={inputClass}
        value={draft.deadline ? new Date(new Date(draft.deadline).getTime() - new Date(draft.deadline).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""}
        onChange={e => setDraft({ ...draft, deadline: e.target.value ? new Date(e.target.value).toISOString() : "" })} /></label>
      <fieldset className="space-y-3"><legend className="text-sm font-semibold">Guildes destinataires</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{guilds.map(g => <label key={g.id} className="flex min-w-0 items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 shrink-0 accent-emerald-400" checked={draft.target_guild_ids.includes(g.id)}
            onChange={e => setDraft({ ...draft, target_guild_ids: e.target.checked ? [...draft.target_guild_ids, g.id] : draft.target_guild_ids.filter(id => id !== g.id) })} />
          <span className="min-w-0 break-words">{guildLabel(g)} <span className="text-zinc-500">({g.active_members || 0})</span></span>
        </label>)}</div><p className="text-xs text-zinc-400">{count} comptes actifs selectionnes</p>
      </fieldset>
      <div className="space-y-6">{draft.questions.map((q, index) => <section key={q.id} className="min-w-0 space-y-3 border-t border-zinc-800 pt-5">
        <div className="flex flex-wrap items-center gap-2"><span className="mr-auto text-sm font-semibold">Question {index + 1}</span>
          <button type="button" aria-label={`Monter la question ${index + 1}`} title="Monter" disabled={index === 0} className="p-2 disabled:opacity-30" onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
          <button type="button" aria-label={`Descendre la question ${index + 1}`} title="Descendre" disabled={index === draft.questions.length - 1} className="p-2 disabled:opacity-30" onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
          <button type="button" aria-label={`Supprimer la question ${index + 1}`} title="Supprimer la question" disabled={draft.questions.length === 1} className="p-2 text-red-300 disabled:opacity-30"
            onClick={() => setDraft({ ...draft, questions: draft.questions.filter(item => item.id !== q.id) })}><Trash2 size={16} /></button>
        </div>
        <input required maxLength={500} aria-label={`Intitule question ${index + 1}`} className={inputClass} value={q.label} onChange={e => question(index, { label: e.target.value })} />
        <div className="flex flex-wrap items-center gap-4"><select aria-label={`Type question ${index + 1}`} className={`${inputClass} max-w-48`} value={q.type}
          onChange={e => question(index, { type: e.target.value, options: e.target.value === "text" ? [] : q.options.length ? q.options : newSurveyQuestion().options })}>
          <option value="single">Choix unique</option><option value="multiple">Choix multiple</option><option value="text">Reponse libre</option>
        </select><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={q.required} onChange={e => question(index, { required: e.target.checked })} />Obligatoire</label></div>
        {q.type !== "text" ? <div className="space-y-2">{q.options.map((option, i) => <div key={option.id} className="flex items-center gap-2">
          <span className="w-5 shrink-0 text-xs text-zinc-500">{i + 1}</span><input required maxLength={300} aria-label={`Question ${index + 1}, proposition ${i + 1}`} className={inputClass}
            value={option.label} onChange={e => question(index, { options: q.options.map(o => o.id === option.id ? { ...o, label: e.target.value } : o) })} />
          <button type="button" title="Supprimer la proposition" aria-label={`Supprimer proposition ${i + 1} question ${index + 1}`} disabled={q.options.length <= 2} className="shrink-0 p-2 text-zinc-400 disabled:opacity-30"
            onClick={() => question(index, { options: q.options.filter(o => o.id !== option.id) })}><Trash2 size={15} /></button>
        </div>)}<Button type="button" variant="outline" disabled={q.options.length >= 20} onClick={() => question(index, { options: [...q.options, { id: crypto.randomUUID(), label: "" }] })}><Plus size={14} />Proposition</Button></div> : null}
      </section>)}</div>
      <Button type="button" variant="outline" disabled={draft.questions.length >= 20} onClick={() => setDraft({ ...draft, questions: [...draft.questions, newSurveyQuestion()] })}><Plus size={16} />Ajouter une question</Button>
    </fieldset>
    <div className="flex flex-wrap gap-2 border-t border-zinc-800 pt-4"><Button type="submit" disabled={busy}><Save size={16} />Enregistrer le brouillon</Button></div>
  </form>;
}

export default function GuildSurveyWorkspace({ onClose, initialCreate = false, activeGuildCode = "", request = requestGuildSurvey }) {
  const [catalog, setCatalog] = useState(null);
  const [view, setView] = useState(initialCreate ? "editor" : "list");
  const [detail, setDetail] = useState(null);
  const [draft, setDraft] = useState(newGuildSurvey);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState("individual");
  const [inspect, setInspect] = useState("");
  const [sampleAnswers, setSampleAnswers] = useState({});
  const guard = useRef(false);
  const boot = useRef(false);
  const run = useCallback(async operation => {
    if (guard.current) return;
    guard.current = true; setBusy(true); setError(""); setNotice("");
    try { await operation(); } catch (failure) { setError(failure.message); if (failure.status === 409) setConfirmation(null); }
    finally { guard.current = false; setBusy(false); }
  }, []);
  useEffect(() => {
    let alive = true;
    request("list").then(data => {
      if (!alive) return;
      setCatalog(data);
      if (!boot.current && initialCreate) {
        setDraft(current => ({ ...current, target_guild_ids: data.guilds.filter(g => g.guild_code === activeGuildCode).map(g => g.id) }));
      }
      boot.current = true;
    }).catch(failure => { if (alive) setError(failure.message); });
    return () => { alive = false; };
  }, [request, initialCreate, activeGuildCode]);
  const refreshCatalog = async () => { const data = await request("list"); setCatalog(data); return data; };
  const openDetail = id => run(async () => {
    setDetail(await request("detail", { surveyId: id })); setConfirmation(null); setView("detail"); setFilter(""); setInspect("");
  });
  const startNew = () => { setDetail(null); setDraft(newGuildSurvey()); setConfirmation(null); setView("editor"); setError(""); };
  const saveDraft = () => run(async () => {
    const invalid = validateSurveyDraft(draft); if (invalid) throw new Error(invalid);
    const data = await request("save", { surveyId: detail?.campaign?.id, expectedRevision: detail?.campaign?.revision, payload: draft });
    setDetail(data); setView("detail"); await refreshCatalog(); setNotice("Brouillon enregistre. Aucun MP envoye.");
  });
  const showPreview = kind => run(async () => {
    const preview = await request(kind === "initial" ? "preview" : "reminder-preview", { surveyId: detail.campaign.id });
    setConfirmation({ kind, preview, requestId: crypto.randomUUID() }); setConfirmed(false); setFilter("");
  });
  const execute = () => run(async () => {
    if (!confirmed || !confirmation) return;
    const action = confirmation.kind === "close" ? "close" : confirmation.kind === "initial" ? "publish" : "remind";
    const result = await request(action, { surveyId: detail.campaign.id, payload: { confirmed: true, requestId: confirmation.requestId, fingerprint: confirmation.preview?.fingerprint } });
    setConfirmation(null); setConfirmed(false); setDetail(await request("detail", { surveyId: detail.campaign.id }));
    await refreshCatalog(); setNotice(action === "close" ? "Sondage cloture." : `${result.queued} invitations ajoutees a la file progressive.`);
  });
  const exportCsv = () => {
    const blob = new Blob([guildSurveyCsv(detail.campaign, detail.recipients)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `sondage-${detail.campaign.id}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const campaign = detail?.campaign;
  const rows = detail?.recipients || [];
  const stats = surveyStats(campaign, rows, filter);
  const selectedRows = rows.filter(r => !filter || r.guild_code_snapshot === filter);
  const guilds = catalog?.guilds || [];
  const filterCodes = [...new Set((confirmation?.preview?.recipients || rows).map(r => r.guild_code_snapshot))].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  const guildFilter = <label className="flex flex-wrap items-center gap-2 text-sm">Guilde<select aria-label="Filtrer par guilde" className={`${inputClass} max-w-xs`} value={filter} onChange={e => setFilter(e.target.value)}>
    <option value="">Toutes les guildes</option>{filterCodes.map(code => <option key={code} value={code}>{guilds.find(g => g.guild_code === code) ? guildLabel(guilds.find(g => g.guild_code === code)) : code}</option>)}
  </select></label>;

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent aria-describedby={undefined}
    className="block max-h-[92dvh] w-[calc(100%-1rem)] overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-zinc-100 sm:max-w-5xl sm:p-6">
    <div className="mb-5 flex items-center gap-3 pr-8"><DialogTitle className="min-w-0 break-words text-lg font-semibold">{view === "editor" ? "Cr\u00e9er un sondage" : "Sondages de guilde"}</DialogTitle>
      <button type="button" title="Actualiser" aria-label="Actualiser les sondages" className="ml-auto p-2" disabled={busy} onClick={() => run(async () => {
        await refreshCatalog(); if (campaign) setDetail(await request("detail", { surveyId: campaign.id })); setConfirmation(null);
      })}><RefreshCw size={17} className={busy ? "animate-spin" : ""} /></button></div>
    {error ? <p role="alert" className="mb-4 break-words rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
    {notice ? <p role="status" className="mb-4 text-sm text-emerald-300">{notice}</p> : null}
    {!catalog ? <p className="py-5 text-sm text-zinc-400">Chargement des sondages...</p> : <>
      {view !== "list" ? <Button type="button" variant="ghost" disabled={busy} onClick={() => { setConfirmation(null); setView("list"); }}><ArrowLeft size={15} />Tous les sondages</Button> : null}
      {view === "list" ? <>
        <div className="mb-4 flex justify-end"><Button type="button" onClick={startNew}><Plus size={16} />Cr&eacute;er un sondage</Button></div>
        {!catalog.surveys.length ? <p className="py-8 text-center text-sm text-zinc-500">Aucun sondage de guilde.</p> : <div className="divide-y divide-zinc-800">{catalog.surveys.map(s => <button type="button" key={s.id} disabled={busy} onClick={() => openDetail(s.id)}
          className="grid w-full min-w-0 gap-2 py-4 text-left hover:bg-zinc-900/50 sm:grid-cols-[1fr_auto]">
          <span className="min-w-0"><span className="block break-words text-sm font-semibold">{s.title}</span><span className="mt-1 block break-words text-xs text-zinc-400">{s.created_by_name} - {date(s.created_at)}</span>
            <span className="mt-1 block break-words text-xs text-zinc-500">{guilds.filter(g => s.target_guild_ids.includes(g.id)).map(guildLabel).join(", ")}</span></span>
          <span className="space-y-1 text-xs sm:text-right"><span className="block text-sky-300">{SURVEY_STATUS_LABELS[s.effective_status]}</span>
            <span className="block text-zinc-300">{s.responses_count}/{s.recipients_count} reponses ({s.recipients_count ? Math.round(100 * s.responses_count / s.recipients_count) : 0} %)</span>
            {s.deadline ? <span className="block text-zinc-500">Limite : {date(s.deadline)}</span> : null}</span>
        </button>)}</div>}
      </> : null}
      {view === "editor" ? <>
        {!detail ? <label className="my-4 block max-w-sm space-y-1 text-sm">Modele<select aria-label="Modele de sondage" className={inputClass} value="" onChange={e => { if (e.target.value === "reorganization") setDraft(reorganizationSurvey(guilds)); }}>
          <option value="">Personnalise</option><option value="reorganization">Projet Paladin x DEUS</option>
        </select></label> : null}
        <DraftEditor draft={draft} setDraft={setDraft} guilds={guilds} busy={busy} onSave={saveDraft} />
      </> : null}
      {view === "detail" && campaign ? <article className="mt-4 min-w-0 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-base font-semibold">{campaign.title}</h2>
          <p className="mt-1 text-xs text-zinc-400">{campaign.created_by_name} - {SURVEY_STATUS_LABELS[campaign.effective_status]} - Limite : {date(campaign.deadline)}</p></div>
          <Button type="button" variant="outline" onClick={exportCsv}><Download size={15} />CSV</Button></div>
        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-zinc-300">{campaign.introduction}</p>
        {campaign.can_manage && !confirmation ? <div className="flex flex-wrap gap-2">
          {campaign.status === "draft" ? <><Button type="button" variant="outline" disabled={busy} onClick={() => { setDraft({ ...campaign, deadline: campaign.deadline || "" }); setView("editor"); }}>Modifier le brouillon</Button>
            <Button type="button" disabled={busy} onClick={() => showPreview("initial")}><Send size={15} />Previsualiser la publication</Button></> : null}
          {campaign.effective_status === "open" ? <><Button type="button" variant="outline" disabled={busy} onClick={() => showPreview("reminder")}><Bell size={15} />Relancer les sans reponse</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => { setConfirmation({ kind: "close" }); setConfirmed(false); }}><XCircle size={15} />Cloturer le sondage</Button></> : null}
        </div> : null}
        {confirmation ? <section className="space-y-4 border-y border-amber-500/40 py-5" aria-label="Confirmation du sondage">
          <h3 className="text-base font-semibold text-amber-200">{confirmation.kind === "close" ? "Cloturer ce sondage" : confirmation.kind === "initial" ? "Previsualisation avant publication" : "Previsualisation de la relance"}</h3>
          {confirmation.preview ? <>
            <div className="flex flex-wrap gap-4 text-sm"><strong>{confirmation.preview.eligible} MP eligibles</strong><span>{confirmation.preview.excluded} exclus</span><span>{confirmation.preview.participants} participants / {confirmation.preview.accounts} comptes</span></div>
            {!confirmation.preview.deliveryReady ? <p role="alert" className="text-sm text-amber-300">Les envois sont desactives : adaptation du worker a valider.</p> : null}
            <dl className="space-y-1 text-xs text-zinc-400">{Object.entries(confirmation.preview.exclusions).map(([key, count]) => <div key={key}>{reasons[key] || key} : {count}</div>)}</dl>
            {guildFilter}
            <ul className="max-h-64 space-y-2 overflow-auto text-sm">{confirmation.preview.recipients.filter(r => !filter || r.guild_code_snapshot === filter).map(r => <li key={r.recipient_id || r.member_key} className="flex flex-wrap justify-between gap-2 border-b border-zinc-900 py-1">
              <span className="min-w-0 break-words">{r.member_name_snapshot} - {r.guild_code_snapshot}{r.linked_accounts > 1 ? ` (${r.linked_accounts} comptes lies)` : ""}</span>
              <span className={r.eligibility === "eligible" ? "text-emerald-300" : "text-zinc-500"}>{reasons[r.eligibility] || r.eligibility}</span>
            </li>)}</ul>
          </> : <p className="text-sm text-zinc-300">Les reponses existantes seront conservees. Les nouveaux votes et envois en attente seront bloques.</p>}
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 shrink-0 accent-amber-400" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />
            <span>{confirmation.kind === "close" ? "Je confirme la cloture de ce sondage." : `Je confirme l'envoi global aux ${confirmation.preview.eligible} destinataires eligibles, toutes les guildes du sondage incluses.`}</span></label>
          <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || !confirmed || (confirmation.preview && !confirmation.preview.deliveryReady) || (confirmation.kind === "reminder" && !confirmation.preview.eligible)} onClick={execute}>
            {confirmation.kind === "close" ? "Confirmer la cloture" : `Confirmer l'envoi de ${confirmation.preview.eligible} MP`}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmation(null)}>Annuler</Button></div>
        </section> : null}
        {campaign.status === "draft" ? <GuildSurveyQuestions questions={campaign.questions} answers={sampleAnswers} onChange={setSampleAnswers} prefix="admin-preview" /> : <>
          <div className="flex flex-wrap items-center justify-between gap-3">{guildFilter}<strong className="text-sm">{stats.responded}/{stats.total} reponses - {stats.rate} %</strong></div>
          <div role="tablist" aria-label="Vue du sondage" className="flex border-b border-zinc-800">{[["individual", "Reponses individuelles"], ["global", "Vue globale"]].map(([value, label]) =>
            <button type="button" role="tab" key={value} aria-selected={tab === value} onClick={() => setTab(value)} className={`px-3 py-2 text-sm ${tab === value ? "border-b-2 border-emerald-400 text-emerald-200" : "text-zinc-400"}`}>{label}</button>)}</div>
          {tab === "global" ? <div className="space-y-5">
            <div className="flex flex-wrap gap-4 text-sm">{[...new Set(rows.map(r => r.guild_code_snapshot))].map(code => { const s = surveyStats(campaign, rows, code); return <span key={code}>{code} : {s.responded}/{s.total} ({s.rate} %)</span>; })}</div>
            {stats.questions.filter(q => q.type !== "text").map(q => <section key={q.id} className="space-y-3 border-b border-zinc-800 pb-4"><h3 className="break-words text-sm font-semibold">{q.label}</h3>
              {q.options.map(o => <div key={o.id} className="text-sm"><div className="flex justify-between gap-3"><span className="min-w-0 break-words">{o.label}</span><strong className="shrink-0">{o.count}</strong></div>
                <div className="mt-1 h-1.5 bg-zinc-800"><div className="h-full bg-emerald-500" style={{ width: `${stats.responded ? o.count / stats.responded * 100 : 0}%` }} /></div></div>)}
            </section>)}</div> : <div className="divide-y divide-zinc-800">{selectedRows.map(r => <div key={r.id} className="py-3">
              <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 text-left text-sm" onClick={() => setInspect(inspect === r.id ? "" : r.id)}>
                <span className="min-w-0 break-words font-medium">{r.member_name_snapshot} <span className="font-normal text-zinc-500">{r.guild_code_snapshot}</span></span>
                <span className={r.response ? "text-emerald-300" : "text-amber-300"}>{r.response ? "Repondu" : "Sans reponse"} - {reasons[r.delivery_status] || r.delivery_status}</span>
              </button>
              {inspect === r.id ? <div className="mt-3 space-y-3 break-words text-sm">{r.last_error ? <p className="text-red-300">{r.last_error}</p> : null}
                {r.response ? <><p className="text-xs text-zinc-500">{date(r.response.updated_at)} - version {r.response.version}</p>{campaign.questions.map(q => <div key={q.id}><p className="text-zinc-400">{q.label}</p><p className="mt-1 whitespace-pre-wrap text-zinc-100">{displaySurveyAnswer(q, r.response.answers[q.id]) || "Non renseigne"}</p></div>)}</> : <p className="text-zinc-500">Aucune reponse enregistree.</p>}
              </div> : null}
            </div>)}</div>}
          <p className="text-xs text-zinc-500">{detail.waves.length} envoi(s) confirme(s)</p>
        </>}
      </article> : null}
    </>}
  </DialogContent></Dialog>;
}
