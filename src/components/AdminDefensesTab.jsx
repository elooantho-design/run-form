import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, CheckCircle2, ClipboardPaste, Download, GitCompareArrows, Library, Link2, Maximize2, Pencil, Plus, RefreshCw, Search, Shield, ShieldAlert, Trash2, X } from "lucide-react";
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

function formatEnemyPercent(value) {
  const number = Number(value) || 0;
  return `${number.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

function formatEnemyDate(value) {
  if (!value) return "Jamais";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Jamais";
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getEnemyRateToneClass(stat) {
  const tone = stat?.rateTone || stat?.rate_tone;
  if (tone === "solid") return "border-emerald-400/45 bg-emerald-500/15 text-emerald-100";
  if (tone === "warning") return "border-yellow-400/45 bg-yellow-500/15 text-yellow-100";
  if (tone === "danger") return "border-orange-400/45 bg-orange-500/15 text-orange-100";
  return "border-red-400/45 bg-red-500/15 text-red-100";
}

function cleanLayoutValue(value) {
  const clean = String(value || "").trim();
  return clean && clean !== "--" ? clean : "";
}

function getDefenseHeroRows(defense) {
  const detailedSlots = Array.isArray(defense?.detailedSlots)
    ? defense.detailedSlots
    : Array.isArray(defense?.detailed_slots)
      ? defense.detailed_slots
      : [];
  const fallbackSlots = Array.isArray(defense?.slots) ? defense.slots : [];
  const rows = detailedSlots.length
    ? detailedSlots
    : fallbackSlots.map((champion, index) => ({ slotIndex: index + 1, champion }));

  return rows
    .map((slot, index) => ({
      key: `${slot?.slotIndex ?? slot?.slot_index ?? index}-${slot?.champion || fallbackSlots[index] || index}`,
      champion: cleanLayoutValue(slot?.portalName || slot?.portal_name || slot?.champion || fallbackSlots[index]),
      position: cleanLayoutValue(slot?.position),
      direction: cleanLayoutValue(slot?.direction),
    }))
    .filter((slot) => slot.champion);
}

function hasCompleteDefenseLayout(heroRows) {
  const firstFiveSlots = heroRows.slice(0, 5);
  return firstFiveSlots.length === 5 && firstFiveSlots.every((slot) => slot.position && slot.direction);
}

function formatEnemyHeroLine(hero, index) {
  const champion = String(hero?.champion || hero || `Hero ${index + 1}`)
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
  const position = hero?.position || "--";
  const direction = hero?.direction || "--";
  return `${champion} ${position} ${direction}`;
}

export default function AdminDefensesTab({
  defenses = [],
  libraryDefenses = [],
  activeGuildCode = "",
  manageableGuildCodes = [],
  migrationRequired = false,
  libraryEquivalenceMigrationRequired = false,
  onEdit,
  onDelete,
  onAdd,
  onAddCondition,
  onRemoveCondition,
  onEnsureEditable,
  onImportDefense,
  onDataChanged,
  openLibraryMergeRequest = null,
  onLibraryMergeRequestConsumed = null,
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
const [enemyHistoryModal, setEnemyHistoryModal] = useState(null);
const [enemyHistoryLoading, setEnemyHistoryLoading] = useState(false);
const [librarySimilarityModal, setLibrarySimilarityModal] = useState(null);
const [librarySimilarityLoading, setLibrarySimilarityLoading] = useState(false);
const [libraryReviewingId, setLibraryReviewingId] = useState("");
const [libraryMergeLoadingId, setLibraryMergeLoadingId] = useState("");
const [libraryMergingId, setLibraryMergingId] = useState("");
const [libraryRecalculateLoading, setLibraryRecalculateLoading] = useState(false);
const [imagePreview, setImagePreview] = useState(null);

const consumeOpenLibraryMergeRequest = useCallback((reviewId = "") => {
  const currentReviewId = openLibraryMergeRequest?.reviewId || openLibraryMergeRequest?.review_id || "";
  if (!currentReviewId) return;
  if (reviewId && String(currentReviewId) !== String(reviewId)) return;
  onLibraryMergeRequestConsumed?.(openLibraryMergeRequest);
}, [onLibraryMergeRequestConsumed, openLibraryMergeRequest]);

const closeLibrarySimilarityModal = () => {
  consumeOpenLibraryMergeRequest();
  setLibrarySimilarityModal(null);
};

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

const getDefenseEnemyLinkId = (defense) =>
  defense?.sourceEnemyDefenseId || defense?.source_enemy_defense_id || "";

const getLibraryPendingCount = (defense) =>
  Number(defense?.librarySimilarityPendingCount ?? defense?.library_similarity_pending_count) || 0;

const getLibraryEquivalenceCount = (defense) =>
  Number(defense?.libraryEquivalenceCount ?? defense?.library_equivalence_count) || 0;

const getLibraryPresentGuilds = (defense) =>
  defense?.presentGuilds || defense?.present_guilds || [];

const getLibraryEquivalentDefenses = (defense) =>
  defense?.equivalentDefenses || defense?.equivalent_defenses || [];

const getLibraryMergeCandidateEquivalentId = (candidate, currentDefenseId = "") => {
  const explicitId = candidate?.equivalentDefenseId || candidate?.equivalent_defense_id;
  if (explicitId) return String(explicitId);

  const leftDefense = candidate?.leftDefense || candidate?.left_defense;
  const rightDefense = candidate?.rightDefense || candidate?.right_defense;
  const currentId = String(currentDefenseId || "");

  if (currentId && String(leftDefense?.id || "") === currentId) return String(rightDefense?.id || "");
  if (currentId && String(rightDefense?.id || "") === currentId) return String(leftDefense?.id || "");

  return String(rightDefense?.id || leftDefense?.id || "");
};

const getImportTargetDetail = (defense, targetGuildCode) =>
  (defense?.importTargets || []).find(
    (entry) => normalizeGuildCodeKey(entry.guildCode || entry.guild_code) === normalizeGuildCodeKey(targetGuildCode)
  ) || null;

const renderEnemyDefenseLinkBadge = (defense) => {
  if (!getDefenseEnemyLinkId(defense)) return null;

  const stat = defense.enemyStats || defense.enemy_stats || null;

  return (
    <button
      type="button"
      onClick={() => openEnemyHistoryModal(defense)}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold hover:bg-white/10 ${
        stat
          ? getEnemyRateToneClass(stat)
          : "border-red-400/45 bg-red-500/15 text-red-100"
      }`}
    >
      <Link2 className="h-3.5 w-3.5" />
      DÉFENSE ADVERSE
      {stat ? (
        <span>
          · Taux de défaite {formatEnemyPercent(stat.successRate ?? stat.success_rate)}
        </span>
      ) : null}
    </button>
  );
};

