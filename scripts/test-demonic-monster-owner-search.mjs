import assert from "node:assert/strict";

import {
  normalizeDemonicMonsterOwnerMinLevel,
  searchDemonicMonsterOwners,
} from "../api/portal-player-data.js";

const GLACIUS_ID = "00000000-0000-4000-8000-000000000001";
const UNKNOWN_MONSTER_ID = "00000000-0000-4000-8000-000000000002";

const members = [
  { id: "00000000-0000-4000-8000-000000000101", watcher_name: "A", guild_code: "G1", role: "member" },
  { id: "00000000-0000-4000-8000-000000000102", watcher_name: "B", guild_code: "G1", role: "member" },
  { id: "00000000-0000-4000-8000-000000000103", watcher_name: "C", guild_code: "G1", role: "member" },
  { id: "00000000-0000-4000-8000-000000000104", watcher_name: "D", guild_code: "G1", role: "member" },
  { id: "00000000-0000-4000-8000-000000000105", watcher_name: "E", guild_code: "G1", role: "member" },
  { id: "00000000-0000-4000-8000-000000000106", watcher_name: "F", guild_code: "G2", role: "member" },
  { id: "00000000-0000-4000-8000-000000000107", watcher_name: "MAD", guild_code: "MAD G1", role: "member" },
];

const monsters = [
  {
    id: GLACIUS_ID,
    name: "Glacius",
    slug: "glacius",
    rarity: "legendaire",
    image_url: "/demonic-monsters/glacius.png",
    is_active: true,
  },
];

const demonicEntries = [
  { member_id: members[0].id, monster_id: GLACIUS_ID, level: 12 },
  { member_id: members[1].id, monster_id: GLACIUS_ID, level: 8 },
  { member_id: members[2].id, monster_id: GLACIUS_ID, level: 3 },
  { member_id: members[3].id, monster_id: GLACIUS_ID, level: 0 },
  { member_id: members[5].id, monster_id: GLACIUS_ID, level: 20 },
];

class QueryBuilder {
  constructor(tableName, tableRows) {
    this.tableName = tableName;
    this.tableRows = tableRows;
    this.filters = [];
    this.orders = [];
  }

  select() {
    return this;
  }

  eq(column, value) {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  gte(column, value) {
    this.filters.push({ type: "gte", column, value });
    return this;
  }

  in(column, values) {
    this.filters.push({ type: "in", column, values: new Set((values || []).map(String)) });
    return this;
  }

  order(column, options = {}) {
    this.orders.push({ column, ascending: options.ascending !== false });
    return this;
  }

  maybeSingle() {
    const rows = this.evaluate();
    return Promise.resolve({ data: rows[0] || null, error: null });
  }

  then(resolve, reject) {
    return Promise.resolve({ data: this.evaluate(), error: null }).then(resolve, reject);
  }

  evaluate() {
    let rows = this.tableRows.map((row) => ({ ...row }));

    this.filters.forEach((filter) => {
      if (filter.type === "eq") {
        rows = rows.filter((row) => row[filter.column] === filter.value);
      } else if (filter.type === "gte") {
        rows = rows.filter((row) => Number(row[filter.column]) >= Number(filter.value));
      } else if (filter.type === "in") {
        rows = rows.filter((row) => filter.values.has(String(row[filter.column])));
      }
    });

    [...this.orders].reverse().forEach((order) => {
      rows.sort((left, right) => {
        const comparison = String(left[order.column] || "").localeCompare(String(right[order.column] || ""), "fr", {
          numeric: true,
          sensitivity: "base",
        });
        return order.ascending ? comparison : -comparison;
      });
    });

    return rows;
  }
}

function createSupabaseStub() {
  return {
    from(tableName) {
      if (tableName === "guild_members") return new QueryBuilder(tableName, members);
      if (tableName === "demonic_monsters") return new QueryBuilder(tableName, monsters);
      if (tableName === "member_demonic_monsters") return new QueryBuilder(tableName, demonicEntries);
      throw new Error(`Unexpected table: ${tableName}`);
    },
  };
}

async function runSearch({ actor = { id: members[0].id, role: "leader", guild_code: "G1" }, guildCode = "G1", minimumLevel = null, monsterId = GLACIUS_ID } = {}) {
  return searchDemonicMonsterOwners(createSupabaseStub(), {
    actor,
    guildCode,
    monsterId,
    minimumLevel,
  });
}

async function assertRejectedWithStatus(promise, statusCode) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.statusCode, statusCode);
    return true;
  });
}

assert.equal(normalizeDemonicMonsterOwnerMinLevel(null), 1);
assert.equal(normalizeDemonicMonsterOwnerMinLevel(undefined), 1);
assert.equal(normalizeDemonicMonsterOwnerMinLevel(""), 1);
assert.equal(normalizeDemonicMonsterOwnerMinLevel("  "), 1);
assert.equal(normalizeDemonicMonsterOwnerMinLevel(1), 1);
assert.equal(normalizeDemonicMonsterOwnerMinLevel("20"), 20);

for (const invalidValue of [0, -1, 21, 3.5, "abc", Number.NaN]) {
  assert.equal(normalizeDemonicMonsterOwnerMinLevel(invalidValue), null);
}

const noMinimum = await runSearch();
assert.deepEqual(
  noMinimum.results.map((row) => `${row.watcherName}:${row.level}`),
  ["A:12", "B:8", "C:3"],
  "G1 without minimum returns only level > 0 owners",
);

const minimum8 = await runSearch({ minimumLevel: 8 });
assert.deepEqual(
  minimum8.results.map((row) => `${row.watcherName}:${row.level}`),
  ["A:12", "B:8"],
  "G1 minimum 8 keeps level >= 8",
);

const minimum3 = await runSearch({ minimumLevel: 3 });
assert.deepEqual(
  minimum3.results.map((row) => `${row.watcherName}:${row.level}`),
  ["A:12", "B:8", "C:3"],
  "G1 minimum 3 keeps level >= 3",
);

const minimum13 = await runSearch({ minimumLevel: 13 });
assert.deepEqual(minimum13.results, [], "G1 minimum 13 has no result");

const g2 = await runSearch({ guildCode: "G2" });
assert.deepEqual(
  g2.results.map((row) => `${row.watcherName}:${row.level}`),
  ["F:20"],
  "G2 returns its own matching owner",
);

await assertRejectedWithStatus(
  runSearch({
    actor: { id: members[6].id, role: "member", guild_code: "MAD G1" },
    guildCode: "G2",
  }),
  403,
);

await assertRejectedWithStatus(runSearch({ monsterId: UNKNOWN_MONSTER_ID }), 400);
await assertRejectedWithStatus(runSearch({ minimumLevel: 0 }), 400);

console.log("demonic monster owner search tests ok");
