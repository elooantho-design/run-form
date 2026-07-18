import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { RotateCcw, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { buildChampionDisplayMap, translateChampionName } from "@/lib/championDisplay";
import { getGvgGuildLabel, isExternalRunGuildCode, isPaladinAdminSession } from "@/lib/guildScope";
import { usePortalLanguage } from "@/lib/portalLanguage";
import { buildPublicHeroUrl } from "@/lib/vpsAssets";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MAX_SLOTS = 5;

const HEROES_FALLBACK = ["laya"];
const SPECIAL_EXTERNAL_DISCORD_ID = "266913883170668545";

const DIRS = [
  { v: "N", label: "N" },
  { v: "S", label: "S" },
  { v: "E", label: "E" },
  { v: "O", label: "O" },
];

const RUN_GRID_MODES = {
  tour: {
    key: "tour",
    label: "Tour",
    rows: 7,
    cols: 10,
    bgUrl: "/maps-actuelles/tour.png",
    bgObjectPosition: "center",
  },
  bastion: {
    key: "bastion",
    label: "Bastion",
    rows: 7,
    cols: 11,
    bgUrl: "/maps-actuelles/bastion.png",
    bgObjectPosition: "center",
  },
};

function makeRows(count) {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  return letters.slice(0, Math.max(0, count));
}

function makeCols(count) {
  return Array.from({ length: Math.max(0, count) }, (_, i) => String(i + 1));
}

function norm(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeChampionName(name) {
  if (!name) return "";
  return String(name)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\d+$/, "");
}

function getHeroImageSrc(heroName) {
  const name = normalizeChampionName(heroName);
  if (!name) return "";
  const fileName = `${name}.png`;
  return buildPublicHeroUrl(fileName) || `/heroes/${fileName}`;
}

const LOCAL_API_PORT = 3000;

function getApiBase() {
  if (typeof window === "undefined") return "";

  const { hostname } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `http://localhost:${LOCAL_API_PORT}`;
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

function parseTimeToSeconds(value) {
  if (!value) return 0;

  const raw = String(value).trim().toLowerCase();

  // format simple: t=123
  if (/^\d+$/.test(raw)) return Number(raw);

  // format: 1h2m3s
  const match = raw.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  if (!match) return 0;

  const h = Number(match[1] || 0);
  const m = Number(match[2] || 0);
  const s = Number(match[3] || 0);

  return h * 3600 + m * 60 + s;
}

function getYoutubeEmbedUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";

  let videoId = null;
  let start = 0;

  // youtu.be
  const shortMatch = value.match(/youtu\.be\/([^?&#]+)/i);
  if (shortMatch?.[1]) {
    videoId = shortMatch[1];

    const tMatch = value.match(/[?&#]t=([^&#]+)/i);
    if (tMatch) start = parseTimeToSeconds(tMatch[1]);
  }

  // youtube.com/watch
  const watchMatch = value.match(/[?&]v=([^?&#]+)/i);
  if (watchMatch?.[1]) {
    videoId = watchMatch[1];

    const tMatch = value.match(/[?&#]t=([^&#]+)/i);
    if (tMatch) start = parseTimeToSeconds(tMatch[1]);
  }

  if (!videoId) return "";

  let embed = `https://www.youtube.com/embed/${videoId}`;

  if (start > 0) {
    embed += `?start=${start}`;
  }

  return embed;
}

function getYoutubeThumbnail(url) {
  const value = String(url || "").trim();
  if (!value) return "";

  const shortMatch = value.match(/youtu\.be\/([^?&]+)/i);
  if (shortMatch?.[1]) {
    return `https://img.youtube.com/vi/${shortMatch[1]}/hqdefault.jpg`;
  }

  const watchMatch = value.match(/[?&]v=([^?&]+)/i);
  if (watchMatch?.[1]) {
    return `https://img.youtube.com/vi/${watchMatch[1]}/hqdefault.jpg`;
  }

  const embedMatch = value.match(/youtube\.com\/embed\/([^?&]+)/i);
  if (embedMatch?.[1]) {
    return `https://img.youtube.com/vi/${embedMatch[1]}/hqdefault.jpg`;
  }

  return "";
}

function getDirectionOverlayConfig(dir) {
  const d = String(dir || "").trim().toUpperCase();

  switch (d) {
    case "E":
      return {
        src: "/ui/hero-dir-e.png",
        width: "160%",
        height: "160%",
        left: "50%",
        top: "50%",
        transform: "translate(-43%, -49%)",
      };
    case "O":
      return {
        src: "/ui/hero-dir-o.png",
        width: "160%",
        height: "160%",
        left: "50%",
        top: "50%",
        transform: "translate(-57%, -51%)",
      };
    case "N":
      return {
        src: "/ui/hero-dir-n.png",
        width: "140%",
        height: "140%",
        left: "50%",
        top: "50%",
        transform: "translate(-49%, -55%)",
      };
    case "S":
      return {
        src: "/ui/hero-dir-s.png",
        width: "160%",
        height: "160%",
        left: "50%",
        top: "50%",
        transform: "translate(-51%, -46%)",
      };
    default:
      return null;
  }
}

export default function RunSearchGrid({ session: portalSession } = {}) {
  const { language, t } = usePortalLanguage();
  const [mode, setMode] = useState("tour");
  const [bgError, setBgError] = useState(false);

  const [slots, setSlots] = useState([]);
  const [results, setResults] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const apiBase = useMemo(() => getApiBase(), []);
  const [activePos, setActivePos] = useState(null);
  const [botCommand, setBotCommand] = useState("");
  const [botModalOpen, setBotModalOpen] = useState(false);
  const [botQueryItems, setBotQueryItems] = useState([]);
  const [includeBoycotted, setIncludeBoycotted] = useState(false);
  const [resultMessage, setResultMessage] = useState("");
  const [boycottUpdatingId, setBoycottUpdatingId] = useState(null);

  const dashboardSession = useMemo(() => {
    if (typeof window === "undefined") return null;

    try {
      return JSON.parse(localStorage.getItem("guildDashboardSession") || "null");
    } catch {
      return null;
    }
  }, []);
  const session = portalSession || dashboardSession;
  const runSessionPayload = useMemo(() => getRunSessionPayload(session), [session]);
  const targetGuildCode = runSessionPayload.guildCode || "G1";
  const showExternalRunAlerts = useMemo(() => isPaladinAdminSession(session), [session]);
  const isSpecialExternal =
    String(session?.discordId || session?.discord_id || "") === SPECIAL_EXTERNAL_DISCORD_ID;

  const [heroPool, setHeroPool] = useState(HEROES_FALLBACK);
  const [championDisplayMap, setChampionDisplayMap] = useState(() => new Map());
  const [heroesLoading, setHeroesLoading] = useState(false);
  const [heroesError, setHeroesError] = useState("");
  const [heroQuery, setHeroQuery] = useState("");

const gridSpec = useMemo(() => {
  return RUN_GRID_MODES[mode] || RUN_GRID_MODES.tour;
}, [mode]);

  const ROWS = useMemo(() => makeRows(gridSpec.rows).reverse(), [gridSpec.rows]);
  const COLS = useMemo(() => makeCols(gridSpec.cols), [gridSpec.cols]);

  const slotByPos = useMemo(() => {
    const map = new Map();
    for (const slot of slots) {
      if (slot && typeof slot.id === "string") {
        map.set(slot.id, slot);
      }
    }
    return map;
  }, [slots]);

  const activeSlot = activePos ? slotByPos.get(activePos) || null : null;
  const canAddMore = slots.length < MAX_SLOTS;

  async function runSearch() {
  const queryItems = slots
    .filter((s) => s.hero)
    .map((s) => ({
      champion: s.hero,
      position: s.id,
      direction: s.dir,
    }));

  if (!queryItems.length) return;

  try {
    setLoadingSearch(true);
    setResultMessage("");

    const res = await fetch(`${apiBase}/api/run?action=search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        queryItems,
        includeBoycotted,
        session: runSessionPayload,
        targetGuildCode,
      }),
    });

        if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status} - ${text.slice(0, 200)}`);
        }

    const data = await res.json();
    console.log("RUN_SEARCH_DATA", data);

    setResults(data || []);
  } catch (e) {
    console.error("Erreur recherche :", e);
  } finally {
    setLoadingSearch(false);
  }
}

function openBotCommandSearch() {
  const parsed = parseBotCommand(botCommand);

  if (!parsed.length) {
    return;
  }

  setBotQueryItems(parsed);
  setBotModalOpen(true);
}

async function runBotCommandSearch() {
  const queryItems = botQueryItems
    .map((item) => ({
      champion: item.champion,
      position: String(item.position || "").trim() || undefined,
      direction: String(item.direction || "").trim().toUpperCase() || undefined,
    }))
    .filter((item) => item.champion);

  if (!queryItems.length) return;

  try {
    setLoadingSearch(true);
    setResultMessage("");

    const res = await fetch(`${apiBase}/api/run?action=search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        queryItems,
        includeBoycotted,
        session: runSessionPayload,
        targetGuildCode,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status} - ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    setResults(data || []);
    setBotModalOpen(false);
  } catch (e) {
    console.error("Erreur recherche bot :", e);
  } finally {
    setLoadingSearch(false);
  }
}

  const filteredHeroes = useMemo(() => {
    const q = norm(heroQuery);
    const sortedPool = [...heroPool].sort((a, b) => norm(a).localeCompare(norm(b)));

    if (!q) return sortedPool.slice(0, 10);

    return sortedPool
      .filter((hero) => {
        const displayName = translateChampionName(hero, championDisplayMap, language);
        return norm(hero).startsWith(q) || norm(displayName).startsWith(q);
      })
      .slice(0, 10);
  }, [championDisplayMap, heroPool, heroQuery, language]);

    function resetAll() {
    setSlots([]);
    setActivePos(null);
    setHeroQuery("");
    setResults([]);
    }

  function isPosInGrid(pos) {
    if (!pos || typeof pos !== "string") return false;
    const r = pos.slice(0, 1);
    const c = pos.slice(1);
    return ROWS.includes(r) && COLS.includes(c);
  }

  function addOrSelectPos(pos) {
    if (!isPosInGrid(pos)) return;

    if (slotByPos.has(pos)) {
      const existing = slotByPos.get(pos);
      setActivePos(pos);
      setHeroQuery(translateChampionName(existing?.hero || "", championDisplayMap, language));
      return;
    }

    if (!canAddMore) return;

    const newSlot = { id: pos, hero: "", dir: "" };
    setSlots((prev) => [...prev, newSlot]);
    setActivePos(pos);
    setHeroQuery("");
  }

  function removePos(pos) {
    setSlots((prev) => prev.filter((slot) => slot && slot.id !== pos));
    setActivePos((current) => (current === pos ? null : current));
  }

  function updateActiveSlot(patch) {
    if (!activePos) return;

    setSlots((prev) =>
      prev.map((slot) =>
        slot && slot.id === activePos ? { ...slot, ...patch } : slot
      )
    );
  }

  useEffect(() => {
    setBgError(false);
  }, [mode]);

  useEffect(() => {
    let cancelled = false;

    async function loadAllChampions() {
      setHeroesLoading(true);
      setHeroesError("");

      try {
        const { data, error } = await supabase
          .from("champions")
          .select("*")
          .order("name", { ascending: true });

        if (error) throw error;

        const seen = new Set();
        const uniq = [];

        for (const row of data || []) {
          const name = String(row?.name || "").trim();
          if (!name) continue;

          const normalized = norm(name);
          if (!normalized || seen.has(normalized)) continue;

          seen.add(normalized);
          uniq.push(name.toLowerCase());
        }

        if (!cancelled && uniq.length) {
          setHeroPool(uniq);
          setChampionDisplayMap(buildChampionDisplayMap(data || []));
        }
      } catch (e) {
        if (!cancelled) {
          setHeroesError(`Erreur Supabase: ${String(e?.message || e)}`);
        }
      } finally {
        if (!cancelled) setHeroesLoading(false);
      }
    }

    loadAllChampions();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activePos && !isPosInGrid(activePos)) {
      setActivePos(null);
      setHeroQuery("");
    }

    setSlots((prev) =>
      prev.filter((slot) => slot && typeof slot.id === "string" && isPosInGrid(slot.id))
    );
  }, [ROWS, COLS, activePos]);

  useEffect(() => {
    if (slots.length === 1 && !activePos && slots[0]?.id) {
      setActivePos(slots[0].id);
      setHeroQuery(translateChampionName(slots[0].hero || "", championDisplayMap, language));
    }

    if (slots.length === 0) {
      setHeroQuery("");
    }
  }, [championDisplayMap, language, slots, activePos]);

function parseBotCommand(input) {
  const text = String(input || "").trim().toLowerCase();
  const regex = /personnage_\d+\s*:\s*([a-z0-9_à-ÿ-]+)/gi;

  const items = [];
  let match;

  while ((match = regex.exec(text))) {
    const champion = String(match[1] || "").trim();
    if (!champion) continue;

    items.push({
      champion,
      position: "",
      direction: "",
    });
  }

  return items.slice(0, 5);
}

function updateBotQueryItem(index, patch) {
  setBotQueryItems((prev) =>
    prev.map((item, i) =>
      i === index
        ? { ...item, ...patch }
        : item
    )
  );
}

function copyToClipboard(text) {
  if (!text) return;

  navigator.clipboard.writeText(text)
    .then(() => {
      console.log("Copié !");
    })
    .catch((err) => {
      console.error("Erreur copie :", err);
    });
}

async function toggleResultBoycott(result, nextBoycott) {
  const stratId = result?.strat_id;
  if (!stratId) return;

  try {
    setBoycottUpdatingId(stratId);
    setResultMessage("");

    const response = await fetch(`${apiBase}/api/run?action=boycott`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: runSessionPayload,
        strat_id: stratId,
        targetGuildCode,
        boycott: nextBoycott,
      }),
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setResultMessage(`Erreur boycott : reponse non JSON (${response.status})`);
      return;
    }

    if (!response.ok) {
      setResultMessage(`Erreur boycott : ${data?.error || "action refusee"}`);
      return;
    }

    setResults((prev) => {
      if (nextBoycott && !includeBoycotted) {
        return prev.filter((item) => item.strat_id !== stratId);
      }

      return prev.map((item) =>
        item.strat_id === stratId ? { ...item, boycott: nextBoycott } : item
      );
    });

    setResultMessage(
      nextBoycott
        ? `Strat #${stratId} masquee pour ${data?.guild_code || targetGuildCode}.`
        : `Strat #${stratId} reactivee pour ${data?.guild_code || targetGuildCode}.`
    );
  } catch (error) {
    console.error("Erreur toggle boycott:", error);
    setResultMessage(`Erreur boycott : ${error?.message || "erreur inconnue"}`);
  } finally {
    setBoycottUpdatingId(null);
  }
}

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl border-zinc-800 bg-zinc-900/70 shadow-2xl">
        <CardHeader className="border-b border-zinc-800">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <CardTitle className="text-lg text-zinc-100">{t("run.search.title", "Recherche de run")}</CardTitle>
              <div className="mt-1 text-sm text-zinc-400">
                {t("run.helper", "Clique jusqu'a 5 cases, puis renseigne heros et direction.").replace("5", MAX_SLOTS)}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={resetAll}
                className="rounded-2xl border-zinc-700 text-zinc-200"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                {t("common.reset", "Reset")}
              </Button>
              <Button
                type="button"
                variant={includeBoycotted ? "default" : "outline"}
                onClick={() => setIncludeBoycotted((current) => !current)}
                className="rounded-2xl"
              >
                {includeBoycotted
                  ? t("run.showingBoycotted", "Boycottes visibles")
                  : t("run.includeBoycotted", "Inclure boycottes")}
              </Button>
                <Button
                onClick={runSearch}
                className="rounded-2xl"
                >
                {t("common.search", "Rechercher")}
                </Button>
              <select
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value);
                  resetAll();
                }}
                className="rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              >
                <option value="tour">Tour</option>
                <option value="bastion">Bastion</option>
              </select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-3 sm:p-4 md:p-6">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_380px]">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-2 sm:p-3">
              <div className="relative overflow-hidden rounded-2xl">
                <div className="relative p-2 sm:p-3 md:p-5">
                  <div className="relative">
                    {!bgError ? (
                      <img
                        src={gridSpec.bgUrl}
                        alt={t("run.mapReference", "Reference")}
                        className="absolute"
                        style={{
                        left: "clamp(20px, 4vw, 36px)",
                        top: "clamp(16px, 3vw, 24px)",
                        width: "calc(100% - clamp(20px, 4vw, 36px))",
                        height: "calc(100% - clamp(16px, 3vw, 24px))",
                        objectFit: "cover",
                        objectPosition: gridSpec.bgObjectPosition,
                        opacity: 0.75,
                        borderRadius: 16,
                        zIndex: 0,
                        }}
                        referrerPolicy="no-referrer"
                        onError={() => setBgError(true)}
                        draggable={false}
                      />
                    ) : (
                      <div
                        className="absolute"
                        style={{
                        left: "clamp(20px, 4vw, 36px)",
                        top: "clamp(16px, 3vw, 24px)",
                        width: "calc(100% - clamp(20px, 4vw, 36px))",
                        height: "calc(100% - clamp(16px, 3vw, 24px))",
                        borderRadius: 16,
                        zIndex: 0,
                          background:
                            mode === "tour"
                              ? "radial-gradient(circle at 20% 20%, rgba(0,0,0,0.10), transparent 45%), radial-gradient(circle at 80% 30%, rgba(0,0,0,0.12), transparent 45%), linear-gradient(135deg, rgba(0,0,0,0.06), transparent)"
                              : "radial-gradient(circle at 30% 70%, rgba(0,0,0,0.10), transparent 45%), radial-gradient(circle at 70% 60%, rgba(0,0,0,0.12), transparent 45%), linear-gradient(135deg, rgba(0,0,0,0.06), transparent)",
                          opacity: 0.85,
                        }}
                      />
                    )}

                    <div
                      className="grid relative"
                      style={{
                gridTemplateColumns: `clamp(20px, 4vw, 36px) repeat(${gridSpec.cols}, minmax(0, 1fr))`,
                gridTemplateRows: `clamp(16px, 3vw, 24px) repeat(${gridSpec.rows}, minmax(0, 1fr))`,
                        zIndex: 1,
                      }}
                    >
                      <div />
                      {COLS.map((c) => (
                        <div
                          key={c}
                          className="select-none pb-2 text-center text-xs text-zinc-400"
                          style={{ alignSelf: "end" }}
                        >
                          {c}
                        </div>
                      ))}

                      {ROWS.map((r) => (
                        <React.Fragment key={r}>
                          <div className="flex select-none items-center justify-end pr-2 text-xs text-zinc-400">
                            {r}
                          </div>

                          {COLS.map((c) => {
                            const pos = `${r}${c}`;
                            const isSelected = slotByPos.has(pos);
                            const isActive = activePos === pos;
                            const slot = slotByPos.get(pos);
                            const isComplete =
                              slot &&
                              String(slot.hero || "").trim() &&
                              String(slot.dir || "").trim();

                            return (
                              <button
                                key={pos}
                                type="button"
                                onClick={() => addOrSelectPos(pos)}
                                className={
                                  `relative aspect-square rounded-xl border transition ` +
                                  (isComplete
                                    ? "border-emerald-500 bg-emerald-500/30 "
                                    : isSelected
                                      ? "bg-zinc-900/80 border-zinc-600 "
                                      : "bg-zinc-900/40 border-zinc-800 ") +
                                  (isActive ? "ring-2 ring-blue-400" : "hover:bg-zinc-800/80")
                                }
                                aria-label={`Case ${pos}`}
                                disabled={!isSelected && !canAddMore}
                              >
                                <div
                                  className="absolute inset-0 rounded-xl"
                                  style={{ boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.03)" }}
                                />

                                <div className="absolute left-2 top-2 flex items-center gap-1">
                                  {isSelected ? (
                                    <Badge className="px-1.5 text-[10px]">
                                      {(slot && slot.dir) || "•"}
                                    </Badge>
                                  ) : (
                                    <span className="text-[10px] text-zinc-500">&nbsp;</span>
                                  )}
                                </div>

                                <div className="absolute inset-0 flex items-center justify-center p-1">
                                  {isSelected ? (
                                    slot && slot.hero ? (
                                      <div className="relative flex h-full w-full items-center justify-center overflow-visible">
                                        <img
                                          src={getHeroImageSrc(slot.hero)}
                                          alt={translateChampionName(slot.hero, championDisplayMap, language)}
                                          className="max-h-[72%] max-w-[72%] object-contain"
                                          onError={(e) => {
                                            e.currentTarget.style.display = "none";
                                          }}
                                        />

                                        {slot.dir ? (() => {
                                          const overlay = getDirectionOverlayConfig(slot.dir);
                                          if (!overlay) return null;

                                          return (
                                            <img
                                              src={overlay.src}
                                              alt=""
                                              aria-hidden="true"
                                              className="pointer-events-none absolute select-none"
                                              style={{
                                                width: overlay.width,
                                                height: overlay.height,
                                                objectFit: "contain",
                                                left: overlay.left,
                                                top: overlay.top,
                                                transform: overlay.transform,
                                              }}
                                              draggable={false}
                                            />
                                          );
                                        })() : null}
                                      </div>
                                    ) : (
                                      <div className="max-w-[90%] truncate text-[11px] font-medium text-zinc-200">
                                        (héros)
                                      </div>
                                    )
                                  ) : (
                                    <div className="text-[11px] text-zinc-500">+</div>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 text-xs text-zinc-400">
                    {gridSpec.label}: {gridSpec.rows} {t("run.rows", "lignes")} x {gridSpec.cols} {t("run.columns", "colonnes")}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <Card className="rounded-3xl border-zinc-800 bg-zinc-950/60">
                <CardHeader className="border-b border-zinc-800">
                  <CardTitle className="text-base text-zinc-100">{t("run.editor", "Edition")}</CardTitle>
                </CardHeader>

                <CardContent className="space-y-4 p-4">
                  {!activeSlot ? (
                    <div className="text-sm text-zinc-400">
                      {t("run.clickGrid", "Clique une case dans la grille.")}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm text-zinc-400">{t("common.position", "Position")}</div>
                          <div className="text-2xl font-semibold text-zinc-100">
                            {activeSlot.id}
                          </div>
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => removePos(activeSlot.id)}
                          className="rounded-2xl"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm text-zinc-300">
                          {t("common.hero", "Heros")} {heroesLoading ? t("common.loadingParenthesis", "(chargement...)") : ""}
                        </label>

                        <Input
                          value={heroQuery}
                          onChange={(e) => setHeroQuery(e.target.value)}
                          placeholder={t("run.startTyping", "Commence a taper...")}
                          className="rounded-2xl border-zinc-700 bg-zinc-950 text-zinc-100"
                        />

                        {heroesError ? (
                          <div className="text-xs text-zinc-500">{heroesError}</div>
                        ) : null}

                        <div className="flex flex-wrap gap-2">
                          {filteredHeroes.map((h) => (
                            <Button
                              key={h}
                              type="button"
                              variant={activeSlot.hero === h ? "default" : "outline"}
                              onClick={() => {
                                setHeroQuery(translateChampionName(h, championDisplayMap, language));
                                updateActiveSlot({ hero: h });
                              }}
                              className="rounded-2xl"
                            >
                              {translateChampionName(h, championDisplayMap, language)}
                            </Button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm text-zinc-300">{t("common.direction", "Direction")}</label>

                        <div className="grid grid-cols-4 gap-2">
                          {DIRS.map((d) => (
                            <Button
                              key={d.v}
                              type="button"
                              variant={activeSlot.dir === d.v ? "default" : "outline"}
                              onClick={() => updateActiveSlot({ dir: d.v })}
                              className="rounded-2xl"
                            >
                              {d.label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-zinc-800 bg-zinc-950/60">
                <CardHeader className="border-b border-zinc-800">
                  <CardTitle className="text-base text-zinc-100">{t("run.currentSelection", "Selection actuelle")}</CardTitle>
                </CardHeader>

                <CardContent className="p-4">
                  <div className="flex flex-wrap gap-2">
                    {slots.length === 0 ? (
                      <Badge>{t("common.none", "Aucune")}</Badge>
                    ) : (
                      [...slots]
                        .filter((slot) => slot && slot.id)
                        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
                        .map((slot) => {
                          const isIncomplete =
                            !String(slot.hero || "").trim() || !String(slot.dir || "").trim();

                          return (
                            <button
                              key={slot.id}
                              type="button"
                              onClick={() => {
                                setActivePos(slot.id);
                                setHeroQuery(translateChampionName(slot.hero || "", championDisplayMap, language));
                              }}
                              className="text-left"
                            >
                              <Badge
                                className={
                                  isIncomplete
                                    ? "border-red-700 bg-red-600 text-white"
                                    : "border-emerald-700 bg-emerald-600 text-white"
                                }
                              >
                                {slot.id} - {slot.hero ? translateChampionName(slot.hero, championDisplayMap, language) : t("run.emptyHero", "(heros)")} - {slot.dir || t("run.emptyDirection", "(dir)")}
                              </Badge>
                            </button>
                          );
                        })
                    )}
                  </div>
                </CardContent>
                           </Card>
            </div>
          </div>

          <Card className="rounded-3xl border-zinc-800 bg-zinc-950/60">
            <CardHeader className="border-b border-zinc-800">
                        {isSpecialExternal && (
            <Card className="rounded-3xl border-zinc-800 bg-zinc-950/60">
              <CardHeader className="border-b border-zinc-800">
                <CardTitle className="text-base text-zinc-100">
                  {t("run.botSearch", "Recherche via commande bot")}
                </CardTitle>
              </CardHeader>

              <CardContent className="p-4">
                <div className="space-y-3">
                  <div className="text-sm text-zinc-400">
                    {t("run.botSearchHelp", "Colle la commande generee par son bot, puis affine si besoin.")}
                  </div>

                  <div className="flex flex-col gap-2 md:flex-row">
                    <textarea
                      value={botCommand}
                      onChange={(e) => setBotCommand(e.target.value)}
                      placeholder="Ex: recherche personnage_1:comtedracula personnage_2:nezha ..."
                      className="min-h-[90px] flex-1 rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none"
                    />

                    <Button
                      type="button"
                      onClick={openBotCommandSearch}
                      className="rounded-2xl"
                    >
                      {t("run.launchSearch", "Lancer la recherche")}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
              <CardTitle className="text-base text-zinc-100">{t("run.results", "Resultats")}</CardTitle>
            </CardHeader>

            <CardContent className="p-4">
              {resultMessage ? (
                <div className="mb-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-sm text-zinc-300">
                  {resultMessage}
                </div>
              ) : null}

              {loadingSearch ? (
                <div className="text-sm text-zinc-400">{t("run.searching", "Recherche en cours...")}</div>
              ) : results.length === 0 ? (
                <div className="text-sm text-zinc-400">{t("run.noResult", "Aucun resultat affiche.")}</div>
              ) : (
                <div className="space-y-4">
                  {results.map((result) => (
                    <div
                      key={result.strat_id}
                      className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4"
                    >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-zinc-100">
                            Strat #{result.strat_id}
                        </div>
                        <Badge className="border-zinc-600 bg-zinc-900 text-zinc-200">
                          {result.guild_code || "PALADIN"}
                        </Badge>
                        {showExternalRunAlerts && isExternalRunGuildCode(result.guild_code) ? (
                          <Badge className="border-amber-400/50 bg-amber-400/10 text-amber-100">
                            Run externe - {getGvgGuildLabel(result.guild_code)}
                          </Badge>
                        ) : null}
                        {result.boycott ? (
                          <Badge className="border-red-500/40 bg-red-500/15 text-red-200">
                            {t("run.boycottBadge", "Boycott")}
                          </Badge>
                        ) : null}
                      </div>

                      <Button
                        type="button"
                        size="sm"
                        variant={result.boycott ? "default" : "outline"}
                        disabled={boycottUpdatingId === result.strat_id}
                        onClick={() => toggleResultBoycott(result, !result.boycott)}
                        className="rounded-xl"
                      >
                        {boycottUpdatingId === result.strat_id
                          ? t("common.loading", "Chargement...")
                          : result.boycott
                            ? t("run.reactivateForGuild", "Repasser actif")
                            : t("run.boycottForGuild", "Boycotter")}
                      </Button>
                    </div>

{result.youtube_url ? (
  <div className="mt-2 space-y-2">
    {getYoutubeEmbedUrl(result.youtube_url) ? (
      <div className="overflow-hidden rounded-xl border border-zinc-800">
        <div className="aspect-video w-full">
          <iframe
            src={getYoutubeEmbedUrl(result.youtube_url)}
            title={`Vidéo strat ${result.strat_id}`}
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      </div>
    ) : getYoutubeThumbnail(result.youtube_url) ? (
      <div className="overflow-hidden rounded-xl border border-zinc-800">
        <img
          src={getYoutubeThumbnail(result.youtube_url)}
          alt={`Miniature vidéo strat ${result.strat_id}`}
          className="h-auto w-full object-cover"
          loading="lazy"
        />
      </div>
    ) : null}

    <a
      href={result.youtube_url}
      target="_blank"
      rel="noreferrer"
      className="block text-sm text-blue-400 underline"
    >
      Voir la vidéo
    </a>
  </div>
) : null}

{result.attack_code ? (
  <div className="mt-2 text-xs text-zinc-300 space-y-1">
    <div className="font-medium text-zinc-100">Code d’attaque :</div>

    <div className="flex items-start gap-2">
      <div className="break-all flex-1">
        {result.attack_code}
      </div>

      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => copyToClipboard(result.attack_code)}
        className="shrink-0 rounded-xl px-2 py-1 text-xs"
      >
        Copier
      </Button>
    </div>
  </div>
) : null}

                {result.commentaire ? (
                <div className="mt-2 text-sm text-zinc-300">
                    {result.commentaire}
                </div>
                ) : null}

                <div className="mt-3 space-y-1 text-xs text-zinc-400">
                        {(result.slots || []).map((slot, index) => (
                          <div key={`${result.strat_id}-${index}`}>
                            {translateChampionName(slot.champion, championDisplayMap, language)} — {slot.position || "-"} / {slot.direction || "-"}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        </CardContent>
      </Card>
            {botModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-3xl rounded-3xl border border-zinc-800 bg-zinc-900 shadow-2xl">
            <div className="border-b border-zinc-800 px-6 py-4">
              <div className="text-lg font-semibold text-zinc-100">
                Affiner la recherche
              </div>
              <div className="mt-1 text-sm text-zinc-400">
                Tu peux laisser vide pour chercher uniquement par héros, ou préciser
                certaines positions et directions.
              </div>
            </div>

            <div className="space-y-3 px-6 py-4">
              {botQueryItems.map((item, index) => (
                <div
                  key={`${item.champion}-${index}`}
                  className="grid grid-cols-1 gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3 md:grid-cols-[180px_1fr_120px]"
                >
                  <div className="flex items-center text-sm font-medium text-zinc-100">
                    {translateChampionName(item.champion, championDisplayMap, language)}
                  </div>

                  <Input
                    value={item.position}
                    onChange={(e) =>
                      updateBotQueryItem(index, {
                        position: e.target.value.toUpperCase(),
                      })
                    }
                    placeholder="Position (ex: C4)"
                    className="rounded-2xl border-zinc-700 bg-zinc-950 text-zinc-100"
                  />

                  <Select
                    value={item.direction || "__empty__"}
                    onValueChange={(value) =>
                      updateBotQueryItem(index, {
                        direction: value === "__empty__" ? "" : value,
                      })
                    }
                  >
                    <SelectTrigger className="rounded-2xl border-zinc-700 bg-zinc-950 text-zinc-100">
                      <SelectValue placeholder="Direction" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__empty__">Aucune</SelectItem>
                      <SelectItem value="N">N</SelectItem>
                      <SelectItem value="S">S</SelectItem>
                      <SelectItem value="E">E</SelectItem>
                      <SelectItem value="O">O</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 border-t border-zinc-800 px-6 py-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setBotModalOpen(false)}
                className="rounded-2xl border-zinc-700 text-zinc-200"
              >
                Annuler
              </Button>

              <Button
                type="button"
                onClick={runBotCommandSearch}
                className="rounded-2xl"
              >
                Rechercher
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
