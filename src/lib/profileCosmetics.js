export const PROFILE_COSMETIC_AVATAR = "avatar";
export const PROFILE_COSMETIC_FRAME = "frame";
export const PROFILE_COSMETIC_ACCESS_BASIC = "basic";
export const PROFILE_COSMETIC_ACCESS_TIER = "tier";
export const PROFILE_COSMETIC_ACCESS_MANUAL = "manual";
export const PROFILE_COSMETIC_TIER_SUPPORT_TOTAL = "support_total";
export const PROFILE_COSMETIC_TIER_MONTHLY_LOYALTY = "monthly_loyalty";
export const PROFILE_COSMETIC_UI_ACCESS_BASIC = "basic";
export const PROFILE_COSMETIC_UI_ACCESS_SUPPORT_TOTAL = "support_total";
export const PROFILE_COSMETIC_UI_ACCESS_MONTHLY_LOYALTY = "monthly_loyalty";
export const PROFILE_COSMETIC_UI_ACCESS_MANUAL = "manual";
export const PROFILE_FRAME_ANIMATION_SHARK_MOUTH = "shark-mouth";
export const PROFILE_FRAME_ANIMATION_INFERNAL_HORNS = "infernal-horns";
export const PROFILE_AVATAR_MEDIA_IMAGE = "image";
export const PROFILE_AVATAR_MEDIA_VIDEO = "video";
export const PROFILE_AVATAR_VIDEO_MIME_MP4 = "video/mp4";
export const PROFILE_AVATAR_VIDEO_MIME_WEBM = "video/webm";
export const PROFILE_AVATAR_VIDEO_MIME_TYPES = new Set([
  PROFILE_AVATAR_VIDEO_MIME_MP4,
  PROFILE_AVATAR_VIDEO_MIME_WEBM,
]);
export const PROFILE_AVATAR_VIDEO_EXTENSIONS_BY_MIME = new Map([
  [PROFILE_AVATAR_VIDEO_MIME_MP4, ".mp4"],
  [PROFILE_AVATAR_VIDEO_MIME_WEBM, ".webm"],
]);
export const PROFILE_COSMETIC_ASSET_TYPES = new Set([PROFILE_COSMETIC_AVATAR, PROFILE_COSMETIC_FRAME]);
export const PROFILE_COSMETIC_UI_ACCESS_MODES = new Set([
  PROFILE_COSMETIC_UI_ACCESS_BASIC,
  PROFILE_COSMETIC_UI_ACCESS_SUPPORT_TOTAL,
  PROFILE_COSMETIC_UI_ACCESS_MONTHLY_LOYALTY,
  PROFILE_COSMETIC_UI_ACCESS_MANUAL,
]);
export const DEFAULT_FRAME_CONTENT_INSET = 0.14;
export const PROFILE_FRAME_VISUAL_INSET_SCALE = 0.72;
export const MIN_PROFILE_FRAME_VISUAL_INSET = 0.06;
export const MAX_PROFILE_FRAME_VISUAL_INSET = 0.12;
export const DEFAULT_FRAME_RENDER_VERSION = 2;
export const DEFAULT_FRAME_CONTENT_RADIUS = 0;
export const MAX_FRAME_CONTENT_RADIUS = 0.5;
export const DEFAULT_FRAME_AVATAR_FIT = "cover";
export const DEFAULT_FRAME_AVATAR_POSITION = { x: 0.5, y: 0.5 };
export const DEFAULT_FRAME_BOX = { x: 0, y: 0, width: 1, height: 1 };
export const MAX_PROFILE_FRAME_ANIMATION_LAYERS = 8;
export const PROFILE_FRAME_ANIMATION_LAYER_POSITION_MIN = -1;
export const PROFILE_FRAME_ANIMATION_LAYER_POSITION_MAX = 2;
export const PROFILE_FRAME_ANIMATION_LAYER_SIZE_MIN = 0.01;
export const PROFILE_FRAME_ANIMATION_LAYER_SIZE_MAX = 2;
export const PROFILE_FRAME_ALLOWED_RENDER_METADATA_KEYS = new Set([
  "render_version",
  "content_box",
  "content_radius",
  "avatar_fit",
  "avatar_position",
  "frame_box",
  "animation_layers",
]);
export const PROFILE_FRAME_ALLOWED_BOX_KEYS = new Set(["x", "y", "width", "height"]);
export const PROFILE_FRAME_ALLOWED_POINT_KEYS = new Set(["x", "y"]);
export const PROFILE_FRAME_ALLOWED_AVATAR_FITS = new Set(["cover", "contain"]);
export const PROFILE_FRAME_ALLOWED_ANIMATION_LAYER_KEYS = new Set([
  "id",
  "label",
  "type",
  "url",
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "flipX",
  "opacity",
  "zIndex",
  "delayMs",
  "pointerEvents",
  "blendMode",
]);
export const PROFILE_FRAME_ALLOWED_ANIMATION_LAYER_TYPES = new Set(["webp"]);
export const PROFILE_FRAME_ALLOWED_ANIMATION_BLEND_MODES = new Set(["normal", "screen", "lighten", "plus-lighter"]);

export function cleanProfileCosmeticText(value, maxLength = 240) {
  return String(value || "").trim().slice(0, maxLength);
}

export function normalizeProfileCosmeticType(value) {
  const type = cleanProfileCosmeticText(value).toLowerCase();
  return PROFILE_COSMETIC_ASSET_TYPES.has(type) ? type : "";
}

export function normalizeProfileAvatarMediaType(value) {
  const mediaType = cleanProfileCosmeticText(value, 40).toLowerCase();
  if (mediaType === PROFILE_AVATAR_MEDIA_VIDEO) {
    return PROFILE_AVATAR_MEDIA_VIDEO;
  }
  return PROFILE_AVATAR_MEDIA_IMAGE;
}

export function normalizeProfileAvatarVideoMimeType(value) {
  const mimeType = cleanProfileCosmeticText(value, 80).toLowerCase();
  return PROFILE_AVATAR_VIDEO_MIME_TYPES.has(mimeType) ? mimeType : "";
}

