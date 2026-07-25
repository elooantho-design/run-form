/* global Buffer, process */
import crypto from "node:crypto";

export const PORTAL_SESSION_COOKIE = "portal_session";
const HASH_PREFIX = "scrypt$1$";
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const REMEMBER_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_FIELD_LENGTH = 240;
const DEFAULT_PASSWORDS = new Set(["motdepassemembre", "motdepasseadmin"]);
const TEMPORARY_PASSWORD_PREFIX = "TMP-";

function cleanText(value) {
  return String(value || "").trim();
}

export function normalizePortalText(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function isPortalAdminRole(role) {
  return ["admin", "administrateur", "leader"].includes(normalizePortalText(role));
}

export function isPortalLeaderRole(role) {
  return normalizePortalText(role) === "leader";
}

export function isPortalCommunityRole(role) {
  return ["community_member", "content_creator", "vip"].includes(normalizePortalText(role));
}

export function isForcedPortalPassword(password) {
  const cleanPassword = cleanText(password);
  return DEFAULT_PASSWORDS.has(cleanPassword) || cleanPassword.startsWith(TEMPORARY_PASSWORD_PREFIX);
}

export function getPortalMemberName(member) {
  return member?.watcher_name || member?.discord_id || "Joueur";
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(String(value || ""), "base64url").toString("utf8");
}

function getSessionSecret() {
  const secret = cleanText(process.env.PORTAL_SESSION_SECRET);
  if (secret) return secret;

  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    return "dev-only-portal-session-secret-change-me";
  }

  throw new Error("PORTAL_SESSION_SECRET manquant cote serveur.");
}

function signPayload(payload) {
  return crypto
    .createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("base64url");
}

export function createPortalSessionToken(member, options = {}) {
  const ttlSeconds = options.remember ? REMEMBER_SESSION_TTL_SECONDS : SESSION_TTL_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: String(member?.id || ""),
      iat: now,
      exp: now + ttlSeconds,
    }),
  );
  return `${payload}.${signPayload(payload)}`;
}

export function parseCookies(req) {
  const cookieHeader = String(req?.headers?.cookie || "");
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf("=");
        if (separatorIndex === -1) return [part, ""];
        return [
          decodeURIComponent(part.slice(0, separatorIndex)),
          decodeURIComponent(part.slice(separatorIndex + 1)),
        ];
      }),
  );
}

function isSecureCookie() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
}

