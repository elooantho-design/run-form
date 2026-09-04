import React, { useMemo, useState } from "react";
import { Ban, CheckCircle2, ClipboardPaste, Download, Library, Pencil, Plus, Search, Shield, ShieldAlert, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import GvgEnemyDefenseBankTab from "@/components/GvgEnemyDefenseBankTab";
import { usePortalLanguage } from "@/lib/portalLanguage";
import { normalizeGuildCodeKey } from "@/lib/guildScope";

function getApiBase() {
  if (typeof window === "undefined") return "";
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return "http://localhost:3001";
  }
  return "";
}

async function callPortalAdminDefenses(payload) {
  const response = await fetch(`${getApiBase()}/api/portal-admin-defenses`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || "Action defense impossible.");
  }
  return data;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function AdminDefensesTab({
  defenses = [],
  libraryDefenses = [],
  activeGuildCode = "",
  manageableGuildCodes = [],
  migrationRequired = false,
  onEdit,
  onDelete,
  onAdd,
  onAddCondition,
  onRemoveCondition,
  onEnsureEditable,
  onImportDefense,
}) {
  const { t } = usePortalLanguage();
  const [typeFilter, setTypeFilter] = useState("all");
const [query, setQuery] = useState("");
const [viewMode, setViewMode] = useState("local");
const showLibrary = viewMode === "library";
const showEnemyBank = viewMode === "enemy";
const [importTargetByDefenseId, setImportTargetByDefenseId] = useState({});
const [importingKey, setImportingKey] = useState("");
const [blocksModalOpen, setBlocksModalOpen] = useState(false);
const [selectedDefenseForBlocks, setSelectedDefenseForBlocks] = useState(null);
const [defenseBlocks, setDefenseBlocks] = useState([]);
const [blocksLoading, setBlocksLoading] = useState(false);
const [newTextBlock, setNewTextBlock] = useState("");
const [infoBlocksByDefenseId, setInfoBlocksByDefenseId] = useState({});
const [blockImageMessage, setBlockImageMessage] = useState("");
const [blockImageUploading, setBlockImageUploading] = useState(false);

const normalizeInfoBlock = (block) => ({
  ...block,
  block_type: block.block_type || block.blockType || "text",
  blockType: block.blockType || block.block_type || "text",
  sort_order: block.sort_order ?? block.sortOrder ?? 9999,
  sortOrder: block.sortOrder ?? block.sort_order ?? 9999,
});

const sortInfoBlocks = (blocks = []) =>
  blocks
    .map(normalizeInfoBlock)
    .sort((a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999));

const cacheDefenseInfoBlocks = (defenseId, blocks) => {
  if (!defenseId) return;

  setInfoBlocksByDefenseId((prev) => ({
    ...prev,
    [String(defenseId)]: sortInfoBlocks(blocks),
  }));
};

const getDefenseInfoBlocks = (defense) =>
  infoBlocksByDefenseId[String(defense.id)] ||
  sortInfoBlocks(defense.infoBlocks || []);

const openDefenseBlocksModal = async (defense) => {
  const editableDefense = onEnsureEditable ? await onEnsureEditable(defense) : defense;
  if (!editableDefense) return;

  setSelectedDefenseForBlocks(editableDefense);
  setBlocksModalOpen(true);
  setBlocksLoading(true);
  setBlockImageMessage("");
  setBlockImageUploading(false);

  try {
    const data = await callPortalAdminDefenses({
      action: "blocks-load",
      guildCode: activeGuildCode,
      defenseId: editableDefense.id,
    });
    const nextBlocks = sortInfoBlocks(data.blocks || []);
    setDefenseBlocks(nextBlocks);
    cacheDefenseInfoBlocks(editableDefense.id, nextBlocks);
  } catch (error) {
    console.error("Erreur chargement blocs defense:", error);
    setDefenseBlocks([]);
  } finally {
    setBlocksLoading(false);
  }
};

  const displayedDefenses = useMemo(() => {
    const sourceRows = showLibrary ? libraryDefenses : defenses;
    const normalizedQuery = query
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    return [...sourceRows]
      .filter((defense) => {
        if (typeFilter === "all") return true;

        return (
          String(defense.type || "")
            .trim()
            .toLowerCase() === typeFilter
        );
      })
      .filter((defense) => {
        if (!normalizedQuery) return true;
        return [
          defense.name,
          defense.type,
          defense.faction,
          defense.guildCode,
          defense.originGuildCode,
          defense.sourceGuildCode,
          ...(defense.slots || []),
        ]
          .join(" ")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), "fr", {
          sensitivity: "base",
        })
      );
  }, [defenses, libraryDefenses, query, showLibrary, typeFilter]);

  const filterButtonClass = (value) =>
    `rounded-xl border px-3 py-1.5 text-sm ${
      typeFilter === value
        ? "border-emerald-600 bg-emerald-950/50 text-emerald-200"
        : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
    }`;

  const formatDefenseTypeLabel = (value) => {
    const normalizedType = String(value || "").trim().toLowerCase();

    if (normalizedType === "tour") return t("defenses.tower", "Tour");
    if (normalizedType === "bastion") return t("defenses.bastion", "Bastion");
    if (normalizedType === "bulle") return t("defenses.bubble", "Bulle");
    return value || "";
  };

  const getSelectedImportTarget = (defense) => {
    const preferredTarget = importTargetByDefenseId[String(defense?.id || "")] || activeGuildCode;
    const allowedTargets = manageableGuildCodes.length ? manageableGuildCodes : [activeGuildCode].filter(Boolean);
    const matchingTarget = allowedTargets.find(
      (guildCode) => normalizeGuildCodeKey(guildCode) === normalizeGuildCodeKey(preferredTarget)
    );
    return matchingTarget || allowedTargets[0] || activeGuildCode;
  };

  const getImportTargetStatus = (defense, targetGuildCode) => {
    const target = (defense?.importTargets || []).find(
      (entry) => normalizeGuildCodeKey(entry.guildCode) === normalizeGuildCodeKey(targetGuildCode)
    );
    return target?.status || defense?.libraryTargetStatus || "available";
  };

  const getImportActionLabel = (status, targetGuildCode) => {
    if (status === "native") return `Deja dans ${targetGuildCode}`;
    if (status === "imported") return `Deja importee dans ${targetGuildCode}`;
    return t("adminDefenses.import", "Importer");
  };

  const importLibraryDefense = async (defense) => {
    const targetGuildCode = getSelectedImportTarget(defense);
    const status = getImportTargetStatus(defense, targetGuildCode);
    if (migrationRequired || status !== "available" || !onImportDefense) return;

    const key = `${defense.id}:${targetGuildCode}`;
    setImportingKey(key);
    try {
      await onImportDefense(defense, targetGuildCode);
    } finally {
      setImportingKey("");
    }
  };

