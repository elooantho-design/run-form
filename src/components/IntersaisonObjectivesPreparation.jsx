import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
import { CheckCircle2, Eye, History, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PALADIN_GUILD_DISPLAY_NAMES } from "@/lib/guildDisplay";
import {
  buildSurveyTwoDiscordPayload,
  getSurveyObjectivesState,
  normalizeSurveyObjectives,
  SURVEY_OBJECTIVE_GUILDS,
  SURVEY_OBJECTIVE_MAX_LENGTH,
} from "@/lib/intersaisonSurveyObjectives";

const STATE_LABELS = {
  incomplete: "Brouillon incomplet",
  complete: "Brouillon complet",
  validated: "Objectifs validés pour le prochain sondage",
  official: "Objectifs officiels publiés",
};

export default function IntersaisonObjectivesPreparation({ request, onStateChange }) {
  const fieldId = useId();
  const [preparation, setPreparation] = useState(null);
  const [objectives, setObjectives] = useState(() => normalizeSurveyObjectives());
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(null);

  const acceptPreparation = useCallback((data) => {
    setPreparation(data);
    const codes = data?.guilds?.map((g) => g.code) || SURVEY_OBJECTIVE_GUILDS;
    const source = data?.version?.objectives || {};
    // An official version retains the exact scope originally sent to players.
    setObjectives(normalizeSurveyObjectives(source, {}, ["official", "archived"].includes(data?.version?.status) ? Object.keys(source) : codes));
  }, []);

  useEffect(() => {
    let cancelled = false;
    request({ action: "load-survey-two-preparation" }).then((data) => {
      if (!cancelled) acceptPreparation(data.preparation);
    }).catch((loadError) => {
      if (!cancelled) setError(loadError.message || "Chargement des objectifs impossible.");
    }).finally(() => {
      if (!cancelled) setBusy(false);
    });
    return () => { cancelled = true; };
  }, [request, acceptPreparation]);

  const guildCodes = useMemo(() => ["official", "archived"].includes(preparation?.version?.status)
    ? Object.keys(preparation.version.objectives) : preparation?.guilds?.map((g) => g.code) || SURVEY_OBJECTIVE_GUILDS, [preparation]);
  const guildNames = useMemo(() => ({ ...PALADIN_GUILD_DISPLAY_NAMES, ...Object.fromEntries((preparation?.guilds || []).map((g) => [g.code, g.name])) }), [preparation]);
  const savedObjectives = useMemo(() => normalizeSurveyObjectives(preparation?.version?.objectives || {}, {}, guildCodes), [preparation, guildCodes]);
  const dirty = JSON.stringify(objectives) !== JSON.stringify(savedObjectives);
  const state = getSurveyObjectivesState(preparation?.version, objectives, { dirty, guildCodes });
  const frozen = ["official", "archived"].includes(preparation?.version?.status);
  const canSave = Boolean(preparation?.schemaReady && preparation?.seasonId && !frozen && !busy);

  useEffect(() => {
    onStateChange?.({ dirty, versionId: preparation?.version?.id || null, status: preparation?.version?.status || "draft" });
  }, [dirty, preparation?.version?.id, preparation?.version?.status, onStateChange]);

  async function reloadObjectives() {
    if (dirty && !window.confirm("Abandonner les modifications non enregistrées et recharger les objectifs ?")) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await request({ action: "load-survey-two-preparation" });
      acceptPreparation(data.preparation);
    } catch (loadError) {
      setError(loadError.message || "Chargement des objectifs impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function saveObjectives() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await request({
        action: "save-survey-two-objectives",
        objectives,
        expectedVersion: preparation?.version?.versionNumber || 0,
      });
      acceptPreparation(data.preparation);
      setNotice("Brouillon enregistré.");
    } catch (saveError) {
      setError(saveError.message || "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function validateObjectives() {
    if (!window.confirm(`Valider cette version des ${guildCodes.length} objectifs ? Cette validation ne lance pas le sondage et ne publie pas les objectifs.`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await request({ action: "validate-survey-two-objectives", versionId: preparation.version.id });
      acceptPreparation(data.preparation);
      setNotice("Objectifs validés pour le prochain sondage. Aucun message envoyé.");
    } catch (validationError) {
      setError(validationError.message || "Validation impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (preparation?.supported === false) return null;

  return (
    <section aria-label="Préparation des objectifs" className="border-y border-zinc-800 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-zinc-100">Préparation des objectifs de la prochaine saison</h3>
          <div role="status" className={`mt-2 text-sm ${state === "validated" || state === "official" ? "text-emerald-300" : "text-amber-200"}`}>
            {STATE_LABELS[state]}
            {preparation?.version ? ` · Version ${preparation.version.versionNumber}` : ""}
            {dirty ? " · Modifications non enregistrées" : ""}
          </div>
        </div>
        <Button type="button" variant="outline" className="max-w-full whitespace-normal border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
          onClick={() => setPreview({ objectives, title: "Prévisualisation du sondage n° 2" })} disabled={busy}>
          <Eye className="h-4 w-4 shrink-0" /> Prévisualiser le sondage n° 2
        </Button>
      </div>
      {error ? <div role="alert" className="mt-3 text-sm text-red-200">{error}</div> : null}
      {notice ? <div role="status" className="mt-3 text-sm text-emerald-200">{notice}</div> : null}
      {preparation?.schemaReady === false ? <div className="mt-3 text-sm text-amber-200">La migration des objectifs doit être installée avant l’enregistrement.</div> : null}
      {preparation && !preparation.seasonId ? <div className="mt-3 text-sm text-amber-200">Aucune inter-saison active. Les objectifs ne peuvent pas encore être enregistrés.</div> : null}
      <div className="mt-5 grid gap-x-6 sm:grid-cols-2">
        {guildCodes.map((code) => (
          <div key={code} className="min-w-0 border-b border-zinc-800 py-4">
            <label htmlFor={`${fieldId}-${code}`} className="font-semibold text-zinc-100">{code} — {guildNames[code]}</label>
            <textarea id={`${fieldId}-${code}`} value={objectives[code]} rows={5} maxLength={SURVEY_OBJECTIVE_MAX_LENGTH}
              disabled={busy || frozen} onChange={(event) => {
                setObjectives((previous) => ({ ...previous, [code]: event.target.value }));
                setNotice("");
              }}
              className="mt-2 min-h-32 w-full resize-y rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm leading-6 text-zinc-100 outline-none focus:border-sky-400 disabled:opacity-60"
              aria-describedby={`${fieldId}-${code}-count`} />
            <div id={`${fieldId}-${code}-count`} className="mt-1 text-right text-xs text-zinc-500">{objectives[code].length} / {SURVEY_OBJECTIVE_MAX_LENGTH}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="icon" title="Recharger les objectifs" aria-label="Recharger les objectifs"
          disabled={busy} onClick={reloadObjectives} className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"><RefreshCw className="h-4 w-4" /></Button>
        <Button type="button" onClick={saveObjectives} disabled={!canSave || (!dirty && Boolean(preparation?.version))}
          className="bg-sky-500 text-zinc-950 hover:bg-sky-400"><Save className="h-4 w-4" /> Enregistrer les objectifs</Button>
        <Button type="button" variant="outline" onClick={validateObjectives}
          disabled={!canSave || dirty || state !== "complete" || !preparation?.version}
          className="border-emerald-500/40 bg-zinc-900 text-emerald-200 hover:bg-zinc-800"><CheckCircle2 className="h-4 w-4" /> Valider les objectifs</Button>
      </div>
      {preparation?.history?.length ? (
        <details className="mt-5 border-t border-zinc-800 pt-3">
          <summary className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300"><History className="h-4 w-4" /> Historique des versions ({preparation.history.length})</summary>
          <ul className="mt-3 max-h-60 space-y-2 overflow-auto">
            {preparation.history.map((version) => (
              <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-400">
                <span>Version {version.versionNumber} · {STATE_LABELS[getSurveyObjectivesState(version, version.objectives)]} · {new Date(version.createdAt).toLocaleString("fr-FR")}</span>
                <Button type="button" variant="ghost" onClick={() => setPreview({ objectives: version.objectives, title: `Version ${version.versionNumber}` })}>
                  <Eye className="h-4 w-4" /> Consulter
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open) setPreview(null); }}>
        <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto border-zinc-700 bg-zinc-950 text-zinc-100 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="pr-8">{preview?.title}</DialogTitle>
            <DialogDescription className="text-zinc-400">Aperçu uniquement · aucune interaction ni aucun envoi</DialogDescription>
          </DialogHeader>
          {preview ? <SurveyTwoMessagePreview objectives={preview.objectives} guildNames={guildNames} /> : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SurveyTwoMessagePreview({ objectives, guildNames }) {
  let payload;
  try { payload = buildSurveyTwoDiscordPayload(objectives, { guildCodes: Object.keys(objectives), guildNames }); }
  catch (error) { return <div role="alert" className="text-red-200">{error.message}</div>; }
  return (
    <div className="min-w-0 space-y-4 rounded-lg bg-[#313338] p-4 text-sm text-zinc-100">
      <div className="font-semibold">Bot 2.0</div>
      <div className="whitespace-pre-wrap break-words leading-6">{payload.content}</div>
      {payload.embeds.map((embed) => (
        <div key={embed.title} className="min-w-0 border-l-4 border-sky-400 bg-[#2b2d31] p-4">
          <div className="font-semibold">{embed.title}</div>
          <dl className="mt-4 space-y-4">
            {embed.fields.map((field) => <div key={field.name}><dt className="font-semibold">{field.name}</dt><dd className="mt-1 whitespace-pre-wrap break-words leading-6">{field.value}</dd></div>)}
          </dl>
          <div className="mt-4 text-xs text-zinc-400">{embed.footer.text}</div>
        </div>
      ))}
      <Button type="button" disabled className="bg-sky-600 text-white">{payload.components[0].components[0].label}</Button>
    </div>
  );
}
