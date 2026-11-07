import {
  normalizeGvgStrategyChampionName,
  normalizeGvgStrategyDirection,
  normalizeGvgStrategyPosition,
} from "./gvgStrategySearch.js";

export function allyPosition(defense) {
  const bastion = Number(defense?.bastion);
  if (![1, 2, 3, 4].includes(bastion)) return null;
  if (defense.type === "fortress") return `Bastion ${bastion}`;
  const tower = Number(defense.tower);
  return defense.type === "tower" && [1, 2, 3, 4, 5].includes(tower)
    ? `B${bastion} Tour ${tower}` : null;
}

export function allySlotLabel(defense) {
  return `${allyPosition(defense) || "Emplacement inconnu"} / Equipe ${defense?.team || "?"}`;
}

export function normalizeAllyAssignment(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  let match = /^B([1-4]) Tour ([1-5])$/i.exec(text);
  if (match) return `B${match[1]} Tour ${match[2]}`;
  match = /^Bastion ([1-4])$/i.exec(text);
  if (match) return `Bastion ${match[1]}`;
  match = /^BB Tour ([1-5])$/i.exec(text);
  if (match) return `BB Tour ${match[1]}`;
  return /^BB Bastion$/i.test(text) ? "BB Bastion" : null;
}

export function allySignature(defense) {
  if (!["tower", "fortress"].includes(defense?.type)) return null;
  const heroes = defense.heroes;
  if (!Array.isArray(heroes) || heroes.length !== 5) return null;
  const slots = heroes.map(hero => {
    const champion = normalizeGvgStrategyChampionName(hero?.champion || hero?.name)?.replace(/[^a-z0-9]/g, "");
    const position = normalizeGvgStrategyPosition(hero?.position, defense.type);
    const direction = normalizeGvgStrategyDirection(hero?.direction);
    return champion && position && ["N", "S", "E", "O"].includes(direction)
      ? { champion, position, direction } : null;
  });
  if (slots.some(slot => !slot) || new Set(slots.map(slot => slot.position)).size !== 5) return null;
  return `${defense.type}:${slots.map(slot => `${slot.position}:${slot.direction}:${slot.champion}`).sort().join("|")}`;
}

export function buildAllyGroups(defenses) {
  const bySignature = new Map();
  for (const defense of defenses || []) {
    if (defense.is_ally !== true) continue;
    const signature = allySignature(defense);
    if (!signature) continue;
    const key = `${defense.guild}:${signature}`;
    if (!bySignature.has(key)) bySignature.set(key, []);
    bySignature.get(key).push(defense);
  }
  return [...bySignature.entries()].sort(([a], [b]) => a.localeCompare(b))
    .filter(([, rows]) => rows.length > 1)
    .map(([signature, rows], index) => ({ num: index + 1, signature, ids: rows.map(row => row.id).sort() }));
}

export function youtubeReference(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const id = url.hostname === "youtu.be" ? url.pathname.slice(1)
      : ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)
        ? url.searchParams.get("v") : null;
    return /^[A-Za-z0-9_-]{11}$/.test(id || "") ? { id, url: `https://youtu.be/${id}` } : null;
  } catch { return null; }
}

export function personalThreadReference(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["discord.com", "www.discord.com", "discordapp.com"].includes(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash) return null;
    const match = /^\/channels\/(\d{17,20})\/(\d{17,20})(?:\/\d{17,20})?\/?$/.exec(url.pathname);
    return match ? { serverId: match[1], channelId: match[2] } : null;
  } catch { return null; }
}

