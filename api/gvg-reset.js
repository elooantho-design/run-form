import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

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
    const guild = String(req.body?.guild || "").toUpperCase();

    if (!guild || !["G1", "G2"].includes(guild)) {
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

    return res.status(200).json({
      success: true,
      guild,
      deleted_defenses: defenseIds.length,
      deleted_images: storagePaths.length,
    });
  } catch (err) {
    console.error("[gvg-reset] server error:", err);
    return res.status(500).json({ error: err?.message || "server error" });
  }
}