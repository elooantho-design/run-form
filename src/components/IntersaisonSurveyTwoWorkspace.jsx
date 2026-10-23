import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Bell, ClipboardList, History, MessageCircle, Plus, RefreshCw, Send, Trash2, Users, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import IntersaisonObjectivesPreparation from "@/components/IntersaisonObjectivesPreparation";
import { PALADIN_GUILD_DISPLAY_NAMES } from "@/lib/guildDisplay";
import IntersaisonForecastPlayer from "@/components/IntersaisonForecastPlayer";
import { getSurveyTwoNonRespondents, resolveForecastAvatarUrl, FORECAST_ROLES } from "@/lib/intersaisonForecast";

const guildLabel = (code) => code ? `${code} — ${PALADIN_GUILD_DISPLAY_NAMES[code] || code}` : "Non renseigné";
const dateLabel = (value) => value ? new Date(value).toLocaleString("fr-FR") : "";
const buttonStyle = "border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800";
const reminderCountLabels = [
  ["Destinataires de la campagne", "total"], ["Destinataires sans réponse", "nonRespondents"],
  ["Relances éligibles", "eligible"], ["Déjà répondants, non relancés", "responded"],
  ["En attente ou en cours, non relancés", "pending"], ["Comptes exclus", "excluded"],
  ["Envois en échec, non relancés", "failed"], ["IDs absents ou invalides, non relancés", "invalid"],
  ["Comptes inactifs, non relancés", "inactive"],
];

function isGlobalReminderPreview(preview, campaignId) {
  const guilds = Object.keys(PALADIN_GUILD_DISPLAY_NAMES);
  return preview?.campaignId === campaignId && typeof preview.fingerprint === "string" && Boolean(preview.fingerprint)
    && typeof preview.canQueue === "boolean" && Array.isArray(preview.blockers)
    && preview.blockers.every((reason) => typeof reason === "string")
    && Array.isArray(preview.scopeGuilds) && preview.scopeGuilds.length === guilds.length
    && guilds.every((code) => preview.scopeGuilds.includes(code))
    && reminderCountLabels.every(([, key]) => Number.isSafeInteger(preview.counts?.[key]) && preview.counts[key] >= 0);
}

export function SurveyChoiceAnswer({ response }) {
  const first = response?.firstChoiceGuildCode || response?.first_choice_guild_code;
  const second = response?.secondChoiceGuildCode || response?.second_choice_guild_code;
  const comment = response?.commentText ?? response?.comment_text ?? "";
  return <div className="space-y-2 text-sm">
    <div><span className="text-zinc-400">Premier choix : </span>{guildLabel(first)}</div>
    {second ? <div><span className="text-zinc-400">Deuxième choix : </span>{guildLabel(second)}</div> : null}
    {comment ? <div className="whitespace-pre-wrap break-words border-t border-zinc-800 pt-3 leading-6">{comment}</div> : null}
  </div>;
}