export function getProfileAvatarVideoExtension(mimeType) {
  return PROFILE_AVATAR_VIDEO_EXTENSIONS_BY_MIME.get(normalizeProfileAvatarVideoMimeType(mimeType)) || "";
}

function normalizeProfileCosmeticAccessType(value) {
  const type = cleanProfileCosmeticText(value).toLowerCase();
  return [PROFILE_COSMETIC_ACCESS_BASIC, PROFILE_COSMETIC_ACCESS_TIER, PROFILE_COSMETIC_ACCESS_MANUAL].includes(type)
    ? type
    : PROFILE_COSMETIC_ACCESS_BASIC;
}

function normalizeProfileCosmeticTierType(value) {
  const type = cleanProfileCosmeticText(value).toLowerCase();
  return [PROFILE_COSMETIC_TIER_SUPPORT_TOTAL, PROFILE_COSMETIC_TIER_MONTHLY_LOYALTY].includes(type) ? type : "";
}

function getProfileCosmeticTierId(tier) {
  return cleanProfileCosmeticText(tier?.id || tier?.tierId || tier?.tier_id, 120);
}

function getProfileCosmeticTierType(tier) {
  return normalizeProfileCosmeticTierType(tier?.tierType || tier?.tier_type);
}

export function createProfileCosmeticNaturalSorter(locale = "fr") {
  const collator = new Intl.Collator(locale || "fr", {
    numeric: true,
    sensitivity: "base",
  });

  return (left, right) => {
    const leftName = getProfileCosmeticDisplayName(left);
    const rightName = getProfileCosmeticDisplayName(right);
    const byName = collator.compare(leftName, rightName);
    if (byName !== 0) return byName;
    return cleanProfileCosmeticText(left?.id || left?.asset_key).localeCompare(
      cleanProfileCosmeticText(right?.id || right?.asset_key),
      locale || "fr",
      { sensitivity: "base" },
    );
  };
}

export function sortProfileCosmeticAssetsNatural(assets = [], locale = "fr") {
  return [...(assets || [])].sort(createProfileCosmeticNaturalSorter(locale));
}

export function findProfileCosmeticTier(tiers = [], tierId = "") {
  const normalizedTierId = cleanProfileCosmeticText(tierId, 120);
  if (!normalizedTierId) return null;
  return (tiers || []).find((tier) => getProfileCosmeticTierId(tier) === normalizedTierId) || null;
}

export function deriveProfileCosmeticUiAccessMode(rule, tiers = []) {
  const accessType = normalizeProfileCosmeticAccessType(rule?.accessType || rule?.access_type);
  if (accessType === PROFILE_COSMETIC_ACCESS_BASIC) return PROFILE_COSMETIC_UI_ACCESS_BASIC;
  if (accessType === PROFILE_COSMETIC_ACCESS_MANUAL) return PROFILE_COSMETIC_UI_ACCESS_MANUAL;

  const tier = findProfileCosmeticTier(tiers, rule?.tierId || rule?.tier_id);
  const tierType = getProfileCosmeticTierType(tier);
  if (tierType === PROFILE_COSMETIC_TIER_MONTHLY_LOYALTY) return PROFILE_COSMETIC_UI_ACCESS_MONTHLY_LOYALTY;
  return PROFILE_COSMETIC_UI_ACCESS_SUPPORT_TOTAL;
}

export function buildProfileCosmeticRuleDraft(rule = {}, tiers = []) {
  return {
    assetId: cleanProfileCosmeticText(rule.assetId || rule.asset_id, 120),
    uiMode: deriveProfileCosmeticUiAccessMode(rule, tiers),
    accessType: normalizeProfileCosmeticAccessType(rule.accessType || rule.access_type),
    tierId: cleanProfileCosmeticText(rule.tierId || rule.tier_id, 120),
    publicUnlockTitle: cleanProfileCosmeticText(rule.publicUnlockTitle || rule.public_unlock_title, 160),
    publicUnlockDescription: cleanProfileCosmeticText(rule.publicUnlockDescription || rule.public_unlock_description, 500),
  };
}

export function buildProfileCosmeticAccessRulePayload({ assetId, uiMode, tierId, publicUnlockTitle, publicUnlockDescription, tiers = [] } = {}) {
  const normalizedAssetId = cleanProfileCosmeticText(assetId, 120);
  const mode = PROFILE_COSMETIC_UI_ACCESS_MODES.has(uiMode) ? uiMode : "";
  const title = cleanProfileCosmeticText(publicUnlockTitle, 160);
  const description = cleanProfileCosmeticText(publicUnlockDescription, 500);

  if (!normalizedAssetId) {
    throw new Error("Cosmetique manquant.");
  }

  if (mode === PROFILE_COSMETIC_UI_ACCESS_BASIC) {
    return {
      assetId: normalizedAssetId,
      accessType: PROFILE_COSMETIC_ACCESS_BASIC,
      tierId: null,
      tierType: null,
      publicUnlockTitle: title || null,
      publicUnlockDescription: description || null,
    };
  }

  if (mode === PROFILE_COSMETIC_UI_ACCESS_MANUAL) {
    if (!title) {
      throw new Error("Un titre public est requis pour une recompense speciale.");
    }
    return {
      assetId: normalizedAssetId,
      accessType: PROFILE_COSMETIC_ACCESS_MANUAL,
      tierId: null,
      tierType: null,
      publicUnlockTitle: title,
      publicUnlockDescription: description || null,
    };
  }

  const expectedTierType =
    mode === PROFILE_COSMETIC_UI_ACCESS_SUPPORT_TOTAL
      ? PROFILE_COSMETIC_TIER_SUPPORT_TOTAL
      : mode === PROFILE_COSMETIC_UI_ACCESS_MONTHLY_LOYALTY
        ? PROFILE_COSMETIC_TIER_MONTHLY_LOYALTY
        : "";
  const tier = findProfileCosmeticTier(tiers, tierId);
  if (!tier || getProfileCosmeticTierType(tier) !== expectedTierType) {
    throw new Error("Selectionne un palier valide pour cette classification.");
  }

  return {
    assetId: normalizedAssetId,
    accessType: PROFILE_COSMETIC_ACCESS_TIER,
    tierId: getProfileCosmeticTierId(tier),
    tierType: expectedTierType,
    publicUnlockTitle: title || null,
    publicUnlockDescription: description || null,
  };
}