const openEnemyHistoryModal = async (defense) => {
  if (!getDefenseEnemyLinkId(defense)) return;

  setEnemyHistoryModal({ defense, error: "", enemyDefense: null, primaryStat: defense.enemyStats || defense.enemy_stats || null, crossGuildStats: [] });
  setEnemyHistoryLoading(true);

  try {
    const data = await callPortalAdminDefenses({
      action: "enemy-history",
      guildCode: defense.guildCode || defense.guild_code || activeGuildCode,
      defenseId: defense.id,
    });
    setEnemyHistoryModal({
      defense: data.defense || defense,
      error: "",
      enemyDefense: data.enemyDefense || data.enemy_defense || null,
      primaryStat: data.primaryStat || data.primary_stat || null,
      crossGuildStats: data.crossGuildStats || data.cross_guild_stats || [],
    });
  } catch (error) {
    setEnemyHistoryModal({
      defense,
      error: error?.message || "Historique defense adverse indisponible.",
      enemyDefense: null,
      primaryStat: defense.enemyStats || defense.enemy_stats || null,
      crossGuildStats: defense.enemyCrossGuildStats || defense.enemy_cross_guild_stats || [],
    });
  } finally {
    setEnemyHistoryLoading(false);
  }
};

const openImagePreview = (src, title = "Defense") => {
  if (!src) return;
  setImagePreview({ src, title });
};

const openLibrarySimilaritiesModal = async (defense) => {
  if (libraryEquivalenceMigrationRequired) return;

  setLibrarySimilarityModal({
    mode: "pending",
    defense,
    candidates: [],
    equivalents: [],
    presentGuilds: getLibraryPresentGuilds(defense),
    error: "",
  });
  setLibrarySimilarityLoading(true);

  try {
    const data = await callPortalAdminDefenses({
      action: "library-similarities",
      guildCode: activeGuildCode,
      defenseId: defense.id,
    });
    setLibrarySimilarityModal({
      mode: "pending",
      defense,
      candidates: data.candidates || [],
      equivalents: [],
      presentGuilds: getLibraryPresentGuilds(defense),
      error: "",
    });
  } catch (error) {
    setLibrarySimilarityModal({
      mode: "pending",
      defense,
      candidates: [],
      equivalents: [],
      presentGuilds: getLibraryPresentGuilds(defense),
      error: error?.message || "Similarites bibliotheque indisponibles.",
    });
  } finally {
    setLibrarySimilarityLoading(false);
  }
};

