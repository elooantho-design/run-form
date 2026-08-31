import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ACTIVITY_STATUS_KNOWN_DATE,
  ACTIVITY_STATUS_NEVER,
  ACTIVITY_STATUS_UNKNOWN_DATE,
  buildPortalMemberActivityProfileStatus,
} from "../api/_portal-member-activity.js";
import {
  getMemberActivityFreshnessTone,
  isMemberActivityFreshnessActionRequired,
} from "../src/lib/memberActivityFreshness.js";

const now = "2026-08-31T12:00:00.000Z";
const member = { id: "member-a", watcher_name: "Darius", guild_code: "G1" };

function buildStatus({
  pb = "2026-08-29T12:00:00.000Z",
  demonic = "2026-08-29T12:00:00.000Z",
  heroBox = "2026-08-29T12:00:00.000Z",
  pbHistory = null,
  demonicHistory = null,
  heroBoxHistory = null,
} = {}) {
  return buildPortalMemberActivityProfileStatus({
    member,
    now,
    state: {
      last_seen_at: "2026-07-01T12:00:00.000Z",
      last_pb_update_at: pb,
      last_demonic_update_at: demonic,
      last_hero_box_update_at: heroBox,
      last_gvg_strat_view_at: "2026-07-01T12:00:00.000Z",
      last_gvg_repro_at: "2026-07-01T12:00:00.000Z",
    },
    historicalEvidence: {
      pb: pbHistory || { date: null, hasData: false },
      demonic: demonicHistory || { date: null, hasData: false },
      heroBox: heroBoxHistory || { date: null, hasData: false },
      lastSeen: { date: "2026-07-01T12:00:00.000Z", hasData: true },
      repro: { date: "2026-07-01T12:00:00.000Z", hasData: true },
    },
  });
}

assert.equal(getMemberActivityFreshnessTone("2026-08-29T12:00:00.000Z", ACTIVITY_STATUS_KNOWN_DATE, now), "fresh");
assert.equal(getMemberActivityFreshnessTone("2026-08-20T12:00:00.000Z", ACTIVITY_STATUS_KNOWN_DATE, now), "neutral");
assert.equal(getMemberActivityFreshnessTone("2026-08-10T12:00:00.000Z", ACTIVITY_STATUS_KNOWN_DATE, now), "stale");
assert.equal(getMemberActivityFreshnessTone("2026-07-20T12:00:00.000Z", ACTIVITY_STATUS_KNOWN_DATE, now), "critical");
assert.equal(getMemberActivityFreshnessTone(null, ACTIVITY_STATUS_NEVER, now), "missing");
assert.equal(getMemberActivityFreshnessTone(null, ACTIVITY_STATUS_UNKNOWN_DATE, now), "unknown");
assert.equal(isMemberActivityFreshnessActionRequired(null, ACTIVITY_STATUS_UNKNOWN_DATE, now), false, "unknown date stays non-red like logs");

assert.equal(buildStatus().profileValid, true, "recent PB, demonic and hero box keep profile valid");
assert.equal(buildStatus({ pb: "2026-08-20T12:00:00.000Z" }).profileValid, true, "gray PB remains valid");
assert.equal(buildStatus({ pb: "2026-08-10T12:00:00.000Z" }).profileValid, true, "yellow PB remains valid");

const stalePb = buildStatus({ pb: "2026-07-20T12:00:00.000Z" });
assert.equal(stalePb.profileValid, false, "PB older than 30 days invalidates profile");
assert.deepEqual(stalePb.actionRequiredModules, ["pb"], "stale PB is the only required module");

const neverPb = buildStatus({ pb: null });
assert.equal(neverPb.profileValid, false, "never-filled PB invalidates profile");
assert.equal(neverPb.modules.pb.status, ACTIVITY_STATUS_NEVER, "never PB keeps its activity status");

const staleDemonic = buildStatus({ demonic: "2026-07-20T12:00:00.000Z" });
assert.equal(staleDemonic.profileValid, false, "demonic older than 30 days invalidates profile");
assert.deepEqual(staleDemonic.actionRequiredModules, ["demonic"], "stale demonic is isolated");

