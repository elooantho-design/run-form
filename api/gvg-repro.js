/* global process */
import { createClient } from "@supabase/supabase-js";
import {
  applyPortalCorsHeaders,
  applyPortalSecurityHeaders,
  isPortalAdminRole,
  requirePortalSession,
  sendPortalJson,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";
import { canUseRunTargetGuild, resolveRunScope } from "../src/lib/runScopeServer.js";
import { touchPortalMemberActivityState } from "./_portal-member-activity.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function normalizeChampionName(name) {
  if (!name) return "";
  return String(name)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\d+$/, "");
}

function normalizeDefenseChampionName(name) {
  if (!name) return null;

  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\d+$/, "")
    .replace(/[^a-z0-9]/g, "")
    .trim() || null;
}

function normalizeDefensePosition(position) {
  return String(position || "").trim().toUpperCase() || null;
}

function normalizeDefenseDirection(direction) {
  const value = String(direction || "").trim().toUpperCase();

  if (["N", "NORD", "NORTH", "UP"].includes(value)) return "N";
  if (["S", "SUD", "SOUTH", "DOWN"].includes(value)) return "S";
  if (["E", "EST", "EAST", "RIGHT"].includes(value)) return "E";
  if (["O", "OUEST", "W", "WEST", "LEFT"].includes(value)) return "O";

  return value || null;
}

function makeDefenseSignature(defense) {
  const heroes = Array.isArray(defense?.heroes) ? defense.heroes : [];

  const slots = heroes
    .map((hero) => {
      const champion = normalizeDefenseChampionName(hero?.champion || hero?.name);
      const position = normalizeDefensePosition(hero?.position);
      const direction = normalizeDefenseDirection(hero?.direction);

      if (!champion || !position || !direction) return null;

      return `${position}:${direction}:${champion}`;
    })
    .filter(Boolean)
    .sort();

  if (slots.length !== 5) return null;

  return slots.join("|");
}

function canReceivePropagatedRepro(defense) {
  const status = String(defense?.status || "").toLowerCase();
  return !status || status === "def" || status === "repro";
}

async function loadScopedDefense(gvgDefenseId, runScope, select = "id, guild") {
  const { data, error } = await supabase
    .from("gvg_defense")
    .select(select)
    .eq("id", gvgDefenseId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    const notFound = new Error("defense introuvable");
    notFound.statusCode = 404;
    throw notFound;
  }

  if (!runScope.canUseGvg || !canUseRunTargetGuild(runScope, data.guild)) {
    const denied = new Error("acces gvg refuse");
    denied.statusCode = 403;
    throw denied;
  }

  return data;
}

async function resolveRequestedReproMember({ sessionCheck, memberId, watcherName }) {
  const sessionMember = sessionCheck.member;
  const requestedMemberId = String(memberId || "").trim();
  const canActForOther = isPortalAdminRole(sessionMember.role);

  if (requestedMemberId && requestedMemberId !== String(sessionMember.id) && !canActForOther) {
    const denied = new Error("acces membre refuse");
    denied.statusCode = 403;
    throw denied;
  }

  if (canActForOther && requestedMemberId && requestedMemberId !== String(sessionMember.id)) {
    const { data, error } = await supabase
      .from("guild_members")
      .select("id, watcher_name, discord_id")
      .eq("id", requestedMemberId)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      const notFound = new Error("membre introuvable");
      notFound.statusCode = 404;
      throw notFound;
    }

    return {
      memberId: data.id,
      watcherName: data.watcher_name || data.discord_id || watcherName || "Joueur",
    };
  }

  return {
    memberId: sessionMember.id,
    watcherName: sessionMember.watcher_name || sessionMember.discord_id || watcherName || "Joueur",
  };
}

