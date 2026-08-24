import React, { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Loader2, Lock, RefreshCw, Save, SlidersHorizontal, UserRound, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ProfileAvatar from "@/components/ProfileAvatar";
import ProfileCosmeticUploadStudio from "@/components/ProfileCosmeticUploadStudio";
import {
  buildFrameRenderMetadataFromInset,
  buildFrameRenderMetadataFromImageData,
  getFrameRenderMetadata,
  normalizeFrameRenderMetadata,
} from "@/lib/profileCosmetics";
import { usePortalLanguage } from "@/lib/portalLanguage";

function getApiBase() {
  if (typeof window === "undefined") return "";
  const configuredBase = import.meta.env?.VITE_API_BASE_URL;
  if (configuredBase) return configuredBase.replace(/\/$/, "");
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : "";
}

function normalizeCosmeticId(value) {
  return String(value || "").trim();
}

function buildAssetMap(assets = []) {
  return new Map((assets || []).map((asset) => [String(asset.id), asset]));
}

function getAssetUrl(asset) {
  return asset?.url || asset?.assetUrl || asset?.asset_url || "";
}

function isAdminSession(session) {
  const role = String(session?.role || "").trim().toLowerCase();
  return Boolean(session?.isAdmin || session?.admin || role === "leader" || role === "admin" || role === "administrator");
}

function clampUnit(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(1, Math.max(0, numeric));
}

function clampContentBox(box) {
  const width = Math.min(1, Math.max(0.05, Number(box?.width) || 0.72));
  const height = Math.min(1, Math.max(0.05, Number(box?.height) || 0.72));
  const x = Math.min(1 - width, Math.max(0, Number(box?.x) || 0));
  const y = Math.min(1 - height, Math.max(0, Number(box?.y) || 0));
  return { x, y, width, height };
}

function updateMetadataBox(metadata, key, patch) {
  return normalizeFrameRenderMetadata({
    ...metadata,
    [key]: clampContentBox({ ...(metadata?.[key] || {}), ...patch }),
  });
}

function updateMetadataPoint(metadata, key, patch) {
  return normalizeFrameRenderMetadata({
    ...metadata,
    [key]: {
      ...(metadata?.[key] || {}),
      ...patch,
    },
  });
}

function toPercent(value) {
  return Math.round(Number(value || 0) * 1000) / 10;
}

function fromPercent(value) {
  return clampUnit(Number(value) / 100);
}

function GeometryInput({ label, value, min = 0, max = 100, step = 1, onChange }) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={toPercent(value)}
        onChange={(event) => onChange(fromPercent(event.target.value))}
        className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-cyan-400"
      />
    </label>
  );
}

async function detectFrameMetadataFromUrl(frame) {
  const frameUrl = getAssetUrl(frame);
  if (!frameUrl) {
    throw new Error("Image du cadre introuvable.");
  }

  const image = new Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";
  const loaded = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("Chargement du cadre impossible."));
  });
  image.src = frameUrl;
  await loaded;

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Analyse du cadre impossible.");
  }
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return buildFrameRenderMetadataFromImageData(imageData);
}

