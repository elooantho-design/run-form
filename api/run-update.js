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
    const {
      strat_id,
      youtubeUrl,
      attackCode,
      commentaire,
      slots,
    } = req.body || {};

    if (!strat_id) {
      return res.status(400).json({ error: "strat_id manquant" });
    }

    if (!youtubeUrl?.trim()) {
      return res.status(400).json({ error: "youtubeUrl manquant" });
    }

    if (!Array.isArray(slots) || slots.length !== 5) {
      return res.status(400).json({ error: "5 slots obligatoires" });
    }

    const hasIncompleteSlot = slots.some(
      (slot) => !slot?.position || !slot?.hero || !slot?.direction
    );

    if (hasIncompleteSlot) {
      return res.status(400).json({
        error: "Chaque slot doit avoir position, hero, direction",
      });
    }

    const { error: updateStratError } = await supabase
      .from("defence_strat")
      .update({
        youtube_url: youtubeUrl.trim(),
        attack_code: attackCode?.trim() || null,
        commentaire: commentaire?.trim() || null,
      })
      .eq("id", strat_id);

    if (updateStratError) {
      console.error("update defence_strat error:", updateStratError);
      return res.status(500).json({ error: "erreur update strat" });
    }

    const { error: deleteSlotsError } = await supabase
      .from("defence_slot")
      .delete()
      .eq("strat_id", strat_id);

    if (deleteSlotsError) {
      console.error("delete defence_slot error:", deleteSlotsError);
      return res.status(500).json({ error: "erreur suppression slots" });
    }

    const payload = slots.map((slot) => ({
      strat_id,
      champion: String(slot.hero).trim().toLowerCase(),
      position: String(slot.position).trim().toUpperCase(),
      direction: String(slot.direction).trim().toUpperCase(),
    }));

    const { error: insertSlotsError } = await supabase
      .from("defence_slot")
      .insert(payload);

    if (insertSlotsError) {
      console.error("insert defence_slot error:", insertSlotsError);
      return res.status(500).json({ error: "erreur insertion slots" });
    }

    return res.status(200).json({
      success: true,
      strat_id,
    });
  } catch (err) {
    console.error("[api/run-update]", err);
    return res.status(500).json({ error: "server error" });
  }
}