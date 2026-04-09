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
      console.error("[gvg-repro-template] defense error:", defenseError);
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
      console.error("[gvg-repro-template] awakenings error:", awakeningsError);
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
  } catch (err) {
    console.error("[gvg-repro-template]", err);
    return res.status(500).json({ error: "server error" });
  }
}