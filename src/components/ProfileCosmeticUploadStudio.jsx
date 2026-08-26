import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ImagePlus,
  Loader2,
  RefreshCw,
  Trash2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ProfileAvatar from "@/components/ProfileAvatar";
import {
  buildFrameRenderMetadataFromImageData,
  createProfileCosmeticDisplayNameAllocator,
  getNextProfileCosmeticDisplayName,
  getProfileAvatarVideoExtension,
  normalizeFrameRenderMetadata,
  normalizeProfileAvatarVideoMimeType,
  PROFILE_AVATAR_MEDIA_VIDEO,
  PROFILE_AVATAR_VIDEO_MIME_MP4,
  PROFILE_AVATAR_VIDEO_MIME_WEBM,
  summarizeProfileCosmeticPublishBatch,
} from "@/lib/profileCosmetics";

const TARGET_COSMETIC_SIZE = 1024;
const MAX_SOURCE_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_NORMALIZED_PNG_BYTES = 2_750_000;
const MAX_AVATAR_VIDEO_BYTES = Math.floor(2.5 * 1024 * 1024);
const DEFAULT_FRAME_MARGIN = 0.04;
const FRAME_ALPHA_THRESHOLD = 8;
const AVATAR_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const AVATAR_VIDEO_TYPES = new Set([PROFILE_AVATAR_VIDEO_MIME_MP4, PROFILE_AVATAR_VIDEO_MIME_WEBM]);
const AVATAR_VIDEO_MIME_BY_EXTENSION = new Map([
  [".mp4", PROFILE_AVATAR_VIDEO_MIME_MP4],
  [".webm", PROFILE_AVATAR_VIDEO_MIME_WEBM],
]);
const AVATAR_UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp,video/mp4,video/webm,.png,.jpg,.jpeg,.webp,.mp4,.webm";

