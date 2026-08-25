import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Award,
  CheckCircle2,
  Coins,
  Crosshair,
  Gift,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UploadCloud,
  UserRound,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ProfileAvatar from "@/components/ProfileAvatar";
import ProfileCosmeticUploadStudio from "@/components/ProfileCosmeticUploadStudio";
import {
  PROFILE_COSMETIC_AVATAR,
  PROFILE_COSMETIC_FRAME,
  PROFILE_COSMETIC_UI_ACCESS_BASIC,
  PROFILE_COSMETIC_UI_ACCESS_MANUAL,
  PROFILE_COSMETIC_UI_ACCESS_MONTHLY_LOYALTY,
  PROFILE_COSMETIC_UI_ACCESS_SUPPORT_TOTAL,
  buildProfileCosmeticAccessRulePayload,
  buildProfileCosmeticRuleDraft,
  buildFrameRenderMetadataFromInset,
  buildFrameRenderMetadataFromImageData,
  getProfileCosmeticAdminAccessBadge,
  getFrameRenderMetadata,
  MAX_PROFILE_FRAME_ANIMATION_LAYERS,
  normalizeFrameRenderMetadata,
  PROFILE_FRAME_ALLOWED_ANIMATION_BLEND_MODES,
  sortProfileCosmeticAssetsNatural,
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

function isLeaderSession(session) {
  const role = String(session?.role || "").trim().toLowerCase();
  return Boolean(session?.isLeader || session?.leader || role === "leader");
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

const ANIMATION_LAYER_URL_PLACEHOLDER = "https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/effects/effet.webp";
const MAX_ANIMATION_EFFECT_BYTES = 5 * 1024 * 1024;
const ANIMATION_LAYER_BLEND_MODES = Array.from(PROFILE_FRAME_ALLOWED_ANIMATION_BLEND_MODES);

function clampNumber(value, fallback = 0, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function getAnimationLayers(metadata) {
  return Array.isArray(metadata?.animation_layers) ? metadata.animation_layers : [];
}

function getNextAnimationLayerId(layers, baseId) {
  const existingIds = new Set(layers.map((layer) => String(layer?.id || "")));
  if (!existingIds.has(baseId)) return baseId;
  let index = 2;
  while (existingIds.has(`${baseId}_${index}`)) index += 1;
  return `${baseId}_${index}`;
}

function buildAnimationLayerDraft(side = "left", existingLayers = []) {
  const isRight = side === "right";
  const baseId = isRight ? "firework_right" : "firework_left";
  return {
    id: getNextAnimationLayerId(existingLayers, baseId),
    label: isRight ? "Feu droite" : "Feu gauche",
    type: "webp",
    url: "",
    x: isRight ? 0.77 : 0,
    y: 0.15,
    width: 0.23,
    height: 0.23,
    rotation: 0,
    flipX: isRight,
    opacity: 1,
    zIndex: 20,
    delayMs: isRight ? 450 : 0,
    pointerEvents: false,
    blendMode: "screen",
  };
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${bytes} o`;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("SHA-256 navigateur indisponible.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function inspectAnimatedWebpBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 20) return false;
  const decoder = new TextDecoder("ascii");
  if (decoder.decode(bytes.subarray(0, 4)) !== "RIFF" || decoder.decode(bytes.subarray(8, 12)) !== "WEBP") return false;
  const text = decoder.decode(bytes);
  return text.includes("ANIM") || text.includes("ANMF");
}

async function readEffectFilePayload(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "");
  if (!file || type !== "image/webp" || !/\.webp$/i.test(name)) {
    throw new Error("Format non supporte. Utilise un fichier WebP anime.");
  }
  if (file.size > MAX_ANIMATION_EFFECT_BYTES) {
    throw new Error(`Fichier trop lourd (${formatBytes(file.size)}). Maximum 5 Mo.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!inspectAnimatedWebpBytes(bytes)) {
    throw new Error("Le WebP doit contenir une animation.");
  }
  return {
    webpBase64: bytesToBase64(bytes),
    sha256: await sha256Hex(bytes),
    size: bytes.length,
  };
}

function setAnimationLayers(metadata, nextLayers) {
  const base = normalizeFrameRenderMetadata(metadata || {});
  return {
    ...base,
    animation_layers: nextLayers.slice(0, MAX_PROFILE_FRAME_ANIMATION_LAYERS),
  };
}

function updateAnimationLayer(metadata, index, patch) {
  const layers = getAnimationLayers(metadata).map((layer, layerIndex) =>
    layerIndex === index
      ? {
          ...layer,
          ...patch,
          pointerEvents: false,
        }
      : layer,
  );
  return setAnimationLayers(metadata, layers);
}

function formatCurrency(cents, language = "fr") {
  const value = Number(cents || 0) / 100;
  return new Intl.NumberFormat(language === "en" ? "en-US" : "fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

function formatAccessType(asset, t, language = "fr") {
  const access = asset?.access || {};
  if (access.source === "leader_bypass") return t("profile.accessLeader", "Acces leader");
  if (access.source === "manual_grant") return t("profile.accessGrant", "Attribution personnelle");
  if (access.accessType === "basic" || access.source === "basic") return t("profile.accessBasic", "Accessible a tous");
  if (access.source === "support_total") {
    return t("profile.accessSupportTotal", "Soutien cumule {amount}").replace(
      "{amount}",
      formatCurrency(access.thresholdValue || 0, language),
    );
  }
  if (access.source === "monthly_loyalty") {
    return t("profile.accessMonthlyLoyalty", "{count} mensualite(s) confirmee(s)").replace(
      "{count}",
      access.thresholdValue || 0,
    );
  }
  if (access.accessType === "manual") return access.title || t("profile.accessManual", "Recompense speciale");
  return access.title || t("profile.locked", "Verrouille");
}

function formatAccessProgress(asset, t, language = "fr") {
  const access = asset?.access || {};
  if (access.source === "support_total" && access.thresholdValue) {
    return `${formatCurrency(access.currentValue || 0, language)} / ${formatCurrency(access.thresholdValue, language)}`;
  }
  if (access.source === "monthly_loyalty" && access.thresholdValue) {
    return t("profile.monthlyProgress", "{current} / {target} mensualites").replace(
      "{current}",
      access.currentValue || 0,
    ).replace("{target}", access.thresholdValue);
  }
  return "";
}

function getAccessBadgeClass(asset) {
  if (asset?.unlocked && !asset?.locked) return "border-emerald-400/30 bg-emerald-400/10 text-emerald-100";
  return "border-amber-400/30 bg-amber-400/10 text-amber-100";
}

function getAccessRuleForAsset(adminState, assetId) {
  return (adminState?.rules || []).find((rule) => String(rule.assetId) === String(assetId)) || {
    assetId,
    accessType: "basic",
    tierId: null,
    publicUnlockTitle: "",
    publicUnlockDescription: "",
  };
}

function getTierThresholdLabel(tier, language, t) {
  if (!tier) return "";
  if (tier.tierType === "support_total") return formatCurrency(tier.thresholdValue, language);
  return `${tier.thresholdValue} ${t("profile.months", "mois")}`;
}

function getAdminBadgeClass(tone) {
  if (tone === "support") return "border-amber-400/35 bg-amber-400/10 text-amber-100";
  if (tone === "monthly") return "border-indigo-400/35 bg-indigo-400/10 text-indigo-100";
  if (tone === "manual") return "border-red-400/35 bg-red-400/10 text-red-100";
  return "border-emerald-400/35 bg-emerald-400/10 text-emerald-100";
}

function getAdminBadgeLabel(rule, tiers, t, language) {
  const badge = getProfileCosmeticAdminAccessBadge(rule, tiers, language);
  if (badge.mode === PROFILE_COSMETIC_UI_ACCESS_SUPPORT_TOTAL) {
    return t("profile.adminBadgeSupportTotal", "Soutien cumule · {value}").replace(
      "{value}",
      getTierThresholdLabel(badge.tier, language, t) || "-",
    );
  }
  if (badge.mode === PROFILE_COSMETIC_UI_ACCESS_MONTHLY_LOYALTY) {
    return t("profile.adminBadgeMonthlyLoyalty", "Fidelite mensuelle · {value}").replace(
      "{value}",
      getTierThresholdLabel(badge.tier, language, t) || "-",
    );
  }
  return t(badge.labelKey, badge.fallbackLabel);
}

function filterTiersByUiMode(tiers = [], uiMode = "") {
  if (uiMode === PROFILE_COSMETIC_UI_ACCESS_SUPPORT_TOTAL) {
    return tiers.filter((tier) => tier.tierType === "support_total");
  }
  if (uiMode === PROFILE_COSMETIC_UI_ACCESS_MONTHLY_LOYALTY) {
    return tiers.filter((tier) => tier.tierType === "monthly_loyalty");
  }
  return [];
}

function getRuleDraftForAsset(adminState, assetId) {
  return buildProfileCosmeticRuleDraft(getAccessRuleForAsset(adminState, assetId), adminState?.tiers || []);
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

function LayerTextInput({ label, value, placeholder = "", onChange }) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</span>
      <input
        type="text"
        value={value || ""}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-400"
      />
    </label>
  );
}

function LayerNumberInput({ label, value, min, max, step = 1, onChange }) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(Number(value)) ? value : 0}
        onChange={(event) => onChange(clampNumber(event.target.value, value || 0, min, max))}
        className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-cyan-400"
      />
    </label>
  );
}

