import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Clipboard,
  Download,
  RotateCw,
  Search,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import HeroDirectionOverlay from "@/components/HeroDirectionOverlay";
import { getChampionDisplayName, getChampionFieldValue, normalizeChampionLookupKey } from "@/lib/championDisplay";
import { fetchPortalChampions } from "@/lib/portalChampions";
import { getHeroDirectionOverlayBox } from "@/lib/heroDirectionOverlay";
import { usePortalLanguage } from "@/lib/portalLanguage";
import { buildPublicHeroUrl } from "@/lib/vpsAssets";
import {
  GUILD_BOSS_CALIBRATION_STORAGE_KEY,
  GUILD_BOSS_DIRECTIONS,
  GUILD_BOSS_MAPS,
  GUILD_BOSS_POINT_CALIBRATION_MAP_IDS,
  GUILD_BOSS_PLACEMENT_STORAGE_KEY,
  getGuildBossCalibrationProgress,
  getGuildBossCellGeometry,
  getGuildBossCellLabel,
  getGuildBossMapConfig,
  getGuildBossPointLabel,
  isGuildBossCellPlayable,
  makeGuildBossCellKey,
  moveGuildBossHero,
  normalizeGuildBossCellPoints,
  normalizeGuildBossDrafts,
  parseGuildBossCellKey,
  placeGuildBossHero,
  removeGuildBossHero,
  resolveGuildBossCellGeometry,
  rotateGuildBossHero,
} from "@/lib/guildBossPlacement";

const MAP_EXPORT_FILE_PREFIX = "placement-bdg";
const HERO_LIST_LIMIT = 120;

function normalizeRoleValue(role) {
  return String(role || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isLeaderSession(session) {
  return Boolean(session?.isLeader || session?.leader || normalizeRoleValue(session?.role) === "leader");
}

function normalizeImageFile(value) {
  const normalized = String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

  return normalized ? `${normalized}.png` : "";
}

function getChampionImageFile(champion) {
  const configured = getChampionFieldValue(champion, [
    "image_file",
    "imageFile",
    "portrait",
    "hero_image",
    "heroImage",
    "portal_name",
    "portalName",
    "name",
  ]);

  return normalizeImageFile(configured || champion?.name);
}

function getChampionLocalImageUrl(champion) {
  const fileName = getChampionImageFile(champion);
  return fileName ? `/heroes/${fileName}` : "";
}

function getChampionRemoteImageUrl(champion) {
  const fileName = getChampionImageFile(champion);
  return buildPublicHeroUrl(fileName);
}

function getChampionInitials(champion, language) {
  const name = getChampionDisplayName(champion, language) || champion?.name || "?";
  return String(name)
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getGridRows(map) {
  return Array.from({ length: map.rows }, (_, rowIndex) =>
    Array.from({ length: map.columns }, (_, columnIndex) => ({
      rowIndex,
      columnIndex,
      cellKey: makeGuildBossCellKey(columnIndex, rowIndex),
    })),
  );
}

function getCalibrationPointKey(point) {
  return `${Number(point?.row) || 0}:${Number(point?.col) || 0}`;
}

function parseCalibrationPointKey(pointKey) {
  const [row, col] = String(pointKey || "")
    .split(":")
    .map((part) => Number(part));
  return {
    row: Number.isInteger(row) ? row : 0,
    col: Number.isInteger(col) ? col : 0,
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error("Image source missing."));
      return;
    }

    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load image: ${src}`));
    image.src = src;
  });
}

function drawFallbackHero(ctx, { x, y, radius, label }) {
  const gradient = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
  gradient.addColorStop(0, "#0f172a");
  gradient.addColorStop(1, "#155e75");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#facc15";
  ctx.lineWidth = Math.max(3, radius * 0.09);
  ctx.stroke();
  ctx.fillStyle = "#f8fafc";
  ctx.font = `700 ${Math.max(14, Math.round(radius * 0.42))}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label || "?", x, y);
}

async function drawDirectionOverlay(ctx, { x, y, radius, direction, imageCache }) {
  const box = getHeroDirectionOverlayBox(direction, { x, y, size: radius * 2 });
  if (!box) return;

  try {
    let directionImage = imageCache.get(box.src);
    if (!directionImage) {
      directionImage = await loadImage(box.src);
      imageCache.set(box.src, directionImage);
    }

    ctx.drawImage(directionImage, box.x, box.y, box.width, box.height);
  } catch {
    // Keep the export usable even if an orientation asset fails to load.
  }
}

async function renderPlacementBlob({ map, placements, championById, includeGrid, language, calibratedPoints = [] }) {
  const mapImage = await loadImage(map.imageUrl);
  const width = mapImage.naturalWidth || mapImage.width;
  const height = mapImage.naturalHeight || mapImage.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable.");

  ctx.drawImage(mapImage, 0, 0, width, height);

  const cellGeometry = resolveGuildBossCellGeometry(map, calibratedPoints);
  const directionImageCache = new Map();

  if (includeGrid) {
    ctx.save();
    ctx.strokeStyle = "rgba(34, 211, 238, 0.72)";
    ctx.lineWidth = Math.max(2, Math.round(width * 0.0015));
    for (let row = 1; row <= map.rows; row += 1) {
      for (let col = 1; col <= map.columns; col += 1) {
        const point = cellGeometry.pointsByCell.get(`${row}:${col}`);
        if (!point) continue;
        const cellWidth = cellGeometry.cellWidth * width;
        const cellHeight = cellGeometry.cellHeight * height;
        ctx.strokeRect(point.x * width - cellWidth / 2, point.y * height - cellHeight / 2, cellWidth, cellHeight);
      }
    }
    ctx.restore();
  }

  for (const [cellKey, placement] of Object.entries(placements || {})) {
    if (!isGuildBossCellPlayable(map, cellKey)) continue;

    const { columnIndex, rowIndex } = parseGuildBossCellKey(cellKey);
    const champion = championById.get(String(placement.championId));
    if (!champion) continue;

    const geometry = getGuildBossCellGeometry(map, calibratedPoints, columnIndex, rowIndex);
    const centerX = geometry.centerX * width;
    const centerY = geometry.centerY * height;
    const cellWidth = geometry.cellWidth * width;
    const cellHeight = geometry.cellHeight * height;
    const radius = Math.min(cellWidth, cellHeight) * 0.32;
    const imageUrl = getChampionLocalImageUrl(champion);

    try {
      const heroImage = await loadImage(imageUrl);
      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.clip();

      const imageSize = Math.min(heroImage.naturalWidth || heroImage.width, heroImage.naturalHeight || heroImage.height);
      const sourceX = ((heroImage.naturalWidth || heroImage.width) - imageSize) / 2;
      const sourceY = ((heroImage.naturalHeight || heroImage.height) - imageSize) / 2;
      ctx.drawImage(
        heroImage,
        sourceX,
        sourceY,
        imageSize,
        imageSize,
        centerX - radius,
        centerY - radius,
        radius * 2,
        radius * 2,
      );
      ctx.restore();
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = Math.max(3, radius * 0.09);
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.stroke();
    } catch {
      drawFallbackHero(ctx, {
        x: centerX,
        y: centerY,
        radius,
        label: getChampionInitials(champion, language),
      });
    }

    await drawDirectionOverlay(ctx, {
      x: centerX,
      y: centerY,
      radius,
      direction: placement.direction,
      imageCache: directionImageCache,
    });
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("PNG export failed."));
      },
      "image/png",
      0.95,
    );
  });
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildHeroOption(champion, language) {
  const displayName = getChampionDisplayName(champion, language);
  const technicalName = String(champion?.name || "").trim();
  const englishName = String(getChampionFieldValue(champion, ["english_name", "englishName", "English name"]) || "").trim();
  const searchKey = normalizeChampionLookupKey(`${displayName} ${technicalName} ${englishName} ${champion?.id || ""}`);

  return {
    id: String(champion?.id || ""),
    champion,
    displayName,
    technicalName,
    searchKey,
    localImageUrl: getChampionLocalImageUrl(champion),
    remoteImageUrl: getChampionRemoteImageUrl(champion),
  };
}