const defenseCardClass = (tier) => {
  const normalizedTier = String(tier || "").trim().toLowerCase();

  if (normalizedTier === "meta_s") {
    return "border-4 border-sky-400 bg-sky-500/35 shadow-[0_0_22px_rgba(56,189,248,0.45)]";
  }

  return "border-4 border-lime-300 bg-lime-500/35 shadow-[0_0_22px_rgba(163,230,53,0.45)]";
};

const moveBlock = async (index, direction) => {
  const next = [...defenseBlocks];
  const targetIndex = direction === "up" ? index - 1 : index + 1;

  if (targetIndex < 0 || targetIndex >= next.length) return;

  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];

  const updated = next.map((block, i) => ({
    ...block,
    sort_order: i + 1,
  }));

  setDefenseBlocks(updated);
  cacheDefenseInfoBlocks(selectedDefenseForBlocks?.id, updated);

  try {
    const data = await callPortalAdminDefenses({
      action: "block-reorder",
      guildCode: activeGuildCode,
      defenseId: selectedDefenseForBlocks?.id,
      blocks: updated.map((block) => ({ id: block.id })),
    });
    const nextBlocks = sortInfoBlocks(data.blocks || updated);
    setDefenseBlocks(nextBlocks);
    cacheDefenseInfoBlocks(selectedDefenseForBlocks?.id, nextBlocks);
  } catch (error) {
    console.error("Erreur tri blocs defense:", error);
  }
};