function FrameGeometryPreview({ avatar, frame, metadata, name, onMetadataChange }) {
  const previewRef = useRef(null);
  const pointerRef = useRef(null);
  const frameWithDraft = useMemo(() => (frame ? { ...frame, metadata } : null), [frame, metadata]);
  const box = metadata?.content_box || { x: 0.14, y: 0.14, width: 0.72, height: 0.72 };

  function applyPointer(clientX, clientY) {
    const state = pointerRef.current;
    const rect = previewRef.current?.getBoundingClientRect();
    if (!state || !rect?.width || !rect?.height) return;

    const dx = (clientX - state.startX) / rect.width;
    const dy = (clientY - state.startY) / rect.height;
    const next = { ...state.startBox };

    if (state.mode === "move") {
      next.x = state.startBox.x + dx;
      next.y = state.startBox.y + dy;
    }
    if (state.mode.includes("e")) next.width = state.startBox.width + dx;
    if (state.mode.includes("s")) next.height = state.startBox.height + dy;
    if (state.mode.includes("w")) {
      next.x = state.startBox.x + dx;
      next.width = state.startBox.width - dx;
    }
    if (state.mode.includes("n")) {
      next.y = state.startBox.y + dy;
      next.height = state.startBox.height - dy;
    }

    onMetadataChange(updateMetadataBox(metadata, "content_box", clampContentBox(next)));
  }

  function stopPointer() {
    pointerRef.current = null;
    window.removeEventListener("pointermove", handleWindowPointerMove);
    window.removeEventListener("pointerup", stopPointer);
  }

  function handleWindowPointerMove(event) {
    applyPointer(event.clientX, event.clientY);
  }

  function startPointer(mode, event) {
    event.preventDefault();
    event.stopPropagation();
    pointerRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startBox: { ...box },
    };
    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", stopPointer);
  }

  useEffect(() => () => stopPointer(), []);

  return (
    <div className="space-y-3">
      <div
        ref={previewRef}
        className="relative mx-auto aspect-square w-full max-w-[260px] rounded-xl border border-zinc-800 bg-zinc-950"
      >
        <div className="absolute inset-5">
          <ProfileAvatar avatar={avatar} frame={frameWithDraft} name={name} size={220} className="h-full w-full" />
        </div>
        <div
          className="absolute z-20 cursor-move border-2 border-cyan-300/90 bg-cyan-300/10 shadow-[0_0_0_1px_rgba(8,47,73,0.8)]"
          style={{
            left: `${box.x * 100}%`,
            top: `${box.y * 100}%`,
            width: `${box.width * 100}%`,
            height: `${box.height * 100}%`,
          }}
          onPointerDown={(event) => startPointer("move", event)}
          title="Zone avatar"
        >
          {["nw", "ne", "sw", "se"].map((handle) => (
            <span
              key={handle}
              className={`absolute h-3 w-3 rounded-full border border-cyan-950 bg-cyan-200 ${
                handle.includes("n") ? "-top-1.5" : "-bottom-1.5"
              } ${handle.includes("w") ? "-left-1.5" : "-right-1.5"}`}
              onPointerDown={(event) => startPointer(handle, event)}
            />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-3 items-end gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
        {[48, 60, 128].map((size) => (
          <div key={size} className="flex flex-col items-center gap-2 text-xs text-zinc-500">
            <ProfileAvatar avatar={avatar} frame={frameWithDraft} name={name} size={size} />
            <span>{size}px</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CosmeticChoice({ asset, selected, locked, children, onClick }) {
  return (
    <button
      type="button"
      disabled={locked}
      onClick={onClick}
      className={`relative rounded-lg border bg-zinc-950 p-3 text-left transition ${
        selected
          ? "border-cyan-300/70 shadow-[0_0_0_2px_rgba(103,232,249,0.18)]"
          : "border-zinc-800 hover:border-zinc-600"
      } ${locked ? "cursor-not-allowed opacity-55" : ""}`}
    >
      <div className="flex items-center justify-center">{children}</div>
      <div className="mt-3 flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-zinc-100">{asset?.displayName || ""}</span>
        {locked ? <Lock className="h-4 w-4 shrink-0 text-zinc-500" /> : null}
      </div>
    </button>
  );
}

export default function ProfileCosmeticsTab({
  session,
  cosmeticsState,
  loading = false,
  onCosmeticsStateChange,
  adminMode = false,
}) {
  const { t } = usePortalLanguage();
  const apiBase = useMemo(() => getApiBase(), []);
  const catalog = cosmeticsState?.catalog || {};
  const selection = cosmeticsState?.selection || {};
  const assetsById = useMemo(() => buildAssetMap(catalog.assets), [catalog.assets]);
  const canManageCosmetics = adminMode && isAdminSession(session);
  const [draftAvatarId, setDraftAvatarId] = useState("");
  const [draftFrameId, setDraftFrameId] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingFrameMetadata, setSavingFrameMetadata] = useState(false);
  const [detectingFrameMetadata, setDetectingFrameMetadata] = useState(false);
  const [studioAvatarId, setStudioAvatarId] = useState("");
  const [frameMetadataDraft, setFrameMetadataDraft] = useState(null);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    setDraftAvatarId(normalizeCosmeticId(selection.selectedAvatarId));
    setDraftFrameId(normalizeCosmeticId(selection.selectedFrameId));
    setMessage("");
    setErrorMessage("");
  }, [selection.selectedAvatarId, selection.selectedFrameId]);

  const draftAvatar = draftAvatarId ? assetsById.get(draftAvatarId) || null : null;
  const studioAvatar = studioAvatarId ? assetsById.get(studioAvatarId) || null : null;
  const previewAvatar = draftAvatar || (canManageCosmetics ? studioAvatar || catalog.avatars?.[0] || null : null);
  const studioPreviewAvatar = studioAvatar || previewAvatar;
  const draftFrame = draftFrameId && previewAvatar ? assetsById.get(draftFrameId) || null : null;
  const frameWithDraftMetadata = draftFrame && frameMetadataDraft ? { ...draftFrame, metadata: frameMetadataDraft } : draftFrame;
  const hasChanges =
    normalizeCosmeticId(selection.selectedAvatarId) !== draftAvatarId ||
    normalizeCosmeticId(selection.selectedFrameId) !== draftFrameId;
  const displayName = session?.watcherName || session?.name || t("common.player", "Joueur");

  useEffect(() => {
    if (!canManageCosmetics || !draftFrame) {
      setFrameMetadataDraft(null);
      return;
    }
    setFrameMetadataDraft(getFrameRenderMetadata(draftFrame));
  }, [canManageCosmetics, draftFrame?.id, draftFrame?.metadata]);

  useEffect(() => {
    if (!studioAvatarId && canManageCosmetics && catalog.avatars?.length) {
      setStudioAvatarId(String(catalog.avatars[0].id));
    }
  }, [canManageCosmetics, catalog.avatars, studioAvatarId]);

  function resetDraft() {
    setDraftAvatarId(normalizeCosmeticId(selection.selectedAvatarId));
    setDraftFrameId(normalizeCosmeticId(selection.selectedFrameId));
    setMessage("");
    setErrorMessage("");
  }

  async function saveSelection() {
    setSaving(true);
    setMessage("");
    setErrorMessage("");

    try {
      const response = await fetch(`${apiBase}/api/portal-cosmetics`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          selectedAvatarId: draftAvatarId || null,
          selectedFrameId: draftAvatar ? draftFrameId || null : null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || t("profile.saveError", "Sauvegarde impossible."));
      }
      onCosmeticsStateChange?.(payload);
      setMessage(t("profile.saved", "Profil enregistre."));
    } catch (error) {
      setErrorMessage(error?.message || t("profile.saveError", "Sauvegarde impossible."));
    } finally {
      setSaving(false);
    }
  }

  async function saveFrameMetadata() {
    if (!draftFrame || !frameMetadataDraft) return;
    setSavingFrameMetadata(true);
    setMessage("");
    setErrorMessage("");

    try {
      const response = await fetch(`${apiBase}/api/portal-cosmetics`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-frame-render-metadata",
          assetId: draftFrame.id,
          metadata: normalizeFrameRenderMetadata(frameMetadataDraft),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || t("profile.frameMetadataSaveError", "Reglage du cadre impossible."));
      }
      onCosmeticsStateChange?.(payload);
      setMessage(t("profile.frameMetadataSaved", "Reglage du cadre enregistre."));
    } catch (error) {
      setErrorMessage(error?.message || t("profile.frameMetadataSaveError", "Reglage du cadre impossible."));
    } finally {
      setSavingFrameMetadata(false);
    }
  }

  async function detectFrameMetadata() {
    if (!draftFrame) return;
    setDetectingFrameMetadata(true);
    setMessage("");
    setErrorMessage("");

    try {
      const result = await detectFrameMetadataFromUrl(draftFrame);
      setFrameMetadataDraft(result.metadata);
      const confidence = result.analysis?.confidence || "unknown";
      const reason = result.analysis?.reason || "";
      setMessage(
        t("profile.frameDetectionApplied", "Detection locale appliquee ({confidence}{reason}).")
          .replace("{confidence}", confidence)
          .replace("{reason}", reason ? ` - ${reason}` : ""),
      );
    } catch (error) {
      setFrameMetadataDraft(buildFrameRenderMetadataFromInset(draftFrame));
      setErrorMessage(
        t("profile.frameDetectionFallback", "{error} Fallback content_inset applique localement, sans sauvegarde.").replace(
          "{error}",
          error?.message || "Detection automatique impossible.",
        ),
      );
    } finally {
      setDetectingFrameMetadata(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-sky-400/25 bg-sky-400/10 text-sky-200">
              <UserRound className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-300">
                {t("profile.customization", "Personnalisation")}
              </p>
              <h2 className="mt-1 text-2xl font-semibold text-zinc-50">
                {adminMode ? t("profile.cosmeticsStudio", "Cosmetiques") : t("profile.title", "Mon profil")}
              </h2>
              <p className="mt-1 text-sm text-zinc-500">{displayName}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
              onClick={resetDraft}
              disabled={!hasChanges || saving}
            >
              <XCircle className="mr-2 h-4 w-4" />
              {t("profile.cancel", "Annuler")}
            </Button>
            <Button
              type="button"
              className="rounded-lg bg-cyan-500 text-zinc-950 hover:bg-cyan-400"
              onClick={saveSelection}
              disabled={!hasChanges || saving || loading}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {saving ? t("profile.saving", "Enregistrement...") : t("profile.save", "Enregistrer")}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="mt-5 flex items-center gap-2 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("common.loading", "Chargement...")}
          </div>
        ) : null}
        {!loading && cosmeticsState && !cosmeticsState.schemaReady ? (
          <div className="mt-5 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
            {t("profile.schemaMissing", "Les tables de personnalisation ne sont pas encore installees.")}
          </div>
        ) : null}
        {message ? <div className="mt-5 rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-100">{message}</div> : null}
        {errorMessage ? <div className="mt-5 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">{errorMessage}</div> : null}
      </div>

      <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
            {t("profile.preview", "Apercu")}
          </p>
          <div className="mt-5 flex flex-col items-center text-center">
            <ProfileAvatar avatar={previewAvatar} frame={frameWithDraftMetadata} name={displayName} size={220} />
            <div className="mt-4 text-lg font-semibold text-zinc-50">{displayName}</div>
            <p className="mt-1 text-sm text-zinc-500">
              {previewAvatar ? previewAvatar.displayName : t("profile.noAvatarSelected", "Aucun avatar selectionne")}
            </p>
            {frameWithDraftMetadata ? (
              <Badge className="mt-3 rounded-full border-cyan-400/30 bg-cyan-400/10 text-cyan-100">
                {frameWithDraftMetadata.displayName}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
                  {t("profile.basicCollection", "Collection Basique")}
                </p>
                <h3 className="mt-1 text-xl font-semibold text-zinc-50">{t("profile.avatars", "Avatars")}</h3>
              </div>
              <span className="text-xs text-zinc-500">{catalog.avatars?.length || 0}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {(catalog.avatars || []).map((avatar) => (
                <CosmeticChoice
                  key={avatar.id}
                  asset={avatar}
                  selected={draftAvatarId === String(avatar.id)}
                  locked={avatar.locked}
                  onClick={() => {
                    setDraftAvatarId(String(avatar.id));
                    setErrorMessage("");
                  }}
                >
                  <ProfileAvatar avatar={avatar} frame={frameWithDraftMetadata} name={displayName} size={88} />
                </CosmeticChoice>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
                  {t("profile.basicCollection", "Collection Basique")}
                </p>
                <h3 className="mt-1 text-xl font-semibold text-zinc-50">{t("profile.frames", "Cadres")}</h3>
              </div>
              <span className="text-xs text-zinc-500">{catalog.frames?.length || 0}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <button
                type="button"
                onClick={() => setDraftFrameId("")}
                className={`rounded-lg border bg-zinc-950 p-3 text-left transition ${
                  !draftFrameId ? "border-cyan-300/70 shadow-[0_0_0_2px_rgba(103,232,249,0.18)]" : "border-zinc-800 hover:border-zinc-600"
                }`}
              >
                <div className="flex h-[88px] items-center justify-center rounded-full border border-dashed border-zinc-700 text-xs text-zinc-500">
                  {t("profile.noFrame", "Aucun cadre")}
                </div>
                <div className="mt-3 truncate text-sm font-medium text-zinc-100">{t("profile.noFrame", "Aucun cadre")}</div>
              </button>

              {(catalog.frames || []).map((frame) => (
                <CosmeticChoice
                  key={frame.id}
                  asset={frame}
                  selected={draftFrameId === String(frame.id)}
                  locked={frame.locked || !previewAvatar}
                  onClick={() => {
                    if (!previewAvatar) return;
                    setDraftFrameId(String(frame.id));
                    setErrorMessage("");
                  }}
                >
                  <ProfileAvatar avatar={previewAvatar} frame={frame} name={displayName} size={88} />
                </CosmeticChoice>
              ))}
            </div>
          </div>

          {canManageCosmetics ? (
            <>
            <ProfileCosmeticUploadStudio
              apiBase={apiBase}
              canManageCosmetics={canManageCosmetics}
              catalog={catalog}
              displayName={displayName}
              previewAvatar={studioPreviewAvatar}
              t={t}
              onCosmeticsStateChange={onCosmeticsStateChange}
              onSelectAvatar={(assetId) => {
                setDraftAvatarId(normalizeCosmeticId(assetId));
                setStudioAvatarId(normalizeCosmeticId(assetId));
              }}
              onSelectFrame={(assetId) => setDraftFrameId(normalizeCosmeticId(assetId))}
              onMessage={setMessage}
              onError={setErrorMessage}
            />

            <div className="rounded-lg border border-purple-400/20 bg-purple-950/10 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-purple-300">
                    {t("profile.frameStudioEyebrow", "Studio admin")}
                  </p>
                  <h3 className="mt-1 text-xl font-semibold text-zinc-50">
                    {t("profile.frameStudioTitle", "Reglage des cadres")}
                  </h3>
                  <p className="mt-1 max-w-2xl text-sm text-zinc-500">
                    {t("profile.frameStudioHelp", "Ajuste la zone avatar des cadres existants sans reuploader leur PNG.")}
                  </p>
                </div>
                {draftFrame ? (
                  <Badge className="rounded-full border-purple-300/30 bg-purple-400/10 text-purple-100">
                    {draftFrame.displayName}
                  </Badge>
                ) : null}
              </div>

              {!draftFrame || !frameMetadataDraft ? (
                <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
                  {t("profile.frameStudioSelectFrame", "Selectionne un cadre pour ajuster son rendu.")}
                </div>
              ) : (
                <div className="mt-5 grid gap-5 xl:grid-cols-[320px_1fr]">
                  <FrameGeometryPreview
                    avatar={studioPreviewAvatar}
                    frame={draftFrame}
                    metadata={frameMetadataDraft}
                    name={displayName}
                    onMetadataChange={setFrameMetadataDraft}
                  />

                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-4">
                      <GeometryInput
                        label="Zone X"
                        value={frameMetadataDraft.content_box.x}
                        onChange={(value) =>
                          setFrameMetadataDraft((current) => updateMetadataBox(current, "content_box", { x: value }))
                        }
                      />
                      <GeometryInput
                        label="Zone Y"
                        value={frameMetadataDraft.content_box.y}
                        onChange={(value) =>
                          setFrameMetadataDraft((current) => updateMetadataBox(current, "content_box", { y: value }))
                        }
                      />
                      <GeometryInput
                        label="Zone L"
                        value={frameMetadataDraft.content_box.width}
                        onChange={(value) =>
                          setFrameMetadataDraft((current) => updateMetadataBox(current, "content_box", { width: value }))
                        }
                      />
                      <GeometryInput
                        label="Zone H"
                        value={frameMetadataDraft.content_box.height}
                        onChange={(value) =>
                          setFrameMetadataDraft((current) => updateMetadataBox(current, "content_box", { height: value }))
                        }
                      />
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <GeometryInput
                        label="Arrondi"
                        max={50}
                        value={frameMetadataDraft.content_radius}
                        onChange={(value) =>
                          setFrameMetadataDraft((current) => normalizeFrameRenderMetadata({ ...current, content_radius: value }))
                        }
                      />
                      <GeometryInput
                        label="Focal X"
                        value={frameMetadataDraft.avatar_position.x}
                        onChange={(value) =>
                          setFrameMetadataDraft((current) => updateMetadataPoint(current, "avatar_position", { x: value }))
                        }
                      />
                      <GeometryInput
                        label="Focal Y"
                        value={frameMetadataDraft.avatar_position.y}
                        onChange={(value) =>
                          setFrameMetadataDraft((current) => updateMetadataPoint(current, "avatar_position", { y: value }))
                        }
                      />
                    </div>

                    <div className="grid gap-3 md:grid-cols-4">
                      <GeometryInput
                        label="Cadre X"
                        value={frameMetadataDraft.frame_box.x}
                        onChange={(value) =>
                          setFrameMetadataDraft((current) => updateMetadataBox(current, "frame_box", { x: value }))
                        }
                      />
                      <GeometryInput
                        label="Cadre Y"
                        value={frameMetadataDraft.frame_box.y}
                        onChange={(value) =>
                          setFrameMetadataDraft((current) => updateMetadataBox(current, "frame_box", { y: value }))
                        }
                      />
                      <GeometryInput
                        label="Cadre L"
                        value={frameMetadataDraft.frame_box.width}
                        onChange={(value) =>
                          setFrameMetadataDraft((current) => updateMetadataBox(current, "frame_box", { width: value }))
                        }
                      />
                      <GeometryInput
                        label="Cadre H"
                        value={frameMetadataDraft.frame_box.height}
                        onChange={(value) =>
                          setFrameMetadataDraft((current) => updateMetadataBox(current, "frame_box", { height: value }))
                        }
                      />
                    </div>

                    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        {t("profile.frameStudioTestAvatar", "Avatar de test")}
                      </div>
                      <div className="grid grid-cols-5 gap-2 sm:grid-cols-8 md:grid-cols-10">
                        {(catalog.avatars || []).slice(0, 20).map((avatar) => (
                          <button
                            key={`studio-avatar-${avatar.id}`}
                            type="button"
                            className={`rounded-lg border p-1 transition ${
                              String(studioAvatarId) === String(avatar.id)
                                ? "border-purple-300 bg-purple-400/10"
                                : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"
                            }`}
                            onClick={() => setStudioAvatarId(String(avatar.id))}
                            title={avatar.displayName}
                          >
                            <ProfileAvatar avatar={avatar} frame={null} name={avatar.displayName} size={42} />
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                        onClick={() => setFrameMetadataDraft(getFrameRenderMetadata(draftFrame))}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        {t("profile.frameStudioReset", "Reinitialiser")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                        onClick={detectFrameMetadata}
                        disabled={detectingFrameMetadata}
                      >
                        {detectingFrameMetadata ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <SlidersHorizontal className="mr-2 h-4 w-4" />}
                        {t("profile.frameStudioAuto", "Detection automatique")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                        onClick={() =>
                          setFrameMetadataDraft((current) => {
                            const box = current?.content_box || { width: 0.72, height: 0.72 };
                            return normalizeFrameRenderMetadata({
                              ...current,
                              content_box: {
                                ...box,
                                x: (1 - box.width) / 2,
                                y: (1 - box.height) / 2,
                              },
                              avatar_position: { x: 0.5, y: 0.5 },
                              frame_box: { x: 0, y: 0, width: 1, height: 1 },
                            });
                          })
                        }
                      >
                        <Crosshair className="mr-2 h-4 w-4" />
                        {t("profile.frameStudioCenter", "Centrer")}
                      </Button>
                      <Button
                        type="button"
                        className="rounded-lg bg-purple-500 text-zinc-950 hover:bg-purple-400"
                        onClick={saveFrameMetadata}
                        disabled={savingFrameMetadata}
                      >
                        {savingFrameMetadata ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        {savingFrameMetadata
                          ? t("profile.frameMetadataSaving", "Enregistrement...")
                          : t("profile.frameMetadataSave", "Enregistrer le reglage")}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
