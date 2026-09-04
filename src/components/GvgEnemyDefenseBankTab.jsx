import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, ShieldCheck, Swords } from "lucide-react";
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
    throw new Error(data?.error || fallbackMessage);
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

function renderHeroLine(hero, index) {
  const champion = formatHeroName(hero?.champion) || `Hero ${index + 1}`;
  const position = hero?.position || "--";
  const direction = hero?.direction || "--";
  return `${champion} ${position} ${direction}`;
}

export default function GvgEnemyDefenseBankTab({ activeGuildCode = "" }) {
  const { t } = usePortalLanguage();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [rateFilter, setRateFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [stratModal, setStratModal] = useState(null);
  const [stratsLoading, setStratsLoading] = useState(false);

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
        if (data.migrationRequired || data.initialized === false) {
          setMessage(data.migrationMessage || "Banque de defenses adverses non initialisee.");
        }
      } catch (error) {
        if (cancelled) return;
        setItems([]);
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

  const filterButtonClass = (active, activeClass = "border-cyan-500 bg-cyan-950/50 text-cyan-100") =>
    `rounded-xl border px-3 py-1.5 text-sm ${
      active ? activeClass : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
    }`;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
        <div className="font-semibold">Legende taux d'ouverture</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-2 py-1 text-xs text-emerald-100">0-20 % solide</span>
          <span className="rounded-lg border border-yellow-400/40 bg-yellow-500/15 px-2 py-1 text-xs text-yellow-100">20-50 % surveiller</span>
          <span className="rounded-lg border border-orange-400/40 bg-orange-500/15 px-2 py-1 text-xs text-orange-100">50-80 % ouverte</span>
          <span className="rounded-lg border border-red-400/40 bg-red-500/15 px-2 py-1 text-xs text-red-100">80-100 % facile</span>
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
          ["solid", "0-20 %"],
          ["warning", "20-50 %"],
          ["danger", "50-80 %"],
          ["critical", "80-100 %"],
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
                      {String(item.mapType || item.map_type || "tower") === "fortress" ? "Forteresse" : "Tour"} adverse
                    </div>
                    <span className="rounded-md border border-white/15 bg-black/20 px-2 py-0.5 text-xs">
                      {formatPercent(successRate)}
                    </span>
                  </div>

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
                  <button
                    type="button"
                    onClick={() => openStrats(item)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-500/50 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/25"
                  >
                    <Swords className="h-4 w-4" />
                    Voir les strats
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
    </div>
  );
}
