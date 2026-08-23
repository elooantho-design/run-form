import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Info,
  Search,
  Shield,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buildChampionDisplayMap, translateChampionName } from "@/lib/championDisplay";
import { getGuildDisplayName } from "@/lib/guildDisplay";
import {
  isPaladinGuildCode,
  isSameGuildSpace,
  normalizeGuildCodeKey,
} from "@/lib/guildScope";
import {
  getDefenseConditionRequirements,
  getDefenseRootId,
  getMemberDefenseCompletion,
  getMemberTrackedDefenseScore,
  normalizeDefenseTier,
} from "@/calculations";
import { resolveDefenseVariantsForGuild } from "@/lib/defenseVariants";
import { usePortalLanguage } from "@/lib/portalLanguage";

const EMPTY_DEFENSE = "--";

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getSessionGuildCode(session) {
  return session?.guildCode || session?.guild_code || "G1";
}

function isEmptyDefenseName(value) {
  const normalized = String(value || "").trim();
  return !normalized || normalized === "--" || normalized === "—" || normalized === "â€”";
}

function getSlotHeroName(slot) {
  return typeof slot === "string" ? slot : slot?.hero || "";
}

function getDefenseLikeTargetId(defense) {
  return getDefenseRootId(defense);
}

function defenseMatchesMemberGuild(defense, memberGuildCode) {
  const memberIsPaladin = isPaladinGuildCode(memberGuildCode);

  if (defense.isGlobal || !defense.guildCode) return memberIsPaladin;
  if (memberIsPaladin) {
    return normalizeGuildCodeKey(defense.guildCode) === normalizeGuildCodeKey(memberGuildCode);
  }

  return isSameGuildSpace(defense.guildCode, memberGuildCode);
}

function getDefenseTypeLabel(defense) {
  return normalizeText(defense?.type).includes("bastion") ? "Bastion" : "Tour";
}

function getTierTone(defense) {
  const tier = normalizeDefenseTier(defense?.tier);

  if (tier === "meta_s") {
    return {
      label: "Meta S",
      card: "border-sky-400/40 bg-sky-500/10",
      badge: "border-sky-300/30 bg-sky-300/12 text-sky-100",
    };
  }

  if (tier === "meta_a") {
    return {
      label: "Meta A",
      card: "border-emerald-400/40 bg-emerald-500/10",
      badge: "border-emerald-300/30 bg-emerald-300/12 text-emerald-100",
    };
  }

  if (tier === "meta") {
    return {
      label: "Meta",
      card: "border-violet-400/35 bg-violet-500/10",
      badge: "border-violet-300/30 bg-violet-300/12 text-violet-100",
    };
  }

  return {
    label: "Secondaire",
    card: "border-zinc-700 bg-zinc-950/72",
    badge: "border-zinc-700 bg-zinc-900 text-zinc-300",
  };
}

function getCompatibilityState(member, defense) {
  const completion = getMemberDefenseCompletion(member, defense);

  if (completion === 100) {
    return {
      label: "Compatible",
      detail: "Tous les heros et conditions sont OK.",
      card: "border-emerald-400/30 bg-emerald-500/8",
      badge: "border-emerald-300/30 bg-emerald-300/12 text-emerald-100",
      icon: CheckCircle2,
    };
  }

  if (completion === 50) {
    return {
      label: "Conditions",
      detail: "Heros presents, conditions d'eveil a verifier.",
      card: "border-amber-400/30 bg-amber-500/8",
      badge: "border-amber-300/30 bg-amber-300/12 text-amber-100",
      icon: Info,
    };
  }

  return {
    label: "Incomplet",
    detail: "Il manque au moins un heros pour cette defense.",
    card: "border-red-400/30 bg-red-500/8",
    badge: "border-red-300/30 bg-red-300/12 text-red-100",
    icon: XCircle,
  };
}

async function postPortalAccess(action, payload = {}) {
  const response = await fetch("/api/portal-access", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `HTTP ${response.status}`);
  }
  return data;
}

