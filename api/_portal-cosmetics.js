import {
  PROFILE_COSMETIC_AVATAR,
  PROFILE_COSMETIC_FRAME,
  buildProfileCosmeticsCatalog,
  cleanProfileCosmeticText,
  normalizeProfileCosmeticAsset,
  resolveProfileCosmeticSelection,
} from "../src/lib/profileCosmetics.js";

export const PROFILE_COSMETIC_ASSET_SELECT = `
  id,
  collection_id,
  asset_key,
  display_name,
  asset_type,
  asset_url,
  is_active,
  sort_order,
  metadata,
  collection:portal_cosmetic_collections (
    id,
    collection_key,
    display_name,
    is_public,
    is_active,
    sort_order
  )
`;

export const PROFILE_COSMETIC_SELECTION_SELECT = `
  member_id,
  selected_avatar_id,
  selected_frame_id,
  updated_at
`;

export function isMissingProfileCosmeticsSchema(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    error?.code === "PGRST205" ||
    message.includes("portal_cosmetic_collections") ||
    message.includes("portal_cosmetic_assets") ||
    message.includes("portal_member_cosmetics")
  );
}

export function serializeProfileCosmeticAsset(row) {
  return normalizeProfileCosmeticAsset(row);
}

export function serializeProfileCosmeticsCatalog(rows = []) {
  return buildProfileCosmeticsCatalog(rows.map(serializeProfileCosmeticAsset).filter(Boolean));
}

function buildEmptyProfileCosmeticsState(member) {
  return {
    ok: true,
    schemaReady: false,
    member: {
      id: member?.id || null,
      displayName: member?.watcher_name || member?.discord_id || "Joueur",
    },
    catalog: {
      assets: [],
      avatars: [],
      frames: [],
      collections: [],
    },
    selection: {
      avatar: null,
      frame: null,
      selectedAvatarId: null,
      selectedFrameId: null,
      updatedAt: null,
    },
  };
}

export function validateProfileCosmeticSelection({ assets = [], selectedAvatarId = "", selectedFrameId = "" }) {
  const catalog = serializeProfileCosmeticsCatalog(assets);
  const assetsById = new Map(catalog.assets.map((asset) => [String(asset.id), asset]));
  const avatarId = cleanProfileCosmeticText(selectedAvatarId);
  const frameId = cleanProfileCosmeticText(selectedFrameId);

  if (frameId && !avatarId) {
    const error = new Error("Un cadre ne peut pas etre selectionne sans avatar.");
    error.statusCode = 400;
    throw error;
  }

  const avatar = avatarId ? assetsById.get(avatarId) : null;
  if (avatarId && (!avatar || avatar.assetType !== PROFILE_COSMETIC_AVATAR || !avatar.isActive || !avatar.unlocked)) {
    const error = new Error("Avatar indisponible.");
    error.statusCode = 400;
    throw error;
  }

  const frame = frameId ? assetsById.get(frameId) : null;
  if (frameId && (!frame || frame.assetType !== PROFILE_COSMETIC_FRAME || !frame.isActive || !frame.unlocked)) {
    const error = new Error("Cadre indisponible.");
    error.statusCode = 400;
    throw error;
  }

  return {
    selectedAvatarId: avatar?.id || null,
    selectedFrameId: frame?.id || null,
    avatar,
    frame,
  };
}

async function loadProfileCosmeticAssetRows(supabase) {
  const { data, error } = await supabase
    .from("portal_cosmetic_assets")
    .select(PROFILE_COSMETIC_ASSET_SELECT)
    .order("asset_type", { ascending: true })
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function loadProfileCosmeticSelectionRow(supabase, memberId) {
  const { data, error } = await supabase
    .from("portal_member_cosmetics")
    .select(PROFILE_COSMETIC_SELECTION_SELECT)
    .eq("member_id", memberId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function loadProfileCosmeticsState(supabase, member) {
  try {
    const [assetRows, selectionRow] = await Promise.all([
      loadProfileCosmeticAssetRows(supabase),
      loadProfileCosmeticSelectionRow(supabase, member.id),
    ]);
    const catalog = serializeProfileCosmeticsCatalog(assetRows);
    const selection = resolveProfileCosmeticSelection(selectionRow, catalog.assets);

    return {
      ok: true,
      schemaReady: true,
      member: {
        id: member?.id || null,
        displayName: member?.watcher_name || member?.discord_id || "Joueur",
      },
      catalog,
      selection,
    };
  } catch (error) {
    if (isMissingProfileCosmeticsSchema(error)) {
      return buildEmptyProfileCosmeticsState(member);
    }
    throw error;
  }
}

export async function saveProfileCosmeticsSelection(supabase, member, body = {}) {
  const assetRows = await loadProfileCosmeticAssetRows(supabase);
  const selection = validateProfileCosmeticSelection({
    assets: assetRows,
    selectedAvatarId: body.selectedAvatarId || body.selected_avatar_id,
    selectedFrameId: body.selectedFrameId || body.selected_frame_id,
  });

  const { error } = await supabase
    .from("portal_member_cosmetics")
    .upsert(
      {
        member_id: member.id,
        selected_avatar_id: selection.selectedAvatarId,
        selected_frame_id: selection.selectedFrameId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "member_id" },
    );

  if (error) throw error;
  return loadProfileCosmeticsState(supabase, member);
}

export async function loadCosmeticsForMemberIds(supabase, memberIds = []) {
  const ids = [...new Set((memberIds || []).map((value) => cleanProfileCosmeticText(value)).filter(Boolean))];
  if (!ids.length) return new Map();

  const selectionResult = await supabase
    .from("portal_member_cosmetics")
    .select(PROFILE_COSMETIC_SELECTION_SELECT)
    .in("member_id", ids);

  if (selectionResult.error) {
    if (isMissingProfileCosmeticsSchema(selectionResult.error)) return new Map();
    throw selectionResult.error;
  }

  const selectionRows = selectionResult.data || [];
  const assetIds = [
    ...new Set(
      selectionRows
        .flatMap((row) => [row.selected_avatar_id, row.selected_frame_id])
        .map((value) => cleanProfileCosmeticText(value))
        .filter(Boolean),
    ),
  ];

  if (!assetIds.length) return new Map();

  const assetsResult = await supabase
    .from("portal_cosmetic_assets")
    .select(PROFILE_COSMETIC_ASSET_SELECT)
    .in("id", assetIds);

  if (assetsResult.error) {
    if (isMissingProfileCosmeticsSchema(assetsResult.error)) return new Map();
    throw assetsResult.error;
  }

  const catalog = serializeProfileCosmeticsCatalog(assetsResult.data || []);
  const cosmeticsByMemberId = new Map();
  for (const row of selectionRows) {
    const selection = resolveProfileCosmeticSelection(row, catalog.assets);
    cosmeticsByMemberId.set(String(row.member_id), {
      avatar: selection.avatar,
      frame: selection.frame,
    });
  }

  return cosmeticsByMemberId;
}
