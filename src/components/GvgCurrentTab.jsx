import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { buildChampionDisplayMap, translateChampionName } from "@/lib/championDisplay";
import {
  getGvgGuildLabel,
  getVisibleGvgGuildCodes,
  isExternalRunGuildCode,
  isPaladinAdminSession,
} from "@/lib/guildScope";
import { usePortalLanguage } from "@/lib/portalLanguage";
import { resolvePublicAssetProxyUrl } from "@/lib/vpsAssets";

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

function getRunSessionParams(session) {
  return {
    memberId: session?.memberId || session?.member_id || session?.id || "",
    discordId: session?.discordId || session?.discord_id || "",
    guildCode: session?.guildCode || session?.guild_code || session?.guild || "G1",
  };
}

function getStatusClasses(status) {
  if (status === "repro") {
    return "border-blue-500/40 bg-blue-500/10 text-blue-200";
  }

  if (status === "strat") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  }

  return "border-orange-500/40 bg-orange-500/10 text-orange-200";
}

function formatTranslation(t, key, fallback, values = {}) {
  let text = t(key, fallback);

  Object.entries(values).forEach(([name, value]) => {
    text = text.replaceAll(`{${name}}`, String(value ?? ""));
  });

  return text;
}

function getStatusLabel(status, reproBy, t) {
  if (status === "repro") {
    return reproBy
      ? formatTranslation(t, "gvgCurrent.statusReproBy", "C'est repro sur {player}", {
          player: reproBy,
        })
      : t("gvgCurrent.statusRepro", "Repro en cours");
  }

  if (status === "strat") {
    return t("gvgCurrent.statusStrat", "Strat disponible");
  }

  return t("gvgCurrent.statusToOpen", "A ouvrir");
}

function buildDefenseTitle(defense, t) {
  if (defense.type === "fortress") {
    return formatTranslation(t, "gvgCurrent.fortressTeam", "Forteresse · Team {team}", {
      team: defense.team,
    });
  }

  return formatTranslation(t, "gvgCurrent.towerTeam", "Tour {tower} · Team {team}", {
    tower: defense.tower,
    team: defense.team,
  });
}

function buildDefenseShortTitle(defense, t) {
  if (defense.type === "fortress") {
    return formatTranslation(t, "gvgCurrent.teamOnly", "Team {team}", {
      team: defense.team,
    });
  }

  return formatTranslation(t, "gvgCurrent.shortTowerTeam", "T{tower} · Team {team}", {
    tower: defense.tower,
    team: defense.team,
  });
}

function toGroupEmoji(value) {
  if (value === null || value === undefined) return "";

  const digitMap = {
    "0": "0️⃣",
    "1": "1️⃣",
    "2": "2️⃣",
    "3": "3️⃣",
    "4": "4️⃣",
    "5": "5️⃣",
    "6": "6️⃣",
    "7": "7️⃣",
    "8": "8️⃣",
    "9": "9️⃣",
  };

  return String(value)
    .split("")
    .map((char) => digitMap[char] || char)
    .join("");
}

const GVG_CURRENT_SLOT_ROWS = [
  { id: "fortress", type: "fortress", tower: null },
  { id: "tower-1", type: "tower", tower: 1 },
  { id: "tower-2", type: "tower", tower: 2 },
  { id: "tower-3", type: "tower", tower: 3 },
  { id: "tower-4", type: "tower", tower: 4 },
  { id: "tower-5", type: "tower", tower: 5 },
];

const GVG_CURRENT_TEAMS = [1, 2];

