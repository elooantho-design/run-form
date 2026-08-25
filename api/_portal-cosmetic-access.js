/* global process */
import { isPortalSupportLiveMode } from "../src/lib/portalSupportConfig.js";
import {
  buildProfileCosmeticsCatalog,
  cleanProfileCosmeticText,
  normalizeProfileCosmeticAsset,
} from "../src/lib/profileCosmetics.js";
import { isPortalLeaderRole } from "./_portal-auth.js";

export const COSMETIC_ACCESS_BASIC = "basic";
export const COSMETIC_ACCESS_TIER = "tier";
export const COSMETIC_ACCESS_MANUAL = "manual";
export const COSMETIC_TIER_SUPPORT_TOTAL = "support_total";
export const COSMETIC_TIER_MONTHLY_LOYALTY = "monthly_loyalty";

const COSMETIC_ACCESS_TYPES = new Set([
  COSMETIC_ACCESS_BASIC,
  COSMETIC_ACCESS_TIER,
  COSMETIC_ACCESS_MANUAL,
]);
const COSMETIC_TIER_TYPES = new Set([
  COSMETIC_TIER_SUPPORT_TOTAL,
  COSMETIC_TIER_MONTHLY_LOYALTY,
]);

function normalizeAccessType(value) {
  const type = cleanProfileCosmeticText(value, 40).toLowerCase();
  return COSMETIC_ACCESS_TYPES.has(type) ? type : COSMETIC_ACCESS_BASIC;
}

function normalizeTierType(value) {
  const type = cleanProfileCosmeticText(value, 40).toLowerCase();
  return COSMETIC_TIER_TYPES.has(type) ? type : "";
}

function numberOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function netPaymentCents(payment) {
  return Math.max(0, Math.round(numberOrZero(payment?.amount_cents) - numberOrZero(payment?.amount_refunded_cents)));
}

export function isMissingCosmeticAccessSchema(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    error?.code === "PGRST205" ||
    message.includes("portal_cosmetic_unlock_tiers") ||
    message.includes("portal_cosmetic_access_rules") ||
    message.includes("portal_member_cosmetic_grants")
  );
}

export function isMissingCosmeticSupportSchema(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    error?.code === "PGRST205" ||
    message.includes("portal_support_payments") ||
    message.includes("amount_refunded_cents") ||
    message.includes("livemode")
  );
}

export function isLeaderCosmeticMember(member) {
  return Boolean(member?.isLeader || member?.leader || isPortalLeaderRole(member?.role));
}

export function buildSupportStatsByMember(payments = [], env = process.env) {
  const livemode = isPortalSupportLiveMode(env);
  const statsByMember = new Map();

  for (const payment of payments || []) {
    const memberId = cleanProfileCosmeticText(payment?.member_id, 120);
    if (!memberId) continue;
    if (Boolean(payment?.livemode) !== livemode) continue;
    if (payment?.status !== "confirmed") continue;

    const current = statsByMember.get(memberId) || {
      memberId,
      supportTotalCents: 0,
      monthlyConfirmedCount: 0,
    };
    const netCents = netPaymentCents(payment);
    current.supportTotalCents += netCents;
    if (payment?.support_type === "monthly" && netCents > 0) {
      current.monthlyConfirmedCount += 1;
    }
    statsByMember.set(memberId, current);
  }

  return statsByMember;
}

