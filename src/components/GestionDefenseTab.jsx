import React, { useState } from "react";
import { supabase } from "@/lib/supabase";
import MonSuiviTab from "./MonSuiviTab";
import { usePortalLanguage } from "@/lib/portalLanguage";
import {
  getMemberDefenseCompletion,
  getMemberTrackedDefenseScore,
  getDefenseConditionRequirements,
  getDefenseAwakeningScore,
} from "@/calculations";

export default function GestionDefenseTab({
  members = [],
  allMembers = [],
  activeGuildCode = "G1",
  trackedMetaDefense,
  setTrackedMetaDefense,
  metaDefenseCounters = [],
  setTodoMember,
  setVerifyMember,
  validateMember,
  openTransferDialog,
  setTransferDialogOpen,
  setMemberToTransfer,
  setTargetGuildCode,
  setMemberAssignment,
  defenses = [],
  clearAssignedDefense,
  cleanAssignedDefenses,
  assignDefense,
  setSelectedId,
  isAdmin = false,
  setDefenseVote,
  defenseLikesCountByRootId,
  defenseDislikesCountByRootId,
  defenseVoteByRootId,
  getDefenseLikeTargetId,
}) {
  const { t } = usePortalLanguage();
  const bastionNumbers = [1, 2, 3, 4];
  const towerNumbers = [1, 2, 3, 4, 5];
  const assignmentZones = [
    { type: "Bastion", number: 1, code: "B1" },
    { type: "Bastion", number: 2, code: "B2" },
    { type: "Bastion", number: 3, code: "B3" },
    { type: "Bastion", number: 4, code: "B4" },
    { type: "Bulle", number: null, code: "BB" },
  ];

  const parseAssignment = (value) => {
    const text = String(value || "").trim();
    const normalized = text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    const compact = normalized.replace(/[_-]+/g, " ");
    const numberMatch = compact.match(/\b([1-5])\b/);
    const towerNumberMatch = compact.match(/\b(?:tour|tower|t)\s*([1-5])\b/);
    const zoneBastionMatch =
      compact.match(/\bb\s*([1-4])\b/) ||
      compact.match(/\bbastion\s*([1-4])\b/);
    const hasBubbleZone = /\bbb\b|\bbulle\b|\bbubble\b/.test(compact);
    const hasTower = compact.includes("tour") || compact.includes("tower") || /\bt\s*[1-5]\b/.test(compact);
    const zoneType = hasBubbleZone ? "Bulle" : zoneBastionMatch ? "Bastion" : null;
    const zoneNumber = zoneType === "Bastion" ? Number(zoneBastionMatch[1]) : null;
    const zoneCode = zoneType === "Bulle" ? "BB" : zoneNumber ? `B${zoneNumber}` : null;

    if (hasBubbleZone && hasTower) {
      return {
        type: "Bulle",
        number: towerNumberMatch ? Number(towerNumberMatch[1]) : numberMatch ? Number(numberMatch[1]) : null,
        zoneType: "Bulle",
        zoneNumber: null,
        zoneCode: "BB",
        bubblePosition: "Tour",
      };
    }

    if (hasBubbleZone && normalized.includes("bastion")) {
      return {
        type: "Bulle",
        number: null,
        zoneType: "Bulle",
        zoneNumber: null,
        zoneCode: "BB",
        bubblePosition: "Bastion",
      };
    }

    if (hasTower) {
      return {
        type: "Tour",
        number: towerNumberMatch ? Number(towerNumberMatch[1]) : numberMatch ? Number(numberMatch[1]) : null,
        zoneType,
        zoneNumber,
        zoneCode,
      };
    }

    if (normalized.includes("bastion")) {
      return {
        type: "Bastion",
        number: numberMatch ? Number(numberMatch[1]) : null,
        zoneType: null,
        zoneNumber: null,
        zoneCode: null,
      };
    }
    if (normalized.includes("bulle") || normalized.includes("bubble")) {
      return {
        type: "Bulle",
        number: null,
        zoneType: "Bulle",
        zoneNumber: null,
        zoneCode: "BB",
        bubblePosition: null,
      };
    }

    return {
      type: "Tour",
      number: numberMatch ? Number(numberMatch[1]) : null,
      zoneType: null,
      zoneNumber: null,
      zoneCode: null,
    };
  };

  const buildAssignmentValue = (draft) => {
    const type = draft?.type || "Tour";
    const number = draft?.number;

    const parsedNumber = Number(number);

    if (type === "Bulle") {
      if (draft?.bubblePosition === "Bastion") return "BB Bastion";
      if (parsedNumber >= 1 && parsedNumber <= 5) return `BB Tour ${parsedNumber}`;
      return "Bulle";
    }

    if (type === "Bastion") {
      return parsedNumber >= 1 && parsedNumber <= 4 ? `Bastion ${parsedNumber}` : "Bastion";
    }

    const zoneCode =
      draft?.zoneType === "Bulle"
        ? "BB"
        : Number(draft?.zoneNumber) >= 1 && Number(draft?.zoneNumber) <= 4
        ? `B${Number(draft.zoneNumber)}`
        : "";

    const towerLabel = parsedNumber >= 1 && parsedNumber <= 5 ? `Tour ${parsedNumber}` : "Tour";
    return zoneCode ? `${zoneCode} ${towerLabel}` : towerLabel;
  };

  const formatDefenseTypeLabel = (value) => {
    const parsedAssignment = parseAssignment(value);
    const normalizedType = parsedAssignment.type.toLowerCase();

    if (normalizedType === "tour") {
      const label = t("defenses.tower", "Tour");
      const towerLabel = parsedAssignment.number ? `${label} ${parsedAssignment.number}` : label;
      return parsedAssignment.zoneCode ? `${parsedAssignment.zoneCode} ${towerLabel}` : towerLabel;
    }
    if (normalizedType === "bastion") {
      const label = t("defenses.bastion", "Bastion");
      return parsedAssignment.number ? `${label} ${parsedAssignment.number}` : label;
    }
    if (normalizedType === "bulle") {
      if (parsedAssignment.bubblePosition === "Bastion") {
        return `BB ${t("defenses.bastion", "Bastion")}`;
      }
      if (parsedAssignment.bubblePosition === "Tour") {
        const label = t("defenses.tower", "Tour");
        return parsedAssignment.number ? `BB ${label} ${parsedAssignment.number}` : `BB ${label}`;
      }
      return t("defenses.bubble", "Bulle");
    }
    return value || "";
  };
  const formatDefenseStatusLabel = (value) => {
    const normalizedStatus = String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();

    if (normalizedStatus.includes("valid")) return t("guildManagement.statusValid", "Valide");
    if (normalizedStatus.includes("verifier")) return t("guildManagement.statusVerify", "A verifier");
    if (normalizedStatus.includes("faire")) return t("guildManagement.statusTodo", "A faire");
    return value || "";
  };
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [memberView, setMemberView] = useState("defenses");
  const [roleSortMode, setRoleSortMode] = useState("alpha");
  const [defenseListFilter, setDefenseListFilter] = useState("tour");
  const [assignmentModalMember, setAssignmentModalMember] = useState(null);
  const [assignmentDraft, setAssignmentDraft] = useState({
    type: "Tour",
    number: 1,
    zoneType: "Bastion",
    zoneNumber: 1,
    bubblePosition: "Tour",
  });

  const [infoModalOpen, setInfoModalOpen] = useState(false);
const [infoDefense, setInfoDefense] = useState(null);
const [infoBlocks, setInfoBlocks] = useState([]);
const [infoBlocksLoading, setInfoBlocksLoading] = useState(false);

const openDefenseInfoModal = async (defense) => {
  if (!defense?.id) return;

  setInfoDefense(defense);
  setInfoModalOpen(true);
  setInfoBlocksLoading(true);

  const { data, error } = await supabase
    .from("guild_defense_blocks")
    .select("id, block_type, content, sort_order")
    .eq("defense_id", defense.id)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Erreur chargement infos défense:", error);
    setInfoBlocks([]);
  } else {
    setInfoBlocks(data || []);
  }

  setInfoBlocksLoading(false);
};

