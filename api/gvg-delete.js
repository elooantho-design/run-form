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
    const { id } = req.body || {};

    if (!id) {
      return res.status(400).json({ error: "id manquant" });
    }

    const { data: defense, error: readError } = await supabase
      .from("gvg_defense")
      .select("id, image_url")
      .eq("id", id)
      .maybeSingle();

    if (readError) {
      console.error("[gvg-delete] read error:", readError);
      return res.status(500).json({ error: "read failed" });
    }

    if (!defense) {
      return res.status(404).json({ error: "défense introuvable" });
    }

    const storagePath = extractStoragePathFromPublicUrl(defense.image_url);

    if (storagePath) {
      const { error: storageError } = await supabase.storage
        .from("gvg-images")
        .remove([storagePath]);

      if (storageError) {
        console.error("[gvg-delete] storage error:", storageError);
        return res.status(500).json({ error: "storage delete failed" });
      }
    }

    const { error: deleteError } = await supabase
      .from("gvg_defense")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("[gvg-delete] db delete error:", deleteError);
      return res.status(500).json({ error: "delete failed" });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[gvg-delete]", err);
    return res.status(500).json({ error: "server error" });
  }
}