export function getProfileCosmeticAdminAccessBadge(rule = {}, tiers = [], locale = "fr") {
  const accessType = normalizeProfileCosmeticAccessType(rule.accessType || rule.access_type);
  if (accessType === PROFILE_COSMETIC_ACCESS_BASIC) {
    return { mode: PROFILE_COSMETIC_UI_ACCESS_BASIC, labelKey: "profile.accessBasic", fallbackLabel: "Accessible a tous", tone: "basic", tier: null };
  }

  if (accessType === PROFILE_COSMETIC_ACCESS_MANUAL) {
    return { mode: PROFILE_COSMETIC_UI_ACCESS_MANUAL, labelKey: "profile.accessManual", fallbackLabel: "Recompense speciale", tone: "manual", tier: null };
  }

  const tier = findProfileCosmeticTier(tiers, rule.tierId || rule.tier_id);
  const tierType = getProfileCosmeticTierType(tier);
  if (tierType === PROFILE_COSMETIC_TIER_MONTHLY_LOYALTY) {
    return {
      mode: PROFILE_COSMETIC_UI_ACCESS_MONTHLY_LOYALTY,
      labelKey: "profile.adminBadgeMonthlyLoyalty",
      fallbackLabel: `Fidelite mensuelle · ${Number(tier?.thresholdValue ?? tier?.threshold_value ?? 0)} mois`,
      tone: "monthly",
      tier,
    };
  }

  const cents = Number(tier?.thresholdValue ?? tier?.threshold_value ?? 0);
  const amount = new Intl.NumberFormat(locale === "en" ? "en-US" : "fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
  return {
    mode: PROFILE_COSMETIC_UI_ACCESS_SUPPORT_TOTAL,
    labelKey: "profile.adminBadgeSupportTotal",
    fallbackLabel: `Soutien cumule · ${amount}`,
    tone: "support",
    tier,
  };
}

function getProfileCosmeticDisplayBaseName(assetType) {
  return normalizeProfileCosmeticType(assetType) === PROFILE_COSMETIC_FRAME ? "Cadre" : "Avatar";
}

function getProfileCosmeticDisplayName(asset) {
  return cleanProfileCosmeticText(asset?.displayName || asset?.display_name || asset?.display_name_fr || asset?.name, 120);
}

function normalizeProfileCosmeticDisplayName(value) {
  return cleanProfileCosmeticText(value, 120)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function getProfileCosmeticNumberedDisplayNameInfo(displayName) {
  const normalized = normalizeProfileCosmeticDisplayName(displayName);
  const match = normalized.match(/^(avatar|cadre|frame) ([1-9]\d*)$/);
  if (!match) return null;
  return {
    assetType: match[1] === "avatar" ? PROFILE_COSMETIC_AVATAR : PROFILE_COSMETIC_FRAME,
    number: Number(match[2]),
  };
}

export function getProfileFrameAnimationKey(frame) {
  const normalizedDisplayName = normalizeProfileCosmeticDisplayName(getProfileCosmeticDisplayName(frame));
  if (normalizedDisplayName === "cadre 35 anime") {
    return PROFILE_FRAME_ANIMATION_INFERNAL_HORNS;
  }

  const info = getProfileCosmeticNumberedDisplayNameInfo(getProfileCosmeticDisplayName(frame));
  if (info?.assetType === PROFILE_COSMETIC_FRAME && info.number === 33) {
    return PROFILE_FRAME_ANIMATION_SHARK_MOUTH;
  }
  return "";
}

export function getNextProfileCosmeticDisplayName(assetType, existingAssets = [], reservedNames = []) {
  const type = normalizeProfileCosmeticType(assetType);
  if (!type) return "Cosmetique";

  const reserved = new Set(reservedNames.map(normalizeProfileCosmeticDisplayName).filter(Boolean));
  let maxNumber = 0;
  for (const asset of existingAssets || []) {
    const assetMatchesType = normalizeProfileCosmeticType(asset?.assetType || asset?.asset_type) === type;
    const info = getProfileCosmeticNumberedDisplayNameInfo(getProfileCosmeticDisplayName(asset));
    if (assetMatchesType && info?.assetType === type) {
      maxNumber = Math.max(maxNumber, info.number);
    }
  }

  let candidateNumber = maxNumber + 1;
  let candidate = `${getProfileCosmeticDisplayBaseName(type)} ${candidateNumber}`;
  while (reserved.has(normalizeProfileCosmeticDisplayName(candidate))) {
    candidateNumber += 1;
    candidate = `${getProfileCosmeticDisplayBaseName(type)} ${candidateNumber}`;
  }
  return candidate;
}

export function createProfileCosmeticDisplayNameAllocator(existingAssets = []) {
  const reservedNames = [];
  return (assetType) => {
    const name = getNextProfileCosmeticDisplayName(assetType, existingAssets, reservedNames);
    reservedNames.push(name);
    return name;
  };
}

export function summarizeProfileCosmeticPublishBatch(results = []) {
  const completed = results.length;
  const succeeded = results.filter((result) => result?.status === "published" || result?.status === "already_published").length;
  const failed = results.filter((result) => result?.status === "failed").length;
  return { completed, succeeded, failed };
}

export function normalizeProfileCosmeticMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

export function getProfileAvatarMediaInfo(asset) {
  const metadata = normalizeProfileCosmeticMetadata(asset?.metadata);
  const metadataMediaType = normalizeProfileAvatarMediaType(metadata.media_type ?? metadata.mediaType);
  const metadataMimeType = normalizeProfileAvatarVideoMimeType(
    metadata.media_mime ?? metadata.mediaMime ?? metadata.mime_type ?? metadata.mimeType ?? metadata.content_type ?? metadata.contentType,
  );

  if (metadataMediaType === PROFILE_AVATAR_MEDIA_VIDEO && metadataMimeType) {
    return {
      mediaType: PROFILE_AVATAR_MEDIA_VIDEO,
      mimeType: metadataMimeType,
      isVideo: true,
    };
  }

  const url = cleanProfileCosmeticText(asset?.url ?? asset?.assetUrl ?? asset?.asset_url, 700)
    .split(/[?#]/)[0]
    .toLowerCase();

  if (url.endsWith(".mp4")) {
    return {
      mediaType: PROFILE_AVATAR_MEDIA_VIDEO,
      mimeType: PROFILE_AVATAR_VIDEO_MIME_MP4,
      isVideo: true,
    };
  }

  if (url.endsWith(".webm")) {
    return {
      mediaType: PROFILE_AVATAR_MEDIA_VIDEO,
      mimeType: PROFILE_AVATAR_VIDEO_MIME_WEBM,
      isVideo: true,
    };
  }

  return {
    mediaType: PROFILE_AVATAR_MEDIA_IMAGE,
    mimeType: "",
    isVideo: false,
  };
}

function clampUnit(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(1, Math.max(0, numeric));
}

function clampContentRadius(value, fallback = DEFAULT_FRAME_CONTENT_RADIUS) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(MAX_FRAME_CONTENT_RADIUS, Math.max(0, numeric));
}

function clampBox(value, fallback = DEFAULT_FRAME_BOX, minSize = 0.04) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fallbackBox = fallback && typeof fallback === "object" ? fallback : DEFAULT_FRAME_BOX;
  const width = Math.min(1, Math.max(minSize, Number.isFinite(Number(raw.width)) ? Number(raw.width) : fallbackBox.width));
  const height = Math.min(1, Math.max(minSize, Number.isFinite(Number(raw.height)) ? Number(raw.height) : fallbackBox.height));
  const x = Math.min(1 - width, Math.max(0, Number.isFinite(Number(raw.x)) ? Number(raw.x) : fallbackBox.x));
  const y = Math.min(1 - height, Math.max(0, Number.isFinite(Number(raw.y)) ? Number(raw.y) : fallbackBox.y));
  return { x, y, width, height };
}

function clampSignedNumber(value, fallback = 0, min = -360, max = 360) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function clampInteger(value, fallback = 0, min = -20, max = 80) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function normalizeFrameAnimationLayerUrl(value) {
  const url = cleanProfileCosmeticText(value, 600);
  if (!url) return "";
  if (url.startsWith("/")) return /\.webp(?:[?#].*)?$/i.test(url) ? url : "";

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "";
    return /\.webp$/i.test(parsed.pathname) ? url : "";
  } catch {
    return "";
  }
}

function normalizeFrameAnimationLayer(layer, index = 0) {
  const source = layer && typeof layer === "object" && !Array.isArray(layer) ? layer : {};
  const url = normalizeFrameAnimationLayerUrl(source.url);
  if (!url) return null;

  const type = cleanProfileCosmeticText(source.type || "webp", 16).toLowerCase();
  if (!PROFILE_FRAME_ALLOWED_ANIMATION_LAYER_TYPES.has(type)) return null;

  const width = clampSignedNumber(
    source.width,
    0.22,
    PROFILE_FRAME_ANIMATION_LAYER_SIZE_MIN,
    PROFILE_FRAME_ANIMATION_LAYER_SIZE_MAX,
  );
  const height = clampSignedNumber(
    source.height,
    0.22,
    PROFILE_FRAME_ANIMATION_LAYER_SIZE_MIN,
    PROFILE_FRAME_ANIMATION_LAYER_SIZE_MAX,
  );
  const x = clampSignedNumber(
    source.x,
    0,
    PROFILE_FRAME_ANIMATION_LAYER_POSITION_MIN,
    PROFILE_FRAME_ANIMATION_LAYER_POSITION_MAX,
  );
  const y = clampSignedNumber(
    source.y,
    0,
    PROFILE_FRAME_ANIMATION_LAYER_POSITION_MIN,
    PROFILE_FRAME_ANIMATION_LAYER_POSITION_MAX,
  );
  const blendMode = cleanProfileCosmeticText(source.blendMode || source.blend_mode || "normal", 32);

  return {
    id: cleanProfileCosmeticText(source.id, 80) || `layer-${index + 1}`,
    label: cleanProfileCosmeticText(source.label, 120),
    type,
    url,
    x,
    y,
    width,
    height,
    rotation: clampSignedNumber(source.rotation, 0, -360, 360),
    flipX: Boolean(source.flipX ?? source.flip_x),
    opacity: clampUnit(source.opacity, 1),
    zIndex: clampInteger(source.zIndex ?? source.z_index, 20, -20, 80),
    delayMs: clampInteger(source.delayMs ?? source.delay_ms, 0, 0, 60000),
    pointerEvents: false,
    blendMode: PROFILE_FRAME_ALLOWED_ANIMATION_BLEND_MODES.has(blendMode) ? blendMode : "normal",
  };
}

export function normalizeFrameAnimationLayers(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_PROFILE_FRAME_ANIMATION_LAYERS)
    .map((layer, index) => normalizeFrameAnimationLayer(layer, index))
    .filter(Boolean);
}

function buildContentBoxFromInset(inset) {
  const safeInset = Math.min(0.45, Math.max(0, Number.isFinite(Number(inset)) ? Number(inset) : DEFAULT_FRAME_CONTENT_INSET));
  return {
    x: safeInset,
    y: safeInset,
    width: Math.max(0.04, 1 - safeInset * 2),
    height: Math.max(0.04, 1 - safeInset * 2),
  };
}

export function getFrameContentInset(frame) {
  const metadata = normalizeProfileCosmeticMetadata(frame?.metadata);
  const inset = Number(metadata.contentInset ?? metadata.content_inset ?? DEFAULT_FRAME_CONTENT_INSET);
  if (!Number.isFinite(inset)) return DEFAULT_FRAME_CONTENT_INSET;
  return Math.min(0.35, Math.max(0, inset));
}

export function getFrameVisualInset(frame) {
  const inset = getFrameContentInset(frame);
  if (inset <= 0) return 0;
  return Math.min(MAX_PROFILE_FRAME_VISUAL_INSET, Math.max(MIN_PROFILE_FRAME_VISUAL_INSET, inset * PROFILE_FRAME_VISUAL_INSET_SCALE));
}

export function buildFrameRenderMetadataFromInset(frame) {
  return {
    render_version: DEFAULT_FRAME_RENDER_VERSION,
    content_box: buildContentBoxFromInset(getFrameContentInset(frame)),
    content_radius: DEFAULT_FRAME_CONTENT_RADIUS,
    avatar_fit: DEFAULT_FRAME_AVATAR_FIT,
    avatar_position: { ...DEFAULT_FRAME_AVATAR_POSITION },
    frame_box: { ...DEFAULT_FRAME_BOX },
  };
}

export function normalizeFrameRenderMetadata(value, fallbackFrame = null) {
  const metadata = normalizeProfileCosmeticMetadata(value);
  const fallback = buildFrameRenderMetadataFromInset(fallbackFrame || { metadata });
  const hasRenderV2 = Number(metadata.render_version ?? metadata.renderVersion) === DEFAULT_FRAME_RENDER_VERSION;
  const contentBox = hasRenderV2 && metadata.content_box ? metadata.content_box : fallback.content_box;
  const frameBox = hasRenderV2 && metadata.frame_box ? metadata.frame_box : fallback.frame_box;
  const avatarPosition = hasRenderV2 && metadata.avatar_position ? metadata.avatar_position : fallback.avatar_position;
  const avatarFit = cleanProfileCosmeticText(metadata.avatar_fit || metadata.avatarFit, 16).toLowerCase();
  const hasAnimationLayerMetadata = hasRenderV2 && Object.prototype.hasOwnProperty.call(metadata, "animation_layers");

  const normalized = {
    render_version: DEFAULT_FRAME_RENDER_VERSION,
    content_box: clampBox(contentBox, fallback.content_box),
    content_radius: clampContentRadius(metadata.content_radius ?? metadata.contentRadius, fallback.content_radius),
    avatar_fit: avatarFit === "contain" ? "contain" : DEFAULT_FRAME_AVATAR_FIT,
    avatar_position: {
      x: clampUnit(avatarPosition.x, fallback.avatar_position.x),
      y: clampUnit(avatarPosition.y, fallback.avatar_position.y),
    },
    frame_box: clampBox(frameBox, fallback.frame_box),
  };

  if (hasAnimationLayerMetadata) {
    normalized.animation_layers = normalizeFrameAnimationLayers(metadata.animation_layers);
  }

  return normalized;
}

export function getFrameRenderMetadata(frame) {
  return normalizeFrameRenderMetadata(frame?.metadata, frame);
}

export function shouldRefreshFrameMetadataDraft({ previousFrameId, nextFrameId, isDirty }) {
  const previous = cleanProfileCosmeticText(previousFrameId, 120);
  const next = cleanProfileCosmeticText(nextFrameId, 120);
  if (!next) return true;
  if (previous !== next) return true;
  return !isDirty;
}

export function normalizeFrameRenderMetadataForStorage(value) {
  return validateFrameRenderMetadataForStorage(value);
}

function createMetadataValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function ensurePlainObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createMetadataValidationError(`${path} doit etre un objet.`);
  }
  return value;
}