const metaSList = metaDefenseCounters.filter(
  (counter) => counter.tier === "meta_s"
);

const metaAList = metaDefenseCounters.filter(
  (counter) => counter.tier === "meta_a"
);



  const truncate = (text) => {
    if (!text) return "--";
    return text.length > 10 ? `${text.slice(0, 10)}…` : text;
  };

  const gaugeColor = (value) => {
    if (value === 100) return "bg-emerald-400";
    if (value === 50) return "bg-amber-400";
    return "bg-zinc-600";
  };

  const statusClass = (status) => {
    if (status === "Validé") {
      return "rounded-xl bg-emerald-500/15 text-emerald-300";
    }
    if (status === "À vérifier") {
      return "rounded-xl bg-amber-500/15 text-amber-300";
    }
    return "rounded-xl bg-red-500/15 text-red-300";
  };

const cycleRoleSortMode = () => {
  setRoleSortMode((prev) => {
    if (prev === "alpha") return "tour_first";
    if (prev === "tour_first") return "bastion_first";
    if (prev === "bastion_first") return "bubble_first";
    return "alpha";
  });
};

  const selectedMember = allMembers.find((m) => m.id === selectedMemberId);
  const isDetailView = selectedMemberId && selectedMember;
  const session = JSON.parse(
  localStorage.getItem("guildDashboardSession") || "{}"
);

const canEditSelectedMember =
  isAdmin || String(session?.memberId) === String(selectedMember?.id);

const getDefenseHeroes = (defense) =>
  (defense?.slots || [])
    .map((slot) => (typeof slot === "string" ? slot : slot?.hero || null))
    .filter(Boolean);

const selectedDefenseNames = [
  selectedMember?.defense1,
  selectedMember?.defense2,
].filter((name) => name && name !== "--" && name !== "—");

const selectedDefenseHeroes = defenses
  .filter((defense) => selectedDefenseNames.includes(defense.name))
  .flatMap(getDefenseHeroes);

const selectedHeroSet = new Set(selectedDefenseHeroes);

const availableDefenses = defenses
  .filter((defense) => {
    if (selectedDefenseNames.includes(defense.name)) return false;

    if (defenseListFilter === "all") return true;

    if (defenseListFilter === "bastion") {
      return (defense.type || "").toLowerCase() === "bastion";
    }

    return (defense.type || "").toLowerCase() === "tour";
  })
  .map((defense) => {
    const heroes = getDefenseHeroes(defense);
    const duplicateHeroes = heroes.filter((hero) => selectedHeroSet.has(hero));

    return {
      ...defense,
      duplicateHeroes,
      duplicateCount: duplicateHeroes.length,
    };
  })
  .sort((a, b) => {
    if (a.duplicateCount !== b.duplicateCount) {
      return a.duplicateCount - b.duplicateCount;
    }

    const scoreA = getMemberTrackedDefenseScore(selectedMember, a) ?? 0;
    const scoreB = getMemberTrackedDefenseScore(selectedMember, b) ?? 0;

    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }

    return String(a.name || "").localeCompare(String(b.name || ""), "fr", {
      sensitivity: "base",
    });
  });