export function buildPublicSupportRankings({ payments = [], cosmeticsByMemberId = new Map(), env = process.env } = {}) {
  const livemode = isPortalSupportLiveMode(env);
  const totals = new Map();
  const monthly = new Map();

  for (const payment of payments || []) {
    if (Boolean(payment?.livemode) !== livemode) continue;
    if (!payment?.display_publicly || payment?.anonymous) continue;
    const memberId = cleanProfileCosmeticText(payment?.member_id, 120);
    const publicName = cleanProfileCosmeticText(payment?.donor_public_name, 80);
    if (!memberId || !publicName) continue;

    const netCents = netPaymentCents(payment);
    if (payment?.status === "confirmed" && netCents > 0) {
      const currentTotal = totals.get(memberId) || { memberId, publicName, amountCents: 0 };
      currentTotal.amountCents += netCents;
      currentTotal.publicName = publicName;
      totals.set(memberId, currentTotal);
    }

    if (
      payment?.support_type === "monthly" &&
      ["active", "confirmed"].includes(String(payment?.status || "")) &&
      netCents > 0
    ) {
      const currentMonthly = monthly.get(memberId) || { memberId, publicName, amountCents: 0 };
      currentMonthly.amountCents = Math.max(currentMonthly.amountCents, netCents);
      currentMonthly.publicName = publicName;
      monthly.set(memberId, currentMonthly);
    }
  }

  const attachCosmetics = (entry) => ({
    ...entry,
    cosmetics: cosmeticsByMemberId.get(String(entry.memberId)) || null,
  });

  return {
    cumulative: [...totals.values()]
      .sort((left, right) => right.amountCents - left.amountCents || left.publicName.localeCompare(right.publicName, "fr"))
      .map(attachCosmetics),
    monthly: [...monthly.values()]
      .sort((left, right) => right.amountCents - left.amountCents || left.publicName.localeCompare(right.publicName, "fr"))
      .map(attachCosmetics),
  };
}

function mapRules(rows = []) {
  const rulesByAssetId = new Map();
  for (const row of rows || []) {
    const assetId = cleanProfileCosmeticText(row?.asset_id, 120);
    if (!assetId) continue;
    rulesByAssetId.set(assetId, {
      assetId,
      accessType: normalizeAccessType(row?.access_type),
      tierId: cleanProfileCosmeticText(row?.tier_id, 120) || null,
      publicUnlockTitle: cleanProfileCosmeticText(row?.public_unlock_title, 160),
      publicUnlockDescription: cleanProfileCosmeticText(row?.public_unlock_description, 500),
    });
  }
  return rulesByAssetId;
}

function mapTiers(rows = []) {
  const tiersById = new Map();
  for (const row of rows || []) {
    const id = cleanProfileCosmeticText(row?.id, 120);
    const tierType = normalizeTierType(row?.tier_type);
    if (!id || !tierType) continue;
    tiersById.set(id, {
      id,
      tierType,
      thresholdValue: Math.max(0, Math.round(numberOrZero(row?.threshold_value))),
      displayName: cleanProfileCosmeticText(row?.display_name, 160),
      publicDescription: cleanProfileCosmeticText(row?.public_description, 500),
      sortOrder: Math.round(numberOrZero(row?.sort_order)),
      isActive: row?.is_active !== false,
    });
  }
  return tiersById;
}

function mapActiveGrants(rows = []) {
  const grantsByMemberAsset = new Map();
  for (const row of rows || []) {
    if (row?.revoked_at) continue;
    const memberId = cleanProfileCosmeticText(row?.member_id, 120);
    const assetId = cleanProfileCosmeticText(row?.asset_id, 120);
    if (!memberId || !assetId) continue;
    grantsByMemberAsset.set(`${memberId}:${assetId}`, {
      id: row?.id || null,
      memberId,
      assetId,
      grantTitle: cleanProfileCosmeticText(row?.grant_title, 160),
      grantDescription: cleanProfileCosmeticText(row?.grant_description, 500),
      grantedAt: row?.granted_at || null,
    });
  }
  return grantsByMemberAsset;
}

function assetCollectionIsVisible(asset) {
  return Boolean(asset?.collection?.is_active ?? asset?.collectionIsActive ?? asset?.collection_is_active);
}

function assetCollectionIsPublic(asset) {
  return Boolean(asset?.collection?.is_public ?? asset?.collectionIsPublic ?? asset?.collection_is_public);
}

function getDefaultAccessRule() {
  return {
    accessType: COSMETIC_ACCESS_BASIC,
    tierId: null,
    publicUnlockTitle: "",
    publicUnlockDescription: "",
  };
}

function buildLockedTitle(rule, tier) {
  if (rule?.publicUnlockTitle) return rule.publicUnlockTitle;
  if (tier?.displayName) return tier.displayName;
  if (tier?.tierType === COSMETIC_TIER_SUPPORT_TOTAL) {
    return "Palier de soutien cumule";
  }
  if (tier?.tierType === COSMETIC_TIER_MONTHLY_LOYALTY) {
    return "Palier de fidelite mensuelle";
  }
  if (rule?.accessType === COSMETIC_ACCESS_MANUAL) {
    return "Recompense speciale";
  }
  return "Accessible a tous";
}

