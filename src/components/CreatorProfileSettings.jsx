import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Youtube,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCreatorLinkPlatformLabel } from "@/lib/creatorLinkPlatforms";
import { usePortalLanguage } from "@/lib/portalLanguage";

const EMPTY_LINK = { id: "", title: "", url: "", platform: "link", sortOrder: 0 };

async function callPveCreatorsApi(payload) {
  const response = await fetch("/api/pve-creators", {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload || {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error || "Traitement createur impossible.");
  }
  return result;
}

function normalizeExternalUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("//")) return `https:${raw}`.replace(/\/+$/, "");
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, "");
}

function normalizeCreatorLink(link, index) {
  return {
    id: String(link?.id || ""),
    title: String(link?.title || "").trim(),
    url: normalizeExternalUrl(link?.url || ""),
    platform: String(link?.platform || "link").trim() || "link",
    sortOrder: Number(link?.sortOrder ?? link?.sort_order ?? index),
  };
}

function normalizeCreatorProfile(profile) {
  if (!profile?.id) return null;

  return {
    id: String(profile.id),
    name: String(profile.name || "").trim(),
    creatorKey: String(profile.creatorKey || profile.creator_key || "").trim(),
    channelUrl: normalizeExternalUrl(profile.channelUrl || profile.channel_url || ""),
    avatarUrl: normalizeExternalUrl(profile.avatarUrl || profile.avatar_url || ""),
    youtubeChannelId: String(profile.youtubeChannelId || profile.youtube_channel_id || "").trim(),
    bio: String(profile.bio || "").replace(/\r\n?/g, "\n").trim(),
    lastYoutubeSyncAt: String(profile.lastYoutubeSyncAt || profile.last_youtube_sync_at || "").trim(),
    links: Array.isArray(profile.links)
      ? profile.links
          .map(normalizeCreatorLink)
          .filter((link) => link.title || link.url)
          .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
      : [],
    linkLimit: Number(profile.linkLimit || profile.link_limit || 10),
  };
}

