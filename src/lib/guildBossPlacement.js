export const GUILD_BOSS_PLACEMENT_TOOL_ID = "placement-bdg";

export const GUILD_BOSS_PLACEMENT_STORAGE_KEY = "portal:guild-boss-placement:v1";

export const GUILD_BOSS_CALIBRATION_STORAGE_KEY = "portal:guild-boss-placement-calibration:v2";

export const GUILD_BOSS_POINT_CALIBRATION_MAP_IDS = new Set(["matrice", "apocalypse", "abysse", "cauchemar"]);

export const GUILD_BOSS_DEFAULT_HERO_FRAME_SCALE = 0.72;
export const GUILD_BOSS_DEFAULT_HERO_EXPORT_RADIUS_SCALE = 0.32;

export const GUILD_BOSS_MATRIX_DEFAULT_CELL_POINTS = [
  { row: 1, col: 1, x: 0.296332, y: 0.253466 },
  { row: 1, col: 2, x: 0.373634, y: 0.251694 },
  { row: 1, col: 3, x: 0.441272, y: 0.253843 },
  { row: 1, col: 4, x: 0.505287, y: 0.249545 },
  { row: 1, col: 5, x: 0.572926, y: 0.251694 },
  { row: 1, col: 6, x: 0.639357, y: 0.251694 },
  { row: 1, col: 7, x: 0.706995, y: 0.253843 },
  { row: 2, col: 1, x: 0.291501, y: 0.363467 },
  { row: 2, col: 2, x: 0.366387, y: 0.367766 },
  { row: 2, col: 3, x: 0.438857, y: 0.367766 },
  { row: 2, col: 4, x: 0.505287, y: 0.363467 },
  { row: 2, col: 5, x: 0.572926, y: 0.363467 },
  { row: 2, col: 6, x: 0.640565, y: 0.367766 },
  { row: 2, col: 7, x: 0.708203, y: 0.359168 },
  { row: 3, col: 1, x: 0.284254, y: 0.496735 },
  { row: 3, col: 2, x: 0.361555, y: 0.492436 },
  { row: 3, col: 3, x: 0.436441, y: 0.492436 },
  { row: 3, col: 4, x: 0.505287, y: 0.490287 },
  { row: 3, col: 5, x: 0.574134, y: 0.490287 },
  { row: 3, col: 6, x: 0.645396, y: 0.490287 },
  { row: 3, col: 7, x: 0.71545, y: 0.483838 },
  { row: 4, col: 1, x: 0.280631, y: 0.627854 },
  { row: 4, col: 2, x: 0.35914, y: 0.619256 },
  { row: 4, col: 3, x: 0.430402, y: 0.621405 },
  { row: 4, col: 4, x: 0.506495, y: 0.619256 },
  { row: 4, col: 5, x: 0.57655, y: 0.621405 },
  { row: 4, col: 6, x: 0.651435, y: 0.614957 },
  { row: 4, col: 7, x: 0.723905, y: 0.614957 },
  { row: 5, col: 1, x: 0.277007, y: 0.752524 },
  { row: 5, col: 2, x: 0.354308, y: 0.758972 },
  { row: 5, col: 3, x: 0.429194, y: 0.754673 },
  { row: 5, col: 4, x: 0.50408, y: 0.754673 },
  { row: 5, col: 5, x: 0.581381, y: 0.754673 },
  { row: 5, col: 6, x: 0.655059, y: 0.754673 },
  { row: 5, col: 7, x: 0.73236, y: 0.752524 },
];

export const GUILD_BOSS_MATRIX_BLOCKED_CELLS = ["0:0", "0:1", "0:2", "6:0", "6:1", "6:2"];