function rejectUnexpectedKeys(value, allowedKeys, path) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw createMetadataValidationError(`${path}.${key} n'est pas autorise.`);
    }
  }
}

function readStrictNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw createMetadataValidationError(`${path} doit etre un nombre fini.`);
  }
  return value;
}

function validateUnitNumber(value, path) {
  const numeric = readStrictNumber(value, path);
  if (numeric < 0 || numeric > 1) {
    throw createMetadataValidationError(`${path} doit etre compris entre 0 et 1.`);
  }
  return numeric;
}

function validateBoxForStorage(value, path) {
  const box = ensurePlainObject(value, path);
  rejectUnexpectedKeys(box, PROFILE_FRAME_ALLOWED_BOX_KEYS, path);
  const x = validateUnitNumber(box.x, `${path}.x`);
  const y = validateUnitNumber(box.y, `${path}.y`);
  const width = validateUnitNumber(box.width, `${path}.width`);
  const height = validateUnitNumber(box.height, `${path}.height`);

  if (width <= 0 || height <= 0) {
    throw createMetadataValidationError(`${path}.width et ${path}.height doivent etre strictement positifs.`);
  }
  if (x + width > 1 + Number.EPSILON) {
    throw createMetadataValidationError(`${path}.x + ${path}.width doit rester inferieur ou egal a 1.`);
  }
  if (y + height > 1 + Number.EPSILON) {
    throw createMetadataValidationError(`${path}.y + ${path}.height doit rester inferieur ou egal a 1.`);
  }

  return { x, y, width, height };
}

