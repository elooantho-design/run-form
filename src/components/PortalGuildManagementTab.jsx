import React, { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, ExternalLink, Link2, MessageSquare, Plus, RefreshCw, Save, Search, Send, ShieldCheck, Trash2, Unlink, UserCog, UserPlus, Users, X } from "lucide-react";
import GestionDefenseTab from "@/components/GestionDefenseTab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getDefenseLikeTargetId,
  getMetaDefenseCounters,
} from "@/calculations";
import {
  PALADIN_CLUSTER_GUILD_CODES,
  isLeaderSession,
  isPaladinSession,
  normalizeGuildCodeKey,
} from "@/lib/guildScope";
import { getChampionDisplayName } from "@/lib/championDisplay";
import { resolveAssignedDefense, resolveDefenseVariantsForGuild } from "@/lib/defenseVariants";
import { usePortalLanguage } from "@/lib/portalLanguage";

const EMPTY_DEFENSE = "--";
const GUILD_STATUS_TODO = "\u00c0 faire";
const GUILD_STATUS_VERIFY = "\u00c0 v\u00e9rifier";
const GUILD_STATUS_VALID = "Valid\u00e9";
const LEADER_MEMBER_ROLE_OPTIONS = ["member", "admin", "leader", "community_member", "content_creator"];
const ADMIN_MEMBER_ROLE_OPTIONS = ["member", "community_member", "content_creator"];
const DISCORD_DEFENSE_DM_CAPABILITY = "discord_defense_dm";

function getEmptyHeroSearchCriteria() {
  return [{ championId: "", heroQuery: "", minAwakening: 0 }];
}

function formatText(template, values) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(new RegExp(`\\{${key}\\}`, "g"), value ?? ""),
    template,
  );
}

function formatPortalAccessWarnings(warnings) {
  const rows = Array.isArray(warnings) ? warnings.filter(Boolean) : [];
  if (!rows.length) return "";

  const first = rows[0]?.message || "Discord n'a pas pu appliquer toute l'action.";
  return rows.length > 1 ? `${first} (+${rows.length - 1})` : first;
}

