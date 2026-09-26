import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  arePortalSessionsEquivalent,
  createPortalSyncMessage,
  getPortalSessionMemberId,
  getPortalSessionSignature,
  reconcilePortalSession,
  shouldHandlePortalSyncMessage,
} from "../src/lib/portalSession.js";
import {
  PORTAL_SESSION_COOKIE,
  buildPortalSessionCheckDiagnostic,
  buildPortalSessionIssuedDiagnostic,
  clearPortalSessionCookie,
  createPortalSessionToken,
  getPortalSession,
  getPortalSessionTokenStatus,
  isPortalDiscordActivityRequest,
  logPortalSessionCheck,
  logPortalSessionIssued,
  setPortalSessionCookie,
  verifyPortalSessionToken,
} from "../api/_portal-auth.js";

const localLeader = {
  memberId: "leader-id",
  watcherName: "Darius",
  role: "leader",
  guildCode: "G1",
  isAdmin: true,
  isLeader: true,
};
const serverMember = {
  memberId: "member-id",
  watcherName: "Pilou",
  role: "member",
  guildCode: "G2",
  isAdmin: false,
  isLeader: false,
};

assert.equal(getPortalSessionMemberId(localLeader), "leader-id", "member id is read from the Portal session");
assert.equal(
  arePortalSessionsEquivalent(serverMember, { ...serverMember }),
  true,
  "equivalent server sessions do not need a React state refresh",
);
assert.equal(
  arePortalSessionsEquivalent(serverMember, { ...serverMember, role: "admin" }),
  false,
  "real server session changes are still committed",
);
assert.notEqual(
  getPortalSessionSignature(localLeader),
  getPortalSessionSignature(serverMember),
  "role and identity differences change the session signature",
);

const replacedByServer = reconcilePortalSession(localLeader, serverMember);
assert.equal(replacedByServer.session.memberId, "member-id", "server session replaces a stale local leader");
assert.equal(replacedByServer.session.role, "member", "stale local leader role is not preserved");
assert.equal(replacedByServer.identityChanged, true, "different member ids are reported as an identity change");
assert.equal(replacedByServer.changed, true, "different server session is reported as changed");

const roleChanged = reconcilePortalSession(
  { ...serverMember, role: "member", isAdmin: false },
  { ...serverMember, role: "admin", isAdmin: true },
);
assert.equal(roleChanged.identityChanged, false, "same member id is not an identity change");
assert.equal(roleChanged.changed, true, "same member id with different permissions is still refreshed");
assert.equal(roleChanged.session.role, "admin", "server role remains authoritative");

const cleared = reconcilePortalSession(serverMember, null);
assert.equal(cleared.session, null, "missing server session clears local state");
assert.equal(cleared.identityChanged, true, "clearing an existing session is an identity change");

const syncMessage = createPortalSyncMessage("tab-a", "login");
assert.equal(syncMessage.type, "portal-sync", "cross-tab event is only a revalidation signal");
assert.equal(syncMessage.reason, "login", "cross-tab event carries a reason");
assert.equal(Object.hasOwn(syncMessage, "session"), false, "cross-tab event never carries a trusted session object");
assert.equal(shouldHandlePortalSyncMessage(syncMessage, "tab-a"), false, "a tab ignores its own sync event");
assert.equal(shouldHandlePortalSyncMessage(syncMessage, "tab-b"), true, "another tab handles the sync event");
assert.equal(shouldHandlePortalSyncMessage({ ...syncMessage, session: localLeader }, "tab-b"), true, "foreign session payloads do not make the event trusted");

const portalSource = await readFile(new URL("../src/SaasPortal.jsx", import.meta.url), "utf8");
assert.match(portalSource, /\/api\/portal-auth\?action=session/, "Portal validates the session through the server endpoint");
assert.match(portalSource, /cache: "no-store"/, "Portal session and cosmetics reloads bypass browser caches");
assert.match(portalSource, /reconcilePortalSession\(previousSession, payload\.session\)/, "Portal reconciles against the server session");
assert.match(portalSource, /arePortalSessionsEquivalent\(previousSession, reconciliation\.session\)/, "unchanged revalidations do not reset Portal state");
assert.doesNotMatch(portalSource, /currentMemberId !== nextMemberId[^]*return current/, "Portal no longer keeps stale local sessions on member mismatch");
assert.match(portalSource, /BroadcastChannel\(PORTAL_SESSION_SYNC_CHANNEL\)/, "Portal uses BroadcastChannel for auth synchronization");
assert.match(portalSource, /PORTAL_SESSION_SYNC_STORAGE_KEY/, "Portal keeps a storage-event fallback for auth synchronization");
assert.match(portalSource, /verifyServerSession\(\{ reason: "focus" \}\)/, "focus revalidates the server session");
assert.match(portalSource, /verifyServerSession\(\{ reason: "visible" \}\)/, "visibilitychange revalidates the server session");
assert.match(portalSource, /key=\{getPortalSessionMemberId\(session\)\}/, "PortalShell remounts only when the authenticated member changes");
assert.match(portalSource, /setRolePreviewMode\(PORTAL_REAL_VIEW_MODE\)/, "role preview is reset when it is no longer available");
assert.match(portalSource, /buildPortalRolePreviewSession\(session, rolePreviewMode\)/, "role preview remains UI-only and starts from the real session");
assert.match(portalSource, /PORTAL_COSMETICS_SYNC_CHANNEL/, "cosmetic changes have a dedicated revalidation signal");