function validatePointForStorage(value, path) {
  const point = ensurePlainObject(value, path);
  rejectUnexpectedKeys(point, PROFILE_FRAME_ALLOWED_POINT_KEYS, path);
  return {
    x: validateUnitNumber(point.x, `${path}.x`),
    y: validateUnitNumber(point.y, `${path}.y`),
  };
}

function validateOptionalBoolean(value, path) {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw createMetadataValidationError(`${path} doit etre un booleen.`);
  }
  return value;
}

function validateOptionalInteger(value, path, fallback, min, max) {
  if (value === undefined) return fallback;
  const numeric = readStrictNumber(value, path);
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
    throw createMetadataValidationError(`${path} doit etre un entier compris entre ${min} et ${max}.`);
  }
  return numeric;
}

function validateOptionalNumber(value, path, fallback, min, max) {
  if (value === undefined) return fallback;
  const numeric = readStrictNumber(value, path);
  if (numeric < min || numeric > max) {
    throw createMetadataValidationError(`${path} doit etre compris entre ${min} et ${max}.`);
  }
  return numeric;
}

function validateFrameAnimationLayerUrl(value, path) {
  if (typeof value !== "string") {
    throw createMetadataValidationError(`${path} doit etre une URL WebP.`);
  }
  const url = normalizeFrameAnimationLayerUrl(value);
  if (!url) {
    throw createMetadataValidationError(`${path} doit etre une URL https ou relative vers un fichier .webp.`);
  }
  return url;
}

