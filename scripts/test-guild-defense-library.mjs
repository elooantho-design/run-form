import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildDefenseLibraryEntries,
  defenseBelongsToGuild,
  getDefenseAssignmentId,
  getDefenseAssignmentName,
  isImportedDefense,
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

assert.equal(defenseBelongsToGuild(nativeG1, "G1"), true, "native G1 belongs to G1");
assert.equal(defenseBelongsToGuild(nativeG1, "G2"), false, "native G1 is not directly visible in G2");
assert.equal(isImportedDefense(importedG2FromG1), true, "imported copy is marked by sourceDefenseId");

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
  verifySql,
] = await Promise.all([
  readFile(new URL("../api/portal-admin-defenses.js", import.meta.url), "utf8"),
  readFile(new URL("../api/portal-access.js", import.meta.url), "utf8"),
  readFile(new URL("../src/SaasPortal.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/MyDefensesTab.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/PortalGuildManagementTab.jsx", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library.sql", import.meta.url), "utf8"),
  readFile(new URL("../scripts/guild_defense_library_verify.sql", import.meta.url), "utf8"),
]);

assert.match(adminApi, /action === "import"/, "admin API exposes explicit import action");
assert.match(adminApi, /import_guild_defense_snapshot/, "admin API imports through transactional RPC");
assert.match(adminApi, /targetGuild === defenseGuild/, "admin API manages defenses only in the selected guild");
assert.match(adminApi, /normalizeGuildCode\(defense\.guildCode\) === activeGuildKey/, "admin API library import status is scoped to the active guild");
assert.match(accessApi, /defenseGuild === requestedGuild/, "portal access reads defenses by exact requested guild");
assert.match(accessApi, /assignment\.id/, "Discord send path resolves assignments by id first");
assert.doesNotMatch(accessApi, /\.in\("name", defenseNames\)/, "Discord send path no longer fetches defenses only by name");
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
assert.match(verifySql, /source_defense_id_fk_removed/, "verify checks source FK removal");

console.log("Guild defense library tests passed");
