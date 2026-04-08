import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: "id manquant" });
    }

    const { data: strat, error: stratError } = await supabase
      .from("defence_strat")
      .select("id, commentaire, youtube_url, attack_code")
      .eq("id", id)
      .single();

    if (stratError || !strat) {
      return res.status(404).json({ error: "run introuvable" });
    }

    const { data: slots, error: slotsError } = await supabase
      .from("defence_slot")
      .select("champion, position, direction")
      .eq("strat_id", id);

    if (slotsError) {
      return res.status(500).json({ error: "erreur slots" });
    }

    return res.status(200).json({
      strat_id: strat.id,
      commentaire: strat.commentaire,
      youtube_url: strat.youtube_url,
      attack_code: strat.attack_code,
      slots: slots || [],
    });
  } catch (err) {
    console.error("run-get error:", err);
    return res.status(500).json({ error: "server error" });
  }
}