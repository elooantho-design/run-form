/* global Buffer, process */
import { randomInt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const PASSWORD_LENGTH = 12;
const TEMPORARY_PASSWORD_PREFIX = "TMP-";
const MAX_MEMBER_ROWS = 600;
const MAX_SUGGESTIONS = 20;
const DISCORD_API_BASE = "https://discord.com/api/v10";
const DEFENSE_FOLLOWUP_TABLE = "guild_defense_discord_followups";
const TODO_STATUS = "\u00c0 faire";
const VERIFY_STATUS = "\u00c0 v\u00e9rifier";
const VALID_STATUS = "Valid\u00e9";
const DISCORD_STATUS_TODO = "\u274c";
const DISCORD_STATUS_VERIFY = "\u26a0\uFE0F";
const DISCORD_STATUS_DONE = "\u2705";
const DEFENSE_STATUSES = new Set([TODO_STATUS, VERIFY_STATUS, VALID_STATUS]);

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
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

function isAdminRole(role) {
  return ["admin", "administrateur", "leader"].includes(
    normalizeText(role)
  );
}

function isLeaderRole(role) {
  return normalizeText(role) === "leader";
}

function normalizeGuildCode(value) {
  return cleanText(value).toUpperCase().replace(/\s+/g, "_");
}

function isPaladinGuildCode(value) {
  return /^G[1-7]$/.test(normalizeGuildCode(value));
}

function isMissingFollowupTable(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes(DEFENSE_FOLLOWUP_TABLE)
  );
}

function getMemberName(member) {
  return member?.watcher_name || member?.discord_id || "Joueur";
}

function serializeMember(member) {
  return {
    id: member.id,
    name: getMemberName(member),
    discordId: member.discord_id || "",
    guildCode: member.guild_code || "",
    role: member.role || "Joueur",
  };
}

