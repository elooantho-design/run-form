import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildDefenseLibraryEntries,
  defenseBelongsToGuild,
  getDefenseAssignmentId,
  getDefenseAssignmentName,
  isImportedDefense,
  normalizeLegacyDefenseAssignmentName,
  resolveAssignedDefense,
  resolveDefenseVariantsForGuild,
} from "../src/lib/defenseVariants.js";

const nativeG1 = {
  id: "def-g1-native",
  name: "Mirror",
  guildCode: "G1",
  type: "Tour",
  slots: ["Khamet", "Valara"],
  conditions: [{ label: "Khamet A1 minimum", minAwakening: 1 }],
  infoBlocks: [{ blockType: "text", content: "Plan G1", sortOrder: 1 }],
};
const nativeG2 = {
  id: "def-g2-native",
  name: "Mirror",
  guildCode: "G2",
  type: "Bastion",
  slots: ["Dame Alexandra", "Khadgrim"],
  conditions: [{ label: "Khadgrim A1 minimum", minAwakening: 1 }],
  infoBlocks: [{ blockType: "text", content: "Plan G2", sortOrder: 1 }],
};
const importedG2FromG1 = {
  ...structuredClone(nativeG1),
  id: "def-g2-copy-from-g1",
  guildCode: "G2",
  sourceDefenseId: nativeG1.id,
  sourceGuildCode: "G1",
  sourceDefenseName: nativeG1.name,
  conditions: [{ label: "Khamet A3 minimum", minAwakening: 3 }],
  infoBlocks: [{ blockType: "text", content: "Plan G2 local", sortOrder: 1 }],
};
const importedG3FromG2 = {
  ...structuredClone(nativeG2),
  id: "def-g3-copy-from-g2",
  guildCode: "G3",
  sourceDefenseId: nativeG2.id,
  sourceGuildCode: "G2",
  sourceDefenseName: nativeG2.name,
};
const paladinRows = [nativeG1, nativeG2, importedG2FromG1, importedG3FromG2];

function collectLegacyG2CopyRequests({ members = [], g2NativeDefenses = [] } = {}) {
  const uniqueSourceByName = new Map();
  const sourceCounts = new Map();

  g2NativeDefenses.forEach((defense) => {
    if (defense.guildCode !== "G2" || isImportedDefense(defense)) return;
    sourceCounts.set(defense.name, (sourceCounts.get(defense.name) || 0) + 1);
    uniqueSourceByName.set(defense.name, defense.id);
  });

  const requests = new Set();
  members.forEach((member) => {
    if (!member?.guildCode || member.guildCode === "G2") return;
    [member.defense1, member.defense2].forEach((rawName) => {
      const defenseName = normalizeLegacyDefenseAssignmentName(rawName);
      if (!defenseName || sourceCounts.get(defenseName) !== 1) return;
      requests.add(`${member.guildCode}:${uniqueSourceByName.get(defenseName)}`);
    });
  });

  return [...requests].sort();
}

for (const [rawValue, expectedValue] of [
  [null, null],
  ["", null],
  ["   ", null],
  ["--", null],
  ["-", null],
  ["—", null],
  ["–", null],
  ["â€”", null],
  ["â€“", null],
  ["  Mirror  ", "Mirror"],
]) {
  assert.equal(
    normalizeLegacyDefenseAssignmentName(rawValue),
    expectedValue,
    `legacy defense assignment ${String(rawValue)} normalizes correctly`,
  );
}

assert.equal(defenseBelongsToGuild(nativeG1, "G1"), true, "native G1 belongs to G1");
assert.equal(defenseBelongsToGuild(nativeG1, "G2"), false, "native G1 is not directly visible in G2");
assert.equal(isImportedDefense(importedG2FromG1), true, "imported copy is marked by sourceDefenseId");
assert.equal(
  resolveAssignedDefense([nativeG2], { guildCode: "G2", defense1: "â€”" }, 1),
  null,
  "mojibake em-dash placeholder does not resolve as a defense",
);
assert.deepEqual(
  collectLegacyG2CopyRequests({
    members: [{ guildCode: "G1", defense1: "â€”", defense2: "--" }],
    g2NativeDefenses: [nativeG2],
  }),
  [],
  "a non-G2 member with only placeholders never triggers a local copy",
);
assert.deepEqual(
  collectLegacyG2CopyRequests({
    members: [{ guildCode: "G1", defense1: "  Mirror  ", defense2: "â€”" }],
    g2NativeDefenses: [nativeG2],
  }),
  [`G1:${nativeG2.id}`],
  "a non-G2 member with a real unique G2 defense name triggers one local copy",
);

