export const GUILD_BOSS_PLACEMENT_TOOL_ID = "placement-bdg";

export const GUILD_BOSS_PLACEMENT_STORAGE_KEY = "portal:guild-boss-placement:v1";

export const GUILD_BOSS_CALIBRATION_STORAGE_KEY = "portal:guild-boss-placement-calibration:v1";

export const GUILD_BOSS_POINT_CALIBRATION_MAP_IDS = new Set(["matrice"]);

export const GUILD_BOSS_DIRECTIONS = [
  { value: "N", labelKey: "pvePlacement.directionNorth", fallback: "N" },
  { value: "E", labelKey: "pvePlacement.directionEast", fallback: "E" },
  { value: "S", labelKey: "pvePlacement.directionSouth", fallback: "S" },
  { value: "W", labelKey: "pvePlacement.directionWest", fallback: "O" },
];

export const GUILD_BOSS_MAPS = [
  {
    id: "matrice",
    labelKey: "pvePlacement.mapMatrix",
    fallbackLabel: "Matrice",
    sourceFile: "Matrice7x5 .png",
    imageUrl: "/pve-placement-bdg/matrice-7x5.png",
    columns: 7,
    rows: 5,
    gridBounds: { x: 0.168, y: 0.193, width: 0.67, height: 0.642 },
  },
  {
    id: "apocalypse",
    labelKey: "pvePlacement.mapApocalypse",
    fallbackLabel: "Apocalypse 1 / 2",
    sourceFile: "Appo 9x4.png",
    imageUrl: "/pve-placement-bdg/apocalypse-9x4.png",
    columns: 9,
    rows: 4,
    gridBounds: { x: 0.198, y: 0.312, width: 0.58, height: 0.45 },
  },
  {
    id: "abysse",
    labelKey: "pvePlacement.mapAbyss",
    fallbackLabel: "Abysse",
    sourceFile: "Abysse 9x4.png",
    imageUrl: "/pve-placement-bdg/abysse-9x4.png",
    columns: 9,
    rows: 4,
    gridBounds: { x: 0.218, y: 0.32, width: 0.56, height: 0.452 },
  },
  {
    id: "cauchemar",
    labelKey: "pvePlacement.mapNightmare",
    fallbackLabel: "Cauchemar",
    sourceFile: "Cauchemar 7x4.png",
    imageUrl: "/pve-placement-bdg/cauchemar-7x4.png",
    columns: 7,
    rows: 4,
    gridBounds: { x: 0.224, y: 0.306, width: 0.54, height: 0.474 },
  },
];

export function getGuildBossMapConfig(mapId) {
  return GUILD_BOSS_MAPS.find((map) => map.id === mapId) || GUILD_BOSS_MAPS[0];
}

export function makeGuildBossCellKey(columnIndex, rowIndex) {
  return `${Number(columnIndex) || 0}:${Number(rowIndex) || 0}`;
}

export function parseGuildBossCellKey(cellKey) {
  const [column, row] = String(cellKey || "")
    .split(":")
    .map((part) => Number(part));

  return {
    columnIndex: Number.isFinite(column) ? column : 0,
    rowIndex: Number.isFinite(row) ? row : 0,
  };
}

export function getGuildBossCellLabel(cellKey) {
  const { columnIndex, rowIndex } = parseGuildBossCellKey(cellKey);
  return `${String.fromCharCode(65 + rowIndex)}${columnIndex + 1}`;
}

export function getGuildBossPointLabel(point) {
  return `R${Number(point?.row) || 0}C${Number(point?.col) || 0}`;
}

function clampNormalizedCoordinate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(1, Math.max(0, number));
}

function getPointKey(row, col) {
  return `${Number(row) || 0}:${Number(col) || 0}`;
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((left, right) => left - right);
  if (!sorted.length) return null;
  return sorted[Math.floor(sorted.length / 2)];
}

