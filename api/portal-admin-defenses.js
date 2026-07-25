/* global Buffer, process */
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  applyPortalCorsHeaders,
  readJsonBody,
  requirePortalAdminSession,
  sendPortalJson,
  validatePortalInput,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const PALADIN_CLUSTER_GUILD_CODES = ["G1", "G2", "G3", "G4", "G5", "G6", "G7"];
const EMPTY_DEFENSE_SLOT = "--";
const MAX_DEFENSE_ROWS = 1200;
const MAX_BLOCK_ROWS = 200;
const DEFENSE_SELECT = `
  id,
  name,
  tier,
  type,
  faction,
  guild_code,
  is_global,
  is_hidden,
  source_defense_id,
  sort_order,
  image_url,
  created_at,
  guild_defense_slots (
    slot_index,
    champion_id,
    champions (
      id,
      name,
      portal_name,
      english_name
    )
  ),
  guild_defense_conditions (
    id,
    champion_id,
    min_awakening,
    champions (
      id,
      name,
      portal_name,
      english_name
    )
  )
`;
const CHAMPION_SAFE_SELECT = "id, name, portal_name, english_name, rarity, image_file, faction, role";
const BLOCK_SAFE_SELECT = "id, defense_id, block_type, content, sort_order";

function sendJson(res, status, payload) {
  sendPortalJson(res, status, payload, res._portalReq || null);
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeText(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeGuildCode(value) {
  return cleanText(value).toUpperCase().replace(/\s+/g, "_");
}

function isPaladinGuildCode(value) {
  return PALADIN_CLUSTER_GUILD_CODES.includes(normalizeGuildCode(value));
}

function isCommunityRole(role) {
  return ["community_member", "content_creator", "vip"].includes(normalizeText(role));
}

function isCommunityAccount(member) {
  return (
    member?.community_access_type === "community" ||
    isCommunityRole(member?.role) ||
    (!member?.guild_code && isCommunityRole(member?.role))
  );
}

function isLeaderRole(role) {
  return normalizeText(role) === "leader";
}

function getGuildSpaceKey(value) {
  const code = normalizeGuildCode(value);
  if (!code) return "";
  if (isPaladinGuildCode(code)) return "PALADIN";

  const match = code.match(/^(.+?)(?:_?G\d+)$/i);
  return (match?.[1] || code).replace(/_+$/g, "") || code;
}

function sameGuildSpace(left, right) {
  const leftSpace = getGuildSpaceKey(left);
  const rightSpace = getGuildSpaceKey(right);
  return Boolean(leftSpace && rightSpace && leftSpace === rightSpace);
}

function canViewGuildCode(actor, guildCode, { leaderSeesAll = false } = {}) {
  if (!actor || isCommunityAccount(actor)) return false;
  if (leaderSeesAll && isLeaderRole(actor.role)) return true;

  const actorGuild = normalizeGuildCode(actor.guild_code);
  const targetGuild = normalizeGuildCode(guildCode);
  if (!actorGuild || !targetGuild) return false;

  if (isPaladinGuildCode(actorGuild)) return isPaladinGuildCode(targetGuild);
  return sameGuildSpace(actorGuild, targetGuild);
}

function canViewDefense(actor, defense, targetGuildCode) {
  if (!canViewGuildCode(actor, targetGuildCode, { leaderSeesAll: true })) return false;
  if (isLeaderRole(actor.role)) return true;
  if (defense?.is_hidden) return false;

  const targetGuild = normalizeGuildCode(targetGuildCode);
  const defenseGuild = normalizeGuildCode(defense?.guild_code);

  if (isPaladinGuildCode(targetGuild)) {
    return Boolean(defense?.is_global) || isPaladinGuildCode(defenseGuild) || defenseGuild === targetGuild;
  }

  return sameGuildSpace(targetGuild, defenseGuild);
}

function canManageDefense(actor, defense, targetGuildCode) {
  if (!canViewGuildCode(actor, targetGuildCode, { leaderSeesAll: true })) return false;
  if (isLeaderRole(actor.role)) return true;

  const targetGuild = normalizeGuildCode(targetGuildCode);
  const defenseGuild = normalizeGuildCode(defense?.guild_code);
  if (!targetGuild || !defenseGuild) return false;

  if (isPaladinGuildCode(targetGuild)) {
    return isPaladinGuildCode(defenseGuild) || Boolean(defense?.is_global);
  }

  return sameGuildSpace(targetGuild, defenseGuild);
}

function getDefenseRootId(defense) {
  return defense?.sourceDefenseId || defense?.source_defense_id || defense?.id || null;
}

function isInheritedDefense(defense, targetGuildCode) {
  if (!defense?.id) return false;
  if (defense.source_defense_id || defense.sourceDefenseId) return false;
  if (!isPaladinGuildCode(targetGuildCode)) return false;
  return Boolean(defense.is_global || defense.isGlobal) && normalizeGuildCode(defense.guild_code || defense.guildCode) !== normalizeGuildCode(targetGuildCode);
}

function normalizeInfoBlock(block) {
  return {
    id: block.id,
    defense_id: block.defense_id,
    defenseId: block.defense_id,
    block_type: block.block_type || "text",
    blockType: block.block_type || "text",
    content: block.content || "",
    sort_order: block.sort_order ?? 9999,
    sortOrder: block.sort_order ?? 9999,
  };
}

function mapConditionRow(condition) {
  const heroName = condition.champions?.name || "Hero";
  return {
    id: condition.id,
    championId: condition.champion_id,
    champion_id: condition.champion_id,
    minAwakening: condition.min_awakening,
    min_awakening: condition.min_awakening,
    label: `${heroName} A${condition.min_awakening} minimum`,
  };
}

function mapDefenseRow(row, blocksByDefenseId = new Map()) {
  const slots = [...(row.guild_defense_slots || [])]
    .sort((a, b) => (a.slot_index ?? 0) - (b.slot_index ?? 0))
    .map((slot) => slot.champions?.name || "")
    .filter(Boolean);

  return {
    id: row.id,
    name: row.name || "",
    tier: row.tier || "meta_s",
    type: row.type || "Tour",
    faction: row.faction || "",
    guildCode: row.guild_code || "",
    guild_code: row.guild_code || "",
    isGlobal: Boolean(row.is_global),
    is_global: Boolean(row.is_global),
    isHidden: Boolean(row.is_hidden),
    is_hidden: Boolean(row.is_hidden),
    sourceDefenseId: row.source_defense_id || null,
    source_defense_id: row.source_defense_id || null,
    sortOrder: row.sort_order ?? 9999,
    sort_order: row.sort_order ?? 9999,
    slots,
    conditions: (row.guild_defense_conditions || []).map(mapConditionRow),
    infoBlocks: blocksByDefenseId.get(String(row.id)) || [],
    image: row.image_url || "",
    image_url: row.image_url || "",
  };
}

function resolveDefenseVariantsForGuild(defenses = [], guildCode) {
  const activeGuildKey = normalizeGuildCode(guildCode);
  const localByRootId = new Map();
  const hiddenRootIds = new Set();

  defenses.forEach((defense) => {
    const rootId = getDefenseRootId(defense);
    if (!rootId || !defense.sourceDefenseId) return;
    if (normalizeGuildCode(defense.guildCode) !== activeGuildKey) return;

    if (defense.isHidden) {
      hiddenRootIds.add(String(rootId));
      return;
    }

    localByRootId.set(String(rootId), defense);
  });

  const resolved = [];
  const emittedRootIds = new Set();

  defenses.forEach((defense) => {
    const rootId = getDefenseRootId(defense);
    if (!rootId) return;

    const rootKey = String(rootId);
    if (emittedRootIds.has(rootKey) || hiddenRootIds.has(rootKey)) return;

    const localVariant = localByRootId.get(rootKey);
    if (localVariant) {
      resolved.push(localVariant);
      emittedRootIds.add(rootKey);
      return;
    }

    if (defense.isHidden) return;
    resolved.push(defense);
    emittedRootIds.add(rootKey);
  });

  return resolved;
}

function sortDefenses(defenses = []) {
  return [...defenses].sort((left, right) => {
    if ((left.sortOrder ?? 9999) !== (right.sortOrder ?? 9999)) {
      return (left.sortOrder ?? 9999) - (right.sortOrder ?? 9999);
    }

    return String(left.name || "").localeCompare(String(right.name || ""), "fr", { sensitivity: "base" });
  });
}

function extractStoragePath(fileUrl) {
  if (!fileUrl) return null;

  try {
    const url = new URL(fileUrl);
    const marker = "/storage/v1/object/public/defense-images/";
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex === -1) return null;
    return decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
  } catch {
    return null;
  }
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) return null;
  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

async function requireAdmin(req, res) {
  const sessionCheck = await requirePortalAdminSession(req, supabase);
  if (sessionCheck.error) {
    sendJson(res, sessionCheck.status || 401, { error: sessionCheck.error });
    return null;
  }
  return sessionCheck.member;
}

async function loadBlocksByDefenseIds(defenseIds = []) {
  if (!defenseIds.length) return new Map();

  const { data, error } = await supabase
    .from("guild_defense_blocks")
    .select(BLOCK_SAFE_SELECT)
    .in("defense_id", defenseIds)
    .order("sort_order", { ascending: true })
    .limit(MAX_BLOCK_ROWS);

  if (error) throw error;

  return (data || []).reduce((grouped, block) => {
    const defenseId = String(block.defense_id);
    grouped.set(defenseId, [...(grouped.get(defenseId) || []), normalizeInfoBlock(block)]);
    return grouped;
  }, new Map());
}

async function loadBlocksArray(defenseId) {
  const blocksByDefenseId = await loadBlocksByDefenseIds([defenseId]);
  return [...(blocksByDefenseId.get(String(defenseId)) || [])];
}

async function loadDefenseRow(defenseId) {
  const { data, error } = await supabase
    .from("guild_defenses")
    .select(DEFENSE_SELECT)
    .eq("id", defenseId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function loadVisibleMappedDefenses(actor, guildCode) {
  const { data, error } = await supabase
    .from("guild_defenses")
    .select(DEFENSE_SELECT)
    .order("created_at", { ascending: true })
    .limit(MAX_DEFENSE_ROWS);

  if (error) throw error;

  const rows = (data || []).filter((row) => canViewDefense(actor, row, guildCode));
  const blocksByDefenseId = await loadBlocksByDefenseIds(rows.map((row) => row.id).filter(Boolean));
  return rows.map((row) => mapDefenseRow(row, blocksByDefenseId));
}

async function loadChampions() {
  const { data, error } = await supabase
    .from("champions")
    .select(CHAMPION_SAFE_SELECT)
    .order("name", { ascending: true });

  if (error) throw error;
  return data || [];
}

function buildChampionByName(champions = []) {
  return new Map(champions.map((champion) => [normalizeText(champion.name), champion]));
}

async function copyDefenseChildren(sourceDefense, targetDefenseId, champions = []) {
  const championByName = buildChampionByName(champions);
  const slotChampions = (sourceDefense.slots || [])
    .map((heroName) => championByName.get(normalizeText(heroName)))
    .filter(Boolean);

  if (slotChampions.length > 0) {
    const { error: slotsError } = await supabase.from("guild_defense_slots").insert(
      slotChampions.map((champion, index) => ({
        defense_id: targetDefenseId,
        champion_id: champion.id,
        slot_index: index + 1,
      })),
    );
    if (slotsError) throw slotsError;
  }

  const conditionRows = (sourceDefense.conditions || [])
    .filter((condition) => condition.championId)
    .map((condition) => ({
      defense_id: targetDefenseId,
      champion_id: condition.championId,
      min_awakening: condition.minAwakening,
    }));

  if (conditionRows.length > 0) {
    const { error: conditionsError } = await supabase.from("guild_defense_conditions").insert(conditionRows);
    if (conditionsError) throw conditionsError;
  }

  const blockRows = (sourceDefense.infoBlocks || []).map((block, index) => ({
    defense_id: targetDefenseId,
    block_type: block.block_type || block.blockType || "text",
    content: block.content,
    sort_order: block.sort_order ?? block.sortOrder ?? index + 1,
  }));

  if (blockRows.length > 0) {
    const { error: blocksError } = await supabase.from("guild_defense_blocks").insert(blockRows);
    if (blocksError) throw blocksError;
  }
}

async function ensureEditableDefense(actor, defenseId, guildCode, { hidden = false } = {}) {
  const row = await loadDefenseRow(defenseId);
  if (!row) throw new Error("Defense introuvable.");
  if (!canManageDefense(actor, row, guildCode)) throw new Error("Acces defense refuse.");

  const blocksByDefenseId = await loadBlocksByDefenseIds([row.id]);
  const sourceDefense = mapDefenseRow(row, blocksByDefenseId);
  const rootId = getDefenseRootId(sourceDefense);

  if (!isInheritedDefense(row, guildCode)) {
    if (hidden) {
      const { data, error } = await supabase
        .from("guild_defenses")
        .update({ is_hidden: true })
        .eq("id", row.id)
        .select(DEFENSE_SELECT)
        .single();
      if (error) throw error;
      return mapDefenseRow(data, await loadBlocksByDefenseIds([data.id]));
    }

    return sourceDefense;
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("guild_defenses")
    .select(DEFENSE_SELECT)
    .eq("source_defense_id", rootId)
    .eq("guild_code", guildCode)
    .limit(1);

  if (existingError) throw existingError;

  const localPayload = {
    name: sourceDefense.name || "",
    tier: sourceDefense.tier || "meta_s",
    type: sourceDefense.type || "Tour",
    faction: sourceDefense.faction || null,
    image_url: sourceDefense.image || sourceDefense.image_url || null,
    guild_code: guildCode,
    is_global: false,
    source_defense_id: rootId,
    sort_order: sourceDefense.sortOrder ?? 9999,
    is_hidden: Boolean(hidden),
  };

  const existing = existingRows?.[0] || null;
  const { data: localRow, error: localError } = existing
    ? await supabase.from("guild_defenses").update(localPayload).eq("id", existing.id).select(DEFENSE_SELECT).single()
    : await supabase.from("guild_defenses").insert(localPayload).select(DEFENSE_SELECT).single();

  if (localError) throw localError;

  if (!existing && !hidden) {
    await copyDefenseChildren(sourceDefense, localRow.id, await loadChampions());
  }

  return mapDefenseRow(localRow, await loadBlocksByDefenseIds([localRow.id]));
}

async function resetAssignedDefenseNames(defenseName, guildCode, resetAllPaladin) {
  const resetGuildCodes = resetAllPaladin
    ? PALADIN_CLUSTER_GUILD_CODES
    : [guildCode].filter(Boolean);

  let resetDefense1Query = supabase
    .from("guild_members")
    .update({ defense_1: EMPTY_DEFENSE_SLOT })
    .eq("defense_1", defenseName);
  let resetDefense2Query = supabase
    .from("guild_members")
    .update({ defense_2: EMPTY_DEFENSE_SLOT })
    .eq("defense_2", defenseName);

  if (resetGuildCodes.length > 0) {
    resetDefense1Query = resetDefense1Query.in("guild_code", resetGuildCodes);
    resetDefense2Query = resetDefense2Query.in("guild_code", resetGuildCodes);
  }

  const [resetDefense1, resetDefense2] = await Promise.all([resetDefense1Query, resetDefense2Query]);
  const mutationError = resetDefense1.error || resetDefense2.error;
  if (mutationError) throw mutationError;
}

async function handleLoad(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const guildCode = normalizeGuildCode(validatePortalInput(body.guildCode, 40) || actor.guild_code);
  if (!canViewGuildCode(actor, guildCode, { leaderSeesAll: true })) {
    sendJson(res, 403, { error: "Acces guilde refuse." });
    return;
  }

  const [defenses, champions] = await Promise.all([
    loadVisibleMappedDefenses(actor, guildCode),
    loadChampions(),
  ]);

  sendJson(res, 200, {
    ok: true,
    defenses: sortDefenses(resolveDefenseVariantsForGuild(defenses, guildCode)),
    champions,
  });
}

async function handleEnsureLocal(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const guildCode = normalizeGuildCode(validatePortalInput(body.guildCode, 40) || actor.guild_code);
  const defenseId = validatePortalInput(body.defenseId, 80);
  const defense = await ensureEditableDefense(actor, defenseId, guildCode, { hidden: Boolean(body.hidden) });
  sendJson(res, 200, { ok: true, defense });
}

async function handleUploadImage(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const parsed = parseDataUrl(body.dataUrl);
  if (!parsed) {
    sendJson(res, 400, { error: "Image invalide." });
    return;
  }

  if (parsed.buffer.length > 4 * 1024 * 1024) {
    sendJson(res, 413, { error: "Image trop lourde." });
    return;
  }

  const fileName = validatePortalInput(body.fileName, 120).replace(/[^\w.-]+/g, "-") || "defense.webp";
  const filePath = `portal-defense-${Date.now()}-${crypto.randomUUID()}-${fileName.replace(/\.[^.]+$/, ".webp")}`;
  const { error: uploadError } = await supabase.storage.from("defense-images").upload(filePath, parsed.buffer, {
    contentType: parsed.contentType,
    upsert: false,
  });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("defense-images").getPublicUrl(filePath);
  sendJson(res, 200, { ok: true, imageUrl: data.publicUrl });
}

async function handleSave(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const guildCode = normalizeGuildCode(validatePortalInput(body.guildCode, 40) || actor.guild_code);
  if (!canViewGuildCode(actor, guildCode, { leaderSeesAll: true })) {
    sendJson(res, 403, { error: "Acces guilde refuse." });
    return;
  }

  const champions = await loadChampions();
  const championByName = buildChampionByName(champions);
  const draft = body.draft || {};
  const cleanName = validatePortalInput(draft.name, 120);
  const slots = Array.isArray(draft.slots)
    ? draft.slots.map((slot) => validatePortalInput(slot, 120)).filter(Boolean)
    : [];

  if (!cleanName || slots.length !== 5) {
    sendJson(res, 400, { error: "Renseigne un nom et les 5 heros de la defense." });
    return;
  }

  const slotChampions = slots.map((heroName) => championByName.get(normalizeText(heroName)));
  if (slotChampions.some((champion) => !champion)) {
    sendJson(res, 400, { error: "Un des heros n'existe pas dans la table champions." });
    return;
  }

  const defenseId = validatePortalInput(draft.id, 80);
  const isEditMode = defenseId && defenseId !== "0";
  let existing = null;

  if (isEditMode) {
    existing = await loadDefenseRow(defenseId);
    if (!existing) throw new Error("Defense introuvable.");
    if (!canManageDefense(actor, existing, guildCode)) throw new Error("Acces defense refuse.");
  }

  const nextIsGlobal = isPaladinGuildCode(guildCode) && Boolean(draft.isGlobal);
  const defensePayload = {
    name: cleanName,
    tier: validatePortalInput(draft.tier, 40) || "meta_s",
    type: validatePortalInput(draft.type, 40) || "Tour",
    faction: validatePortalInput(draft.faction, 80) || null,
    image_url: validatePortalInput(draft.imageUrl || draft.image || draft.image_url, 500) || null,
    guild_code: nextIsGlobal ? normalizeGuildCode(draft.guildCode || guildCode || "G1") : guildCode,
    is_global: nextIsGlobal,
    source_defense_id: draft.sourceDefenseId || draft.source_defense_id || null,
  };

  const { data: savedDefense, error: defenseError } = isEditMode
    ? await supabase.from("guild_defenses").update(defensePayload).eq("id", defenseId).select(DEFENSE_SELECT).single()
    : await supabase.from("guild_defenses").insert(defensePayload).select(DEFENSE_SELECT).single();

  if (defenseError) throw defenseError;

  if (isEditMode) {
    const { error: deleteSlotsError } = await supabase.from("guild_defense_slots").delete().eq("defense_id", savedDefense.id);
    if (deleteSlotsError) throw deleteSlotsError;
  }

  const { error: slotsError } = await supabase.from("guild_defense_slots").insert(
    slotChampions.map((champion, index) => ({
      defense_id: savedDefense.id,
      champion_id: champion.id,
      slot_index: index + 1,
    })),
  );
  if (slotsError) throw slotsError;

  sendJson(res, 200, { ok: true, defense: mapDefenseRow(savedDefense, await loadBlocksByDefenseIds([savedDefense.id])) });
}

async function handleConditionsLoad(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const guildCode = normalizeGuildCode(validatePortalInput(body.guildCode, 40) || actor.guild_code);
  const defenseId = validatePortalInput(body.defenseId, 80);
  const defense = await ensureEditableDefense(actor, defenseId, guildCode);

  const { data, error } = await supabase
    .from("guild_defense_conditions")
    .select("id, champion_id, min_awakening, champions ( name )")
    .eq("defense_id", defense.id)
    .order("min_awakening", { ascending: false });

  if (error) throw error;
  sendJson(res, 200, { ok: true, defense, conditions: (data || []).map(mapConditionRow) });
}

async function handleConditionAdd(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const guildCode = normalizeGuildCode(validatePortalInput(body.guildCode, 40) || actor.guild_code);
  const defense = await ensureEditableDefense(actor, validatePortalInput(body.defenseId, 80), guildCode);
  const heroName = validatePortalInput(body.heroName, 120);
  const minAwakening = Number(body.minAwakening);

  if (!heroName || Number.isNaN(minAwakening)) throw new Error("Condition invalide.");
  if (!(defense.slots || []).some((slot) => normalizeText(slot) === normalizeText(heroName))) {
    throw new Error("La condition doit viser un heros present dans cette defense.");
  }

  const champion = buildChampionByName(await loadChampions()).get(normalizeText(heroName));
  if (!champion) throw new Error("Hero introuvable.");

  const { error } = await supabase.from("guild_defense_conditions").insert({
    defense_id: defense.id,
    champion_id: champion.id,
    min_awakening: minAwakening,
  });

  if (error) throw error;
  sendJson(res, 200, { ok: true, defense });
}

async function handleConditionRemove(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const guildCode = normalizeGuildCode(validatePortalInput(body.guildCode, 40) || actor.guild_code);
  const defense = await ensureEditableDefense(actor, validatePortalInput(body.defenseId, 80), guildCode);
  const conditionId = validatePortalInput(body.conditionId, 80);

  const { error } = await supabase
    .from("guild_defense_conditions")
    .delete()
    .eq("id", conditionId)
    .eq("defense_id", defense.id);

  if (error) throw error;
  sendJson(res, 200, { ok: true, defense });
}

async function handleDelete(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const guildCode = normalizeGuildCode(validatePortalInput(body.guildCode, 40) || actor.guild_code);
  const defenseId = validatePortalInput(body.defenseId, 80);
  const row = await loadDefenseRow(defenseId);

  if (!row) throw new Error("Defense introuvable.");
  if (!canManageDefense(actor, row, guildCode)) throw new Error("Acces defense refuse.");

  const mappedDefense = mapDefenseRow(row, await loadBlocksByDefenseIds([row.id]));
  const shouldHideLocally = Boolean(mappedDefense.sourceDefenseId || isInheritedDefense(row, guildCode));

  await resetAssignedDefenseNames(
    mappedDefense.name,
    guildCode,
    !shouldHideLocally && (mappedDefense.isGlobal || isPaladinGuildCode(mappedDefense.guildCode)),
  );

  if (shouldHideLocally) {
    const localDefense = await ensureEditableDefense(actor, defenseId, guildCode, { hidden: true });
    sendJson(res, 200, { ok: true, hidden: true, defense: localDefense });
    return;
  }

  const { data: blocks, error: blocksError } = await supabase
    .from("guild_defense_blocks")
    .select("id, block_type, content")
    .eq("defense_id", defenseId);
  if (blocksError) throw blocksError;

  const storagePaths = [
    extractStoragePath(mappedDefense.image || mappedDefense.image_url),
    ...(blocks || [])
      .filter((block) => block.block_type === "image")
      .map((block) => extractStoragePath(block.content)),
  ].filter(Boolean);

  const uniqueStoragePaths = [...new Set(storagePaths)];
  if (uniqueStoragePaths.length > 0) {
    const { error: storageError } = await supabase.storage.from("defense-images").remove(uniqueStoragePaths);
    if (storageError) throw storageError;
  }

  const [blocksDelete, conditionsDelete, slotsDelete] = await Promise.all([
    supabase.from("guild_defense_blocks").delete().eq("defense_id", defenseId),
    supabase.from("guild_defense_conditions").delete().eq("defense_id", defenseId),
    supabase.from("guild_defense_slots").delete().eq("defense_id", defenseId),
  ]);

  const mutationError = blocksDelete.error || conditionsDelete.error || slotsDelete.error;
  if (mutationError) throw mutationError;

  const { error: defenseError } = await supabase.from("guild_defenses").delete().eq("id", defenseId);
  if (defenseError) throw defenseError;

  sendJson(res, 200, { ok: true, deleted: true });
}

async function handleBlocksLoad(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const guildCode = normalizeGuildCode(validatePortalInput(body.guildCode, 40) || actor.guild_code);
  const defenseId = validatePortalInput(body.defenseId, 80);
  const defense = await loadDefenseRow(defenseId);
  if (!defense || !canViewDefense(actor, defense, guildCode)) throw new Error("Acces defense refuse.");

  const blocks = await loadBlocksArray(defenseId);
  sendJson(res, 200, { ok: true, blocks });
}

async function handleBlockReorder(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const guildCode = normalizeGuildCode(validatePortalInput(body.guildCode, 40) || actor.guild_code);
  const defense = await ensureEditableDefense(actor, validatePortalInput(body.defenseId, 80), guildCode);
  const blocks = Array.isArray(body.blocks) ? body.blocks : [];

  await Promise.all(
    blocks.map((block, index) =>
      supabase
        .from("guild_defense_blocks")
        .update({ sort_order: index + 1 })
        .eq("id", validatePortalInput(block.id, 80))
        .eq("defense_id", defense.id),
    ),
  );

  sendJson(res, 200, { ok: true, blocks: await loadBlocksArray(defense.id) });
}

async function handleBlockDelete(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const guildCode = normalizeGuildCode(validatePortalInput(body.guildCode, 40) || actor.guild_code);
  const defense = await ensureEditableDefense(actor, validatePortalInput(body.defenseId, 80), guildCode);
  const blockId = validatePortalInput(body.blockId, 80);

  const { data: block, error: blockError } = await supabase
    .from("guild_defense_blocks")
    .select(BLOCK_SAFE_SELECT)
    .eq("id", blockId)
    .eq("defense_id", defense.id)
    .maybeSingle();
  if (blockError) throw blockError;

  const storagePath = block?.block_type === "image" ? extractStoragePath(block.content) : null;
  if (storagePath) {
    const { error: storageError } = await supabase.storage.from("defense-images").remove([storagePath]);
    if (storageError) throw storageError;
  }

  const { error } = await supabase
    .from("guild_defense_blocks")
    .delete()
    .eq("id", blockId)
    .eq("defense_id", defense.id);
  if (error) throw error;

  sendJson(res, 200, { ok: true, blocks: await loadBlocksArray(defense.id) });
}

async function handleBlockAddText(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const guildCode = normalizeGuildCode(validatePortalInput(body.guildCode, 40) || actor.guild_code);
  const defense = await ensureEditableDefense(actor, validatePortalInput(body.defenseId, 80), guildCode);
  const content = validatePortalInput(body.content, 5000);
  if (!content) throw new Error("Texte vide.");

  const existingBlocks = await loadBlocksArray(defense.id);
  const { error } = await supabase.from("guild_defense_blocks").insert({
    defense_id: defense.id,
    block_type: "text",
    content,
    sort_order: existingBlocks.length + 1,
  });
  if (error) throw error;

  sendJson(res, 200, { ok: true, blocks: await loadBlocksArray(defense.id) });
}

async function handleBlockAddImage(body, req, res) {
  const actor = await requireAdmin(req, res);
  if (!actor) return;

  const guildCode = normalizeGuildCode(validatePortalInput(body.guildCode, 40) || actor.guild_code);
  const defense = await ensureEditableDefense(actor, validatePortalInput(body.defenseId, 80), guildCode);
  const parsed = parseDataUrl(body.dataUrl);
  if (!parsed) throw new Error("Image invalide.");
  if (parsed.buffer.length > 4 * 1024 * 1024) throw new Error("Image trop lourde.");

  const fileName = validatePortalInput(body.fileName, 120).replace(/[^\w.-]+/g, "-") || "block.webp";
  const filePath = `editor-block-${Date.now()}-${crypto.randomUUID()}-${fileName.replace(/\.[^.]+$/, ".webp")}`;

  const { error: uploadError } = await supabase.storage.from("defense-images").upload(filePath, parsed.buffer, {
    contentType: parsed.contentType,
    upsert: false,
  });
  if (uploadError) throw uploadError;

  const { data: publicData } = supabase.storage.from("defense-images").getPublicUrl(filePath);
  const existingBlocks = await loadBlocksArray(defense.id);
  const { error } = await supabase.from("guild_defense_blocks").insert({
    defense_id: defense.id,
    block_type: "image",
    content: publicData.publicUrl,
    sort_order: existingBlocks.length + 1,
  });
  if (error) throw error;

  sendJson(res, 200, { ok: true, blocks: await loadBlocksArray(defense.id) });
}

export default async function handler(req, res) {
  try {
    res._portalReq = req;
    applyPortalCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    if (!verifyPortalRequestOrigin(req)) {
      sendJson(res, 403, { error: "Origine de la requete refusee." });
      return;
    }

    const body = await readJsonBody(req);
    const action = cleanText(body.action);

    if (action === "load") return await handleLoad(body, req, res);
    if (action === "ensure-local") return await handleEnsureLocal(body, req, res);
    if (action === "upload-image") return await handleUploadImage(body, req, res);
    if (action === "save") return await handleSave(body, req, res);
    if (action === "conditions-load") return await handleConditionsLoad(body, req, res);
    if (action === "condition-add") return await handleConditionAdd(body, req, res);
    if (action === "condition-remove") return await handleConditionRemove(body, req, res);
    if (action === "delete") return await handleDelete(body, req, res);
    if (action === "blocks-load") return await handleBlocksLoad(body, req, res);
    if (action === "block-reorder") return await handleBlockReorder(body, req, res);
    if (action === "block-delete") return await handleBlockDelete(body, req, res);
    if (action === "block-add-text") return await handleBlockAddText(body, req, res);
    if (action === "block-add-image") return await handleBlockAddImage(body, req, res);

    sendJson(res, 400, { error: "Action inconnue." });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || "Erreur gestion defenses." });
  }
}
