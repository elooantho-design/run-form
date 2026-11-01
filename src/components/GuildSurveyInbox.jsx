import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ClipboardList, RefreshCw, Save } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import GuildSurveyQuestions from "@/components/GuildSurveyQuestions";
import { requestGuildSurvey } from "@/lib/guildSurveyApi";
import { SURVEY_STATUS_LABELS } from "@/lib/guildSurveys";

export default function GuildSurveyInbox({ request = requestGuildSurvey }) {
  const [surveys, setSurveys] = useState([]);
  const [opened, setOpened] = useState(() => Boolean(new URLSearchParams(window.location.search).get("guildSurvey")));
  const [selected, setSelected] = useState(() => new URLSearchParams(window.location.search).get("guildSurvey") || "");
  const [form, setForm] = useState(null);
  const [answers, setAnswers] = useState({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const refresh = useCallback(async () => { const data = await request("mine"); setSurveys(data.surveys); }, [request]);
  useEffect(() => {
    let alive = true;
    request("mine").then(data => { if (alive) setSurveys(data.surveys); }).catch(failure => {
      if (alive && failure.status !== 428) setError(failure.message);
    });
    return () => { alive = false; };
  }, [request]);
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    request("answer-form", { surveyId: selected }).then(data => {
      if (alive) { setForm(data); setAnswers(data.response?.answers || {}); setError(""); setNotice(""); }
    }).catch(failure => { if (alive) { setForm(null); setError(failure.message); } });
    return () => { alive = false; };
  }, [request, selected]);
  const openSurvey = id => { setForm(null); setError(""); setNotice(""); setSelected(id); setOpened(true); };
  const close = () => {
    if (guard.current) return;
    setOpened(false); setSelected(""); setForm(null); setAnswers({}); setError("");
    const url = new URL(window.location.href);
    if (url.searchParams.has("guildSurvey")) { url.searchParams.delete("guildSurvey"); window.history.replaceState(null, "", url); }
  };
  const save = async event => {
    event.preventDefault();
    if (guard.current || !form || form.campaign.status !== "open") return;
    for (const q of form.campaign.questions) {
      if (q.required && (q.type === "multiple" ? !answers[q.id]?.length : !String(answers[q.id] || "").trim())) {
        setError("Merci de repondre a toutes les questions obligatoires."); return;
      }
    }
    guard.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const data = await request("answer", { surveyId: selected, expectedRevision: form.response?.version || 0, payload: { answers } });
      setForm(current => ({ ...current, response: { ...current.response, answers, version: data.version } }));
      setNotice("Votre reponse a ete enregistree."); await refresh();
    } catch (failure) { setError(failure.message); }
    finally { guard.current = false; setBusy(false); }
  };
  const pending = surveys.filter(s => s.status === "open" && !s.responded).length;
  return <>
    <div className="flex justify-end"><Button type="button" variant="outline" className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100"
      onClick={() => { setOpened(true); setSelected(""); setForm(null); setError(""); refresh().catch(failure => setError(failure.message)); }}>
      <ClipboardList size={16} />Mes sondages{pending ? ` (${pending})` : ""}
    </Button></div>
    <Dialog open={opened} onOpenChange={open => { if (!open) close(); }}><DialogContent aria-describedby={undefined}
      className="block max-h-[92dvh] w-[calc(100%-1rem)] overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-zinc-100 sm:max-w-2xl sm:p-6">
      <DialogTitle className="mb-5 break-words pr-8 text-lg font-semibold">{form?.campaign.title || "Mes sondages"}</DialogTitle>
      {error ? <p role="alert" className="mb-4 break-words text-sm text-red-300">{error}</p> : null}
      {notice ? <p role="status" className="mb-4 text-sm text-emerald-300">{notice}</p> : null}
      {selected ? <>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => { setSelected(""); setForm(null); setError(""); }}><ArrowLeft size={14} />Mes sondages</Button>
        {!form ? <p className="py-6 text-sm text-zinc-500">{error ? "Sondage inaccessible." : "Chargement du sondage..."}</p> : <form onSubmit={save} className="mt-4 space-y-5">
          <p className="break-words text-xs text-zinc-400">{form.recipient.name} - {form.recipient.guild} - {SURVEY_STATUS_LABELS[form.campaign.status]}</p>
          {form.campaign.deadline ? <p className="text-xs text-zinc-400">Date limite : {new Date(form.campaign.deadline).toLocaleString("fr-FR")}</p> : null}
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-zinc-300">{form.campaign.introduction}</p>
          <GuildSurveyQuestions questions={form.campaign.questions} answers={answers} onChange={setAnswers} disabled={busy || form.campaign.status !== "open"} prefix="member-survey" />
          {form.campaign.status === "open" ? <Button type="submit" disabled={busy}><Save size={16} />{form.response ? "Modifier ma reponse" : "Enregistrer ma reponse"}</Button> : <p className="text-sm text-zinc-400">Ce sondage est cloture.</p>}
        </form>}
      </> : <>
        <div className="mb-2 flex justify-end"><button type="button" title="Actualiser" aria-label="Actualiser mes sondages" onClick={() => refresh().catch(failure => setError(failure.message))} className="p-2"><RefreshCw size={16} /></button></div>
        {!surveys.length ? <p className="py-5 text-sm text-zinc-500">Aucun sondage ne vous est adresse.</p> : <div className="divide-y divide-zinc-800">{surveys.map(s => <button type="button" key={s.id} onClick={() => openSurvey(s.id)} className="block w-full min-w-0 space-y-2 py-4 text-left hover:bg-zinc-900">
          <span className="block break-words text-sm font-semibold">{s.title}</span><span className="block text-xs text-zinc-400">{SURVEY_STATUS_LABELS[s.status]} - {s.responded ? "Reponse enregistree" : "Sans reponse"}</span>
        </button>)}</div>}
      </>}
    </DialogContent></Dialog>
  </>;
}