function createDraftLink() {
  return {
    ...EMPTY_LINK,
    id: `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  };
}

export default function CreatorProfileSettings() {
  const { t } = usePortalLanguage();
  const [profile, setProfile] = useState(null);
  const [bio, setBio] = useState("");
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const linkLimit = useMemo(() => Math.max(1, Number(profile?.linkLimit || 10)), [profile?.linkLimit]);
  const canAddLink = links.length < linkLimit;

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      setLoading(true);
      setMessage("");
      setErrorMessage("");

      try {
        const payload = await callPveCreatorsApi({ action: "my-profile" });
        if (cancelled) return;

        const normalizedProfile = normalizeCreatorProfile(payload.profile);
        setProfile(normalizedProfile);
        setBio(normalizedProfile?.bio || "");
        setLinks(normalizedProfile?.links || []);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error?.message || t("settings.creatorProfileLoadError", "Profil createur indisponible."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [t]);

  function updateLink(index, field, value) {
    setLinks((previous) =>
      previous.map((link, currentIndex) =>
        currentIndex === index
          ? {
              ...link,
              [field]: value,
            }
          : link,
      ),
    );
  }

  function removeLink(index) {
    setLinks((previous) => previous.filter((_, currentIndex) => currentIndex !== index));
  }

  function moveLink(index, direction) {
    setLinks((previous) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= previous.length) return previous;
      const next = [...previous];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (!profile?.id || saving) return;

    setSaving(true);
    setMessage("");
    setErrorMessage("");

    try {
      const payload = await callPveCreatorsApi({
        action: "update-profile",
        creatorId: profile.id,
        bio,
        links: links
          .map((link) => ({
            id: link.id,
            title: String(link.title || "").trim(),
            url: String(link.url || "").trim(),
          }))
          .filter((link) => link.title || link.url),
      });
      const normalizedProfile = normalizeCreatorProfile(payload.profile);
      setProfile(normalizedProfile);
      setBio(normalizedProfile?.bio || "");
      setLinks(normalizedProfile?.links || []);
      setMessage(t("settings.creatorProfileSaved", "Profil createur sauvegarde."));
    } catch (error) {
      setErrorMessage(error?.message || t("settings.creatorProfileSaveError", "Sauvegarde impossible."));
    } finally {
      setSaving(false);
    }
  }

  async function refreshYoutube() {
    if (!profile?.id || refreshing) return;

    setRefreshing(true);
    setMessage("");
    setErrorMessage("");

    try {
      const payload = await callPveCreatorsApi({
        action: "refresh-youtube",
        creatorId: profile.id,
      });
      const normalizedProfile = normalizeCreatorProfile(payload.profile);
      setProfile(normalizedProfile);
      setBio(normalizedProfile?.bio || "");
      setLinks(normalizedProfile?.links || []);
      setMessage(t("settings.creatorProfileYoutubeRefreshed", "Informations YouTube actualisees."));
    } catch (error) {
      setErrorMessage(error?.message || t("settings.creatorProfileYoutubeError", "Actualisation YouTube impossible."));
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5 text-sm text-zinc-400">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("settings.creatorProfileChecking", "Verification du profil createur...")}
        </span>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/10 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {profile.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt=""
              className="h-16 w-16 shrink-0 rounded-full border border-zinc-700 bg-zinc-900 object-cover"
            />
          ) : (
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-xl font-bold text-zinc-400">
              {(profile.name || "?").charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-300">
              {t("settings.creatorProfileEyebrow", "Profil createur")}
            </div>
            <h3 className="truncate text-xl font-semibold text-white">{profile.name}</h3>
            {profile.youtubeChannelId ? (
              <div className="mt-1 truncate text-xs text-zinc-500">{profile.youtubeChannelId}</div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {profile.channelUrl ? (
            <a
              href={profile.channelUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-2 rounded-xl border border-red-800 bg-red-950/35 px-3 py-2 text-sm font-semibold text-red-100 hover:bg-red-900/50"
            >
              <Youtube className="h-4 w-4" />
              {t("pve.openCreatorChannel", "Voir la chaine")}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
          <Button
            type="button"
            onClick={refreshYoutube}
            disabled={refreshing || !profile.channelUrl}
            variant="outline"
            className="rounded-xl border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing
              ? t("pve.refreshingYoutube", "Actualisation...")
              : t("pve.refreshYoutube", "Actualiser depuis YouTube")}
          </Button>
        </div>
      </div>

      {message ? (
        <div className="mt-4 rounded-xl border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-100">
          {message}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="mt-4 rounded-xl border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {errorMessage}
        </div>
      ) : null}

      <form onSubmit={saveProfile} className="mt-5 space-y-4">
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <label htmlFor="creator-profile-bio" className="text-sm font-semibold text-zinc-300">
              {t("settings.creatorBio", "Bio")}
            </label>
            <span className="text-xs text-zinc-500">{bio.length}/1000</span>
          </div>
          <textarea
            id="creator-profile-bio"
            value={bio}
            onChange={(event) => setBio(event.target.value.slice(0, 1000))}
            rows={5}
            placeholder={t("settings.creatorBioPlaceholder", "Presentation, contenu prefere, planning...")}
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-600"
          />
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-zinc-300">{t("settings.creatorLinks", "Liens")}</div>
              <div className="mt-1 text-xs text-zinc-500">
                {t("settings.creatorLinksHelp", "Ajoute jusqu'a {count} liens publics.")
                  .replace("{count}", String(linkLimit))}
              </div>
            </div>
            <Button
              type="button"
              onClick={() => setLinks((previous) => [...previous, createDraftLink()])}
              disabled={!canAddLink}
              variant="outline"
              className="rounded-xl border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              {t("common.add", "Ajouter")}
            </Button>
          </div>

          {links.length ? (
            <div className="space-y-2">
              {links.map((link, index) => (
                <div
                  key={link.id || `creator-link-${index}`}
                  className="grid gap-2 rounded-xl border border-zinc-800 bg-zinc-950 p-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_auto]"
                >
                  <input
                    value={link.title}
                    onChange={(event) => updateLink(index, "title", event.target.value)}
                    placeholder={t("settings.creatorLinkTitle", "Titre du lien")}
                    maxLength={80}
                    className="rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm text-white outline-none focus:border-emerald-600"
                  />
                  <input
                    value={link.url}
                    onChange={(event) => updateLink(index, "url", event.target.value)}
                    placeholder="https://..."
                    className="rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm text-white outline-none focus:border-emerald-600"
                  />
                  <div className="flex items-center gap-1">
                    <span className="hidden min-w-16 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-2 text-center text-xs text-zinc-400 md:inline-block">
                      {getCreatorLinkPlatformLabel(link.platform, link.url)}
                    </span>
                    <button
                      type="button"
                      onClick={() => moveLink(index, -1)}
                      disabled={index === 0}
                      className="rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                      title={t("settings.creatorLinkMoveUp", "Monter")}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveLink(index, 1)}
                      disabled={index === links.length - 1}
                      className="rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                      title={t("settings.creatorLinkMoveDown", "Descendre")}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeLink(index)}
                      className="rounded-lg border border-red-800 bg-red-950/40 p-2 text-red-200 hover:bg-red-900"
                      title={t("common.delete", "Supprimer")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950 px-4 py-5 text-sm text-zinc-500">
              <Link2 className="mr-2 inline h-4 w-4" />
              {t("settings.creatorNoLinks", "Aucun lien supplementaire.")}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving} className="rounded-xl bg-emerald-600 text-white hover:bg-emerald-500">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? t("common.saving", "Sauvegarde...") : t("common.save", "Sauvegarder")}
          </Button>
        </div>
      </form>
    </div>
  );
}