function FrameAnimationLayersPanel({ metadata, onMetadataChange, t, apiBase, onMessage, onError }) {
  const layers = getAnimationLayers(metadata);
  const canAddLayer = layers.length < MAX_PROFILE_FRAME_ANIMATION_LAYERS;
  const effectInputRefs = useRef(new Map());
  const [effectUploads, setEffectUploads] = useState({});

  function getUploadState(index) {
    return effectUploads[index] || {};
  }

  function updateUploadState(index, patch) {
    setEffectUploads((current) => ({
      ...current,
      [index]: {
        ...(current[index] || {}),
        ...patch,
      },
    }));
  }

  function selectEffectFile(index, file) {
    if (!file) return;
    const type = String(file.type || "").toLowerCase();
    if (type !== "image/webp" || !/\.webp$/i.test(file.name || "")) {
      updateUploadState(index, {
        file: null,
        name: "",
        size: 0,
        status: "failed",
        error: t("profile.animationLayerUploadInvalidFormat", "Format non supporte. Utilise un fichier WebP anime."),
      });
      return;
    }
    if (file.size > MAX_ANIMATION_EFFECT_BYTES) {
      updateUploadState(index, {
        file: null,
        name: "",
        size: 0,
        status: "failed",
        error: t("profile.animationLayerUploadTooLarge", "Fichier trop lourd. Maximum 5 Mo."),
      });
      return;
    }
    updateUploadState(index, {
      file,
      name: file.name,
      size: file.size,
      status: "selected",
      error: "",
    });
  }

  async function uploadSelectedEffect(index) {
    const uploadState = getUploadState(index);
    const file = uploadState.file;
    if (!file || uploadState.status === "uploading") return;
    updateUploadState(index, { status: "uploading", error: "" });
    onMessage?.("");
    onError?.("");

    try {
      const payload = await readEffectFilePayload(file);
      const response = await fetch(`${apiBase}/api/portal-cosmetics-admin`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "publish-cosmetic-effect",
          fileName: file.name,
          mimeType: "image/webp",
          size: payload.size,
          webpBase64: payload.webpBase64,
          sha256: payload.sha256,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.url) {
        throw new Error(data?.error || t("profile.animationLayerUploadError", "Upload WebP impossible."));
      }

      onMetadataChange((current) => updateAnimationLayer(current, index, { url: data.url }));
      updateUploadState(index, {
        status: "published",
        error: "",
        url: data.url,
        filename: data.filename || "",
      });
      onMessage?.(t("profile.animationLayerUploadSuccess", "WebP anime importe. Pense a enregistrer le reglage du cadre."));
    } catch (error) {
      const message = error?.message || t("profile.animationLayerUploadError", "Upload WebP impossible.");
      updateUploadState(index, { status: "failed", error: message });
      onError?.(message);
    }
  }

  function duplicateLayerUrl(index) {
    const sourceLayer = layers[index];
    if (!sourceLayer?.url) return;
    const mirroredIndex = layers.findIndex((layer, layerIndex) => {
      if (layerIndex === index) return false;
      if (Boolean(layer?.flipX) !== Boolean(sourceLayer.flipX)) return true;
      return /right/i.test(String(layer?.id || "")) && !/right/i.test(String(sourceLayer?.id || ""));
    });
    if (mirroredIndex < 0) return;
    onMetadataChange((current) => updateAnimationLayer(current, mirroredIndex, { url: sourceLayer.url }));
  }

  function addLayer(side = "left") {
    onMetadataChange((current) => {
      const currentLayers = getAnimationLayers(current);
      return setAnimationLayers(current, [...currentLayers, buildAnimationLayerDraft(side, currentLayers)]);
    });
  }

  function addSymmetricLayers() {
    onMetadataChange((current) => {
      const currentLayers = getAnimationLayers(current);
      const left = buildAnimationLayerDraft("left", currentLayers);
      const right = buildAnimationLayerDraft("right", [...currentLayers, left]);
      return setAnimationLayers(current, [...currentLayers, left, right]);
    });
  }

  function removeLayer(index) {
    onMetadataChange((current) => setAnimationLayers(current, getAnimationLayers(current).filter((_, layerIndex) => layerIndex !== index)));
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            {t("profile.animationLayers", "Calques animes")}
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {t(
              "profile.animationLayersHelp",
              "Ajoute des WebP animes positionnes en ratios sur le cadre. Les clics restent ignores.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
            onClick={addSymmetricLayers}
            disabled={!canAddLayer || layers.length > MAX_PROFILE_FRAME_ANIMATION_LAYERS - 2}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {t("profile.animationLayersAddPair", "Ajouter gauche/droite")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
            onClick={() => addLayer("left")}
            disabled={!canAddLayer}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t("profile.animationLayersAdd", "Ajouter un calque")}
          </Button>
        </div>
      </div>

      {layers.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-zinc-800 bg-zinc-900/50 px-3 py-4 text-sm text-zinc-500">
          {t("profile.animationLayersEmpty", "Aucun calque anime pour ce cadre.")}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {layers.map((layer, index) => (
            <div key={`${layer.id || "layer"}-${index}`} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
              {(() => {
                const uploadState = getUploadState(index);
                const canDuplicateUrl = Boolean(
                  layer.url &&
                    layers.some((candidate, candidateIndex) => candidateIndex !== index && Boolean(candidate?.flipX) !== Boolean(layer.flipX)),
                );
                return (
                  <>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-zinc-100">{layer.label || layer.id || `Calque ${index + 1}`}</div>
                  <div className="text-xs text-zinc-500">WebP · pointer-events: none</div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-lg border-red-400/25 bg-red-500/10 px-3 text-red-100 hover:bg-red-500/20"
                  onClick={() => removeLayer(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <LayerTextInput
                  label="ID"
                  value={layer.id}
                  placeholder="firework_left"
                  onChange={(value) => onMetadataChange((current) => updateAnimationLayer(current, index, { id: value }))}
                />
                <LayerTextInput
                  label="Label"
                  value={layer.label}
                  placeholder="Feu gauche"
                  onChange={(value) => onMetadataChange((current) => updateAnimationLayer(current, index, { label: value }))}
                />
              </div>
              <div className="mt-3">
                <LayerTextInput
                  label="URL WebP"
                  value={layer.url}
                  placeholder={ANIMATION_LAYER_URL_PLACEHOLDER}
                  onChange={(value) => onMetadataChange((current) => updateAnimationLayer(current, index, { url: value }))}
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    ref={(node) => {
                      if (node) effectInputRefs.current.set(index, node);
                      else effectInputRefs.current.delete(index);
                    }}
                    type="file"
                    accept="image/webp"
                    className="hidden"
                    onChange={(event) => {
                      selectEffectFile(index, event.target.files?.[0] || null);
                      event.target.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-lg border-zinc-700 bg-zinc-950 text-zinc-100 hover:bg-zinc-800"
                    onClick={() => effectInputRefs.current.get(index)?.click()}
                    disabled={uploadState.status === "uploading"}
                  >
                    <UploadCloud className="mr-2 h-4 w-4" />
                    {uploadState.file
                      ? t("profile.animationLayerUploadChange", "Changer le WebP")
                      : t("profile.animationLayerUploadSelect", "Importer un WebP anime")}
                  </Button>
                  {uploadState.file ? (
                    <Button
                      type="button"
                      className="rounded-lg bg-cyan-500 text-zinc-950 hover:bg-cyan-400"
                      onClick={() => void uploadSelectedEffect(index)}
                      disabled={uploadState.status === "uploading"}
                    >
                      {uploadState.status === "uploading" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                      {t("profile.animationLayerUploadAction", "Importer")}
                    </Button>
                  ) : null}
                  {canDuplicateUrl ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-lg border-zinc-700 bg-zinc-950 text-zinc-100 hover:bg-zinc-800"
                      onClick={() => duplicateLayerUrl(index)}
                    >
                      {t("profile.animationLayerDuplicateUrl", "Dupliquer l'URL")}
                    </Button>
                  ) : null}
                </div>
                {uploadState.name ? (
                  <div className="mt-2 text-xs text-zinc-500">
                    {uploadState.name} · {formatBytes(uploadState.size)}
                  </div>
                ) : null}
                {uploadState.status === "published" && uploadState.url ? (
                  <div className="mt-2 truncate rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">
                    {uploadState.url}
                  </div>
                ) : null}
                {uploadState.error ? (
                  <div className="mt-2 rounded-lg border border-red-400/25 bg-red-400/10 px-3 py-2 text-xs text-red-100">
                    {uploadState.error}
                  </div>
                ) : null}
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-4">
                <GeometryInput
                  label="X"
                  step={0.5}
                  value={layer.x}
                  onChange={(value) => onMetadataChange((current) => updateAnimationLayer(current, index, { x: value }))}
                />
                <GeometryInput
                  label="Y"
                  step={0.5}
                  value={layer.y}
                  onChange={(value) => onMetadataChange((current) => updateAnimationLayer(current, index, { y: value }))}
                />
                <GeometryInput
                  label="Largeur"
                  min={1}
                  step={0.5}
                  value={layer.width}
                  onChange={(value) => onMetadataChange((current) => updateAnimationLayer(current, index, { width: value }))}
                />
                <GeometryInput
                  label="Hauteur"
                  min={1}
                  step={0.5}
                  value={layer.height}
                  onChange={(value) => onMetadataChange((current) => updateAnimationLayer(current, index, { height: value }))}
                />
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-5">
                <LayerNumberInput
                  label="Rotation"
                  min={-360}
                  max={360}
                  value={layer.rotation}
                  onChange={(value) => onMetadataChange((current) => updateAnimationLayer(current, index, { rotation: value }))}
                />
                <GeometryInput
                  label="Opacite"
                  step={1}
                  value={layer.opacity}
                  onChange={(value) => onMetadataChange((current) => updateAnimationLayer(current, index, { opacity: value }))}
                />
                <LayerNumberInput
                  label="Z"
                  min={-20}
                  max={80}
                  value={layer.zIndex}
                  onChange={(value) => onMetadataChange((current) => updateAnimationLayer(current, index, { zIndex: Math.round(value) }))}
                />
                <LayerNumberInput
                  label="Delai ms"
                  min={0}
                  max={60000}
                  value={layer.delayMs}
                  onChange={(value) => onMetadataChange((current) => updateAnimationLayer(current, index, { delayMs: Math.round(value) }))}
                />
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Fusion</span>
                  <select
                    value={layer.blendMode || "normal"}
                    onChange={(event) => onMetadataChange((current) => updateAnimationLayer(current, index, { blendMode: event.target.value }))}
                    className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-cyan-400"
                  >
                    {ANIMATION_LAYER_BLEND_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="mt-3 inline-flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={Boolean(layer.flipX)}
                  onChange={(event) => onMetadataChange((current) => updateAnimationLayer(current, index, { flipX: event.target.checked }))}
                  className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-cyan-400"
                />
                {t("profile.animationLayerFlipX", "Miroir horizontal")}
              </label>
                  </>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
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
  const accessTitle = asset?.access?.title || asset?.access?.description || asset?.displayName || "";
  return (
    <button
      type="button"
      aria-disabled={locked ? "true" : "false"}
      onClick={onClick}
      className={`relative rounded-lg border bg-zinc-950 p-3 text-left transition ${
        selected
          ? "border-cyan-300/70 shadow-[0_0_0_2px_rgba(103,232,249,0.18)]"
          : "border-zinc-800 hover:border-zinc-600"
      } ${locked ? "border-zinc-800/80" : ""}`}
      title={accessTitle}
    >
      <div className={`flex items-center justify-center transition ${locked ? "opacity-45 grayscale" : ""}`}>
        {children}
      </div>
      <div className="mt-3 flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-zinc-100">{asset?.displayName || ""}</span>
        {locked ? <Lock className="h-4 w-4 shrink-0 text-zinc-500" /> : null}
      </div>
      {locked ? (
        <span className="mt-2 block truncate text-xs text-amber-200/80">{accessTitle}</span>
      ) : null}
    </button>
  );
}

function AdminTabButton({ active, icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
        active
          ? "border-purple-300/60 bg-purple-400/15 text-purple-100"
          : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-600 hover:text-zinc-100"
      }`}
    >
      {React.createElement(icon, { className: "h-4 w-4" })}
      {label}
    </button>
  );
}

function AdminAccessBadge({ rule, adminState, t, language }) {
  const badge = getProfileCosmeticAdminAccessBadge(rule, adminState?.tiers || [], language);
  return (
    <Badge className={`mt-2 rounded-full border ${getAdminBadgeClass(badge.tone)}`}>
      {getAdminBadgeLabel(rule, adminState?.tiers || [], t, language)}
    </Badge>
  );
}

function AdminCollectionsPanel({ catalog, adminState, t, language }) {
  const sortedAvatars = useMemo(() => sortProfileCosmeticAssetsNatural(catalog.avatars || [], "fr"), [catalog.avatars]);
  const sortedFrames = useMemo(() => sortProfileCosmeticAssetsNatural(catalog.frames || [], "fr"), [catalog.frames]);
  const renderAsset = (asset) => {
    const rule = getAccessRuleForAsset(adminState, asset.id);
    const tier = rule.tierId ? (adminState?.tiers || []).find((item) => String(item.id) === String(rule.tierId)) : null;
    return (
      <div key={`admin-asset-${asset.id}`} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
        <div className="flex items-center gap-3">
          <ProfileAvatar
            avatar={asset.assetType === "avatar" ? asset : (catalog.avatars || [])[0] || null}
            frame={asset.assetType === "frame" ? asset : null}
            name={asset.displayName}
            size={58}
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-zinc-100">{asset.displayName}</div>
            <div className="text-xs uppercase tracking-[0.14em] text-zinc-500">{asset.assetType}</div>
            <AdminAccessBadge rule={rule} adminState={adminState} t={t} language={language} />
            {tier?.displayName ? <div className="mt-2 truncate text-xs text-zinc-400">{tier.displayName}</div> : null}
            {rule.publicUnlockTitle ? <div className="mt-1 truncate text-xs font-semibold text-zinc-200">{rule.publicUnlockTitle}</div> : null}
            {rule.publicUnlockDescription ? <div className="mt-1 line-clamp-2 text-xs text-zinc-500">{rule.publicUnlockDescription}</div> : null}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {!adminState?.accessSchemaReady ? (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
          {t("profile.accessSchemaMissing", "Installe scripts/profile_cosmetics_access.sql pour gerer les classifications.")}
        </div>
      ) : null}
      <div>
        <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500">{t("profile.avatars", "Avatars")}</h4>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{sortedAvatars.map(renderAsset)}</div>
      </div>
      <div>
        <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500">{t("profile.frames", "Cadres")}</h4>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{sortedFrames.map(renderAsset)}</div>
      </div>
    </div>
  );
}

function AdminClassificationPanel({ apiBase, catalog, adminState, refreshAdminState, t, language, onMessage, onError, onCosmeticsChanged }) {
  const [tierDraft, setTierDraft] = useState({
    tierType: "support_total",
    thresholdEuros: 50,
    thresholdValue: 1,
    displayName: "",
    publicDescription: "",
    sortOrder: 0,
  });
  const [selectedAssetType, setSelectedAssetType] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const sortedAvatars = useMemo(() => sortProfileCosmeticAssetsNatural(catalog.avatars || [], "fr"), [catalog.avatars]);
  const sortedFrames = useMemo(() => sortProfileCosmeticAssetsNatural(catalog.frames || [], "fr"), [catalog.frames]);
  const assetOptions =
    selectedAssetType === PROFILE_COSMETIC_AVATAR
      ? sortedAvatars
      : selectedAssetType === PROFILE_COSMETIC_FRAME
        ? sortedFrames
        : [];
  const selectedAsset = (assetOptions || []).find((asset) => String(asset.id) === String(selectedAssetId)) || null;
  const [ruleDraft, setRuleDraft] = useState(() => buildProfileCosmeticRuleDraft({}, adminState?.tiers || []));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selectedAssetId) {
      setRuleDraft(buildProfileCosmeticRuleDraft({}, adminState?.tiers || []));
      return;
    }
    setRuleDraft(getRuleDraftForAsset(adminState, selectedAssetId));
  }, [adminState, selectedAssetId]);

  const tierOptions = useMemo(
    () => filterTiersByUiMode(adminState?.tiers || [], ruleDraft.uiMode),
    [adminState?.tiers, ruleDraft.uiMode],
  );
  const needsTier =
    ruleDraft.uiMode === PROFILE_COSMETIC_UI_ACCESS_SUPPORT_TOTAL ||
    ruleDraft.uiMode === PROFILE_COSMETIC_UI_ACCESS_MONTHLY_LOYALTY;
  const canSaveRule =
    Boolean(adminState?.accessSchemaReady && selectedAsset) &&
    (!needsTier || Boolean(ruleDraft.tierId)) &&
    (ruleDraft.uiMode !== PROFILE_COSMETIC_UI_ACCESS_MANUAL || Boolean(String(ruleDraft.publicUnlockTitle || "").trim()));
  const previewAvatar =
    selectedAsset?.assetType === PROFILE_COSMETIC_AVATAR
      ? selectedAsset
      : (catalog.avatars || []).find((avatar) => getAssetUrl(avatar)) || null;
  const previewFrame = selectedAsset?.assetType === PROFILE_COSMETIC_FRAME ? selectedAsset : null;

  async function postAdmin(body) {
    const response = await fetch(`${apiBase}/api/portal-cosmetics-admin`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || t("profile.adminSaveError", "Sauvegarde admin impossible."));
    return payload;
  }

  async function saveTier() {
    setSaving(true);
    onError("");
    onMessage("");
    try {
      await postAdmin({ action: "upsert-tier", ...tierDraft });
      await refreshAdminState();
      await onCosmeticsChanged?.();
      onMessage(t("profile.tierSaved", "Palier enregistre."));
      setTierDraft({ ...tierDraft, displayName: "", publicDescription: "" });
    } catch (error) {
      onError(error?.message || t("profile.tierSaveError", "Palier impossible a enregistrer."));
    } finally {
      setSaving(false);
    }
  }

  async function deleteTier(tierId) {
    if (!window.confirm(t("profile.deleteTierConfirm", "Supprimer ce palier ?"))) return;
    setSaving(true);
    onError("");
    onMessage("");
    try {
      await postAdmin({ action: "delete-tier", tierId });
      await refreshAdminState();
      await onCosmeticsChanged?.();
      onMessage(t("profile.tierDeleted", "Palier supprime."));
    } catch (error) {
      onError(error?.message || t("profile.tierDeleteError", "Suppression du palier impossible."));
    } finally {
      setSaving(false);
    }
  }

  async function saveRule() {
    if (!selectedAsset) return;
    setSaving(true);
    onError("");
    onMessage("");
    try {
      const payload = buildProfileCosmeticAccessRulePayload({
        assetId: selectedAsset.id,
        uiMode: ruleDraft.uiMode,
        tierId: ruleDraft.tierId,
        publicUnlockTitle: ruleDraft.publicUnlockTitle,
        publicUnlockDescription: ruleDraft.publicUnlockDescription,
        tiers: adminState?.tiers || [],
      });
      await postAdmin({
        action: "set-access-rule",
        ...payload,
      });
      await refreshAdminState();
      await onCosmeticsChanged?.();
      onMessage(t("profile.ruleSaved", "Classification enregistree."));
    } catch (error) {
      onError(error?.message || t("profile.ruleSaveError", "Classification impossible a enregistrer."));
    } finally {
      setSaving(false);
    }
  }

  function handleAssetTypeChange(nextType) {
    setSelectedAssetType(nextType);
    setSelectedAssetId("");
    setRuleDraft(buildProfileCosmeticRuleDraft({}, adminState?.tiers || []));
  }

  function handleUiModeChange(nextMode) {
    setRuleDraft((current) => ({
      ...current,
      uiMode: nextMode,
      accessType:
        nextMode === PROFILE_COSMETIC_UI_ACCESS_BASIC
          ? "basic"
          : nextMode === PROFILE_COSMETIC_UI_ACCESS_MANUAL
            ? "manual"
            : "tier",
      tierId: "",
    }));
  }

  return (
    <div className="space-y-5">
      {!adminState?.accessSchemaReady ? (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
          {t("profile.accessSchemaMissing", "Installe scripts/profile_cosmetics_access.sql pour gerer les classifications.")}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Coins className="h-4 w-4 text-emerald-300" />
            {t("profile.tiersTitle", "Paliers")}
          </div>
          <div className="mt-4 grid gap-3">
            <select
              value={tierDraft.tierType}
              onChange={(event) => setTierDraft((current) => ({ ...current, tierType: event.target.value }))}
              className="h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
            >
              <option value="support_total">{t("profile.tierSupportTotal", "Soutien cumule")}</option>
              <option value="monthly_loyalty">{t("profile.tierMonthlyLoyalty", "Fidelite mensuelle")}</option>
            </select>
            <input
              value={tierDraft.displayName}
              onChange={(event) => setTierDraft((current) => ({ ...current, displayName: event.target.value }))}
              className="h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
              placeholder={t("profile.tierName", "Nom du palier")}
            />
            {tierDraft.tierType === "support_total" ? (
              <input
                type="number"
                min="1"
                value={tierDraft.thresholdEuros}
                onChange={(event) => setTierDraft((current) => ({ ...current, thresholdEuros: event.target.value }))}
                className="h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
                placeholder={t("profile.thresholdEuros", "Seuil en euros")}
              />
            ) : (
              <input
                type="number"
                min="1"
                value={tierDraft.thresholdValue}
                onChange={(event) => setTierDraft((current) => ({ ...current, thresholdValue: event.target.value }))}
                className="h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
                placeholder={t("profile.thresholdMonths", "Nombre de mensualites")}
              />
            )}
            <textarea
              value={tierDraft.publicDescription}
              onChange={(event) => setTierDraft((current) => ({ ...current, publicDescription: event.target.value }))}
              className="min-h-20 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              placeholder={t("profile.publicDescription", "Description publique")}
            />
            <Button type="button" onClick={saveTier} disabled={saving || !adminState?.accessSchemaReady} className="rounded-lg bg-emerald-500 text-zinc-950 hover:bg-emerald-400">
              <Save className="h-4 w-4" />
              {t("profile.tierCreate", "Enregistrer le palier")}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Sparkles className="h-4 w-4 text-purple-300" />
            {t("profile.assetRulesTitle", "Classification des cosmetiques")}
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <select
              value={selectedAssetType}
              onChange={(event) => handleAssetTypeChange(event.target.value)}
              className="h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
            >
              <option value="">{t("profile.selectCosmeticType", "Selectionne un type")}</option>
              <option value={PROFILE_COSMETIC_AVATAR}>{t("profile.avatar", "Avatar")}</option>
              <option value={PROFILE_COSMETIC_FRAME}>{t("profile.frame", "Cadre")}</option>
            </select>
            <select
              value={selectedAssetId}
              onChange={(event) => setSelectedAssetId(event.target.value)}
              disabled={!selectedAssetType}
              className="h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
            >
              <option value="">
                {selectedAssetType === PROFILE_COSMETIC_AVATAR
                  ? t("profile.selectAvatar", "Selectionne un avatar")
                  : selectedAssetType === PROFILE_COSMETIC_FRAME
                    ? t("profile.selectFrame", "Selectionne un cadre")
                    : t("profile.chooseCosmeticTypeHelp", "Choisis d'abord Avatar ou Cadre")}
              </option>
              {assetOptions.map((asset) => (
                <option key={`rule-asset-${asset.id}`} value={asset.id}>
                  {asset.displayName}
                </option>
              ))}
            </select>
          </div>

          {!selectedAsset ? (
            <div className="mt-4 rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-500">
              {selectedAssetType
                ? t("profile.chooseCosmeticHelp", "Selectionne un cosmetique pour modifier sa classification.")
                : t("profile.chooseCosmeticTypeHelp", "Choisis d'abord Avatar ou Cadre")}
            </div>
          ) : (
            <div className="mt-4 grid gap-4 xl:grid-cols-[220px_1fr]">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-center">
                <div className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">
                  {t("profile.classificationPreview", "Apercu")}
                </div>
                <div className="mt-4 flex justify-center">
                  <ProfileAvatar avatar={previewAvatar} frame={previewFrame} name={selectedAsset.displayName} size={118} />
                </div>
                <div className="mt-3 text-sm font-semibold text-zinc-100">{selectedAsset.displayName}</div>
                <div className="mt-1 text-xs uppercase tracking-[0.14em] text-zinc-500">{selectedAsset.assetType}</div>
              </div>
              <div className="grid gap-3">
                <select
                  value={ruleDraft.uiMode || PROFILE_COSMETIC_UI_ACCESS_BASIC}
                  onChange={(event) => handleUiModeChange(event.target.value)}
                  className="h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
                >
                  <option value={PROFILE_COSMETIC_UI_ACCESS_BASIC}>{t("profile.accessBasic", "Accessible a tous")}</option>
                  <option value={PROFILE_COSMETIC_UI_ACCESS_SUPPORT_TOTAL}>
                    {t("profile.accessSupportTier", "Palier de soutien cumule")}
                  </option>
                  <option value={PROFILE_COSMETIC_UI_ACCESS_MONTHLY_LOYALTY}>
                    {t("profile.accessMonthlyTier", "Palier de fidelite mensuelle")}
                  </option>
                  <option value={PROFILE_COSMETIC_UI_ACCESS_MANUAL}>{t("profile.accessManual", "Recompense speciale")}</option>
                </select>
                {needsTier ? (
                  <>
                    <select
                      value={ruleDraft.tierId || ""}
                      onChange={(event) => setRuleDraft((current) => ({ ...current, tierId: event.target.value }))}
                      className="h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
                    >
                      <option value="">{t("profile.noTier", "Aucun palier")}</option>
                      {tierOptions.map((tier) => (
                        <option key={`tier-option-${tier.id}`} value={tier.id}>
                          {tier.displayName} - {getTierThresholdLabel(tier, language, t)}
                        </option>
                      ))}
                    </select>
                    {!tierOptions.length ? (
                      <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
                        {t("profile.noTierForMode", "Aucun palier de ce type. Cree d'abord le palier dans le panneau Paliers.")}
                      </div>
                    ) : null}
                  </>
                ) : null}
                <input
                  value={ruleDraft.publicUnlockTitle || ""}
                  onChange={(event) => setRuleDraft((current) => ({ ...current, publicUnlockTitle: event.target.value }))}
                  className="h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
                  placeholder={t("profile.unlockTitlePlaceholder", "Titre public d'obtention")}
                />
                <textarea
                  value={ruleDraft.publicUnlockDescription || ""}
                  onChange={(event) => setRuleDraft((current) => ({ ...current, publicUnlockDescription: event.target.value }))}
                  className="min-h-20 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                  placeholder={t("profile.unlockDescriptionPlaceholder", "Description publique facultative")}
                />
                {ruleDraft.uiMode === PROFILE_COSMETIC_UI_ACCESS_MANUAL && !String(ruleDraft.publicUnlockTitle || "").trim() ? (
                  <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
                    {t("profile.manualTitleRequired", "Un titre public est requis pour une recompense speciale.")}
                  </div>
                ) : null}
                <Button type="button" onClick={saveRule} disabled={saving || !canSaveRule} className="rounded-lg bg-purple-500 text-zinc-950 hover:bg-purple-400">
                  <Save className="h-4 w-4" />
                  {t("profile.ruleSave", "Enregistrer la classification")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {(adminState?.tiers || []).map((tier) => (
          <div key={`tier-${tier.id}`} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-zinc-100">{tier.displayName}</div>
                <div className="text-sm text-zinc-500">
                  {tier.tierType === "support_total" ? formatCurrency(tier.thresholdValue, language) : `${tier.thresholdValue} ${t("profile.months", "mois")}`}
                </div>
              </div>
              <Button type="button" variant="ghost" size="sm" className="text-red-200 hover:text-red-100" onClick={() => deleteTier(tier.id)}>
                {t("common.delete", "Supprimer")}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminGrantsPanel({ apiBase, catalog, t, onMessage, onError, onCosmeticsChanged }) {
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState([]);
  const [selectedMember, setSelectedMember] = useState(null);
  const [assetId, setAssetId] = useState(catalog.assets?.[0]?.id || "");
  const [grantTitle, setGrantTitle] = useState("");
  const [grantDescription, setGrantDescription] = useState("");
  const [grants, setGrants] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setAssetId((current) => current || catalog.assets?.[0]?.id || "");
  }, [catalog.assets]);

  async function fetchAdmin(path, options = {}) {
    const response = await fetch(`${apiBase}/api/portal-cosmetics-admin${path}`, {
      credentials: "include",
      ...options,
      headers: {
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || t("profile.adminLoadError", "Chargement admin impossible."));
    return payload;
  }

  async function searchMembers() {
    if (query.trim().length < 2) return;
    setLoading(true);
    onError("");
    try {
      const payload = await fetchAdmin(`?action=search-members&q=${encodeURIComponent(query.trim())}`);
      setMembers(payload.members || []);
    } catch (error) {
      onError(error?.message || t("profile.memberSearchError", "Recherche joueur impossible."));
    } finally {
      setLoading(false);
    }
  }

  async function loadGrants(member) {
    setSelectedMember(member);
    setLoading(true);
    onError("");
    try {
      const payload = await fetchAdmin(`?action=member-grants&memberId=${encodeURIComponent(member.id)}`);
      setGrants(payload.grants || []);
    } catch (error) {
      onError(error?.message || t("profile.memberGrantsError", "Chargement des attributions impossible."));
    } finally {
      setLoading(false);
    }
  }

  async function grantCosmetic() {
    if (!selectedMember || !assetId || !grantTitle.trim()) return;
    setLoading(true);
    onError("");
    onMessage("");
    try {
      await fetchAdmin("", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "grant-cosmetic",
          memberId: selectedMember.id,
          assetId,
          grantTitle,
          grantDescription,
        }),
      });
      await loadGrants(selectedMember);
      await onCosmeticsChanged?.();
      setGrantTitle("");
      setGrantDescription("");
      onMessage(t("profile.grantSaved", "Attribution enregistree."));
    } catch (error) {
      onError(error?.message || t("profile.grantError", "Attribution impossible."));
    } finally {
      setLoading(false);
    }
  }

  async function revokeGrant(grant) {
    if (!window.confirm(t("profile.revokeConfirm", "Revoquer cette attribution ?"))) return;
    setLoading(true);
    onError("");
    onMessage("");
    try {
      await fetchAdmin("", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke-grant", grantId: grant.id }),
      });
      if (selectedMember) await loadGrants(selectedMember);
      await onCosmeticsChanged?.();
      onMessage(t("profile.grantRevoked", "Attribution revoquee."));
    } catch (error) {
      onError(error?.message || t("profile.revokeError", "Revocation impossible."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Search className="h-4 w-4 text-cyan-300" />
          {t("profile.memberSearch", "Recherche joueur")}
        </div>
        <div className="mt-4 flex gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void searchMembers();
            }}
            className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            placeholder={t("profile.memberSearchPlaceholder", "Nom ou Discord ID")}
          />
          <Button type="button" variant="outline" onClick={searchMembers} disabled={loading} className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100">
            <Search className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-4 space-y-2">
          {members.map((member) => (
            <button
              type="button"
              key={`grant-member-${member.id}`}
              onClick={() => loadGrants(member)}
              className={`w-full rounded-lg border p-3 text-left text-sm transition ${
                selectedMember?.id === member.id
                  ? "border-cyan-300/60 bg-cyan-400/10 text-cyan-50"
                  : "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600"
              }`}
            >
              <div className="font-semibold">{member.watcherName}</div>
              <div className="text-xs text-zinc-500">{member.guildCode || t("common.community", "Communaute")} · {member.role || "-"}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Gift className="h-4 w-4 text-purple-300" />
          {t("profile.manualGrantTitle", "Attribution manuelle")}
        </div>
        <div className="mt-2 text-sm text-zinc-500">
          {selectedMember ? selectedMember.watcherName : t("profile.selectMemberFirst", "Selectionne un joueur d'abord.")}
        </div>
        <div className="mt-4 grid gap-3">
          <select
            value={assetId}
            onChange={(event) => setAssetId(event.target.value)}
            className="h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
          >
            {(catalog.assets || []).map((asset) => (
              <option key={`grant-asset-${asset.id}`} value={asset.id}>
                {asset.displayName}
              </option>
            ))}
          </select>
          <input
            value={grantTitle}
            onChange={(event) => setGrantTitle(event.target.value)}
            className="h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
            placeholder={t("profile.grantTitlePlaceholder", "Top soutien - Saison 13")}
          />
          <textarea
            value={grantDescription}
            onChange={(event) => setGrantDescription(event.target.value)}
            className="min-h-20 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            placeholder={t("profile.grantDescription", "Description facultative")}
          />
          <Button type="button" onClick={grantCosmetic} disabled={loading || !selectedMember || !assetId || !grantTitle.trim()} className="rounded-lg bg-purple-500 text-zinc-950 hover:bg-purple-400">
            <Award className="h-4 w-4" />
            {t("profile.grantAction", "Attribuer")}
          </Button>
        </div>

        <div className="mt-5 space-y-2">
          {grants.length ? (
            grants.map((grant) => (
              <div key={`grant-${grant.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-zinc-100">{grant.grantTitle}</div>
                  <div className="truncate text-xs text-zinc-500">{grant.asset?.displayName || grant.assetId}</div>
                </div>
                {grant.revokedAt ? (
                  <Badge className="border border-zinc-700 bg-zinc-800 text-zinc-400">{t("profile.revoked", "Revoquee")}</Badge>
                ) : (
                  <Button type="button" variant="ghost" size="sm" onClick={() => revokeGrant(grant)} className="text-red-200 hover:text-red-100">
                    {t("profile.revoke", "Revoquer")}
                  </Button>
                )}
              </div>
            ))
          ) : (
            <p className="rounded-lg border border-dashed border-zinc-800 p-4 text-sm text-zinc-500">
              {t("profile.noGrants", "Aucune attribution pour ce joueur.")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProfileCosmeticsTab({
  session,
  cosmeticsState,
  loading = false,
  onCosmeticsStateChange,
  onCosmeticsChanged,
  adminMode = false,
}) {
  const { t, language } = usePortalLanguage();
  const apiBase = useMemo(() => getApiBase(), []);
  const catalog = cosmeticsState?.catalog || {};
  const selection = cosmeticsState?.selection || {};
  const progress = cosmeticsState?.progress || {};
  const assetsById = useMemo(() => buildAssetMap(catalog.assets), [catalog.assets]);
  const canManageCosmetics = adminMode && isLeaderSession(session);
  const isLeader = isLeaderSession(session);
  const [draftAvatarId, setDraftAvatarId] = useState("");
  const [draftFrameId, setDraftFrameId] = useState("");
  const [inspectedAssetId, setInspectedAssetId] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingFrameMetadata, setSavingFrameMetadata] = useState(false);
  const [detectingFrameMetadata, setDetectingFrameMetadata] = useState(false);
  const [studioAvatarId, setStudioAvatarId] = useState("");
  const [frameMetadataDraft, setFrameMetadataDraft] = useState(null);
  const [adminTab, setAdminTab] = useState("collections");
  const [adminState, setAdminState] = useState(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    setDraftAvatarId(normalizeCosmeticId(selection.selectedAvatarId));
    setDraftFrameId(normalizeCosmeticId(selection.selectedFrameId));
    setInspectedAssetId("");
    setMessage("");
    setErrorMessage("");
  }, [selection.selectedAvatarId, selection.selectedFrameId]);

  const draftAvatar = draftAvatarId ? assetsById.get(draftAvatarId) || null : null;
  const studioAvatar = studioAvatarId ? assetsById.get(studioAvatarId) || null : null;
  const inspectedAsset = inspectedAssetId ? assetsById.get(inspectedAssetId) || null : null;
  const catalogPreviewAvatar = useMemo(
    () => (catalog.avatars || []).find((avatar) => getAssetUrl(avatar)) || null,
    [catalog.avatars],
  );
  const previewAvatar =
    inspectedAsset?.assetType === "avatar"
      ? inspectedAsset
      : draftAvatar || (inspectedAsset?.assetType === "frame" || canManageCosmetics ? studioAvatar || catalogPreviewAvatar : null);
  const framePreviewAvatar = previewAvatar || catalogPreviewAvatar;
  const studioPreviewAvatar = studioAvatar || previewAvatar || catalogPreviewAvatar;
  const draftFrame = draftFrameId && draftAvatar ? assetsById.get(draftFrameId) || null : null;
  const previewFrame = inspectedAsset?.assetType === "frame" ? inspectedAsset : draftFrame;
  const frameWithDraftMetadata = draftFrame && frameMetadataDraft ? { ...draftFrame, metadata: frameMetadataDraft } : draftFrame;
  const frameForMainPreview =
    previewFrame && frameMetadataDraft && draftFrame?.id === previewFrame.id ? frameWithDraftMetadata : previewFrame;
  const previewAccessAsset = inspectedAsset || previewFrame || previewAvatar;
  const previewAccessProgress = formatAccessProgress(previewAccessAsset, t, language);
  const progressTiers = progress?.tiers || [];
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

  async function refreshAdminState() {
    if (!canManageCosmetics) return null;
    setAdminLoading(true);
    try {
      const response = await fetch(`${apiBase}/api/portal-cosmetics-admin`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || t("profile.adminLoadError", "Chargement admin impossible."));
      }
      setAdminState(payload);
      return payload;
    } catch (error) {
      setErrorMessage(error?.message || t("profile.adminLoadError", "Chargement admin impossible."));
      return null;
    } finally {
      setAdminLoading(false);
    }
  }

  useEffect(() => {
    if (canManageCosmetics) {
      void refreshAdminState();
    }
  }, [canManageCosmetics]);

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
      await onCosmeticsChanged?.();
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
      const response = await fetch(`${apiBase}/api/portal-cosmetics-admin`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-frame-render-metadata",
          assetId: draftFrame.id,
          metadata: frameMetadataDraft,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || t("profile.frameMetadataSaveError", "Reglage du cadre impossible."));
      }
      onCosmeticsStateChange?.(payload);
      await onCosmeticsChanged?.();
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

  if (adminMode && !isLeader) {
    return (
      <section className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-5 text-sm text-amber-100">
        <div className="flex items-center gap-3">
          <Lock className="h-5 w-5" />
          <div>
            <div className="font-semibold">{t("profile.leaderOnlyAdmin", "Administration cosmetiques reservee au leader.")}</div>
            <p className="mt-1 text-amber-100/80">
              {t("rolePreview.notice", "Seule l'interface est simulee. Les permissions serveur restent celles du compte reel.")}
            </p>
          </div>
        </div>
      </section>
    );
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
        {!loading && cosmeticsState?.schemaReady !== false && cosmeticsState?.accessSchemaReady === false ? (
          <div className="mt-5 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
            {t("profile.accessSchemaMissing", "Installe scripts/profile_cosmetics_access.sql pour gerer les classifications.")}
          </div>
        ) : null}
        {message ? <div className="mt-5 rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-100">{message}</div> : null}
        {errorMessage ? <div className="mt-5 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">{errorMessage}</div> : null}
      </div>

      {!adminMode && progressTiers.length ? (
        <div className="rounded-lg border border-emerald-400/20 bg-emerald-950/10 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
                {t("profile.progressTitle", "Progression")}
              </p>
              <p className="mt-1 text-sm text-zinc-400">
                {t("profile.progressHelp", "Tes soutiens confirmes debloquent automatiquement les paliers eligibles.")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge className="border border-emerald-400/30 bg-emerald-400/10 text-emerald-100">
                <Coins className="mr-1.5 h-3.5 w-3.5" />
                {formatCurrency(progress.supportTotalCents || 0, language)}
              </Badge>
              <Badge className="border border-purple-400/30 bg-purple-400/10 text-purple-100">
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                {t("profile.monthlyProgress", "{current} / {target} mensualites")
                  .replace("{current}", progress.monthlyConfirmedCount || 0)
                  .replace("{target}", progress.nextMonthlyTier?.thresholdValue || progress.monthlyConfirmedCount || 0)}
              </Badge>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
            {t("profile.preview", "Apercu")}
          </p>
          <div className="mt-5 flex flex-col items-center text-center">
            <ProfileAvatar avatar={previewAvatar} frame={frameForMainPreview} name={displayName} size={220} />
            <div className="mt-4 text-lg font-semibold text-zinc-50">{displayName}</div>
            <p className="mt-1 text-sm text-zinc-500">
              {previewAvatar ? previewAvatar.displayName : t("profile.noAvatarSelected", "Aucun avatar selectionne")}
            </p>
            {frameForMainPreview ? (
              <Badge className="mt-3 rounded-full border-cyan-400/30 bg-cyan-400/10 text-cyan-100">
                {frameForMainPreview.displayName}
              </Badge>
            ) : null}
            {previewAccessAsset ? (
              <div className="mt-4 w-full rounded-lg border border-zinc-800 bg-zinc-900/55 p-3 text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={`rounded-full border ${getAccessBadgeClass(previewAccessAsset)}`}>
                    {previewAccessAsset.locked ? t("profile.locked", "Verrouille") : t("profile.unlocked", "Debloque")}
                  </Badge>
                  <span className="text-sm font-semibold text-zinc-100">{previewAccessAsset.displayName}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-zinc-400">
                  {formatAccessType(previewAccessAsset, t, language)}
                </p>
                {previewAccessAsset.access?.description ? (
                  <p className="mt-1 text-xs leading-5 text-zinc-500">{previewAccessAsset.access.description}</p>
                ) : null}
                {previewAccessProgress ? (
                  <p className="mt-2 text-xs font-semibold text-cyan-200">{previewAccessProgress}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
                  {t("profile.catalog", "Catalogue")}
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
                    if (avatar.locked) {
                      setInspectedAssetId(String(avatar.id));
                      return;
                    }
                    setInspectedAssetId("");
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
                  {t("profile.catalog", "Catalogue")}
                </p>
                <h3 className="mt-1 text-xl font-semibold text-zinc-50">{t("profile.frames", "Cadres")}</h3>
              </div>
              <span className="text-xs text-zinc-500">{catalog.frames?.length || 0}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <button
                type="button"
                onClick={() => {
                  setInspectedAssetId("");
                  setDraftFrameId("");
                }}
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
                    if (frame.locked || !draftAvatar) {
                      setInspectedAssetId(String(frame.id));
                      return;
                    }
                    setInspectedAssetId("");
                    setDraftFrameId(String(frame.id));
                    setErrorMessage("");
                  }}
                >
                  <ProfileAvatar avatar={framePreviewAvatar} frame={frame} name={displayName} size={88} />
                </CosmeticChoice>
              ))}
            </div>
          </div>

          {canManageCosmetics ? (
            <div className="rounded-lg border border-purple-400/20 bg-purple-950/10 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-purple-300">
                    {t("profile.adminEyebrow", "Administration leader")}
                  </p>
                  <h3 className="mt-1 text-xl font-semibold text-zinc-50">
                    {t("profile.cosmeticsStudio", "Cosmetiques")}
                  </h3>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={refreshAdminState}
                  disabled={adminLoading}
                  className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                >
                  <RefreshCw className={`h-4 w-4 ${adminLoading ? "animate-spin" : ""}`} />
                  {t("common.refresh", "Rafraichir")}
                </Button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <AdminTabButton
                  active={adminTab === "collections"}
                  icon={Award}
                  label={t("profile.adminCollections", "Collections")}
                  onClick={() => setAdminTab("collections")}
                />
                <AdminTabButton
                  active={adminTab === "studio"}
                  icon={SlidersHorizontal}
                  label={t("profile.adminStudio", "Studio")}
                  onClick={() => setAdminTab("studio")}
                />
                <AdminTabButton
                  active={adminTab === "classification"}
                  icon={Sparkles}
                  label={t("profile.adminClassification", "Classification")}
                  onClick={() => setAdminTab("classification")}
                />
                <AdminTabButton
                  active={adminTab === "grants"}
                  icon={Gift}
                  label={t("profile.adminGrants", "Attributions")}
                  onClick={() => setAdminTab("grants")}
                />
              </div>

              <div className="mt-5">
                {adminTab === "collections" ? (
                  <AdminCollectionsPanel catalog={catalog} adminState={adminState} t={t} language={language} />
                ) : null}

                {adminTab === "classification" ? (
                  <AdminClassificationPanel
                    apiBase={apiBase}
                    catalog={catalog}
                    adminState={adminState}
                    refreshAdminState={refreshAdminState}
                    t={t}
                    language={language}
                    onMessage={setMessage}
                    onError={setErrorMessage}
                    onCosmeticsChanged={onCosmeticsChanged}
                  />
                ) : null}

                {adminTab === "grants" ? (
                  <AdminGrantsPanel
                    apiBase={apiBase}
                    catalog={catalog}
                    t={t}
                    onMessage={setMessage}
                    onError={setErrorMessage}
                    onCosmeticsChanged={onCosmeticsChanged}
                  />
                ) : null}

                {adminTab === "studio" ? (
                  <>
                    <ProfileCosmeticUploadStudio
              apiBase={apiBase}
              canManageCosmetics={canManageCosmetics}
              catalog={catalog}
              previewAvatar={studioPreviewAvatar}
              t={t}
              onCosmeticsStateChange={(nextState) => {
                onCosmeticsStateChange?.(nextState);
                void onCosmeticsChanged?.();
              }}
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

                    <FrameAnimationLayersPanel
                      metadata={frameMetadataDraft}
                      onMetadataChange={setFrameMetadataDraft}
                      t={t}
                      apiBase={apiBase}
                      onMessage={setMessage}
                      onError={setErrorMessage}
                    />

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
          ) : null}
        </div>
      </div>
    </section>
  );
}
