import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, CheckCircle2, Download, RefreshCw, Send, X, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getGuildDisplayName } from "@/lib/guildDisplay";

const DEFAULT_SURVEY_ONE_MESSAGE = `⚔️ Cluster Paladin — Préparation de la prochaine saison

Bonjour !

Nous commençons à préparer la prochaine saison et, avant de définir les objectifs des différentes guildes du cluster, nous souhaitons recueillir ton avis.

Attention : ce message n'est pas encore le sondage d'inter-saison qui déterminera ta future guilde.

Le sondage d'affectation viendra dans un second temps.

Pour préparer celui-ci, nous souhaitons comprendre tes ambitions, tes attentes et l'environnement dans lequel tu aimerais évoluer la saison prochaine.

L'objectif est de construire les futurs objectifs de nos guildes à partir des envies des joueurs, plutôt que de vous imposer des orientations décidées à l'avance.

Quel objectif aimerais-tu que ta guilde poursuive la saison prochaine, et dans quel environnement souhaiterais-tu évoluer pour prendre plaisir à jouer ?

Tu peux répondre librement, en quelques mots ou en développant ta réflexion.

Merci pour ta participation !`;

function getApiBase() {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:3001";
}

async function callPortalIntersaison(payload) {
  const response = await fetch(`${getApiBase()}/api/portal-intersaison`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `Erreur Portal (${response.status})`);
  }
  return data;
}

function formatDateTime(value) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function getMemberToneClass(color) {
  if (color === "green") return "border-emerald-400/40 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/20";
  if (color === "orange") return "border-orange-400/40 bg-orange-500/15 text-orange-100 hover:bg-orange-500/20";
  if (color === "red") return "border-red-400/40 bg-red-500/15 text-red-100 hover:bg-red-500/20";
  return "border-zinc-700 bg-zinc-950/80 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-900";
}

function getStatusBadgeClass(color) {
  if (color === "green") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (color === "orange") return "border-orange-500/30 bg-orange-500/10 text-orange-200";
  if (color === "red") return "border-red-500/30 bg-red-500/10 text-red-200";
  return "border-zinc-700 bg-zinc-900 text-zinc-300";
}

function getSurveyStatusLabel(center, pollNumber) {
  const campaign = (center?.campaigns || []).find((row) => Number(row.pollNumber) === Number(pollNumber));
  if (!center?.surveySchemaReady) return "Migration requise";
  if (!center?.season) return "Aucune inter-saison active";
  if (!campaign) return pollNumber === 1 ? "Sondage 1 — En préparation" : "Sondage 2 — En préparation";
  if (campaign.status === "open") return `${campaign.title} — En cours`;
  if (campaign.status === "closed") return `${campaign.title} — Clôturé`;
  return `${campaign.title} — ${campaign.status}`;
}

function serializeGuildCardsForPoll(center, pollNumber) {
  if (Number(pollNumber) === 1) return center?.guildCards || [];
  return (center?.guilds || []).map((guild) => {
    const guildCode = guild.guild_code || guild.guildCode || "";
    const members = (center?.members || [])
      .filter((member) => String(member.guild_code || "") === String(guildCode))
      .sort((left, right) =>
        String(left.watcher_name || "").localeCompare(String(right.watcher_name || ""), "fr", {
          sensitivity: "base",
        }),
      )
      .map((member) => ({
        id: member.id,
        watcherName: member.watcher_name || "",
        discordId: member.discord_id || "",
        guildCode,
        delivery: {
          color: "neutral",
          status: "not_included",
          label: "Non inclus",
          detail: "Sondage 2 préparé, campagne non lancée",
        },
      }));

    return {
      guild,
      guildCode,
      displayName: guild.display_name || guildCode,
      totalMembers: members.length,
      targeted: 0,
      responded: 0,
      members,
    };
  });
}

