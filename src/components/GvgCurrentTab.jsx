import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";


function getApiBase() {
  if (typeof window === "undefined") return "";

  const { hostname } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:3000";
  }

  return "";
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

function getStatusLabel(status, reproBy) {
  if (status === "repro") {
    return reproBy ? `C’est repro sur ${reproBy}` : "Repro en cours";
  }

  if (status === "strat") {
    return "Strat disponible";
  }

  return "À ouvrir";
}

function buildDefenseTitle(defense) {
  if (defense.type === "fortress") {
    return `Forteresse · Team ${defense.team}`;
  }

  return `Tour ${defense.tower} · Team ${defense.team}`;
}

export default function GvgCurrentTab() {
  const apiBase = useMemo(() => getApiBase(), []);

  const [selectedGuild, setSelectedGuild] = useState(() => {
    return localStorage.getItem("gvg_selected_guild") || "";
  });
const [refreshTick, setRefreshTick] = useState(0);
  const [selectedFilter, setSelectedFilter] = useState(null);
  const [selectedBastionId, setSelectedBastionId] = useState(null);
  const [defenses, setDefenses] = useState([]);
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


  const session = useMemo(() => {
    if (typeof window === "undefined") return null;

    try {
      const raw = localStorage.getItem("guildDashboardSession");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
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

  try {
    setLoading(true);
    setMessage("");

    const response = await fetch(
      `${apiBase}/api/gvg-data?guild=${encodeURIComponent(selectedGuild)}`
    );

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      if (!cancelled) {
        setMessage(`Réponse non JSON gvg-list (${response.status})`);
      }
      return;
    }

    if (!response.ok) {
      if (!cancelled) {
        setMessage(`Erreur chargement GVG : ${data?.error || "erreur inconnue"}`);
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
      setMessage(`Erreur chargement GVG : ${error?.message || "erreur inconnue"}`);
    }
  } finally {
    if (!cancelled) {
      setLoading(false);
    }
  }
}

function getYoutubeEmbedUrl(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url);

    if (parsed.hostname.includes("youtu.be")) {
      const videoId = parsed.pathname.replace("/", "").trim();
      return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
    }

    if (
      parsed.hostname.includes("youtube.com") ||
      parsed.hostname.includes("www.youtube.com")
    ) {
      const videoId = parsed.searchParams.get("v");
      return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
    }

    return null;
  } catch {
    return null;
  }
}

function openDefenseImage(defense) {
  if (!defense?.image_url) return;

  setImageModalUrl(defense.image_url);
  setImageModalTitle(buildDefenseTitle(defense));
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
}, [apiBase, selectedGuild, refreshTick]);

  const bastions = useMemo(() => {
    return [1, 2, 3, 4].map((bastionId) => {
      const items = defenses.filter((defense) => Number(defense.bastion) === bastionId);

      return {
        id: bastionId,
        defenses: items,
      };
    });
  }, [defenses]);

  const selectedBastion = useMemo(() => {
    return bastions.find((bastion) => bastion.id === selectedBastionId) || null;
  }, [bastions, selectedBastionId]);

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
      setMessage(`Réponse non JSON gvg-update (${response.status})`);
      return;
    }

    if (!response.ok) {
      setMessage(`Erreur repro : ${data?.error || "erreur inconnue"}`);
      return;
    }

setRefreshTick((prev) => prev + 1);
  } catch (error) {
    console.error("markDefenseAsRepro error:", error);
    setMessage(`Erreur repro : ${error?.message || "erreur inconnue"}`);
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

    const response = await fetch(
      `${apiBase}/api/gvg-strat-search?gvgDefenseId=${encodeURIComponent(defenseId)}`
    );

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setStratModalMessage(`Réponse non JSON gvg-strat-search (${response.status})`);
      setStratModalOpen(true);
      return;
    }

    if (!response.ok) {
      setStratModalMessage(`Erreur lecture strat : ${data?.error || "erreur inconnue"}`);
      setStratModalOpen(true);
      return;
    }

    const items = Array.isArray(data?.items) ? data.items : [];

    if (!items.length) {
      setStratModalMessage("Aucune strat trouvée.");
      setStratModalOpen(true);
      return;
    }

    setStratModalItems(items);
    setStratModalOpen(true);
  } catch (error) {
    console.error("openStratView error:", error);
    setStratModalMessage(`Erreur lecture strat : ${error?.message || "erreur inconnue"}`);
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
      setReproViewMessage(`Réponse non JSON gvg-repro-get (${response.status})`);
      setReproViewOpen(true);
      return;
    }

    if (!response.ok) {
      setReproViewMessage(`Erreur lecture repro : ${data?.error || "erreur inconnue"}`);
      setReproViewOpen(true);
      return;
    }

    if (!data?.item) {
      setReproViewMessage("Aucune repro enregistrée.");
      setReproViewOpen(true);
      return;
    }

    setReproViewText(data.item.message_text || "");
    setReproViewOpen(true);
  } catch (error) {
    console.error("openReproView error:", error);
    setReproViewMessage(`Erreur lecture repro : ${error?.message || "erreur inconnue"}`);
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
      setReproMessage(`Réponse non JSON gvg-repro-template (${response.status})`);
      return;
    }

    if (!response.ok) {
      setReproMessage(`Erreur template repro : ${data?.error || "erreur inconnue"}`);
      return;
    }

    setReproWatcherName(data?.watcherName || currentWatcherName);
    setReproHeroLines(Array.isArray(data?.heroLines) ? data.heroLines : []);
    setReproModalOpen(true);
  } catch (error) {
    console.error("openReproModal error:", error);
    setReproMessage(`Erreur template repro : ${error?.message || "erreur inconnue"}`);
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
      setMessage(`Réponse non JSON gvg-update (${response.status})`);
      return;
    }

    if (!response.ok) {
      setMessage(`Erreur annulation repro : ${data?.error || "erreur inconnue"}`);
      return;
    }

