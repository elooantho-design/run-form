import React, { useEffect, useMemo, useState } from "react";

const DEFAULT_GUILDS = ["G1", "G2", "G3", "G4", "G5", "G6", "G7"];

function normalizeGuildInput(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 24);
}

function getApiBase() {
  if (typeof window === "undefined") return "";

  const configuredBase = import.meta.env?.VITE_API_BASE_URL;
  if (configuredBase) return configuredBase.replace(/\/$/, "");

  const { hostname } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:3000";
  }

  return "";
}

function parseYoutubeTimeToSeconds(value) {
  if (!value) return 0;

  const raw = String(value).trim().toLowerCase();

  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }

  const match = raw.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  if (!match) return 0;

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);

  return hours * 3600 + minutes * 60 + seconds;
}

function getYoutubeEmbedUrl(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url);

    let videoId = null;
    let startSeconds = 0;

    if (parsed.hostname.includes("youtu.be")) {
      videoId = parsed.pathname.replace("/", "").trim();

      startSeconds =
        parseYoutubeTimeToSeconds(parsed.searchParams.get("t")) ||
        parseYoutubeTimeToSeconds(parsed.searchParams.get("start")) ||
        parseYoutubeTimeToSeconds(parsed.hash.replace(/^#t=/, ""));
    }

    if (
      parsed.hostname.includes("youtube.com") ||
      parsed.hostname.includes("www.youtube.com")
    ) {
      videoId = parsed.searchParams.get("v");

      startSeconds =
        parseYoutubeTimeToSeconds(parsed.searchParams.get("t")) ||
        parseYoutubeTimeToSeconds(parsed.searchParams.get("start")) ||
        parseYoutubeTimeToSeconds(parsed.hash.replace(/^#t=/, ""));
    }

    if (!videoId) return null;

    const embed = new URL(`https://www.youtube.com/embed/${videoId}`);

    if (startSeconds > 0) {
      embed.searchParams.set("start", String(startSeconds));
    }

    return embed.toString();
  } catch {
    return null;
  }
}

function normalizeChampionName(name) {
  if (!name) return null;

  return String(name)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\d+$/, "");
}

function normalizePos(pos) {
  if (!pos) return null;
  return String(pos).trim().toUpperCase();
}

function normalizeDir(dir) {
  if (!dir) return null;

  const d = String(dir).trim().toUpperCase();

  if (["N", "NORD", "NORTH", "↑"].includes(d)) return "N";
  if (["S", "SUD", "SOUTH", "↓"].includes(d)) return "S";
  if (["E", "EST", "EAST", "→"].includes(d)) return "E";
  if (["O", "OUEST", "WEST", "W", "←"].includes(d)) return "O";

  return d;
}

export default function GvgPanelTab() {
  const apiBase = useMemo(() => getApiBase(), []);
  const allowedDiscordId = "931555574846484560";

const session = useMemo(() => {
  if (typeof window === "undefined") return null;

  try {
    return JSON.parse(localStorage.getItem("guildDashboardSession") || "null");
  } catch {
    return null;
  }
}, []);

const canUsePanelActions =
  String(session?.discordId || "") === allowedDiscordId;
const [guild, setGuild] = useState("G1");
const [recordModalOpen, setRecordModalOpen] = useState(false);
const [recordCreating, setRecordCreating] = useState(false);
const [recordSession, setRecordSession] = useState(null);
const [recordSessions, setRecordSessions] = useState([]);
const [recordSessionsLoading, setRecordSessionsLoading] = useState(false);
const [recordSessionsMessage, setRecordSessionsMessage] = useState("");

const [items, setItems] = useState([]);
const enemyItems = useMemo(
  () => items.filter((d) => d.is_ally !== true),
  [items]
);

const allyItems = useMemo(
  () => items.filter((d) => d.is_ally === true),
  [items]
);
const [loading, setLoading] = useState(false);
const [message, setMessage] = useState("");
const [commentModal, setCommentModal] = useState(null);
const [commentValue, setCommentValue] = useState("");
const [attackModal, setAttackModal] = useState(null);
const [attackValue, setAttackValue] = useState("");
const [returnModal, setReturnModal] = useState(null);
const [runsModal, setRunsModal] = useState(null);
const [runs, setRuns] = useState([]);
const [runsLoading, setRunsLoading] = useState(false);

const recordCounts = useMemo(
  () => ({
    enemy: enemyItems.filter((d) => d.record_status === "a_record").length,
    ally: allyItems.filter((d) => d.record_status === "a_record").length,
  }),
  [enemyItems, allyItems]
);

  async function load() {
    try {
      setLoading(true);
      setMessage("");

      const response = await fetch(
        `${apiBase}/api/gvg-data?guild=${encodeURIComponent(guild)}`
      );

      const rawText = await response.text();
      let data = null;

      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        setMessage(`Réponse non JSON gvg-panel-list (${response.status})`);
        setItems([]);
        return;
      }

      if (!response.ok) {
        setMessage(`Erreur chargement panel : ${data?.error || "erreur inconnue"}`);
        setItems([]);
        return;
      }

      const opened = (data?.items || []).filter(
        (d) => d.record_status !== null && d.record_status !== undefined
      );

      setItems(opened);
    } catch (error) {
      console.error("load panel error:", error);
      setMessage(`Erreur chargement panel : ${error?.message || "erreur inconnue"}`);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadRecordSessions({ silent = false } = {}) {
    try {
      setRecordSessionsLoading(true);
      if (!silent) setRecordSessionsMessage("");

      const response = await fetch(`${apiBase}/api/gvg-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "record_sessions",
          guild,
          limit: 12,
        }),
      });

      const rawText = await response.text();
      let data = null;

      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        setRecordSessionsMessage(`Reponse non JSON records VPS (${response.status})`);
        setRecordSessions([]);
        return;
      }

      if (!response.ok) {
        setRecordSessionsMessage(data?.error || "Erreur suivi records VPS");
        setRecordSessions([]);
        return;
      }

      setRecordSessions(data?.sessions || []);
      if (!silent) {
        setRecordSessionsMessage(`Suivi record VPS a jour pour ${guild}.`);
      }
    } catch (error) {
      console.error("loadRecordSessions error:", error);
      setRecordSessionsMessage(`Erreur suivi records VPS : ${error?.message || "erreur inconnue"}`);
      setRecordSessions([]);
    } finally {
      setRecordSessionsLoading(false);
    }
  }

  useEffect(() => {
    load();
    loadRecordSessions({ silent: true });
  }, [guild]);

function makeRecordSessionId() {
  const random = Math.random().toString(36).slice(2, 10);
  return `record_${Date.now()}_${random}`;
}

function getRecordScopeCount(scope) {
  if (scope === "enemy") return recordCounts.enemy;
  if (scope === "ally") return recordCounts.ally;
  return recordCounts.enemy + recordCounts.ally;
}

function getRecordScopeLabel(scope) {
  if (scope === "enemy") return "defenses ennemies";
  if (scope === "ally") return "defenses alliees";
  return "defenses ennemies + alliees";
}

async function createRecordLauncherSession(scope) {
  if (!canUsePanelActions || recordCreating) return;

  const count = getRecordScopeCount(scope);
  if (!count) {
    setRecordSession(null);
    setMessage(`Aucune defense a record pour ${getRecordScopeLabel(scope)}.`);
    return;
  }

  try {
    setRecordCreating(true);
    setRecordSession(null);
    setMessage("");

    const sessionId = makeRecordSessionId();
    const response = await fetch(`${apiBase}/api/gvg-data`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "record_session_create",
        guild,
        scope,
        session_id: sessionId,
        source: typeof window !== "undefined" && window.location?.pathname?.includes("portal")
          ? "portal"
          : "dashboard",
      }),
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setMessage(`Reponse non JSON session record (${response.status})`);
      return;
    }

    if (!response.ok) {
      setMessage(data?.error || "Erreur creation session record");
      return;
    }

    if (!data?.count) {
      setMessage(data?.message || "Aucune defense a record pour cette selection.");
      return;
    }

    setRecordSession(data);
    setMessage(`Session record prete: ${data.count} defense(s) pour ${getRecordScopeLabel(scope)}.`);
    loadRecordSessions({ silent: true });
  } catch (error) {
    console.error("createRecordLauncherSession error:", error);
    setMessage(`Erreur session record : ${error?.message || "erreur inconnue"}`);
  } finally {
    setRecordCreating(false);
  }
}

function launchRecordProtocol() {
  if (!recordSession?.protocol_url) return;
  window.location.href = recordSession.protocol_url;
}

function makeDefenseRecordKey(defense) {
  if (!defense) return "";

  const base =
    defense.type === "fortress"
      ? `b${defense.bastion}_fort_team${defense.team}`
      : `b${defense.bastion}_t${defense.tower}_team${defense.team}`;

  return defense.is_ally === true ? `${base}_ally` : base;
}

const recordUploadsByKey = useMemo(() => {
  const map = new Map();

  for (const session of recordSessions || []) {
    const sessionTime = Date.parse(session?.updated_at || session?.created_at || "") || 0;

    for (const item of session?.items || []) {
      const key = String(item?.key || item?.def_key || "").toLowerCase();
      const defenseId = String(item?.id || item?.defense_id || "").toLowerCase();
      if (!key && !defenseId) continue;

      const itemTime =
        Date.parse(item?.uploaded_at || session?.updated_at || session?.created_at || "") ||
        sessionTime;
      const mapKeys = [
        defenseId ? `id:${defenseId}` : "",
        key ? `key:${key}` : "",
      ].filter(Boolean);

      for (const mapKey of mapKeys) {
        const current = map.get(mapKey);

        if (!current || itemTime >= current.time) {
          map.set(mapKey, { item, session, time: itemTime });
        }
      }
    }
  }

  return map;
}, [recordSessions]);

const recordVpsStats = useMemo(() => {
  const sessions = recordSessions || [];
  let total = 0;
  let uploaded = 0;
  let pending = 0;

  for (const session of sessions) {
    const counts = session?.counts || {};
    total += Number(counts.total || 0);
    uploaded += Number(counts.uploaded || 0);
    pending += Number(counts.pending || 0);
  }

  return { sessions: sessions.length, total, uploaded, pending };
}, [recordSessions]);

function getDefenseRecordState(defense) {
  if (!defense) return null;

  const key = makeDefenseRecordKey(defense).toLowerCase();
  const defenseId = String(defense.id || "").toLowerCase();
  const upload =
    (defenseId ? recordUploadsByKey.get(`id:${defenseId}`) : null) ||
    recordUploadsByKey.get(`key:${key}`);

  if (defense.record_status === "push") {
    return {
      label: "Push base",
      title: "La defense a ete envoyee dans la base definitive.",
      badgeClass: "border-purple-400 bg-purple-500/15 text-purple-100",
      cardClass: "border-purple-400/70 bg-purple-500/10",
    };
  }

  if (defense.record_status === "record") {
    return {
      label: "Lien YouTube OK",
      title: "La video est liee a la defense.",
      badgeClass: "border-emerald-400 bg-emerald-500/15 text-emerald-100",
      cardClass: "border-emerald-500/70 bg-emerald-500/10",
    };
  }

  if (defense.record_status === "a_record" && upload?.item?.status === "uploaded") {
    return {
      label: "Video VPS recue",
      title: `Video recue par le VPS (${upload.session?.session_id || "session record"}).`,
      badgeClass: "border-cyan-400 bg-cyan-500/15 text-cyan-100",
      cardClass: "border-cyan-400/70 bg-cyan-500/10",
    };
  }

  if (defense.record_status === "a_record") {
    return {
      label: "A record",
      title: "Cette defense est dans le prochain plan record.",
      badgeClass: "border-amber-400 bg-amber-500/15 text-amber-100",
      cardClass: "border-amber-500/60 bg-amber-500/10",
    };
  }

  if (defense.record_status === "pas_record") {
    return {
      label: "Pas record",
      title: "Cette defense est ouverte dans le panel mais pas demandee en record.",
      badgeClass: "border-zinc-600 bg-zinc-800/60 text-zinc-300",
      cardClass: "border-zinc-800 bg-zinc-950/60",
    };
  }

  return {
    label: "A ouvrir",
    title: "Clique la ligne pour ouvrir cette defense dans le panel.",
    badgeClass: "border-zinc-700 bg-zinc-900/60 text-zinc-400",
    cardClass: "border-zinc-800 bg-zinc-950/60",
  };
}
  function buildSlotLabel(bastion, type, tower, team) {
    if (type === "fortress") {
      return `B${bastion}_F_T${team}`;
    }

    return `B${bastion}_T${tower}_T${team}`;
  }

function getGroupEmoji(groupNum) {
  const value = Number(groupNum);

  if (!Number.isFinite(value) || value <= 0) return "";

  const map = {
    1: "1️⃣",
    2: "2️⃣",
    3: "3️⃣",
    4: "4️⃣",
    5: "5️⃣",
    6: "6️⃣",
    7: "7️⃣",
    8: "8️⃣",
    9: "9️⃣",
    10: "🔟",
  };

  return map[value] || "🔢";
}

            function getDefenseForSlot(sourceItems, bastion, type, tower, team) {
            return (
                sourceItems.find(
                (d) =>
                    Number(d.bastion) === Number(bastion) &&
                    d.type === type &&
                    Number(d.team) === Number(team) &&
                    (type === "fortress" || Number(d.tower) === Number(tower))
                ) || null
            );
            }
  async function toggleRecord(defense) {
  try {
    const response = await fetch(`${apiBase}/api/gvg-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: defense.id,
        action: "record_toggle",
      }),
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setMessage("Erreur réponse toggle");
      return;
    }

    if (!response.ok) {
      setMessage(data?.error || "Erreur toggle");
      return;
    }

    load(); // refresh
  } catch (e) {
    console.error(e);
    setMessage("Erreur toggle");
  }
}

function openCommentModal(defense) {
  setCommentModal(defense);
  setCommentValue(defense.record_comment || "");
}

function openAttackModal(defense) {
  setAttackModal(defense);
  setAttackValue(defense.attack_code || "");
}

function openReturnModal(defense) {
  setReturnModal(defense);
}

async function saveComment() {
  if (!commentModal) return;

  try {
    const response = await fetch(`${apiBase}/api/gvg-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: commentModal.id,
        action: "panel_update_fields",
        record_comment: commentValue,
      }),
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setMessage("Erreur JSON commentaire");
      return;
    }

    if (!response.ok) {
      setMessage(data?.error || "Erreur sauvegarde commentaire");
      return;
    }

    setCommentModal(null);
    load();
  } catch (e) {
    console.error(e);
    setMessage("Erreur commentaire");
  }
}

async function saveAttackCode() {
  if (!attackModal) return;

  try {
    const response = await fetch(`${apiBase}/api/gvg-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: attackModal.id,
        action: "panel_update_fields",
        attack_code: attackValue,
      }),
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setMessage("Erreur JSON code d'attaque");
      return;
    }

    if (!response.ok) {
      setMessage(data?.error || "Erreur sauvegarde code d'attaque");
      return;
    }

    setAttackModal(null);
    load();
  } catch (e) {
    console.error(e);
    setMessage("Erreur code d'attaque");
  }
}

