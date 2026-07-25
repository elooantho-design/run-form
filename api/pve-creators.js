/* global process */
import { createClient } from "@supabase/supabase-js";
import {
  applyPortalCorsHeaders,
  readJsonBody,
  requirePortalAdminSession,
  sendPortalJson,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const CREATOR_SELECT = "id, name, creator_key, channel_url, avatar_url";
const CREATOR_SELECT_WITH_YOUTUBE_ID = `${CREATOR_SELECT}, youtube_channel_id`;

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

async function requirePortalAdmin(req) {
  const sessionCheck = await requirePortalAdminSession(req, supabase);
  if (sessionCheck.error) {
    return { status: sessionCheck.status, error: sessionCheck.error };
  }
  return { admin: sessionCheck.member };
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

    sendJson(res, 400, { error: "Action inconnue." });
  } catch (error) {
    sendJson(res, error.status || 500, {
      error: error.message || "Traitement createur PVE impossible.",
    });
  }
}
