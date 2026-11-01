import React from "react";
import { X } from "lucide-react";

export default function GuildSurveyQuestions({ questions = [], answers = {}, onChange, disabled = false, prefix = "survey" }) {
  return <div className="space-y-6">{questions.map((question, index) => <fieldset key={question.id} disabled={disabled} className="min-w-0 border-b border-zinc-800 pb-5">
    <legend className="mb-3 w-full break-words text-sm font-semibold text-zinc-100">
      {index + 1}. {question.label}{question.required ? <span className="ml-1 text-amber-300" aria-label="obligatoire">*</span> : <span className="ml-2 text-xs font-normal text-zinc-500">Facultatif</span>}
    </legend>
    {question.type === "text" ? <textarea aria-label={question.label} required={question.required} maxLength={4000}
      className="min-h-28 w-full rounded-md border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-100 disabled:opacity-70"
      value={answers[question.id] || ""} onChange={e => onChange({ ...answers, [question.id]: e.target.value })} /> :
      <div className="space-y-2">{question.options.map(option => <label key={option.id} className="flex cursor-pointer items-start gap-3 break-words rounded-md p-2 text-sm text-zinc-200 hover:bg-zinc-900">
        <input className="mt-1 shrink-0 accent-emerald-400" name={`${prefix}-${question.id}`} type={question.type === "single" ? "radio" : "checkbox"}
          required={question.type === "single" && question.required} value={option.id}
          checked={question.type === "single" ? answers[question.id] === option.id : (answers[question.id] || []).includes(option.id)}
          onChange={e => onChange({ ...answers, [question.id]: question.type === "single" ? option.id :
            e.target.checked ? [...(answers[question.id] || []), option.id] : (answers[question.id] || []).filter(value => value !== option.id) })} />
        <span className="min-w-0 break-words">{option.label}</span>
      </label>)}</div>}
    {!question.required && question.type === "single" && answers[question.id] ? <button type="button" className="mt-2 flex items-center gap-2 p-2 text-xs text-zinc-400"
      title="Effacer ce choix" aria-label={`Effacer le choix : ${question.label}`} onClick={() => onChange({ ...answers, [question.id]: "" })}><X size={14} />Effacer</button> : null}
  </fieldset>)}</div>;
}