function buildAccessForAsset({ member, rule, tier, grant, stats, accessSchemaReady }) {
  const accessType = accessSchemaReady ? normalizeAccessType(rule?.accessType) : COSMETIC_ACCESS_BASIC;
  const leader = isLeaderCosmeticMember(member);
  const currentValue =
    tier?.tierType === COSMETIC_TIER_SUPPORT_TOTAL
      ? stats.supportTotalCents
      : tier?.tierType === COSMETIC_TIER_MONTHLY_LOYALTY
        ? stats.monthlyConfirmedCount
        : null;
  const thresholdValue = tier?.thresholdValue || null;
  const title = grant?.grantTitle || buildLockedTitle({ ...rule, accessType }, tier);
  const description = grant?.grantDescription || rule?.publicUnlockDescription || tier?.publicDescription || "";

  if (leader) {
    return {
      unlocked: true,
      source: "leader_bypass",
      accessType,
      title,
      description,
      tierId: tier?.id || null,
      thresholdValue,
      currentValue,
    };
  }

  if (grant) {
    return {
      unlocked: true,
      source: "manual_grant",
      accessType,
      title,
      description,
      tierId: tier?.id || null,
      thresholdValue,
      currentValue,
    };
  }

  if (accessType === COSMETIC_ACCESS_BASIC) {
    return {
      unlocked: true,
      source: "basic",
      accessType,
      title,
      description,
      tierId: null,
      thresholdValue: null,
      currentValue: null,
    };
  }

  if (accessType === COSMETIC_ACCESS_TIER && tier?.isActive && thresholdValue) {
    const unlocked = Number(currentValue || 0) >= thresholdValue;
    return {
      unlocked,
      source: tier.tierType,
      accessType,
      title,
      description,
      tierId: tier.id,
      thresholdValue,
      currentValue,
    };
  }

  return {
    unlocked: false,
    source: accessType === COSMETIC_ACCESS_MANUAL ? "manual_grant" : "locked",
    accessType,
    title,
    description,
    tierId: tier?.id || null,
    thresholdValue,
    currentValue,
  };
}

export function decorateCosmeticAssetsForMember({
  assetRows = [],
  member,
  accessRules = [],
  unlockTiers = [],
  grants = [],
  supportPayments = [],
  accessSchemaReady = true,
  env = process.env,
} = {}) {
  const rulesByAssetId = mapRules(accessRules);
  const tiersById = mapTiers(unlockTiers);
  const grantsByMemberAsset = mapActiveGrants(grants);
  const memberId = cleanProfileCosmeticText(member?.id, 120);
  const stats = buildSupportStatsByMember(supportPayments, env).get(memberId) || {
    memberId,
    supportTotalCents: 0,
    monthlyConfirmedCount: 0,
  };

  return (assetRows || [])
    .map((row) => {
      const normalizedAsset = normalizeProfileCosmeticAsset(row);
      if (!normalizedAsset?.isActive) return null;
      if (!isLeaderCosmeticMember(member) && (!assetCollectionIsVisible(row) || !assetCollectionIsPublic(row))) return null;

      const rule = accessSchemaReady ? rulesByAssetId.get(String(normalizedAsset.id)) || getDefaultAccessRule() : getDefaultAccessRule();
      const tier = rule.tierId ? tiersById.get(String(rule.tierId)) || null : null;
      const grant = grantsByMemberAsset.get(`${memberId}:${normalizedAsset.id}`) || null;
      const access = buildAccessForAsset({
        member,
        rule,
        tier,
        grant,
        stats,
        accessSchemaReady,
      });

      return {
        ...row,
        access,
        unlocked: access.unlocked,
        locked: !access.unlocked,
      };
    })
    .filter(Boolean);
}

export function buildProfileCosmeticAccessCatalog(options = {}) {
  return buildProfileCosmeticsCatalog(decorateCosmeticAssetsForMember(options));
}