export function buildGuildBossGridCenterPoints(map) {
  if (!map || !Number.isInteger(map.rows) || !Number.isInteger(map.columns)) return [];

  const bounds = map.gridBounds || { x: 0, y: 0, width: 1, height: 1 };
  const cellWidth = bounds.width / map.columns;
  const cellHeight = bounds.height / map.rows;
  const points = [];

  for (let row = 1; row <= map.rows; row += 1) {
    for (let col = 1; col <= map.columns; col += 1) {
      points.push({
        row,
        col,
        x: bounds.x + (col - 0.5) * cellWidth,
        y: bounds.y + (row - 0.5) * cellHeight,
      });
    }
  }

  return points;
}

export function normalizeGuildBossCellPoints(map, value) {
  if (!map || !Array.isArray(value)) return [];

  const byCell = new Map();

  for (const item of value) {
    const row = Number(item?.row);
    const col = Number(item?.col);
    const x = clampNormalizedCoordinate(item?.x);
    const y = clampNormalizedCoordinate(item?.y);
    if (!Number.isInteger(row) || !Number.isInteger(col) || x === null || y === null) continue;
    if (row < 1 || row > map.rows || col < 1 || col > map.columns) continue;

    byCell.set(getPointKey(row, col), {
      row,
      col,
      x: Number(x.toFixed(6)),
      y: Number(y.toFixed(6)),
    });
  }

  return [...byCell.values()].sort((left, right) => left.row - right.row || left.col - right.col);
}

export function getGuildBossCalibrationProgress(map, points) {
  const normalizedPoints = normalizeGuildBossCellPoints(map, points);
  const total = (map?.rows || 0) * (map?.columns || 0);
  const pointKeys = new Set(normalizedPoints.map((point) => getPointKey(point.row, point.col)));
  let nextPoint = null;

  for (let row = 1; row <= (map?.rows || 0); row += 1) {
    for (let col = 1; col <= (map?.columns || 0); col += 1) {
      if (!pointKeys.has(getPointKey(row, col))) {
        nextPoint = { row, col };
        return {
          count: normalizedPoints.length,
          total,
          complete: normalizedPoints.length === total,
          nextPoint,
        };
      }
    }
  }

  return {
    count: normalizedPoints.length,
    total,
    complete: normalizedPoints.length === total,
    nextPoint,
  };
}

export function resolveGuildBossCellGeometry(map, calibratedPoints = []) {
  const normalizedPoints = normalizeGuildBossCellPoints(map, calibratedPoints);
  const total = (map?.rows || 0) * (map?.columns || 0);
  const usesCalibratedPoints = GUILD_BOSS_POINT_CALIBRATION_MAP_IDS.has(map?.id) && normalizedPoints.length === total;
  const points = usesCalibratedPoints ? normalizedPoints : buildGuildBossGridCenterPoints(map);
  const pointsByCell = new Map(points.map((point) => [getPointKey(point.row, point.col), point]));
  const horizontalSteps = [];
  const verticalSteps = [];

  for (let row = 1; row <= (map?.rows || 0); row += 1) {
    for (let col = 1; col < (map?.columns || 0); col += 1) {
      const left = pointsByCell.get(getPointKey(row, col));
      const right = pointsByCell.get(getPointKey(row, col + 1));
      if (left && right) horizontalSteps.push(Math.abs(right.x - left.x));
    }
  }

  for (let col = 1; col <= (map?.columns || 0); col += 1) {
    for (let row = 1; row < (map?.rows || 0); row += 1) {
      const top = pointsByCell.get(getPointKey(row, col));
      const bottom = pointsByCell.get(getPointKey(row + 1, col));
      if (top && bottom) verticalSteps.push(Math.abs(bottom.y - top.y));
    }
  }

  const fallbackBounds = map?.gridBounds || { width: 1, height: 1 };
  const cellWidth = median(horizontalSteps) || fallbackBounds.width / (map?.columns || 1);
  const cellHeight = median(verticalSteps) || fallbackBounds.height / (map?.rows || 1);

  return {
    usesCalibratedPoints,
    points,
    pointsByCell,
    cellWidth,
    cellHeight,
  };
}