const openLibraryEquivalenceDetailsModal = async (defense) => {
  setLibrarySimilarityModal({
    mode: "equivalents",
    defense,
    candidates: [],
    equivalents: getLibraryEquivalentDefenses(defense),
    presentGuilds: getLibraryPresentGuilds(defense),
    error: "",
  });
  setLibrarySimilarityLoading(true);

  try {
    const data = await callPortalAdminDefenses({
      action: "library-equivalence-details",
      guildCode: activeGuildCode,
      defenseId: defense.id,
    });
    setLibrarySimilarityModal({
      mode: "equivalents",
      defense,
      candidates: data.mergeCandidates || data.merge_candidates || [],
      equivalents: data.equivalentDefenses || data.equivalent_defenses || [],
      presentGuilds: data.presentGuilds || data.present_guilds || [],
      error: "",
    });
  } catch (error) {
    setLibrarySimilarityModal({
      mode: "equivalents",
      defense,
      candidates: [],
      equivalents: getLibraryEquivalentDefenses(defense),
      presentGuilds: getLibraryPresentGuilds(defense),
      error: error?.message || "Equivalences bibliotheque indisponibles.",
    });
  } finally {
    setLibrarySimilarityLoading(false);
  }
};

const updateLibrarySimilarityCandidate = (reviewId, updater) => {
  setLibrarySimilarityModal((previous) => previous ? {
    ...previous,
    candidates: (previous.candidates || []).map((item) => {
      const itemReviewId = item.review?.id || item.review_id;
      return itemReviewId === reviewId ? updater(item) : item;
    }),
  } : previous);
};

const loadLibraryMergePreview = async (candidate) => {
  const reviewId = candidate?.review?.id || candidate?.review_id;
  if (!reviewId) return null;

  setLibraryMergeLoadingId(reviewId);
  try {
    const data = await callPortalAdminDefenses({
      action: "library-merge-preview",
      guildCode: activeGuildCode,
      reviewId,
    });
    const mergePlan = data.mergePlan || data.merge_plan || null;
    updateLibrarySimilarityCandidate(reviewId, (item) => ({
      ...item,
      mergePlan,
      merge_plan: mergePlan,
      mergeError: "",
      merge_error: "",
    }));
    return mergePlan;
  } catch (error) {
    updateLibrarySimilarityCandidate(reviewId, (item) => ({
      ...item,
      mergeError: error?.message || "Plan de fusion indisponible.",
      merge_error: error?.message || "Plan de fusion indisponible.",
    }));
    return null;
  } finally {
    setLibraryMergeLoadingId("");
  }
};

const showLibraryMergePlan = async (candidate) => {
  const reviewId = candidate?.review?.id || candidate?.review_id;
  if (!reviewId) return null;

  updateLibrarySimilarityCandidate(reviewId, (item) => ({
    ...item,
    showMergePlan: true,
    show_merge_plan: true,
  }));

  return loadLibraryMergePreview(candidate);
};

const reviewLibrarySimilarity = async (candidate, status) => {
  const reviewId = candidate?.review?.id || candidate?.review_id;
  if (!reviewId) return;

  setLibraryReviewingId(reviewId);
  try {
    const result = await callPortalAdminDefenses({
      action: "library-review",
      guildCode: activeGuildCode,
      reviewId,
      status,
    });

    if (status === "identical") {
      updateLibrarySimilarityCandidate(reviewId, (item) => ({
        ...item,
        review: { ...(item.review || {}), status: "identical" },
        mergePlan: result.mergePlan || result.merge_plan || item.mergePlan || null,
        merge_plan: result.mergePlan || result.merge_plan || item.merge_plan || null,
      }));
      await loadLibraryMergePreview(candidate);
    } else {
      setLibrarySimilarityModal((previous) => previous ? {
        ...previous,
        candidates: (previous.candidates || []).filter((item) => (item.review?.id || item.review_id) !== reviewId),
      } : previous);
    }
    onDataChanged?.();
  } catch (error) {
    setLibrarySimilarityModal((previous) => previous ? {
      ...previous,
      error: error?.message || "Validation similarite bibliotheque impossible.",
    } : previous);
  } finally {
    setLibraryReviewingId("");
  }
};

const mergeLibraryRoots = async (candidate) => {
  const reviewId = candidate?.review?.id || candidate?.review_id;
  if (!reviewId) return;

  setLibraryMergingId(reviewId);
  try {
    const data = await callPortalAdminDefenses({
      action: "library-merge",
      guildCode: activeGuildCode,
      reviewId,
    });
    const mergePlan = data.mergePlan || data.merge_plan || candidate.mergePlan || candidate.merge_plan || {};
    const mergeResult = data.mergeResult || data.merge_result || {};
    const canonicalDefense = mergePlan.canonical || null;
    const absorbedDefense = mergePlan.absorbed || null;
    const canonicalId = String(
      mergeResult.canonical_defense_id ||
        mergeResult.canonicalDefenseId ||
        canonicalDefense?.id ||
        "",
    );
    const absorbedId = String(
      mergeResult.absorbed_defense_id ||
        mergeResult.absorbedDefenseId ||
        absorbedDefense?.id ||
        "",
    );

    setLibrarySimilarityModal((previous) => previous ? {
      ...previous,
      notice: "Fusion bibliotheque effectuee.",
      candidates: (previous.candidates || []).filter((item) => (item.review?.id || item.review_id) !== reviewId),
      defense: absorbedId && String(previous.defense?.id || "") === absorbedId && canonicalDefense
        ? { ...previous.defense, ...canonicalDefense }
        : previous.defense,
      equivalents: (previous.equivalents || []).filter((defense) => {
        const id = String(defense?.id || "");
        if (absorbedId && id === absorbedId) return false;
        if (absorbedId && String(previous.defense?.id || "") === absorbedId && canonicalId && id === canonicalId) return false;
        return true;
      }),
      presentGuilds: mergePlan.guilds || mergePlan.presentGuilds || mergePlan.present_guilds || previous.presentGuilds,
    } : previous);
    consumeOpenLibraryMergeRequest(reviewId);
    onDataChanged?.();
  } catch (error) {
    updateLibrarySimilarityCandidate(reviewId, (item) => ({
      ...item,
      mergeError: error?.message || "Fusion bibliotheque impossible.",
      merge_error: error?.message || "Fusion bibliotheque impossible.",
    }));
  } finally {
    setLibraryMergingId("");
  }
};

