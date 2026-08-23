export const PROFILE_COSMETIC_AVATAR = "avatar";
export const PROFILE_COSMETIC_FRAME = "frame";
export const PROFILE_COSMETIC_ASSET_TYPES = new Set([PROFILE_COSMETIC_AVATAR, PROFILE_COSMETIC_FRAME]);
export const DEFAULT_FRAME_CONTENT_INSET = 0.14;

export function cleanProfileCosmeticText(value, maxLength = 240) {
  return String(value || "").trim().slice(0, maxLength);
}

export function normalizeProfileCosmeticType(value) {
  const type = cleanProfileCosmeticText(value).toLowerCase();
  return PROFILE_COSMETIC_ASSET_TYPES.has(type) ? type : "";
}

export function normalizeProfileCosmeticMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

export function getFrameContentInset(frame) {
  const metadata = normalizeProfileCosmeticMetadata(frame?.metadata);
  const inset = Number(metadata.contentInset ?? metadata.content_inset ?? DEFAULT_FRAME_CONTENT_INSET);
  if (!Number.isFinite(inset)) return DEFAULT_FRAME_CONTENT_INSET;
  return Math.min(0.35, Math.max(0, inset));
}

export function normalizeProfileCosmeticAsset(row) {
  if (!row) return null;
  const type = normalizeProfileCosmeticType(row.assetType || row.asset_type);
  if (!type) return null;
  const collection = row.collection || row.portal_cosmetic_collections || {};
  const collectionIsActive = row.collectionIsActive ?? row.collection_is_active ?? collection.isActive ?? collection.is_active;
  const collectionIsPublic = row.collectionIsPublic ?? row.collection_is_public ?? collection.isPublic ?? collection.is_public;
  const isActive = row.isActive ?? row.is_active;
  const unlocked =
    typeof row.unlocked === "boolean"
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
