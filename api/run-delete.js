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
    const { strat_id } = req.body || {};

    if (!strat_id) {
      return res.status(400).json({ error: "strat_id manquant" });
    }

    const { error: deleteSlotsError } = await supabase
      .from("defence_slot")
      .delete()
      .eq("strat_id", strat_id);

    if (deleteSlotsError) {
      console.error("delete defence_slot error:", deleteSlotsError);
      return res.status(500).json({ error: "erreur suppression slots" });
    }

    const { error: deleteStratError } = await supabase
      .from("defence_strat")
      .delete()
      .eq("id", strat_id);

    if (deleteStratError) {
      console.error("delete defence_strat error:", deleteStratError);
      return res.status(500).json({ error: "erreur suppression strat" });
    }

    return res.status(200).json({
      success: true,
      strat_id,
    });
  } catch (err) {
    console.error("[api/run-delete]", err);
    return res.status(500).json({ error: "server error" });
  }
}