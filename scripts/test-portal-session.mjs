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
  createPortalSessionToken,
  getPortalSession,
  getPortalSessionTokenStatus,
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
process.env.PORTAL_SESSION_SECRET = "test-portal-session-secret";

const requestWithCookies = {
  method: "GET",
  url: "/api/portal-auth?action=session",
  headers: {
    host: "run-form-tau.vercel.app",
    "x-forwarded-host": "1552374112159277217.discordsays.com",
    origin: "https://1552374112159277217.discordsays.com",
    referer: "https://1552374112159277217.discordsays.com/portal",
    "user-agent": "Discord Activity Test",
    cookie: `${PORTAL_SESSION_COOKIE}=secret-token-value; other_cookie=another-secret`,
  },
};

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
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    partitioned: false,
  },
  "issued-cookie diagnostic exposes only cookie settings",
);
assert.equal(typeof issuedDiagnostic.secure, "boolean", "issued-cookie diagnostic exposes Secure as a boolean");
assert.doesNotMatch(
  JSON.stringify(issuedDiagnostic),
  /secret-token-value|another-secret/,
  "issued-cookie diagnostic never serializes cookie values",
);

const fakeResponse = {
  headers: {},
  setHeader(name, value) {
    this.headers[name] = value;
  },
};
setPortalSessionCookie(fakeResponse, "sensitive-cookie-token", { remember: false });
assert.match(fakeResponse.headers["Set-Cookie"], /^portal_session=/, "setPortalSessionCookie writes Set-Cookie");
assert.match(fakeResponse.headers["Set-Cookie"], /SameSite=Lax/, "session cookie SameSite remains unchanged");
assert.match(fakeResponse.headers["Set-Cookie"], /Path=\//, "session cookie Path remains unchanged");

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

console.log("portal session tests passed");
