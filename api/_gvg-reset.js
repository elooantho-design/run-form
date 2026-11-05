import { randomUUID } from "node:crypto";
import { buildSourceGvgKey } from "./_gvg-enemy-defense-bank.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resetError(message, statusCode = 409) {
  return Object.assign(new Error(message), { statusCode });
}

export function parseGvgResetInput(body) {
  const guild = String(body?.guild || "").trim().toUpperCase().replace(/\s+/g, "_");
  if (!/^[A-Z0-9_-]{2,24}$/.test(guild)) throw resetError("Guilde manquante ou invalide.", 400);
  if (body?.action === "resume") {
    if (!UUID.test(String(body.operationId || ""))) throw resetError("Identifiant de reprise invalide.", 400);
    return { action: "resume", guild, operationId: body.operationId };
  }
  if (body?.action && body.action !== "reset") throw resetError("Action de reset invalide.", 400);
  if (typeof body?.saveEnemyDefenses !== "boolean") {
    throw resetError("Choisissez explicitement de sauvegarder ou non les defenses adverses.", 400);
  }
  if (!UUID.test(String(body?.requestId || ""))) throw resetError("Identifiant de reset invalide.", 400);
  return { guild, saveEnemyDefenses: body.saveEnemyDefenses, requestId: body.requestId };
}

async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    const missing = error.code === "PGRST202" || error.code === "42883" || error.code === "42P01";
    const message = missing ? "Installation SQL du reset securise requise."
      : error.code === "42501" ? "Vos permissions ou le perimetre de la guilde ont change."
      : error.code === "55P03" ? "Une operation GvG est en cours. Reessayez la meme demande apres sa fin."
      : error.code === "40001" ? "La GvG a change pendant la preparation. Confirmez une nouvelle tentative."
      : error.message || "Reset impossible.";
    throw Object.assign(resetError(message, missing ? 428 : error.code === "42501" ? 403 : 409), { code: error.code });
  }
  return data;
}

function storagePath(url) {
  if (!url) return null;
  const marker = "/storage/v1/object/public/gvg-images/";
  const index = String(url).indexOf(marker);
  if (index < 0) return null;
  const path = String(url).slice(index + marker.length).split("?")[0];
  return path && !path.split("/").includes("..") ? path : null;
}

async function retainResetImages(db, defenses) {
  const urls = [...new Set(defenses.map(row => row.image_url).filter(url => storagePath(url)))];
  if (!urls.length) return { removed: 0, protected: 0, retained: 0 };
  const referenced = new Set();
  for (const table of ["gvg_defense", "guild_defenses", "gvg_enemy_defenses"]) {
    const { data, error } = await db.from(table).select("image_url").in("image_url", urls);
    if (error) throw error;
    for (const row of data || []) referenced.add(row.image_url);
  }
  const paths = [...new Set(urls.filter(url => !referenced.has(url)).map(storagePath))];
  // Storage.remove has no compare-and-delete generation precondition. Retaining
  // an old object is safer than deleting a newly uploaded object at the same key.
  return { removed: 0, protected: referenced.size, retained: paths.length,
    reason: "generation_safe_storage_deletion_unavailable" };
}

export async function getPendingGvgReset({ db, portalGuild, actor }) {
  return rpc(db, "get_pending_gvg_reset_cleanup", {
    p_portal_guild_id: portalGuild.id, p_actor_member_id: actor.id,
  });
}

async function requireCleanupCapabilities(db, requestVps) {
  const sql = await rpc(db, "get_gvg_reset_cleanup_capabilities", {});
  if (sql?.version !== 2 || sql?.scoped_cleanup !== true || sql?.resume_cleanup !== true) {
    throw resetError("Installation SQL corrective du reset requise.", 428);
  }
  const vps = await requestVps("/api/v1/reset-cleanups/capabilities");
  if (vps?.version !== 1 || vps?.scoped_cleanup !== true || vps?.initial_snapshot !== true) {
    throw resetError("Adaptation VPS du nettoyage cible requise. Aucun reset lance.", 428);
  }
}

function validateManifest(manifest, operation) {
  if (!manifest || manifest.version !== 1 || manifest.operation_id !== operation.operation_id
    || manifest.organization_id !== operation.organization_id || manifest.portal_guild_id !== operation.portal_guild_id
    || manifest.guild !== operation.technical_guild) {
    throw resetError("Le manifeste de nettoyage ne correspond pas a cette operation.", 409);
  }
  return manifest;
}

