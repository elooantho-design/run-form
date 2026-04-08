import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const {
      mode,
      youtubeUrl,
      attackCode,
      commentaire,
      slots,
    } = req.body || {};

    const normalizedSlots = Array.isArray(slots)
      ? slots.map((slot) => ({
          position: String(slot?.position || "").trim().toUpperCase(),
          hero: String(slot?.hero || "").trim().toLowerCase(),
          direction: String(slot?.direction || "").trim().toUpperCase(),
        }))
      : [];

    if (!youtubeUrl || !String(youtubeUrl).trim()) {
      return res.status(400).json({ error: "youtubeUrl manquant" });
    }

    if (!["tour", "bastion"].includes(String(mode || "").toLowerCase())) {
      return res.status(400).json({ error: "mode invalide" });
    }

    if (normalizedSlots.length !== 5) {
      return res.status(400).json({ error: "il faut exactement 5 slots" });
    }

    const hasIncompleteSlot = normalizedSlots.some(
      (slot) => !slot.position || !slot.hero || !slot.direction
    );

    if (hasIncompleteSlot) {
      return res.status(400).json({
        error: "chaque slot doit avoir une position, un héros et une direction",
      });
    }

    const { data: stratRow, error: stratError } = await supabase
      .from("defence_strat")
      .insert({
        youtube_url: String(youtubeUrl).trim(),
        commentaire: String(commentaire || "").trim() || null,
        attack_code: String(attackCode || "").trim() || null,
      })
      .select("id, youtube_url, commentaire, attack_code")
      .single();

    if (stratError || !stratRow?.id) {
      console.error("Erreur création defence_strat:", stratError);
      return res.status(500).json({
        error: stratError?.message || "erreur création defence_strat",
      });
    }

    const slotRows = normalizedSlots.map((slot) => ({
      strat_id: stratRow.id,
      champion: slot.hero,
      position: slot.position,
      direction: slot.direction,
    }));

    const { error: slotsError } = await supabase
      .from("defence_slot")
      .insert(slotRows);

    if (slotsError) {
      console.error("Erreur création defence_slot:", slotsError);
      return res.status(500).json({
        error: slotsError.message || "erreur création defence_slot",
      });
    }

    return res.status(200).json({
      ok: true,
      strat_id: stratRow.id,
    });
  } catch (error) {
    console.error("Erreur api/run-add:", error);
    return res.status(500).json({
      error: error?.message || "server error",
    });
  }
}