export default function IntersaisonSurveyTwoWorkspace({ request, center, pollNumber, onCenterChange, onRefresh, forecastVisible, onForecastVisibleChange }) {
  const [workspace, setWorkspace] = useState(null);
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [launchPreview, setLaunchPreview] = useState(null);
  const [currentGuildFilter, setCurrentGuildFilter] = useState("");
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderPreview, setReminderPreview] = useState(null);
  const [reminderNeedsPreview, setReminderNeedsPreview] = useState(false);
  const actionLock = useRef(false);
  const reminderSession = useRef(null);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [search, setSearch] = useState("");
  const [placementOpen, setPlacementOpen] = useState(false);
  const [placementMemberId, setPlacementMemberId] = useState("");
  const [placementGuild, setPlacementGuild] = useState("G1");
  const [placementRole, setPlacementRole] = useState("member");
  const [placementVersions, setPlacementVersions] = useState({ placement: 0, role: 0 });
  const [selectedPlayerKey, setSelectedPlayerKey] = useState(null);
  const [commentPlayerKey, setCommentPlayerKey] = useState(null);
  const selectedPlayer = workspace?.forecast?.players.find((p) => p.memberKey === selectedPlayerKey);
  const commentPlayer = workspace?.forecast?.players.find((p) => p.memberKey === commentPlayerKey);

  const campaign = center?.campaigns?.find((c) => c.pollNumber === pollNumber && c.status !== "cancelled");
  const ready = workspace?.schemaReady && workspace?.seasonId;
  const reminderCampaign = workspace?.choiceCampaign;
  const canRemind = Boolean(pollNumber === 2 && ready && center?.surveySchemaReady
    && center?.season?.id === workspace.seasonId && reminderCampaign?.id
    && reminderCampaign.poll_number === 2 && reminderCampaign.is_test === false && reminderCampaign.status === "open"
    && campaign?.id === reminderCampaign.id && campaign.isTest === false && campaign.status === "open");
  const nonRespondents = getSurveyTwoNonRespondents(workspace?.forecast?.players);
  const filteredNonRespondents = getSurveyTwoNonRespondents(workspace?.forecast?.players, currentGuildFilter);
  const unassignedRespondents = workspace?.forecast?.unassigned.filter((player) => player.answer) || [];
  const candidates = workspace?.candidates?.[pollNumber] || [];
  const loadWorkspace = useCallback(async () => {
    try {
      const data = await request({ action: "load-survey-two-workspace" });
      setWorkspace(data.workspace);
    } catch (loadError) { setError(loadError.message); }
  }, [request]);
  useEffect(() => { void loadWorkspace(); }, [loadWorkspace, center?.season?.id]);
  useEffect(() => { if (editor?.versionId) void loadWorkspace(); }, [editor?.versionId, editor?.status, loadWorkspace]);
  useEffect(() => {
    if (pollNumber !== 2) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || actionLock.current || busy || reminderOpen || addOpen || placementOpen || launchPreview || selectedPlayer || commentPlayer) return;
      void loadWorkspace();
      void onRefresh?.();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [pollNumber, busy, reminderOpen, addOpen, placementOpen, launchPreview, selectedPlayer, commentPlayer, loadWorkspace, onRefresh]);

  async function perform(payload, success) {
    if (actionLock.current) return null;
    actionLock.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await request(payload);
      if (data.workspace) setWorkspace(data.workspace);
      if (data.surveyCenter) onCenterChange(data.surveyCenter);
      setNotice(typeof success === "function" ? success(data) : success || "");
      return data;
    } catch (actionError) { setError(actionError.message); return null; }
    finally { actionLock.current = false; setBusy(false); }
  }
  async function previewReminders() {
    if (!canRemind || actionLock.current) return;
    actionLock.current = true;
    reminderSession.current = null;
    setBusy(true); setError(""); setNotice(""); setReminderOpen(true);
    setReminderPreview(null); setReminderNeedsPreview(false);
    try {
      const data = await request({ action: "preview-survey-two-reminders", campaignId: reminderCampaign.id });
      if (!isGlobalReminderPreview(data?.preview, reminderCampaign.id)) throw new Error("Prévisualisation globale des relances invalide.");
      reminderSession.current = { preview: data.preview, requestId: crypto.randomUUID(), needsPreview: false };
      setReminderPreview(data.preview);
    } catch (previewError) {
      setReminderNeedsPreview(true);
      setError(previewError.message || "Prévisualisation des relances impossible.");
    } finally { actionLock.current = false; setBusy(false); }
  }
  async function confirmReminders() {
    const session = reminderSession.current;
    if (!canRemind || actionLock.current || !reminderOpen || !session || session.needsPreview
      || session.preview !== reminderPreview || session.preview.campaignId !== reminderCampaign.id
      || !session.preview.canQueue || session.preview.blockers.length || session.preview.counts.eligible === 0) return;
    actionLock.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await request({ action: "queue-survey-two-reminders", campaignId: session.preview.campaignId,
        confirmed: true, previewFingerprint: session.preview.fingerprint, requestId: session.requestId });
      if (!Number.isSafeInteger(data?.result?.queuedCount) || data.result.queuedCount < 0) throw new Error("Résultat de mise en file invalide.");
      reminderSession.current = null;
      setReminderOpen(false); setReminderPreview(null);
      if (data.workspace) setWorkspace(data.workspace);
      if (data.surveyCenter) onCenterChange(data.surveyCenter);
      setNotice(data.result.alreadyQueued
        ? `${data.result.queuedCount} relance(s) déjà en file. Aucun doublon ajouté.`
        : `${data.result.queuedCount} relance(s) ajoutée(s) à la file Discord globale G1 à G7.`);
    } catch (reminderError) {
      const status = Number(reminderError.statusCode ?? reminderError.status ?? reminderError.response?.status);
      // Unknown failures require a fresh preview; transient failures reuse the request key.
      const retryable = status !== 409 && (reminderError instanceof TypeError || [0, 408, 429].includes(status) || (status >= 500 && status <= 599));
      if (!retryable) {
        session.needsPreview = true;
        setReminderNeedsPreview(true);
      }
      setError(`${reminderError.message || "Relance impossible."}${retryable ? "" : " Nouvelle prévisualisation requise avant confirmation."}`);
    } finally { actionLock.current = false; setBusy(false); }
  }
  function closeReminders(open) {
    if (open || actionLock.current) return;
    reminderSession.current = null;
    setReminderOpen(false); setReminderPreview(null); setReminderNeedsPreview(false);
  }
  async function previewLaunch() {
    const data = await perform({ action: "preview-survey-two-launch" });
    if (data) setLaunchPreview(data.preview);
  }
  async function launch(isTest) {
    if (isTest && !window.confirm("Envoyer le sondage n° 2 uniquement sur ton propre compte Discord, hors résultats officiels ?")) return;
    const preview = isTest ? workspace.preview : launchPreview;
    const data = await perform({ action: isTest ? "launch-survey-two-test" : "launch-survey-two", confirmed: true,
      versionId: preview.versionId, rosterFingerprint: preview.rosterFingerprint },
    isTest ? "Test personnel ajouté à la file Discord. Aucun objectif officialisé." : "Sondage n° 2 ajouté à la file Discord progressive.");
    if (data) setLaunchPreview(null);
  }
  async function closeSurvey() {
    if (!window.confirm(`Clôturer uniquement le sondage n° ${pollNumber} ? La saison et toutes ses réponses seront conservées.`)) return;
    await perform({ action: "close-survey", campaignId: campaign.id, confirmed: true }, `Sondage n° ${pollNumber} clôturé. Inter-saison conservée.`);
  }
  async function addRecipients() {
    if (!window.confirm(`Ajouter ${selectedIds.length} joueur(s) au sondage n° ${pollNumber} et mettre les MP éligibles en file ?`)) return;
    const data = await perform({ action: "add-survey-members", campaignId: campaign.id, memberIds: selectedIds, confirmed: true },
      (result) => `${result.result.addedCount} nouveau(x) destinataire(s), ${result.result.queuedCount} MP ajouté(s) à la file.`);
    if (data) { setAddOpen(false); setSelectedIds([]); }
  }
  async function savePlacement(player, remove = false) {
    const memberId = player?.memberKey || placementMemberId;
    const existing = workspace.forecast?.players.find((p) => p.memberKey === memberId);
    if (remove && !window.confirm("Retirer ce placement manuel ? Son historique et la réponse du joueur seront conservés.")) return;
    const payload = remove || !workspace.forecastRolesReady
      ? { action: "save-survey-placement", memberId, guildCode: remove ? null : placementGuild || null,
        expectedRevision: remove ? existing?.placementRevision || 0 : placementVersions.placement }
      : { action: "save-survey-forecast-entry", memberId, guildCode: placementGuild || null, forecastRole: placementRole,
        expectedRevision: placementVersions.placement, expectedRoleRevision: placementVersions.role };
    const data = await perform(payload, remove ? "Placement retiré. Historique conservé." : "Plan prévisionnel enregistré.");
    if (data) { setPlacementOpen(false); setSelectedPlayerKey(null); }
  }
  function selectPlacementMember(memberId) {
    const player = workspace?.forecast?.players.find((p) => p.memberKey === memberId);
    setPlacementMemberId(memberId); setPlacementGuild(player?.manual?.guild_code || ""); setPlacementRole(player?.forecastRole || "member");
    setPlacementVersions({ placement: player?.placementRevision || 0, role: player?.roleRevision || 0 });
  }
  function openPlacement(player = null) {
    selectPlacementMember(player?.memberKey || ""); setSelectedPlayerKey(null); setSearch(""); setPlacementOpen(true);
  }
  function renderPlayer(player) {
    return <IntersaisonForecastPlayer key={player.memberKey} player={player} avatarUrl={resolveForecastAvatarUrl(player.avatarUrl)}
      onOpen={() => { setSelectedPlayerKey(player.memberKey); void loadWorkspace(); }}
      onComment={() => { setCommentPlayerKey(player.memberKey); void loadWorkspace(); }} />;
  }
  if (workspace?.supported === false) return null;
  const matchingMembers = (workspace?.members || []).filter((m) => String(m.watcher_name).toLowerCase().includes(search.toLowerCase()));
  const dialogError = error ? <div role="alert" className="text-sm text-red-200">{error}</div> : null;

  return <section aria-label={`Actions sondage ${pollNumber}`} className="space-y-4 border-y border-zinc-800 py-4">
    {dialogError}
    {notice ? <div role="status" className="text-sm text-sky-200">{notice}</div> : null}
    {workspace?.schemaReady === false ? <div className="text-sm text-amber-200">Migration du sondage n° 2 requise avant toute nouvelle action.</div> : null}
    {pollNumber === 2 ? <>
      <details open={!workspace?.choiceCampaign} className="border-b border-zinc-800 pb-3">
        <summary className="cursor-pointer text-sm font-semibold text-zinc-200">Objectifs des sept guildes</summary>
        <IntersaisonObjectivesPreparation request={request} onStateChange={setEditor} />
      </details>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!ready || busy || editor?.dirty || !workspace?.preview?.canLaunch} onClick={previewLaunch} className="bg-sky-500 text-zinc-950 hover:bg-sky-400"><Send className="h-4 w-4" /> Lancer le sondage n° 2</Button>
        <Button type="button" variant="outline" disabled={!ready || busy || editor?.dirty || !workspace?.preview?.canTest} onClick={() => launch(true)} className={buttonStyle}><Send className="h-4 w-4" /> M'envoyer un test</Button>
      </div>
      {!workspace?.choiceCampaign && workspace?.preview?.blockers?.length ? <ul className="space-y-1 text-sm text-amber-200">{workspace.preview.blockers.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
      <div role="tablist" aria-label="Vue des guildes" className="flex flex-wrap gap-1 border-b border-zinc-800">
        {[[false, "Effectifs actuels", Users], [true, "Plan prévisionnel", ClipboardList]].map(([value, label, Icon]) =>
          <button key={label} type="button" role="tab" aria-selected={forecastVisible === value} onClick={() => onForecastVisibleChange(value)}
            className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm ${forecastVisible === value ? "border-sky-400 text-sky-200" : "border-transparent text-zinc-400"}`}>{React.createElement(Icon, { className: "h-4 w-4" })}{label}</button>)}
      </div>
    </> : null}
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="icon" title="Synchroniser les nouveaux membres et les réponses" aria-label="Synchroniser" disabled={busy} className={buttonStyle}
        onClick={() => { void loadWorkspace(); void onRefresh?.(); }}><RefreshCw className="h-4 w-4" /></Button>
      {campaign?.status === "open" ? <>
        <Button type="button" variant="outline" className={buttonStyle} disabled={!ready || busy || !candidates.length}
          onClick={() => { setSelectedIds([]); setSearch(""); setAddOpen(true); }}><Plus className="h-4 w-4" /> Nouveaux destinataires ({candidates.length})</Button>
        <Button type="button" variant="outline" className={buttonStyle} disabled={!ready || busy} onClick={closeSurvey}><XCircle className="h-4 w-4" /> Clôturer le sondage n° {pollNumber}</Button>
      </> : null}
      {pollNumber === 2 && forecastVisible ? <Button type="button" variant="outline" className={buttonStyle} disabled={!ready || busy} onClick={() => openPlacement()}><Plus className="h-4 w-4" /> Ajouter un joueur</Button> : null}
    </div>
    {pollNumber === 2 && forecastVisible && workspace?.forecast ? <>
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {workspace.forecast.guilds.map((guild) => <div key={guild.code} className="min-w-0 overflow-hidden rounded-lg border border-zinc-800">
          <div className="border-b border-zinc-800 bg-zinc-900 p-3">
            <div className="flex justify-between gap-2"><h3 className="font-semibold text-zinc-100">{guild.name}</h3><span className={`shrink-0 text-sm ${guild.overCapacity ? "text-red-200" : "text-zinc-400"}`}>{guild.count} / 30</span></div>
            <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sm text-zinc-400">{guild.objective || "Objectifs non publiés"}</div>
          </div>
          <div className="max-h-96 space-y-1 overflow-y-auto p-2">{guild.players.map(renderPlayer)}
            {!guild.players.length ? <div className="p-2 text-sm text-zinc-500">Aucun placement</div> : null}</div>
        </div>)}
      </div>
      <div className="border-t border-zinc-800 pt-4"><h3 className="mb-3 text-sm font-semibold text-zinc-300">Sans affectation prévisionnelle ({workspace.forecast.unassigned.length})</h3>
        <div className="mb-2 text-xs text-zinc-500">Total global sans affectation : {workspace.forecast.unassigned.length}</div>
        {unassignedRespondents.length ? <div className="space-y-2">
          <h4 className="text-sm text-zinc-400">Avec réponse, sans affectation prévisionnelle ({unassignedRespondents.length})</h4>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{unassignedRespondents.map(renderPlayer)}</div>
        </div> : null}
        <section aria-label="Joueurs sans réponse au sondage n° 2" className="mt-4 space-y-3 border-t border-zinc-800 pt-4">
          <h4 className="text-sm font-semibold text-zinc-300">Sans réponse au sondage n° 2 ({nonRespondents.length} au total)</h4>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="min-w-0 text-sm text-zinc-400">Guilde actuelle
              <select aria-label="Guilde actuelle des non-répondants" value={currentGuildFilter} onChange={(event) => setCurrentGuildFilter(event.target.value)}
                className="mt-1 block w-full max-w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-zinc-100 sm:w-72">
                <option value="">Toutes les guildes</option>{Object.entries(PALADIN_GUILD_DISPLAY_NAMES).map(([code, label]) => <option key={code} value={code}>{code} — {label}</option>)}
              </select>
            </label>
            <Button type="button" variant="outline" className={`${buttonStyle} h-auto min-h-9 max-w-full whitespace-normal text-left`} disabled={!canRemind || busy || reminderOpen} onClick={previewReminders}>
              <Bell className="h-4 w-4 shrink-0" /> Relancer tous les sans réponse
            </Button>
          </div>
          <p role="status" className="text-xs text-zinc-400">{filteredNonRespondents.length} affiché(s) sur {nonRespondents.length} sans réponse au total · {currentGuildFilter ? guildLabel(currentGuildFilter) : "Toutes les guildes actuelles"}</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{filteredNonRespondents.map((player) => <div key={player.memberKey} className="min-w-0">
            {renderPlayer(player)}
            {player.targetGuild ? <div className="mt-1 break-words text-xs text-zinc-400">Affectation prévisionnelle : {guildLabel(player.targetGuild)}</div> : null}
          </div>)}</div>
          {!filteredNonRespondents.length ? <p className="text-sm text-zinc-500">Aucun joueur sans réponse pour cette guilde actuelle.</p> : null}
        </section>
      </div>
    </> : null}
    <Dialog open={Boolean(launchPreview)} onOpenChange={(open) => { if (!open) setLaunchPreview(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto border-zinc-700 bg-zinc-950 text-zinc-100 sm:max-w-2xl">
        <DialogHeader><DialogTitle>Lancer le sondage n° 2</DialogTitle><DialogDescription className="text-zinc-400">Version {launchPreview?.versionNumber} · MP envoyés progressivement après confirmation</DialogDescription></DialogHeader>
        {dialogError}
        <div className="grid gap-2 text-sm sm:grid-cols-2">{Object.entries(PALADIN_GUILD_DISPLAY_NAMES).map(([code, label]) => <div key={code}>{code} — {label}</div>)}</div>
        <dl className="space-y-2 border-y border-zinc-800 py-3 text-sm">{[
          ["Joueurs actifs ciblés", "total"], ["IDs absents ou invalides", "missing"],
          ["IDs Discord distincts", "distinctDiscordIds"], ["IDs partagés non vérifiés", "duplicateDiscordIds"],
          ["Comptes aux rattachements ambigus, exclus des MP", "duplicates"], ["Comptes éligibles aux MP", "eligible"],
        ].map(([label, key]) => <div key={key} className="flex justify-between gap-4"><dt>{label}</dt><dd>{launchPreview?.counts?.[key] || 0}</dd></div>)}</dl>
        {launchPreview?.blockers?.map((reason) => <div key={reason} className="text-sm text-amber-200">{reason}</div>)}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" className={buttonStyle} onClick={() => setLaunchPreview(null)} disabled={busy}>Annuler</Button>
          <Button type="button" onClick={() => launch(false)} disabled={busy || !launchPreview?.canLaunch}>Confirmer le lancement</Button></div>
      </DialogContent>
    </Dialog>
    <Dialog open={reminderOpen} onOpenChange={closeReminders}>
      <DialogContent showCloseButton={!busy} className="max-h-[90dvh] overflow-y-auto border-zinc-700 bg-zinc-950 text-zinc-100 sm:max-w-2xl">
        <DialogHeader><DialogTitle>Relance globale du sondage n° 2</DialogTitle><DialogDescription className="text-zinc-400">Destinataires de la campagne officielle du sondage n° 2 · Toutes les guildes G1 à G7, indépendamment du filtre de la liste.</DialogDescription></DialogHeader>
        {dialogError}
        {reminderPreview ? <>
          <p className="text-sm font-semibold text-sky-200">{reminderPreview.counts.eligible} relance(s) éligible(s) exactement sur le périmètre global G1 à G7.</p>
          <dl className="space-y-2 border-y border-zinc-800 py-3 text-sm">{reminderCountLabels.map(([label, key]) => <div key={key} className="flex justify-between gap-4"><dt className="min-w-0 break-words">{label}</dt><dd className="shrink-0">{reminderPreview.counts[key]}</dd></div>)}</dl>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">{reminderPreview.scopeGuilds.map((code) => <span key={code}>{guildLabel(code)}</span>)}</div>
          {reminderPreview.blockers.map((reason, index) => <p key={`${index}-${reason}`} className="text-sm text-amber-200">{reason}</p>)}
        </> : busy ? <p role="status" className="text-sm text-zinc-400">Prévisualisation globale en cours...</p> : null}
        {!canRemind ? <p className="text-sm text-amber-200">La relance nécessite une campagne officielle du sondage n° 2 ouverte et prête.</p> : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button type="button" variant="outline" className={buttonStyle} onClick={() => closeReminders(false)} disabled={busy}>Annuler</Button>
          {reminderNeedsPreview ? <Button type="button" className="h-auto min-h-9 whitespace-normal" onClick={previewReminders} disabled={busy || !canRemind}><RefreshCw className="h-4 w-4 shrink-0" /> Nouvelle prévisualisation</Button>
            : <Button type="button" className="h-auto min-h-9 whitespace-normal" onClick={confirmReminders} disabled={busy || !canRemind || !reminderPreview?.canQueue || Boolean(reminderPreview?.blockers.length) || !reminderPreview?.counts.eligible}>
              <Bell className="h-4 w-4 shrink-0" /> Confirmer {reminderPreview?.counts.eligible ?? 0} relance(s) globales
            </Button>}
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={addOpen} onOpenChange={setAddOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto border-zinc-700 bg-zinc-950 text-zinc-100">
        <DialogHeader><DialogTitle>Nouveaux destinataires · Sondage {pollNumber}</DialogTitle><DialogDescription className="text-zinc-400">{candidates.length} membre(s) non inclus · aucun envoi automatique</DialogDescription></DialogHeader>
        {dialogError}<SearchField value={search} onChange={setSearch} />
        <div className="max-h-80 space-y-2 overflow-y-auto">{candidates.filter((m) => String(m.watcher_name).toLowerCase().includes(search.toLowerCase())).map((m) =>
          <label key={m.id} className="flex items-center gap-3 border-b border-zinc-800 py-2 text-sm"><input type="checkbox" checked={selectedIds.includes(m.id)}
            onChange={(e) => setSelectedIds((prev) => e.target.checked ? [...prev, m.id] : prev.filter((id) => id !== m.id))} />
            <span className="min-w-0 break-words">{m.watcher_name}<span className="ml-2 text-xs text-zinc-500">{m.guild_code}</span></span>
          </label>)}</div>
        <Button type="button" disabled={busy || !selectedIds.length} onClick={addRecipients}><Send className="h-4 w-4" /> Ajouter et mettre en file ({selectedIds.length})</Button>
      </DialogContent>
    </Dialog>
    <Dialog open={placementOpen} onOpenChange={setPlacementOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto border-zinc-700 bg-zinc-950 text-zinc-100">
        <DialogHeader><DialogTitle>Placement administratif</DialogTitle><DialogDescription className="text-zinc-400">Plan prévisionnel uniquement · aucun transfert réel</DialogDescription></DialogHeader>
        {dialogError}<SearchField value={search} onChange={setSearch} />
        <label className="text-sm">Joueur<select aria-label="Joueur du dashboard" value={placementMemberId} onChange={(e) => selectPlacementMember(e.target.value)} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 p-2">
          <option value="">Sélectionner un joueur</option>{matchingMembers.map((m) => <option key={m.id} value={m.id}>{m.watcher_name} · {m.guild_code}</option>)}
        </select></label>
        <label className="text-sm">Guilde prévisionnelle<select aria-label="Guilde prévisionnelle" value={placementGuild} onChange={(e) => setPlacementGuild(e.target.value)} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 p-2">
          <option value="">Suivre le premier choix</option>
          {Object.keys(PALADIN_GUILD_DISPLAY_NAMES).map((code) => <option key={code} value={code}>{guildLabel(code)}</option>)}
        </select></label>
        <label className="text-sm">Rôle prévisionnel<select aria-label="Rôle prévisionnel" value={placementRole} onChange={(e) => setPlacementRole(e.target.value)} disabled={!workspace?.forecastRolesReady} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 p-2 disabled:opacity-50">
          {Object.entries(FORECAST_ROLES).map(([role, label]) => <option key={role} value={role}>{label}</option>)}
        </select></label>
        {!workspace?.forecastRolesReady ? <div className="text-xs text-amber-200">Migration des rôles prévisionnels requise. Les placements existants restent disponibles.</div> : null}
        <Button type="button" disabled={busy || !placementMemberId || (!workspace?.forecastRolesReady && !placementGuild)} onClick={() => savePlacement(null)}>Enregistrer</Button>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(commentPlayer)} onOpenChange={(open) => { if (!open) setCommentPlayerKey(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto border-zinc-700 bg-zinc-950 text-zinc-100 sm:max-w-xl">
        <DialogHeader><DialogTitle>Commentaire de {commentPlayer?.name}</DialogTitle><DialogDescription className="text-zinc-400">Dernière réponse · {dateLabel(commentPlayer?.answer?.responded_at)}</DialogDescription></DialogHeader>
        <div className="whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">{commentPlayer?.answer?.comment_text || "Aucun commentaire."}</div>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(selectedPlayer)} onOpenChange={(open) => { if (!open) setSelectedPlayerKey(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto border-zinc-700 bg-zinc-950 text-zinc-100 sm:max-w-2xl">
        <DialogHeader><DialogTitle>{selectedPlayer?.name}</DialogTitle><DialogDescription className="text-zinc-400">Guilde active : {guildLabel(selectedPlayer?.currentGuild)}</DialogDescription></DialogHeader>
        {dialogError}
        {selectedPlayer?.answer ? <section className="space-y-3 border-b border-zinc-800 pb-3"><h3 className="flex items-center gap-2 font-semibold"><MessageCircle className="h-4 w-4" /> Choix exprimé par le joueur</h3><SurveyChoiceAnswer response={selectedPlayer.answer} /><div className="text-xs text-zinc-500">{dateLabel(selectedPlayer.answer.responded_at)}</div></section> : <div className="text-sm text-zinc-400">Aucune réponse au sondage.</div>}
        <section className="space-y-2"><h3 className="font-semibold">Placement administratif</h3>
          <div className="text-sm text-zinc-300">Rôle prévisionnel : {FORECAST_ROLES[selectedPlayer?.forecastRole] || "Membre"}</div>
          {selectedPlayer?.forecastRoleEvent ? <div className="text-xs text-zinc-400">{selectedPlayer.forecastRoleEvent.actor_name} · {dateLabel(selectedPlayer.forecastRoleEvent.created_at)}</div> : null}
          {selectedPlayer?.manual ? <div className="text-sm">{guildLabel(selectedPlayer.manual.guild_code)}<div className="mt-1 text-xs text-zinc-400">{selectedPlayer.manual.actor_name} · {dateLabel(selectedPlayer.manual.created_at)}</div></div> : <div className="text-sm text-zinc-400">Aucun placement manuel actif.</div>}
          {selectedPlayer?.hasDifference ? <div className="text-sm text-amber-200">Le choix du joueur diffère du placement administratif.</div> : null}
          <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className={buttonStyle} disabled={busy || !selectedPlayer?.activeNow} onClick={() => openPlacement(selectedPlayer)}><ArrowLeftRight className="h-4 w-4" /> Modifier le placement</Button>
            {selectedPlayer?.manual ? <Button type="button" variant="outline" className={buttonStyle} disabled={busy} onClick={() => savePlacement(selectedPlayer, true)}><Trash2 className="h-4 w-4" /> Retirer</Button> : null}</div>
        </section>
        {selectedPlayer?.manualHistory?.length ? <details className="border-t border-zinc-800 pt-3"><summary className="cursor-pointer text-sm"><History className="mr-2 inline h-4 w-4" />Historique des placements</summary><ul className="mt-2 space-y-2 text-xs text-zinc-400">{selectedPlayer.manualHistory.map((e) => <li key={e.id}>{e.action === "set" ? guildLabel(e.guild_code) : "Placement retiré"} · {e.actor_name} · {dateLabel(e.created_at)}</li>)}</ul></details> : null}
        {selectedPlayer?.forecastRoleHistory?.length ? <details className="border-t border-zinc-800 pt-3"><summary className="cursor-pointer text-sm">Historique des rôles prévisionnels</summary><ul className="mt-2 space-y-2 text-xs text-zinc-400">{selectedPlayer.forecastRoleHistory.map((event) => <li key={event.id}>{FORECAST_ROLES[event.forecast_role]} · {event.actor_name} · {dateLabel(event.created_at)}</li>)}</ul></details> : null}
      </DialogContent>
    </Dialog>
  </section>;
}

function SearchField({ value, onChange }) {
  return <input type="search" aria-label="Rechercher un joueur" placeholder="Rechercher un joueur" value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100" />;
}
