export function normalizeStoredPbRaw(value) {
  let number = Number(value || 0);

  if (!Number.isFinite(number) || number <= 0) return 0;

  while (number >= 1000) {
    number /= 1000;
  }

  return number;
}

export function truncatePbValue(value) {
  const number = normalizeStoredPbRaw(value);

  if (!number) return 0;

  return Math.trunc((number + Number.EPSILON) * 1000) / 1000;
}

export function formatPbAverage(value) {
  const truncated = truncatePbValue(value);

  if (!truncated) return "-";

  return truncated.toFixed(3).replace(".", ",");
}

export function formatPbInputValue(value) {
  const formatted = formatPbAverage(value);

  return formatted === "-" ? "" : formatted;
}

export function normalizePbRawInput(value) {
  const raw = String(value || "").trim();

  if (!raw) return NaN;

  const compact = raw.replace(/\s+/g, "");
  const decimalMatch = compact.match(/^(\d{1,3})[,.](\d{1,3})$/);

  if (decimalMatch) {
    const [, integerPart, decimalPart] = decimalMatch;
    const numeric = Number(`${integerPart}.${decimalPart}`);
    return Number.isFinite(numeric) ? numeric : NaN;
  }

  const digits = compact.replace(/\D/g, "").slice(0, 6);

  if (!digits) return NaN;

  const numeric = Number(digits);

  if (!Number.isFinite(numeric)) return NaN;

  if (digits.length <= 3) return numeric;

  return numeric / 1000;
}
