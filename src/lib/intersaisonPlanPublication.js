export function buildRosterPublication(forecast, revision, date = new Date()) {
  if (!Number.isInteger(revision) || revision < 1 || !Array.isArray(forecast?.guilds)) throw new Error("Plan indisponible.");
  const seen = new Set();
  return forecast.guilds.map((guild) => {
    const names = guild.players.map((player) => {
      if (!player.memberKey || seen.has(player.memberKey)) throw new Error("Un compte apparaît plusieurs fois dans le plan.");
      seen.add(player.memberKey);
      return String(player.name || "Compte sans pseudo");
    }).sort((a, b) => a.localeCompare(b, "fr"));
    return { code: guild.code, name: guild.name, count: names.length, names, revision, date: date.toLocaleDateString("fr-FR") };
  });
}

export async function downloadRosterPublication(item, documentRef = document) {
  const canvas = documentRef.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Export image non disponible dans ce navigateur.");
  const width = 1000;
  const textWidth = width - 120;
  const linesFor = (text, size, bold = false) => {
    context.font = `${bold ? "bold " : ""}${size}px Arial`;
    const lines = [];
    let line = "";
    for (const character of Array.from(text)) {
      if (context.measureText(line + character).width > textWidth && line) { lines.push(line); line = ""; }
      line += character;
    }
    lines.push(line);
    return lines;
  };
  const title = linesFor(`${item.code} - ${item.name}`, 42, true);
  const names = item.names.map((name) => linesFor(name, 30));
  const headerHeight = 150 + title.length * 52;
  canvas.width = width;
  canvas.height = headerHeight + names.reduce((height, lines) => height + lines.length * 40 + 14, 0) + 60;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, canvas.height);
  context.fillStyle = "#15705c";
  context.fillRect(0, 0, width, 10);
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
  for (const lines of names) {
    for (const line of lines) { context.fillText(line, 60, y); y += 40; }
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
