/* global process */
import { createClient } from "@supabase/supabase-js";
import { purgeDiscordReproChannelForGuild } from "../src/lib/discordReproServer.js";
import {
  applyPortalCorsHeaders,
  applyPortalSecurityHeaders,
  requirePortalAdminSession,
  sendPortalJson,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";
import { canUseRunTargetGuild, resolveRunScope } from "../src/lib/runScopeServer.js";
import { archiveEnemyDefensesBeforeGvgReset } from "./_gvg-enemy-defense-bank.js";
import { refreshEnemyDefenseStratAvailabilityForGuild } from "./gvg-enemy-defense-bank.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const DEFAULT_GVG_SERVER_URL = "http://152.228.128.157";

function normalizeGuildCode(value) {
  const code = String(value || "").trim().toUpperCase().replace(/\s+/g, "_");
  return /^[A-Z0-9_-]{2,24}$/.test(code) ? code : null;
}

function isValidGuild(value) {
  return normalizeGuildCode(value) !== null;
}

async function logGvgReset({
  guild,
  actor,
  defenseIds,
  storagePaths,
  discordReproCleanup,
  recordServerReset,
  enemyDefenseArchive,
  enemyStratAvailability,
}) {
  const { error } = await supabase.from("portal_activity_logs").insert({
    actor_member_id: actor.memberId,
    actor_name: actor.name,
    action_type: "gvg_reset",
    entity_type: "gvg",
    entity_id: guild,
    summary: `${actor.name} a reset la GVG ${guild}`,
    metadata: {
      guild,
      actorRole: actor.role,
      actorGuildCode: actor.guildCode,
      deletedDefenses: defenseIds.length,
      deletedImages: storagePaths.length,
      discordReproCleanup,
      recordServerReset,
      enemyDefenseArchive,
      enemyStratAvailability,
    },
  });

  if (error) throw error;
}

function getGvgServerConfig() {
  const serverUrl = String(
    process.env.GVG_SERVER_URL ||
      process.env.GVG_VPS_URL ||
      DEFAULT_GVG_SERVER_URL
  ).replace(/\/$/, "");
  const token = process.env.GVG_API_TOKEN || process.env.GVG_SERVER_TOKEN || "";

  return { serverUrl, token };
}

async function requestGvgVps(pathname, options = {}) {
  const { serverUrl, token } = getGvgServerConfig();

  if (!token) {
    const error = new Error("GVG_API_TOKEN manquant cote serveur");
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch(new URL(pathname, `${serverUrl}/`).toString(), {
    method: options.method || "GET",
    headers: {
      "X-GVG-Token": token,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(data?.detail || data?.error || `Erreur VPS ${response.status}`);
    error.statusCode = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function extractStoragePathFromPublicUrl(url) {
  if (!url) return null;

  const marker = "/storage/v1/object/public/gvg-images/";
  const index = String(url).indexOf(marker);

  if (index === -1) return null;

  return String(url).slice(index + marker.length);
}

export default async function handler(req, res) {
  applyPortalCorsHeaders(req, res);
  applyPortalSecurityHeaders(res);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return sendPortalJson(res, 405, { error: "method not allowed" }, req);
  }

  if (!verifyPortalRequestOrigin(req)) {
    return sendPortalJson(res, 403, { error: "origine invalide" }, req);
  }

  try {
    const guild = normalizeGuildCode(req.body?.guild);

    if (!isValidGuild(guild)) {
      return sendPortalJson(res, 400, { error: "guild manquante ou invalide" }, req);
    }

    const sessionCheck = await requirePortalAdminSession(req, supabase);
    if (sessionCheck.error) {
      return sendPortalJson(res, sessionCheck.status || 401, { error: sessionCheck.error }, req);
    }

    const runScope = await resolveRunScope(supabase, req, sessionCheck.member);
    if (!runScope.canUseGvg || !canUseRunTargetGuild(runScope, guild)) {
      return sendPortalJson(res, 403, { error: "acces gvg refuse" }, req);
    }

    const actor = {
      memberId: sessionCheck.member.id,
      name: sessionCheck.member.watcher_name || sessionCheck.member.discord_id || "Inconnu",
      role: sessionCheck.member.role || null,
      guildCode: sessionCheck.member.guild_code || null,
    };

    // 1) Lire les défenses AVANT suppression
    const { data: defenses, error: readError } = await supabase
      .from("gvg_defense")
      .select(`
        id,
        guild,
        bastion,
        type,
        tower,
        team,
        defense_key,
        raw_name,
        heroes,
        image_url,
        status,
        repro_by,
        is_ally,
        record_status,
        created_at,
        updated_at
      `)
      .eq("guild", guild);

    if (readError) {
      console.error("[gvg-reset] read error:", readError);
      return sendPortalJson(res, 500, { error: "erreur lecture gvg" }, req);
    }

    const defenseIds = (defenses || []).map((row) => row.id).filter(Boolean);
    const enemyDefenseArchive = await archiveEnemyDefensesBeforeGvgReset(supabase, {
      guild,
      defenses: defenses || [],
    });
    let enemyStratAvailability = null;
    let enemyStratAvailabilityWarning = null;

    try {
      enemyStratAvailability = await refreshEnemyDefenseStratAvailabilityForGuild({
        scope: runScope,
        targetGuildCode: guild,
      });
    } catch (availabilityError) {
      console.error("[gvg-reset] enemy strat availability refresh error:", availabilityError);
      enemyStratAvailabilityWarning =
        availabilityError?.message || "mise a jour availability strats adverses impossible";
    }

    let discordReproCleanup = null;
    let discordReproWarning = null;

    try {
      discordReproCleanup = await purgeDiscordReproChannelForGuild(supabase, guild, {
        reason: "gvg_reset",
        source: "gvg-reset",
      });
    } catch (cleanupError) {
      console.error("[gvg-reset] discord repro cleanup error:", cleanupError);
      discordReproWarning =
        cleanupError?.message || "nettoyage Discord repro impossible";
    }

    // 2) Supprimer les fichiers liés
    const storagePaths = (defenses || [])
      .map((row) => extractStoragePathFromPublicUrl(row.image_url))
      .filter(Boolean);

    if (storagePaths.length > 0) {
      const { error: storageError } = await supabase.storage
        .from("gvg-images")
        .remove(storagePaths);

      if (storageError) {
        console.error("[gvg-reset] storage remove error:", storageError);
        return sendPortalJson(res, 500, { error: "suppression storage impossible" }, req);
      }
    }

    // 3) Supprimer les repro liées
    if (defenseIds.length > 0) {
      const { error: reproError } = await supabase
        .from("gvg_repro")
        .delete()
        .in("gvg_defense_id", defenseIds);

      if (reproError) {
        console.error("[gvg-reset] repro delete error:", reproError);
        return sendPortalJson(res, 500, { error: "suppression repro impossible" }, req);
      }
    }

    // 4) Supprimer les défenses
    const { error: deleteError } = await supabase
      .from("gvg_defense")
      .delete()
      .eq("guild", guild);

    if (deleteError) {
      console.error("[gvg-reset] defense delete error:", deleteError);
      return sendPortalJson(res, 500, { error: "suppression gvg impossible" }, req);
    }

    let recordServerReset = null;
    let recordServerWarning = null;
    let activityLogWarning = null;

    try {
      recordServerReset = await requestGvgVps(
        `/api/v1/record/sessions/${encodeURIComponent(guild)}`,
        { method: "DELETE" }
      );
    } catch (recordResetError) {
      console.error("[gvg-reset] record server reset error:", recordResetError);
      recordServerWarning =
        recordResetError?.message || "nettoyage records VPS impossible";
    }

    try {
      await logGvgReset({
        guild,
        actor,
        defenseIds,
        storagePaths,
        discordReproCleanup,
        recordServerReset,
        enemyDefenseArchive,
        enemyStratAvailability,
      });
    } catch (activityError) {
      console.error("[gvg-reset] activity log error:", activityError);
      activityLogWarning = activityError?.message || "log reset impossible";
    }

    return sendPortalJson(res, 200, {
      success: true,
      guild,
      deleted_defenses: defenseIds.length,
      deleted_images: storagePaths.length,
      enemy_defense_archive: enemyDefenseArchive,
      enemy_strat_availability: enemyStratAvailability,
      enemy_strat_availability_warning: enemyStratAvailabilityWarning,
      discord_repro_cleanup: discordReproCleanup,
      discord_repro_warning: discordReproWarning,
      record_server_reset: recordServerReset,
      record_server_warning: recordServerWarning,
      activity_log_warning: activityLogWarning,
    }, req);
  } catch (err) {
    console.error("[gvg-reset] server error:", err);
    return sendPortalJson(res, err?.statusCode || 500, { error: err?.message || "server error" }, req);
  }
}