assert.deepEqual(
  resolveDefenseVariantsForGuild(paladinRows, "G1").map((defense) => defense.id),
  [nativeG1.id],
  "G1 management only sees native/imported defenses available in G1",
);
assert.deepEqual(
  resolveDefenseVariantsForGuild(paladinRows, "G2").map((defense) => defense.id),
  [nativeG2.id, importedG2FromG1.id],
  "G2 management sees native G2 plus imported G2 copy",
);

const libraryForG2 = buildDefenseLibraryEntries({
  nativeDefenses: [nativeG1, nativeG2],
  localDefenses: paladinRows,
  targetGuildCode: "G2",
  manageableGuildCodes: ["G1", "G2", "G3"],
});
assert.deepEqual(
  libraryForG2.map((defense) => [defense.id, defense.libraryTargetStatus]),
  [
    [nativeG1.id, "imported"],
    [nativeG2.id, "native"],
  ],
  "library exposes native models and disables duplicate imports for target guild",
);
assert.equal(
  libraryForG2.find((defense) => defense.id === nativeG2.id)?.libraryTargetStatus,
  "native",
  "an import into another guild does not mark the active target guild as imported",
);
assert.equal(
  libraryForG2.flatMap((defense) => defense.importTargets).every((target) => ["G1", "G2", "G3"].includes(target.guildCode)),
  true,
  "library import targets stay inside the manageable organization guilds",
);

const memberG2 = {
  id: "member-g2",
  guildCode: "G2",
  defense1: "Mirror",
  defense1Id: importedG2FromG1.id,
  defense2: "Mirror",
  defense2Id: nativeG2.id,
};
assert.equal(getDefenseAssignmentId(memberG2, 1), importedG2FromG1.id, "slot 1 assignment id is readable");
assert.equal(getDefenseAssignmentName(memberG2, 2), nativeG2.name, "slot 2 legacy assignment name is readable");
assert.equal(
  resolveAssignedDefense(resolveDefenseVariantsForGuild(paladinRows, "G2"), memberG2, 1)?.id,
  importedG2FromG1.id,
  "Mes defenses resolves an imported local copy by id before name",
);
assert.equal(
  resolveAssignedDefense(resolveDefenseVariantsForGuild(paladinRows, "G2"), memberG2, 2)?.id,
  nativeG2.id,
  "Gestion de guilde resolves homonymous local native defense by id",
);

const copiedSnapshot = structuredClone(importedG2FromG1);
copiedSnapshot.conditions[0].minAwakening = 5;
assert.equal(nativeG1.conditions[0].minAwakening, 1, "editing imported copy does not mutate native source");
assert.equal(copiedSnapshot.infoBlocks[0].content, "Plan G2 local", "imported copy keeps its own blocks");

const rowsAfterSourceDelete = paladinRows.filter((defense) => defense.id !== nativeG1.id);
assert.equal(
  rowsAfterSourceDelete.some((defense) => defense.id === importedG2FromG1.id),
  true,
  "deleting source does not remove already imported copy in the business model",
);
assert.equal(
  buildDefenseLibraryEntries({
    nativeDefenses: rowsAfterSourceDelete.filter((defense) => !isImportedDefense(defense)),
    localDefenses: rowsAfterSourceDelete,
    targetGuildCode: "G2",
    manageableGuildCodes: ["G2"],
  }).some((defense) => defense.id === importedG2FromG1.id),
  false,
  "library does not promote imported copies as native models",
);

