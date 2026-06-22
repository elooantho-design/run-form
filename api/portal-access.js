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
  return ["admin", "administrateur", "leader", "officier"].includes(
    normalizeText(role)
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

    sendJson(res, 400, { error: "Action inconnue." });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || "Erreur acces joueurs." });
  }
}