export function getGuildBossCellGeometry(map, calibratedPoints, columnIndex, rowIndex) {
  const layout = resolveGuildBossCellGeometry(map, calibratedPoints);
  const point = layout.pointsByCell.get(getPointKey(rowIndex + 1, columnIndex + 1));

  if (!point) {
    return {
      centerX: 0,
      centerY: 0,
      cellWidth: layout.cellWidth,
      cellHeight: layout.cellHeight,
      usesCalibratedPoints: layout.usesCalibratedPoints,
    };
  }

  return {
    centerX: point.x,
    centerY: point.y,
    cellWidth: layout.cellWidth,
    cellHeight: layout.cellHeight,
    usesCalibratedPoints: layout.usesCalibratedPoints,
  };
}

export function normalizeGuildBossDirection(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "O") return "W";
  return GUILD_BOSS_DIRECTIONS.some((direction) => direction.value === normalized) ? normalized : "E";
}

export function getNextGuildBossDirection(direction) {
  const normalized = normalizeGuildBossDirection(direction);
  const currentIndex = GUILD_BOSS_DIRECTIONS.findIndex((item) => item.value === normalized);
  return GUILD_BOSS_DIRECTIONS[(currentIndex + 1) % GUILD_BOSS_DIRECTIONS.length].value;
}

export function normalizeGuildBossPlacements(value) {
  if (!value || typeof value !== "object") return {};

  return Object.fromEntries(
    Object.entries(value)
      .map(([cellKey, placement]) => {
        const championId = String(placement?.championId || placement?.champion_id || "").trim();
        if (!championId) return null;

        return [
          String(cellKey),
          {
            championId,
            direction: normalizeGuildBossDirection(placement?.direction),
          },
        ];
      })
      .filter(Boolean),
  );
}

export function normalizeGuildBossDrafts(value) {
  if (!value || typeof value !== "object") return {};

  return Object.fromEntries(
    GUILD_BOSS_MAPS.map((map) => [
      map.id,
      normalizeGuildBossPlacements(value[map.id]?.placements || value[map.id] || {}),
    ]),
  );
}

export function placeGuildBossHero(placements, { cellKey, championId, direction = "E" }) {
  const next = { ...normalizeGuildBossPlacements(placements) };
  const normalizedChampionId = String(championId || "").trim();
  if (!cellKey || !normalizedChampionId) return next;

  for (const [existingCellKey, placement] of Object.entries(next)) {
    if (String(placement.championId) === normalizedChampionId && existingCellKey !== cellKey) {
      delete next[existingCellKey];
    }
  }

  next[cellKey] = {
    championId: normalizedChampionId,
    direction: normalizeGuildBossDirection(direction),
  };

  return next;
}

export function moveGuildBossHero(placements, { fromCellKey, toCellKey }) {
  const next = { ...normalizeGuildBossPlacements(placements) };
  if (!fromCellKey || !toCellKey || !next[fromCellKey]) return next;

  const placement = next[fromCellKey];
  delete next[fromCellKey];
  next[toCellKey] = placement;

  return next;
}

export function removeGuildBossHero(placements, cellKey) {
  const next = { ...normalizeGuildBossPlacements(placements) };
  delete next[cellKey];
  return next;
}

export function rotateGuildBossHero(placements, cellKey, direction) {
  const next = { ...normalizeGuildBossPlacements(placements) };
  if (!next[cellKey]) return next;

  next[cellKey] = {
    ...next[cellKey],
    direction: direction ? normalizeGuildBossDirection(direction) : getNextGuildBossDirection(next[cellKey].direction),
  };

  return next;
}

export function validateGuildBossMapConfigs(maps = GUILD_BOSS_MAPS) {
  return maps.map((map) => {
    const errors = [];
    if (!map.id) errors.push("missing id");
    if (!map.imageUrl) errors.push("missing imageUrl");
    if (!Number.isInteger(map.columns) || map.columns <= 0) errors.push("invalid columns");
    if (!Number.isInteger(map.rows) || map.rows <= 0) errors.push("invalid rows");

    const bounds = map.gridBounds || {};
    for (const key of ["x", "y", "width", "height"]) {
      if (!Number.isFinite(bounds[key])) errors.push(`invalid gridBounds.${key}`);
    }
    if (bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0) {
      errors.push("gridBounds out of range");
    }
    if (bounds.x + bounds.width > 1 || bounds.y + bounds.height > 1) {
      errors.push("gridBounds exceed image");
    }

    return { id: map.id, ok: errors.length === 0, errors };
  });
}
