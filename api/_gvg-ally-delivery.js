/* global process */
import { createHash, randomUUID } from "node:crypto";
import { personalThreadReference, renderAllyFeedbackMessage } from "../src/lib/gvgAllyFollowup.js";

export function allyDeliveryConfigured() {
  return Boolean(process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_DEFENSE_BOT_TOKEN || process.env.DISCORD_TOKEN);
}

export function deliveryMessage(row) {
  const limited = { ...row, history: [...row.history] };
  while (renderAllyFeedbackMessage(limited).length > 1900 && limited.history.length) limited.history.pop();
  return renderAllyFeedbackMessage(limited);
}

export function deliveryMessageVersion(row) {
  return createHash("sha256").update(JSON.stringify([row.defense_id, row.owner?.id,
    row.owner?.personal_forum_post_url, deliveryMessage(row)])).digest("hex");
}

export function attachAllyDeliveries(preview, deliveries = []) {
  for (const row of preview.rows) {
    row.delivery = deliveries.find(receipt => receipt.defense_id === row.defense_id) || null;
    row.message = deliveryMessage(row);
    row.message_version = deliveryMessageVersion(row);
    row.sendable = row.ready && (!row.delivery || row.delivery.status === "failed");
  }
  preview.sent = preview.rows.filter(row => row.delivery?.status === "sent").length;
  preview.ready = preview.rows.filter(row => row.sendable).length;
  return preview;
}

const outcomeError = (message, uncertain = false) => Object.assign(new Error(message), { uncertain });

// No automatic POST retries: a lost response does not prove that Discord rejected a message.
export async function sendAllyThreadMessage(payload, nonce, { fetchImpl = fetch } = {}) {
  const thread = personalThreadReference(payload.thread_url);
  const token = String(process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_DEFENSE_BOT_TOKEN || process.env.DISCORD_TOKEN || "").trim();
  if (!thread || !token) throw outcomeError("Espace personnel invalide ou bot Discord non configure.");
  async function request(path, method, body) {
    const response = await fetchImpl(`https://discord.com/api/v10${path}`, {
      method, redirect: "error", signal: AbortSignal.timeout(method === "GET" ? 3500 : 7000),
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = response.status === 403 ? "Le bot n'a pas acces a l'espace personnel Discord."
        : response.status === 404 ? "Espace personnel Discord introuvable."
          : response.status === 429 ? "Limite Discord atteinte. Reessayez plus tard."
            : response.status === 401 ? "Configuration du bot Discord refusee."
              : "Discord a refuse l'envoi ou est indisponible.";
      throw outcomeError(reason, method === "POST" && response.status >= 500);
    }
    return data;
  }
  let channel;
  try { channel = await request(`/channels/${thread.channelId}`, "GET"); }
  catch (error) { throw outcomeError(error.uncertain === false ? error.message : "Verification de l'espace Discord impossible. Aucun message envoye."); }
  if (!channel || channel.id !== thread.channelId || channel.guild_id !== thread.serverId || ![11, 12].includes(channel.type)) {
    throw outcomeError("Le lien ne correspond pas a un fil personnel sur le serveur indique.");
  }
  let message;
  try {
    message = await request(`/channels/${thread.channelId}/messages`, "POST", {
      content: payload.content, allowed_mentions: { parse: [] },
      nonce: nonce.replace(/-/g, "").slice(0, 25), enforce_nonce: true,
    });
  } catch (error) {
    if (typeof error.uncertain === "boolean") throw error;
    throw outcomeError("Resultat Discord incertain apres une coupure. Verifiez le fil avant toute reprise.", true);
  }
  if (!/^\d{17,20}$/.test(message?.id || "") || message.channel_id !== thread.channelId) {
    throw outcomeError("Discord n'a pas confirme le message. Verifiez le fil avant toute reprise.", true);
  }
  return message.id;
}

export async function deliverAllyFeedback({ db, context, data, row, rpc, send = sendAllyThreadMessage }) {
  if (!row?.sendable) throw Object.assign(new Error("Ce retour n'est pas pret ou a deja ete traite."), { statusCode: 409 });
  const claimed = await rpc(db, "claim_gvg_ally_delivery", { ...context, p_defense_id: row.defense_id,
    p_snapshot_version: data.snapshot_version, p_receipt_id: randomUUID(), p_claim_token: randomUUID(),
    p_payload: { owner_member_id: row.owner.id, thread_url: row.owner.personal_forum_post_url,
      label: row.label, owner_name: row.owner.watcher_name, content: row.message } });
  if (!claimed.claimed) return { status: claimed.status, attempted: false };
  let status, messageId = null, reason = null;
  try { messageId = await send(claimed.payload, claimed.receipt_id); status = "sent"; }
  catch (error) {
    status = error.uncertain === false ? "failed" : "uncertain";
    // Only safe, known transport failures may be shown. Never echo arbitrary HTTP bodies.
    reason = typeof error.uncertain === "boolean" ? error.message : "Resultat Discord incertain. Verifiez le fil personnel.";
  }
  try {
    await rpc(db, "finish_gvg_ally_delivery", { p_receipt_id: claimed.receipt_id, p_claim_token: claimed.claim_token,
      p_status: status, p_message_id: messageId, p_error: reason });
  } catch {
    return { status: "uncertain", attempted: true, error: "Resultat non enregistre. Aucun renvoi automatique ; verifiez le fil personnel." };
  }
  return { status, attempted: true, ...(reason ? { error: reason } : {}) };
}
