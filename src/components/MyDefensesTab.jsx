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
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  getDefenseConditionRequirements,
  getDefenseRootId,
  getMemberDefenseCompletion,
  getMemberTrackedDefenseScore,
  normalizeDefenseTier,
} from "@/calculations";

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

function getSessionRole(session) {
  return normalizeText(session?.role || "");
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

export default function MyDefensesTab({ session }) {
  const [member, setMember] = useState(null);
  const [defenses, setDefenses] = useState([]);
  const [defenseVotes, setDefenseVotes] = useState([]);
  const [defenseQuery, setDefenseQuery] = useState("");
  const [defenseTypeFilter, setDefenseTypeFilter] = useState("tour");
  const [loading, setLoading] = useState(true);
  const [savingSlot, setSavingSlot] = useState("");
  const [voteSavingId, setVoteSavingId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [infoDefense, setInfoDefense] = useState(null);
  const [infoBlocks, setInfoBlocks] = useState([]);
  const [infoLoading, setInfoLoading] = useState(false);

  const guildCode = getSessionGuildCode(session);

  const isAdmin = useMemo(() => {
    const role = getSessionRole(session);
    return role.includes("admin") || role.includes("administrateur");
  }, [session]);

  const canEdit = useMemo(() => {
    if (!member?.id) return false;
    return isAdmin || String(member.id) === String(session?.memberId);
  }, [isAdmin, member?.id, session?.memberId]);

  const selectedDefenseNames = useMemo(() => {
    return [member?.defense1, member?.defense2].filter((name) => !isEmptyDefenseName(name));
  }, [member?.defense1, member?.defense2]);

  const selectedHeroSet = useMemo(() => {
    return new Set(
      defenses
        .filter((defense) => selectedDefenseNames.includes(defense.name))
        .flatMap((defense) => (defense.slots || []).map(getSlotHeroName).filter(Boolean))
    );
  }, [defenses, selectedDefenseNames]);

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
    if (!session?.memberId) return new Map();

    const votes = new Map();

    defenseVotes
      .filter((vote) => String(vote.memberId) === String(session.memberId))
      .forEach((vote) => {
        votes.set(vote.defenseId, vote.value);
      });

    return votes;
  }, [defenseVotes, session?.memberId]);

  const assignedDefenses = useMemo(() => {
    return [member?.defense1, member?.defense2].map((defenseName, index) => ({
      slot: index + 1,
      defenseName,
      defense: defenses.find((item) => item.name === defenseName) || null,
    }));
  }, [defenses, member?.defense1, member?.defense2]);

  const availableDefenses = useMemo(() => {
    const search = normalizeText(defenseQuery);

    return defenses
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
  }, [defenseQuery, defenseTypeFilter, defenses, member, selectedDefenseNames, selectedHeroSet]);

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

      const memberQuery = supabase
        .from("guild_members")
        .select(`
          id,
          watcher_name,
          discord_id,
          guild_code,
          assignment,
          status,
          defense_1,
          defense_2,
          member_awakenings (
            awakening_level,
            champion_id,
            champions (
              name
            )
          )
        `);

      let memberPromise;

      if (session?.memberId) {
        memberPromise = memberQuery.eq("id", session.memberId).maybeSingle();
      } else if (sessionWatcherName) {
        memberPromise = memberQuery
          .eq("guild_code", guildCode)
          .eq("watcher_name", sessionWatcherName)
          .maybeSingle();
      } else {
        memberPromise = memberQuery
          .eq("guild_code", guildCode)
          .order("watcher_name", { ascending: true })
          .limit(1)
          .maybeSingle();
      }

      const [memberResult, defensesResult, votesResult] = await Promise.all([
        memberPromise,
        supabase
          .from("guild_defenses")
          .select(`
            id,
            name,
            tier,
            type,
            faction,
            image_url,
            guild_code,
            is_global,
            source_defense_id,
            sort_order,
            created_at,
            guild_defense_slots (
              slot_index,
              champion_id,
              champions (
                name
              )
            ),
            guild_defense_conditions (
              id,
              champion_id,
              min_awakening,
              champions (
                name
              )
            )
          `)
          .or(`is_global.eq.true,guild_code.eq.${guildCode}`)
          .order("created_at", { ascending: true }),
        supabase.from("cluster_defense_likes").select("id, defense_id, member_id, value, created_at"),
      ]);

      if (cancelled) return;

      if (memberResult.error || defensesResult.error || votesResult.error) {
        console.error(
          "Erreur chargement mes defenses:",
          memberResult.error || defensesResult.error || votesResult.error
        );
        setErrorMessage("Impossible de charger tes defenses pour le moment.");
        setLoading(false);
        return;
      }

      const memberRow = memberResult.data;

      if (!memberRow) {
        setMember(null);
        setDefenses([]);
        setDefenseVotes([]);
        setErrorMessage("Aucun profil joueur trouve pour cette session.");
        setLoading(false);
        return;
      }

      const awakenings = {};

      (memberRow.member_awakenings || []).forEach((entry) => {
        const heroName = entry.champions?.name;
        if (heroName) {
          awakenings[heroName] = entry.awakening_level;
        }
      });

      const mappedMember = {
        id: memberRow.id,
        name: memberRow.watcher_name || "Joueur",
        discordId: memberRow.discord_id || "",
        guildCode: memberRow.guild_code || guildCode,
        assignment: memberRow.assignment || "Tour",
        status: memberRow.status || "A faire",
        defense1: memberRow.defense_1 || EMPTY_DEFENSE,
        defense2: memberRow.defense_2 || EMPTY_DEFENSE,
        awakenings,
      };

      const mappedDefenses = (defensesResult.data || [])
        .map((row) => {
          const slots = [...(row.guild_defense_slots || [])]
            .sort((a, b) => a.slot_index - b.slot_index)
            .map((slot) => slot.champions?.name || "")
            .filter(Boolean);

          const conditions = (row.guild_defense_conditions || []).map((condition) => ({
            id: condition.id,
            championId: condition.champion_id,
            minAwakening: condition.min_awakening,
            label: `${condition.champions?.name} A${condition.min_awakening} minimum`,
          }));

          return {
            id: row.id,
            name: row.name,
            tier: row.tier,
            type: row.type,
            faction: row.faction || "",
            guildCode: row.guild_code,
            isGlobal: row.is_global,
            sourceDefenseId: row.source_defense_id,
            sortOrder: row.sort_order ?? 9999,
            slots,
            conditions,
            image: row.image_url,
          };
        })
        .sort((a, b) => {
          if ((a.sortOrder ?? 9999) !== (b.sortOrder ?? 9999)) {
            return (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999);
          }

          return String(a.name || "").localeCompare(String(b.name || ""), "fr", { sensitivity: "base" });
        });

      const mappedVotes = (votesResult.data || []).map((row) => ({
        id: row.id,
        defenseId: row.defense_id,
        memberId: row.member_id,
        value: row.value,
        createdAt: row.created_at,
      }));

      setMember(mappedMember);
      setDefenses(mappedDefenses);
      setDefenseVotes(mappedVotes);
      setDefenseTypeFilter(normalizeText(mappedMember.assignment).includes("bastion") ? "bastion" : "tour");
      setLoading(false);
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, [guildCode, session?.memberId]);

  async function assignDefense(slot, defense) {
    if (!member?.id || !defense?.name || !canEdit) return;

    const column = slot === 1 ? "defense_1" : "defense_2";
    const localKey = slot === 1 ? "defense1" : "defense2";
    setSavingSlot(`${slot}-${defense.id}`);

    const { error } = await supabase
      .from("guild_members")
      .update({ [column]: defense.name })
      .eq("id", member.id);

    setSavingSlot("");

    if (error) {
      console.error("Erreur assignation defense:", error);
      setErrorMessage("Impossible d'assigner cette defense.");
      return;
    }

    setMember((previous) => (previous ? { ...previous, [localKey]: defense.name } : previous));
  }

  async function clearAssignedDefense(slot) {
    if (!member?.id || !canEdit) return;

    const column = slot === 1 ? "defense_1" : "defense_2";
    const localKey = slot === 1 ? "defense1" : "defense2";
    setSavingSlot(`clear-${slot}`);

    const { error } = await supabase
      .from("guild_members")
      .update({ [column]: EMPTY_DEFENSE })
      .eq("id", member.id);

    setSavingSlot("");

    if (error) {
      console.error("Erreur suppression defense:", error);
      setErrorMessage("Impossible de retirer cette defense.");
      return;
    }

    setMember((previous) => (previous ? { ...previous, [localKey]: EMPTY_DEFENSE } : previous));
  }

  async function setDefenseVote(defense, value) {
    if (!session?.memberId || !defense) return;

    const targetDefenseId = getDefenseLikeTargetId(defense);
    if (!targetDefenseId) return;

    const existingVote = defenseVotes.find(
      (vote) =>
        String(vote.defenseId) === String(targetDefenseId) &&
        String(vote.memberId) === String(session.memberId)
    );

    setVoteSavingId(`${targetDefenseId}-${value}`);

    if (existingVote) {
      if (existingVote.value === value) {
        const { error } = await supabase.from("cluster_defense_likes").delete().eq("id", existingVote.id);

        setVoteSavingId("");

        if (error) {
          console.error("Erreur suppression vote defense:", error);
          return;
        }

        setDefenseVotes((previous) => previous.filter((vote) => vote.id !== existingVote.id));
        return;
      }

      const { error } = await supabase
        .from("cluster_defense_likes")
        .update({ value })
        .eq("id", existingVote.id);

      setVoteSavingId("");

      if (error) {
        console.error("Erreur mise a jour vote defense:", error);
        return;
      }

      setDefenseVotes((previous) =>
        previous.map((vote) => (vote.id === existingVote.id ? { ...vote, value } : vote))
      );
      return;
    }

    const { data, error } = await supabase
      .from("cluster_defense_likes")
      .upsert(
        {
          defense_id: targetDefenseId,
          member_id: session.memberId,
          value,
        },
        { onConflict: "defense_id,member_id" }
      )
      .select()
      .single();

    setVoteSavingId("");

    if (error) {
      console.error("Erreur ajout vote defense:", error);
      return;
    }

    setDefenseVotes((previous) => [
      ...previous,
      {
        id: data.id,
        defenseId: data.defense_id,
        memberId: data.member_id,
        value: data.value,
        createdAt: data.created_at,
      },
    ]);
  }

  async function openDefenseInfo(defense) {
    if (!defense?.id) return;

    setInfoDefense(defense);
    setInfoBlocks([]);
    setInfoLoading(true);

    const { data, error } = await supabase
      .from("guild_defense_blocks")
      .select("id, block_type, content, sort_order")
      .eq("defense_id", defense.id)
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("Erreur infos defense:", error);
      setInfoBlocks([]);
    } else {
      setInfoBlocks(data || []);
    }

    setInfoLoading(false);
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
        <CardContent className="p-6 text-sm text-zinc-400">Chargement de tes defenses...</CardContent>
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
              Espace joueur
            </p>
            <h2 className="mt-3 text-3xl font-semibold text-white md:text-4xl">
              Mes defenses
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300 md:text-base">
              Choisis tes deux defenses et verifie si ta box actuelle permet de les jouer.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 xl:min-w-[420px]">
            {[
              { label: "Slots", value: `${summary.filledSlots}/2`, icon: Shield },
              { label: "OK", value: `${summary.compatibleSlots}/2`, icon: CheckCircle2 },
              { label: "Score max", value: summary.bestScore || "-", icon: ThumbsUp },
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
            Aucun profil joueur trouve pour cette session.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="rounded-[1.1rem] border-zinc-800 bg-zinc-950/86 shadow-2xl">
            <CardHeader className="border-b border-zinc-800">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-2xl font-semibold text-zinc-50">{member.name}</div>
                  <div className="mt-1 text-sm text-zinc-500">
                    {member.assignment || "Tour"} - {canEdit ? "Edition autorisee" : "Lecture seule"}
                  </div>
                </div>
                <Badge className="w-fit rounded-lg border-zinc-700 bg-zinc-900 text-zinc-300">
                  {guildCode}
                </Badge>
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
                    onClear={() => clearAssignedDefense(slot)}
                    onInfo={() => openDefenseInfo(defense)}
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
                  <div className="text-lg font-semibold text-zinc-50">Choisir une defense</div>
                  <div className="text-sm text-zinc-500">
                    Les doublons de heros sont signales avant attribution.
                  </div>
                </div>

                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                  <div className="relative md:w-80">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                    <Input
                      value={defenseQuery}
                      onChange={(event) => setDefenseQuery(event.target.value)}
                      placeholder="Rechercher une defense..."
                      className="rounded-lg border-zinc-700 bg-zinc-900 pl-9 text-zinc-100"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: "tour", label: "Tours" },
                      { id: "bastion", label: "Bastions" },
                      { id: "all", label: "Toutes" },
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
                    onAssign={() => assignToFirstFreeSlot(defense)}
                    onInfo={() => openDefenseInfo(defense)}
                    voteProps={voteProps}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={Boolean(infoDefense)} onOpenChange={(open) => !open && setInfoDefense(null)}>
        <DialogContent className="max-h-[86vh] max-w-3xl overflow-hidden border-zinc-800 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle>{infoDefense?.name || "Informations defense"}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[68vh] overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            {infoLoading ? (
              <div className="text-sm text-zinc-400">Chargement...</div>
            ) : infoBlocks.length === 0 ? (
              <div className="text-sm text-zinc-500">Aucune information disponible pour cette defense.</div>
            ) : (
              <div className="space-y-5 text-sm leading-6 text-zinc-200">
                {infoBlocks.map((block) =>
                  block.block_type === "image" ? (
                    <img
                      key={block.id}
                      src={block.content}
                      alt="Info defense"
                      className="mx-auto max-h-[420px] w-full rounded-lg object-contain"
                    />
                  ) : (
                    <div key={block.id} className="whitespace-pre-wrap">
                      {block.content}
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
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
  onClear,
  onInfo,
  voteProps,
}) {
  if (!defense) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/70 p-5">
        <div className="text-sm text-zinc-500">Defense {slot}</div>
        <div className="mt-3 text-lg font-semibold text-zinc-200">
          {isEmptyDefenseName(defenseName) ? "Aucune defense selectionnee" : defenseName}
        </div>
        <div className="mt-3 text-sm text-zinc-500">
          Selectionne une defense dans la liste en dessous pour remplir ce slot.
        </div>
      </div>
    );
  }

  return (
    <DefenseCardShell defense={defense} member={member} voteProps={voteProps}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-zinc-500">Defense {slot}</div>
          <div className="mt-1 text-xl font-semibold text-white">{defense.name}</div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onInfo}
            className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
          >
            <Info className="h-4 w-4" />
          </Button>
          {canEdit ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClear}
              disabled={saving}
              className="rounded-lg border-red-500/35 bg-red-500/10 text-red-200 hover:bg-red-500/20"
            >
              Retirer
            </Button>
          ) : null}
        </div>
      </div>
      <DefenseBody defense={defense} member={member} />
    </DefenseCardShell>
  );
}

