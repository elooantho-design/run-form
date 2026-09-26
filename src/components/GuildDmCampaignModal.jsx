import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, Clock3, Mail, RefreshCw, Send, X, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const MAX_MESSAGE_LENGTH = 1800;

function formatDateTime(value) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function formatFullDateTime(value) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function truncateMessage(value, maxLength = 90) {
  const message = String(value || "").trim().replace(/\s+/g, " ");
  if (message.length <= maxLength) return message;
  return `${message.slice(0, maxLength - 1)}…`;
}

async function fetchGuildDmJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
  return payload;
}

function groupRecipientsByStatus(recipients) {
  return {
    confirmed: recipients.filter((recipient) => recipient.confirmedAt || recipient.status === "confirmed"),
    pending: recipients.filter(
      (recipient) => !recipient.confirmedAt && !["confirmed", "failed"].includes(recipient.status),
    ),
    failed: recipients.filter((recipient) => recipient.status === "failed"),
  };
}

function getTestDeliveryState(detail) {
  const recipient = detail?.recipients?.[0] || null;
  if (!recipient) return { label: "En file", tone: "amber", lastError: "" };
  if (recipient.status === "confirmed" || recipient.confirmedAt) {
    return { label: "Confirmé", tone: "emerald", lastError: "" };
  }
  if (recipient.status === "failed") {
    return { label: "Échec", tone: "red", lastError: recipient.lastError || "Erreur Discord" };
  }
  if (recipient.status === "sent" || recipient.sentAt) {
    return { label: "Envoyé", tone: "sky", lastError: "" };
  }
  return { label: "En file", tone: "amber", lastError: "" };
}

function getStatusBadgeClass(tone) {
  if (tone === "emerald") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (tone === "red") return "border-red-500/30 bg-red-500/10 text-red-200";
  if (tone === "sky") return "border-sky-500/30 bg-sky-500/10 text-sky-200";
  return "border-amber-500/30 bg-amber-500/10 text-amber-200";
}