async function findMatchingReproDefenseIds(gvgDefenseId) {
  const { data: targetDefense, error: readError } = await supabase
    .from("gvg_defense")
    .select("id, guild, is_ally, heroes, status")
    .eq("id", gvgDefenseId)
    .maybeSingle();

  if (readError) throw readError;
  if (!targetDefense) return [gvgDefenseId];

  const signature = makeDefenseSignature(targetDefense);
  const guild = String(targetDefense?.guild || "").trim();

  if (!signature || !guild) return [gvgDefenseId];

  const { data, error } = await supabase
    .from("gvg_defense")
    .select("id, heroes, status, is_ally")
    .eq("guild", guild);

  if (error) throw error;

  const ids = new Set([gvgDefenseId]);

  for (const defense of data || []) {
    if (!defense?.id) continue;
    if ((defense?.is_ally === true) !== (targetDefense?.is_ally === true)) continue;
    if (!canReceivePropagatedRepro(defense)) continue;
    if (makeDefenseSignature(defense) !== signature) continue;
    ids.add(defense.id);
  }

  return [...ids];
}

function buildMessageText({
  watcherName,
  playerPb,
  enemyPb,
  heroLines,
  artifact,
}) {
  const safeWatcher = watcherName || "Joueur";
  const safePlayerPb = playerPb || "...";
  const safeEnemyPb = enemyPb || "...";
  const safeArtifact = artifact || "...";

  const heroText = (heroLines || [])
    .map((line, index) => {
      const heroName = line?.hero || `héros ${index + 1}`;
      const awakening =
        Number.isFinite(Number(line?.awakening)) && Number(line?.awakening) >= 0
          ? `A${Number(line.awakening)}`
          : "A?";
      const stuff = line?.stuff || "...";

      return `Héros ${index + 1} : ${heroName} ${awakening} stuff en : ${stuff}`;
    })
    .join("\n");

  return [
    `Repro sur ${safeWatcher}`,
    "",
    `Repro ${safePlayerPb} k PB / Adversaire ${safeEnemyPb} k PB`,
    "",
    heroText,
    "",
    `Artéfact : ${safeArtifact}`,
  ].join("\n");
}

async function handleTemplate(req, res, sessionCheck, runScope) {
  const { gvgDefenseId, memberId, watcherName } = req.body || {};

  if (!gvgDefenseId) {
    return res.status(400).json({ error: "gvgDefenseId manquant" });
  }

  const defense = await loadScopedDefense(gvgDefenseId, runScope, "id, guild, heroes");
  const requestedMember = await resolveRequestedReproMember({ sessionCheck, memberId, watcherName });

  if (!defense) {
    return res.status(404).json({ error: "défense introuvable" });
  }

  const heroes = Array.isArray(defense.heroes) ? defense.heroes : [];
  const normalizedHeroNames = heroes
    .map((hero) => normalizeChampionName(hero?.champion))
    .filter(Boolean);

  const { data: awakenings, error: awakeningsError } = await supabase
    .from("member_awakenings")
    .select(`
      awakening_level,
      champions (
        name
      )
    `)
    .eq("member_id", requestedMember.memberId);

  if (awakeningsError) {
    console.error("[gvg-repro:template] awakenings error:", awakeningsError);
    return res.status(500).json({ error: "erreur lecture éveils" });
  }

  const awakeningMap = new Map();

  for (const row of awakenings || []) {
    const heroName = normalizeChampionName(row?.champions?.name || "");
    if (!heroName) continue;
    awakeningMap.set(heroName, Number(row?.awakening_level ?? -1));
  }

  const heroLines = normalizedHeroNames.map((heroName, index) => ({
    slot: index + 1,
    hero: heroName,
    awakening: awakeningMap.has(heroName) ? awakeningMap.get(heroName) : -1,
    stuff: "",
  }));

  return res.status(200).json({
    success: true,
    watcherName: requestedMember.watcherName,
    gvgDefenseId,
    heroLines,
  });
}