export function buildAllyFollowupPreview({ defenses = [], states = [], members = [], provisional_member_ids = [], historicalRuns = [], pendingDefenseIds = [] }) {
  const stateById = new Map(states.map(state => [state.defense_id, state]));
  const provisional = new Set(provisional_member_ids);
  const pending = new Set(pendingDefenseIds);
  const allCurrentVideoIds = new Set(defenses.map(defense => youtubeReference(defense.youtube_url)?.id).filter(Boolean));
  const rows = defenses.filter(defense => defense.is_ally === true).map(defense => {
    const state = stateById.get(defense.id) || { revision: 0, opened: false };
    const signature = allySignature(defense);
    const group = signature ? defenses.filter(candidate => candidate.is_ally === true && candidate.guild === defense.guild
      && allySignature(candidate) === signature) : [defense];
    const matches = members.filter(member => normalizeAllyAssignment(member.assignment) === allyPosition(defense));
    const owner = matches.length === 1 ? matches[0] : null;
    const ownerConfirmed = Boolean(owner && state.owner_member_id === owner.id && state.owner_confirmed === true && !provisional.has(owner.id));
    const ownVideo = youtubeReference(defense.youtube_url);
    const candidatesByVideo = new Map();
    for (const candidate of group) {
      const video = youtubeReference(candidate.youtube_url);
      if (video) candidatesByVideo.set(video.id, { defense_id: candidate.id, label: allySlotLabel(candidate), ...video });
    }
    const candidates = [...candidatesByVideo.values()];
    const source = group.find(candidate => candidate.id === state.video_defense_id);
    const chosenVideo = source && youtubeReference(source.youtube_url);
    const groupPending = group.some(candidate => pending.has(candidate.id)
      || (candidate.record_status === "a_record" && !youtubeReference(candidate.youtube_url)));
    const selected = ownVideo ? { ...ownVideo, defense_id: defense.id, source: "own" }
      : groupPending ? null
        : chosenVideo ? { ...chosenVideo, defense_id: source.id, source: "group" }
          : candidates.length === 1 ? { ...candidates[0], source: "group" } : null;
    const sessionStart = Date.parse(defense.created_at || "");
    const history = [];
    const seen = new Set(selected ? [selected.id] : []);
    for (const run of historicalRuns) {
      const video = youtubeReference(run.youtube_url);
      if (!video || seen.has(video.id) || allCurrentVideoIds.has(video.id) || run.guild !== defense.guild
        || !signature || run.signature !== signature
        || !Number.isFinite(sessionStart) || !(Date.parse(run.created_at) < sessionStart)) continue;
      seen.add(video.id);
      history.push(video);
    }
    const reasons = [];
    if (state.opened) {
      if (!signature) reasons.push("Composition incomplete ou invalide");
      if (!owner) reasons.push(matches.length > 1 ? "Plusieurs joueurs affectes a cet emplacement" : "Proprietaire non identifie");
      else if (!ownerConfirmed) reasons.push(provisional.has(owner.id) ? "Placement provisoire a verifier" : "Proprietaire a confirmer");
      if (owner && !personalThreadReference(owner.personal_forum_post_url)) reasons.push("Espace personnel Discord absent ou lien invalide");
      if (groupPending) reasons.push("Record de cette session encore en attente");
      if (!ownVideo && !groupPending && !chosenVideo && candidates.length > 1) reasons.push("Choisir la video du groupe");
      if (!selected && !history.length) reasons.push("Aucune video disponible");
    }
    return { defense_id: defense.id, label: allySlotLabel(defense), position: allyPosition(defense), state,
      owner, owner_confirmed: ownerConfirmed, owner_provisional: Boolean(owner && provisional.has(owner.id)),
      candidates, video: selected, history, reasons, opened: state.opened === true,
      ready: state.opened === true && reasons.length === 0 };
  });
  return { mode: "preview_only", delivery_enabled: false, sent: 0, rows,
    opened: rows.filter(row => row.opened).length, ready: rows.filter(row => row.ready).length,
    warnings: rows.filter(row => row.opened && row.reasons.length) };
}

export function renderAllyFeedbackMessage(row) {
  const parts = [`Retour GvG - ${row.label}`];
  if (row.video?.source === "own") parts.push("Ta defense a ete ouverte pendant cette GvG. Voici la video de l'attaque. Regarde si tu peux ajuster ta defense pour mieux contrer cette strategie.");
  else if (row.video) parts.push("Ta defense a ete signalee ouverte. Voici un replay de cette GvG sur une defense identique a la tienne : il sert de reference, pas de preuve de l'attaque exacte subie.");
  else if (row.history.length) parts.push("Ta defense a ete signalee ouverte. Nous n'avons pas de replay attribue pour cette GvG ; voici des exemples deja disponibles.");
  else parts.push("Ta defense a ete signalee ouverte. Aucune video n'est disponible pour le moment.");
  if (row.video) parts.push(row.video.url);
  if (row.history.length) parts.push("Autres manieres de passer cette defense, issues des GvG precedentes. Verifie si tes ajustements couvrent aussi ces strategies.", ...row.history.map(video => video.url));
  return parts.join("\n\n");
}
