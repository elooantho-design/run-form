import React, { useRef, useState } from "react";
import { CheckCircle2, Download, LockKeyhole, Pencil, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildRosterPublication, downloadRosterPublication } from "@/lib/intersaisonPlanPublication";

const style = "h-auto min-h-9 max-w-full whitespace-normal border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800";
const inputStyle = "mt-1 w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-zinc-100";

export default function IntersaisonPlanLifecycle({ request, plan, forecast, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [guild, setGuild] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mode, setMode] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const session = useRef(null);
  const lock = useRef(false);
  if (!plan) return null;

  async function run(action) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (cause) { setError(cause.message || "Action impossible."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function saveGuild(event) {
    event.preventDefault();
    await run(async () => {
      await request({ action: "save-forecast-guild", seasonId: plan.seasonId, expectedPlanRevision: plan.revision,
        guildCode: guild.code || null, name: guild.name, objective: guild.objective });
      setGuild(null); setNotice("Guilde prévisionnelle enregistrée. Aucun transfert effectué."); await onRefresh();
    });
  }
  async function openPreview(nextMode) {
    await run(async () => {
      setMode(nextMode); setPreview(null); setConfirmed(false); session.current = null;
      const data = await request({ action: "preview-forecast-application", seasonId: plan.seasonId });
      if (data.preview?.seasonId !== plan.seasonId || !/^[a-f0-9]{32}$/.test(data.preview.fingerprint || "")
        || !Array.isArray(data.preview.changes) || !Array.isArray(data.preview.creations) || !Array.isArray(data.preview.blockers)) {
        throw new Error("Prévisualisation invalide.");
      }
      session.current = { preview: data.preview, requestId: crypto.randomUUID(), seasonId: plan.seasonId };
      setPreview(data.preview);
    });
  }
  async function apply() {
    const current = session.current;
    if (!confirmed || !current || current.preview !== preview || current.seasonId !== plan.seasonId || !preview.canApply || preview.blockers.length) return;
    if (mode === "close" && (plan.appliedRevision !== plan.revision || preview.changes.length || preview.creations.length || preview.renames?.length)) return;
    await run(async () => {
      try {
        const data = await request({ action: mode === "close" ? "close-forecast-cycle" : "apply-forecast-plan",
          seasonId: current.seasonId, fingerprint: preview.fingerprint, requestId: current.requestId, confirmed: true });
        setMode(null); session.current = null; setPreview(null);
        setNotice(mode === "close" ? "Inter-saison clôturée." : `${data.result.transferred} transfert(s), ${data.result.community} passage(s) en communauté, ${data.result.createdGuilds} guilde(s) créée(s).`);
        await onRefresh();
      } catch (cause) {
        // Keep the request key on network uncertainty; explicit conflicts require a new preview.
        if (Number(cause.statusCode || cause.status) === 409) { session.current = null; setPreview(null); setConfirmed(false); }
        throw cause;
      }
    });
  }
  async function prepareNext() {
    if (!window.confirm("Préparer une nouvelle Inter-saison vide ? Les effectifs réels et les objectifs de référence seront conservés. Aucun MP ne sera envoyé.")) return;
    await run(async () => {
      await request({ action: "prepare-next-forecast-cycle", seasonId: plan.seasonId, confirmed: true });
      setNotice("Nouveau cycle préparé. Aucun sondage lancé."); await onRefresh();
    });
  }
  async function exportGuild(code) {
    await run(async () => {
      const item = buildRosterPublication(forecast, plan.revision).find((row) => row.code === code);
      await downloadRosterPublication(item);
    });
  }
  const canClose = preview && plan.appliedRevision === plan.revision && !preview.changes.length && !preview.creations.length && !preview.renames?.length;

  return <section aria-label="Validation et publication du plan" className="space-y-3 border-y border-zinc-800 py-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold text-zinc-100">Plan prévisionnel · Version {plan.revision}</h3>
      <span className="text-sm text-zinc-400">{plan.closedAt ? "Inter-saison clôturée" : plan.appliedRevision === plan.revision ? "Dernière version appliquée" : "Modifications non appliquées"}</span></div>
    {error ? <div role="alert" className="text-sm text-red-200">{error}</div> : null}
    {notice ? <div role="status" className="text-sm text-sky-200">{notice}</div> : null}
    <div className="flex flex-wrap items-center gap-2">
      {!plan.closedAt ? <>
        <Button type="button" variant="outline" className={style} disabled={busy} onClick={() => setGuild({ code: "", name: "", objective: "" })}><Plus className="h-4 w-4 shrink-0" /> Ajouter une guilde</Button>
        <Button type="button" className="h-auto min-h-9 max-w-full whitespace-normal bg-emerald-600 text-white hover:bg-emerald-500" disabled={busy} onClick={() => openPreview("apply")}><CheckCircle2 className="h-4 w-4 shrink-0" /> Valider et appliquer le plan</Button>
        <Button type="button" variant="outline" className={style} disabled={busy} onClick={() => openPreview("close")}><LockKeyhole className="h-4 w-4 shrink-0" /> Clôturer l’Inter-saison</Button>
      </> : <Button type="button" variant="outline" className={style} disabled={busy} onClick={prepareNext}><RefreshCw className="h-4 w-4 shrink-0" /> Préparer une nouvelle Inter-saison</Button>}
    </div>
    <div className="divide-y divide-zinc-800">{Object.entries(plan.guilds).map(([code, row]) => <div key={code} className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="min-w-0 break-words text-sm text-zinc-200">{code} — {row.name}{!row.existingId ? " · À créer" : ""}</span>
      <div className="flex shrink-0 gap-2">{!plan.closedAt ? <Button type="button" size="icon" variant="outline" className={style} title={`Modifier les objectifs de ${row.name}`} aria-label={`Modifier ${code}`} disabled={busy} onClick={() => setGuild({ code, name: row.name, objective: row.objective })}><Pencil className="h-4 w-4" /></Button> : null}
        <Button type="button" variant="outline" className={style} disabled={busy} onClick={() => exportGuild(code)}><Download className="h-4 w-4 shrink-0" /> Image {code}</Button></div>
    </div>)}</div>
    <Dialog open={Boolean(guild)} onOpenChange={(open) => { if (!open && !busy) setGuild(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto border-zinc-700 bg-zinc-950 text-zinc-100">
      <DialogHeader><DialogTitle>{guild?.code ? `Modifier ${guild.code}` : "Ajouter une guilde prévisionnelle"}</DialogTitle><DialogDescription>Création réelle uniquement après validation du plan.</DialogDescription></DialogHeader>
      {error ? <div role="alert" className="text-sm text-red-200">{error}</div> : null}
      <form onSubmit={saveGuild} className="space-y-4"><label className="block text-sm">Nom de la guilde<input required maxLength={80} value={guild?.name || ""} disabled={busy} onChange={(event) => setGuild({ ...guild, name: event.target.value })} className={inputStyle} /></label>
        <label className="block text-sm">Objectifs<textarea required rows={6} maxLength={600} value={guild?.objective || ""} disabled={busy} onChange={(event) => setGuild({ ...guild, objective: event.target.value })} className={inputStyle} /></label>
        <Button type="submit" disabled={busy}>Enregistrer le brouillon</Button></form>
    </DialogContent></Dialog>
    <Dialog open={Boolean(mode)} onOpenChange={(open) => { if (!open && !busy) { setMode(null); setPreview(null); session.current = null; } }}><DialogContent className="max-h-[90dvh] overflow-y-auto border-zinc-700 bg-zinc-950 text-zinc-100 sm:max-w-2xl">
      <DialogHeader><DialogTitle>{mode === "close" ? "Clôturer l’Inter-saison" : "Appliquer le plan aux effectifs réels"}</DialogTitle><DialogDescription>{mode === "close" ? "Aucun transfert supplémentaire ne sera effectué." : "Les changements ci-dessous seront appliqués uniquement après confirmation."}</DialogDescription></DialogHeader>
      {error ? <div role="alert" className="text-sm text-red-200">{error}</div> : null}
      {preview ? <>
        <Button type="button" variant="outline" className={style} disabled={busy} onClick={() => openPreview(mode)}><RefreshCw className="h-4 w-4" /> Actualiser la prévisualisation</Button>
        <div className="text-sm">{preview.creations.length} guilde(s) à créer · {preview.changes.filter((row) => row.target_guild).length} transfert(s) · {preview.changes.filter((row) => !row.target_guild).length} passage(s) en communauté</div>
        <div className="max-h-80 divide-y divide-zinc-800 overflow-y-auto text-sm">{preview.creations.map((row) => <div key={row.code} className="py-2">Nouvelle guilde : {row.code} — {row.name}</div>)}
          {(preview.renames || []).map((row) => <div key={`rename-${row.code}`} className="break-words py-2">Nom de {row.code} : {row.before} → {row.after}</div>)}
          {preview.changes.map((row) => <div key={row.member_id} className="break-words py-2">{row.member_name} : {row.current_guild || "Communauté"} → {row.target_guild || "Communauté"}</div>)}</div>
        {preview.blockers.map((reason) => <p key={reason} className="text-sm text-amber-200">{reason}</p>)}
        {mode === "close" && !canClose ? <p className="text-sm text-amber-200">Appliquer la dernière version et tous les écarts avant la clôture.</p> : null}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} className="mt-1" /><span>{mode === "close" ? "Je confirme la clôture et le verrouillage de ce cycle." : "Je confirme les changements sur les effectifs réels, y compris les passages en communauté indiqués."}</span></label>
        <Button type="button" onClick={apply} disabled={busy || !confirmed || !preview.canApply || preview.blockers.length > 0 || (mode === "close" && !canClose)}>Confirmer {mode === "close" ? "la clôture" : "l’application"}</Button>
      </> : <Button type="button" variant="outline" className={style} disabled={busy} onClick={() => openPreview(mode)}><RefreshCw className="h-4 w-4" /> Actualiser la prévisualisation</Button>}
    </DialogContent></Dialog>
  </section>;
}
