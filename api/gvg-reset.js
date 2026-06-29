import { createClient } from "@supabase/supabase-js";
import { cleanupDiscordReproRequestsForDefenseIds } from "../src/lib/discordReproServer.js";

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

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim()
  );
}

function getResetActor(body) {
  const actor = body?.actor || {};
  const memberId = actor.memberId || actor.id || null;
  const name = String(actor.name || actor.watcherName || actor.discordId || "Inconnu").trim() || "Inconnu";

  return {
    memberId: isUuid(memberId) ? memberId : null,
    name,
    role: actor.role || null,
    guildCode: actor.guildCode || actor.guild_code || null,
  };
}

async function logGvgReset({
  guild,
  actor,
  defenseIds,
  storagePaths,
  discordReproCleanup,
  recordServerReset,
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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const guild = normalizeGuildCode(req.body?.guild);
    const actor = getResetActor(req.body);

    if (!isValidGuild(guild)) {
      return res.status(400).json({ error: "guild manquante ou invalide" });
    }

    // 1) Lire les défenses AVANT suppression
    const { data: defenses, error: readError } = await supabase
      .from("gvg_defense")
      .select("id, image_url")
      .eq("guild", guild);

    if (readError) {
      console.error("[gvg-reset] read error:", readError);
      return res.status(500).json({ error: "erreur lecture gvg" });
    }

    const defenseIds = (defenses || []).map((row) => row.id).filter(Boolean);
    let discordReproCleanup = null;
    let discordReproWarning = null;

    if (defenseIds.length > 0) {
      try {
        discordReproCleanup = await cleanupDiscordReproRequestsForDefenseIds(
          supabase,
          defenseIds
        );
      } catch (cleanupError) {
        console.error("[gvg-reset] discord repro cleanup error:", cleanupError);
        discordReproWarning =
          cleanupError?.message || "nettoyage Discord repro impossible";
      }
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
        return res.status(500).json({ error: "suppression storage impossible" });
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
        return res.status(500).json({ error: "suppression repro impossible" });
      }
    }

    // 4) Supprimer les défenses
    const { error: deleteError } = await supabase
      .from("gvg_defense")
      .delete()
      .eq("guild", guild);

    if (deleteError) {
      console.error("[gvg-reset] defense delete error:", deleteError);
      return res.status(500).json({ error: "suppression gvg impossible" });
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
      });
    } catch (activityError) {
      console.error("[gvg-reset] activity log error:", activityError);
      activityLogWarning = activityError?.message || "log reset impossible";
    }

    return res.status(200).json({
      success: true,
      guild,
      deleted_defenses: defenseIds.length,
      deleted_images: storagePaths.length,
      discord_repro_cleanup: discordReproCleanup,
      discord_repro_warning: discordReproWarning,
      record_server_reset: recordServerReset,
      record_server_warning: recordServerWarning,
      activity_log_warning: activityLogWarning,
    });
  } catch (err) {
    console.error("[gvg-reset] server error:", err);
    return res.status(500).json({ error: err?.message || "server error" });
  }
}
