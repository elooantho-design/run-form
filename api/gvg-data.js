import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const UPLOADED_DIR =
  process.env.YOUTUBE_UPLOADED_DIR || "";
const DEFAULT_GVG_SERVER_URL = "http://152.228.128.157";

function normalizeGuildCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9_-]{2,24}$/.test(code) ? code : null;
}

function normalizeRecordScope(value) {
  const scope = String(value || "").trim().toLowerCase();
  return ["enemy", "ally", "both"].includes(scope) ? scope : null;
}

function getGvgServerConfig() {
  const serverUrl = String(
    process.env.GVG_SERVER_URL ||
      process.env.GVG_VPS_URL ||
      DEFAULT_GVG_SERVER_URL
  ).replace(/\/$/, "");
  const token = process.env.GVG_API_TOKEN || process.env.GVG_SERVER_TOKEN || "";

  return { serverUrl, token };
}

async function requestGvgVps(pathname, options = {}) {
  const { serverUrl, token } = getGvgServerConfig();

  if (!token) {
    const error = new Error("GVG_API_TOKEN manquant cote serveur");
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch(new URL(pathname, serverUrl).toString(), {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "X-GVG-Token": token,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(data?.detail || data?.error || `Erreur VPS ${response.status}`);
    error.statusCode = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function extractStoragePathFromPublicUrl(url) {
  if (!url) return null;

  const marker = "/storage/v1/object/public/gvg-images/";
  const index = String(url).indexOf(marker);

  if (index === -1) return null;

  return String(url).slice(index + marker.length);
}

function isValidGuild(value) {
  return normalizeGuildCode(value) !== null;
}

async function handleList(req, res) {
  const guild = normalizeGuildCode(req.query?.guild);

  if (!guild) {
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
  group_num,
  image_url,
  record_status,
  record_comment,
  attack_code,
  youtube_url,
  is_ally,
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

async function handleImportGroups(req, res) {
  try {
    const { guild, data } = req.body;

    if (!guild || !data?.map) {
      return res.status(400).json({ error: "data invalide" });
    }

    const entries = Object.entries(data.map);

    for (const [key, value] of entries) {
      const groupNum = value?.num;

      if (!groupNum) continue;

      const match = key.match(/^b(\d+)_(t(\d+)|fort)_team(\d)$/);
      if (!match) continue;

      const bastion = Number(match[1]);
      const isFort = key.includes("fort");
      const tower = isFort ? null : Number(match[3]);
      const type = isFort ? "fortress" : "tower";
      const team = Number(match[4]);

      let query = supabase
        .from("gvg_defense")
        .update({ group_num: groupNum })
        .eq("guild", guild)
        .eq("bastion", bastion)
        .eq("type", type)
        .eq("team", team);

      if (tower === null) {
        query = query.is("tower", null);
      } else {
        query = query.eq("tower", tower);
      }

      await query;
    }

    return res.json({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
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

async function handlePanelOpen(req, res) {
  const { id } = req.body || {};

  if (!id) {
    return res.status(400).json({ error: "id manquant" });
  }

  const { data: defense, error: readError } = await supabase
    .from("gvg_defense")
    .select("id, record_status")
    .eq("id", id)
    .maybeSingle();

  if (readError) {
    console.error("[gvg-data:panel_open] read error:", readError);
    return res.status(500).json({ error: "read failed" });
  }

  if (!defense) {
    return res.status(404).json({ error: "défense introuvable" });
  }

  if (defense.record_status) {
    return res.status(200).json({
      success: true,
      item: defense,
      already_open: true,
    });
  }

  const { data, error } = await supabase
    .from("gvg_defense")
    .update({
      record_status: "pas_record",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id, record_status")
    .maybeSingle();

  if (error) {
    console.error("[gvg-data:panel_open] update error:", error);
    return res.status(500).json({ error: "update failed" });
  }

  return res.status(200).json({
    success: true,
    item: data,
  });
}

async function handleRecordToggle(req, res) {
  const { id } = req.body || {};

  if (!id) {
    return res.status(400).json({ error: "id manquant" });
  }

  const { data: defense, error: readError } = await supabase
    .from("gvg_defense")
    .select("id, record_status")
    .eq("id", id)
    .maybeSingle();

  if (readError) {
    console.error("[gvg-data:record_toggle] read error:", readError);
    return res.status(500).json({ error: "read failed" });
  }

  if (!defense) {
    return res.status(404).json({ error: "défense introuvable" });
  }

  if (!defense.record_status) {
    return res.status(400).json({ error: "défense non ouverte dans le panel" });
  }

  if (defense.record_status === "record" || defense.record_status === "push") {
    return res.status(400).json({ error: "statut verrouillé" });
  }

  const nextStatus =
    defense.record_status === "a_record" ? "pas_record" : "a_record";

  const { data, error } = await supabase
    .from("gvg_defense")
    .update({
      record_status: nextStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id, record_status")
    .maybeSingle();

  if (error) {
    console.error("[gvg-data:record_toggle] update error:", error);
    return res.status(500).json({ error: "update failed" });
  }

  return res.status(200).json({
    success: true,
    item: data,
  });
}

async function handlePanelUpdateFields(req, res) {
  const { id, record_comment, attack_code } = req.body || {};

  if (!id) {
    return res.status(400).json({ error: "id manquant" });
  }

  const payload = {
    updated_at: new Date().toISOString(),
  };

  if (record_comment !== undefined) {
    payload.record_comment = String(record_comment || "").trim() || null;
  }

  if (attack_code !== undefined) {
    payload.attack_code = String(attack_code || "").trim() || null;
  }

  const { data, error } = await supabase
    .from("gvg_defense")
    .update(payload)
    .eq("id", id)
    .select("id, record_comment, attack_code")
    .maybeSingle();

  if (error) {
    console.error("[gvg-data:panel_update_fields] update error:", error);
    return res.status(500).json({ error: "update failed" });
  }

  if (!data) {
    return res.status(404).json({ error: "défense introuvable" });
  }

  return res.status(200).json({
    success: true,
    item: data,
  });
}

function makeRecordPlanItem(defense) {
  const defKey = makeDefKey(defense);
  const side = defense.is_ally === true ? "ally" : "enemy";

  return {
    id: String(defense.id),
    key: side === "ally" ? `${defKey}_ally` : defKey,
    def_key: defKey,
    side,
    guild: normalizeGuildCode(defense.guild) || String(defense.guild || "").toUpperCase(),
    bastion: Number(defense.bastion),
    type: String(defense.type || ""),
    tower: defense.tower === null || defense.tower === undefined ? null : Number(defense.tower),
    team: Number(defense.team),
    attack_code: defense.attack_code || null,
    record_comment: defense.record_comment || null,
  };
}

async function handleCreateRecordSession(req, res) {
  const body = req.body || {};
  const guild = normalizeGuildCode(body.guild);
  const scope = normalizeRecordScope(body.scope || body.side);
  const sessionId = String(body.session_id || body.sessionId || "").trim();
  const source = String(body.source || "panel").trim() || "panel";

  if (!guild) {
    return res.status(400).json({ error: "guild invalide" });
  }

  if (!scope) {
    return res.status(400).json({ error: "scope invalide: enemy, ally ou both attendu" });
  }

  if (!/^[A-Za-z0-9_-]{12,96}$/.test(sessionId)) {
    return res.status(400).json({ error: "session_id invalide" });
  }

  let query = supabase
    .from("gvg_defense")
    .select(`
      id,
      guild,
      bastion,
      type,
      tower,
      team,
      is_ally,
      record_status,
      record_comment,
      attack_code
    `)
    .eq("guild", guild)
    .eq("record_status", "a_record");

  if (scope === "ally") {
    query = query.eq("is_ally", true);
  } else if (scope === "enemy") {
    query = query.or("is_ally.is.false,is_ally.is.null");
  }

  const { data, error } = await query
    .order("is_ally", { ascending: true })
    .order("bastion", { ascending: true })
    .order("type", { ascending: true })
    .order("tower", { ascending: true, nullsFirst: true })
    .order("team", { ascending: true });

  if (error) {
    console.error("[gvg-data:record_session_create] supabase error:", error);
    return res.status(500).json({ error: "lecture gvg_defense impossible" });
  }

  const items = (data || []).map(makeRecordPlanItem);

  if (!items.length) {
    return res.status(200).json({
      success: true,
      session_id: sessionId,
      guild,
      scope,
      count: 0,
      items: [],
      message: "Aucune defense a record pour cette selection.",
    });
  }

  try {
    const vps = await requestGvgVps("/api/v1/record/sessions", {
      method: "POST",
      body: {
        session_id: sessionId,
        guild,
        side: scope,
        source,
        items,
      },
    });

    return res.status(200).json({
      success: true,
      session_id: sessionId,
      guild,
      scope,
      count: items.length,
      items,
      protocol_url: `paladin-gvg-record://start?guild=${encodeURIComponent(guild)}&side=${encodeURIComponent(scope)}&session=${encodeURIComponent(sessionId)}`,
      vps,
    });
  } catch (error) {
    console.error("[gvg-data:record_session_create] VPS error:", error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "creation session record VPS impossible",
      details: error.data || undefined,
    });
  }
}

async function handleRecordSessions(req, res) {
  const body = req.body || {};
  const guild = normalizeGuildCode(body.guild || req.query?.guild);
  const rawLimit = Number(body.limit || req.query?.limit || 20);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 20;

  if (!guild) {
    return res.status(400).json({ error: "guild invalide" });
  }

  try {
    const params = new URLSearchParams({
      guild,
      limit: String(limit),
    });
    const vps = await requestGvgVps(`/api/v1/record/sessions?${params.toString()}`);
    const sessions = vps?.sessions || [];
    const syncedYoutube = await syncRecordYoutubeLinksFromSessions(guild, sessions);

    return res.status(200).json({
      success: true,
      guild,
      sessions,
      synced_youtube: syncedYoutube,
    });
  } catch (error) {
    console.error("[gvg-data:record_sessions] VPS error:", error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "lecture sessions record VPS impossible",
      details: error.data || undefined,
    });
  }
}

async function syncRecordYoutubeLinksFromSessions(guild, sessions) {
  const normalizedGuild = normalizeGuildCode(guild);
  if (!normalizedGuild) {
    return { updated: 0, candidates: 0, items: [] };
  }

  const candidatesById = new Map();

  for (const session of sessions || []) {
    for (const item of session?.items || []) {
      const id = String(item?.id || item?.defense_id || "").trim();
      const youtubeUrl = String(item?.youtube_url || "").trim();

      if (!id || !youtubeUrl) {
        continue;
      }

      candidatesById.set(id, {
        id,
        youtube_url: youtubeUrl,
        session_id: session?.session_id || null,
        item_key: item?.key || null,
      });
    }
  }

  const results = [];

  for (const item of candidatesById.values()) {
    const { data, error } = await supabase
      .from("gvg_defense")
      .update({
        youtube_url: item.youtube_url,
        record_status: "record",
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id)
      .eq("guild", normalizedGuild)
      .neq("record_status", "push")
      .select("id, youtube_url, record_status")
      .maybeSingle();

    if (error) {
      console.error("[gvg-data:record_youtube_sync] update error:", error);
      throw new Error("erreur synchronisation YouTube");
    }

    if (data) {
      results.push(data);
    }
  }

  return {
    updated: results.length,
    candidates: candidatesById.size,
    items: results,
  };
}

async function handleRecordYoutubeUpload(req, res) {
  const body = req.body || {};
  const guild = normalizeGuildCode(body.guild);
  const sessionId = String(body.session_id || body.sessionId || "").trim() || null;
  const rawLimit = Number(body.limit || 8);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 50)) : 8;

  if (!guild) {
    return res.status(400).json({ error: "guild invalide" });
  }

  try {
    const vps = await requestGvgVps("/api/v1/record/youtube/upload", {
      method: "POST",
      body: {
        guild,
        session_id: sessionId,
        limit,
      },
    });

    const params = new URLSearchParams({
      guild,
      limit: "100",
    });
    const sessionsResponse = await requestGvgVps(`/api/v1/record/sessions?${params.toString()}`);
    const sessions = sessionsResponse?.sessions || [];
    const syncedYoutube = await syncRecordYoutubeLinksFromSessions(guild, sessions);

    return res.status(200).json({
      success: true,
      guild,
      vps,
      sessions,
      synced_youtube: syncedYoutube,
    });
  } catch (error) {
    console.error("[gvg-data:record_youtube_upload] VPS error:", error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "upload YouTube VPS impossible",
      details: error.data || undefined,
    });
  }
}

async function handleRecordOk(req, res) {
  const { guild } = req.body || {};

  if (!isValidGuild(guild)) {
    return res.status(400).json({ error: "guild manquante ou invalide" });
  }

  const normalizedGuild = String(guild).toUpperCase();

  if (!UPLOADED_DIR) {
    return res.status(500).json({
      error: "YOUTUBE_UPLOADED_DIR manquant cote serveur",
    });
  }

  let filenames = [];
  try {
    filenames = fs.readdirSync(UPLOADED_DIR).filter((name) => /\.mp4$/i.test(name));
  } catch (error) {
    console.error("[gvg-data:record_ok] read dir error:", error);
    return res.status(500).json({ error: "impossible de lire le dossier uploaded" });
  }

const { data: defenses, error: readError } = await supabase
  .from("gvg_defense")
  .select("id, guild, bastion, type, tower, team, record_status, youtube_url, is_ally")
  .eq("guild", normalizedGuild)
  .in("record_status", ["pas_record", "a_record", "record"]);

  if (readError) {
    console.error("[gvg-data:record_ok] read defenses error:", readError);
    return res.status(500).json({ error: "erreur lecture gvg_defense" });
  }

  const updates = [];
const usedFiles = new Set();

for (const defense of defenses || []) {
  const defKey =
    defense.type === "fortress"
      ? `b${defense.bastion}_fort_team${defense.team}`
      : `b${defense.bastion}_t${defense.tower}_team${defense.team}`;

  const expectedPrefix = defense.is_ally
    ? `${defKey.toLowerCase()}_ally__`
    : `${defKey.toLowerCase()}__`;

  const matchedFile = filenames.find((name) => {
    const lower = name.toLowerCase();

    if (usedFiles.has(name)) return false;

    return lower.startsWith(expectedPrefix);
  });

  if (!matchedFile) continue;

  const match = matchedFile.match(/__(.+)\.mp4$/i);
  if (!match) continue;

  const videoId = String(match[1] || "").trim();
  if (!videoId) continue;

  usedFiles.add(matchedFile);

  updates.push({
    id: defense.id,
    youtube_url: `https://youtu.be/${videoId}`,
    record_status: "record",
    filename: matchedFile,
  });
}

  if (!updates.length) {
    return res.status(200).json({
      success: true,
      updated: 0,
      deleted: 0,
      items: [],
    });
  }

  const results = [];
  let deletedCount = 0;

  for (const item of updates) {
    const { data, error } = await supabase
      .from("gvg_defense")
 .update({
  youtube_url: item.youtube_url,
  record_status: item.record_status,
  updated_at: new Date().toISOString(),
})
      .eq("id", item.id)
      .select("id, youtube_url, record_status")
      .maybeSingle();

    if (error) {
      console.error("[gvg-data:record_ok] update error:", error);
      return res.status(500).json({ error: "erreur mise à jour record_ok" });
    }

    if (data) {
      results.push(data);

      const filePath = path.join(UPLOADED_DIR, item.filename);

      try {
        fs.unlinkSync(filePath);
        deletedCount += 1;
      } catch (deleteError) {
        console.error("[gvg-data:record_ok] delete file error:", deleteError);
      }
    }
  }

  return res.status(200).json({
    success: true,
    updated: results.length,
    deleted: deletedCount,
    items: results,
  });
}


function makeDefKey(defense) {
  if (defense.type === "fortress") {
    return `b${defense.bastion}_fort_team${defense.team}`;
  }

  return `b${defense.bastion}_t${defense.tower}_team${defense.team}`;
}

function makeStratName(defense) {
  if (defense.type === "fortress") {
    return `B${defense.bastion} Fort - Team ${defense.team}`;
  }

  return `B${defense.bastion} Tower ${defense.tower} - Team ${defense.team}`;
}

function normalizeChampionName(name) {
  if (!name) return null;

  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim() || null;
}

function heroesToSlots(stratId, heroes) {
  const arr = Array.isArray(heroes) ? heroes : [];

  return arr
    .map((hero) => {
      if (!hero || typeof hero !== "object") return null;

      const champion = normalizeChampionName(hero.champion || hero.name);
      if (!champion) return null;

      const position = hero.position ? String(hero.position).toUpperCase().trim() : null;
      const direction = hero.direction ? String(hero.direction).toUpperCase().trim() : null;

      if (!position || !direction) return null;

      return {
        strat_id: stratId,
        champion,
        position,
        direction,
      };
    })
    .filter(Boolean);
}

async function handlePushToBase(req, res) {
  const { guild } = req.body || {};

  if (!isValidGuild(guild)) {
    return res.status(400).json({ error: "guild manquante ou invalide" });
  }

  const normalizedGuild = String(guild).toUpperCase();

  const { data: defenses, error: readError } = await supabase
    .from("gvg_defense")
    .select(`
      id,
      guild,
      bastion,
      type,
      tower,
      team,
      heroes,
      youtube_url,
      record_comment,
      attack_code,
      record_status
    `)
    .eq("guild", normalizedGuild)
    .eq("record_status", "record");

  if (readError) {
    console.error("[gvg-data:push_to_base] read defenses error:", readError);
    return res.status(500).json({ error: "erreur lecture gvg_defense" });
  }

  if (!defenses?.length) {
    return res.status(200).json({
      success: true,
      pushed: 0,
      items: [],
    });
  }

  const results = [];

  for (const defense of defenses) {
    if (!defense.youtube_url) {
      continue;
    }

    const defKey = makeDefKey(defense);
    const stratName = makeStratName(defense);

    const { data: existingStrats, error: existingError } = await supabase
      .from("defence_strat")
      .select("id")
      .eq("def_key", defKey)
      .eq("youtube_url", defense.youtube_url)
      .limit(1);

    if (existingError) {
      console.error("[gvg-data:push_to_base] read defence_strat error:", existingError);
      return res.status(500).json({ error: "erreur lecture defence_strat" });
    }

    let stratId = existingStrats?.[0]?.id || null;

    if (!stratId) {
      const { data: insertedStrat, error: insertStratError } = await supabase
        .from("defence_strat")
        .insert({
          name: stratName,
          commentaire: defense.record_comment || null,
          youtube_url: defense.youtube_url,
          def_key: defKey,
          attack_code: defense.attack_code || null,
        })
        .select("id")
        .single();

      if (insertStratError || !insertedStrat?.id) {
        console.error("[gvg-data:push_to_base] insert defence_strat error:", insertStratError);
        return res.status(500).json({ error: "erreur insertion defence_strat" });
      }

      stratId = insertedStrat.id;
    } else {
      const { error: updateStratError } = await supabase
        .from("defence_strat")
        .update({
          name: stratName,
          commentaire: defense.record_comment || null,
          attack_code: defense.attack_code || null,
        })
        .eq("id", stratId);

      if (updateStratError) {
        console.error("[gvg-data:push_to_base] update defence_strat error:", updateStratError);
        return res.status(500).json({ error: "erreur mise à jour defence_strat" });
      }

      const { error: deleteSlotsError } = await supabase
        .from("defence_slot")
        .delete()
        .eq("strat_id", stratId);

      if (deleteSlotsError) {
        console.error("[gvg-data:push_to_base] delete defence_slot error:", deleteSlotsError);
        return res.status(500).json({ error: "erreur suppression defence_slot" });
      }
    }

    const slots = heroesToSlots(stratId, defense.heroes);

    if (slots.length) {
      const { error: insertSlotsError } = await supabase
        .from("defence_slot")
        .insert(slots);

      if (insertSlotsError) {
        console.error("[gvg-data:push_to_base] insert defence_slot error:", insertSlotsError);
        return res.status(500).json({ error: "erreur insertion defence_slot" });
      }
    }

    const { data: updatedDefense, error: updateDefenseError } = await supabase
      .from("gvg_defense")
      .update({
        record_status: "push",
        updated_at: new Date().toISOString(),
      })
      .eq("id", defense.id)
      .select("id, record_status, youtube_url")
      .maybeSingle();

    if (updateDefenseError) {
      console.error("[gvg-data:push_to_base] update gvg_defense error:", updateDefenseError);
      return res.status(500).json({ error: "erreur update gvg_defense" });
    }

    if (updatedDefense) {
      results.push(updatedDefense);
    }
  }

  return res.status(200).json({
    success: true,
    pushed: results.length,
    items: results,
  });
}

async function handlePanelReturn(req, res) {
  const { id } = req.body || {};

  if (!id) {
    return res.status(400).json({ error: "id manquant" });
  }

  const { data, error } = await supabase
    .from("gvg_defense")
    .update({
      record_status: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id, record_status")
    .maybeSingle();

  if (error) {
    console.error("[gvg-data:panel_return] update error:", error);
    return res.status(500).json({ error: "erreur retour panel" });
  }

  if (!data) {
    return res.status(404).json({ error: "défense introuvable" });
  }

  return res.status(200).json({
    success: true,
    item: data,
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

  if (action === "import_groups") {
    return await handleImportGroups(req, res);
  }

  if (action === "panel_open") {
    return await handlePanelOpen(req, res);
  }

  if (action === "record_toggle") {
    return await handleRecordToggle(req, res);
  }

  if (action === "record_session_create") {
    return await handleCreateRecordSession(req, res);
  }

  if (action === "record_sessions") {
    return await handleRecordSessions(req, res);
  }

if (action === "panel_update_fields") {
  return await handlePanelUpdateFields(req, res);
}

if (action === "record_ok") {
  return await handleRecordOk(req, res);
}

if (action === "record_youtube_upload") {
  return await handleRecordYoutubeUpload(req, res);
}

if (action === "push_to_base") {
  return await handlePushToBase(req, res);
}

if (action === "panel_return") {
  return await handlePanelReturn(req, res);
}

  return res.status(400).json({ error: "action invalide" });
}

    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    console.error("[gvg-data] server error:", err);
    return res.status(500).json({ error: err?.message || "server error" });
  }
}