export default function PortalIntersaisonSurveyCenter({ organizationFallback = null }) {
  const [center, setCenter] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [selectedPoll, setSelectedPoll] = useState(1);
  const [messageDraft, setMessageDraft] = useState(DEFAULT_SURVEY_ONE_MESSAGE);
  const [confirmLaunchOpen, setConfirmLaunchOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const organization = center?.organization || organizationFallback || null;
  const selectedCampaign = useMemo(
    () => (center?.campaigns || []).find((row) => Number(row.pollNumber) === Number(selectedPoll)) || null,
    [center?.campaigns, selectedPoll],
  );
  const guildCards = useMemo(() => serializeGuildCardsForPoll(center, selectedPoll), [center, selectedPoll]);
  const totalMembers = useMemo(
    () => guildCards.reduce((sum, card) => sum + Number(card.totalMembers || 0), 0),
    [guildCards],
  );
  const totalTargeted = useMemo(
    () => guildCards.reduce((sum, card) => sum + Number(card.targeted || 0), 0),
    [guildCards],
  );
  const totalResponded = useMemo(
    () => guildCards.reduce((sum, card) => sum + Number(card.responded || 0), 0),
    [guildCards],
  );

  const getGuildLabel = useCallback(
    (guildCode, fallback = "-") =>
      getGuildDisplayName({
        guildCode,
        guilds: center?.guilds || [],
        organizationId: organization?.id,
        organizationKey: organization?.organization_key || organization?.organizationKey,
        emptyFallback: fallback,
      }),
    [center?.guilds, organization?.id, organization?.organizationKey, organization?.organization_key],
  );

  const loadCenter = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await callPortalIntersaison({ action: "load-survey-center" });
      setCenter(data.surveyCenter || null);
      setMessageDraft(data.surveyCenter?.defaultSurveyOneMessage || DEFAULT_SURVEY_ONE_MESSAGE);
    } catch (loadError) {
      setError(loadError?.message || "Chargement du centre inter-saison impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCenter();
  }, [loadCenter]);

  async function launchSurveyOne() {
    if (launching) return;
    setLaunching(true);
    setError("");
    setNotice("");
    try {
      const data = await callPortalIntersaison({
        action: "launch-survey-one",
        message: messageDraft,
      });
      setCenter(data.surveyCenter || null);
      setConfirmLaunchOpen(false);
      setNotice("Sondage 1 ajouté à la file Discord. Le bot enverra les MP progressivement.");
    } catch (launchError) {
      setError(launchError?.message || "Lancement du sondage impossible.");
    } finally {
      setLaunching(false);
    }
  }

  async function queueRecipient(member) {
    if (!member?.surveyRecipient?.id || reminding) return;
    setReminding(true);
    setError("");
    setNotice("");
    try {
      const data = await callPortalIntersaison({
        action: "queue-survey-recipient",
        surveyRecipientId: member.surveyRecipient.id,
      });
      setCenter(data.surveyCenter || null);
      setSelectedMember(null);
      setNotice("Joueur remis dans la file Discord.");
    } catch (queueError) {
      setError(queueError?.message || "Relance impossible.");
    } finally {
      setReminding(false);
    }
  }

  async function queueCollectiveReminders() {
    if (!selectedCampaign?.id || reminding) return;
    const confirmed = window.confirm("Lancer les relances collectives pour les joueurs sans réponse ?");
    if (!confirmed) return;

    setReminding(true);
    setError("");
    setNotice("");
    try {
      const data = await callPortalIntersaison({
        action: "queue-survey-reminders",
        surveyCampaignId: selectedCampaign.id,
      });
      setCenter(data.surveyCenter || null);
      setNotice(`${data.queuedCount || 0} destinataire(s) remis dans la file Discord.`);
    } catch (queueError) {
      setError(queueError?.message || "Relances collectives impossibles.");
    } finally {
      setReminding(false);
    }
  }

  async function exportSurveyOne() {
    setError("");
    try {
      const data = await callPortalIntersaison({ action: "export-survey-one" });
      const blob = new Blob([data.content || ""], { type: data.contentType || "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = data.fileName || "intersaison-sondage-1.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError?.message || "Export impossible.");
    }
  }

  async function finishSurveySeason() {
    if (!center?.season?.id || finishing) return;
    const confirmed = window.confirm(
      "Clôturer cette inter-saison ? Les campagnes ouvertes seront fermées et une nouvelle inter-saison pourra ensuite être démarrée.",
    );
    if (!confirmed) return;

    setFinishing(true);
    setError("");
    setNotice("");
    try {
      const data = await callPortalIntersaison({
        action: "finish-survey-season",
        seasonId: center.season.id,
      });
      setCenter(data.surveyCenter || null);
      setNotice("Inter-saison clôturée. Une nouvelle campagne pourra être lancée.");
    } catch (finishError) {
      setError(finishError?.message || "Clôture de l'inter-saison impossible.");
    } finally {
      setFinishing(false);
    }
  }

  return (
    <Card className="overflow-hidden rounded-xl border-zinc-800 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.16),transparent_34%),linear-gradient(135deg,#050505,#0b0b0f_55%,#09090b)] shadow-2xl">
      <CardHeader className="gap-4 border-b border-zinc-800/80">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-300">Centre de pilotage</div>
            <CardTitle className="mt-1 text-2xl text-zinc-50">Inter-saison</CardTitle>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              Vue temps réel des effectifs actuels, des campagnes Discord et des réponses joueur.
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-lg border-zinc-700 bg-zinc-950/80 text-zinc-100"
              onClick={loadCenter}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Actualiser
            </Button>
            {selectedCampaign?.status === "open" ? (
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20"
                disabled={reminding}
                onClick={queueCollectiveReminders}
              >
                <Bell className="h-4 w-4" />
                Relances collectives
              </Button>
            ) : null}
            {selectedPoll === 1 && selectedCampaign ? (
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-emerald-500/40 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
                onClick={exportSurveyOne}
              >
                <Download className="h-4 w-4" />
                Exporter les réponses
              </Button>
            ) : null}
            {center?.season?.id ? (
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-red-500/40 bg-red-500/10 text-red-100 hover:bg-red-500/20"
                disabled={finishing}
                onClick={finishSurveySeason}
              >
                <XCircle className="h-4 w-4" />
                Clôturer l'inter-saison
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 p-4 sm:p-5">
        {error ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
            {notice}
          </div>
        ) : null}
        {!loading && center?.surveySchemaReady === false ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-100">
            Migration inter-saison sondages non exécutée. Les effectifs restent visibles, mais le lancement et le suivi des campagnes sont bloqués.
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex flex-wrap gap-2">
            {[
              [1, "Sondage 1 — Consultation des objectifs"],
              [2, "Sondage 2 — Choix de guilde"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSelectedPoll(value)}
                className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                  selectedPoll === value
                    ? "border-sky-400/60 bg-sky-500/15 text-sky-100"
                    : "border-zinc-800 bg-zinc-950/70 text-zinc-400 hover:text-zinc-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <Badge className="justify-center rounded-lg border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sky-100">
            {getSurveyStatusLabel(center, selectedPoll)}
          </Badge>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Effectif actuel</div>
            <div className="mt-1 text-2xl font-semibold text-zinc-50">{totalMembers}</div>
            <div className="text-sm text-zinc-500">{organization?.display_name || "Organisation"}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Ciblés campagne</div>
            <div className="mt-1 text-2xl font-semibold text-zinc-50">{totalTargeted}</div>
            <div className="text-sm text-zinc-500">sur le sondage sélectionné</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Réponses</div>
            <div className="mt-1 text-2xl font-semibold text-zinc-50">
              {totalResponded} / {totalTargeted || 0}
            </div>
            <div className="text-sm text-zinc-500">participation enregistrée</div>
          </div>
        </div>

        {selectedPoll === 1 && !selectedCampaign && center?.surveySchemaReady !== false ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-zinc-100">Préparer le sondage 1</div>
                <p className="mt-1 text-sm text-zinc-500">
                  Le lancement créera une campagne DM dans la file existante. Aucun envoi ne part avant confirmation.
                </p>
              </div>
              <Button
                type="button"
                className="rounded-lg bg-sky-500 text-zinc-950 hover:bg-sky-400"
                disabled={launching || !messageDraft.trim()}
                onClick={() => setConfirmLaunchOpen(true)}
              >
                <Send className="h-4 w-4" />
                Lancer le sondage 1
              </Button>
            </div>
            <textarea
              value={messageDraft}
              onChange={(event) => setMessageDraft(event.target.value)}
              rows={9}
              className="mt-4 w-full resize-y rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-3 text-sm leading-6 text-zinc-100 outline-none focus:border-sky-400/60"
            />
            {confirmLaunchOpen ? (
              <div className="mt-4 rounded-lg border border-sky-500/30 bg-sky-500/10 p-4">
                <div className="font-semibold text-sky-100">Confirmer le lancement du sondage 1 ?</div>
                <div className="mt-2 text-sm text-sky-100/90">
                  Les joueurs actifs des guildes affichées seront placés dans la file DM progressive.
                </div>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-lg border-zinc-700 text-zinc-200"
                    disabled={launching}
                    onClick={() => setConfirmLaunchOpen(false)}
                  >
                    Annuler
                  </Button>
                  <Button
                    type="button"
                    className="rounded-lg bg-sky-500 text-zinc-950 hover:bg-sky-400"
                    disabled={launching}
                    onClick={launchSurveyOne}
                  >
                    {launching ? "Création..." : "Confirmer"}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {selectedPoll === 2 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 text-sm leading-6 text-zinc-400">
            Sondage 2 préparé côté architecture : les objectifs par guilde et le choix de future guilde seront branchés après validation du sondage 1.
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
          {guildCards.map((card, index) => (
            <div
              key={card.guildCode || index}
              className="group overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/80 shadow-lg shadow-black/20 transition hover:border-sky-500/40"
            >
              <div className="border-b border-zinc-800 bg-gradient-to-r from-zinc-900 via-zinc-900 to-sky-950/30 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-sky-300">Guilde</div>
                    <div className="mt-1 text-lg font-semibold text-zinc-50">
                      {getGuildLabel(card.guildCode, card.displayName)}
                    </div>
                  </div>
                  <Badge className="rounded-lg border-zinc-700 bg-zinc-950 text-zinc-200">
                    {card.totalMembers}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Badge className="rounded-lg border-zinc-700 bg-zinc-950 text-zinc-300">
                    Ciblés {card.targeted}
                  </Badge>
                  <Badge className="rounded-lg border-emerald-500/30 bg-emerald-500/10 text-emerald-200">
                    Réponses {card.responded}
                  </Badge>
                </div>
              </div>
              <div className="max-h-[360px] space-y-2 overflow-y-auto p-3">
                {card.members.length ? (
                  card.members.map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => setSelectedMember(member)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition ${getMemberToneClass(member.delivery.color)}`}
                    >
                      <span className="min-w-0 truncate font-medium">{member.watcherName || "-"}</span>
                      <span className="shrink-0 text-[11px] opacity-80">{member.delivery.label}</span>
                    </button>
                  ))
                ) : (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3 text-sm text-zinc-500">
                    Aucun membre actif.
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {selectedCampaign ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/80">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              onClick={() => setTrackingOpen((current) => !current)}
            >
              <span className="font-semibold text-zinc-100">Suivi détaillé des messages</span>
              <Badge className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-300">
                {trackingOpen ? "Masquer" : "Afficher"}
              </Badge>
            </button>
            {trackingOpen ? (
              <div className="border-t border-zinc-800 p-4">
                <div className="max-h-96 overflow-y-auto">
                  {(center?.recipients || []).map((recipient) => (
                    <div
                      key={recipient.id}
                      className="grid gap-2 border-b border-zinc-900 px-1 py-3 text-sm last:border-b-0 md:grid-cols-[minmax(0,1fr)_90px_110px_130px_minmax(0,1fr)]"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-zinc-100">{recipient.memberName}</div>
                        <div className="truncate text-xs text-zinc-500">{recipient.discordUserId || "ID Discord absent"}</div>
                      </div>
                      <div className="text-zinc-400">{getGuildLabel(recipient.guildCode, recipient.guildCode)}</div>
                      <Badge className={`w-fit rounded-lg ${getStatusBadgeClass(recipient.responseStatus === "responded" ? "green" : recipient.deliveryStatus === "sent" ? "orange" : recipient.deliveryStatus === "not_included" ? "neutral" : "red")}`}>
                        {recipient.responseStatus === "responded" ? "Répondu" : recipient.deliveryStatus}
                      </Badge>
                      <div className="text-zinc-400">{formatDateTime(recipient.respondedAt || recipient.lastSentAt)}</div>
                      <div className="min-w-0 truncate text-zinc-500">
                        {recipient.response?.objectiveText || recipient.lastError || "-"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {selectedMember ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Joueur</div>
                  <div className="mt-1 text-xl font-semibold text-zinc-50">{selectedMember.watcherName}</div>
                  <div className="text-sm text-zinc-500">{getGuildLabel(selectedMember.guildCode, selectedMember.guildCode)}</div>
                </div>
                <button
                  type="button"
                  className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
                  onClick={() => setSelectedMember(null)}
                  title="Fermer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
                  <span className="text-zinc-400">Statut</span>
                  <Badge className={`rounded-lg ${getStatusBadgeClass(selectedMember.delivery.color)}`}>
                    {selectedMember.delivery.label}
                  </Badge>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3 text-zinc-300">
                  {selectedMember.delivery.detail}
                </div>
                {selectedMember.response?.objectiveText ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-100">
                    <div className="mb-2 flex items-center gap-2 font-semibold">
                      <CheckCircle2 className="h-4 w-4" />
                      Réponse enregistrée
                    </div>
                    <div className="whitespace-pre-wrap leading-6">{selectedMember.response.objectiveText}</div>
                  </div>
                ) : selectedMember.delivery.color === "orange" ? (
                  <Button
                    type="button"
                    className="w-full rounded-lg bg-amber-500 text-zinc-950 hover:bg-amber-400"
                    disabled={reminding}
                    onClick={() => queueRecipient(selectedMember)}
                  >
                    <Bell className="h-4 w-4" />
                    Envoyer un rappel
                  </Button>
                ) : selectedMember.delivery.color === "red" ? (
                  <Button
                    type="button"
                    className="w-full rounded-lg bg-red-600 text-white hover:bg-red-500"
                    disabled={reminding}
                    onClick={() => queueRecipient(selectedMember)}
                  >
                    <XCircle className="h-4 w-4" />
                    Réessayer l'envoi
                  </Button>
                ) : (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3 text-zinc-500">
                    Aucune action disponible pour ce statut.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 text-sm text-zinc-400">
            Chargement du centre de pilotage...
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