const displayedMembers = [...members].sort((a, b) => {
  if (roleSortMode === "alpha") {
    return a.name.localeCompare(b.name);
  }

  const assignmentA = parseAssignment(a.assignment);
  const assignmentB = parseAssignment(b.assignment);

  const getZoneRank = (assignment) => {
    if (assignment.type === "Tour") {
      if (assignment.zoneType === "Bastion" && assignment.zoneNumber) {
        return assignment.zoneNumber;
      }
      if (assignment.zoneType === "Bulle") return 5;
      return 99;
    }

    if (assignment.type === "Bastion" && assignment.number) {
      return assignment.number;
    }

    if (assignment.type === "Bulle") {
      if (assignment.bubblePosition === "Bastion") return 0;
      if (assignment.bubblePosition === "Tour") return 1;
      return 5;
    }
    return 99;
  };

  const orderByMode = {
    tour_first: { Tour: 0, Bulle: 1, Bastion: 2 },
    bastion_first: { Bastion: 0, Tour: 1, Bulle: 2 },
    bubble_first: { Bulle: 0, Tour: 1, Bastion: 2 },
  };
  const order = orderByMode[roleSortMode] || orderByMode.tour_first;
  const typeRankA = order[assignmentA.type] ?? 99;
  const typeRankB = order[assignmentB.type] ?? 99;

  if (typeRankA !== typeRankB) {
    return typeRankA - typeRankB;
  }

  const zoneRankA = getZoneRank(assignmentA);
  const zoneRankB = getZoneRank(assignmentB);

  if (zoneRankA !== zoneRankB) {
    return zoneRankA - zoneRankB;
  }

  const numberA = assignmentA.number ?? 99;
  const numberB = assignmentB.number ?? 99;

  if (numberA !== numberB) {
    return numberA - numberB;
  }

  return a.name.localeCompare(b.name);
});

const openAssignmentModal = (member) => {
  const parsedAssignment = parseAssignment(member.assignment);
  setAssignmentModalMember(member);
  setAssignmentDraft({
    type: parsedAssignment.type,
    number: parsedAssignment.number || 1,
    zoneType: parsedAssignment.zoneType || "Bastion",
    zoneNumber: parsedAssignment.zoneType === "Bulle" ? null : parsedAssignment.zoneNumber || 1,
    bubblePosition: parsedAssignment.bubblePosition || "Tour",
  });
};

const updateAssignmentType = (nextType) => {
  setAssignmentDraft((previous) => {
    if (nextType === "Tour") {
      const nextNumber =
        Number(previous.number) >= 1 && Number(previous.number) <= 5
          ? Number(previous.number)
          : 1;
      const nextZoneType = previous.zoneType || "Bastion";

      return {
        ...previous,
        type: "Tour",
        number: nextNumber,
        zoneType: nextZoneType,
        zoneNumber:
          nextZoneType === "Bulle"
            ? null
            : Number(previous.zoneNumber) >= 1 && Number(previous.zoneNumber) <= 4
            ? Number(previous.zoneNumber)
            : 1,
        bubblePosition: "Tour",
      };
    }

    if (nextType === "Bastion") {
      return {
        ...previous,
        type: "Bastion",
        number:
          Number(previous.number) >= 1 && Number(previous.number) <= 4
            ? Number(previous.number)
            : 1,
        zoneType: "Bastion",
        zoneNumber: 1,
        bubblePosition: "Tour",
      };
    }

    return {
      ...previous,
      type: "Bulle",
      number:
        Number(previous.number) >= 1 && Number(previous.number) <= 5
          ? Number(previous.number)
          : 1,
      zoneType: "Bulle",
      zoneNumber: null,
      bubblePosition: previous.bubblePosition || "Tour",
    };
  });
};

const saveAssignmentDraft = async () => {
  if (!assignmentModalMember || !setMemberAssignment) return;

  const nextAssignment = buildAssignmentValue(assignmentDraft);
  const saved = await setMemberAssignment(assignmentModalMember.id, nextAssignment);
  if (saved !== false) {
    setAssignmentModalMember(null);
  }
};