export const GUILD_BOSS_APOCALYPSE_DEFAULT_CELL_POINTS = [
  { row: 1, col: 1, x: 0.246902, y: 0.37178 },
  { row: 1, col: 2, x: 0.306959, y: 0.369871 },
  { row: 1, col: 3, x: 0.373451, y: 0.364146 },
  { row: 1, col: 4, x: 0.43887, y: 0.360329 },
  { row: 1, col: 5, x: 0.5, y: 0.350787 },
  { row: 1, col: 6, x: 0.565419, y: 0.350787 },
  { row: 1, col: 7, x: 0.628694, y: 0.367963 },
  { row: 1, col: 8, x: 0.690896, y: 0.37178 },
  { row: 1, col: 9, x: 0.752026, y: 0.367963 },
  { row: 2, col: 1, x: 0.238322, y: 0.469108 },
  { row: 2, col: 2, x: 0.302669, y: 0.469108 },
  { row: 2, col: 3, x: 0.367016, y: 0.467199 },
  { row: 2, col: 4, x: 0.437798, y: 0.457657 },
  { row: 2, col: 5, x: 0.5, y: 0.455749 },
  { row: 2, col: 6, x: 0.562202, y: 0.459566 },
  { row: 2, col: 7, x: 0.625477, y: 0.463383 },
  { row: 2, col: 8, x: 0.697331, y: 0.467199 },
  { row: 2, col: 9, x: 0.761678, y: 0.467199 },
  { row: 3, col: 1, x: 0.229743, y: 0.575978 },
  { row: 3, col: 2, x: 0.29409, y: 0.583612 },
  { row: 3, col: 3, x: 0.362726, y: 0.575978 },
  { row: 3, col: 4, x: 0.437798, y: 0.575978 },
  { row: 3, col: 5, x: 0.497855, y: 0.57407 },
  { row: 3, col: 6, x: 0.566492, y: 0.575978 },
  { row: 3, col: 7, x: 0.634056, y: 0.575978 },
  { row: 3, col: 8, x: 0.700548, y: 0.57407 },
  { row: 3, col: 9, x: 0.765968, y: 0.579795 },
  { row: 4, col: 1, x: 0.223308, y: 0.696207 },
  { row: 4, col: 2, x: 0.28551, y: 0.698115 },
  { row: 4, col: 3, x: 0.358437, y: 0.694299 },
  { row: 4, col: 4, x: 0.431363, y: 0.701932 },
  { row: 4, col: 5, x: 0.49571, y: 0.703841 },
  { row: 4, col: 6, x: 0.564347, y: 0.705749 },
  { row: 4, col: 7, x: 0.638346, y: 0.69239 },
  { row: 4, col: 8, x: 0.702693, y: 0.700024 },
  { row: 4, col: 9, x: 0.774547, y: 0.698115 },
];

export const GUILD_BOSS_APOCALYPSE_BLOCKED_CELLS = ["3:0", "4:0", "5:0", "0:2", "8:2", "0:3", "1:3", "7:3", "8:3"];

export const GUILD_BOSS_ABYSSE_DEFAULT_CELL_POINTS = [
  { row: 1, col: 1, x: 0.262989, y: 0.325978 },
  { row: 1, col: 2, x: 0.328408, y: 0.32407 },
  { row: 1, col: 3, x: 0.389538, y: 0.325978 },
  { row: 1, col: 4, x: 0.450667, y: 0.32407 },
  { row: 1, col: 5, x: 0.517159, y: 0.318344 },
  { row: 1, col: 6, x: 0.585796, y: 0.320253 },
  { row: 1, col: 7, x: 0.647998, y: 0.314528 },
  { row: 1, col: 8, x: 0.71449, y: 0.316436 },
  { row: 1, col: 9, x: 0.782054, y: 0.322161 },
  { row: 2, col: 1, x: 0.251192, y: 0.427123 },
  { row: 2, col: 2, x: 0.318756, y: 0.429031 },
  { row: 2, col: 3, x: 0.388465, y: 0.427123 },
  { row: 2, col: 4, x: 0.448522, y: 0.425215 },
  { row: 2, col: 5, x: 0.512869, y: 0.421398 },
  { row: 2, col: 6, x: 0.587941, y: 0.427547 },
  { row: 2, col: 7, x: 0.649071, y: 0.427123 },
  { row: 2, col: 8, x: 0.719852, y: 0.429031 },
  { row: 2, col: 9, x: 0.788489, y: 0.427123 },
  { row: 3, col: 1, x: 0.238322, y: 0.545444 },
  { row: 3, col: 2, x: 0.310176, y: 0.543535 },
  { row: 3, col: 3, x: 0.379886, y: 0.539719 },
  { row: 3, col: 4, x: 0.44745, y: 0.54926 },
  { row: 3, col: 5, x: 0.521449, y: 0.547352 },
  { row: 3, col: 6, x: 0.589013, y: 0.547352 },
  { row: 3, col: 7, x: 0.658723, y: 0.543535 },
  { row: 3, col: 8, x: 0.724142, y: 0.545444 },
  { row: 3, col: 9, x: 0.799214, y: 0.554986 },
  { row: 4, col: 1, x: 0.227598, y: 0.68094 },
  { row: 4, col: 2, x: 0.298379, y: 0.682848 },
  { row: 4, col: 3, x: 0.373451, y: 0.677123 },
  { row: 4, col: 4, x: 0.444233, y: 0.682848 },
  { row: 4, col: 5, x: 0.518232, y: 0.671398 },
  { row: 4, col: 6, x: 0.593303, y: 0.677123 },
  { row: 4, col: 7, x: 0.663012, y: 0.671398 },
  { row: 4, col: 8, x: 0.734867, y: 0.679031 },
  { row: 4, col: 9, x: 0.81101, y: 0.679031 },
];

