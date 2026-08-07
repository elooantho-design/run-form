import assert from "node:assert/strict";

import {
  normalizeHeroBoxAwakeningLevel,
  upsertHeroBoxAwakening,
  upsertHeroBoxAwakenings,
} from "../api/portal-player-data.js";

function createMemberAwakeningsSupabaseStub(initialRows = []) {
  const rows = new Map();
  const upsertCalls = [];

  function keyFor(row) {
    return `${row.member_id}:${row.champion_id}`;
  }

  initialRows.forEach((row) => {
    rows.set(keyFor(row), { ...row });
  });

  return {
    rows,
    upsertCalls,
    from(tableName) {
      assert.equal(tableName, "member_awakenings");
      return {
        upsert(payload, options) {
          assert.deepEqual(options, { onConflict: "member_id,champion_id" });
          const payloadRows = Array.isArray(payload) ? payload : [payload];
          upsertCalls.push(payloadRows.map((row) => ({ ...row })));

          const savedRows = payloadRows.map((row) => {
            const saved = {
              member_id: row.member_id,
              champion_id: row.champion_id,
              awakening_level: row.awakening_level,
            };
            rows.set(keyFor(saved), saved);
            return {
              champion_id: saved.champion_id,
              awakening_level: saved.awakening_level,
            };
          });

          return {
            select(columns) {
              assert.equal(columns, "champion_id, awakening_level");
              return {
                single() {
                  return Promise.resolve({ data: savedRows[0], error: null });
                },
                then(resolve, reject) {
                  return Promise.resolve({ data: savedRows, error: null }).then(resolve, reject);
                },
              };
            },
          };
        },
      };
    },
  };
}

function readAwakeningsForMember(supabase, memberId) {
  return Array.from(supabase.rows.values())
    .filter((row) => row.member_id === memberId)
    .map((row) => ({
      champion_id: row.champion_id,
      awakening_level: row.awakening_level,
    }));
}

assert.equal(normalizeHeroBoxAwakeningLevel(-1), -1);
for (const level of [0, 1, 2, 3, 4, 5]) {
  assert.equal(normalizeHeroBoxAwakeningLevel(level), level);
  assert.equal(normalizeHeroBoxAwakeningLevel(String(level)), level);
}

for (const invalidValue of [null, undefined, "", " ", -5, 6, 999, 1.5, "abc", Number.NaN]) {
  assert.equal(normalizeHeroBoxAwakeningLevel(invalidValue), null);
}

const memberId = "member-alistair";
const alistairChampionId = 101;
const supabase = createMemberAwakeningsSupabaseStub([
  {
    member_id: memberId,
    champion_id: alistairChampionId,
    awakening_level: 0,
  },
]);

const lockedAlistair = await upsertHeroBoxAwakening(supabase, {
  memberId,
  championId: alistairChampionId,
  awakeningLevel: normalizeHeroBoxAwakeningLevel(-1),
});

assert.equal(supabase.upsertCalls[0][0].awakening_level, -1, "Alistair lock writes -1 to Supabase");
assert.deepEqual(lockedAlistair, {
  champion_id: alistairChampionId,
  championId: alistairChampionId,
  awakening_level: -1,
  awakeningLevel: -1,
});
assert.deepEqual(readAwakeningsForMember(supabase, memberId), [
  {
    champion_id: alistairChampionId,
    awakening_level: -1,
  },
]);

for (const level of [-1, 0, 1, 2, 3, 4, 5]) {
  const result = await upsertHeroBoxAwakening(supabase, {
    memberId,
    championId: alistairChampionId,
    awakeningLevel: normalizeHeroBoxAwakeningLevel(level),
  });
  assert.equal(result.awakeningLevel, level);
  assert.equal(readAwakeningsForMember(supabase, memberId)[0].awakening_level, level);
}

const bulkSupabase = createMemberAwakeningsSupabaseStub();
const bulkRows = [
  { member_id: memberId, champion_id: 201, awakening_level: normalizeHeroBoxAwakeningLevel(-1) },
  { member_id: memberId, champion_id: 202, awakening_level: normalizeHeroBoxAwakeningLevel(0) },
  { member_id: memberId, champion_id: 203, awakening_level: normalizeHeroBoxAwakeningLevel(5) },
];
const bulkResult = await upsertHeroBoxAwakenings(bulkSupabase, bulkRows);

assert.deepEqual(
  bulkSupabase.upsertCalls[0].map((row) => row.awakening_level),
  [-1, 0, 5],
  "bulk upsert preserves -1, 0 and 5",
);
assert.deepEqual(
  bulkResult.map((row) => row.awakeningLevel),
  [-1, 0, 5],
);
assert.deepEqual(
  readAwakeningsForMember(bulkSupabase, memberId).map((row) => row.awakening_level),
  [-1, 0, 5],
);

console.log("portal-player-data hero box tests ok");