function AvailableDefenseCard({ defense, member, canEdit, saving, onAssign, onInfo, voteProps }) {
  return (
    <DefenseCardShell defense={defense} member={member} voteProps={voteProps}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold text-white">{defense.name}</div>
          {defense.duplicateCount > 0 ? (
            <div className="mt-1 text-xs text-amber-300">
              Doublon : {defense.duplicateHeroes.join(", ")}
            </div>
          ) : (
            <div className="mt-1 text-xs text-emerald-300">Aucun doublon heros</div>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onInfo}
            className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
          >
            <Info className="h-4 w-4" />
          </Button>
          {canEdit ? (
            <Button
              type="button"
              size="sm"
              onClick={onAssign}
              disabled={saving}
              className="rounded-lg bg-pink-500 text-white hover:bg-pink-400"
            >
              Ajouter
            </Button>
          ) : null}
        </div>
      </div>
      <DefenseBody defense={defense} member={member} />
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

function DefenseBody({ defense, member }) {
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
          <div className="text-sm text-zinc-500">Aucune image</div>
        )}
      </div>

      <div className="space-y-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Heros / Eveils
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
                  <span className="min-w-0 truncate text-sm text-zinc-100">{heroName}</span>
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
            <span className="text-sm text-zinc-400">Heros manquants</span>
            <span className={`text-right text-sm ${missingHeroes.length === 0 ? "text-emerald-300" : "text-red-300"}`}>
              {missingHeroes.length === 0 ? "OK" : missingHeroes.join(", ")}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
            <span className="text-sm text-zinc-400">Conditions</span>
            <span className={`text-right text-sm ${missingConditions.length === 0 ? "text-emerald-300" : "text-red-300"}`}>
              {missingConditions.length === 0
                ? "OK"
                : missingConditions
                    .map((requirement) => `${requirement.hero} A${requirement.minAwakening}`)
                    .join(", ")}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
            <span className="text-sm text-zinc-400">Score d'eveil</span>
            <span className="text-sm text-zinc-100">{score ?? "-"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