export const GUILD_BOSS_ABYSSE_BLOCKED_CELLS = ["0:2", "8:2", "0:3", "1:3", "3:3", "5:3", "7:3", "8:3"];

export const GUILD_BOSS_CAUCHEMAR_DEFAULT_CELL_POINTS = [
  { row: 1, col: 1, x: 0.290872, y: 0.339337 },
  { row: 1, col: 2, x: 0.364871, y: 0.339337 },
  { row: 1, col: 3, x: 0.430291, y: 0.339337 },
  { row: 1, col: 4, x: 0.49571, y: 0.333612 },
  { row: 1, col: 5, x: 0.562202, y: 0.339337 },
  { row: 1, col: 6, x: 0.637274, y: 0.333612 },
  { row: 1, col: 7, x: 0.706983, y: 0.333612 },
  { row: 2, col: 1, x: 0.283365, y: 0.438573 },
  { row: 2, col: 2, x: 0.354147, y: 0.444299 },
  { row: 2, col: 3, x: 0.428146, y: 0.451932 },
  { row: 2, col: 4, x: 0.49571, y: 0.444299 },
  { row: 2, col: 5, x: 0.566492, y: 0.444299 },
  { row: 2, col: 6, x: 0.644781, y: 0.436665 },
  { row: 2, col: 7, x: 0.715562, y: 0.440482 },
  { row: 3, col: 1, x: 0.274786, y: 0.556894 },
  { row: 3, col: 2, x: 0.347712, y: 0.553077 },
  { row: 3, col: 3, x: 0.421711, y: 0.551169 },
  { row: 3, col: 4, x: 0.49571, y: 0.545444 },
  { row: 3, col: 5, x: 0.572927, y: 0.547352 },
  { row: 3, col: 6, x: 0.647998, y: 0.558802 },
  { row: 3, col: 7, x: 0.720925, y: 0.551169 },
  { row: 4, col: 1, x: 0.261916, y: 0.686665 },
  { row: 4, col: 2, x: 0.340205, y: 0.68094 },
  { row: 4, col: 3, x: 0.419566, y: 0.677123 },
  { row: 4, col: 4, x: 0.5, y: 0.675215 },
  { row: 4, col: 5, x: 0.579361, y: 0.677123 },
  { row: 4, col: 6, x: 0.65765, y: 0.68094 },
  { row: 4, col: 7, x: 0.732722, y: 0.690482 },
];

export const GUILD_BOSS_CAUCHEMAR_BLOCKED_CELLS = ["0:3", "6:3"];

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
    defaultCellPoints: GUILD_BOSS_MATRIX_DEFAULT_CELL_POINTS,
    blockedCells: GUILD_BOSS_MATRIX_BLOCKED_CELLS,
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
    defaultCellPoints: GUILD_BOSS_APOCALYPSE_DEFAULT_CELL_POINTS,
    blockedCells: GUILD_BOSS_APOCALYPSE_BLOCKED_CELLS,
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
    defaultCellPoints: GUILD_BOSS_ABYSSE_DEFAULT_CELL_POINTS,
    blockedCells: GUILD_BOSS_ABYSSE_BLOCKED_CELLS,
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
    defaultCellPoints: GUILD_BOSS_CAUCHEMAR_DEFAULT_CELL_POINTS,
    blockedCells: GUILD_BOSS_CAUCHEMAR_BLOCKED_CELLS,
    heroFrameScale: 0.88,
    heroExportRadiusScale: 0.39,
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

