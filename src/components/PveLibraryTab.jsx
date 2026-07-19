import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, Edit3, ExternalLink, RefreshCw, Search, Trash2, Youtube, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { getChampionDisplayName, normalizeChampionLookupKey } from "@/lib/championDisplay";
import { usePortalLanguage } from "@/lib/portalLanguage";

const CREATOR_MODE_UNLISTED = "__unlisted__";
const CREATOR_MODE_NEW = "__new_creator__";

function isAdminSession(session) {
  const role = String(session?.role || "").trim().toLowerCase();
  return role === "admin" || role === "leader";
}

function isMissingPveVideoHeroesError(error) {
  if (!error) return false;

  const code = String(error.code || "");
  const message = String(error.message || error.details || error.hint || "");

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes("pve_video_heroes") &&
      (message.includes("schema cache") ||
        message.includes("does not exist") ||
        message.includes("Could not find the table")))
  );
}

function isMissingPveVideoHeroAlternativesError(error) {
  if (!error) return false;

  const code = String(error.code || "");
  const message = String(error.message || error.details || error.hint || "");

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes("pve_video_hero_alternatives") &&
      (message.includes("schema cache") ||
        message.includes("does not exist") ||
        message.includes("Could not find the table")))
  );
}

function isMissingPveCreatorsError(error) {
  if (!error) return false;

  const code = String(error.code || "");
  const message = String(error.message || error.details || error.hint || "");

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes("pve_creators") &&
      (message.includes("schema cache") ||
        message.includes("does not exist") ||
        message.includes("Could not find the table")))
  );
}

function isMissingPveVideoCreatorColumnError(error) {
  if (!error) return false;

  const code = String(error.code || "");
  const message = String(error.message || error.details || error.hint || "");
  const missingCreatorColumn = message.includes("creator_id") || message.includes("suggested_creator_name");

  return (
    code === "PGRST204" ||
    (missingCreatorColumn &&
      (message.includes("schema cache") ||
        message.includes("does not exist") ||
        message.includes("Could not find the") ||
        message.includes("column")))
  );
}

function normalizeExternalUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, "");
}

function buildCreatorKey(name) {
  const base = String(name || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base || "creator";
}

function extractYoutubeVideoId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] || "";
    }

    if (host.endsWith("youtube.com")) {
      const watchId = url.searchParams.get("v");
      if (watchId) return watchId;

      const parts = url.pathname.split("/").filter(Boolean);
      const markerIndex = parts.findIndex((part) => ["embed", "shorts", "live"].includes(part));
      if (markerIndex >= 0) return parts[markerIndex + 1] || "";
    }
  } catch {
    const looseMatch = raw.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{6,})/);
    return looseMatch?.[1] || "";
  }

  return "";
}

