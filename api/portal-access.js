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
const COMMUNITY_REQUESTS_TABLE = "portal_community_access_requests";
const TODO_STATUS = "\u00c0 faire";
const VERIFY_STATUS = "\u00c0 v\u00e9rifier";
const VALID_STATUS = "Valid\u00e9";
const DISCORD_STATUS_TODO = "\u274c";
const DISCORD_STATUS_VERIFY = "\u26a0\uFE0F";
const DISCORD_STATUS_DONE = "\u2705";
const DEFENSE_STATUSES = new Set([TODO_STATUS, VERIFY_STATUS, VALID_STATUS]);
const COMMUNITY_ROLES = new Set(["community_member", "content_creator"]);
const COMMUNITY_STATUSES = new Set(["active", "inactive"]);
const COMMUNITY_REQUEST_STATUSES = new Set(["pending", "accepted", "refused"]);

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

function isCommunityRole(role) {
  return COMMUNITY_ROLES.has(normalizeText(role));
}

function normalizeCommunityRole(role) {
  const normalized = normalizeText(role);
  return COMMUNITY_ROLES.has(normalized) ? normalized : "community_member";
}

function normalizeCommunityStatus(status) {
  const normalized = normalizeText(status);
  return COMMUNITY_STATUSES.has(normalized) ? normalized : "active";
}

