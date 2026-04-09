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
    const guild = String(req.query?.guild || "").toUpperCase();

    if (!guild || !["G1", "G2"].includes(guild)) {
      return res.status(400).json({ error: "guild manquante ou invalide" });
    }

    const { data, error } = await supabase
      .from("gvg_defense")
      .select(`
        id,
        guild,
        bastion,
        type,
        tower,
        team,
        defense_key,
        raw_name,
        heroes,
        status,
        repro_by,
        image_url,
        created_at,
        updated_at
      `)
      .eq("guild", guild)
      .order("bastion", { ascending: true })
      .order("type", { ascending: true })
      .order("tower", { ascending: true, nullsFirst: true })
      .order("team", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[api/gvg-list] select error:", error);
      return res.status(500).json({ error: "erreur lecture gvg" });
    }

    return res.status(200).json({
      guild,
      items: data || [],
    });
  } catch (err) {
    console.error("[api/gvg-list]", err);
    return res.status(500).json({ error: "server error" });
  }
}