function HeroPortrait({ option, className = "" }) {
  const { language } = usePortalLanguage();
  const [src, setSrc] = useState(option?.localImageUrl || option?.remoteImageUrl || "");

  useEffect(() => {
    setSrc(option?.localImageUrl || option?.remoteImageUrl || "");
  }, [option?.localImageUrl, option?.remoteImageUrl]);

  if (!option) return null;

  return src ? (
    <img
      src={src}
      alt={option.displayName}
      draggable={false}
      className={`rounded-full border border-yellow-400/70 bg-zinc-950 object-cover ${className}`}
      onError={() => {
        if (src !== option.remoteImageUrl && option.remoteImageUrl) {
          setSrc(option.remoteImageUrl);
          return;
        }
        setSrc("");
      }}
    />
  ) : (
    <span
      className={`inline-flex items-center justify-center rounded-full border border-yellow-400/70 bg-cyan-950 text-xs font-black text-cyan-100 ${className}`}
    >
      {getChampionInitials(option.champion, language)}
    </span>
  );
}

export default function GuildBossPlacementTab({ session }) {
  const { language, t } = usePortalLanguage();
  const [selectedMapId, setSelectedMapId] = useState(GUILD_BOSS_MAPS[0].id);
  const selectedMap = getGuildBossMapConfig(selectedMapId);
  const isLeader = isLeaderSession(session);
  const [drafts, setDrafts] = useState(() => {
    if (typeof window === "undefined") return normalizeGuildBossDrafts({});
    try {
      return normalizeGuildBossDrafts(JSON.parse(window.localStorage.getItem(GUILD_BOSS_PLACEMENT_STORAGE_KEY) || "{}"));
    } catch {
      return normalizeGuildBossDrafts({});
    }
  });
  const [history, setHistory] = useState([]);
  const [champions, setChampions] = useState([]);
  const [championsLoading, setChampionsLoading] = useState(false);
  const [heroQuery, setHeroQuery] = useState("");
  const [selectedHeroId, setSelectedHeroId] = useState("");
  const [selectedCellKey, setSelectedCellKey] = useState("");
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [showCalibration, setShowCalibration] = useState(false);
  const [selectedCalibrationPointKey, setSelectedCalibrationPointKey] = useState("");
  const [calibrationHistory, setCalibrationHistory] = useState([]);
  const [calibrationPointsByMap, setCalibrationPointsByMap] = useState(() => {
    if (typeof window === "undefined") return {};
    try {
      const parsed = JSON.parse(window.localStorage.getItem(GUILD_BOSS_CALIBRATION_STORAGE_KEY) || "{}");
      return Object.fromEntries(
        GUILD_BOSS_MAPS.map((map) => [map.id, normalizeGuildBossCellPoints(map, parsed[map.id]?.points || parsed[map.id] || [])]),
      );
    } catch {
      return {};
    }
  });
  const dragPayloadRef = useRef(null);

  const displayMap = selectedMap;
  const placements = drafts[selectedMap.id] || {};
  const isPointCalibrationMap = GUILD_BOSS_POINT_CALIBRATION_MAP_IDS.has(selectedMap.id);
  const isPointCalibrationActive = isLeader && showCalibration && isPointCalibrationMap;
  const activeCalibrationPoints = useMemo(
    () => normalizeGuildBossCellPoints(selectedMap, calibrationPointsByMap[selectedMap.id] || []),
    [calibrationPointsByMap, selectedMap],
  );
  const calibrationProgress = useMemo(
    () => getGuildBossCalibrationProgress(selectedMap, activeCalibrationPoints),
    [activeCalibrationPoints, selectedMap],
  );
  const cellGeometry = useMemo(
    () => resolveGuildBossCellGeometry(displayMap, activeCalibrationPoints),
    [activeCalibrationPoints, displayMap],
  );
  const activeCalibrationPointByKey = useMemo(
    () => new Map(activeCalibrationPoints.map((point) => [getCalibrationPointKey(point), point])),
    [activeCalibrationPoints],
  );
  const calibrationCells = useMemo(() => getGridRows(displayMap).flat(), [displayMap]);
  const canUndoCalibration = calibrationHistory.some((entry) => entry.mapId === selectedMap.id);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(GUILD_BOSS_PLACEMENT_STORAGE_KEY, JSON.stringify(drafts));
  }, [drafts]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(GUILD_BOSS_CALIBRATION_STORAGE_KEY, JSON.stringify(calibrationPointsByMap));
  }, [calibrationPointsByMap]);

  useEffect(() => {
    let cancelled = false;

    async function loadChampions() {
      setChampionsLoading(true);
      setErrorMessage("");

      try {
        const nextChampions = await fetchPortalChampions();
        if (!cancelled) setChampions(nextChampions);
      } catch (error) {
        if (!cancelled) setErrorMessage(error?.message || t("pvePlacement.heroLoadError", "Chargement des heros impossible."));
      } finally {
        if (!cancelled) setChampionsLoading(false);
      }
    }

    void loadChampions();

    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    setSelectedCellKey("");
    setSelectedCalibrationPointKey("");
  }, [selectedMapId]);

  useEffect(() => {
    if (!isLeader) setShowCalibration(false);
  }, [isLeader]);

  useEffect(() => {
    if (!isPointCalibrationActive) return;
    setSelectedHeroId("");
    setSelectedCellKey("");
  }, [isPointCalibrationActive]);

  const heroOptions = useMemo(
    () =>
      champions
        .map((champion) => buildHeroOption(champion, language))
        .filter((option) => option.id && option.displayName)
        .sort((left, right) => left.displayName.localeCompare(right.displayName, "fr", { sensitivity: "base" })),
    [champions, language],
  );

  const championById = useMemo(
    () => new Map(heroOptions.map((option) => [String(option.id), option.champion])),
    [heroOptions],
  );

  const heroOptionById = useMemo(
    () => new Map(heroOptions.map((option) => [String(option.id), option])),
    [heroOptions],
  );

  const selectedHero = heroOptionById.get(String(selectedHeroId)) || null;
  const selectedPlacement = selectedCellKey ? placements[selectedCellKey] || null : null;
  const selectedPlacementHero = selectedPlacement ? heroOptionById.get(String(selectedPlacement.championId)) || null : null;

  const filteredHeroOptions = useMemo(() => {
    const query = normalizeChampionLookupKey(heroQuery);
    if (!query) return heroOptions.slice(0, HERO_LIST_LIMIT);
    return heroOptions.filter((option) => option.searchKey.includes(query)).slice(0, HERO_LIST_LIMIT);
  }, [heroOptions, heroQuery]);

  function commitPlacements(updater) {
    setDrafts((previous) => {
      const current = previous[selectedMap.id] || {};
      const nextPlacements = typeof updater === "function" ? updater(current) : updater;
      setHistory((previousHistory) => [
        ...previousHistory.slice(-24),
        {
          mapId: selectedMap.id,
          placements: current,
        },
      ]);
      return {
        ...previous,
        [selectedMap.id]: nextPlacements,
      };
    });
  }

  function handleCellClick(cellKey) {
    if (isPointCalibrationActive) return;
    if (!isGuildBossCellPlayable(displayMap, cellKey)) return;
    const placement = placements[cellKey];

    if (selectedHeroId) {
      commitPlacements((current) =>
        placeGuildBossHero(current, {
          cellKey,
          championId: selectedHeroId,
          direction: placement?.direction || "E",
          map: displayMap,
        }),
      );
      setSelectedCellKey(cellKey);
      setMessage("");
      return;
    }

    setSelectedCellKey(placement ? cellKey : "");
  }

  function handleDrop(event, cellKey) {
    event.preventDefault();
    if (isPointCalibrationActive) return;
    if (!isGuildBossCellPlayable(displayMap, cellKey)) return;
    const rawPayload = event.dataTransfer.getData("application/json");
    const payload = rawPayload ? JSON.parse(rawPayload) : dragPayloadRef.current;

    if (!payload) return;

    if (payload.type === "hero") {
      commitPlacements((current) =>
        placeGuildBossHero(current, {
          cellKey,
          championId: payload.championId,
          direction: "E",
          map: displayMap,
        }),
      );
      setSelectedCellKey(cellKey);
      setSelectedHeroId("");
      return;
    }

    if (payload.type === "placement") {
      commitPlacements((current) => moveGuildBossHero(current, { fromCellKey: payload.cellKey, toCellKey: cellKey, map: displayMap }));
      setSelectedCellKey(cellKey);
    }
  }

  function undoLastChange() {
    const last = [...history].reverse().find((entry) => entry.mapId === selectedMap.id);
    if (!last) return;

    setDrafts((previous) => ({ ...previous, [selectedMap.id]: last.placements }));
    setHistory((previousHistory) => {
      const index = previousHistory.lastIndexOf(last);
      return index >= 0 ? previousHistory.filter((_, itemIndex) => itemIndex !== index) : previousHistory;
    });
  }

  function clearMap() {
    if (
      Object.keys(placements).length &&
      typeof window !== "undefined" &&
      !window.confirm(t("pvePlacement.clearConfirm", "Vider le placement de cette carte ?"))
    ) {
      return;
    }

    commitPlacements({});
    setSelectedCellKey("");
    setMessage(t("pvePlacement.cleared", "Placement vide."));
  }

  function removeSelectedPlacement() {
    if (isPointCalibrationActive) return;
    if (!selectedCellKey) return;
    commitPlacements((current) => removeGuildBossHero(current, selectedCellKey));
    setSelectedCellKey("");
  }

  function rotateSelectedPlacement(direction) {
    if (isPointCalibrationActive) return;
    if (!selectedCellKey) return;
    commitPlacements((current) => rotateGuildBossHero(current, selectedCellKey, direction));
  }

  async function createExportBlob() {
    return renderPlacementBlob({
      map: displayMap,
      placements,
      championById,
      includeGrid: false,
      language,
      calibratedPoints: activeCalibrationPoints,
    });
  }

  async function copyExport() {
    setExporting(true);
    setErrorMessage("");

    try {
      const blob = await createExportBlob();
      if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setMessage(t("pvePlacement.copied", "Image copiee dans le presse-papier."));
      } else {
        downloadBlob(blob, `${MAP_EXPORT_FILE_PREFIX}-${selectedMap.id}.png`);
        setMessage(t("pvePlacement.clipboardFallback", "Presse-papier indisponible, image telechargee."));
      }
    } catch (error) {
      setErrorMessage(error?.message || t("pvePlacement.copyError", "Impossible de copier l'image."));
    } finally {
      setExporting(false);
    }
  }

  async function downloadExport() {
    setExporting(true);
    setErrorMessage("");

    try {
      const blob = await createExportBlob();
      downloadBlob(blob, `${MAP_EXPORT_FILE_PREFIX}-${selectedMap.id}.png`);
      setMessage(t("pvePlacement.downloaded", "Image telechargee."));
    } catch (error) {
      setErrorMessage(error?.message || t("pvePlacement.downloadError", "Impossible de telecharger l'image."));
    } finally {
      setExporting(false);
    }
  }

  function commitCalibrationPoints(updater) {
    if (!isLeader || !isPointCalibrationMap) return;
    setCalibrationPointsByMap((previous) => {
      const current = normalizeGuildBossCellPoints(selectedMap, previous[selectedMap.id] || []);
      const next = normalizeGuildBossCellPoints(selectedMap, typeof updater === "function" ? updater(current) : updater);

      setCalibrationHistory((previousHistory) => [
        ...previousHistory.slice(-24),
        {
          mapId: selectedMap.id,
          points: current,
        },
      ]);

      return {
        ...previous,
        [selectedMap.id]: next,
      };
    });
  }

  function upsertCalibrationPoint(point) {
    commitCalibrationPoints((current) => [
      ...current.filter((item) => item.row !== point.row || item.col !== point.col),
      point,
    ]);
  }

  function handleCalibrationMapClick(event) {
    if (!isPointCalibrationActive) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;

    const replacementPoint = selectedCalibrationPointKey ? parseCalibrationPointKey(selectedCalibrationPointKey) : null;
    const targetPoint = replacementPoint?.row && replacementPoint?.col ? replacementPoint : calibrationProgress.nextPoint;
    if (!targetPoint) {
      setMessage(t("pvePlacement.calibrationComplete", "Calibration Matrice complete. Selectionne un point pour le deplacer."));
      return;
    }

    const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    const point = {
      row: targetPoint.row,
      col: targetPoint.col,
      x: Number(x.toFixed(6)),
      y: Number(y.toFixed(6)),
    };

    upsertCalibrationPoint(point);
    setSelectedCalibrationPointKey("");
    setMessage(`${getGuildBossPointLabel(point)} ${t("pvePlacement.calibrationPointSaved", "enregistre.")}`);
  }

  function selectCalibrationPoint(point) {
    if (!isLeader || !isPointCalibrationMap) return;
    setSelectedCalibrationPointKey(getCalibrationPointKey(point));
    setMessage(`${getGuildBossPointLabel(point)} ${t("pvePlacement.calibrationMoveHelp", "selectionne. Clique sur la carte pour le deplacer.")}`);
  }

  function undoLastCalibrationChange() {
    if (!isLeader || !isPointCalibrationMap) return;
    const last = [...calibrationHistory].reverse().find((entry) => entry.mapId === selectedMap.id);
    if (!last) return;

    setCalibrationPointsByMap((previous) => ({ ...previous, [selectedMap.id]: last.points }));
    setCalibrationHistory((previousHistory) => {
      const index = previousHistory.lastIndexOf(last);
      return index >= 0 ? previousHistory.filter((_, itemIndex) => itemIndex !== index) : previousHistory;
    });
    setSelectedCalibrationPointKey("");
    setMessage(t("pvePlacement.calibrationUndo", "Derniere action de calibration annulee."));
  }

  function resetSelectedCalibrationPoint() {
    if (!isLeader || !isPointCalibrationMap || !selectedCalibrationPointKey) return;
    const selectedPoint = parseCalibrationPointKey(selectedCalibrationPointKey);

    commitCalibrationPoints((current) => current.filter((point) => point.row !== selectedPoint.row || point.col !== selectedPoint.col));
    setSelectedCalibrationPointKey("");
    setMessage(`${getGuildBossPointLabel(selectedPoint)} ${t("pvePlacement.calibrationPointReset", "a recommencer.")}`);
  }

  function removeLastCalibrationPoint() {
    if (!isLeader || !isPointCalibrationMap || !activeCalibrationPoints.length) return;
    const lastPoint = activeCalibrationPoints[activeCalibrationPoints.length - 1];

    commitCalibrationPoints((current) => current.filter((point) => point.row !== lastPoint.row || point.col !== lastPoint.col));
    if (selectedCalibrationPointKey === getCalibrationPointKey(lastPoint)) setSelectedCalibrationPointKey("");
    setMessage(`${getGuildBossPointLabel(lastPoint)} ${t("pvePlacement.calibrationPointRemoved", "supprime.")}`);
  }

  function resetAllCalibrationPoints() {
    if (!isLeader || !isPointCalibrationMap) return;
    if (
      activeCalibrationPoints.length &&
      typeof window !== "undefined" &&
      !window.confirm(t("pvePlacement.resetPointCalibrationConfirm", "Recommencer les 35 points de Matrice ?"))
    ) {
      return;
    }

    commitCalibrationPoints([]);
    setSelectedCalibrationPointKey("");
    setSelectedHeroId("");
    setSelectedCellKey("");
    setMessage(t("pvePlacement.pointCalibrationReset", "Calibration Matrice vide."));
  }

  async function copyCalibrationPoints() {
    if (!isLeader || !isPointCalibrationMap) return;
    if (!calibrationProgress.complete) {
      setErrorMessage(t("pvePlacement.calibrationIncomplete", "Pose les 35 points avant de copier le JSON final."));
      return;
    }

    const payload = JSON.stringify(
      activeCalibrationPoints.map((point) => ({
        row: point.row - 1,
        col: point.col - 1,
        x: point.x,
        y: point.y,
      })),
      null,
      2,
    );

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
        setMessage(t("pvePlacement.calibrationCopied", "JSON de calibration copie."));
      } else {
        setMessage(payload);
      }
    } catch {
      setMessage(payload);
    }
  }

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 shadow-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.28em] text-emerald-300">
              {t("pvePlacement.eyebrow", "Outil PVE")}
            </div>
            <h2 className="mt-2 text-2xl font-black text-white">{t("pvePlacement.title", "Placement BDG")}</h2>
            <p className="mt-1 max-w-3xl text-sm text-zinc-400">
              {t(
                "pvePlacement.description",
                "Prepare un placement sur une carte de Boss de guilde, puis copie ou telecharge l'image pour Discord.",
              )}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {isLeader ? (
              <Button
                type="button"
                variant="outline"
                className={`border-yellow-700/70 ${
                  showCalibration ? "bg-yellow-400/15 text-yellow-100" : "bg-zinc-900 text-zinc-100"
                }`}
                onClick={() => setShowCalibration((value) => !value)}
              >
                <SlidersHorizontal className="mr-2 h-4 w-4" />
                {t("pvePlacement.calibration", "Calibration")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="border-zinc-700 bg-zinc-900 text-zinc-100"
              disabled={isPointCalibrationActive ? !canUndoCalibration : !history.some((entry) => entry.mapId === selectedMap.id)}
              onClick={isPointCalibrationActive ? undoLastCalibrationChange : undoLastChange}
            >
              <Undo2 className="mr-2 h-4 w-4" />
              {t("pvePlacement.undo", "Annuler")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-red-800/70 bg-red-950/30 text-red-100"
              disabled={isPointCalibrationActive}
              onClick={clearMap}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t("pvePlacement.clear", "Vider")}
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {GUILD_BOSS_MAPS.map((map) => {
            const selected = selectedMap.id === map.id;
            return (
              <button
                key={map.id}
                type="button"
                onClick={() => setSelectedMapId(map.id)}
                className={`rounded-xl border p-3 text-left transition ${
                  selected
                    ? "border-cyan-300/70 bg-cyan-400/10 text-cyan-50"
                    : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-600"
                }`}
              >
                <div className="font-black">{t(map.labelKey, map.fallbackLabel)}</div>
                <div className="mt-1 text-xs text-zinc-500">{Object.keys(drafts[map.id] || {}).length} {t("pvePlacement.placed", "places")}</div>
              </button>
            );
          })}
        </div>
      </div>

      {message ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200">
          {message}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200">
          {errorMessage}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-lg font-black text-white">{t(displayMap.labelKey, displayMap.fallbackLabel)}</h3>
              <p className="text-xs text-zinc-500">
                {isPointCalibrationActive ? (
                  <>
                    {displayMap.columns} {t("pvePlacement.columns", "colonnes")} x {displayMap.rows}{" "}
                    {t("pvePlacement.rows", "lignes")} - {activeCalibrationPoints.length}/{displayMap.columns * displayMap.rows}{" "}
                    {t("pvePlacement.calibratedPoints", "points calibres")}
                  </>
                ) : (
                  <>{Object.keys(placements).length} {t("pvePlacement.placed", "places")}</>
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="border-cyan-800/70 bg-cyan-950/30 text-cyan-100"
                disabled={exporting}
                onClick={copyExport}
              >
                <Clipboard className="mr-2 h-4 w-4" />
                {t("pvePlacement.copy", "Copier")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border-zinc-700 bg-zinc-900 text-zinc-100"
                disabled={exporting}
                onClick={downloadExport}
              >
                <Download className="mr-2 h-4 w-4" />
                {t("pvePlacement.download", "PNG")}
              </Button>
            </div>
          </div>

          {isLeader && showCalibration ? (
            <div className="mb-3 rounded-xl border border-yellow-500/35 bg-yellow-500/10 p-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.22em] text-yellow-200">
                    {t("pvePlacement.calibrationTitle", "Calibration leader")}
                  </div>
                  <p className="mt-1 text-xs text-yellow-100/75">
                    {isPointCalibrationMap
                      ? selectedCalibrationPointKey
                        ? `${getGuildBossPointLabel(parseCalibrationPointKey(selectedCalibrationPointKey))} ${t(
                            "pvePlacement.calibrationMoveHelp",
                            "selectionne. Clique sur la carte pour le deplacer.",
                          )}`
                        : calibrationProgress.nextPoint
                          ? `${t("pvePlacement.nextCalibrationPoint", "Prochain point")} : ${getGuildBossPointLabel(
                              calibrationProgress.nextPoint,
                            )} - ${calibrationProgress.count}/${calibrationProgress.total}`
                          : `${t("pvePlacement.calibrationComplete", "Calibration Matrice complete. Selectionne un point pour le deplacer.")} ${calibrationProgress.count}/${calibrationProgress.total}`
                      : t("pvePlacement.calibrationMatrixOnly", "Calibration par points disponible uniquement pour Matrice pour le moment.")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {isPointCalibrationMap ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        className="border-zinc-700 bg-zinc-950 text-zinc-100"
                        disabled={!canUndoCalibration}
                        onClick={undoLastCalibrationChange}
                      >
                        <Undo2 className="mr-2 h-4 w-4" />
                        {t("pvePlacement.undoCalibration", "Annuler action")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="border-zinc-700 bg-zinc-950 text-zinc-100"
                        disabled={!activeCalibrationPoints.length}
                        onClick={removeLastCalibrationPoint}
                      >
                        {t("pvePlacement.removeLastPoint", "Supprimer dernier point")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="border-yellow-700 bg-zinc-950 text-yellow-100"
                        disabled={!calibrationProgress.complete}
                        onClick={copyCalibrationPoints}
                      >
                        <Clipboard className="mr-2 h-4 w-4" />
                        {t("pvePlacement.copyCalibrationJson", "Copier JSON")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="border-zinc-700 bg-zinc-950 text-zinc-100"
                        disabled={!selectedCalibrationPointKey}
                        onClick={resetSelectedCalibrationPoint}
                      >
                        {t("pvePlacement.resetPoint", "Recommencer ce point")}
                      </Button>
                      <Button type="button" variant="outline" className="border-red-800 bg-red-950/40 text-red-100" onClick={resetAllCalibrationPoints}>
                        {t("pvePlacement.resetAllPoints", "Reinitialiser la calibration")}
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>

              {isPointCalibrationMap ? (
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-yellow-100/80">
                  <Badge className="border border-yellow-500/40 bg-black/35 text-yellow-100">
                    {calibrationProgress.count}/{calibrationProgress.total}
                  </Badge>
                  <Badge className="border border-zinc-700 bg-black/35 text-zinc-200">
                    {cellGeometry.usesCalibratedPoints
                      ? t("pvePlacement.usesPointCalibration", "Placement par points actif")
                      : t("pvePlacement.usesGridFallback", "Fallback gridBounds tant que les 35 points ne sont pas poses")}
                  </Badge>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-black" style={{ aspectRatio: "1672 / 941" }}>
            <img src={displayMap.imageUrl} alt={t(displayMap.labelKey, displayMap.fallbackLabel)} className="h-full w-full object-cover" />
            {!isPointCalibrationActive ? (
              <div className="absolute inset-0">
                {getGridRows(displayMap)
                  .flat()
                  .filter(({ cellKey }) => isGuildBossCellPlayable(displayMap, cellKey))
                  .map(({ cellKey, columnIndex, rowIndex }) => {
                    const placement = placements[cellKey];
                    const option = placement ? heroOptionById.get(String(placement.championId)) : null;
                    const selectedCell = selectedCellKey === cellKey;
                    const geometry = getGuildBossCellGeometry(displayMap, activeCalibrationPoints, columnIndex, rowIndex);

                    return (
                      <button
                        key={cellKey}
                        type="button"
                        aria-pressed={selectedCell}
                        className={`group absolute min-h-0 border border-transparent bg-transparent text-[10px] font-black ${
                          selectedHeroId ? "cursor-copy" : "cursor-pointer"
                        }`}
                        style={{
                          left: `${geometry.centerX * 100}%`,
                          top: `${geometry.centerY * 100}%`,
                          width: `${geometry.cellWidth * 100}%`,
                          height: `${geometry.cellHeight * 100}%`,
                          transform: "translate(-50%, -50%)",
                        }}
                        onClick={() => handleCellClick(cellKey)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => handleDrop(event, cellKey)}
                      >
                        {option ? (
                          <span
                            draggable
                            onDragStart={(event) => {
                              const payload = { type: "placement", cellKey };
                              dragPayloadRef.current = payload;
                              event.dataTransfer.setData("application/json", JSON.stringify(payload));
                            }}
                            className="absolute inset-0 flex items-center justify-center"
                          >
                            <span className="relative block h-[72%] max-h-20 min-h-8 aspect-square">
                              <HeroPortrait option={option} className="h-full w-full" />
                              <HeroDirectionOverlay direction={placement.direction} />
                            </span>
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
              </div>
            ) : null}

            {isPointCalibrationActive ? (
              <div className="absolute inset-0 z-40 cursor-crosshair" onClick={handleCalibrationMapClick}>
                {activeCalibrationPoints.map((point) => {
                  const pointKey = getCalibrationPointKey(point);
                  const selected = selectedCalibrationPointKey === pointKey;
                  return (
                    <button
                      key={pointKey}
                      type="button"
                      aria-label={getGuildBossPointLabel(point)}
                      title={getGuildBossPointLabel(point)}
                      className={`absolute h-3 w-3 rounded-full border shadow-lg transition ${
                        selected
                          ? "border-white bg-yellow-300 ring-4 ring-black/70"
                          : "border-yellow-100 bg-yellow-300/80 hover:scale-125 hover:bg-yellow-200"
                      }`}
                      style={{
                        left: `${point.x * 100}%`,
                        top: `${point.y * 100}%`,
                        transform: "translate(-50%, -50%)",
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        selectCalibrationPoint(point);
                      }}
                    />
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        <aside className="space-y-4">
          {isPointCalibrationActive ? (
            <div className="rounded-2xl border border-yellow-500/35 bg-zinc-950/70 p-4">
              <div>
                <h3 className="font-black text-white">{t("pvePlacement.calibrationPoints", "Points Matrice")}</h3>
                <p className="mt-1 text-xs text-zinc-500">
                  {t("pvePlacement.calibrationPointsHelp", "Selectionne un point place, puis clique la map pour le deplacer.")}
                </p>
              </div>

              <div className="mt-3 grid max-h-[620px] grid-cols-2 gap-2 overflow-y-auto pr-1">
                {calibrationCells.map(({ columnIndex, rowIndex }) => {
                  const pointTarget = { row: rowIndex + 1, col: columnIndex + 1 };
                  const pointKey = getCalibrationPointKey(pointTarget);
                  const point = activeCalibrationPointByKey.get(pointKey);
                  const selected = selectedCalibrationPointKey === pointKey;

                  return (
                    <button
                      key={pointKey}
                      type="button"
                      disabled={!point}
                      onClick={() => point && selectCalibrationPoint(point)}
                      className={`rounded-xl border p-2 text-left transition ${
                        selected
                          ? "border-yellow-300 bg-yellow-300/15 text-yellow-50"
                          : point
                            ? "border-zinc-700 bg-zinc-900/80 text-zinc-200 hover:border-yellow-500/70"
                            : "cursor-default border-zinc-900 bg-black/35 text-zinc-600"
                      }`}
                    >
                      <span className="block text-sm font-black">{getGuildBossPointLabel(pointTarget)}</span>
                      <span className="mt-0.5 block text-[11px] font-semibold">
                        {point
                          ? `${point.x.toFixed(4)}, ${point.y.toFixed(4)}`
                          : t("pvePlacement.pointMissing", "A placer")}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-black text-white">{t("pvePlacement.heroPicker", "Heros")}</h3>
                    <p className="text-xs text-zinc-500">
                      {selectedHero
                        ? t("pvePlacement.selectedHeroHelp", "Clique une case pour placer le heros.")
                        : t("pvePlacement.heroPickerHelp", "Selectionne un heros, puis clique une case.")}
                    </p>
                  </div>
                  {selectedHero ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-zinc-700 bg-zinc-900 text-zinc-200"
                      onClick={() => setSelectedHeroId("")}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>

                <label className="mt-3 flex items-center gap-2 rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-300">
                  <Search className="h-4 w-4 text-zinc-500" />
                  <input
                    value={heroQuery}
                    onChange={(event) => setHeroQuery(event.target.value)}
                    placeholder={t("pvePlacement.heroSearch", "Chercher un heros...")}
                    className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-zinc-600"
                  />
                </label>

                <div className="mt-3 max-h-[440px] space-y-2 overflow-y-auto pr-1">
                  {championsLoading ? (
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-4 text-sm text-zinc-400">
                      {t("common.loading", "Chargement...")}
                    </div>
                  ) : null}
                  {filteredHeroOptions.map((option) => {
                    const selected = selectedHeroId === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        draggable
                        onClick={() => setSelectedHeroId(selected ? "" : option.id)}
                        onDragStart={(event) => {
                          const payload = { type: "hero", championId: option.id };
                          dragPayloadRef.current = payload;
                          event.dataTransfer.setData("application/json", JSON.stringify(payload));
                        }}
                        className={`flex w-full items-center gap-3 rounded-xl border p-2 text-left transition ${
                          selected
                            ? "border-yellow-300/70 bg-yellow-300/10 text-yellow-50"
                            : "border-zinc-800 bg-zinc-900/70 text-zinc-200 hover:border-zinc-600"
                        }`}
                      >
                        <HeroPortrait option={option} className="h-10 w-10" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold">{option.displayName}</span>
                          {option.technicalName && option.technicalName !== option.displayName ? (
                            <span className="block truncate text-xs text-zinc-500">{option.technicalName}</span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                  {!championsLoading && !filteredHeroOptions.length ? (
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-4 text-sm text-zinc-400">
                      {t("pvePlacement.noHero", "Aucun heros trouve.")}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                <h3 className="font-black text-white">{t("pvePlacement.selection", "Selection")}</h3>
                {selectedPlacement && selectedPlacementHero ? (
                  <div className="mt-3 space-y-3">
                    <div className="flex items-center gap-3">
                      <HeroPortrait option={selectedPlacementHero} className="h-12 w-12" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-black text-white">{selectedPlacementHero.displayName}</div>
                        <div className="text-xs text-zinc-500">
                          {getGuildBossCellLabel(selectedCellKey)} - {t("pvePlacement.direction", "Direction")}{" "}
                          {GUILD_BOSS_DIRECTIONS.find((item) => item.value === selectedPlacement.direction)?.fallback || "E"}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2">
                      {GUILD_BOSS_DIRECTIONS.map((direction) => (
                        <button
                          key={direction.value}
                          type="button"
                          onClick={() => rotateSelectedPlacement(direction.value)}
                          className={`rounded-xl border px-3 py-2 text-sm font-black transition ${
                            selectedPlacement.direction === direction.value
                              ? "border-yellow-300 bg-yellow-300/15 text-yellow-100"
                              : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600"
                          }`}
                        >
                          {t(direction.labelKey, direction.fallback)}
                        </button>
                      ))}
                    </div>

                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1 border-zinc-700 bg-zinc-900 text-zinc-100"
                        onClick={() => rotateSelectedPlacement()}
                      >
                        <RotateCw className="mr-2 h-4 w-4" />
                        {t("pvePlacement.rotate", "Tourner")}
                      </Button>
                      <Button type="button" variant="outline" className="border-red-800 bg-red-950/40 text-red-100" onClick={removeSelectedPlacement}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-zinc-800 bg-black/40 p-4 text-sm text-zinc-400">
                    {t("pvePlacement.noSelection", "Clique un heros place pour regler son sens ou le retirer.")}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge className="border border-cyan-500/30 bg-cyan-500/10 text-cyan-100">
                    {Object.keys(placements).length} {t("pvePlacement.placed", "places")}
                  </Badge>
                  <Badge className="border border-zinc-700 bg-zinc-900 text-zinc-300">
                    {t("pvePlacement.localDraft", "Brouillon local")}
                  </Badge>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
