import React, { useEffect, useMemo, useState } from "react";
import { Ban, Pencil, Trash2 } from "lucide-react";
import {
  getGuildSpaceKey,
  getGvgGuildLabel,
  getSessionGuildCode,
  getVisibleGvgGuildCodes,
  isExternalRunGuildCode,
  isPaladinAdminSession,
  isPaladinGuildCode,
  isPaladinSession,
} from "@/lib/guildScope";
import { usePortalLanguage } from "@/lib/portalLanguage";
import { buildPublicDownloadUrl } from "@/lib/vpsAssets";

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

function getRunSessionPayload(session) {
  return {
    memberId: session?.memberId || session?.member_id || session?.id || "",
    discordId: session?.discordId || session?.discord_id || "",
    guildCode: session?.guildCode || session?.guild_code || session?.guild || "G1",
    role: session?.role || "",
  };
}

function formatTranslation(t, key, fallback, values = {}) {
  let text = t(key, fallback);

  Object.entries(values).forEach(([name, value]) => {
    text = text.replaceAll(`{${name}}`, String(value ?? ""));
  });

  return text;
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

export default function GvgPanelTab({ session: portalSession, onEditRun } = {}) {
  const { language, t } = usePortalLanguage();
  const apiBase = useMemo(() => getApiBase(), []);
  const dashboardSession = useMemo(() => {
    if (typeof window === "undefined") return null;

    try {
      return JSON.parse(localStorage.getItem("guildDashboardSession") || "null");
    } catch {
      return null;
    }
  }, []);
  const session = portalSession || dashboardSession;
  const visibleGuilds = useMemo(() => getVisibleGvgGuildCodes(session), [session]);
  const showExternalRunAlerts = useMemo(() => isPaladinAdminSession(session), [session]);
  const canUseCustomGuildInput = isPaladinSession(session);

  const sessionRole = String(session?.role || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const canUsePanelActions =
    session?.isAdmin === true ||
    session?.admin === true ||
    sessionRole.includes("admin") ||
    sessionRole.includes("administrateur") ||
    sessionRole.includes("leader");
const [guild, setGuild] = useState("G1");
const [recordModalOpen, setRecordModalOpen] = useState(false);
const [recordCreating, setRecordCreating] = useState(false);
const [recordSession, setRecordSession] = useState(null);
const [recordSessions, setRecordSessions] = useState([]);
const [recordSessionsLoading, setRecordSessionsLoading] = useState(false);
const [recordSessionsMessage, setRecordSessionsMessage] = useState("");
const [groupCalc, setGroupCalc] = useState(null);
const [groupCalculating, setGroupCalculating] = useState(false);

const [items, setItems] = useState([]);
const [recordTogglingIds, setRecordTogglingIds] = useState(() => new Set());
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

useEffect(() => {
  if (visibleGuilds.length === 0) return;
  setGuild((current) => (visibleGuilds.includes(current) ? current : visibleGuilds[0]));
}, [visibleGuilds]);

const recordCounts = useMemo(
  () => ({
    enemy: enemyItems.filter((d) => d.record_status === "a_record").length,
    ally: allyItems.filter((d) => d.record_status === "a_record").length,
  }),
  [enemyItems, allyItems]
);

  async function load() {
    if (!visibleGuilds.includes(guild)) return;

    try {
      setLoading(true);
      setMessage("");

      const params = new URLSearchParams({ guild });

      Object.entries(getRunSessionPayload(session)).forEach(([key, value]) => {
        if (value) params.set(key, String(value));
      });

      const response = await fetch(`${apiBase}/api/gvg-data?${params.toString()}`);

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
        return [];
      }

      if (!response.ok) {
        setRecordSessionsMessage(data?.error || "Erreur suivi records VPS");
        setRecordSessions([]);
        return [];
      }

      const sessions = data?.sessions || [];
      setRecordSessions(sessions);
      if (!silent) {
        setRecordSessionsMessage("Suivi record VPS rafraichi.");
      }
      return sessions;
    } catch (error) {
      console.error("loadRecordSessions error:", error);
      setRecordSessionsMessage(`Erreur suivi records VPS : ${error?.message || "erreur inconnue"}`);
      setRecordSessions([]);
      return [];
    } finally {
      setRecordSessionsLoading(false);
    }
  }

  useEffect(() => {
    setGroupCalc(null);
    load();
    loadRecordSessions({ silent: true });
  }, [guild, visibleGuilds]);

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

async function refreshRecordTracking() {
  await loadRecordSessions({ silent: true });
  await load();
  setRecordSessionsMessage("Suivi VPS recalcule sur les defenses actuellement a record.");
}

async function calculateGroups() {
  if (!canUsePanelActions || groupCalculating) return;

  try {
    setGroupCalculating(true);
    setMessage("Calcul des groupes en cours...");

    const response = await fetch(`${apiBase}/api/gvg-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "calculate_groups",
        guild,
      }),
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setMessage(`Reponse non JSON calcul groupes (${response.status})`);
      return;
    }

    if (!response.ok || !data?.success) {
      setMessage(data?.error || "Erreur calcul groupes");
      return;
    }

    setGroupCalc(data);
    await load();

    const enemyCount = Number(data?.updated_enemy_groups || 0);
    const mirrorCount = Number(data?.matched_mirror_groups || 0);
    const warning = data?.schema_warning ? ` ${data.schema_warning}` : "";
    setMessage(
      `Calcul groupes termine : ${enemyCount} groupe(s) ennemi(s), ${mirrorCount} correspondance(s) ennemi/allie.${warning}`
    );
  } catch (error) {
    console.error("calculateGroups error:", error);
    setMessage(`Erreur calcul groupes : ${error?.message || "erreur inconnue"}`);
  } finally {
    setGroupCalculating(false);
  }
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

function getDefenseRecordUpload(defense) {
  if (!defense?.id) return null;

  const defenseId = String(defense.id || "").toLowerCase();
  return recordUploadsByKey.get(`id:${defenseId}`) || null;
}

function isRecordVideoReceived(upload) {
  const item = upload?.item;
  const status = item?.status;

  return Boolean(
    item?.video_file ||
      ["uploaded", "youtube_uploading", "youtube_uploaded", "youtube_error"].includes(status)
  );
}

const recordFlowStats = useMemo(() => {
  const toRecord = items.filter((defense) => defense.record_status === "a_record");
  const uploaded = toRecord.filter((defense) =>
    isRecordVideoReceived(getDefenseRecordUpload(defense))
  ).length;
  const youtube = items.filter(
    (defense) => defense.record_status === "record" && defense.youtube_url
  ).length;

  return {
    toRecord: toRecord.length,
    uploaded,
    pending: Math.max(0, toRecord.length - uploaded),
    youtube,
  };
}, [items, recordUploadsByKey]);

function getDefenseRecordState(defense) {
  if (!defense) return null;

  const upload = getDefenseRecordUpload(defense);
  const uploadStatus = upload?.item?.status;

  if (defense.record_status === "push") {
    return {
      label: t("gvgPanel.recordStatePush", "Push base"),
      title: t("gvgPanel.recordStatePushTitle", "La defense a ete envoyee dans la base definitive."),
      badgeClass: "border-purple-400 bg-purple-500/15 text-purple-100",
      cardClass: "border-purple-400/70 bg-purple-500/10",
    };
  }

  if (defense.record_status === "record") {
    return {
      label: t("gvgPanel.recordStateYoutubeOk", "YouTube OK"),
      title: t("gvgPanel.recordStateYoutubeOkTitle", "La video YouTube est liee a cette defense."),
      badgeClass: "border-emerald-400 bg-emerald-500/15 text-emerald-100",
      cardClass: "border-emerald-500/70 bg-emerald-500/10",
    };
  }

  if (defense.record_status === "a_record" && uploadStatus === "youtube_error") {
    return {
      label: t("gvgPanel.recordStateYoutubeError", "Erreur YouTube"),
      title: upload?.item?.youtube_error || t("gvgPanel.recordStateYoutubeErrorTitle", "Upload YouTube en erreur."),
      badgeClass: "border-red-400 bg-red-500/15 text-red-100",
      cardClass: "border-red-500/70 bg-red-500/10",
    };
  }

  if (defense.record_status === "a_record" && uploadStatus === "youtube_uploading") {
    return {
      label: t("gvgPanel.recordStateYoutubeUploading", "Upload YouTube..."),
      title: t("gvgPanel.recordStateYoutubeUploadingTitle", "La video est en cours d'envoi sur YouTube."),
      badgeClass: "border-blue-400 bg-blue-500/15 text-blue-100",
      cardClass: "border-blue-500/70 bg-blue-500/10",
    };
  }

  if (defense.record_status === "a_record" && uploadStatus === "youtube_uploaded") {
    return {
      label: t("gvgPanel.recordStateYoutubeVpsOk", "YouTube VPS OK"),
      title: t("gvgPanel.recordStateYoutubeVpsOkTitle", "Le VPS a recu le lien YouTube; rafraichis pour synchroniser Supabase."),
      badgeClass: "border-emerald-400 bg-emerald-500/15 text-emerald-100",
      cardClass: "border-emerald-500/70 bg-emerald-500/10",
    };
  }

  if (defense.record_status === "a_record" && isRecordVideoReceived(upload)) {
    return {
      label: t("gvgPanel.recordStateVpsReceived", "Video VPS recue"),
      title: `${t("gvgPanel.recordStateVpsReceivedTitle", "Video recue par le VPS")} (${upload.session?.session_id || "session record"}).`,
      badgeClass: "border-cyan-400 bg-cyan-500/15 text-cyan-100",
      cardClass: "border-cyan-400/70 bg-cyan-500/10",
    };
  }

  if (defense.record_status === "a_record") {
    return {
      label: t("gvgPanel.recordStateToRecord", "A record"),
      title: t("gvgPanel.recordStateToRecordTitle", "Cette defense est dans le prochain plan record."),
      badgeClass: "border-amber-400 bg-amber-500/15 text-amber-100",
      cardClass: "border-amber-500/60 bg-amber-500/10",
    };
  }

  if (defense.record_status === "pas_record") {
    return {
      label: t("gvgPanel.recordStateNotRecord", "Pas record"),
      title: t("gvgPanel.recordStateNotRecordTitle", "Cette defense est ouverte dans le panel mais pas demandee en record."),
      badgeClass: "border-zinc-600 bg-zinc-800/60 text-zinc-300",
      cardClass: "border-zinc-800 bg-zinc-950/60",
    };
  }

  return {
    label: t("gvgPanel.recordStateOpen", "A ouvrir"),
    title: t("gvgPanel.recordStateOpenTitle", "Clique la ligne pour ouvrir cette defense dans le panel."),
    badgeClass: "border-zinc-700 bg-zinc-900/60 text-zinc-400",
    cardClass: "border-zinc-800 bg-zinc-950/60",
  };
}
  function buildSlotLabel(bastion, type, tower, team) {
    const strongholdPrefix = language === "en" ? "S" : "B";

    if (type === "fortress") {
      const keepCode = language === "en" ? "K" : "F";
      return `${strongholdPrefix}${bastion}_${keepCode}_T${team}`;
    }

    return `${strongholdPrefix}${bastion}_T${tower}_T${team}`;
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

function getGroupLabel(groupNum) {
  const value = Number(groupNum);
  return Number.isFinite(value) && value > 0 ? String(value) : "";
}

function getMirrorGroup(defense) {
  const persistedNum = Number(defense?.mirror_group_num);

  if (Number.isFinite(persistedNum) && persistedNum > 0) {
    return { num: persistedNum };
  }

  if (!defense?.id || !groupCalc?.mirror_map) return null;
  return groupCalc.mirror_map[String(defense.id)] || null;
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
  if (!defense?.id || recordTogglingIds.has(defense.id)) return;
  if (defense.record_status === "record" || defense.record_status === "push") return;

  const previousStatus = defense.record_status;
  const optimisticStatus = previousStatus === "a_record" ? "pas_record" : "a_record";

  setRecordTogglingIds((current) => {
    const next = new Set(current);
    next.add(defense.id);
    return next;
  });
  setItems((current) =>
    current.map((item) =>
      item.id === defense.id ? { ...item, record_status: optimisticStatus } : item
    )
  );

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
      setItems((current) =>
        current.map((item) =>
          item.id === defense.id ? { ...item, record_status: previousStatus } : item
        )
      );
      return;
    }

    if (!response.ok) {
      setMessage(data?.error || "Erreur toggle");
      setItems((current) =>
        current.map((item) =>
          item.id === defense.id ? { ...item, record_status: previousStatus } : item
        )
      );
      return;
    }

    if (data?.item?.record_status) {
      setItems((current) =>
        current.map((item) =>
          item.id === defense.id ? { ...item, record_status: data.item.record_status } : item
        )
      );
    }
  } catch (e) {
    console.error(e);
    setMessage("Erreur toggle");
    setItems((current) =>
      current.map((item) =>
        item.id === defense.id ? { ...item, record_status: previousStatus } : item
      )
    );
  } finally {
    setRecordTogglingIds((current) => {
      const next = new Set(current);
      next.delete(defense.id);
      return next;
    });
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

    if (data?.item?.id) {
      setItems((current) =>
        current.map((item) =>
          item.id === data.item.id
            ? { ...item, record_comment: data.item.record_comment || null }
            : item
        )
      );
    }

    setCommentModal(null);
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

    if (data?.item?.id) {
      setItems((current) =>
        current.map((item) =>
          item.id === data.item.id
            ? { ...item, attack_code: data.item.attack_code || null }
            : item
        )
      );
    }

    setAttackModal(null);
  } catch (e) {
    console.error(e);
    setMessage("Erreur code d'attaque");
  }
}

function buildAhkCommand() {
  if (!canUsePanelActions) return;

  const repairCommand = `$ErrorActionPreference = "Stop"
$base = Join-Path $env:LOCALAPPDATA "PaladinGVGRecordLauncher"
$currentFile = Join-Path $base "CURRENT_PATH.txt"
if (!(Test-Path -LiteralPath $currentFile)) { throw "Launcher record non installe. Reinstalle depuis Portal." }
$root = (Get-Content -Raw -LiteralPath $currentFile).Trim()
$ahk = Join-Path $root "runtime\\autohotkey\\AutoHotkey64.exe"
$script = Join-Path $root "PaladinGVGRecord.ahk"
if (!(Test-Path -LiteralPath $ahk)) { throw "AutoHotkey record introuvable: $ahk" }
if (!(Test-Path -LiteralPath $script)) { throw "Script record introuvable: $script" }
$protocolRoot = "HKCU:\\Software\\Classes\\paladin-gvg-record"
$commandRoot = Join-Path $protocolRoot "shell\\open\\command"
New-Item -Force -Path $protocolRoot | Out-Null
Set-Item -Path $protocolRoot -Value "URL:Paladin GVG Record Launcher"
New-ItemProperty -Force -Path $protocolRoot -Name "URL Protocol" -Value "" | Out-Null
New-Item -Force -Path $commandRoot | Out-Null
Set-Item -Path $commandRoot -Value "\`"$ahk\`" \`"$script\`" \`"%1\`""
Write-Host "Protocole record repare."
Write-Host ((Get-Item $commandRoot).GetValue(""))
Pause`;

  navigator.clipboard.writeText(repairCommand);
  setMessage("Commande de reparation du protocole record copiee.");
  return;

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
    setMessage("Upload YouTube lance sur le VPS. Reste sur le panel et rafraichis le suivi dans quelques instants.");

    const response = await fetch(`${apiBase}/api/gvg-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "record_youtube_upload",
        guild,
        limit: 50,
      }),
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setMessage(`Reponse non JSON Upload YouTube (${response.status})`);
      return;
    }

    if (!response.ok) {
      setMessage(data?.error || "Erreur Upload YouTube VPS");
      return;
    }

    if (Array.isArray(data?.sessions)) {
      setRecordSessions(data.sessions);
    }

    const queued = Number(data?.vps?.queued || 0);
    const synced = Number(data?.synced_youtube?.updated || 0);

    if (data?.vps?.already_running) {
      setMessage("Upload YouTube deja en cours sur le VPS. Rafraichis le suivi dans quelques instants.");
    } else if (queued > 0) {
      setMessage(`Upload YouTube lance : ${queued} video(s) en file. Deja synchronisees : ${synced}.`);
    } else if (synced > 0) {
      setMessage(`${synced} lien(s) YouTube synchronise(s) dans la GVG en cours.`);
    } else {
      setMessage(data?.vps?.message || "Aucune nouvelle video VPS a envoyer sur YouTube.");
    }

    await loadRecordSessions({ silent: true });
    await load();
  } catch (error) {
    console.error("markRecordOk error:", error);
    setMessage(`Erreur Upload YouTube : ${error?.message || "erreur inconnue"}`);
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
  body: JSON.stringify({
    queryItems,
    includeBoycotted: false,
    session: getRunSessionPayload(session),
    targetGuildCode: defense.guild || guild,
  }),
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
    const response = await fetch(`${apiBase}/api/run?action=delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: getRunSessionPayload(session),
        strat_id: stratId,
        targetGuildCode: runsModal?.guild || guild,
        gvgDefenseId: runsModal?.id || null,
      }),
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setMessage(`Suppression impossible : reponse non JSON (${response.status})`);
      return;
    }

    if (!response.ok) {
      setMessage(`Suppression impossible : ${data?.error || "run hors perimetre"}`);
      return;
    }

    setRuns((prev) => prev.filter((r) => r.strat_id !== stratId));
    setMessage(`Strat #${stratId} supprimee.`);
  } catch (err) {
    console.error("Erreur suppression strat:", err);
    setMessage(`Suppression impossible : ${err?.message || "erreur inconnue"}`);
  }
};

function handleEditStrat(run) {
  const stratId = run?.strat_id;
  if (!stratId || typeof onEditRun !== "function") return;

  setRunsModal(null);
  onEditRun(stratId);
}

const handleBoycottStrat = async (run) => {
  const stratId = run?.strat_id;
  const targetGuildCode = runsModal?.guild || guild;

  if (!stratId || !targetGuildCode) {
    setMessage("Boycott impossible : strat ou guilde manquante.");
    return;
  }

  try {
    const response = await fetch(`${apiBase}/api/run?action=boycott`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: getRunSessionPayload(session),
        strat_id: stratId,
        targetGuildCode,
        gvgDefenseId: runsModal?.id || null,
        boycott: true,
      }),
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setMessage(`Boycott impossible : reponse non JSON (${response.status})`);
      return;
    }

    if (!response.ok) {
      setMessage(`Boycott impossible : ${data?.error || "run hors perimetre"}`);
      return;
    }

    const remainingRuns = runs.filter((r) => r.strat_id !== stratId);
    setRuns(remainingRuns);

    if (runsModal?.id && data?.gvg_status) {
      setItems((prev) =>
        prev.map((item) =>
          item.id === runsModal.id
            ? { ...item, status: data.gvg_status }
            : item
        )
      );
    }

    setMessage(
      `Strat #${stratId} boycottee pour ${getGvgGuildLabel(data?.guild_code || targetGuildCode)}.`
    );
  } catch (err) {
    console.error("Erreur boycott strat:", err);
    setMessage(`Boycott impossible : ${err?.message || "erreur inconnue"}`);
  }
};

