export { FORECAST_ROLES, getForecastDiscordId } from "./intersaisonSurveyChoices.js";

export function buildForecastAvatarUrl(user) {
  const id = String(user?.id || "");
  if (!/^\d{15,22}$/.test(id)) return "";
  const hash = String(user?.avatar || "");
  if (/^(?:a_)?[a-f0-9]{32}$/i.test(hash)) return `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=64`;
  const discriminator = String(user?.discriminator || "");
  const index = /^\d{4}$/.test(discriminator) && discriminator !== "0000"
    ? Number(discriminator) % 5 : Number((BigInt(id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

export function createForecastAvatarQueue(request, onResult) {
  const waiting = new Map(), cache = new Map(), inFlight = new Set();
  let timer, running = false, disposed = false;
  function schedule() {
    if (!disposed && !running && !timer && waiting.size) timer = setTimeout(flush, 60);
  }
  async function flush() {
    timer = null;
    if (disposed) return;
    running = true;
    const batch = [...waiting.entries()].slice(0, 12);
    for (const [memberId] of batch) { waiting.delete(memberId); inFlight.add(memberId); }
    let avatars = {};
    try { avatars = (await request({ action: "load-survey-forecast-avatars", memberIds: batch.map(([id]) => id) })).avatars || {}; }
    catch { /* Cosmetic fallback only; no retry loop and no survey action. */ }
    if (!disposed) {
      for (const [memberId, identity] of batch) {
        const url = /^https:\/\/cdn\.discordapp\.com\/(?:avatars|embed\/avatars)\//.test(avatars[memberId] || "") ? avatars[memberId] : "";
        cache.set(identity, { url, expires: Date.now() + 600000 });
        onResult(`${memberId}:${identity}`, url);
      }
    }
    for (const [id] of batch) inFlight.delete(id);
    running = false;
    schedule();
  }
  return {
    add(memberId, identity) {
      if (disposed || !memberId || !identity) return;
      const known = cache.get(identity);
      if (known?.expires > Date.now()) { onResult(`${memberId}:${identity}`, known.url); return; }
      if (!inFlight.has(memberId)) waiting.set(memberId, identity);
      schedule();
    },
    dispose() { disposed = true; clearTimeout(timer); waiting.clear(); },
  };
}
