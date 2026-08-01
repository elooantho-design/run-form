/* global process */
import crypto from "node:crypto";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function clean(value) {
  return String(value || "").trim();
}

export function createPortalTranslatorSignature({ secret, timestamp, body }) {
  const normalizedSecret = clean(secret);
  const normalizedTimestamp = clean(timestamp);
  const rawBody = typeof body === "string" ? body : JSON.stringify(body || {});

  if (!normalizedSecret || !normalizedTimestamp) return "";

  return crypto
    .createHmac("sha256", normalizedSecret)
    .update(`${normalizedTimestamp}.${rawBody}`, "utf8")
    .digest("hex");
}

export function verifyPortalTranslatorSignature({ secret, timestamp, body, signature, now = Date.now() }) {
  const normalizedSecret = clean(secret);
  const normalizedTimestamp = clean(timestamp);
  const normalizedSignature = clean(signature).toLowerCase();

  if (!normalizedSecret || !normalizedTimestamp || !normalizedSignature) {
    return false;
  }

  const timestampMs = Number(normalizedTimestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > MAX_CLOCK_SKEW_MS) {
    return false;
  }

  const expected = createPortalTranslatorSignature({
    secret: normalizedSecret,
    timestamp: normalizedTimestamp,
    body,
  });

  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(normalizedSignature, "hex");
  if (!expectedBuffer.length || expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}