async function handleSave(req, res, sessionCheck, runScope) {
  const {
    gvgDefenseId,
    memberId,
    watcherName,
    playerPb,
    enemyPb,
    heroLines,
    artifact,
  } = req.body || {};

  if (!gvgDefenseId) {
    return res.status(400).json({ error: "gvgDefenseId manquant" });
  }

  await loadScopedDefense(gvgDefenseId, runScope, "id, guild");
  const requestedMember = await resolveRequestedReproMember({ sessionCheck, memberId, watcherName });

  if (!Array.isArray(heroLines) || heroLines.length !== 5) {
    return res.status(400).json({ error: "heroLines invalide" });
  }

  const messageText = buildMessageText({
    watcherName: requestedMember.watcherName,
    playerPb,
    enemyPb,
    heroLines,
    artifact,
  });

  const payloadBase = {
    member_id: requestedMember.memberId,
    watcher_name: requestedMember.watcherName,
    player_pb: playerPb || null,
    enemy_pb: enemyPb || null,
    stuff_1: heroLines[0]?.stuff || null,
    stuff_2: heroLines[1]?.stuff || null,
    stuff_3: heroLines[2]?.stuff || null,
    stuff_4: heroLines[3]?.stuff || null,
    stuff_5: heroLines[4]?.stuff || null,
    artifact: artifact || null,
    message_text: messageText,
    updated_at: new Date().toISOString(),
  };

  const targetIds = await findMatchingReproDefenseIds(gvgDefenseId);
  const payload = targetIds.map((targetId) => ({
    ...payloadBase,
    gvg_defense_id: targetId,
  }));

  const { data, error } = await supabase
    .from("gvg_repro")
    .upsert(payload, {
      onConflict: "gvg_defense_id",
    })
    .select("id, gvg_defense_id, watcher_name, message_text");

  if (error) {
    console.error("[gvg-repro:save] upsert error:", error);
    return res.status(500).json({
      error: error.message || "erreur sauvegarde repro",
    });
  }

  await touchPortalMemberActivityState(supabase, requestedMember.memberId, {
    last_gvg_repro_at: payloadBase.updated_at,
  });

  return res.status(200).json({
    success: true,
    item:
      (data || []).find((row) => String(row.gvg_defense_id) === String(gvgDefenseId)) ||
      (data || [])[0] ||
      null,
    items: data || [],
    propagated_count: (data || []).length,
  });
}

async function handleGet(req, res, runScope) {
  const gvgDefenseId = req.query?.gvgDefenseId;

  if (!gvgDefenseId) {
    return res.status(400).json({ error: "gvgDefenseId manquant" });
  }

  await loadScopedDefense(gvgDefenseId, runScope, "id, guild");

  const { data, error } = await supabase
    .from("gvg_repro")
    .select("id, gvg_defense_id, watcher_name, message_text, created_at")
    .eq("gvg_defense_id", gvgDefenseId)
    .maybeSingle();

  if (error) {
    console.error("[gvg-repro:get] error:", error);
    return res.status(500).json({
      error: error.message || "erreur lecture repro",
    });
  }

  return res.status(200).json({
    success: true,
    item: data || null,
  });
}

export default async function handler(req, res) {
  applyPortalCorsHeaders(req, res);
  applyPortalSecurityHeaders(res);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (!verifyPortalRequestOrigin(req)) {
      return sendPortalJson(res, 403, { error: "origine invalide" }, req);
    }

    const sessionCheck = await requirePortalSession(req, supabase);
    if (sessionCheck.error) {
      return sendPortalJson(res, sessionCheck.status || 401, { error: sessionCheck.error }, req);
    }

    const runScope = await resolveRunScope(supabase, req, sessionCheck.member);

    if (req.method === "GET") {
      return await handleGet(req, res, runScope);
    }

    if (req.method === "POST") {
      const action = req.body?.action;

      if (action === "template") {
        return await handleTemplate(req, res, sessionCheck, runScope);
      }

      if (action === "save") {
        return await handleSave(req, res, sessionCheck, runScope);
      }

      return sendPortalJson(res, 400, { error: "action invalide" }, req);
    }

    return sendPortalJson(res, 405, { error: "method not allowed" }, req);
  } catch (err) {
    console.error("[gvg-repro] server error:", err);
    return sendPortalJson(res, err?.statusCode || 500, { error: err?.message || "server error" }, req);
  }
}
