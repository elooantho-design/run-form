/* global Buffer, process */
import crypto from "node:crypto";

export const PORTAL_SESSION_COOKIE = "portal_session";
const HASH_PREFIX = "scrypt$1$";
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const REMEMBER_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_FIELD_LENGTH = 240;
const DEFAULT_PASSWORDS = new Set(["motdepassemembre", "motdepasseadmin"]);
const TEMPORARY_PASSWORD_PREFIX = "TMP-";
const DISCORD_CLIENT_ID_PATTERN = /^\d{17,20}$/;

function cleanText(value) {
  return String(value || "").trim();
}

function cleanHeaderValue(req, name) {
  return cleanText(req?.headers?.[name]).slice(0, 500);
}

function getRequestPath(req) {
  try {
    return new URL(req?.url || "/", "https://portal.local").pathname;
  } catch {
    return "/";
  }
}

function getRequestPathWithQuery(req) {
  try {
    const parsed = new URL(req?.url || "/", "https://portal.local");
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/";
  }
}

function getDiscordActivityClientId() {
  const clientId = cleanText(process.env.VITE_DISCORD_CLIENT_ID);
  return DISCORD_CLIENT_ID_PATTERN.test(clientId) ? clientId : "";
}

export function getPortalDiscordActivityOrigin() {
  const clientId = getDiscordActivityClientId();
  return clientId ? `https://${clientId}.discordsays.com` : "";
}

function isConfiguredDiscordActivityOrigin(parsedUrl) {
  const expectedOrigin = getPortalDiscordActivityOrigin();
  if (!expectedOrigin) return false;

  const expectedUrl = new URL(expectedOrigin);
  return (
    parsedUrl.protocol === expectedUrl.protocol &&
    parsedUrl.hostname === expectedUrl.hostname &&
    parsedUrl.port === expectedUrl.port
  );
}

export function isPortalDiscordActivityRequest(req) {
  const candidates = [
    cleanHeaderValue(req, "origin"),
    cleanHeaderValue(req, "referer"),
  ].filter(Boolean);

  return candidates.some((value) => {
    try {
      return isConfiguredDiscordActivityOrigin(new URL(value));
    } catch {
      return false;
    }
  });
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

function cleanCookieName(value) {
  const rawName = String(value || "").slice(0, 160);
  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
}

function readCookieNames(req) {
  const cookieHeader = String(req?.headers?.cookie || "");
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separatorIndex = part.indexOf("=");
      return cleanCookieName(separatorIndex === -1 ? part : part.slice(0, separatorIndex));
    })
    .filter(Boolean)
    .slice(0, 80);
}

function isSecureCookie() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
}

function getPortalSessionCookieMaxAge(options = {}) {
  return options.remember ? REMEMBER_SESSION_TTL_SECONDS : SESSION_TTL_SECONDS;
}

function getPortalSessionCookieAttributes(options = {}) {
  const discordActivity = isPortalDiscordActivityRequest(options.req);
  const sameSite = discordActivity ? "None" : "Lax";
  const secure = isSecureCookie() || discordActivity;
  return {
    sameSite,
    secure,
    partitioned: false,
  };
}

export function setPortalSessionCookie(res, token, options = {}) {
  const maxAge = getPortalSessionCookieMaxAge(options);
  const cookieAttributes = getPortalSessionCookieAttributes(options);
  const attributes = [
    `${PORTAL_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${cookieAttributes.sameSite}`,
    `Max-Age=${maxAge}`,
  ];
  if (cookieAttributes.secure) attributes.push("Secure");
  res.setHeader("Set-Cookie", attributes.join("; "));
}

export function buildPortalSessionIssuedDiagnostic(req, options = {}) {
  const cookieAttributes = getPortalSessionCookieAttributes({ ...options, req });
  return {
    cookieName: PORTAL_SESSION_COOKIE,
    sameSite: cookieAttributes.sameSite,
    secure: cookieAttributes.secure,
    path: "/",
    maxAge: getPortalSessionCookieMaxAge(options),
    partitioned: cookieAttributes.partitioned,
    host: cleanHeaderValue(req, "host"),
    "x-forwarded-host": cleanHeaderValue(req, "x-forwarded-host"),
    origin: cleanHeaderValue(req, "origin"),
  };
}

