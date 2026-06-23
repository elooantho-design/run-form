import React, { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, RefreshCw, ShieldCheck, Users } from "lucide-react";
import GestionDefenseTab from "@/components/GestionDefenseTab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { logPortalActivity } from "@/lib/portalActivity";
import {
  getDefenseLikeTargetId,
  getMetaDefenseCounters,
} from "@/calculations";

const GUILD_CODES = ["G1", "G2", "G3", "G4", "G5", "G6", "G7"];
const EMPTY_DEFENSE = "--";

function getSessionGuildCode(session) {
  return session?.guildCode || session?.guild_code || "G1";
}

function normalizeAssignment(value) {
  const cleanValue = String(value || "").trim();
  return cleanValue || "Tour";
}

function mapDefenseRow(row, blocksByDefenseId = new Map()) {
  const slots = [...(row.guild_defense_slots || [])]
    .sort((a, b) => (a.slot_index ?? 0) - (b.slot_index ?? 0))
    .map((slot) => slot.champions?.name || "")
    .filter(Boolean);

  const conditions = (row.guild_defense_conditions || []).map((condition) => ({
    id: condition.id,
    championId: condition.champion_id,
    minAwakening: condition.min_awakening,
    label: `${condition.champions?.name || "Hero"} A${condition.min_awakening} minimum`,
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
    infoBlocks: blocksByDefenseId.get(String(row.id)) || [],
    image: row.image_url,
  };
}

function mapVoteRow(row) {
  return {
    id: row.id,
    defenseId: row.defense_id,
    memberId: row.member_id,
    value: row.value,
    createdAt: row.created_at,
  };
}

function isAdminSession(session) {
  return Boolean(session?.isAdmin || session?.admin || String(session?.role || "").toLowerCase().includes("admin"));
}

export default function PortalGuildManagementTab({ session }) {
  const [activeGuildCode, setActiveGuildCode] = useState(getSessionGuildCode(session));
  const [members, setMembers] = useState([]);
  const [defenses, setDefenses] = useState([]);
  const [defenseVotes, setDefenseVotes] = useState([]);
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [trackedMetaDefenseId, setTrackedMetaDefenseId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingMessage, setSavingMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [memberToTransfer, setMemberToTransfer] = useState(null);
  const [targetGuildCode, setTargetGuildCode] = useState("");

  const connectedMemberId = session?.memberId || session?.id || "";
  const isAdmin = isAdminSession(session);

  const activeMembers = useMemo(
    () => members.filter((member) => String(member.guildCode || activeGuildCode) === String(activeGuildCode)),
    [activeGuildCode, members]
  );

  const activeDefenses = useMemo(
    () =>
      defenses.filter(
        (defense) =>
          defense.isGlobal ||
          !defense.guildCode ||
          String(defense.guildCode) === String(activeGuildCode)
      ),
    [activeGuildCode, defenses]
  );

  const trackedMetaDefense = useMemo(() => {
    if (!trackedMetaDefenseId) return null;
    return activeDefenses.find((defense) => String(defense.id) === String(trackedMetaDefenseId)) || null;
  }, [activeDefenses, trackedMetaDefenseId]);

  const metaDefenseCounters = useMemo(
    () => getMetaDefenseCounters(activeDefenses, activeMembers),
    [activeDefenses, activeMembers]
  );

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

  useEffect(() => {
    let cancelled = false;

    async function loadGuildManagementData() {
      setLoading(true);
      setErrorMessage("");

      const [membersResult, defensesResult, votesResult] = await Promise.all([
        supabase
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
            awakening_status,
            personal_forum_post_url,
            member_awakenings (
              awakening_level,
              champion_id,
              champions (
                name
              )
            )
          `)
          .order("watcher_name", { ascending: true }),
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
          .order("created_at", { ascending: true }),
        supabase.from("cluster_defense_likes").select("id, defense_id, member_id, value, created_at"),
      ]);

      if (cancelled) return;

      if (membersResult.error || defensesResult.error || votesResult.error) {
        console.error(
          "Erreur chargement gestion guildes Portal:",
          membersResult.error || defensesResult.error || votesResult.error
        );
        setErrorMessage("Impossible de charger la gestion des guildes pour le moment.");
        setMembers([]);
        setDefenses([]);
        setDefenseVotes([]);
        setLoading(false);
        return;
      }

      const defenseRows = defensesResult.data || [];
      const defenseIds = defenseRows.map((row) => row.id).filter(Boolean);
      let blocksByDefenseId = new Map();

      if (defenseIds.length > 0) {
        const { data: blockRows, error: blocksError } = await supabase
          .from("guild_defense_blocks")
          .select("id, defense_id, block_type, content, sort_order")
          .in("defense_id", defenseIds)
          .order("sort_order", { ascending: true });

        if (cancelled) return;

        if (blocksError) {
          console.error("Erreur chargement infos defenses Portal:", blocksError);
        } else {
          blocksByDefenseId = (blockRows || []).reduce((grouped, block) => {
            const defenseId = String(block.defense_id);
            const previous = grouped.get(defenseId) || [];

            grouped.set(defenseId, [
              ...previous,
              {
                id: block.id,
                blockType: block.block_type,
                content: block.content,
                sortOrder: block.sort_order ?? 9999,
              },
            ]);

            return grouped;
          }, new Map());
        }
      }

      const mappedMembers = (membersResult.data || []).map((row) => {
        const awakenings = {};

        (row.member_awakenings || []).forEach((entry) => {
          const heroName = entry.champions?.name;
          if (heroName) {
            awakenings[heroName] = entry.awakening_level;
          }
        });

        return {
          id: row.id,
          name: row.watcher_name || row.discord_id || "Joueur",
          discordId: row.discord_id || "",
          guildCode: row.guild_code || "G1",
          assignment: normalizeAssignment(row.assignment),
          status: row.status || "À faire",
          awakeningStatus: row.awakening_status || "En attente",
          personalForumPostUrl: row.personal_forum_post_url || "",
          defense1: row.defense_1 || EMPTY_DEFENSE,
          defense2: row.defense_2 || EMPTY_DEFENSE,
          awakenings,
        };
      });

      const mappedDefenses = defenseRows
        .map((row) => mapDefenseRow(row, blocksByDefenseId))
        .sort((a, b) => {
          if ((a.sortOrder ?? 9999) !== (b.sortOrder ?? 9999)) {
            return (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999);
          }

          return String(a.name || "").localeCompare(String(b.name || ""), "fr", { sensitivity: "base" });
        });

      setMembers(mappedMembers);
      setDefenses(mappedDefenses);
      setDefenseVotes((votesResult.data || []).map(mapVoteRow));
      setSelectedMemberId((current) => {
        if (current && mappedMembers.some((member) => String(member.id) === String(current))) return current;
        const connectedMember = mappedMembers.find((member) => String(member.id) === String(connectedMemberId));
        return connectedMember?.id || mappedMembers.find((member) => member.guildCode === activeGuildCode)?.id || null;
      });
      setLoading(false);
    }

    loadGuildManagementData();

    return () => {
      cancelled = true;
    };
  }, [activeGuildCode, connectedMemberId, refreshTick]);

  useEffect(() => {
    if (!trackedMetaDefenseId) return;
    if (activeDefenses.some((defense) => String(defense.id) === String(trackedMetaDefenseId))) return;
    setTrackedMetaDefenseId(null);
  }, [activeDefenses, trackedMetaDefenseId]);

  function updateMemberLocal(memberId, patch) {
    setMembers((previous) =>
      previous.map((member) => (String(member.id) === String(memberId) ? { ...member, ...patch } : member))
    );
  }

  async function updateMemberField(memberId, patch, errorLabel, logPayload) {
    setSavingMessage("Sauvegarde en cours...");
    setErrorMessage("");

    const { error } = await supabase.from("guild_members").update(patch).eq("id", memberId);

    setSavingMessage("");

    if (error) {
      console.error(errorLabel, error);
      setErrorMessage(error.message || "Sauvegarde impossible.");
      return false;
    }

    if (logPayload) {
      void logPortalActivity(session, logPayload);
    }

    return true;
  }

  async function assignDefense(slot, defense, memberId) {
    if (!memberId || !defense?.name) return;

    const column = slot === 1 ? "defense_1" : "defense_2";
    const localKey = slot === 1 ? "defense1" : "defense2";
    const targetMember = members.find((member) => String(member.id) === String(memberId));

    const saved = await updateMemberField(
      memberId,
      { [column]: defense.name },
      "Erreur assignation defense Portal:",
      {
        targetMemberId: memberId,
        targetName: targetMember?.name || "",
        actionType: "guild_management_defense_assign",
        entityType: "defense",
        entityId: String(defense.id),
        summary: `${targetMember?.name || "Joueur"} : defense ${slot} affectee a ${defense.name}`,
        metadata: {
          slot,
          defenseId: defense.id,
          defenseName: defense.name,
          guildCode: activeGuildCode,
        },
      }
    );

    if (saved) {
      updateMemberLocal(memberId, { [localKey]: defense.name });
    }
  }

  async function clearAssignedDefense(slot) {
    if (!selectedMemberId) return;

    const targetMember = members.find((member) => String(member.id) === String(selectedMemberId));
    const column = slot === 1 ? "defense_1" : "defense_2";
    const localKey = slot === 1 ? "defense1" : "defense2";
    const previousDefenseName = slot === 1 ? targetMember?.defense1 : targetMember?.defense2;

    const saved = await updateMemberField(
      selectedMemberId,
      { [column]: EMPTY_DEFENSE },
      "Erreur suppression defense Portal:",
      {
        targetMemberId: selectedMemberId,
        targetName: targetMember?.name || "",
        actionType: "guild_management_defense_unassign",
        entityType: "defense",
        summary: `${targetMember?.name || "Joueur"} : defense ${slot} retiree`,
        metadata: {
          slot,
          previousDefenseName,
          guildCode: activeGuildCode,
        },
      }
    );

    if (saved) {
      updateMemberLocal(selectedMemberId, { [localKey]: EMPTY_DEFENSE });
    }
  }

  async function setMemberAssignment(memberId, value) {
    const targetMember = members.find((member) => String(member.id) === String(memberId));
    const saved = await updateMemberField(
      memberId,
      { assignment: value },
      "Erreur affectation role Portal:",
      {
        targetMemberId: memberId,
        targetName: targetMember?.name || "",
        actionType: "guild_management_assignment_update",
        entityType: "member",
        entityId: String(memberId),
        summary: `${targetMember?.name || "Joueur"} : role defense passe a ${value}`,
        metadata: {
          assignment: value,
          guildCode: activeGuildCode,
        },
      }
    );

    if (saved) {
      updateMemberLocal(memberId, { assignment: value });
    }
  }

  async function setMemberStatus(memberId, status) {
    const targetMember = members.find((member) => String(member.id) === String(memberId));
    const saved = await updateMemberField(
      memberId,
      { status },
      "Erreur statut Portal:",
      {
        targetMemberId: memberId,
        targetName: targetMember?.name || "",
        actionType: "guild_management_status_update",
        entityType: "member",
        entityId: String(memberId),
        summary: `${targetMember?.name || "Joueur"} : statut defense passe a ${status}`,
        metadata: {
          status,
          guildCode: activeGuildCode,
        },
      }
    );

    if (saved) {
      updateMemberLocal(memberId, { status });
    }
  }

  async function setDefenseVote(defense, value) {
    if (!connectedMemberId || !defense) return;

    const targetDefenseId = getDefenseLikeTargetId(defense);
    if (!targetDefenseId) return;

    const existingVote = defenseVotes.find(
      (vote) =>
        String(vote.defenseId) === String(targetDefenseId) &&
        String(vote.memberId) === String(connectedMemberId)
    );

    if (existingVote) {
      if (existingVote.value === value) {
        const { error } = await supabase.from("cluster_defense_likes").delete().eq("id", existingVote.id);

        if (error) {
          console.error("Erreur suppression vote defense Portal:", error);
          setErrorMessage(error.message || "Vote impossible.");
          return;
        }

        setDefenseVotes((previous) => previous.filter((vote) => vote.id !== existingVote.id));
        return;
      }

      const { error } = await supabase.from("cluster_defense_likes").update({ value }).eq("id", existingVote.id);

      if (error) {
        console.error("Erreur mise a jour vote defense Portal:", error);
        setErrorMessage(error.message || "Vote impossible.");
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
          member_id: connectedMemberId,
          value,
        },
        { onConflict: "defense_id,member_id" }
      )
      .select()
      .single();

    if (error) {
      console.error("Erreur ajout vote defense Portal:", error);
      setErrorMessage(error.message || "Vote impossible.");
      return;
    }

    setDefenseVotes((previous) => [...previous, mapVoteRow(data)]);
  }

  async function transferMemberToGuild() {
    if (!memberToTransfer?.id || !targetGuildCode || targetGuildCode === memberToTransfer.guildCode) return;

    const confirmed = window.confirm(`Transferer ${memberToTransfer.name} vers ${targetGuildCode} ?`);
    if (!confirmed) return;

    const saved = await updateMemberField(
      memberToTransfer.id,
      { guild_code: targetGuildCode },
      "Erreur transfert membre Portal:",
      {
        targetMemberId: memberToTransfer.id,
        targetName: memberToTransfer.name,
        actionType: "guild_management_member_transfer",
        entityType: "member",
        entityId: String(memberToTransfer.id),
        summary: `${memberToTransfer.name} transfere de ${memberToTransfer.guildCode || activeGuildCode} vers ${targetGuildCode}`,
        metadata: {
          fromGuildCode: memberToTransfer.guildCode || activeGuildCode,
          toGuildCode: targetGuildCode,
        },
      }
    );

    if (!saved) return;

    updateMemberLocal(memberToTransfer.id, { guildCode: targetGuildCode });
    setTransferDialogOpen(false);
    setMemberToTransfer(null);
    setTargetGuildCode("");
    setSelectedMemberId((current) => (String(current) === String(memberToTransfer.id) ? null : current));
  }

  return (
    <section className="space-y-5">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-300" />
              <h2 className="text-xl font-semibold text-zinc-50">Gestion des guildes</h2>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              Pilotage des defenses meta, statuts de preparation, roles Tour/Bulle/Bastion et transferts entre guildes.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge className="rounded-lg border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
              <Users className="mr-1 h-3.5 w-3.5" />
              {activeMembers.length} joueurs
            </Badge>
            <Badge className="rounded-lg border-sky-500/30 bg-sky-500/10 text-sky-300">
              {activeDefenses.length} defenses
            </Badge>
            <Button
              type="button"
              variant="outline"
              className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
              onClick={() => setRefreshTick((value) => value + 1)}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Rafraichir
            </Button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {GUILD_CODES.map((guildCode) => (
            <button
              key={guildCode}
              type="button"
              onClick={() => {
                setActiveGuildCode(guildCode);
                setSelectedMemberId(null);
                setTrackedMetaDefenseId(null);
              }}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                activeGuildCode === guildCode
                  ? "border-emerald-300/60 bg-emerald-500/15 text-emerald-100"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-600 hover:text-zinc-100"
              }`}
            >
              {guildCode}
            </button>
          ))}
        </div>
      </div>

      {savingMessage ? (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
          {savingMessage}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {errorMessage}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5 text-sm text-zinc-400">
          Chargement de la gestion des guildes...
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/70">
          <div className="min-w-[1080px] lg:min-w-0">
            <GestionDefenseTab
              members={activeMembers}
              allMembers={activeMembers}
              activeGuildCode={activeGuildCode}
              trackedMetaDefense={trackedMetaDefense}
              setTrackedMetaDefense={setTrackedMetaDefenseId}
              metaDefenseCounters={metaDefenseCounters}
              setTodoMember={(memberId) => setMemberStatus(memberId, "À faire")}
              setVerifyMember={(memberId) => setMemberStatus(memberId, "À vérifier")}
              validateMember={(memberId) => setMemberStatus(memberId, "Validé")}
              setTransferDialogOpen={setTransferDialogOpen}
              setMemberToTransfer={setMemberToTransfer}
              setTargetGuildCode={setTargetGuildCode}
              setMemberAssignment={setMemberAssignment}
              defenses={activeDefenses}
              clearAssignedDefense={clearAssignedDefense}
              cleanAssignedDefenses={() => {}}
              assignDefense={assignDefense}
              setSelectedId={setSelectedMemberId}
              isAdmin={isAdmin}
              setDefenseVote={setDefenseVote}
              defenseLikesCountByRootId={defenseLikesCountByRootId}
              defenseDislikesCountByRootId={defenseDislikesCountByRootId}
              defenseVoteByRootId={defenseVoteByRootId}
              getDefenseLikeTargetId={getDefenseLikeTargetId}
            />
          </div>
        </div>
      )}

      {transferDialogOpen && memberToTransfer ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10">
                <ArrowRightLeft className="h-5 w-5 text-amber-200" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-zinc-50">Transferer un joueur</h3>
                <p className="mt-1 text-sm text-zinc-400">
                  {memberToTransfer.name} est actuellement dans {memberToTransfer.guildCode || activeGuildCode}.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-2">
              {GUILD_CODES.filter((guildCode) => guildCode !== (memberToTransfer.guildCode || activeGuildCode)).map(
                (guildCode) => (
                  <button
                    key={guildCode}
                    type="button"
                    onClick={() => setTargetGuildCode(guildCode)}
                    className={`rounded-lg border px-4 py-3 text-left text-sm transition ${
                      targetGuildCode === guildCode
                        ? "border-amber-300/70 bg-amber-500/15 text-amber-100"
                        : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:text-white"
                    }`}
                  >
                    {guildCode}
                  </button>
                )
              )}
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-zinc-700 text-zinc-200"
                onClick={() => {
                  setTransferDialogOpen(false);
                  setMemberToTransfer(null);
                  setTargetGuildCode("");
                }}
              >
                Annuler
              </Button>
              <Button
                type="button"
                className="rounded-lg bg-amber-500 text-zinc-950 hover:bg-amber-400"
                disabled={!targetGuildCode}
                onClick={transferMemberToGuild}
              >
                Transferer
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
