export const ACTIVITY_STATUS_KNOWN_DATE = "known_date";
export const ACTIVITY_STATUS_UNKNOWN_DATE = "unknown_date";
export const ACTIVITY_STATUS_NEVER = "never";

export const MEMBER_ACTIVITY_FRESHNESS_DAY_MS = 24 * 60 * 60 * 1000;
export const MEMBER_ACTIVITY_FRESHNESS_LIMITS_MS = Object.freeze({
  fresh: 7 * MEMBER_ACTIVITY_FRESHNESS_DAY_MS,
  neutral: 14 * MEMBER_ACTIVITY_FRESHNESS_DAY_MS,
  stale: 30 * MEMBER_ACTIVITY_FRESHNESS_DAY_MS,
});

export function getMemberActivityFreshnessTone(value, status, now = Date.now()) {
  if (status === ACTIVITY_STATUS_UNKNOWN_DATE) return "unknown";
  if (!value) return "missing";

  const timestamp = Date.parse(value);
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(timestamp) || !Number.isFinite(nowMs)) return "stale";

  const ageMs = nowMs - timestamp;
  if (ageMs <= MEMBER_ACTIVITY_FRESHNESS_LIMITS_MS.fresh) return "fresh";
  if (ageMs <= MEMBER_ACTIVITY_FRESHNESS_LIMITS_MS.neutral) return "neutral";
  if (ageMs <= MEMBER_ACTIVITY_FRESHNESS_LIMITS_MS.stale) return "stale";
  return "critical";
}

export function isMemberActivityFreshnessActionRequired(value, status, now = Date.now()) {
  const tone = getMemberActivityFreshnessTone(value, status, now);
  return tone === "critical" || tone === "missing";
}