return (
  <div className="space-y-6">
    {isDetailView ? (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div className="text-xl font-semibold text-white">
            {selectedMember.name}
          </div>

          <button
            onClick={() => {
              setSelectedMemberId(null);
              setMemberView("defenses");
            }}
            className="text-sm text-zinc-400 hover:text-white"
          >
            ← {t("common.back", "Retour")}
          </button>
        </div>

        <div className="flex gap-4 border-b border-zinc-800 pb-2">
          <button
            onClick={() => setMemberView("defenses")}
            className={
              memberView === "defenses"
                ? "border-b-2 border-white pb-1 text-white"
                : "pb-1 text-zinc-400 hover:text-white"
            }
          >
            {t("defenses.title", "Mes defenses")}
          </button>

          <button
            onClick={() => setMemberView("followup")}
            className={
              memberView === "followup"
                ? "border-b-2 border-white pb-1 text-white"
                : "pb-1 text-zinc-400 hover:text-white"
            }
          >
            {t("guildManagement.followup", "Mon suivi")}
          </button>
        </div>

        {memberView === "defenses" && canEditSelectedMember && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => clearAssignedDefense(1)}
              className="rounded-xl border border-red-700 bg-red-900/30 px-3 py-1 text-xs text-red-300 hover:bg-red-800/50"
            >
              {t("defenses.clearDefense", "Clean Def")} 1
            </button>

            <button
              type="button"
              onClick={() => clearAssignedDefense(2)}
              className="rounded-xl border border-red-700 bg-red-900/30 px-3 py-1 text-xs text-red-300 hover:bg-red-800/50"
            >
              {t("defenses.clearDefense", "Clean Def")} 2
            </button>
          </div>
        )}

          {memberView === "defenses" ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {[selectedMember.defense1, selectedMember.defense2].map((defName, index) => {
                  const defense = defenses.find((d) => d.name === defName);

                  const missingHeroes = defense
                    ? (defense.slots || [])
                        .map((slot) => (typeof slot === "string" ? slot : slot?.hero || null))
                        .filter(
                          (heroName) =>
                            heroName &&
                            (selectedMember?.awakenings?.[heroName] ?? -1) === -1
                        )
                    : [];

                  const missingConditions = defense
                    ? getDefenseConditionRequirements(defense).filter(
                        (requirement) =>
                          (selectedMember?.awakenings?.[requirement.hero] ?? -1) <
                          requirement.minAwakening
                      )
                    : [];

                  const hasError =
                    missingHeroes.length > 0 || missingConditions.length > 0;

                  const isMetaS = metaSList.some((m) => m.name === defName);
                  const isMetaA = metaAList.some((m) => m.name === defName);

                  let cardColor = "bg-zinc-900 border-zinc-800";

                  let defenseBadge = t("defenses.secondary", "Secondaire");
                  let defenseBadgeClass = "bg-zinc-800 text-zinc-300";

                  if (isMetaS) {
                    defenseBadge = "Meta S";
                    defenseBadgeClass = "bg-blue-500/20 text-blue-300";
                  } else if (isMetaA) {
                    defenseBadge = "Meta A";
                    defenseBadgeClass = "bg-emerald-500/20 text-emerald-300";
                  }
                    let typeBadge = formatDefenseTypeLabel("Tour");
                    let typeBadgeClass = "bg-zinc-800 text-zinc-300";

                    if ((defense?.type || "").toLowerCase() === "bastion") {
                      typeBadge = formatDefenseTypeLabel("Bastion");
                      typeBadgeClass = "bg-violet-500/20 text-violet-300";
                    }
                  if (hasError) {
                    cardColor = "bg-red-500/10 border-red-500/30";
                  } else if (isMetaS) {
                    cardColor = "bg-blue-500/10 border-blue-500/30";
                  } else if (isMetaA) {
                    cardColor = "bg-emerald-500/10 border-emerald-500/30";
                  }

                  return (
                    <div
                      key={index}
                      className={`rounded-2xl border p-5 ${cardColor}`}
                    >
<div className="mb-3 flex items-center justify-between">
  <div className="text-sm text-zinc-400">
    {t("defenses.defense", "Defense")} {index + 1}
  </div>

  <div className="flex flex-wrap items-center gap-2">

{defense && (
  <div className="flex items-center gap-1 mr-2">
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setDefenseVote(defense, 1);
      }}
      className={`text-xs ${
        defenseVoteByRootId?.get(getDefenseLikeTargetId(defense)) === 1
          ? "text-emerald-400"
          : "text-zinc-500"
      }`}
    >
      👍 {defenseLikesCountByRootId?.get(getDefenseLikeTargetId(defense)) || 0}
    </button>

    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setDefenseVote(defense, -1);
      }}
      className={`text-xs ${
        defenseVoteByRootId?.get(getDefenseLikeTargetId(defense)) === -1
          ? "text-red-400"
          : "text-zinc-500"
      }`}
    >
      👎 {defenseDislikesCountByRootId?.get(getDefenseLikeTargetId(defense)) || 0}
    </button>
  </div>
)}
    <div className={`rounded-lg px-2 py-1 text-xs ${defenseBadgeClass}`}>
      {defenseBadge}
    </div>

    <div className={`rounded-lg px-2 py-1 text-xs ${typeBadgeClass}`}>
      {typeBadge}
    </div>

{defense && canEditSelectedMember && (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      if (!clearAssignedDefense) return;
      clearAssignedDefense(index + 1);
    }}
    className="rounded-lg bg-red-500/20 px-2 py-1 text-xs text-red-300 hover:bg-red-500/30"
    title={t("defenses.removeDefense", "Retirer cette defense")}
  >
    -
  </button>
)}
  </div>
</div>

                      {!defense ? (
                        <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-950/60 p-6 text-sm text-zinc-500">
                          {t("defenses.noneSelected", "Aucune defense selectionnee")}
                        </div>
                      ) : (
                        <>
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
  <div className="font-medium text-white">{defense.name}</div>

  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      openDefenseInfoModal(defense);
    }}
    className="rounded-lg border border-blue-700 bg-blue-900/30 px-2 py-1 text-xs text-blue-300 hover:bg-blue-800/50"
  >
    {t("adminDefenses.infoButton", "Infos")}
  </button>
