import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Edit3, RefreshCw, ShieldCheck, UserPlus, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePortalLanguage } from "@/lib/portalLanguage";

const ROLE_OPTIONS = [
  { value: "community_member", labelKey: "community.roleMember", fallback: "Membre communaute" },
  { value: "content_creator", labelKey: "community.roleCreator", fallback: "Createur de contenu" },
];

const LANGUAGE_OPTIONS = [
  { value: "fr", label: "FR" },
  { value: "en", label: "EN" },
];

const REQUEST_STATUS_META = {
  pending: {
    labelKey: "community.requestPending",
    fallback: "En attente",
    className: "border-amber-400/30 bg-amber-950/35 text-amber-100",
  },
  accepted: {
    labelKey: "community.requestAccepted",
    fallback: "Acceptee",
    className: "border-emerald-400/30 bg-emerald-950/35 text-emerald-100",
  },
  refused: {
    labelKey: "community.requestRefused",
    fallback: "Refusee",
    className: "border-red-400/30 bg-red-950/35 text-red-100",
  },
};

const MEMBER_STATUS_META = {
  active: {
    labelKey: "community.memberActive",
    fallback: "Actif",
    className: "border-emerald-400/30 bg-emerald-950/35 text-emerald-100",
  },
  inactive: {
    labelKey: "community.memberInactive",
    fallback: "Inactif",
    className: "border-zinc-600 bg-zinc-900 text-zinc-300",
  },
};