function normalizeCommunityRequestStatus(status) {
  const normalized = normalizeText(status);
  return COMMUNITY_REQUEST_STATUSES.has(normalized) ? normalized : "pending";
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

function serializeCommunityMember(member) {
  return {
    id: member.id,
    watcherName: member.watcher_name || "",
    name: getMemberName(member),
    discordId: member.discord_id || "",
    preferredLanguage: member.preferred_language || "fr",
    role: normalizeCommunityRole(member.role),
    status: normalizeCommunityStatus(member.community_status),
    guildCode: member.guild_code || "",
    accessType: member.community_access_type || (isCommunityRole(member.role) ? "community" : ""),
    createdAt: member.created_at || null,
  };
}

function serializeCommunityRequest(row) {
  return {
    id: row.id,
    discordContact: row.discord_contact || "",
    preferredLanguage: row.preferred_language || "fr",
    guildName: row.guild_name || "",
    message: row.message || "",
    status: normalizeCommunityRequestStatus(row.status),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    handledAt: row.handled_at || null,
    handledByMemberId: row.handled_by_member_id || null,
    handledByName: row.handled_by_name || "",
    createdMemberId: row.created_member_id || null,
    metadata: row.metadata || {},
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

async function requireLeaderById(actorMemberId) {
  if (!actorMemberId) {
    return { error: "Session leader manquante.", status: 401 };
  }

  const { data, error } = await supabase
    .from("guild_members")
    .select("id, role, discord_id, watcher_name, guild_code")
    .eq("id", actorMemberId)
    .maybeSingle();

  if (error) {
    return { error: error.message || "Verification leader impossible.", status: 500 };
  }

  if (!data || !isLeaderRole(data.role)) {
    return { error: "Acces leader refuse.", status: 403 };
  }

  return { leader: data };
}

async function initializeMemberData(memberId, memberName) {
  const warnings = [];
  const { data: champions, error: championsError } = await supabase
    .from("champions")
    .select("id, name")
    .order("name", { ascending: true });

  if (championsError) {
    warnings.push("Initialisation des eveils impossible.");
  } else {
    const awakeningRows = (champions || [])
      .filter((champion) => champion.id)
      .map((champion) => ({
        member_id: memberId,
        champion_id: champion.id,
        awakening_level: -1,
      }));

    if (awakeningRows.length) {
      const { error } = await supabase.from("member_awakenings").insert(awakeningRows);
      if (error) warnings.push("Initialisation des eveils impossible.");
    }
  }

  const pbRows = [1, 2, 3, 4, 5].map((slotIndex) => ({
    member_id: memberId,
    member_name: memberName,
    slot_index: slotIndex,
    pb_raw: 0,
    champion_id: null,
  }));

  const { error: pbError } = await supabase.from("member_pb_entries").insert(pbRows);
  if (pbError) warnings.push("Initialisation des PB impossible.");

  return warnings;
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

async function handleExternalAccountRequest(body, req, res) {
  const discordContact = cleanText(body.discordContact || body.discord_contact || body.discordId || body.discord_id);
  const preferredLanguage = cleanText(body.preferredLanguage || body.preferred_language || body.language || "fr") || "fr";
  const guildName = cleanText(body.guildName || body.guild_name || body.guild || "");

  if (discordContact.length < 2) {
    sendJson(res, 400, { error: "Contact Discord obligatoire." });
    return;
  }

  if (discordContact.length > 120 || guildName.length > 120) {
    sendJson(res, 400, { error: "Demande trop longue." });
    return;
  }

  const cleanLanguage = ["fr", "en"].includes(preferredLanguage.toLowerCase())
    ? preferredLanguage.toLowerCase()
    : "fr";

  let existingMember = null;
  if (/^\d{15,25}$/.test(discordContact)) {
    const { data, error } = await supabase
      .from("guild_members")
      .select("id, watcher_name, discord_id, guild_code")
      .eq("discord_id", discordContact)
      .maybeSingle();

    if (error) {
      sendJson(res, 500, { error: error.message || "Verification du compte impossible." });
      return;
    }

    existingMember = data || null;
  }

  if (existingMember) {
    sendJson(res, 409, {
      error: "Un compte existe deja pour cet ID Discord. Utilise mot de passe oublie ou contacte un admin.",
      member: serializeMember(existingMember),
    });
    return;
  }

  const { data: members, error: leadersError } = await supabase
    .from("guild_members")
    .select("id, role, watcher_name, discord_id, guild_code")
    .limit(MAX_MEMBER_ROWS);

  if (leadersError) {
    sendJson(res, 500, { error: leadersError.message || "Chargement leaders impossible." });
    return;
  }

  const leaders = (members || []).filter((member) => isLeaderRole(member.role) && member.discord_id);
  const sourceIp = cleanText(
    req.headers["x-forwarded-for"] ||
      req.headers["x-real-ip"] ||
      req.socket?.remoteAddress ||
      ""
  ).split(",")[0] || "";
  const summary = `Nouvelle demande de compte externe : ${discordContact}`;

  const { data: requestRow, error: requestError } = await supabase
    .from(COMMUNITY_REQUESTS_TABLE)
    .insert({
      discord_contact: discordContact,
      preferred_language: cleanLanguage,
      guild_name: guildName || null,
      status: "pending",
      source_ip: sourceIp || null,
      metadata: {
        source: "portal_login",
      },
    })
    .select("id, created_at")
    .maybeSingle();

  if (requestError) {
    sendJson(res, 500, { error: requestError.message || "Enregistrement de la demande impossible." });
    return;
  }

  const { data: logRow, error: logError } = await supabase
    .from("portal_activity_logs")
    .insert({
      actor_name: "Demande externe",
      target_name: discordContact,
      action_type: "external_account_request",
      entity_type: "external_access",
      entity_id: discordContact,
      summary,
      metadata: {
        requestId: requestRow?.id || null,
        discordContact,
        preferredLanguage: cleanLanguage,
        guildName,
        sourceIp,
      },
    })
    .select("id, created_at")
    .maybeSingle();

  if (logError) {
    sendJson(res, 500, { error: logError.message || "Enregistrement de la demande impossible." });
    return;
  }

  const warnings = [];
  const dmMessageIds = [];
  const leaderMessage = [
    "**Nouvelle demande de compte Portal**",
    "",
    `Contact Discord : ${discordContact}`,
    `Langue : ${cleanLanguage.toUpperCase()}`,
    `Guilde indiquee : ${guildName || "-"}`,
    `Demande : ${requestRow?.id || "-"}`,
    `Log Portal : ${logRow?.id || "-"}`,
  ].join("\n");

  for (const leader of leaders) {
    try {
      const sentIds = await sendDiscordDm(leader.discord_id, leaderMessage);
      dmMessageIds.push(...sentIds.filter(Boolean));
    } catch (discordError) {
      warnings.push(
        serializeDiscordWarning(discordError, {
          type: "external_request_dm_failed",
          leaderId: leader.id,
          leaderName: getMemberName(leader),
        })
      );
    }
  }

  if (!leaders.length) {
    warnings.push({
      type: "missing_leader_discord_id",
      message: "Aucun leader avec ID Discord trouve pour recevoir le MP.",
    });
  }

  if (dmMessageIds.length || warnings.length) {
    await supabase
      .from("portal_activity_logs")
      .update({
        metadata: {
          discordContact,
          requestId: requestRow?.id || null,
          preferredLanguage: cleanLanguage,
          guildName,
          sourceIp,
          dmMessageIds,
          warnings,
        },
      })
      .eq("id", logRow?.id);
  }

  sendJson(res, 200, {
    ok: true,
    requestId: requestRow?.id || null,
    logId: logRow?.id || null,
    notifiedLeaders: dmMessageIds.length,
    warnings,
  });
}

async function handleCommunityList(body, res) {
  const actorMemberId = cleanText(body.actorMemberId || body.actor_member_id);
  const leaderCheck = await requireLeaderById(actorMemberId);

  if (leaderCheck.error) {
    sendJson(res, leaderCheck.status, { error: leaderCheck.error });
    return;
  }

  const [requestsResult, membersResult] = await Promise.all([
    supabase
      .from(COMMUNITY_REQUESTS_TABLE)
      .select(
        "id, created_at, updated_at, discord_contact, preferred_language, guild_name, message, status, handled_at, handled_by_member_id, handled_by_name, created_member_id, metadata",
      )
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("guild_members")
      .select(
        "id, watcher_name, discord_id, guild_code, role, created_at, preferred_language, community_access_type, community_status",
      )
      .is("guild_code", null)
      .order("watcher_name", { ascending: true })
      .limit(MAX_MEMBER_ROWS),
  ]);

  if (requestsResult.error) {
    sendJson(res, 500, { error: requestsResult.error.message || "Chargement des demandes impossible." });
    return;
  }

  if (membersResult.error) {
    sendJson(res, 500, { error: membersResult.error.message || "Chargement des membres communaute impossible." });
    return;
  }

  const members = (membersResult.data || []).filter(
    (member) => member.community_access_type === "community" || isCommunityRole(member.role),
  );

  sendJson(res, 200, {
    requests: (requestsResult.data || []).map(serializeCommunityRequest),
    members: members.map(serializeCommunityMember),
  });
}

async function handleCommunityUpdateRequest(body, res) {
  const actorMemberId = cleanText(body.actorMemberId || body.actor_member_id);
  const requestId = cleanText(body.requestId || body.request_id);
  const nextStatus = normalizeCommunityRequestStatus(body.status);
  const leaderCheck = await requireLeaderById(actorMemberId);

  if (leaderCheck.error) {
    sendJson(res, leaderCheck.status, { error: leaderCheck.error });
    return;
  }

  if (!requestId) {
    sendJson(res, 400, { error: "Demande manquante." });
    return;
  }

  const updatePayload = {
    status: nextStatus,
    handled_at: nextStatus === "pending" ? null : new Date().toISOString(),
    handled_by_member_id: nextStatus === "pending" ? null : leaderCheck.leader.id,
    handled_by_name: nextStatus === "pending" ? null : getMemberName(leaderCheck.leader),
  };

  const { data, error } = await supabase
    .from(COMMUNITY_REQUESTS_TABLE)
    .update(updatePayload)
    .eq("id", requestId)
    .select(
      "id, created_at, updated_at, discord_contact, preferred_language, guild_name, message, status, handled_at, handled_by_member_id, handled_by_name, created_member_id, metadata",
    )
    .maybeSingle();

  if (error) {
    sendJson(res, 500, { error: error.message || "Mise a jour de la demande impossible." });
    return;
  }

  if (!data) {
    sendJson(res, 404, { error: "Demande introuvable." });
    return;
  }

  await supabase.from("portal_activity_logs").insert({
    actor_member_id: leaderCheck.leader.id,
    actor_name: getMemberName(leaderCheck.leader),
    target_name: data.discord_contact || "",
    action_type: "community_request_update",
    entity_type: COMMUNITY_REQUESTS_TABLE,
    entity_id: data.id,
    summary: `${getMemberName(leaderCheck.leader)} a passe une demande communaute en ${nextStatus}`,
    metadata: { status: nextStatus },
  });

  sendJson(res, 200, { request: serializeCommunityRequest(data) });
}

async function handleCommunityCreateMember(body, res) {
  const actorMemberId = cleanText(body.actorMemberId || body.actor_member_id);
  const requestId = cleanText(body.requestId || body.request_id);
  const watcherName = cleanText(body.watcherName || body.watcher_name || body.name);
  const discordId = cleanText(body.discordId || body.discord_id);
  const role = normalizeCommunityRole(body.role);
  const preferredLanguage = ["fr", "en"].includes(cleanText(body.preferredLanguage || body.preferred_language).toLowerCase())
    ? cleanText(body.preferredLanguage || body.preferred_language).toLowerCase()
    : "fr";
  const leaderCheck = await requireLeaderById(actorMemberId);

  if (leaderCheck.error) {
    sendJson(res, leaderCheck.status, { error: leaderCheck.error });
    return;
  }

  if (!watcherName || !discordId) {
    sendJson(res, 400, { error: "Pseudo et ID Discord obligatoires." });
    return;
  }

  if (watcherName.length > 80 || discordId.length > 120) {
    sendJson(res, 400, { error: "Informations trop longues." });
    return;
  }

  const { data: existingMember, error: existingError } = await supabase
    .from("guild_members")
    .select("id, watcher_name, discord_id, guild_code, role")
    .eq("discord_id", discordId)
    .maybeSingle();

  if (existingError) {
    sendJson(res, 500, { error: existingError.message || "Verification du compte impossible." });
    return;
  }

  if (existingMember) {
    sendJson(res, 409, {
      error: "Un compte existe deja pour cet ID Discord.",
      member: serializeMember(existingMember),
    });
    return;
  }

  const temporaryPassword = generatePassword();
  const { data: member, error: insertError } = await supabase
    .from("guild_members")
    .insert({
      watcher_name: watcherName,
      discord_id: discordId,
      guild_code: null,
      role,
      password: temporaryPassword,
      assignment: "Communaut\u00e9",
      status: "Actif",
      awakening_status: "En attente",
      defense_1: "\u2014",
      defense_2: "\u2014",
      community_access_type: "community",
      community_status: "active",
      preferred_language: preferredLanguage,
    })
    .select("id, watcher_name, discord_id, guild_code, role, created_at, preferred_language, community_access_type, community_status")
    .maybeSingle();

  if (insertError) {
    sendJson(res, 500, { error: insertError.message || "Creation du membre communaute impossible." });
    return;
  }

  const warnings = await initializeMemberData(member.id, watcherName);

  let updatedRequest = null;
  if (requestId) {
    const { data: requestRow } = await supabase
      .from(COMMUNITY_REQUESTS_TABLE)
      .update({
        status: "accepted",
        handled_at: new Date().toISOString(),
        handled_by_member_id: leaderCheck.leader.id,
        handled_by_name: getMemberName(leaderCheck.leader),
        created_member_id: member.id,
      })
      .eq("id", requestId)
      .select(
        "id, created_at, updated_at, discord_contact, preferred_language, guild_name, message, status, handled_at, handled_by_member_id, handled_by_name, created_member_id, metadata",
      )
      .maybeSingle();

    updatedRequest = requestRow || null;
  }

  await supabase.from("portal_activity_logs").insert({
    actor_member_id: leaderCheck.leader.id,
    actor_name: getMemberName(leaderCheck.leader),
    target_member_id: member.id,
    target_name: watcherName,
    action_type: "community_member_create",
    entity_type: "guild_members",
    entity_id: member.id,
    summary: `${getMemberName(leaderCheck.leader)} a cree le compte communaute de ${watcherName}`,
    metadata: { role, preferredLanguage, requestId: requestId || null },
  });

  sendJson(res, 200, {
    member: serializeCommunityMember(member),
    request: updatedRequest ? serializeCommunityRequest(updatedRequest) : null,
    temporaryPassword,
    warnings,
  });
}

async function handleCommunityUpdateMember(body, res) {
  const actorMemberId = cleanText(body.actorMemberId || body.actor_member_id);
  const memberId = cleanText(body.memberId || body.member_id);
  const watcherName = cleanText(body.watcherName || body.watcher_name || body.name);
  const discordId = cleanText(body.discordId || body.discord_id);
  const role = normalizeCommunityRole(body.role);
  const status = normalizeCommunityStatus(body.status || body.community_status);
  const preferredLanguage = ["fr", "en"].includes(cleanText(body.preferredLanguage || body.preferred_language).toLowerCase())
    ? cleanText(body.preferredLanguage || body.preferred_language).toLowerCase()
    : "fr";
  const leaderCheck = await requireLeaderById(actorMemberId);

  if (leaderCheck.error) {
    sendJson(res, leaderCheck.status, { error: leaderCheck.error });
    return;
  }

  if (!memberId || !watcherName || !discordId) {
    sendJson(res, 400, { error: "Membre, pseudo et ID Discord obligatoires." });
    return;
  }

  const { data: target, error: targetError } = await supabase
    .from("guild_members")
    .select("id, watcher_name, discord_id, guild_code, role, community_access_type")
    .eq("id", memberId)
    .maybeSingle();

  if (targetError) {
    sendJson(res, 500, { error: targetError.message || "Chargement du membre impossible." });
    return;
  }

  if (!target || target.guild_code || (target.community_access_type !== "community" && !isCommunityRole(target.role))) {
    sendJson(res, 404, { error: "Membre communaute introuvable." });
    return;
  }

  const { data: duplicate, error: duplicateError } = await supabase
    .from("guild_members")
    .select("id")
    .eq("discord_id", discordId)
    .neq("id", memberId)
    .maybeSingle();

  if (duplicateError) {
    sendJson(res, 500, { error: duplicateError.message || "Verification ID Discord impossible." });
    return;
  }

  if (duplicate) {
    sendJson(res, 409, { error: "Cet ID Discord est deja utilise par un autre compte." });
    return;
  }

  const { data: member, error: updateError } = await supabase
    .from("guild_members")
    .update({
      watcher_name: watcherName,
      discord_id: discordId,
      role,
      community_access_type: "community",
      community_status: status,
      preferred_language: preferredLanguage,
    })
    .eq("id", memberId)
    .select("id, watcher_name, discord_id, guild_code, role, created_at, preferred_language, community_access_type, community_status")
    .maybeSingle();

  if (updateError) {
    sendJson(res, 500, { error: updateError.message || "Mise a jour du membre impossible." });
    return;
  }

  await supabase.from("portal_activity_logs").insert({
    actor_member_id: leaderCheck.leader.id,
    actor_name: getMemberName(leaderCheck.leader),
    target_member_id: member.id,
    target_name: watcherName,
    action_type: "community_member_update",
    entity_type: "guild_members",
    entity_id: member.id,
    summary: `${getMemberName(leaderCheck.leader)} a modifie ${watcherName}`,
    metadata: { role, status, preferredLanguage },
  });

  sendJson(res, 200, { member: serializeCommunityMember(member) });
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

    if (action === "external-account-request") {
      await handleExternalAccountRequest(body, req, res);
      return;
    }

    if (action === "community-list") {
      await handleCommunityList(body, res);
      return;
    }

    if (action === "community-update-request") {
      await handleCommunityUpdateRequest(body, res);
      return;
    }

    if (action === "community-create-member") {
      await handleCommunityCreateMember(body, res);
      return;
    }

    if (action === "community-update-member") {
      await handleCommunityUpdateMember(body, res);
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