function canDeleteRunFromPanel(run) {
  if (!canUsePanelActions) return false;

  const runGuildCode = run?.guild_code || "";

  if (isPaladinSession(session)) {
    return !runGuildCode || isPaladinGuildCode(runGuildCode);
  }

  return Boolean(
    runGuildCode &&
      getGuildSpaceKey(runGuildCode) === getGuildSpaceKey(getSessionGuildCode(session))
  );
}

function renderPanelGrid(sourceItems, panelKey, wrapperClass, titleClass) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
      {[1, 2, 3, 4].map((bastion) => (
        <div
          key={`${panelKey}-${bastion}`}
          className={wrapperClass}
        >
          <div className={`mb-3 text-sm font-semibold ${titleClass}`}>
            {formatTranslation(t, "gvgCurrent.bastionNumber", "Bastion {number}", {
              number: bastion,
            })}
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
              const mirrorGroup = getMirrorGroup(defense);
              const canOpenVisibleRuns = Boolean(
                defense &&
                  (defense.has_visible_run === true ||
                    Number(defense.visible_run_count || 0) > 0 ||
                    defense.record_status === "push")
              );

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
                    title={defense ? t("gvgPanel.returnToCurrent", "Renvoyer dans GVG en cours") : ""}
                  >
                    <span className="flex items-center gap-2">
                      <span>{buildSlotLabel(bastion, slot.type, slot.tower, slot.team)}</span>
                      {defense?.group_num ? (
                        <span
                          className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-sky-300/70 bg-sky-500/25 px-1.5 text-[10px] font-bold text-sky-100 no-underline"
                          title={t("gvgPanel.enemyMirrorGroup", "Groupe de defenses ennemies identiques")}
                        >
                          {getGroupLabel(defense.group_num)}
                        </span>
                      ) : null}
                      {mirrorGroup?.num ? (
                        <span
                          className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-emerald-300/70 bg-emerald-500/25 px-1.5 text-[10px] font-bold text-emerald-100 no-underline"
                          title={t("gvgPanel.crossSideMirrorGroup", "Composition presente aussi entre ennemi et allie")}
                        >
                          {getGroupLabel(mirrorGroup.num)}
                        </span>
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
                            defense.record_status === "push" ||
                            recordTogglingIds.has(defense.id)
                          }
                          title={t("gvgPanel.toggleRecord", "Basculer a record / pas record")}
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
                          title={t("gvgPanel.comment", "Commentaire")}
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
                          title={t("gvgPanel.attackCode", "Code d'attaque")}
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
                          title={t("gvgPanel.recordStatus", "Statut record")}
                        >
                          ✅
                        </button>

                        <button
                          onClick={() => openRuns(defense)}
                          className={`flex h-7 min-w-8 items-center justify-center rounded-full border px-2 text-[10px] font-semibold transition ${
                            canOpenVisibleRuns
                              ? "border-green-500 bg-green-500/15 hover:scale-110 cursor-pointer"
                              : "border-red-500 bg-red-500/15 opacity-50 cursor-not-allowed"
                          }`}
                          disabled={!canOpenVisibleRuns}
                          title={t("gvgPanel.viewRuns", "Voir les runs")}
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
  {visibleGuilds.map((item) => (
    <button
      key={item}
      onClick={() => setGuild(item)}
      className={`px-3 py-1 rounded ${
        guild === item ? "bg-white text-black" : "bg-zinc-800 text-white"
      }`}
    >
      {getGvgGuildLabel(item)}
    </button>
  ))}

  {canUseCustomGuildInput ? (
    <input
      value={guild}
      onChange={(event) => setGuild(normalizeGuildInput(event.target.value))}
      className="w-24 rounded border border-zinc-700 bg-zinc-950 px-3 py-1 text-sm uppercase text-white outline-none focus:border-cyan-400"
      placeholder="MAD"
      title={t("gvgPanel.guildCode", "Code guilde")}
    />
  ) : null}

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
  {t("gvgPanel.startRecord", "Lancer record")}
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
  {t("gvgPanel.repairRecord", "Reparer record")}
</button>

<button
  onClick={calculateGroups}
  disabled={!canUsePanelActions || groupCalculating}
  className={`rounded px-3 py-1 text-sm text-white ${
    canUsePanelActions && !groupCalculating
      ? "bg-indigo-600 hover:bg-indigo-500"
      : "cursor-not-allowed bg-zinc-700 opacity-50"
  }`}
>
  {groupCalculating ? t("gvgPanel.calculating", "Calcul...") : t("gvgPanel.calculateGroups", "Calcul groupes")}
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
  Upload YouTube
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
  📦 {t("gvgPanel.pushToBase", "Push en base")}
</button>
</div>

      {message ? (
        <div className="text-sm text-red-400">{message}</div>
      ) : null}

      {loading && <div>{t("common.loading", "Chargement...")}</div>}

      <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold uppercase tracking-wide text-cyan-100">
              {t("gvgPanel.vpsRecordTracking", "Suivi record VPS")}
            </div>
            <div className="mt-1 text-xs text-zinc-400">
              {t("gvgPanel.vpsRecordHelp", "Plan actif seulement : marque les defenses en A record, lance le record, attends le message de fin, puis rafraichis. Le reset GVG nettoie les videos VPS de cette guilde.")}
            </div>
          </div>

          <button
            type="button"
            onClick={refreshRecordTracking}
            disabled={recordSessionsLoading}
            className="rounded-lg border border-cyan-500/40 px-3 py-1 text-xs font-semibold text-cyan-100 hover:border-cyan-300 disabled:opacity-50"
          >
            {recordSessionsLoading ? t("gvgPanel.refreshingRecords", "Rafraichissement...") : t("gvgPanel.refreshVpsRecords", "Rafraichir records VPS")}
          </button>
        </div>

        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-zinc-500">{t("gvgPanel.toRecord", "A record")}</div>
            <div className="text-lg font-semibold text-amber-200">
              {recordFlowStats.toRecord}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-zinc-500">{t("gvgPanel.vpsVideosReceived", "Videos VPS recues")}</div>
            <div className="text-lg font-semibold text-cyan-100">
              {recordFlowStats.uploaded}/{recordFlowStats.toRecord}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-zinc-500">{t("gvgPanel.stillWaiting", "Encore attendues")}</div>
            <div className="text-lg font-semibold text-emerald-200">
              {recordFlowStats.pending}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-zinc-500">YouTube OK</div>
            <div className="text-lg font-semibold text-zinc-200">{recordFlowStats.youtube}</div>
          </div>
        </div>

        {recordSessionsMessage ? (
          <div className="mt-2 text-xs text-cyan-200">{recordSessionsMessage}</div>
        ) : null}

      </div>

{!loading && !message && (
  <>
    <div className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-400">
      {t("gvgPanel.enemyDefenses", "Defenses adverses")}
    </div>

    {renderPanelGrid(
      enemyItems,
      "enemy",
      "rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4",
      "text-zinc-100"
    )}

    <div className="mt-10 mb-4 rounded-2xl border-2 border-red-500 bg-red-500/5 p-4 text-center">
      <div className="text-sm font-semibold uppercase tracking-[0.2em] text-red-400">
        {t("gvgPanel.allyDefenses", "Defenses alliees")}
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
            <div className="mb-1 text-lg font-semibold text-white">{t("gvgPanel.startGvgRecord", "Lancer un record GVG")}</div>
            <div className="mb-4 text-sm text-zinc-400">
              {t("gvgPanel.recordPlanGuild", "Guilde")} {getGvgGuildLabel(guild)}. {t("gvgPanel.recordPlanHelp", "Le plan sera limite a cette guilde et aux defenses marquees a record.")}
            </div>

            <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 text-xs text-zinc-300">
              <div className="mb-2 font-semibold uppercase tracking-wide text-cyan-100">
                {t("gvgPanel.playerInstructions", "Ce que le joueur doit faire")}
              </div>
              <ol className="list-decimal space-y-1 pl-4">
                <li>{t("gvgPanel.instructionScope", "Choisir Ennemies, Alliees ou Les deux selon le record demande.")}</li>
                <li>{t("gvgPanel.instructionLauncher", "Cliquer sur Ouvrir le launcher record et accepter l'autorisation Windows.")}</li>
                <li>{t("gvgPanel.instructionNoTouch", "Ne pas toucher a la souris pendant le record.")}</li>
                <li>{t("gvgPanel.instructionRefresh", "Quand le launcher annonce la fin, revenir ici et cliquer sur Rafraichir records VPS.")}</li>
              </ol>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {[
                ["enemy", t("gvgPanel.enemies", "Ennemies"), recordCounts.enemy],
                ["ally", t("gvgPanel.allies", "Alliees"), recordCounts.ally],
                ["both", t("gvgPanel.both", "Les deux"), recordCounts.enemy + recordCounts.ally],
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
                  <div className="text-xs text-zinc-400">{count} {t("gvgPanel.defensesToRecord", "defense(s) a record")}</div>
                </button>
              ))}
            </div>

            {recordCreating ? (
              <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm text-zinc-300">
                {t("gvgPanel.creatingRecordSession", "Creation de la session record sur le VPS...")}
              </div>
            ) : null}

            {recordSession ? (
              <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                <div className="font-semibold">{t("gvgPanel.sessionCreated", "Session creee")}</div>
                <div>{recordSession.count} {t("gvgPanel.defensesInPlan", "defense(s) dans le plan")} {recordSession.scope}.</div>
                <div className="mt-1 break-all text-xs text-emerald-200/80">{recordSession.session_id}</div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={launchRecordProtocol}
                    className="rounded bg-emerald-600 px-3 py-1 text-sm text-white hover:bg-emerald-500"
                  >
                    {t("gvgPanel.openRecordLauncher", "Ouvrir le launcher record")}
                  </button>
                  <a
                    href={
                      buildPublicDownloadUrl("PaladinGVGRecordLauncher.zip") ||
                      `${apiBase}/api/gvg-server?action=record-launcher-download`
                    }
                    className="rounded border border-emerald-500/40 px-3 py-1 text-sm text-emerald-100 hover:border-emerald-300"
                  >
                    {t("gvgPanel.downloadInstall", "Telecharger / installer")}
                  </a>
                </div>
                <div className="mt-2 text-xs text-emerald-200/70">
                  {t("gvgPanel.recordLauncherHelp", "Si rien ne s'ouvre, installe le launcher record une fois, puis reclique sur ouvrir. A la fin du record, ferme le message du launcher et clique sur Rafraichir records VPS dans le panel.")}
                </div>
              </div>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRecordModalOpen(false)}
                className="rounded bg-zinc-800 px-3 py-1 text-sm text-white hover:bg-zinc-700"
              >
                {t("common.close", "Fermer")}
              </button>
            </div>
          </div>
        </div>
      )}

      {commentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-4">
            <div className="mb-2 text-sm text-zinc-200">
              {t("gvgPanel.comment", "Commentaire")} · {buildSlotLabel(
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
              placeholder={t("gvgPanel.commentPlaceholder", "Saisis ton commentaire...")}
            />

            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setCommentModal(null)}
                className="rounded bg-zinc-700 px-3 py-1 text-sm text-white"
              >
                {t("common.cancel", "Annuler")}
              </button>

              <button
                onClick={saveComment}
                className="rounded bg-green-600 px-3 py-1 text-sm text-white"
              >
                {t("common.save", "Enregistrer")}
              </button>
            </div>
          </div>
        </div>
      )}

          {attackModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-4">
            <div className="mb-2 text-sm text-zinc-200">
              {t("gvgPanel.attackCode", "Code d'attaque")} · {buildSlotLabel(
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
              placeholder={t("gvgPanel.attackCodePlaceholder", "Saisis le code d'attaque...")}
            />

            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setAttackModal(null)}
                className="rounded bg-zinc-700 px-3 py-1 text-sm text-white"
              >
                {t("common.cancel", "Annuler")}
              </button>

              <button
                onClick={saveAttackCode}
                className="rounded bg-green-600 px-3 py-1 text-sm text-white"
              >
                {t("common.save", "Enregistrer")}
              </button>
            </div>
          </div>
        </div>
      )}

      {returnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-4">
            <div className="mb-2 text-sm text-zinc-200">
              {t("gvgPanel.returnToCurrent", "Renvoyer dans GVG en cours")}
            </div>

            <div className="text-sm text-zinc-300">
              {t("gvgPanel.returnQuestionStart", "Veux-tu renvoyer la defense")}{" "}
              <span className="font-semibold text-white">
                {buildSlotLabel(
                  returnModal.bastion,
                  returnModal.type,
                  returnModal.tower,
                  returnModal.team
                )}
              </span>{" "}
              {t("gvgPanel.returnQuestionEnd", "dans GVG en cours ?")}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setReturnModal(null)}
                className="rounded bg-zinc-700 px-3 py-1 text-sm text-white"
              >
                {t("common.cancel", "Annuler")}
              </button>

              <button
                onClick={confirmReturnToCurrent}
                className="rounded bg-red-600 px-3 py-1 text-sm text-white"
              >
                {t("common.confirm", "Confirmer")}
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
                <div className="text-zinc-400">{t("common.loading", "Chargement...")}</div>
              ) : runs.length === 0 ? (
                <div className="text-zinc-500">{t("gvgPanel.noRunFound", "Aucun run trouve")}</div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {runs.map((run, i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-zinc-700 bg-zinc-800/60 p-3"
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-white">
                          Strat #{run.strat_id}
                          </span>
                          {showExternalRunAlerts && isExternalRunGuildCode(run.guild_code) ? (
                            <span className="rounded-full border border-amber-400/50 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold uppercase text-amber-100">
                              Run externe - {getGvgGuildLabel(run.guild_code)}
                            </span>
                          ) : null}
                        </div>

                        {canUsePanelActions ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleEditStrat(run)}
                              disabled={!canDeleteRunFromPanel(run)}
                              title={
                                canDeleteRunFromPanel(run)
                                  ? t("gvgPanel.editStrat", "Modifier la strat")
                                  : t("gvgPanel.editLimited", "Modification limitee a la banque modifiable")
                              }
                              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold ${
                                canDeleteRunFromPanel(run)
                                  ? "bg-zinc-700 text-white hover:bg-zinc-600"
                                  : "cursor-not-allowed bg-zinc-700 text-zinc-300 opacity-50"
                              }`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              {t("common.edit", "Modifier")}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleBoycottStrat(run)}
                              className="inline-flex items-center gap-1 rounded bg-amber-600 px-2 py-1 text-xs font-semibold text-white hover:bg-amber-700"
                            >
                              <Ban className="h-3.5 w-3.5" />
                              {t("gvgPanel.boycottFor", "Boycotter pour")} {getGvgGuildLabel(runsModal.guild || guild)}
                            </button>

                            <button
                              onClick={() => handleDeleteStrat(run)}
                              disabled={!canDeleteRunFromPanel(run)}
                              title={
                                canDeleteRunFromPanel(run)
                                  ? t("gvgPanel.deleteStrat", "Supprimer la strat")
                                  : t("gvgPanel.deleteLimited", "Suppression limitee a la banque modifiable")
                              }
                              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold ${
                                canDeleteRunFromPanel(run)
                                  ? "bg-red-600 text-white hover:bg-red-700"
                                  : "cursor-not-allowed bg-zinc-700 text-zinc-300 opacity-50"
                              }`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {t("common.delete", "Supprimer")}
                            </button>
                          </div>
                        ) : null}
                      </div>

                      {run.youtube_url ? (
                        getYoutubeEmbedUrl(run.youtube_url) ? (
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
                        ) : (
                          <a
                            href={run.youtube_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm text-blue-400 underline"
                          >
                            {t("gvgCurrent.openVideo", "Ouvrir la video")}
                          </a>
                        )
                      ) : null}

                      <div className="mt-3 grid gap-2 rounded-xl border border-zinc-700/70 bg-zinc-950/50 p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            {t("gvgPanel.attackCode", "Code d'attaque")}
                          </span>
                          {run.attack_code ? (
                            <span className="font-semibold text-zinc-100">{run.attack_code}</span>
                          ) : (
                            <span className="text-zinc-400">{t("gvgPanel.noAttackCode", "Pas de code")}</span>
                          )}
                        </div>

                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            {t("gvgPanel.instructions", "Consignes")}
                          </div>
                          <div className="mt-1 whitespace-pre-wrap text-zinc-200">
                            {run.commentaire
                              ? run.commentaire
                              : t("gvgPanel.noInstructions", "Pas de consigne particuliere")}
                          </div>
                        </div>
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
                  {t("common.close", "Fermer")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