function hasOpenRecordStatus(defense) {
  const value = defense?.record_status;
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function isActiveGvgDefense(defense) {
  return Boolean(defense) && !hasOpenRecordStatus(defense);
}

function defenseMatchesDesktopSlot(defense, slot, team) {
  if (!defense || !slot) return false;
  if (Number(defense.team) !== Number(team)) return false;

  if (slot.type === "fortress") {
    return defense.type === "fortress";
  }

  return defense.type !== "fortress" && Number(defense.tower) === Number(slot.tower);
}

function shouldShowDefenseForCurrentFilter(defense, selectedFilter) {
  if (!isActiveGvgDefense(defense)) return false;
  if (selectedFilter === "repro") return defense.status === "repro";
  if (selectedFilter === "strat") return defense.status === "strat";
  return true;
}

export default function GvgCurrentTab({ session: portalSession } = {}) {
  const apiBase = useMemo(() => getApiBase(), []);
  const { language, t } = usePortalLanguage();
const [refreshTick, setRefreshTick] = useState(0);
  const [selectedFilter, setSelectedFilter] = useState(null);
  const [selectedBastionId, setSelectedBastionId] = useState(null);
  const [defenses, setDefenses] = useState([]);
  const [openingDefenseIds, setOpeningDefenseIds] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [reproModalOpen, setReproModalOpen] = useState(false);
    const [reproLoading, setReproLoading] = useState(false);
    const [reproSaving, setReproSaving] = useState(false);
    const [reproDefenseId, setReproDefenseId] = useState(null);
    const [reproWatcherName, setReproWatcherName] = useState("");
    const [reproPlayerPb, setReproPlayerPb] = useState("");
    const [reproEnemyPb, setReproEnemyPb] = useState("");
    const [reproHeroLines, setReproHeroLines] = useState([]);
    const [reproArtifact, setReproArtifact] = useState("");
    const [reproMessage, setReproMessage] = useState("");
    const [reproViewOpen, setReproViewOpen] = useState(false);
    const [reproViewLoading, setReproViewLoading] = useState(false);
    const [reproViewMessage, setReproViewMessage] = useState("");
    const [reproViewText, setReproViewText] = useState("");
    const [imageModalOpen, setImageModalOpen] = useState(false);
    const [imageModalUrl, setImageModalUrl] = useState("");
    const [imageModalTitle, setImageModalTitle] = useState("");
    const [stratModalOpen, setStratModalOpen] = useState(false);
    const [stratModalLoading, setStratModalLoading] = useState(false);
    const [stratModalMessage, setStratModalMessage] = useState("");
    const [stratModalItems, setStratModalItems] = useState([]);
    const [reproCandidates, setReproCandidates] = useState([]);
    const [reproHeroes, setReproHeroes] = useState([]);
    const [reproCandidatesModalOpen, setReproCandidatesModalOpen] = useState(false);
    const [championDisplayMap, setChampionDisplayMap] = useState(() => new Map());


  const dashboardSession = useMemo(() => {
    if (typeof window === "undefined") return null;

    try {
      const raw = localStorage.getItem("guildDashboardSession");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);
  const session = portalSession || dashboardSession;
  const showExternalRunAlerts = useMemo(() => isPaladinAdminSession(session), [session]);
  const visibleGuilds = useMemo(() => getVisibleGvgGuildCodes(session), [session]);
  const [selectedGuild, setSelectedGuild] = useState(() => {
    return localStorage.getItem("gvg_selected_guild") || "";
  });

  useEffect(() => {
    if (visibleGuilds.length === 0) {
      setSelectedGuild("");
      if (typeof window !== "undefined") localStorage.removeItem("gvg_selected_guild");
      return;
    }

    setSelectedGuild((current) => {
      if (visibleGuilds.includes(current)) return current;
      const nextGuild = visibleGuilds[0];
      if (typeof window !== "undefined") localStorage.setItem("gvg_selected_guild", nextGuild);
      return nextGuild;
    });
  }, [visibleGuilds]);

  useEffect(() => {
    let cancelled = false;

    async function loadChampionDisplayMap() {
      const { data, error } = await supabase.from("champions").select("*");
      if (cancelled) return;
      if (error) {
        console.warn("champions display map unavailable:", error);
        return;
      }

      setChampionDisplayMap(buildChampionDisplayMap(data || []));
    }

    loadChampionDisplayMap();

    return () => {
      cancelled = true;
    };
  }, []);

  const currentWatcherName = useMemo(() => {
    return (
      session?.watcherName ||
      session?.memberName ||
      session?.name ||
      "Joueur"
    );
  }, [session]);

async function loadGvg(cancelled = false) {
  if (!selectedGuild) return;
  if (!visibleGuilds.includes(selectedGuild)) return;

  try {
    setLoading(true);
    setMessage("");

    const params = new URLSearchParams({
      guild: selectedGuild,
    });

    Object.entries(getRunSessionParams(session)).forEach(([key, value]) => {
      if (value) params.set(key, String(value));
    });

    const response = await fetch(`${apiBase}/api/gvg-data?${params.toString()}`);

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      if (!cancelled) {
        setMessage(
          formatTranslation(t, "gvgCurrent.errorNonJson", "Reponse non JSON {context} ({status})", {
            context: "gvg-list",
            status: response.status,
          })
        );
      }
      return;
    }

    if (!response.ok) {
      if (!cancelled) {
        setMessage(
          formatTranslation(t, "gvgCurrent.errorLoad", "Erreur chargement GVG : {error}", {
            error: data?.error || t("common.unknownError", "erreur inconnue"),
          })
        );
      }
      return;
    }

    if (!cancelled) {
      setDefenses(Array.isArray(data?.items) ? data.items : []);
      setSelectedBastionId((prev) => prev || 1);
      setSelectedFilter((prev) => prev || "def");
    }
  } catch (error) {
    console.error("loadGvg error:", error);
    if (!cancelled) {
      setMessage(
        formatTranslation(t, "gvgCurrent.errorLoad", "Erreur chargement GVG : {error}", {
          error: error?.message || t("common.unknownError", "erreur inconnue"),
        })
      );
    }
  } finally {
    if (!cancelled) {
      setLoading(false);
    }
  }
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

function getDefenseImageUrl(defense) {
  if (!defense?.image_url) return "";
  const imageUrl = resolvePublicAssetProxyUrl(defense.image_url);

  return (
    imageUrl.startsWith("/api/") && apiBase
      ? `${apiBase}${imageUrl}`
      : imageUrl
  );
}

function openDefenseImage(defense) {
  const imageUrl = getDefenseImageUrl(defense);
  if (!imageUrl) return;

  setImageModalUrl(imageUrl);
  setImageModalTitle(buildDefenseTitle(defense, t));
  setImageModalOpen(true);
}

useEffect(() => {
  if (!selectedGuild) {
    setDefenses([]);
    setSelectedBastionId(null);
    setSelectedFilter(null);
    return;
  }

  let cancelled = false;
  loadGvg(cancelled);

  return () => {
    cancelled = true;
  };
}, [apiBase, selectedGuild, refreshTick, visibleGuilds]);

const bastions = useMemo(() => {
  return [1, 2, 3, 4].map((bastionId) => {
    const items = defenses.filter(
      (defense) =>
        Number(defense.bastion) === bastionId &&
        isActiveGvgDefense(defense)
    );

    return {
      id: bastionId,
      defenses: items,
    };
  });
}, [defenses]);

  const selectedBastion = useMemo(() => {
    return bastions.find((bastion) => bastion.id === selectedBastionId) || null;
  }, [bastions, selectedBastionId]);

  const selectedBastionAllDefenses = useMemo(() => {
    if (!selectedBastionId) return [];
    return defenses.filter((defense) => Number(defense.bastion) === Number(selectedBastionId));
  }, [defenses, selectedBastionId]);

  const filteredDefenses = useMemo(() => {
    if (!selectedBastion) return [];

    if (selectedFilter === "repro") {
      return selectedBastion.defenses.filter((defense) => defense.status === "repro");
    }

    if (selectedFilter === "strat") {
      return selectedBastion.defenses.filter((defense) => defense.status === "strat");
    }

    return selectedBastion.defenses;
  }, [selectedBastion, selectedFilter]);

async function markDefenseAsRepro(defenseId) {
  try {
    const response = await fetch(`${apiBase}/api/gvg-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: defenseId,
        action: "repro",
        watcher: currentWatcherName,
      }),
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setMessage(
        formatTranslation(t, "gvgCurrent.errorNonJson", "Reponse non JSON {context} ({status})", {
          context: "gvg-update",
          status: response.status,
        })
      );
      return;
    }

    if (!response.ok) {
      setMessage(
        formatTranslation(t, "gvgCurrent.errorRepro", "Erreur repro : {error}", {
          error: data?.error || t("common.unknownError", "erreur inconnue"),
        })
      );
      return;
    }

setRefreshTick((prev) => prev + 1);
  } catch (error) {
    console.error("markDefenseAsRepro error:", error);
    setMessage(
      formatTranslation(t, "gvgCurrent.errorRepro", "Erreur repro : {error}", {
        error: error?.message || t("common.unknownError", "erreur inconnue"),
      })
    );
  }
}

async function openReproCandidates(defense) {
  try {
    // ferme le modal repro classique
    setReproModalOpen(false);

    const res = await fetch(`${apiBase}/api/gvg-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "repro_candidates",
        defenseId: defense.id,
      }),
    });

    const data = await res.json();

    setReproCandidates(data.candidates || []);
    setReproHeroes(data.heroes || []);

    // ouvre le BON modal
    setReproCandidatesModalOpen(true);
  } catch (e) {
    console.error(e);
  }
}

async function openStratView(defenseId) {
  try {
    setStratModalLoading(true);
    setStratModalMessage("");
    setStratModalItems([]);

    const params = new URLSearchParams({
      gvgDefenseId: String(defenseId),
    });

    Object.entries(getRunSessionParams(session)).forEach(([key, value]) => {
      if (value) params.set(key, String(value));
    });

    const response = await fetch(`${apiBase}/api/gvg-strat-search?${params.toString()}`);

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setStratModalMessage(
        formatTranslation(t, "gvgCurrent.errorNonJson", "Reponse non JSON {context} ({status})", {
          context: "gvg-strat-search",
          status: response.status,
        })
      );
      setStratModalOpen(true);
      return;
    }

    if (!response.ok) {
      setStratModalMessage(
        formatTranslation(t, "gvgCurrent.errorReadStrat", "Erreur lecture strat : {error}", {
          error: data?.error || t("common.unknownError", "erreur inconnue"),
        })
      );
      setStratModalOpen(true);
      return;
    }

    const items = Array.isArray(data?.items) ? data.items : [];

    if (!items.length) {
      setStratModalMessage(t("gvgCurrent.noStratFound", "Aucune strat trouvee."));
      setStratModalOpen(true);
      return;
    }

    setStratModalItems(items);
    setStratModalOpen(true);
  } catch (error) {
    console.error("openStratView error:", error);
    setStratModalMessage(
      formatTranslation(t, "gvgCurrent.errorReadStrat", "Erreur lecture strat : {error}", {
        error: error?.message || t("common.unknownError", "erreur inconnue"),
      })
    );
    setStratModalOpen(true);
  } finally {
    setStratModalLoading(false);
  }
}

