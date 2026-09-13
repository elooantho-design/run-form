const GVG_POSITION_GRIDS = {
  tower: { rows: 7, cols: 10 },
  fortress: { rows: 8, cols: 11 },
};

export function normalizeGvgStrategyMapType(mapType) {
  const value = String(mapType || "").trim().toLowerCase();
  if (value === "fortress" || value === "bastion" || value === "fort") return "fortress";
  if (value === "tower" || value === "tour") return "tower";
  return "tower";
}

export function normalizeGvgStrategyChampionName(name) {
  if (!name) return null;
  return (
    String(name)
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\d+$/, "") || null
  );
}

export function normalizeGvgStrategyPosition(position, mapType = "tower") {
  if (!position) return null;
  const value = String(position).trim().toUpperCase();
  const match = /^([A-Z])([1-9]\d?)$/.exec(value);
  if (!match) return null;

  const grid = GVG_POSITION_GRIDS[normalizeGvgStrategyMapType(mapType)] || GVG_POSITION_GRIDS.tower;
  const row = match[1].charCodeAt(0) - "A".charCodeAt(0) + 1;
  const col = Number(match[2]);

  return row >= 1 && row <= grid.rows && col >= 1 && col <= grid.cols ? value : null;
}

export function normalizeGvgStrategyDirection(direction) {
  if (!direction) return null;
  const value = String(direction).trim().toUpperCase();

  if (["N", "NORD", "NORTH", "UP"].includes(value)) return "N";
  if (["S", "SUD", "SOUTH", "DOWN"].includes(value)) return "S";
  if (["E", "EST", "EAST", "RIGHT"].includes(value)) return "E";
  if (["O", "OUEST", "W", "WEST", "LEFT"].includes(value)) return "O";

  if (value === "↑") return "N";
  if (value === "↓") return "S";
  if (value === "→") return "E";
  if (value === "←") return "O";

  return value || null;
}

export function buildGvgStrategyCriteriaFromHeroes(heroes, mapType = "tower", overrides = []) {
  const normalizedMapType = normalizeGvgStrategyMapType(mapType);
  return (Array.isArray(heroes) ? heroes : [])
    .slice(0, 5)
    .map((hero, index) => {
      const override = overrides[index] || {};
      return {
        champion: normalizeGvgStrategyChampionName(hero?.champion || hero?.name),
        position: normalizeGvgStrategyPosition(hero?.position, normalizedMapType),
        direction: normalizeGvgStrategyDirection(hero?.direction),
        matchChampion: override.matchChampion !== false,
        matchPosition: override.matchPosition !== false,
        matchDirection: override.matchDirection !== false,
      };
    })
    .filter((line) => line.champion || line.position || line.direction);
}

export function normalizeGvgStrategyCandidateSlot(slot, mapType = "tower") {
  const normalizedMapType = normalizeGvgStrategyMapType(mapType);
  return {
    champion: normalizeGvgStrategyChampionName(slot?.champion || slot?.name),
    position: normalizeGvgStrategyPosition(slot?.position, normalizedMapType),
    direction: normalizeGvgStrategyDirection(slot?.direction),
  };
}

export function gvgStrategySlotMatchesCriteria(candidateSlot, criteriaLine) {
  if (!candidateSlot || !criteriaLine) return false;

  if (criteriaLine.matchChampion && candidateSlot.champion !== criteriaLine.champion) {
    return false;
  }

  if (criteriaLine.matchPosition && candidateSlot.position !== criteriaLine.position) {
    return false;
  }

  if (criteriaLine.matchDirection && candidateSlot.direction !== criteriaLine.direction) {
    return false;
  }

  return true;
}

export function gvgStrategyHasBijectiveMatch(sourceCriteria, candidateSlots, mapType = "tower") {
  const criteria = (sourceCriteria || []).filter(Boolean);
  const slots = (candidateSlots || [])
    .map((slot) => normalizeGvgStrategyCandidateSlot(slot, mapType))
    .filter((slot) => slot.champion || slot.position || slot.direction);

  if (!criteria.length || slots.length < criteria.length) return false;

  const candidatesByCriteria = criteria.map((line) =>
    slots
      .map((slot, index) => ({ slot, index }))
      .filter(({ slot }) => gvgStrategySlotMatchesCriteria(slot, line))
      .map(({ index }) => index)
  );

  if (candidatesByCriteria.some((candidateIndexes) => candidateIndexes.length === 0)) {
    return false;
  }

  const order = criteria
    .map((_, index) => index)
    .sort((a, b) => candidatesByCriteria[a].length - candidatesByCriteria[b].length);
  const used = new Set();

  function visit(orderIndex) {
    if (orderIndex >= order.length) return true;

    const criteriaIndex = order[orderIndex];
    for (const slotIndex of candidatesByCriteria[criteriaIndex]) {
      if (used.has(slotIndex)) continue;
      used.add(slotIndex);
      if (visit(orderIndex + 1)) return true;
      used.delete(slotIndex);
    }

    return false;
  }

  return visit(0);
}

export function inferGvgStrategyMapType(strat = {}, slots = []) {
  const explicit = normalizeGvgStrategyMapType(strat.map_type || strat.mapType || "");
  if (strat.map_type || strat.mapType) return explicit;

  const defKey = String(strat.def_key || strat.defKey || "").toLowerCase();
  if (/_fort(?:_|$)/.test(defKey) || /fortress/.test(defKey) || /bastion/.test(defKey)) {
    return "fortress";
  }
  if (/_t\d+_/.test(defKey) || /tower/.test(defKey) || /tour/.test(defKey)) {
    return "tower";
  }

  const name = String(strat.name || "").toLowerCase();
  if (name.includes("forteresse") || name.includes("fortress") || /\bfort\b/.test(name)) {
    return "fortress";
  }
  if (name.includes("tower") || name.includes("tour")) {
    return "tower";
  }

  const hasFortressOnlyPosition = (slots || []).some((slot) => {
    const raw = String(slot?.position || "").trim().toUpperCase();
    const match = /^([A-Z])([1-9]\d?)$/.exec(raw);
    if (!match) return false;
    const row = match[1].charCodeAt(0) - "A".charCodeAt(0) + 1;
    const col = Number(match[2]);
    return row > GVG_POSITION_GRIDS.tower.rows || col > GVG_POSITION_GRIDS.tower.cols;
  });

  return hasFortressOnlyPosition ? "fortress" : "tower";
}

export function compareGvgStrategySearchResults(a, b) {
  const likesA = Number(a?.likes_count ?? a?.likesCount ?? a?.likes ?? 0) || 0;
  const likesB = Number(b?.likes_count ?? b?.likesCount ?? b?.likes ?? 0) || 0;
  if (likesB !== likesA) return likesB - likesA;

  const dateA = Date.parse(a?.created_at || a?.createdAt || "") || 0;
  const dateB = Date.parse(b?.created_at || b?.createdAt || "") || 0;
  if (dateB !== dateA) return dateB - dateA;

  return Number(a?.strat_id || a?.id || 0) - Number(b?.strat_id || b?.id || 0);
}
