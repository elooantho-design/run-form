import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { RotateCcw, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const MAX_SLOTS = 5;

const HEROES_FALLBACK = ["laya"];

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
    bgObjectPosition: "center 55%",
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
  return name ? `/heroes/${name}.png` : "";
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

function getYoutubeEmbedUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";

  const shortMatch = value.match(/youtu\.be\/([^?&]+)/i);
  if (shortMatch?.[1]) {
    return `https://www.youtube.com/embed/${shortMatch[1]}`;
  }

  const watchMatch = value.match(/[?&]v=([^?&]+)/i);
  if (watchMatch?.[1]) {
    return `https://www.youtube.com/embed/${watchMatch[1]}`;
  }

  const embedMatch = value.match(/youtube\.com\/embed\/([^?&]+)/i);
  if (embedMatch?.[1]) {
    return `https://www.youtube.com/embed/${embedMatch[1]}`;
  }

  return "";
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

export default function RunSearchGrid() {
  const [mode, setMode] = useState("tour");
  const [bgError, setBgError] = useState(false);

  const [slots, setSlots] = useState([]);
  const [results, setResults] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const apiBase = useMemo(() => getApiBase(), []);
  const [activePos, setActivePos] = useState(null);

  const [heroPool, setHeroPool] = useState(HEROES_FALLBACK);
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

    const res = await fetch(`${apiBase}/api/run-search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ queryItems }),
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

  const filteredHeroes = useMemo(() => {
    const q = norm(heroQuery);
    const sortedPool = [...heroPool].sort((a, b) => norm(a).localeCompare(norm(b)));

    if (!q) return sortedPool.slice(0, 10);

    return sortedPool.filter((hero) => norm(hero).startsWith(q)).slice(0, 10);
  }, [heroPool, heroQuery]);

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
      setHeroQuery(existing?.hero || "");
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
          .select("name")
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
      setHeroQuery(slots[0].hero || "");
    }

    if (slots.length === 0) {
      setHeroQuery("");
    }
  }, [slots, activePos]);

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

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl border-zinc-800 bg-zinc-900/70 shadow-2xl">
        <CardHeader className="border-b border-zinc-800">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <CardTitle className="text-lg text-zinc-100">Recherche de run</CardTitle>
              <div className="mt-1 text-sm text-zinc-400">
                Clique jusqu’à {MAX_SLOTS} cases, puis renseigne héros et direction.
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={resetAll}
                className="rounded-2xl border-zinc-700 text-zinc-200"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset
              </Button>
                <Button
                onClick={runSearch}
                className="rounded-2xl"
                >
                Rechercher
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

        <CardContent className="p-6">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_380px]">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3">
              <div className="relative overflow-hidden rounded-2xl">
                <div className="relative p-3 md:p-5">
                  <div className="relative">
                    {!bgError ? (
                      <img
                        src={gridSpec.bgUrl}
                        alt="Référence"
                        className="absolute"
                        style={{
                          left: 36,
                          top: 24,
                          width: "calc(100% - 36px)",
                          height: "calc(100% - 24px)",
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
                          left: 36,
                          top: 24,
                          width: "calc(100% - 36px)",
                          height: "calc(100% - 24px)",
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
                        gridTemplateColumns: `36px repeat(${gridSpec.cols}, minmax(0, 1fr))`,
                        gridTemplateRows: `24px repeat(${gridSpec.rows}, minmax(0, 1fr))`,
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
                                          alt={slot.hero}
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
                    {gridSpec.label}: {gridSpec.rows} lignes × {gridSpec.cols} colonnes
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <Card className="rounded-3xl border-zinc-800 bg-zinc-950/60">
                <CardHeader className="border-b border-zinc-800">
                  <CardTitle className="text-base text-zinc-100">Édition</CardTitle>
                </CardHeader>

                <CardContent className="space-y-4 p-4">
                  {!activeSlot ? (
                    <div className="text-sm text-zinc-400">
                      Clique une case dans la grille.
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm text-zinc-400">Position</div>
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
                          Héros {heroesLoading ? "(chargement...)" : ""}
                        </label>

                        <Input
                          value={heroQuery}
                          onChange={(e) => setHeroQuery(e.target.value)}
                          placeholder="Commence à taper…"
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
                                setHeroQuery(h);
                                updateActiveSlot({ hero: h });
                              }}
                              className="rounded-2xl"
                            >
                              {h}
                            </Button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm text-zinc-300">Direction</label>

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
                  <CardTitle className="text-base text-zinc-100">Sélection actuelle</CardTitle>
                </CardHeader>

                <CardContent className="p-4">
                  <div className="flex flex-wrap gap-2">
                    {slots.length === 0 ? (
                      <Badge>Aucune</Badge>
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
                                setHeroQuery(slot.hero || "");
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
                                {slot.id} · {slot.hero || "(héros)"} · {slot.dir || "(dir)"}
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
              <CardTitle className="text-base text-zinc-100">Résultats</CardTitle>
            </CardHeader>

            <CardContent className="p-4">
              {loadingSearch ? (
                <div className="text-sm text-zinc-400">Recherche en cours...</div>
              ) : results.length === 0 ? (
                <div className="text-sm text-zinc-400">Aucun résultat affiché.</div>
              ) : (
                <div className="space-y-4">
                  {results.map((result) => (
                    <div
                      key={result.strat_id}
                      className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4"
                    >
                    <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-zinc-100">
                        Strat #{result.strat_id}
                    </div>
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
                            {slot.champion} — {slot.position || "-"} / {slot.direction || "-"}
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
    </div>
  );
}