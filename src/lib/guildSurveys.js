export const SURVEY_TYPES = ["single", "multiple", "text"];
export const SURVEY_STATUS_LABELS = { draft: "Brouillon", open: "Ouvert", closed: "Cloture" };

export function newSurveyQuestion(type = "single") {
  return { id: crypto.randomUUID(), type, label: "", required: true,
    options: type === "text" ? [] : [1, 2].map(() => ({ id: crypto.randomUUID(), label: "" })) };
}

export function newGuildSurvey() {
  return { title: "", introduction: "", deadline: "", target_guild_ids: [], questions: [newSurveyQuestion()] };
}

export function reorganizationSurvey(guilds = []) {
  const choices = (labels) => labels.map((label, i) => ({ id: `option_${i + 1}`, label }));
  return {
    title: "Projet de r\u00e9organisation \u2014 Paladin \u00d7 DEUS",
    introduction: "Suite \u00e0 l'arriv\u00e9e de DEUS dans notre cluster et \u00e0 une r\u00e9union entre nos responsables, nous \u00e9tudions une r\u00e9organisation de nos effectifs.\n\nNotre objectif est de constituer une nouvelle G2 comp\u00e9titive r\u00e9unissant des joueurs de Paladin Imperatores et de DEUS, avec une implication plus importante en GvG. Parall\u00e8lement, nous envisageons de faire \u00e9voluer Imperatores vers une guilde de progression associant GvG et PvE.\n\nAvant de prendre des d\u00e9cisions, nous souhaitons conna\u00eetre vos envies et vos ambitions.\n\nMerci d'actualiser vos PB dans le dashboard. Le choix GvG comp\u00e9titive constitue une candidature, pas une garantie de s\u00e9lection. Aucun choix PvE ou progression n'entra\u00eene de transfert automatique.\n\nBoss hebdomadaires : si votre changement de guilde est confirm\u00e9 ou probable, rapprochez-vous d'un responsable pour les consignes. Aucune activit\u00e9 n'est bloqu\u00e9e automatiquement.",
    deadline: "",
    target_guild_ids: guilds.filter(g => ["G2", "G8"].includes(g.guild_code)).map(g => g.id),
    questions: [
      { id: "project", type: "single", required: true,
        label: "Quel type de guilde correspond le mieux \u00e0 vos attentes pour la prochaine saison ?",
        options: choices([
          "GvG comp\u00e9titive \u2014 Je souhaite int\u00e9grer un effectif ambitieux, avec une participation r\u00e9guli\u00e8re aux attaques, reproductions et strat\u00e9gies.",
          "GvG progression \u2014 Je souhaite participer \u00e0 la GvG dans un cadre moins exigeant.",
          "PvE / D\u00e9tente \u2014 Je pr\u00e9f\u00e8re privil\u00e9gier le PvE et jouer \u00e0 mon rythme.",
          "Ind\u00e9cis \u2014 Je souhaite \u00e9changer avec un responsable avant de me d\u00e9cider.",
        ]) },
      { id: "availability", type: "single", required: true,
        label: "\u00cates-vous pr\u00eat \u00e0 vous investir r\u00e9guli\u00e8rement dans les reproductions et le travail collectif GvG ?",
        options: choices(["Oui, r\u00e9guli\u00e8rement.", "Oui, selon mes disponibilit\u00e9s.", "Occasionnellement.", "Non, je pr\u00e9f\u00e8re jouer sans cette obligation."]) },
      { id: "comment", type: "text", required: false,
        label: "Souhaitez-vous apporter une pr\u00e9cision sur vos attentes ou vos disponibilit\u00e9s ?", options: [] },
    ],
  };
}

export function displaySurveyAnswer(question, answer) {
  if (question.type === "text") return typeof answer === "string" ? answer : "";
  const values = Array.isArray(answer) ? answer : answer ? [answer] : [];
  return (question.options || []).filter(o => values.includes(o.id)).map(o => o.label).join(" | ");
}

export function surveyStats(campaign, recipients = [], guildCode = "") {
  const rows = recipients.filter(r => !guildCode || r.guild_code_snapshot === guildCode);
  const answered = rows.filter(r => r.response);
  return { total: rows.length, responded: answered.length, rate: rows.length ? Math.round(100 * answered.length / rows.length) : 0,
    questions: (campaign?.questions || []).map(q => ({ ...q,
      options: (q.options || []).map(o => ({ ...o, count: answered.filter(r => {
        const answer = r.response.answers[q.id];
        return Array.isArray(answer) ? answer.includes(o.id) : answer === o.id;
      }).length })),
    })) };
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]|^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function guildSurveyCsv(campaign, recipients = []) {
  const columns = ["Joueur", "Guilde au lancement", "Participation", "Livraison", "Date reponse", ...(campaign.questions || []).map(q => q.label)];
  const rows = recipients.map(r => [r.member_name_snapshot, r.guild_code_snapshot, r.response ? "Repondu" : "Sans reponse", r.delivery_status,
    r.response?.updated_at || "", ...(campaign.questions || []).map(q => displaySurveyAnswer(q, r.response?.answers?.[q.id]))]);
  return "\ufeff" + [columns, ...rows].map(row => row.map(csvCell).join(";")).join("\r\n");
}

export function validateSurveyDraft(draft) {
  if (!draft.title?.trim() || draft.title.length > 160) return "Titre requis (160 caracteres maximum).";
  if ((draft.introduction || "").length > 6000) return "Introduction trop longue (6000 caracteres maximum).";
  if (!draft.target_guild_ids?.length) return "Selectionnez au moins une guilde.";
  if (!draft.questions?.length || draft.questions.length > 20) return "Le sondage doit contenir entre 1 et 20 questions.";
  for (const q of draft.questions) {
    if (!q.label?.trim() || q.label.length > 500 || !SURVEY_TYPES.includes(q.type)) return "Question incomplete ou trop longue.";
    if (q.type !== "text" && (q.options.length < 2 || q.options.length > 20 || q.options.some(o => !o.label?.trim() || o.label.length > 300))) return "Chaque choix doit contenir entre 2 et 20 propositions renseignees.";
  }
  if (draft.deadline && (!Number.isFinite(Date.parse(draft.deadline)) || Date.parse(draft.deadline) <= Date.now())) return "La date limite doit etre future.";
  return "";
}
