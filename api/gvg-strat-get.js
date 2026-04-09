import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const defenseId = req.query?.gvgDefenseId;

    if (!defenseId) {
      return res.status(400).json({ error: "gvgDefenseId manquant" });
    }

    const { data, error } = await supabase
      .from("gvg_defense")
      .select("id, strat_data")
      .eq("id", defenseId)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      strat: data?.strat_data || null,
    });
  } catch (err) {
    return res.status(500).json({ error: "server error" });
  }
}