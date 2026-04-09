import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
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
      console.error("[gvg-repro-get] error:", error);
      return res.status(500).json({
        error: error.message || "erreur lecture repro",
      });
    }

    return res.status(200).json({
      success: true,
      item: data || null,
    });
  } catch (err) {
    console.error("[gvg-repro-get]", err);
    return res.status(500).json({
      error: err?.message || "server error",
    });
  }
}