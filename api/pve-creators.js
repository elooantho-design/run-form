/* global process */
import { createClient } from "@supabase/supabase-js";
import {
  applyPortalCorsHeaders,
  readJsonBody,
  requirePortalAdminSession,
  requirePortalSession,
  isPortalLeaderRole,
  sendPortalJson,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";
import {
  CREATOR_PROFILE_LINK_LIMIT,
  cleanProfileText,
  detectCreatorLinkPlatform,
  makeProfileValidationError,
  normalizeCreatorBio,
  normalizeCreatorProfileLinks,
} from "./_pve-creator-profile.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const CREATOR_SELECT = "id, name, creator_key, channel_url, avatar_url";
const CREATOR_SELECT_WITH_YOUTUBE_ID = `${CREATOR_SELECT}, youtube_channel_id`;
const CREATOR_PROFILE_SELECT = `${CREATOR_SELECT_WITH_YOUTUBE_ID}, bio, linked_member_id, last_youtube_sync_at`;
const CREATOR_LINK_SELECT = "id, creator_id, title, url, sort_order, created_at, updated_at";
const CREATOR_MEMBER_SELECT = "id, watcher_name, discord_id, guild_code, role, community_access_type, community_status";
const YOUTUBE_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

function sendJson(res, status, payload) {
  sendPortalJson(res, status, payload, res._portalReq || null);
}

async function readBody(req) {
  return readJsonBody(req);
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeText(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function buildCreatorKey(name) {
  const base = cleanText(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base || "creator";
}

function normalizeExternalUrl(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  if (raw.startsWith("//")) return `https:${raw}`.replace(/\/+$/, "");
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, "");
}

function normalizeChannelUrlKey(value) {
  const normalizedUrl = normalizeExternalUrl(value);
  if (!normalizedUrl) return "";

  try {
    const url = new URL(normalizedUrl);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    const path = url.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${path}`;
  } catch {
    return normalizedUrl
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  }
}

function normalizeCreator(row) {
  return {
    id: String(row?.id || ""),
    name: cleanText(row?.name),
    creator_key: cleanText(row?.creator_key),
    channel_url: normalizeExternalUrl(row?.channel_url),
    avatar_url: normalizeExternalUrl(row?.avatar_url),
    youtube_channel_id: cleanText(row?.youtube_channel_id),
    bio: cleanProfileText(row?.bio),
    linked_member_id: cleanText(row?.linked_member_id),
    last_youtube_sync_at: cleanText(row?.last_youtube_sync_at),
  };
}

function isMissingYoutubeChannelColumn(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const message = String(error.message || error.details || error.hint || "");

  return (
    code === "PGRST204" ||
    (message.includes("youtube_channel_id") &&
      (message.includes("schema cache") ||
        message.includes("does not exist") ||
        message.includes("Could not find the") ||
        message.includes("column")))
  );
}

function isMissingCreatorProfileSchemaError(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const message = String(error.message || error.details || error.hint || "");

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "PGRST204" ||
    ((message.includes("bio") ||
      message.includes("linked_member_id") ||
      message.includes("last_youtube_sync_at") ||
      message.includes("pve_creator_links")) &&
      (message.includes("schema cache") ||
        message.includes("does not exist") ||
        message.includes("Could not find the") ||
        message.includes("column") ||
        message.includes("table")))
  );
}

async function requirePortalAdmin(req) {
  const sessionCheck = await requirePortalAdminSession(req, supabase);
  if (sessionCheck.error) {
    return { status: sessionCheck.status, error: sessionCheck.error };
  }
  return { admin: sessionCheck.member };
}

async function requireCreatorLinkManager(req) {
  const sessionCheck = await requirePortalSession(req, supabase);
  if (sessionCheck.error) {
    return { status: sessionCheck.status, error: sessionCheck.error };
  }
  if (!isPortalLeaderRole(sessionCheck.member?.role)) {
    return { status: 403, error: "Acces leader requis pour gerer les liaisons createur." };
  }
  return { manager: sessionCheck.member };
}

async function requirePortalUser(req) {
  const sessionCheck = await requirePortalSession(req, supabase);
  if (sessionCheck.error) {
    return { status: sessionCheck.status, error: sessionCheck.error };
  }
  return { member: sessionCheck.member };
}

async function listCreators() {
  let { data, error } = await supabase
    .from("pve_creators")
    .select(CREATOR_SELECT_WITH_YOUTUBE_ID)
    .order("name", { ascending: true });

  if (isMissingYoutubeChannelColumn(error)) {
    const fallback = await supabase
      .from("pve_creators")
      .select(CREATOR_SELECT)
      .order("name", { ascending: true });
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  return (data || []).map(normalizeCreator);
}

async function findCreatorById(creatorId) {
  let { data, error } = await supabase
    .from("pve_creators")
    .select(CREATOR_SELECT_WITH_YOUTUBE_ID)
    .eq("id", creatorId)
    .maybeSingle();

  if (isMissingYoutubeChannelColumn(error)) {
    const fallback = await supabase
      .from("pve_creators")
      .select(CREATOR_SELECT)
      .eq("id", creatorId)
      .maybeSingle();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  return data ? normalizeCreator(data) : null;
}

async function findExistingCreator({ creatorKey, channelUrl, channelUrls, youtubeChannelId }) {
  const creators = await listCreators();
  const channelKeys = new Set(
    [channelUrl, ...(Array.isArray(channelUrls) ? channelUrls : [])]
      .map(normalizeChannelUrlKey)
      .filter(Boolean),
  );
  const normalizedCreatorKey = normalizeText(creatorKey);
  const normalizedYoutubeChannelId = cleanText(youtubeChannelId);

  return (
    creators.find((creator) => normalizedCreatorKey && normalizeText(creator.creator_key) === normalizedCreatorKey) ||
    creators.find((creator) => normalizedYoutubeChannelId && creator.youtube_channel_id === normalizedYoutubeChannelId) ||
    creators.find((creator) => channelKeys.has(normalizeChannelUrlKey(creator.channel_url))) ||
    null
  );
}

function getYoutubeDataApiKey() {
  return cleanText(process.env.YOUTUBE_DATA_API_KEY || process.env.YOUTUBE_API_KEY);
}

function makeYoutubeError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  error.isYoutubeError = true;
  return error;
}

async function fetchYoutubeApi(pathname, params) {
  const apiKey = getYoutubeDataApiKey();
  if (!apiKey) {
    throw makeYoutubeError(
      "YOUTUBE_DATA_API_KEY manquante cote serveur. Tu peux creer le createur manuellement en renseignant son nom.",
      503,
    );
  }

  const url = new URL(`${YOUTUBE_API_BASE}/${pathname}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  url.searchParams.set("key", apiKey);

  let response;
  try {
    response = await fetch(url);
  } catch {
    throw makeYoutubeError(
      "YouTube ne repond pas pour le moment. Tu peux creer le createur manuellement.",
      502,
    );
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = cleanText(payload?.error?.errors?.[0]?.reason || payload?.error?.status);
    const message = cleanText(payload?.error?.message);

    if (["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"].includes(reason)) {
      throw makeYoutubeError(
        "Quota YouTube atteint. Tu peux creer le createur manuellement, puis relancer la recuperation plus tard.",
        429,
      );
    }

    throw makeYoutubeError(
      message || "YouTube a refuse la recuperation automatique du createur.",
      response.status || 502,
    );
  }

  return payload;
}

function getYoutubeUrl(value) {
  const raw = cleanText(value);
  if (!raw) return null;

  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

function extractYoutubeVideoId(value) {
  const raw = cleanText(value);
  if (!raw) return "";

  const directVideoId = raw.match(/^[a-zA-Z0-9_-]{11}$/);
  if (directVideoId) return raw;

  const url = getYoutubeUrl(raw);
  if (url) {
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || "";

    if (host.endsWith("youtube.com")) {
      const watchId = url.searchParams.get("v");
      if (watchId) return watchId;

      const parts = url.pathname.split("/").filter(Boolean);
      const markerIndex = parts.findIndex((part) => ["embed", "shorts", "live"].includes(part));
      if (markerIndex >= 0) return parts[markerIndex + 1] || "";
    }
  }

  const looseMatch = raw.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([a-zA-Z0-9_-]{11})/);
  return looseMatch?.[1] || "";
}

function parseYoutubeChannelLocator(value) {
  const raw = cleanText(value);
  if (!raw) return null;

  if (/^UC[a-zA-Z0-9_-]{10,}$/i.test(raw)) {
    return { channelId: raw };
  }

  if (raw.startsWith("@")) {
    return { handle: raw.replace(/^@+/, "") };
  }

  const videoId = extractYoutubeVideoId(raw);
  if (videoId) return { videoId };

  const url = getYoutubeUrl(raw);
  if (!url) return null;

  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  if (!host.includes("youtube.com")) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "channel" && parts[1]) return { channelId: parts[1] };
  if (parts[0]?.startsWith("@")) return { handle: parts[0].replace(/^@+/, "") };

  return null;
}

function pickBestThumbnail(thumbnails) {
  const candidates = Object.values(thumbnails || {})
    .filter((thumbnail) => thumbnail?.url)
    .sort((left, right) => {
      const leftSize = Number(left.width || 0) * Number(left.height || 0);
      const rightSize = Number(right.width || 0) * Number(right.height || 0);
      return rightSize - leftSize;
    });

  return normalizeExternalUrl(candidates[0]?.url || "");
}

function normalizeYoutubeChannel(item) {
  const channelId = cleanText(item?.id);
  const snippet = item?.snippet || {};
  const name = cleanText(snippet.title);

  if (!channelId || !name) return null;

  return {
    youtubeChannelId: channelId,
    name,
    creatorKey: buildCreatorKey(name),
    channelUrl: `https://www.youtube.com/channel/${channelId}`,
    avatarUrl: pickBestThumbnail(snippet.thumbnails),
  };
}

async function fetchYoutubeChannelById(channelId) {
  const payload = await fetchYoutubeApi("channels", {
    part: "snippet",
    id: channelId,
    maxResults: 1,
  });

  return normalizeYoutubeChannel(payload?.items?.[0]);
}

async function fetchYoutubeChannelByHandle(handle) {
  const cleanHandle = cleanText(handle).replace(/^@+/, "");
  if (!cleanHandle) return null;

  let payload = await fetchYoutubeApi("channels", {
    part: "snippet",
    forHandle: cleanHandle,
    maxResults: 1,
  });

  if (!payload?.items?.length) {
    payload = await fetchYoutubeApi("channels", {
      part: "snippet",
      forHandle: `@${cleanHandle}`,
      maxResults: 1,
    });
  }

  return normalizeYoutubeChannel(payload?.items?.[0]);
}

async function fetchYoutubeChannelByVideoId(videoId) {
  const videoPayload = await fetchYoutubeApi("videos", {
    part: "snippet",
    id: videoId,
    maxResults: 1,
  });
  const channelId = cleanText(videoPayload?.items?.[0]?.snippet?.channelId);
  if (!channelId) return null;

  return fetchYoutubeChannelById(channelId);
}

async function fetchYoutubeCreatorInfo(inputUrl) {
  const locator = parseYoutubeChannelLocator(inputUrl);
  if (!locator) {
    throw makeYoutubeError(
      "Lien YouTube non reconnu. Utilise une URL de video, une URL /channel/ ou une URL avec @handle.",
      400,
    );
  }

  const channel =
    (locator.channelId && (await fetchYoutubeChannelById(locator.channelId))) ||
    (locator.handle && (await fetchYoutubeChannelByHandle(locator.handle))) ||
    (locator.videoId && (await fetchYoutubeChannelByVideoId(locator.videoId))) ||
    null;

  if (!channel) {
    throw makeYoutubeError(
      "Createur YouTube introuvable. Tu peux renseigner la fiche manuellement.",
      404,
    );
  }

  return channel;
}

async function insertCreator(payload) {
  let { data, error } = await supabase
    .from("pve_creators")
    .insert(payload)
    .select(CREATOR_SELECT_WITH_YOUTUBE_ID)
    .single();

  if (isMissingYoutubeChannelColumn(error)) {
    const fallbackPayload = { ...payload };
    delete fallbackPayload.youtube_channel_id;

    const fallback = await supabase
      .from("pve_creators")
      .insert(fallbackPayload)
      .select(CREATOR_SELECT)
      .single();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  return normalizeCreator(data);
}

async function updateCreatorFields(creatorId, patch) {
  if (!Object.keys(patch).length) return findCreatorById(creatorId);

  let { data, error } = await supabase
    .from("pve_creators")
    .update(patch)
    .eq("id", creatorId)
    .select(CREATOR_SELECT_WITH_YOUTUBE_ID)
    .single();

  if (isMissingYoutubeChannelColumn(error)) {
    const fallbackPatch = { ...patch };
    delete fallbackPatch.youtube_channel_id;

    const fallback = await supabase
      .from("pve_creators")
      .update(fallbackPatch)
      .eq("id", creatorId)
      .select(CREATOR_SELECT)
      .single();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  return normalizeCreator(data);
}

async function patchExistingCreator(existing, desired) {
  const patch = {};

  if (!existing.youtube_channel_id && desired.youtube_channel_id) {
    patch.youtube_channel_id = desired.youtube_channel_id;
  }
  if (!existing.channel_url && desired.channel_url) {
    patch.channel_url = desired.channel_url;
  }
  if (!existing.avatar_url && desired.avatar_url) {
    patch.avatar_url = desired.avatar_url;
  }

  return updateCreatorFields(existing.id, patch);
}

async function createOrReuseCreator(input) {
  const manualName = cleanText(input?.name);
  const manualChannelUrl = normalizeExternalUrl(input?.channelUrl || input?.channel_url);
  const manualAvatarUrl = normalizeExternalUrl(input?.avatarUrl || input?.avatar_url);
  const lookupUrl = cleanText(
    input?.youtubeLookupUrl ||
      input?.youtube_lookup_url ||
      input?.channelLookupUrl ||
      input?.channel_lookup_url ||
      input?.lookupUrl ||
      input?.lookup_url ||
      manualChannelUrl,
  );

  let youtubeInfo = null;
  let youtubeWarning = "";

  if (lookupUrl) {
    try {
      youtubeInfo = await fetchYoutubeCreatorInfo(lookupUrl);
    } catch (error) {
      youtubeWarning = error.message || "Recuperation YouTube impossible.";
      if (!manualName) {
        throw error;
      }
    }
  }

  const name = manualName || youtubeInfo?.name || "";
  if (!name) {
    const error = new Error("Nom du createur obligatoire.");
    error.status = 400;
    throw error;
  }

  const channelUrl = manualChannelUrl || youtubeInfo?.channelUrl || "";
  const avatarUrl = manualAvatarUrl || youtubeInfo?.avatarUrl || "";
  const youtubeChannelId = youtubeInfo?.youtubeChannelId || "";
  const creatorKey = buildCreatorKey(input?.creatorKey || input?.creator_key || name);

  const existing = await findExistingCreator({
    creatorKey,
    channelUrl,
    channelUrls: [manualChannelUrl, lookupUrl, youtubeInfo?.channelUrl],
    youtubeChannelId,
  });
  if (existing) {
    const creator = await patchExistingCreator(existing, {
      channel_url: channelUrl || null,
      avatar_url: avatarUrl || null,
      youtube_channel_id: youtubeChannelId || null,
    });
    return { creator, youtubeWarning };
  }

  const creator = await insertCreator({
    name,
    creator_key: creatorKey,
    channel_url: channelUrl || null,
    avatar_url: avatarUrl || null,
    youtube_channel_id: youtubeChannelId || null,
  });

  return { creator, youtubeWarning };
}

function normalizeCreatorLink(row) {
  const url = normalizeExternalUrl(row?.url);
  return {
    id: String(row?.id || ""),
    creator_id: String(row?.creator_id || ""),
    title: cleanProfileText(row?.title),
    url,
    sort_order: Number(row?.sort_order ?? 0),
    platform: detectCreatorLinkPlatform(url),
  };
}

function normalizeLinkedMember(row) {
  if (!row?.id) return null;

  return {
    id: String(row.id),
    watcherName: cleanText(row.watcher_name),
    discordId: cleanText(row.discord_id),
    guildCode: cleanText(row.guild_code),
    role: cleanText(row.role),
    communityAccessType: cleanText(row.community_access_type),
    communityStatus: cleanText(row.community_status),
  };
}

function getSessionMemberId(member) {
  return String(member?.id || member?.member_id || member?.memberId || "");
}

function canManageCreator(member) {
  return isPortalLeaderRole(member?.role);
}

function canEditCreatorProfile(member, creator) {
  const sessionMemberId = getSessionMemberId(member);
  if (!sessionMemberId || !creator?.id) return false;
  return canManageCreator(member) || (creator.linked_member_id && creator.linked_member_id === sessionMemberId);
}

function buildCreatorProfilePayload({
  creator,
  links = [],
  linkedMember = null,
  sessionMember = null,
  profileSchemaReady = true,
  linksSchemaReady = true,
}) {
  const canManage = canManageCreator(sessionMember);
  const canEdit = canEditCreatorProfile(sessionMember, creator);

  return {
    id: creator.id,
    name: creator.name,
    creatorKey: creator.creator_key,
    channelUrl: creator.channel_url,
    avatarUrl: creator.avatar_url,
    youtubeChannelId: creator.youtube_channel_id,
    bio: creator.bio || "",
    lastYoutubeSyncAt: creator.last_youtube_sync_at || "",
    links: links
      .map((link) => ({
        id: link.id,
        title: link.title,
        url: link.url,
        platform: link.platform,
        sortOrder: link.sort_order,
      }))
      .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0)),
    linkedAccount:
      canManage && linkedMember
        ? {
            id: linkedMember.id,
            watcherName: linkedMember.watcherName,
            discordId: linkedMember.discordId,
            guildCode: linkedMember.guildCode,
            role: linkedMember.role,
            communityAccessType: linkedMember.communityAccessType,
            communityStatus: linkedMember.communityStatus,
          }
        : null,
    hasLinkedAccount: Boolean(creator.linked_member_id),
    canEdit,
    canManageLink: canManage,
    profileSchemaReady,
    linksSchemaReady,
    linkLimit: CREATOR_PROFILE_LINK_LIMIT,
  };
}

async function findCreatorProfileRow({ creatorId = "", creatorKey = "" }) {
  const id = cleanText(creatorId);
  const key = cleanText(creatorKey);

  if (!id && !key) {
    const error = makeProfileValidationError("Createur manquant.");
    throw error;
  }

  let query = supabase.from("pve_creators").select(CREATOR_PROFILE_SELECT);
  query = id ? query.eq("id", id) : query.eq("creator_key", key);

  let { data, error } = await query.maybeSingle();
  let profileSchemaReady = true;

  if (isMissingCreatorProfileSchemaError(error)) {
    profileSchemaReady = false;
    let fallback = supabase.from("pve_creators").select(CREATOR_SELECT_WITH_YOUTUBE_ID);
    fallback = id ? fallback.eq("id", id) : fallback.eq("creator_key", key);
    ({ data, error } = await fallback.maybeSingle());

    if (isMissingYoutubeChannelColumn(error)) {
      let basic = supabase.from("pve_creators").select(CREATOR_SELECT);
      basic = id ? basic.eq("id", id) : basic.eq("creator_key", key);
      ({ data, error } = await basic.maybeSingle());
    }
  }

  if (error) throw error;
  if (!data) return { creator: null, profileSchemaReady };

  return { creator: normalizeCreator(data), profileSchemaReady };
}

async function loadCreatorLinks(creatorId) {
  const { data, error } = await supabase
    .from("pve_creator_links")
    .select(CREATOR_LINK_SELECT)
    .eq("creator_id", creatorId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (isMissingCreatorProfileSchemaError(error)) {
    return { links: [], linksSchemaReady: false };
  }

  if (error) throw error;
  return { links: (data || []).map(normalizeCreatorLink), linksSchemaReady: true };
}

async function loadLinkedMember(creator) {
  if (!creator?.linked_member_id) return null;

  const { data, error } = await supabase
    .from("guild_members")
    .select(CREATOR_MEMBER_SELECT)
    .eq("id", creator.linked_member_id)
    .maybeSingle();

  if (error) throw error;
  return normalizeLinkedMember(data);
}

async function loadCreatorProfile({ creatorId = "", creatorKey = "", sessionMember = null }) {
  const { creator, profileSchemaReady } = await findCreatorProfileRow({ creatorId, creatorKey });
  if (!creator) return null;

  const { links, linksSchemaReady } = profileSchemaReady
    ? await loadCreatorLinks(creator.id)
    : { links: [], linksSchemaReady: false };
  const linkedMember = profileSchemaReady && canManageCreator(sessionMember) ? await loadLinkedMember(creator) : null;

  return buildCreatorProfilePayload({
    creator,
    links,
    linkedMember,
    sessionMember,
    profileSchemaReady,
    linksSchemaReady,
  });
}

async function updateProfileLinks(creatorId, links) {
  const normalizedLinks = normalizeCreatorProfileLinks(links);

  const { error: deleteError } = await supabase
    .from("pve_creator_links")
    .delete()
    .eq("creator_id", creatorId);

  if (deleteError) throw deleteError;

  if (!normalizedLinks.length) return [];

  const rows = normalizedLinks.map((link) => ({
    creator_id: creatorId,
    title: link.title,
    url: link.url,
    sort_order: link.sort_order,
  }));

  const { data, error } = await supabase
    .from("pve_creator_links")
    .insert(rows)
    .select(CREATOR_LINK_SELECT)
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return (data || []).map(normalizeCreatorLink);
}

async function updateCreatorProfileAction(req, body) {
  const auth = await requirePortalUser(req);
  if (auth.error) return { status: auth.status, payload: { error: auth.error } };

  const creatorId = cleanText(body.creatorId);
  const { creator, profileSchemaReady } = await findCreatorProfileRow({ creatorId });

  if (!creator) return { status: 404, payload: { error: "Createur introuvable." } };
  if (!profileSchemaReady) {
    return { status: 409, payload: { error: "Migration profil createur requise avant modification." } };
  }
  if (!canEditCreatorProfile(auth.member, creator)) {
    return { status: 403, payload: { error: "Tu n'es pas autorise a modifier ce profil createur." } };
  }

  const bio = normalizeCreatorBio(body.bio);
  const links = Array.isArray(body.links) ? body.links : [];

  const { error: updateError } = await supabase
    .from("pve_creators")
    .update({ bio })
    .eq("id", creator.id);

  if (updateError) throw updateError;

  await updateProfileLinks(creator.id, links);
  const profile = await loadCreatorProfile({ creatorId: creator.id, sessionMember: auth.member });

  return { status: 200, payload: { ok: true, profile } };
}

async function refreshCreatorYoutubeAction(req, body) {
  const auth = await requirePortalUser(req);
  if (auth.error) return { status: auth.status, payload: { error: auth.error } };

  const creatorId = cleanText(body.creatorId);
  const { creator, profileSchemaReady } = await findCreatorProfileRow({ creatorId });

  if (!creator) return { status: 404, payload: { error: "Createur introuvable." } };
  if (!profileSchemaReady) {
    return { status: 409, payload: { error: "Migration profil createur requise avant actualisation." } };
  }
  if (!canEditCreatorProfile(auth.member, creator)) {
    return { status: 403, payload: { error: "Tu n'es pas autorise a actualiser ce profil createur." } };
  }

  const lastSyncAt = creator.last_youtube_sync_at ? Date.parse(creator.last_youtube_sync_at) : 0;
  if (lastSyncAt && Date.now() - lastSyncAt < YOUTUBE_REFRESH_COOLDOWN_MS) {
    return {
      status: 429,
      payload: { error: "Actualisation YouTube deja lancee recemment. Reessaie dans quelques minutes." },
    };
  }

  const youtubeInfo =
    (creator.youtube_channel_id && (await fetchYoutubeChannelById(creator.youtube_channel_id))) ||
    (creator.channel_url && (await fetchYoutubeCreatorInfo(creator.channel_url))) ||
    null;

  if (!youtubeInfo) {
    return { status: 400, payload: { error: "Aucune chaine YouTube valide n'est rattachee a ce createur." } };
  }

  const { error: updateError } = await supabase
    .from("pve_creators")
    .update({
      name: youtubeInfo.name,
      creator_key: buildCreatorKey(youtubeInfo.name),
      channel_url: youtubeInfo.channelUrl || null,
      avatar_url: youtubeInfo.avatarUrl || null,
      youtube_channel_id: youtubeInfo.youtubeChannelId || null,
      last_youtube_sync_at: new Date().toISOString(),
    })
    .eq("id", creator.id);

  if (updateError) throw updateError;

  const profile = await loadCreatorProfile({ creatorId: creator.id, sessionMember: auth.member });

  return { status: 200, payload: { ok: true, profile } };
}

async function getCreatorProfileAction(req, body) {
  const auth = await requirePortalUser(req);
  if (auth.error) return { status: auth.status, payload: { error: auth.error } };

  const profile = await loadCreatorProfile({
    creatorId: cleanText(body.creatorId),
    creatorKey: cleanText(body.creatorKey),
    sessionMember: auth.member,
  });

  if (!profile) return { status: 404, payload: { error: "Createur introuvable." } };
  return { status: 200, payload: { ok: true, profile } };
}

async function getMyCreatorProfileAction(req) {
  const auth = await requirePortalUser(req);
  if (auth.error) return { status: auth.status, payload: { error: auth.error } };

  const memberId = getSessionMemberId(auth.member);
  if (!memberId) return { status: 200, payload: { ok: true, profile: null } };

  let { data, error } = await supabase
    .from("pve_creators")
    .select(CREATOR_PROFILE_SELECT)
    .eq("linked_member_id", memberId)
    .maybeSingle();

  if (isMissingCreatorProfileSchemaError(error)) {
    return {
      status: 200,
      payload: { ok: true, profile: null, profileSchemaReady: false },
    };
  }

  if (error) throw error;
  if (!data) return { status: 200, payload: { ok: true, profile: null, profileSchemaReady: true } };

  const profile = await loadCreatorProfile({ creatorId: data.id, sessionMember: auth.member });
  return { status: 200, payload: { ok: true, profile, profileSchemaReady: true } };
}

async function searchMembersAction(req, body) {
  const auth = await requireCreatorLinkManager(req);
  if (auth.error) return { status: auth.status, payload: { error: auth.error } };

  const query = cleanText(body.query);
  if (query.length < 2) {
    return { status: 200, payload: { ok: true, members: [] } };
  }

  const safeQuery = query.replace(/[%_,().]/g, " ").replace(/\s+/g, " ").trim();
  if (safeQuery.length < 2) {
    return { status: 200, payload: { ok: true, members: [] } };
  }

  const pattern = `%${safeQuery}%`;
  const { data, error } = await supabase
    .from("guild_members")
    .select(CREATOR_MEMBER_SELECT)
    .or(`watcher_name.ilike.${pattern},discord_id.ilike.${pattern}`)
    .limit(20);

  if (error) throw error;

  return {
    status: 200,
    payload: {
      ok: true,
      members: (data || []).map(normalizeLinkedMember).filter(Boolean),
    },
  };
}

async function linkCreatorMemberAction(req, body) {
  const auth = await requireCreatorLinkManager(req);
  if (auth.error) return { status: auth.status, payload: { error: auth.error } };

  const creatorId = cleanText(body.creatorId);
  const memberId = cleanText(body.memberId);
  if (!creatorId || !memberId) {
    return { status: 400, payload: { error: "Createur ou compte manquant." } };
  }

  const { creator, profileSchemaReady } = await findCreatorProfileRow({ creatorId });
  if (!creator) return { status: 404, payload: { error: "Createur introuvable." } };
  if (!profileSchemaReady) {
    return { status: 409, payload: { error: "Migration profil createur requise avant liaison." } };
  }

  const { data: memberData, error: memberError } = await supabase
    .from("guild_members")
    .select(CREATOR_MEMBER_SELECT)
    .eq("id", memberId)
    .maybeSingle();

  if (memberError) throw memberError;
  if (!memberData) return { status: 404, payload: { error: "Compte Dashboard introuvable." } };

  const { data: existingLink, error: existingLinkError } = await supabase
    .from("pve_creators")
    .select("id, name")
    .eq("linked_member_id", memberId)
    .maybeSingle();

  if (isMissingCreatorProfileSchemaError(existingLinkError)) {
    return { status: 409, payload: { error: "Migration profil createur requise avant liaison." } };
  }
  if (existingLinkError) throw existingLinkError;
  if (existingLink?.id && String(existingLink.id) !== creator.id) {
    return {
      status: 409,
      payload: { error: `Ce compte est deja lie au createur ${cleanText(existingLink.name) || existingLink.id}.` },
    };
  }

  const { error: updateError } = await supabase
    .from("pve_creators")
    .update({ linked_member_id: memberId })
    .eq("id", creator.id);

  if (updateError) throw updateError;

  const profile = await loadCreatorProfile({ creatorId: creator.id, sessionMember: auth.manager });
  return { status: 200, payload: { ok: true, profile } };
}

async function unlinkCreatorMemberAction(req, body) {
  const auth = await requireCreatorLinkManager(req);
  if (auth.error) return { status: auth.status, payload: { error: auth.error } };

  const creatorId = cleanText(body.creatorId);
  const { creator, profileSchemaReady } = await findCreatorProfileRow({ creatorId });
  if (!creator) return { status: 404, payload: { error: "Createur introuvable." } };
  if (!profileSchemaReady) {
    return { status: 409, payload: { error: "Migration profil createur requise avant dissociation." } };
  }

  const { error } = await supabase
    .from("pve_creators")
    .update({ linked_member_id: null })
    .eq("id", creator.id);

  if (error) throw error;

  const profile = await loadCreatorProfile({ creatorId: creator.id, sessionMember: auth.manager });
  return { status: 200, payload: { ok: true, profile } };
}

async function resolveSuggestion(req, body) {
  const auth = await requirePortalAdmin(req);
  if (auth.error) return { status: auth.status, payload: { error: auth.error } };

  const videoIds = Array.isArray(body.videoIds)
    ? body.videoIds.map((value) => cleanText(value)).filter(Boolean)
    : [];

  if (!videoIds.length || videoIds.length > 50) {
    return {
      status: 400,
      payload: { error: "Liste de videos invalide." },
    };
  }

  let creator = null;
  let youtubeWarning = "";
  const creatorId = cleanText(body.creatorId);

  if (creatorId) {
    creator = await findCreatorById(creatorId);
    if (!creator) {
      return {
        status: 404,
        payload: { error: "Createur introuvable." },
      };
    }
  } else {
    const result = await createOrReuseCreator(body.creator || {});
    creator = result.creator;
    youtubeWarning = result.youtubeWarning;
  }

  const { error: updateError } = await supabase
    .from("pve_videos")
    .update({
      creator_id: creator.id,
      suggested_creator_name: null,
      updated_at: new Date().toISOString(),
    })
    .in("id", videoIds);

  if (updateError) throw updateError;

  return {
    status: 200,
    payload: {
      ok: true,
      creator,
      videoIds,
      youtubeWarning,
    },
  };
}

async function createOrReuseCreatorAction(req, body) {
  const auth = await requirePortalAdmin(req);
  if (auth.error) return { status: auth.status, payload: { error: auth.error } };

  const result = await createOrReuseCreator(body.creator || {});

  return {
    status: 200,
    payload: {
      ok: true,
      creator: result.creator,
      youtubeWarning: result.youtubeWarning,
    },
  };
}

async function updateCreatorAction(req, body) {
  const auth = await requirePortalAdmin(req);
  if (auth.error) return { status: auth.status, payload: { error: auth.error } };

  const creatorId = cleanText(body.creatorId);
  if (!creatorId) {
    return { status: 400, payload: { error: "Createur manquant." } };
  }

  const existing = await findCreatorById(creatorId);
  if (!existing) {
    return { status: 404, payload: { error: "Createur introuvable." } };
  }

  const input = body.creator || {};
  const lookupUrl = cleanText(input.youtubeLookupUrl || input.youtube_lookup_url || input.lookupUrl || input.lookup_url);
  let youtubeInfo = null;
  let youtubeWarning = "";

  if (lookupUrl) {
    try {
      youtubeInfo = await fetchYoutubeCreatorInfo(lookupUrl);
    } catch (error) {
      youtubeWarning = error.message || "Recuperation YouTube impossible.";
    }
  }

  const name = cleanText(input.name) || youtubeInfo?.name || existing.name;
  const channelUrl = normalizeExternalUrl(input.channelUrl || input.channel_url) || youtubeInfo?.channelUrl || existing.channel_url;
  const avatarUrl = normalizeExternalUrl(input.avatarUrl || input.avatar_url) || youtubeInfo?.avatarUrl || existing.avatar_url;
  const creatorKey = buildCreatorKey(input.creatorKey || input.creator_key || name);

  const creator = await updateCreatorFields(creatorId, {
    name,
    creator_key: creatorKey,
    channel_url: channelUrl || null,
    avatar_url: avatarUrl || null,
    youtube_channel_id: youtubeInfo?.youtubeChannelId || existing.youtube_channel_id || null,
  });

  return {
    status: 200,
    payload: {
      ok: true,
      creator,
      youtubeWarning,
    },
  };
}

export default async function handler(req, res) {
  try {
    res._portalReq = req;
    applyPortalCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    if (!verifyPortalRequestOrigin(req)) {
      sendJson(res, 403, { error: "Origine de la requete refusee." });
      return;
    }

    const body = await readBody(req);
    const action = cleanText(body.action || "resolve-suggestion");

    if (action === "resolve-suggestion") {
      const result = await resolveSuggestion(req, body);
      sendJson(res, result.status, result.payload);
      return;
    }

    if (action === "create-or-reuse") {
      const result = await createOrReuseCreatorAction(req, body);
      sendJson(res, result.status, result.payload);
      return;
    }

    if (action === "update-creator") {
      const result = await updateCreatorAction(req, body);
      sendJson(res, result.status, result.payload);
      return;
    }

    if (action === "profile") {
      const result = await getCreatorProfileAction(req, body);
      sendJson(res, result.status, result.payload);
      return;
    }

    if (action === "my-profile") {
      const result = await getMyCreatorProfileAction(req);
      sendJson(res, result.status, result.payload);
      return;
    }

    if (action === "update-profile") {
      const result = await updateCreatorProfileAction(req, body);
      sendJson(res, result.status, result.payload);
      return;
    }

    if (action === "refresh-youtube") {
      const result = await refreshCreatorYoutubeAction(req, body);
      sendJson(res, result.status, result.payload);
      return;
    }

    if (action === "search-members") {
      const result = await searchMembersAction(req, body);
      sendJson(res, result.status, result.payload);
      return;
    }

    if (action === "link-member") {
      const result = await linkCreatorMemberAction(req, body);
      sendJson(res, result.status, result.payload);
      return;
    }

    if (action === "unlink-member") {
      const result = await unlinkCreatorMemberAction(req, body);
      sendJson(res, result.status, result.payload);
      return;
    }

    sendJson(res, 400, { error: "Action inconnue." });
  } catch (error) {
    sendJson(res, error.status || 500, {
      error: error.message || "Traitement createur PVE impossible.",
    });
  }
}