function signedManifest(prepared, operation) {
  const manifest = validateManifest(prepared?.manifest, operation);
  if (manifest.snapshot_id !== operation.request_id || manifest.initial_snapshot?.snapshot_id !== operation.request_id
    || !/^[0-9a-f]{64}$/.test(manifest.initial_snapshot?.snapshot_digest || "")) {
    throw resetError("Inventaire initial du nettoyage absent ou incoherent.", 409);
  }
  if (Object.hasOwn(manifest, "authorization")
    || !/^[0-9a-f]{64}$/.test(prepared.manifest_digest || "")
    || !/^v1\.[0-9a-f]{64}$/.test(prepared.manifest_token || "")) {
    throw resetError("Signature du manifeste de nettoyage absente ou invalide.", 409);
  }
  return { ...manifest, authorization: { manifest_digest: prepared.manifest_digest, manifest_token: prepared.manifest_token } };
}

function responseFor(operation, receipt, { guild, saveEnemyDefenses }, cleanup, archive) {
  return {
    success: true,
    guild,
    operation_id: operation.operation_id,
    saveEnemyDefenses,
    deleted_defenses: receipt?.deleted_defenses || 0,
    deleted_images: cleanup?.storage?.removed || 0,
    retained_images: cleanup?.storage?.retained || 0,
    enemy_defense_archive: saveEnemyDefenses ? archive || receipt?.archive_result || null : { skipped: true, reason: "technical_reset" },
    enemy_strat_availability: cleanup?.availability || null,
    discord_repro_cleanup: cleanup?.discord || null,
    record_server_reset: cleanup?.record || null,
    already_completed: operation.state === "completed",
  };
}

