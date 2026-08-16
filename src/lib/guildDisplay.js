import {
  PALADIN_CLUSTER_GUILD_CODES,
  normalizeGuildCode,
  normalizeGuildCodeKey,
} from "./guildScope.js";

export const PALADIN_GUILD_DISPLAY_NAMES = {
  G1: "Légende",
  G2: "Imperatores",
  G3: "Loyalty",
  G4: "Collegium",
  G5: "Senatores",
  G6: "Legacy",
  G7: "Magistratus",
};

function normalizeOrganizationKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

function getGuildRowCode(row) {
  return normalizeGuildCode(row?.guild_code || row?.guildCode || row?.code);
}

function getGuildRowDisplayName(row) {
  return String(row?.display_name || row?.displayName || row?.name || "").trim();
}

function findGuildDisplayNameInRows(guildCode, guilds, organizationKey, organizationId) {
  const codeKey = normalizeGuildCodeKey(guildCode);
  if (!codeKey || !Array.isArray(guilds)) return "";

  const expectedOrganizationKey = normalizeOrganizationKey(organizationKey);
  const expectedOrganizationId = String(organizationId || "").trim();

  const row = guilds.find((item) => {
    if (normalizeGuildCodeKey(getGuildRowCode(item)) !== codeKey) return false;

    if (expectedOrganizationId) {
      const rowOrganizationId = String(item?.organization_id || item?.organizationId || "").trim();
      return rowOrganizationId === expectedOrganizationId;
    }

    if (expectedOrganizationKey) {
      const rowOrganizationKey = normalizeOrganizationKey(
        item?.organization_key || item?.organizationKey || item?.organization?.organization_key || item?.organization?.organizationKey,
      );
      return !rowOrganizationKey || rowOrganizationKey === expectedOrganizationKey;
    }

    return true;
  });

  return getGuildRowDisplayName(row);
}

function shouldUsePaladinFallback(guildCode, organizationKey, guilds, organizationId) {
  const codeKey = normalizeGuildCodeKey(guildCode);
  if (!PALADIN_CLUSTER_GUILD_CODES.includes(codeKey)) return false;

  const expectedOrganizationKey = normalizeOrganizationKey(organizationKey);
  if (expectedOrganizationKey && !["paladin", "paladin_cluster"].includes(expectedOrganizationKey)) {
    return false;
  }

  if (organizationId && Array.isArray(guilds)) {
    const matchingRow = guilds.find((item) => normalizeGuildCodeKey(getGuildRowCode(item)) === codeKey);
    if (matchingRow) return true;
  }

  return true;
}

export function getGuildDisplayName(input = {}) {
  const options = typeof input === "string" ? { guildCode: input } : input || {};
  const guildCode = normalizeGuildCode(
    options.guildCode || options.guild_code || options.code || options.guild || "",
  );
  const fallback = options.fallback;
  const emptyFallback = options.emptyFallback ?? "";

  if (!guildCode) return emptyFallback;

  const displayName = findGuildDisplayNameInRows(
    guildCode,
    options.guilds,
    options.organizationKey || options.organization_key,
    options.organizationId || options.organization_id,
  );
  if (displayName) return displayName;

  const codeKey = normalizeGuildCodeKey(guildCode);
  if (
    shouldUsePaladinFallback(
      guildCode,
      options.organizationKey || options.organization_key,
      options.guilds,
      options.organizationId || options.organization_id,
    )
  ) {
    return PALADIN_GUILD_DISPLAY_NAMES[codeKey] || guildCode;
  }

  return fallback ?? guildCode;
}

export function getSessionGuildDisplayName(session, options = {}) {
  return getGuildDisplayName({
    guildCode: session?.guildCode || session?.guild_code || session?.guild,
    organizationKey: session?.organizationKey || session?.organization_key,
    organizationId: session?.organizationId || session?.organization_id,
    ...options,
  });
}
