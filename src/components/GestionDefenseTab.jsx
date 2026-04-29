import React, { useState } from "react";
import { supabase } from "@/lib/supabase";
import MonSuiviTab from "./MonSuiviTab";
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
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [memberView, setMemberView] = useState("defenses");
  const [roleSortMode, setRoleSortMode] = useState("alpha");
  const [defenseListFilter, setDefenseListFilter] = useState("tour");

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

  if (roleSortMode === "tour_first") {
    const order = { Tour: 0, Bulle: 1, Bastion: 2 };
    return (order[a.assignment] ?? 99) - (order[b.assignment] ?? 99);
  }

  if (roleSortMode === "bastion_first") {
    const order = { Bastion: 0, Tour: 1, Bulle: 2 };
    return (order[a.assignment] ?? 99) - (order[b.assignment] ?? 99);
  }

  return 0;
});

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
            ← Retour
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
            Mes défenses
          </button>

          <button
            onClick={() => setMemberView("followup")}
            className={
              memberView === "followup"
                ? "border-b-2 border-white pb-1 text-white"
                : "pb-1 text-zinc-400 hover:text-white"
            }
          >
            Mon suivi
          </button>
        </div>

        {memberView === "defenses" && canEditSelectedMember && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => clearAssignedDefense(1)}
              className="rounded-xl border border-red-700 bg-red-900/30 px-3 py-1 text-xs text-red-300 hover:bg-red-800/50"
            >
              Clean Def 1
            </button>

            <button
              type="button"
              onClick={() => clearAssignedDefense(2)}
              className="rounded-xl border border-red-700 bg-red-900/30 px-3 py-1 text-xs text-red-300 hover:bg-red-800/50"
            >
              Clean Def 2
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

                  let defenseBadge = "Secondaire";
                  let defenseBadgeClass = "bg-zinc-800 text-zinc-300";

                  if (isMetaS) {
                    defenseBadge = "Meta S";
                    defenseBadgeClass = "bg-blue-500/20 text-blue-300";
                  } else if (isMetaA) {
                    defenseBadge = "Meta A";
                    defenseBadgeClass = "bg-emerald-500/20 text-emerald-300";
                  }
                    let typeBadge = "Tour";
                    let typeBadgeClass = "bg-zinc-800 text-zinc-300";

                    if ((defense?.type || "").toLowerCase() === "bastion") {
                      typeBadge = "Bastion";
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
    Défense {index + 1}
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
    title="Retirer cette défense"
  >
    -
  </button>
)}
  </div>
</div>

                      {!defense ? (
                        <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-950/60 p-6 text-sm text-zinc-500">
                          Aucune défense sélectionnée
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
    💬 Infos
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
                                <div className="text-sm text-zinc-500">Aucune image</div>
                              )}
                            </div>

                            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                Héros / Éveils
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
                              <span className="text-sm text-zinc-400">Conditions</span>

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
  <span className="text-sm text-zinc-400">Score d’éveil</span>

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
      Liste des défenses
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
        Tours
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
        Bastions
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
        Toutes
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

    let defenseBadge = "Secondaire";
    let defenseBadgeClass = "bg-zinc-800 text-zinc-300";

    if (isMetaS) {
      defenseBadge = "Meta S";
      defenseBadgeClass = "bg-blue-500/20 text-blue-300";
    } else if (isMetaA) {
      defenseBadge = "Meta A";
      defenseBadgeClass = "bg-emerald-500/20 text-emerald-300";
    }

        let typeBadge = "Tour";
        let typeBadgeClass = "bg-zinc-800 text-zinc-300";

        if ((defense?.type || "").toLowerCase() === "bastion") {
          typeBadge = "Bastion";
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
    Doublon : {defense.duplicateHeroes.join(", ")}
  </div>
) : (
  <div className="mt-1 text-xs text-emerald-300">
    Aucun doublon héros
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
        title="Liker cette défense"
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
        title="Disliker cette défense"
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
        title="Ajouter cette défense"
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
              <div className="text-sm text-zinc-500">Aucune image</div>
            )}
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Héros / Éveils
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
            <span className="text-sm text-zinc-400">Conditions</span>

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
  <span className="text-sm text-zinc-400">Score d’éveil</span>

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
              Liste des membres {activeGuildCode}
            </div>

            <div className="overflow-hidden rounded-2xl border border-zinc-800">
              <div className="grid grid-cols-[200px_220px_140px_200px_100px_140px_100px] gap-3 border-b border-zinc-800 px-5 py-4 text-xs uppercase tracking-[0.2em] text-zinc-500">
                <div>Joueur</div>
                <div>Def1 / Def2</div>
                <button
  type="button"
  onClick={cycleRoleSortMode}
  className="text-left hover:text-white"
>
  Rôle
  <span className="ml-2 text-[10px] text-zinc-400">
    {roleSortMode === "alpha"
      ? "A→Z"
      : roleSortMode === "tour_first"
      ? "Tours"
      : "Bastions"}
  </span>
</button>
                <div>Complétion</div>
                <div>Score</div>
                <div>Statut</div>
                <div>Transfert</div>
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
  setSelectedMemberId(member.id);
  if (setSelectedId) setSelectedId(member.id);
  setMemberView("defenses");

  setDefenseListFilter(
    (member.assignment || "Tour") === "Bastion"
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
        if (!setMemberAssignment) return;

        const current = member.assignment || "Tour";
        const next =
          current === "Tour"
            ? "Bastion"
            : current === "Bastion"
            ? "Bulle"
            : "Tour";

        setMemberAssignment(member.id, next);
      }}
      className="inline-flex cursor-pointer rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-800"
    >
      {member.assignment || "Tour"}
    </div>
  ) : (
    <div className="inline-flex rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1 text-sm text-zinc-400">
      {member.assignment || "Tour"}
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
      {member.status}
    </div>
  ) : (
    <div className={`inline-flex px-2 py-1 text-xs ${statusClass(member.status)}`}>
      {member.status}
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
      {infoModalOpen && infoDefense && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-white">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-bold">{infoDefense.name}</div>
          <div className="text-sm text-zinc-400">Informations défense</div>
        </div>

        <button
          type="button"
          onClick={() => setInfoModalOpen(false)}
          className="rounded-xl border border-zinc-700 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          Fermer
        </button>
      </div>

      <div className="min-h-0 overflow-y-auto rounded-xl bg-zinc-950 p-4">
        {infoBlocksLoading ? (
          <div className="text-sm text-zinc-400">Chargement...</div>
        ) : infoBlocks.length === 0 ? (
          <div className="text-sm text-zinc-500">
            Aucune information disponible pour cette défense.
          </div>
        ) : (
          <div className="space-y-5 leading-relaxed text-zinc-200">
            {infoBlocks.map((block) =>
              block.block_type === "image" ? (
                <img
                  key={block.id}
                  src={block.content}
                  alt="Info défense"
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