function createDraftId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cleanDisplayName(value, fallback = "Cosmetique") {
  const text = String(value || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (!text) return fallback;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function normalizeComparableName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${bytes} o`;
}

function fileLooksLikePng(file) {
  return String(file?.type || "").toLowerCase() === "image/png" || String(file?.name || "").toLowerCase().endsWith(".png");
}

function getFileExtension(file) {
  const match = String(file?.name || "")
    .toLowerCase()
    .match(/\.[a-z0-9]+$/);
  return match ? match[0] : "";
}

function fileLooksLikeAvatarImage(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  return AVATAR_IMAGE_TYPES.has(type) || /\.(png|jpe?g|webp)$/.test(name);
}

function getAvatarVideoMimeFromFile(file) {
  const mimeByType = normalizeProfileAvatarVideoMimeType(file?.type);
  const extension = getFileExtension(file);
  const mimeByExtension = AVATAR_VIDEO_MIME_BY_EXTENSION.get(extension) || "";
  if (mimeByType && !mimeByExtension) return "";
  if (mimeByType && mimeByExtension && mimeByType !== mimeByExtension) return "";
  return mimeByType || mimeByExtension;
}

function fileLooksLikeAvatarVideo(file) {
  return Boolean(getAvatarVideoMimeFromFile(file));
}

function fileLooksLikeAvatar(file) {
  return fileLooksLikeAvatarImage(file) || fileLooksLikeAvatarVideo(file);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Chargement de l'image impossible."));
    image.decoding = "async";
    image.src = dataUrl;
  });
}

function createCanvas(width = TARGET_COSMETIC_SIZE, height = TARGET_COSMETIC_SIZE) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function readFileBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

function readAscii(bytes, start, length) {
  let text = "";
  for (let index = start; index < start + length && index < bytes.length; index += 1) {
    text += String.fromCharCode(bytes[index]);
  }
  return text;
}

function bytesContainAscii(bytes, needle, limit = 4096) {
  const haystack = readAscii(bytes, 0, Math.min(bytes.length, limit));
  return haystack.includes(needle);
}

function inspectMp4Bytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) {
    throw new Error("Video MP4 invalide.");
  }
  const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  const boxType = readAscii(bytes, 4, 4);
  if (boxType !== "ftyp" || boxSize < 8 || boxSize > bytes.length) {
    throw new Error("Signature MP4 invalide.");
  }
}

function inspectWebmBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) {
    throw new Error("Video WebM invalide.");
  }
  const hasEbmlSignature = bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if (!hasEbmlSignature || !bytesContainAscii(bytes, "webm")) {
    throw new Error("Signature WebM invalide.");
  }
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("SHA-256 navigateur indisponible.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function canvasToPngPayload(canvas) {
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("Generation PNG impossible."));
    }, "image/png");
  });
  if (blob.size > MAX_NORMALIZED_PNG_BYTES) {
    throw new Error(`PNG normalise trop volumineux (${formatBytes(blob.size)}).`);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const base64 = bytesToBase64(bytes);
  return {
    pngBase64: base64,
    pngDataUrl: `data:image/png;base64,${base64}`,
    bytes: blob.size,
    sha256: await sha256Hex(bytes),
  };
}

function getImageDataFromCanvas(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Analyse image impossible.");
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function findVisibleAlphaBox(imageData) {
  const { data, width, height } = imageData;
  const box = { minX: width, minY: height, maxX: -1, maxY: -1, visible: 0, transparent: 0 };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3] || 0;
      if (alpha > FRAME_ALPHA_THRESHOLD) {
        box.minX = Math.min(box.minX, x);
        box.minY = Math.min(box.minY, y);
        box.maxX = Math.max(box.maxX, x);
        box.maxY = Math.max(box.maxY, y);
        box.visible += 1;
      } else {
        box.transparent += 1;
      }
    }
  }
  return box.visible ? box : null;
}

function buildDraftAsset(draft) {
  const url = draft?.previewUrl || draft?.pngDataUrl || draft?.videoDataUrl || "";
  if (!url) return null;
  return {
    id: draft.id,
    displayName: draft.displayName,
    assetType: draft.assetType,
    url,
    assetUrl: url,
    isActive: true,
    unlocked: true,
    locked: false,
    metadata: draft.metadata || {},
  };
}

function buildDraftNameAsset(draft) {
  return {
    assetType: draft.assetType,
    displayName: draft.displayName,
  };
}

async function normalizeFrameFile(file, settings = {}) {
  if (!fileLooksLikePng(file)) {
    throw new Error("Un cadre doit etre un PNG.");
  }
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const sourceCanvas = createCanvas(sourceWidth, sourceHeight);
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) throw new Error("Canvas navigateur indisponible.");
  sourceContext.clearRect(0, 0, sourceWidth, sourceHeight);
  sourceContext.drawImage(image, 0, 0);

  const sourceData = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight);
  const visibleBox = findVisibleAlphaBox(sourceData);
  if (!visibleBox || !visibleBox.transparent) {
    throw new Error("Un cadre doit contenir des pixels visibles et une transparence alpha.");
  }

  const cropWidth = visibleBox.maxX - visibleBox.minX + 1;
  const cropHeight = visibleBox.maxY - visibleBox.minY + 1;
  const margin = Math.min(0.16, Math.max(0, Number(settings.margin ?? DEFAULT_FRAME_MARGIN)));
  const marginPx = Math.round(TARGET_COSMETIC_SIZE * margin);
  const maxWidth = TARGET_COSMETIC_SIZE - marginPx * 2;
  const maxHeight = TARGET_COSMETIC_SIZE - marginPx * 2;
  const scale = Math.min(maxWidth / cropWidth, maxHeight / cropHeight);
  const outputWidth = Math.max(1, Math.round(cropWidth * scale));
  const outputHeight = Math.max(1, Math.round(cropHeight * scale));
  const outputX = Math.round((TARGET_COSMETIC_SIZE - outputWidth) / 2);
  const outputY = Math.round((TARGET_COSMETIC_SIZE - outputHeight) / 2);

  const outputCanvas = createCanvas();
  const outputContext = outputCanvas.getContext("2d", { willReadFrequently: true });
  if (!outputContext) throw new Error("Canvas navigateur indisponible.");
  outputContext.clearRect(0, 0, TARGET_COSMETIC_SIZE, TARGET_COSMETIC_SIZE);
  outputContext.drawImage(sourceCanvas, visibleBox.minX, visibleBox.minY, cropWidth, cropHeight, outputX, outputY, outputWidth, outputHeight);

  const outputData = getImageDataFromCanvas(outputCanvas);
  const alphaAnalysis = buildFrameRenderMetadataFromImageData(outputData);
  const metadata = normalizeFrameRenderMetadata(alphaAnalysis.metadata);
  const payload = await canvasToPngPayload(outputCanvas);

  return {
    ...payload,
    metadata,
    source: { width: sourceWidth, height: sourceHeight },
    normalized: { width: TARGET_COSMETIC_SIZE, height: TARGET_COSMETIC_SIZE },
    analysis: alphaAnalysis.analysis,
    settings: { margin },
    needsManualReview: Boolean(alphaAnalysis.analysis?.needs_manual_review),
  };
}

async function normalizeAvatarFile(file, settings = {}) {
  if (!fileLooksLikeAvatar(file)) {
    throw new Error("Format avatar non supporte. Utilise PNG, JPEG, WebP, MP4 ou WebM.");
  }

  if (fileLooksLikeAvatarVideo(file)) {
    const mimeType = getAvatarVideoMimeFromFile(file);
    if (!AVATAR_VIDEO_TYPES.has(mimeType)) {
      throw new Error("Format video avatar non supporte. Utilise MP4 ou WebM.");
    }
    if (file.size > MAX_AVATAR_VIDEO_BYTES) {
      throw new Error(`Video avatar trop volumineuse (${formatBytes(file.size)}). Max ${formatBytes(MAX_AVATAR_VIDEO_BYTES)}.`);
    }
    const bytes = await readFileBytes(file);
    if (mimeType === PROFILE_AVATAR_VIDEO_MIME_MP4) inspectMp4Bytes(bytes);
    else inspectWebmBytes(bytes);
    const base64 = bytesToBase64(bytes);
    const videoDataUrl = `data:${mimeType};base64,${base64}`;
    return {
      contentBase64: base64,
      videoDataUrl,
      previewUrl: videoDataUrl,
      mediaKind: PROFILE_AVATAR_MEDIA_VIDEO,
      mimeType,
      metadata: {
        media_type: PROFILE_AVATAR_MEDIA_VIDEO,
        media_mime: mimeType,
        media_extension: getProfileAvatarVideoExtension(mimeType),
        avatar_fit: "cover",
        avatar_position: {
          x: 0.5,
          y: 0.5,
        },
      },
      source: null,
      normalized: null,
      settings: {},
      bytes: file.size,
      sha256: await sha256Hex(bytes),
      needsManualReview: false,
    };
  }

  if (!fileLooksLikeAvatarImage(file)) {
    throw new Error("Format avatar non supporte. Utilise PNG, JPEG ou WebP.");
  }
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const zoom = Math.min(2.5, Math.max(1, Number(settings.zoom ?? 1)));
  const offsetX = Math.min(0.5, Math.max(-0.5, Number(settings.offsetX ?? 0)));
  const offsetY = Math.min(0.5, Math.max(-0.5, Number(settings.offsetY ?? 0)));
  const scale = Math.max(TARGET_COSMETIC_SIZE / sourceWidth, TARGET_COSMETIC_SIZE / sourceHeight) * zoom;
  const outputWidth = sourceWidth * scale;
  const outputHeight = sourceHeight * scale;
  const outputX = (TARGET_COSMETIC_SIZE - outputWidth) / 2 + offsetX * TARGET_COSMETIC_SIZE;
  const outputY = (TARGET_COSMETIC_SIZE - outputHeight) / 2 + offsetY * TARGET_COSMETIC_SIZE;

  const outputCanvas = createCanvas();
  const outputContext = outputCanvas.getContext("2d");
  if (!outputContext) throw new Error("Canvas navigateur indisponible.");
  outputContext.clearRect(0, 0, TARGET_COSMETIC_SIZE, TARGET_COSMETIC_SIZE);
  outputContext.drawImage(image, outputX, outputY, outputWidth, outputHeight);
  const payload = await canvasToPngPayload(outputCanvas);

  return {
    ...payload,
    metadata: {
      crop: {
        zoom,
        offset_x: offsetX,
        offset_y: offsetY,
      },
      avatar_fit: "cover",
      avatar_position: {
        x: Number((0.5 - offsetX).toFixed(4)),
        y: Number((0.5 - offsetY).toFixed(4)),
      },
    },
    source: { width: sourceWidth, height: sourceHeight },
    normalized: { width: TARGET_COSMETIC_SIZE, height: TARGET_COSMETIC_SIZE },
    settings: { zoom, offsetX, offsetY },
    mediaKind: "image",
    previewUrl: payload.pngDataUrl,
    needsManualReview: false,
  };
}

async function normalizeDraftFile(file, assetType, settings) {
  if (typeof document === "undefined") {
    throw new Error("Normalisation locale indisponible hors navigateur.");
  }
  if (!file) {
    throw new Error("Fichier source manquant.");
  }
  const maxSourceBytes = assetType === "avatar" && fileLooksLikeAvatarVideo(file) ? MAX_AVATAR_VIDEO_BYTES : MAX_SOURCE_IMAGE_BYTES;
  if (file.size > maxSourceBytes) {
    throw new Error(`Fichier source trop volumineux (${formatBytes(file.size)}).`);
  }
  return assetType === "frame" ? normalizeFrameFile(file, settings) : normalizeAvatarFile(file, settings);
}

function DraftStatusBadge({ draft, t }) {
  const status = draft.status;
  if (status === "published") {
    return <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-100">{t("profile.uploadPublished", "Publie")}</Badge>;
  }
  if (status === "publishing") {
    return <Badge className="border-cyan-400/30 bg-cyan-400/10 text-cyan-100">{t("profile.uploadPublishing", "Publication...")}</Badge>;
  }
  if (status === "failed") {
    return <Badge className="border-red-400/30 bg-red-400/10 text-red-100">{t("profile.uploadFailed", "Erreur")}</Badge>;
  }
  if (draft.needsManualReview && !draft.manualValidated) {
    return <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-100">{t("profile.uploadManualReview", "Verification manuelle")}</Badge>;
  }
  if (status === "normalizing") {
    return <Badge className="border-zinc-600 bg-zinc-800 text-zinc-200">{t("profile.uploadNormalizing", "Normalisation...")}</Badge>;
  }
  return <Badge className="border-cyan-400/30 bg-cyan-400/10 text-cyan-100">{t("profile.uploadReady", "Pret")}</Badge>;
}

function RangeControl({ label, value, min, max, step, suffix = "", onChange }) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-full accent-cyan-400"
        />
        <span className="w-14 text-right text-xs text-zinc-400">
          {Number(value).toFixed(step < 1 ? 2 : 0)}
          {suffix}
        </span>
      </div>
    </label>
  );
}

function DraftInfoGrid({ draft, t }) {
  const confidence = draft.assetType === "frame" ? draft.analysis?.confidence || null : null;
  const finalSize = draft.bytes ? formatBytes(draft.bytes) : "-";
  const isVideo = draft.mediaKind === PROFILE_AVATAR_MEDIA_VIDEO;
  const finalFormat = isVideo ? (draft.mimeType === PROFILE_AVATAR_VIDEO_MIME_WEBM ? "WebM video" : "MP4 video") : "PNG 1024x1024";
  return (
    <div className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-400 sm:grid-cols-2 xl:grid-cols-4">
      <div>
        <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
          {t("profile.uploadInfoType", "Type")}
        </span>
        <span className="text-zinc-200">
          {draft.assetType === "avatar" ? t("profile.uploadTypeAvatar", "Avatar") : t("profile.uploadTypeFrame", "Cadre")}
        </span>
      </div>
      <div>
        <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
          {t("profile.uploadInfoName", "Nom propose")}
        </span>
        <span className="text-zinc-200">{draft.serverAsset?.displayName || draft.displayName}</span>
      </div>
      <div>
        <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
          {t("profile.uploadInfoFormat", "Format final")}
        </span>
        <span className="text-zinc-200">{finalFormat}</span>
      </div>
      <div>
        <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
          {t("profile.uploadInfoWeight", "Poids final")}
        </span>
        <span className="text-zinc-200">{finalSize}</span>
      </div>
      {draft.source || isVideo ? (
        <div className="sm:col-span-2">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
            {t("profile.uploadInfoDimensions", "Dimensions")}
          </span>
          <span className="text-zinc-200">
            {isVideo
              ? t("profile.uploadVideoKeptOriginal", "Video conservee telle quelle")
              : `${draft.source.width}x${draft.source.height} -> ${draft.normalized?.width || 1024}x${draft.normalized?.height || 1024}`}
          </span>
        </div>
      ) : null}
      {confidence ? (
        <div>
          <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
            {t("profile.uploadInfoConfidence", "Confiance")}
          </span>
          <span className="text-zinc-200">{confidence}</span>
        </div>
      ) : null}
    </div>
  );
}

export default function ProfileCosmeticUploadStudio({
  apiBase,
  canManageCosmetics,
  catalog,
  previewAvatar,
  t,
  onCosmeticsStateChange,
  onSelectAvatar,
  onSelectFrame,
  onMessage,
  onError,
}) {
  const inputRef = useRef(null);
  const draftsRef = useRef([]);
  const publishingDraftIdsRef = useRef(new Set());
  const [assetType, setAssetType] = useState("avatar");
  const [drafts, setDrafts] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [batchStatus, setBatchStatus] = useState(null);
  draftsRef.current = drafts;
  const framePreview = useMemo(() => (catalog.frames || [])[0] || null, [catalog.frames]);
  const catalogAssets = useMemo(() => catalog.assets || [...(catalog.avatars || []), ...(catalog.frames || [])], [catalog.assets, catalog.avatars, catalog.frames]);
  const existingDisplayNames = useMemo(() => {
    return new Set(catalogAssets.map((asset) => normalizeComparableName(asset.displayName || asset.display_name)).filter(Boolean));
  }, [catalogAssets]);

  const readyDrafts = drafts.filter((draft) => draft.status === "ready" && (!draft.needsManualReview || draft.manualValidated));

  const updateDraft = useCallback((id, patch) => {
    setDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
  }, []);

  const normalizeAndStore = useCallback(
    async (draft, settingsPatch = {}) => {
      const settings = { ...(draft.settings || {}), ...settingsPatch };
      updateDraft(draft.id, {
        status: "normalizing",
        error: "",
        settings,
        pngDataUrl: "",
        videoDataUrl: "",
        previewUrl: "",
        contentBase64: "",
        mediaKind: "",
        mimeType: "",
        metadata: null,
        sha256: "",
        bytes: 0,
        source: null,
        normalized: null,
        analysis: null,
      });
      try {
        const normalized = await normalizeDraftFile(draft.file, draft.assetType, settings);
        updateDraft(draft.id, {
          ...normalized,
          status: "ready",
          error: "",
          manualValidated: !normalized.needsManualReview,
        });
      } catch (error) {
        updateDraft(draft.id, {
          status: "failed",
          error: error?.message || t("profile.uploadNormalizeError", "Normalisation impossible."),
        });
      }
    },
    [t, updateDraft],
  );

  const addFiles = useCallback(
    async (fileList) => {
      const files = [...(fileList || [])];
      if (!files.length) return;
      onMessage?.("");
      onError?.("");
      setBatchStatus(null);
      const allocateDisplayName = createProfileCosmeticDisplayNameAllocator([
        ...catalogAssets,
        ...drafts.map(buildDraftNameAsset),
      ]);
      for (const file of files) {
        const displayName = allocateDisplayName(assetType);
        const draft = {
          id: createDraftId(),
          file,
          fileName: file.name,
          displayName,
          autoDisplayName: displayName,
          displayNameEdited: false,
          assetType,
          settings: assetType === "frame" ? { margin: DEFAULT_FRAME_MARGIN } : { zoom: 1, offsetX: 0, offsetY: 0 },
          status: "normalizing",
          manualValidated: false,
          error: "",
        };
        setDrafts((current) => [draft, ...current]);
        await normalizeAndStore(draft);
      }
    },
    [assetType, catalogAssets, drafts, normalizeAndStore, onError, onMessage],
  );

  async function publishDraft(draftId) {
    if (publishingDraftIdsRef.current.has(draftId)) return { draftId, status: "skipped" };
    const draft = draftsRef.current.find((item) => item.id === draftId);
    if (!draft) return;
    if (draft.status === "published") return { draftId, status: "already_published" };
    if (draft.status === "publishing") return { draftId, status: "skipped" };
    if (draft.needsManualReview && !draft.manualValidated) {
      updateDraft(draft.id, {
        status: "failed",
        error: t("profile.uploadManualReviewRequired", "Valide visuellement ce cadre avant publication."),
        errorStep: t("profile.uploadManualReview", "Verification manuelle"),
      });
      return { draftId, status: "failed" };
    }
    const isVideoDraft = draft.assetType === "avatar" && draft.mediaKind === PROFILE_AVATAR_MEDIA_VIDEO;
    if ((isVideoDraft ? !draft.contentBase64 || !draft.mimeType : !draft.pngDataUrl) || !draft.metadata || !draft.sha256) {
      await normalizeAndStore(draft);
      return { draftId, status: "failed" };
    }

    publishingDraftIdsRef.current.add(draft.id);
    updateDraft(draft.id, { status: "publishing", error: "" });
    onMessage?.("");
    onError?.("");

    try {
      const publishPayload = {
        action: "publish-cosmetic-asset",
        assetType: draft.assetType,
        collectionKey: "basic",
        displayName: draft.displayName,
        fileName: draft.fileName,
        metadata: draft.metadata,
        sha256: draft.sha256,
      };
      if (isVideoDraft) {
        publishPayload.mediaKind = PROFILE_AVATAR_MEDIA_VIDEO;
        publishPayload.mimeType = draft.mimeType;
        publishPayload.contentBase64 = draft.contentBase64;
        publishPayload.size = draft.bytes;
      } else {
        publishPayload.pngDataUrl = draft.pngDataUrl;
      }

      const response = await fetch(`${apiBase}/api/portal-cosmetics-admin`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(publishPayload),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const step = payload?.step ? `${payload.step} - ` : "";
        throw new Error(`${step}${payload?.error || t("profile.uploadPublishError", "Publication impossible.")}`);
      }
      onCosmeticsStateChange?.(payload);
      const asset = payload.publishedAsset || null;
      if (asset?.assetType === "avatar") onSelectAvatar?.(String(asset.id));
      if (asset?.assetType === "frame") onSelectFrame?.(String(asset.id));
      updateDraft(draft.id, {
        status: "published",
        serverAsset: asset,
        publish: payload.publish,
        error: "",
        errorStep: "",
      });
      onMessage?.(
        payload.publish?.status === "already_published"
          ? t("profile.uploadAlreadyPublished", "Ce cosmetique etait deja publie.")
          : t("profile.uploadPublishedMessage", "Cosmetique publie et catalogue rafraichi."),
      );
      return { draftId, status: payload.publish?.status === "already_published" ? "already_published" : "published" };
    } catch (error) {
      updateDraft(draft.id, {
        status: "failed",
        error: error?.message || t("profile.uploadPublishError", "Publication impossible."),
        errorStep: t("profile.uploadPublishError", "Publication impossible."),
      });
      return { draftId, status: "failed" };
    } finally {
      publishingDraftIdsRef.current.delete(draft.id);
    }
  }

  async function publishAllReady() {
    const targets = draftsRef.current.filter((draft) => draft.status === "ready" && (!draft.needsManualReview || draft.manualValidated));
    if (!targets.length) return;
    setBatchStatus({ status: "publishing", completed: 0, total: targets.length, succeeded: 0, failed: 0 });
    const results = [];
    for (const draft of targets) {
      const result = await publishDraft(draft.id);
      results.push(result || { draftId: draft.id, status: "failed" });
      const summary = summarizeProfileCosmeticPublishBatch(results);
      setBatchStatus({ status: "publishing", total: targets.length, ...summary });
    }
    const summary = summarizeProfileCosmeticPublishBatch(results);
    setBatchStatus({ status: "done", total: targets.length, ...summary });
    onMessage?.(
      t("profile.uploadBatchSummary", "{completed} publications terminees, {succeeded} reussies, {failed} en erreur.")
        .replace("{completed}", String(summary.completed))
        .replace("{succeeded}", String(summary.succeeded))
        .replace("{failed}", String(summary.failed)),
    );
  }

  function changeDraftAssetType(draft, nextType) {
    const nextName = draft.displayNameEdited
      ? draft.displayName
      : getNextProfileCosmeticDisplayName(
          nextType,
          [...catalogAssets, ...drafts.filter((item) => item.id !== draft.id).map(buildDraftNameAsset)],
        );
    const nextDraft = {
      ...draft,
      assetType: nextType,
      displayName: nextName,
      autoDisplayName: nextName,
      settings: nextType === "frame" ? { margin: DEFAULT_FRAME_MARGIN } : { zoom: 1, offsetX: 0, offsetY: 0 },
      manualValidated: false,
    };
    updateDraft(draft.id, nextDraft);
    void normalizeAndStore(nextDraft);
  }

  function updateDraftDisplayName(draftId, value) {
    updateDraft(draftId, { displayName: cleanDisplayName(value, "Cosmetique"), displayNameEdited: true });
  }

  function removeDraft(id) {
    setDrafts((current) => current.filter((draft) => draft.id !== id));
  }

  if (!canManageCosmetics) return null;

  return (
    <div className="rounded-lg border border-cyan-400/20 bg-cyan-950/10 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">
            {t("profile.uploadStudioEyebrow", "Studio admin")}
          </p>
          <h3 className="mt-1 text-xl font-semibold text-zinc-50">
            {t("profile.uploadStudioTitle", "Ajouter des cosmetiques")}
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            {t("profile.uploadStudioHelp", "Depose tes assets, normalise les images localement, puis publie-les une par une vers le VPS.")}
          </p>
        </div>
        <Button
          type="button"
          className="rounded-lg bg-cyan-500 text-zinc-950 hover:bg-cyan-400"
          disabled={!readyDrafts.length || batchStatus?.status === "publishing"}
          onClick={publishAllReady}
        >
          {batchStatus?.status === "publishing" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
          {readyDrafts.length
            ? t("profile.uploadPublishReadyCount", "Publier {count} brouillons prets").replace("{count}", String(readyDrafts.length))
            : t("profile.uploadPublishAll", "Publier les brouillons prets")}
        </Button>
      </div>
      {batchStatus ? (
        <div className="mt-4 rounded-lg border border-cyan-400/20 bg-cyan-400/10 p-3 text-sm text-cyan-50">
          {batchStatus.status === "publishing"
            ? t("profile.uploadBatchProgress", "{completed}/{total} publications terminees.")
                .replace("{completed}", String(batchStatus.completed))
                .replace("{total}", String(batchStatus.total))
            : t("profile.uploadBatchSummary", "{completed} publications terminees, {succeeded} reussies, {failed} en erreur.")
                .replace("{completed}", String(batchStatus.completed))
                .replace("{succeeded}", String(batchStatus.succeeded))
                .replace("{failed}", String(batchStatus.failed))}
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[320px_1fr]">
        <div
          className={`rounded-lg border border-dashed p-4 transition ${
            dragging ? "border-cyan-300 bg-cyan-400/10" : "border-zinc-700 bg-zinc-950"
          }`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void addFiles(event.dataTransfer.files);
          }}
        >
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-400/10 text-cyan-100">
              <ImagePlus className="h-7 w-7" />
            </div>
            <p className="mt-4 text-sm font-semibold text-zinc-100">
              {t("profile.uploadDropTitle", "Glisse tes fichiers ici")}
            </p>
            <p className="mt-2 max-w-[250px] text-sm text-zinc-500">
              {t("profile.uploadDropHelp", "Aucun upload n'est lance avant le bouton Valider et publier.")}
            </p>
            <div className="mt-4 flex w-full max-w-[260px] rounded-lg border border-zinc-800 bg-zinc-900 p-1">
              {["avatar", "frame"].map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold transition ${
                    assetType === type ? "bg-cyan-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"
                  }`}
                  onClick={() => setAssetType(type)}
                >
                  {type === "avatar" ? t("profile.avatars", "Avatars") : t("profile.frames", "Cadres")}
                </button>
              ))}
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={assetType === "frame" ? "image/png" : AVATAR_UPLOAD_ACCEPT}
              className="hidden"
              onChange={(event) => {
                void addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="mt-4 rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
              onClick={() => inputRef.current?.click()}
            >
              <UploadCloud className="mr-2 h-4 w-4" />
              {t("profile.uploadBrowse", "Choisir des fichiers")}
            </Button>
            <p className="mt-3 text-xs text-zinc-600">
              {t("profile.uploadLimits", "Images max 12 Mo, sortie PNG max 2.75 Mo. Videos avatar MP4/WebM max 2.5 Mo.")}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {!drafts.length ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5 text-sm text-zinc-500">
              {t("profile.uploadNoDrafts", "Aucun brouillon pour le moment.")}
            </div>
          ) : null}

          {drafts.map((draft) => {
            const draftAsset = buildDraftAsset(draft);
            const previewFrame = draft.assetType === "frame" ? draftAsset : framePreview;
            const avatarPreview = draft.assetType === "avatar" ? draftAsset : previewAvatar || (catalog.avatars || [])[0] || null;
            const canPublish = draft.status === "ready" && (!draft.needsManualReview || draft.manualValidated);
            const hasNameCollision = existingDisplayNames.has(normalizeComparableName(draft.displayName));
            return (
              <div key={draft.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <div className="flex flex-col gap-4 xl:flex-row">
                  <div className="flex shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 p-3 xl:w-[170px]">
                    {draftAsset ? (
                      <ProfileAvatar avatar={avatarPreview} frame={previewFrame} name={draft.displayName} size={128} />
                    ) : draft.status === "normalizing" ? (
                      <Loader2 className="h-8 w-8 animate-spin text-cyan-200" />
                    ) : (
                      <XCircle className="h-8 w-8 text-red-200" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <DraftStatusBadge draft={draft} t={t} />
                          <span className="truncate text-xs text-zinc-500">{draft.fileName}</span>
                        </div>
                        <input
                          type="text"
                          value={draft.displayName}
                          onChange={(event) => updateDraftDisplayName(draft.id, event.target.value)}
                          className="mt-2 h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-cyan-400"
                        />
                        {hasNameCollision ? (
                          <p className="mt-2 max-w-xl text-xs text-amber-200">
                            {t(
                              "profile.uploadDuplicateNameWarning",
                              "Un asset existant porte deja un nom proche. Les anciens assets sans hash source ne sont pas dedoublonnes par contenu.",
                            )}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        <select
                          value={draft.assetType}
                          onChange={(event) => changeDraftAssetType(draft, event.target.value)}
                          className="h-9 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-cyan-400"
                          disabled={draft.status === "publishing"}
                        >
                          <option value="avatar">{t("profile.uploadTypeAvatar", "Avatar")}</option>
                          <option value="frame">{t("profile.uploadTypeFrame", "Cadre")}</option>
                        </select>
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                          onClick={() => removeDraft(draft.id)}
                          disabled={draft.status === "publishing"}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <DraftInfoGrid draft={draft} t={t} />

                    {draft.assetType === "frame" ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        <RangeControl
                          label={t("profile.uploadFrameMargin", "Marge cadre")}
                          value={draft.settings?.margin ?? DEFAULT_FRAME_MARGIN}
                          min={0}
                          max={0.16}
                          step={0.01}
                          onChange={(value) => void normalizeAndStore(draft, { margin: value })}
                        />
                        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-400">
                          {draft.source ? `${draft.source.width}x${draft.source.height} -> 1024x1024` : t("common.loading", "Chargement...")}
                          {draft.bytes ? <span className="ml-2 text-zinc-500">{formatBytes(draft.bytes)}</span> : null}
                          {draft.analysis?.confidence ? (
                            <span className="ml-2 text-zinc-500">({draft.analysis.confidence})</span>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      draft.mediaKind === PROFILE_AVATAR_MEDIA_VIDEO ? (
                        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-400">
                          {t(
                            "profile.uploadAvatarVideoNoCrop",
                            "Avatar video conserve tel quel : pas de crop navigateur, lecture muette en boucle, max 2.5 Mo.",
                          )}
                        </div>
                      ) : (
                        <div className="grid gap-3 md:grid-cols-3">
                        <RangeControl
                          label={t("profile.uploadAvatarZoom", "Zoom")}
                          value={draft.settings?.zoom ?? 1}
                          min={1}
                          max={2.5}
                          step={0.05}
                          onChange={(value) => void normalizeAndStore(draft, { zoom: value })}
                        />
                        <RangeControl
                          label={t("profile.uploadAvatarOffsetX", "Horizontal")}
                          value={draft.settings?.offsetX ?? 0}
                          min={-0.5}
                          max={0.5}
                          step={0.02}
                          onChange={(value) => void normalizeAndStore(draft, { offsetX: value })}
                        />
                        <RangeControl
                          label={t("profile.uploadAvatarOffsetY", "Vertical")}
                          value={draft.settings?.offsetY ?? 0}
                          min={-0.5}
                          max={0.5}
                          step={0.02}
                          onChange={(value) => void normalizeAndStore(draft, { offsetY: value })}
                        />
                      </div>
                      )
                    )}

                    {draft.assetType === "frame" && draft.metadata ? (
                      <div className="grid gap-3 md:grid-cols-4">
                        {["x", "y", "width", "height"].map((key) => (
                          <label key={key} className="space-y-1">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                              {`Zone ${key}`}
                            </span>
                            <input
                              type="number"
                              min={0}
                              max={1}
                              step={0.01}
                              value={Number(draft.metadata.content_box?.[key] ?? 0).toFixed(2)}
                              onChange={(event) => {
                                const metadata = normalizeFrameRenderMetadata({
                                  ...draft.metadata,
                                  content_box: {
                                    ...draft.metadata.content_box,
                                    [key]: Number(event.target.value),
                                  },
                                });
                                updateDraft(draft.id, { metadata, manualValidated: true, needsManualReview: false });
                              }}
                              className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-cyan-400"
                            />
                          </label>
                        ))}
                      </div>
                    ) : null}

                    {draft.needsManualReview && draft.status !== "published" ? (
                      <div className="rounded-lg border border-amber-400/25 bg-amber-400/10 p-3 text-sm text-amber-100">
                        <p>{t("profile.uploadManualReviewText", "Verification manuelle requise avant publication.")}</p>
                        <Button
                          type="button"
                          variant="outline"
                          className="mt-3 rounded-lg border-amber-300/40 bg-zinc-950 text-amber-100 hover:bg-amber-400/10"
                          onClick={() => updateDraft(draft.id, { manualValidated: true })}
                        >
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                          {t("profile.uploadManualReviewConfirm", "Valider visuellement")}
                        </Button>
                      </div>
                    ) : null}

                    {draft.error ? (
                      <div className="rounded-lg border border-red-400/25 bg-red-400/10 p-3 text-sm text-red-100">
                        {draft.errorStep ? <div className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-red-200">{draft.errorStep}</div> : null}
                        {draft.error}
                      </div>
                    ) : null}

                    {draft.publish?.url ? (
                      <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 p-3 text-xs text-emerald-100">
                        <div>{draft.publish.url}</div>
                        <div className="mt-1">
                          SHA-256 {draft.publish.sha256}
                          {draft.publish.width && draft.publish.height ? ` - ${draft.publish.width}x${draft.publish.height}` : ""}
                          {draft.publish.mimeType ? ` - ${draft.publish.mimeType}` : ""}
                        </div>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      {draft.status === "published" ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-lg border-emerald-300/30 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/15"
                          onClick={() => inputRef.current?.click()}
                        >
                          <ImagePlus className="mr-2 h-4 w-4" />
                          {t("profile.uploadAddAnother", "Ajouter un autre cosmetique")}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          className="rounded-lg bg-cyan-500 text-zinc-950 hover:bg-cyan-400"
                          onClick={() => publishDraft(draft.id)}
                          disabled={!canPublish || draft.status === "publishing"}
                        >
                          {draft.status === "publishing" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                          {t("profile.uploadPublish", "Valider et publier")}
                        </Button>
                      )}
                      {draft.status === "failed" ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                          onClick={() => void publishDraft(draft.id)}
                        >
                          <RefreshCw className="mr-2 h-4 w-4" />
                          {t("profile.uploadRetry", "Nouvelle tentative")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
