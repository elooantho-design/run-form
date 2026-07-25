import { createClient } from "@supabase/supabase-js";
import {
  applyPortalCorsHeaders,
  isPortalAdminRole,
  readJsonBody,
  requirePortalSession,
  sendPortalJson,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function cleanText(value) {
  return String(value || "").trim();
}

function extractYoutubeVideoId(value) {
  const raw = cleanText(value);
  if (!raw) return "";

  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();

    if (host === "youtu.be") return url.pathname.replace(/^\//, "").split("/")[0] || "";
    if (host.endsWith("youtube.com")) {
      if (url.searchParams.get("v")) return url.searchParams.get("v") || "";
      const shortsMatch = url.pathname.match(/\/shorts\/([^/?#]+)/i);
      if (shortsMatch) return shortsMatch[1];
      const embedMatch = url.pathname.match(/\/embed\/([^/?#]+)/i);
      if (embedMatch) return embedMatch[1];
    }
  } catch {
    const directMatch = raw.match(/^[a-zA-Z0-9_-]{8,}$/);
    if (directMatch) return raw;
  }

  return "";
}

function normalizeIdList(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => cleanText(value))
    .filter(Boolean))];
}

function normalizeHeroAlternatives(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .map(([requiredChampionId, alternativeIds]) => [
        cleanText(requiredChampionId),
        normalizeIdList(alternativeIds),
      ])
      .filter(([requiredChampionId]) => Boolean(requiredChampionId))
  );
}

async function validateVideoPayload(body) {
  const contentId = cleanText(body.contentId || body.content_id);
  const videoId = cleanText(body.videoId || body.video_id || body.id);
  const youtubeUrl = cleanText(body.youtubeUrl || body.youtube_url);
  const youtubeVideoId = cleanText(body.youtubeVideoId || body.youtube_video_id) || extractYoutubeVideoId(youtubeUrl);
  const stageIds = normalizeIdList(body.stageIds || body.stage_ids);
  const heroIds = normalizeIdList(body.heroIds || body.hero_ids);
  const heroAlternatives = normalizeHeroAlternatives(body.heroAlternatives || body.hero_alternatives);
  const creatorId = cleanText(body.creatorId || body.creator_id) || null;
  const suggestedCreatorName = cleanText(body.suggestedCreatorName || body.suggested_creator_name) || null;

  if (!contentId) return { error: "Contenu PVE manquant.", status: 400 };
  if (!youtubeUrl || !youtubeVideoId) return { error: "Lien YouTube invalide.", status: 400 };
  if (!stageIds.length) return { error: "Selectionne au moins un niveau.", status: 400 };

  const { data: content, error: contentError } = await supabase
    .from("pve_contents")
    .select("id, name")
    .eq("id", contentId)
    .maybeSingle();

  if (contentError) return { error: contentError.message || "Lecture contenu PVE impossible.", status: 500 };
  if (!content) return { error: "Contenu PVE introuvable.", status: 404 };

  const { data: stages, error: stagesError } = await supabase
    .from("pve_content_stages")
    .select("id, name")
    .eq("content_id", contentId)
    .in("id", stageIds);

  if (stagesError) return { error: stagesError.message || "Verification niveaux impossible.", status: 500 };
  if ((stages || []).length !== stageIds.length) {
    return { error: "Un niveau selectionne ne correspond pas au contenu PVE.", status: 400 };
  }

  let heroes = [];
  if (heroIds.length) {
    const { data, error } = await supabase
      .from("champions")
      .select("id, name")
      .in("id", heroIds);

    if (error) return { error: error.message || "Verification heros impossible.", status: 500 };
    if ((data || []).length !== heroIds.length) return { error: "Un heros selectionne est invalide.", status: 400 };
    heroes = data || [];
  }

  const allAlternativeIds = [
    ...new Set(Object.values(heroAlternatives).flat().map(String).filter(Boolean)),
  ];
  let alternatives = [];
  if (allAlternativeIds.length) {
    const { data, error } = await supabase
      .from("champions")
      .select("id, name")
      .in("id", allAlternativeIds);

    if (error) return { error: error.message || "Verification alternatives impossible.", status: 500 };
    alternatives = data || [];
  }

  if (creatorId) {
    const { data: creator, error: creatorError } = await supabase
      .from("pve_creators")
      .select("id")
      .eq("id", creatorId)
      .maybeSingle();

    if (creatorError) return { error: creatorError.message || "Verification createur impossible.", status: 500 };
    if (!creator) return { error: "Createur introuvable.", status: 404 };
  }

  const duplicateCheck = await findDuplicateStages({
    contentId,
    youtubeVideoId,
    stageIds,
    excludeVideoId: videoId,
  });
  if (duplicateCheck.error) return duplicateCheck;
  if (duplicateCheck.stageIds.length) {
    return { error: "Cette video YouTube est deja liee a un niveau selectionne.", status: 409 };
  }

  return {
    content,
    videoId,
    youtubeUrl,
    youtubeVideoId,
    title: cleanText(body.title) || `${content.name} - ${stages?.[0]?.name || "PVE"}`,
    notes: cleanText(body.notes) || null,
    stageIds,
    heroIds,
    heroAlternatives,
    heroes,
    alternatives,
    creatorId,
    suggestedCreatorName,
  };
}

async function findDuplicateStages({ contentId, youtubeVideoId, stageIds, excludeVideoId }) {
  const { data: videos, error: videoError } = await supabase
    .from("pve_videos")
    .select("id")
    .eq("content_id", contentId)
    .eq("youtube_video_id", youtubeVideoId);

  if (videoError) return { error: videoError.message || "Verification doublon impossible.", status: 500 };

  const candidateIds = (videos || [])
    .map((video) => String(video.id))
    .filter((id) => id && id !== String(excludeVideoId || ""));

  if (!candidateIds.length) return { stageIds: [] };

  const { data: links, error: linksError } = await supabase
    .from("pve_video_stages")
    .select("stage_id")
    .in("video_id", candidateIds)
    .in("stage_id", stageIds);

  if (linksError) return { error: linksError.message || "Verification doublon impossible.", status: 500 };
  return { stageIds: [...new Set((links || []).map((row) => String(row.stage_id)))] };
}

function requireAdmin(member) {
  if (!isPortalAdminRole(member?.role)) {
    return { error: "Action reservee aux admins.", status: 403 };
  }
  return {};
}

function isMissingTableOrColumn(error, marker = "") {
  if (!error) return false;
  const code = String(error.code || "");
  const message = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`;
  const hasMarker = marker ? message.includes(marker) : true;

  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    (hasMarker &&
      (message.includes("schema cache") ||
        message.includes("does not exist") ||
        message.includes("Could not find the")))
  );
}

async function loadNavigation(req, res) {
  const { data, error } = await supabase
    .from("pve_contents")
    .select("id, slug, name, description, stage_count, sort_order, category_slug, category_name, category_sort_order, is_active")
    .eq("is_active", true)
    .order("category_sort_order", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    if (isMissingTableOrColumn(error, "pve_contents")) {
      return sendPortalJson(res, 200, { contents: [] }, req);
    }
    return sendPortalJson(res, 500, { error: error.message || "Chargement navigation PVE impossible." }, req);
  }

  return sendPortalJson(res, 200, { contents: data || [] }, req);
}

async function loadContent(req, res, member, body) {
  const contentId = cleanText(body.contentId || body.content_id);
  if (!contentId) {
    return sendPortalJson(res, 400, { error: "Contenu PVE manquant." }, req);
  }

  const [
    stagesResult,
    videosWithCreatorResult,
    videoStagesResult,
    videoHeroesResult,
    videoAlternativesResult,
    creatorsResult,
    championsResult,
    ownedHeroesResult,
  ] = await Promise.all([
    supabase
      .from("pve_content_stages")
      .select("id, content_id, stage_number, name, sort_order")
      .eq("content_id", contentId)
      .order("sort_order", { ascending: true })
      .order("stage_number", { ascending: true }),
    supabase
      .from("pve_videos")
      .select("id, content_id, creator_id, suggested_creator_name, youtube_url, youtube_video_id, title, notes, created_by_name, created_at")
      .eq("content_id", contentId)
      .order("created_at", { ascending: false }),
    supabase
      .from("pve_video_stages")
      .select("id, content_id, video_id, stage_id")
      .eq("content_id", contentId),
    supabase
      .from("pve_video_heroes")
      .select("id, content_id, video_id, champion_id, champion_name, sort_order")
      .eq("content_id", contentId),
    supabase
      .from("pve_video_hero_alternatives")
      .select("id, content_id, video_id, required_champion_id, required_champion_name, alternative_champion_id, alternative_champion_name, sort_order")
      .eq("content_id", contentId),
    supabase
      .from("pve_creators")
      .select("id, name, creator_key, channel_url, avatar_url, youtube_channel_id")
      .order("name", { ascending: true }),
    supabase.from("champions").select("*").order("name", { ascending: true }),
    supabase
      .from("member_awakenings")
      .select("champion_id, awakening_level")
      .eq("member_id", member.id)
      .gte("awakening_level", 0),
  ]);

  let videosResult = videosWithCreatorResult;
  const videoCreatorColumnMissing = isMissingTableOrColumn(videosWithCreatorResult.error, "creator_id");
  if (videoCreatorColumnMissing) {
    videosResult = await supabase
      .from("pve_videos")
      .select("id, content_id, youtube_url, youtube_video_id, title, notes, created_by_name, created_at")
      .eq("content_id", contentId)
      .order("created_at", { ascending: false });
  }

  const heroLinksMissing = isMissingTableOrColumn(videoHeroesResult.error, "pve_video_heroes");
  const alternativeLinksMissing = isMissingTableOrColumn(videoAlternativesResult.error, "pve_video_hero_alternatives");
  const creatorsMissing = isMissingTableOrColumn(creatorsResult.error, "pve_creators");

  const blockingError =
    stagesResult.error ||
    videosResult.error ||
    videoStagesResult.error ||
    (videoHeroesResult.error && !heroLinksMissing ? videoHeroesResult.error : null) ||
    (videoAlternativesResult.error && !alternativeLinksMissing ? videoAlternativesResult.error : null) ||
    (creatorsResult.error && !creatorsMissing ? creatorsResult.error : null) ||
    championsResult.error ||
    ownedHeroesResult.error;

  if (blockingError) {
    const status = isMissingTableOrColumn(blockingError) ? 200 : 500;
    return sendPortalJson(res, status, {
      error: status === 200 ? "" : blockingError.message || "Chargement PVE impossible.",
      stages: [],
      videos: [],
      videoStages: [],
      videoHeroes: [],
      videoHeroAlternatives: [],
      creators: [],
      champions: [],
      ownedChampionIds: [],
      creatorSchemaReady: false,
    }, req);
  }

  return sendPortalJson(res, 200, {
    stages: stagesResult.data || [],
    videos: videosResult.data || [],
    videoStages: videoStagesResult.data || [],
    videoHeroes: heroLinksMissing ? [] : videoHeroesResult.data || [],
    videoHeroAlternatives: alternativeLinksMissing ? [] : videoAlternativesResult.data || [],
    creators: creatorsMissing ? [] : creatorsResult.data || [],
    champions: championsResult.data || [],
    ownedChampionIds: (ownedHeroesResult.data || []).map((row) => String(row.champion_id || "")).filter(Boolean),
    creatorSchemaReady: !videoCreatorColumnMissing && !creatorsMissing,
  }, req);
}

async function replaceVideoLinks(payload) {
  const {
    content,
    videoId,
    stageIds,
    heroIds,
    heroAlternatives,
    heroes,
    alternatives,
  } = payload;

  const { error: deleteStagesError } = await supabase.from("pve_video_stages").delete().eq("video_id", videoId);
  if (deleteStagesError) throw deleteStagesError;

  const { error: insertStagesError } = await supabase.from("pve_video_stages").insert(
    stageIds.map((stageId) => ({
      content_id: content.id,
      video_id: videoId,
      stage_id: stageId,
    }))
  );
  if (insertStagesError) throw insertStagesError;

  const { error: deleteHeroesError } = await supabase.from("pve_video_heroes").delete().eq("video_id", videoId);
  if (deleteHeroesError) throw deleteHeroesError;

  const { error: deleteAlternativesError } = await supabase
    .from("pve_video_hero_alternatives")
    .delete()
    .eq("video_id", videoId);
  if (deleteAlternativesError) throw deleteAlternativesError;

  if (!heroIds.length) return;

  const heroById = new Map((heroes || []).map((hero) => [String(hero.id), hero]));
  const alternativeById = new Map((alternatives || []).map((hero) => [String(hero.id), hero]));
  const heroRows = heroIds
    .map((championId, index) => {
      const champion = heroById.get(String(championId));
      if (!champion) return null;
      return {
        content_id: content.id,
        video_id: videoId,
        champion_id: champion.id,
        champion_name: champion.name,
        sort_order: index + 1,
      };
    })
    .filter(Boolean);

  if (heroRows.length) {
    const { error } = await supabase.from("pve_video_heroes").insert(heroRows);
    if (error) throw error;
  }

  const alternativeRows = heroIds.flatMap((requiredChampionId) => {
    const requiredChampion = heroById.get(String(requiredChampionId));
    if (!requiredChampion) return [];

    return (heroAlternatives[String(requiredChampionId)] || [])
      .map((alternativeChampionId, index) => {
        const alternativeChampion = alternativeById.get(String(alternativeChampionId));
        if (!alternativeChampion) return null;
        return {
          content_id: content.id,
          video_id: videoId,
          required_champion_id: requiredChampion.id,
          required_champion_name: requiredChampion.name,
          alternative_champion_id: alternativeChampion.id,
          alternative_champion_name: alternativeChampion.name,
          sort_order: index + 1,
        };
      })
      .filter(Boolean);
  });

  if (alternativeRows.length) {
    const { error } = await supabase.from("pve_video_hero_alternatives").insert(alternativeRows);
    if (error) throw error;
  }
}

async function saveVideo(req, res, member, body) {
  const payload = await validateVideoPayload(body);
  if (payload.error) return sendPortalJson(res, payload.status || 400, { error: payload.error }, req);

  const isEditing = Boolean(payload.videoId);
  if (isEditing) {
    const adminCheck = requireAdmin(member);
    if (adminCheck.error) return sendPortalJson(res, adminCheck.status, { error: adminCheck.error }, req);

    const { data: existing, error: existingError } = await supabase
      .from("pve_videos")
      .select("id")
      .eq("id", payload.videoId)
      .eq("content_id", payload.content.id)
      .maybeSingle();

    if (existingError) return sendPortalJson(res, 500, { error: existingError.message }, req);
    if (!existing) return sendPortalJson(res, 404, { error: "Video introuvable." }, req);
  }

  const videoPayload = {
    content_id: payload.content.id,
    creator_id: payload.creatorId,
    suggested_creator_name: payload.suggestedCreatorName,
    youtube_url: payload.youtubeUrl,
    youtube_video_id: payload.youtubeVideoId,
    title: payload.title,
    notes: payload.notes,
    updated_at: new Date().toISOString(),
  };

  const result = isEditing
    ? await supabase.from("pve_videos").update(videoPayload).eq("id", payload.videoId).select("id").single()
    : await supabase
        .from("pve_videos")
        .insert({
          ...videoPayload,
          created_by_member_id: member.id,
          created_by_name: member.watcher_name || member.discord_id || "",
        })
        .select("id")
        .single();

  if (result.error) {
    return sendPortalJson(res, 500, { error: result.error.message || "Enregistrement video impossible." }, req);
  }

  try {
    await replaceVideoLinks({ ...payload, videoId: result.data.id });
  } catch (error) {
    return sendPortalJson(res, 500, { error: error?.message || "Enregistrement liens video impossible." }, req);
  }

  return sendPortalJson(res, 200, { success: true, video: { id: result.data.id } }, req);
}

async function deleteVideo(req, res, member, body) {
  const adminCheck = requireAdmin(member);
  if (adminCheck.error) return sendPortalJson(res, adminCheck.status, { error: adminCheck.error }, req);

  const videoId = cleanText(body.videoId || body.video_id || body.id);
  if (!videoId) return sendPortalJson(res, 400, { error: "Video manquante." }, req);

  const tables = ["pve_video_hero_alternatives", "pve_video_heroes", "pve_video_stages"];
  for (const table of tables) {
    const { error } = await supabase.from(table).delete().eq("video_id", videoId);
    if (error) return sendPortalJson(res, 500, { error: error.message || "Suppression video impossible." }, req);
  }

  const { error } = await supabase.from("pve_videos").delete().eq("id", videoId);
  if (error) return sendPortalJson(res, 500, { error: error.message || "Suppression video impossible." }, req);

  return sendPortalJson(res, 200, { success: true }, req);
}

export default async function handler(req, res) {
  applyPortalCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    return sendPortalJson(res, 405, { error: "Method not allowed" }, req);
  }

  if (!verifyPortalRequestOrigin(req)) {
    return sendPortalJson(res, 403, { error: "Origine de requete refusee." }, req);
  }

  const sessionCheck = await requirePortalSession(req, supabase);
  if (sessionCheck.error) {
    return sendPortalJson(res, sessionCheck.status || 401, { error: sessionCheck.error }, req);
  }

  try {
    const body = await readJsonBody(req);
    const action = cleanText(body.action || "save").toLowerCase();

    if (action === "navigation") return await loadNavigation(req, res);
    if (action === "load") return await loadContent(req, res, sessionCheck.member, body);
    if (action === "save") return await saveVideo(req, res, sessionCheck.member, body);
    if (action === "delete") return await deleteVideo(req, res, sessionCheck.member, body);

    return sendPortalJson(res, 400, { error: "Action inconnue." }, req);
  } catch (error) {
    return sendPortalJson(res, 500, { error: error?.message || "Erreur video PVE." }, req);
  }
}