function validateFrameAnimationLayerForStorage(value, index) {
  const path = `metadata.animation_layers[${index}]`;
  const layer = ensurePlainObject(value, path);
  rejectUnexpectedKeys(layer, PROFILE_FRAME_ALLOWED_ANIMATION_LAYER_KEYS, path);

  const id = cleanProfileCosmeticText(layer.id, 80);
  if (!id || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id)) {
    throw createMetadataValidationError(`${path}.id doit contenir uniquement lettres, chiffres, tirets ou underscores.`);
  }

  const type = cleanProfileCosmeticText(layer.type || "webp", 16).toLowerCase();
  if (!PROFILE_FRAME_ALLOWED_ANIMATION_LAYER_TYPES.has(type)) {
    throw createMetadataValidationError(`${path}.type doit etre webp.`);
  }

  const width = validateOptionalNumber(
    layer.width,
    `${path}.width`,
    0.22,
    PROFILE_FRAME_ANIMATION_LAYER_SIZE_MIN,
    PROFILE_FRAME_ANIMATION_LAYER_SIZE_MAX,
  );
  const height = validateOptionalNumber(
    layer.height,
    `${path}.height`,
    0.22,
    PROFILE_FRAME_ANIMATION_LAYER_SIZE_MIN,
    PROFILE_FRAME_ANIMATION_LAYER_SIZE_MAX,
  );
  const x = validateOptionalNumber(
    layer.x,
    `${path}.x`,
    0,
    PROFILE_FRAME_ANIMATION_LAYER_POSITION_MIN,
    PROFILE_FRAME_ANIMATION_LAYER_POSITION_MAX,
  );
  const y = validateOptionalNumber(
    layer.y,
    `${path}.y`,
    0,
    PROFILE_FRAME_ANIMATION_LAYER_POSITION_MIN,
    PROFILE_FRAME_ANIMATION_LAYER_POSITION_MAX,
  );

  const pointerEvents = validateOptionalBoolean(layer.pointerEvents, `${path}.pointerEvents`);
  if (pointerEvents) {
    throw createMetadataValidationError(`${path}.pointerEvents doit rester false.`);
  }

  const blendMode = cleanProfileCosmeticText(layer.blendMode || "normal", 32);
  if (!PROFILE_FRAME_ALLOWED_ANIMATION_BLEND_MODES.has(blendMode)) {
    throw createMetadataValidationError(`${path}.blendMode n'est pas supporte.`);
  }

  return {
    id,
    label: cleanProfileCosmeticText(layer.label, 120),
    type,
    url: validateFrameAnimationLayerUrl(layer.url, `${path}.url`),
    x,
    y,
    width,
    height,
    rotation: validateOptionalNumber(layer.rotation, `${path}.rotation`, 0, -360, 360),
    flipX: validateOptionalBoolean(layer.flipX, `${path}.flipX`),
    opacity: validateOptionalNumber(layer.opacity, `${path}.opacity`, 1, 0, 1),
    zIndex: validateOptionalInteger(layer.zIndex, `${path}.zIndex`, 20, -20, 80),
    delayMs: validateOptionalInteger(layer.delayMs, `${path}.delayMs`, 0, 0, 60000),
    pointerEvents: false,
    blendMode,
  };
}

function validateFrameAnimationLayersForStorage(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw createMetadataValidationError("metadata.animation_layers doit etre un tableau.");
  }
  if (value.length > MAX_PROFILE_FRAME_ANIMATION_LAYERS) {
    throw createMetadataValidationError(`metadata.animation_layers ne peut pas depasser ${MAX_PROFILE_FRAME_ANIMATION_LAYERS} calques.`);
  }

  const ids = new Set();
  return value.map((layer, index) => {
    const normalized = validateFrameAnimationLayerForStorage(layer, index);
    if (ids.has(normalized.id)) {
      throw createMetadataValidationError(`metadata.animation_layers[${index}].id est en doublon.`);
    }
    ids.add(normalized.id);
    return normalized;
  });
}

export function validateFrameRenderMetadataForStorage(value) {
  const metadata = ensurePlainObject(value, "metadata");
  rejectUnexpectedKeys(metadata, PROFILE_FRAME_ALLOWED_RENDER_METADATA_KEYS, "metadata");

  if (metadata.render_version !== DEFAULT_FRAME_RENDER_VERSION) {
    throw createMetadataValidationError("metadata.render_version doit etre egal a 2.");
  }
  if (!PROFILE_FRAME_ALLOWED_AVATAR_FITS.has(metadata.avatar_fit)) {
    throw createMetadataValidationError("metadata.avatar_fit doit etre cover ou contain.");
  }

  const contentRadius = readStrictNumber(metadata.content_radius, "metadata.content_radius");
  if (contentRadius < 0 || contentRadius > MAX_FRAME_CONTENT_RADIUS) {
    throw createMetadataValidationError(`metadata.content_radius doit etre compris entre 0 et ${MAX_FRAME_CONTENT_RADIUS}.`);
  }

  const normalized = {
    render_version: DEFAULT_FRAME_RENDER_VERSION,
    content_box: validateBoxForStorage(metadata.content_box, "metadata.content_box"),
    content_radius: contentRadius,
    avatar_fit: metadata.avatar_fit,
    avatar_position: validatePointForStorage(metadata.avatar_position, "metadata.avatar_position"),
    frame_box: validateBoxForStorage(metadata.frame_box, "metadata.frame_box"),
  };

  const animationLayers = validateFrameAnimationLayersForStorage(metadata.animation_layers);
  if (animationLayers !== undefined) {
    normalized.animation_layers = animationLayers;
  }

  return normalized;
}