function generatePassword() {
  let password = "";

  for (let index = 0; index < PASSWORD_LENGTH; index += 1) {
    password += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }

  return `${TEMPORARY_PASSWORD_PREFIX}${password}`;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function requireAdmin(actorMemberId, adminPassword) {
  if (!actorMemberId || !adminPassword) {
    return { error: "Mot de passe admin obligatoire.", status: 401 };
  }

  const { data, error } = await supabase
    .from("guild_members")
    .select("id, role, discord_id, watcher_name, guild_code")
    .eq("id", actorMemberId)
    .eq("password", adminPassword)
    .maybeSingle();

  if (error) {
    return { error: error.message || "Verification admin impossible.", status: 500 };
  }

  if (!data || !isAdminRole(data.role)) {
    return { error: "Acces admin refuse.", status: 403 };
  }

  return { admin: data };
}

async function requireAdminById(actorMemberId) {
  if (!actorMemberId) {
    return { error: "Session admin manquante.", status: 401 };
  }

  const { data, error } = await supabase
    .from("guild_members")
    .select("id, role, discord_id, watcher_name, guild_code")
    .eq("id", actorMemberId)
    .maybeSingle();

  if (error) {
    return { error: error.message || "Verification admin impossible.", status: 500 };
  }

  if (!data || !isAdminRole(data.role)) {
    return { error: "Acces admin refuse.", status: 403 };
  }

  return { admin: data };
}

function canAdminManageTarget(admin, target) {
  if (isLeaderRole(admin?.role)) return true;

  const adminGuild = normalizeGuildCode(admin?.guild_code);
  const targetGuild = normalizeGuildCode(target?.guild_code);
  if (!adminGuild || !targetGuild) return false;

  if (isPaladinGuildCode(adminGuild) && isPaladinGuildCode(targetGuild)) return true;
  return adminGuild === targetGuild;
}

function getDiscordBotToken() {
  return String(
    process.env.DISCORD_BOT_TOKEN ||
      process.env.DISCORD_DEFENSE_BOT_TOKEN ||
      process.env.DISCORD_TOKEN ||
      ""
  ).trim();
}

async function discordRequest(pathname, options = {}) {
  const token = getDiscordBotToken();
  if (!token) {
    const error = new Error("DISCORD_BOT_TOKEN manquant.");
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch(`${DISCORD_API_BASE}${pathname}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bot ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) return null;

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.message || `Discord HTTP ${response.status}`);
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function serializeDiscordWarning(error, extra = {}) {
  const retryAfter = Number(error?.payload?.retry_after ?? error?.data?.retry_after ?? 0);
  const statusCode = error?.statusCode ?? error?.status ?? null;
  const retryText =
    statusCode === 429 && Number.isFinite(retryAfter) && retryAfter > 0
      ? ` Reessaie dans ${Math.ceil(retryAfter)}s.`
      : "";

  return {
    ...extra,
    statusCode,
    retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    message: `${error?.message || "Discord request failed"}${retryText}`,
  };
}

function buildDiscordStatusChannelName(currentName, targetName, statusEmoji) {
  const cleanCurrent = cleanText(currentName);
  const cleanTarget = cleanText(targetName);
  const strippedCurrent = cleanCurrent
    .replace(/^\s*(?:\u2705|\u274c|\u26a0\uFE0F?|\u26a0)\s*(?:[-\u2013\u2014]\s*)?/u, "")
    .trim();
  const baseName = strippedCurrent || cleanTarget || cleanCurrent || "Joueur";

  return `${statusEmoji} - ${baseName}`.slice(0, 100);
}

function getDiscordStatusEmoji(status) {
  if (status === VERIFY_STATUS) return DISCORD_STATUS_VERIFY;
  if (status === VALID_STATUS) return DISCORD_STATUS_DONE;
  return DISCORD_STATUS_TODO;
}

async function renameDiscordChannelStatus(channelId, targetName, statusEmoji) {
  if (!channelId) return { skipped: true, reason: "missing_channel" };

  const channel = await discordRequest(`/channels/${encodeURIComponent(channelId)}`, {
    method: "GET",
  });
  const before = cleanText(channel?.name);
  const after = buildDiscordStatusChannelName(before, targetName, statusEmoji);

  if (!after || before === after) {
    return { skipped: true, reason: "already_named", channelId, before, after };
  }

  await discordRequest(`/channels/${encodeURIComponent(channelId)}`, {
    method: "PATCH",
    body: { name: after },
  });

  return { renamed: true, channelId, before, after };
}

function parseDiscordChannelId(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  if (/^\d{15,25}$/.test(raw)) return raw;

  try {
    const parsed = new URL(raw);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const channelsIndex = parts.findIndex((part) => part === "channels");
    if (channelsIndex >= 0 && parts[channelsIndex + 2]) {
      return parts[channelsIndex + 2];
    }
  } catch {
    return "";
  }

  return "";
}

function splitDiscordMessage(content) {
  const limit = 1800;
  const lines = String(content || "").split("\n");
  const chunks = [];
  let current = "";

  lines.forEach((line) => {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > limit && current) {
      chunks.push(current);
      current = line;
      return;
    }
    current = next;
  });

  if (current) chunks.push(current);
  return chunks.length ? chunks : ["Message vide."];
}

async function sendDiscordMessages(channelId, content) {
  const chunks = splitDiscordMessage(content);
  const sent = [];

  for (const chunk of chunks) {
    const message = await discordRequest(`/channels/${encodeURIComponent(channelId)}/messages`, {
      method: "POST",
      body: {
        content: chunk,
        allowed_mentions: { parse: [] },
      },
    });
    sent.push(message?.id || null);
  }

  return sent;
}

async function sendDiscordDm(userId, content) {
  const channel = await discordRequest("/users/@me/channels", {
    method: "POST",
    body: { recipient_id: String(userId) },
  });

  if (!channel?.id) {
    const error = new Error("Salon MP Discord introuvable.");
    error.statusCode = 500;
    throw error;
  }

  return sendDiscordMessages(channel.id, content);
}

function normalizeDefenseName(value) {
  const cleanValue = cleanText(value);
  return cleanValue && cleanValue !== "--" && cleanValue !== "—" ? cleanValue : "";
}

function formatDefenseBlocks(defense) {
  const blocks = [...(defense.guild_defense_blocks || [])]
    .sort((a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999))
    .map((block) => cleanText(block.content))
    .filter(Boolean);

  return blocks.length ? blocks.map((block) => `  - ${block}`).join("\n") : "  - Aucune consigne particuliere";
}

function formatDefenseConditions(defense) {
  const conditions = [...(defense.guild_defense_conditions || [])]
    .map((condition) => {
      const hero = condition.champions?.name || "Hero";
      const awakening = condition.min_awakening ?? 0;
      return `${hero} A${awakening} minimum`;
    })
    .filter(Boolean);

  return conditions.length ? conditions.map((condition) => `  - ${condition}`).join("\n") : "  - Aucune condition";
}

function formatDefenseHeroes(defense) {
  const heroes = [...(defense.guild_defense_slots || [])]
    .sort((a, b) => (a.slot_index ?? 0) - (b.slot_index ?? 0))
    .map((slot) => slot.champions?.name)
    .filter(Boolean);

  return heroes.length ? heroes.join(", ") : "Non renseigne";
}

function pickDefenseForGuild(rows, name, guildCode) {
  const matching = rows.filter((row) => row.name === name);
  const normalizedGuild = normalizeGuildCode(guildCode);

  return (
    matching.find((row) => normalizeGuildCode(row.guild_code) === normalizedGuild) ||
    matching.find((row) => row.is_global) ||
    matching[0] ||
    null
  );
}

function buildDefenseMessage({ target, defenses, missingNames, actor }) {
  const targetName = getMemberName(target);
  const guildCode = target.guild_code || "-";
  const actorName = getMemberName(actor);

  const lines = [
    `**Defenses assignees - ${targetName} (${guildCode})**`,
    `Envoye par ${actorName}.`,
    "",
    "Voici les defenses a preparer :",
  ];

  defenses.forEach((defense, index) => {
    lines.push("");
    lines.push(`**Defense ${index + 1} - ${defense.name}**`);
    lines.push(`Type : ${defense.type || "-"} | Tier : ${defense.tier || "-"}`);
    lines.push(`Heros : ${formatDefenseHeroes(defense)}`);
    lines.push("Conditions :");
    lines.push(formatDefenseConditions(defense));
    lines.push("Infos :");
    lines.push(formatDefenseBlocks(defense));
    if (defense.image_url) lines.push(`Image : ${defense.image_url}`);
  });

  missingNames.forEach((name) => {
    lines.push("");
    lines.push(`**${name}**`);
    lines.push("Defense assignee mais informations introuvables dans Portal.");
  });

  return lines.join("\n");
}

async function loadMembers() {
  return supabase
    .from("guild_members")
    .select("id, role, discord_id, watcher_name, guild_code")
    .order("watcher_name", { ascending: true })
    .limit(MAX_MEMBER_ROWS);
}

async function handleSearch(body, res) {
  const actorMemberId = cleanText(body.actorMemberId || body.actor_member_id);
  const adminPassword = cleanText(body.adminPassword || body.admin_password);
  const adminCheck = await requireAdmin(actorMemberId, adminPassword);

  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  const query = normalizeText(body.query);
  if (query.length < 2) {
    sendJson(res, 200, { members: [] });
    return;
  }

  const { data, error } = await loadMembers();

  if (error) {
    sendJson(res, 500, { error: error.message || "Recherche joueur impossible." });
    return;
  }

  const members = (data || [])
    .filter((member) => {
      const haystack = normalizeText(
        `${member.watcher_name || ""} ${member.discord_id || ""} ${member.guild_code || ""}`
      );
      return haystack.includes(query);
    })
    .slice(0, MAX_SUGGESTIONS)
    .map(serializeMember);

  sendJson(res, 200, { members });
}

async function handleReset(body, res) {
  const actorMemberId = cleanText(body.actorMemberId || body.actor_member_id);
  const adminPassword = cleanText(body.adminPassword || body.admin_password);
  const memberId = cleanText(body.memberId || body.member_id);
  const adminCheck = await requireAdmin(actorMemberId, adminPassword);

  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  if (!memberId) {
    sendJson(res, 400, { error: "Joueur manquant." });
    return;
  }

  const { data: target, error: targetError } = await supabase
    .from("guild_members")
    .select("id, role, discord_id, watcher_name, guild_code")
    .eq("id", memberId)
    .maybeSingle();

  if (targetError) {
    sendJson(res, 500, { error: targetError.message || "Joueur introuvable." });
    return;
  }

  if (!target) {
    sendJson(res, 404, { error: "Joueur introuvable." });
    return;
  }

  if (isAdminRole(target.role)) {
    sendJson(res, 403, { error: "Les comptes admin ne peuvent pas etre reinitalises ici." });
    return;
  }

  const temporaryPassword = generatePassword();
  const { error: updateError } = await supabase
    .from("guild_members")
    .update({ password: temporaryPassword })
    .eq("id", target.id);

  if (updateError) {
    sendJson(res, 500, { error: updateError.message || "Reset du mot de passe impossible." });
    return;
  }

  const adminName = getMemberName(adminCheck.admin);
  const targetName = getMemberName(target);

  await supabase.from("portal_activity_logs").insert({
    actor_member_id: adminCheck.admin.id,
    actor_name: adminName,
    target_member_id: target.id,
    target_name: targetName,
    action_type: "player_password_reset",
    entity_type: "guild_members",
    entity_id: target.id,
    summary: `${adminName} a genere un nouveau mot de passe pour ${targetName}`,
    metadata: {
      targetDiscordId: target.discord_id || "",
      targetGuildCode: target.guild_code || "",
    },
  });

  sendJson(res, 200, {
    member: serializeMember(target),
    temporaryPassword,
  });
}

async function handleUpdateDefenseStatus(body, res) {
  const actorMemberId = cleanText(body.actorMemberId || body.actor_member_id);
  const memberId = cleanText(body.memberId || body.member_id);
  const status = cleanText(body.status);
  const adminCheck = await requireAdminById(actorMemberId);

  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  if (!memberId) {
    sendJson(res, 400, { error: "Joueur manquant." });
    return;
  }

  if (!DEFENSE_STATUSES.has(status)) {
    sendJson(res, 400, { error: "Statut defense invalide." });
    return;
  }

  const { data: target, error: targetError } = await supabase
    .from("guild_members")
    .select("id, role, discord_id, watcher_name, guild_code, personal_forum_post_url")
    .eq("id", memberId)
    .maybeSingle();

  if (targetError) {
    sendJson(res, 500, { error: targetError.message || "Joueur introuvable." });
    return;
  }

  if (!target) {
    sendJson(res, 404, { error: "Joueur introuvable." });
    return;
  }

  if (!canAdminManageTarget(adminCheck.admin, target)) {
    sendJson(res, 403, { error: "Ce joueur n'est pas dans ton perimetre." });
    return;
  }

  const { error: statusError } = await supabase
    .from("guild_members")
    .update({ status })
    .eq("id", target.id);

  if (statusError) {
    sendJson(res, 500, { error: statusError.message || "Mise a jour statut impossible." });
    return;
  }

  const warnings = [];
  let forumRename = null;
  const forumChannelId = parseDiscordChannelId(target.personal_forum_post_url);
  if (forumChannelId) {
    try {
      forumRename = await renameDiscordChannelStatus(
        forumChannelId,
        getMemberName(target),
        getDiscordStatusEmoji(status)
      );
    } catch (renameError) {
      warnings.push(serializeDiscordWarning(renameError, {
        type: "discord_channel_rename_failed",
        memberId: target.id,
        memberName: getMemberName(target),
      }));
    }
  }

  const adminName = getMemberName(adminCheck.admin);
  const targetName = getMemberName(target);

  await supabase.from("portal_activity_logs").insert({
    actor_member_id: adminCheck.admin.id,
    actor_name: adminName,
    target_member_id: target.id,
    target_name: targetName,
    action_type: "guild_management_status_update",
    entity_type: "guild_members",
    entity_id: target.id,
    summary: `${targetName} : statut defense passe a ${status}`,
    metadata: {
      guildCode: target.guild_code || "",
      status,
      forumRename,
      warnings,
    },
  });

  sendJson(res, 200, {
    ok: true,
    memberId: target.id,
    status,
    forumSkipped: !forumChannelId,
    forumRename,
    warnings,
  });
}

async function handleResetDefenseStatuses(body, res) {
  const actorMemberId = cleanText(body.actorMemberId || body.actor_member_id);
  const memberIds = Array.isArray(body.memberIds || body.member_ids)
    ? [...new Set((body.memberIds || body.member_ids).map(cleanText).filter(Boolean))]
    : [];
  const adminCheck = await requireAdminById(actorMemberId);

  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  if (memberIds.length === 0) {
    sendJson(res, 400, { error: "Aucun joueur a remettre a faire." });
    return;
  }

  if (memberIds.length > MAX_MEMBER_ROWS) {
    sendJson(res, 400, { error: "Trop de joueurs dans la demande." });
    return;
  }

  const { data: targets, error: targetError } = await supabase
    .from("guild_members")
    .select("id, role, discord_id, watcher_name, guild_code, personal_forum_post_url")
    .in("id", memberIds);

  if (targetError) {
    sendJson(res, 500, { error: targetError.message || "Chargement joueurs impossible." });
    return;
  }

  const manageableTargets = (targets || []).filter((target) =>
    canAdminManageTarget(adminCheck.admin, target)
  );

  if (manageableTargets.length !== memberIds.length) {
    sendJson(res, 403, { error: "Certains joueurs ne sont pas dans ton perimetre." });
    return;
  }

  const manageableIds = manageableTargets.map((target) => target.id);
  const { error: statusError } = await supabase
    .from("guild_members")
    .update({ status: TODO_STATUS })
    .in("id", manageableIds);

  if (statusError) {
    sendJson(res, 500, { error: statusError.message || "Reset des statuts impossible." });
    return;
  }

  const warnings = [];
  const forumRenames = [];
  for (const target of manageableTargets) {
    const forumChannelId = parseDiscordChannelId(target.personal_forum_post_url);
    if (!forumChannelId) continue;

    try {
      const rename = await renameDiscordChannelStatus(
        forumChannelId,
        getMemberName(target),
        getDiscordStatusEmoji(TODO_STATUS)
      );
      forumRenames.push({ memberId: target.id, ...rename });
    } catch (renameError) {
      warnings.push(serializeDiscordWarning(renameError, {
        type: "discord_channel_rename_failed",
        memberId: target.id,
        memberName: getMemberName(target),
      }));
    }
  }

  const adminName = getMemberName(adminCheck.admin);
  const guildCode = cleanText(body.guildCode || body.guild_code);

  await supabase.from("portal_activity_logs").insert({
    actor_member_id: adminCheck.admin.id,
    actor_name: adminName,
    action_type: "guild_management_status_reset",
    entity_type: "guild_members",
    entity_id: guildCode || null,
    summary: `${adminName} a remis les statuts defense en A faire${guildCode ? ` (${guildCode})` : ""}`,
    metadata: {
      guildCode,
      count: manageableTargets.length,
      renamedCount: forumRenames.filter((rename) => rename?.renamed).length,
      warnings,
    },
  });

  sendJson(res, 200, {
    ok: true,
    memberIds: manageableIds,
    status: TODO_STATUS,
    forumRenames,
    warnings,
  });
}

async function handleSendDefenses(body, res) {
  const actorMemberId = cleanText(body.actorMemberId || body.actor_member_id);
  const memberId = cleanText(body.memberId || body.member_id);
  const adminCheck = await requireAdminById(actorMemberId);

  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  if (!memberId) {
    sendJson(res, 400, { error: "Joueur manquant." });
    return;
  }

  const { data: target, error: targetError } = await supabase
    .from("guild_members")
    .select("id, role, discord_id, watcher_name, guild_code, defense_1, defense_2, personal_forum_post_url")
    .eq("id", memberId)
    .maybeSingle();

  if (targetError) {
    sendJson(res, 500, { error: targetError.message || "Joueur introuvable." });
    return;
  }

  if (!target) {
    sendJson(res, 404, { error: "Joueur introuvable." });
    return;
  }

  if (!canAdminManageTarget(adminCheck.admin, target)) {
    sendJson(res, 403, { error: "Ce joueur n'est pas dans ton perimetre." });
    return;
  }

  if (!target.discord_id) {
    sendJson(res, 400, { error: "ID Discord du joueur manquant." });
    return;
  }

  const defenseNames = [normalizeDefenseName(target.defense_1), normalizeDefenseName(target.defense_2)].filter(Boolean);
  if (defenseNames.length === 0) {
    sendJson(res, 400, { error: "Aucune defense assignee a ce joueur." });
    return;
  }

  const { data: defenseRows, error: defenseError } = await supabase
    .from("guild_defenses")
    .select(`
      id,
      name,
      tier,
      type,
      faction,
      guild_code,
      is_global,
      image_url,
      guild_defense_slots (
        slot_index,
        champions (
          name
        )
      ),
      guild_defense_conditions (
        min_awakening,
        champions (
          name
        )
      ),
      guild_defense_blocks (
        block_type,
        content,
        sort_order
      )
    `)
    .in("name", defenseNames);

  if (defenseError) {
    sendJson(res, 500, { error: defenseError.message || "Chargement defenses impossible." });
    return;
  }

  const defenses = [];
  const missingNames = [];
  const customContent = cleanText(body.customMessage || body.custom_message || body.message);

  defenseNames.forEach((name) => {
    const defense = pickDefenseForGuild(defenseRows || [], name, target.guild_code);
    if (defense) defenses.push(defense);
    else missingNames.push(name);
  });

  const content =
    customContent ||
    buildDefenseMessage({
      target,
      defenses,
      missingNames,
      actor: adminCheck.admin,
    });

  const dmMessageIds = await sendDiscordDm(target.discord_id, content);
  const forumPostUrl = cleanText(body.forumPostUrl || body.forum_post_url || target.personal_forum_post_url);
  const forumChannelId = parseDiscordChannelId(forumPostUrl);
  let forumMessageIds = [];
  const warnings = [];
  let forumRename = null;
  let followupTracking = null;
  let statusUpdated = false;

  if (forumChannelId) {
    forumMessageIds = await sendDiscordMessages(forumChannelId, content);

    try {
      forumRename = await renameDiscordChannelStatus(
        forumChannelId,
        getMemberName(target),
        getDiscordStatusEmoji(VERIFY_STATUS)
      );
    } catch (renameError) {
      warnings.push(serializeDiscordWarning(renameError, {
        type: "discord_channel_rename_failed",
        memberId: target.id,
        memberName: getMemberName(target),
      }));
    }
  }

  const { error: statusError } = await supabase
    .from("guild_members")
    .update({ status: VERIFY_STATUS })
    .eq("id", target.id);

  if (statusError) {
    warnings.push({
      type: "member_status_update_failed",
      message: statusError.message || "status update failed",
    });
  } else {
    statusUpdated = true;
  }

  if (forumChannelId && forumMessageIds.length > 0) {
    const followupUpdatedAt = new Date().toISOString();
    const { error: supersedeError } = await supabase
      .from(DEFENSE_FOLLOWUP_TABLE)
      .update({
        state: "deleted",
        updated_at: followupUpdatedAt,
        last_error: "superseded_by_new_defense_message",
      })
      .eq("member_id", target.id)
      .eq("discord_channel_id", forumChannelId)
      .eq("state", "pending");

    if (supersedeError && !isMissingFollowupTable(supersedeError)) {
      warnings.push({
        type: "followup_supersede_failed",
        message: supersedeError.message || "followup supersede failed",
      });
    }

    const { data: followupRow, error: followupError } = await supabase
      .from(DEFENSE_FOLLOWUP_TABLE)
      .insert({
        guild_code: normalizeGuildCode(target.guild_code),
        member_id: target.id,
        member_name: getMemberName(target),
        member_discord_id: target.discord_id || null,
        admin_member_id: adminCheck.admin.id,
        admin_name: getMemberName(adminCheck.admin),
        discord_channel_id: forumChannelId,
        discord_message_id: forumMessageIds[0] || null,
        discord_message_ids: forumMessageIds.filter(Boolean),
        dm_message_ids: dmMessageIds.filter(Boolean),
        forum_post_url: forumPostUrl || null,
        defense_names: defenseNames,
        message_content: content,
        thread_name_before: forumRename?.before || null,
        thread_name_after: forumRename?.after || null,
        state: "pending",
        updated_at: followupUpdatedAt,
      })
      .select("id")
      .maybeSingle();

    if (followupError) {
      warnings.push({
        type: isMissingFollowupTable(followupError)
          ? "missing_guild_defense_discord_followups_table"
          : "followup_tracking_failed",
        message: followupError.message || "followup tracking failed",
      });
    } else {
      followupTracking = { id: followupRow?.id || null };
    }
  }

  const adminName = getMemberName(adminCheck.admin);
  const targetName = getMemberName(target);

  await supabase.from("portal_activity_logs").insert({
    actor_member_id: adminCheck.admin.id,
    actor_name: adminName,
    target_member_id: target.id,
    target_name: targetName,
    action_type: "guild_management_defenses_sent",
    entity_type: "guild_members",
    entity_id: target.id,
    summary: `${adminName} a envoye les defenses de ${targetName} sur Discord`,
    metadata: {
      guildCode: target.guild_code || "",
      defenseNames,
      dmMessageIds,
      forumMessageIds,
      forumPostUrl: forumPostUrl || "",
      forumRename,
      followupTracking,
      statusUpdated,
      warnings,
    },
  });

  sendJson(res, 200, {
    ok: true,
    dmMessageIds,
    forumMessageIds,
    forumSkipped: !forumChannelId,
    forumRename,
    followupTracking,
    statusUpdated,
    warnings,
  });
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    const body = await readBody(req);
    const action = cleanText(body.action);

    if (action === "search") {
      await handleSearch(body, res);
      return;
    }

    if (action === "reset") {
      await handleReset(body, res);
      return;
    }

    if (action === "send-defenses") {
      await handleSendDefenses(body, res);
      return;
    }

    if (action === "update-defense-status") {
      await handleUpdateDefenseStatus(body, res);
      return;
    }

    if (action === "reset-defense-statuses") {
      await handleResetDefenseStatuses(body, res);
      return;
    }

    sendJson(res, 400, { error: "Action inconnue." });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || "Erreur acces joueurs." });
  }
}