async function runAccessQuery(promise) {
  try {
    const result = await promise;
    if (result?.error) throw result.error;
    return { data: result?.data || [], missing: false };
  } catch (error) {
    if (isMissingCosmeticAccessSchema(error)) return { data: [], missing: true, error };
    throw error;
  }
}

async function runSupportQuery(promise) {
  try {
    const result = await promise;
    if (result?.error) throw result.error;
    return { data: result?.data || [], missing: false };
  } catch (error) {
    if (isMissingCosmeticSupportSchema(error)) return { data: [], missing: true, error };
    throw error;
  }
}

export async function loadCosmeticAccessContext(supabase, memberIds = [], env = process.env) {
  const ids = [...new Set((memberIds || []).map((value) => cleanProfileCosmeticText(value, 120)).filter(Boolean))];
  const livemode = isPortalSupportLiveMode(env);

  const grantsQuery = ids.length
    ? supabase
        .from("portal_member_cosmetic_grants")
        .select("id, member_id, asset_id, grant_title, grant_description, granted_at, revoked_at")
        .in("member_id", ids)
    : Promise.resolve({ data: [], error: null });

  const paymentsQuery = ids.length
    ? supabase
        .from("portal_support_payments")
        .select("member_id, support_type, amount_cents, amount_refunded_cents, status, livemode")
        .in("member_id", ids)
        .eq("livemode", livemode)
    : Promise.resolve({ data: [], error: null });

  const [rulesResult, tiersResult, grantsResult, paymentsResult] = await Promise.all([
    runAccessQuery(
      supabase
        .from("portal_cosmetic_access_rules")
        .select("asset_id, access_type, tier_id, public_unlock_title, public_unlock_description"),
    ),
    runAccessQuery(
      supabase
        .from("portal_cosmetic_unlock_tiers")
        .select("id, tier_type, threshold_value, display_name, public_description, sort_order, is_active")
        .order("tier_type", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("threshold_value", { ascending: true }),
    ),
    runAccessQuery(grantsQuery),
    runSupportQuery(paymentsQuery),
  ]);

  const accessSchemaReady = !rulesResult.missing && !tiersResult.missing && !grantsResult.missing;

  return {
    accessSchemaReady,
    supportSchemaReady: !paymentsResult.missing,
    accessRules: rulesResult.data,
    unlockTiers: tiersResult.data,
    grants: grantsResult.data,
    supportPayments: paymentsResult.data,
  };
}

export function buildMemberCosmeticProgress({ member, accessContext, env = process.env } = {}) {
  const memberId = cleanProfileCosmeticText(member?.id, 120);
  const stats = buildSupportStatsByMember(accessContext?.supportPayments || [], env).get(memberId) || {
    memberId,
    supportTotalCents: 0,
    monthlyConfirmedCount: 0,
  };
  const tiers = (accessContext?.unlockTiers || [])
    .map((tier) => ({
      id: tier.id,
      tierType: normalizeTierType(tier.tier_type || tier.tierType),
      thresholdValue: Math.max(0, Math.round(numberOrZero(tier.threshold_value ?? tier.thresholdValue))),
      displayName: cleanProfileCosmeticText(tier.display_name || tier.displayName, 160),
      publicDescription: cleanProfileCosmeticText(tier.public_description || tier.publicDescription, 500),
      sortOrder: Math.round(numberOrZero(tier.sort_order ?? tier.sortOrder)),
      isActive: tier.is_active !== false && tier.isActive !== false,
    }))
    .filter((tier) => tier.id && tier.tierType && tier.isActive)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.thresholdValue - right.thresholdValue);

  const nextSupportTier = tiers.find(
    (tier) => tier.tierType === COSMETIC_TIER_SUPPORT_TOTAL && stats.supportTotalCents < tier.thresholdValue,
  ) || null;
  const nextMonthlyTier = tiers.find(
    (tier) => tier.tierType === COSMETIC_TIER_MONTHLY_LOYALTY && stats.monthlyConfirmedCount < tier.thresholdValue,
  ) || null;

  return {
    supportTotalCents: stats.supportTotalCents,
    monthlyConfirmedCount: stats.monthlyConfirmedCount,
    tiers,
    nextSupportTier,
    nextMonthlyTier,
  };
}