function getGuildBossBlockedCellSet(map) {
  return new Set((map?.blockedCells || []).map((cellKey) => String(cellKey)));
}

function getNormalizedPositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function getGuildBossHeroFrameScale(map) {
  return getNormalizedPositiveNumber(map?.heroFrameScale, GUILD_BOSS_DEFAULT_HERO_FRAME_SCALE);
}

export function getGuildBossHeroExportRadiusScale(map) {
  return getNormalizedPositiveNumber(map?.heroExportRadiusScale, GUILD_BOSS_DEFAULT_HERO_EXPORT_RADIUS_SCALE);
}

export function isGuildBossCellPlayable(map, cellKey) {
  if (!map || !cellKey) return false;

  const { columnIndex, rowIndex } = parseGuildBossCellKey(cellKey);
  if (columnIndex < 0 || rowIndex < 0 || columnIndex >= map.columns || rowIndex >= map.rows) return false;

  return !getGuildBossBlockedCellSet(map).has(String(cellKey));
}

export function getGuildBossPointLabel(point) {
  return `L${Number(point?.row) || 0}-C${Number(point?.col) || 0}`;
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
  const defaultPoints = normalizeGuildBossCellPoints(map, map?.defaultCellPoints || []);
  const total = (map?.rows || 0) * (map?.columns || 0);
  const supportsPointCalibration = GUILD_BOSS_POINT_CALIBRATION_MAP_IDS.has(map?.id);
  const hasCustomPoints = supportsPointCalibration && normalizedPoints.length === total;
  const hasDefaultPoints = supportsPointCalibration && defaultPoints.length === total;
  const usesCalibratedPoints = hasCustomPoints || hasDefaultPoints;
  const points = hasCustomPoints ? normalizedPoints : hasDefaultPoints ? defaultPoints : buildGuildBossGridCenterPoints(map);
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

export function normalizeGuildBossPlacements(value, map = null) {
  if (!value || typeof value !== "object") return {};

  return Object.fromEntries(
    Object.entries(value)
      .map(([cellKey, placement]) => {
        const championId = String(placement?.championId || placement?.champion_id || "").trim();
        if (!championId) return null;
        if (map && !isGuildBossCellPlayable(map, cellKey)) return null;

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
      normalizeGuildBossPlacements(value[map.id]?.placements || value[map.id] || {}, map),
    ]),
  );
}

export function placeGuildBossHero(placements, { cellKey, championId, direction = "E", map = null }) {
  const next = { ...normalizeGuildBossPlacements(placements, map) };
  const normalizedChampionId = String(championId || "").trim();
  if (!cellKey || !normalizedChampionId) return next;
  if (map && !isGuildBossCellPlayable(map, cellKey)) return next;

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

export function moveGuildBossHero(placements, { fromCellKey, toCellKey, map = null }) {
  const next = { ...normalizeGuildBossPlacements(placements, map) };
  if (!fromCellKey || !toCellKey || !next[fromCellKey]) return next;
  if (map && !isGuildBossCellPlayable(map, toCellKey)) return next;

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
    if (map.heroFrameScale !== undefined && (!Number.isFinite(map.heroFrameScale) || map.heroFrameScale <= 0 || map.heroFrameScale > 1.5)) {
      errors.push("invalid heroFrameScale");
    }
    if (
      map.heroExportRadiusScale !== undefined &&
      (!Number.isFinite(map.heroExportRadiusScale) || map.heroExportRadiusScale <= 0 || map.heroExportRadiusScale > 1)
    ) {
      errors.push("invalid heroExportRadiusScale");
    }
    for (const cellKey of map.blockedCells || []) {
      const { columnIndex, rowIndex } = parseGuildBossCellKey(cellKey);
      if (columnIndex < 0 || rowIndex < 0 || columnIndex >= map.columns || rowIndex >= map.rows) {
        errors.push(`invalid blocked cell ${cellKey}`);
      }
    }

    return { id: map.id, ok: errors.length === 0, errors };
  });
}