const recalculateLibrarySimilarities = async () => {
  if (libraryEquivalenceMigrationRequired) return;

  setLibraryRecalculateLoading(true);
  try {
    await callPortalAdminDefenses({
      action: "library-recalculate",
      guildCode: activeGuildCode,
    });
    onDataChanged?.();
  } catch (error) {
    console.error("Erreur recalcul similarites bibliotheque:", error);
  } finally {
    setLibraryRecalculateLoading(false);
  }
};

useEffect(() => {
  const reviewId = openLibraryMergeRequest?.reviewId || openLibraryMergeRequest?.review_id || "";
  if (!reviewId) return;

  let cancelled = false;
  const defenseLabel = openLibraryMergeRequest?.defenseName || openLibraryMergeRequest?.defense_name || "Defense";

  async function openRequestedMergePlan() {
    setLibrarySimilarityModal({
      mode: "pending",
      defense: { name: defenseLabel },
      candidates: [],
      equivalents: [],
      presentGuilds: [],
      error: "",
    });
    setLibrarySimilarityLoading(true);

    try {
      const data = await callPortalAdminDefenses({
        action: "library-merge-preview",
        guildCode: activeGuildCode,
        reviewId,
      });
      if (cancelled) return;

      const mergePlan = data.mergePlan || data.merge_plan || null;
      setLibrarySimilarityModal({
        mode: "pending",
        defense: { name: defenseLabel },
        candidates: [{
          review: { id: reviewId, status: "identical" },
          review_id: reviewId,
          leftDefense: mergePlan?.canonical || null,
          left_defense: mergePlan?.canonical || null,
          rightDefense: mergePlan?.absorbed || null,
          right_defense: mergePlan?.absorbed || null,
          mergePlan,
          merge_plan: mergePlan,
          showMergePlan: true,
          show_merge_plan: true,
        }],
        equivalents: [],
        presentGuilds: mergePlan?.guilds || [],
        error: "",
      });
    } catch (error) {
      if (cancelled) return;
      setLibrarySimilarityModal({
        mode: "pending",
        defense: { name: defenseLabel },
        candidates: [],
        equivalents: [],
        presentGuilds: [],
        error: error?.message || "Plan de fusion indisponible.",
      });
    } finally {
      if (!cancelled) {
        setLibrarySimilarityLoading(false);
        consumeOpenLibraryMergeRequest(reviewId);
      }
    }
  }

  openRequestedMergePlan();

  return () => {
    cancelled = true;
  };
}, [
  activeGuildCode,
  openLibraryMergeRequest?.defenseName,
  openLibraryMergeRequest?.defense_name,
  openLibraryMergeRequest?.reviewId,
  openLibraryMergeRequest?.review_id,
  openLibraryMergeRequest?.token,
  consumeOpenLibraryMergeRequest,
]);

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
    if (status === "equivalent-native") return `Deja presente dans ${targetGuildCode}`;
    if (status === "equivalent-imported") return `Deja presente dans ${targetGuildCode}`;
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