export function setPortalSessionCookie(res, token, options = {}) {
  const maxAge = options.remember ? REMEMBER_SESSION_TTL_SECONDS : SESSION_TTL_SECONDS;
  const attributes = [
    `${PORTAL_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (isSecureCookie()) attributes.push("Secure");
  res.setHeader("Set-Cookie", attributes.join("; "));
}

export function clearPortalSessionCookie(res) {
  const attributes = [
    `${PORTAL_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (isSecureCookie()) attributes.push("Secure");
  res.setHeader("Set-Cookie", attributes.join("; "));
}

export function verifyPortalSessionToken(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;

  const expectedSignature = signPayload(payload);
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;

  let decoded;
  try {
    decoded = JSON.parse(base64UrlDecode(payload));
  } catch {
    return null;
  }

  if (!decoded?.sub || !decoded?.exp || Number(decoded.exp) <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return decoded;
}

export function isHashedPortalPassword(value) {
  return cleanText(value).startsWith(HASH_PREFIX);
}

export function hashPortalPassword(password) {
  const cleanPassword = cleanText(password);
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(cleanPassword, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return `${HASH_PREFIX}${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPortalPassword(candidate, stored) {
  const cleanCandidate = cleanText(candidate);
  const cleanStored = String(stored || "");

  if (!cleanCandidate || !cleanStored) return { ok: false, needsMigration: false };

  if (!isHashedPortalPassword(cleanStored)) {
    return {
      ok: cleanCandidate === cleanStored,
      needsMigration: cleanCandidate === cleanStored,
    };
  }

  const [, version, saltValue, hashValue] = cleanStored.split("$");
  if (version !== "1" || !saltValue || !hashValue) {
    return { ok: false, needsMigration: false };
  }

  let expected;
  let actual;
  try {
    const salt = Buffer.from(saltValue, "base64url");
    expected = Buffer.from(hashValue, "base64url");
    actual = crypto.scryptSync(cleanCandidate, salt, expected.length, {
      N: 16384,
      r: 8,
      p: 1,
    });
  } catch {
    return { ok: false, needsMigration: false };
  }

  return {
    ok: actual.length === expected.length && crypto.timingSafeEqual(actual, expected),
    needsMigration: false,
  };
}

export function validatePortalInput(value, maxLength = MAX_FIELD_LENGTH) {
  const cleanValue = cleanText(value);
  if (cleanValue.length > maxLength) return "";
  return cleanValue;
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export function applyPortalSecurityHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

export function applyPortalCorsHeaders(req, res) {
  const origin = cleanText(req?.headers?.origin);
  if (!origin) return;

  let allowed = false;
  try {
    const parsedOrigin = new URL(origin);
    const requestHost = cleanText(req?.headers?.["x-forwarded-host"] || req?.headers?.host);
    allowed =
      parsedOrigin.host === requestHost ||
      ["localhost", "127.0.0.1"].includes(parsedOrigin.hostname);
  } catch {
    allowed = false;
  }

  if (!allowed) return;

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Vary", "Origin");
}

export function sendPortalJson(res, status, payload, req = null) {
  applyPortalSecurityHeaders(res);
  if (req) applyPortalCorsHeaders(req, res);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export function verifyPortalRequestOrigin(req) {
  const method = String(req?.method || "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;

  const origin = cleanText(req.headers?.origin);
  const referer = cleanText(req.headers?.referer);
  const host = cleanText(req.headers?.["x-forwarded-host"] || req.headers?.host);
  const valueToCheck = origin || referer;
  if (!host) return false;
  if (!valueToCheck) {
    return process.env.NODE_ENV !== "production" && !process.env.VERCEL;
  }

  try {
    return new URL(valueToCheck).host === host;
  } catch {
    return false;
  }
}

function isMissingPasswordChangeColumn(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "PGRST204" ||
    error?.code === "42703" ||
    message.includes("password_change_required")
  );
}

const MEMBER_SELECT =
  "id, role, discord_id, watcher_name, guild_code, community_access_type, community_status, preferred_language, password_change_required";
const MEMBER_SELECT_WITH_PASSWORD = `${MEMBER_SELECT}, password`;
const MEMBER_SELECT_FALLBACK =
  "id, role, discord_id, watcher_name, guild_code, community_access_type, community_status, preferred_language";
const MEMBER_SELECT_FALLBACK_WITH_PASSWORD = `${MEMBER_SELECT_FALLBACK}, password`;

async function queryMember(supabase, column, value, options = {}) {
  const select = options.includePassword ? MEMBER_SELECT_WITH_PASSWORD : MEMBER_SELECT;
  let { data, error } = await supabase.from("guild_members").select(select).eq(column, value).maybeSingle();

  if (isMissingPasswordChangeColumn(error)) {
    const fallbackSelect = options.includePassword
      ? MEMBER_SELECT_FALLBACK_WITH_PASSWORD
      : MEMBER_SELECT_FALLBACK;
    const fallback = await supabase.from("guild_members").select(fallbackSelect).eq(column, value).maybeSingle();
    data = fallback.data;
    error = fallback.error;
    if (data) data.password_change_required = false;
  }

  if (error) throw error;
  return data || null;
}

export async function loadPortalMemberById(supabase, memberId, options = {}) {
  const cleanMemberId = cleanText(memberId);
  if (!cleanMemberId) return null;
  return queryMember(supabase, "id", cleanMemberId, options);
}

export async function loadPortalMemberByDiscordId(supabase, discordId, options = {}) {
  const cleanDiscordId = cleanText(discordId);
  if (!cleanDiscordId) return null;
  return queryMember(supabase, "discord_id", cleanDiscordId, options);
}

export async function updatePortalMemberPassword(supabase, memberId, passwordHash, options = {}) {
  const payload = {
    password: passwordHash,
    password_change_required: Boolean(options.passwordChangeRequired),
  };
  let { error } = await supabase.from("guild_members").update(payload).eq("id", memberId);

  if (isMissingPasswordChangeColumn(error)) {
    const fallback = await supabase.from("guild_members").update({ password: passwordHash }).eq("id", memberId);
    error = fallback.error;
  }

  if (error) throw error;
}

export function buildPortalSession(member, overrides = {}) {
  const role = member?.role || "Joueur";
  const communityAccessType = member?.community_access_type || (isPortalCommunityRole(role) ? "community" : "");
  const isCommunity = communityAccessType === "community" || isPortalCommunityRole(role);
  const guildCode = isCommunity ? "COMMUNITY" : member?.guild_code || "G1";
  const watcherName = getPortalMemberName(member);
  const admin = isPortalAdminRole(role);
  const leader = isPortalLeaderRole(role);

  return {
    memberId: member?.id || null,
    id: member?.id || null,
    discordId: member?.discord_id || "",
    discord_id: member?.discord_id || "",
    name: watcherName,
    watcherName,
    memberName: watcherName,
    role,
    guild: guildCode,
    guildCode,
    guild_code: guildCode,
    accessType: isCommunity ? "community" : "guild",
    access_type: isCommunity ? "community" : "guild",
    communityAccessType,
    community_access_type: communityAccessType,
    communityStatus: member?.community_status || (isCommunity ? "active" : ""),
    community_status: member?.community_status || (isCommunity ? "active" : ""),
    preferredLanguage: member?.preferred_language || "",
    preferred_language: member?.preferred_language || "",
    isAdmin: admin,
    admin,
    isLeader: leader,
    leader,
    passwordChangeRequired: Boolean(overrides.passwordChangeRequired ?? member?.password_change_required),
  };
}

export async function getPortalSession(req, supabase, options = {}) {
  const token = parseCookies(req)[PORTAL_SESSION_COOKIE];
  const payload = verifyPortalSessionToken(token);
  if (!payload?.sub) return { error: "Session Portal manquante ou expiree.", status: 401 };

  let member;
  try {
    member = await loadPortalMemberById(supabase, payload.sub, {
      includePassword: Boolean(options.includePassword),
    });
  } catch (error) {
    return { error: error.message || "Verification session impossible.", status: 500 };
  }

  if (!member) return { error: "Session Portal invalide.", status: 401 };

  if (
    (member.community_access_type === "community" || isPortalCommunityRole(member.role)) &&
    normalizePortalText(member.community_status) === "inactive"
  ) {
    return { error: "Compte desactive.", status: 403 };
  }

  return { member, session: buildPortalSession(member) };
}

export async function requirePortalSession(req, supabase, options = {}) {
  return getPortalSession(req, supabase, options);
}

export async function requirePortalAdminSession(req, supabase, options = {}) {
  const result = await getPortalSession(req, supabase, options);
  if (result.error) return result;
  if (!isPortalAdminRole(result.member.role)) return { error: "Acces admin refuse.", status: 403 };
  return result;
}

export async function requirePortalLeaderSession(req, supabase, options = {}) {
  const result = await getPortalSession(req, supabase, options);
  if (result.error) return result;
  if (!isPortalLeaderRole(result.member.role)) return { error: "Acces leader refuse.", status: 403 };
  return result;
}

export async function verifyCurrentPortalPasswordForSession(supabase, sessionResult, password) {
  const passwordCheck = verifyPortalPassword(password, sessionResult?.member?.password);
  if (!passwordCheck.ok) return false;

  if (passwordCheck.needsMigration) {
    await updatePortalMemberPassword(supabase, sessionResult.member.id, hashPortalPassword(password), {
      passwordChangeRequired: Boolean(sessionResult.member.password_change_required || isForcedPortalPassword(password)),
    });
  }

  return true;
}