const deleteBlock = async (block) => {
  const confirmDelete = window.confirm(t("adminDefenses.deleteBlockConfirm", "Supprimer ce bloc ?"));
  if (!confirmDelete) return;

  try {
    const data = await callPortalAdminDefenses({
      action: "block-delete",
      guildCode: activeGuildCode,
      defenseId: selectedDefenseForBlocks?.id,
      blockId: block.id,
    });
    const nextBlocks = sortInfoBlocks(data.blocks || []);
    setDefenseBlocks(nextBlocks);
    cacheDefenseInfoBlocks(selectedDefenseForBlocks?.id, nextBlocks);
  } catch (error) {
    console.error("Erreur suppression bloc:", error);
  }
};

const addTextBlock = async () => {
  if (!selectedDefenseForBlocks?.id) return;

  const cleanText = newTextBlock.trim();
  if (!cleanText) return;

  try {
    const data = await callPortalAdminDefenses({
      action: "block-add-text",
      guildCode: activeGuildCode,
      defenseId: selectedDefenseForBlocks.id,
      content: cleanText,
    });
    const nextBlocks = sortInfoBlocks(data.blocks || []);
    setDefenseBlocks(nextBlocks);
    cacheDefenseInfoBlocks(selectedDefenseForBlocks?.id, nextBlocks);
    setNewTextBlock("");
  } catch (error) {
    console.error("Erreur ajout bloc texte:", error);
  }
};

const compressImageFile = (file, maxWidth = 1400, quality = 0.82) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = () => {
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");

        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("Compression image impossible"));
              return;
            }

            resolve(
              new File([blob], file.name.replace(/\.[^.]+$/, ".webp"), {
                type: "image/webp",
              })
            );
          },
          "image/webp",
          quality
        );
      };

      img.onerror = reject;
      img.src = reader.result;
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const saveImageBlockFromFile = async (file, successMessage) => {
  if (!file || !selectedDefenseForBlocks?.id) return;

  setBlockImageUploading(true);
  setBlockImageMessage(t("adminDefenses.imageUploadInProgress", "Upload de l'image en cours..."));

  try {
    const compressedFile = await compressImageFile(file);
    const dataUrl = await fileToDataUrl(compressedFile);
    const data = await callPortalAdminDefenses({
      action: "block-add-image",
      guildCode: activeGuildCode,
      defenseId: selectedDefenseForBlocks.id,
      fileName: compressedFile.name || file.name || "defense-block.webp",
      dataUrl,
    });

    const nextBlocks = sortInfoBlocks(data.blocks || []);
    setDefenseBlocks(nextBlocks);
    cacheDefenseInfoBlocks(selectedDefenseForBlocks?.id, nextBlocks);
    setBlockImageMessage(successMessage || t("adminDefenses.fileImageAdded", "Image ajoutee."));
    return true;
  } catch (error) {
    console.error("Erreur compression/upload image bloc:", error);
    setBlockImageMessage(t("adminDefenses.imageUploadFailed", "Impossible d'ajouter cette image."));
    return false;
  } finally {
    setBlockImageUploading(false);
  }
};

const addImageBlock = async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";

  await saveImageBlockFromFile(file, t("adminDefenses.fileImageAdded", "Image ajoutee."));
};

const handlePasteImageBlock = async (event) => {
  const clipboardItems = Array.from(event.clipboardData?.items || []);
  const imageItem = clipboardItems.find((item) => item.type?.startsWith("image/"));

  if (!imageItem) {
    setBlockImageMessage(t("adminDefenses.clipboardNoImage", "Aucune image trouvee dans le presse-papier."));
    return;
  }

  event.preventDefault();

  const file = imageItem.getAsFile();
  await saveImageBlockFromFile(
    file,
    t("adminDefenses.clipboardImageAdded", "Image collee depuis le presse-papier.")
  );
};

