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
    const { guild } = req.body || {};

    if (!guild || !["G1", "G2"].includes(String(guild).toUpperCase())) {
      return res.status(400).json({ error: "guild manquante ou invalide" });
    }

    const normalizedGuild = String(guild).toUpperCase();

    const { data: defenses, error: readError } = await supabase
      .from("gvg_defense")
      .select("id, image_url")
      .eq("guild", normalizedGuild);

    if (readError) {
      console.error("[gvg-reset] read error:", readError);
      return res.status(500).json({ error: "read failed" });
    }

    const storagePaths = (defenses || [])
      .map((row) => extractStoragePathFromPublicUrl(row.image_url))
      .filter(Boolean);

    if (storagePaths.length) {
      const { error: storageError } = await supabase.storage
        .from("gvg-images")
        .remove(storagePaths);

      if (storageError) {
        console.error("[gvg-reset] storage error:", storageError);
        return res.status(500).json({ error: "storage reset failed" });
      }
    }

    const { error: deleteError } = await supabase
      .from("gvg_defense")
      .delete()
      .eq("guild", normalizedGuild);

    if (deleteError) {
      console.error("[gvg-reset] db delete error:", deleteError);
      return res.status(500).json({ error: "erreur suppression gvg" });
    }

    return res.status(200).json({
      success: true,
      guild: normalizedGuild,
    });
  } catch (err) {
    console.error("[gvg-reset]", err);
    return res.status(500).json({ error: "server error" });
  }
}