import {
  PROFILE_COSMETIC_AVATAR,
  PROFILE_COSMETIC_FRAME,
  buildProfileCosmeticsCatalog,
  cleanProfileCosmeticText,
  normalizeFrameRenderMetadataForStorage,
  normalizeProfileCosmeticAsset,
  normalizeProfileCosmeticMetadata,
  normalizeProfileCosmeticType,
  resolveProfileCosmeticSelection,
} from "../src/lib/profileCosmetics.js";
import {
  buildMemberCosmeticProgress,
  buildProfileCosmeticAccessCatalog,
  decorateCosmeticAssetsForMember,
  loadCosmeticAccessContext,
} from "./_portal-cosmetic-access.js";

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
    accessSchemaReady: false,
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
    progress: {
      supportTotalCents: 0,
      monthlyConfirmedCount: 0,
      tiers: [],
      nextSupportTier: null,
      nextMonthlyTier: null,
    },
  };
}

function getUnlockedCosmeticAssets(assets = []) {
  return (assets || []).filter((asset) => asset?.isActive && asset?.unlocked && !asset?.locked);
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

export async function loadProfileCosmeticAssetRows(supabase) {
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
    const accessContext = await loadCosmeticAccessContext(supabase, [member.id]);
    const catalog = buildProfileCosmeticAccessCatalog({
      assetRows,
      member,
      ...accessContext,
    });
    const selection = resolveProfileCosmeticSelection(selectionRow, getUnlockedCosmeticAssets(catalog.assets));

    return {
      ok: true,
      schemaReady: true,
      accessSchemaReady: accessContext.accessSchemaReady,
      member: {
        id: member?.id || null,
        displayName: member?.watcher_name || member?.discord_id || "Joueur",
      },
      catalog,
      selection,
      progress: buildMemberCosmeticProgress({ member, accessContext }),
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
  const accessContext = await loadCosmeticAccessContext(supabase, [member.id]);
  const decoratedAssets = decorateCosmeticAssetsForMember({
    assetRows,
    member,
    ...accessContext,
  });
  const selection = validateProfileCosmeticSelection({
    assets: decoratedAssets,
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

export async function saveProfileCosmeticFrameMetadata(supabase, member, body = {}) {
  const allowedBodyKeys = new Set(["action", "assetId", "asset_id", "metadata", "renderMetadata"]);
  for (const key of Object.keys(body || {})) {
    if (!allowedBodyKeys.has(key)) {
      const error = new Error(`Le champ ${key} n'est pas autorise pour cette action.`);
      error.statusCode = 400;
      throw error;
    }
  }

  const assetId = cleanProfileCosmeticText(body.assetId || body.asset_id, 120);
  if (!assetId) {
    const error = new Error("Cadre manquant.");
    error.statusCode = 400;
    throw error;
  }

  const { data: asset, error: assetError } = await supabase
    .from("portal_cosmetic_assets")
    .select(PROFILE_COSMETIC_ASSET_SELECT)
    .eq("id", assetId)
    .maybeSingle();

  if (assetError) throw assetError;
  if (!asset || normalizeProfileCosmeticType(asset.asset_type || asset.assetType) !== PROFILE_COSMETIC_FRAME) {
    const error = new Error("Cadre introuvable.");
    error.statusCode = 404;
    throw error;
  }

  const previousMetadata = normalizeProfileCosmeticMetadata(asset.metadata);
  const renderMetadataPayload = body.metadata ?? body.renderMetadata;
  const renderMetadata = normalizeFrameRenderMetadataForStorage(renderMetadataPayload);
  const nextMetadata = {
    ...previousMetadata,
    ...renderMetadata,
  };

  const { data: updatedAsset, error } = await supabase
    .from("portal_cosmetic_assets")
    .update({ metadata: nextMetadata })
    .eq("id", assetId)
    .select(PROFILE_COSMETIC_ASSET_SELECT)
    .single();

  if (error) throw error;
  const state = await loadProfileCosmeticsState(supabase, member);
  return {
    ...state,
    savedAsset: serializeProfileCosmeticAsset(updatedAsset),
  };
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

  const [assetsResult, membersResult, accessContext] = await Promise.all([
    supabase
      .from("portal_cosmetic_assets")
      .select(PROFILE_COSMETIC_ASSET_SELECT)
      .in("id", assetIds),
    supabase
      .from("guild_members")
      .select("id, watcher_name, role")
      .in("id", ids),
    loadCosmeticAccessContext(supabase, ids),
  ]);

  if (assetsResult.error) {
    if (isMissingProfileCosmeticsSchema(assetsResult.error)) return new Map();
    throw assetsResult.error;
  }
  if (membersResult.error) throw membersResult.error;

  const assetRows = assetsResult.data || [];
  const memberById = new Map((membersResult.data || []).map((member) => [String(member.id), member]));
  const cosmeticsByMemberId = new Map();
  for (const row of selectionRows) {
    const member = memberById.get(String(row.member_id)) || { id: row.member_id };
    const catalog = buildProfileCosmeticAccessCatalog({
      assetRows,
      member,
      ...accessContext,
    });
    const selection = resolveProfileCosmeticSelection(row, getUnlockedCosmeticAssets(catalog.assets));
    if (selection.avatar || selection.frame) {
      cosmeticsByMemberId.set(String(row.member_id), {
        avatar: selection.avatar,
        frame: selection.frame,
      });
    }
  }

  return cosmeticsByMemberId;
}
