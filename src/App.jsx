import React, { useEffect, useMemo, useState } from "react";
import { RotateCcw, Trash2, Info } from "lucide-react";

// --- Composants UI simples (remplacent ceux du canvas ChatGPT) ---
const Card = ({children,className=""}) => <div className={`border rounded-xl bg-white/5 ${className}`}>{children}</div>;
const CardHeader = ({children,className=""}) => <div className={`p-3 border-b ${className}`}>{children}</div>;
const CardContent = ({ children, className = "" }) => <div className={`p-3 ${className}`}>{children}</div>;
const CardTitle = ({children,className=""}) => <h3 className={`font-semibold ${className}`}>{children}</h3>;

const Button = ({children,onClick,disabled,className="",variant="default",size="md",type="button"}) => (
  <button
    type={type}
    disabled={disabled}
    onClick={onClick}
    className={`px-3 py-2 rounded border text-sm ${disabled?"opacity-50":"hover:bg-gray-200"} ${className}`}
  >
    {children}
  </button>
);

const Input = ({ className = "", ...props }) => (
  <input {...props} className={`border rounded px-2 py-1 w-full text-sm ${className}`} />
);

const Textarea = ({ className = "", ...props }) => (
  <textarea {...props} className={`border rounded px-2 py-1 w-full text-sm ${className}`} />
);
const Label = ({children}) => <label className="text-sm font-medium">{children}</label>;
const Badge = ({children,className=""}) => <span className={`px-2 py-1 text-xs border rounded ${className}`}>{children}</span>;
const Separator = () => <div className="border-t my-3" />;

const Select = ({value,onValueChange,children}) => (
  <select value={value} onChange={(e)=>onValueChange(e.target.value)} className="border rounded px-2 py-1 text-sm">
    {children}
  </select>
);
const SelectItem = ({value,children}) => <option value={value}>{children}</option>;
const SelectContent = ({children}) => <>{children}</>;
const SelectTrigger = ({children}) => <>{children}</>;
const SelectValue = () => null;

const MAX_SLOTS = 5;
const BOT_MARKER = "RUN_FORM_V1";
const LOCAL_API_PORT = 3210;
// Quand tu héberges le formulaire derrière le bot/ngrok, laisse vide pour utiliser le même domaine.
// Tu peux aussi coller ici une URL publique explicite si besoin.
const PUBLIC_API_BASE = "";

const HEROES_FALLBACK = [

  "laya",

];

const DIRS = [
  { v: "N", label: "N" },
  { v: "S", label: "S" },
  { v: "E", label: "E" },
  { v: "O", label: "O" },
];

const BASTION_BG_URL = "https://i.imgur.com/COaAm3p.jpeg";
const TOUR_BG_URL = "https://i.imgur.com/PrufUJf.jpeg";

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

function normalizeApiDirToForm(dir) {
  const d = String(dir || "").trim().toLowerCase();

  if (d === "n" || d === "nord") return "N";
  if (d === "s" || d === "sud") return "S";
  if (d === "e" || d === "est") return "E";
  if (d === "o" || d === "ouest" || d === "w") return "O";

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

function getApiBase() {
  if (typeof window === "undefined") return null;

  if (PUBLIC_API_BASE) {
    return PUBLIC_API_BASE.replace(/\/$/, "");
  }

  const { protocol, hostname, origin } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `http://localhost:${LOCAL_API_PORT}`;
  }

  if (protocol === "https:" || protocol === "http:") {
    return origin;
  }

  return null;
}