const renderLibraryDefensePanel = (defense, title) => {
  const heroRows = getDefenseHeroRows(defense);
  const hasAnyLayout = heroRows.some((slot) => slot.position && slot.direction);
  const imageSrc = defense?.image || defense?.image_url || defense?.imageUrl || "";

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
      <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">{title}</div>
      <div className="mt-1 text-base font-semibold text-zinc-50">{defense?.name || "Defense"}</div>
      <div className="mt-1 text-xs text-zinc-400">
        {(defense?.guildCode || defense?.guild_code || "-")} · {formatDefenseTypeLabel(defense?.type)}
      </div>

      <button
        type="button"
        onClick={() => openImagePreview(imageSrc, defense?.name || "Defense")}
        disabled={!imageSrc}
        className="group mt-3 flex h-44 w-full items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 text-xs text-zinc-500 disabled:cursor-not-allowed"
      >
        {imageSrc ? (
          <span className="relative h-full w-full">
            <img
              src={imageSrc}
              alt={defense?.name || "Defense"}
              className="h-full w-full object-cover"
            />
            <span className="absolute right-2 top-2 rounded-lg border border-zinc-700 bg-black/70 p-1 text-zinc-100 opacity-0 transition group-hover:opacity-100">
              <Maximize2 className="h-3.5 w-3.5" />
            </span>
          </span>
        ) : (
          t("common.noImage", "Aucune image")
        )}
      </button>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {heroRows.map((slot) => (
          <span
            key={slot.key}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700/70 bg-zinc-950/60 px-2 py-1 text-xs text-zinc-100"
          >
            <span className="font-medium">{slot.champion}</span>
            {hasAnyLayout && slot.position && slot.direction ? (
              <span className="font-semibold text-cyan-200">
                {slot.position} {slot.direction}
              </span>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
};

const renderLibraryMergePlan = (candidate) => {
  const reviewId = candidate?.review?.id || candidate?.review_id;
  const reviewStatus = candidate?.review?.status || candidate?.status || "";
  const mergePlan = candidate?.mergePlan || candidate?.merge_plan || null;
  const mergeError = candidate?.mergeError || candidate?.merge_error || "";

  if (reviewStatus !== "identical" && !mergePlan && !mergeError) return null;

  const canonical = mergePlan?.canonical || null;
  const absorbed = mergePlan?.absorbed || null;
  const canonicalScore = mergePlan?.canonicalScore || mergePlan?.canonical_score || {};
  const absorbedScore = mergePlan?.absorbedScore || mergePlan?.absorbed_score || {};
  const transfers = mergePlan?.transfers || [];
  const conflicts = mergePlan?.conflicts || [];
  const guilds = mergePlan?.guilds || [];
  const guildsAfter = mergePlan?.guildsAfter || mergePlan?.guilds_after || guilds;
  const rootLocalPresence = mergePlan?.rootLocalPresence || mergePlan?.root_local_presence || null;
  const descendants = mergePlan?.descendants || {};
  const localCollisions = mergePlan?.localCollisions || mergePlan?.local_collisions || [];
  const canMerge = Boolean(mergePlan?.canMerge ?? mergePlan?.can_merge);
  const isBusy = libraryMergeLoadingId === reviewId || libraryMergingId === reviewId;

  return (
    <div className="mt-4 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-emerald-50">Plan de fusion</div>
          <div className="mt-1 text-xs text-emerald-100/80">
            La review est marquee IDENTIQUE. La fusion conserve une seule root active sans supprimer physiquement l'historique.
          </div>
        </div>

        {!mergePlan && (
          <button
            type="button"
            onClick={() => loadLibraryMergePreview(candidate)}
            disabled={isBusy}
            className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
          >
            {libraryMergeLoadingId === reviewId ? "Chargement..." : "VOIR LE PLAN DE FUSION"}
          </button>
        )}
      </div>

      {mergeError ? (
        <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
          {mergeError}
        </div>
      ) : null}

      {mergePlan ? (
        <>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-zinc-700/70 bg-zinc-950/60 p-3">
              <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Defense conservee</div>
              <div className="mt-1 font-semibold text-zinc-50">{canonical?.name || "Defense"}</div>
              <div className="mt-1 text-xs text-zinc-400">
                {canonical?.guildCode || canonical?.guild_code || "-"} · score {canonicalScore.score ?? "-"}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {(canonicalScore.reasons || []).map((reason) => (
                  <span key={reason} className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-200">
                    {reason}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-700/70 bg-zinc-950/60 p-3">
              <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Defense absorbee</div>
              <div className="mt-1 font-semibold text-zinc-50">{absorbed?.name || "Defense"}</div>
              <div className="mt-1 text-xs text-zinc-400">
                {absorbed?.guildCode || absorbed?.guild_code || "-"} · score {absorbedScore.score ?? "-"}
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-3 text-sm text-zinc-200 md:grid-cols-2">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
              <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Guildes concernees</div>
              <div className="mt-1">
                Avant : {guilds.map((entry) => entry.guildCode || entry.guild_code).filter(Boolean).join(" · ") || "-"}
              </div>
              <div className="mt-1">
                Apres : {guildsAfter.map((entry) => entry.guildCode || entry.guild_code).filter(Boolean).join(" · ") || "-"}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
              <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Descendants</div>
              <div className="mt-1">
                {descendants.repointedCount ?? descendants.repointed_count ?? 0} repointe(s) · {localCollisions.length} collision(s) locale(s)
              </div>
            </div>
          </div>

          {rootLocalPresence ? (
            <div className="mt-3 rounded-xl border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-100">
              <div className="text-xs uppercase tracking-[0.16em] text-cyan-200/80">Presence locale preservee</div>
              <div className="mt-1">
                {rootLocalPresence.message || `${rootLocalPresence.guildCode || rootLocalPresence.guild_code || "Guilde"} conserve une defense locale apres fusion.`}
              </div>
            </div>
          ) : null}

          <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3 text-sm">
            <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Donnees recuperees</div>
            {transfers.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {transfers.map((transfer) => (
                  <span key={`${transfer.type}-${transfer.label}`} className="rounded-md border border-cyan-400/25 bg-cyan-400/10 px-2 py-0.5 text-xs text-cyan-100">
                    {transfer.label}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-1 text-zinc-400">Aucune donnee complementaire a transferer.</div>
            )}
          </div>

          {conflicts.length ? (
            <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
              <div className="font-semibold">Conflits bloquants</div>
              <ul className="mt-1 space-y-1">
                {conflicts.map((conflict, index) => (
                  <li key={`${conflict.type || "conflict"}-${index}`}>
                    {conflict.message || conflict.type || "Conflit"}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">
              Conflits : aucun.
            </div>
          )}

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                consumeOpenLibraryMergeRequest(reviewId);
                updateLibrarySimilarityCandidate(reviewId, (item) => ({
                  ...item,
                  mergePlan: null,
                  merge_plan: null,
                  showMergePlan: false,
                  show_merge_plan: false,
                }));
              }}
              className="rounded-xl border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800"
            >
              ANNULER
            </button>
            <button
              type="button"
              onClick={() => mergeLibraryRoots(candidate)}
              disabled={!canMerge || isBusy}
              className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {libraryMergingId === reviewId ? "Fusion..." : "FUSIONNER"}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
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

        {showLibrary ? (
          <button
            type="button"
            onClick={recalculateLibrarySimilarities}
            disabled={libraryEquivalenceMigrationRequired || libraryRecalculateLoading}
            className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className="mr-1.5 inline h-4 w-4 align-[-3px]" />
            {libraryRecalculateLoading ? t("common.loading", "Chargement...") : "Recalculer similarites"}
          </button>
        ) : null}

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

      {showLibrary && libraryEquivalenceMigrationRequired ? (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Migration equivalences bibliotheque requise avant de valider les similarites entre modeles.
        </div>
      ) : null}

      {showEnemyBank ? (
        <GvgEnemyDefenseBankTab activeGuildCode={activeGuildCode} onDataChanged={onDataChanged} />
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
            const heroRows = getDefenseHeroRows(defense);
            const hasAnyLayout = heroRows.some((slot) => slot.position && slot.direction);
            const hasCompleteLayout = hasCompleteDefenseLayout(heroRows);
            const libraryPendingCount = getLibraryPendingCount(defense);
            const libraryEquivalenceCount = getLibraryEquivalenceCount(defense);
            const presentGuilds = getLibraryPresentGuilds(defense);

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
                      {renderEnemyDefenseLinkBadge(defense)}
                      {showLibrary && libraryPendingCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => openLibrarySimilaritiesModal(defense)}
                          className="inline-flex items-center gap-1 rounded-md border border-violet-300/35 bg-violet-400/10 px-2 py-0.5 text-xs font-semibold text-violet-100 hover:bg-violet-400/20"
                        >
                          <GitCompareArrows className="h-3.5 w-3.5" />
                          SIMILARITÉ BIBLIOTHÈQUE · {libraryPendingCount}
                        </button>
                      ) : null}
                      {showLibrary && libraryEquivalenceCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => openLibraryEquivalenceDetailsModal(defense)}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-300/35 bg-emerald-400/10 px-2 py-0.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/20"
                        >
                          <Link2 className="h-3.5 w-3.5" />
                          ÉQUIVALENTE · {libraryEquivalenceCount}
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-zinc-300">
                      {defense.tier} · {formatDefenseTypeLabel(defense.type)}
                    </div>
                    {showLibrary && presentGuilds.length ? (
                      <div className="mt-2 text-xs text-zinc-200">
                        Presente :{" "}
                        {presentGuilds.map((entry) => entry.guildCode || entry.guild_code).filter(Boolean).join(" · ")}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-3 text-sm text-zinc-200">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{t("common.heroes", "Heros")} :</span>
                      {hasCompleteLayout ? (
                        <span className="rounded-md border border-emerald-300/30 bg-emerald-300/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-100">
                          LAYOUT VALIDÉ
                        </span>
                      ) : null}
                    </div>
                    {hasAnyLayout ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {heroRows.map((slot) => (
                          <span
                            key={slot.key}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700/70 bg-zinc-950/60 px-2 py-1 text-xs text-zinc-100"
                          >
                            <span className="font-medium">{slot.champion}</span>
                            {slot.position && slot.direction ? (
                              <span className="font-semibold text-cyan-200">
                                {slot.position} {slot.direction}
                              </span>
                            ) : null}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span>
                        {" "}
                        {(defense.slots || []).filter(Boolean).join(", ") ||
                          t("common.notFilled", "Non renseigne")}
                      </span>
                    )}
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
                          const targetDetail = getImportTargetDetail(defense, guildCode);
                          const viaLabel = targetDetail?.viaDefenseName || targetDetail?.via_defense_name;
                          return (
                            <option key={guildCode} value={guildCode} disabled={optionStatus !== "available"}>
                              {guildCode} {optionStatus === "available" ? "" : `- deja presente${viaLabel ? ` via ${viaLabel}` : ""}`}
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
 {librarySimilarityModal && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-white shadow-2xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-bold">
            {librarySimilarityModal.mode === "equivalents" ? "Equivalences bibliotheque" : "Similarites bibliotheque"}
          </div>
          <div className="text-sm text-zinc-400">
            {librarySimilarityModal.defense?.name || "Defense"}
          </div>
        </div>

        <button
          type="button"
          onClick={closeLibrarySimilarityModal}
          className="rounded-xl border border-zinc-700 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          {t("common.close", "Fermer")}
        </button>
      </div>

      {librarySimilarityModal.error ? (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {librarySimilarityModal.error}
        </div>
      ) : null}
      {librarySimilarityModal.notice ? (
        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {librarySimilarityModal.notice}
        </div>
      ) : null}

      {librarySimilarityLoading ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 text-sm text-zinc-400">
          {t("common.loading", "Chargement...")}
        </div>
      ) : librarySimilarityModal.mode === "equivalents" ? (
        <div className="min-h-0 overflow-y-auto">
          <div className="mb-3 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
            Presente : {(librarySimilarityModal.presentGuilds || []).map((entry) => entry.guildCode || entry.guild_code).filter(Boolean).join(" · ") || "-"}
          </div>
          {(librarySimilarityModal.equivalents || []).length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 text-sm text-zinc-400">
              Aucun autre modele equivalent confirme.
            </div>
          ) : (
            <div className="space-y-4">
              {(librarySimilarityModal.equivalents || []).map((defense) => {
                const currentDefenseId = librarySimilarityModal.defense?.id || "";
                const equivalentId = String(defense?.id || "");
                const mergeCandidate = (librarySimilarityModal.candidates || []).find(
                  (candidate) => getLibraryMergeCandidateEquivalentId(candidate, currentDefenseId) === equivalentId,
                );
                const reviewId = mergeCandidate?.review?.id || mergeCandidate?.review_id || "";
                const mergePlanVisible = Boolean(
                  mergeCandidate?.showMergePlan ||
                    mergeCandidate?.show_merge_plan ||
                    mergeCandidate?.mergePlan ||
                    mergeCandidate?.merge_plan ||
                    mergeCandidate?.mergeError ||
                    mergeCandidate?.merge_error ||
                    libraryMergeLoadingId === reviewId ||
                    libraryMergingId === reviewId,
                );
                const mergedIntoId = defense?.mergedIntoDefenseId || defense?.merged_into_defense_id;

                return (
                  <div key={equivalentId || reviewId} className="rounded-2xl border border-violet-300/20 bg-violet-400/5 p-4">
                    {renderLibraryDefensePanel(defense, defense.guildCode || defense.guild_code || "Modele lie")}

                    {mergedIntoId ? (
                      <div className="mt-3 rounded-xl border border-zinc-700/70 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-300">
                        Modele deja fusionne vers {mergedIntoId}.
                      </div>
                    ) : mergeCandidate ? (
                      mergePlanVisible ? (
                        renderLibraryMergePlan(mergeCandidate)
                      ) : (
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => showLibraryMergePlan(mergeCandidate)}
                            disabled={libraryMergeLoadingId === reviewId}
                            className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
                          >
                            {libraryMergeLoadingId === reviewId ? "Chargement..." : "VOIR LE PLAN DE FUSION"}
                          </button>
                        </div>
                      )
                    ) : (
                      <div className="mt-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-100">
                        Review IDENTIQUE introuvable pour cette equivalence active.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (librarySimilarityModal.candidates || []).length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 text-sm text-zinc-400">
          Aucune similarite bibliotheque en attente pour ce modele.
        </div>
      ) : (
        <div className="min-h-0 space-y-4 overflow-y-auto">
          {(librarySimilarityModal.candidates || []).map((candidate) => {
            const reviewId = candidate.review?.id || candidate.review_id;
            const leftDefense = candidate.leftDefense || candidate.left_defense;
            const rightDefense = candidate.rightDefense || candidate.right_defense;

            return (
              <div key={reviewId} className="rounded-2xl border border-violet-300/20 bg-violet-400/5 p-4">
                <div className="grid gap-3 lg:grid-cols-2">
                  {renderLibraryDefensePanel(leftDefense, "Modele A")}
                  {renderLibraryDefensePanel(rightDefense, "Modele B")}
                </div>

                {renderLibraryMergePlan(candidate)}

                {(candidate.review?.status || candidate.status) !== "identical" ? (
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => reviewLibrarySimilarity(candidate, "different")}
                      disabled={libraryReviewingId === reviewId}
                      className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-100 hover:bg-red-500/20 disabled:opacity-50"
                    >
                      DIFFERENTE
                    </button>
                    <button
                      type="button"
                      onClick={() => reviewLibrarySimilarity(candidate, "identical")}
                      disabled={libraryReviewingId === reviewId}
                      className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
                    >
                      {libraryReviewingId === reviewId ? "Validation..." : "IDENTIQUE"}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  </div>
)}
 {imagePreview && (
  <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4">
    <div className="relative max-h-[94vh] w-full max-w-6xl">
      <button
        type="button"
        onClick={() => setImagePreview(null)}
        className="absolute right-3 top-3 z-10 rounded-xl border border-zinc-700 bg-black/75 p-2 text-zinc-100 hover:bg-zinc-900"
        aria-label={t("common.close", "Fermer")}
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={imagePreview.src}
        alt={imagePreview.title}
        className="max-h-[94vh] w-full rounded-2xl border border-zinc-800 object-contain"
      />
    </div>
  </div>
)}
 {enemyHistoryModal && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-white shadow-2xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-bold">Défense adverse liée</div>
          <div className="text-sm text-zinc-400">
            {enemyHistoryModal.defense?.name || "Defense locale"}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setEnemyHistoryModal(null)}
          className="rounded-xl border border-zinc-700 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          {t("common.close", "Fermer")}
        </button>
      </div>

      {enemyHistoryModal.error ? (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {enemyHistoryModal.error}
        </div>
      ) : null}

      {enemyHistoryLoading ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 text-sm text-zinc-400">
          {t("common.loading", "Chargement...")}
        </div>
      ) : (
        <div className="grid min-h-0 gap-4 overflow-y-auto lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
            <div className="mb-2 text-sm font-semibold text-zinc-100">Source adverse</div>
            {enemyHistoryModal.enemyDefense?.imageUrl || enemyHistoryModal.enemyDefense?.image_url ? (
              <img
                src={enemyHistoryModal.enemyDefense.imageUrl || enemyHistoryModal.enemyDefense.image_url}
                alt="Defense adverse"
                className="h-52 w-full rounded-lg border border-zinc-800 object-cover"
              />
            ) : (
              <div className="flex h-52 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-xs text-zinc-500">
                Image adverse indisponible
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {(enemyHistoryModal.enemyDefense?.heroes || []).map((hero, index) => (
                <span
                  key={`${hero.champion || "hero"}-${index}`}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
                >
                  {formatEnemyHeroLine(hero, index)}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {enemyHistoryModal.primaryStat ? (
              <div className={`rounded-xl border p-4 ${getEnemyRateToneClass(enemyHistoryModal.primaryStat)}`}>
                <div className="text-xs uppercase tracking-[0.16em] opacity-75">Taux de défaite</div>
                <div className="mt-1 text-3xl font-bold">
                  {formatEnemyPercent(enemyHistoryModal.primaryStat.successRate ?? enemyHistoryModal.primaryStat.success_rate)}
                </div>
                <div className="mt-2 text-sm">
                  {(enemyHistoryModal.primaryStat.displayName || enemyHistoryModal.primaryStat.guildCode || "Guilde source")} ·{" "}
                  {Number(enemyHistoryModal.primaryStat.opened) || 0}/{Number(enemyHistoryModal.primaryStat.encounters) || 0} ouvertes · derniere rencontre{" "}
                  {formatEnemyDate(enemyHistoryModal.primaryStat.lastSeenAt || enemyHistoryModal.primaryStat.last_seen_at)}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 text-sm text-zinc-400">
                Aucune statistique disponible pour cette defense adverse.
              </div>
            )}

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
              <div className="mb-3 text-sm font-semibold text-zinc-100">Stats par guilde</div>
              {(enemyHistoryModal.crossGuildStats || []).length === 0 ? (
                <div className="text-sm text-zinc-400">Aucune autre guilde rencontree.</div>
              ) : (
                <div className="grid gap-2">
                  {(enemyHistoryModal.crossGuildStats || []).map((stat) => (
                    <div
                      key={`${stat.portalGuildId || stat.portal_guild_id}-${stat.guildCode || stat.guild_code}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
                    >
                      <span className="font-semibold text-zinc-100">
                        {stat.displayName || stat.display_name || stat.guildCode || stat.guild_code || "Guilde"}
                      </span>
                      <span className="text-zinc-300">
                        {Number(stat.opened) || 0}/{Number(stat.encounters) || 0} · {formatEnemyPercent(stat.successRate ?? stat.success_rate)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
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