function formatDate(value) {
  if (!value) return "";

  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function normalizeContent(row) {
  return {
    id: row.id || "",
    navId: row.navId || row.slug || row.id || "",
    name: row.name || row.label || "",
    slug: row.slug || "",
    description: row.description || "",
    categorySlug: row.categorySlug || row.category_slug || "",
    categoryName: row.categoryName || row.category_name || "",
    categorySortOrder: row.categorySortOrder ?? row.category_sort_order ?? 9999,
    stageCount: row.stage_count ?? row.stageCount ?? 0,
    sortOrder: row.sort_order ?? row.sortOrder ?? 9999,
    isActive: row.is_active ?? row.isActive ?? true,
    missingInDatabase: Boolean(row.missingInDatabase),
  };
}

function normalizeStage(row) {
  return {
    id: row.id,
    contentId: row.content_id || row.contentId,
    number: row.stage_number ?? row.stageNumber ?? 0,
    name: row.name || "",
    sortOrder: row.sort_order ?? row.sortOrder ?? row.stage_number ?? 9999,
  };
}

function normalizeCreator(row) {
  return {
    id: String(row?.id || ""),
    name: String(row?.name || "").trim(),
    creatorKey: String(row?.creator_key || row?.creatorKey || "").trim(),
    channelUrl: normalizeExternalUrl(row?.channel_url || row?.channelUrl || ""),
    avatarUrl: normalizeExternalUrl(row?.avatar_url || row?.avatarUrl || ""),
    youtubeChannelId: String(row?.youtube_channel_id || row?.youtubeChannelId || "").trim(),
  };
}

function sortCreators(creators) {
  return [...creators].sort((left, right) => left.name.localeCompare(right.name, "fr", { sensitivity: "base" }));
}

function buildSuggestedCreatorGroupKey(value) {
  return normalizeChampionLookupKey(value) || "unknown";
}

function getStageShortLabel(stage) {
  if (!stage) return "";

  const number = stage.number ?? "";
  const name = String(stage.name || "").trim();
  const defaultName = `Niveau ${number}`;

  if (name && name.toLowerCase() !== defaultName.toLowerCase()) return name;
  return String(number);
}

function getStageFullLabel(content, stage) {
  if (!stage) return content?.name || "PVE";

  const shortLabel = getStageShortLabel(stage);
  return shortLabel ? `${content?.name || "PVE"} ${shortLabel}` : content?.name || "PVE";
}

function getSessionMemberId(session) {
  return session?.memberId || session?.member_id || session?.id || "";
}

function normalizeChampionOption(row, language = "fr") {
  const technicalName = String(row?.name || "").trim();
  const displayName = getChampionDisplayName(row, language) || technicalName;

  return {
    id: row?.id || "",
    technicalName,
    displayName,
    searchKey: normalizeChampionLookupKey([
      technicalName,
      displayName,
      row?.portal_name,
      row?.PortalName,
      row?.english_name,
      row?.["English name"],
    ].filter(Boolean).join(" ")),
  };
}

function normalizeVideo(
  row,
  linkRows = [],
  heroLinkRows = [],
  alternativeLinkRows = [],
  championById = new Map(),
  creatorById = new Map(),
  language = "fr",
) {
  const heroLinks = heroLinkRows
    .filter((link) => String(link.video_id || link.videoId) === String(row.id))
    .sort((left, right) => (left.sort_order ?? 9999) - (right.sort_order ?? 9999))
    .map((link) => {
      const champion = championById.get(String(link.champion_id || link.championId || ""));
      const option = champion ? normalizeChampionOption(champion, language) : null;
      const championId = String(link.champion_id || link.championId || option?.id || "");
      const technicalName = option?.technicalName || link.champion_name || "";
      const alternativeLinks = alternativeLinkRows
        .filter((alternativeLink) => {
          if (String(alternativeLink.video_id || alternativeLink.videoId) !== String(row.id)) return false;

          const requiredId = String(alternativeLink.required_champion_id || alternativeLink.requiredChampionId || "");
          const requiredName = String(alternativeLink.required_champion_name || alternativeLink.requiredChampionName || "");

          return (championId && requiredId === championId) || (technicalName && requiredName === technicalName);
        })
        .sort((left, right) => (left.sort_order ?? 9999) - (right.sort_order ?? 9999))
        .map((alternativeLink) => {
          const alternativeChampion = championById.get(
            String(alternativeLink.alternative_champion_id || alternativeLink.alternativeChampionId || ""),
          );
          const alternativeOption = alternativeChampion ? normalizeChampionOption(alternativeChampion, language) : null;

          return {
            id: String(
              alternativeLink.alternative_champion_id ||
                alternativeLink.alternativeChampionId ||
                alternativeOption?.id ||
                alternativeLink.alternative_champion_name ||
                "",
            ),
            championId: alternativeLink.alternative_champion_id || alternativeLink.alternativeChampionId || alternativeOption?.id || "",
            technicalName: alternativeOption?.technicalName || alternativeLink.alternative_champion_name || "",
            displayName: alternativeOption?.displayName || alternativeLink.alternative_champion_name || "",
          };
        });

      return {
        id: String(championId || link.champion_name || ""),
        championId: championId || "",
        technicalName,
        displayName: option?.displayName || link.champion_name || "",
        alternatives: alternativeLinks,
      };
    });

  const creatorId = String(row.creator_id || row.creatorId || "");
  const creator = creatorId ? creatorById.get(creatorId) || null : null;

  return {
    id: row.id,
    contentId: row.content_id || row.contentId,
    creatorId,
    creator,
    suggestedCreatorName: String(row.suggested_creator_name || row.suggestedCreatorName || "").trim(),
    youtubeUrl: row.youtube_url || row.youtubeUrl || "",
    youtubeVideoId: row.youtube_video_id || row.youtubeVideoId || "",
    title: row.title || "",
    notes: row.notes || "",
    createdByName: row.created_by_name || row.createdByName || "",
    createdAt: row.created_at || row.createdAt || "",
    stageIds: linkRows
      .filter((link) => String(link.video_id || link.videoId) === String(row.id))
      .map((link) => String(link.stage_id || link.stageId)),
    heroes: heroLinks,
  };
}

export default function PveLibraryTab({
  session,
  contents = [],
  selectedContentId = "",
}) {
  const { language, t } = usePortalLanguage();
  const isAdminUser = isAdminSession(session);
  const [localContents, setLocalContents] = useState(contents.map(normalizeContent));
  const [selectedStageId, setSelectedStageId] = useState("");
  const [stages, setStages] = useState([]);
  const [videos, setVideos] = useState([]);
  const [champions, setChampions] = useState([]);
  const [creators, setCreators] = useState([]);
  const [creatorSchemaReady, setCreatorSchemaReady] = useState(true);
  const [loading, setLoading] = useState(false);
  const [savingVideo, setSavingVideo] = useState(false);
  const [resolvingCreatorKey, setResolvingCreatorKey] = useState("");
  const [deletingVideoId, setDeletingVideoId] = useState("");
  const [videoFormOpen, setVideoFormOpen] = useState(false);
  const [editingVideoId, setEditingVideoId] = useState("");
  const [heroSearch, setHeroSearch] = useState("");
  const [alternativeHeroSearches, setAlternativeHeroSearches] = useState({});
  const [creatorReviewDrafts, setCreatorReviewDrafts] = useState({});
  const [boxFilterEnabled, setBoxFilterEnabled] = useState(false);
  const [ownedChampionIds, setOwnedChampionIds] = useState([]);
  const [ownedHeroesLoading, setOwnedHeroesLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [videoDraft, setVideoDraft] = useState({
    url: "",
    title: "",
    notes: "",
    creatorId: "",
    creatorMode: "",
    suggestedCreatorName: "",
    creatorLookupUrl: "",
    creatorName: "",
    creatorChannelUrl: "",
    creatorAvatarUrl: "",
    stageIds: [],
    heroIds: [],
    heroAlternatives: {},
  });

  useEffect(() => {
    setLocalContents(contents.map(normalizeContent));
  }, [contents]);

  useEffect(() => {
    let cancelled = false;

    async function loadChampions() {
      const { data, error } = await supabase.from("champions").select("*").order("name", { ascending: true });

      if (cancelled) return;

      if (error) {
        console.warn("[pve-champions]", error);
        setChampions([]);
        return;
      }

      setChampions(data || []);
    }

    void loadChampions();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const memberId = getSessionMemberId(session);
    let cancelled = false;

    async function loadOwnedHeroes() {
      if (!memberId) {
        setOwnedChampionIds([]);
        setOwnedHeroesLoading(false);
        return;
      }

      setOwnedHeroesLoading(true);
      const { data, error } = await supabase
        .from("member_awakenings")
        .select("champion_id, awakening_level")
        .eq("member_id", memberId)
        .gte("awakening_level", 0);

      if (cancelled) return;

      if (error) {
        console.warn("[pve-owned-heroes]", error);
        setOwnedChampionIds([]);
        setOwnedHeroesLoading(false);
        return;
      }

      setOwnedChampionIds((data || []).map((row) => String(row.champion_id || "")).filter(Boolean));
      setOwnedHeroesLoading(false);
    }

    void loadOwnedHeroes();

    return () => {
      cancelled = true;
    };
  }, [session?.memberId, session?.member_id, session?.id]);

  const sortedContents = useMemo(
    () =>
      [...localContents]
        .filter((content) => content.isActive)
        .sort((a, b) => {
          if ((a.categorySortOrder ?? 9999) !== (b.categorySortOrder ?? 9999)) {
            return (a.categorySortOrder ?? 9999) - (b.categorySortOrder ?? 9999);
          }

          if ((a.sortOrder ?? 9999) !== (b.sortOrder ?? 9999)) {
            return (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999);
          }

          return String(a.name || "").localeCompare(String(b.name || ""), "fr", {
            sensitivity: "base",
          });
        }),
    [localContents],
  );

  const selectedContent = useMemo(() => {
    if (selectedContentId) {
      const found = sortedContents.find(
        (content) =>
          String(content.id) === String(selectedContentId) ||
          String(content.navId) === String(selectedContentId) ||
          String(content.slug) === String(selectedContentId),
      );
      if (found) return found;
    }

    return sortedContents[0] || null;
  }, [selectedContentId, sortedContents]);

  const championOptions = useMemo(
    () =>
      champions
        .map((champion) => normalizeChampionOption(champion, language))
        .filter((champion) => champion.id && champion.technicalName)
        .sort((left, right) => left.displayName.localeCompare(right.displayName, "fr", { sensitivity: "base" })),
    [champions, language],
  );

  const championById = useMemo(
    () => new Map(champions.map((champion) => [String(champion.id), champion])),
    [champions],
  );

  const selectedDraftHeroes = useMemo(
    () =>
      videoDraft.heroIds
        .map((id) => championOptions.find((champion) => String(champion.id) === String(id)))
        .filter(Boolean),
    [championOptions, videoDraft.heroIds],
  );

  const heroSuggestions = useMemo(() => {
    const query = normalizeChampionLookupKey(heroSearch);
    if (query.length < 2) return [];
    const selectedIds = new Set(videoDraft.heroIds.map(String));

    return championOptions
      .filter((champion) => !selectedIds.has(String(champion.id)) && champion.searchKey.includes(query))
      .slice(0, 8);
  }, [championOptions, heroSearch, videoDraft.heroIds]);

  const getAlternativeHeroSuggestions = (requiredChampionId) => {
    const key = String(requiredChampionId || "");
    const query = normalizeChampionLookupKey(alternativeHeroSearches[key]);
    if (query.length < 2) return [];

    const selectedAlternativeIds = new Set((videoDraft.heroAlternatives?.[key] || []).map(String));

    return championOptions
      .filter(
        (champion) =>
          String(champion.id) !== key &&
          !selectedAlternativeIds.has(String(champion.id)) &&
          champion.searchKey.includes(query),
      )
      .slice(0, 6);
  };

  const selectedStage = useMemo(
    () => stages.find((stage) => String(stage.id) === String(selectedStageId)) || stages[0] || null,
    [selectedStageId, stages],
  );

  const selectedStageVideos = useMemo(() => {
    if (!selectedStage?.id) return [];

    return videos.filter((video) => video.stageIds.includes(String(selectedStage.id)));
  }, [selectedStage, videos]);

  const ownedChampionIdSet = useMemo(
    () => new Set(ownedChampionIds.map((championId) => String(championId))),
    [ownedChampionIds],
  );

  const boxCompatibleStageVideos = useMemo(
    () =>
      selectedStageVideos.filter((video) => {
        if (!video.heroes?.length) return false;

        return video.heroes.every((hero) => {
          const championId = String(hero.championId || hero.id || "");
          if (championId && ownedChampionIdSet.has(championId)) return true;

          return (hero.alternatives || []).some((alternative) => {
            const alternativeId = String(alternative.championId || alternative.id || "");
            return alternativeId && ownedChampionIdSet.has(alternativeId);
          });
        });
      }),
    [ownedChampionIdSet, selectedStageVideos],
  );

  const visibleStageVideos = boxFilterEnabled ? boxCompatibleStageVideos : selectedStageVideos;

  const videosByStageId = useMemo(() => {
    const map = new Map();

    videos.forEach((video) => {
      video.stageIds.forEach((stageId) => {
        const key = String(stageId);
        map.set(key, (map.get(key) || 0) + 1);
      });
    });

    return map;
  }, [videos]);

  const pendingCreatorGroups = useMemo(() => {
    const map = new Map();

    videos
      .filter((video) => !video.creatorId && String(video.suggestedCreatorName || "").trim())
      .forEach((video) => {
        const suggestedName = String(video.suggestedCreatorName || "").trim();
        const key = buildSuggestedCreatorGroupKey(suggestedName);

        if (!map.has(key)) {
          map.set(key, {
            key,
            suggestedName,
            videos: [],
          });
        }

        map.get(key).videos.push(video);
      });

    return [...map.values()].sort((left, right) =>
      left.suggestedName.localeCompare(right.suggestedName, "fr", { sensitivity: "base" }),
    );
  }, [videos]);

  const pendingCreatorVideoCount = pendingCreatorGroups.reduce((total, group) => total + group.videos.length, 0);

  const selectedStageLabel = selectedStage
    ? getStageFullLabel(selectedContent, selectedStage)
    : selectedContent?.name || "PVE";

  const getDuplicateYoutubeStageLabels = (youtubeVideoId, selectedStageIds, ignoredVideoId = "") => {
    const normalizedYoutubeVideoId = String(youtubeVideoId || "");
    if (!normalizedYoutubeVideoId) return [];

    const duplicateStageIds = new Set();

    videos.forEach((video) => {
      if (ignoredVideoId && String(video.id) === String(ignoredVideoId)) return;
      if (String(video.youtubeVideoId || "") !== normalizedYoutubeVideoId) return;

      selectedStageIds.forEach((stageId) => {
        if (video.stageIds.includes(String(stageId))) duplicateStageIds.add(String(stageId));
      });
    });

    return stages
      .filter((stage) => duplicateStageIds.has(String(stage.id)))
      .map((stage) => getStageFullLabel(selectedContent, stage));
  };

  const loadContentData = async () => {
    if (!selectedContent?.id) {
      setStages([]);
      setVideos([]);
      setCreators([]);
      setErrorMessage(
        selectedContent
          ? t(
              "pve.contentMissing",
              "Ce contenu PVE n'est pas encore cree dans Supabase. Relance le script create_pve_library.sql.",
            )
          : "",
      );
      return;
    }

    setLoading(true);
    setErrorMessage("");

    const [stagesResult, initialVideosResult, linksResult, heroLinksResult, alternativeLinksResult, creatorsResult] = await Promise.all([
      supabase
        .from("pve_content_stages")
        .select("id, content_id, stage_number, name, sort_order")
        .eq("content_id", selectedContent.id)
        .order("sort_order", { ascending: true })
        .order("stage_number", { ascending: true }),
      supabase
        .from("pve_videos")
        .select("id, content_id, creator_id, suggested_creator_name, youtube_url, youtube_video_id, title, notes, created_by_name, created_at")
        .eq("content_id", selectedContent.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("pve_video_stages")
        .select("id, content_id, video_id, stage_id")
        .eq("content_id", selectedContent.id),
      supabase
        .from("pve_video_heroes")
        .select("id, content_id, video_id, champion_id, champion_name, sort_order")
        .eq("content_id", selectedContent.id),
      supabase
        .from("pve_video_hero_alternatives")
        .select(
          "id, content_id, video_id, required_champion_id, required_champion_name, alternative_champion_id, alternative_champion_name, sort_order",
        )
        .eq("content_id", selectedContent.id),
      supabase
        .from("pve_creators")
        .select("id, name, creator_key, channel_url, avatar_url")
        .order("name", { ascending: true }),
    ]);

    let videosResult = initialVideosResult;
    const videoCreatorColumnMissing = isMissingPveVideoCreatorColumnError(initialVideosResult.error);
    if (videoCreatorColumnMissing) {
      videosResult = await supabase
        .from("pve_videos")
        .select("id, content_id, youtube_url, youtube_video_id, title, notes, created_by_name, created_at")
        .eq("content_id", selectedContent.id)
        .order("created_at", { ascending: false });
    }

    const heroLinksMissing = isMissingPveVideoHeroesError(heroLinksResult.error);
    const alternativeLinksMissing = isMissingPveVideoHeroAlternativesError(alternativeLinksResult.error);
    const creatorsMissing = isMissingPveCreatorsError(creatorsResult.error);
    setCreatorSchemaReady(!videoCreatorColumnMissing && !creatorsMissing);

    if (
      stagesResult.error ||
      videosResult.error ||
      linksResult.error ||
      (heroLinksResult.error && !heroLinksMissing) ||
      (alternativeLinksResult.error && !alternativeLinksMissing) ||
      (creatorsResult.error && !creatorsMissing)
    ) {
      const error =
        stagesResult.error ||
        videosResult.error ||
        linksResult.error ||
        heroLinksResult.error ||
        alternativeLinksResult.error ||
        creatorsResult.error;
      setErrorMessage(
        error?.code === "42P01"
          ? t(
              "pve.missingTables",
              "Les tables PVE ne sont pas encore creees. Lance le script SQL create_pve_library.sql dans Supabase.",
            )
          : error?.message || t("pve.loadError", "Chargement PVE impossible."),
      );
      setStages([]);
      setVideos([]);
      setCreators([]);
      setLoading(false);
      return;
    }

    const nextStages = (stagesResult.data || []).map(normalizeStage);
    const nextCreators = creatorsMissing ? [] : sortCreators((creatorsResult.data || []).map(normalizeCreator).filter((creator) => creator.id && creator.name));
    const creatorById = new Map(nextCreators.map((creator) => [String(creator.id), creator]));
    const nextVideos = (videosResult.data || []).map((row) =>
      normalizeVideo(
        row,
        linksResult.data || [],
        heroLinksMissing ? [] : heroLinksResult.data || [],
        alternativeLinksMissing ? [] : alternativeLinksResult.data || [],
        championById,
        creatorById,
        language,
      ),
    );

    setStages(nextStages);
    setVideos(nextVideos);
    setCreators(nextCreators);
    setSelectedStageId((current) => {
      if (nextStages.some((stage) => String(stage.id) === String(current))) return current;
      return nextStages[0]?.id || "";
    });
    setVideoDraft((previous) => ({
      ...previous,
      stageIds: nextStages[0]?.id ? [String(nextStages[0].id)] : [],
      creatorId: "",
      creatorMode: "",
      suggestedCreatorName: "",
      creatorLookupUrl: "",
      creatorName: "",
      creatorChannelUrl: "",
      creatorAvatarUrl: "",
      heroIds: [],
      heroAlternatives: {},
    }));
    setLoading(false);
  };

  useEffect(() => {
    setMessage("");
    setErrorMessage("");
    setVideoFormOpen(false);
    void loadContentData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContent?.id]);

  useEffect(() => {
    if (!selectedStage?.id || videoFormOpen) return;

    setVideoDraft((previous) => ({
      ...previous,
      stageIds: [String(selectedStage.id)],
    }));
  }, [selectedStage?.id, videoFormOpen]);

  const toggleVideoStage = (stageId) => {
    const key = String(stageId);

    setVideoDraft((previous) => {
      const exists = previous.stageIds.includes(key);
      const nextStageIds = exists
        ? previous.stageIds.filter((id) => id !== key)
        : [...previous.stageIds, key];

      return {
        ...previous,
        stageIds: nextStageIds,
      };
    });
  };

  const addDraftHero = (champion) => {
    if (!champion?.id) return;

    setVideoDraft((previous) => {
      if (previous.heroIds.some((id) => String(id) === String(champion.id))) return previous;
      return {
        ...previous,
        heroIds: [...previous.heroIds, String(champion.id)],
        heroAlternatives: {
          ...(previous.heroAlternatives || {}),
          [String(champion.id)]: previous.heroAlternatives?.[String(champion.id)] || [],
        },
      };
    });
    setHeroSearch("");
  };

  const removeDraftHero = (championId) => {
    const key = String(championId);
    setVideoDraft((previous) => ({
      ...previous,
      heroIds: previous.heroIds.filter((id) => String(id) !== key),
      heroAlternatives: Object.fromEntries(
        Object.entries(previous.heroAlternatives || {}).filter(([requiredId]) => String(requiredId) !== key),
      ),
    }));
    setAlternativeHeroSearches((previous) =>
      Object.fromEntries(Object.entries(previous || {}).filter(([requiredId]) => String(requiredId) !== key)),
    );
  };

  const addDraftAlternativeHero = (requiredChampionId, alternativeChampion) => {
    const requiredKey = String(requiredChampionId || "");
    if (!requiredKey || !alternativeChampion?.id) return;

    setVideoDraft((previous) => {
      const currentAlternatives = previous.heroAlternatives?.[requiredKey] || [];
      if (currentAlternatives.some((id) => String(id) === String(alternativeChampion.id))) return previous;

      return {
        ...previous,
        heroAlternatives: {
          ...(previous.heroAlternatives || {}),
          [requiredKey]: [...currentAlternatives, String(alternativeChampion.id)],
        },
      };
    });
    setAlternativeHeroSearches((previous) => ({ ...previous, [requiredKey]: "" }));
  };

  const removeDraftAlternativeHero = (requiredChampionId, alternativeChampionId) => {
    const requiredKey = String(requiredChampionId || "");
    const alternativeKey = String(alternativeChampionId || "");
    if (!requiredKey || !alternativeKey) return;

    setVideoDraft((previous) => ({
      ...previous,
      heroAlternatives: {
        ...(previous.heroAlternatives || {}),
        [requiredKey]: (previous.heroAlternatives?.[requiredKey] || []).filter((id) => String(id) !== alternativeKey),
      },
    }));
  };

  const getCreatorReviewDraft = (group) => ({
    existingCreatorId: "",
    name: group?.suggestedName || "",
    channelUrl: "",
    avatarUrl: "",
    lookupUrl: "",
    ...(creatorReviewDrafts[group?.key] || {}),
  });

  const updateCreatorReviewDraft = (groupKey, patch) => {
    setCreatorReviewDrafts((previous) => ({
      ...previous,
      [groupKey]: {
        ...(previous[groupKey] || {}),
        ...patch,
      },
    }));
  };

  const resolveCreatorGroup = async (group, mode) => {
    if (!isAdminUser || !group?.videos?.length || resolvingCreatorKey) return;

    const draft = getCreatorReviewDraft(group);
    const videoIds = group.videos.map((video) => video.id).filter(Boolean);
    const body = {
      action: "resolve-suggestion",
      actorMemberId: getSessionMemberId(session),
      videoIds,
    };

    if (mode === "existing") {
      if (!draft.existingCreatorId) {
        setErrorMessage(t("pve.creatorExistingRequired", "Selectionne un createur existant."));
        return;
      }

      body.creatorId = draft.existingCreatorId;
    } else {
      const name = String(draft.name || group.suggestedName || "").trim();
      const lookupUrl = String(draft.lookupUrl || "").trim();
      const channelUrl = normalizeExternalUrl(draft.channelUrl);

      if (!name && !lookupUrl && !channelUrl) {
        setErrorMessage(t("pve.creatorNameOrUrlRequired", "Renseigne un nom ou une URL YouTube de createur."));
        return;
      }

      body.creator = {
        name,
        youtubeLookupUrl: lookupUrl,
        channelUrl,
        avatarUrl: normalizeExternalUrl(draft.avatarUrl),
      };
    }

    setResolvingCreatorKey(group.key);
    setErrorMessage("");
    setMessage("");

    const response = await fetch("/api/pve-creators", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setErrorMessage(payload?.error || t("pve.resolveCreatorError", "Attribution du createur impossible."));
      setResolvingCreatorKey("");
      return;
    }

    const normalizedCreator = normalizeCreator(payload.creator);
    const videoIdSet = new Set(videoIds.map(String));

    if (normalizedCreator.id) {
      setCreators((previous) =>
        sortCreators([...previous.filter((creator) => creator.id !== normalizedCreator.id), normalizedCreator]),
      );
      setVideos((previous) =>
        previous.map((video) =>
          videoIdSet.has(String(video.id))
            ? {
                ...video,
                creatorId: normalizedCreator.id,
                creator: normalizedCreator,
                suggestedCreatorName: "",
              }
            : video,
        ),
      );
    }

    setCreatorReviewDrafts((previous) => {
      const next = { ...previous };
      delete next[group.key];
      return next;
    });
    setMessage(
      payload?.youtubeWarning
        ? `${t("pve.creatorResolved", "Createur officiel associe.")} ${payload.youtubeWarning}`
        : t("pve.creatorResolved", "Createur officiel associe."),
    );
    setResolvingCreatorKey("");
  };

  const openAddVideoForm = () => {
    setEditingVideoId("");
    setHeroSearch("");
    setErrorMessage("");
    setMessage("");
    setVideoDraft({
      url: "",
      title: "",
      notes: "",
      creatorId: "",
      creatorMode: "",
      suggestedCreatorName: "",
      creatorLookupUrl: "",
      creatorName: "",
      creatorChannelUrl: "",
      creatorAvatarUrl: "",
      stageIds: selectedStage?.id ? [String(selectedStage.id)] : [],
      heroIds: [],
      heroAlternatives: {},
    });
    setVideoFormOpen((value) => !value || Boolean(editingVideoId));
  };

  const openEditVideoForm = (video) => {
    if (!isAdminUser || !video?.id) return;

    setEditingVideoId(video.id);
    setHeroSearch("");
    setAlternativeHeroSearches({});
    setErrorMessage("");
    setMessage("");
    const nextHeroAlternatives = {};
    (video.heroes || []).forEach((hero) => {
      const heroId = String(hero.championId || hero.id || "");
      if (!heroId) return;
      nextHeroAlternatives[heroId] = (hero.alternatives || [])
        .map((alternative) => String(alternative.championId || alternative.id || ""))
        .filter(Boolean);
    });
    setVideoDraft({
      url: video.youtubeUrl || "",
      title: video.title || "",
      notes: video.notes || "",
      creatorId: video.creatorId || "",
      creatorMode: video.creatorId ? "" : video.suggestedCreatorName ? CREATOR_MODE_UNLISTED : "",
      suggestedCreatorName: video.suggestedCreatorName || "",
      creatorLookupUrl: "",
      creatorName: "",
      creatorChannelUrl: "",
      creatorAvatarUrl: "",
      stageIds: video.stageIds?.length ? video.stageIds.map(String) : selectedStage?.id ? [String(selectedStage.id)] : [],
      heroIds: (video.heroes || []).map((hero) => String(hero.championId || hero.id)).filter(Boolean),
      heroAlternatives: nextHeroAlternatives,
    });
    setVideoFormOpen(true);
  };

  const closeVideoForm = () => {
    setVideoFormOpen(false);
    setEditingVideoId("");
    setHeroSearch("");
    setAlternativeHeroSearches({});
  };

  const replaceVideoLinks = async (videoId, selectedStageIds, selectedHeroIds, heroAlternativeIdsByHeroId = {}) => {
    const { error: deleteStagesError } = await supabase
      .from("pve_video_stages")
      .delete()
      .eq("video_id", videoId);

    if (deleteStagesError) throw deleteStagesError;

    const { error: insertStagesError } = await supabase.from("pve_video_stages").insert(
      selectedStageIds.map((stageId) => ({
        content_id: selectedContent.id,
        video_id: videoId,
        stage_id: stageId,
      })),
    );

    if (insertStagesError) throw insertStagesError;

    const { error: deleteHeroesError } = await supabase
      .from("pve_video_heroes")
      .delete()
      .eq("video_id", videoId);

    const heroTableMissing = isMissingPveVideoHeroesError(deleteHeroesError);
    if (deleteHeroesError && !heroTableMissing) throw deleteHeroesError;
    if (heroTableMissing) return;

    const { error: deleteAlternativesError } = await supabase
      .from("pve_video_hero_alternatives")
      .delete()
      .eq("video_id", videoId);

    const alternativeTableMissing = isMissingPveVideoHeroAlternativesError(deleteAlternativesError);
    if (deleteAlternativesError && !alternativeTableMissing) throw deleteAlternativesError;

    if (!selectedHeroIds.length) return;

    const heroRows = selectedHeroIds
      .map((championId, index) => {
        const champion = championOptions.find((option) => String(option.id) === String(championId));
        if (!champion) return null;

        return {
          content_id: selectedContent.id,
          video_id: videoId,
          champion_id: champion.id,
          champion_name: champion.technicalName,
          sort_order: index + 1,
        };
      })
      .filter(Boolean);

    if (!heroRows.length) return;

    const { error: insertHeroesError } = await supabase.from("pve_video_heroes").insert(heroRows);
    if (insertHeroesError) throw insertHeroesError;

    if (alternativeTableMissing) return;

    const alternativeRows = selectedHeroIds.flatMap((requiredChampionId) => {
      const requiredChampion = championOptions.find((option) => String(option.id) === String(requiredChampionId));
      if (!requiredChampion) return [];

      return (heroAlternativeIdsByHeroId[String(requiredChampionId)] || [])
        .map((alternativeChampionId, index) => {
          const alternativeChampion = championOptions.find(
            (option) => String(option.id) === String(alternativeChampionId),
          );
          if (!alternativeChampion) return null;

          return {
            content_id: selectedContent.id,
            video_id: videoId,
            required_champion_id: requiredChampion.id,
            required_champion_name: requiredChampion.technicalName,
            alternative_champion_id: alternativeChampion.id,
            alternative_champion_name: alternativeChampion.technicalName,
            sort_order: index + 1,
          };
        })
        .filter(Boolean);
    });

    if (!alternativeRows.length) return;

    const { error: insertAlternativesError } = await supabase
      .from("pve_video_hero_alternatives")
      .insert(alternativeRows);
    if (insertAlternativesError) throw insertAlternativesError;
  };

  const saveVideo = async (event) => {
    event.preventDefault();
    if (!selectedContent?.id || savingVideo) return;

    if (editingVideoId && !isAdminUser) return;

    const cleanUrl = videoDraft.url.trim();
    const youtubeVideoId = extractYoutubeVideoId(cleanUrl);
    const selectedStageIds = videoDraft.stageIds.filter((stageId) =>
      stages.some((stage) => String(stage.id) === String(stageId)),
    );
    const selectedHeroIds = videoDraft.heroIds.filter((championId) =>
      championOptions.some((champion) => String(champion.id) === String(championId)),
    );
    const selectedHeroIdSet = new Set(selectedHeroIds.map(String));
    const selectedHeroAlternatives = Object.fromEntries(
      Object.entries(videoDraft.heroAlternatives || {})
        .filter(([requiredChampionId]) => selectedHeroIdSet.has(String(requiredChampionId)))
        .map(([requiredChampionId, alternativeChampionIds]) => [
          String(requiredChampionId),
          (alternativeChampionIds || []).filter(
            (alternativeChampionId) =>
              String(alternativeChampionId) !== String(requiredChampionId) &&
              championOptions.some((champion) => String(champion.id) === String(alternativeChampionId)),
          ),
        ]),
    );

    if (!youtubeVideoId) {
      setErrorMessage(t("pve.invalidYoutubeUrl", "Colle un lien YouTube valide."));
      return;
    }

    if (!selectedStageIds.length) {
      setErrorMessage(t("pve.noStageSelected", "Selectionne au moins un niveau."));
      return;
    }

    const duplicateStageLabels = getDuplicateYoutubeStageLabels(youtubeVideoId, selectedStageIds, editingVideoId);
    if (duplicateStageLabels.length) {
      const duplicateMessage = t(
        "pve.duplicateYoutubeForStages",
        "Cette video YouTube est deja liee a : {stages}.",
      ).replace("{stages}", duplicateStageLabels.join(", "));
      setErrorMessage(duplicateMessage);
      return;
    }

    const suggestedCreatorName =
      videoDraft.creatorMode === CREATOR_MODE_UNLISTED
        ? String(videoDraft.suggestedCreatorName || "").trim()
        : "";

    if (creatorSchemaReady && videoDraft.creatorMode === CREATOR_MODE_UNLISTED && !suggestedCreatorName) {
      setErrorMessage(t("pve.suggestedCreatorNameRequired", "Renseigne le nom du createur a proposer."));
      return;
    }

    if (creatorSchemaReady && videoDraft.creatorMode === CREATOR_MODE_NEW) {
      const hasCreatorDraft =
        String(videoDraft.creatorName || "").trim() ||
        String(videoDraft.creatorLookupUrl || "").trim() ||
        normalizeExternalUrl(videoDraft.creatorChannelUrl);

      if (!hasCreatorDraft) {
        setErrorMessage(t("pve.creatorNameOrUrlRequired", "Renseigne un nom ou une URL YouTube de createur."));
        return;
      }
    }

    setSavingVideo(true);
    setErrorMessage("");
    setMessage("");

    let videoCreatorId = videoDraft.creatorId || "";
    let youtubeWarning = "";

    if (creatorSchemaReady && videoDraft.creatorMode === CREATOR_MODE_NEW) {
      const response = await fetch("/api/pve-creators", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "create-or-reuse",
          actorMemberId: getSessionMemberId(session),
          creator: {
            name: String(videoDraft.creatorName || "").trim(),
            youtubeLookupUrl: String(videoDraft.creatorLookupUrl || "").trim(),
            channelUrl: normalizeExternalUrl(videoDraft.creatorChannelUrl),
            avatarUrl: normalizeExternalUrl(videoDraft.creatorAvatarUrl),
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setErrorMessage(payload?.error || t("pve.createCreatorError", "Creation du createur impossible."));
        setSavingVideo(false);
        return;
      }

      const normalizedCreator = normalizeCreator(payload.creator);
      if (!normalizedCreator.id) {
        setErrorMessage(t("pve.createCreatorError", "Creation du createur impossible."));
        setSavingVideo(false);
        return;
      }

      videoCreatorId = normalizedCreator.id;
      youtubeWarning = String(payload?.youtubeWarning || "").trim();
      setCreators((previous) =>
        sortCreators([...previous.filter((creator) => creator.id !== normalizedCreator.id), normalizedCreator]),
      );
    }

    const videoPayload = {
      content_id: selectedContent.id,
      youtube_url: cleanUrl,
      youtube_video_id: youtubeVideoId,
      title: videoDraft.title.trim() || `${selectedContent.name} - ${selectedStageLabel}`,
      notes: videoDraft.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };
    if (creatorSchemaReady) {
      videoPayload.creator_id = videoCreatorId || null;
      videoPayload.suggested_creator_name = suggestedCreatorName || null;
    }

    const result = editingVideoId
      ? await supabase
          .from("pve_videos")
          .update(videoPayload)
          .eq("id", editingVideoId)
          .select("id")
          .single()
      : await supabase
          .from("pve_videos")
          .insert({
            ...videoPayload,
            created_by_member_id: session?.memberId || session?.id || null,
            created_by_name: session?.watcherName || session?.name || "",
          })
          .select("id")
          .single();

    if (result.error) {
      setErrorMessage(result.error.message || t("pve.saveVideoError", "Ajout de la video impossible."));
      setSavingVideo(false);
      return;
    }

    try {
      await replaceVideoLinks(result.data.id, selectedStageIds, selectedHeroIds, selectedHeroAlternatives);
    } catch (error) {
      setErrorMessage(error?.message || t("pve.saveVideoError", "Ajout de la video impossible."));
      setSavingVideo(false);
      return;
    }

    setVideoDraft({
      url: "",
      title: "",
      notes: "",
      creatorId: "",
      creatorMode: "",
      suggestedCreatorName: "",
      creatorLookupUrl: "",
      creatorName: "",
      creatorChannelUrl: "",
      creatorAvatarUrl: "",
      stageIds: selectedStage?.id ? [String(selectedStage.id)] : [],
      heroIds: [],
      heroAlternatives: {},
    });
    closeVideoForm();
    const saveMessage = editingVideoId ? t("pve.videoUpdated", "Video modifiee.") : t("pve.videoAdded", "Video ajoutee.");
    setMessage(youtubeWarning ? `${saveMessage} ${youtubeWarning}` : saveMessage);
    setSavingVideo(false);
    await loadContentData();
  };

  const deleteVideo = async (video) => {
    if (!isAdminUser || !video?.id || deletingVideoId) return;
    const confirmed = window.confirm(t("pve.deleteVideoConfirm", "Supprimer cette video PVE ?"));
    if (!confirmed) return;

    setDeletingVideoId(video.id);
    setErrorMessage("");
    setMessage("");

    const { error: deleteAlternativeLinksError } = await supabase
      .from("pve_video_hero_alternatives")
      .delete()
      .eq("video_id", video.id);

    if (deleteAlternativeLinksError && !isMissingPveVideoHeroAlternativesError(deleteAlternativeLinksError)) {
      setErrorMessage(deleteAlternativeLinksError.message || t("pve.deleteVideoError", "Suppression de la video impossible."));
      setDeletingVideoId("");
      return;
    }

    const { error: deleteHeroLinksError } = await supabase
      .from("pve_video_heroes")
      .delete()
      .eq("video_id", video.id);

    if (deleteHeroLinksError && !isMissingPveVideoHeroesError(deleteHeroLinksError)) {
      setErrorMessage(deleteHeroLinksError.message || t("pve.deleteVideoError", "Suppression de la video impossible."));
      setDeletingVideoId("");
      return;
    }

    const { error: deleteStageLinksError } = await supabase
      .from("pve_video_stages")
      .delete()
      .eq("video_id", video.id);

    if (deleteStageLinksError) {
      setErrorMessage(deleteStageLinksError.message || t("pve.deleteVideoError", "Suppression de la video impossible."));
      setDeletingVideoId("");
      return;
    }

    const { error } = await supabase.from("pve_videos").delete().eq("id", video.id);

    if (error) {
      setErrorMessage(error.message || t("pve.deleteVideoError", "Suppression de la video impossible."));
      setDeletingVideoId("");
      return;
    }

    setMessage(t("pve.videoDeleted", "Video supprimee."));
    setDeletingVideoId("");
    await loadContentData();
  };

  if (!selectedContent) {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-400">
        {t("pve.noContent", "Aucun contenu PVE disponible pour le moment.")}
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">
            <BookOpen className="h-4 w-4" />
            {t("pve.library", "Bibliotheque PVE")}
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-white">
            {selectedContent?.name || t("nav.pve", "PVE")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            {selectedContent?.description ||
              t("pve.description", "Centralise les videos YouTube utiles pour passer les contenus PVE.")}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={loadContentData}
            disabled={loading || !selectedContent}
            className="rounded-xl border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {t("common.refresh", "Rafraichir")}
          </Button>
        </div>
      </div>

      {message ? (
        <div className="rounded-xl border border-emerald-700 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
          {message}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded-xl border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {errorMessage}
        </div>
      ) : null}

      {isAdminUser && pendingCreatorVideoCount ? (
        <div className="space-y-3 rounded-2xl border border-amber-800/70 bg-amber-950/20 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">
                {t("pve.creatorReviewEyebrow", "Createurs a identifier")}
              </div>
              <h3 className="mt-1 text-lg font-semibold text-white">
                {t("pve.creatorReviewTitle", "{count} videos sans createur officiel").replace(
                  "{count}",
                  String(pendingCreatorVideoCount),
                )}
              </h3>
              <p className="mt-1 text-sm text-amber-100/75">
                {t(
                  "pve.creatorReviewDescription",
                  "Associe ces propositions a un createur existant ou cree une fiche officielle.",
                )}
              </p>
            </div>
            <Badge className="border-amber-500/60 bg-amber-500/15 text-amber-100">
              {pendingCreatorGroups.length} {t("pve.creatorGroups", "groupe(s)")}
            </Badge>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            {pendingCreatorGroups.map((group) => {
              const draft = getCreatorReviewDraft(group);
              const resolving = resolvingCreatorKey === group.key;

              return (
                <div key={group.key} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-white">{group.suggestedName}</div>
                      <div className="text-xs text-zinc-500">
                        {group.videos.length} {t("pve.creatorVideosPending", "video(s) a attribuer")}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 space-y-2">
                    {group.videos.map((video) => (
                      <div key={`creator-review-video-${video.id}`} className="rounded-xl border border-zinc-800 bg-black/30 p-2">
                        <a
                          href={video.youtubeUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="line-clamp-1 text-sm font-semibold text-zinc-100 hover:text-amber-100 hover:underline"
                        >
                          {video.title}
                        </a>
                        <div className="mt-1 text-xs text-zinc-500">
                          {video.createdByName
                            ? `${t("pve.addedBy", "Ajoute par")} ${video.createdByName}`
                            : t("common.unknown", "Inconnu")}
                          {video.createdAt ? ` - ${formatDate(video.createdAt)}` : ""}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="text-sm font-medium text-zinc-300">
                      {t("pve.assignExistingCreator", "Associer a un createur existant")}
                      <select
                        value={draft.existingCreatorId}
                        onChange={(event) =>
                          updateCreatorReviewDraft(group.key, { existingCreatorId: event.target.value })
                        }
                        className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
                      >
                        <option value="">{t("pve.creatorNone", "Aucun createur lie")}</option>
                        {creators.map((creator) => (
                          <option key={`review-creator-${creator.id}`} value={creator.id}>
                            {creator.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        onClick={() => resolveCreatorGroup(group, "existing")}
                        disabled={resolving || !draft.existingCreatorId}
                        className="w-full rounded-xl bg-amber-500 text-amber-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {resolving ? t("common.saving", "Sauvegarde...") : t("pve.resolveCreatorWithExisting", "Associer")}
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 rounded-xl border border-zinc-800 bg-black/30 p-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                      {t("pve.createOfficialCreator", "Creer une fiche officielle")}
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <label className="text-sm font-medium text-zinc-300">
                        {t("pve.creatorLookupUrl", "URL chaine ou video YouTube")}
                        <input
                          type="text"
                          value={draft.lookupUrl}
                          onChange={(event) => updateCreatorReviewDraft(group.key, { lookupUrl: event.target.value })}
                          placeholder="https://www.youtube.com/@... ou https://youtu.be/..."
                          className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
                        />
                      </label>
                      <label className="text-sm font-medium text-zinc-300">
                        {t("pve.officialCreatorName", "Nom officiel")}
                        <input
                          type="text"
                          value={draft.name}
                          onChange={(event) => updateCreatorReviewDraft(group.key, { name: event.target.value })}
                          className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
                        />
                      </label>
                      <label className="text-sm font-medium text-zinc-300">
                        {t("pve.officialCreatorChannelUrl", "URL chaine YouTube")}
                        <input
                          type="url"
                          value={draft.channelUrl}
                          onChange={(event) => updateCreatorReviewDraft(group.key, { channelUrl: event.target.value })}
                          placeholder="https://www.youtube.com/@..."
                          className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
                        />
                      </label>
                      <label className="text-sm font-medium text-zinc-300">
                        {t("pve.officialCreatorAvatarUrl", "Avatar ou logo")}
                        <input
                          type="url"
                          value={draft.avatarUrl}
                          onChange={(event) => updateCreatorReviewDraft(group.key, { avatarUrl: event.target.value })}
                          placeholder="https://..."
                          className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
                        />
                      </label>
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">
                      {t(
                        "pve.creatorLookupHelp",
                        "Si une URL YouTube est renseignee, le serveur complete les champs vides une seule fois puis stocke les infos dans Supabase.",
                      )}
                    </p>
                    <Button
                      type="button"
                      onClick={() => resolveCreatorGroup(group, "new")}
                      disabled={
                        resolving ||
                        !(
                          String(draft.name || "").trim() ||
                          String(draft.lookupUrl || "").trim() ||
                          normalizeExternalUrl(draft.channelUrl)
                        )
                      }
                      className="mt-3 rounded-xl bg-zinc-100 text-zinc-950 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {resolving
                        ? t("common.saving", "Sauvegarde...")
                        : t("pve.resolveCreatorWithNew", "Creer et associer")}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {selectedContent ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(280px,420px)_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">
                    {t("pve.stages", "Niveaux")}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {t("pve.stagesHelp", "Clique un niveau pour voir les videos associees.")}
                  </div>
                </div>
                <Badge className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-300">
                  {stages.length}
                </Badge>
              </div>

              {loading ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-400">
                  {t("common.loading", "Chargement...")}
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-4">
                  {stages.map((stage) => {
                    const selected = String(stage.id) === String(selectedStage?.id);
                    const videoCount = videosByStageId.get(String(stage.id)) || 0;
                    const stageLabel = getStageShortLabel(stage);
                    const compactStageLabel = stageLabel.length <= 3;

                    return (
                      <button
                        key={stage.id}
                        type="button"
                        onClick={() => {
                          setSelectedStageId(stage.id);
                          setVideoDraft((previous) => ({
                            ...previous,
                            stageIds: [String(stage.id)],
                          }));
                        }}
                        className={`relative min-h-[70px] rounded-xl border p-2 text-left transition ${
                          selected
                            ? "border-amber-300 bg-amber-500/20 text-amber-50 shadow-[0_0_18px_rgba(245,158,11,0.25)]"
                            : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600"
                        }`}
                      >
                        <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                          {selectedContent.name}
                        </div>
                        <div
                          className={`mt-1 font-black ${
                            compactStageLabel ? "text-2xl leading-none" : "text-sm leading-tight"
                          }`}
                        >
                          {stageLabel}
                        </div>
                        <div className="mt-2 text-[0.68rem] text-zinc-400">
                          {videoCount} {t("pve.videoShort", "video")}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                  {t("pve.selectedStage", "Niveau selectionne")}
                </div>
                <h3 className="text-xl font-semibold text-white">{selectedStageLabel}</h3>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="flex rounded-xl border border-zinc-800 bg-zinc-900 p-1">
                  <button
                    type="button"
                    onClick={() => setBoxFilterEnabled(false)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      !boxFilterEnabled
                        ? "bg-zinc-100 text-zinc-950"
                        : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                    }`}
                  >
                    {t("pve.filterAllVideos", "Toutes")} ({selectedStageVideos.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setBoxFilterEnabled(true)}
                    disabled={ownedHeroesLoading}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      boxFilterEnabled
                        ? "bg-emerald-400 text-emerald-950"
                        : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                    }`}
                  >
                    {ownedHeroesLoading
                      ? t("pve.loadingBox", "Box...")
                      : `${t("pve.filterMyBox", "Ma box")} (${boxCompatibleStageVideos.length})`}
                  </button>
                </div>

                <Button
                  type="button"
                  onClick={openAddVideoForm}
                  disabled={!selectedStage}
                  className="rounded-xl bg-red-600 text-white hover:bg-red-500"
                >
                  <Youtube className="h-4 w-4" />
                  {t("pve.addVideo", "Ajouter une video")}
                </Button>
              </div>
            </div>

            {videoFormOpen ? (
              <form onSubmit={saveVideo} className="space-y-4 rounded-2xl border border-red-900/60 bg-red-950/20 p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm font-medium text-zinc-300">
                    {t("pve.youtubeUrl", "Lien YouTube")}
                    <input
                      type="url"
                      value={videoDraft.url}
                      onChange={(event) => setVideoDraft((previous) => ({ ...previous, url: event.target.value }))}
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                    />
                  </label>

                  <label className="text-sm font-medium text-zinc-300">
                    {t("common.title", "Titre")}
                    <input
                      type="text"
                      value={videoDraft.title}
                      onChange={(event) => setVideoDraft((previous) => ({ ...previous, title: event.target.value }))}
                      placeholder={t("pve.titleOptional", "Optionnel")}
                      className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                    />
                  </label>
                </div>

                <label className="text-sm font-medium text-zinc-300">
                  {t("pve.notes", "Notes")}
                  <textarea
                    value={videoDraft.notes}
                    onChange={(event) => setVideoDraft((previous) => ({ ...previous, notes: event.target.value }))}
                    rows={3}
                    placeholder={t("pve.notesPlaceholder", "Compo, pre-requis, astuces...")}
                    className="mt-1 w-full resize-none rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                  />
                </label>

                {creatorSchemaReady ? (
                  <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3">
                    <label className="text-sm font-medium text-zinc-300">
                      {t("pve.creatorSelect", "Createur YouTube")}
                      <select
                        value={
                          videoDraft.creatorMode === CREATOR_MODE_UNLISTED
                            ? CREATOR_MODE_UNLISTED
                            : videoDraft.creatorMode === CREATOR_MODE_NEW
                              ? CREATOR_MODE_NEW
                              : videoDraft.creatorId
                        }
                        onChange={(event) => {
                          const value = event.target.value;
                          setVideoDraft((previous) => {
                            if (value === CREATOR_MODE_UNLISTED) {
                              return {
                                ...previous,
                                creatorId: "",
                                creatorMode: CREATOR_MODE_UNLISTED,
                                creatorLookupUrl: "",
                                creatorName: "",
                                creatorChannelUrl: "",
                                creatorAvatarUrl: "",
                              };
                            }

                            if (value === CREATOR_MODE_NEW) {
                              return {
                                ...previous,
                                creatorId: "",
                                creatorMode: CREATOR_MODE_NEW,
                                suggestedCreatorName: "",
                              };
                            }

                            return {
                              ...previous,
                              creatorId: value,
                              creatorMode: "",
                              suggestedCreatorName: "",
                              creatorLookupUrl: "",
                              creatorName: "",
                              creatorChannelUrl: "",
                              creatorAvatarUrl: "",
                            };
                          });
                        }}
                        className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                      >
                        <option value="">{t("pve.creatorNone", "Aucun createur lie")}</option>
                        {creators.map((creator) => (
                          <option key={creator.id} value={creator.id}>
                            {creator.name}
                          </option>
                        ))}
                        <option value={CREATOR_MODE_UNLISTED}>
                          {t("pve.creatorUnlisted", "Createur non repertorie")}
                        </option>
                        <option value={CREATOR_MODE_NEW}>
                          {t("pve.creatorCreateNew", "Creer un createur officiel")}
                        </option>
                      </select>
                    </label>

                    {videoDraft.creatorMode === CREATOR_MODE_NEW ? (
                      <div className="space-y-3">
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="text-sm font-medium text-zinc-300">
                            {t("pve.creatorLookupUrl", "URL chaine ou video YouTube")}
                            <input
                              type="text"
                              value={videoDraft.creatorLookupUrl}
                              onChange={(event) =>
                                setVideoDraft((previous) => ({ ...previous, creatorLookupUrl: event.target.value }))
                              }
                              placeholder="https://www.youtube.com/@... ou https://youtu.be/..."
                              className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                            />
                          </label>
                          <label className="text-sm font-medium text-zinc-300">
                            {t("pve.officialCreatorName", "Nom officiel")}
                            <input
                              type="text"
                              value={videoDraft.creatorName}
                              onChange={(event) =>
                                setVideoDraft((previous) => ({ ...previous, creatorName: event.target.value }))
                              }
                              placeholder={t("pve.creatorAutoNamePlaceholder", "Auto si URL YouTube reconnue")}
                              className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                            />
                          </label>
                          <label className="text-sm font-medium text-zinc-300">
                            {t("pve.officialCreatorChannelUrl", "URL chaine YouTube")}
                            <input
                              type="url"
                              value={videoDraft.creatorChannelUrl}
                              onChange={(event) =>
                                setVideoDraft((previous) => ({ ...previous, creatorChannelUrl: event.target.value }))
                              }
                              placeholder="https://www.youtube.com/@..."
                              className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                            />
                          </label>
                          <label className="text-sm font-medium text-zinc-300">
                            {t("pve.officialCreatorAvatarUrl", "Avatar ou logo")}
                            <input
                              type="url"
                              value={videoDraft.creatorAvatarUrl}
                              onChange={(event) =>
                                setVideoDraft((previous) => ({ ...previous, creatorAvatarUrl: event.target.value }))
                              }
                              placeholder="https://..."
                              className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                            />
                          </label>
                        </div>
                        <p className="text-xs text-zinc-500">
                          {t(
                            "pve.creatorLookupHelp",
                            "Si une URL YouTube est renseignee, le serveur complete les champs vides une seule fois puis stocke les infos dans Supabase.",
                          )}
                        </p>
                      </div>
                    ) : null}

                    {videoDraft.creatorMode === CREATOR_MODE_UNLISTED ? (
                      <label className="text-sm font-medium text-zinc-300">
                        {t("pve.suggestedCreatorName", "Nom du createur a proposer")}
                        <input
                          type="text"
                          value={videoDraft.suggestedCreatorName}
                          onChange={(event) =>
                            setVideoDraft((previous) => ({ ...previous, suggestedCreatorName: event.target.value }))
                          }
                          required
                          className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                        />
                        <span className="mt-1 block text-xs text-zinc-500">
                          {t(
                            "pve.suggestedCreatorHelp",
                            "La video sera visible tout de suite. Un admin validera ensuite la fiche createur officielle.",
                          )}
                        </span>
                      </label>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-800 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
                    {t(
                      "pve.creatorMigrationMissing",
                      "La migration createurs PVE n'est pas encore appliquee. Les videos restent utilisables sans attribution createur.",
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <div>
                    <div className="text-sm font-medium text-zinc-300">
                      {t("pve.composition", "Composition")}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {t("pve.compositionHelp", "Optionnel : ajoute les heros utilises pour faciliter les futurs filtres.")}
                    </div>
                  </div>

                  {selectedDraftHeroes.length ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedDraftHeroes.map((champion) => (
                        <span
                          key={`draft-hero-${champion.id}`}
                          className="inline-flex items-center gap-1 rounded-full border border-emerald-700/70 bg-emerald-950/40 px-3 py-1 text-xs font-semibold text-emerald-100"
                        >
                          {champion.displayName}
                          <button
                            type="button"
                            onClick={() => removeDraftHero(champion.id)}
                            className="rounded-full p-0.5 text-emerald-200 hover:bg-emerald-800 hover:text-white"
                            title={t("common.remove", "Retirer")}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="relative">
                    <input
                      type="text"
                      value={heroSearch}
                      onChange={(event) => setHeroSearch(event.target.value)}
                      placeholder={t("pve.heroSearchPlaceholder", "Chercher un heros...")}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-red-500"
                    />

                    {heroSuggestions.length ? (
                      <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-20 max-h-56 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-1 shadow-2xl">
                        {heroSuggestions.map((champion) => (
                          <button
                            key={`suggestion-${champion.id}`}
                            type="button"
                            onClick={() => addDraftHero(champion)}
                            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                          >
                            <span className="font-semibold text-white">{champion.displayName}</span>
                            <span className="ml-2 text-xs text-zinc-500">{champion.technicalName}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {selectedDraftHeroes.length ? (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        {t("pve.alternatives", "Remplacants")}
                      </div>
                      {selectedDraftHeroes.map((champion) => {
                        const championKey = String(champion.id);
                        const selectedAlternativeIds = videoDraft.heroAlternatives?.[championKey] || [];
                        const selectedAlternatives = selectedAlternativeIds
                          .map((alternativeId) =>
                            championOptions.find((option) => String(option.id) === String(alternativeId)),
                          )
                          .filter(Boolean);
                        const alternativeSuggestions = getAlternativeHeroSuggestions(championKey);

                        return (
                          <div
                            key={`alternatives-${championKey}`}
                            className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-white">{champion.displayName}</span>
                              <span className="text-xs text-zinc-500">
                                {t("pve.alternativeHelp", "peut etre remplace par")}
                              </span>
                              {selectedAlternatives.map((alternative) => (
                                <span
                                  key={`alternative-${championKey}-${alternative.id}`}
                                  className="inline-flex items-center gap-1 rounded-full border border-sky-700/70 bg-sky-950/40 px-2.5 py-1 text-xs font-semibold text-sky-100"
                                >
                                  {alternative.displayName}
                                  <button
                                    type="button"
                                    onClick={() => removeDraftAlternativeHero(championKey, alternative.id)}
                                    className="rounded-full p-0.5 text-sky-200 hover:bg-sky-800 hover:text-white"
                                    title={t("common.remove", "Retirer")}
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </span>
                              ))}
                            </div>

                            <div className="relative mt-2">
                              <input
                                type="text"
                                value={alternativeHeroSearches[championKey] || ""}
                                onChange={(event) =>
                                  setAlternativeHeroSearches((previous) => ({
                                    ...previous,
                                    [championKey]: event.target.value,
                                  }))
                                }
                                placeholder={t("pve.alternativeSearchPlaceholder", "Ajouter un remplacant...")}
                                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
                              />

                              {alternativeSuggestions.length ? (
                                <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-20 max-h-56 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-1 shadow-2xl">
                                  {alternativeSuggestions.map((alternative) => (
                                    <button
                                      key={`alternative-suggestion-${championKey}-${alternative.id}`}
                                      type="button"
                                      onClick={() => addDraftAlternativeHero(championKey, alternative)}
                                      className="block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
                                    >
                                      <span className="font-semibold text-white">{alternative.displayName}</span>
                                      <span className="ml-2 text-xs text-zinc-500">{alternative.technicalName}</span>
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>

                <div>
                  <div className="mb-2 text-sm font-medium text-zinc-300">
                    {t("pve.validStages", "Niveaux concernes")}
                  </div>
                  <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-2">
                    {stages.map((stage) => {
                      const selected = videoDraft.stageIds.includes(String(stage.id));

                      return (
                        <button
                          key={`video-stage-${stage.id}`}
                          type="button"
                          onClick={() => toggleVideoStage(stage.id)}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                            selected
                              ? "border-red-400 bg-red-500/20 text-red-100"
                              : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-600"
                          }`}
                        >
                          {getStageFullLabel(selectedContent, stage)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closeVideoForm}
                    disabled={savingVideo}
                    className="rounded-xl border-zinc-700 bg-transparent text-zinc-200"
                  >
                    {t("common.cancel", "Annuler")}
                  </Button>
                  <Button type="submit" disabled={savingVideo} className="rounded-xl bg-red-600 text-white hover:bg-red-500">
                    {savingVideo
                      ? t("common.saving", "Sauvegarde...")
                      : editingVideoId
                        ? t("pve.updateVideo", "Modifier la video")
                        : t("pve.saveVideo", "Enregistrer la video")}
                  </Button>
                </div>
              </form>
            ) : null}

            {visibleStageVideos.length ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {visibleStageVideos.map((video) => (
                  <article key={video.id} className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
                    <div className="bg-black">
                      <iframe
                        src={`https://www.youtube.com/embed/${video.youtubeVideoId}`}
                        title={video.title}
                        className="aspect-video w-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                        loading="lazy"
                      />
                    </div>
                    <div className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="font-semibold text-white">{video.title}</h4>
                          {video.createdByName || video.createdAt ? (
                            <div className="mt-1 text-xs text-zinc-500">
                              {video.createdByName
                                ? `${t("pve.addedBy", "Ajoute par")} ${video.createdByName}`
                                : t("common.unknown", "Inconnu")}
                              {video.createdAt ? ` - ${formatDate(video.createdAt)}` : ""}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {isAdminUser ? (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditVideoForm(video)}
                                className="rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                                title={t("pve.editVideo", "Modifier la video")}
                              >
                                <Edit3 className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteVideo(video)}
                                disabled={deletingVideoId === video.id}
                                className="rounded-lg border border-red-800 bg-red-950/40 p-2 text-red-200 hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-60"
                                title={t("pve.deleteVideo", "Supprimer la video")}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          ) : null}
                          <a
                            href={video.youtubeUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                            title={t("pve.openYoutube", "Ouvrir YouTube")}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </div>
                      </div>

                      {video.creator ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                          <div className="flex min-w-0 items-center gap-2">
                            {video.creator.avatarUrl ? (
                              <img
                                src={video.creator.avatarUrl}
                                alt=""
                                loading="lazy"
                                className="h-9 w-9 shrink-0 rounded-full border border-zinc-700 object-cover"
                                onError={(event) => {
                                  event.currentTarget.style.display = "none";
                                }}
                              />
                            ) : null}
                            <div className="min-w-0">
                              <div className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                                {t("pve.creator", "Createur")}
                              </div>
                              {video.creator.channelUrl ? (
                                <a
                                  href={video.creator.channelUrl}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="block truncate text-sm font-semibold text-emerald-200 hover:text-emerald-100 hover:underline"
                                >
                                  {video.creator.name}
                                </a>
                              ) : (
                                <div className="truncate text-sm font-semibold text-zinc-100">{video.creator.name}</div>
                              )}
                            </div>
                          </div>
                          {video.creator.channelUrl ? (
                            <a
                              href={video.creator.channelUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 hover:text-white"
                            >
                              {t("pve.openCreatorChannel", "Voir la chaine")}
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : null}
                        </div>
                      ) : video.suggestedCreatorName ? (
                        <div className="rounded-xl border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-sm text-amber-100">
                          <span className="text-amber-200/80">
                            {t("pve.suggestedCreator", "Createur propose")} :
                          </span>{" "}
                          <span className="font-semibold">{video.suggestedCreatorName}</span>
                        </div>
                      ) : null}

                      {video.notes ? (
                        <p className="whitespace-pre-wrap text-sm text-zinc-300">{video.notes}</p>
                      ) : null}

                      {video.heroes?.length ? (
                        <div>
                          <div className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                            {t("pve.composition", "Composition")}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {video.heroes.map((hero) => (
                              <div
                                key={`hero-${video.id}-${hero.championId || hero.technicalName}`}
                                className="inline-flex flex-wrap items-center gap-1.5"
                              >
                                <Badge className="border-emerald-700/70 bg-emerald-950/40 text-emerald-100">
                                  {hero.displayName}
                                </Badge>
                                {hero.alternatives?.length ? (
                                  <>
                                    <span className="text-[0.7rem] text-zinc-500">
                                      {t("pve.replaces", "ou")}
                                    </span>
                                    {hero.alternatives.map((alternative) => (
                                      <Badge
                                        key={`hero-alt-${video.id}-${hero.championId || hero.technicalName}-${
                                          alternative.championId || alternative.technicalName
                                        }`}
                                        className="border-sky-700/70 bg-sky-950/40 text-sky-100"
                                      >
                                        {alternative.displayName}
                                      </Badge>
                                    ))}
                                  </>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="flex flex-wrap gap-1.5">
                        {stages
                          .filter((stage) => video.stageIds.includes(String(stage.id)))
                          .map((stage) => (
                            <Badge key={`badge-${video.id}-${stage.id}`} className="border-zinc-700 bg-zinc-900 text-zinc-300">
                              {getStageFullLabel(selectedContent, stage)}
                            </Badge>
                          ))}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 p-8 text-center">
                <Search className="mx-auto h-8 w-8 text-zinc-600" />
                <div className="mt-3 font-semibold text-zinc-200">
                  {boxFilterEnabled && selectedStageVideos.length
                    ? t("pve.noBoxVideoForStage", "Aucune video compatible avec ta box.")
                    : t("pve.noVideoForStage", "Aucune video pour ce niveau.")}
                </div>
                <p className="mt-1 text-sm text-zinc-500">
                  {boxFilterEnabled && selectedStageVideos.length
                    ? t(
                        "pve.noBoxVideoHelp",
                        "Les videos sans composition ou avec des heros manquants restent dans Toutes.",
                      )
                    : t("pve.noVideoHelp", "Ajoute une video YouTube et associe-la a un ou plusieurs niveaux.")}
                </p>
                {boxFilterEnabled && selectedStageVideos.length ? (
                  <Button
                    type="button"
                    onClick={() => setBoxFilterEnabled(false)}
                    variant="outline"
                    className="mt-4 rounded-xl border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                  >
                    {t("pve.showAllVideos", "Afficher toutes")}
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 p-8 text-center text-zinc-400">
          {t("pve.noContent", "Aucun contenu PVE disponible pour le moment.")}
        </div>
      )}
    </section>
  );
}
