import React, { useEffect, useMemo, useState } from "react";
import { Crown, Gem, History, Minus, Plus, Search, Shield, Trophy } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { logPortalActivity } from "@/lib/portalActivity";
import { filterByGuildScope, isLeaderSession } from "@/lib/guildScope";

const SOUL_STONE_TABS = [
  { id: "mes-pierres", label: "Mes pierres", icon: Gem },
  { id: "historique", label: "Historique", icon: History },
  { id: "classement", label: "Classement", icon: Trophy },
];

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getSessionRole(session) {
  return normalizeText(session?.role || "");
}

function formatDate(value) {
  if (!value) return "-";

  return new Date(value).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function SoulStoneCounterCard({
  type,
  title,
  total,
  lastDate,
  image,
  disabled,
  onAdd,
  onRemove,
}) {
  const isLord = type === "lord";

  return (
    <article
      className={`relative overflow-hidden rounded-3xl border bg-zinc-950 p-6 ${
        isLord
          ? "border-yellow-300/45 shadow-[0_0_34px_rgba(250,204,21,0.16)]"
          : "border-sky-200/35 shadow-[0_0_34px_rgba(125,211,252,0.12)]"
      }`}
    >
      <div
        className={`pointer-events-none absolute inset-0 ${
          isLord
            ? "bg-[radial-gradient(circle_at_20%_20%,rgba(250,204,21,0.18),transparent_34%)]"
            : "bg-[radial-gradient(circle_at_20%_20%,rgba(125,211,252,0.16),transparent_34%)]"
        }`}
      />

      <div className="relative z-10 mb-5 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-lg font-semibold text-zinc-50">
            {isLord ? <Crown className="h-5 w-5 text-yellow-200" /> : <Gem className="h-5 w-5 text-sky-100" />}
            {title}
          </div>
          <div className="mt-1 text-sm text-zinc-400">Total : {total}</div>
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-10 w-10 rounded-xl border-zinc-700 bg-zinc-900 p-0"
            onClick={onRemove}
            disabled={disabled}
            title="Retirer la derniere pierre"
          >
            <Minus className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            className="h-10 w-10 rounded-xl p-0"
            onClick={onAdd}
            disabled={disabled}
            title="Ajouter une pierre"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="relative z-10 mb-4 overflow-hidden rounded-3xl border border-zinc-800 bg-black/60">
        <img src={image} alt={title} className="h-[240px] w-full object-contain p-5" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black to-transparent" />
      </div>

      <div className="relative z-10 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 text-sm text-zinc-300">
        Derniere pierre recue : <span className="font-semibold text-zinc-100">{formatDate(lastDate)}</span>
      </div>
    </article>
  );
}

export default function SoulStonesTab({ session }) {
  const [members, setMembers] = useState([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [soulStones, setSoulStones] = useState([]);
  const [soulStonesLoading, setSoulStonesLoading] = useState(false);
  const [soulStoneView, setSoulStoneView] = useState("mes-pierres");
  const [clusterSoulStoneRows, setClusterSoulStoneRows] = useState([]);
  const [clusterSoulStonesLoading, setClusterSoulStonesLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const visibleMemberIds = useMemo(() => new Set(members.map((member) => String(member.id))), [members]);

  const selectedMember = useMemo(() => {
    return members.find((member) => String(member.id) === String(selectedMemberId)) || members[0] || null;
  }, [members, selectedMemberId]);

  const memberSuggestions = useMemo(() => {
    const normalizedQuery = normalizeText(memberQuery);

    return members
      .filter((member) => {
        if (!normalizedQuery) return true;
        return normalizeText(`${member.name} ${member.discordId} ${member.guildCode}`).includes(normalizedQuery);
      })
      .slice(0, 8);
  }, [memberQuery, members]);

  const canEditSoulStones = useMemo(() => {
    const role = getSessionRole(session);
    const isAdmin =
      session?.isAdmin ||
      session?.admin ||
      role.includes("admin") ||
      role.includes("administrateur") ||
      role.includes("leader");
    const isOwnProfile =
      selectedMember?.id && session?.memberId
        ? String(selectedMember.id) === String(session.memberId)
        : true;

    return isAdmin || isOwnProfile;
  }, [selectedMember, session]);

  useEffect(() => {
    let cancelled = false;

    async function loadMembers() {
      const { data, error } = await supabase
        .from("guild_members")
        .select("id, watcher_name, discord_id, guild_code")
        .order("watcher_name", { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error("Erreur chargement membres pierres d'ame:", error);
        setErrorMessage("Impossible de charger les membres du cluster.");
        return;
      }

      const mapped = filterByGuildScope(data || [], session, (row) => row.guild_code, {
        leaderSeesAll: true,
      }).map((row) => ({
        id: row.id,
        name: row.watcher_name || "Joueur",
        discordId: row.discord_id || "",
        guildCode: row.guild_code || "",
      }));

      setMembers(mapped);
      setSelectedMemberId((current) => {
        if (current && mapped.some((member) => String(member.id) === String(current))) {
          return current;
        }

        const bySessionId = mapped.find((member) => String(member.id) === String(session?.memberId));
        if (bySessionId) return bySessionId.id;

        const sessionName = normalizeText(session?.watcherName || session?.name);
        const byName = mapped.find((member) => normalizeText(member.name) === sessionName);
        if (byName) return byName.id;

        return mapped[0]?.id || "";
      });
    }

    loadMembers();

    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    let cancelled = false;

    async function loadSoulStones() {
      if (!selectedMember?.id) {
        setSoulStones([]);
        return;
      }

      setSoulStonesLoading(true);
      setErrorMessage("");

      const { data, error } = await supabase
        .from("soul_stones")
        .select("id, member_id, watcher_name, type, created_at")
        .eq("member_id", selectedMember.id)
        .order("created_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        console.error("Erreur chargement pierres d'ame:", error);
        setSoulStones([]);
        setErrorMessage("Impossible de charger les pierres d'ame du joueur.");
        setSoulStonesLoading(false);
        return;
      }

      setSoulStones(
        (data || []).map((row) => ({
          id: row.id,
          memberId: row.member_id,
          watcherName: row.watcher_name || "",
          type: row.type,
          createdAt: row.created_at,
        })),
      );
      setSoulStonesLoading(false);
    }

    loadSoulStones();

    return () => {
      cancelled = true;
    };
  }, [selectedMember?.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadClusterSoulStoneRows() {
      setClusterSoulStonesLoading(true);

      const { data, error } = await supabase.rpc("get_soulstone_ranking");

      if (cancelled) return;

      if (error) {
        console.error("Erreur chargement classement pierres d'ame:", error);
        setClusterSoulStoneRows([]);
        setClusterSoulStonesLoading(false);
        return;
      }

      const rows = (data || [])
        .filter((row) => isLeaderSession(session) || visibleMemberIds.has(String(row.member_id)))
        .map((row) => ({
          memberId: row.member_id,
          watcherName: row.watcher_name || "Inconnu",
          lord: Number(row.lord_count || 0),
          brute: Number(row.brute_count || 0),
          total: Number(row.total || 0),
        }))
        .sort((a, b) => {
          if (b.total !== a.total) return b.total - a.total;
          if (b.lord !== a.lord) return b.lord - a.lord;
          return a.watcherName.localeCompare(b.watcherName, "fr", { sensitivity: "base" });
        });

      setClusterSoulStoneRows(rows);
      setClusterSoulStonesLoading(false);
    }

    loadClusterSoulStoneRows();

    return () => {
      cancelled = true;
    };
  }, [session, soulStones.length, visibleMemberIds]);

  const totalLordSoulStones = useMemo(() => {
    return soulStones.filter((stone) => stone.type === "lord").length;
  }, [soulStones]);

  const totalBruteSoulStones = useMemo(() => {
    return soulStones.filter((stone) => stone.type === "brute").length;
  }, [soulStones]);

  const lastLordSoulStoneDate = useMemo(() => {
    return soulStones.find((stone) => stone.type === "lord")?.createdAt || null;
  }, [soulStones]);

  const lastBruteSoulStoneDate = useMemo(() => {
    return soulStones.find((stone) => stone.type === "brute")?.createdAt || null;
  }, [soulStones]);

  async function addSoulStone(type) {
    if (!selectedMember?.id || !canEditSoulStones) return;

    try {
      const { data, error } = await supabase
        .from("soul_stones")
        .insert({
          member_id: selectedMember.id,
          watcher_name: selectedMember.name,
          type,
        })
        .select("id, member_id, watcher_name, type, created_at")
        .single();

      if (error) {
        console.error("Erreur ajout pierre d'ame:", error);
        setErrorMessage("Impossible d'ajouter la pierre d'ame.");
        return;
      }

      const created = {
        id: data.id,
        memberId: data.member_id,
        watcherName: data.watcher_name || "",
        type: data.type,
        createdAt: data.created_at,
      };

      setSoulStones((previous) => [created, ...previous]);
      void logPortalActivity(session, {
        targetMemberId: selectedMember.id,
        targetName: selectedMember.name,
        actionType: "soul_stone_add",
        entityType: "soul_stone",
        entityId: String(data.id),
        summary: `${selectedMember.name} : ajout pierre ${type}`,
        metadata: { type },
      });
    } catch (error) {
      console.error("Erreur addSoulStone:", error);
      setErrorMessage("Une erreur est survenue pendant l'ajout.");
    }
  }

  async function removeLastSoulStone(type) {
    if (!selectedMember?.id || !canEditSoulStones) return;

    const lastStone = soulStones.find((stone) => stone.type === type);
    if (!lastStone) return;

    try {
      const { error } = await supabase.from("soul_stones").delete().eq("id", lastStone.id);

      if (error) {
        console.error("Erreur suppression pierre d'ame:", error);
        setErrorMessage("Impossible de supprimer la derniere pierre d'ame.");
        return;
      }

      setSoulStones((previous) => previous.filter((stone) => stone.id !== lastStone.id));
      void logPortalActivity(session, {
        targetMemberId: selectedMember.id,
        targetName: selectedMember.name,
        actionType: "soul_stone_remove",
        entityType: "soul_stone",
        entityId: String(lastStone.id),
        summary: `${selectedMember.name} : retrait pierre ${type}`,
        metadata: { type },
      });
    } catch (error) {
      console.error("Erreur removeLastSoulStone:", error);
      setErrorMessage("Une erreur est survenue pendant la suppression.");
    }
  }

  return (
    <section className="space-y-6">
      <div
        className="relative overflow-hidden rounded-[1.35rem] border border-white/20 bg-zinc-950 p-6 shadow-[0_0_44px_rgba(255,255,255,0.12)]"
        style={{
          backgroundImage:
            "linear-gradient(120deg, rgba(9,9,11,0.96), rgba(15,23,42,0.78)), url('/backgrounds/bg-pierre-ame.webp')",
          backgroundPosition: "center",
          backgroundSize: "cover",
        }}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_20%,rgba(255,255,255,0.16),transparent_28%),radial-gradient(circle_at_82%_22%,rgba(250,204,21,0.14),transparent_24%)]" />
        <div className="relative z-10 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-100">
              <Gem className="h-4 w-4" />
              Inventaire mystique
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-4xl">
              Pierre d'ame
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300 md:text-base">
              Gestion des pierres Lord et Brute avec historique joueur et classement du cluster.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:w-[560px]">
            <div className="rounded-2xl border border-yellow-300/25 bg-black/40 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Lord</div>
              <div className="mt-2 text-2xl font-semibold text-yellow-200">{totalLordSoulStones}</div>
            </div>
            <div className="rounded-2xl border border-sky-200/20 bg-black/40 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Brute</div>
              <div className="mt-2 text-2xl font-semibold text-sky-100">{totalBruteSoulStones}</div>
            </div>
            <div className="rounded-2xl border border-emerald-300/20 bg-black/40 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Total</div>
              <div className="mt-2 text-2xl font-semibold text-emerald-200">
                {totalLordSoulStones + totalBruteSoulStones}
              </div>
            </div>
          </div>
        </div>
      </div>

      <Card className="rounded-3xl border-zinc-800 bg-zinc-950/85 shadow-2xl">
        <CardContent className="p-0">
          <div className="grid min-h-[680px] grid-cols-1 xl:grid-cols-[260px_1fr]">
            <aside className="border-b border-zinc-800 p-5 xl:border-b-0 xl:border-r">
              <div>
                <div className="text-lg font-semibold text-zinc-50">Navigation</div>
                <div className="mt-1 text-sm text-zinc-500">Pierres, historique et cluster</div>
              </div>

              <div className="mt-5 space-y-3">
                {SOUL_STONE_TABS.map((tab) => {
                  const Icon = tab.icon;
                  const selected = soulStoneView === tab.id;

                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setSoulStoneView(tab.id)}
                      className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left font-medium transition ${
                        selected
                          ? "border-white/70 bg-zinc-100 text-zinc-950"
                          : "border-zinc-800 bg-zinc-900/70 text-zinc-300 hover:border-white/35 hover:bg-zinc-900"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <div className="mt-6 space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500" htmlFor="soul-member">
                  Joueur du cluster
                </label>
                <div className="flex h-10 items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 ring-white/20 transition focus-within:border-white/50 focus-within:ring-2">
                  <Search className="h-4 w-4 shrink-0 text-zinc-500" />
                  <input
                    id="soul-member"
                    type="search"
                    value={memberQuery}
                    onChange={(event) => setMemberQuery(event.target.value)}
                    placeholder="Rechercher un joueur"
                    className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
                  />
                </div>

                <div className="max-h-64 space-y-2 overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950/80 p-2">
                  {memberSuggestions.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-zinc-500">Aucun joueur trouve.</div>
                  ) : (
                    memberSuggestions.map((member) => {
                      const selected = String(member.id) === String(selectedMemberId);

                      return (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => {
                            setSelectedMemberId(member.id);
                            setMemberQuery(member.name);
                          }}
                          className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                            selected
                              ? "border-white/60 bg-white/10 text-white"
                              : "border-transparent bg-zinc-900/70 text-zinc-300 hover:border-white/25 hover:bg-zinc-900"
                          }`}
                        >
                          <span className="block truncate text-sm font-semibold">{member.name}</span>
                          <span className="mt-0.5 block truncate text-xs text-zinc-500">
                            {member.guildCode || "Cluster"} {member.discordId ? `- ${member.discordId}` : ""}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-5 text-amber-100">
                <span className="font-semibold text-amber-200">Important :</span> renseigner le total reel, inventaire
                plus pierres deja utilisees sur vos heros.
              </div>

              <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-400">
                <div className="flex items-center gap-2 font-medium text-zinc-200">
                  <Shield className="h-4 w-4 text-zinc-100" />
                  {selectedMember?.name || "Aucun membre"}
                </div>
                <div className="mt-1 text-xs text-zinc-500">{selectedMember?.guildCode || "Cluster"}</div>
                <p className="mt-2 leading-5">
                  Les boutons + et - ajoutent une entree ou retirent la derniere entree du type choisi.
                </p>
              </div>
            </aside>

            <div className="p-5">
              {errorMessage ? (
                <div className="mb-5 rounded-2xl border border-red-500/35 bg-red-500/10 p-4 text-sm text-red-100">
                  {errorMessage}
                </div>
              ) : null}

              {!selectedMember ? (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-8 text-sm text-zinc-400">
                  Aucun membre selectionne.
                </div>
              ) : soulStonesLoading ? (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-8 text-sm text-zinc-400">
                  Chargement des pierres d'ame...
                </div>
              ) : (
                <>
                  {soulStoneView === "mes-pierres" ? (
                    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                      <SoulStoneCounterCard
                        type="lord"
                        title="Pierre Lord"
                        total={totalLordSoulStones}
                        lastDate={lastLordSoulStoneDate}
                        image="/soul-stones/lord.png"
                        disabled={!canEditSoulStones}
                        onAdd={() => addSoulStone("lord")}
                        onRemove={() => removeLastSoulStone("lord")}
                      />

                      <SoulStoneCounterCard
                        type="brute"
                        title="Pierre Brute"
                        total={totalBruteSoulStones}
                        lastDate={lastBruteSoulStoneDate}
                        image="/soul-stones/brute.png"
                        disabled={!canEditSoulStones}
                        onAdd={() => addSoulStone("brute")}
                        onRemove={() => removeLastSoulStone("brute")}
                      />
                    </div>
                  ) : null}

                  {soulStoneView === "historique" ? (
                    <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
                      <div className="mb-5 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-lg font-semibold text-zinc-50">Historique</div>
                          <div className="text-sm text-zinc-500">{soulStones.length} entree(s)</div>
                        </div>
                        <Badge className="rounded-xl border-white/20 bg-white/10 text-zinc-100">
                          {selectedMember.name}
                        </Badge>
                      </div>

                      <div className="space-y-3">
                        {soulStones.length > 0 ? (
                          soulStones.map((stone) => (
                            <div
                              key={stone.id}
                              className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-4"
                            >
                              <div className="flex items-center gap-3">
                                <div
                                  className={`flex h-10 w-10 items-center justify-center rounded-xl border ${
                                    stone.type === "lord"
                                      ? "border-yellow-300/35 bg-yellow-300/10 text-yellow-200"
                                      : "border-sky-200/30 bg-sky-200/10 text-sky-100"
                                  }`}
                                >
                                  {stone.type === "lord" ? <Crown className="h-5 w-5" /> : <Gem className="h-5 w-5" />}
                                </div>
                                <div className="font-medium text-zinc-100">
                                  {stone.type === "lord" ? "Pierre Lord" : "Pierre Brute"}
                                </div>
                              </div>

                              <div className="text-sm text-zinc-400">{formatDate(stone.createdAt)}</div>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-400">
                            Aucun historique.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {soulStoneView === "classement" ? (
                    <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
                      <div className="mb-5 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-lg font-semibold text-zinc-50">Classement du cluster</div>
                          <div className="text-sm text-zinc-500">Tri par total puis pierres Lord</div>
                        </div>
                        <Trophy className="h-6 w-6 text-amber-200" />
                      </div>

                      <div className="space-y-4">
                        <div className="grid grid-cols-[1fr_82px_82px_82px] gap-3 px-4 text-sm text-zinc-400 md:grid-cols-[1fr_100px_100px_100px]">
                          <div>Joueur</div>
                          <div className="text-center">Lord</div>
                          <div className="text-center">Brute</div>
                          <div className="text-center">Total</div>
                        </div>

                        {clusterSoulStonesLoading ? (
                          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-400">
                            Chargement du classement...
                          </div>
                        ) : clusterSoulStoneRows.length > 0 ? (
                          clusterSoulStoneRows.map((row, index) => (
                            <div
                              key={row.memberId}
                              className="grid grid-cols-[1fr_82px_82px_82px] items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 md:grid-cols-[1fr_100px_100px_100px]"
                            >
                              <div className="flex min-w-0 items-center gap-3">
                                <div className="text-sm text-zinc-500">#{index + 1}</div>
                                <div className="truncate font-medium text-zinc-100">{row.watcherName}</div>
                              </div>

                              <div className="text-center font-semibold text-yellow-300">{row.lord}</div>
                              <div className="text-center font-semibold text-sky-100">{row.brute}</div>
                              <div className="text-center font-bold text-emerald-300">{row.total}</div>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-400">
                            Aucun classement disponible.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
