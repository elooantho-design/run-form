export const HERO_DIRECTION_OPTIONS = [
  { value: "N", label: "N" },
  { value: "S", label: "S" },
  { value: "E", label: "E" },
  { value: "O", label: "O" },
];

export function normalizeHeroDirection(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "W") return "O";
  return HERO_DIRECTION_OPTIONS.some((direction) => direction.value === normalized) ? normalized : "";
}

export function getHeroDirectionOverlayConfig(direction) {
  switch (normalizeHeroDirection(direction)) {
    case "E":
      return {
        src: "/ui/hero-dir-e.png",
        width: "160%",
        height: "160%",
        left: "50%",
        top: "50%",
        transform: "translate(-43%, -49%)",
      };
    case "O":
      return {
        src: "/ui/hero-dir-o.png",
        width: "160%",
        height: "160%",
        left: "50%",
        top: "50%",
        transform: "translate(-57%, -51%)",
      };
    case "N":
      return {
        src: "/ui/hero-dir-n.png",
        width: "140%",
        height: "140%",
        left: "50%",
        top: "50%",
        transform: "translate(-49%, -55%)",
      };
    case "S":
      return {
        src: "/ui/hero-dir-s.png",
        width: "160%",
        height: "160%",
        left: "50%",
        top: "50%",
        transform: "translate(-51%, -46%)",
      };
    default:
      return null;
  }
}

function parsePercent(value, fallback) {
  const raw = String(value || "").trim();
  const number = Number(raw.endsWith("%") ? raw.slice(0, -1) : raw);
  if (!Number.isFinite(number)) return fallback;
  return number / 100;
}

function parseTranslatePercent(transform) {
  const match = String(transform || "").match(/translate\(\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%\s*\)/i);
  if (!match) return { x: 0, y: 0 };
  return {
    x: Number(match[1]) / 100,
    y: Number(match[2]) / 100,
  };
}

export function getHeroDirectionOverlayBox(direction, { x = 0, y = 0, size = 0 } = {}) {
  const overlay = getHeroDirectionOverlayConfig(direction);
  if (!overlay || !Number.isFinite(size) || size <= 0) return null;

  const width = size * parsePercent(overlay.width, 1);
  const height = size * parsePercent(overlay.height, 1);
  const left = x - size / 2 + size * parsePercent(overlay.left, 0.5);
  const top = y - size / 2 + size * parsePercent(overlay.top, 0.5);
  const translate = parseTranslatePercent(overlay.transform);

  return {
    src: overlay.src,
    x: left + width * translate.x,
    y: top + height * translate.y,
    width,
    height,
  };
}
