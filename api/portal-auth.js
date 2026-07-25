/* global process */
import { createClient } from "@supabase/supabase-js";
import {
  applyPortalCorsHeaders,
  buildPortalSession,
  clearPortalSessionCookie,
  createPortalSessionToken,
  getPortalMemberName,
  hashPortalPassword,
  isForcedPortalPassword,
  isPortalAdminRole,
  isPortalCommunityRole,
  loadPortalMemberByDiscordId,
  readJsonBody,
  requirePortalSession,
  sendPortalJson,
  setPortalSessionCookie,
  updatePortalMemberPassword,
  validatePortalInput,
  verifyPortalPassword,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const LOGIN_LOCK_MS = 2 * 60 * 1000;
const rateLimitBuckets = new Map();

function cleanText(value) {
  return String(value || "").trim();
}

function getClientIp(req) {
  return cleanText(req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

function getRateLimitKey(req, suffix) {
  return `${getClientIp(req)}:${suffix}`;
}

function checkRateLimit(key) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);

  if (bucket?.lockedUntil && bucket.lockedUntil > now) {
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((bucket.lockedUntil - now) / 1000),
    };
  }

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + LOGIN_WINDOW_MS,
      lockedUntil: 0,
    });
    return { ok: true };
  }

  bucket.count += 1;
  if (bucket.count > LOGIN_MAX_ATTEMPTS) {
    bucket.lockedUntil = now + LOGIN_LOCK_MS;
    return {
      ok: false,
      retryAfterSeconds: Math.ceil(LOGIN_LOCK_MS / 1000),
    };
  }

  return { ok: true };
}

function clearRateLimit(key) {
  rateLimitBuckets.delete(key);
}

async function writeActivity(row) {
  await supabase.from("portal_activity_logs").insert(row);
}

async function handleLogin(req, res, body) {
  const discordId = validatePortalInput(body.discordId || body.discord_id || body.identifier, 80);
  const password = validatePortalInput(body.password, 240);
  const remember = Boolean(body.remember);

  if (!discordId || !password) {
    sendPortalJson(res, 400, { error: "Identifiant Discord ou mot de passe incorrect." }, req);
    return;
  }

  const rateKey = getRateLimitKey(req, `login:${discordId.toLowerCase()}`);
  const rate = checkRateLimit(rateKey);
  if (!rate.ok) {
    sendPortalJson(
      res,
      429,
      { error: `Trop d'essais. Reessaie dans ${rate.retryAfterSeconds}s.` },
      req,
    );
    return;
  }

  let member;
  try {
    member = await loadPortalMemberByDiscordId(supabase, discordId, { includePassword: true });
  } catch {
    sendPortalJson(res, 500, { error: "Connexion impossible. Reessaie ou contacte un admin." }, req);
    return;
  }

  const passwordCheck = verifyPortalPassword(password, member?.password);
  if (!member || !passwordCheck.ok) {
    sendPortalJson(res, 401, { error: "Identifiant Discord ou mot de passe incorrect." }, req);
    return;
  }

  if (
    (member.community_access_type === "community" || isPortalCommunityRole(member.role)) &&
    String(member.community_status || "").trim().toLowerCase() === "inactive"
  ) {
    sendPortalJson(res, 403, { error: "Ce compte communaute est desactive. Contacte Darius." }, req);
    return;
  }

  const passwordChangeRequired =
    Boolean(member.password_change_required) || isForcedPortalPassword(password);

  if (passwordCheck.needsMigration) {
    await updatePortalMemberPassword(supabase, member.id, hashPortalPassword(password), {
      passwordChangeRequired,
    });
    member.password_change_required = passwordChangeRequired;
  }

  clearRateLimit(rateKey);

  const token = createPortalSessionToken(member, { remember });
  setPortalSessionCookie(res, token, { remember });
  sendPortalJson(
    res,
    200,
    { session: buildPortalSession(member, { passwordChangeRequired }) },
    req,
  );
}

async function handleSession(req, res) {
  const sessionCheck = await requirePortalSession(req, supabase);
  if (sessionCheck.error) {
    sendPortalJson(res, sessionCheck.status, { error: sessionCheck.error }, req);
    return;
  }

  sendPortalJson(res, 200, { session: sessionCheck.session }, req);
}

async function handleLogout(req, res) {
  clearPortalSessionCookie(res);
  sendPortalJson(res, 200, { ok: true }, req);
}

