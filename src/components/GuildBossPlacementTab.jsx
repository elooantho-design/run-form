import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Clipboard,
  Download,
  Eye,
  EyeOff,
  RotateCw,
  Search,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getChampionDisplayName, getChampionFieldValue, normalizeChampionLookupKey } from "@/lib/championDisplay";
import { fetchPortalChampions } from "@/lib/portalChampions";
import { usePortalLanguage } from "@/lib/portalLanguage";
import { buildPublicHeroUrl } from "@/lib/vpsAssets";
import {
  GUILD_BOSS_DIRECTIONS,
  GUILD_BOSS_MAPS,
  GUILD_BOSS_PLACEMENT_STORAGE_KEY,
  getGuildBossCellLabel,
  getGuildBossMapConfig,
  makeGuildBossCellKey,
  moveGuildBossHero,
  normalizeGuildBossDirection,
  normalizeGuildBossDrafts,
  parseGuildBossCellKey,
  placeGuildBossHero,
  removeGuildBossHero,
  rotateGuildBossHero,
} from "@/lib/guildBossPlacement";

const MAP_EXPORT_FILE_PREFIX = "placement-bdg";
const HERO_LIST_LIMIT = 120;
const CALIBRATION_STEP = 0.001;

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

function normalizeGridBounds(bounds, fallback) {
  const base = fallback || { x: 0, y: 0, width: 1, height: 1 };
  const next = {
    x: Number.isFinite(Number(bounds?.x)) ? Number(bounds.x) : base.x,
    y: Number.isFinite(Number(bounds?.y)) ? Number(bounds.y) : base.y,
    width: Number.isFinite(Number(bounds?.width)) ? Number(bounds.width) : base.width,
    height: Number.isFinite(Number(bounds?.height)) ? Number(bounds.height) : base.height,
  };

  next.x = Math.min(0.99, Math.max(0, next.x));
  next.y = Math.min(0.99, Math.max(0, next.y));
  next.width = Math.min(1 - next.x, Math.max(0.01, next.width));
  next.height = Math.min(1 - next.y, Math.max(0.01, next.height));

  return next;
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

function getArrowRotation(direction) {
  switch (normalizeGuildBossDirection(direction)) {
    case "N":
      return "rotate(270deg)";
    case "S":
      return "rotate(90deg)";
    case "W":
      return "rotate(180deg)";
    case "E":
    default:
      return "rotate(0deg)";
  }
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

function drawDirectionArrow(ctx, { x, y, radius, direction }) {
  const normalized = normalizeGuildBossDirection(direction);
  const tipDistance = radius * 1.05;
  const baseDistance = radius * 0.62;
  const halfWidth = radius * 0.24;
  const vector = {
    N: { x: 0, y: -1 },
    E: { x: 1, y: 0 },
    S: { x: 0, y: 1 },
    W: { x: -1, y: 0 },
  }[normalized];
  const perp = { x: -vector.y, y: vector.x };
  const tip = { x: x + vector.x * tipDistance, y: y + vector.y * tipDistance };
  const base = { x: x + vector.x * baseDistance, y: y + vector.y * baseDistance };

  ctx.save();
  ctx.fillStyle = "#facc15";
  ctx.strokeStyle = "rgba(15, 23, 42, 0.9)";
  ctx.lineWidth = Math.max(2, radius * 0.055);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(base.x + perp.x * halfWidth, base.y + perp.y * halfWidth);
  ctx.lineTo(base.x - perp.x * halfWidth, base.y - perp.y * halfWidth);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

async function renderPlacementBlob({ map, placements, championById, includeGrid, language }) {
  const mapImage = await loadImage(map.imageUrl);
  const width = mapImage.naturalWidth || mapImage.width;
  const height = mapImage.naturalHeight || mapImage.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable.");

  ctx.drawImage(mapImage, 0, 0, width, height);

  const bounds = {
    x: map.gridBounds.x * width,
    y: map.gridBounds.y * height,
    width: map.gridBounds.width * width,
    height: map.gridBounds.height * height,
  };
  const cellWidth = bounds.width / map.columns;
  const cellHeight = bounds.height / map.rows;

  if (includeGrid) {
    ctx.save();
    ctx.strokeStyle = "rgba(34, 211, 238, 0.72)";
    ctx.lineWidth = Math.max(2, Math.round(width * 0.0015));
    for (let column = 0; column <= map.columns; column += 1) {
      const x = bounds.x + column * cellWidth;
      ctx.beginPath();
      ctx.moveTo(x, bounds.y);
      ctx.lineTo(x, bounds.y + bounds.height);
      ctx.stroke();
    }
    for (let row = 0; row <= map.rows; row += 1) {
      const y = bounds.y + row * cellHeight;
      ctx.beginPath();
      ctx.moveTo(bounds.x, y);
      ctx.lineTo(bounds.x + bounds.width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  for (const [cellKey, placement] of Object.entries(placements || {})) {
    const { columnIndex, rowIndex } = parseGuildBossCellKey(cellKey);
    const champion = championById.get(String(placement.championId));
    if (!champion) continue;

    const centerX = bounds.x + columnIndex * cellWidth + cellWidth / 2;
    const centerY = bounds.y + rowIndex * cellHeight + cellHeight / 2;
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

    drawDirectionArrow(ctx, {
      x: centerX,
      y: centerY,
      radius,
      direction: placement.direction,
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
  const [showGrid, setShowGrid] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [showCalibration, setShowCalibration] = useState(false);
  const [calibrationBoundsByMap, setCalibrationBoundsByMap] = useState(() =>
    Object.fromEntries(GUILD_BOSS_MAPS.map((map) => [map.id, map.gridBounds])),
  );
  const dragPayloadRef = useRef(null);

  const activeGridBounds = calibrationBoundsByMap[selectedMap.id] || selectedMap.gridBounds;
  const displayMap = useMemo(
    () => ({
      ...selectedMap,
      gridBounds: normalizeGridBounds(activeGridBounds, selectedMap.gridBounds),
    }),
    [activeGridBounds, selectedMap],
  );
  const placements = drafts[selectedMap.id] || {};

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(GUILD_BOSS_PLACEMENT_STORAGE_KEY, JSON.stringify(drafts));
  }, [drafts]);

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
  }, [selectedMapId]);

  useEffect(() => {
    if (!isLeader) setShowCalibration(false);
  }, [isLeader]);

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
    const placement = placements[cellKey];

    if (selectedHeroId) {
      commitPlacements((current) =>
        placeGuildBossHero(current, {
          cellKey,
          championId: selectedHeroId,
          direction: placement?.direction || "E",
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
    const rawPayload = event.dataTransfer.getData("application/json");
    const payload = rawPayload ? JSON.parse(rawPayload) : dragPayloadRef.current;

    if (!payload) return;

    if (payload.type === "hero") {
      commitPlacements((current) =>
        placeGuildBossHero(current, {
          cellKey,
          championId: payload.championId,
          direction: "E",
        }),
      );
      setSelectedCellKey(cellKey);
      setSelectedHeroId("");
      return;
    }

    if (payload.type === "placement") {
      commitPlacements((current) => moveGuildBossHero(current, { fromCellKey: payload.cellKey, toCellKey: cellKey }));
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
    if (!selectedCellKey) return;
    commitPlacements((current) => removeGuildBossHero(current, selectedCellKey));
    setSelectedCellKey("");
  }

  function rotateSelectedPlacement(direction) {
    if (!selectedCellKey) return;
    commitPlacements((current) => rotateGuildBossHero(current, selectedCellKey, direction));
  }

  async function createExportBlob() {
    return renderPlacementBlob({
      map: displayMap,
      placements,
      championById,
      includeGrid: showGrid,
      language,
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

  function updateCalibrationBound(key, rawValue) {
    if (!isLeader) return;
    setCalibrationBoundsByMap((previous) => {
      const current = normalizeGridBounds(previous[selectedMap.id] || selectedMap.gridBounds, selectedMap.gridBounds);
      const next = normalizeGridBounds({ ...current, [key]: Number(rawValue) }, selectedMap.gridBounds);
      return { ...previous, [selectedMap.id]: next };
    });
  }

  function resetCalibrationBounds() {
    if (!isLeader) return;
    setCalibrationBoundsByMap((previous) => ({ ...previous, [selectedMap.id]: selectedMap.gridBounds }));
  }

  async function copyCalibrationBounds() {
    if (!isLeader) return;
    const bounds = normalizeGridBounds(displayMap.gridBounds, selectedMap.gridBounds);
    const payload = `gridBounds: { x: ${bounds.x.toFixed(4)}, y: ${bounds.y.toFixed(4)}, width: ${bounds.width.toFixed(4)}, height: ${bounds.height.toFixed(4)} }`;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
        setMessage(t("pvePlacement.calibrationCopied", "Valeurs gridBounds copiees."));
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
              onClick={() => setShowGrid((value) => !value)}
            >
              {showGrid ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
              {showGrid ? t("pvePlacement.hideGrid", "Masquer grille") : t("pvePlacement.showGrid", "Afficher grille")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-zinc-700 bg-zinc-900 text-zinc-100"
              disabled={!history.some((entry) => entry.mapId === selectedMap.id)}
              onClick={undoLastChange}
            >
              <Undo2 className="mr-2 h-4 w-4" />
              {t("pvePlacement.undo", "Annuler")}
            </Button>
            <Button type="button" variant="outline" className="border-red-800/70 bg-red-950/30 text-red-100" onClick={clearMap}>
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
                <div className="mt-1 text-xs text-zinc-500">
                  {map.columns} x {map.rows} - {map.sourceFile}
                </div>
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
                {displayMap.columns} {t("pvePlacement.columns", "colonnes")} x {displayMap.rows}{" "}
                {t("pvePlacement.rows", "lignes")} - gridBounds {displayMap.gridBounds.x.toFixed(3)},{" "}
                {displayMap.gridBounds.y.toFixed(3)}, {displayMap.gridBounds.width.toFixed(3)},{" "}
                {displayMap.gridBounds.height.toFixed(3)}
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
                    {t(
                      "pvePlacement.calibrationHelp",
                      "Ajuste les valeurs normalisees, puis copie gridBounds pour me les transmettre.",
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" className="border-yellow-700 bg-zinc-950 text-yellow-100" onClick={copyCalibrationBounds}>
                    <Clipboard className="mr-2 h-4 w-4" />
                    {t("pvePlacement.copyBounds", "Copier gridBounds")}
                  </Button>
                  <Button type="button" variant="outline" className="border-zinc-700 bg-zinc-950 text-zinc-100" onClick={resetCalibrationBounds}>
                    {t("pvePlacement.resetBounds", "Reset bounds")}
                  </Button>
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {["x", "y", "width", "height"].map((key) => (
                  <label key={key} className="block">
                    <span className="text-xs font-black uppercase tracking-[0.16em] text-yellow-100">{key}</span>
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step={CALIBRATION_STEP}
                      value={displayMap.gridBounds[key].toFixed(4)}
                      onChange={(event) => updateCalibrationBound(key, event.target.value)}
                      className="mt-1 h-10 w-full rounded-lg border border-yellow-700/60 bg-black px-3 text-sm font-bold text-yellow-50 outline-none focus:border-yellow-300"
                    />
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-black" style={{ aspectRatio: "1672 / 941" }}>
            <img src={displayMap.imageUrl} alt={t(displayMap.labelKey, displayMap.fallbackLabel)} className="h-full w-full object-cover" />
            <div
              className={`absolute ${showCalibration ? "outline outline-2 outline-yellow-300" : ""}`}
              style={{
                left: `${displayMap.gridBounds.x * 100}%`,
                top: `${displayMap.gridBounds.y * 100}%`,
                width: `${displayMap.gridBounds.width * 100}%`,
                height: `${displayMap.gridBounds.height * 100}%`,
              }}
            >
              <div
                className="grid h-full w-full"
                style={{
                  gridTemplateColumns: `repeat(${displayMap.columns}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${displayMap.rows}, minmax(0, 1fr))`,
                }}
              >
                {getGridRows(displayMap)
                  .flat()
                  .map(({ cellKey, columnIndex, rowIndex }) => {
                    const placement = placements[cellKey];
                    const option = placement ? heroOptionById.get(String(placement.championId)) : null;
                    const selectedCell = selectedCellKey === cellKey;

                    return (
                      <button
                        key={cellKey}
                        type="button"
                        className={`group relative min-h-0 border text-[10px] font-black transition ${
                          showGrid || showCalibration ? "border-cyan-300/45 bg-cyan-300/5" : "border-transparent"
                        } ${selectedCell ? "ring-2 ring-yellow-300" : ""} ${
                          selectedHeroId ? "cursor-copy hover:bg-emerald-400/15" : "cursor-pointer hover:bg-cyan-400/10"
                        }`}
                        onClick={() => handleCellClick(cellKey)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => handleDrop(event, cellKey)}
                      >
                        {showGrid || showCalibration ? (
                          <span className="absolute left-1 top-1 rounded bg-black/55 px-1 text-[10px] text-cyan-100">
                            {getGuildBossCellLabel(cellKey)}
                          </span>
                        ) : null}
                        {showCalibration ? (
                          <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-yellow-300/90 px-1 text-[9px] font-black text-zinc-950">
                            C{columnIndex + 1} R{rowIndex + 1}
                          </span>
                        ) : null}
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
                              <span
                                className="absolute -right-1 top-1/2 h-0 w-0 -translate-y-1/2 border-y-[7px] border-l-[12px] border-y-transparent border-l-yellow-300 drop-shadow"
                                style={{ transform: `translateY(-50%) ${getArrowRotation(placement.direction)}` }}
                              />
                            </span>
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>
        </div>

        <aside className="space-y-4">
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
        </aside>
      </div>
    </section>
  );
}
