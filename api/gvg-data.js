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

async function handleList(req, res) {
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
    console.error("[gvg-data:list] select error:", error);
    return res.status(500).json({ error: "erreur lecture gvg" });
  }

  return res.status(200).json({
    success: true,
    guild,
    items: data || [],
  });
}

async function handleUpdate(req, res) {
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
    console.error("[gvg-data:update] supabase error:", error);
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
}

async function handleDelete(req, res) {
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
    console.error("[gvg-data:delete] read error:", readError);
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
      console.error("[gvg-data:delete] storage error:", storageError);
      return res.status(500).json({ error: "storage delete failed" });
    }
  }

  const { error: deleteError } = await supabase
    .from("gvg_defense")
    .delete()
    .eq("id", id);

  if (deleteError) {
    console.error("[gvg-data:delete] db delete error:", deleteError);
    return res.status(500).json({ error: "delete failed" });
  }

  return res.status(200).json({ success: true });
}

async function handleReproCandidates(req, res) {
  const { defenseId } = req.body || {};

  if (!defenseId) {
    return res.status(400).json({ error: "defenseId manquant" });
  }

  const { data: defense, error: defenseError } = await supabase
    .from("gvg_defense")
    .select("id, guild, heroes")
    .eq("id", defenseId)
    .maybeSingle();

  if (defenseError) {
    console.error("[gvg-data:repro-candidates] defense error:", defenseError);
    return res.status(500).json({ error: "erreur lecture défense" });
  }

  if (!defense) {
    return res.status(404).json({ error: "défense introuvable" });
  }

const heroes = Array.isArray(defense.heroes) ? defense.heroes : [];

const heroNames = heroes
  .map((hero) => String(hero?.champion || "").trim())
  .filter(Boolean);

if (!heroNames.length) {
  return res.status(200).json({
    success: true,
    heroes: [],
    candidates: [],
  });
}

const { data: championsData, error: championsError } = await supabase
  .from("champions")
  .select("id, name")
  .in("name", heroNames);

  if (championsError) {
    console.error("[gvg-data:repro-candidates] champions error:", championsError);
    return res.status(500).json({ error: "erreur lecture champions" });
  }

const championsByName = new Map(
  (championsData || []).map((row) => [String(row.name || "").trim(), row])
);

const orderedHeroes = heroNames.map((name) => {
  const champion = championsByName.get(name);

  return {
    champion_id: champion?.id ? String(champion.id) : name,
    champion_name: name,
  };
});

  const { data: members, error: membersError } = await supabase
    .from("guild_members")
    .select("id, watcher_name")
    .eq("guild_code", defense.guild)
    .order("watcher_name", { ascending: true });

  if (membersError) {
    console.error("[gvg-data:repro-candidates] members error:", membersError);
    return res.status(500).json({ error: "erreur lecture membres" });
  }

  const memberIds = (members || []).map((member) => member.id).filter(Boolean);

  if (!memberIds.length) {
    return res.status(200).json({
      success: true,
      heroes: orderedHeroes,
      candidates: [],
    });
  }

const championIds = orderedHeroes
  .map((hero) => hero.champion_id)
  .filter((id) => /^\d+$/.test(String(id)));

const { data: awakenings, error: awakeningsError } = await supabase
  .from("member_awakenings")
  .select("member_id, champion_id, awakening_level")
  .in("member_id", memberIds)
  .in("champion_id", championIds);

  if (awakeningsError) {
    console.error("[gvg-data:repro-candidates] awakenings error:", awakeningsError);
    return res.status(500).json({ error: "erreur lecture éveils" });
  }

  const awakeningsByMember = new Map();

  for (const row of awakenings || []) {
    const memberKey = String(row.member_id);
    const championKey = String(row.champion_id);

    if (!awakeningsByMember.has(memberKey)) {
      awakeningsByMember.set(memberKey, new Map());
    }

    awakeningsByMember
      .get(memberKey)
      .set(championKey, Number(row.awakening_level ?? -1));
  }

  const candidates = (members || []).map((member) => {
    const memberAwakenings = awakeningsByMember.get(String(member.id)) || new Map();

    const heroesStatus = orderedHeroes.map((hero) => ({
      champion_id: hero.champion_id,
      champion_name: hero.champion_name,
      awakening: memberAwakenings.has(hero.champion_id)
        ? memberAwakenings.get(hero.champion_id)
        : -1,
    }));

    const canRepro = heroesStatus.every((hero) => hero.awakening >= 0);

    return {
      memberId: member.id,
      name: member.watcher_name || "Inconnu",
      canRepro,
      heroes: heroesStatus,
    };
  });

  candidates.sort((a, b) => {
    if (a.canRepro !== b.canRepro) {
      return a.canRepro ? -1 : 1;
    }

    return String(a.name).localeCompare(String(b.name), "fr", {
      sensitivity: "base",
    });
  });

  return res.status(200).json({
    success: true,
    heroes: orderedHeroes,
    candidates,
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (req.method === "GET") {
      return await handleList(req, res);
    }

if (req.method === "POST") {
  const action = req.body?.action;

  if (action === "repro" || action === "cancel") {
    return await handleUpdate(req, res);
  }

  if (action === "delete") {
    return await handleDelete(req, res);
  }

  if (action === "repro_candidates") {
    return await handleReproCandidates(req, res);
  }

  return res.status(400).json({ error: "action invalide" });
}

    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    console.error("[gvg-data] server error:", err);
    return res.status(500).json({ error: err?.message || "server error" });
  }
}