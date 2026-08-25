/* global process */
import { createClient } from "@supabase/supabase-js";
import {
  applyPortalCorsHeaders,
  readJsonBody,
  requirePortalLeaderSession,
  sendPortalJson,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";
import {
  PROFILE_COSMETIC_ASSET_SELECT,
  isMissingProfileCosmeticsSchema,
  loadProfileCosmeticAssetRows,
  saveProfileCosmeticFrameMetadata,
  serializeProfileCosmeticsCatalog,
} from "./_portal-cosmetics.js";
import { isMissingCosmeticAccessSchema } from "./_portal-cosmetic-access.js";
import { publishProfileCosmeticAsset, publishProfileCosmeticEffect } from "./_portal-cosmetics-publish.js";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "7mb",
    },
  },
};

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function cleanText(value, maxLength = 240) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanLongText(value, maxLength = 1000) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeAccessType(value) {
  const type = cleanText(value, 40).toLowerCase();
  return ["basic", "tier", "manual"].includes(type) ? type : "";
}

function normalizeTierType(value) {
  const type = cleanText(value, 40).toLowerCase();
  return ["support_total", "monthly_loyalty"].includes(type) ? type : "";
}

function readPositiveInteger(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return 0;
  return numeric;
}

function eurosToCents(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric * 100);
}

function serializeTier(row) {
  return {
    id: row.id,
    tierType: row.tier_type,
    thresholdValue: Number(row.threshold_value || 0),
    displayName: row.display_name || "",
    publicDescription: row.public_description || "",
    sortOrder: Number(row.sort_order || 0),
    isActive: row.is_active !== false,
  };
}

function serializeRule(row) {
  return {
    assetId: row.asset_id,
    accessType: row.access_type || "basic",
    tierId: row.tier_id || null,
    publicUnlockTitle: row.public_unlock_title || "",
    publicUnlockDescription: row.public_unlock_description || "",
  };
}

function serializeGrant(row) {
  return {
    id: row.id,
    memberId: row.member_id,
    assetId: row.asset_id,
    grantTitle: row.grant_title || "",
    grantDescription: row.grant_description || "",
    grantedAt: row.granted_at || null,
    revokedAt: row.revoked_at || null,
    asset: row.asset
      ? {
          id: row.asset.id,
          displayName: row.asset.display_name || "",
          assetType: row.asset.asset_type || "",
          assetUrl: row.asset.asset_url || "",
        }
      : null,
  };
}