// SQL owns the business transaction. External cleanup is idempotent and resumable.
export async function executeGvgReset({
  db, input, portalGuild, actor,
  archiveEnemyDefenses, refreshAvailability, purgeDiscord, requestVps,
}) {
  try {
    await requireCleanupCapabilities(db, requestVps);
  } catch (error) {
    // This attempt did not start or resume any operation.
    throw Object.assign(error, { resetState: "not_started" });
  }
  let initialSnapshot = null;
  if (input.action !== "resume") {
    initialSnapshot = await requestVps("/api/v1/reset-cleanups/snapshot", {
      method: "POST", body: { request_id: input.requestId, guild: input.guild,
        organization_id: portalGuild.organization_id, portal_guild_id: portalGuild.id },
    });
    if (initialSnapshot?.snapshot_id !== input.requestId
      || !/^snapshot\.v1\.[0-9a-f]{64}$/.test(initialSnapshot.snapshot_token || "")) {
      throw resetError("Inventaire VPS initial indisponible. Aucun reset lance.", 409);
    }
  }
  let leaseToken = randomUUID();
  const initial = input.action === "resume" ? await rpc(db, "resume_gvg_reset_cleanup", {
    p_operation_id: input.operationId, p_actor_member_id: actor.id,
    p_portal_guild_id: portalGuild.id, p_lease_token: leaseToken,
  }) : await rpc(db, "begin_gvg_reset", {
    p_portal_guild_id: portalGuild.id,
    p_actor_member_id: actor.id,
    p_request_id: input.requestId,
    p_save_enemy_defenses: input.saveEnemyDefenses,
    p_lease_token: leaseToken,
  });
  leaseToken = initial.lease_token || leaseToken;
  const operation = await rpc(db, "read_gvg_reset_cleanup", {
    p_operation_id: initial.operation_id, p_lease_token: leaseToken,
  });
  if (operation.portal_guild_id !== portalGuild.id || operation.technical_guild !== input.guild
    || operation.organization_id !== portalGuild.organization_id) throw resetError("Perimetre de reprise invalide.", 403);
  input = { ...input, saveEnemyDefenses: operation.save_enemy_defenses };
  if (operation.state === "failed") {
    throw Object.assign(resetError("Cette operation a echoue avant le reset. Confirmez une nouvelle tentative."),
      { operationId: operation.operation_id, resetState: "failed" });
  }
  let receipt = operation.result || null;
  const cleanup = { ...(operation.cleanup_result || {}) };
  if (operation.state === "completed") return responseFor(operation, receipt, input, cleanup);
  let committed = operation.state === "committed";
  const defenses = operation.defenses || [];
  const persistArchive = async ({ sourceGvgKey = null, defenses: payload = null } = {}) => {
    if (committed) return receipt?.archive_result || {};
    receipt = await rpc(db, "commit_gvg_reset", {
      p_operation_id: operation.operation_id, p_lease_token: leaseToken,
      p_source_gvg_key: sourceGvgKey, p_archive_payload: payload,
    });
    committed = true;
    return receipt.archive_result || {};
  };
  try {
    let manifest = operation.cleanup_manifest || null;
    if (committed && !manifest) cleanup.record = { skipped: true, reason: "legacy_no_manifest_preserved" };
    if (!committed) {
      if (!manifest) {
        if (!Number.isFinite(Date.parse(operation.created_at))) throw resetError("Date d'origine du reset indisponible.", 409);
        const prepared = await requestVps(`/api/v1/reset-cleanups/${operation.operation_id}/prepare`, {
          method: "POST", body: { guild: operation.technical_guild, organization_id: operation.organization_id,
            portal_guild_id: operation.portal_guild_id, defense_ids: defenses.map(row => row.id), created_before: operation.created_at,
            snapshot_id: initialSnapshot.snapshot_id, snapshot_token: initialSnapshot.snapshot_token },
        });
        manifest = signedManifest(prepared, operation);
        await rpc(db, "register_gvg_reset_cleanup", {
          p_operation_id: operation.operation_id, p_lease_token: leaseToken, p_manifest: manifest,
        });
      } else validateManifest(manifest, operation);
    }
    if (!cleanup.discord) {
      const result = committed
        ? { skipped: true, reason: "committed_reset_no_new_discord_cleanup" }
        : await purgeDiscord(db, input.guild, { reason: "gvg_reset", source: "gvg-reset", defenseIds: defenses.map(row => row.id) });
      if (result?.enabled === false || (!result?.skipped && result?.scoped_cleanup_confirmed !== true)) {
        console.error("[gvg-reset] reset_discord_cleanup_incomplete", {
          guild: input.guild,
          defense_ids: defenses.map(row => row.id),
          failed_requests: result?.items?.filter(item => item.errors?.length).length ?? null,
        });
        throw resetError(committed
          ? "Reset deja enregistre ; nettoyage Discord repro incomplet. Reprenez la meme operation."
          : "Nettoyage Discord repro incomplet. Aucune nouvelle sauvegarde ni suppression GvG effectuee.", 503);
      }
      cleanup.discord = result;
    }
    let archive = null;
    if (input.saveEnemyDefenses) {
      archive = await archiveEnemyDefenses(db, { guild: input.guild, defenses, persistArchive });
      if (!committed) await persistArchive({ sourceGvgKey: buildSourceGvgKey(input.guild, defenses.filter(row => row.is_ally !== true)), defenses: [] });
      if (archive?.similarity_detection?.ok === false) {
        throw resetError("Reset enregistre ; post-traitement adverse a reprendre avec la meme operation.", 503);
      }
      if (!cleanup.availability) cleanup.availability = await refreshAvailability();
    } else if (!committed) {
      await persistArchive();
    }
    if (!cleanup.storage) cleanup.storage = await retainResetImages(db, defenses);
    if (!cleanup.record) {
      if (manifest) {
        validateManifest(manifest, operation);
        const { authorization, ...originalManifest } = manifest;
        if (!authorization?.manifest_token) throw resetError("Signature d'origine du nettoyage indisponible.", 409);
        cleanup.record = await requestVps(`/api/v1/reset-cleanups/${operation.operation_id}/execute`, {
          method: "POST", body: { manifest: originalManifest, manifest_token: authorization.manifest_token },
        });
        if (cleanup.record?.ok !== true || cleanup.record?.cleanup_complete !== true) {
          delete cleanup.record;
          throw resetError("Nettoyage cible incomplet ; reprendre cette operation.", 503);
        }
      } else {
        cleanup.record = { skipped: true, reason: "legacy_no_manifest_preserved" };
      }
    }
    delete cleanup.error;
    await rpc(db, "finish_gvg_reset", {
      p_operation_id: operation.operation_id, p_lease_token: leaseToken,
      p_success: true, p_cleanup_result: cleanup,
    });
    return responseFor(operation, receipt, input, cleanup, archive);
  } catch (error) {
    let finished;
    try {
      finished = await rpc(db, "finish_gvg_reset", {
        p_operation_id: operation.operation_id, p_lease_token: leaseToken,
        p_success: false, p_cleanup_result: { ...cleanup, error: error?.message || "Reset interrompu." },
      });
    } catch (releaseError) {
      console.error("[gvg-reset] operation release failed:", releaseError.code || "unknown");
    }
    const commitConfirmed = committed || finished?.state === "committed" || finished?.state === "completed";
    throw Object.assign(error, {
      statusCode: commitConfirmed ? 503 : error.statusCode || 500,
      resetCommitted: commitConfirmed,
      resetState: finished?.state === "failed" ? "failed" : undefined,
      operationId: operation.operation_id,
    });
  }
}