function getApiBase(apiBase) {
  if (apiBase) return apiBase;
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

function roleLabel(role, t) {
  const option = ROLE_OPTIONS.find((item) => item.value === role) || ROLE_OPTIONS[0];
  return t(option.labelKey, option.fallback);
}

function formatDate(value) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function createDraftFromRequest(request) {
  const contact = String(request?.discordContact || "").trim();
  const isDiscordId = /^\d{15,25}$/.test(contact);

  return {
    requestId: request?.id || "",
    watcherName: isDiscordId ? "" : contact,
    discordId: isDiscordId ? contact : "",
    preferredLanguage: request?.preferredLanguage || "fr",
    role: "community_member",
  };
}

function createDraftFromMember(member) {
  return {
    memberId: member?.id || "",
    watcherName: member?.watcherName || member?.name || "",
    discordId: member?.discordId || "",
    preferredLanguage: member?.preferredLanguage || "fr",
    role: member?.role || "community_member",
    status: member?.status || "active",
  };
}

function StatusBadge({ meta, fallback }) {
  const { t } = usePortalLanguage();
  const resolvedMeta = meta || {
    labelKey: "",
    fallback,
    className: "border-zinc-700 bg-zinc-900 text-zinc-300",
  };

  return (
    <Badge className={`${resolvedMeta.className} rounded-full px-2.5 py-1 text-[0.7rem] font-semibold`}>
      {resolvedMeta.labelKey ? t(resolvedMeta.labelKey, resolvedMeta.fallback) : resolvedMeta.fallback}
    </Badge>
  );
}

export default function CommunityMembersTab({ session, apiBase }) {
  const { t } = usePortalLanguage();
  const [requests, setRequests] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [message, setMessage] = useState("");
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [memberDraft, setMemberDraft] = useState(null);
  const [memberEditor, setMemberEditor] = useState(null);
  const [temporaryPassword, setTemporaryPassword] = useState("");

  const actorMemberId = session?.memberId || session?.id || "";
  const pendingRequests = useMemo(
    () => requests.filter((request) => request.status === "pending"),
    [requests],
  );

  async function post(action, payload = {}) {
    const response = await fetch(`${getApiBase(apiBase)}/api/portal-access`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        actorMemberId,
        ...payload,
      }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json?.error || "Action impossible.");
    return json;
  }

  async function loadData() {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await post("community-list");
      setRequests(data.requests || []);
      setMembers(data.members || []);
    } catch (error) {
      setErrorMessage(error?.message || t("community.loadError", "Chargement impossible."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorMemberId]);

  function openRequest(request) {
    setSelectedRequest(request);
    setMemberDraft(createDraftFromRequest(request));
    setTemporaryPassword("");
    setMessage("");
    setErrorMessage("");
  }

  function closeRequest() {
    setSelectedRequest(null);
    setMemberDraft(null);
    setTemporaryPassword("");
  }

  function closeEditor() {
    setMemberEditor(null);
    setTemporaryPassword("");
  }

  async function updateRequestStatus(request, status) {
    setSaving(true);
    setMessage("");
    setErrorMessage("");
    try {
      const data = await post("community-update-request", {
        requestId: request.id,
        status,
      });
      setRequests((previous) =>
        previous.map((item) => (item.id === data.request?.id ? data.request : item)),
      );
      if (selectedRequest?.id === data.request?.id) {
        setSelectedRequest(data.request);
      }
      setMessage(t("community.requestUpdated", "Demande mise a jour."));
    } catch (error) {
      setErrorMessage(error?.message || t("community.saveError", "Enregistrement impossible."));
    } finally {
      setSaving(false);
    }
  }

  async function createMember(event) {
    event.preventDefault();
    const draft = memberDraft || memberEditor;
    if (!draft) return;

    setSaving(true);
    setMessage("");
    setErrorMessage("");
    setTemporaryPassword("");
    try {
      const data = await post("community-create-member", draft);
      setMembers((previous) => [
        data.member,
        ...previous.filter((member) => member.id !== data.member.id),
      ]);
      if (data.request) {
        setRequests((previous) =>
          previous.map((request) => (request.id === data.request.id ? data.request : request)),
        );
        setSelectedRequest(data.request);
      }
      if (memberEditor && !memberEditor.memberId) {
        setMemberEditor(createDraftFromMember(data.member));
      }
      setTemporaryPassword(data.temporaryPassword || "");
      setMessage(t("community.memberCreated", "Compte communaute cree."));
    } catch (error) {
      setErrorMessage(error?.message || t("community.saveError", "Enregistrement impossible."));
    } finally {
      setSaving(false);
    }
  }

  async function updateMember(event) {
    event.preventDefault();
    if (!memberEditor) return;

    setSaving(true);
    setMessage("");
    setErrorMessage("");
    try {
      const data = await post("community-update-member", memberEditor);
      setMembers((previous) =>
        previous.map((member) => (member.id === data.member?.id ? data.member : member)),
      );
      setMemberEditor(data.member ? createDraftFromMember(data.member) : memberEditor);
      setMessage(t("community.memberUpdated", "Membre mis a jour."));
    } catch (error) {
      setErrorMessage(error?.message || t("community.saveError", "Enregistrement impossible."));
    } finally {
      setSaving(false);
    }
  }

  async function resetMemberPassword() {
    if (!memberEditor?.memberId) return;

    setResettingPassword(true);
    setMessage("");
    setErrorMessage("");
    setTemporaryPassword("");
    try {
      const data = await post("community-reset-member-password", {
        memberId: memberEditor.memberId,
      });
      if (data.member) {
        setMembers((previous) =>
          previous.map((member) => (member.id === data.member.id ? data.member : member)),
        );
        setMemberEditor(createDraftFromMember(data.member));
      }
      setTemporaryPassword(data.temporaryPassword || "");
      setMessage(t("community.passwordReset", "Mot de passe provisoire regenere."));
    } catch (error) {
      setErrorMessage(error?.message || t("community.saveError", "Enregistrement impossible."));
    } finally {
      setResettingPassword(false);
    }
  }

  async function quickToggleMember(member) {
    const nextStatus = member.status === "inactive" ? "active" : "inactive";
    setSaving(true);
    setMessage("");
    setErrorMessage("");
    try {
      const data = await post("community-update-member", {
        ...createDraftFromMember(member),
        status: nextStatus,
      });
      setMembers((previous) =>
        previous.map((item) => (item.id === data.member?.id ? data.member : item)),
      );
      setMessage(
        nextStatus === "active"
          ? t("community.memberReactivated", "Membre reactive.")
          : t("community.memberDeactivated", "Membre desactive."),
      );
    } catch (error) {
      setErrorMessage(error?.message || t("community.saveError", "Enregistrement impossible."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-cyan-300">
              <ShieldCheck className="h-4 w-4" />
              {t("community.eyebrow", "Acces leader")}
            </div>
            <h2 className="mt-2 text-2xl font-semibold text-zinc-50">
              {t("community.title", "Membres communaute")}
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-zinc-400">
              {t(
                "community.description",
                "Gere les demandes creees depuis le login et les comptes communaute independants des guildes clientes.",
              )}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
            onClick={loadData}
            disabled={loading}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {t("common.refresh", "Rafraichir")}
          </Button>
        </div>

        {errorMessage ? (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-950/40 px-3 py-2 text-sm text-red-100">
            {errorMessage}
          </div>
        ) : null}
        {message ? (
          <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-100">
            {message}
          </div>
        ) : null}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-zinc-50">
                {t("community.requestsTitle", "Demandes de creation")}
              </h3>
              <p className="text-sm text-zinc-500">
                {t("community.requestsHelp", "Les demandes envoyees depuis le login arrivent ici.")}
              </p>
            </div>
            <Badge className="rounded-full border border-amber-400/30 bg-amber-950/40 text-amber-100">
              {pendingRequests.length}
            </Badge>
          </div>

          <div className="mt-4 space-y-3">
            {requests.length ? (
              requests.map((request) => {
                const meta = REQUEST_STATUS_META[request.status] || REQUEST_STATUS_META.pending;
                return (
                  <button
                    key={request.id}
                    type="button"
                    onClick={() => openRequest(request)}
                    className="w-full rounded-xl border border-zinc-800 bg-black/25 p-4 text-left transition hover:border-cyan-400/45 hover:bg-zinc-900"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-zinc-50">
                          {request.discordContact || "-"}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          {formatDate(request.createdAt)} - {request.preferredLanguage?.toUpperCase() || "FR"}
                        </div>
                        {request.guildName ? (
                          <div className="mt-1 text-xs text-zinc-400">{request.guildName}</div>
                        ) : null}
                      </div>
                      <StatusBadge meta={meta} />
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-800 bg-black/20 p-6 text-center text-sm text-zinc-500">
                {loading ? t("common.loading", "Chargement...") : t("community.noRequests", "Aucune demande.")}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-zinc-50">
                {t("community.membersTitle", "Membres existants")}
              </h3>
              <p className="text-sm text-zinc-500">
                {t("community.membersHelp", "Comptes independants des guildes clientes.")}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              className="bg-cyan-500 text-zinc-950 hover:bg-cyan-400"
              onClick={() => {
                setMemberEditor({
                  memberId: "",
                  watcherName: "",
                  discordId: "",
                  preferredLanguage: "fr",
                  role: "community_member",
                  status: "active",
                });
                setTemporaryPassword("");
                setSelectedRequest(null);
                setMemberDraft(null);
              }}
            >
              <UserPlus className="mr-2 h-4 w-4" />
              {t("community.createManual", "Creer")}
            </Button>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-zinc-800">
            <div className="hidden grid-cols-[1.4fr_1.2fr_0.75fr_0.75fr_auto] gap-3 border-b border-zinc-800 bg-zinc-900/60 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 md:grid">
              <span>{t("community.memberName", "Pseudo")}</span>
              <span>{t("community.discordId", "Discord ID")}</span>
              <span>{t("community.role", "Role")}</span>
              <span>{t("community.status", "Statut")}</span>
              <span className="text-right">{t("community.actions", "Actions")}</span>
            </div>
            {members.length ? (
              members.map((member) => {
                const statusMeta = MEMBER_STATUS_META[member.status] || MEMBER_STATUS_META.active;
                return (
                  <div
                    key={member.id}
                    className="grid gap-3 border-b border-zinc-900 px-4 py-3 text-sm last:border-0 md:grid-cols-[1.4fr_1.2fr_0.75fr_0.75fr_auto] md:items-center"
                  >
                    <div>
                      <div className="font-semibold text-zinc-50">{member.name}</div>
                      <div className="text-xs text-zinc-500">{formatDate(member.createdAt)}</div>
                    </div>
                    <div className="break-all text-zinc-300">{member.discordId || "-"}</div>
                    <div className="text-zinc-300">{roleLabel(member.role, t)}</div>
                    <StatusBadge meta={statusMeta} />
                    <div className="flex flex-wrap justify-start gap-2 md:justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                        onClick={() => {
                          setMemberEditor(createDraftFromMember(member));
                          setTemporaryPassword("");
                        }}
                      >
                        <Edit3 className="mr-2 h-4 w-4" />
                        {t("common.edit", "Modifier")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={
                          member.status === "inactive"
                            ? "border-emerald-500/35 bg-emerald-950/40 text-emerald-100 hover:bg-emerald-900/40"
                            : "border-red-500/35 bg-red-950/40 text-red-100 hover:bg-red-900/40"
                        }
                        onClick={() => quickToggleMember(member)}
                        disabled={saving}
                      >
                        {member.status === "inactive" ? (
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                        ) : (
                          <XCircle className="mr-2 h-4 w-4" />
                        )}
                        {member.status === "inactive"
                          ? t("community.reactivate", "Reactiver")
                          : t("community.deactivate", "Desactiver")}
                      </Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-6 text-center text-sm text-zinc-500">
                {loading ? t("common.loading", "Chargement...") : t("community.noMembers", "Aucun membre communaute.")}
              </div>
            )}
          </div>
        </div>
      </section>

      {selectedRequest && memberDraft ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-100 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">
                  {t("community.requestDetail", "Detail demande")}
                </div>
                <h3 className="mt-2 text-xl font-semibold">{selectedRequest.discordContact}</h3>
                <p className="mt-1 text-sm text-zinc-500">{formatDate(selectedRequest.createdAt)}</p>
              </div>
              <Button variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-100" onClick={closeRequest}>
                {t("common.close", "Fermer")}
              </Button>
            </div>

            <div className="mt-4 grid gap-3 rounded-xl border border-zinc-800 bg-black/25 p-4 text-sm text-zinc-300 sm:grid-cols-2">
              <div>
                <span className="text-zinc-500">{t("community.discordContact", "Contact Discord")}</span>
                <div className="mt-1 font-medium text-zinc-100">{selectedRequest.discordContact || "-"}</div>
              </div>
              <div>
                <span className="text-zinc-500">{t("community.language", "Langue")}</span>
                <div className="mt-1 font-medium text-zinc-100">
                  {selectedRequest.preferredLanguage?.toUpperCase() || "FR"}
                </div>
              </div>
              <div>
                <span className="text-zinc-500">{t("community.guildIndicated", "Guilde indiquee")}</span>
                <div className="mt-1 font-medium text-zinc-100">{selectedRequest.guildName || "-"}</div>
              </div>
              <div>
                <span className="text-zinc-500">{t("community.status", "Statut")}</span>
                <div className="mt-1">
                  <StatusBadge meta={REQUEST_STATUS_META[selectedRequest.status]} />
                </div>
              </div>
            </div>

            <form onSubmit={createMember} className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-zinc-300">{t("community.memberName", "Pseudo")}</span>
                  <input
                    value={memberDraft.watcherName}
                    onChange={(event) => setMemberDraft((current) => ({ ...current, watcherName: event.target.value }))}
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-cyan-400"
                    required
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-zinc-300">{t("community.discordId", "Discord ID")}</span>
                  <input
                    value={memberDraft.discordId}
                    onChange={(event) => setMemberDraft((current) => ({ ...current, discordId: event.target.value }))}
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-cyan-400"
                    required
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-zinc-300">{t("community.language", "Langue")}</span>
                  <select
                    value={memberDraft.preferredLanguage}
                    onChange={(event) =>
                      setMemberDraft((current) => ({ ...current, preferredLanguage: event.target.value }))
                    }
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-cyan-400"
                  >
                    {LANGUAGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-zinc-300">{t("community.role", "Role")}</span>
                  <select
                    value={memberDraft.role}
                    onChange={(event) => setMemberDraft((current) => ({ ...current, role: event.target.value }))}
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-cyan-400"
                  >
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.labelKey, option.fallback)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {temporaryPassword ? (
                <div className="rounded-xl border border-cyan-400/25 bg-cyan-950/30 p-3 text-sm text-cyan-100">
                  <div className="font-semibold">{t("community.temporaryPassword", "Mot de passe provisoire")}</div>
                  <div className="mt-1 font-mono text-base">{temporaryPassword}</div>
                </div>
              ) : null}

              <div className="flex flex-wrap justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-red-500/35 bg-red-950/40 text-red-100 hover:bg-red-900/40"
                    disabled={saving}
                    onClick={() => updateRequestStatus(selectedRequest, "refused")}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    {t("community.refuse", "Refuser")}
                  </Button>
                  {selectedRequest.status !== "pending" ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="border-amber-500/35 bg-amber-950/40 text-amber-100 hover:bg-amber-900/40"
                      disabled={saving}
                      onClick={() => updateRequestStatus(selectedRequest, "pending")}
                    >
                      <Clock3 className="mr-2 h-4 w-4" />
                      {t("community.backToPending", "Remettre en attente")}
                    </Button>
                  ) : null}
                </div>
                <Button type="submit" className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400" disabled={saving}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  {t("community.acceptAndCreate", "Accepter et creer le compte")}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {memberEditor ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-100 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">
                  {memberEditor.memberId ? t("community.editMember", "Modifier membre") : t("community.createMember", "Creer membre")}
                </div>
                <h3 className="mt-2 text-xl font-semibold">{memberEditor.watcherName || t("community.newMember", "Nouveau membre")}</h3>
              </div>
              <Button variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-100" onClick={closeEditor}>
                {t("common.close", "Fermer")}
              </Button>
            </div>

            <form
              onSubmit={memberEditor.memberId ? updateMember : createMember}
              className="mt-5 space-y-4"
            >
              {!memberEditor.memberId ? (
                <input type="hidden" value="" readOnly />
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-zinc-300">{t("community.memberName", "Pseudo")}</span>
                  <input
                    value={memberEditor.watcherName}
                    onChange={(event) => setMemberEditor((current) => ({ ...current, watcherName: event.target.value }))}
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-cyan-400"
                    required
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-zinc-300">{t("community.discordId", "Discord ID")}</span>
                  <input
                    value={memberEditor.discordId}
                    onChange={(event) => setMemberEditor((current) => ({ ...current, discordId: event.target.value }))}
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-cyan-400"
                    required
                  />
                </label>
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-zinc-300">{t("community.language", "Langue")}</span>
                  <select
                    value={memberEditor.preferredLanguage}
                    onChange={(event) =>
                      setMemberEditor((current) => ({ ...current, preferredLanguage: event.target.value }))
                    }
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-cyan-400"
                  >
                    {LANGUAGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-zinc-300">{t("community.role", "Role")}</span>
                  <select
                    value={memberEditor.role}
                    onChange={(event) => setMemberEditor((current) => ({ ...current, role: event.target.value }))}
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-cyan-400"
                  >
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.labelKey, option.fallback)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-2 sm:col-span-2">
                  <span className="text-sm font-medium text-zinc-300">{t("community.status", "Statut")}</span>
                  <select
                    value={memberEditor.status}
                    onChange={(event) => setMemberEditor((current) => ({ ...current, status: event.target.value }))}
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-cyan-400"
                  >
                    <option value="active">{t("community.memberActive", "Actif")}</option>
                    <option value="inactive">{t("community.memberInactive", "Inactif")}</option>
                  </select>
                </label>
              </div>

              {temporaryPassword ? (
                <div className="rounded-xl border border-cyan-400/25 bg-cyan-950/30 p-3 text-sm text-cyan-100">
                  <div className="font-semibold">{t("community.temporaryPassword", "Mot de passe provisoire")}</div>
                  <div className="mt-1 font-mono text-base">{temporaryPassword}</div>
                  <div className="mt-2 text-xs text-cyan-100/75">
                    {t("community.passwordOneTime", "Copie-le maintenant : il ne sera plus visible apres fermeture.")}
                  </div>
                </div>
              ) : null}

              <div className="flex justify-end gap-2">
                {memberEditor.memberId ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="mr-auto border-amber-500/35 bg-amber-950/30 text-amber-100 hover:bg-amber-900/40"
                    onClick={resetMemberPassword}
                    disabled={saving || resettingPassword}
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${resettingPassword ? "animate-spin" : ""}`} />
                    {resettingPassword
                      ? t("community.passwordResetting", "Generation...")
                      : t("community.resetPassword", "Regenerer mot de passe")}
                  </Button>
                ) : null}
                <Button type="button" variant="outline" className="border-zinc-700 bg-zinc-900 text-zinc-100" onClick={closeEditor}>
                  {t("common.cancel", "Annuler")}
                </Button>
                <Button type="submit" className="bg-cyan-500 text-zinc-950 hover:bg-cyan-400" disabled={saving}>
                  {memberEditor.memberId ? t("common.save", "Enregistrer") : t("community.createMember", "Creer membre")}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