const originalSessionSecret = process.env.PORTAL_SESSION_SECRET;
const originalDiscordClientId = process.env.VITE_DISCORD_CLIENT_ID;
const originalNodeEnv = process.env.NODE_ENV;
const originalVercel = process.env.VERCEL;
const discordClientId = "1552374112159277217";
process.env.PORTAL_SESSION_SECRET = "test-portal-session-secret";
process.env.VITE_DISCORD_CLIENT_ID = discordClientId;
process.env.NODE_ENV = "production";
process.env.VERCEL = "1";

const requestWithCookies = {
  method: "GET",
  url: "/api/portal-auth?action=session",
  headers: {
    host: "run-form-tau.vercel.app",
    "x-forwarded-host": `${discordClientId}.discordsays.com`,
    origin: `https://${discordClientId}.discordsays.com`,
    referer: `https://${discordClientId}.discordsays.com/portal`,
    "user-agent": "Discord Activity Test",
    cookie: `${PORTAL_SESSION_COOKIE}=secret-token-value; other_cookie=another-secret`,
  },
};
const normalBrowserRequest = {
  method: "POST",
  url: "/api/portal-auth?action=login",
  headers: {
    host: "run-form-tau.vercel.app",
    origin: "https://run-form-tau.vercel.app",
    referer: "https://run-form-tau.vercel.app/portal",
  },
};
const otherDiscordRequest = {
  method: "POST",
  url: "/api/portal-auth?action=login",
  headers: {
    host: "run-form-tau.vercel.app",
    origin: "https://999999999999999999.discordsays.com",
  },
};
const spoofedDiscordRequest = {
  method: "POST",
  url: "/api/portal-auth?action=login",
  headers: {
    host: "run-form-tau.vercel.app",
    origin: `https://${discordClientId}.discordsays.com.evil.com`,
  },
};
const malformedOriginRequest = {
  method: "POST",
  url: "/api/portal-auth?action=login",
  headers: {
    host: "run-form-tau.vercel.app",
    origin: "https://",
  },
};

function makeResponseRecorder() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
}

assert.equal(isPortalDiscordActivityRequest(requestWithCookies), true, "configured Discord Activity request is detected");
assert.equal(isPortalDiscordActivityRequest(normalBrowserRequest), false, "normal browser request is not detected as Discord Activity");
assert.equal(isPortalDiscordActivityRequest(otherDiscordRequest), false, "another Discord app is not detected as this Activity");
assert.equal(isPortalDiscordActivityRequest(spoofedDiscordRequest), false, "Discord suffix spoof is not detected as this Activity");
assert.equal(isPortalDiscordActivityRequest(malformedOriginRequest), false, "malformed Origin is not detected as Discord Activity");

const checkDiagnostic = buildPortalSessionCheckDiagnostic(requestWithCookies, {
  portalSessionTokenStatus: "malformed",
});
assert.equal(checkDiagnostic.method, "GET", "session diagnostic records the request method");
assert.equal(checkDiagnostic.path, "/api/portal-auth?action=session", "session diagnostic records the checked route");
assert.equal(checkDiagnostic.hasCookieHeader, true, "session diagnostic detects cookie header presence");
assert.deepEqual(
  checkDiagnostic.cookieNames,
  [PORTAL_SESSION_COOKIE, "other_cookie"],
  "session diagnostic includes cookie names only",
);
assert.equal(checkDiagnostic.hasPortalSessionCookie, true, "session diagnostic detects portal_session by name");
assert.equal(checkDiagnostic.portalSessionTokenStatus, "malformed", "session diagnostic carries token status");
assert.doesNotMatch(
  JSON.stringify(checkDiagnostic),
  /secret-token-value|another-secret/,
  "session diagnostic never serializes cookie values",
);

