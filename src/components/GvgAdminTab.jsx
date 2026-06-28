import React, { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getGvgGuildLabel, getVisibleGvgGuildCodes } from "@/lib/guildScope";
import { usePortalLanguage } from "@/lib/portalLanguage";

const JOB_STALE_MS = 48 * 60 * 60 * 1000;

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
  return String(job?.target_guild || job?.mode || job?.guild || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function isJobForGuild(job, guild) {
  return getJobGuildCode(job) === guild;
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

function getJobAgeLabel(job, t) {
  const timestamp = getJobTimestamp(job);
  if (timestamp === null) return t("gvgAdmin.unknownAge", "Age inconnu");
  return isJobExpired(job) ? t("gvgAdmin.expired48h", "Caduc +48h") : t("gvgAdmin.valid48h", "Valide -48h");
}

function getJobTone(job) {
  if (job.state === "error") return "border-red-500/35 bg-red-500/10";
  if (isJobExpired(job)) return "border-red-500/45 bg-red-500/12";
  if (job.state === "ready") return "border-emerald-500/35 bg-emerald-500/10";
  if (job.state === "processing") return "border-cyan-500/35 bg-cyan-500/10";
  return "border-zinc-700 bg-zinc-950/55";
}

export default function GvgAdminTab({ session } = {}) {
  const { t } = usePortalLanguage();
  const apiBase = useMemo(() => getApiBase(), []);
  const visibleGuilds = useMemo(() => getVisibleGvgGuildCodes(session), [session]);

  const [guild, setGuild] = useState("G1");
  const [jsonInput, setJsonInput] = useState("");
  const [jsonInputAlly, setJsonInputAlly] = useState("");
  const [loadingImport, setLoadingImport] = useState(false);
  const [loadingReset, setLoadingReset] = useState(false);
  const [message, setMessage] = useState("");
  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [groupJson, setGroupJson] = useState("");
  const [serverJobs, setServerJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [jobImportingId, setJobImportingId] = useState(null);
  const [jobDeletingId, setJobDeletingId] = useState(null);
  const visibleServerJobs = useMemo(
    () => serverJobs.filter((job) => isJobForGuild(job, guild)),
    [guild, serverJobs]
  );
  const hiddenServerJobsCount = serverJobs.length - visibleServerJobs.length;
  const selectedGuildAllowed = visibleGuilds.includes(guild);

  useEffect(() => {
    if (visibleGuilds.length === 0) return;
    setGuild((current) => (visibleGuilds.includes(current) ? current : visibleGuilds[0]));
  }, [visibleGuilds]);

  async function importItems(items, { ally = false } = {}) {
    if (!selectedGuildAllowed) {
      throw new Error("Guilde non autorisee pour cette session.");
    }

    const response = await fetch(`${apiBase}/api/gvg-import`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        guild,
        items,
        is_ally: ally,
      }),
    });

    const data = await readJsonResponse(response, ally ? "import allie" : "import");

    if (!response.ok) {
      throw new Error(data?.error || "erreur inconnue");
    }

    return data;
  }

  async function handleImport() {
    try {
      setLoadingImport(true);
      setMessage("");

      let parsed = null;

      try {
        parsed = JSON.parse(jsonInput);
      } catch {
        setMessage("JSON invalide.");
        return;
      }

      if (!Array.isArray(parsed) || !parsed.length) {
        setMessage("Le JSON doit etre un tableau non vide.");
        return;
      }

      const data = await importItems(parsed);
      setMessage(`Import OK : ${data?.inserted || 0} defenses injectees pour ${data?.guild}.`);
    } catch (error) {
      console.error("handleImport error:", error);
      setMessage(`Erreur import : ${error?.message || "erreur inconnue"}`);
    } finally {
      setLoadingImport(false);
    }
  }

  async function handleImportAlly() {
    try {
      setLoadingImport(true);
      setMessage("");

      let parsed = null;

      try {
        parsed = JSON.parse(jsonInputAlly);
      } catch {
        setMessage("JSON allie invalide.");
        return;
      }

      if (!Array.isArray(parsed) || !parsed.length) {
        setMessage("Le JSON allie doit etre un tableau non vide.");
        return;
      }

      const data = await importItems(parsed, { ally: true });
      setMessage(`Import ALLIE OK : ${data?.inserted || 0} defenses injectees pour ${data?.guild}.`);
    } catch (error) {
      console.error("handleImportAlly error:", error);
      setMessage(`Erreur import allie : ${error?.message || "erreur inconnue"}`);
    } finally {
      setLoadingImport(false);
    }
  }

  async function handleReset() {
    if (!selectedGuildAllowed) return;

    const confirmed = window.confirm(`Reinitialiser entierement la GVG ${getGvgGuildLabel(guild)} ?`);

    if (!confirmed) return;

    try {
      setLoadingReset(true);
      setMessage("");

      const response = await fetch(`${apiBase}/api/gvg-reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          guild,
          actor: {
            memberId: session?.memberId || session?.id || null,
            name: session?.watcherName || session?.memberName || session?.name || session?.discordId || "Inconnu",
            role: session?.role || null,
            guildCode: session?.guildCode || session?.guild_code || null,
          },
        }),
      });

      const data = await readJsonResponse(response, "reset");

      if (!response.ok) {
        setMessage(`Erreur reset : ${data?.error || "erreur inconnue"}`);
        return;
      }

      setMessage(`Reset OK : ${data?.guild} vide.`);
    } catch (error) {
      console.error("handleReset error:", error);
      setMessage(`Erreur reset : ${error?.message || "erreur inconnue"}`);
    } finally {
      setLoadingReset(false);
    }
  }

  async function loadServerJobs() {
    if (!selectedGuildAllowed) return;

    try {
      setLoadingJobs(true);
      setMessage("");

      const response = await fetch(
        `${apiBase}/api/gvg-server?action=jobs&limit=25&guild=${encodeURIComponent(guild)}`
      );
      const data = await readJsonResponse(response, "jobs VPS");

      if (!response.ok) {
        setMessage(`Erreur jobs VPS : ${data?.error || "erreur inconnue"}`);
        return;
      }

      setServerJobs(Array.isArray(data?.jobs) ? data.jobs : []);
      setMessage(`Jobs VPS charges : ${data?.jobs?.length || 0}. Affiches pour ${getGvgGuildLabel(guild)} : ${(data?.jobs || []).filter((job) => isJobForGuild(job, guild)).length}.`);
    } catch (error) {
      console.error("loadServerJobs error:", error);
      setMessage(`Erreur jobs VPS : ${error?.message || "erreur inconnue"}`);
    } finally {
      setLoadingJobs(false);
    }
  }

  async function importServerJob(job) {
    if (!selectedGuildAllowed) return;

    const confirmed = window.confirm(
      `Importer le job ${getJobSourceGuild(job)} / ${getJobId(job)} dans ${getGvgGuildLabel(guild)} ?`
    );

    if (!confirmed) return;

    try {
      setJobImportingId(getJobId(job));
      setMessage("");

      const response = await fetch(`${apiBase}/api/gvg-server`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "import",
          targetGuild: guild,
          sourceGuild: getJobSourceGuild(job),
          jobId: getJobId(job),
          side: job.side,
        }),
      });

      const data = await readJsonResponse(response, "import job VPS");

      if (!response.ok) {
        setMessage(`Erreur import job VPS : ${data?.error || "erreur inconnue"}`);
        return;
      }

      setMessage(
        `Import VPS OK : ${data?.imported || 0} defenses injectees dans ${data?.guild}.`
      );
    } catch (error) {
      console.error("importServerJob error:", error);
      setMessage(`Erreur import job VPS : ${error?.message || "erreur inconnue"}`);
    } finally {
      setJobImportingId(null);
    }
  }

  async function deleteServerJob(job) {
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
      setJobDeletingId(jobId);
      setMessage(`Suppression du probe ${sourceGuild} / ${jobId} en cours...`);

      const response = await fetch(`${apiBase}/api/gvg-server`, {
        method: "POST",
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

      setServerJobs((current) =>
        current.filter(
          (item) => getJobSourceGuild(item) !== sourceGuild || getJobId(item) !== jobId
        )
      );
      setMessage(`Probe supprime du serveur : ${sourceGuild} / ${jobId}.`);
    } catch (error) {
      console.error("deleteServerJob error:", error);
      setMessage(`Erreur suppression VPS : ${error?.message || "erreur inconnue"}`);
    } finally {
      setJobDeletingId(null);
    }
  }

  async function handleImportGroups() {
    if (!selectedGuildAllowed) return;

    try {
      const parsed = JSON.parse(groupJson);

      const response = await fetch(`${apiBase}/api/gvg-data`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "import_groups",
          guild,
          data: parsed,
        }),
      });

      const data = await readJsonResponse(response, "import groupes");

      if (!response.ok || !data?.success) {
        setMessage(`Erreur import groupes : ${data?.error || "erreur inconnue"}`);
        return;
      }

      setMessage("Groupes importes.");
    } catch (error) {
      setMessage(`Erreur import groupes : ${error?.message || "JSON invalide"}`);
    }
  }

  async function handleUploadImages(files) {
    if (!selectedGuildAllowed) return;

    if (!files.length) return;

    const BATCH_SIZE = 8;

    try {
      setUploadingImages(true);
      setUploadResult(null);

      const allResults = [];

      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        const formData = new FormData();
        formData.append("guild", guild);

        batch.forEach((file) => {
          formData.append("files", file);
        });

        const response = await fetch(`${apiBase}/api/gvg-upload-images`, {
          method: "POST",
          body: formData,
        });

        const data = await readJsonResponse(response, "upload images");

        if (!response.ok) {
          setUploadResult({
            error: data?.error || `Erreur upload batch (${response.status})`,
            details: data,
            batchStart: i,
            batchEnd: i + batch.length - 1,
          });
          return;
        }

        if (Array.isArray(data?.results)) {
          allResults.push(...data.results);
        }
      }

      setUploadResult({
        success: true,
        guild,
        totalFiles: files.length,
        results: allResults,
      });
    } catch (error) {
      console.error(error);
      setUploadResult({ error: error.message });
    } finally {
      setUploadingImages(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl border-zinc-800 bg-zinc-900/70 shadow-2xl">
        <CardHeader className="border-b border-zinc-800">
          <CardTitle className="text-lg text-zinc-100">{t("gvgAdmin.title", "Admin GVG")}</CardTitle>
        </CardHeader>

        <CardContent className="space-y-6 p-4 md:p-6">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="text-sm text-zinc-400">{t("gvgAdmin.targetGuild", "Guilde ciblee")}</div>

            <div className="mt-3 flex flex-wrap gap-3">
                {visibleGuilds.map((item) => (
                <Button
                  key={item}
                  type="button"
                  variant={guild === item ? "default" : "outline"}
                  className="rounded-2xl"
                  onClick={() => setGuild(item)}
                >
                  {getGvgGuildLabel(item)}
                </Button>
              ))}

              <Button
                type="button"
                variant="destructive"
                className="rounded-2xl"
                disabled={loadingImport || loadingReset || !selectedGuildAllowed}
                onClick={handleReset}
              >
                {loadingReset ? t("gvgAdmin.resetting", "Reset...") : `${t("gvgAdmin.reset", "Reset")} ${getGvgGuildLabel(guild)}`}
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-cyan-100">{t("gvgAdmin.vpsJobs", "Jobs VPS")}</div>
                <div className="text-xs text-zinc-400">
                  {t("gvgAdmin.vpsJobsHelp", "Captures envoyees par les launchers joueurs et traitees cote serveur.")}
                  {hiddenServerJobsCount > 0 ? ` ${hiddenServerJobsCount} ${t("gvgAdmin.hiddenJobs", "job(s) hors guilde masques")}.` : ""}
                </div>
              </div>

              <Button
                type="button"
                className="rounded-2xl"
                variant="outline"
                disabled={loadingJobs || !selectedGuildAllowed}
                onClick={loadServerJobs}
              >
                {loadingJobs ? t("common.loading", "Chargement...") : t("common.refresh", "Rafraichir")}
              </Button>
            </div>

            <div className="mt-4 grid gap-3">
              {visibleServerJobs.length ? (
                visibleServerJobs.map((job) => (
                  <div
                    key={`${getJobSourceGuild(job)}-${getJobId(job)}`}
                    className={`rounded-2xl border p-4 ${getJobTone(job)}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-zinc-100">
                          {job.guild} · {job.mode?.toUpperCase()} · {job.side || "-"}
                        </div>
                        <div className="mt-1 text-xs text-zinc-400">
                          {job.job_id} · {formatDate(job.created_at)} · {job.files_count} {t("gvgAdmin.captures", "captures")} · {job.size_mb} Mo
                        </div>
                        <div className="mt-2 text-xs text-zinc-300">
                          {t("gvgAdmin.state", "Etat")} : <span className="font-semibold">{job.state}</span>
                          {job.processing?.summary?.reco_ok !== undefined
                            ? ` · ${t("gvgAdmin.recoOk", "Reco OK")} : ${job.processing.summary.reco_ok}/${job.processing.summary.captures}`
                            : ""}
                        </div>
                        <div className={`mt-2 inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${
                          isJobExpired(job)
                            ? "border-red-400/40 bg-red-500/15 text-red-200"
                            : "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                        }`}>
                          {getJobAgeLabel(job, t)}
                        </div>
                      </div>

                      <Button
                        type="button"
                        className="rounded-2xl"
                        disabled={
                          job.state !== "ready" ||
                          !job.has_site_payload ||
                          jobImportingId === getJobId(job)
                        }
                        onClick={() => importServerJob(job)}
                      >
                        {jobImportingId === getJobId(job) ? t("gvgAdmin.importing", "Import...") : `${t("gvgAdmin.importInto", "Importer dans")} ${getGvgGuildLabel(guild)}`}
                      </Button>
                      <Button
                        type="button"
                        className="rounded-2xl border-red-500/40 text-red-200"
                        variant="outline"
                        disabled={jobDeletingId === getJobId(job)}
                        onClick={() => deleteServerJob(job)}
                        title={t("gvgAdmin.deleteProbeTitle", "Supprimer ce probe du serveur")}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {jobDeletingId === getJobId(job) ? t("gvgAdmin.deleting", "Suppression...") : t("common.delete", "Supprimer")}
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-400">
                  {t("gvgAdmin.noJobLoaded", "Aucun job charge pour")} {getGvgGuildLabel(guild)}.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="text-sm text-zinc-400">
              {t("gvgAdmin.manualEnemyJson", "Import manuel JSON ennemi")}
            </div>

            <textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder='[ { "def": "...", "compo": [...] } ]'
              className="mt-3 min-h-[220px] w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none"
            />

            <Button
              type="button"
              className="mt-3 rounded-2xl"
              disabled={loadingImport || loadingReset || !selectedGuildAllowed}
              onClick={handleImport}
            >
              {loadingImport ? t("gvgAdmin.importInProgress", "Import en cours...") : `${t("gvgAdmin.import", "Importer")} ${getGvgGuildLabel(guild)}`}
            </Button>
          </div>

          {message ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-300">
              {message}
            </div>
          ) : null}

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
            <div className="text-sm text-zinc-300">
              {t("gvgAdmin.manualImageUpload", "Upload manuel des images GVG")}
            </div>

            <input
              type="file"
              multiple
              accept="image/*"
              disabled={!selectedGuildAllowed}
              onChange={(event) => handleUploadImages(Array.from(event.target.files || []))}
              className="text-sm text-zinc-200"
            />

            {uploadingImages ? (
              <div className="text-sm text-zinc-400">{t("gvgAdmin.uploading", "Upload en cours...")}</div>
            ) : null}

            {uploadResult ? (
              <div className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-zinc-950 p-3 text-xs text-zinc-300">
                {JSON.stringify(uploadResult, null, 2)}
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="mb-2 text-sm text-zinc-400">
              {t("gvgAdmin.importIdenticalGroups", "Import groupes identiques")}
            </div>

            <textarea
              value={groupJson}
              onChange={(e) => setGroupJson(e.target.value)}
              className="h-40 w-full rounded-xl border border-zinc-700 bg-zinc-900 p-2 text-xs text-zinc-200"
              placeholder={t("gvgAdmin.groupJsonPlaceholder", 'Colle ici ton JSON "map" des groupes')}
            />

            <Button
              type="button"
              variant="outline"
              className="mt-2 rounded-2xl"
              disabled={!selectedGuildAllowed}
              onClick={handleImportGroups}
            >
              {t("gvgAdmin.importGroups", "Import groupes")}
            </Button>
          </div>

          <div className="rounded-2xl border-2 border-red-500/60 bg-red-500/5 p-5 text-center">
            <div className="text-sm font-semibold tracking-wide text-red-300">
              {t("gvgAdmin.allyMode", "MODE ALLIE")}
            </div>
          </div>

          <div className="rounded-2xl border border-red-500/40 bg-red-500/5 p-4">
            <div className="text-sm text-red-300">
              {t("gvgAdmin.manualAllyJson", "Import manuel JSON allie")}
            </div>

            <textarea
              value={jsonInputAlly}
              onChange={(e) => setJsonInputAlly(e.target.value)}
              placeholder='[ { "def": "...", "compo": [...] } ]'
              className="mt-3 min-h-[220px] w-full rounded-2xl border border-red-500/40 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none"
            />

            <Button
              type="button"
              className="mt-3 rounded-2xl bg-red-600 hover:bg-red-500"
              disabled={loadingImport || !selectedGuildAllowed}
              onClick={handleImportAlly}
            >
              {loadingImport ? t("gvgAdmin.importingAlly", "Import allie...") : `${t("gvgAdmin.importAlly", "Importer ALLIE")} ${getGvgGuildLabel(guild)}`}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