async function openReproView(defenseId) {
  try {
    setReproViewLoading(true);
    setReproViewMessage("");
    setReproViewText("");

    const response = await fetch(
      `${apiBase}/api/gvg-repro?gvgDefenseId=${encodeURIComponent(defenseId)}`
    );

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setReproViewMessage(
        formatTranslation(t, "gvgCurrent.errorNonJson", "Reponse non JSON {context} ({status})", {
          context: "gvg-repro-get",
          status: response.status,
        })
      );
      setReproViewOpen(true);
      return;
    }

    if (!response.ok) {
      setReproViewMessage(
        formatTranslation(t, "gvgCurrent.errorReadRepro", "Erreur lecture repro : {error}", {
          error: data?.error || t("common.unknownError", "erreur inconnue"),
        })
      );
      setReproViewOpen(true);
      return;
    }

    if (!data?.item) {
      setReproViewMessage(t("gvgCurrent.noReproSaved", "Aucune repro enregistree."));
      setReproViewOpen(true);
      return;
    }

    setReproViewText(data.item.message_text || "");
    setReproViewOpen(true);
  } catch (error) {
    console.error("openReproView error:", error);
    setReproViewMessage(
      formatTranslation(t, "gvgCurrent.errorReadRepro", "Erreur lecture repro : {error}", {
        error: error?.message || t("common.unknownError", "erreur inconnue"),
      })
    );
    setReproViewOpen(true);
  } finally {
    setReproViewLoading(false);
  }
}

async function openReproModal(defenseId) {
  try {
    setReproLoading(true);
    setReproMessage("");
    setReproDefenseId(defenseId);
    setReproWatcherName(currentWatcherName);
    setReproPlayerPb("");
    setReproEnemyPb("");
    setReproArtifact("");
    setReproHeroLines([]);

    const response = await fetch(`${apiBase}/api/gvg-repro`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
        body: JSON.stringify({
          action: "template",
          gvgDefenseId: defenseId,
          memberId: session?.memberId,
          watcherName: currentWatcherName,
        }),
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setReproMessage(
        formatTranslation(t, "gvgCurrent.errorNonJson", "Reponse non JSON {context} ({status})", {
          context: "gvg-repro-template",
          status: response.status,
        })
      );
      return;
    }

    if (!response.ok) {
      setReproMessage(
        formatTranslation(t, "gvgCurrent.errorTemplateRepro", "Erreur template repro : {error}", {
          error: data?.error || t("common.unknownError", "erreur inconnue"),
        })
      );
      return;
    }

    setReproWatcherName(data?.watcherName || currentWatcherName);
    setReproHeroLines(Array.isArray(data?.heroLines) ? data.heroLines : []);
    setReproModalOpen(true);
  } catch (error) {
    console.error("openReproModal error:", error);
    setReproMessage(
      formatTranslation(t, "gvgCurrent.errorTemplateRepro", "Erreur template repro : {error}", {
        error: error?.message || t("common.unknownError", "erreur inconnue"),
      })
    );
  } finally {
    setReproLoading(false);
  }
}

