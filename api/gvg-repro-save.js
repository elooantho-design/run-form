import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

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

    const payload = {
      gvg_defense_id: gvgDefenseId,
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

    const { data, error } = await supabase
      .from("gvg_repro")
      .upsert(payload, {
        onConflict: "gvg_defense_id",
      })
      .select("id, gvg_defense_id, watcher_name, message_text")
      .maybeSingle();

    if (error) {
      console.error("[gvg-repro-save] upsert error:", error);
      return res.status(500).json({ error: error.message || "erreur sauvegarde repro" });
    }

    return res.status(200).json({
      success: true,
      item: data,
    });
  } catch (err) {
    console.error("[gvg-repro-save]", err);
    return res.status(500).json({ error: err?.message || "server error" });
  }
}