async function loadAccessAdminData(req, res) {
  let assetRows = [];
  try {
    assetRows = await loadProfileCosmeticAssetRows(supabase);
  } catch (error) {
    if (isMissingProfileCosmeticsSchema(error)) {
      sendPortalJson(res, 200, {
        ok: true,
        schemaReady: false,
        accessSchemaReady: false,
        catalog: serializeProfileCosmeticsCatalog([]),
        tiers: [],
        rules: [],
      }, req);
      return;
    }
    throw error;
  }

  try {
    const [tiersResult, rulesResult] = await Promise.all([
      supabase
        .from("portal_cosmetic_unlock_tiers")
        .select("id, tier_type, threshold_value, display_name, public_description, sort_order, is_active")
        .order("tier_type", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("threshold_value", { ascending: true }),
      supabase
        .from("portal_cosmetic_access_rules")
        .select("asset_id, access_type, tier_id, public_unlock_title, public_unlock_description"),
    ]);

    if (tiersResult.error) throw tiersResult.error;
    if (rulesResult.error) throw rulesResult.error;

    sendPortalJson(res, 200, {
      ok: true,
      schemaReady: true,
      accessSchemaReady: true,
      catalog: serializeProfileCosmeticsCatalog(assetRows),
      tiers: (tiersResult.data || []).map(serializeTier),
      rules: (rulesResult.data || []).map(serializeRule),
    }, req);
  } catch (error) {
    if (isMissingCosmeticAccessSchema(error)) {
      sendPortalJson(res, 200, {
        ok: true,
        schemaReady: true,
        accessSchemaReady: false,
        catalog: serializeProfileCosmeticsCatalog(assetRows),
        tiers: [],
        rules: [],
        error: "Installe scripts/profile_cosmetics_access.sql pour gérer les classifications.",
      }, req);
      return;
    }
    throw error;
  }
}

async function upsertTier(req, res, leader, body) {
  const tierType = normalizeTierType(body.tierType || body.tier_type);
  const displayName = cleanText(body.displayName || body.display_name, 120);
  const publicDescription = cleanLongText(body.publicDescription || body.public_description, 500);
  const sortOrder = Math.round(Number(body.sortOrder ?? body.sort_order ?? 0));
  const isActive = body.isActive === undefined && body.is_active === undefined
    ? true
    : Boolean(body.isActive ?? body.is_active);
  const thresholdValue = tierType === "support_total"
    ? eurosToCents(body.thresholdEuros ?? body.threshold_euros ?? body.thresholdValue ?? body.threshold_value)
    : readPositiveInteger(body.thresholdValue ?? body.threshold_value);

  if (!tierType || !displayName || !thresholdValue) {
    sendPortalJson(res, 400, { error: "Palier cosmetique invalide." }, req);
    return;
  }

  const payload = {
    tier_type: tierType,
    threshold_value: thresholdValue,
    display_name: displayName,
    public_description: publicDescription || null,
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
    is_active: isActive,
  };
  const tierId = cleanText(body.tierId || body.tier_id, 120);
  const query = tierId
    ? supabase
        .from("portal_cosmetic_unlock_tiers")
        .update(payload)
        .eq("id", tierId)
        .select("id, tier_type, threshold_value, display_name, public_description, sort_order, is_active")
        .single()
    : supabase
        .from("portal_cosmetic_unlock_tiers")
        .insert(payload)
        .select("id, tier_type, threshold_value, display_name, public_description, sort_order, is_active")
        .single();
  const { data, error } = await query;
  if (error) throw error;

  sendPortalJson(res, 200, { ok: true, tier: serializeTier(data), updatedByMemberId: leader.member.id }, req);
}

async function deleteTier(req, res, body) {
  const tierId = cleanText(body.tierId || body.tier_id, 120);
  if (!tierId) {
    sendPortalJson(res, 400, { error: "Palier manquant." }, req);
    return;
  }

  const { error } = await supabase.from("portal_cosmetic_unlock_tiers").delete().eq("id", tierId);
  if (error) throw error;
  sendPortalJson(res, 200, { ok: true, deletedTierId: tierId }, req);
}

async function setAccessRule(req, res, leader, body) {
  const assetId = cleanText(body.assetId || body.asset_id, 120);
  const accessType = normalizeAccessType(body.accessType || body.access_type);
  const tierId = cleanText(body.tierId || body.tier_id, 120) || null;
  const requestedTierType = normalizeTierType(body.tierType || body.tier_type);
  const title = cleanText(body.publicUnlockTitle || body.public_unlock_title, 160);
  const description = cleanLongText(body.publicUnlockDescription || body.public_unlock_description, 500);

  if (!assetId || !accessType) {
    sendPortalJson(res, 400, { error: "Regle cosmetique invalide." }, req);
    return;
  }
  if (accessType === "tier" && !tierId) {
    sendPortalJson(res, 400, { error: "Un palier est requis pour cette regle." }, req);
    return;
  }
  if (accessType === "manual" && !title) {
    sendPortalJson(res, 400, { error: "Un titre public est requis pour une recompense manuelle." }, req);
    return;
  }

  const { data: asset, error: assetError } = await supabase
    .from("portal_cosmetic_assets")
    .select("id")
    .eq("id", assetId)
    .maybeSingle();
  if (assetError) throw assetError;
  if (!asset) {
    sendPortalJson(res, 404, { error: "Cosmetique introuvable." }, req);
    return;
  }

  if (accessType === "tier") {
    const { data: tier, error: tierError } = await supabase
      .from("portal_cosmetic_unlock_tiers")
      .select("id, tier_type, is_active")
      .eq("id", tierId)
      .maybeSingle();
    if (tierError) throw tierError;
    if (!tier || tier.is_active === false) {
      sendPortalJson(res, 400, { error: "Palier cosmetique invalide." }, req);
      return;
    }
    if (requestedTierType && tier.tier_type !== requestedTierType) {
      sendPortalJson(res, 400, { error: "Le palier ne correspond pas a cette classification." }, req);
      return;
    }
  }

  const payload = {
    asset_id: assetId,
    access_type: accessType,
    tier_id: accessType === "tier" ? tierId : null,
    public_unlock_title: title || null,
    public_unlock_description: description || null,
    updated_by_member_id: leader.member.id,
  };
  const { data, error } = await supabase
    .from("portal_cosmetic_access_rules")
    .upsert(payload, { onConflict: "asset_id" })
    .select("asset_id, access_type, tier_id, public_unlock_title, public_unlock_description")
    .single();
  if (error) throw error;
  sendPortalJson(res, 200, { ok: true, rule: serializeRule(data) }, req);
}

async function searchMembers(req, res, queryValue) {
  const query = cleanText(queryValue, 80);
  if (query.length < 2) {
    sendPortalJson(res, 200, { ok: true, members: [] }, req);
    return;
  }
  const escaped = query.replace(/[%_,]/g, "");
  const { data, error } = await supabase
    .from("guild_members")
    .select("id, watcher_name, discord_id, guild_code, role, community_status")
    .or(`watcher_name.ilike.%${escaped}%,discord_id.ilike.%${escaped}%`)
    .order("watcher_name", { ascending: true })
    .limit(20);
  if (error) throw error;
  sendPortalJson(res, 200, {
    ok: true,
    members: (data || []).map((member) => ({
      id: member.id,
      watcherName: member.watcher_name || "",
      discordId: member.discord_id || "",
      guildCode: member.guild_code || "",
      role: member.role || "",
      communityStatus: member.community_status || "",
    })),
  }, req);
}

async function loadMemberGrants(req, res, memberIdValue) {
  const memberId = cleanText(memberIdValue, 120);
  if (!memberId) {
    sendPortalJson(res, 400, { error: "Membre manquant." }, req);
    return;
  }
  const { data, error } = await supabase
    .from("portal_member_cosmetic_grants")
    .select(`
      id,
      member_id,
      asset_id,
      grant_title,
      grant_description,
      granted_at,
      revoked_at,
      asset:portal_cosmetic_assets (
        id,
        display_name,
        asset_type,
        asset_url
      )
    `)
    .eq("member_id", memberId)
    .order("granted_at", { ascending: false });
  if (error) throw error;
  sendPortalJson(res, 200, { ok: true, grants: (data || []).map(serializeGrant) }, req);
}

async function grantCosmetic(req, res, leader, body) {
  const memberId = cleanText(body.memberId || body.member_id, 120);
  const assetId = cleanText(body.assetId || body.asset_id, 120);
  const grantTitle = cleanText(body.grantTitle || body.grant_title, 160);
  const grantDescription = cleanLongText(body.grantDescription || body.grant_description, 500);
  if (!memberId || !assetId || !grantTitle) {
    sendPortalJson(res, 400, { error: "Attribution cosmetique incomplete." }, req);
    return;
  }

  const { data: existing, error: existingError } = await supabase
    .from("portal_member_cosmetic_grants")
    .select("id")
    .eq("member_id", memberId)
    .eq("asset_id", assetId)
    .is("revoked_at", null)
    .maybeSingle();
  if (existingError) throw existingError;

  const payload = {
    grant_title: grantTitle,
    grant_description: grantDescription || null,
    granted_by_member_id: leader.member.id,
  };
  const query = existing?.id
    ? supabase
        .from("portal_member_cosmetic_grants")
        .update(payload)
        .eq("id", existing.id)
        .select("id, member_id, asset_id, grant_title, grant_description, granted_at, revoked_at")
        .single()
    : supabase
        .from("portal_member_cosmetic_grants")
        .insert({
          member_id: memberId,
          asset_id: assetId,
          ...payload,
          metadata: {},
        })
        .select("id, member_id, asset_id, grant_title, grant_description, granted_at, revoked_at")
        .single();

  const { data, error } = await query;
  if (error) throw error;
  sendPortalJson(res, 200, { ok: true, grant: serializeGrant(data) }, req);
}

async function revokeGrant(req, res, body) {
  const grantId = cleanText(body.grantId || body.grant_id, 120);
  if (!grantId) {
    sendPortalJson(res, 400, { error: "Attribution manquante." }, req);
    return;
  }
  const { data, error } = await supabase
    .from("portal_member_cosmetic_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", grantId)
    .is("revoked_at", null)
    .select("id, member_id, asset_id, grant_title, grant_description, granted_at, revoked_at")
    .single();
  if (error) throw error;
  sendPortalJson(res, 200, { ok: true, grant: serializeGrant(data) }, req);
}

export default async function handler(req, res) {
  try {
    applyPortalCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (!["GET", "POST"].includes(req.method)) {
      sendPortalJson(res, 405, { error: "Method not allowed" }, req);
      return;
    }

    if (!verifyPortalRequestOrigin(req)) {
      sendPortalJson(res, 403, { error: "Origine de la requete refusee." }, req);
      return;
    }

    const leader = await requirePortalLeaderSession(req, supabase);
    if (leader.error) {
      sendPortalJson(res, leader.status || 403, { error: leader.error }, req);
      return;
    }

    if (req.method === "GET") {
      const action = cleanText(req.query?.action || req.query?.intent, 80).toLowerCase();
      if (action === "search-members") {
        await searchMembers(req, res, req.query?.q || req.query?.query);
        return;
      }
      if (action === "member-grants") {
        await loadMemberGrants(req, res, req.query?.memberId || req.query?.member_id);
        return;
      }
      await loadAccessAdminData(req, res);
      return;
    }

    const body = await readJsonBody(req);
    const action = cleanText(body.action, 80).toLowerCase();

    if (action === "publish-cosmetic-asset") {
      const state = await publishProfileCosmeticAsset(supabase, leader.member, body);
      sendPortalJson(res, 200, state, req);
      return;
    }
    if (action === "publish-cosmetic-effect") {
      const result = await publishProfileCosmeticEffect(body);
      sendPortalJson(res, 200, result, req);
      return;
    }
    if (action === "save-frame-render-metadata" || action === "save-frame-metadata") {
      const state = await saveProfileCosmeticFrameMetadata(supabase, leader.member, body);
      sendPortalJson(res, 200, state, req);
      return;
    }
    if (action === "upsert-tier") {
      await upsertTier(req, res, leader, body);
      return;
    }
    if (action === "delete-tier") {
      await deleteTier(req, res, body);
      return;
    }
    if (action === "set-access-rule") {
      await setAccessRule(req, res, leader, body);
      return;
    }
    if (action === "grant-cosmetic") {
      await grantCosmetic(req, res, leader, body);
      return;
    }
    if (action === "revoke-grant") {
      await revokeGrant(req, res, body);
      return;
    }

    sendPortalJson(res, 400, { error: "Action admin cosmetiques inconnue." }, req);
  } catch (error) {
    const missingSchema = isMissingProfileCosmeticsSchema(error) || isMissingCosmeticAccessSchema(error);
    sendPortalJson(res, missingSchema ? 409 : error.status || error.statusCode || 500, {
      error: missingSchema
        ? "Tables des cosmetiques de profil incompletes. Execute les migrations cosmetiques."
        : error?.message || "Erreur admin cosmetiques.",
    }, req);
  }
}
