import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Edit3, RefreshCw, SearchCheck, Shield, Trash2, UploadCloud } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { logPortalActivity } from "@/lib/portalActivity";
import { buildChampionDisplayMap, translateChampionName } from "@/lib/championDisplay";
import { fetchPortalChampions } from "@/lib/portalChampions";
import { getGvgGuildLabel, getVisibleGvgGuildCodes, normalizeGvgGuildCode } from "@/lib/guildScope";
import { usePortalLanguage } from "@/lib/portalLanguage";
import { buildPublicPreviewUrl, resolvePublicAssetProxyUrl } from "@/lib/vpsAssets";

const DIRECTIONS = ["N", "S", "E", "O"];
const DEFENSE_SLOT_COUNT = 5;
const JOB_STALE_MS = 48 * 60 * 60 * 1000;
const GVG_MAP_GRID_OPTIONS = {
  tower: { rows: 7, cols: 10 },
  fortress: { rows: 8, cols: 11 },
};

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

async function readJsonResponse(response, label) {
  const rawText = await response.text();

  try {
    return rawText ? JSON.parse(rawText) : null;
  } catch {
    throw new Error(`Reponse non JSON ${label} (${response.status})`);
  }
}

function formatDate(value) {
  if (!value) return "-";

  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function getJobGuildCode(job) {
  return String(job?.target_guild || job?.mode || job?.guild || "").toUpperCase();
}

function isJobForGuild(job, guild) {
  return normalizeGvgGuildCode(getJobGuildCode(job)) === normalizeGvgGuildCode(guild);
}

function getJobSourceGuild(job) {
  return String(job?.resolved_guild || job?.source_guild || job?.guild || "").trim();
}

function getJobId(job) {
  return String(job?.resolved_job_id || job?.job_id || job?.id || "").trim();
}

function getJobTimestamp(job) {
  const value = job?.updated_at || job?.created_at;
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isJobExpired(job) {
  const timestamp = getJobTimestamp(job);
  return timestamp !== null && Date.now() - timestamp > JOB_STALE_MS;
}

function getJobAgeLabel(job) {
  const timestamp = getJobTimestamp(job);
  if (timestamp === null) return "Age inconnu";
  return isJobExpired(job) ? "Caduc +48h" : "Valide -48h";
}

function buildPreviewUrl(job, item) {
  if (!item?.preview_file) return resolvePublicAssetProxyUrl(item?.image_url || "");

  return (
    buildPublicPreviewUrl(getJobSourceGuild(job), getJobId(job), item.preview_file) ||
    `/api/gvg-server?action=preview&guild=${encodeURIComponent(getJobSourceGuild(job))}&jobId=${encodeURIComponent(
      getJobId(job)
    )}&file=${encodeURIComponent(item.preview_file)}`
  );
}

function resolveApiUrl(apiBase, url) {
  const resolvedUrl = resolvePublicAssetProxyUrl(url);
  if (!resolvedUrl) return "";
  if (/^https?:\/\//i.test(resolvedUrl)) return resolvedUrl;
  if (resolvedUrl.startsWith("/api/") && apiBase) return `${apiBase}${resolvedUrl}`;
  return resolvedUrl;
}

function normalizePayloadItems(job, payload) {
  const rawItems = Array.isArray(payload?.items)
    ? payload.items
    : Array.isArray(payload?.payload?.items)
      ? payload.payload.items
      : [];

  return rawItems.map((item, index) => {
    const rawCompo = Array.isArray(item?.compo) ? item.compo : [];
    const normalizedCompo = Array.from({ length: DEFENSE_SLOT_COUNT }, (_, heroIndex) => {
      const hero = rawCompo[heroIndex] || {};
      const hasHero = Boolean(hero?.champion || hero?.position || hero?.direction);

      return {
        champion: hero?.champion || "",
        position: hero?.position || "",
        direction: hero?.direction || "",
        _missing: !hasHero,
      };
    });

    return {
      ...item,
      image_url: buildPreviewUrl(job, item),
      compo: normalizedCompo,
      _recognizedCount: rawCompo.length,
      _expectedCount: Number(item?.expected_heroes || DEFENSE_SLOT_COUNT),
      _localId: `${item?.def || "def"}-${index}`,
      _validated: false,
      _edited: false,
    };
  });
}

function stripUiFields(item) {
  const cleaned = {};

  for (const [key, value] of Object.entries(item || {})) {
    if (!key.startsWith("_")) cleaned[key] = value;
  }

  cleaned.compo = Array.isArray(item?.compo)
    ? item.compo.map((hero) => ({
        champion: String(hero?.champion || "").trim(),
        position: String(hero?.position || "").trim(),
        direction: String(hero?.direction || "").trim(),
      }))
    : [];

  return cleaned;
}

function getDefenseLabel(item) {
  return item?.def || item?.raw_name || "Defense inconnue";
}

function makePositionOptions({ rows, cols }) {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").slice(0, Math.max(0, rows));
  return letters.flatMap((row) => Array.from({ length: Math.max(0, cols) }, (_, index) => `${row}${index + 1}`));
}

function getItemGridKind(item) {
  const explicitType = String(item?.type || "").toLowerCase();
  if (explicitType === "fortress") return "fortress";
  if (explicitType === "tower") return "tower";

  const value = String(item?.def || item?.raw_name || "").toLowerCase();
  if (value.includes("tower")) return "tower";
  if (value.includes("fortress")) return "fortress";
  return "tower";
}

function getPositionOptionsForItem(item) {
  const grid = GVG_MAP_GRID_OPTIONS[getItemGridKind(item)] || GVG_MAP_GRID_OPTIONS.tower;
  return makePositionOptions(grid);
}

function getValidationTone(item) {
  if (item?._validated && item?._edited) return "border-amber-400/45 bg-amber-500/10";
  if (item?._validated) return "border-emerald-400/45 bg-emerald-500/10";
  if (needsManualReview(item)) return "border-amber-400/70 bg-amber-500/12 shadow-[0_0_22px_rgba(245,158,11,0.14)]";
  return "border-zinc-800 bg-zinc-950/65";
}

function isItemSuspicious(item) {
  if (!item) return false;
  if (item.reco_ok === false) return true;
  if (item.reco_issue) return true;
  return Number(item.heroes_found ?? item._recognizedCount ?? 0) < Number(item.expected_heroes ?? item._expectedCount ?? DEFENSE_SLOT_COUNT);
}

function getItemIssueLabel(item) {
  if (!isItemSuspicious(item)) return "";
  const found = Number(item?.heroes_found ?? item?._recognizedCount ?? 0);
  const expected = Number(item?.expected_heroes ?? item?._expectedCount ?? DEFENSE_SLOT_COUNT);
  if (found < expected) return `${expected - found} slot(s) a completer`;
  return "Reco a verifier";
}

function isHeroSlotComplete(hero) {
  return Boolean(hero?.champion?.trim() && hero?.position?.trim() && hero?.direction?.trim());
}

function isItemComplete(item) {
  return Array.isArray(item?.compo) && item.compo.length === DEFENSE_SLOT_COUNT && item.compo.every(isHeroSlotComplete);
}

function needsManualReview(item) {
  return Boolean(item && !item._validated && (isItemSuspicious(item) || !isItemComplete(item)));
}

function getManualReviewLabel(item) {
  if (!item) return "";
  const missingSlots = Array.isArray(item.compo)
    ? item.compo.filter((hero) => !isHeroSlotComplete(hero)).length
    : DEFENSE_SLOT_COUNT;
  if (missingSlots > 0) return `${missingSlots} slot(s) a completer`;
  return getItemIssueLabel(item) || "Reco a verifier";
}

function getJobTone(job) {
  if (job.state === "error") return "border-red-500/35 bg-red-500/10";
  if (isJobExpired(job)) return "border-red-500/45 bg-red-500/12";
  if (job.state === "ready") return "border-emerald-500/35 bg-emerald-500/10";
  if (job.state === "processing") return "border-cyan-500/35 bg-cyan-500/10";
  return "border-zinc-800 bg-zinc-950/65";
}

function getDefaultValidationGuild(session) {
  return getVisibleGvgGuildCodes(session)[0] || "G1";
}

function isGuildAllowed(guild, visibleGuilds) {
  const normalizedGuild = normalizeGvgGuildCode(guild);
  return visibleGuilds.some((item) => normalizeGvgGuildCode(item) === normalizedGuild);
}

export default function GvgValidationTab({ session }) {
  const apiBase = useMemo(() => getApiBase(), []);
  const { language, t } = usePortalLanguage();
  const visibleGuilds = useMemo(() => getVisibleGvgGuildCodes(session), [session]);

  const [guild, setGuild] = useState(() => getDefaultValidationGuild(session));
  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [items, setItems] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [loadingPayload, setLoadingPayload] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deletingJobId, setDeletingJobId] = useState(null);
  const [message, setMessage] = useState("");
  const [championPool, setChampionPool] = useState([]);
  const [championDisplayMap, setChampionDisplayMap] = useState(() => new Map());

  const visibleJobs = useMemo(
    () => jobs.filter((job) => isJobForGuild(job, guild)),
    [guild, jobs]
  );

  const hiddenJobsCount = jobs.length - visibleJobs.length;
  const selectedGuildAllowed = isGuildAllowed(guild, visibleGuilds);
  const selectedItem = items[selectedIndex] || null;
  const positionOptions = useMemo(() => getPositionOptionsForItem(selectedItem), [selectedItem]);
  const validatedCount = items.filter((item) => item._validated).length;
  const editedCount = items.filter((item) => item._edited).length;
  const suspiciousCount = items.filter(needsManualReview).length;
  const readyToImport = items.length > 0 && validatedCount === items.length;
  const championOptions = useMemo(() => {
    const values = new Set();

    for (const champion of championPool) {
      const value = String(champion || "").trim();
      if (value) values.add(value);
    }

    for (const item of items) {
      for (const hero of item.compo || []) {
        const champion = String(hero?.champion || "").trim();
        if (champion) values.add(champion);
      }
    }

    return Array.from(values).sort((left, right) => left.localeCompare(right, "fr"));
  }, [championPool, items]);

  useEffect(() => {
    if (visibleGuilds.length === 0) {
      setGuild("");
      setSelectedJob(null);
      setItems([]);
      setSelectedIndex(0);
      setJobs([]);
      return;
    }

    if (isGuildAllowed(guild, visibleGuilds)) return;

    setGuild(visibleGuilds[0]);
    setSelectedJob(null);
    setItems([]);
    setSelectedIndex(0);
    setJobs([]);
  }, [guild, visibleGuilds]);

  useEffect(() => {
    let cancelled = false;

    async function loadChampionPool() {
      try {
        const data = await fetchPortalChampions();
        if (!cancelled) {
          setChampionPool((data || []).map((row) => row.name).filter(Boolean));
          setChampionDisplayMap(buildChampionDisplayMap(data || []));
        }
      } catch (error) {
        console.warn("champions autocomplete unavailable:", error);
      }
    }

    loadChampionPool();

    return () => {
      cancelled = true;
    };
  }, []);

  async function loadJobs() {
    if (!selectedGuildAllowed) {
      setMessage("Guilde non autorisee pour cette session.");
      return;
    }

    try {
      setLoadingJobs(true);
      setMessage("");

      const response = await fetch(
        `${apiBase}/api/gvg-server?action=jobs&limit=100&guild=${encodeURIComponent(guild)}`,
        { credentials: "include" }
      );
      const data = await readJsonResponse(response, "jobs VPS");

      if (!response.ok) {
        setMessage(`Erreur jobs VPS : ${data?.error || "erreur inconnue"}`);
        return;
      }

      const loadedJobs = Array.isArray(data?.jobs) ? data.jobs : [];
      setJobs(loadedJobs);
      setMessage(`Jobs charges : ${loadedJobs.length}. Affiches pour ${guild} : ${loadedJobs.filter((job) => isJobForGuild(job, guild)).length}.`);
    } catch (error) {
      console.error("loadJobs error:", error);
      setMessage(`Erreur jobs VPS : ${error?.message || "erreur inconnue"}`);
    } finally {
      setLoadingJobs(false);
    }
  }

  async function selectJob(job) {
    if (!isJobForGuild(job, guild)) {
      setMessage("Job hors perimetre pour cette session.");
      return;
    }

    try {
      setLoadingPayload(true);
      setMessage("");
      setSelectedJob(job);
      setItems([]);
      setSelectedIndex(0);

      const response = await fetch(
        `${apiBase}/api/gvg-server?action=payload&guild=${encodeURIComponent(
          getJobSourceGuild(job)
        )}&jobId=${encodeURIComponent(getJobId(job))}`,
        { credentials: "include" }
      );
      const data = await readJsonResponse(response, "payload VPS");

      if (!response.ok) {
        setMessage(`Erreur payload VPS : ${data?.error || "erreur inconnue"}`);
        return;
      }

      const nextItems = normalizePayloadItems(job, data);
      setItems(nextItems);
      setMessage(`Payload charge : ${nextItems.length} defenses a controler.`);
    } catch (error) {
      console.error("selectJob error:", error);
      setMessage(`Erreur payload VPS : ${error?.message || "erreur inconnue"}`);
    } finally {
      setLoadingPayload(false);
    }
  }

  async function deleteServerJob(job) {
    if (!isJobForGuild(job, guild)) {
      setMessage("Suppression bloquee : job hors perimetre pour cette session.");
      return;
    }

    const sourceGuild = getJobSourceGuild(job);
    const jobId = getJobId(job);

    if (!sourceGuild || !jobId) {
      setMessage("Impossible de supprimer ce job : reference serveur invalide.");
      return;
    }

    const confirmed = window.confirm(
      `Supprimer definitivement le probe ${sourceGuild} / ${jobId} du serveur ?`
    );

    if (!confirmed) return;

    try {
      setDeletingJobId(jobId);
      setMessage(`Suppression du probe ${sourceGuild} / ${jobId} en cours...`);

      const response = await fetch(`${apiBase}/api/gvg-server`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "delete",
          sourceGuild,
          jobId,
        }),
      });
      const data = await readJsonResponse(response, "suppression job VPS");

      if (!response.ok) {
        setMessage(`Erreur suppression VPS : ${data?.error || "erreur inconnue"}`);
        return;
      }

      setJobs((current) =>
        current.filter(
          (item) => getJobSourceGuild(item) !== sourceGuild || getJobId(item) !== jobId
        )
      );

      if (getJobId(selectedJob) === jobId) {
        setSelectedJob(null);
        setItems([]);
        setSelectedIndex(0);
      }

      setMessage(`Probe supprime du serveur : ${sourceGuild} / ${jobId}.`);
      void logPortalActivity(session, {
        targetMemberId: session?.memberId || session?.id || null,
        targetName: session?.watcherName || session?.name || "",
        actionType: "gvg_job_delete",
        entityType: "gvg",
        entityId: jobId,
        summary: `${session?.watcherName || session?.name || "Joueur"} a supprime un job GVG ${sourceGuild} / ${jobId}`,
        metadata: { sourceGuild, jobId },
      });
    } catch (error) {
      console.error("deleteServerJob error:", error);
      setMessage(`Erreur suppression VPS : ${error?.message || "erreur inconnue"}`);
    } finally {
      setDeletingJobId(null);
    }
  }

  function updateHero(rowIndex, field, value) {
    setItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== selectedIndex) return item;

        const nextCompo = item.compo.map((hero, heroIndex) =>
          heroIndex === rowIndex ? { ...hero, [field]: value, _missing: false } : hero
        );

        return {
          ...item,
          compo: nextCompo,
          def_key_sha1: null,
          _edited: true,
          _validated: false,
        };
      })
    );
  }

  function validateSelected() {
    if (!selectedItem || !isItemComplete(selectedItem)) {
      setMessage("Impossible de valider : la defense doit contenir 5 heros avec nom, position et direction.");
      return;
    }

    setItems((current) =>
      current.map((item, index) =>
        index === selectedIndex ? { ...item, _validated: true } : item
      )
    );
    setMessage("Defense validee.");
  }

  function validateAll() {
    const incompleteCount = items.filter((item) => !isItemComplete(item)).length;

    setItems((current) =>
      current.map((item) => (isItemComplete(item) ? { ...item, _validated: true } : item))
    );

    setMessage(
      incompleteCount
        ? `${items.length - incompleteCount} defense(s) validee(s). ${incompleteCount} defense(s) restent a completer.`
        : "Toutes les defenses sont validees."
    );
  }

  async function importValidated() {
    if (!selectedGuildAllowed) {
      setMessage("Import bloque : guilde non autorisee pour cette session.");
      return;
    }

    if (!readyToImport || !selectedJob) {
      setMessage("Tout doit etre valide avant l'import.");
      return;
    }

    if (items.some((item) => !isItemComplete(item))) {
      setMessage("Import bloque : chaque defense doit contenir 5 heros complets.");
      return;
    }

    const confirmed = window.confirm(
      `Importer ${items.length} defenses validees dans ${guild} ?`
    );

    if (!confirmed) return;

    try {
      setImporting(true);
      setMessage("");

      const response = await fetch(`${apiBase}/api/gvg-import`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          guild,
          is_ally: selectedJob.side === "ally",
          items: items.map(stripUiFields),
        }),
      });
      const data = await readJsonResponse(response, "import validation");

      if (!response.ok) {
        setMessage(`Erreur import : ${data?.error || "erreur inconnue"}`);
        return;
      }

      setMessage(`Import OK : ${data?.inserted || 0} defenses injectees dans ${data?.guild}.`);
      void logPortalActivity(session, {
        targetMemberId: session?.memberId || session?.id || null,
        targetName: session?.watcherName || session?.name || "",
        actionType: "gvg_validation_import",
        entityType: "gvg",
        entityId: getJobId(selectedJob),
        summary: `${session?.watcherName || session?.name || "Joueur"} a importe ${data?.inserted || 0} defenses GVG dans ${data?.guild || guild}`,
        metadata: {
          guild,
          inserted: data?.inserted || 0,
          sourceGuild: getJobSourceGuild(selectedJob),
          jobId: getJobId(selectedJob),
          side: selectedJob.side || "",
          editedCount,
        },
      });
    } catch (error) {
      console.error("importValidated error:", error);
      setMessage(`Erreur import : ${error?.message || "erreur inconnue"}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl border-zinc-800 bg-zinc-900/70 shadow-2xl">
        <CardHeader className="border-b border-zinc-800">
          <CardTitle className="flex items-center gap-2 text-lg text-zinc-100">
            <SearchCheck className="h-5 w-5 text-cyan-300" />
            {t("validation.title", "Validation reconnaissance GVG")}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6 p-4 md:p-6">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm text-zinc-400">{t("validation.targetGuild", "Guilde ciblee")}</div>
                <div className="mt-1 text-xs text-zinc-500">
                  {t("validation.scopeHelp", "L'ecran ne montre que les jobs de la guilde selectionnee.")}
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="rounded-2xl border-zinc-700 text-zinc-200"
                disabled={loadingJobs}
                onClick={loadJobs}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {loadingJobs ? t("validation.loadingJobs", "Chargement...") : t("validation.loadJobs", "Charger les jobs")}
              </Button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {visibleGuilds.map((item) => (
                <Button
                  key={item}
                  type="button"
                  variant={normalizeGvgGuildCode(guild) === normalizeGvgGuildCode(item) ? "default" : "outline"}
                  className="rounded-2xl"
                  onClick={() => {
                    setGuild(item);
                    setSelectedJob(null);
                    setItems([]);
                    setSelectedIndex(0);
                  }}
                >
                  {getGvgGuildLabel(item)}
                </Button>
              ))}
            </div>

            {message ? (
              <div className="mt-4 rounded-2xl border border-cyan-500/25 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
                {message}
              </div>
            ) : null}
          </div>

          <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-zinc-100">{t("validation.jobs", "Jobs disponibles")}</div>
                    <div className="text-xs text-zinc-500">
                      {hiddenJobsCount > 0
                        ? `${hiddenJobsCount} job(s) hors ${guild} masques.`
                        : t("validation.noHiddenJob", "Aucun job hors guilde affiche.")}
                    </div>
                  </div>
                  <Shield className="h-5 w-5 text-zinc-500" />
                </div>

                <div className="mt-4 space-y-3">
                  {visibleJobs.length ? (
                    visibleJobs.map((job) => (
                      <div
                        key={`${getJobSourceGuild(job)}-${getJobId(job)}`}
                        role="button"
                        tabIndex={job.state !== "ready" || !job.has_site_payload || loadingPayload ? -1 : 0}
                        aria-disabled={job.state !== "ready" || !job.has_site_payload || loadingPayload}
                        className={`relative w-full rounded-2xl border p-3 pr-12 text-left transition hover:border-cyan-300/60 ${
                          job.state !== "ready" || !job.has_site_payload || loadingPayload
                            ? "cursor-not-allowed opacity-50"
                            : "cursor-pointer"
                        } ${getJobTone(job)} ${
                          getJobId(selectedJob) === getJobId(job) ? "ring-2 ring-cyan-300/70" : ""
                        }`}
                        onClick={() => {
                          if (job.state !== "ready" || !job.has_site_payload || loadingPayload) return;
                          selectJob(job);
                        }}
                      >
                        <div className="text-sm font-semibold text-zinc-100">
                          {job.guild} · {job.side || "-"} · {job.state}
                        </div>
                        <div className="mt-1 text-xs text-zinc-400">
                          {formatDate(job.created_at)} · {job.files_count || 0} captures · {job.size_mb || 0} Mo
                        </div>
                        <div className="mt-1 truncate text-xs text-zinc-500">{getJobId(job)}</div>
                        <div className={`mt-2 inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${
                          isJobExpired(job)
                            ? "border-red-400/40 bg-red-500/15 text-red-200"
                            : "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                        }`}>
                          {getJobAgeLabel(job)}
                        </div>
                        <button
                          type="button"
                          className="absolute right-3 top-3 rounded-xl border border-red-500/40 bg-red-500/10 p-2 text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={deletingJobId === getJobId(job)}
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteServerJob(job);
                          }}
                          title="Supprimer ce probe du serveur"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 text-sm text-zinc-400">
                      {t("validation.noJob", "Aucun job")} {guild} {t("validation.loaded", "charge.")}
                    </div>
                  )}
                </div>
              </div>

              {items.length ? (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-zinc-100">{t("validation.control", "Controle des defenses")}</div>
                      <div className="text-xs text-zinc-500">
                        {validatedCount}/{items.length} validees · {editedCount} corrigee(s)
                        {suspiciousCount ? ` · ${suspiciousCount} a verifier` : ""}
                      </div>
                    </div>
                    <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                  </div>

                  <div className="mt-4 max-h-[520px] space-y-2 overflow-y-auto pr-1">
                    {items.map((item, index) => (
                      <button
                        key={item._localId}
                        type="button"
                        className={`w-full rounded-2xl border p-3 text-left transition hover:border-cyan-300/60 ${getValidationTone(item)} ${
                          index === selectedIndex ? "ring-2 ring-cyan-300/70" : ""
                        }`}
                        onClick={() => setSelectedIndex(index)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-2">
                            {needsManualReview(item) ? (
                              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
                            ) : null}
                            <span className="truncate text-sm font-semibold text-zinc-100">
                              {getDefenseLabel(item)}
                            </span>
                          </span>
                          <span
                            className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold ${
                              item._validated
                                ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                                : needsManualReview(item)
                                  ? "border-amber-400/45 bg-amber-500/15 text-amber-200"
                                  : "border-zinc-700 bg-zinc-900 text-zinc-300"
                            }`}
                          >
                            {item._validated ? "OK" : needsManualReview(item) ? "Doute" : "A verifier"}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          {Number(item.heroes_found ?? item._recognizedCount ?? 0)}/{Number(item.expected_heroes ?? item._expectedCount ?? DEFENSE_SLOT_COUNT)} heros reconnus
                          {needsManualReview(item) ? (
                            <span className="ml-2 text-amber-300">{getManualReviewLabel(item)}</span>
                          ) : null}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="min-h-[520px] rounded-3xl border border-zinc-800 bg-zinc-950/65 p-4 shadow-2xl">
              {!selectedJob ? (
                <div className="flex min-h-[480px] flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/60 p-8 text-center">
                  <SearchCheck className="h-10 w-10 text-zinc-600" />
                  <div className="mt-4 text-lg font-semibold text-zinc-100">
                    {t("validation.selectJob", "Selectionne un job")} {guild}
                  </div>
                  <div className="mt-2 max-w-md text-sm text-zinc-400">
                    {t("validation.selectJobHelp", "Charge les jobs VPS, choisis une reconnaissance terminee, puis controle les 48 defenses avant import.")}
                  </div>
                </div>
              ) : loadingPayload ? (
                <div className="flex min-h-[480px] items-center justify-center text-sm text-zinc-400">
                  {t("validation.payloadLoading", "Chargement du payload...")}
                </div>
              ) : selectedItem ? (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm text-zinc-500">{t("validation.selectedDefense", "Defense selectionnee")}</div>
                      <h2 className="mt-1 text-2xl font-semibold text-zinc-100">
                        {getDefenseLabel(selectedItem)}
                      </h2>
                      <div className="mt-1 text-xs text-zinc-500">
                        Job {selectedJob.job_id} · {selectedJob.side || "-"} · {guild}
                      </div>
                      {needsManualReview(selectedItem) ? (
                        <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-100">
                          <AlertTriangle className="h-4 w-4" />
                          {getManualReviewLabel(selectedItem)}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-2xl border-zinc-700 text-zinc-200"
                        onClick={validateSelected}
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        {t("validation.validateOne", "Valider cette defense")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-2xl border-zinc-700 text-zinc-200"
                        onClick={validateAll}
                      >
                        {t("validation.validateAll", "Tout valider")}
                      </Button>
                      <Button
                        type="button"
                        className="rounded-2xl"
                        disabled={!readyToImport || importing}
                        onClick={importValidated}
                      >
                        <UploadCloud className="mr-2 h-4 w-4" />
                        {importing ? t("validation.importing", "Import...") : t("validation.import", "Importer")}
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_460px]">
                    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-black/60">
                      {selectedItem.image_url ? (
                        <img
                          src={resolveApiUrl(apiBase, selectedItem.image_url)}
                          alt={getDefenseLabel(selectedItem)}
                          className="max-h-[620px] w-full object-contain"
                        />
                      ) : (
                        <div className="flex min-h-[360px] items-center justify-center text-sm text-zinc-500">
                          {t("validation.noImage", "Aucune image disponible.")}
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/75 p-4">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-zinc-100">{t("validation.recognizedComp", "Composition reconnue")}</div>
                          <div className="text-xs text-zinc-500">
                            {t("validation.compHelp", "5 slots obligatoires. Modifier une ligne remet la defense en attente de validation.")}
                          </div>
                        </div>
                        <Edit3 className="h-5 w-5 text-zinc-500" />
                      </div>

                      <datalist id="gvg-validation-heroes">
                        {championOptions.map((champion) => (
                          <option key={champion} value={champion} />
                        ))}
                      </datalist>
                      <datalist id="gvg-validation-positions">
                        {positionOptions.map((position) => (
                          <option key={position} value={position} />
                        ))}
                      </datalist>

                      <div className="space-y-3">
                        {selectedItem.compo.map((hero, heroIndex) => (
                          <div
                            key={`${selectedItem._localId}-${heroIndex}`}
                            className={`grid gap-2 rounded-2xl border p-3 ${
                              isHeroSlotComplete(hero)
                                ? "border-zinc-800 bg-zinc-900/60"
                                : "border-amber-400/40 bg-amber-500/10"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.14em]">
                              <span className={isHeroSlotComplete(hero) ? "text-zinc-500" : "text-amber-200"}>
                                Slot {heroIndex + 1}
                              </span>
                              {isHeroSlotComplete(hero) ? (
                                <span className="text-emerald-300">{t("validation.complete", "Complet")}</span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-amber-200">
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                  {t("validation.toFill", "A remplir")}
                                </span>
                              )}
                            </div>

                            <input
                              value={hero.champion || ""}
                              onChange={(event) => updateHero(heroIndex, "champion", event.target.value)}
                              list="gvg-validation-heroes"
                              className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-300/80"
                              placeholder={t("validation.heroName", "Nom du heros")}
                            />
                            {language === "en" && hero.champion ? (
                              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-300">
                                EN: {translateChampionName(hero.champion, championDisplayMap, language)}
                              </div>
                            ) : null}

                            <div className="grid grid-cols-2 gap-2">
                              <input
                                value={hero.position || ""}
                                onChange={(event) => updateHero(heroIndex, "position", event.target.value)}
                                list="gvg-validation-positions"
                                className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-300/80"
                                placeholder="Position"
                              />

                              <select
                                value={hero.direction || ""}
                                onChange={(event) => updateHero(heroIndex, "direction", event.target.value)}
                                className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-300/80"
                              >
                                <option value="">Direction</option>
                                {DIRECTIONS.map((direction) => (
                                  <option key={direction} value={direction}>
                                    {direction}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[480px] items-center justify-center text-sm text-zinc-400">
                  {t("validation.noPayloadItem", "Aucun item dans ce payload.")}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