export function logPortalSessionIssued(req, options = {}) {
  console.info("[portal-session-issued]", buildPortalSessionIssuedDiagnostic(req, options));
}

export function clearPortalSessionCookie(res, options = {}) {
  const cookieAttributes = getPortalSessionCookieAttributes(options);
  const attributes = [
    `${PORTAL_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    `SameSite=${cookieAttributes.sameSite}`,
    "Max-Age=0",
  ];
  if (cookieAttributes.secure) attributes.push("Secure");
  res.setHeader("Set-Cookie", attributes.join("; "));
}

export function getPortalSessionTokenStatus(token) {
  if (!token) return "absent";

  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return "malformed";

  let decoded;
  try {
    decoded = JSON.parse(base64UrlDecode(payload));
  } catch {
    return "malformed";
  }

  if (!decoded?.sub || !decoded?.exp) return "malformed";

  const expectedSignature = signPayload(payload);
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return "signature_invalid";
  }

  if (Number(decoded.exp) <= Math.floor(Date.now() / 1000)) return "expired";

  return "valid";
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

export function buildPortalSessionCheckDiagnostic(req, options = {}) {
  const cookieNames = Array.isArray(options.cookieNames) ? options.cookieNames : readCookieNames(req);
  const hasCookieHeader = Boolean(String(req?.headers?.cookie || "").trim());
  const hasPortalSessionCookie = cookieNames.includes(PORTAL_SESSION_COOKIE);

  return {
    method: cleanText(req?.method || "GET").toUpperCase() || "GET",
    path: getRequestPathWithQuery(req),
    host: cleanHeaderValue(req, "host"),
    "x-forwarded-host": cleanHeaderValue(req, "x-forwarded-host"),
    origin: cleanHeaderValue(req, "origin"),
    referer: cleanHeaderValue(req, "referer"),
    "user-agent": cleanHeaderValue(req, "user-agent"),
    hasCookieHeader,
    cookieNames,
    hasPortalSessionCookie,
    portalSessionTokenStatus: options.portalSessionTokenStatus || "absent",
  };
}

export function logPortalSessionCheck(req, options = {}) {
  console.info("[portal-session-check]", buildPortalSessionCheckDiagnostic(req, options));
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
      isConfiguredDiscordActivityOrigin(parsedOrigin) ||
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

export function getPortalRequestOriginCheck(req) {
  const method = String(req?.method || "GET").toUpperCase();
  const origin = cleanHeaderValue(req, "origin");
  const referer = cleanHeaderValue(req, "referer");
  const host = cleanHeaderValue(req, "host");
  const forwardedHost = cleanHeaderValue(req, "x-forwarded-host");
  const forwardedProto = cleanHeaderValue(req, "x-forwarded-proto");
  const requestHost = forwardedHost || host;
  const valueToCheck = origin || referer;

  const diagnostic = {
    method,
    path: getRequestPath(req),
    origin,
    referer,
    host,
    forwardedHost,
    forwardedProto,
    secFetchSite: cleanHeaderValue(req, "sec-fetch-site"),
    secFetchMode: cleanHeaderValue(req, "sec-fetch-mode"),
    secFetchDest: cleanHeaderValue(req, "sec-fetch-dest"),
    userAgent: cleanHeaderValue(req, "user-agent"),
    requestHost,
    checkedValueHost: "",
    checkedValueOrigin: "",
    discordActivityOrigin: getPortalDiscordActivityOrigin(),
    reason: "",
    allowed: false,
  };

  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    diagnostic.allowed = true;
    diagnostic.reason = "safe_method";
    return diagnostic;
  }

  if (!requestHost) {
    diagnostic.reason = "missing_request_host";
    return diagnostic;
  }

  if (!valueToCheck) {
    diagnostic.allowed = process.env.NODE_ENV !== "production" && !process.env.VERCEL;
    diagnostic.reason = diagnostic.allowed ? "dev_missing_origin_referer" : "missing_origin_referer";
    return diagnostic;
  }

  try {
    const parsed = new URL(valueToCheck);
    diagnostic.checkedValueHost = parsed.host;
    diagnostic.checkedValueOrigin = parsed.origin;
    if (parsed.host === requestHost) {
      diagnostic.allowed = true;
      diagnostic.reason = "same_origin";
      return diagnostic;
    }
    if (isConfiguredDiscordActivityOrigin(parsed)) {
      diagnostic.allowed = true;
      diagnostic.reason = "discord_activity_origin";
      return diagnostic;
    }
    diagnostic.reason = "host_mismatch";
    return diagnostic;
  } catch {
    diagnostic.reason = "invalid_origin_referer";
    return diagnostic;
  }
}

export function logPortalOriginCheckFailure(req, override = null) {
  const diagnostic = override || getPortalRequestOriginCheck(req);
  if (diagnostic?.allowed) return;
  console.warn("[portal-origin-check]", diagnostic);
}

export function sendPortalJson(res, status, payload, req = null) {
  applyPortalSecurityHeaders(res);
  if (req) applyPortalCorsHeaders(req, res);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export function verifyPortalRequestOrigin(req) {
  return getPortalRequestOriginCheck(req).allowed;
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
  "id, role, discord_id, watcher_name, guild_code, community_access_type, community_status, preferred_language, password_change_required, primary_member_id";
const MEMBER_SELECT_WITH_PASSWORD = `${MEMBER_SELECT}, password`;
const MEMBER_SELECT_FALLBACK =
  "id, role, discord_id, watcher_name, guild_code, community_access_type, community_status, preferred_language, primary_member_id";
const MEMBER_SELECT_FALLBACK_WITH_PASSWORD = `${MEMBER_SELECT_FALLBACK}, password`;

export class PortalAuthResolutionError extends Error {
  constructor(message, { code = "portal_auth_resolution_failed", status = 409 } = {}) {
    super(message);
    this.name = "PortalAuthResolutionError";
    this.code = code;
    this.status = status;
  }
}

export function isPortalAuthResolutionError(error) {
  return error instanceof PortalAuthResolutionError || error?.name === "PortalAuthResolutionError";
}

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

async function queryMembersByDiscordId(supabase, discordId) {
  const cleanDiscordId = cleanText(discordId);
  if (!cleanDiscordId) return null;

  let { data, error } = await supabase
    .from("guild_members")
    .select(MEMBER_SELECT)
    .eq("discord_id", cleanDiscordId);

  if (isMissingPasswordChangeColumn(error)) {
    const fallback = await supabase
      .from("guild_members")
      .select(MEMBER_SELECT_FALLBACK)
      .eq("discord_id", cleanDiscordId);
    data = fallback.data;
    error = fallback.error;
    if (data) {
      data = data.map((row) => ({
        ...row,
        password_change_required: false,
      }));
    }
  }

  if (error) throw error;
  return data || [];
}

function resolvePortalPrincipalForDiscordId(rows) {
  if (!rows?.length) return null;

  const principals = rows.filter((row) => !cleanText(row?.primary_member_id));

  if (principals.length === 1) {
    return principals[0];
  }

  if (principals.length === 0) {
    throw new PortalAuthResolutionError("Compte principal introuvable pour cet ID Discord.", {
      code: "portal_auth_principal_missing",
      status: 409,
    });
  }

  throw new PortalAuthResolutionError("Plusieurs comptes principaux utilisent cet ID Discord. Contacte un leader Portal.", {
    code: "portal_auth_principal_ambiguous",
    status: 409,
  });
}

export async function loadPortalPrincipalByDiscordId(supabase, discordId, options = {}) {
  const rows = await queryMembersByDiscordId(supabase, discordId);
  const principal = resolvePortalPrincipalForDiscordId(rows);
  if (!principal) return null;

  if (options.includePassword) {
    return loadPortalMemberById(supabase, principal.id, { includePassword: true });
  }

  return principal;
}

export async function loadPortalMemberByDiscordId(supabase, discordId, options = {}) {
  return loadPortalPrincipalByDiscordId(supabase, discordId, options);
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
  const cookies = parseCookies(req);
  const token = cookies[PORTAL_SESSION_COOKIE];
  const portalSessionTokenStatus = getPortalSessionTokenStatus(token);
  if (options.logSessionCheck) {
    logPortalSessionCheck(req, {
      cookieNames: Object.keys(cookies),
      portalSessionTokenStatus,
    });
  }
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
