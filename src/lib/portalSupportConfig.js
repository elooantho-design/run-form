export const PORTAL_SUPPORT_CONFIG = {
  currency: "eur",
  suggestedAmountsEuros: [5, 10, 20, 50, 100, 200],
  minAmountEuros: 2,
  maxAmountEuros: 10000,
  monthlyTargetEuros: 100,
  productName: "Soutien Portal",
};

export function normalizeSupportType(value) {
  return value === "monthly" ? "monthly" : "one_time";
}

export function getSupportTypeLabel(type) {
  return normalizeSupportType(type) === "monthly" ? "Soutien mensuel Portal" : "Soutien ponctuel Portal";
}

export function eurosToCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

export function centsToEuros(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return amount / 100;
}

function readConfiguredEuros(value, fallback) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : fallback;
}

export function getSupportAmountLimitsEuros(env = {}) {
  const minAmountEuros = readConfiguredEuros(
    env.PORTAL_SUPPORT_MIN_AMOUNT_EUR,
    PORTAL_SUPPORT_CONFIG.minAmountEuros,
  );
  const configuredMaxAmountEuros = readConfiguredEuros(
    env.PORTAL_SUPPORT_MAX_AMOUNT_EUR,
    PORTAL_SUPPORT_CONFIG.maxAmountEuros,
  );
  const maxAmountEuros = Math.max(configuredMaxAmountEuros, minAmountEuros);

  return { minAmountEuros, maxAmountEuros };
}

export function getSupportAmountLimitsCents(env = {}) {
  const { minAmountEuros, maxAmountEuros } = getSupportAmountLimitsEuros(env);

  return {
    minCents: eurosToCents(minAmountEuros),
    maxCents: eurosToCents(maxAmountEuros),
  };
}

export function validateSupportAmountCents(value, limits = getSupportAmountLimitsCents()) {
  const amountCents = Math.round(Number(value || 0));
  const minCents = Number.isFinite(Number(limits.minCents))
    ? Math.round(Number(limits.minCents))
    : eurosToCents(PORTAL_SUPPORT_CONFIG.minAmountEuros);
  const maxCents = Number.isFinite(Number(limits.maxCents))
    ? Math.round(Number(limits.maxCents))
    : eurosToCents(PORTAL_SUPPORT_CONFIG.maxAmountEuros);

  return {
    ok: amountCents >= minCents && amountCents <= maxCents,
    amountCents,
    minCents,
    maxCents,
  };
}