const [
  adminApi,
  accessApi,
  saasPortal,
  myDefensesTab,
  guildManagementTab,
  migrationSql,
  preflightSql,
  verifySql,
] = await Promise.all([
  readFile(new URL("../api/portal-admin-defenses.js", import.meta.url), "utf8"),
  readFile(new URL("../api/portal-access.js", import.meta.url), "utf8"),
  readFile(new URL("../src/SaasPortal.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/MyDefensesTab.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/PortalGuildManagementTab.jsx", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_preflight.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_verify.sql", import.meta.url), "utf8"),
]);

function countSqlMatches(sql, pattern) {
  return [...sql.matchAll(pattern)].length;
}

assert.match(adminApi, /action === "import"/, "admin API exposes explicit import action");
assert.match(adminApi, /import_guild_defense_snapshot/, "admin API imports through transactional RPC");
assert.match(adminApi, /targetGuild === defenseGuild/, "admin API manages defenses only in the selected guild");
assert.match(adminApi, /normalizeGuildCode\(defense\.guildCode\) === activeGuildKey/, "admin API library import status is scoped to the active guild");
assert.doesNotMatch(
  adminApi.match(/const DEFENSE_SELECT_BASE = `[\s\S]*?`;/)?.[0] || "",
  /source_defense_id/,
  "admin API pre-migration fallback does not select source_defense_id",
);
assert.match(accessApi, /defenseGuild === requestedGuild/, "portal access reads defenses by exact requested guild");
assert.match(accessApi, /assignment\.id/, "Discord send path resolves assignments by id first");
assert.doesNotMatch(accessApi, /\.in\("name", defenseNames\)/, "Discord send path no longer fetches defenses only by name");
assert.doesNotMatch(
  accessApi.match(/const DEFENSE_SELECT_BASE = `[\s\S]*?`;/)?.[0] || "",
  /source_defense_id/,
  "portal access pre-migration fallback does not select source_defense_id",
);
assert.match(saasPortal, /libraryDefenses=/, "admin UI passes library entries to list component");
assert.match(saasPortal, /onImportDefense=\{importDefense\}/, "admin UI wires explicit import handler");
assert.match(myDefensesTab, /resolveAssignedDefense/, "Mes defenses resolves local copy assignments");
assert.match(myDefensesTab, /defenseId: defense\.id/, "Mes defenses assigns stable defense id");
assert.match(guildManagementTab, /member-defense-assign/, "Gestion de guilde uses the dedicated assignment endpoint");
assert.match(migrationSql, /create or replace function public\.import_guild_defense_snapshot/, "migration defines import RPC");
assert.match(migrationSql, /insert into public\.guild_defense_slots/, "import clones slots");
assert.match(migrationSql, /insert into public\.guild_defense_conditions/, "import clones conditions");
assert.match(migrationSql, /insert into public\.guild_defense_blocks/, "import clones blocks");
assert.match(migrationSql, /drop constraint if exists/, "migration removes destructive source FK constraints");
for (const [label, sql] of [
  ["preflight", preflightSql],
  ["migration", migrationSql],
  ["verify", verifySql],
]) {
  assert.doesNotMatch(sql, /\bpg_constraint\s+constraint\b/i, `${label} does not alias pg_constraint as a reserved word`);
  assert.doesNotMatch(sql, /\bconstraint\./i, `${label} does not reference the reserved constraint alias`);
  assert.match(sql, /assignment_empty_markers/, `${label} centralizes legacy empty assignment markers`);
  assert.match(sql, /'â€”'/, `${label} ignores mojibake em-dash placeholders`);
  assert.match(sql, /'â€“'/, `${label} ignores mojibake en-dash placeholders`);
  assert.doesNotMatch(
    sql,
    /nullif\(nullif\(member\.defense_[12]/i,
    `${label} does not use the old partial placeholder filter`,
  );
}
assert.match(preflightSql, /column_source_defense_id_exists/, "preflight reports whether source_defense_id exists");
assert.match(preflightSql, /column_organization_id_exists/, "preflight reports whether organization_id exists");
assert.match(preflightSql, /column_defense_1_id_exists/, "preflight reports whether defense_1_id exists");
assert.match(preflightSql, /column_defense_2_id_exists/, "preflight reports whether defense_2_id exists");
assert.match(preflightSql, /assignment_raw_values/, "preflight reports raw legacy assignment values");
assert.equal(
  countSqlMatches(preflightSql, /^assignment_normalized_slots as \(/gm),
  1,
  "preflight defines assignment_normalized_slots exactly once",
);
assert.equal(
  countSqlMatches(preflightSql, /^member_defenses as \(/gm),
  1,
  "preflight defines member_defenses exactly once",
);
assert.equal(
  countSqlMatches(preflightSql, /^legacy_g2_member_defenses as \(/gm),
  1,
  "preflight defines legacy_g2_member_defenses exactly once",
);
assert.doesNotMatch(preflightSql, /^assignment_raw_slots as \(/m, "preflight has no stale assignment_raw_slots cte");
assert.doesNotMatch(
  preflightSql,
  /where\s+slot\.defense_name\s+is\s+not\s+null/i,
  "preflight has no stale slot.defense_name filter from the old assignment block",
);
assert.doesNotMatch(
  preflightSql,
  /\('defense_1',\s*nullif\(nullif\(member\.defense_1,\s*'--'\),\s*'—'\)\)/i,
  "preflight has no stale defense_1 partial placeholder normalization",
);
const preflightStatementCount = preflightSql
  .replace(/--.*$/gm, "")
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean).length;
assert.equal(preflightStatementCount, 1, "preflight returns one consolidated result set for Supabase");
assert.match(preflightSql, /\bunion all\b/i, "preflight consolidates diagnostics through one unioned result set");
assert.match(
  preflightSql,
  /check_name[\s\S]*subject[\s\S]*expected_value[\s\S]*actual_value[\s\S]*status[\s\S]*details/i,
  "preflight exposes one diagnostic table with stable columns",
);
assert.match(preflightSql, /to_jsonb\(defense\)->>'source_defense_id'/, "preflight reads future source column through jsonb");
assert.doesNotMatch(
  preflightSql,
  /\b(?:defense|local_defense|g2_defense|source_defense)\.source_defense_id\b/i,
  "preflight does not directly reference source_defense_id before migration",
);
assert.match(preflightSql, /guild_code_cross_tenant_duplicates/, "preflight audits cross-tenant guild_code duplicates");
assert.match(preflightSql, /existing_defense_total/, "preflight reports existing defense total");
assert.match(preflightSql, /existing_defenses_expected_native_guild_g2/, "preflight reports the confirmed G2 legacy ownership assumption");
assert.doesNotMatch(
  migrationSql,
  /from\s+public\.portal_guilds\s+guild[\s\S]{0,240}where\s+guild\.guild_code\s*=[\s\S]{0,160}limit\s+1/i,
  "migration does not resolve portal_guilds with guild_code plus limit 1",
);
assert.match(
  migrationSql,
  /guild\.organization_id\s*=\s*v_source\.organization_id[\s\S]{0,160}guild\.guild_code\s*=\s*p_target_guild_code/i,
  "import RPC resolves target guild inside the source organization",
);
assert.match(
  migrationSql,
  /on public\.guild_defenses \(organization_id, guild_code, source_defense_id\)/,
  "duplicate import index is tenant-scoped",
);
assert.match(migrationSql, /v_unexpected_legacy_count/, "migration validates historical native defenses are still marked G2");
assert.match(migrationSql, /import_guild_defense_snapshot\(/, "migration uses the import RPC for legacy assignment copies");
assert.doesNotMatch(
  migrationSql,
  /\b(?:min|max)\s*\(\s*(?:guild\.organization_id|source_defense\.id|matching_ids\[1\])\s*\)/i,
  "migration does not use invalid min/max aggregates on uuid values",
);
assert.match(verifySql, /portal_guild_code_duplicates/, "verify confirms no guild_code crosses tenants");
assert.match(verifySql, /unique_import_index_tenant_scoped/, "verify checks tenant-scoped duplicate import index");
assert.match(verifySql, /native_defenses_outside_expected_g2/, "verify checks legacy native G2 mapping");
assert.match(verifySql, /invalid_assignment_ids/, "verify checks assignment ids");
assert.match(verifySql, /source_defense_id_fk_removed/, "verify checks source FK removal");

console.log("Guild defense library tests passed");