async function cancelDefenseRepro(defenseId) {
  try {
    const response = await fetch(`${apiBase}/api/gvg-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: defenseId,
        action: "cancel",
        watcher: currentWatcherName,
      }),
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setMessage(
        formatTranslation(t, "gvgCurrent.errorNonJson", "Reponse non JSON {context} ({status})", {
          context: "gvg-update",
          status: response.status,
        })
      );
      return;
    }

    if (!response.ok) {
      setMessage(
        formatTranslation(t, "gvgCurrent.errorCancelRepro", "Erreur annulation repro : {error}", {
          error: data?.error || t("common.unknownError", "erreur inconnue"),
        })
      );
      return;
    }

setRefreshTick((prev) => prev + 1);

  } catch (error) {
    console.error("cancelDefenseRepro error:", error);
    setMessage(
      formatTranslation(t, "gvgCurrent.errorCancelRepro", "Erreur annulation repro : {error}", {
        error: error?.message || t("common.unknownError", "erreur inconnue"),
      })
    );
  }
}

async function markDefenseAsOpened(defenseId) {
  const previousDefense = defenses.find((defense) => defense.id === defenseId) || null;

  try {
    setOpeningDefenseIds((current) => {
      const next = new Set(current);
      next.add(defenseId);
      return next;
    });

    setDefenses((current) =>
      current.map((defense) =>
        defense.id === defenseId
          ? {
          ...defense,
          record_status: defense.record_status || "pas_record",
            }
          : defense
      )
    );
    setMessage(t("gvgCurrent.sentToPanel", "Defense envoyee dans le panel."));

    const response = await fetch(`${apiBase}/api/gvg-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: defenseId,
        action: "panel_open",
      }),
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      if (previousDefense) {
        setDefenses((current) =>
          current.map((defense) => (defense.id === defenseId ? previousDefense : defense))
        );
      }
      setMessage(
        formatTranslation(t, "gvgCurrent.errorNonJson", "Reponse non JSON {context} ({status})", {
          context: "gvg-panel-open",
          status: response.status,
        })
      );
      return;
    }

    if (!response.ok) {
      if (previousDefense) {
        setDefenses((current) =>
          current.map((defense) => (defense.id === defenseId ? previousDefense : defense))
        );
      }
      setMessage(
        formatTranslation(t, "gvgCurrent.errorPanelOpen", "Erreur ouverture panel : {error}", {
          error: data?.error || t("common.unknownError", "erreur inconnue"),
        })
      );
      return;
    }

    if (data?.already_open) {
      setMessage(t("gvgCurrent.alreadyOpen", "Cette defense est deja ouverte dans le panel."));
    } else {
      setMessage(t("gvgCurrent.sentToPanel", "Defense envoyee dans le panel."));
    }

    setRefreshTick((prev) => prev + 1);
  } catch (error) {
    console.error("markDefenseAsOpened error:", error);
    if (previousDefense) {
      setDefenses((current) =>
        current.map((defense) => (defense.id === defenseId ? previousDefense : defense))
      );
    }
    setMessage(
      formatTranslation(t, "gvgCurrent.errorPanelOpen", "Erreur ouverture panel : {error}", {
        error: error?.message || t("common.unknownError", "erreur inconnue"),
      })
    );
  } finally {
    setOpeningDefenseIds((current) => {
      const next = new Set(current);
      next.delete(defenseId);
      return next;
    });
  }
}

