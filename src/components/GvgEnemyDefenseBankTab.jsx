import React, { useEffect, useMemo, useState } from "react";
import { Ban, CheckCircle2, Download, Link2, RefreshCw, Search, ShieldCheck, Swords, XCircle } from "lucide-react";
import { usePortalLanguage } from "@/lib/portalLanguage";

function getApiBase() {
  if (typeof window === "undefined") return "";
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return "http://localhost:3001";
  }
  return "";
}

async function readJsonResponse(response, fallbackMessage) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.error || fallbackMessage);
    error.data = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

function formatPercent(value) {
  const number = Number(value) || 0;
  return `${number.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

function formatDate(value) {
  if (!value) return "Jamais";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Jamais";
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getRateTone(rate) {
  const value = Number(rate) || 0;
  if (value <= 20) return "solid";
  if (value <= 50) return "warning";
  if (value <= 80) return "danger";
  return "critical";
}

function getRateToneClass(rate) {
  const tone = getRateTone(rate);
  if (tone === "solid") return "border-emerald-400/50 bg-emerald-500/15 text-emerald-100";
  if (tone === "warning") return "border-yellow-400/50 bg-yellow-500/15 text-yellow-100";
  if (tone === "danger") return "border-orange-400/50 bg-orange-500/15 text-orange-100";
  return "border-red-400/50 bg-red-500/15 text-red-100";
}

function matchesRateFilter(item, filter) {
  const rate = Number(item?.successRate ?? item?.success_rate) || 0;
  if (filter === "solid") return rate >= 0 && rate <= 20;
  if (filter === "warning") return rate > 20 && rate <= 50;
  if (filter === "danger") return rate > 50 && rate <= 80;
  if (filter === "critical") return rate > 80;
  return true;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function formatHeroName(value) {
  return String(value || "")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatMapType(value) {
  return String(value || "").toLowerCase() === "fortress" ? "Forteresse" : "Tour";
}

function renderHeroLine(hero, index) {
  const champion = formatHeroName(hero?.champion || hero) || `Hero ${index + 1}`;
  const position = hero?.position || "--";
  const direction = hero?.direction || "--";
  return `${champion} ${position} ${direction}`;
}

function renderLocalHeroLine(hero, index) {
  const champion = formatHeroName(hero?.champion || hero) || `Hero ${index + 1}`;
  const position = hero?.position || "--";
  const direction = hero?.direction || "--";
  return hero?.position || hero?.direction ? `${champion} ${position} ${direction}` : champion;
}

function getLocalGuildCode(defense) {
  return defense?.guildCode || defense?.guild_code || "";
}

function getLocalImage(defense) {
  return defense?.imageUrl || defense?.image_url || defense?.image || "";
}

export default function GvgEnemyDefenseBankTab({ activeGuildCode = "" }) {
  const { t } = usePortalLanguage();
  const [items, setItems] = useState([]);
  const [guilds, setGuilds] = useState([]);
  const [linksInitialized, setLinksInitialized] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [rateFilter, setRateFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [stratModal, setStratModal] = useState(null);
  const [stratsLoading, setStratsLoading] = useState(false);
  const [similarityModal, setSimilarityModal] = useState(null);
  const [similarityLoading, setSimilarityLoading] = useState(false);
  const [importModal, setImportModal] = useState(null);
  const [importLoading, setImportLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadItems() {
      if (!activeGuildCode) return;
      setLoading(true);
      setMessage("");

      try {
        const url = new URL(`${getApiBase()}/api/gvg-enemy-defense-bank`, window.location.origin);
        url.searchParams.set("guild", activeGuildCode);
        const response = await fetch(url.toString(), { credentials: "include" });
        const data = await readJsonResponse(response, "Lecture banque defenses adverses impossible.");

        if (cancelled) return;
        setItems(data.items || []);
        setGuilds(data.guilds || []);
        setLinksInitialized(data.linksInitialized !== false && data.links_initialized !== false);
        if (data.migrationRequired || data.initialized === false) {
          setMessage(data.migrationMessage || "Banque de defenses adverses non initialisee.");
        } else if (data.linksInitialized === false || data.links_initialized === false) {
          setMessage("Fonctionnalite de liaison non initialisee : execute le SQL gvg_enemy_defense_links avant validation/import.");
        }
      } catch (error) {
        if (cancelled) return;
        setItems([]);
        setGuilds([]);
        setLinksInitialized(true);
        setMessage(error?.message || "Lecture banque defenses adverses impossible.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadItems();

    return () => {
      cancelled = true;
    };
  }, [activeGuildCode, refreshTick]);

  const mapTypes = useMemo(
    () => [...new Set(items.map((item) => String(item.mapType || item.map_type || "").toLowerCase()).filter(Boolean))],
    [items],
  );

  const targetGuilds = useMemo(() => {
    const rows = guilds.length ? guilds : [{ guild_code: activeGuildCode, display_name: activeGuildCode }];
    return rows.filter((guild) => guild?.guild_code);
  }, [activeGuildCode, guilds]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = normalizeText(query);

    return items
      .filter((item) => matchesRateFilter(item, rateFilter))
      .filter((item) => typeFilter === "all" || String(item.mapType || item.map_type || "").toLowerCase() === typeFilter)
      .filter((item) => {
        if (!normalizedQuery) return true;
        return normalizeText((item.heroes || []).map((hero, index) => renderHeroLine(hero, index)).join(" ")).includes(
          normalizedQuery,
        );
      });
  }, [items, query, rateFilter, typeFilter]);

  async function openStrats(item) {
    if (!(item.hasAvailableStrat || item.has_available_strat)) return;

    setStratModal({ item, items: [], error: "" });
    setStratsLoading(true);

    try {
      const url = new URL(`${getApiBase()}/api/gvg-enemy-defense-bank`, window.location.origin);
      url.searchParams.set("action", "strats");
      url.searchParams.set("guild", activeGuildCode);
      url.searchParams.set("defenseId", item.id);

      const response = await fetch(url.toString(), { credentials: "include" });
      const data = await readJsonResponse(response, "Recherche de strats impossible.");
      setStratModal({ item, items: data.items || [], error: "" });
    } catch (error) {
      setStratModal({ item, items: [], error: error?.message || "Recherche de strats impossible." });
    } finally {
      setStratsLoading(false);
    }
  }

  async function openSimilarities(item) {
    if (!linksInitialized) return;
    setSimilarityModal({ item, enemyDefense: item, candidates: [], error: "" });
    setSimilarityLoading(true);

    try {
      const url = new URL(`${getApiBase()}/api/gvg-enemy-defense-bank`, window.location.origin);
      url.searchParams.set("action", "similarities");
      url.searchParams.set("guild", activeGuildCode);
      url.searchParams.set("defenseId", item.id);

      const response = await fetch(url.toString(), { credentials: "include" });
      const data = await readJsonResponse(response, "Lecture similarites impossible.");
      setSimilarityModal({
        item,
        enemyDefense: data.enemyDefense || data.enemy_defense || item,
        candidates: data.candidates || [],
        error: "",
      });
    } catch (error) {
      setSimilarityModal({ item, enemyDefense: item, candidates: [], error: error?.message || "Lecture similarites impossible." });
    } finally {
      setSimilarityLoading(false);
    }
  }

  async function reviewSimilarity(candidate, status) {
    if (!candidate?.review?.id) return;
    setSimilarityLoading(true);

    try {
      const response = await fetch(`${getApiBase()}/api/gvg-enemy-defense-bank`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "review-similarity",
          guild: activeGuildCode,
          reviewId: candidate.review.id,
          status,
        }),
      });
      await readJsonResponse(response, "Validation similarite impossible.");
      setSimilarityModal((previous) =>
        previous
          ? {
              ...previous,
              candidates: previous.candidates.filter((item) => item.review?.id !== candidate.review.id),
              error: "",
            }
          : previous,
      );
      setRefreshTick((value) => value + 1);
    } catch (error) {
      setSimilarityModal((previous) => previous ? { ...previous, error: error?.message || "Validation similarite impossible." } : previous);
    } finally {
      setSimilarityLoading(false);
    }
  }

  function openImport(item) {
    const defaultGuild = targetGuilds.find((guild) => guild.guild_code === activeGuildCode)?.guild_code || targetGuilds[0]?.guild_code || activeGuildCode;
    setImportModal({
      item,
      targetGuildCode: defaultGuild,
      name: `${formatMapType(item.mapType || item.map_type)} adverse`,
      error: "",
      success: "",
    });
  }

  async function submitImport(event) {
    event?.preventDefault();
    if (!importModal?.item?.id) return;
    setImportLoading(true);

    try {
      const response = await fetch(`${getApiBase()}/api/gvg-enemy-defense-bank`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import",
          guild: activeGuildCode,
          defenseId: importModal.item.id,
          targetGuildCode: importModal.targetGuildCode,
          name: importModal.name,
        }),
      });
      const data = await readJsonResponse(response, "Import defense adverse impossible.");
      setImportModal((previous) =>
        previous
          ? {
              ...previous,
              success: `Defense importee dans ${previous.targetGuildCode}.`,
              error: "",
            }
          : previous,
      );
      setRefreshTick((value) => value + 1);
      return data;
    } catch (error) {
      if (error?.data?.requiresReview || error?.data?.requires_review) {
        setImportModal((previous) => previous ? { ...previous, error: error.message } : previous);
        await openSimilarities(importModal.item);
      } else {
        setImportModal((previous) => previous ? { ...previous, error: error?.message || "Import defense adverse impossible." } : previous);
      }
      return null;
    } finally {
      setImportLoading(false);
    }
  }

  async function removeLinkedDefense(item, localDefense) {
    const guildCode = getLocalGuildCode(localDefense);
    const confirmed = window.confirm(`Retirer cette defense locale de ${guildCode || "la guilde"} ?`);
    if (!confirmed) return;

    try {
      const response = await fetch(`${getApiBase()}/api/gvg-enemy-defense-bank`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove-local",
          guild: activeGuildCode,
          defenseId: item.id,
          localDefenseId: localDefense.id,
        }),
      });
      await readJsonResponse(response, "Retrait defense locale impossible.");
      setRefreshTick((value) => value + 1);
    } catch (error) {
      setMessage(error?.message || "Retrait defense locale impossible.");
    }
  }

  const filterButtonClass = (active, activeClass = "border-cyan-500 bg-cyan-950/50 text-cyan-100") =>
    `rounded-xl border px-3 py-1.5 text-sm ${
      active ? activeClass : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
    }`;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
        <div className="font-semibold">Legende taux d'ouverture</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-100">0-20 % SOLIDE</span>
          <span className="rounded-lg border border-yellow-400/40 bg-yellow-500/15 px-2 py-1 text-xs font-semibold text-yellow-100">20-50 % À SURVEILLER</span>
          <span className="rounded-lg border border-orange-400/40 bg-orange-500/15 px-2 py-1 text-xs font-semibold text-orange-100">50-80 % FRAGILE</span>
          <span className="rounded-lg border border-red-400/40 bg-red-500/15 px-2 py-1 text-xs font-semibold text-red-100">80-100 % FACILE</span>
        </div>
      </div>

      {message ? (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {message}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {[
          ["all", t("common.allPlural", "Toutes")],
          ["solid", "SOLIDE"],
          ["warning", "À SURVEILLER"],
          ["danger", "FRAGILE"],
          ["critical", "FACILE"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setRateFilter(value)}
            className={filterButtonClass(rateFilter === value)}
          >
            {label}
          </button>
        ))}

        {mapTypes.length > 1 ? (
          <>
            <button
              type="button"
              onClick={() => setTypeFilter("all")}
              className={filterButtonClass(typeFilter === "all")}
            >
              Types
            </button>
            {mapTypes.map((mapType) => (
              <button
                key={mapType}
                type="button"
                onClick={() => setTypeFilter(mapType)}
                className={filterButtonClass(typeFilter === mapType)}
              >
                {mapType === "fortress" ? t("defenses.bastion", "Bastion") : t("defenses.tower", "Tour")}
              </button>
            ))}
          </>
        ) : null}

        <label className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("common.search", "Rechercher")}
            className="h-9 w-full rounded-xl border border-zinc-700 bg-zinc-900 pl-9 pr-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
          />
        </label>

        <button
          type="button"
          onClick={() => setRefreshTick((value) => value + 1)}
          className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("common.refresh", "Rafraichir")}
        </button>
      </div>

      <div className="grid gap-3">
        {loading ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 text-sm text-zinc-400">
            {t("common.loading", "Chargement...")}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 text-sm text-zinc-400">
            Aucune defense adverse archivee pour {activeGuildCode}.
          </div>
        ) : (
          filteredItems.map((item) => {
            const successRate = Number(item.successRate ?? item.success_rate) || 0;
            const heroes = item.heroes || item.canonicalDefinition?.heroes || item.canonical_definition?.heroes || [];
            const pendingCount = Number(item.similarityPendingCount ?? item.similarity_pending_count) || 0;
            const linkedDefenses = item.linkedLocalDefenses || item.linked_local_defenses || [];
            const stratCount = Number(item.stratCount ?? item.strat_count) || 0;
            const hasAvailableStrat = item.hasAvailableStrat || item.has_available_strat || stratCount > 0;

            return (
              <article
                key={item.id}
                className={`grid gap-4 rounded-2xl border p-4 lg:grid-cols-[minmax(180px,280px)_minmax(0,1fr)_auto] ${getRateToneClass(successRate)}`}
              >
                <div className="flex h-[170px] items-center justify-center overflow-hidden rounded-xl border border-black/30 bg-zinc-950/80">
                  {item.imageUrl || item.image_url ? (
                    <img
                      src={item.imageUrl || item.image_url}
                      alt="Defense adverse"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="text-xs text-zinc-500">{t("common.noImage", "Aucune image")}</div>
                  )}
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <ShieldCheck className="h-4 w-4" />
                    <div className="font-semibold text-white">
                      {formatMapType(item.mapType || item.map_type)} adverse
                    </div>
                    <span className="rounded-md border border-white/15 bg-black/20 px-2 py-0.5 text-xs">
                      {formatPercent(successRate)}
                    </span>
                    {pendingCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => openSimilarities(item)}
                        className="rounded-md border border-fuchsia-300/50 bg-fuchsia-500/20 px-2 py-0.5 text-xs font-semibold text-fuchsia-100 hover:bg-fuchsia-500/30"
                      >
                        Similarites detectees · {pendingCount}
                      </button>
                    ) : null}
                  </div>

                  {linkedDefenses.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {linkedDefenses.map((defense) => (
                        <span
                          key={`${item.id}-${defense.id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-2 py-1 text-xs text-emerald-100"
                        >
                          <Link2 className="h-3.5 w-3.5" />
                          Liee a {getLocalGuildCode(defense) || "-"}
                          <button
                            type="button"
                            onClick={() => removeLinkedDefense(item, defense)}
                            className="ml-1 rounded border border-emerald-200/20 px-1 text-[10px] uppercase hover:bg-emerald-200/10"
                          >
                            Retirer
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-xl border border-black/20 bg-black/20 p-3">
                      <div className="text-xs uppercase tracking-[0.16em] opacity-70">Rencontree</div>
                      <div className="mt-1 text-lg font-bold text-white">{Number(item.encounters) || 0}</div>
                    </div>
                    <div className="rounded-xl border border-black/20 bg-black/20 p-3">
                      <div className="text-xs uppercase tracking-[0.16em] opacity-70">Ouverte</div>
                      <div className="mt-1 text-lg font-bold text-white">{Number(item.opened) || 0}</div>
                    </div>
                    <div className="rounded-xl border border-black/20 bg-black/20 p-3" title={formatDate(item.lastSeenAt || item.last_seen_at)}>
                      <div className="text-xs uppercase tracking-[0.16em] opacity-70">Derniere</div>
                      <div className="mt-1 text-sm font-semibold text-white">{formatDate(item.lastSeenAt || item.last_seen_at)}</div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {heroes.map((hero, index) => (
                      <span
                        key={`${item.id}-${hero.champion}-${hero.position}-${hero.direction}-${index}`}
                        className="rounded-lg border border-white/10 bg-black/25 px-2 py-1 text-xs text-zinc-100"
                      >
                        {renderHeroLine(hero, index)}
                      </span>
                    ))}
                  </div>

                  {(item.crossGuildStats || []).length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(item.crossGuildStats || []).map((stat) => (
                        <span
                          key={`${item.id}-${stat.portalGuildId || stat.portal_guild_id}`}
                          className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-2 py-1 text-xs text-cyan-100"
                          title={`${stat.guildCode || stat.guild_code}: rencontree ${stat.encounters}, ouverte ${stat.opened}, ${formatPercent(stat.successRate ?? stat.success_rate)}`}
                        >
                          {stat.guildCode || stat.guild_code} · {formatPercent(stat.successRate ?? stat.success_rate)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col justify-start gap-2">
                  {hasAvailableStrat ? (
                    <button
                      type="button"
                      onClick={() => openStrats(item)}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-500/50 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/25"
                    >
                      <Swords className="h-4 w-4" />
                      Voir la strat · {stratCount}
                    </button>
                  ) : (
                    <div className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/50 bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-100">
                      <Ban className="h-4 w-4" />
                      Aucune strat
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => openImport(item)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/50 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/25"
                  >
                    <Download className="h-4 w-4" />
                    Importer
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>

      {stratModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-white shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-bold">Strats existantes</div>
                <div className="text-sm text-zinc-400">Defense adverse {activeGuildCode}</div>
              </div>
              <button
                type="button"
                onClick={() => setStratModal(null)}
                className="rounded-xl border border-zinc-700 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                {t("common.close", "Fermer")}
              </button>
            </div>

            {stratsLoading ? (
              <div className="text-sm text-zinc-400">{t("common.loading", "Chargement...")}</div>
            ) : stratModal.error ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {stratModal.error}
              </div>
            ) : stratModal.items.length === 0 ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-4 py-3 text-sm text-zinc-400">
                Aucune strat
              </div>
            ) : (
              <div className="space-y-3">
                {stratModal.items.map((strat) => (
                  <div key={strat.strat_id} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold text-zinc-100">Strat #{strat.strat_id}</div>
                      {strat.youtube_url ? (
                        <a
                          href={strat.youtube_url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/25"
                        >
                          Video
                        </a>
                      ) : null}
                    </div>
                    {strat.attack_code ? (
                      <div className="mt-2 text-xs text-zinc-300">Code attaque : {strat.attack_code}</div>
                    ) : null}
                    {strat.commentaire ? (
                      <div className="mt-2 whitespace-pre-wrap text-sm text-zinc-200">{strat.commentaire}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {similarityModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-white shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-bold">Similarites detectees</div>
                <div className="text-sm text-zinc-400">Validation visuelle, une candidate a la fois.</div>
              </div>
              <button
                type="button"
                onClick={() => setSimilarityModal(null)}
                className="rounded-xl border border-zinc-700 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                {t("common.close", "Fermer")}
              </button>
            </div>

            {similarityModal.error ? (
              <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {similarityModal.error}
              </div>
            ) : null}

            <div className="grid min-h-0 gap-4 overflow-y-auto lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
                <div className="mb-2 text-sm font-semibold text-zinc-100">Defense adverse</div>
                {similarityModal.enemyDefense?.imageUrl || similarityModal.enemyDefense?.image_url ? (
                  <img
                    src={similarityModal.enemyDefense.imageUrl || similarityModal.enemyDefense.image_url}
                    alt="Defense adverse"
                    className="h-52 w-full rounded-lg border border-zinc-800 object-cover"
                  />
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {(similarityModal.enemyDefense?.heroes || []).map((hero, index) => (
                    <span key={`${hero.champion}-${index}`} className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs">
                      {renderHeroLine(hero, index)}
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {similarityLoading ? (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 text-sm text-zinc-400">
                    {t("common.loading", "Chargement...")}
                  </div>
                ) : similarityModal.candidates.length === 0 ? (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 text-sm text-zinc-400">
                    Aucune candidate en attente.
                  </div>
                ) : (
                  similarityModal.candidates.map((candidate) => {
                    const localDefense = candidate.localDefense || candidate.local_defense || {};
                    return (
                      <div key={candidate.review?.id} className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 md:grid-cols-[220px_minmax(0,1fr)_auto]">
                        <div className="flex h-36 items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
                          {getLocalImage(localDefense) ? (
                            <img src={getLocalImage(localDefense)} alt={localDefense.name || "Defense locale"} className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-xs text-zinc-500">Aucune image</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-zinc-100">{localDefense.name}</span>
                            <span className="rounded-md border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-xs text-cyan-100">
                              {getLocalGuildCode(localDefense)}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-zinc-400">{localDefense.type || "Defense locale"}</div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {(localDefense.detailedSlots || localDefense.detailed_slots || localDefense.slots || []).map((hero, index) => (
                              <span key={`${localDefense.id}-${index}`} className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100">
                                {renderLocalHeroLine(hero, index)}
                              </span>
                            ))}
                          </div>
                          {(localDefense.conditions || []).length ? (
                            <div className="mt-2 text-xs text-zinc-400">
                              Conditions : {(localDefense.conditions || []).slice(0, 3).map((condition) => condition.label).join(", ")}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={() => reviewSimilarity(candidate, "identical")}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/50 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/25"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Identique
                          </button>
                          <button
                            type="button"
                            onClick={() => reviewSimilarity(candidate, "different")}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/50 bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-100 hover:bg-red-500/25"
                          >
                            <XCircle className="h-4 w-4" />
                            Differente
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {importModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form
            onSubmit={submitImport}
            className="w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-white shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-bold">Importer une defense adverse</div>
                <div className="text-sm text-zinc-400">Copie locale independante, sans modifier la banque adverse.</div>
              </div>
              <button
                type="button"
                onClick={() => setImportModal(null)}
                className="rounded-xl border border-zinc-700 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                {t("common.close", "Fermer")}
              </button>
            </div>

            {importModal.error ? (
              <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {importModal.error}
              </div>
            ) : null}
            {importModal.success ? (
              <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                {importModal.success}
              </div>
            ) : null}

            <div className="grid gap-3">
              <label className="block text-sm font-medium text-zinc-300">
                Guilde cible
                <select
                  value={importModal.targetGuildCode}
                  onChange={(event) => setImportModal((previous) => ({ ...previous, targetGuildCode: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                >
                  {targetGuilds.map((guild) => (
                    <option key={guild.id || guild.guild_code} value={guild.guild_code}>
                      {guild.display_name || guild.guild_code}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium text-zinc-300">
                Nom local
                <input
                  type="text"
                  value={importModal.name}
                  onChange={(event) => setImportModal((previous) => ({ ...previous, name: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                  required
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setImportModal(null)}
                className="rounded-xl border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={importLoading}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/50 bg-emerald-500/20 px-3 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/30 disabled:cursor-wait disabled:opacity-60"
              >
                <Download className="h-4 w-4" />
                {importLoading ? "Import..." : "Importer"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