function getDiscordAppUrl(value) {
  const rawUrl = String(value || "").trim();
  if (!rawUrl) return "";
  if (rawUrl.startsWith("discord://")) return rawUrl;

  const match = rawUrl.match(/discord(?:app)?\.com\/channels\/([^/?#]+)\/([^/?#]+)(?:\/([^/?#]+))?/i);
  if (!match) return rawUrl;

  const [, guildId, channelId, messageId] = match;
  return `discord://-/channels/${guildId}/${channelId}${messageId ? `/${messageId}` : ""}`;
}

function openDiscordTarget(value) {
  const targetUrl = getDiscordAppUrl(value);
  if (!targetUrl) return;

  if (targetUrl.startsWith("discord://")) {
    window.location.href = targetUrl;
    return;
  }

  window.open(targetUrl, "_blank", "noopener,noreferrer");
}

function getSessionGuildCode(session) {
  return session?.guildCode || session?.guild_code || "G1";
}

function normalizeRoleValue(role) {
  return String(role || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isPrivilegedMemberRole(role) {
  const normalized = normalizeRoleValue(role);
  return normalized === "admin" || normalized === "administrateur" || normalized === "leader";
}

function normalizeHeroSearchText(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isAdminSession(session) {
  const role = normalizeRoleValue(session?.role);

  return Boolean(
    session?.isAdmin ||
      session?.admin ||
      role.includes("admin") ||
      role.includes("administrateur") ||
      role.includes("leader"),
  );
}

async function postPortalAccess(action, payload = {}) {
  const response = await fetch("/api/portal-access", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `HTTP ${response.status}`);
  }
  return data;
}

function getEmptyMemberEditDraft() {
  return {
    watcherName: "",
    guildCode: "",
    role: "member",
    rosterStatus: "active",
    discordId: "",
    personalForumPostUrl: "",
  };
}

function createMemberEditDraft(member) {
  return {
    watcherName: member?.watcherName || member?.name || "",
    guildCode: member?.guildCode || "",
    role: member?.role || "member",
    rosterStatus: member?.rosterStatus || "active",
    discordId: member?.discordId || "",
    personalForumPostUrl: member?.personalForumPostUrl || "",
  };
}

function MemberEditModal({
  t,
  isLeader,
  isAdmin,
  profile,
  draft,
  results,
  query,
  linkedAccounts,
  isSecondary,
  canLinkSecondaries,
  effectiveDiscordId,
  linkQuery,
  linkResults,
  loading,
  saving,
  linkLoading,
  linkSearchLoading,
  error,
  message,
  setQuery,
  setDraft,
  setLinkQuery,
  onClose,
  onSearch,
  onLoadProfile,
  onSave,
  onSearchLink,
  onLinkSecondary,
  onUnlinkSecondary,
  onResetSelection,
}) {
  const member = profile?.member || null;
  const primary = profile?.primary || null;
  const secondaryCount = linkedAccounts.filter((linked) => String(linked.primaryMemberId) === String(member?.id)).length;
  const canEditRole = isLeader || (isAdmin && member && !isPrivilegedMemberRole(member.role));
  const baseRoleOptions = isLeader ? LEADER_MEMBER_ROLE_OPTIONS : ADMIN_MEMBER_ROLE_OPTIONS;
  const roleOptions = baseRoleOptions.includes(draft.role) ? baseRoleOptions : [draft.role, ...baseRoleOptions];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-violet-500/30 bg-violet-500/10">
              <UserCog className="h-5 w-5 text-violet-200" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-zinc-50">
                {t("guildManagement.editMember", "Modifier un joueur")}
              </h3>
              <p className="mt-1 text-sm text-zinc-400">
                {t("guildManagement.editMemberHelp", "Recherche un compte existant, puis modifie sa fiche dediee.")}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
            disabled={loading || saving || linkLoading}
            onClick={onClose}
            title={t("common.close", "Fermer")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[320px_1fr]">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              {t("guildManagement.memberEditSearch", "Recherche joueur")}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void onSearch();
                  }
                }}
                placeholder={t("guildManagement.memberEditSearchPlaceholder", "Nom du joueur...")}
                className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/20"
              />
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-lg border-violet-500/40 bg-violet-500/10 px-3 text-violet-100 hover:bg-violet-500/20"
                disabled={loading}
                onClick={onSearch}
              >
                <Search className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-3 grid gap-2">
              {results.length ? (
                results.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                      String(item.id) === String(member?.id)
                        ? "border-violet-300/60 bg-violet-500/15 text-violet-100"
                        : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
                    }`}
                    onClick={() => onLoadProfile(item.id)}
                  >
                    <div className="font-semibold">{item.name || item.watcherName}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-500">
                      <span>{item.guildCode || "-"}</span>
                      <span>{item.role || "member"}</span>
                      {item.linkedAccountRole === "secondary" ? <span>secondaire</span> : null}
                    </div>
                  </button>
                ))
              ) : (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-6 text-center text-sm text-zinc-500">
                  {t("guildManagement.memberEditNoSearch", "Lance une recherche pour choisir un joueur.")}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
            {!member ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-12 text-center text-sm text-zinc-500">
                {t("guildManagement.memberEditSelectHelp", "Selectionne un joueur pour ouvrir sa fiche.")}
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                      {t("guildManagement.memberEditSheet", "Fiche joueur")}
                    </div>
                    <h4 className="mt-1 text-xl font-semibold text-zinc-50">{member.name || member.watcherName}</h4>
                    <p className="mt-1 text-sm text-zinc-400">
                      {isSecondary && primary
                        ? formatText(
                            t("guildManagement.secondaryOf", "Compte secondaire de {primary} · principal {guild}"),
                            { primary: primary.name || primary.watcherName, guild: primary.guildCode || "-" },
                          )
                        : t("guildManagement.primaryAccount", "Compte principal / autonome")}
                    </p>
                  </div>
                  {isSecondary ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-lg border-red-500/40 bg-red-500/10 text-red-100 hover:bg-red-500/20"
                      disabled={linkLoading}
                      onClick={() => onUnlinkSecondary(member)}
                    >
                      <Unlink className="mr-2 h-4 w-4" />
                      {t("guildManagement.unlinkSecondary", "Delier")}
                    </Button>
                  ) : null}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="text-sm text-zinc-400">{t("guildManagement.playerName", "Nom joueur")}</span>
                    <input
                      type="text"
                      value={draft.watcherName}
                      onChange={(event) => setDraft((previous) => ({ ...previous, watcherName: event.target.value }))}
                      className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/20"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm text-zinc-400">Guilde</span>
                    <input
                      type="text"
                      value={draft.guildCode}
                      onChange={(event) => setDraft((previous) => ({ ...previous, guildCode: event.target.value }))}
                      className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/20"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm text-zinc-400">Role</span>
                    <select
                      value={draft.role}
                      disabled={!canEditRole}
                      onChange={(event) => setDraft((previous) => ({ ...previous, role: event.target.value }))}
                      className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/20 disabled:cursor-not-allowed disabled:opacity-60 [&>option]:bg-zinc-950 [&>option]:text-zinc-100"
                    >
                      {roleOptions.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm text-zinc-400">Roster</span>
                    <select
                      value={draft.rosterStatus}
                      onChange={(event) => setDraft((previous) => ({ ...previous, rosterStatus: event.target.value }))}
                      className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/20 [&>option]:bg-zinc-950 [&>option]:text-zinc-100"
                    >
                      <option value="active">active</option>
                      <option value="non_roster">non_roster</option>
                      <option value="inactive">inactive</option>
                    </select>
                  </label>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="text-sm text-zinc-400">ID Discord</span>
                    <input
                      type="text"
                      value={isSecondary ? effectiveDiscordId : draft.discordId}
                      disabled={isSecondary}
                      onChange={(event) => setDraft((previous) => ({ ...previous, discordId: event.target.value }))}
                      className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    {isSecondary ? (
                      <span className="mt-2 block text-xs text-zinc-500">
                        {t("guildManagement.discordInherited", "Discord herite du compte principal.")}
                      </span>
                    ) : null}
                  </label>
                  <label className="block">
                    <span className="text-sm text-zinc-400">
                      {t("guildManagement.personalForumLink", "Lien forum personnel")}
                    </span>
                    <input
                      type="url"
                      value={draft.personalForumPostUrl}
                      onChange={(event) =>
                        setDraft((previous) => ({ ...previous, personalForumPostUrl: event.target.value }))
                      }
                      placeholder="https://discord.com/channels/..."
                      className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/20"
                    />
                    <span className="mt-2 block text-xs text-zinc-500">
                      {t("guildManagement.forumPerAccount", "Ce lien reste propre a ce compte.")}
                    </span>
                  </label>
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                    <Link2 className="h-4 w-4 text-violet-300" />
                    {t("guildManagement.linkedAccounts", "Comptes lies")}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {isSecondary
                      ? t("guildManagement.secondaryAccount", "Ce compte est secondaire.")
                      : formatText(t("guildManagement.secondaryCount", "{count} compte(s) secondaire(s)."), {
                          count: secondaryCount,
                        })}
                  </div>

                  {linkedAccounts.length ? (
                    <div className="mt-3 grid gap-2">
                      {linkedAccounts.map((linked) => (
                        <div
                          key={linked.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm"
                        >
                          <div>
                            <div className="font-semibold text-zinc-100">{linked.name || linked.watcherName}</div>
                            <div className="mt-1 text-xs text-zinc-500">
                              {linked.guildCode || "-"} · {linked.role || "member"}
                              {linked.primaryMemberId ? " · secondaire" : " · principal"}
                            </div>
                          </div>
                          {linked.primaryMemberId ? (
                            <Button
                              type="button"
                              variant="outline"
                              className="h-9 rounded-lg border-red-500/40 bg-red-500/10 px-3 text-red-100 hover:bg-red-500/20"
                              disabled={linkLoading}
                              onClick={() => onUnlinkSecondary(linked)}
                            >
                              <Unlink className="mr-2 h-4 w-4" />
                              {t("guildManagement.unlinkSecondary", "Delier")}
                            </Button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-4 text-center text-sm text-zinc-500">
                      {t("guildManagement.noLinkedAccounts", "Aucun autre compte lie pour le moment.")}
                    </div>
                  )}

                  {canLinkSecondaries ? (
                    <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                        {t("guildManagement.linkExistingAccount", "Lier un compte existant")}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <input
                          type="search"
                          value={linkQuery}
                          onChange={(event) => setLinkQuery(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void onSearchLink();
                            }
                          }}
                          placeholder={t("guildManagement.memberEditSearchPlaceholder", "Nom du joueur...")}
                          className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/20"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="h-10 rounded-lg border-violet-500/40 bg-violet-500/10 px-3 text-violet-100 hover:bg-violet-500/20"
                          disabled={linkSearchLoading}
                          onClick={onSearchLink}
                        >
                          <Search className="h-4 w-4" />
                        </Button>
                      </div>
                      {linkResults.length ? (
                        <div className="mt-3 grid gap-2">
                          {linkResults.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-left text-sm text-zinc-300 transition hover:border-violet-400/50 hover:text-zinc-100"
                              disabled={linkLoading}
                              onClick={() => onLinkSecondary(item)}
                            >
                              <div className="font-semibold">{item.name || item.watcherName}</div>
                              <div className="mt-1 text-xs text-zinc-500">
                                {item.guildCode || "-"} · {item.role || "member"}
                                {item.linkedAccountRole === "secondary" ? " · deja secondaire" : ""}
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {message ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                    {message}
                  </div>
                ) : null}
                {error ? (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {error}
                  </div>
                ) : null}

                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-lg border-zinc-700 text-zinc-200"
                    disabled={saving}
                    onClick={onResetSelection}
                  >
                    {t("common.reset", "Reset")}
                  </Button>
                  <Button
                    type="button"
                    className="rounded-lg bg-violet-500 text-zinc-950 hover:bg-violet-400"
                    disabled={saving || !draft.watcherName.trim()}
                    onClick={onSave}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? t("common.saving", "Sauvegarde...") : t("common.save", "Sauvegarder")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {loading && !member ? (
          <div className="mt-4 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
            {t("common.loading", "Chargement...")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function PortalGuildManagementTab({ session }) {
  const { t, language } = usePortalLanguage();
  const [activeGuildCode, setActiveGuildCode] = useState(getSessionGuildCode(session));
  const [members, setMembers] = useState([]);
  const [defenses, setDefenses] = useState([]);
  const [defenseVotes, setDefenseVotes] = useState([]);
  const [champions, setChampions] = useState([]);
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [trackedMetaDefenseId, setTrackedMetaDefenseId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingMessage, setSavingMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [memberToTransfer, setMemberToTransfer] = useState(null);
  const [targetGuildCode, setTargetGuildCode] = useState("");
  const [removingMemberId, setRemovingMemberId] = useState("");
  const [convertingCommunityMemberId, setConvertingCommunityMemberId] = useState("");
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [newMember, setNewMember] = useState({
    name: "",
    discordId: "",
    forumPostUrl: "",
  });
  const [addingMember, setAddingMember] = useState(false);
  const [memberPanelOpen, setMemberPanelOpen] = useState(false);
  const [memberPanelMember, setMemberPanelMember] = useState(null);
  const [memberPanelForumUrl, setMemberPanelForumUrl] = useState("");
  const [memberPanelSaving, setMemberPanelSaving] = useState(false);
  const [memberPanelSending, setMemberPanelSending] = useState(false);
  const [memberPanelMessage, setMemberPanelMessage] = useState("");
  const [memberPanelError, setMemberPanelError] = useState("");
  const [memberPanelCustomMessage, setMemberPanelCustomMessage] = useState("");
  const [resettingStatuses, setResettingStatuses] = useState(false);
  const [heroSearchOpen, setHeroSearchOpen] = useState(false);
  const [heroSearchCriteria, setHeroSearchCriteria] = useState(getEmptyHeroSearchCriteria);
  const [heroSearchResults, setHeroSearchResults] = useState(null);
  const [heroSearchLoading, setHeroSearchLoading] = useState(false);
  const [heroSearchError, setHeroSearchError] = useState("");
  const [activeHeroSearchIndex, setActiveHeroSearchIndex] = useState(null);
  const [memberEditOpen, setMemberEditOpen] = useState(false);
  const [memberEditQuery, setMemberEditQuery] = useState("");
  const [memberEditResults, setMemberEditResults] = useState([]);
  const [memberEditProfile, setMemberEditProfile] = useState(null);
  const [memberEditDraft, setMemberEditDraft] = useState(getEmptyMemberEditDraft);
  const [memberEditLoading, setMemberEditLoading] = useState(false);
  const [memberEditSaving, setMemberEditSaving] = useState(false);
  const [memberEditError, setMemberEditError] = useState("");
  const [memberEditMessage, setMemberEditMessage] = useState("");
  const [linkSearchQuery, setLinkSearchQuery] = useState("");
  const [linkSearchResults, setLinkSearchResults] = useState([]);
  const [linkSearchLoading, setLinkSearchLoading] = useState(false);
  const [linkActionLoading, setLinkActionLoading] = useState(false);
  const [discordCapabilities, setDiscordCapabilities] = useState({});
  const [discordCapabilitiesReady, setDiscordCapabilitiesReady] = useState(true);

  const connectedMemberId = session?.memberId || session?.id || "";
  const isAdmin = isAdminSession(session);
  const isLeader = isLeaderSession(session);
  const visibleGuildCodes = useMemo(() => {
    if (isPaladinSession(session)) return PALADIN_CLUSTER_GUILD_CODES;

    const sessionGuildCode = getSessionGuildCode(session);
    return sessionGuildCode ? [sessionGuildCode] : [];
  }, [session]);
  const removeMemberLabel = isPaladinSession(session)
    ? t("guildManagement.leaveCluster", "Quitte le cluster")
    : t("guildManagement.leaveGuild", "Quitte la guilde");
  const defenseDiscordEnabled = discordCapabilities?.[DISCORD_DEFENSE_DM_CAPABILITY] === true;
  const defenseDiscordDisabledMessage = t(
    "guildManagement.discordDefenseDisabled",
    "Cette fonctionnalite n'est pas activee pour votre organisation. Pour activer l'envoi des defenses directement aux joueurs, contactez Darius.",
  );
  const championOptions = useMemo(
    () =>
      [...(champions || [])]
        .map((champion) => ({
          ...champion,
          label: getChampionDisplayName(champion, language) || champion.portal_name || champion.name || `Hero ${champion.id}`,
        }))
        .sort((left, right) => left.label.localeCompare(right.label, "fr", { sensitivity: "base" })),
    [champions, language],
  );
  const championOptionById = useMemo(
    () => new Map(championOptions.map((champion) => [String(champion.id), champion])),
    [championOptions],
  );
  const validHeroSearchCriteria = useMemo(
    () =>
      heroSearchCriteria
        .filter((criterion) => criterion.championId)
        .map((criterion) => ({
          championId: String(criterion.championId),
          minAwakening: Math.max(0, Math.min(5, Number(criterion.minAwakening) || 0)),
        })),
    [heroSearchCriteria],
  );

  const activeMembers = useMemo(
    () => members.filter((member) => normalizeGuildCodeKey(member.guildCode) === normalizeGuildCodeKey(activeGuildCode)),
    [activeGuildCode, members]
  );

  const activeDefenses = useMemo(
    () =>
      resolveDefenseVariantsForGuild(
        defenses.filter(
          (defense) => normalizeGuildCodeKey(defense.guildCode || defense.guild_code) === normalizeGuildCodeKey(activeGuildCode)
        ),
        activeGuildCode,
      ),
    [activeGuildCode, defenses]
  );

  const trackedMetaDefense = useMemo(() => {
    if (!trackedMetaDefenseId) return null;
    return activeDefenses.find((defense) => String(defense.id) === String(trackedMetaDefenseId)) || null;
  }, [activeDefenses, trackedMetaDefenseId]);

  const metaDefenseCounters = useMemo(
    () => getMetaDefenseCounters(activeDefenses, activeMembers),
    [activeDefenses, activeMembers]
  );

  const defenseLikesCountByRootId = useMemo(() => {
    const counts = new Map();

    defenseVotes.forEach((vote) => {
      if (vote.value !== 1) return;
      counts.set(vote.defenseId, (counts.get(vote.defenseId) || 0) + 1);
    });

    return counts;
  }, [defenseVotes]);

  const defenseDislikesCountByRootId = useMemo(() => {
    const counts = new Map();

    defenseVotes.forEach((vote) => {
      if (vote.value !== -1) return;
      counts.set(vote.defenseId, (counts.get(vote.defenseId) || 0) + 1);
    });

    return counts;
  }, [defenseVotes]);

  const defenseVoteByRootId = useMemo(() => {
    if (!connectedMemberId) return new Map();
    const votes = new Map();

    defenseVotes
      .filter((vote) => String(vote.memberId) === String(connectedMemberId))
      .forEach((vote) => {
        votes.set(vote.defenseId, vote.value);
      });

    return votes;
  }, [connectedMemberId, defenseVotes]);

  useEffect(() => {
    if (visibleGuildCodes.length === 0) return;

    setActiveGuildCode((current) =>
      visibleGuildCodes.some((guildCode) => normalizeGuildCodeKey(guildCode) === normalizeGuildCodeKey(current))
        ? current
        : visibleGuildCodes[0],
    );
  }, [visibleGuildCodes]);

  useEffect(() => {
    let cancelled = false;

    async function loadGuildManagementData() {
      setLoading(true);
      setErrorMessage("");

      try {
        const payload = await postPortalAccess("guild-management-load", {
          guildCode: activeGuildCode,
        });

        if (cancelled) return;

        const mappedMembers = payload.members || [];
        setMembers(mappedMembers);
        setDefenses(payload.defenses || []);
        setDefenseVotes(payload.defenseVotes || []);
        setChampions(payload.champions || []);
        setDiscordCapabilities(payload.discordCapabilities || {});
        setDiscordCapabilitiesReady(payload.discordCapabilitiesReady !== false);
        setSelectedMemberId((current) => {
          if (current && mappedMembers.some((member) => String(member.id) === String(current))) return current;
          const connectedMember = mappedMembers.find((member) => String(member.id) === String(connectedMemberId));
          return (
            connectedMember?.id ||
            mappedMembers.find(
              (member) => normalizeGuildCodeKey(member.guildCode) === normalizeGuildCodeKey(activeGuildCode),
            )?.id ||
            null
          );
        });
        setLoading(false);
      } catch (error) {
        if (cancelled) return;
        console.error("Erreur chargement gestion guildes Portal:", error);
        setErrorMessage(error?.message || "Impossible de charger la gestion des guildes pour le moment.");
        setMembers([]);
        setDefenses([]);
        setDefenseVotes([]);
        setChampions([]);
        setDiscordCapabilities({});
        setDiscordCapabilitiesReady(true);
        setLoading(false);
      }
    }

    loadGuildManagementData();

    return () => {
      cancelled = true;
    };
  }, [activeGuildCode, connectedMemberId, refreshTick]);

  useEffect(() => {
    if (!trackedMetaDefenseId) return;
    if (activeDefenses.some((defense) => String(defense.id) === String(trackedMetaDefenseId))) return;
    setTrackedMetaDefenseId(null);
  }, [activeDefenses, trackedMetaDefenseId]);

  function updateMemberLocal(memberId, patch) {
    setMembers((previous) =>
      previous.map((member) => (String(member.id) === String(memberId) ? { ...member, ...patch } : member))
    );
  }

  async function updateMemberField(memberId, patch, errorLabel) {
    setSavingMessage("Sauvegarde en cours...");
    setErrorMessage("");

    try {
      const payload = await postPortalAccess("guild-member-update", {
        memberId,
        patch,
      });
      setSavingMessage("");
      if (payload.member) {
        updateMemberLocal(memberId, payload.member);
        setMemberPanelMember((previous) =>
          previous && String(previous.id) === String(memberId) ? { ...previous, ...payload.member } : previous
        );
      }
      return true;
    } catch (error) {
      setSavingMessage("");
      console.error(errorLabel, error);
      setErrorMessage(error?.message || "Sauvegarde impossible.");
      return false;
    }
  }

  function openMemberPanel(member) {
    setMemberPanelMember(member);
    setMemberPanelForumUrl(member?.personalForumPostUrl || "");
    setMemberPanelCustomMessage(buildMemberDefenseMessageDraft(member));
    setMemberPanelMessage("");
    setMemberPanelError("");
    setMemberPanelOpen(true);
  }

  function getAssignedDefenseNames(member) {
    return [member?.defense1, member?.defense2].filter(
      (name) => name && name !== EMPTY_DEFENSE && name !== "—"
    );
  }

  function getAssignedDefenseDetails(member) {
    return [1, 2].map((slot) => {
      const defenseName = slot === 1 ? member?.defense1 : member?.defense2;
      return {
        name: defenseName,
        defense: resolveAssignedDefense(activeDefenses, member, slot),
      };
    }).filter(({ name, defense }) => defense || (name && name !== EMPTY_DEFENSE && name !== "—"));
  }

  function formatDefenseDraftDetails(defense) {
    if (!defense) {
      return [
        t("guildManagement.defenseMissingInfo", "Defense assignee mais informations introuvables dans Portal."),
      ];
    }

    const heroes = defense.slots?.length ? defense.slots.join(", ") : t("common.empty", "Vide");
    const conditions = defense.conditions?.length
      ? defense.conditions.map((condition) => `- ${condition.label}`).join("\n")
      : `- ${t("adminDefenses.noCondition", "Aucune condition")}`;
    const infos = defense.infoBlocks?.length
      ? defense.infoBlocks
          .map((block) => String(block.content || "").trim())
          .filter(Boolean)
          .map((content) => `- ${content}`)
          .join("\n")
      : `- ${t("gvgCurrent.noInstructions", "Pas de consigne particuliere")}`;

    return [
      `Type : ${defense.type || "-"}`,
      `Tier : ${defense.tier || "-"}`,
      `Heros : ${heroes}`,
      "Conditions :",
      conditions,
      "Infos :",
      infos,
      defense.image ? `Image : ${defense.image}` : "",
    ].filter(Boolean);
  }

  function buildMemberDefenseMessageDraft(member) {
    const targetName = member?.name || "Joueur";
    const guildCode = member?.guildCode || activeGuildCode || "-";
    const actorName = session?.watcherName || session?.name || "Admin";
    const assignedDefenses = getAssignedDefenseDetails(member);

    const lines = [
      `**Defenses assignees - ${targetName} (${guildCode})**`,
      `Envoye par ${actorName}.`,
      "",
      "Voici les defenses a preparer :",
    ];

    if (assignedDefenses.length === 0) {
      lines.push("");
      lines.push(t("guildManagement.noDefenseToSend", "Aucune defense assignee a ce joueur."));
      return lines.join("\n");
    }

    assignedDefenses.forEach(({ name, defense }, index) => {
      lines.push("");
      lines.push(`**Defense ${index + 1} - ${name}**`);
      lines.push(...formatDefenseDraftDetails(defense));
    });

    return lines.join("\n");
  }

  async function saveMemberForumPostUrl({ silent = false } = {}) {
    if (!memberPanelMember?.id) return false;

    const cleanUrl = memberPanelForumUrl.trim();
    setMemberPanelSaving(true);
    setMemberPanelError("");
    if (!silent) setMemberPanelMessage("");

    const saved = await updateMemberField(
      memberPanelMember.id,
      { personal_forum_post_url: cleanUrl || null },
      "Erreur sauvegarde lien Discord personnel Portal:",
      {
        targetMemberId: memberPanelMember.id,
        targetName: memberPanelMember.name || "",
        actionType: "guild_management_personal_chat_update",
        entityType: "member",
        entityId: String(memberPanelMember.id),
        summary: `${memberPanelMember.name || "Joueur"} : lien tchat Discord personnel mis a jour`,
        metadata: {
          guildCode: memberPanelMember.guildCode || activeGuildCode,
          hasPersonalForumPostUrl: Boolean(cleanUrl),
        },
      }
    );

    setMemberPanelSaving(false);

    if (!saved) {
      setMemberPanelError(t("guildManagement.personalChatSaveError", "Sauvegarde du lien impossible."));
      return false;
    }

    updateMemberLocal(memberPanelMember.id, { personalForumPostUrl: cleanUrl });
    setMemberPanelMember((previous) =>
      previous ? { ...previous, personalForumPostUrl: cleanUrl } : previous
    );
    if (!silent) {
      setMemberPanelMessage(t("guildManagement.personalChatSaved", "Lien tchat sauvegarde."));
    }
    return true;
  }

  async function sendMemberDefensesToDiscord() {
    if (!memberPanelMember?.id || memberPanelSending) return;

    if (!discordCapabilitiesReady || !defenseDiscordEnabled) {
      setMemberPanelError(
        discordCapabilitiesReady
          ? defenseDiscordDisabledMessage
          : t("guildManagement.discordCapabilityMigrationMissing", "Migration capabilities Discord non executee."),
      );
      return;
    }

    const defenseNames = getAssignedDefenseNames(memberPanelMember);
    if (defenseNames.length === 0) {
      setMemberPanelError(t("guildManagement.noDefenseToSend", "Aucune defense assignee a ce joueur."));
      return;
    }

    if (!memberPanelMember.discordId) {
      setMemberPanelError(t("guildManagement.noDiscordId", "ID Discord joueur manquant."));
      return;
    }

    const cleanCustomMessage = memberPanelCustomMessage.trim();
    if (!cleanCustomMessage) {
      setMemberPanelError(t("guildManagement.emptyDiscordMessage", "Le message Discord ne peut pas etre vide."));
      return;
    }

    setMemberPanelSending(true);
    setMemberPanelError("");
    setMemberPanelMessage(t("guildManagement.sendingDefenses", "Envoi Discord en cours..."));

    try {
      const cleanUrl = memberPanelForumUrl.trim();
      if (cleanUrl !== (memberPanelMember.personalForumPostUrl || "")) {
        const saved = await saveMemberForumPostUrl({ silent: true });
        if (!saved) return;
      }

      const response = await fetch("/api/portal-access", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send-defenses",
          actorMemberId: session?.memberId || session?.id || "",
          memberId: memberPanelMember.id,
          forumPostUrl: cleanUrl,
          customMessage: cleanCustomMessage,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }

      setMemberPanelMessage(
        payload?.forumSkipped
          ? t("guildManagement.defensesSentDmOnly", "Defenses envoyees en MP. Aucun tchat personnel exploitable.")
          : t("guildManagement.defensesSent", "Defenses envoyees en MP et dans le tchat personnel.")
      );
      const warningText = formatPortalAccessWarnings(payload?.warnings);
      if (warningText) {
        setMemberPanelError(
          formatText(
            t(
              "guildManagement.discordRenameWarning",
              "Action Portal effectuee, mais Discord n'a pas renomme le salon : {warning}",
            ),
            { warning: warningText },
          )
        );
      }
      if (payload?.statusUpdated) {
        updateMemberLocal(memberPanelMember.id, { status: GUILD_STATUS_VERIFY });
        setMemberPanelMember((previous) =>
          previous ? { ...previous, status: GUILD_STATUS_VERIFY } : previous
        );
      }

    } catch (error) {
      console.error("Erreur envoi defenses Discord Portal:", error);
      setMemberPanelError(
        formatText(t("guildManagement.defensesSendError", "Envoi impossible : {error}"), {
          error: error?.message || t("common.unknownError", "erreur inconnue"),
        })
      );
    } finally {
      setMemberPanelSending(false);
    }
  }

  async function assignDefense(slot, defense, memberId) {
    if (!memberId || !defense?.name) return;

    const localKey = slot === 1 ? "defense1" : "defense2";
    const idKey = slot === 1 ? "defense1Id" : "defense2Id";
    setSavingMessage("Sauvegarde en cours...");
    setErrorMessage("");

    try {
      const payload = await postPortalAccess("member-defense-assign", {
        memberId,
        slot,
        defenseId: defense.id,
        defenseName: defense.name,
      });
      const updatedMember = payload.member || {};
      const localPatch = {
        ...updatedMember,
        [localKey]: updatedMember[localKey] || defense.name,
        [idKey]: updatedMember[idKey] || defense.id,
      };
      updateMemberLocal(memberId, localPatch);
      setMemberPanelMember((previous) =>
        previous && String(previous.id) === String(memberId) ? { ...previous, ...localPatch } : previous
      );
    } catch (error) {
      console.error("Erreur assignation defense Portal:", error);
      setErrorMessage(error?.message || "Affectation defense impossible.");
    } finally {
      setSavingMessage("");
    }
  }

  async function clearAssignedDefense(slot) {
    if (!selectedMemberId) return;

    const targetMember = members.find((member) => String(member.id) === String(selectedMemberId));
    const localKey = slot === 1 ? "defense1" : "defense2";
    const idKey = slot === 1 ? "defense1Id" : "defense2Id";
    const previousDefenseName = slot === 1 ? targetMember?.defense1 : targetMember?.defense2;
    setSavingMessage("Sauvegarde en cours...");
    setErrorMessage("");

    try {
      const payload = await postPortalAccess("member-defense-assign", {
        memberId: selectedMemberId,
        slot,
        defenseId: "",
        defenseName: EMPTY_DEFENSE,
      });
      const updatedMember = payload.member || {};
      const localPatch = {
        ...updatedMember,
        [localKey]: updatedMember[localKey] || EMPTY_DEFENSE,
        [idKey]: updatedMember[idKey] || null,
      };
      updateMemberLocal(selectedMemberId, localPatch);
      setMemberPanelMember((previous) =>
        previous && String(previous.id) === String(selectedMemberId) ? { ...previous, ...localPatch } : previous
      );
    } catch (error) {
      console.error("Erreur suppression defense Portal:", error, previousDefenseName);
      setErrorMessage(error?.message || "Retrait defense impossible.");
    } finally {
      setSavingMessage("");
    }
  }

  async function setMemberAssignment(memberId, value) {
    const targetMember = members.find((member) => String(member.id) === String(memberId));
    const saved = await updateMemberField(
      memberId,
      { assignment: value },
      "Erreur affectation role Portal:",
      {
        targetMemberId: memberId,
        targetName: targetMember?.name || "",
        actionType: "guild_management_assignment_update",
        entityType: "member",
        entityId: String(memberId),
        summary: `${targetMember?.name || "Joueur"} : role defense passe a ${value}`,
        metadata: {
          assignment: value,
          guildCode: activeGuildCode,
        },
      }
    );

    if (saved) {
      updateMemberLocal(memberId, { assignment: value });
    }

    return saved;
  }

  async function setMemberStatus(memberId, status) {
    setSavingMessage(t("common.saving", "Sauvegarde..."));
    setErrorMessage("");

    try {
      const response = await fetch("/api/portal-access", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update-defense-status",
          actorMemberId: session?.memberId || session?.id || "",
          memberId,
          status,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }

      updateMemberLocal(memberId, { status });
      setMemberPanelMember((previous) =>
        previous && String(previous.id) === String(memberId) ? { ...previous, status } : previous
      );
      const warningText = formatPortalAccessWarnings(payload?.warnings);
      if (warningText) {
        setErrorMessage(
          formatText(
            t(
              "guildManagement.discordRenameWarning",
              "Action Portal effectuee, mais Discord n'a pas renomme le salon : {warning}",
            ),
            { warning: warningText },
          )
        );
      }
    } catch (error) {
      console.error("Erreur statut Portal:", error);
      setErrorMessage(error?.message || "Sauvegarde impossible.");
    } finally {
      setSavingMessage("");
    }
  }

  async function resetActiveMemberStatuses() {
    if (!isAdmin || resettingStatuses) return;
    const memberIds = activeMembers.map((member) => member.id).filter(Boolean);
    if (!memberIds.length) return;

    const confirmed = window.confirm(
      t(
        "guildManagement.resetStatusesConfirm",
        "Remettre tous les joueurs visibles en statut A faire ?",
      )
    );
    if (!confirmed) return;

    setResettingStatuses(true);
    setSavingMessage(t("guildManagement.resettingStatuses", "Remise a faire des statuts..."));
    setErrorMessage("");

    try {
      const response = await fetch("/api/portal-access", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset-defense-statuses",
          actorMemberId: session?.memberId || session?.id || "",
          guildCode: activeGuildCode,
          memberIds,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }

      const updatedIds = payload?.memberIds?.length ? payload.memberIds : memberIds;
      setMembers((previous) =>
        previous.map((member) =>
          updatedIds.includes(member.id) ? { ...member, status: GUILD_STATUS_TODO } : member
        )
      );
      setMemberPanelMember((previous) =>
        previous && updatedIds.includes(previous.id) ? { ...previous, status: GUILD_STATUS_TODO } : previous
      );
      const warningText = formatPortalAccessWarnings(payload?.warnings);
      if (warningText) {
        setErrorMessage(
          formatText(
            t(
              "guildManagement.discordResetRenameWarning",
              "Statuts remis a faire, mais certains salons Discord n'ont pas ete renommes : {warning}",
            ),
            { warning: warningText },
          )
        );
      }
    } catch (error) {
      console.error("Erreur reset statuts gestion guilde:", error);
      setErrorMessage(error?.message || t("guildManagement.resetStatusesError", "Reset des statuts impossible."));
    } finally {
      setResettingStatuses(false);
      setSavingMessage("");
    }
  }

  function openHeroSearchModal() {
    setHeroSearchCriteria(getEmptyHeroSearchCriteria());
    setHeroSearchOpen(true);
    setHeroSearchError("");
    setHeroSearchResults(null);
  }

  function resetHeroSearchModal() {
    setHeroSearchCriteria(getEmptyHeroSearchCriteria());
    setHeroSearchResults(null);
    setHeroSearchError("");
    setActiveHeroSearchIndex(null);
  }

  function closeHeroSearchModal() {
    if (heroSearchLoading) return;
    setHeroSearchOpen(false);
    resetHeroSearchModal();
  }

  function resetMemberEditModal() {
    setMemberEditQuery("");
    setMemberEditResults([]);
    setMemberEditProfile(null);
    setMemberEditDraft(getEmptyMemberEditDraft());
    setMemberEditError("");
    setMemberEditMessage("");
    setLinkSearchQuery("");
    setLinkSearchResults([]);
  }

  function openMemberEditModal() {
    resetMemberEditModal();
    setMemberEditOpen(true);
  }

  function updateMemberEditLocal(profile) {
    const member = profile?.member;
    if (!member?.id) return;

    updateMemberLocal(member.id, {
      name: member.name || member.watcherName,
      discordId: member.discordId,
      guildCode: member.guildCode,
      role: member.role,
      personalForumPostUrl: member.personalForumPostUrl,
    });
  }

  async function searchMembersToEdit() {
    const query = memberEditQuery.trim();
    if (query.length < 2) {
      setMemberEditResults([]);
      setMemberEditError(t("guildManagement.memberEditQueryShort", "Tape au moins 2 caracteres."));
      return;
    }

    setMemberEditLoading(true);
    setMemberEditError("");
    setMemberEditMessage("");

    try {
      const payload = await postPortalAccess("member-edit-search", { query });
      setMemberEditResults(payload.results || []);
    } catch (error) {
      setMemberEditError(error?.message || t("guildManagement.memberEditSearchError", "Recherche joueur impossible."));
    } finally {
      setMemberEditLoading(false);
    }
  }

  async function loadMemberEditProfile(memberId) {
    if (!memberId) return;

    setMemberEditLoading(true);
    setMemberEditError("");
    setMemberEditMessage("");

    try {
      const payload = await postPortalAccess("member-edit-load", { memberId });
      const profile = payload.profile || null;
      setMemberEditProfile(profile);
      setMemberEditDraft(createMemberEditDraft(profile?.member));
      setLinkSearchQuery("");
      setLinkSearchResults([]);
      updateMemberEditLocal(profile);
    } catch (error) {
      setMemberEditError(error?.message || t("guildManagement.memberEditLoadError", "Chargement fiche joueur impossible."));
    } finally {
      setMemberEditLoading(false);
    }
  }

  async function saveMemberEditProfile() {
    const member = memberEditProfile?.member;
    if (!member?.id || memberEditSaving) return;

    setMemberEditSaving(true);
    setMemberEditError("");
    setMemberEditMessage("");

    try {
      const payload = await postPortalAccess("member-edit-update", {
        memberId: member.id,
        patch: {
          watcherName: memberEditDraft.watcherName,
          guildCode: memberEditDraft.guildCode,
          role: memberEditDraft.role,
          rosterStatus: memberEditDraft.rosterStatus,
          discordId: memberEditIsSecondary ? memberEditEffectiveDiscordId : memberEditDraft.discordId,
          personalForumPostUrl: memberEditDraft.personalForumPostUrl,
        },
      });
      const profile = payload.profile || null;
      setMemberEditProfile(profile);
      setMemberEditDraft(createMemberEditDraft(profile?.member));
      updateMemberEditLocal(profile);
      setMemberEditMessage(t("guildManagement.memberEditSaved", "Fiche joueur sauvegardee."));
    } catch (error) {
      setMemberEditError(error?.message || t("guildManagement.memberEditSaveError", "Sauvegarde fiche joueur impossible."));
    } finally {
      setMemberEditSaving(false);
    }
  }

  async function searchMembersToLink() {
    const query = linkSearchQuery.trim();
    if (query.length < 2) {
      setLinkSearchResults([]);
      setMemberEditError(t("guildManagement.memberEditQueryShort", "Tape au moins 2 caracteres."));
      return;
    }

    setLinkSearchLoading(true);
    setMemberEditError("");
    setMemberEditMessage("");

    try {
      const payload = await postPortalAccess("member-edit-search", { query });
      const currentId = memberEditProfile?.member?.id;
      setLinkSearchResults((payload.results || []).filter((member) => String(member.id) !== String(currentId)));
    } catch (error) {
      setMemberEditError(error?.message || t("guildManagement.memberEditSearchError", "Recherche joueur impossible."));
    } finally {
      setLinkSearchLoading(false);
    }
  }

  async function linkSecondaryAccount(secondary) {
    const primary = memberEditProfile?.member;
    if (!primary?.id || !secondary?.id || linkActionLoading) return;

    const confirmed = window.confirm(
      formatText(
        t("guildManagement.linkSecondaryConfirm", "Definir {secondary} comme compte secondaire de {primary} ?"),
        { primary: primary.name || primary.watcherName, secondary: secondary.name || secondary.watcherName },
      ),
    );
    if (!confirmed) return;

    setLinkActionLoading(true);
    setMemberEditError("");
    setMemberEditMessage("");

    try {
      const payload = await postPortalAccess("member-link-secondary", {
        primaryMemberId: primary.id,
        secondaryMemberId: secondary.id,
      });
      const profile = payload.profile || null;
      setMemberEditProfile(profile);
      setMemberEditDraft(createMemberEditDraft(profile?.member));
      setLinkSearchQuery("");
      setLinkSearchResults([]);
      updateMemberEditLocal(profile);
      setMemberEditMessage(t("guildManagement.linkSecondarySaved", "Compte secondaire lie."));
    } catch (error) {
      setMemberEditError(error?.message || t("guildManagement.linkSecondaryError", "Lien compte secondaire impossible."));
    } finally {
      setLinkActionLoading(false);
    }
  }

  async function unlinkSecondaryAccount(member) {
    if (!member?.id || linkActionLoading) return;

    const confirmed = window.confirm(
      formatText(
        t("guildManagement.unlinkSecondaryConfirm", "Delier {secondary} de son compte principal ?"),
        { secondary: member.name || member.watcherName },
      ),
    );
    if (!confirmed) return;

    setLinkActionLoading(true);
    setMemberEditError("");
    setMemberEditMessage("");

    try {
      const payload = await postPortalAccess("member-unlink-secondary", { memberId: member.id });
      const profile = payload.profile || null;
      setMemberEditProfile(profile);
      setMemberEditDraft(createMemberEditDraft(profile?.member));
      updateMemberEditLocal(profile);
      setMemberEditMessage(t("guildManagement.unlinkSecondarySaved", "Compte delie."));
    } catch (error) {
      setMemberEditError(error?.message || t("guildManagement.unlinkSecondaryError", "Deliaison impossible."));
    } finally {
      setLinkActionLoading(false);
    }
  }

  function updateHeroSearchCriterion(index, patch) {
    setHeroSearchCriteria((previous) =>
      previous.map((criterion, currentIndex) =>
        currentIndex === index ? { ...criterion, ...patch } : criterion,
      ),
    );
    setHeroSearchResults(null);
    setHeroSearchError("");
  }

  function addHeroSearchCriterion() {
    setHeroSearchCriteria((previous) => [...previous, { championId: "", heroQuery: "", minAwakening: 0 }]);
    setHeroSearchResults(null);
    setHeroSearchError("");
  }

  function removeHeroSearchCriterion(index) {
    setHeroSearchCriteria((previous) => {
      const next = previous.filter((_, currentIndex) => currentIndex !== index);
      return next.length ? next : getEmptyHeroSearchCriteria();
    });
    setHeroSearchResults(null);
    setHeroSearchError("");
  }

  async function runHeroAvailabilitySearch(scope) {
    if (!validHeroSearchCriteria.length) {
      setHeroSearchError(t("guildManagement.heroSearchMissingHero", "Selectionne au moins un heros."));
      return;
    }

    setHeroSearchLoading(true);
    setHeroSearchError("");

    try {
      const payload = await postPortalAccess("hero-availability-search", {
        guildCode: activeGuildCode,
        scope,
        requirements: validHeroSearchCriteria,
      });
      setHeroSearchResults(payload);
    } catch (error) {
      console.error("Erreur recherche disponibilite heros Portal:", error);
      setHeroSearchError(error?.message || t("guildManagement.heroSearchFailed", "Recherche impossible."));
    } finally {
      setHeroSearchLoading(false);
    }
  }

  async function setDefenseVote(defense, value) {
    if (!connectedMemberId || !defense) return;

    const targetDefenseId = getDefenseLikeTargetId(defense);
    if (!targetDefenseId) return;

    try {
      const payload = await postPortalAccess("defense-vote", {
        defenseId: targetDefenseId,
        value,
      });
      setDefenseVotes(payload.defenseVotes || []);
    } catch (error) {
      console.error("Erreur ajout vote defense Portal:", error);
      setErrorMessage(error?.message || "Vote impossible.");
    }
  }

  async function transferMemberToGuild() {
    if (!memberToTransfer?.id || !targetGuildCode || targetGuildCode === memberToTransfer.guildCode) return;
    const targetAllowed = visibleGuildCodes.some(
      (guildCode) => normalizeGuildCodeKey(guildCode) === normalizeGuildCodeKey(targetGuildCode),
    );
    if (!targetAllowed) return;

    const confirmed = window.confirm(`Transferer ${memberToTransfer.name} vers ${targetGuildCode} ?`);
    if (!confirmed) return;

    const saved = await updateMemberField(
      memberToTransfer.id,
      { guild_code: targetGuildCode },
      "Erreur transfert membre Portal:",
      {
        targetMemberId: memberToTransfer.id,
        targetName: memberToTransfer.name,
        actionType: "guild_management_member_transfer",
        entityType: "member",
        entityId: String(memberToTransfer.id),
        summary: `${memberToTransfer.name} transfere de ${memberToTransfer.guildCode || activeGuildCode} vers ${targetGuildCode}`,
        metadata: {
          fromGuildCode: memberToTransfer.guildCode || activeGuildCode,
          toGuildCode: targetGuildCode,
        },
      }
    );

    if (!saved) return;

    updateMemberLocal(memberToTransfer.id, { guildCode: targetGuildCode });
    setTransferDialogOpen(false);
    setMemberToTransfer(null);
    setTargetGuildCode("");
    setSelectedMemberId((current) => (String(current) === String(memberToTransfer.id) ? null : current));
  }

  async function removeMemberFromGuild() {
    if (!isAdmin || !memberToTransfer?.id || removingMemberId) return;

    const confirmMessage = formatText(
      isPaladinSession(session)
        ? t(
            "guildManagement.leaveClusterConfirm",
            "Retirer definitivement {player} du cluster ? Cette action supprimera toutes ses donnees.",
          )
        : t(
            "guildManagement.leaveGuildConfirm",
            "Retirer definitivement {player} de la guilde ? Cette action supprimera toutes ses donnees.",
          ),
      { player: memberToTransfer.name },
    );

    if (!window.confirm(confirmMessage)) return;

    setRemovingMemberId(memberToTransfer.id);
    setSavingMessage(t("guildManagement.removingMember", "Suppression du membre en cours..."));
    setErrorMessage("");

    try {
      await postPortalAccess("guild-member-delete", {
        memberId: memberToTransfer.id,
      });

      setMembers((previous) => previous.filter((member) => String(member.id) !== String(memberToTransfer.id)));
      setDefenseVotes((previous) => previous.filter((vote) => String(vote.memberId) !== String(memberToTransfer.id)));
      setSelectedMemberId((current) => (String(current) === String(memberToTransfer.id) ? null : current));
      setTransferDialogOpen(false);
      setMemberToTransfer(null);
      setTargetGuildCode("");
    } catch (error) {
      setErrorMessage(error?.message || t("guildManagement.removeMemberError", "Suppression du membre impossible."));
    } finally {
      setRemovingMemberId("");
      setSavingMessage("");
    }
  }

  async function convertMemberToCommunity() {
    if (!isAdmin || !memberToTransfer?.id || convertingCommunityMemberId) return;

    const confirmed = window.confirm(
      formatText(
        t(
          "guildManagement.convertCommunityConfirm",
          "Passer {player} en compte communaute ? Sa box et ses donnees joueur seront conservees, mais il sortira de sa guilde actuelle.",
        ),
        { player: memberToTransfer.name },
      ),
    );

    if (!confirmed) return;

    setConvertingCommunityMemberId(memberToTransfer.id);
    setSavingMessage(t("guildManagement.convertingCommunity", "Conversion en compte communaute..."));
    setErrorMessage("");

    try {
      await postPortalAccess("guild-member-convert-community", {
        memberId: memberToTransfer.id,
      });

      setMembers((previous) => previous.filter((member) => String(member.id) !== String(memberToTransfer.id)));
      setDefenseVotes((previous) => previous.filter((vote) => String(vote.memberId) !== String(memberToTransfer.id)));
      setSelectedMemberId((current) => (String(current) === String(memberToTransfer.id) ? null : current));
      setTransferDialogOpen(false);
      setMemberToTransfer(null);
      setTargetGuildCode("");
      setSavingMessage(
        formatText(
          t("guildManagement.convertCommunitySuccess", "{player} est maintenant dans les membres communaute."),
          { player: memberToTransfer.name },
        ),
      );
    } catch (error) {
      setErrorMessage(error?.message || t("guildManagement.convertCommunityError", "Conversion communaute impossible."));
      setSavingMessage("");
    } finally {
      setConvertingCommunityMemberId("");
    }
  }

  async function addMember() {
    const cleanName = newMember.name.trim();
    const cleanDiscordId = newMember.discordId.trim();
    const cleanForumPostUrl = newMember.forumPostUrl.trim();

    if (!cleanName || !cleanDiscordId) {
      setErrorMessage("Nom joueur et ID Discord sont obligatoires.");
      return;
    }

    setAddingMember(true);
    setErrorMessage("");

    try {
      const payload = await postPortalAccess("guild-member-create", {
        name: cleanName,
        discordId: cleanDiscordId,
        forumPostUrl: cleanForumPostUrl,
        guildCode: activeGuildCode,
        role: "member",
      });

      const createdMember = payload.member;
      if (!createdMember?.id) {
        throw new Error("Creation du membre impossible.");
      }

      setMembers((previous) => [
        ...previous.filter((member) => String(member.id) !== String(createdMember.id)),
        createdMember,
      ]);
      setSelectedMemberId(createdMember.id);
      setNewMember({ name: "", discordId: "", forumPostUrl: "" });
      setAddMemberOpen(false);
      if (payload.warnings?.length) {
        setErrorMessage(`Membre cree, mais ${payload.warnings.join(" ")}`);
      }
    } catch (error) {
      console.error("Erreur ajout membre Portal:", error);
      setErrorMessage(error?.message || "Ajout du membre impossible.");
    } finally {
      setAddingMember(false);
    }
  }

  const memberEditMember = memberEditProfile?.member || null;
  const memberEditLinkedAccounts = (memberEditProfile?.linkedAccounts || []).filter(
    (member) => String(member.id) !== String(memberEditMember?.id),
  );
  const memberEditIsSecondary = memberEditMember?.linkedAccountRole === "secondary";
  const memberEditCanLinkSecondaries = Boolean(memberEditMember?.id && !memberEditIsSecondary);
  const memberEditEffectiveDiscordId = memberEditProfile?.effectiveDiscordId || memberEditDraft.discordId || "";

  return (
    <section className="space-y-5">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-300" />
              <h2 className="text-xl font-semibold text-zinc-50">{t("guildManagement.title", "Gestion des guildes")}</h2>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              {t("guildManagement.description", "Pilotage des defenses meta, statuts de preparation, roles Tour/Bulle/Bastion et transferts entre guildes.")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge className="rounded-lg border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
              <Users className="mr-1 h-3.5 w-3.5" />
              {activeMembers.length} {t("guildManagement.players", "joueurs")}
            </Badge>
            <Badge className="rounded-lg border-sky-500/30 bg-sky-500/10 text-sky-300">
              {activeDefenses.length} {t("guildManagement.defenses", "defenses")}
            </Badge>
            <Button
              type="button"
              variant="outline"
              className="rounded-lg border-cyan-500/40 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20"
              disabled={!isAdmin || loading}
              onClick={openHeroSearchModal}
            >
              <Search className="mr-2 h-4 w-4" />
              {t("guildManagement.heroSearchButton", "Qui a ces heros ?")}
            </Button>
            <Button
              type="button"
              className="rounded-lg bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
              disabled={!isAdmin}
              onClick={() => setAddMemberOpen(true)}
            >
              <UserPlus className="mr-2 h-4 w-4" />
              {t("guildManagement.addMember", "Ajouter un membre")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-lg border-violet-500/40 bg-violet-500/10 text-violet-100 hover:bg-violet-500/20"
              disabled={!isAdmin}
              onClick={openMemberEditModal}
            >
              <UserCog className="mr-2 h-4 w-4" />
              {t("guildManagement.editMember", "Modifier un joueur")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-lg border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20"
              disabled={!isAdmin || resettingStatuses || activeMembers.length === 0}
              onClick={resetActiveMemberStatuses}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {resettingStatuses
                ? t("guildManagement.resettingStatusesShort", "Reset...")
                : t("guildManagement.resetStatuses", "Tout a faire")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
              onClick={() => setRefreshTick((value) => value + 1)}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("common.refresh", "Rafraichir")}
            </Button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {visibleGuildCodes.map((guildCode) => (
            <button
              key={guildCode}
              type="button"
              onClick={() => {
                setActiveGuildCode(guildCode);
                setSelectedMemberId(null);
                setTrackedMetaDefenseId(null);
              }}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                activeGuildCode === guildCode
                  ? "border-emerald-300/60 bg-emerald-500/15 text-emerald-100"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-600 hover:text-zinc-100"
              }`}
            >
              {guildCode}
            </button>
          ))}
        </div>
      </div>

      {savingMessage ? (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
          {savingMessage}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {errorMessage}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5 text-sm text-zinc-400">
          {t("guildManagement.loading", "Chargement de la gestion des guildes...")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/70">
          <div className="min-w-[1080px] lg:min-w-0">
            <GestionDefenseTab
              members={activeMembers}
              allMembers={activeMembers}
              activeGuildCode={activeGuildCode}
              trackedMetaDefense={trackedMetaDefense}
              setTrackedMetaDefense={setTrackedMetaDefenseId}
              metaDefenseCounters={metaDefenseCounters}
              setTodoMember={(memberId) => setMemberStatus(memberId, GUILD_STATUS_TODO)}
              setVerifyMember={(memberId) => setMemberStatus(memberId, GUILD_STATUS_VERIFY)}
              validateMember={(memberId) => setMemberStatus(memberId, GUILD_STATUS_VALID)}
              setTransferDialogOpen={setTransferDialogOpen}
              setMemberToTransfer={setMemberToTransfer}
              setTargetGuildCode={setTargetGuildCode}
              setMemberAssignment={setMemberAssignment}
              defenses={activeDefenses}
              clearAssignedDefense={clearAssignedDefense}
              cleanAssignedDefenses={() => {}}
              assignDefense={assignDefense}
              setSelectedId={setSelectedMemberId}
              isAdmin={isAdmin}
              setDefenseVote={setDefenseVote}
              defenseLikesCountByRootId={defenseLikesCountByRootId}
              defenseDislikesCountByRootId={defenseDislikesCountByRootId}
              defenseVoteByRootId={defenseVoteByRootId}
              getDefenseLikeTargetId={getDefenseLikeTargetId}
              onOpenMemberPanel={openMemberPanel}
            />
          </div>
        </div>
      )}

      {addMemberOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xl rounded-lg border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10">
                  <UserPlus className="h-5 w-5 text-emerald-200" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-zinc-50">{t("guildManagement.addMember", "Ajouter un membre")}</h3>
                  <p className="mt-1 text-sm text-zinc-400">
                    {t("guildManagement.addMemberHelp", "Le joueur sera ajoute dans {guild} avec le mot de passe par defaut membre.").replace("{guild}", activeGuildCode)}
                  </p>
                </div>
              </div>

              <button
                type="button"
                className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
                onClick={() => {
                  if (addingMember) return;
                  setAddMemberOpen(false);
                }}
                title={t("common.close", "Fermer")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 grid gap-4">
              <label className="block">
                <span className="text-sm text-zinc-400">{t("guildManagement.playerName", "Nom joueur")}</span>
                <input
                  type="text"
                  value={newMember.name}
                  onChange={(event) => setNewMember((previous) => ({ ...previous, name: event.target.value }))}
                  placeholder="Ex: Robsoul"
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
                />
              </label>

              <label className="block">
                <span className="text-sm text-zinc-400">ID Discord</span>
                <input
                  type="text"
                  value={newMember.discordId}
                  onChange={(event) => setNewMember((previous) => ({ ...previous, discordId: event.target.value }))}
                  placeholder="Ex: 259417928569585665"
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
                />
              </label>

              <label className="block">
                <span className="text-sm text-zinc-400">{t("guildManagement.personalForumLink", "Lien forum personnel")}</span>
                <input
                  type="url"
                  value={newMember.forumPostUrl}
                  onChange={(event) => setNewMember((previous) => ({ ...previous, forumPostUrl: event.target.value }))}
                  placeholder="https://discord.com/channels/..."
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
                />
              </label>

              <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-4 text-sm leading-6 text-zinc-400">
                {t("guildManagement.autoCreatePrefix", "Creation automatique : profil joueur, box heros initialisee a non possede, 5 slots PB vides, role defense")}{" "}
                <span className="text-zinc-100">{t("defenses.tower", "Tour")}</span> {t("common.and", "et")} {t("guildManagement.status", "statut")}{" "}
                <span className="text-zinc-100">{t("guildManagement.todo", "A faire")}</span>.
              </div>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-zinc-700 text-zinc-200"
                disabled={addingMember}
                onClick={() => setAddMemberOpen(false)}
              >
                {t("common.cancel", "Annuler")}
              </Button>
              <Button
                type="button"
                className="rounded-lg bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
                disabled={addingMember || !newMember.name.trim() || !newMember.discordId.trim()}
                onClick={addMember}
              >
                <Plus className="mr-2 h-4 w-4" />
                {addingMember ? t("guildManagement.adding", "Ajout...") : t("common.confirm", "Confirmer")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {memberEditOpen ? (
        <MemberEditModal
          t={t}
          isLeader={isLeader}
          isAdmin={isAdmin}
          profile={memberEditProfile}
          draft={memberEditDraft}
          results={memberEditResults}
          query={memberEditQuery}
          linkedAccounts={memberEditLinkedAccounts}
          isSecondary={memberEditIsSecondary}
          canLinkSecondaries={memberEditCanLinkSecondaries}
          effectiveDiscordId={memberEditEffectiveDiscordId}
          linkQuery={linkSearchQuery}
          linkResults={linkSearchResults}
          loading={memberEditLoading}
          saving={memberEditSaving}
          linkLoading={linkActionLoading}
          linkSearchLoading={linkSearchLoading}
          error={memberEditError}
          message={memberEditMessage}
          setQuery={setMemberEditQuery}
          setDraft={setMemberEditDraft}
          setLinkQuery={setLinkSearchQuery}
          onClose={() => {
            if (memberEditLoading || memberEditSaving || linkActionLoading) return;
            setMemberEditOpen(false);
            resetMemberEditModal();
          }}
          onSearch={searchMembersToEdit}
          onLoadProfile={loadMemberEditProfile}
          onSave={saveMemberEditProfile}
          onSearchLink={searchMembersToLink}
          onLinkSecondary={linkSecondaryAccount}
          onUnlinkSecondary={unlinkSecondaryAccount}
          onResetSelection={() => {
            setMemberEditProfile(null);
            setMemberEditDraft(getEmptyMemberEditDraft());
            setLinkSearchQuery("");
            setLinkSearchResults([]);
            setMemberEditMessage("");
            setMemberEditError("");
          }}
        />
      ) : null}

      {heroSearchOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10">
                  <Search className="h-5 w-5 text-cyan-200" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-zinc-50">
                    {t("guildManagement.heroSearchTitle", "Qui possede ces heros ?")}
                  </h3>
                  <p className="mt-1 text-sm text-zinc-400">
                    {t(
                      "guildManagement.heroSearchHelp",
                      "Selectionne un ou plusieurs heros, ajoute un eveil minimum, puis lance la recherche.",
                    )}
                  </p>
                </div>
              </div>

              <button
                type="button"
                className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
                disabled={heroSearchLoading}
                onClick={closeHeroSearchModal}
                title={t("common.close", "Fermer")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-3">
              {heroSearchCriteria.map((criterion, index) => {
                const selectedChampion = criterion.championId
                  ? championOptionById.get(String(criterion.championId))
                  : null;
                const heroInputValue = criterion.heroQuery ?? selectedChampion?.label ?? "";
                const normalizedHeroQuery = normalizeHeroSearchText(heroInputValue);
                const filteredChampionOptions = championOptions
                  .filter((champion) => {
                    if (!normalizedHeroQuery) return true;
                    return [
                      champion.label,
                      champion.name,
                      champion.portal_name,
                      champion.english_name,
                    ].some((value) => normalizeHeroSearchText(value).includes(normalizedHeroQuery));
                  })
                  .slice(0, 40);

                return (
                  <div
                    key={`hero-search-${index}`}
                    className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-900/70 p-3 md:grid-cols-[minmax(0,1fr)_240px_auto]"
                  >
                    <label className="relative block">
                      <span className="whitespace-nowrap text-xs uppercase tracking-[0.18em] text-zinc-500">
                        {t("guildManagement.heroSearchHero", "Heros")}
                      </span>
                      <input
                        type="text"
                        value={heroInputValue}
                        onFocus={() => setActiveHeroSearchIndex(index)}
                        onBlur={() => {
                          window.setTimeout(() => {
                            setActiveHeroSearchIndex((current) => (current === index ? null : current));
                          }, 120);
                        }}
                        onChange={(event) => {
                          updateHeroSearchCriterion(index, {
                            championId: "",
                            heroQuery: event.target.value,
                          });
                          setActiveHeroSearchIndex(index);
                        }}
                        placeholder={t("guildManagement.heroSearchChooseHero", "Selectionner un heros")}
                        className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                      />
                      {activeHeroSearchIndex === index ? (
                        <div className="absolute left-0 right-0 top-full z-20 mt-2 max-h-72 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-1 shadow-2xl">
                          {filteredChampionOptions.length ? (
                            filteredChampionOptions.map((champion) => (
                              <button
                                key={champion.id}
                                type="button"
                                className={`block w-full rounded-md px-3 py-2 text-left text-sm transition ${
                                  String(criterion.championId) === String(champion.id)
                                    ? "bg-cyan-500/20 text-cyan-100"
                                    : "text-zinc-100 hover:bg-zinc-800"
                                }`}
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  updateHeroSearchCriterion(index, {
                                    championId: String(champion.id),
                                    heroQuery: champion.label,
                                  });
                                  setActiveHeroSearchIndex(null);
                                }}
                              >
                                {champion.label}
                              </button>
                            ))
                          ) : (
                            <div className="px-3 py-3 text-sm text-zinc-500">
                              {t("guildManagement.heroSearchNoHeroMatch", "Aucun heros trouve.")}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </label>

                    <label className="block">
                      <span className="whitespace-nowrap text-xs uppercase tracking-[0.18em] text-zinc-500">
                        {t("guildManagement.heroSearchAwakening", "Eveil minimum")}
                      </span>
                      <select
                        value={criterion.minAwakening}
                        onChange={(event) =>
                          updateHeroSearchCriterion(index, { minAwakening: Number(event.target.value) })
                        }
                        className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 [&>option]:bg-zinc-950 [&>option]:text-zinc-100"
                      >
                        {[0, 1, 2, 3, 4, 5].map((awakening) => (
                          <option key={awakening} value={awakening} className="bg-zinc-950 text-zinc-100">
                            A{awakening}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="flex items-end justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 rounded-lg border-red-500/40 px-3 text-red-200 hover:bg-red-500/10"
                        disabled={heroSearchCriteria.length === 1}
                        onClick={() => removeHeroSearchCriterion(index)}
                        title={t("common.delete", "Supprimer")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}

              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-zinc-700 text-zinc-200"
                onClick={addHeroSearchCriterion}
              >
                <Plus className="mr-2 h-4 w-4" />
                {t("guildManagement.heroSearchAddHero", "Ajouter un heros")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-zinc-700 text-zinc-200"
                disabled={heroSearchLoading}
                onClick={resetHeroSearchModal}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {t("common.reset", "Reset")}
              </Button>
            </div>

            {heroSearchError ? (
              <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {heroSearchError}
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-cyan-500/40 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20"
                disabled={heroSearchLoading || validHeroSearchCriteria.length === 0}
                onClick={() => runHeroAvailabilitySearch("guild")}
              >
                <Search className="mr-2 h-4 w-4" />
                {heroSearchLoading
                  ? t("guildManagement.heroSearchRunning", "Recherche...")
                  : formatText(t("guildManagement.heroSearchGuild", "Chercher dans {guild}"), {
                      guild: activeGuildCode,
                    })}
              </Button>
              <Button
                type="button"
                className="rounded-lg bg-cyan-500 text-zinc-950 hover:bg-cyan-400"
                disabled={heroSearchLoading || validHeroSearchCriteria.length === 0}
                onClick={() => runHeroAvailabilitySearch("all")}
              >
                <Search className="mr-2 h-4 w-4" />
                {heroSearchLoading
                  ? t("guildManagement.heroSearchRunning", "Recherche...")
                  : t("guildManagement.heroSearchCluster", "Chercher dans tout le dashboard")}
              </Button>
            </div>

            {heroSearchResults ? (
              <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                      {t("guildManagement.heroSearchResults", "Resultats")}
                    </div>
                    <div className="mt-1 text-lg font-semibold text-zinc-50">
                      {heroSearchResults.results?.length || 0}{" "}
                      {t("guildManagement.heroSearchPlayersFound", "joueur(s) trouve(s)")}
                    </div>
                  </div>
                  <Badge className="rounded-lg border-cyan-500/30 bg-cyan-500/10 text-cyan-200">
                    {heroSearchResults.scope === "all"
                      ? t("guildManagement.heroSearchScopeAll", "Dashboard entier")
                      : heroSearchResults.guildCode || activeGuildCode}
                  </Badge>
                </div>

                {heroSearchResults.results?.length ? (
                  <div className="mt-4 grid gap-2">
                    {heroSearchResults.results.map((result) => (
                      <div
                        key={result.memberId}
                        className="rounded-lg border border-zinc-800 bg-black/25 px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-zinc-100">{result.name}</span>
                          {heroSearchResults.scope === "all" ? (
                            <Badge className="rounded-md border-zinc-700 bg-zinc-900 text-zinc-300">
                              {result.guildCode || "-"}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-400">
                          {(result.matches || []).map((match) => (
                            <span
                              key={`${result.memberId}-${match.championId}`}
                              className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-200"
                            >
                              {match.heroName} A{match.awakening}
                              {Number(match.minAwakening) > 0 ? ` / min A${match.minAwakening}` : ""}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg border border-zinc-800 bg-black/25 px-4 py-6 text-center text-sm text-zinc-400">
                    {t("guildManagement.heroSearchNoResult", "Aucun joueur ne correspond a ces conditions.")}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {memberPanelOpen && memberPanelMember ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10">
                  <MessageSquare className="h-5 w-5 text-sky-200" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-zinc-50">
                    {t("guildManagement.playerPanelTitle", "Suivi Discord joueur")}
                  </h3>
                  <p className="mt-1 text-sm text-zinc-400">
                    {memberPanelMember.name} · {memberPanelMember.guildCode || activeGuildCode} · ID Discord :{" "}
                    {memberPanelMember.discordId || "-"}
                  </p>
                </div>
              </div>

              <button
                type="button"
                className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
                disabled={memberPanelSaving || memberPanelSending}
                onClick={() => {
                  if (memberPanelSaving || memberPanelSending) return;
                  setMemberPanelOpen(false);
                  setMemberPanelMember(null);
                }}
                title={t("common.close", "Fermer")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 grid gap-4">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                  {t("guildManagement.assignedDefenses", "Defenses assignees")}
                </div>
                <div className="mt-2 grid gap-2 text-sm text-zinc-200 sm:grid-cols-2">
                  {[memberPanelMember.defense1, memberPanelMember.defense2].map((defenseName, index) => (
                    <div key={`${defenseName || "empty"}-${index}`} className="rounded-lg border border-zinc-800 bg-black/25 px-3 py-2">
                      <span className="text-zinc-500">Def {index + 1}</span>
                      <div className="mt-1 font-semibold text-zinc-100">
                        {defenseName && defenseName !== EMPTY_DEFENSE && defenseName !== "—"
                          ? defenseName
                          : t("common.empty", "Vide")}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <label className="block">
                <span className="text-sm text-zinc-400">
                  {t("guildManagement.personalChatLink", "Lien du tchat personnalise Discord")}
                </span>
                <input
                  type="url"
                  value={memberPanelForumUrl}
                  onChange={(event) => setMemberPanelForumUrl(event.target.value)}
                  placeholder="https://discord.com/channels/..."
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/20"
                />
              </label>

              <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 text-sm leading-6 text-zinc-400">
                {t(
                  "guildManagement.discordSendHelp",
                  "Le bouton d'envoi transmet les defenses en MP au joueur et copie le meme message dans son tchat personnalise si le lien est renseigne.",
                )}
              </div>

              {!discordCapabilitiesReady || !defenseDiscordEnabled ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  {discordCapabilitiesReady
                    ? defenseDiscordDisabledMessage
                    : t("guildManagement.discordCapabilityMigrationMissing", "Migration capabilities Discord non executee.")}
                </div>
              ) : null}

              <label className="block">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-zinc-400">
                    {t("guildManagement.discordMessageLabel", "Message Discord a envoyer")}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 rounded-lg border-zinc-700 px-2 text-xs text-zinc-200"
                    disabled={memberPanelSending}
                    onClick={() => setMemberPanelCustomMessage(buildMemberDefenseMessageDraft(memberPanelMember))}
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    {t("guildManagement.resetDiscordMessage", "Reinitialiser")}
                  </Button>
                </div>
                <textarea
                  value={memberPanelCustomMessage}
                  onChange={(event) => setMemberPanelCustomMessage(event.target.value)}
                  rows={14}
                  className="mt-2 min-h-56 w-full resize-y rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-3 font-mono text-sm leading-6 text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/20"
                />
                <span className="mt-2 block text-xs leading-5 text-zinc-500">
                  {t(
                    "guildManagement.discordMessageDraftHelp",
                    "Tu peux modifier les infos et conditions ici : cela personnalise uniquement le message Discord, sans modifier les defenses sources.",
                  )}
                </span>
              </label>

              {memberPanelMessage ? (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  {memberPanelMessage}
                </div>
              ) : null}

              {memberPanelError ? (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {memberPanelError}
                </div>
              ) : null}
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-zinc-700 text-zinc-200"
                disabled={!memberPanelForumUrl.trim()}
                onClick={() => openDiscordTarget(memberPanelForumUrl)}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                {t("guildManagement.openPersonalChat", "Ouvrir le tchat")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-zinc-700 text-zinc-200"
                disabled={memberPanelSaving}
                onClick={() => saveMemberForumPostUrl()}
              >
                <Save className="mr-2 h-4 w-4" />
                {memberPanelSaving ? t("common.saving", "Sauvegarde...") : t("common.save", "Sauvegarder")}
              </Button>
              <Button
                type="button"
                className="rounded-lg bg-sky-500 text-zinc-950 hover:bg-sky-400"
                disabled={
                  memberPanelSending ||
                  !isAdmin ||
                  !discordCapabilitiesReady ||
                  !defenseDiscordEnabled ||
                  getAssignedDefenseNames(memberPanelMember).length === 0 ||
                  !memberPanelCustomMessage.trim()
                }
                onClick={sendMemberDefensesToDiscord}
              >
                <Send className="mr-2 h-4 w-4" />
                {memberPanelSending
                  ? t("guildManagement.sending", "Envoi...")
                  : t("guildManagement.sendDefenses", "Envoyer les defenses")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {transferDialogOpen && memberToTransfer ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10">
                <ArrowRightLeft className="h-5 w-5 text-amber-200" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-zinc-50">{t("guildManagement.transferPlayer", "Transferer un joueur")}</h3>
                <p className="mt-1 text-sm text-zinc-400">
                  {memberToTransfer.name} est actuellement dans {memberToTransfer.guildCode || activeGuildCode}.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-2">
              {visibleGuildCodes
                .filter(
                  (guildCode) =>
                    normalizeGuildCodeKey(guildCode) !==
                    normalizeGuildCodeKey(memberToTransfer.guildCode || activeGuildCode),
                )
                .map((guildCode) => (
                  <button
                    key={guildCode}
                    type="button"
                    onClick={() => setTargetGuildCode(guildCode)}
                    className={`rounded-lg border px-4 py-3 text-left text-sm transition ${
                      targetGuildCode === guildCode
                        ? "border-amber-300/70 bg-amber-500/15 text-amber-100"
                        : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:text-white"
                    }`}
                  >
                    {guildCode}
                  </button>
                ))}
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              {isAdmin ? (
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-lg border-cyan-500/40 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20"
                  disabled={Boolean(removingMemberId || convertingCommunityMemberId)}
                  onClick={convertMemberToCommunity}
                >
                  {convertingCommunityMemberId === memberToTransfer.id
                    ? t("guildManagement.convertingCommunityShort", "Conversion...")
                    : t("guildManagement.convertCommunity", "Passer en communaute")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="destructive"
                className="rounded-lg bg-red-700 text-white hover:bg-red-600"
                disabled={Boolean(removingMemberId || convertingCommunityMemberId)}
                onClick={removeMemberFromGuild}
              >
                {removingMemberId === memberToTransfer.id
                  ? t("guildManagement.removing", "Suppression...")
                  : removeMemberLabel}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-zinc-700 text-zinc-200"
                disabled={Boolean(removingMemberId || convertingCommunityMemberId)}
                onClick={() => {
                  setTransferDialogOpen(false);
                  setMemberToTransfer(null);
                  setTargetGuildCode("");
                }}
              >
                {t("common.cancel", "Annuler")}
              </Button>
              <Button
                type="button"
                className="rounded-lg bg-amber-500 text-zinc-950 hover:bg-amber-400"
                disabled={
                  Boolean(removingMemberId || convertingCommunityMemberId) ||
                  !targetGuildCode ||
                  !visibleGuildCodes.some(
                    (guildCode) => normalizeGuildCodeKey(guildCode) === normalizeGuildCodeKey(targetGuildCode),
                  )
                }
                onClick={transferMemberToGuild}
              >
                {t("guildManagement.transferAction", "Transferer")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