</div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="flex min-h-[180px] items-center justify-center overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
                              {defense.image ? (
                                <img
                                  src={defense.image}
                                  alt={defense.name}
                                  className="w-full aspect-video object-contain"
                                />
                              ) : (
                                <div className="text-sm text-zinc-500">{t("common.noImage", "Aucune image")}</div>
                              )}
                            </div>

                            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                {t("defenses.heroesAwakenings", "Heros / Eveils")}
                              </div>

                              <div className="space-y-2">
                                {(defense.slots || []).map((slot, i) => {
                                  const heroName =
                                    typeof slot === "string" ? slot : slot?.hero || "—";

                                  const awakening =
                                    selectedMember?.awakenings?.[heroName] ?? -1;

                                  return (
                                    <div
                                      key={`${defense.id}-${heroName}-${i}`}
                                      className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2"
                                    >
                                      <div className="truncate text-sm text-zinc-100">
                                        {heroName}
                                      </div>

                                      <div
                                        className={`ml-3 rounded-lg px-2 py-1 text-xs ${
                                          awakening === -1
                                            ? "bg-red-500/20 text-red-300"
                                            : "bg-emerald-500/20 text-emerald-300"
                                        }`}
                                      >
                                        {awakening === -1 ? "✖" : `A${awakening}`}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 space-y-2">
                            <div className="flex items-start justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
                              <span className="text-sm text-zinc-400">{t("defenses.conditions", "Conditions")}</span>

                              <span
                                className={`ml-4 text-right text-sm ${
                                  missingConditions.length === 0 ? "text-emerald-300" : "text-red-300"
                                }`}
                              >
                                {missingConditions.length === 0
                                  ? "OK"
                                  : missingConditions
                                      .map(
                                        (requirement) =>
                                          `${requirement.hero} A${requirement.minAwakening}`
                                      )
                                      .join(", ")}
                              </span>
                            </div>

<div className="flex items-start justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
  <span className="text-sm text-zinc-400">{t("defenses.awakeningScore", "Score d'eveil")}</span>

  <span className="ml-4 text-right text-sm text-zinc-100">
    {getMemberTrackedDefenseScore(selectedMember, defense) ?? "--"}
  </span>
</div>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

<div className="border-t border-zinc-800 pt-6">
  <div className="mb-4 flex items-center justify-between gap-4">
    <div className="text-lg font-semibold text-zinc-50">
      {t("defenses.defenseList", "Liste des defenses")}
    </div>

    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => setDefenseListFilter("tour")}
        className={`rounded-xl px-3 py-2 text-sm ${
          defenseListFilter === "tour"
            ? "bg-zinc-100 text-zinc-950"
            : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
        }`}
      >
        {t("defenses.towers", "Tours")}
      </button>

      <button
        type="button"
        onClick={() => setDefenseListFilter("bastion")}
        className={`rounded-xl px-3 py-2 text-sm ${
          defenseListFilter === "bastion"
            ? "bg-zinc-100 text-zinc-950"
            : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
        }`}
      >
        {t("defenses.bastions", "Bastions")}
      </button>

      <button
        type="button"
        onClick={() => setDefenseListFilter("all")}
        className={`rounded-xl px-3 py-2 text-sm ${
          defenseListFilter === "all"
            ? "bg-zinc-100 text-zinc-950"
            : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
        }`}
      >
        {t("common.allPlural", "Toutes")}
      </button>
    </div>
  </div>

<div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
  {availableDefenses.map((defense) => {
    const missingHeroes = (defense.slots || [])
      .map((slot) => (typeof slot === "string" ? slot : slot?.hero || null))
      .filter(
        (heroName) =>
          heroName &&
          (selectedMember?.awakenings?.[heroName] ?? -1) === -1
      );

    const missingConditions = getDefenseConditionRequirements(defense).filter(
      (requirement) =>
        (selectedMember?.awakenings?.[requirement.hero] ?? -1) <
        requirement.minAwakening
    );

    const hasError =
      missingHeroes.length > 0 || missingConditions.length > 0;

    const isMetaS = metaSList.some((m) => m.name === defense.name);
    const isMetaA = metaAList.some((m) => m.name === defense.name);

    let cardColor = "bg-zinc-900 border-zinc-800";

    let defenseBadge = t("defenses.secondary", "Secondaire");
    let defenseBadgeClass = "bg-zinc-800 text-zinc-300";

    if (isMetaS) {
      defenseBadge = "Meta S";
      defenseBadgeClass = "bg-blue-500/20 text-blue-300";
    } else if (isMetaA) {
      defenseBadge = "Meta A";
      defenseBadgeClass = "bg-emerald-500/20 text-emerald-300";
    }

        let typeBadge = formatDefenseTypeLabel("Tour");
        let typeBadgeClass = "bg-zinc-800 text-zinc-300";

        if ((defense?.type || "").toLowerCase() === "bastion") {
          typeBadge = formatDefenseTypeLabel("Bastion");
          typeBadgeClass = "bg-violet-500/20 text-violet-300";
        }

    if (hasError) {
      cardColor = "bg-red-500/10 border-red-500/30";
    } else if (isMetaS) {
      cardColor = "bg-blue-500/10 border-blue-500/30";
    } else if (isMetaA) {
      cardColor = "bg-emerald-500/10 border-emerald-500/30";
    }

    return (
      <div
        key={defense.id}
        className={`rounded-2xl border p-5 ${cardColor}`}
      >
<div className="mb-3 flex items-center justify-between">
  <div className="text-sm text-zinc-400">{defense.name}</div>
{defense.duplicateCount > 0 ? (
  <div className="mt-1 text-xs text-amber-300">
    {t("defenses.duplicate", "Doublon")} : {defense.duplicateHeroes.join(", ")}
  </div>
) : (
  <div className="mt-1 text-xs text-emerald-300">
    {t("defenses.noDuplicate", "Aucun doublon heros")}
  </div>
)}
  <div className="flex flex-wrap items-center gap-2">

    {/* 👍 👎 */}
    <div className="flex items-center gap-1 mr-2">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setDefenseVote(defense, 1);
        }}
        className={`text-xs ${
          defenseVoteByRootId?.get(getDefenseLikeTargetId(defense)) === 1
            ? "text-emerald-400"
            : "text-zinc-500"
        }`}
        title={t("guildManagement.likeDefense", "Liker cette defense")}
      >
        👍 {defenseLikesCountByRootId?.get(getDefenseLikeTargetId(defense)) || 0}
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setDefenseVote(defense, -1);
        }}
        className={`text-xs ${
          defenseVoteByRootId?.get(getDefenseLikeTargetId(defense)) === -1
            ? "text-red-400"
            : "text-zinc-500"
        }`}
        title={t("guildManagement.dislikeDefense", "Disliker cette defense")}
      >
        👎 {defenseDislikesCountByRootId?.get(getDefenseLikeTargetId(defense)) || 0}
      </button>
    </div>

    <div className={`rounded-lg px-2 py-1 text-xs ${defenseBadgeClass}`}>
      {defenseBadge}
    </div>

    <div className={`rounded-lg px-2 py-1 text-xs ${typeBadgeClass}`}>
      {typeBadge}
    </div>

    {isAdmin && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!assignDefense || !selectedMember) return;

          const isEmptyDefense = (value) =>
            !value || value === "--" || value === "—";

          const defense1Empty = isEmptyDefense(selectedMember.defense1);
          const defense2Empty = isEmptyDefense(selectedMember.defense2);

          if (defense1Empty) {
            assignDefense(1, defense, selectedMember.id);
            return;
          }

          if (defense2Empty) {
            assignDefense(2, defense, selectedMember.id);
            return;
          }
        }}
        className="rounded-lg bg-emerald-500/20 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/30"
        title={t("defenses.addDefense", "Ajouter cette defense")}
      >
        +
      </button>
    )}
  </div>