async function handlePasswordChange(req, res, body) {
  const sessionCheck = await requirePortalSession(req, supabase, { includePassword: true });
  if (sessionCheck.error) {
    sendPortalJson(res, sessionCheck.status, { error: sessionCheck.error }, req);
    return;
  }

  const currentPassword = validatePortalInput(body.currentPassword || body.current_password, 240);
  const newPassword = validatePortalInput(body.newPassword || body.new_password, 240);

  if (!currentPassword || !newPassword) {
    sendPortalJson(res, 400, { error: "Mot de passe actuel et nouveau mot de passe obligatoires." }, req);
    return;
  }

  if (newPassword.length < 6) {
    sendPortalJson(res, 400, { error: "Le nouveau mot de passe doit faire au moins 6 caracteres." }, req);
    return;
  }

  if (isForcedPortalPassword(newPassword)) {
    sendPortalJson(res, 400, { error: "Choisis un mot de passe different du mot de passe temporaire." }, req);
    return;
  }

  const passwordCheck = verifyPortalPassword(currentPassword, sessionCheck.member.password);
  if (!passwordCheck.ok) {
    sendPortalJson(res, 403, { error: "Le mot de passe actuel est incorrect." }, req);
    return;
  }

  await updatePortalMemberPassword(supabase, sessionCheck.member.id, hashPortalPassword(newPassword), {
    passwordChangeRequired: false,
  });
  sessionCheck.member.password_change_required = false;

  const token = createPortalSessionToken(sessionCheck.member, { remember: false });
  setPortalSessionCookie(res, token, { remember: false });

  await writeActivity({
    actor_member_id: sessionCheck.member.id,
    actor_name: getPortalMemberName(sessionCheck.member),
    target_member_id: sessionCheck.member.id,
    target_name: getPortalMemberName(sessionCheck.member),
    action_type: "player_password_change",
    entity_type: "guild_members",
    entity_id: sessionCheck.member.id,
    summary: `${getPortalMemberName(sessionCheck.member)} a change son mot de passe`,
    metadata: { forcedFlow: true },
  });

  sendPortalJson(
    res,
    200,
    { session: buildPortalSession(sessionCheck.member, { passwordChangeRequired: false }) },
    req,
  );
}

async function handleForgotAdmins(req, res, body) {
  const discordId = validatePortalInput(body.discordId || body.discord_id, 80);
  if (!discordId) {
    sendPortalJson(res, 400, { error: "ID Discord obligatoire." }, req);
    return;
  }

  const rateKey = getRateLimitKey(req, `forgot:${discordId.toLowerCase()}`);
  const rate = checkRateLimit(rateKey);
  if (!rate.ok) {
    sendPortalJson(
      res,
      429,
      { error: `Trop d'essais. Reessaie dans ${rate.retryAfterSeconds}s.` },
      req,
    );
    return;
  }

  const { data: member, error: memberError } = await supabase
    .from("guild_members")
    .select("id, watcher_name, discord_id, guild_code")
    .eq("discord_id", discordId)
    .maybeSingle();

  if (memberError) {
    sendPortalJson(res, 500, { error: "Recherche impossible pour le moment." }, req);
    return;
  }

  if (!member) {
    sendPortalJson(res, 404, { error: "Aucun compte Portal trouve pour cet ID Discord." }, req);
    return;
  }

  const guildCode = cleanText(member.guild_code);
  if (!guildCode) {
    sendPortalJson(res, 404, { error: "Ce compte n'a pas de guilde assignee. Contacte un admin Paladin." }, req);
    return;
  }

  const { data: admins, error: adminsError } = await supabase
    .from("guild_members")
    .select("watcher_name, discord_id, role, guild_code")
    .eq("guild_code", guildCode);

  if (adminsError) {
    sendPortalJson(res, 500, { error: "Recherche admins impossible pour le moment." }, req);
    return;
  }

  const adminRows = (admins || [])
    .filter((row) => isPortalAdminRole(row.role))
    .sort((left, right) =>
      String(left.watcher_name || "").localeCompare(String(right.watcher_name || ""), "fr", {
        sensitivity: "base",
      }),
    )
    .map((row) => ({
      name: row.watcher_name || row.discord_id || "Admin",
      discordId: row.discord_id || "",
      role: row.role || "admin",
    }));

  clearRateLimit(rateKey);
  sendPortalJson(res, 200, { guildCode, admins: adminRows }, req);
}

export default async function handler(req, res) {
  applyPortalCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!verifyPortalRequestOrigin(req)) {
    sendPortalJson(res, 403, { error: "Origine de requete invalide." }, req);
    return;
  }

  try {
    const action = cleanText(req.query?.action || "");

    if (req.method === "GET" && action === "session") {
      await handleSession(req, res);
      return;
    }

    if (req.method !== "POST") {
      sendPortalJson(res, 405, { error: "Method not allowed" }, req);
      return;
    }

    const body = await readJsonBody(req);
    const bodyAction = cleanText(body.action || action);

    if (bodyAction === "login") {
      await handleLogin(req, res, body);
      return;
    }

    if (bodyAction === "logout") {
      await handleLogout(req, res);
      return;
    }

    if (bodyAction === "change-password") {
      await handlePasswordChange(req, res, body);
      return;
    }

    if (bodyAction === "forgot-admins") {
      await handleForgotAdmins(req, res, body);
      return;
    }

    sendPortalJson(res, 400, { error: "Action auth inconnue." }, req);
  } catch (error) {
    sendPortalJson(res, error?.status || 500, {
      error: error?.message || "Erreur authentification Portal.",
    }, req);
  }
}
