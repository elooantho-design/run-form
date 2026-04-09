import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

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
    const { id, action, watcher } = req.body || {};

    if (!id || !action) {
      return res.status(400).json({ error: "id ou action manquant" });
    }

    if (!["repro", "cancel"].includes(action)) {
      return res.status(400).json({ error: "action invalide" });
    }

    const updatePayload =
      action === "repro"
        ? {
            status: "repro",
            repro_by: watcher || "Joueur",
            updated_at: new Date().toISOString(),
          }
        : {
            status: "def",
            repro_by: null,
            updated_at: new Date().toISOString(),
          };

    const { data, error } = await supabase
      .from("gvg_defense")
      .update(updatePayload)
      .eq("id", id)
      .select("id, status, repro_by")
      .maybeSingle();

    if (error) {
      console.error("[gvg-update] supabase error:", error);
      return res.status(500).json({
        error: error.message || "update failed",
        details: error,
      });
    }

    if (!data) {
      return res.status(404).json({ error: "défense introuvable" });
    }

    return res.status(200).json({
      success: true,
      item: data,
    });
  } catch (err) {
    console.error("[gvg-update] server error:", err);
    return res.status(500).json({
      error: err?.message || "server error",
    });
  }
}