function renderDefenseCard(defense, key = defense.id) {
  const canOpenVisibleRuns =
    defense.has_visible_run === true ||
    Number(defense.visible_run_count || 0) > 0 ||
    defense.record_status === "push";
  const isOpeningDefense = openingDefenseIds.has(defense.id);

  return (
    <div
      key={key}
      className={`w-full rounded-2xl border px-4 py-3 ${getStatusClasses(
        defense.status
      )}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-medium">
            {buildDefenseTitle(defense, t)}
          </div>

          <div className="mt-1 text-sm opacity-80">
            {getStatusLabel(defense.status, defense.repro_by, t)}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="text-sm font-semibold">
            {buildDefenseShortTitle(defense, t)}
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            {defense.group_num ? (
              <div
                className="rounded-2xl border border-zinc-600 bg-zinc-900/60 px-5 py-3 text-2xl font-bold leading-none text-zinc-100 shadow-sm"
                title={t("gvgCurrent.enemyGroupTitle", "Groupe de defenses ennemies identiques")}
              >
                {toGroupEmoji(defense.group_num)}
              </div>
            ) : null}

            {defense.mirror_group_num ? (
              <div
                className="rounded-2xl border border-emerald-400/70 bg-emerald-500/15 px-5 py-3 text-2xl font-bold leading-none text-emerald-100 shadow-sm shadow-emerald-500/20"
                title={t(
                  "gvgCurrent.mirrorGroupTitle",
                  "Composition aussi presente cote allie : eviter en debut de GVG"
                )}
              >
                {toGroupEmoji(defense.mirror_group_num)}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,42%)] md:items-start">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => openReproModal(defense.id)}
            className="rounded-2xl border border-blue-500/40 bg-blue-500/15 px-3 py-2 text-sm font-medium text-blue-200 transition hover:bg-blue-500/25"
          >
            {reproLoading && reproDefenseId === defense.id
              ? t("common.loading", "Chargement...")
              : t("gvgCurrent.markAsRepro", "C'est repro")}
          </button>

          {defense.status === "repro" &&
          defense.repro_by === currentWatcherName ? (
            <button
              type="button"
              onClick={() => cancelDefenseRepro(defense.id)}
              className="rounded-2xl border border-zinc-600 bg-zinc-800/60 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-700/70"
            >
              {t("gvgCurrent.cancelRepro", "Annuler repro")}
            </button>
          ) : null}

          {defense.status === "repro" ? (
            <button
              type="button"
              onClick={() => openReproView(defense.id)}
              className="rounded-2xl border border-zinc-600 bg-zinc-800/60 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-700/70"
            >
              ⚔️
            </button>
          ) : null}

          {defense.image_url ? (
            <button
              type="button"
              onClick={() => openDefenseImage(defense)}
              className="rounded-2xl border border-zinc-600 bg-zinc-800/60 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-700/70"
            >
              📸
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => canOpenVisibleRuns && openStratView(defense.id)}
            disabled={!canOpenVisibleRuns}
            className={`rounded-2xl border px-3 py-2 text-sm font-medium transition ${
              canOpenVisibleRuns
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
                : "cursor-not-allowed border-zinc-600 bg-zinc-800/40 text-zinc-500 opacity-60"
            }`}
            title={
              canOpenVisibleRuns
                ? t("gvgCurrent.viewRuns", "Voir les runs disponibles")
                : t("gvgCurrent.noVisibleRun", "Aucun run visible pour ce compte")
            }
          >
            👀
          </button>

          <button
            type="button"
            onClick={() => openReproCandidates(defense)}
            className="rounded-2xl border border-zinc-500/40 bg-zinc-500/15 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-500/25"
            title={t("gvgCurrent.whoCanRepro", "Qui peut repro")}
          >
            ❓
          </button>

          <button
            type="button"
            onClick={() => markDefenseAsOpened(defense.id)}
            disabled={isOpeningDefense}
            className="rounded-2xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/25 disabled:cursor-wait disabled:opacity-70"
          >
            {isOpeningDefense ? t("common.saving", "Enregistrement...") : t("gvgCurrent.markAsOpen", "C'est ouvert")}
          </button>
        </div>

        {defense.image_url ? (
          <button
            type="button"
            onClick={() => openDefenseImage(defense)}
            className="group block w-full overflow-hidden rounded-xl border border-zinc-700/80 bg-black/40 shadow-sm transition hover:border-zinc-400/80"
            title={t("gvgCurrent.viewDefenseImage", "Voir l'image de la defense en grand")}
          >
            <img
              src={getDefenseImageUrl(defense)}
              alt={buildDefenseTitle(defense, t)}
              loading="lazy"
              decoding="async"
              className="h-36 w-full object-contain object-center transition duration-200 group-hover:scale-[1.02] sm:h-44 md:h-36 2xl:h-44"
            />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function renderDesktopSlot(slot, team) {
  const defense = selectedBastionAllDefenses.find((item) =>
    defenseMatchesDesktopSlot(item, slot, team)
  );
  const key = `slot-${selectedBastionId}-${slot.id}-${team}`;

  if (shouldShowDefenseForCurrentFilter(defense, selectedFilter)) {
    return renderDefenseCard(defense, key);
  }

  const slotLabel = buildDefenseTitle(
    {
      type: slot.type,
      tower: slot.tower,
      team,
    },
    t
  );
  const placeholderLabel =
    defense && hasOpenRecordStatus(defense)
      ? t("gvgCurrent.slotOpened", "Ouverte")
      : t("gvgCurrent.slotEmpty", "Vide");

  return (
    <div
      key={key}
      className="flex min-h-[14rem] w-full flex-col justify-between rounded-2xl border border-dashed border-zinc-800/90 bg-zinc-950/35 px-4 py-3 text-zinc-600"
    >
      <div>
        <div className="font-medium text-zinc-500">{slotLabel}</div>
        <div className="mt-1 text-sm text-zinc-600">{placeholderLabel}</div>
      </div>
      <div className="text-right text-xs uppercase tracking-[0.24em] text-zinc-700">
        {t("gvgCurrent.slotPlaceholder", "Emplacement")}
      </div>
    </div>
  );
}

  function getCounters(bastion) {
    const items = bastion.defenses || [];

    return {
      def: items.length,
      repro: items.filter((defense) => defense.status === "repro").length,
      strat: items.filter((defense) => defense.status === "strat").length,
    };
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl border-zinc-800 bg-zinc-900/70 shadow-2xl">
        <CardHeader className="border-b border-zinc-800">
          <CardTitle className="text-lg text-zinc-100">
            {t("gvg.current", "GVG en cours")}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6 p-4 md:p-6">
          {!selectedGuild ? (
            <div className="space-y-4">
              <div className="text-sm text-zinc-400">
                {t("gvg.chooseGuild", "Choisis la guilde a afficher.")}
              </div>

              <div className="flex flex-wrap gap-3">
                {visibleGuilds.map((guild) => (
                  <Button
                    key={guild}
                    type="button"
                    className="rounded-2xl"
                    onClick={() => {
                      localStorage.setItem("gvg_selected_guild", guild);
                      setSelectedGuild(guild);
                    }}
                  >
                    {getGvgGuildLabel(guild)}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-zinc-400">{t("gvg.selectedGuild", "Guilde selectionnee")}</div>
                  <div className="text-2xl font-semibold text-zinc-100">
                    {getGvgGuildLabel(selectedGuild)}
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="rounded-2xl border-zinc-700 text-zinc-200"
                  onClick={() => {
                    localStorage.removeItem("gvg_selected_guild");
                    setSelectedGuild("");
                    setSelectedFilter(null);
                    setSelectedBastionId(null);
                    setDefenses([]);
                    setMessage("");
                  }}
                >
                  {t("gvg.changeGuild", "Changer de guilde")}
                </Button>
              </div>

              {message ? (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-300">
                  {message}
                </div>
              ) : null}

              {loading ? (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-400">
                  {t("gvg.loading", "Chargement de la GVG...")}
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {bastions.map((bastion) => {
                  const counters = getCounters(bastion);

                  return (
                    <div
                      key={bastion.id}
                      className={`rounded-3xl border bg-zinc-950/60 p-4 text-left transition ${
                        selectedBastionId === bastion.id
                          ? "border-zinc-500"
                          : "border-zinc-800"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedBastionId(bastion.id);
                          setSelectedFilter("def");
                        }}
                        className="w-full text-left"
                      >
                        <div className="text-lg font-semibold text-zinc-100">
                          {formatTranslation(t, "gvgCurrent.bastionNumber", "Bastion {number}", {
                            number: bastion.id,
                          })}
                        </div>
                      </button>

                      <div className="mt-4 space-y-3">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedBastionId(bastion.id);
                            setSelectedFilter("def");
                          }}
                          className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2 transition ${
                            selectedBastionId === bastion.id && selectedFilter === "def"
                              ? "border-orange-400 bg-orange-500/20"
                              : "border-orange-500/30 bg-orange-500/10"
                          }`}
                        >
                          <span className="text-sm text-orange-200">
                            {t("gvgCurrent.def", "Def")}
                          </span>
                          <span className="text-base font-semibold text-orange-300">
                            {counters.def}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedBastionId(bastion.id);
                            setSelectedFilter("repro");
                          }}
                          className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2 transition ${
                            selectedBastionId === bastion.id && selectedFilter === "repro"
                              ? "border-blue-400 bg-blue-500/20"
                              : "border-blue-500/30 bg-blue-500/10"
                          }`}
                        >
                          <span className="text-sm text-blue-200">
                            {t("gvgCurrent.repro", "Repro")}
                          </span>
                          <span className="text-base font-semibold text-blue-300">
                            {counters.repro}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedBastionId(bastion.id);
                            setSelectedFilter("strat");
                          }}
                          className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2 transition ${
                            selectedBastionId === bastion.id && selectedFilter === "strat"
                              ? "border-emerald-400 bg-emerald-500/20"
                              : "border-emerald-500/30 bg-emerald-500/10"
                          }`}
                        >
                          <span className="text-sm text-emerald-200">
                            {t("gvgCurrent.strat", "Strat")}
                          </span>
                          <span className="text-base font-semibold text-emerald-300">
                            {counters.strat}
                          </span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {selectedBastion ? (
                <div className="rounded-3xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm text-zinc-400">
                        {t("gvgCurrent.selectedBastion", "Bastion selectionne")}
                      </div>
                      <div className="text-xl font-semibold text-zinc-100">
                        {formatTranslation(t, "gvgCurrent.bastionNumber", "Bastion {number}", {
                          number: selectedBastion.id,
                        })}
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl border-zinc-700 text-zinc-200"
                      onClick={() => setSelectedFilter("def")}
                    >
                      {t("gvgCurrent.viewAllDefenses", "Voir toutes les defenses")}
                    </Button>
                  </div>

                  <div className={`mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2 ${
                    selectedFilter === "def" ? "xl:hidden" : ""
                  }`}>
                    {filteredDefenses.length === 0 ? (
                      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-zinc-400">
                        {t("gvgCurrent.noDefenseForFilter", "Aucune defense pour ce filtre.")}
                      </div>
                    ) : (
                      filteredDefenses.map((defense) => {
                        const canOpenVisibleRuns =
                          defense.has_visible_run === true ||
                          Number(defense.visible_run_count || 0) > 0 ||
                          defense.record_status === "push";
                        const isOpeningDefense = openingDefenseIds.has(defense.id);

                        return (
                        <div
                          key={defense.id}
                          className={`w-full rounded-2xl border px-4 py-3 ${getStatusClasses(
                            defense.status
                          )}`}
                        >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="font-medium">
                              {buildDefenseTitle(defense, t)}
                            </div>

                            <div className="mt-1 text-sm opacity-80">
                              {getStatusLabel(defense.status, defense.repro_by, t)}
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-2">
                            <div className="text-sm font-semibold">
                              {buildDefenseShortTitle(defense, t)}
                            </div>

                            <div className="flex flex-wrap justify-end gap-2">
                              {defense.group_num ? (
                                <div
                                  className="rounded-2xl border border-zinc-600 bg-zinc-900/60 px-5 py-3 text-2xl font-bold leading-none text-zinc-100 shadow-sm"
                                  title={t("gvgCurrent.enemyGroupTitle", "Groupe de defenses ennemies identiques")}
                                >
                                  {toGroupEmoji(defense.group_num)}
                                </div>
                              ) : null}

                              {defense.mirror_group_num ? (
                                <div
                                  className="rounded-2xl border border-emerald-400/70 bg-emerald-500/15 px-5 py-3 text-2xl font-bold leading-none text-emerald-100 shadow-sm shadow-emerald-500/20"
                                  title={t(
                                    "gvgCurrent.mirrorGroupTitle",
                                    "Composition aussi presente cote allie : eviter en debut de GVG"
                                  )}
                                >
                                  {toGroupEmoji(defense.mirror_group_num)}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>

                          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,42%)] md:items-start">
                            <div className="flex flex-wrap gap-2">
                        <button
                        type="button"
                        onClick={() => openReproModal(defense.id)}
                        className="rounded-2xl border border-blue-500/40 bg-blue-500/15 px-3 py-2 text-sm font-medium text-blue-200 transition hover:bg-blue-500/25"
                        >
                        {reproLoading && reproDefenseId === defense.id
                          ? t("common.loading", "Chargement...")
                          : t("gvgCurrent.markAsRepro", "C'est repro")}
                        </button>

                            {defense.status === "repro" &&
                            defense.repro_by === currentWatcherName ? (
                              <button
                                type="button"
                                onClick={() => cancelDefenseRepro(defense.id)}
                                className="rounded-2xl border border-zinc-600 bg-zinc-800/60 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-700/70"
                              >
                                {t("gvgCurrent.cancelRepro", "Annuler repro")}
                              </button>
                            ) : null}
                            {defense.status === "repro" ? (
                            <button
                                type="button"
                                onClick={() => openReproView(defense.id)}
                                className="rounded-2xl border border-zinc-600 bg-zinc-800/60 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-700/70"
                            >
                                ⚔️
                            </button>
                            ) : null}
                            {defense.image_url ? (
                            <button
                              type="button"
                              onClick={() => openDefenseImage(defense)}
                              className="rounded-2xl border border-zinc-600 bg-zinc-800/60 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-700/70"
                            >
                              📸
                            </button>
                          ) : null}
  <button
    type="button"
    onClick={() => canOpenVisibleRuns && openStratView(defense.id)}
    disabled={!canOpenVisibleRuns}
    className={`rounded-2xl border px-3 py-2 text-sm font-medium transition ${
      canOpenVisibleRuns
        ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
        : "cursor-not-allowed border-zinc-600 bg-zinc-800/40 text-zinc-500 opacity-60"
    }`}
    title={
      canOpenVisibleRuns
        ? t("gvgCurrent.viewRuns", "Voir les runs disponibles")
        : t("gvgCurrent.noVisibleRun", "Aucun run visible pour ce compte")
    }
  >
    👀
  </button>

<button
  type="button"
  onClick={() => openReproCandidates(defense)}
  className="rounded-2xl border border-zinc-500/40 bg-zinc-500/15 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-500/25"
  title={t("gvgCurrent.whoCanRepro", "Qui peut repro")}
>
  ❓
</button>

<button
  type="button"
  onClick={() => markDefenseAsOpened(defense.id)}
  disabled={isOpeningDefense}
  className="rounded-2xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/25 disabled:cursor-wait disabled:opacity-70"
>
  {isOpeningDefense ? t("common.saving", "Enregistrement...") : t("gvgCurrent.markAsOpen", "C'est ouvert")}
</button>
                          </div>

                            {defense.image_url ? (
                              <button
                                type="button"
                                onClick={() => openDefenseImage(defense)}
                                className="group block w-full overflow-hidden rounded-xl border border-zinc-700/80 bg-black/40 shadow-sm transition hover:border-zinc-400/80"
                                title={t("gvgCurrent.viewDefenseImage", "Voir l'image de la defense en grand")}
                              >
                                <img
                                  src={getDefenseImageUrl(defense)}
                                  alt={buildDefenseTitle(defense, t)}
                                  loading="lazy"
                                  decoding="async"
                                  className="h-36 w-full object-contain object-center transition duration-200 group-hover:scale-[1.02] sm:h-44 md:h-36 2xl:h-44"
                                />
                              </button>
                            ) : null}
                        </div>
                        </div>
                        );
                      })
                    )}
                  </div>

                  {selectedFilter === "def" ? (
                    <div className="mt-4 hidden grid-cols-2 gap-3 xl:grid">
                      {GVG_CURRENT_SLOT_ROWS.flatMap((slot) =>
                        GVG_CURRENT_TEAMS.map((team) => renderDesktopSlot(slot, team))
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
              
            </div>
          )}
        </CardContent>
      </Card>
            {reproModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-zinc-800 bg-zinc-950 p-4 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-zinc-100">
                  {t("gvgCurrent.reproModalTitle", "Repro")}
                </div>
                <div className="text-sm text-zinc-400">
                  {t("gvgCurrent.reproModalHelp", "Complete les champs manquants")}
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="rounded-2xl border-zinc-700 text-zinc-200"
                onClick={() => {
                  setReproModalOpen(false);
                  setReproMessage("");
                }}
              >
                {t("common.close", "Fermer")}
              </Button>
            </div>

            <div className="mt-6 space-y-4">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="text-sm text-zinc-400">
                  {t("gvgCurrent.reproOn", "Repro sur")}
                </div>
                <div className="mt-1 text-base font-semibold text-zinc-100">
                  {reproWatcherName}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                  <label className="text-sm text-zinc-300">
                    {t("gvgCurrent.reproPlayerBp", "Repro k PB")}
                  </label>
                  <input
                    value={reproPlayerPb}
                    onChange={(e) => setReproPlayerPb(e.target.value)}
                    placeholder="..."
                    className="mt-2 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none"
                  />
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                  <label className="text-sm text-zinc-300">
                    {t("gvgCurrent.reproEnemyBp", "Adversaire k PB")}
                  </label>
                  <input
                    value={reproEnemyPb}
                    onChange={(e) => setReproEnemyPb(e.target.value)}
                    placeholder="..."
                    className="mt-2 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none"
                  />
                </div>
              </div>

              <div className="space-y-3">
                {reproHeroLines.map((line, index) => (
                  <div
                    key={index}
                    className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4"
                  >
                    <div className="text-sm text-zinc-300">
                      {formatTranslation(t, "gvgCurrent.heroSlot", "Heros {slot} :", {
                        slot: line.slot,
                      })}{" "}
                      <span className="font-semibold text-zinc-100">
                        {line.hero}{" "}
                        {Number(line.awakening) >= 0 ? `A${line.awakening}` : "A?"}
                      </span>
                    </div>

                    <input
                      value={line.stuff || ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        setReproHeroLines((prev) =>
                          prev.map((heroLine, heroIndex) =>
                            heroIndex === index
                              ? { ...heroLine, stuff: value }
                              : heroLine
                          )
                        );
                      }}
                      placeholder={t("gvgCurrent.stuffPlaceholder", "stuff en : ...")}
                      className="mt-2 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none"
                    />
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                <label className="text-sm text-zinc-300">
                  {t("gvgCurrent.artifact", "Artefact")}
                </label>
                <input
                  value={reproArtifact}
                  onChange={(e) => setReproArtifact(e.target.value)}
                  placeholder="..."
                  className="mt-2 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none"
                />
              </div>

              {reproMessage ? (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-zinc-300">
                  {reproMessage}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-3">
  <Button
    type="button"
    className="rounded-2xl"
    disabled={reproSaving}
    onClick={async () => {
      try {
        setReproSaving(true);
        setReproMessage("");

        const response = await fetch(`${apiBase}/api/gvg-repro`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "save",
            gvgDefenseId: reproDefenseId,
            memberId: session?.memberId || null,
            watcherName: reproWatcherName,
            playerPb: reproPlayerPb,
            enemyPb: reproEnemyPb,
            heroLines: reproHeroLines,
            artifact: reproArtifact,
          }),
        });

        const rawText = await response.text();
        let data = null;

        try {
          data = rawText ? JSON.parse(rawText) : null;
        } catch {
          setReproMessage(
            formatTranslation(t, "gvgCurrent.errorNonJson", "Reponse non JSON {context} ({status})", {
              context: "gvg-repro-save",
              status: response.status,
            })
          );
          return;
        }

        if (!response.ok) {
          setReproMessage(
            formatTranslation(t, "gvgCurrent.errorSaveRepro", "Erreur sauvegarde repro : {error}", {
              error: data?.error || t("common.unknownError", "erreur inconnue"),
            })
          );
          return;
        }

        await markDefenseAsRepro(reproDefenseId);
        setReproMessage(t("gvgCurrent.reproSaved", "Repro enregistree avec succes."));
        setReproModalOpen(false);
      } catch (error) {
        console.error("save repro modal error:", error);
        setReproMessage(
          formatTranslation(t, "gvgCurrent.errorSaveRepro", "Erreur sauvegarde repro : {error}", {
            error: error?.message || t("common.unknownError", "erreur inconnue"),
          })
        );
      } finally {
        setReproSaving(false);
      }
    }}
  >
    {reproSaving ? t("common.saving", "Enregistrement...") : t("gvgCurrent.saveRepro", "Enregistrer la repro")}
  </Button>
</div>

            </div>
          </div>
        </div>
      ) : null}
      {reproViewOpen ? (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <div className="w-full max-w-2xl rounded-3xl border border-zinc-800 bg-zinc-950 p-4 shadow-2xl">
      <div className="flex items-center justify-between">
        <div className="text-lg font-semibold text-zinc-100">
          {t("gvgCurrent.savedReproTitle", "Repro enregistree")}
        </div>

        <Button
          type="button"
          variant="outline"
          className="rounded-2xl border-zinc-700 text-zinc-200"
          onClick={() => setReproViewOpen(false)}
        >
          {t("common.close", "Fermer")}
        </Button>
      </div>

      <div className="mt-4 whitespace-pre-wrap rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-zinc-200">
        {reproViewLoading
          ? t("common.loading", "Chargement...")
          : reproViewMessage || reproViewText}
      </div>
    </div>
  </div>
) : null}
{imageModalOpen ? (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
    <div className="w-full max-w-4xl rounded-3xl border border-zinc-800 bg-zinc-950 p-4 shadow-2xl">
      
      <div className="flex items-center justify-between">
        <div className="text-lg font-semibold text-zinc-100">
          {imageModalTitle}
        </div>

        <Button
          type="button"
          variant="outline"
          className="rounded-2xl border-zinc-700 text-zinc-200"
          onClick={() => setImageModalOpen(false)}
        >
          {t("common.close", "Fermer")}
        </Button>
      </div>

      <div className="mt-4 flex items-center justify-center">
        <img
          src={imageModalUrl}
          alt={t("common.image", "Image")}
          className="max-h-[75vh] w-auto rounded-2xl border border-zinc-800"
        />
      </div>
    </div>
  </div>
) : null}
{stratModalOpen ? (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
    <div className="w-full max-w-3xl rounded-3xl border border-zinc-800 bg-zinc-950 p-4 shadow-2xl">

      <div className="flex items-center justify-between">
        <div className="text-lg font-semibold text-zinc-100">
          {t("gvgCurrent.availableStrats", "Strats disponibles")}
        </div>

        <Button
          type="button"
          variant="outline"
          className="rounded-2xl border-zinc-700 text-zinc-200"
          onClick={() => setStratModalOpen(false)}
        >
          {t("common.close", "Fermer")}
        </Button>
      </div>

      <div className="mt-4 space-y-4 max-h-[70vh] overflow-y-auto">

        {stratModalLoading ? (
          <div className="text-sm text-zinc-400">{t("common.loading", "Chargement...")}</div>
        ) : stratModalMessage ? (
          <div className="text-sm text-zinc-300">{stratModalMessage}</div>
        ) : (
          stratModalItems.map((strat, index) => (
            <div
              key={strat.strat_id || index}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm text-zinc-400">
                  {formatTranslation(t, "gvgCurrent.stratNumber", "Strat #{number}", {
                    number: strat.strat_id,
                  })}
                </div>
                {showExternalRunAlerts && isExternalRunGuildCode(strat.guild_code) ? (
                  <span className="rounded-full border border-amber-400/50 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold uppercase text-amber-100">
                    {formatTranslation(t, "gvgCurrent.externalRun", "Run externe - {guild}", {
                      guild: getGvgGuildLabel(strat.guild_code),
                    })}
                  </span>
                ) : null}
              </div>

{strat.youtube_url ? (
  <div className="mt-3 space-y-3">
    <div className="text-xs text-zinc-500">{t("gvgCurrent.video", "Video")} :</div>

    {getYoutubeEmbedUrl(strat.youtube_url) ? (
      <div className="overflow-hidden rounded-2xl border border-zinc-800">
        <iframe
          src={getYoutubeEmbedUrl(strat.youtube_url)}
          title={`Strat video ${strat.strat_id}`}
          className="h-64 w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    ) : (
      <a
        href={strat.youtube_url}
        target="_blank"
        rel="noreferrer"
        className="inline-block text-sm text-blue-400 underline"
      >
        {t("gvgCurrent.openVideo", "Ouvrir la video")}
      </a>
    )}
  </div>
) : null}

{strat.attack_code ? (
  <div className="mt-3 flex flex-wrap items-center gap-2">
    <div className="text-xs text-zinc-500">
      {t("gvgCurrent.code", "Code")} : {strat.attack_code}
    </div>

    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(strat.attack_code);
        } catch (error) {
          console.error("clipboard error:", error);
        }
      }}
      className="rounded-2xl border border-zinc-700 bg-zinc-800/60 px-3 py-1 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700/70"
    >
      {t("common.copy", "Copier")}
    </button>
  </div>
) : null}

{strat.commentaire ? (
  <div className="mt-2 text-sm text-zinc-200 whitespace-pre-wrap">
    {strat.commentaire}
  </div>
) : null}

              <div className="mt-3 text-xs text-zinc-500">
                {t("gvgCurrent.slots", "Slots")} :
              </div>

              <div className="mt-1 text-xs text-zinc-300">
                {strat.slots.map((s, i) => (
                  <div key={i}>
                    {translateChampionName(s.champion, championDisplayMap, language)} {s.position || ""} {s.direction || ""}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}

      </div>
    </div>
  </div>
) : null}

{reproCandidatesModalOpen && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
    <div className="w-[700px] max-h-[80vh] overflow-y-auto rounded-2xl bg-zinc-900 p-6">
      <div className="mb-4 text-lg font-bold text-zinc-50">
        {t("gvgCurrent.whoCanReproDefense", "Qui peut repro cette defense")}
      </div>

      <div className="mb-4 flex gap-4 text-sm text-zinc-400">
        {reproHeroes.map((h) => (
          <div key={h.champion_id} className="w-[100px] text-center">
            {translateChampionName(h.champion_name, championDisplayMap, language)}
          </div>
        ))}
      </div>

{[...reproCandidates]
  .sort((a, b) => {
    if (a.canRepro !== b.canRepro) {
      return a.canRepro ? -1 : 1;
    }

    return String(a.name).localeCompare(String(b.name), "fr", {
      sensitivity: "base",
    });
  })
  .map((c) => (
    <div
      key={c.memberId}
      className={`mb-2 rounded-xl border p-3 ${
        c.canRepro
          ? "border-emerald-500/30 bg-emerald-500/10"
          : "border-red-500/30 bg-red-500/10"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="font-medium text-zinc-50">
          {c.name}
        </div>

        <div
          className={`rounded-xl px-2 py-1 text-xs font-semibold ${
            c.canRepro
              ? "bg-emerald-500/20 text-emerald-300"
              : "bg-red-500/20 text-red-300"
          }`}
        >
          {c.canRepro
            ? `✅ ${t("gvgCurrent.canRepro", "Peut repro")}`
            : `❌ ${t("gvgCurrent.incomplete", "Incomplet")}`}
        </div>
      </div>

      <div className="flex gap-4 text-sm">
        {c.heroes.map((h, i) => (
          <div
            key={i}
            className={`w-[100px] text-center ${
              h.awakening >= 0 ? "text-emerald-300" : "text-red-300"
            }`}
          >
            {h.awakening >= 0 ? `A${h.awakening}` : "❌"}
          </div>
        ))}
      </div>
    </div>
  ))}

      <button
        type="button"
        onClick={() => setReproCandidatesModalOpen(false)}
        className="mt-4 rounded-xl bg-zinc-700 px-4 py-2 hover:bg-zinc-600"
      >
        {t("common.close", "Fermer")}
      </button>
    </div>
  </div>
)}
    </div>
  );
}
