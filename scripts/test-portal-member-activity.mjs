import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PORTAL_MEMBER_ACTIVITY_HEARTBEAT_THROTTLE_MS,
  buildCurrentGvgContextsByGuild,
  buildGvgActivityContextId,
  buildPortalMemberActivityOverview,
  isCurrentGuildActivityMember,
  isMissingPortalMemberActivityState,
  touchPortalMemberLastSeen,
} from "../api/_portal-member-activity.js";

const guilds = [
  { guild_code: "G1", display_name: "Legende" },
  { guild_code: "G2", display_name: "Imperatores" },
];
const members = [
  { id: "member-a", watcher_name: "Alpha", guild_code: "G1", role: "member", roster_status: "active" },
  { id: "member-b", watcher_name: "Beta", guild_code: "G1", role: "admin", roster_status: "active" },
  { id: "member-c", watcher_name: "Gamma", guild_code: "G1", role: "member", roster_status: "non_roster" },
  { id: "member-d", watcher_name: "Delta", guild_code: "G1", role: "community_member", roster_status: "active" },
  { id: "member-e", watcher_name: "Epsilon", guild_code: "G2", role: "member", roster_status: "active" },
];
const currentContext = "gvg:G1:2026-08-24";
const states = [
  {
    member_id: "member-a",
    last_seen_at: "2026-08-24T10:00:00.000Z",
    last_pb_update_at: "2026-08-24T10:01:00.000Z",
    last_demonic_update_at: "2026-08-24T10:02:00.000Z",
    last_hero_box_update_at: "2026-08-24T10:03:00.000Z",
    last_gvg_strat_view_at: "2026-08-24T10:04:00.000Z",
    last_gvg_strat_context_id: currentContext,
    last_gvg_repro_at: "2026-08-24T10:05:00.000Z",
  },
  {
    member_id: "member-b",
    last_seen_at: null,
    last_pb_update_at: null,
    last_demonic_update_at: null,
    last_hero_box_update_at: null,
    last_gvg_strat_view_at: "2026-08-10T10:04:00.000Z",
    last_gvg_strat_context_id: "gvg:G1:2026-08-10",
    last_gvg_repro_at: null,
  },
];

assert.equal(isCurrentGuildActivityMember(members[0]), true, "active guild members are eligible");
assert.equal(isCurrentGuildActivityMember(members[2]), false, "non-roster members are excluded from the active overview");
assert.equal(isCurrentGuildActivityMember(members[3]), false, "community accounts are excluded from guild activity");

const overview = buildPortalMemberActivityOverview({
  guilds,
  members,
  states,
  currentGvgContextsByGuild: { G1: currentContext },
});
const g1 = overview.guilds.find((guild) => guild.guildCode === "G1");
const g2 = overview.guilds.find((guild) => guild.guildCode === "G2");
assert.equal(g1.members.length, 2, "overview rows come from current guild_members, not from logs");
assert.equal(g2.members.length, 1, "another scoped guild still gets its own members");
assert.equal(g1.summary.totalMembers, 2, "active member without state is counted");
assert.equal(g1.summary.neverSeenMembers, 1, "never connected members are represented as missing last_seen");

const alpha = g1.members.find((member) => member.memberId === "member-a");
const beta = g1.members.find((member) => member.memberId === "member-b");
assert.equal(alpha.viewedCurrentGvgStrat, true, "current GVG strat context counts as viewed");
assert.equal(beta.viewedCurrentGvgStrat, false, "old GVG strat context does not count for the current GVG");
assert.equal(beta.currentGvgStratViewedAt, null, "old strat view is hidden from the current GVG column");
assert.equal(alpha.lastDemonicUpdateAt, states[0].last_demonic_update_at, "demonic status is driven by explicit save state");
assert.equal(Object.hasOwn(alpha, "demonicCompletion"), false, "monster possession is not used as a partial completion signal");

assert.equal(
  buildGvgActivityContextId({ guild: "G1", created_at: "2026-08-24T22:15:00.000Z" }),
  currentContext,
  "GvG context is stable for all defenses imported the same day in a guild",
);
assert.deepEqual(
  buildCurrentGvgContextsByGuild([
    { guild: "G1", created_at: "2026-08-10T10:00:00.000Z" },
    { guild: "G1", created_at: "2026-08-24T10:00:00.000Z" },
  ]),
  { G1: currentContext },
  "latest GvG defense import determines the current context",
);

function createHeartbeatSupabase(lastSeenAt) {
  const calls = [];
  const client = {
    calls,
    from(table) {
      calls.push({ type: "from", table });
      return {
        select() {
          calls.push({ type: "select" });
          return this;
        },
        eq(column, value) {
          calls.push({ type: "eq", column, value });
          return this;
        },
        maybeSingle: async () => ({ data: lastSeenAt ? { member_id: "member-a", last_seen_at: lastSeenAt } : null, error: null }),
        upsert: async (row, options) => {
          calls.push({ type: "upsert", row, options });
          return { error: null };
        },
      };
    },
  };
  return client;
}

const recentSupabase = createHeartbeatSupabase("2026-08-24T10:00:00.000Z");
const throttled = await touchPortalMemberLastSeen(recentSupabase, "member-a", {
  now: "2026-08-24T10:03:00.000Z",
});
assert.equal(throttled.throttled, true, "last_seen heartbeat is throttled around five minutes");
assert.equal(
  recentSupabase.calls.some((call) => call.type === "upsert"),
  false,
  "throttled heartbeat does not write",
);

const staleSupabase = createHeartbeatSupabase("2026-08-24T09:00:00.000Z");
const touched = await touchPortalMemberLastSeen(staleSupabase, "member-a", {
  now: "2026-08-24T10:00:01.000Z",
});
assert.equal(touched.touched, true, "stale heartbeat writes last_seen_at");
assert.equal(
  staleSupabase.calls.find((call) => call.type === "upsert")?.row?.member_id,
  "member-a",
  "heartbeat writes the server-resolved member id only",
);
assert.equal(PORTAL_MEMBER_ACTIVITY_HEARTBEAT_THROTTLE_MS, 300000, "heartbeat throttle is five minutes");
assert.equal(
  isMissingPortalMemberActivityState({ code: "42P01", message: 'relation "portal_member_activity_state" does not exist' }),
  true,
  "missing migration is detected gracefully",
);

const source = await readFile(new URL("../api/_portal-member-activity.js", import.meta.url), "utf8");
assert.match(source, /\.in\("member_id", memberIds\)/, "activity state is loaded in one scoped query");
assert.doesNotMatch(source, /member_demonic_monsters/, "overview does not infer demonic completion from owned monsters");

console.log("portal member activity tests passed");