export default function PrototypeFormulaireRunGrille() {
  const [mode, setMode] = useState("tour");
  const [bgError, setBgError] = useState(false);

  const [slots, setSlots] = useState([]);
  const [activePos, setActivePos] = useState(null);

  const [heroPool, setHeroPool] = useState(HEROES_FALLBACK);
  const [heroesLoading, setHeroesLoading] = useState(false);
  const [heroesError, setHeroesError] = useState("");
  const [heroesLoaded, setHeroesLoaded] = useState(false);
  const [heroQuery, setHeroQuery] = useState("");

  const [youtube, setYoutube] = useState("");
  const [authorId, setAuthorId] = useState("");
  const [attackCode, setAttackCode] = useState("");
  const [comment, setComment] = useState("");

  const [submitState, setSubmitState] = useState("idle");
  const [submitError, setSubmitError] = useState("");
  const [sent, setSent] = useState(false);
  const [adminMessage, setAdminMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formMode, setFormMode] = useState("create");
  const [editRunId, setEditRunId] = useState(null);
  const apiBase = useMemo(() => getApiBase(), []);

  const gridSpec = useMemo(() => {
    if (mode === "bastion") {
      return { rows: 8, cols: 10, bgUrl: BASTION_BG_URL, label: "Bastion" };
    }
    return { rows: 7, cols: 10, bgUrl: TOUR_BG_URL, label: "Tour" };
  }, [mode]);

  const ROWS = useMemo(() => makeRows(gridSpec.rows).reverse(), [gridSpec.rows]);
  const COLS = useMemo(() => makeCols(gridSpec.cols), [gridSpec.cols]);

  const slotByPos = useMemo(() => {
    const map = new Map();
    for (const slot of slots) {
      if (slot && typeof slot.id === "string") map.set(slot.id, slot);
    }
    return map;
  }, [slots]);

  const activeSlot = activePos ? slotByPos.get(activePos) || null : null;

  const filteredHeroes = useMemo(() => {
    const q = norm(heroQuery);
    if (!q) return heroPool.slice(0, 10);
    return heroPool.filter((hero) => norm(hero).includes(q)).slice(0, 10);
  }, [heroPool, heroQuery]);

  const canAddMore = slots.length < MAX_SLOTS;

  function clearStatus() {
    setSubmitState("idle");
    setSubmitError("");
    setSent(false);
  }

function resetAll() {
  setSlots([]);
  setActivePos(null);
  setHeroQuery("");
  setYoutube("");
  setAuthorId("");
  setAttackCode("");
  setComment("");
  setAdminMessage("");
  setSubmitState("idle");
  setSubmitError("");
  setSent(false);
  setIsSubmitting(false);
  setFormMode("create");
  setEditRunId(null);
}

  function resetGridOnly() {
    setAdminMessage("");
    clearStatus();
  }

  function isPosInGrid(pos) {
    if (!pos || typeof pos !== "string") return false;
    const r = pos.slice(0, 1);
    const c = pos.slice(1);
    return ROWS.includes(r) && COLS.includes(c);
  }

  function addOrSelectPos(pos) {
    if (!isPosInGrid(pos)) return;

    clearStatus();

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
    clearStatus();
    setSlots((prev) => prev.filter((slot) => slot && slot.id !== pos));
    setActivePos((current) => (current === pos ? null : current));
  }

  function updateActiveSlot(patch) {
    if (!activePos) return;
    clearStatus();
    setSlots((prev) => prev.map((slot) => (slot && slot.id === activePos ? { ...slot, ...patch } : slot)));
  }

  const missing = useMemo(() => {
    const problems = [];

    if (!authorId.trim()) problems.push("Ton nom Discord est obligatoire.");
    if (!youtube.trim()) problems.push("Lien YouTube manquant.");
    if (slots.length !== MAX_SLOTS) problems.push(`Sélectionne ${MAX_SLOTS} cases (actuel: ${slots.length}).`);

    const validPos = (p) => /^[A-H][1-8]$/.test(String(p || "").trim().toUpperCase());

    for (const slot of slots) {
      if (!slot || typeof slot.id !== "string") continue;
      if (!validPos(slot.id)) problems.push(`Position invalide (A-H + 1-8) sur ${slot.id}.`);
      if (!String(slot.hero || "").trim()) problems.push(`Héros manquant sur ${slot.id}.`);
      if (!String(slot.dir || "").trim()) problems.push(`Direction manquante sur ${slot.id}.`);
    }

    return Array.from(new Set(problems));
    }, [slots, youtube, authorId]);

  const ready = missing.length === 0;

  const payload = useMemo(() => {
    const placements = [...slots]
      .filter((slot) => slot && typeof slot.id === "string")
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map((slot) => ({
        pos: slot.id,
        hero: String(slot.hero || "").trim(),
        dir: String(slot.dir || "").trim(),
      }))
      .filter((placement) => placement.hero && placement.dir);

    return {
      type: mode,
      placements,
      youtube: youtube.trim() || undefined,
      attack_code: attackCode.trim() || undefined,
      comment: comment.trim() || undefined,
    };
  }, [attackCode, comment, mode, slots, youtube]);

function buildAdminMessage(p) {
  const lines = [];

  if (formMode === "edit" && editRunId) {
    lines.push(`RUN_MODIF_${editRunId}`);
  } else {
    lines.push(BOT_MARKER);
  }

  if (String(authorId || "").trim()) {
    lines.push(`RUN_AUTHOR_ID=${String(authorId).trim()}`);
  }

  lines.push(`Type: ${p.type}`);
  lines.push(`YouTube: ${p.youtube}`);
  if (p.attack_code) lines.push(`Attack: ${p.attack_code}`);
  if (p.comment) lines.push(`Commentaire: ${p.comment}`);

  const ordered = [...(p.placements || [])]
    .sort((a, b) => String(a.pos).localeCompare(String(b.pos)))
    .slice(0, 5);

  for (let i = 0; i < ordered.length; i += 1) {
    const pl = ordered[i];
    const dir = String(pl.dir || "").trim().toUpperCase();
    lines.push(`• P${i + 1}: \`${normalizeChampionName(pl.hero)} ${pl.pos} ${dir}\``);
  }

  return lines.join("\n");
}

async function submit() {
  if (!ready || isSubmitting || sent) return;

  const msg = buildAdminMessage(payload);
  setAdminMessage(msg);
  setSubmitError("");
  setIsSubmitting(true);

  if (!apiBase) {
    setSubmitState("error");
    setSubmitError("Impossible de déterminer l’URL de l’API.");
    setIsSubmitting(false);
    return;
  }

  try {
    const res = await fetch(`${apiBase}/api/run-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg }),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    setSubmitState("sent");
    setSent(true);

    // reset automatique après 4 secondes
    if (formMode !== "edit") {
      setTimeout(() => {
        resetAll();
      }, 4000);
    }

  } catch (e) {
    console.error(e);
    setSubmitState("error");
    setSubmitError(`Envoi impossible: ${String(e?.message || e)}`);
  } finally {
    setIsSubmitting(false);
  }
}

  useEffect(() => {
    setBgError(false);
  }, [mode]);

  useEffect(() => {
    let cancelled = false;

    async function loadAllChampions() {
      if (!apiBase) {
        setHeroesLoaded(false);
        setHeroesLoading(false);
        setHeroesError("Impossible de déterminer l’URL de l’API.");
        return;
      }

      setHeroesLoading(true);
      setHeroesError("");

      try {
        const res = await fetch(`${apiBase}/api/champions`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const list = Array.isArray(data) ? data : data?.champions;
        if (!Array.isArray(list)) throw new Error("Bad payload");

        const seen = new Set();
        const uniq = [];

        for (const x of list) {
          const name = String(x || "").trim();
          if (!name) continue;
          const key = norm(name);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          uniq.push(name);
        }

        if (!cancelled && uniq.length) {
          setHeroPool(uniq);
          setHeroesLoaded(true);
        }
      } catch (e) {
        if (!cancelled) {
          setHeroesLoaded(false);
          setHeroesError(`Impossible de charger la liste officielle: ${String(e?.message || e)}`);
        }
      } finally {
        if (!cancelled) setHeroesLoading(false);
      }
    }

    loadAllChampions();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  useEffect(() => {
  let cancelled = false;

  async function loadEditRun() {
    if (typeof window === "undefined") return;
    if (!apiBase) return;

    const params = new URLSearchParams(window.location.search);
    const modeParam = params.get("mode");
    const runParam = params.get("run");

    if (modeParam !== "edit" || !runParam) {
      setFormMode("create");
      setEditRunId(null);
      return;
    }

    const runId = Number(runParam);

    if (!Number.isInteger(runId) || runId <= 0) {
      setSubmitState("error");
      setSubmitError("Numéro de strat invalide dans l’URL.");
      return;
    }

    setFormMode("edit");
    setEditRunId(runId);

    try {
      const res = await fetch(`${apiBase}/api/run/${runId}`, {
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      if (cancelled) return;

      const placements = Array.isArray(data?.placements) ? data.placements : [];

      const loadedSlots = placements
        .slice(0, 5)
        .map((p) => ({
          id: String(p.pos || "").trim().toUpperCase(),
          hero: normalizeChampionName(p.hero || ""),
          dir: normalizeApiDirToForm(p.dir),
        }))
        .filter((s) => s.id && s.hero && s.dir);

      setYoutube(String(data?.youtube_url || ""));
      setAttackCode(String(data?.attack_code || ""));
      setComment(String(data?.commentaire || ""));
      setSlots(loadedSlots);
      setActivePos(loadedSlots[0]?.id || null);
      setHeroQuery(loadedSlots[0]?.hero || "");
      clearStatus();
    } catch (e) {
      console.error("[loadEditRun]", e);
      if (!cancelled) {
        setSubmitState("error");
        setSubmitError(`Impossible de charger la strat ${runId}: ${String(e?.message || e)}`);
      }
    }
  }

  loadEditRun();

  return () => {
    cancelled = true;
  };
}, [apiBase]);

  useEffect(() => {
    if (activePos && !isPosInGrid(activePos)) {
      setActivePos(null);
      setHeroQuery("");
    }
    setSlots((prev) => prev.filter((slot) => slot && typeof slot.id === "string" && isPosInGrid(slot.id)));
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

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
  {formMode === "edit" && editRunId
    ? `Modification du run #${editRunId}`
    : "Ajoute un run"}
</h1>
          <p className="text-sm text-muted-foreground mt-1">
  {formMode === "edit"
    ? "Le formulaire a été prérempli avec les données de la strat. Modifie ce que tu veux puis envoie la demande."
    : `1) Choisis Tour/Bastion · 2) Clique ${MAX_SLOTS} cases · 3) Renseigne héros + direction · 4) Ajoute le lien YouTube · 5) Envoyer`}
</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={resetAll} className="gap-2">
            <RotateCcw className="h-4 w-4" /> Reset
          </Button>
        </div>
      </div>

      

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="text-lg">Zone de sélection</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="gap-1">
                    <Info className="h-3.5 w-3.5" /> {slots.length}/{MAX_SLOTS} positions
                  </Badge>
                  {activePos ? <Badge>édition: {activePos}</Badge> : <Badge variant="secondary">clique une case</Badge>}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-[180px]">
                  <Label className="text-xs text-muted-foreground">Type</Label>
                  <Select
                    value={mode}
                    onValueChange={(v) => {
                      setMode(v);
                      resetGridOnly();
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choisir" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tour">Tour</SelectItem>
                      <SelectItem value="bastion">Bastion</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Separator className="mt-3" />
            {bgError ? <p className="text-xs text-destructive mt-3">L’image de référence ne charge pas.</p> : null}
          </CardHeader>

          <CardContent>
            <div className="relative overflow-hidden rounded-2xl border bg-muted/20">
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
    objectPosition: mode === "bastion" ? "center 55%" : "center",
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
                      <div key={c} className="text-xs text-muted-foreground text-center pb-2 select-none" style={{ alignSelf: "end" }}>
                        {c}
                      </div>
                    ))}

                    {ROWS.map((r) => (
                      <React.Fragment key={r}>
                        <div className="text-xs text-muted-foreground pr-2 flex items-center justify-end select-none">{r}</div>
                        {COLS.map((c) => {
                          const pos = `${r}${c}`;
                          const isSelected = slotByPos.has(pos);
                          const isActive = activePos === pos;
                          const slot = slotByPos.get(pos);
                          const isComplete = slot && String(slot.hero || "").trim() && String(slot.dir || "").trim();

                          return (
                            <button
                              key={pos}
                              type="button"
                              onClick={() => addOrSelectPos(pos)}
                              className={
                                `relative aspect-square rounded-xl border transition ` +
                                (isComplete
                                  ? "bg-green-500/30 border-green-500 "
                                  : isSelected
                                    ? "bg-background/80 "
                                    : "bg-background/40 ") +
                                (isActive ? "ring-2 ring-primary" : "hover:bg-background/70")
                              }
                              aria-label={`Case ${pos}`}
                              disabled={!isSelected && !canAddMore}
                            >
                              <div className="absolute inset-0 rounded-xl" style={{ boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.03)" }} />

                              <div className="absolute left-2 top-2 flex items-center gap-1">
                                {isSelected ? (
                                  <Badge variant={isActive ? "default" : "secondary"} className="text-[10px] px-1.5">
                                    {(slot && slot.dir) || "•"}
                                  </Badge>
                                ) : (
                                  <span className="text-[10px] text-muted-foreground">&nbsp;</span>
                                )}
                              </div>

<div className="absolute inset-0 flex items-center justify-center p-1">
  {isSelected ? (
    slot && slot.hero ? (
      <div className="relative w-full h-full flex items-center justify-center overflow-visible">
        <img
          src={getHeroImageSrc(slot.hero)}
          alt={slot.hero}
          className="max-w-[72%] max-h-[72%] object-contain"
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
              className="absolute pointer-events-none select-none"
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
      <div className="text-[11px] font-medium truncate max-w-[90%]">
        (héro)
      </div>
    )
  ) : (
    <div className="text-[11px] text-muted-foreground">+</div>
  )}
</div>
                            </button>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                <div className="mt-3 text-xs text-muted-foreground">
                  {gridSpec.label}: {gridSpec.rows} lignes × {gridSpec.cols} colonnes · Clique {MAX_SLOTS} cases.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Édition</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!activeSlot ? (
                <div className="text-sm text-muted-foreground">Clique une case dans la grille, puis choisis le héros et la direction.</div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">Position</div>
                      <div className="text-2xl font-semibold tracking-tight tabular-nums">{activeSlot.id}</div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => removePos(activeSlot.id)} aria-label="Retirer">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label>
                      Héros {heroesLoading ? <span className="text-xs text-muted-foreground">(chargement…)</span> : null}
                      {heroesLoaded && !heroesLoading ? <span className="text-xs text-muted-foreground">(liste officielle)</span> : null}
                    </Label>
                    <Input
                      value={heroQuery}
                      onChange={(e) => {
                        setHeroQuery(e.target.value);
                      }}
                      placeholder="Commence à taper…"
                    />
                    {heroesError ? <div className="text-xs text-muted-foreground">{heroesError}</div> : null}
                    <div className="flex flex-wrap gap-2">
                      {filteredHeroes.map((h) => (
                        <Button
                          key={h}
                          type="button"
                          variant={activeSlot.hero === h ? "default" : "outline"}
                          size="sm"
                          onClick={() => {
                            setHeroQuery(h);
                            updateActiveSlot({ hero: h });
                          }}
                        >
                          {h}
                        </Button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          const v = heroQuery.trim().toLowerCase();
                          if (!v) return;
                          clearStatus();
                          setHeroPool((prev) => (prev.includes(v) ? prev : [v, ...prev]));
                          updateActiveSlot({ hero: v });
                          setHeroQuery(v);
                        }}
                      >
                        Ajouter au pool
                      </Button>
                      <span className="text-xs text-muted-foreground">(si absent)</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Direction</Label>
                    <div className="grid grid-cols-4 gap-2">
                      {DIRS.map((d) => (
                        <Button key={d.v} type="button" variant={activeSlot.dir === d.v ? "default" : "outline"} onClick={() => updateActiveSlot({ dir: d.v })}>
                          {d.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <Separator />

              <div className="space-y-2">
                <Label>Positions sélectionnées</Label>
                <div className="flex flex-wrap gap-2">
                  {slots.length === 0 ? (
                    <Badge variant="secondary">Aucune</Badge>
                  ) : (
                    [...slots]
                      .filter((slot) => slot && slot.id)
                      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
                      .map((slot) => (
  <button
  key={slot.id}
  type="button"
  onClick={() => {
    clearStatus();
    setActivePos(slot.id);
    setHeroQuery(slot.hero || "");
  }}
  className="text-left"
>
  <Badge
    className={
      (() => {
        const isIncomplete =
          !String(slot.hero || "").trim() || !String(slot.dir || "").trim();

        return isIncomplete
          ? "bg-red-600 text-white border-red-700"
          : "bg-green-600 text-white border-green-700";
      })()
    }
  >
    {slot.id} · {slot.hero || "(héro)"} · {slot.dir || "(dir)"}
  </Badge>
</button>
                      ))
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Infos du run</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Ton nom sur Discord</Label>
                <Input
                  value={authorId}
                  onChange={(e) => {
                    clearStatus();
                    setAuthorId(e.target.value);
                  }}
                  placeholder="ex: Jengsen ^^ "
                  inputMode="numeric"
                />

              </div>

              <div className="space-y-2">
                <Label>Lien YouTube</Label>
                <Input
                  value={youtube}
                  onChange={(e) => {
                    clearStatus();
                    setYoutube(e.target.value);
                  }}
                  placeholder="https://youtu.be/..."
                />
              </div>

              <div className="space-y-2">
                <Label>Code d’attaque (optionnel)</Label>
                <Input
                  value={attackCode}
                  onChange={(e) => {
                    clearStatus();
                    setAttackCode(e.target.value);
                  }}
                  placeholder="ex: <GVG>.....</GVG>"
                />
              </div>

              <div className="space-y-2">
                <Label>Commentaire (optionnel) </Label>
                <Textarea
                  value={comment}
                  onChange={(e) => {
                    clearStatus();
                    setComment(e.target.value);
                  }}
                  placeholder="timing  / remarques…"
                />
              </div>

              <Separator />

              {missing.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium">À compléter</div>
                  <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                    {missing.slice(0, 6).map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="text-sm">
                  <Badge className="mr-2">Prêt</Badge>
                  Tu peux envoyer.
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button onClick={submit} disabled={!ready || isSubmitting || sent}>
                  {sent ? "Envoyé ✓" : isSubmitting ? "Envoi..." : "Envoyer"}
                </Button>
                {sent ? (
                  <span className="text-xs text-green-600">✅ Demande envoyée aux admins.</span>
                ) : submitState === "sent" ? (
                  <span className="text-xs text-muted-foreground">✅ Envoi effectué.</span>
                ) : submitState === "error" ? (
                  <span className="text-xs text-destructive">❌ {submitError || "Erreur"}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">&nbsp;</span>
                )}
              </div>

              {adminMessage ? (
                <div className="space-y-2">
                  <Label>Dernier message généré</Label>
                  <Textarea value={adminMessage} readOnly className="min-h-[160px]" />
                </div>
              ) : null}

              <p className="text-xs text-muted-foreground">
                Le bouton “Envoyer” poste directement la demande au bot local, qui la republie dans le salon admin avec les réactions ✅ / ❌.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>


    </div>
  );
}
