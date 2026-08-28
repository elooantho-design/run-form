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

console.log("portal session tests passed");