function getAlphaAt({ rgbaData, alphaData, width }, x, y) {
  const index = y * width + x;
  if (alphaData) return alphaData[index] || 0;
  return rgbaData?.[index * 4 + 3] || 0;
}

function normalizePixelBox(box, width, height, padding = 0) {
  const x = Math.min(width - 1, Math.max(0, box.minX + padding));
  const y = Math.min(height - 1, Math.max(0, box.minY + padding));
  const right = Math.min(width, Math.max(x + 1, box.maxX + 1 - padding));
  const bottom = Math.min(height, Math.max(y + 1, box.maxY + 1 - padding));
  return {
    x: Number((x / width).toFixed(4)),
    y: Number((y / height).toFixed(4)),
    width: Number(((right - x) / width).toFixed(4)),
    height: Number(((bottom - y) / height).toFixed(4)),
  };
}

function findTransparentStart(pixelSource, threshold) {
  const centerX = Math.floor(pixelSource.width / 2);
  const centerY = Math.floor(pixelSource.height / 2);
  if (getAlphaAt(pixelSource, centerX, centerY) <= threshold) return { x: centerX, y: centerY };

  const maxRadius = Math.floor(Math.min(pixelSource.width, pixelSource.height) * 0.16);
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const x = centerX + dx;
        const y = centerY + dy;
        if (x < 0 || y < 0 || x >= pixelSource.width || y >= pixelSource.height) continue;
        if (getAlphaAt(pixelSource, x, y) <= threshold) return { x, y };
      }
    }
  }
  return null;
}

export function analyzeFrameAlphaGeometry({ width, height, rgbaData = null, alphaData = null }, options = {}) {
  const safeWidth = Number(width);
  const safeHeight = Number(height);
  if (!Number.isInteger(safeWidth) || !Number.isInteger(safeHeight) || safeWidth <= 0 || safeHeight <= 0) {
    throw new Error("Image de cadre invalide.");
  }
  if (!rgbaData && !alphaData) {
    throw new Error("Donnees alpha manquantes.");
  }

  const alphaThreshold = Number.isFinite(Number(options.alphaThreshold)) ? Number(options.alphaThreshold) : 8;
  const pixelSource = { width: safeWidth, height: safeHeight, rgbaData, alphaData };
  const visible = {
    minX: safeWidth,
    minY: safeHeight,
    maxX: -1,
    maxY: -1,
    count: 0,
  };

  for (let y = 0; y < safeHeight; y += 1) {
    for (let x = 0; x < safeWidth; x += 1) {
      if (getAlphaAt(pixelSource, x, y) <= alphaThreshold) continue;
      visible.minX = Math.min(visible.minX, x);
      visible.minY = Math.min(visible.minY, y);
      visible.maxX = Math.max(visible.maxX, x);
      visible.maxY = Math.max(visible.maxY, y);
      visible.count += 1;
    }
  }

  if (!visible.count) {
    const fallback = buildFrameRenderMetadataFromInset({ metadata: { content_inset: DEFAULT_FRAME_CONTENT_INSET } });
    return {
      metadata: fallback,
      analysis: {
        visible_box: null,
        opening_box: null,
        confidence: "low",
        confidence_score: 0,
        needs_manual_review: true,
        reason: "aucun pixel alpha visible",
      },
    };
  }

  const start = findTransparentStart(pixelSource, alphaThreshold);
  if (!start) {
    const fallback = buildFrameRenderMetadataFromInset({ metadata: { content_inset: DEFAULT_FRAME_CONTENT_INSET } });
    return {
      metadata: fallback,
      analysis: {
        visible_box: normalizePixelBox(visible, safeWidth, safeHeight),
        opening_box: null,
        confidence: "low",
        confidence_score: 0.15,
        needs_manual_review: true,
        reason: "ouverture centrale transparente introuvable",
      },
    };
  }

  const visited = new Uint8Array(safeWidth * safeHeight);
  const stack = [start.y * safeWidth + start.x];
  const opening = {
    minX: start.x,
    minY: start.y,
    maxX: start.x,
    maxY: start.y,
    count: 0,
    touchesEdge: false,
  };
  visited[stack[0]] = 1;

  while (stack.length) {
    const index = stack.pop();
    const x = index % safeWidth;
    const y = Math.floor(index / safeWidth);
    opening.minX = Math.min(opening.minX, x);
    opening.minY = Math.min(opening.minY, y);
    opening.maxX = Math.max(opening.maxX, x);
    opening.maxY = Math.max(opening.maxY, y);
    opening.count += 1;
    if (x === 0 || y === 0 || x === safeWidth - 1 || y === safeHeight - 1) opening.touchesEdge = true;

    const neighbours = [index - 1, index + 1, index - safeWidth, index + safeWidth];
    for (const nextIndex of neighbours) {
      if (nextIndex < 0 || nextIndex >= visited.length || visited[nextIndex]) continue;
      const nx = nextIndex % safeWidth;
      const ny = Math.floor(nextIndex / safeWidth);
      if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
      if (getAlphaAt(pixelSource, nx, ny) > alphaThreshold) continue;
      visited[nextIndex] = 1;
      stack.push(nextIndex);
    }
  }

  const padding = Math.round(Math.min(safeWidth, safeHeight) * 0.018);
  const contentBox = clampBox(normalizePixelBox(opening, safeWidth, safeHeight, padding), buildContentBoxFromInset(DEFAULT_FRAME_CONTENT_INSET));
  const openingAreaRatio = opening.count / (safeWidth * safeHeight);
  const visibleAreaRatio = visible.count / (safeWidth * safeHeight);
  const openingWidth = contentBox.width;
  const openingHeight = contentBox.height;
  let confidenceScore = 0.85;
  const reasons = [];

  if (opening.touchesEdge) {
    confidenceScore -= 0.45;
    reasons.push("l'ouverture centrale touche le bord exterieur");
  }
  if (openingWidth < 0.38 || openingHeight < 0.38 || openingWidth > 0.9 || openingHeight > 0.9) {
    confidenceScore -= 0.25;
    reasons.push("taille d'ouverture atypique");
  }
  if (visibleAreaRatio < 0.05 || visibleAreaRatio > 0.7) {
    confidenceScore -= 0.2;
    reasons.push("surface visible atypique");
  }
  if (openingAreaRatio < 0.12 || openingAreaRatio > 0.82) {
    confidenceScore -= 0.15;
    reasons.push("surface transparente centrale atypique");
  }

  confidenceScore = Math.max(0, Math.min(1, Number(confidenceScore.toFixed(2))));
  const confidence = confidenceScore >= 0.75 ? "high" : confidenceScore >= 0.45 ? "medium" : "low";

  return {
    metadata: normalizeFrameRenderMetadata({
      render_version: DEFAULT_FRAME_RENDER_VERSION,
      content_box: contentBox,
      content_radius: DEFAULT_FRAME_CONTENT_RADIUS,
      avatar_fit: DEFAULT_FRAME_AVATAR_FIT,
      avatar_position: { ...DEFAULT_FRAME_AVATAR_POSITION },
      frame_box: { ...DEFAULT_FRAME_BOX },
    }),
    analysis: {
      visible_box: normalizePixelBox(visible, safeWidth, safeHeight),
      opening_box: normalizePixelBox(opening, safeWidth, safeHeight),
      confidence,
      confidence_score: confidenceScore,
      needs_manual_review: confidence !== "high",
      reason: reasons.length ? reasons.join("; ") : "ouverture centrale isolee detectee",
    },
  };
}