</div>


        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex min-h-[180px] items-center justify-center overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
            {defense.image ? (
              <img
                src={defense.image}
                alt={defense.name}
                className="w-full aspect-video object-contain"
              />
            ) : (
              <div className="text-sm text-zinc-500">{t("common.noImage", "Aucune image")}</div>
            )}
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {t("defenses.heroesAwakenings", "Heros / Eveils")}
            </div>

            <div className="space-y-2">
              {(defense.slots || []).map((slot, i) => {
                const heroName =
                  typeof slot === "string" ? slot : slot?.hero || "—";

                const awakening =
                  selectedMember?.awakenings?.[heroName] ?? -1;

                return (
                  <div
                    key={`${defense.id}-${heroName}-${i}`}
                    className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2"
                  >
                    <div className="truncate text-sm text-zinc-100">
                      {heroName}
                    </div>

                    <div
                      className={`ml-3 rounded-lg px-2 py-1 text-xs ${
                        awakening === -1
                          ? "bg-red-500/20 text-red-300"
                          : "bg-emerald-500/20 text-emerald-300"
                      }`}
                    >
                      {awakening === -1 ? "✖" : `A${awakening}`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-start justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
            <span className="text-sm text-zinc-400">{t("defenses.conditions", "Conditions")}</span>

            <span
              className={`ml-4 text-right text-sm ${
                missingConditions.length === 0 ? "text-emerald-300" : "text-red-300"
              }`}
            >
              {missingConditions.length === 0
                ? "OK"
                : missingConditions
                    .map(
                      (requirement) =>
                        `${requirement.hero} A${requirement.minAwakening}`
                    )
                    .join(", ")}
            </span>
          </div>

<div className="flex items-start justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
  <span className="text-sm text-zinc-400">{t("defenses.awakeningScore", "Score d'eveil")}</span>

  <span className="ml-4 text-right text-sm text-zinc-100">
    {getMemberTrackedDefenseScore(selectedMember, defense) ?? "--"}
  </span>
</div>
        </div>
      </div>
    );
  })}
</div>
</div>
            </div>
          ) : (
            <MonSuiviTab selectedMember={selectedMember} />
          )}
        </div>
      ) : (
        <>
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-5 shadow-2xl">
            <div className="space-y-4">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Meta S
                </div>
                <div className="flex flex-wrap gap-2">
                  {metaSList.map((def) => {
                    const count = members.filter(
                      (m) => m.defense1 === def.name || m.defense2 === def.name
                    ).length;

                    return (
                      <div
                        key={def.id}
                        className={`flex items-center gap-1 rounded-2xl border px-3 py-2 text-xs ${
                          trackedMetaDefense?.id === def.id
                            ? "border-amber-400 bg-amber-500/10"
                            : "border-zinc-800 bg-zinc-900"
                        }`}
                      >
                        <button
                          type="button"
                          className={`text-yellow-400 ${
                            trackedMetaDefense?.id === def.id ? "scale-110" : ""
                          }`}
                          onClick={() => {
                            if (!setTrackedMetaDefense) return;
                            setTrackedMetaDefense(
                              trackedMetaDefense?.id === def.id ? null : String(def.id)
                            );
                          }}
                        >
                          ★
                        </button>

                        <span
                          className="max-w-[90px] truncate text-zinc-100"
                          title={def.name}
                        >
                          {truncate(def.name)}
                        </span>

                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] ${
                            count === 0
                              ? "bg-red-500/20 text-red-300"
                              : "bg-emerald-500/20 text-emerald-300"
                          }`}
                        >
                          {count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-zinc-800 pt-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Meta A
                </div>
                <div className="flex flex-wrap gap-2">
                  {metaAList.map((def) => {
                    const count = members.filter(
                      (m) => m.defense1 === def.name || m.defense2 === def.name
                    ).length;

                    return (
                      <div
                        key={def.id}
                        className={`flex items-center gap-1 rounded-2xl border px-3 py-2 text-xs ${
                          trackedMetaDefense?.id === def.id
                            ? "border-amber-400 bg-amber-500/10"
                            : "border-zinc-800 bg-zinc-900"
                        }`}
                      >
                        <button
                          type="button"
                          className={`text-yellow-400 ${
                            trackedMetaDefense?.id === def.id ? "scale-110" : ""
                          }`}
                          onClick={() => {
                            if (!setTrackedMetaDefense) return;
                            setTrackedMetaDefense(
                              trackedMetaDefense?.id === def.id ? null : String(def.id)
                            );
                          }}
                        >
                          ★
                        </button>

                        <span
                          className="max-w-[90px] truncate text-zinc-100"
                          title={def.name}
                        >
                          {truncate(def.name)}
                        </span>

                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] ${
                            count === 0
                              ? "bg-red-500/20 text-red-300"
                              : "bg-emerald-500/20 text-emerald-300"
                          }`}
                        >
                          {count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-5 shadow-2xl">
            <div className="mb-4 text-lg font-semibold text-zinc-50">
              {t("guildManagement.memberList", "Liste des membres")} {activeGuildCode}
            </div>

            <div className="overflow-hidden rounded-2xl border border-zinc-800">
              <div className="grid grid-cols-[200px_220px_140px_200px_100px_140px_100px] gap-3 border-b border-zinc-800 px-5 py-4 text-xs uppercase tracking-[0.2em] text-zinc-500">
                <div>{t("common.player", "Joueur")}</div>
                <div>{t("guildManagement.def1Def2", "Def1 / Def2")}</div>
                <button
  type="button"
  onClick={cycleRoleSortMode}
  className="text-left hover:text-white"
>
  {t("guildManagement.role", "Role")}
  <span className="ml-2 text-[10px] text-zinc-400">
    {roleSortMode === "alpha"
      ? "A→Z"
      : roleSortMode === "tour_first"
      ? t("defenses.towers", "Tours")
      : roleSortMode === "bastion_first"
      ? t("defenses.bastions", "Bastions")
      : t("defenses.bubbles", "Bulles")}
  </span>
</button>
                <div>{t("guildManagement.completion", "Completion")}</div>
                <div>{t("guildManagement.score", "Score")}</div>
                <div>{t("guildManagement.status", "Statut")}</div>
                <div>{t("guildManagement.transfer", "Transfert")}</div>
              </div>

<div className="divide-y divide-zinc-800">
  {displayedMembers.map((member) => {
    const completion = trackedMetaDefense
      ? getMemberDefenseCompletion(member, trackedMetaDefense)
      : 0;

    const hasTrackedDefense =
      trackedMetaDefense &&
      (member.defense1 === trackedMetaDefense.name ||
        member.defense2 === trackedMetaDefense.name);

    return (
      <button
        key={member.id}
        type="button"
onClick={() => {
  const parsedMemberAssignment = parseAssignment(member.assignment);
  setSelectedMemberId(member.id);
  if (setSelectedId) setSelectedId(member.id);
  setMemberView("defenses");

  setDefenseListFilter(
    parsedMemberAssignment.type === "Bastion" ||
      (parsedMemberAssignment.type === "Bulle" && parsedMemberAssignment.bubblePosition === "Bastion")
      ? "bastion"
      : "tour"
  );
}}
        className={`grid w-full grid-cols-[200px_220px_140px_200px_100px_140px_100px] items-center gap-3 px-5 py-4 text-left hover:bg-zinc-900 ${
          hasTrackedDefense
            ? "bg-emerald-500/10"
            : selectedMemberId === member.id
            ? "bg-zinc-800/60"
            : ""
        }`}
      >
        <div className="font-medium text-zinc-50">{member.name}</div>

        <div className="text-xs text-zinc-300 leading-tight">
          <div>{member.defense1 || "--"}</div>
          <div className="text-zinc-500">{member.defense2 || "--"}</div>
        </div>

<div>
  {isAdmin ? (
    <div
      onClick={(e) => {
        e.stopPropagation();
        openAssignmentModal(member);
      }}
      className="inline-flex cursor-pointer rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-800"
    >
      {formatDefenseTypeLabel(member.assignment || "Tour")}
    </div>
  ) : (
    <div className="inline-flex rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1 text-sm text-zinc-400">
      {formatDefenseTypeLabel(member.assignment || "Tour")}
    </div>
  )}
</div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="h-2 w-full rounded-full bg-zinc-800">
            <div
              className={`h-2 rounded-full ${gaugeColor(completion)}`}
              style={{ width: `${completion}%` }}
            />
          </div>
          <span className="text-sm text-zinc-300">{completion}%</span>
        </div>

        <div className="text-zinc-100">
          {trackedMetaDefense
            ? getMemberTrackedDefenseScore(member, trackedMetaDefense) ?? "--"
            : "--"}
        </div>

<div>
  {isAdmin ? (
    <div
      onClick={(e) => {
        e.stopPropagation();

        if (member.status === "À faire") {
          setVerifyMember(member.id);
        } else if (member.status === "À vérifier") {
          validateMember(member.id);
        } else {
          setTodoMember(member.id);
        }
      }}
      className={`inline-flex cursor-pointer px-2 py-1 text-xs ${statusClass(
        member.status
      )}`}
    >
      {formatDefenseStatusLabel(member.status)}
    </div>
  ) : (
    <div className={`inline-flex px-2 py-1 text-xs ${statusClass(member.status)}`}>
      {formatDefenseStatusLabel(member.status)}
    </div>
  )}
</div>

<div>
  {isAdmin ? (
    <div
      onClick={(e) => {
        e.stopPropagation();
        if (!setMemberToTransfer || !setTransferDialogOpen) return;
        setMemberToTransfer(member);
        if (setTargetGuildCode) setTargetGuildCode("");
        setTransferDialogOpen(true);
      }}
      className="flex cursor-pointer flex-col items-center gap-1 text-lg text-amber-300 hover:text-amber-200"
    >
      <span>⬆️</span>
      <span>⬇️</span>
    </div>
  ) : null}
</div>
      </button>
    );
  })}
</div>
            </div>
          </div>
        </>
      )}
      {assignmentModalMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-white shadow-2xl">
            <div className="mb-5">
              <div className="text-lg font-semibold">
                {t("guildManagement.assignmentModalTitle", "Position defense")}
              </div>
              <div className="mt-1 text-sm text-zinc-400">
                {assignmentModalMember.name}
              </div>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="text-sm text-zinc-400">
                  {t("guildManagement.assignmentType", "Categorie")}
                </span>
                <select
                  value={assignmentDraft.type}
                  onChange={(event) => updateAssignmentType(event.target.value)}
                  className="mt-2 h-11 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-emerald-400/60"
                >
                  <option value="Tour">{t("defenses.tower", "Tour")}</option>
                  <option value="Bastion">{t("defenses.bastion", "Bastion")}</option>
                  <option value="Bulle">{t("defenses.bubble", "Bulle")}</option>
                </select>
              </label>

              {assignmentDraft.type === "Tour" ? (
                <div>
                  <div className="text-sm text-zinc-400">
                    {t("guildManagement.assignmentZone", "Zone")}
                  </div>
                  <div className="mt-2 grid grid-cols-5 gap-2">
                    {assignmentZones.map((zone) => (
                      <button
                        key={zone.code}
                        type="button"
                        onClick={() =>
                          setAssignmentDraft((previous) => ({
                            ...previous,
                            zoneType: zone.type,
                            zoneNumber: zone.number,
                          }))
                        }
                        className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                          assignmentDraft.zoneType === zone.type &&
                          Number(assignmentDraft.zoneNumber || 0) === Number(zone.number || 0)
                            ? "border-emerald-300/70 bg-emerald-500/15 text-emerald-100"
                            : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:text-white"
                        }`}
                      >
                        {zone.code}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {assignmentDraft.type === "Bulle" ? (
                <div>
                  <div className="text-sm text-zinc-400">
                    {t("guildManagement.assignmentBubblePosition", "Position bulle")}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {[
                      {
                        id: "Bastion",
                        label: `BB ${t("defenses.bastion", "Bastion")}`,
                      },
                      {
                        id: "Tour",
                        label: `BB ${t("defenses.tower", "Tour")}`,
                      },
                    ].map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() =>
                          setAssignmentDraft((previous) => ({
                            ...previous,
                            bubblePosition: option.id,
                            number:
                              option.id === "Tour"
                                ? Number(previous.number) >= 1 && Number(previous.number) <= 5
                                  ? Number(previous.number)
                                  : 1
                                : 1,
                          }))
                        }
                        className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                          assignmentDraft.bubblePosition === option.id
                            ? "border-emerald-300/70 bg-emerald-500/15 text-emerald-100"
                            : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:text-white"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {assignmentDraft.type !== "Bulle" ||
              (assignmentDraft.type === "Bulle" && assignmentDraft.bubblePosition === "Tour") ? (
                <div>
                  <div className="text-sm text-zinc-400">
                    {assignmentDraft.type === "Tour" ||
                    (assignmentDraft.type === "Bulle" && assignmentDraft.bubblePosition === "Tour")
                      ? t("guildManagement.assignmentTowerNumber", "Numero de tour")
                      : t("guildManagement.assignmentNumber", "Numero")}
                  </div>
                  <div
                    className={`mt-2 grid gap-2 ${
                      assignmentDraft.type === "Tour" ||
                      (assignmentDraft.type === "Bulle" && assignmentDraft.bubblePosition === "Tour")
                        ? "grid-cols-5"
                        : "grid-cols-4"
                    }`}
                  >
                    {(assignmentDraft.type === "Tour" ||
                    (assignmentDraft.type === "Bulle" && assignmentDraft.bubblePosition === "Tour")
                      ? towerNumbers
                      : bastionNumbers
                    ).map((number) => (
                      <button
                        key={number}
                        type="button"
                        onClick={() =>
                          setAssignmentDraft((previous) => ({
                            ...previous,
                            number,
                          }))
                        }
                        className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                          Number(assignmentDraft.number) === number
                            ? "border-emerald-300/70 bg-emerald-500/15 text-emerald-100"
                            : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:text-white"
                        }`}
                      >
                        {number}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAssignmentModalMember(null)}
                className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
              >
                {t("common.cancel", "Annuler")}
              </button>
              <button
                type="button"
                onClick={saveAssignmentDraft}
                className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
              >
                {t("common.save", "Enregistrer")}
              </button>
            </div>
          </div>
        </div>
      )}
      {infoModalOpen && infoDefense && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-white">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-bold">{infoDefense.name}</div>
          <div className="text-sm text-zinc-400">{t("adminDefenses.defenseInfo", "Informations defense")}</div>
        </div>

        <button
          type="button"
          onClick={() => setInfoModalOpen(false)}
          className="rounded-xl border border-zinc-700 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          {t("common.close", "Fermer")}
        </button>
      </div>

      <div className="min-h-0 overflow-y-auto rounded-xl bg-zinc-950 p-4">
        {infoBlocksLoading ? (
          <div className="text-sm text-zinc-400">{t("common.loading", "Chargement...")}</div>
        ) : infoBlocks.length === 0 ? (
          <div className="text-sm text-zinc-500">
            {t("adminDefenses.noInfo", "Aucune information disponible pour cette defense.")}
          </div>
        ) : (
          <div className="space-y-5 leading-relaxed text-zinc-200">
            {infoBlocks.map((block) =>
              block.block_type === "image" ? (
                <img
                  key={block.id}
                  src={block.content}
                  alt={t("adminDefenses.infoImageAlt", "Info defense")}
                  className="mx-auto max-h-[420px] w-full rounded-xl object-contain"
                />
              ) : (
                <div
                  key={block.id}
                  className="whitespace-pre-wrap text-sm md:text-base"
                >
                  {block.content}
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  </div>
)}
    </div>
  );
}