const emptyCookieDiagnostic = buildPortalSessionCheckDiagnostic({
  method: "GET",
  url: "/api/portal-auth?action=session",
  headers: {},
});
assert.equal(emptyCookieDiagnostic.hasCookieHeader, false, "session diagnostic detects missing cookie header");
assert.equal(emptyCookieDiagnostic.hasPortalSessionCookie, false, "session diagnostic detects missing portal_session");
assert.equal(emptyCookieDiagnostic.portalSessionTokenStatus, "absent", "missing portal_session is reported as absent");

const issuedDiagnostic = buildPortalSessionIssuedDiagnostic(requestWithCookies, { remember: true });
assert.deepEqual(
  {
    cookieName: issuedDiagnostic.cookieName,
    sameSite: issuedDiagnostic.sameSite,
    path: issuedDiagnostic.path,
    maxAge: issuedDiagnostic.maxAge,
    partitioned: issuedDiagnostic.partitioned,
  },
  {
    cookieName: PORTAL_SESSION_COOKIE,
    sameSite: "None",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    partitioned: false,
  },
  "Discord Activity issued-cookie diagnostic exposes SameSite=None without Partitioned",
);
assert.equal(typeof issuedDiagnostic.secure, "boolean", "issued-cookie diagnostic exposes Secure as a boolean");
assert.equal(issuedDiagnostic.secure, true, "Discord Activity SameSite=None keeps Secure enabled");
assert.doesNotMatch(
  JSON.stringify(issuedDiagnostic),
  /secret-token-value|another-secret/,
  "issued-cookie diagnostic never serializes cookie values",
);

const normalIssuedDiagnostic = buildPortalSessionIssuedDiagnostic(normalBrowserRequest, { remember: false });
assert.equal(normalIssuedDiagnostic.sameSite, "Lax", "normal browser cookie keeps SameSite=Lax");
assert.equal(normalIssuedDiagnostic.secure, true, "normal production browser cookie keeps Secure");
assert.equal(normalIssuedDiagnostic.partitioned, false, "normal browser cookie does not add Partitioned");
assert.equal(normalIssuedDiagnostic.maxAge, 60 * 60 * 12, "normal browser non-remember Max-Age is unchanged");

const otherDiscordIssuedDiagnostic = buildPortalSessionIssuedDiagnostic(otherDiscordRequest, { remember: false });
assert.equal(otherDiscordIssuedDiagnostic.sameSite, "Lax", "another Discord app does not receive SameSite=None");

const spoofedIssuedDiagnostic = buildPortalSessionIssuedDiagnostic(spoofedDiscordRequest, { remember: false });
assert.equal(spoofedIssuedDiagnostic.sameSite, "Lax", "Discord suffix spoof does not receive SameSite=None");

const malformedIssuedDiagnostic = buildPortalSessionIssuedDiagnostic(malformedOriginRequest, { remember: false });
assert.equal(malformedIssuedDiagnostic.sameSite, "Lax", "malformed Origin does not receive SameSite=None");