function buildAhkCommand() {
  if (!canUsePanelActions) return;

  const selectedEnemy = enemyItems
    .filter((d) => d.record_status === "a_record")
    .sort((a, b) => {
      if (a.bastion !== b.bastion) return a.bastion - b.bastion;
      if (a.type !== b.type) return a.type === "tower" ? -1 : 1;
      if ((a.tower || 0) !== (b.tower || 0)) return (a.tower || 0) - (b.tower || 0);
      return a.team - b.team;
    });

  const selectedAlly = allyItems
    .filter((d) => d.record_status === "a_record")
    .sort((a, b) => {
      if (a.bastion !== b.bastion) return a.bastion - b.bastion;
      if (a.type !== b.type) return a.type === "tower" ? -1 : 1;
      if ((a.tower || 0) !== (b.tower || 0)) return (a.tower || 0) - (b.tower || 0);
      return a.team - b.team;
    });

  if (!selectedEnemy.length && !selectedAlly.length) {
    setMessage("Aucune défense à record");
    return;
  }

  const enemyShots = selectedEnemy
    .map((d) => {
      if (d.type === "fortress") {
        return `b${d.bastion}_fort_team${d.team}`;
      }
      return `b${d.bastion}_t${d.tower}_team${d.team}`;
    })
    .join("|");

  const allyShots = selectedAlly
    .map((d) => {
      if (d.type === "fortress") {
        return `b${d.bastion}_fort_team${d.team}`;
      }
      return `b${d.bastion}_t${d.tower}_team${d.team}`;
    })
    .join("|");

  let command = `& "C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe" \`
  "C:\\Users\\athon\\OneDrive\\Bureau\\Bot Zizi\\Bot-Paladin\\record_run_with_req.ahk"`;

  if (enemyShots) {
    command += ` \`\n  --shots "${enemyShots}"`;
  }

  if (allyShots) {
    command += ` \`\n  --ally-shots "${allyShots}"`;
  }

  navigator.clipboard.writeText(command);
  setMessage("Commande copiée !");
}

