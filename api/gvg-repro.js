import { createClient } from "@supabase/supabase-js";

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

async function handleTemplate(req, res) {
  const { gvgDefenseId, memberId, watcherName } = req.body || {};

  if (!gvgDefenseId) {
    return res.status(400).json({ error: "gvgDefenseId manquant" });
  }

  if (!memberId) {
    return res.status(400).json({ error: "memberId manquant" });
  }

  const { data: defense, error: defenseError } = await supabase
    .from("gvg_defense")
    .select("id, heroes")
    .eq("id", gvgDefenseId)
    .maybeSingle();

  if (defenseError) {
    console.error("[gvg-repro:template] defense error:", defenseError);
    return res.status(500).json({ error: "erreur lecture défense" });
  }

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
    .eq("member_id", memberId);

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
    watcherName: watcherName || "Joueur",
    gvgDefenseId,
    heroLines,
  });
}

async function handleSave(req, res) {
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

  if (!watcherName) {
    return res.status(400).json({ error: "watcherName manquant" });
  }

  if (!Array.isArray(heroLines) || heroLines.length !== 5) {
    return res.status(400).json({ error: "heroLines invalide" });
  }

  const messageText = buildMessageText({
    watcherName,
    playerPb,
    enemyPb,
    heroLines,
    artifact,
  });

  const payloadBase = {
    member_id: memberId || null,
    watcher_name: watcherName,
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

async function handleGet(req, res) {
  const gvgDefenseId = req.query?.gvgDefenseId;

  if (!gvgDefenseId) {
    return res.status(400).json({ error: "gvgDefenseId manquant" });
  }

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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (req.method === "GET") {
      return await handleGet(req, res);
    }

    if (req.method === "POST") {
      const action = req.body?.action;

      if (action === "template") {
        return await handleTemplate(req, res);
      }

      if (action === "save") {
        return await handleSave(req, res);
      }

      return res.status(400).json({ error: "action invalide" });
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    console.error("[gvg-repro] server error:", err);
    return res.status(500).json({ error: err?.message || "server error" });
  }
}
