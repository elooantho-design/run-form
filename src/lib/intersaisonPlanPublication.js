import { resolveForecastAvatarUrl } from "./intersaisonForecast.js";

export const ROSTER_GUILD_CRESTS = Object.freeze({
  G1: "/guild-crests/legend.png",
  G2: "/guild-crests/imperatores-loyalty.png",
  G3: "/guild-crests/imperatores-loyalty.png",
  G4: "/guild-crests/collegium.png",
  G5: "/guild-crests/senatores-legacy-magistratus.png",
  G6: "/guild-crests/senatores-legacy-magistratus.png",
  G7: "/guild-crests/senatores-legacy-magistratus.png",
});

export function buildRosterPublication(forecast, revision, date = new Date()) {
  if (!Number.isInteger(revision) || revision < 1 || !Array.isArray(forecast?.guilds)) throw new Error("Plan indisponible.");
  const seen = new Set();
  return forecast.guilds.map((guild) => {
    const players = guild.players.map((player) => {
      if (!player.memberKey || seen.has(player.memberKey)) throw new Error("Un compte apparaît plusieurs fois dans le plan.");
      seen.add(player.memberKey);
      return { name: String(player.name || "Compte sans pseudo"), avatarUrl: resolveForecastAvatarUrl(player.avatarUrl, { discordActivity: false }) };
    }).sort((a, b) => a.name.localeCompare(b.name, "fr"));
    return { code: guild.code, name: guild.name, count: players.length, names: players.map((player) => player.name),
      avatarUrls: players.map((player) => player.avatarUrl), revision, date: date.toLocaleDateString("fr-FR") };
  });
}

export async function downloadRosterPublication(item, documentRef = document) {
  let crest = null;
  if (Object.hasOwn(ROSTER_GUILD_CRESTS, item.code)) {
    try { crest = await loadPublicationImage(documentRef, ROSTER_GUILD_CRESTS[item.code]); }
    catch { throw new Error(`Blason de ${item.name} indisponible. Réessaie le téléchargement.`); }
  }
  const avatarUrls = item.names.map((_, index) => resolveForecastAvatarUrl(item.avatarUrls?.[index]));
  const avatars = new Map(await Promise.all([...new Set(avatarUrls.filter(Boolean))].map(async (url) =>
    [url, await loadPublicationImage(documentRef, url).catch(() => null)])));
  const canvas = documentRef.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Export image non disponible dans ce navigateur.");
  const width = 1000;
  const textWidth = width - 120;
  const linesFor = (text, size, bold = false, maxWidth = textWidth) => {
    context.font = `${bold ? "bold " : ""}${size}px Arial`;
    const lines = [];
    let line = "";
    for (const character of Array.from(text)) {
      if (context.measureText(line + character).width > maxWidth && line) { lines.push(line); line = ""; }
      line += character;
    }
    lines.push(line);
    return lines;
  };
  const title = linesFor(`${item.code} - ${item.name}`, 42, true, crest ? textWidth - 220 : textWidth);
  const names = item.names.map((name) => linesFor(name, 30, false, textWidth - 58));
  const crestScale = crest ? Math.min(170 / crest.naturalWidth, 220 / crest.naturalHeight) : 0;
  const crestWidth = crest ? crest.naturalWidth * crestScale : 0;
  const crestHeight = crest ? crest.naturalHeight * crestScale : 0;
  const headerHeight = Math.max(150 + title.length * 52, crest ? 40 + crestHeight + 50 : 0);
  canvas.width = width;
  canvas.height = headerHeight + names.reduce((height, lines) => height + lines.length * 40 + 14, 0) + 60;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, canvas.height);
  context.fillStyle = "#15705c";
  context.fillRect(0, 0, width, 10);
  if (crest) context.drawImage(crest, width - 60 - crestWidth, 40, crestWidth, crestHeight);
  context.fillStyle = "#16191b";
  context.font = "bold 42px Arial";
  title.forEach((line, i) => context.fillText(line, 60, 76 + i * 52));
  context.font = "24px Arial";
  context.fillStyle = "#566168";
  const titleBottom = 76 + (title.length - 1) * 52;
  context.fillText(`${item.count} joueurs - Plan prévisionnel`, 60, titleBottom + 48);
  context.fillText(`Version ${item.revision} - ${item.date}`, 60, titleBottom + 84);
  context.font = "30px Arial";
  context.fillStyle = "#16191b";
  let y = headerHeight;
  for (const [index, lines] of names.entries()) {
    const image = avatars.get(avatarUrls[index]);
    const top = y - 31;
    context.save();
    context.beginPath(); context.arc(80, top + 20, 20, 0, Math.PI * 2); context.clip();
    context.fillStyle = "#e4e7eb"; context.fillRect(60, top, 40, 40);
    if (image) {
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 60, top, 40, 40);
    } else {
      context.fillStyle = "#77818c";
      context.beginPath(); context.arc(80, top + 14, 6, 0, Math.PI * 2); context.fill();
      context.beginPath(); context.ellipse(80, top + 34, 13, 11, 0, Math.PI, 0); context.fill();
    }
    context.restore();
    for (const line of lines) { context.fillText(line, 118, y); y += 40; }
    y += 14;
  }
  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Export image impossible.")), "image/png"));
  const url = URL.createObjectURL(blob);
  try {
    const link = documentRef.createElement("a");
    link.href = url;
    link.download = `plan-${item.code}-v${item.revision}.png`;
    documentRef.body.append(link);
    link.click();
    link.remove();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
function loadPublicationImage(documentRef, url) {
  return new Promise((resolve, reject) => {
    const image = documentRef.createElement("img");
    const timer = setTimeout(() => finish(true), 5000);
    const finish = (error) => {
      clearTimeout(timer);
      image.onload = null; image.onerror = null;
      if (error || !image.naturalWidth || !image.naturalHeight) reject(new Error("Image indisponible."));
      else resolve(image);
    };
    image.crossOrigin = "anonymous";
    image.onload = () => finish(false);
    image.onerror = () => finish(true);
    image.src = url;
  });
}