async function markRecordOk() {
    if (!canUsePanelActions) return;
  try {
    setMessage("");

    const response = await fetch(`${apiBase}/api/gvg-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "record_ok",
        guild,
      }),
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setMessage(`Réponse non JSON record_ok (${response.status})`);
      return;
    }

    if (!response.ok) {
      setMessage(data?.error || "Erreur Record OK");
      return;
    }

    setMessage(`${data?.updated || 0} défense(s) passée(s) en record`);
    load();
  } catch (error) {
    console.error("markRecordOk error:", error);
    setMessage(`Erreur Record OK : ${error?.message || "erreur inconnue"}`);
  }
}

async function pushToBase() {
    if (!canUsePanelActions) return;
  try {
    setMessage("");

    const response = await fetch(`${apiBase}/api/gvg-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "push_to_base",
        guild,
      }),
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setMessage(`Réponse non JSON push_to_base (${response.status})`);
      return;
    }

    if (!response.ok) {
      setMessage(data?.error || "Erreur Push en base");
      return;
    }

    setMessage(`${data?.pushed || 0} défense(s) poussée(s) en base`);
    load();
  } catch (error) {
    console.error("pushToBase error:", error);
    setMessage(`Erreur Push en base : ${error?.message || "erreur inconnue"}`);
  }
}