const staleHeroBox = buildStatus({ heroBox: "2026-07-20T12:00:00.000Z" });
assert.equal(staleHeroBox.profileValid, false, "hero box older than 30 days invalidates profile");
assert.deepEqual(staleHeroBox.actionRequiredModules, ["heroBox"], "stale hero box is isolated");

const twoRed = buildStatus({
  pb: "2026-07-20T12:00:00.000Z",
  demonic: "2026-07-21T12:00:00.000Z",
});
assert.equal(twoRed.actionRequiredCount, 2, "two red modules are detailed in the modal data");
assert.deepEqual(twoRed.actionRequiredModules, ["pb", "demonic"]);

const threeRed = buildStatus({
  pb: "2026-07-20T12:00:00.000Z",
  demonic: "2026-07-21T12:00:00.000Z",
  heroBox: null,
});
assert.equal(threeRed.actionRequiredCount, 3, "three red modules are detailed in the modal data");

assert.equal(
  buildStatus({
    pb: null,
    pbHistory: { date: null, hasData: true },
  }).modules.pb.status,
  ACTIVITY_STATUS_UNKNOWN_DATE,
  "historical unknown PB keeps the same non-communicated status as logs",
);
assert.equal(
  buildStatus({
    pb: null,
    pbHistory: { date: null, hasData: true },
  }).profileValid,
  true,
  "unknown/non-communicated PB does not become red in home profile status",
);
assert.equal(
  buildStatus().profileValid,
  true,
  "old presence, GVG strat and repro dates do not affect home profile validity",
);

const saasPortalSource = await readFile(new URL("../src/SaasPortal.jsx", import.meta.url), "utf8");
const portalActivitySource = await readFile(new URL("../api/portal-activity.js", import.meta.url), "utf8");
const memberActivitySource = await readFile(new URL("../api/_portal-member-activity.js", import.meta.url), "utf8");
const freshnessSource = await readFile(new URL("../src/lib/memberActivityFreshness.js", import.meta.url), "utf8");
const homeViewSource = saasPortalSource.slice(
  saasPortalSource.indexOf("function HomeView"),
  saasPortalSource.indexOf("function HeroBoxView"),
);
const selfStatusIndex = portalActivitySource.indexOf('action === "self-status"');
const adminSessionIndex = portalActivitySource.indexOf("const sessionCheck = await requirePortalAdminSession", selfStatusIndex);

assert.match(saasPortalSource, /action=self-status/, "home profile status uses the dedicated self endpoint");
assert.match(saasPortalSource, /profileStatus\.loading/, "home profile status has a neutral loading state");
assert.match(saasPortalSource, /function HomeProfileStatusModal/, "home profile status opens one detail modal");
assert.match(saasPortalSource, /getMemberActivityFreshnessTone/, "home and logs use the shared freshness helper");
assert.doesNotMatch(saasPortalSource, /function getMemberActivityDateTone/, "old duplicated freshness function was removed");
assert.doesNotMatch(homeViewSource, /readMemberActivitySimulations|localStorage/, "home profile status ignores admin date simulations");

assert.notEqual(selfStatusIndex, -1, "self-status route exists");
assert.ok(selfStatusIndex < adminSessionIndex, "self-status is handled before admin-only log routes");
assert.match(portalActivitySource, /requirePortalSession\(req, supabase\)/, "self-status uses the server session");
assert.doesNotMatch(
  portalActivitySource.slice(selfStatusIndex, adminSessionIndex),
  /memberId|member_id|searchParams\.get\("memberId"\)/,
  "self-status does not accept a client-supplied member id",
);
assert.match(memberActivitySource, /loadPortalMemberActivitySelfStatus/, "self-status loader is centralized in activity helper");
assert.match(memberActivitySource, /MEMBER_ACTIVITY_PROFILE_MODULES/, "profile status modules are explicit");
assert.match(freshnessSource, /fresh: 7 \* MEMBER_ACTIVITY_FRESHNESS_DAY_MS/, "fresh threshold remains seven days");
assert.match(freshnessSource, /neutral: 14 \* MEMBER_ACTIVITY_FRESHNESS_DAY_MS/, "neutral threshold remains fourteen days");
assert.match(freshnessSource, /stale: 30 \* MEMBER_ACTIVITY_FRESHNESS_DAY_MS/, "stale threshold remains thirty days");

console.log("home profile status tests passed");