const pasteImageBlockFromClipboard = async () => {
  if (typeof navigator === "undefined" || !navigator.clipboard?.read) {
    setBlockImageMessage(
      t(
        "adminDefenses.clipboardUnsupported",
        "Lecture directe du presse-papier indisponible. Clique dans la zone de collage puis fais Ctrl+V."
      )
    );
    return;
  }

  try {
    const clipboardItems = await navigator.clipboard.read();

    for (const item of clipboardItems) {
      const imageType = item.types.find((type) => type.startsWith("image/"));
      if (!imageType) continue;

      const blob = await item.getType(imageType);
      const extension = imageType.split("/")[1]?.split("+")[0] || "png";
      const file = new File([blob], `clipboard-defense-${Date.now()}.${extension}`, {
        type: imageType,
      });

      await saveImageBlockFromFile(
        file,
        t("adminDefenses.clipboardImageAdded", "Image collee depuis le presse-papier.")
      );
      return;
    }

    setBlockImageMessage(t("adminDefenses.clipboardNoImage", "Aucune image trouvee dans le presse-papier."));
  } catch (error) {
    console.error("Erreur lecture presse-papier image:", error);
    setBlockImageMessage(
      t(
        "adminDefenses.clipboardUnsupported",
        "Lecture directe du presse-papier indisponible. Clique dans la zone de collage puis fais Ctrl+V."
      )
    );
  }
};

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-white">
            <Shield className="h-5 w-5" />
            {t("adminDefenses.title", "Gestion defense")}
          </h2>
          <p className="text-sm text-zinc-400">
            {t("adminDefenses.description", "Gestion des defenses disponibles dans Mes defenses.")}
          </p>
        </div>

        <button
          type="button"
          onClick={onAdd}
          disabled={showLibrary || showEnemyBank}
          className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-800"
        >
          <Plus className="h-4 w-4" />
          {t("adminDefenses.addDefense", "Ajouter une defense")}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setViewMode("local")}
          className={`rounded-xl border px-3 py-1.5 text-sm ${
            viewMode === "local"
              ? "border-emerald-600 bg-emerald-950/50 text-emerald-200"
              : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
          }`}
        >
          <Shield className="mr-1.5 inline h-4 w-4 align-[-3px]" />
          Défenses locales
        </button>

        {!showEnemyBank ? (
          <>
        <button
          type="button"
          onClick={() => setTypeFilter("all")}
          className={filterButtonClass("all")}
        >
          {t("common.allPlural", "Toutes")}
        </button>

        <button
          type="button"
          onClick={() => setTypeFilter("tour")}
          className={filterButtonClass("tour")}
        >
          {t("defenses.tower", "Tour")}
        </button>

        <button
          type="button"
          onClick={() => setTypeFilter("bastion")}
          className={filterButtonClass("bastion")}
        >
          {t("defenses.bastion", "Bastion")}
        </button>

        <button
          type="button"
          onClick={() => setTypeFilter("bulle")}
          className={filterButtonClass("bulle")}
        >
          {t("defenses.bubble", "Bulle")}
        </button>
          </>
        ) : null}

        <button
          type="button"
          onClick={() => setViewMode(showLibrary ? "local" : "library")}
          className={`rounded-xl border px-3 py-1.5 text-sm ${
            showLibrary
              ? "border-cyan-500 bg-cyan-950/50 text-cyan-100"
              : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
          }`}
        >
          <Library className="mr-1.5 inline h-4 w-4 align-[-3px]" />
          {t("adminDefenses.library", "Bibliotheque")}
        </button>

        <button
          type="button"
          onClick={() => setViewMode(showEnemyBank ? "local" : "enemy")}
          className={`rounded-xl border px-3 py-1.5 text-sm ${
            showEnemyBank
              ? "border-red-500 bg-red-950/50 text-red-100"
              : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
          }`}
        >
          <ShieldAlert className="mr-1.5 inline h-4 w-4 align-[-3px]" />
          Défenses adverses
        </button>

        {!showEnemyBank ? (
        <label className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("common.search", "Rechercher")}
            className="h-9 w-full rounded-xl border border-zinc-700 bg-zinc-900 pl-9 pr-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
          />
        </label>
        ) : null}
      </div>

      {showLibrary ? (
        <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
          {t(
            "adminDefenses.libraryHelp",
            "La bibliotheque affiche les defenses natives de ton organisation. L'import cree une copie locale independante."
          )}
        </div>
      ) : null}

      {showLibrary && migrationRequired ? (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {t(
            "adminDefenses.libraryMigrationRequired",
            "Migration bibliotheque requise avant de pouvoir importer une defense."
          )}
        </div>
      ) : null}

      {showEnemyBank ? (
        <GvgEnemyDefenseBankTab activeGuildCode={activeGuildCode} />
      ) : (
      <div className="grid gap-3">
        {displayedDefenses.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 text-sm text-zinc-400">
            {t("adminDefenses.noDefenseLoaded", "Aucune defense chargee.")}
          </div>
        ) : (
          displayedDefenses.map((defense) => {
            const imageSrc = defense.image || defense.image_url || "";
            const infoBlocks = getDefenseInfoBlocks(defense);
            const selectedTarget = getSelectedImportTarget(defense);
            const targetStatus = getImportTargetStatus(defense, selectedTarget);
            const importKey = `${defense.id}:${selectedTarget}`;
            const canImport = showLibrary && !migrationRequired && targetStatus === "available";

            return (
              <div
                key={defense.id}
                className={`grid min-h-[220px] gap-5 rounded-2xl p-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,300px)_auto] ${
                  showLibrary && targetStatus !== "available" ? "opacity-70" : ""
                } ${defenseCardClass(
                  defense.tier
                )}`}
              >
                <div className="flex flex-col">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-semibold text-white">
                        {defense.name}
                      </div>
                      {showLibrary ? (
                        <span className="rounded-md border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-xs font-semibold text-cyan-100">
                          {defense.originGuildCode || defense.guildCode || "-"}
                        </span>
                      ) : defense.sourceGuildCode ? (
                        <span className="rounded-md border border-amber-300/30 bg-amber-300/10 px-2 py-0.5 text-xs font-semibold text-amber-100">
                          Importee depuis {defense.sourceGuildCode}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-zinc-300">
                      {defense.tier} · {formatDefenseTypeLabel(defense.type)}
                    </div>
                  </div>

                  <div className="mt-3 text-sm text-zinc-200">
                    {t("common.heroes", "Heros")} :{" "}
                    {(defense.slots || []).filter(Boolean).join(", ") ||
                      t("common.notFilled", "Non renseigne")}
                  </div>

                  <div className="mt-2 text-sm text-zinc-300">
                    {t("defenses.conditions", "Conditions")} :
                    {(defense.conditions || []).length === 0 ? (
                      <span className="ml-2 text-zinc-400">{t("common.none", "Aucune")}</span>
                    ) : (
                      <ul className="mt-1 space-y-1">
                        {defense.conditions.slice(0, 5).map((cond, i) => (
                          <li
                            key={cond.id || cond.label || i}
                            className="text-xs text-zinc-200"
                          >
                            • {typeof cond === "string" ? cond : cond.label}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="mt-3 rounded-xl border border-zinc-900/60 bg-black/20 p-3 text-sm text-zinc-300">
                    <div>
                      {t("adminDefenses.info", "Infos")} :
                      {infoBlocks.length === 0 ? (
                        <span className="ml-2 text-zinc-400">{t("common.none", "Aucune")}</span>
                      ) : null}
                    </div>

                    {infoBlocks.length > 0 ? (
                      <div className="mt-2 space-y-2">
                        {infoBlocks.slice(0, 3).map((block, index) => {
                          const blockType = block.block_type || block.blockType;

                          return blockType === "image" ? (
                            <div
                              key={block.id || `${defense.id}-info-image-${index}`}
                              className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80"
                            >
                              <img
                                src={block.content}
                                alt={t("adminDefenses.infoImageAlt", "Info defense")}
                                className="max-h-24 w-full object-contain"
                              />
                            </div>
                          ) : (
                            <div
                              key={block.id || `${defense.id}-info-text-${index}`}
                              className="max-h-20 overflow-hidden whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950/70 p-2 text-xs leading-relaxed text-zinc-200"
                            >
                              {block.content}
                            </div>
                          );
                        })}

                        {infoBlocks.length > 3 ? (
                          <div className="text-xs text-zinc-400">
                            +{infoBlocks.length - 3} {t("adminDefenses.moreInfo", "info(s) dans le modal")}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="flex h-[180px] items-center justify-center overflow-hidden rounded-xl border border-black/30 bg-zinc-950/80">
                  {imageSrc ? (
                    <img
                      src={imageSrc}
                      alt={defense.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="text-xs text-zinc-500">{t("common.noImage", "Aucune image")}</div>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  {showLibrary ? (
                    <>
                      <select
                        value={selectedTarget}
                        onChange={(event) =>
                          setImportTargetByDefenseId((previous) => ({
                            ...previous,
                            [String(defense.id)]: event.target.value,
                          }))
                        }
                        className="rounded-xl border border-zinc-700 bg-zinc-950/80 px-2 py-2 text-xs text-zinc-100 outline-none"
                      >
                        {(manageableGuildCodes.length ? manageableGuildCodes : [activeGuildCode]).map((guildCode) => {
                          const optionStatus = getImportTargetStatus(defense, guildCode);
                          return (
                            <option key={guildCode} value={guildCode} disabled={optionStatus !== "available"}>
                              {guildCode} {optionStatus === "available" ? "" : "- deja presente"}
                            </option>
                          );
                        })}
                      </select>
                      <button
                        type="button"
                        onClick={() => importLibraryDefense(defense)}
                        disabled={!canImport || importingKey === importKey}
                        className="flex items-center justify-center gap-2 rounded-xl border border-cyan-500/50 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-950/40 disabled:text-zinc-500"
                      >
                        {targetStatus === "available" ? (
                          <Download className="h-4 w-4" />
                        ) : targetStatus === "native" ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <Ban className="h-4 w-4" />
                        )}
                        {importingKey === importKey
                          ? t("common.loading", "Chargement...")
                          : getImportActionLabel(targetStatus, selectedTarget)}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onEdit?.(defense)}
                        className="rounded-xl border border-zinc-700 bg-zinc-950/40 p-2 text-zinc-200 hover:bg-zinc-800"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onDelete?.(defense)}
                        className="rounded-xl border border-red-900/60 bg-zinc-950/40 p-2 text-red-300 hover:bg-red-950/40"
                        title={defense.sourceDefenseId ? `Retirer de ${activeGuildCode}` : t("common.delete", "Supprimer")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onAddCondition?.(defense)}
                        className="rounded-xl border border-zinc-700 bg-zinc-950/40 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
                      >
                        + {t("defenses.conditions", "Condition")}
                      </button>

                      <button
                        type="button"
                        onClick={() => onRemoveCondition?.(defense)}
                        disabled={(defense.conditions || []).length === 0}
                        className="rounded-xl border border-zinc-700 bg-zinc-950/40 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        - {t("defenses.conditions", "Condition")}
                      </button>
                      <button
                        type="button"
                        onClick={() => openDefenseBlocksModal(defense)}
                        className="rounded-xl border border-blue-700 bg-blue-900/30 px-2 py-1 text-xs text-blue-300 hover:bg-blue-800/50"
                      >
                        {t("adminDefenses.infoButton", "Infos")}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
      )}
 {blocksModalOpen && selectedDefenseForBlocks && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-white">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-bold">{t("adminDefenses.defenseInfo", "Infos defense")}</div>
          <div className="text-sm text-zinc-400">
            {selectedDefenseForBlocks.name}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setBlocksModalOpen(false)}
          className="rounded-xl border border-zinc-700 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          {t("common.close", "Fermer")}
        </button>
      </div>

      <div className="min-h-0 overflow-y-auto rounded-xl border border-dashed border-zinc-700 p-4 text-sm text-zinc-400">
        <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
          <div className="mb-2 text-sm font-semibold text-zinc-200">
            {t("adminDefenses.addTextBlock", "Ajouter un bloc texte")}
          </div>

          <textarea
            value={newTextBlock}
            onChange={(e) => setNewTextBlock(e.target.value)}
            rows={4}
            placeholder={t("adminDefenses.textPlaceholder", "Ecris ton commentaire ici...")}
            className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm text-white outline-none focus:border-blue-500"
          />

<div className="mt-2 flex flex-wrap gap-2">
  <button
    type="button"
    onClick={addTextBlock}
    className="rounded-xl border border-emerald-700 bg-emerald-900/30 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-800/50"
  >
    {t("adminDefenses.saveText", "Enregistrer le texte")}
  </button>

  <label
    className={`cursor-pointer rounded-xl border border-blue-700 bg-blue-900/30 px-3 py-1.5 text-xs text-blue-300 hover:bg-blue-800/50 ${
      blockImageUploading ? "pointer-events-none opacity-60" : ""
    }`}
  >
    {t("adminDefenses.addFile", "Ajouter un fichier")}
    <input
      type="file"
      accept="image/*"
      onChange={addImageBlock}
      disabled={blockImageUploading}
      className="hidden"
    />
  </label>

  <button
    type="button"
    onClick={pasteImageBlockFromClipboard}
    disabled={blockImageUploading}
    className="flex items-center gap-1.5 rounded-xl border border-violet-700 bg-violet-900/30 px-3 py-1.5 text-xs text-violet-200 hover:bg-violet-800/50 disabled:cursor-wait disabled:opacity-60"
  >
    <ClipboardPaste className="h-3.5 w-3.5" />
    {t("adminDefenses.pasteImage", "Coller depuis le presse-papier")}
  </button>
</div>

          <div
            role="button"
            tabIndex={0}
            onPaste={handlePasteImageBlock}
            className="mt-3 rounded-xl border border-dashed border-violet-800 bg-violet-950/20 p-3 outline-none transition focus:border-violet-400 focus:bg-violet-950/40"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-violet-200">
              <ClipboardPaste className="h-4 w-4" />
              {t("adminDefenses.pasteZoneTitle", "Collage rapide")}
            </div>
            <div className="mt-1 text-xs text-zinc-400">
              {t(
                "adminDefenses.pasteZoneHelp",
                "Clique ici puis fais Ctrl+V pour ajouter directement l'image copiee."
              )}
            </div>
          </div>

          {blockImageMessage && (
            <div className="mt-2 text-xs text-zinc-300">
              {blockImageMessage}
            </div>
          )}
        </div>

        {blocksLoading ? (
          t("common.loading", "Chargement...")
        ) : defenseBlocks.length === 0 ? (
          t("adminDefenses.noBlock", "Aucun bloc pour cette defense.")
        ) : (
          <div className="space-y-2">
            {defenseBlocks.map((block, index) => (
              <div
                key={block.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs uppercase tracking-wide text-zinc-500">
                    {block.block_type === "image" ? t("common.image", "Image") : t("common.text", "Texte")}
                  </div>

                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => moveBlock(index, "up")}
                      disabled={index === 0}
                      className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300 disabled:opacity-30"
                    >
                      ↑
                    </button>

                    <button
                      type="button"
                      onClick={() => moveBlock(index, "down")}
                      disabled={index === defenseBlocks.length - 1}
                      className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300 disabled:opacity-30"
                    >
                      ↓
                    </button>

                    <button
                      type="button"
                      onClick={() => deleteBlock(block)}
                      className="rounded-lg border border-red-800 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40"
                    >
                      {t("common.delete", "Supprimer")}
                    </button>
                  </div>
                </div>

                {block.block_type === "image" ? (
                  <div className="overflow-hidden rounded-xl border border-zinc-800 bg-black">
                    <img
                      src={block.content}
                      alt={t("adminDefenses.blockImageAlt", "Bloc defense")}
                      className="max-h-[320px] w-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap rounded-xl bg-zinc-950/70 p-3 text-sm text-zinc-200">
                    {block.content}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  </div>
)}
    </div>
  );
}