const fakeResponse = makeResponseRecorder();
setPortalSessionCookie(fakeResponse, "sensitive-cookie-token", { remember: false, req: normalBrowserRequest });
assert.match(fakeResponse.headers["Set-Cookie"], /^portal_session=/, "setPortalSessionCookie writes Set-Cookie");
assert.match(fakeResponse.headers["Set-Cookie"], /SameSite=Lax/, "normal browser session cookie keeps SameSite=Lax");
assert.match(fakeResponse.headers["Set-Cookie"], /Secure/, "normal production session cookie keeps Secure");
assert.match(fakeResponse.headers["Set-Cookie"], /Path=\//, "session cookie Path remains unchanged");
assert.doesNotMatch(fakeResponse.headers["Set-Cookie"], /Partitioned/, "normal browser session cookie does not add Partitioned");

const discordResponse = makeResponseRecorder();
setPortalSessionCookie(discordResponse, "sensitive-cookie-token", { remember: false, req: requestWithCookies });
assert.match(discordResponse.headers["Set-Cookie"], /SameSite=None/, "Discord Activity session cookie uses SameSite=None");
assert.match(discordResponse.headers["Set-Cookie"], /Secure/, "Discord Activity session cookie keeps Secure");
assert.doesNotMatch(discordResponse.headers["Set-Cookie"], /Partitioned/, "Discord Activity session cookie does not add Partitioned");
assert.match(discordResponse.headers["Set-Cookie"], /Max-Age=43200/, "Discord Activity non-remember Max-Age is unchanged");

const rememberResponse = makeResponseRecorder();
setPortalSessionCookie(rememberResponse, "sensitive-cookie-token", { remember: true, req: requestWithCookies });
assert.match(rememberResponse.headers["Set-Cookie"], /Max-Age=2592000/, "remember Max-Age stays unchanged");

const normalLogoutResponse = makeResponseRecorder();
clearPortalSessionCookie(normalLogoutResponse, { req: normalBrowserRequest });
assert.match(normalLogoutResponse.headers["Set-Cookie"], /^portal_session=/, "logout clears the session cookie");
assert.match(normalLogoutResponse.headers["Set-Cookie"], /SameSite=Lax/, "normal browser logout clears with SameSite=Lax");
assert.match(normalLogoutResponse.headers["Set-Cookie"], /Max-Age=0/, "logout Max-Age remains zero");

const discordLogoutResponse = makeResponseRecorder();
clearPortalSessionCookie(discordLogoutResponse, { req: requestWithCookies });
assert.match(discordLogoutResponse.headers["Set-Cookie"], /SameSite=None/, "Discord Activity logout clears with SameSite=None");
assert.match(discordLogoutResponse.headers["Set-Cookie"], /Secure/, "Discord Activity logout keeps Secure");
assert.doesNotMatch(discordLogoutResponse.headers["Set-Cookie"], /Partitioned/, "Discord Activity logout does not add Partitioned");

const validToken = createPortalSessionToken({ id: "member-test" });
assert.equal(getPortalSessionTokenStatus(""), "absent", "empty token is diagnosed as absent");
assert.equal(getPortalSessionTokenStatus("not-a-token"), "malformed", "malformed token is diagnosed");
assert.equal(getPortalSessionTokenStatus(validToken), "valid", "valid token is diagnosed");
assert.equal(verifyPortalSessionToken(validToken)?.sub, "member-test", "valid token behavior remains unchanged");

const [validPayload, validSignature] = validToken.split(".");
const signatureInvalidToken = `${validPayload}.${"x".repeat(validSignature.length)}`;
assert.equal(
  getPortalSessionTokenStatus(signatureInvalidToken),
  "signature_invalid",
  "bad signature is diagnosed distinctly",
);

const originalDateNow = Date.now;
Date.now = () => 1_000_000;
const expiredToken = createPortalSessionToken({ id: "expired-member" });
Date.now = originalDateNow;
assert.equal(getPortalSessionTokenStatus(expiredToken), "expired", "expired token is diagnosed distinctly");

const missingSessionResult = await getPortalSession(
  { method: "GET", url: "/api/portal-auth?action=session", headers: {} },
  null,
);
assert.deepEqual(
  missingSessionResult,
  { error: "Session Portal manquante ou expiree.", status: 401 },
  "missing cookie keeps the existing HTTP/session behavior",
);

const badSessionResult = await getPortalSession(
  {
    method: "GET",
    url: "/api/portal-auth?action=session",
    headers: { cookie: `${PORTAL_SESSION_COOKIE}=${signatureInvalidToken}` },
  },
  null,
);
assert.deepEqual(
  badSessionResult,
  { error: "Session Portal manquante ou expiree.", status: 401 },
  "invalid cookie keeps the existing HTTP/session behavior",
);

const capturedLogs = [];
const originalConsoleInfo = console.info;
console.info = (...args) => capturedLogs.push(args);
try {
  logPortalSessionCheck(requestWithCookies, { portalSessionTokenStatus: "malformed" });
  logPortalSessionIssued(requestWithCookies, { remember: false });
} finally {
  console.info = originalConsoleInfo;
}
const serializedLogs = JSON.stringify(capturedLogs);
assert.match(serializedLogs, /\[portal-session-check\]/, "session check log uses the expected prefix");
assert.match(serializedLogs, /\[portal-session-issued\]/, "session issued log uses the expected prefix");
assert.doesNotMatch(
  serializedLogs,
  /secret-token-value|another-secret|sensitive-cookie-token|test-portal-session-secret|member-test/,
  "runtime diagnostics never log cookie values, tokens, secrets, or session ids",
);

if (originalSessionSecret === undefined) {
  delete process.env.PORTAL_SESSION_SECRET;
} else {
  process.env.PORTAL_SESSION_SECRET = originalSessionSecret;
}
if (originalDiscordClientId === undefined) {
  delete process.env.VITE_DISCORD_CLIENT_ID;
} else {
  process.env.VITE_DISCORD_CLIENT_ID = originalDiscordClientId;
}
if (originalNodeEnv === undefined) {
  delete process.env.NODE_ENV;
} else {
  process.env.NODE_ENV = originalNodeEnv;
}
if (originalVercel === undefined) {
  delete process.env.VERCEL;
} else {
  process.env.VERCEL = originalVercel;
}

console.log("portal session tests passed");