export default function MyDefensesTab({ session }) {
  const { language, t } = usePortalLanguage();
  const [members, setMembers] = useState([]);
  const [selectedMemberId, setSelectedMemberId] = useState(session?.memberId || session?.id || "");
  const [memberQuery, setMemberQuery] = useState("");
  const [memberAwakeningsByMemberId, setMemberAwakeningsByMemberId] = useState({});
  const [defenses, setDefenses] = useState([]);
  const [defenseVotes, setDefenseVotes] = useState([]);
  const [defenseQuery, setDefenseQuery] = useState("");
  const [defenseTypeFilter, setDefenseTypeFilter] = useState("tour");
  const [loading, setLoading] = useState(true);
  const [savingSlot, setSavingSlot] = useState("");
  const [voteSavingId, setVoteSavingId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [championDisplayMap, setChampionDisplayMap] = useState(() => new Map());

  const guildCode = getSessionGuildCode(session);
  const guildDisplayName = getGuildDisplayName({
    guildCode,
    emptyFallback: t("common.community", "Communauté"),
  });
  const connectedMemberId = session?.memberId || session?.id || "";

  const selectedMemberBase = useMemo(() => {
    return members.find((item) => String(item.id) === String(selectedMemberId)) || members[0] || null;
  }, [members, selectedMemberId]);

  const member = useMemo(() => {
    if (!selectedMemberBase) return null;
    return {
      ...selectedMemberBase,
      awakenings: memberAwakeningsByMemberId[String(selectedMemberBase.id)] || {},
    };
  }, [memberAwakeningsByMemberId, selectedMemberBase]);

  const memberSuggestions = useMemo(() => {
    const search = normalizeText(memberQuery);

    return members
      .filter((item) => {
        if (!search) return true;
        return normalizeText(`${item.name} ${item.discordId} ${item.guildCode}`).includes(search);
      })
      .slice(0, 8);
  }, [memberQuery, members]);

  const canEdit = useMemo(() => {
    if (typeof member?.permissions?.canEdit === "boolean") return member.permissions.canEdit;
    return Boolean(member?.id && connectedMemberId && String(member.id) === String(connectedMemberId));
  }, [connectedMemberId, member?.id, member?.permissions?.canEdit]);

  const memberDefenses = useMemo(() => {
    const memberGuildCode = member?.guildCode || guildCode;

    return resolveDefenseVariantsForGuild(
      defenses.filter((defense) => defenseMatchesMemberGuild(defense, memberGuildCode)),
      memberGuildCode,
    );
  }, [defenses, guildCode, member?.guildCode]);

  const selectedDefenseNames = useMemo(() => {
    return [member?.defense1, member?.defense2].filter((name) => !isEmptyDefenseName(name));
  }, [member?.defense1, member?.defense2]);

  const selectedHeroSet = useMemo(() => {
    return new Set(
      memberDefenses
        .filter((defense) => selectedDefenseNames.includes(defense.name))
        .flatMap((defense) => (defense.slots || []).map(getSlotHeroName).filter(Boolean))
    );
  }, [memberDefenses, selectedDefenseNames]);

  const defenseLikesCountByRootId = useMemo(() => {
    const counts = new Map();

    defenseVotes.forEach((vote) => {
      if (vote.value !== 1) return;
      counts.set(vote.defenseId, (counts.get(vote.defenseId) || 0) + 1);
    });

    return counts;
  }, [defenseVotes]);

  const defenseDislikesCountByRootId = useMemo(() => {
    const counts = new Map();

    defenseVotes.forEach((vote) => {
      if (vote.value !== -1) return;
      counts.set(vote.defenseId, (counts.get(vote.defenseId) || 0) + 1);
    });

    return counts;
  }, [defenseVotes]);

  const defenseVoteByRootId = useMemo(() => {
    if (!connectedMemberId) return new Map();

    const votes = new Map();

    defenseVotes
      .filter((vote) => String(vote.memberId) === String(connectedMemberId))
      .forEach((vote) => {
        votes.set(vote.defenseId, vote.value);
      });

    return votes;
  }, [connectedMemberId, defenseVotes]);

  const assignedDefenses = useMemo(() => {
    return [member?.defense1, member?.defense2].map((defenseName, index) => ({
      slot: index + 1,
      defenseName,
      defense: memberDefenses.find((item) => item.name === defenseName) || null,
    }));
  }, [member?.defense1, member?.defense2, memberDefenses]);

  const availableDefenses = useMemo(() => {
    const search = normalizeText(defenseQuery);

    return memberDefenses
      .filter((defense) => !selectedDefenseNames.includes(defense.name))
      .filter((defense) => {
        if (defenseTypeFilter === "all") return true;
        return normalizeText(defense.type).includes(defenseTypeFilter);
      })
      .filter((defense) => {
        if (!search) return true;
        const slots = (defense.slots || []).join(" ");
        return (
          normalizeText(defense.name).includes(search) ||
          normalizeText(defense.faction).includes(search) ||
          normalizeText(slots).includes(search)
        );
      })
      .map((defense) => {
        const duplicateHeroes = (defense.slots || [])
          .map(getSlotHeroName)
          .filter((heroName) => heroName && selectedHeroSet.has(heroName));

        return {
          ...defense,
          duplicateHeroes,
          duplicateCount: duplicateHeroes.length,
          score: getMemberTrackedDefenseScore(member, defense) ?? -1,
        };
      })
      .sort((a, b) => {
        if (a.duplicateCount !== b.duplicateCount) return a.duplicateCount - b.duplicateCount;
        if (a.score !== b.score) return b.score - a.score;
        return String(a.name || "").localeCompare(String(b.name || ""), "fr", { sensitivity: "base" });
      });
  }, [defenseQuery, defenseTypeFilter, member, memberDefenses, selectedDefenseNames, selectedHeroSet]);

  const summary = useMemo(() => {
    const filledSlots = assignedDefenses.filter((slot) => slot.defense).length;
    const compatibleSlots = assignedDefenses.filter(
      (slot) => slot.defense && getMemberDefenseCompletion(member, slot.defense) === 100
    ).length;
    const bestScore = assignedDefenses.reduce((best, slot) => {
      if (!slot.defense) return best;
      return Math.max(best, getMemberTrackedDefenseScore(member, slot.defense) ?? 0);
    }, 0);

    return { filledSlots, compatibleSlots, bestScore };
  }, [assignedDefenses, member]);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setErrorMessage("");
      const sessionWatcherName = session?.watcherName || session?.name || "";

      try {
        const payload = await postPortalAccess("my-defenses-load");

        if (cancelled) return;

        const mappedMembers = payload.members || [];
        if (mappedMembers.length === 0) {
          setMembers([]);
          setDefenses([]);
          setDefenseVotes([]);
          setErrorMessage("Aucun profil joueur trouve dans le cluster.");
          setLoading(false);
          return;
        }

        setMembers(mappedMembers);
        setDefenses(payload.defenses || []);
        setDefenseVotes(payload.defenseVotes || []);
        setChampionDisplayMap(buildChampionDisplayMap(payload.champions || []));
        const normalizedSessionName = normalizeText(sessionWatcherName);
        const selectedMember =
          mappedMembers.find((item) => String(item.id) === String(connectedMemberId)) ||
          mappedMembers.find((item) => normalizedSessionName && normalizeText(item.name) === normalizedSessionName) ||
          mappedMembers[0] ||
          null;

        setSelectedMemberId(selectedMember?.id || "");
        setDefenseTypeFilter(normalizeText(selectedMember?.assignment).includes("bastion") ? "bastion" : "tour");
        setLoading(false);
      } catch (error) {
        if (cancelled) return;
        console.error("Erreur chargement mes defenses:", error);
        setErrorMessage(error?.message || "Impossible de charger tes defenses pour le moment.");
        setMembers([]);
        setDefenses([]);
        setDefenseVotes([]);
        setLoading(false);
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, [connectedMemberId, session]);

  useEffect(() => {
    if (!selectedMemberBase?.id) {
      return;
    }

    let cancelled = false;

    async function loadSelectedMemberAwakenings() {
      try {
        const payload = await postPortalAccess("member-awakenings-load", {
          memberId: selectedMemberBase.id,
        });

        if (cancelled) return;

        setMemberAwakeningsByMemberId((previous) => ({
          ...previous,
          [String(selectedMemberBase.id)]: payload.awakenings || {},
        }));
      } catch (error) {
        if (cancelled) return;
        console.error("Erreur chargement eveils defenses:", error);
        setMemberAwakeningsByMemberId((previous) => ({
          ...previous,
          [String(selectedMemberBase.id)]: {},
        }));
      }
    }

    loadSelectedMemberAwakenings();

    return () => {
      cancelled = true;
    };
  }, [selectedMemberBase?.id]);

  async function assignDefense(slot, defense) {
    if (!member?.id || !defense?.name || !canEdit) return;

    const localKey = slot === 1 ? "defense1" : "defense2";
    setSavingSlot(`${slot}-${defense.id}`);
    setErrorMessage("");

    try {
      const payload = await postPortalAccess("member-defense-assign", {
        memberId: member.id,
        slot,
        defenseName: defense.name,
      });

      const updatedMember = payload.member || {};
      setMembers((previous) =>
        previous.map((item) =>
          String(item.id) === String(member.id)
            ? { ...item, ...updatedMember, [localKey]: updatedMember[localKey] || defense.name }
            : item
        )
      );
    } catch (error) {
      console.error("Erreur assignation defense:", error);
      setErrorMessage(error?.message || "Impossible d'assigner cette defense.");
    } finally {
      setSavingSlot("");
    }
  }

  async function clearAssignedDefense(slot) {
    if (!member?.id || !canEdit) return;

    const localKey = slot === 1 ? "defense1" : "defense2";
    setSavingSlot(`clear-${slot}`);
    setErrorMessage("");

    try {
      const payload = await postPortalAccess("member-defense-assign", {
        memberId: member.id,
        slot,
        defenseName: EMPTY_DEFENSE,
      });

      const updatedMember = payload.member || {};
      setMembers((previous) =>
        previous.map((item) =>
          String(item.id) === String(member.id)
            ? { ...item, ...updatedMember, [localKey]: updatedMember[localKey] || EMPTY_DEFENSE }
            : item
        )
      );
    } catch (error) {
      console.error("Erreur suppression defense:", error);
      setErrorMessage(error?.message || "Impossible de retirer cette defense.");
    } finally {
      setSavingSlot("");
    }
  }

  async function setDefenseVote(defense, value) {
    if (!connectedMemberId || !defense) return;

    const targetDefenseId = getDefenseLikeTargetId(defense);
    if (!targetDefenseId) return;

    setVoteSavingId(`${targetDefenseId}-${value}`);

    try {
      const payload = await postPortalAccess("defense-vote", {
        defenseId: targetDefenseId,
        value,
      });
      setDefenseVotes(payload.defenseVotes || []);
    } catch (error) {
      console.error("Erreur vote defense:", error);
    } finally {
      setVoteSavingId("");
    }
  }

  function assignToFirstFreeSlot(defense) {
    if (isEmptyDefenseName(member?.defense1)) {
      assignDefense(1, defense);
      return;
    }

    if (isEmptyDefenseName(member?.defense2)) {
      assignDefense(2, defense);
      return;
    }

    assignDefense(2, defense);
  }

  const voteProps = {
    likesByRootId: defenseLikesCountByRootId,
    dislikesByRootId: defenseDislikesCountByRootId,
    voteByRootId: defenseVoteByRootId,
    savingId: voteSavingId,
    onVote: setDefenseVote,
  };

  if (loading) {
    return (
      <Card className="rounded-[1.1rem] border-zinc-800 bg-zinc-950/86">
        <CardContent className="p-6 text-sm text-zinc-400">{t("defenses.loading", "Chargement de tes defenses...")}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[1.35rem] border border-pink-500/35 bg-zinc-950 p-6 shadow-[0_0_38px_rgba(236,72,153,0.16)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(236,72,153,0.24),transparent_34%),radial-gradient(circle_at_86%_20%,rgba(168,85,247,0.18),transparent_28%),linear-gradient(135deg,rgba(10,10,12,0.2),rgba(39,7,24,0.46))]" />
        <div className="relative z-10 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-pink-200">
              {t("defenses.playerSpace", "Espace joueur")}
            </p>
            <h2 className="mt-3 text-3xl font-semibold text-white md:text-4xl">
              {t("defenses.title", "Mes defenses")}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300 md:text-base">
              {t("defenses.description", "Choisis tes deux defenses et verifie si ta box actuelle permet de les jouer.")}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 xl:min-w-[420px]">
            {[
              { label: "Slots", value: `${summary.filledSlots}/2`, icon: Shield },
              { label: "OK", value: `${summary.compatibleSlots}/2`, icon: CheckCircle2 },
              { label: t("defenses.maxScore", "Score max"), value: summary.bestScore || "-", icon: ThumbsUp },
            ].map((item) => {
              const Icon = item.icon;

              return (
                <div key={item.label} className="rounded-lg border border-white/10 bg-black/32 p-4">
                  <Icon className="h-4 w-4 text-pink-200" />
                  <div className="mt-3 text-2xl font-semibold text-white">{item.value}</div>
                  <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">{item.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {errorMessage ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {errorMessage}
        </div>
      ) : null}

      {!member ? (
        <Card className="rounded-[1.1rem] border-zinc-800 bg-zinc-950/86">
          <CardContent className="p-6 text-sm text-zinc-500">
            {t("defenses.noProfile", "Aucun profil joueur trouve pour cette session.")}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="rounded-[1.1rem] border-zinc-800 bg-zinc-950/86 shadow-2xl">
            <CardHeader className="border-b border-zinc-800">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <div className="text-2xl font-semibold text-zinc-50">{member.name}</div>
                  <div className="mt-1 text-sm text-zinc-500">
                    {member.assignment || "Tour"} - {t("defenses.openEdit", "edition ouverte")}
                  </div>
                  <Badge className="mt-3 w-fit rounded-lg border-zinc-700 bg-zinc-900 text-zinc-300">
                    {getGuildDisplayName({
                      guildCode: member.guildCode || guildCode,
                      emptyFallback: guildDisplayName,
                    })}
                  </Badge>
                </div>

                <div className="w-full max-w-xl">
                  <label className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500" htmlFor="defense-member-search">
                    {t("defenses.player", "Joueur")}
                  </label>
                  <div className="mt-2 flex h-10 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 ring-pink-400/25 transition focus-within:border-pink-400/60 focus-within:ring-2">
                    <Search className="h-4 w-4 shrink-0 text-zinc-500" />
                    <input
                      id="defense-member-search"
                      type="search"
                      value={memberQuery}
                      onChange={(event) => setMemberQuery(event.target.value)}
                      placeholder={t("heroBox.searchPlayer", "Rechercher un joueur")}
                      className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
                    />
                  </div>
                  <div className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/80 p-2">
                    {memberSuggestions.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-zinc-500">{t("defenses.noPlayer", "Aucun joueur trouve.")}</div>
                    ) : (
                      memberSuggestions.map((suggestion) => {
                        const selected = String(suggestion.id) === String(member.id);

                        return (
                          <button
                            key={suggestion.id}
                            type="button"
                            onClick={() => {
                              setSelectedMemberId(suggestion.id);
                              setMemberQuery(suggestion.name);
                              setDefenseTypeFilter(
                                normalizeText(suggestion.assignment).includes("bastion") ? "bastion" : "tour"
                              );
                            }}
                            className={`w-full rounded-md border px-3 py-2 text-left transition ${
                              selected
                                ? "border-pink-300/55 bg-pink-500/10 text-white"
                                : "border-transparent bg-zinc-900/70 text-zinc-300 hover:border-pink-400/35 hover:bg-zinc-900"
                            }`}
                          >
                            <span className="block truncate text-sm font-semibold">{suggestion.name}</span>
                            <span className="mt-0.5 block truncate text-xs text-zinc-500">
                              {getGuildDisplayName({
                                guildCode: suggestion.guildCode,
                                emptyFallback: t("common.community", "Communauté"),
                              })}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 p-5">
              <div className="grid gap-5 2xl:grid-cols-2">
                {assignedDefenses.map(({ slot, defenseName, defense }) => (
                  <AssignedDefenseCard
                    key={`${member.id}-${slot}-${defenseName}`}
                    defense={defense}
                    defenseName={defenseName}
                    member={member}
                    slot={slot}
                    canEdit={canEdit}
                    saving={savingSlot === `clear-${slot}`}
                    championDisplayMap={championDisplayMap}
                    language={language}
                    onClear={() => clearAssignedDefense(slot)}
                    voteProps={voteProps}
                  />
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[1.1rem] border-zinc-800 bg-zinc-950/86 shadow-2xl">
            <CardHeader className="border-b border-zinc-800">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <div className="text-lg font-semibold text-zinc-50">{t("defenses.choose", "Choisir une defense")}</div>
                  <div className="text-sm text-zinc-500">
                    {t("defenses.duplicates", "Les doublons de heros sont signales avant attribution.")}
                  </div>
                </div>

                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                  <div className="relative md:w-80">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                    <Input
                      value={defenseQuery}
                      onChange={(event) => setDefenseQuery(event.target.value)}
                      placeholder={t("defenses.search", "Rechercher une defense...")}
                      className="rounded-lg border-zinc-700 bg-zinc-900 pl-9 text-zinc-100"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: "tour", label: "Tours" },
                      { id: "bastion", label: "Bastions" },
                      { id: "all", label: t("common.all", "Toutes") },
                    ].map((filter) => (
                      <button
                        key={filter.id}
                        type="button"
                        onClick={() => setDefenseTypeFilter(filter.id)}
                        className={`rounded-lg px-3 py-2 text-sm transition ${
                          defenseTypeFilter === filter.id
                            ? "bg-zinc-100 text-zinc-950"
                            : "border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                        }`}
                      >
                        {filter.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5">
              <div className="grid gap-5 2xl:grid-cols-2">
                {availableDefenses.map((defense) => (
                  <AvailableDefenseCard
                    key={defense.id}
                    defense={defense}
                    member={member}
                    canEdit={canEdit}
                    saving={savingSlot === `1-${defense.id}` || savingSlot === `2-${defense.id}`}
                    championDisplayMap={championDisplayMap}
                    language={language}
                    onAssign={() => assignToFirstFreeSlot(defense)}
                    voteProps={voteProps}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

    </div>
  );
}

function AssignedDefenseCard({
  defense,
  defenseName,
  member,
  slot,
  canEdit,
  saving,
  championDisplayMap,
  language,
  onClear,
  voteProps,
}) {
  const { t } = usePortalLanguage();

  if (!defense) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/70 p-5">
        <div className="text-sm text-zinc-500">{t("defenses.defense", "Defense")} {slot}</div>
        <div className="mt-3 text-lg font-semibold text-zinc-200">
          {isEmptyDefenseName(defenseName) ? t("defenses.noneSelected", "Aucune defense selectionnee") : defenseName}
        </div>
        <div className="mt-3 text-sm text-zinc-500">
          {t("defenses.selectBelow", "Selectionne une defense dans la liste en dessous pour remplir ce slot.")}
        </div>
      </div>
    );
  }

  return (
    <DefenseCardShell defense={defense} member={member} voteProps={voteProps}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-zinc-500">{t("defenses.defense", "Defense")} {slot}</div>
          <div className="mt-1 text-xl font-semibold text-white">{defense.name}</div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {canEdit ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClear}
              disabled={saving}
              className="rounded-lg border-red-500/35 bg-red-500/10 text-red-200 hover:bg-red-500/20"
            >
              {t("common.remove", "Retirer")}
            </Button>
          ) : null}
        </div>
      </div>
      <DefenseBody defense={defense} member={member} championDisplayMap={championDisplayMap} language={language} />
    </DefenseCardShell>
  );
}

function AvailableDefenseCard({ defense, member, canEdit, saving, onAssign, voteProps, championDisplayMap, language }) {
  const { t } = usePortalLanguage();

  return (
    <DefenseCardShell defense={defense} member={member} voteProps={voteProps}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold text-white">{defense.name}</div>
          {defense.duplicateCount > 0 ? (
            <div className="mt-1 text-xs text-amber-300">
              {t("defenses.duplicate", "Doublon")} : {defense.duplicateHeroes.map((hero) => translateChampionName(hero, championDisplayMap, language)).join(", ")}
            </div>
          ) : (
            <div className="mt-1 text-xs text-emerald-300">{t("defenses.noDuplicate", "Aucun doublon heros")}</div>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {canEdit ? (
            <Button
              type="button"
              size="sm"
              onClick={onAssign}
              disabled={saving}
              className="rounded-lg bg-pink-500 text-white hover:bg-pink-400"
            >
              {t("common.add", "Ajouter")}
            </Button>
          ) : null}
        </div>
      </div>
      <DefenseBody defense={defense} member={member} championDisplayMap={championDisplayMap} language={language} />
    </DefenseCardShell>
  );
}

function DefenseCardShell({ defense, member, voteProps, children }) {
  const tierTone = getTierTone(defense);
  const typeLabel = getDefenseTypeLabel(defense);
  const compatibility = getCompatibilityState(member, defense);
  const CompatibilityIcon = compatibility.icon;

  return (
    <div className={`rounded-lg border p-5 ${tierTone.card} ${compatibility.card}`}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge className={`rounded-md ${tierTone.badge}`}>{tierTone.label}</Badge>
        <Badge className="rounded-md border-zinc-700 bg-zinc-900 text-zinc-300">{typeLabel}</Badge>
        {defense?.faction ? (
          <Badge className="rounded-md border-zinc-700 bg-zinc-900 text-zinc-300">{defense.faction}</Badge>
        ) : null}
        <Badge className={`ml-auto rounded-md ${compatibility.badge}`}>
          <CompatibilityIcon className="mr-1 h-3.5 w-3.5" />
          {compatibility.label}
        </Badge>
        <VoteControls defense={defense} voteProps={voteProps} />
      </div>
      {children}
      <DefenseInfoBlocks blocks={defense.infoBlocks} />
    </div>
  );
}

function DefenseInfoBlocks({ blocks }) {
  const { t } = usePortalLanguage();

  if (!blocks?.length) return null;

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-pink-300/20 bg-pink-500/8 p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-200">{t("defenses.info", "Infos defense")}</div>
      <div className="space-y-3 text-sm leading-6 text-zinc-200">
        {blocks.map((block) =>
          block.blockType === "image" ? (
            <img
              key={block.id}
              src={block.content}
              alt={t("defenses.info", "Info defense")}
              className="mx-auto max-h-[180px] w-full rounded-md object-contain"
            />
          ) : (
            <div key={block.id} className="whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
              {block.content}
            </div>
          )
        )}
      </div>
    </div>
  );
}

function VoteControls({ defense, voteProps }) {
  const targetDefenseId = getDefenseLikeTargetId(defense);
  const activeVote = voteProps.voteByRootId.get(targetDefenseId);
  const likes = voteProps.likesByRootId.get(targetDefenseId) || 0;
  const dislikes = voteProps.dislikesByRootId.get(targetDefenseId) || 0;

  return (
    <div className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950/80 p-1">
      <button
        type="button"
        onClick={() => voteProps.onVote(defense, 1)}
        disabled={voteProps.savingId === `${targetDefenseId}-1`}
        className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition ${
          activeVote === 1 ? "bg-emerald-500/20 text-emerald-200" : "text-zinc-500 hover:text-emerald-200"
        }`}
        title="J'aime cette defense"
      >
        <ThumbsUp className="h-3.5 w-3.5" />
        {likes}
      </button>
      <button
        type="button"
        onClick={() => voteProps.onVote(defense, -1)}
        disabled={voteProps.savingId === `${targetDefenseId}--1`}
        className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition ${
          activeVote === -1 ? "bg-red-500/20 text-red-200" : "text-zinc-500 hover:text-red-200"
        }`}
        title="Je n'aime pas cette defense"
      >
        <ThumbsDown className="h-3.5 w-3.5" />
        {dislikes}
      </button>
    </div>
  );
}

function DefenseBody({ defense, member, championDisplayMap, language }) {
  const { t } = usePortalLanguage();
  const missingConditions = getDefenseConditionRequirements(defense).filter(
    (requirement) => (member?.awakenings?.[requirement.hero] ?? -1) < requirement.minAwakening
  );
  const missingHeroes = (defense.slots || [])
    .map(getSlotHeroName)
    .filter((heroName) => heroName && (member?.awakenings?.[heroName] ?? -1) < 0);
  const score = getMemberTrackedDefenseScore(member, defense);

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1.05fr)_minmax(220px,0.95fr)]">
      <div className="flex min-h-[170px] items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-black/45">
        {defense.image ? (
          <img src={defense.image} alt={defense.name} className="max-h-[210px] w-full object-contain" />
        ) : (
          <div className="text-sm text-zinc-500">{t("defenses.noImage", "Aucune image")}</div>
        )}
      </div>

      <div className="space-y-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            {t("defenses.heroesAwakenings", "Heros / Eveils")}
          </div>
          <div className="space-y-2">
            {(defense.slots || []).map((slot, index) => {
              const heroName = getSlotHeroName(slot) || "-";
              const awakening = member?.awakenings?.[heroName] ?? -1;
              const owned = awakening >= 0;

              return (
                <div
                  key={`${defense.id}-${heroName}-${index}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2"
                >
                  <span className="min-w-0 truncate text-sm text-zinc-100">
                    {translateChampionName(heroName, championDisplayMap, language)}
                  </span>
                  <span
                    className={`shrink-0 rounded-md px-2 py-1 text-xs ${
                      owned ? "bg-emerald-500/16 text-emerald-200" : "bg-red-500/16 text-red-200"
                    }`}
                  >
                    {owned ? `A${awakening}` : <XCircle className="h-3.5 w-3.5" />}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid gap-2">
          <div className="flex items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
            <span className="text-sm text-zinc-400">{t("defenses.missingHeroes", "Heros manquants")}</span>
            <span className={`text-right text-sm ${missingHeroes.length === 0 ? "text-emerald-300" : "text-red-300"}`}>
              {missingHeroes.length === 0
                ? "OK"
                : missingHeroes.map((heroName) => translateChampionName(heroName, championDisplayMap, language)).join(", ")}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
            <span className="text-sm text-zinc-400">{t("defenses.conditions", "Conditions")}</span>
            <span className={`text-right text-sm ${missingConditions.length === 0 ? "text-emerald-300" : "text-red-300"}`}>
              {missingConditions.length === 0
                ? "OK"
                : missingConditions
                    .map(
                      (requirement) =>
                        `${translateChampionName(requirement.hero, championDisplayMap, language)} A${requirement.minAwakening}`,
                    )
                    .join(", ")}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
            <span className="text-sm text-zinc-400">{t("defenses.awakeningScore", "Score d'eveil")}</span>
            <span className="text-sm text-zinc-100">{score ?? "-"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
