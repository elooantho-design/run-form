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

  defenseNames.forEach((name) => {
    const defense = pickDefenseForGuild(defenseRows || [], name, target.guild_code);
    if (defense) defenses.push(defense);
    else missingNames.push(name);
  });

  const content = buildDefenseMessage({
    target,
    defenses,
    missingNames,
    actor: adminCheck.admin,
  });

  const dmMessageIds = await sendDiscordDm(target.discord_id, content);
  const forumPostUrl = cleanText(body.forumPostUrl || body.forum_post_url || target.personal_forum_post_url);
  const forumChannelId = parseDiscordChannelId(forumPostUrl);
  let forumMessageIds = [];

  if (forumChannelId) {
    forumMessageIds = await sendDiscordMessages(forumChannelId, content);
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
    },
  });

  sendJson(res, 200, {
    ok: true,
    dmMessageIds,
    forumMessageIds,
    forumSkipped: !forumChannelId,
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

    sendJson(res, 400, { error: "Action inconnue." });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || "Erreur acces joueurs." });
  }
}
