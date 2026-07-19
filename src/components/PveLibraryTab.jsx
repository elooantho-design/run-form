import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, ExternalLink, Plus, RefreshCw, Search, Youtube } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { usePortalLanguage } from "@/lib/portalLanguage";

function isAdminSession(session) {
  const role = String(session?.role || "").trim().toLowerCase();
  return role === "admin" || role === "leader";
}

function slugifyContentName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
    id: row.id,
    name: row.name || row.label || "",
    slug: row.slug || "",
    description: row.description || "",
    stageCount: row.stage_count ?? row.stageCount ?? 0,
    sortOrder: row.sort_order ?? row.sortOrder ?? 9999,
    isActive: row.is_active ?? row.isActive ?? true,
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

function normalizeVideo(row, linkRows = []) {
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
  };
}

export default function PveLibraryTab({
  session,
  contents = [],
  selectedContentId = "",
  onContentCreated,
}) {
  const { t } = usePortalLanguage();
  const isAdminUser = isAdminSession(session);
  const [localContents, setLocalContents] = useState(contents.map(normalizeContent));
  const [selectedStageId, setSelectedStageId] = useState("");
  const [stages, setStages] = useState([]);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingVideo, setSavingVideo] = useState(false);
  const [savingContent, setSavingContent] = useState(false);
  const [videoFormOpen, setVideoFormOpen] = useState(false);
  const [contentFormOpen, setContentFormOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [videoDraft, setVideoDraft] = useState({
    url: "",
    title: "",
    notes: "",
    stageIds: [],
  });
  const [contentDraft, setContentDraft] = useState({
    name: "",
    description: "",
    stageCount: 24,
  });

  useEffect(() => {
    setLocalContents(contents.map(normalizeContent));
  }, [contents]);

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
      const found = sortedContents.find((content) => String(content.id) === String(selectedContentId));
      if (found) return found;
    }

    return sortedContents[0] || null;
  }, [selectedContentId, sortedContents]);

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
      return;
    }

    setLoading(true);
    setErrorMessage("");

    const [stagesResult, videosResult, linksResult] = await Promise.all([
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
    ]);

    if (stagesResult.error || videosResult.error || linksResult.error) {
      const error = stagesResult.error || videosResult.error || linksResult.error;
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
    const nextVideos = (videosResult.data || []).map((row) => normalizeVideo(row, linksResult.data || []));

    setStages(nextStages);
    setVideos(nextVideos);
    setSelectedStageId((current) => {
      if (nextStages.some((stage) => String(stage.id) === String(current))) return current;
      return nextStages[0]?.id || "";
    });
    setVideoDraft((previous) => ({
      ...previous,
      stageIds: nextStages[0]?.id ? [String(nextStages[0].id)] : [],
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

  const saveVideo = async (event) => {
    event.preventDefault();
    if (!selectedContent?.id || savingVideo) return;

    const cleanUrl = videoDraft.url.trim();
    const youtubeVideoId = extractYoutubeVideoId(cleanUrl);
    const selectedStageIds = videoDraft.stageIds.filter((stageId) =>
      stages.some((stage) => String(stage.id) === String(stageId)),
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

    const { data: video, error: videoError } = await supabase
      .from("pve_videos")
      .insert({
        content_id: selectedContent.id,
        youtube_url: cleanUrl,
        youtube_video_id: youtubeVideoId,
        title: videoDraft.title.trim() || `${selectedContent.name} - ${selectedStageLabel}`,
        notes: videoDraft.notes.trim() || null,
        created_by_member_id: session?.memberId || session?.id || null,
        created_by_name: session?.watcherName || session?.name || "",
      })
      .select("id, content_id, youtube_url, youtube_video_id, title, notes, created_by_name, created_at")
      .single();

    if (videoError) {
      setErrorMessage(videoError.message || t("pve.saveVideoError", "Ajout de la video impossible."));
      setSavingVideo(false);
      return;
    }

    const { error: linksError } = await supabase.from("pve_video_stages").insert(
      selectedStageIds.map((stageId) => ({
        content_id: selectedContent.id,
        video_id: video.id,
        stage_id: stageId,
      })),
    );

    if (linksError) {
      setErrorMessage(linksError.message || t("pve.saveVideoError", "Ajout de la video impossible."));
      setSavingVideo(false);
      return;
    }

    setVideoDraft({
      url: "",
      title: "",
      notes: "",
      stageIds: selectedStage?.id ? [String(selectedStage.id)] : [],
    });
    setVideoFormOpen(false);
    setMessage(t("pve.videoAdded", "Video ajoutee."));
    setSavingVideo(false);
    await loadContentData();
  };

  const createContent = async (event) => {
    event.preventDefault();
    if (!isAdminUser || savingContent) return;

    const cleanName = contentDraft.name.trim();
    const stageCount = Math.max(1, Math.min(60, Number(contentDraft.stageCount) || 1));
    const slug = slugifyContentName(cleanName);

    if (!cleanName || !slug) {
      setErrorMessage(t("pve.contentNameRequired", "Renseigne un nom de contenu."));
      return;
    }

    setSavingContent(true);
    setErrorMessage("");
    setMessage("");

    const nextSortOrder =
      sortedContents.reduce((max, content) => Math.max(max, Number(content.sortOrder) || 0), 0) + 10;

    const { data: content, error: contentError } = await supabase
      .from("pve_contents")
      .insert({
        slug,
        name: cleanName,
        description: contentDraft.description.trim() || null,
        stage_count: stageCount,
        sort_order: nextSortOrder,
        is_active: true,
        created_by_member_id: session?.memberId || session?.id || null,
        created_by_name: session?.watcherName || session?.name || "",
      })
      .select("id, slug, name, description, stage_count, sort_order, is_active")
      .single();

    if (contentError) {
      setErrorMessage(contentError.message || t("pve.createContentError", "Creation du contenu impossible."));
      setSavingContent(false);
      return;
    }

    const { error: stagesError } = await supabase.from("pve_content_stages").insert(
      Array.from({ length: stageCount }, (_, index) => ({
        content_id: content.id,
        stage_number: index + 1,
        name: `${t("pve.stage", "Niveau")} ${index + 1}`,
        sort_order: index + 1,
      })),
    );

    if (stagesError) {
      setErrorMessage(stagesError.message || t("pve.createContentError", "Creation du contenu impossible."));
      setSavingContent(false);
      return;
    }

    const normalizedContent = normalizeContent(content);
    setLocalContents((previous) => [...previous, normalizedContent]);
    setContentDraft({ name: "", description: "", stageCount: 24 });
    setContentFormOpen(false);
    setMessage(t("pve.contentCreated", "Contenu PVE cree."));
    setSavingContent(false);
    onContentCreated?.(normalizedContent);
  };

  if (!selectedContent && !isAdminUser) {
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

          {isAdminUser ? (
            <Button
              type="button"
              onClick={() => setContentFormOpen((value) => !value)}
              className="rounded-xl bg-emerald-600 text-white hover:bg-emerald-500"
            >
              <Plus className="h-4 w-4" />
              {t("pve.addContent", "Ajouter un contenu")}
            </Button>
          ) : null}
        </div>
      </div>

      {contentFormOpen && isAdminUser ? (
        <form
          onSubmit={createContent}
          className="grid gap-3 rounded-2xl border border-emerald-900/60 bg-emerald-950/20 p-4 md:grid-cols-[minmax(0,1fr)_130px_auto]"
        >
          <label className="text-sm font-medium text-zinc-300">
            {t("pve.contentName", "Nom du contenu")}
            <input
              type="text"
              value={contentDraft.name}
              onChange={(event) => setContentDraft((previous) => ({ ...previous, name: event.target.value }))}
              placeholder="GR2, GR3, Guild Boss..."
              className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
            />
          </label>

          <label className="text-sm font-medium text-zinc-300">
            {t("pve.stageCount", "Niveaux")}
            <input
              type="number"
              min="1"
              max="60"
              value={contentDraft.stageCount}
              onChange={(event) => setContentDraft((previous) => ({ ...previous, stageCount: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
            />
          </label>

          <div className="flex items-end">
            <Button type="submit" disabled={savingContent} className="w-full rounded-xl bg-emerald-600 text-white hover:bg-emerald-500">
              {savingContent ? t("common.saving", "Sauvegarde...") : t("common.save", "Sauvegarder")}
            </Button>
          </div>

          <label className="text-sm font-medium text-zinc-300 md:col-span-3">
            {t("common.description", "Description")}
            <input
              type="text"
              value={contentDraft.description}
              onChange={(event) => setContentDraft((previous) => ({ ...previous, description: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
            />
          </label>
        </form>
      ) : null}

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
                onClick={() => setVideoFormOpen((value) => !value)}
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
                    onClick={() => setVideoFormOpen(false)}
                    disabled={savingVideo}
                    className="rounded-xl border-zinc-700 bg-transparent text-zinc-200"
                  >
                    {t("common.cancel", "Annuler")}
                  </Button>
                  <Button type="submit" disabled={savingVideo} className="rounded-xl bg-red-600 text-white hover:bg-red-500">
                    {savingVideo ? t("common.saving", "Sauvegarde...") : t("pve.saveVideo", "Enregistrer la video")}
                  </Button>
                </div>
              </form>
            ) : null}

            {selectedStageVideos.length ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {selectedStageVideos.map((video) => (
                  <article key={video.id} className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
                    <a
                      href={video.youtubeUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="group block bg-black"
                    >
                      <img
                        src={`https://img.youtube.com/vi/${video.youtubeVideoId}/hqdefault.jpg`}
                        alt={video.title}
                        className="aspect-video w-full object-cover opacity-90 transition group-hover:opacity-100"
                        loading="lazy"
                      />
                    </a>
                    <div className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="font-semibold text-white">{video.title}</h4>
                          <div className="mt-1 text-xs text-zinc-500">
                            {video.createdByName || t("common.unknown", "Inconnu")}
                            {video.createdAt ? ` - ${formatDate(video.createdAt)}` : ""}
                          </div>
                        </div>
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

                      {video.notes ? (
                        <p className="whitespace-pre-wrap text-sm text-zinc-300">{video.notes}</p>
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
