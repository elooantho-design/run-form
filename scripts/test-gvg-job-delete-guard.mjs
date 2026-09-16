import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  annotateJobsWithActiveGvgLocks,
  extractGvgJobRefFromImageUrl,
  findActiveGvgJobReferences,
  formatJobDeleteBlockedMessage,
} from "../src/lib/gvgJobDeleteGuard.js";

class QueryStub {
  constructor(rows) {
    this.rows = rows;
    this.imageNeedle = "";
  }

  select() {
    return this;
  }

  ilike(_column, pattern) {
    this.imageNeedle = String(pattern || "").replace(/^%|%$/g, "");
    return this;
  }

  not() {
    return this;
  }

  limit() {
    return this;
  }

  then(resolve, reject) {
    const filtered = this.imageNeedle
      ? this.rows.filter((row) => String(row.image_url || "").includes(this.imageNeedle))
      : this.rows.filter((row) => row.image_url);
    return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
  }
}

function createSupabaseStub(rows) {
  return {
    from(tableName) {
      assert.equal(tableName, "gvg_defense", "job delete guard only inspects active GVG rows");
      return new QueryStub(rows);
    },
  };
}

const g1Preview = "/api/gvg-server?action=preview&guild=G1&jobId=job_active&file=b1_t1.webp";
const g2Preview = "https://vps-aad12be0.vps.ovh.net/public/jobs/G2/job_active/previews/b2_t1.webp";

assert.deepEqual(
  extractGvgJobRefFromImageUrl(g1Preview),
  {
    sourceGuild: "G1",
    sourceGuildKey: "G1",
    jobId: "job_active",
    sourcePath: "/public/jobs/G1/job_active/previews/b1_t1.webp",
  },
  "preview proxy URLs keep enough information to recover the active job reference",
);

{
  const lock = await findActiveGvgJobReferences(createSupabaseStub([
    { id: "def-1", guild: "G1", image_url: g1Preview, raw_name: "B1 T1" },
  ]), {
    sourceGuild: "G1",
    jobId: "job_active",
  });

  assert.equal(lock.deletion_allowed, false, "TEST A: an active G1 job is locked");
  assert.equal(lock.defense_count, 1, "TEST A: active defense count is reported");
  assert.deepEqual(lock.guilds, ["G1"], "TEST A: blocking guild is reported");
  assert.match(formatJobDeleteBlockedMessage(lock), /G1/, "TEST A: conflict message names the guild");
}

{
  const lock = await findActiveGvgJobReferences(createSupabaseStub([
    { id: "def-1", guild: "G1", image_url: g1Preview, raw_name: "B1 T1" },
  ]), {
    sourceGuild: "G1",
    jobId: "job_unused",
  });

  assert.equal(lock.deletion_allowed, true, "TEST B: an unused job remains deletable");
  assert.equal(lock.defense_count, 0, "TEST B: no active reference is reported");
}

{
  const annotated = await annotateJobsWithActiveGvgLocks(
    createSupabaseStub([
      { id: "def-1", guild: "G1", image_url: g1Preview, raw_name: "B1 T1" },
      { id: "def-2", guild: "G2", image_url: g2Preview, raw_name: "B2 T1" },
    ]),
    [
      { source_guild: "G1", job_id: "job_active" },
      { source_guild: "G2", job_id: "job_active" },
      { source_guild: "G3", job_id: "job_free" },
    ],
  );

  assert.deepEqual(
    annotated.map((job) => [job.source_guild, job.deletion_locked, job.active_gvg_lock.guilds]),
    [
      ["G1", true, ["G1"]],
      ["G2", true, ["G2"]],
      ["G3", false, []],
    ],
    "TEST C/D: listed jobs expose lock metadata and become deletable once active rows disappear",
  );
}

const serverSource = await readFile(new URL("../api/gvg-server.js", import.meta.url), "utf8");
const deleteHandler = serverSource.slice(
  serverSource.indexOf("async function handleDeleteJob"),
  serverSource.indexOf("async function handleDiscordReproInteraction"),
);

assert.ok(deleteHandler.includes("findActiveGvgJobReferences"), "server delete handler checks active GVG references");
assert.ok(deleteHandler.includes("res.status(409)"), "server delete handler returns HTTP 409 for active GVG references");
assert.ok(
  deleteHandler.indexOf("findActiveGvgJobReferences") < deleteHandler.indexOf("deleteVpsJob"),
  "VPS delete is not called before the active-GVG guard",
);

const validationSource = await readFile(new URL("../src/components/GvgValidationTab.jsx", import.meta.url), "utf8");
const adminSource = await readFile(new URL("../src/components/GvgAdminTab.jsx", import.meta.url), "utf8");

assert.match(validationSource, /isJobDeletionLocked\(job\)/, "validation job list disables delete for locked jobs");
assert.match(adminSource, /isJobDeletionLocked\(job\)/, "admin job list disables delete for locked jobs");

console.log("gvg job delete guard tests passed");