setRefreshTick((prev) => prev + 1);

  } catch (error) {
    console.error("cancelDefenseRepro error:", error);
    setMessage(`Erreur annulation repro : ${error?.message || "erreur inconnue"}`);
  }
}

async function markDefenseAsOpened(defenseId) {
  try {
    const response = await fetch(`${apiBase}/api/gvg-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    body: JSON.stringify({
      id: defenseId,
      action: "delete",
    }),
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setMessage(`Réponse non JSON gvg-delete (${response.status})`);
      return;
    }

    if (!response.ok) {
      setMessage(`Erreur ouverture défense : ${data?.error || "erreur inconnue"}`);
      return;
    }

    setRefreshTick((prev) => prev + 1);
  } catch (error) {
    console.error("markDefenseAsOpened error:", error);
    setMessage(`Erreur ouverture défense : ${error?.message || "erreur inconnue"}`);
  }
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
            GVG en cours
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6 p-4 md:p-6">
          {!selectedGuild ? (
            <div className="space-y-4">
              <div className="text-sm text-zinc-400">
                Choisis la guilde à afficher.
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  className="rounded-2xl"
                  onClick={() => {
                    localStorage.setItem("gvg_selected_guild", "G1");
                    setSelectedGuild("G1");
                  }}
                >
                  G1
                </Button>

                <Button
                  type="button"
                  className="rounded-2xl"
                  onClick={() => {
                    localStorage.setItem("gvg_selected_guild", "G2");
                    setSelectedGuild("G2");
                  }}
                >
                  G2
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-zinc-400">Guilde sélectionnée</div>
                  <div className="text-2xl font-semibold text-zinc-100">
                    {selectedGuild}
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
                  Changer de guilde
                </Button>
              </div>

              {message ? (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-300">
                  {message}
                </div>
              ) : null}

              {loading ? (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-400">
                  Chargement de la GVG...
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
                          Bastion {bastion.id}
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
                          <span className="text-sm text-orange-200">Déf</span>
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
                          <span className="text-sm text-blue-200">Repro</span>
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
                          <span className="text-sm text-emerald-200">Strat</span>
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
                      <div className="text-sm text-zinc-400">Bastion sélectionné</div>
                      <div className="text-xl font-semibold text-zinc-100">
                        Bastion {selectedBastion.id}
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl border-zinc-700 text-zinc-200"
                      onClick={() => setSelectedFilter("def")}
                    >
                      Voir toutes les défenses
                    </Button>
                  </div>

                  <div className="mt-4 space-y-3">
                    {filteredDefenses.length === 0 ? (
                      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-zinc-400">
                        Aucune défense pour ce filtre.
                      </div>
                    ) : (
                      filteredDefenses.map((defense) => (
                        <div
                          key={defense.id}
                          className={`w-full rounded-2xl border px-4 py-3 ${getStatusClasses(
                            defense.status
                          )}`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="font-medium">
                                {buildDefenseTitle(defense)}
                              </div>
                              <div className="mt-1 text-sm opacity-80">
                                {getStatusLabel(defense.status, defense.repro_by)}
                              </div>
                            </div>

                            <div className="text-sm font-semibold">
                              {defense.type === "fortress"
                                ? `Team ${defense.team}`
                                : `T${defense.tower} · Team ${defense.team}`}
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2">
                        <button
                        type="button"
                        onClick={() => openReproModal(defense.id)}
                        className="rounded-2xl border border-blue-500/40 bg-blue-500/15 px-3 py-2 text-sm font-medium text-blue-200 transition hover:bg-blue-500/25"
                        >
                        {reproLoading && reproDefenseId === defense.id ? "Chargement..." : "C’est repro"}
                        </button>

                            {defense.status === "repro" &&
                            defense.repro_by === currentWatcherName ? (
                              <button
                                type="button"
                                onClick={() => cancelDefenseRepro(defense.id)}
                                className="rounded-2xl border border-zinc-600 bg-zinc-800/60 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-700/70"
                              >
                                Annuler repro
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
{defense.status === "strat" ? (
  <button
    type="button"
    onClick={() => openStratView(defense.id)}
    className="rounded-2xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/25"
  >
    👀
  </button>
) : null}

<button
  type="button"
  onClick={() => openReproCandidates(defense)}
  className="rounded-2xl border border-zinc-500/40 bg-zinc-500/15 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-500/25"
  title="Qui peut repro"
>
  ❓
</button>

<button
  type="button"
  onClick={() => markDefenseAsOpened(defense.id)}
  className="rounded-2xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/25"
>
  C’est ouvert
</button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
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
                  Repro
                </div>
                <div className="text-sm text-zinc-400">
                  Complète les champs manquants
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
                Fermer
              </Button>
            </div>

            <div className="mt-6 space-y-4">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="text-sm text-zinc-400">Repro sur</div>
                <div className="mt-1 text-base font-semibold text-zinc-100">
                  {reproWatcherName}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                  <label className="text-sm text-zinc-300">Repro k PB</label>
                  <input
                    value={reproPlayerPb}
                    onChange={(e) => setReproPlayerPb(e.target.value)}
                    placeholder="..."
                    className="mt-2 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none"
                  />
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                  <label className="text-sm text-zinc-300">Adversaire k PB</label>
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
                      Héros {line.slot} :{" "}
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
                      placeholder="stuff en : ..."
                      className="mt-2 w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none"
                    />
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                <label className="text-sm text-zinc-300">Artéfact</label>
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
          setReproMessage(`Réponse non JSON gvg-repro-save (${response.status})`);
          return;
        }

        if (!response.ok) {
          setReproMessage(`Erreur sauvegarde repro : ${data?.error || "erreur inconnue"}`);
          return;
        }

        await markDefenseAsRepro(reproDefenseId);
        setReproMessage("Repro enregistrée avec succès.");
        setReproModalOpen(false);
      } catch (error) {
        console.error("save repro modal error:", error);
        setReproMessage(`Erreur sauvegarde repro : ${error?.message || "erreur inconnue"}`);
      } finally {
        setReproSaving(false);
      }
    }}
  >
    {reproSaving ? "Enregistrement..." : "Enregistrer la repro"}
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
          Repro enregistrée
        </div>

        <Button
          type="button"
          variant="outline"
          className="rounded-2xl border-zinc-700 text-zinc-200"
          onClick={() => setReproViewOpen(false)}
        >
          Fermer
        </Button>
      </div>

      <div className="mt-4 whitespace-pre-wrap rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-zinc-200">
        {reproViewLoading
          ? "Chargement..."
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
          Fermer
        </Button>
      </div>

      <div className="mt-4 flex items-center justify-center">
        <img
          src={imageModalUrl}
          alt="defense"
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
          Strats disponibles
        </div>

        <Button
          type="button"
          variant="outline"
          className="rounded-2xl border-zinc-700 text-zinc-200"
          onClick={() => setStratModalOpen(false)}
        >
          Fermer
        </Button>
      </div>

      <div className="mt-4 space-y-4 max-h-[70vh] overflow-y-auto">

        {stratModalLoading ? (
          <div className="text-sm text-zinc-400">Chargement...</div>
        ) : stratModalMessage ? (
          <div className="text-sm text-zinc-300">{stratModalMessage}</div>
        ) : (
          stratModalItems.map((strat, index) => (
            <div
              key={strat.strat_id || index}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4"
            >
              <div className="text-sm text-zinc-400">
                Strat #{strat.strat_id}
              </div>

{strat.youtube_url ? (
  <div className="mt-3 space-y-3">
    <div className="text-xs text-zinc-500">Vidéo :</div>

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
        Ouvrir la vidéo
      </a>
    )}
  </div>
) : null}

{strat.attack_code ? (
  <div className="mt-3 flex flex-wrap items-center gap-2">
    <div className="text-xs text-zinc-500">
      Code : {strat.attack_code}
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
      Copier
    </button>
  </div>
) : null}

{strat.commentaire ? (
  <div className="mt-2 text-sm text-zinc-200 whitespace-pre-wrap">
    {strat.commentaire}
  </div>
) : null}

              <div className="mt-3 text-xs text-zinc-500">
                Slots :
              </div>

              <div className="mt-1 text-xs text-zinc-300">
                {strat.slots.map((s, i) => (
                  <div key={i}>
                    {s.champion} {s.position || ""} {s.direction || ""}
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
        Qui peut repro cette défense
      </div>

      <div className="mb-4 flex gap-4 text-sm text-zinc-400">
        {reproHeroes.map((h) => (
          <div key={h.champion_id} className="w-[100px] text-center">
            {h.champion_name}
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
          {c.canRepro ? "✅ Peut repro" : "❌ Incomplet"}
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
        Fermer
      </button>
    </div>
  </div>
)}
    </div>
  );
}