async function confirmReturnToCurrent() {
  if (!returnModal) return;

  try {
    setMessage("");

    const response = await fetch(`${apiBase}/api/gvg-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "panel_return",
        id: returnModal.id,
      }),
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setMessage(`Réponse non JSON panel_return (${response.status})`);
      return;
    }

    if (!response.ok) {
      setMessage(data?.error || "Erreur retour vers GVG en cours");
      return;
    }

    setReturnModal(null);
    setMessage("Défense renvoyée dans GVG en cours");
    load();
  } catch (error) {
    console.error("confirmReturnToCurrent error:", error);
    setMessage(`Erreur retour GVG : ${error?.message || "erreur inconnue"}`);
  }
}

async function openRuns(defense) {
  if (!defense) return;

  try {
    setRunsLoading(true);
    setRunsModal(defense);
    setRuns([]);

const queryItems = Array.isArray(defense.heroes)
  ? defense.heroes
      .map((hero) => ({
        champion: normalizeChampionName(hero?.champion),
        position: normalizePos(hero?.position),
        direction: normalizeDir(hero?.direction),
      }))
      .filter(
        (item) => item.champion && item.position && item.direction
      )
  : [];

    if (!queryItems.length) {
      setRuns([]);
      return;
    }

const response = await fetch(`${apiBase}/api/run?action=search`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ queryItems }),
});

const rawText = await response.text();
let data = null;

console.log("run-search status:", response.status);
console.log("run-search rawText:", rawText);

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      console.error("Réponse non JSON run-search:", rawText);
      setRuns([]);
      return;
    }
console.log("run-search parsed data:", data);
    if (!response.ok) {
      console.error("run-search error:", data);
      setRuns([]);
      return;
    }

    setRuns(Array.isArray(data) ? data : []);
  } catch (e) {
    console.error("openRuns error:", e);
    setRuns([]);
  } finally {
    setRunsLoading(false);
  }
}

const handleDeleteStrat = async (run) => {
  const stratId = run?.strat_id;

  if (!stratId) {
    console.error("Suppression impossible: strat_id manquant", run);
    return;
  }

  const confirmDelete = window.confirm(
    `Supprimer la strat #${stratId} ?`
  );

  if (!confirmDelete) return;

  try {
    await fetch(`${apiBase}/api/delete-strat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: stratId }),
    });

    setRuns((prev) => prev.filter((r) => r.strat_id !== stratId));
  } catch (err) {
    console.error("Erreur suppression strat:", err);
  }
};

function renderPanelGrid(sourceItems, panelKey, wrapperClass, titleClass) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
      {[1, 2, 3, 4].map((bastion) => (
        <div
          key={`${panelKey}-${bastion}`}
          className={wrapperClass}
        >
          <div className={`mb-3 text-sm font-semibold ${titleClass}`}>
            Bastion {bastion}
          </div>

          <div className="space-y-2">
            {[
              { type: "fortress", tower: null, team: 1 },
              { type: "fortress", tower: null, team: 2 },
              ...[1, 2, 3, 4, 5].flatMap((tower) =>
                [1, 2].map((team) => ({
                  type: "tower",
                  tower,
                  team,
                }))
              ),
            ].map((slot, index) => {
              const defense = getDefenseForSlot(
                sourceItems,
                bastion,
                slot.type,
                slot.tower,
                slot.team
              );
              const recordState = getDefenseRecordState(defense);

              return (
                <div
                  key={`${panelKey}-${bastion}-${slot.type}-${slot.tower ?? "F"}-${slot.team}-${index}`}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2 transition ${
                    recordState?.cardClass || "border-zinc-800 bg-zinc-950/60"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => defense && openReturnModal(defense)}
                    className={`flex min-w-0 flex-col items-start gap-1 text-left text-xs ${
                      defense
                        ? "text-zinc-100 underline underline-offset-4 hover:text-white"
                        : "text-zinc-200"
                    }`}
                    disabled={!defense}
                    title={defense ? "Renvoyer dans GVG en cours" : ""}
                  >
                    <span className="flex items-center gap-2">
                      <span>{buildSlotLabel(bastion, slot.type, slot.tower, slot.team)}</span>
                      {defense?.group_num ? (
                        <span className="no-underline">{getGroupEmoji(defense.group_num)}</span>
                      ) : null}
                    </span>
                    {defense && recordState ? (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide no-underline ${recordState.badgeClass}`}
                        title={recordState.title}
                      >
                        {recordState.label}
                      </span>
                    ) : null}
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    {!defense ? (
                      <span className="text-xs text-zinc-600">—</span>
                    ) : (
                      <>
                        <button
                          onClick={() => toggleRecord(defense)}
                          className={`flex h-7 min-w-8 items-center justify-center rounded-full border px-2 text-[10px] font-semibold transition ${
                            defense.record_status === "a_record"
                              ? "border-green-500 bg-green-500/15"
                              : defense.record_status === "pas_record"
                              ? "border-red-500 bg-red-500/15"
                              : "border-zinc-600 bg-zinc-800/40 cursor-not-allowed opacity-60"
                          }`}
                          disabled={
                            defense.record_status === "record" ||
                            defense.record_status === "push"
                          }
                          title="Basculer a record / pas record"
                        >
                          📹
                        </button>

                        <button
                          onClick={() => openCommentModal(defense)}
                          className={`flex h-7 min-w-8 items-center justify-center rounded-full border px-2 text-[10px] font-semibold transition ${
                            defense.record_comment
                              ? "border-green-500 bg-green-500/15"
                              : "border-red-500 bg-red-500/15"
                          }`}
                          title="Commentaire"
                        >
                          💬
                        </button>

                        <button
                          onClick={() => openAttackModal(defense)}
                          className={`flex h-7 min-w-10 items-center justify-center rounded-full border px-2 text-[10px] font-semibold transition ${
                            defense.attack_code
                              ? "border-green-500 bg-green-500/15"
                              : "border-red-500 bg-red-500/15"
                          }`}
                          title="Code d'attaque"
                        >
                          ⚔️
                        </button>

                        <button
                          type="button"
                          className={`flex h-7 min-w-8 items-center justify-center rounded-full border px-2 text-[10px] font-semibold transition cursor-default ${
                            defense.record_status === "record" || defense.record_status === "push"
                              ? "border-green-500 bg-green-500/15"
                              : "border-red-500 bg-red-500/15"
                          }`}
                          title="Statut record"
                        >
                          ✅
                        </button>

                        <button
                          onClick={() => openRuns(defense)}
                          className={`flex h-7 min-w-8 items-center justify-center rounded-full border px-2 text-[10px] font-semibold transition ${
                            defense.status === "strat" || defense.record_status === "push"
                              ? "border-green-500 bg-green-500/15 hover:scale-110 cursor-pointer"
                              : "border-red-500 bg-red-500/15 opacity-50 cursor-not-allowed"
                          }`}
                          disabled={!(defense.status === "strat" || defense.record_status === "push")}
                          title="Voir les runs"
                        >
                          👍
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

  return (
    <div className="space-y-4">
<div className="flex flex-wrap items-center gap-2">
  {DEFAULT_GUILDS.map((item) => (
    <button
      key={item}
      onClick={() => setGuild(item)}
      className={`px-3 py-1 rounded ${
        guild === item ? "bg-white text-black" : "bg-zinc-800 text-white"
      }`}
    >
      {item}
    </button>
  ))}

  <input
    value={guild}
    onChange={(event) => setGuild(normalizeGuildInput(event.target.value))}
    className="w-24 rounded border border-zinc-700 bg-zinc-950 px-3 py-1 text-sm uppercase text-white outline-none focus:border-cyan-400"
    placeholder="MAD"
    title="Code guilde"
  />

<button
  onClick={() => {
    setRecordSession(null);
    setRecordModalOpen(true);
  }}
  disabled={!canUsePanelActions}
  className={`rounded px-3 py-1 text-sm text-white ${
    canUsePanelActions
      ? "bg-cyan-600 hover:bg-cyan-500"
      : "cursor-not-allowed bg-zinc-700 opacity-50"
  }`}
>
  Lancer record
</button>

<button
  onClick={buildAhkCommand}
  disabled={!canUsePanelActions}
  className={`rounded px-3 py-1 text-sm text-white ${
    canUsePanelActions
      ? "bg-green-600"
      : "cursor-not-allowed bg-zinc-700 opacity-50"
  }`}
>
  Cmd record locale
</button>

<button
  onClick={markRecordOk}
  disabled={!canUsePanelActions}
  className={`rounded px-3 py-1 text-sm text-white ${
    canUsePanelActions
      ? "bg-blue-600"
      : "cursor-not-allowed bg-zinc-700 opacity-50"
  }`}
>
  ✅ Record OK
</button>

<button
  onClick={pushToBase}
  disabled={!canUsePanelActions}
  className={`rounded px-3 py-1 text-sm text-white ${
    canUsePanelActions
      ? "bg-amber-600"
      : "cursor-not-allowed bg-zinc-700 opacity-50"
  }`}
>
  📦 Push en base
</button>
</div>

      {message ? (
        <div className="text-sm text-red-400">{message}</div>
      ) : null}

      {loading && <div>Chargement…</div>}

      <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold uppercase tracking-wide text-cyan-100">
              Suivi record VPS
            </div>
            <div className="mt-1 text-xs text-zinc-400">
              Parcours normal : marque les defenses en A record, lance le record, attends le message de fin,
              puis rafraichis ce suivi.
            </div>
          </div>

          <button
            type="button"
            onClick={() => loadRecordSessions()}
            disabled={recordSessionsLoading}
            className="rounded-lg border border-cyan-500/40 px-3 py-1 text-xs font-semibold text-cyan-100 hover:border-cyan-300 disabled:opacity-50"
          >
            {recordSessionsLoading ? "Rafraichissement..." : "Rafraichir records VPS"}
          </button>
        </div>

        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-zinc-500">A record</div>
            <div className="text-lg font-semibold text-amber-200">
              {recordCounts.enemy + recordCounts.ally}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-zinc-500">Sessions VPS</div>
            <div className="text-lg font-semibold text-cyan-100">{recordVpsStats.sessions}</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-zinc-500">Videos recues</div>
            <div className="text-lg font-semibold text-emerald-200">
              {recordVpsStats.uploaded}/{recordVpsStats.total}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-zinc-500">Encore attendues</div>
            <div className="text-lg font-semibold text-zinc-200">{recordVpsStats.pending}</div>
          </div>
        </div>

        {recordSessionsMessage ? (
          <div className="mt-2 text-xs text-cyan-200">{recordSessionsMessage}</div>
        ) : null}

        {recordSessions.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {recordSessions.slice(0, 4).map((session) => (
              <div
                key={session.session_id}
                className="rounded-full border border-zinc-700 bg-zinc-950/70 px-3 py-1 text-xs text-zinc-300"
                title={session.session_id}
              >
                {session.side || "record"} - {session.counts?.uploaded || 0}/{session.counts?.total || 0} videos
              </div>
            ))}
          </div>
        ) : null}
      </div>

{!loading && !message && (
  <>
    <div className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-400">
      Défenses adverses
    </div>

    {renderPanelGrid(
      enemyItems,
      "enemy",
      "rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4",
      "text-zinc-100"
    )}

    <div className="mt-10 mb-4 rounded-2xl border-2 border-red-500 bg-red-500/5 p-4 text-center">
      <div className="text-sm font-semibold uppercase tracking-[0.2em] text-red-400">
        Défenses alliées
      </div>
    </div>

    {renderPanelGrid(
      allyItems,
      "ally",
      "rounded-2xl border border-red-500/30 bg-red-500/5 p-4",
      "text-red-200"
    )}
  </>
)}
      {recordModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-cyan-500/40 bg-zinc-950 p-5 shadow-[0_0_30px_rgba(34,211,238,0.18)]">
            <div className="mb-1 text-lg font-semibold text-white">Lancer un record GVG</div>
            <div className="mb-4 text-sm text-zinc-400">
              Guilde {guild}. Le plan sera limite a cette guilde et aux defenses marquees a record.
            </div>

            <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 text-xs text-zinc-300">
              <div className="mb-2 font-semibold uppercase tracking-wide text-cyan-100">
                Ce que le joueur doit faire
              </div>
              <ol className="list-decimal space-y-1 pl-4">
                <li>Choisir Ennemies, Alliees ou Les deux selon le record demande.</li>
                <li>Cliquer sur Ouvrir le launcher record et accepter l'autorisation Windows.</li>
                <li>Ne pas toucher a la souris pendant le record.</li>
                <li>Quand le launcher annonce la fin, revenir ici et cliquer sur Rafraichir records VPS.</li>
              </ol>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {[
                ["enemy", "Ennemies", recordCounts.enemy],
                ["ally", "Alliees", recordCounts.ally],
                ["both", "Les deux", recordCounts.enemy + recordCounts.ally],
              ].map(([scope, label, count]) => (
                <button
                  key={scope}
                  type="button"
                  onClick={() => createRecordLauncherSession(scope)}
                  disabled={!canUsePanelActions || recordCreating || count === 0}
                  className={`rounded-xl border px-4 py-3 text-left transition ${
                    count > 0 && canUsePanelActions
                      ? "border-cyan-500/40 bg-cyan-500/10 hover:border-cyan-300"
                      : "border-zinc-800 bg-zinc-900/70 opacity-50"
                  }`}
                >
                  <div className="text-sm font-semibold text-white">{label}</div>
                  <div className="text-xs text-zinc-400">{count} defense(s) a record</div>
                </button>
              ))}
            </div>

            {recordCreating ? (
              <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm text-zinc-300">
                Creation de la session record sur le VPS...
              </div>
            ) : null}

            {recordSession ? (
              <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                <div className="font-semibold">Session creee</div>
                <div>{recordSession.count} defense(s) dans le plan {recordSession.scope}.</div>
                <div className="mt-1 break-all text-xs text-emerald-200/80">{recordSession.session_id}</div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={launchRecordProtocol}
                    className="rounded bg-emerald-600 px-3 py-1 text-sm text-white hover:bg-emerald-500"
                  >
                    Ouvrir le launcher record
                  </button>
                  <a
                    href={`${apiBase}/api/gvg-server?action=record-launcher-download`}
                    className="rounded border border-emerald-500/40 px-3 py-1 text-sm text-emerald-100 hover:border-emerald-300"
                  >
                    Telecharger / installer
                  </a>
                </div>
                <div className="mt-2 text-xs text-emerald-200/70">
                  Si rien ne s'ouvre, installe le launcher record une fois, puis reclique sur ouvrir.
                  A la fin du record, ferme le message du launcher et clique sur Rafraichir records VPS dans le panel.
                </div>
              </div>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRecordModalOpen(false)}
                className="rounded bg-zinc-800 px-3 py-1 text-sm text-white hover:bg-zinc-700"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {commentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-4">
            <div className="mb-2 text-sm text-zinc-200">
              Commentaire · {buildSlotLabel(
                commentModal.bastion,
                commentModal.type,
                commentModal.tower,
                commentModal.team
              )}
            </div>

            <textarea
              value={commentValue}
              onChange={(e) => setCommentValue(e.target.value)}
              className="h-28 w-full rounded bg-zinc-800 p-2 text-sm text-white outline-none"
              placeholder="Saisis ton commentaire..."
            />

            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setCommentModal(null)}
                className="rounded bg-zinc-700 px-3 py-1 text-sm text-white"
              >
                Annuler
              </button>

              <button
                onClick={saveComment}
                className="rounded bg-green-600 px-3 py-1 text-sm text-white"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

          {attackModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-4">
            <div className="mb-2 text-sm text-zinc-200">
              Code d'attaque · {buildSlotLabel(
                attackModal.bastion,
                attackModal.type,
                attackModal.tower,
                attackModal.team
              )}
            </div>

            <textarea
              value={attackValue}
              onChange={(e) => setAttackValue(e.target.value)}
              className="h-28 w-full rounded bg-zinc-800 p-2 text-sm text-white outline-none"
              placeholder="Saisis le code d'attaque..."
            />

            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setAttackModal(null)}
                className="rounded bg-zinc-700 px-3 py-1 text-sm text-white"
              >
                Annuler
              </button>

              <button
                onClick={saveAttackCode}
                className="rounded bg-green-600 px-3 py-1 text-sm text-white"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {returnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-4">
            <div className="mb-2 text-sm text-zinc-200">
              Renvoyer dans GVG en cours
            </div>

            <div className="text-sm text-zinc-300">
              Veux-tu renvoyer la défense{" "}
              <span className="font-semibold text-white">
                {buildSlotLabel(
                  returnModal.bastion,
                  returnModal.type,
                  returnModal.tower,
                  returnModal.team
                )}
              </span>{" "}
              dans GVG en cours ?
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setReturnModal(null)}
                className="rounded bg-zinc-700 px-3 py-1 text-sm text-white"
              >
                Annuler
              </button>

              <button
                onClick={confirmReturnToCurrent}
                className="rounded bg-red-600 px-3 py-1 text-sm text-white"
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}

      {runsModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 p-4">
          <div className="flex min-h-full items-start justify-center py-6">
            <div className="w-full max-w-4xl rounded-xl border border-zinc-700 bg-zinc-900 p-4">
              <div className="mb-3 text-sm text-zinc-200">
                Runs · {buildSlotLabel(
                  runsModal.bastion,
                  runsModal.type,
                  runsModal.tower,
                  runsModal.team
                )}
              </div>

              {runsLoading ? (
                <div className="text-zinc-400">Chargement...</div>
              ) : runs.length === 0 ? (
                <div className="text-zinc-500">Aucun run trouvé</div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {runs.map((run, i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-zinc-700 bg-zinc-800/60 p-3"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-semibold text-white">
                        Strat #{run.strat_id}
                        </span>

                        <button
                          onClick={() => handleDeleteStrat(run)}
                          className="rounded bg-red-600 px-2 py-1 text-xs hover:bg-red-700"
                        >
                          Supprimer
                        </button>
                      </div>

                      <div className="w-full aspect-video overflow-hidden rounded-xl border border-zinc-800">
                        <iframe
                          src={getYoutubeEmbedUrl(run.youtube_url)}
                          className="h-full w-full"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                          allowFullScreen
                          loading="lazy"
                          referrerPolicy="strict-origin-when-cross-origin"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => setRunsModal(null)}
                  className="rounded bg-zinc-700 px-3 py-1 text-sm text-white"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
