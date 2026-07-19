import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, Edit3, ExternalLink, RefreshCw, Search, Trash2, Youtube, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { getChampionDisplayName, normalizeChampionLookupKey } from "@/lib/championDisplay";
import { usePortalLanguage } from "@/lib/portalLanguage";

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
    categoryName: row.categoryName || row.category_name || "",
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

function normalizeVideo(row, linkRows = [], heroLinkRows = [], championById = new Map(), language = "fr") {
  const heroLinks = heroLinkRows
    .filter((link) => String(link.video_id || link.videoId) === String(row.id))
    .sort((left, right) => (left.sort_order ?? 9999) - (right.sort_order ?? 9999))
    .map((link) => {
      const champion = championById.get(String(link.champion_id || link.championId || ""));
      const option = champion ? normalizeChampionOption(champion, language) : null;

      return {
        id: String(link.champion_id || link.championId || option?.id || link.champion_name || ""),
        championId: link.champion_id || link.championId || option?.id || "",
        technicalName: option?.technicalName || link.champion_name || "",
        displayName: option?.displayName || link.champion_name || "",
      };
    });

  return {
    id: row.id,
    contentId: row.content_id || row.contentId,
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
  const [loading, setLoading] = useState(false);
  const [savingVideo, setSavingVideo] = useState(false);
  const [deletingVideoId, setDeletingVideoId] = useState("");
  const [videoFormOpen, setVideoFormOpen] = useState(false);
  const [editingVideoId, setEditingVideoId] = useState("");
  const [heroSearch, setHeroSearch] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [videoDraft, setVideoDraft] = useState({
    url: "",
    title: "",
    notes: "",
    stageIds: [],
    heroIds: [],
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

  const sortedContents = useMemo(
    () =>
      [...localContents]
        .filter((content) => content.isActive)
        .sort((a, b) => {
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

  const selectedStage = useMemo(
    () => stages.find((stage) => String(stage.id) === String(selectedStageId)) || stages[0] || null,
    [selectedStageId, stages],
  );

  const selectedStageVideos = useMemo(() => {
    if (!selectedStage?.id) return [];

    return videos.filter((video) => video.stageIds.includes(String(selectedStage.id)));
  }, [selectedStage, videos]);

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

  const selectedStageLabel = selectedStage
    ? `${selectedContent?.name || "PVE"} ${selectedStage.number}`
    : selectedContent?.name || "PVE";

  const loadContentData = async () => {
    if (!selectedContent?.id) {
      setStages([]);
      setVideos([]);
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

    const [stagesResult, videosResult, linksResult, heroLinksResult] = await Promise.all([
      supabase
        .from("pve_content_stages")
        .select("id, content_id, stage_number, name, sort_order")
        .eq("content_id", selectedContent.id)
        .order("sort_order", { ascending: true })
        .order("stage_number", { ascending: true }),
      supabase
        .from("pve_videos")
        .select("id, content_id, youtube_url, youtube_video_id, title, notes, created_by_name, created_at")
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
    ]);

    const heroLinksMissing = isMissingPveVideoHeroesError(heroLinksResult.error);
    if (stagesResult.error || videosResult.error || linksResult.error || (heroLinksResult.error && !heroLinksMissing)) {
      const error = stagesResult.error || videosResult.error || linksResult.error || heroLinksResult.error;
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
      setLoading(false);
      return;
    }

    const nextStages = (stagesResult.data || []).map(normalizeStage);
    const nextVideos = (videosResult.data || []).map((row) =>
      normalizeVideo(row, linksResult.data || [], heroLinksMissing ? [] : heroLinksResult.data || [], championById, language),
    );

    setStages(nextStages);
    setVideos(nextVideos);
    setSelectedStageId((current) => {
      if (nextStages.some((stage) => String(stage.id) === String(current))) return current;
      return nextStages[0]?.id || "";
    });
    setVideoDraft((previous) => ({
      ...previous,
      stageIds: nextStages[0]?.id ? [String(nextStages[0].id)] : [],
      heroIds: [],
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
      };
    });
    setHeroSearch("");
  };

  const removeDraftHero = (championId) => {
    setVideoDraft((previous) => ({
      ...previous,
      heroIds: previous.heroIds.filter((id) => String(id) !== String(championId)),
    }));
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
      stageIds: selectedStage?.id ? [String(selectedStage.id)] : [],
      heroIds: [],
    });
    setVideoFormOpen((value) => !value || Boolean(editingVideoId));
  };

  const openEditVideoForm = (video) => {
    if (!isAdminUser || !video?.id) return;

    setEditingVideoId(video.id);
    setHeroSearch("");
    setErrorMessage("");
    setMessage("");
    setVideoDraft({
      url: video.youtubeUrl || "",
      title: video.title || "",
      notes: video.notes || "",
      stageIds: video.stageIds?.length ? video.stageIds.map(String) : selectedStage?.id ? [String(selectedStage.id)] : [],
      heroIds: (video.heroes || []).map((hero) => String(hero.championId || hero.id)).filter(Boolean),
    });
    setVideoFormOpen(true);
  };

  const closeVideoForm = () => {
    setVideoFormOpen(false);
    setEditingVideoId("");
    setHeroSearch("");
  };

  const replaceVideoLinks = async (videoId, selectedStageIds, selectedHeroIds) => {
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

    if (!youtubeVideoId) {
      setErrorMessage(t("pve.invalidYoutubeUrl", "Colle un lien YouTube valide."));
      return;
    }

    if (!selectedStageIds.length) {
      setErrorMessage(t("pve.noStageSelected", "Selectionne au moins un niveau."));
      return;
    }

    setSavingVideo(true);
    setErrorMessage("");
    setMessage("");

    const videoPayload = {
      content_id: selectedContent.id,
      youtube_url: cleanUrl,
      youtube_video_id: youtubeVideoId,
      title: videoDraft.title.trim() || `${selectedContent.name} - ${selectedStageLabel}`,
      notes: videoDraft.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };

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
      await replaceVideoLinks(result.data.id, selectedStageIds, selectedHeroIds);
    } catch (error) {
      setErrorMessage(error?.message || t("pve.saveVideoError", "Ajout de la video impossible."));
      setSavingVideo(false);
      return;
    }

    setVideoDraft({
      url: "",
      title: "",
      notes: "",
      stageIds: selectedStage?.id ? [String(selectedStage.id)] : [],
      heroIds: [],
    });
    closeVideoForm();
    setMessage(editingVideoId ? t("pve.videoUpdated", "Video modifiee.") : t("pve.videoAdded", "Video ajoutee."));
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
                        <div className="mt-1 text-2xl font-black leading-none">{stage.number}</div>
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
                          {selectedContent.name} {stage.number}
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

            {selectedStageVideos.length ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {selectedStageVideos.map((video) => (
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
                          <div className="mt-1 text-xs text-zinc-500">
                            {video.createdByName || t("common.unknown", "Inconnu")}
                            {video.createdAt ? ` - ${formatDate(video.createdAt)}` : ""}
                          </div>
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
                            rel="noreferrer"
                            className="rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                            title={t("pve.openYoutube", "Ouvrir YouTube")}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </div>
                      </div>

                      {video.notes ? (
                        <p className="whitespace-pre-wrap text-sm text-zinc-300">{video.notes}</p>
                      ) : null}

                      {video.heroes?.length ? (
                        <div>
                          <div className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                            {t("pve.composition", "Composition")}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {video.heroes.map((hero) => (
                              <Badge
                                key={`hero-${video.id}-${hero.championId || hero.technicalName}`}
                                className="border-emerald-700/70 bg-emerald-950/40 text-emerald-100"
                              >
                                {hero.displayName}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="flex flex-wrap gap-1.5">
                        {stages
                          .filter((stage) => video.stageIds.includes(String(stage.id)))
                          .map((stage) => (
                            <Badge key={`badge-${video.id}-${stage.id}`} className="border-zinc-700 bg-zinc-900 text-zinc-300">
                              {selectedContent.name} {stage.number}
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
                  {t("pve.noVideoForStage", "Aucune video pour ce niveau.")}
                </div>
                <p className="mt-1 text-sm text-zinc-500">
                  {t("pve.noVideoHelp", "Ajoute une video YouTube et associe-la a un ou plusieurs niveaux.")}
                </p>
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