function RecipientTable({ title, icon, recipients, emptyLabel, renderMeta }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          {icon}
          {title}
        </div>
        <Badge className="rounded-lg border-zinc-700 bg-zinc-950 text-zinc-300">{recipients.length}</Badge>
      </div>
      {recipients.length ? (
        <div className="max-h-64 overflow-y-auto">
          {recipients.map((recipient) => (
            <div
              key={recipient.id}
              className="grid gap-2 border-b border-zinc-900 px-4 py-3 text-sm last:border-b-0 md:grid-cols-[minmax(0,1fr)_90px_minmax(0,180px)]"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-zinc-100">{recipient.memberName}</div>
                <div className="truncate text-xs text-zinc-500">{recipient.discordUserId}</div>
              </div>
              <div className="text-zinc-400">{recipient.guildCode}</div>
              <div className="text-zinc-400">{renderMeta(recipient)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-4 text-sm text-zinc-500">{emptyLabel}</div>
      )}
    </div>
  );
}

export default function GuildDmCampaignModal({ activeGuildCode = "", onClose }) {
  const [tab, setTab] = useState("new");
  const [summary, setSummary] = useState(null);
  const [selectedGuildCodes, setSelectedGuildCodes] = useState([]);
  const [message, setMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [campaignDetail, setCampaignDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [showTests, setShowTests] = useState(false);

  const manageableGuilds = useMemo(() => summary?.manageableGuilds || [], [summary]);
  const campaigns = useMemo(() => summary?.campaigns || [], [summary]);
  const testCampaigns = useMemo(() => summary?.testCampaigns || [], [summary]);
  const schemaReady = summary?.schemaReady !== false;
  const testModeReady = summary?.testModeReady !== false;
  const historyCampaigns = useMemo(() => {
    const rows = showTests ? [...campaigns, ...testCampaigns] : [...campaigns];
    return rows.sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));
  }, [campaigns, showTests, testCampaigns]);

  const selectedGuilds = useMemo(
    () =>
      manageableGuilds.filter((guild) =>
        selectedGuildCodes.some((guildCode) => guildCode === guild.guildCode),
      ),
    [manageableGuilds, selectedGuildCodes],
  );

  const selectedTotals = useMemo(
    () =>
      selectedGuilds.reduce(
        (totals, guild) => ({
          reachable: totals.reachable + Number(guild.reachableMembers || 0),
          missing: totals.missing + Number(guild.missingDiscordMembers || 0),
          total: totals.total + Number(guild.totalActiveMembers || 0),
        }),
        { reachable: 0, missing: 0, total: 0 },
      ),
    [selectedGuilds],
  );

  const detailGroups = useMemo(
    () => groupRecipientsByStatus(campaignDetail?.recipients || []),
    [campaignDetail],
  );
  const testDeliveryState = getTestDeliveryState(campaignDetail?.campaign?.isTest ? campaignDetail : null);

  const loadSummary = useCallback(async ({ keepSelection = true } = {}) => {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchGuildDmJson("/api/portal-guild-dm?action=summary");
      setSummary(payload);
      setNotice(payload.schemaReady === false ? "Migration guild_dm_campaigns non executee." : "");
      const guildCodes = (payload.manageableGuilds || []).map((guild) => guild.guildCode).filter(Boolean);
      setSelectedGuildCodes((previous) => {
        if (keepSelection && previous.some((guildCode) => guildCodes.includes(guildCode))) {
          return previous.filter((guildCode) => guildCodes.includes(guildCode));
        }
        if (activeGuildCode && guildCodes.includes(activeGuildCode)) return [activeGuildCode];
        return guildCodes.slice(0, 1);
      });
    } catch (loadError) {
      setError(loadError?.message || "Chargement des campagnes impossible.");
    } finally {
      setLoading(false);
    }
  }, [activeGuildCode]);

  async function loadCampaignDetail(campaignId) {
    if (!campaignId) return;
    setDetailLoading(true);
    setError("");
    try {
      const payload = await fetchGuildDmJson(
        `/api/portal-guild-dm?action=campaign&campaignId=${encodeURIComponent(campaignId)}`,
      );
      setCampaignDetail(payload);
      setSelectedCampaignId(campaignId);
    } catch (loadError) {
      setError(loadError?.message || "Detail de campagne impossible.");
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    void loadSummary({ keepSelection: false });
  }, [loadSummary]);

  function toggleGuild(guildCode) {
    setConfirmOpen(false);
    setSelectedGuildCodes((previous) =>
      previous.includes(guildCode)
        ? previous.filter((value) => value !== guildCode)
        : [...previous, guildCode],
    );
  }

  async function createCampaign() {
    if (saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = await fetchGuildDmJson("/api/portal-guild-dm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-campaign",
          guildCodes: selectedGuildCodes,
          message,
        }),
      });
      setConfirmOpen(false);
      setMessage("");
      setTab("history");
      setCampaignDetail(payload);
      setSelectedCampaignId(payload.campaign?.id || "");
      setNotice(`Campagne creee : ${payload.campaign?.totalRecipients || selectedTotals.reachable} MP en attente du bot.`);
      await loadSummary({ keepSelection: true });
    } catch (saveError) {
      setError(saveError?.message || "Creation de campagne impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function createTestCampaign() {
    if (testSending) return;
    setTestSending(true);
    setError("");
    setNotice("");
    try {
      const payload = await fetchGuildDmJson("/api/portal-guild-dm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-test-campaign",
          message,
        }),
      });
      setCampaignDetail(payload);
      setSelectedCampaignId(payload.campaign?.id || "");
      setNotice("Test ajouté à la file d'envoi.");
      await loadSummary({ keepSelection: true });
    } catch (testError) {
      setError(testError?.message || "Creation du test impossible.");
    } finally {
      setTestSending(false);
    }
  }

  async function retryPendingRecipients() {
    if (!campaignDetail?.campaign?.id || retrying) return;
    const confirmed = window.confirm("Relancer uniquement les destinataires envoyes qui n'ont pas confirme ?");
    if (!confirmed) return;

    setRetrying(true);
    setError("");
    try {
      const payload = await fetchGuildDmJson("/api/portal-guild-dm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "retry-pending",
          campaignId: campaignDetail.campaign.id,
        }),
      });
      setCampaignDetail(payload);
      setNotice(`${payload.queuedCount || 0} non-confirme(s) remis dans la file d'envoi.`);
      await loadSummary({ keepSelection: true });
    } catch (retryError) {
      setError(retryError?.message || "Relance impossible.");
    } finally {
      setRetrying(false);
    }
  }

  const canPreview =
    schemaReady &&
    selectedGuildCodes.length > 0 &&
    selectedTotals.reachable > 0 &&
    message.trim().length > 0 &&
    message.trim().length <= MAX_MESSAGE_LENGTH;
  const canCreateTest =
    schemaReady &&
    testModeReady &&
    message.trim().length > 0 &&
    message.trim().length <= MAX_MESSAGE_LENGTH;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10">
              <Mail className="h-5 w-5 text-sky-200" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-zinc-50">Messages prives Discord</h3>
              <p className="mt-1 text-sm text-zinc-400">
                Envoie une consigne aux membres joignables et suis les confirmations explicites.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
            disabled={saving || retrying || testSending}
            onClick={onClose}
            title="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-2 border-b border-zinc-800 px-4 pt-4 sm:px-5">
          {[
            ["new", "Nouveau message"],
            ["history", "Historique"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`rounded-t-lg border px-4 py-2 text-sm font-semibold transition ${
                tab === value
                  ? "border-sky-500/40 bg-sky-500/10 text-sky-100"
                  : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-100"
              }`}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {loading ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 text-sm text-zinc-400">
              Chargement...
            </div>
          ) : null}

          {error ? (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          {notice ? (
            <div className="mb-4 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
              {notice}
            </div>
          ) : null}

          {!loading && !schemaReady ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-4 text-sm text-amber-100">
              La migration <span className="font-semibold">guild_dm_campaigns</span> doit etre executee avant d'utiliser les MP de guilde.
            </div>
          ) : null}

          {!loading && schemaReady && tab === "new" ? (
            <div className="space-y-5">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Guildes</div>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {manageableGuilds.map((guild) => {
                    const selected = selectedGuildCodes.includes(guild.guildCode);
                    return (
                      <button
                        key={guild.guildCode}
                        type="button"
                        className={`rounded-lg border p-4 text-left transition ${
                          selected
                            ? "border-sky-400/60 bg-sky-500/10"
                            : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-600"
                        }`}
                        onClick={() => toggleGuild(guild.guildCode)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-semibold text-zinc-100">{guild.guildCode}</div>
                          <div
                            className={`flex h-5 w-5 items-center justify-center rounded border ${
                              selected ? "border-sky-300 bg-sky-400 text-zinc-950" : "border-zinc-700"
                            }`}
                          >
                            {selected ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                          </div>
                        </div>
                        <div className="mt-2 text-sm text-zinc-400">
                          {guild.reachableMembers}/{guild.totalActiveMembers} joignables
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          {guild.missingDiscordMembers} sans ID Discord
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs uppercase tracking-[0.18em] text-zinc-500">Message</span>
                  <span className={`text-xs ${message.length > MAX_MESSAGE_LENGTH ? "text-red-300" : "text-zinc-500"}`}>
                    {message.length}/{MAX_MESSAGE_LENGTH}
                  </span>
                </div>
                <textarea
                  value={message}
                  onChange={(event) => {
                    setConfirmOpen(false);
                    setMessage(event.target.value);
                  }}
                  rows={8}
                  placeholder="Consigne importante pour cette GvG..."
                  className="mt-2 w-full resize-y rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-3 text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/20"
                />
              </label>

              {!testModeReady ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  La migration <span className="font-semibold">guild_dm_campaigns_test_mode</span> doit etre executee avant d'envoyer un test.
                </div>
              ) : null}

              <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 text-sm text-zinc-300">
                <div className="font-semibold text-zinc-100">Apercu d'envoi</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <div>{selectedGuildCodes.length} guilde(s)</div>
                  <div>{selectedTotals.reachable} MP joignables</div>
                  <div>{selectedTotals.missing} sans ID Discord</div>
                </div>
                {selectedTotals.reachable === 0 ? (
                  <div className="mt-3 flex items-center gap-2 text-amber-200">
                    <AlertTriangle className="h-4 w-4" />
                    Aucun destinataire joignable dans la selection.
                  </div>
                ) : null}
              </div>

              {confirmOpen ? (
                <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-4">
                  <div className="font-semibold text-sky-100">Confirmer l'envoi</div>
                  <div className="mt-2 text-sm leading-6 text-sky-100/90">
                    Envoyer ce message a <span className="font-semibold">{selectedGuildCodes.join(", ")}</span> :{" "}
                    <span className="font-semibold">{selectedTotals.reachable} MP</span>.{" "}
                    {selectedTotals.missing} membre(s) sans ID Discord seront ignores.
                  </div>
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-lg border-zinc-700 text-zinc-200"
                      disabled={saving}
                      onClick={() => setConfirmOpen(false)}
                    >
                      Annuler
                    </Button>
                    <Button
                      type="button"
                      className="rounded-lg bg-sky-500 text-zinc-950 hover:bg-sky-400"
                      disabled={saving}
                      onClick={createCampaign}
                    >
                      <Send className="mr-2 h-4 w-4" />
                      {saving ? "Creation..." : `Envoyer ${selectedTotals.reachable} MP`}
                    </Button>
                  </div>
                </div>
              ) : null}

              {campaignDetail?.campaign?.isTest ? (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge className="rounded-lg border-purple-500/30 bg-purple-500/10 text-purple-200">TEST</Badge>
                        <span className="text-sm font-semibold text-zinc-100">Dernier test</span>
                      </div>
                      <div className="mt-2 text-sm text-zinc-400">
                        {formatFullDateTime(campaignDetail.campaign.createdAt)}
                      </div>
                    </div>
                    <Badge className={`rounded-lg py-1.5 ${getStatusBadgeClass(testDeliveryState.tone)}`}>
                      {testDeliveryState.label}
                    </Badge>
                  </div>
                  {testDeliveryState.lastError ? (
                    <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                      {testDeliveryState.lastError}
                    </div>
                  ) : null}
                  <div className="mt-4 flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-lg border-zinc-700 px-3 text-zinc-200"
                      disabled={detailLoading}
                      onClick={() => loadCampaignDetail(campaignDetail.campaign.id)}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Actualiser le test
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {!loading && schemaReady && tab === "history" ? (
            <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Historique</div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg border-zinc-700 px-3 text-zinc-200"
                    onClick={() => loadSummary({ keepSelection: true })}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Actualiser
                  </Button>
                </div>
                {testCampaigns.length ? (
                  <label className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={showTests}
                      onChange={(event) => setShowTests(event.target.checked)}
                      className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-sky-500"
                    />
                    Afficher les tests
                    <Badge className="ml-auto rounded-lg border-purple-500/30 bg-purple-500/10 text-purple-200">
                      {testCampaigns.length}
                    </Badge>
                  </label>
                ) : null}
                {historyCampaigns.length ? (
                  historyCampaigns.map((campaign) => (
                    <button
                      key={campaign.id}
                      type="button"
                      className={`block w-full rounded-lg border p-4 text-left transition ${
                        selectedCampaignId === campaign.id
                          ? "border-sky-400/60 bg-sky-500/10"
                          : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-600"
                      }`}
                      onClick={() => loadCampaignDetail(campaign.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2 font-semibold text-zinc-100">
                            {formatDateTime(campaign.createdAt)}
                            {campaign.isTest ? (
                              <Badge className="rounded-lg border-purple-500/30 bg-purple-500/10 text-purple-200">TEST</Badge>
                            ) : null}
                          </div>
                          <div className="mt-1 text-xs text-zinc-500">{campaign.targetGuildCodes.join(" · ")}</div>
                        </div>
                        <Badge className="rounded-lg border-zinc-700 bg-zinc-950 text-zinc-300">
                          {campaign.status}
                        </Badge>
                      </div>
                      <div className="mt-3 text-sm text-zinc-300">"{truncateMessage(campaign.messagePreview || campaign.message)}"</div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-400">
                        <span>OK {campaign.confirmedCount}</span>
                        <span>Attente {campaign.pendingCount}</span>
                        <span>Echecs {campaign.failedCount}</span>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-zinc-500">
                    Aucune campagne pour le moment.
                  </div>
                )}
              </div>

              <div className="min-w-0">
                {detailLoading ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-zinc-400">
                    Chargement du detail...
                  </div>
                ) : null}

                {campaignDetail?.campaign ? (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Campagne</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-lg font-semibold text-zinc-50">
                            {formatFullDateTime(campaignDetail.campaign.createdAt)}
                            {campaignDetail.campaign.isTest ? (
                              <Badge className="rounded-lg border-purple-500/30 bg-purple-500/10 text-purple-200">TEST</Badge>
                            ) : null}
                          </div>
                          <div className="mt-1 text-sm text-zinc-400">
                            {campaignDetail.campaign.targetGuildCodes.join(" · ")}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-lg border-zinc-700 text-zinc-200"
                          onClick={() => loadCampaignDetail(campaignDetail.campaign.id)}
                        >
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Actualiser
                        </Button>
                      </div>

                      <div className="mt-4 whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm leading-6 text-zinc-200">
                        {campaignDetail.campaign.message}
                      </div>

                      <div className="mt-4 grid gap-2 sm:grid-cols-4">
                        <Badge className="justify-center rounded-lg border-zinc-700 bg-zinc-950 py-2 text-zinc-200">
                          {campaignDetail.campaign.totalRecipients} destinataires
                        </Badge>
                        <Badge className="justify-center rounded-lg border-emerald-500/30 bg-emerald-500/10 py-2 text-emerald-200">
                          {campaignDetail.campaign.confirmedCount} confirmes
                        </Badge>
                        <Badge className="justify-center rounded-lg border-amber-500/30 bg-amber-500/10 py-2 text-amber-200">
                          {campaignDetail.campaign.pendingCount} en attente
                        </Badge>
                        <Badge className="justify-center rounded-lg border-red-500/30 bg-red-500/10 py-2 text-red-200">
                          {campaignDetail.campaign.failedCount} echecs
                        </Badge>
                      </div>

                      <div className="mt-4 flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-lg border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20"
                          disabled={retrying || detailGroups.pending.filter((recipient) => recipient.status === "sent").length === 0}
                          onClick={retryPendingRecipients}
                        >
                          <Bell className="mr-2 h-4 w-4" />
                          {retrying ? "Relance..." : "Relancer les non-confirmes"}
                        </Button>
                      </div>
                    </div>

                    <RecipientTable
                      title="Confirmes"
                      icon={<CheckCircle2 className="h-4 w-4 text-emerald-300" />}
                      recipients={detailGroups.confirmed}
                      emptyLabel="Aucune confirmation pour le moment."
                      renderMeta={(recipient) => formatDateTime(recipient.confirmedAt)}
                    />
                    <RecipientTable
                      title="En attente"
                      icon={<Clock3 className="h-4 w-4 text-amber-300" />}
                      recipients={detailGroups.pending}
                      emptyLabel="Aucun destinataire en attente."
                      renderMeta={(recipient) =>
                        recipient.status === "queued" ? "En file" : recipient.lastSentAt || recipient.sentAt ? formatDateTime(recipient.lastSentAt || recipient.sentAt) : "Non envoye"
                      }
                    />
                    <RecipientTable
                      title="Echecs"
                      icon={<XCircle className="h-4 w-4 text-red-300" />}
                      recipients={detailGroups.failed}
                      emptyLabel="Aucun echec d'envoi."
                      renderMeta={(recipient) => recipient.lastError || "Erreur Discord"}
                    />
                  </div>
                ) : (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-5 text-sm text-zinc-500">
                    Selectionne une campagne pour voir les confirmations.
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-800 p-4 sm:p-5">
          {tab === "new" ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-purple-500/40 bg-purple-500/10 text-purple-100 hover:bg-purple-500/20"
                disabled={!canCreateTest || saving || testSending}
                onClick={createTestCampaign}
              >
                <Send className="mr-2 h-4 w-4" />
                {testSending ? "Ajout du test..." : "M'envoyer un test"}
              </Button>
              <Button
                type="button"
                className="rounded-lg bg-sky-500 text-zinc-950 hover:bg-sky-400"
                disabled={!canPreview || saving || testSending}
                onClick={() => setConfirmOpen(true)}
              >
                <Send className="mr-2 h-4 w-4" />
                Apercu avant envoi
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="rounded-lg border-zinc-700 text-zinc-200"
            disabled={saving || retrying || testSending}
            onClick={onClose}
          >
            Fermer
          </Button>
        </div>
      </div>
    </div>
  );
}