export function buildFrameRenderMetadataFromImageData(imageData, options = {}) {
  return analyzeFrameAlphaGeometry(
    {
      width: imageData?.width,
      height: imageData?.height,
      rgbaData: imageData?.data,
    },
    options,
  );
}

export function normalizeProfileCosmeticAsset(row) {
  if (!row) return null;
  const type = normalizeProfileCosmeticType(row.assetType || row.asset_type);
  if (!type) return null;
  const collection = row.collection || row.portal_cosmetic_collections || {};
  const collectionIsActive = row.collectionIsActive ?? row.collection_is_active ?? collection.isActive ?? collection.is_active;
  const collectionIsPublic = row.collectionIsPublic ?? row.collection_is_public ?? collection.isPublic ?? collection.is_public;
  const isActive = row.isActive ?? row.is_active;
  const access = row.access && typeof row.access === "object" && !Array.isArray(row.access) ? row.access : null;
  const unlocked =
    typeof access?.unlocked === "boolean"
      ? access.unlocked
      : typeof row.unlocked === "boolean"
      ? row.unlocked
      : typeof row.locked === "boolean"
        ? !row.locked
        : Boolean(collectionIsActive && collectionIsPublic);

  return {
    id: row.id || null,
    collectionId: row.collectionId || row.collection_id || collection.id || null,
    collectionKey: collection.collectionKey || collection.collection_key || row.collectionKey || row.collection_key || "",
    collectionName: collection.displayName || collection.display_name || row.collectionName || row.collection_name || "",
    assetKey: row.assetKey || row.asset_key || "",
    displayName: row.displayName || row.display_name || row.assetKey || row.asset_key || "",
    assetType: type,
    url: row.url || row.assetUrl || row.asset_url || "",
    assetUrl: row.assetUrl || row.asset_url || row.url || "",
    isActive: Boolean(isActive),
    sortOrder: Number(row.sortOrder ?? row.sort_order ?? 0),
    metadata: normalizeProfileCosmeticMetadata(row.metadata),
    access,
    unlocked,
    locked: !unlocked,
  };
}

export function buildProfileCosmeticsCatalog(assetRows = []) {
  const assets = assetRows
    .map(normalizeProfileCosmeticAsset)
    .filter(Boolean)
    .filter((asset) => asset.isActive)
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
      return left.displayName.localeCompare(right.displayName, "fr", { sensitivity: "base" });
    });

  const collectionsByKey = new Map();
  for (const asset of assets) {
    const key = asset.collectionKey || "unknown";
    if (!collectionsByKey.has(key)) {
      collectionsByKey.set(key, {
        collectionKey: key,
        displayName: asset.collectionName || key,
        avatars: [],
        frames: [],
      });
    }

    const collection = collectionsByKey.get(key);
    if (asset.assetType === PROFILE_COSMETIC_AVATAR) collection.avatars.push(asset);
    if (asset.assetType === PROFILE_COSMETIC_FRAME) collection.frames.push(asset);
  }

  return {
    assets,
    avatars: assets.filter((asset) => asset.assetType === PROFILE_COSMETIC_AVATAR),
    frames: assets.filter((asset) => asset.assetType === PROFILE_COSMETIC_FRAME),
    collections: [...collectionsByKey.values()],
  };
}

export function resolveProfileCosmeticSelection(selectionRow, assetRows = []) {
  const catalog = buildProfileCosmeticsCatalog(assetRows);
  const assetById = new Map(catalog.assets.map((asset) => [String(asset.id), asset]));
  const avatarId = cleanProfileCosmeticText(selectionRow?.selectedAvatarId || selectionRow?.selected_avatar_id);
  const frameId = cleanProfileCosmeticText(selectionRow?.selectedFrameId || selectionRow?.selected_frame_id);
  const avatar = avatarId ? assetById.get(avatarId) || null : null;
  const frame = frameId && avatar ? assetById.get(frameId) || null : null;

  return {
    avatar,
    frame,
    selectedAvatarId: avatar?.id || null,
    selectedFrameId: frame?.id || null,
    updatedAt: selectionRow?.updatedAt || selectionRow?.updated_at || null,
  };
}
