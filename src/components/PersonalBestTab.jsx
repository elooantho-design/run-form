import React, { useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, Crown, Search, Trophy, UserRound } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { logPortalActivity } from "@/lib/portalActivity";

const PB_SORT_OPTIONS = [
  { id: "top1", label: "Top 1" },
  { id: "top3", label: "Top 3" },
  { id: "top5", label: "Top 5" },
];

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeHeroImageName(heroName) {
  return String(heroName || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function getHeroImageUrl(heroName) {
  return `/heroes/${normalizeHeroImageName(heroName)}.png`;
}

function getSessionGuildCode(session) {
  return session?.guildCode || session?.guild_code || "G1";
}

function getSessionRole(session) {
  return normalizeText(session?.role || "");
}

function formatPbAverage(value) {
  if (!value || Number.isNaN(value)) return "-";
  return Number(value).toFixed(1);
}

function formatShortDate(value) {
  if (!value) return "-";

  return new Date(value).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function isPbOutdated(date) {
  if (!date) return false;

  const diffTime = new Date() - new Date(date);
  const diffDays = diffTime / (1000 * 60 * 60 * 24);

  return diffDays >= 30;
}

function getAwakeningLabel(value) {
  if (value === -1 || value === undefined || value === null) return "X";
  if (value === 0) return "0";
  if (value === 1) return "I";
  if (value === 2) return "II";
  if (value === 3) return "III";
  if (value === 4) return "IV";
  return "V";
}

function getDisplayedPbValue(slot, member) {
  if (!slot) return 0;

  const raw = Number(slot.pbRaw || 0);

  if (slot.championLord !== "lord") {
    return raw;
  }

  const awakeningLevel =
    slot.championName && member?.awakenings
      ? Number(member.awakenings[slot.championName] ?? -1)
      : -1;

  if (awakeningLevel < 0) {
    return raw;
  }

  const multiplierMap = {
    0: 1.1,
    1: 1.11,
    2: 1.12,
    3: 1.13,
    4: 1.14,
    5: 1.15,
  };

  return raw * (multiplierMap[awakeningLevel] ?? 1);
}

function buildMemberAwakenings(memberAwakenings) {
  const awakenings = {};

  (memberAwakenings || []).forEach((entry) => {
    const heroName = entry.champions?.name;
    if (heroName) {
      awakenings[heroName] = Number(entry.awakening_level ?? -1);
    }
  });

  return awakenings;
}

export default function PersonalBestTab({ session }) {
  const [members, setMembers] = useState([]);
  const [allHeroesData, setAllHeroesData] = useState([]);
  const [pbEntries, setPbEntries] = useState([]);
  const [pbSortMode, setPbSortMode] = useState("top3");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [pbEditDialogOpen, setPbEditDialogOpen] = useState(false);
  const [pbHeroSearch, setPbHeroSearch] = useState("");
  const [pbSlotToEdit, setPbSlotToEdit] = useState(null);
  const [pbRawInput, setPbRawInput] = useState("");
  const [pbRowDetailOpen, setPbRowDetailOpen] = useState(false);
  const [pbSelectedMember, setPbSelectedMember] = useState(null);

  const guildCode = getSessionGuildCode(session);
  const memberIds = useMemo(() => members.map((member) => member.id).filter(Boolean), [members]);

  const isAdmin = useMemo(() => {
    const role = getSessionRole(session);
    return role.includes("admin") || role.includes("administrateur");
  }, [session]);

  useEffect(() => {
    let cancelled = false;

    async function loadMembersAndHeroes() {
      setLoading(true);
      setErrorMessage("");

      const [membersResult, heroesResult] = await Promise.all([
        supabase
          .from("guild_members")
          .select(`
            id,
            watcher_name,
            discord_id,
            guild_code,
            assignment,
            member_awakenings (
              awakening_level,
              champion_id,
              champions (
                name
              )
            )
          `)
          .eq("guild_code", guildCode)
          .order("watcher_name", { ascending: true }),
        supabase.from("champions").select("id, name, lord").order("name", { ascending: true }),
      ]);

      if (cancelled) return;

      if (membersResult.error) {
        console.error("Erreur chargement membres PB:", membersResult.error);
        setErrorMessage("Impossible de charger les membres de guilde.");
        setLoading(false);
        return;
      }

      if (heroesResult.error) {
        console.error("Erreur chargement champions PB:", heroesResult.error);
        setErrorMessage("Impossible de charger la liste des heros.");
        setLoading(false);
        return;
      }

      setMembers(
        (membersResult.data || []).map((row) => ({
          id: row.id,
          name: row.watcher_name || "Joueur",
          discordId: row.discord_id || "",
          guildCode: row.guild_code || guildCode,
          assignment: row.assignment || "Tour",
          awakenings: buildMemberAwakenings(row.member_awakenings),
        })),
      );

      setAllHeroesData(
        (heroesResult.data || []).map((row) => ({
          id: row.id,
          name: row.name,
          lord: row.lord || "non-lord",
        })),
      );

      setLoading(false);
    }

    loadMembersAndHeroes();

    return () => {
      cancelled = true;
    };
  }, [guildCode]);

  useEffect(() => {
    let cancelled = false;

    async function loadPbEntries() {
      if (memberIds.length === 0) {
        setPbEntries([]);
        return;
      }

      const { data, error } = await supabase
        .from("member_pb_entries")
        .select(`
          id,
          member_id,
          member_name,
          slot_index,
          pb_raw,
          champion_id,
          updated_at,
          champions (
            id,
            name,
            lord
          )
        `)
        .in("member_id", memberIds)
        .order("member_name", { ascending: true })
        .order("slot_index", { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error("Erreur chargement PB entries:", error);
        setErrorMessage("Impossible de charger les PB.");
        return;
      }

      setPbEntries(
        (data || []).map((row) => ({
          id: row.id,
          memberId: row.member_id,
          memberName: row.member_name || "",
          slotIndex: row.slot_index,
          pbRaw: Number(row.pb_raw || 0),
          championId: row.champion_id || null,
          championName: row.champions?.name || "",
          championLord: row.champions?.lord || "non-lord",
          updatedAt: row.updated_at || null,
        })),
      );
    }

    loadPbEntries();

    return () => {
      cancelled = true;
    };
  }, [memberIds]);

  const pbRows = useMemo(() => {
    const grouped = new Map();

    members.forEach((member) => {
      grouped.set(member.id, {
        memberId: member.id,
        memberName: member.name || "Inconnu",
        slots: [null, null, null, null, null],
        updatedAt: null,
      });
    });

    pbEntries.forEach((entry) => {
      if (!grouped.has(entry.memberId)) {
        grouped.set(entry.memberId, {
          memberId: entry.memberId,
          memberName: entry.memberName || "Inconnu",
          slots: [null, null, null, null, null],
          updatedAt: entry.updatedAt || null,
        });
      }

      const row = grouped.get(entry.memberId);
      if (entry.updatedAt && (!row.updatedAt || new Date(entry.updatedAt) > new Date(row.updatedAt))) {
        row.updatedAt = entry.updatedAt;
      }

      const slotPosition = Math.max(0, Math.min(4, (entry.slotIndex || 1) - 1));

      row.slots[slotPosition] = {
        id: entry.id,
        slotIndex: entry.slotIndex,
        pbRaw: Number(entry.pbRaw || 0),
        championId: entry.championId,
        championName: entry.championName,
        championLord: entry.championLord || "non-lord",
      };
    });

    return Array.from(grouped.values())
      .map((row) => {
        const member = members.find((item) => item.id === row.memberId);
        const sortedSlots = [...row.slots].sort((a, b) => {
          const pbA = getDisplayedPbValue(a, member);
          const pbB = getDisplayedPbValue(b, member);
          return pbB - pbA;
        });

        const pbValues = sortedSlots.map((slot) => getDisplayedPbValue(slot, member)).sort((a, b) => b - a);
        const top1 = pbValues[0] || 0;
        const top3 = (pbValues[0] + pbValues[1] + pbValues[2]) / 3 || 0;
        const top5 = (pbValues[0] + pbValues[1] + pbValues[2] + pbValues[3] + pbValues[4]) / 5 || 0;

        return {
          ...row,
          slots: sortedSlots,
          top1,
          top3,
          top5,
        };
      })
      .sort((a, b) => {
        if (pbSortMode === "top1" && b.top1 !== a.top1) return b.top1 - a.top1;
        if (pbSortMode === "top3" && b.top3 !== a.top3) return b.top3 - a.top3;
        if (pbSortMode === "top5" && b.top5 !== a.top5) return b.top5 - a.top5;
        return a.memberName.localeCompare(b.memberName, "fr", { sensitivity: "base" });
      });
  }, [members, pbEntries, pbSortMode]);

  const filteredPbHeroResults = useMemo(() => {
    const q = normalizeText(pbHeroSearch);
    const heroes = allHeroesData.map((hero) => hero.name).filter(Boolean);

    if (!q) return heroes.slice(0, 20);

    return heroes.filter((hero) => normalizeText(hero).includes(q)).slice(0, 20);
  }, [pbHeroSearch, allHeroesData]);

  const summary = useMemo(() => {
    const rowsWithPb = pbRows.filter((row) => row.top1 > 0);
    const bestRow = rowsWithPb[0] || null;
    const connectedMemberId = session?.memberId || session?.id || "";
    const connectedName = normalizeText(session?.watcherName || session?.memberName || session?.name);
    const connectedRow =
      pbRows.find((row) => connectedMemberId && String(row.memberId) === String(connectedMemberId)) ||
      pbRows.find((row) => connectedName && normalizeText(row.memberName) === connectedName) ||
      null;
    const averageTop3 =
      rowsWithPb.length > 0
        ? rowsWithPb.reduce((sum, row) => sum + row.top3, 0) / rowsWithPb.length
        : 0;

    return {
      rowCount: pbRows.length,
      bestName: bestRow?.memberName || "-",
      connectedTop1: connectedRow?.top1 || 0,
      averageTop3,
    };
  }, [pbRows, session?.id, session?.memberId, session?.memberName, session?.name, session?.watcherName]);

  function canEditRow(rowMemberId) {
    return isAdmin || String(rowMemberId) === String(session?.memberId);
  }

  function openPbEditDialog(slot, memberId) {
    if (!slot?.id) return;

    setPbSlotToEdit({
      entryId: slot.id,
      memberId,
      slotIndex: slot.slotIndex,
      currentChampionId: slot.championId,
      currentChampionName: slot.championName || "",
      currentPbRaw: Number(slot.pbRaw || 0),
    });

    setPbHeroSearch(slot.championName || "");
    setPbRawInput(String(Number(slot.pbRaw || 0)));
    setPbEditDialogOpen(true);
  }

  async function selectPbHero(heroName) {
    if (!pbSlotToEdit?.entryId) return;

    const champion = allHeroesData.find((hero) => hero.name === heroName);
    if (!champion) return;
    const targetMember = members.find((member) => String(member.id) === String(pbSlotToEdit.memberId));
    const previousHeroName = pbSlotToEdit.currentChampionName || "";

    const { error } = await supabase
      .from("member_pb_entries")
      .update({
        champion_id: champion.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pbSlotToEdit.entryId);

    if (error) {
      console.error("Erreur mise a jour heros PB:", error);
      setErrorMessage("Impossible de mettre a jour le heros PB.");
      return;
    }

    setPbEntries((previous) =>
      previous.map((entry) =>
        entry.id === pbSlotToEdit.entryId
          ? {
              ...entry,
              championId: champion.id,
              championName: champion.name,
              championLord: champion.lord || "non-lord",
              updatedAt: new Date().toISOString(),
            }
          : entry,
      ),
    );

    setPbSlotToEdit((previous) =>
      previous
        ? {
            ...previous,
            currentChampionId: champion.id,
            currentChampionName: champion.name,
          }
        : previous,
    );
    setPbHeroSearch(heroName);
    void logPortalActivity(session, {
      targetMemberId: pbSlotToEdit.memberId,
      targetName: targetMember?.name || "",
      actionType: "pb_hero_update",
      entityType: "pb",
      entityId: String(pbSlotToEdit.entryId),
      summary: `${targetMember?.name || "Joueur"} : affi ${pbSlotToEdit.slotIndex} heros ${previousHeroName || "-"} -> ${champion.name}`,
      metadata: {
        slotIndex: pbSlotToEdit.slotIndex,
        previousHeroName,
        nextHeroName: champion.name,
        championId: champion.id,
      },
    });
  }

  async function updatePbRaw(entryId, nextValue) {
    const normalizedValue = Number(String(nextValue).replace(",", "."));
    const currentEntry = pbEntries.find((entry) => String(entry.id) === String(entryId));
    const targetMember = currentEntry
      ? members.find((member) => String(member.id) === String(currentEntry.memberId))
      : null;

    if (Number.isNaN(normalizedValue)) {
      setErrorMessage("Le PB brut doit etre une valeur numerique.");
      return false;
    }

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("member_pb_entries")
      .update({
        pb_raw: normalizedValue,
        updated_at: now,
      })
      .eq("id", entryId);

    if (error) {
      console.error("Erreur mise a jour PB brut:", error);
      setErrorMessage("Impossible de mettre a jour le PB brut.");
      return false;
    }

    setPbEntries((previous) =>
      previous.map((entry) =>
        entry.id === entryId
          ? {
              ...entry,
              pbRaw: normalizedValue,
              updatedAt: now,
            }
          : entry,
      ),
    );

    if (currentEntry) {
      void logPortalActivity(session, {
        targetMemberId: currentEntry.memberId,
        targetName: targetMember?.name || currentEntry.memberName || "",
        actionType: "pb_update",
        entityType: "pb",
        entityId: String(entryId),
        summary: `${targetMember?.name || currentEntry.memberName || "Joueur"} : affi ${currentEntry.slotIndex} PB ${Number(currentEntry.pbRaw || 0)} -> ${normalizedValue}`,
        metadata: {
          slotIndex: currentEntry.slotIndex,
          championName: currentEntry.championName,
          previousPbRaw: Number(currentEntry.pbRaw || 0),
          nextPbRaw: normalizedValue,
        },
      });
    }

    return true;
  }

  async function savePbEdit() {
    if (!pbSlotToEdit) return;

    const saved = await updatePbRaw(pbSlotToEdit.entryId, pbRawInput);
    if (!saved) return;

    setPbEditDialogOpen(false);
    setPbSlotToEdit(null);
    setPbHeroSearch("");
    setPbRawInput("");
  }

  return (
    <section className="space-y-6">
      <div
        className="relative overflow-hidden rounded-[1.35rem] border border-emerald-400/30 bg-zinc-950 p-6 shadow-[0_0_44px_rgba(16,185,129,0.12)]"
        style={{
          backgroundImage:
            "linear-gradient(120deg, rgba(6,12,10,0.96), rgba(6,18,16,0.76)), url('/backgrounds/personal-best-card-preview.png')",
          backgroundPosition: "center",
          backgroundSize: "cover",
        }}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_20%,rgba(16,185,129,0.18),transparent_30%),radial-gradient(circle_at_82%_24%,rgba(250,204,21,0.12),transparent_24%)]" />
        <div className="relative z-10 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100">
              <BarChart3 className="h-4 w-4" />
              Tableur PB
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-4xl">
              Mes PB
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300 md:text-base">
              Classement des meilleurs scores, affis, top 1, top 3 et top 5 de la guilde.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:w-[600px]">
            <div className="rounded-2xl border border-zinc-800 bg-black/40 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Joueurs</div>
              <div className="mt-2 text-2xl font-semibold text-zinc-50">{summary.rowCount}</div>
            </div>
            <div className="rounded-2xl border border-emerald-300/20 bg-black/40 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Mon Top 1</div>
              <div className="mt-2 text-2xl font-semibold text-emerald-200">
                {formatPbAverage(summary.connectedTop1)}
              </div>
            </div>
            <div className="rounded-2xl border border-amber-300/20 bg-black/40 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Top 3 moyen</div>
              <div className="mt-2 text-2xl font-semibold text-amber-200">{formatPbAverage(summary.averageTop3)}</div>
            </div>
          </div>
        </div>
      </div>

      <Card className="rounded-3xl border-zinc-800 bg-zinc-950/85 shadow-2xl">
        <CardHeader className="border-b border-zinc-800 pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-lg font-semibold text-zinc-50">Classement PB</div>
              <div className="text-sm text-zinc-500">Clique une ligne pour le detail, clique une affi pour modifier.</div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {PB_SORT_OPTIONS.map((option) => (
                <Button
                  key={option.id}
                  type="button"
                  variant={pbSortMode === option.id ? "default" : "outline"}
                  className="rounded-2xl"
                  onClick={() => setPbSortMode(option.id)}
                >
                  Trier {option.label}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {errorMessage ? (
            <div className="m-5 rounded-2xl border border-red-500/35 bg-red-500/10 p-4 text-sm text-red-100">
              {errorMessage}
            </div>
          ) : null}

          {loading ? (
            <div className="p-8 text-sm text-zinc-400">Chargement des PB...</div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[1080px]">
                <div className="grid grid-cols-[190px_repeat(5,142px)_82px_82px_82px_82px] border-b border-zinc-800 bg-zinc-950/70">
                  <div className="p-3 text-lg font-semibold text-zinc-50">Nom</div>
                  {Array.from({ length: 5 }, (_, index) => (
                    <div key={index} className="p-3 text-center text-lg font-semibold text-zinc-50">
                      Affi {index + 1}
                    </div>
                  ))}
                  <div className="p-3 text-center text-sm font-semibold text-zinc-50">Top 1</div>
                  <div className="p-3 text-center text-sm font-semibold text-zinc-50">Top 3</div>
                  <div className="p-3 text-center text-sm font-semibold text-zinc-50">Top 5</div>
                  <div className="p-3 text-center text-sm font-semibold text-zinc-50">Date</div>
                </div>

                {pbRows.map((row, rowIndex) => {
                  const member = members.find((item) => item.id === row.memberId);
                  const outdated = isPbOutdated(row.updatedAt);
                  const editable = canEditRow(row.memberId);

                  return (
                    <div
                      key={row.memberId}
                      onClick={() => {
                        setPbEditDialogOpen(false);
                        setPbSlotToEdit(null);
                        setPbSelectedMember(member || { id: row.memberId, name: row.memberName });
                        setPbRowDetailOpen(true);
                      }}
                      className={`grid grid-cols-[190px_repeat(5,142px)_82px_82px_82px_82px] cursor-pointer border-b border-zinc-800 transition ${
                        outdated
                          ? "bg-red-500/10"
                          : rowIndex % 2 === 0
                            ? "bg-[#0f172a]"
                            : "bg-[#172033]"
                      } ${!outdated ? "hover:bg-[#26364f]" : ""}`}
                    >
                      <div className="flex items-center gap-2 p-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-base font-semibold text-zinc-200">
                          {rowIndex + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-base font-medium text-zinc-50">{row.memberName}</div>
                          {row.memberName === summary.bestName ? (
                            <div className="mt-1 flex items-center gap-1 text-xs text-amber-300">
                              <Trophy className="h-3.5 w-3.5" />
                            MVP
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {row.slots.map((slot, slotIndex) => {
                        if (!slot) {
                          return (
                            <div key={`${row.memberId}-empty-${slotIndex}`} className="p-2">
                              <div className="flex h-[58px] items-center justify-center rounded-2xl border border-dashed border-zinc-700 bg-zinc-950 text-xs text-zinc-500">
                                Vide
                              </div>
                            </div>
                          );
                        }

                        const isLord = slot.championLord === "lord";

                        return (
                          <div key={slot.id} className="p-2">
                            <button
                              type="button"
                              disabled={!editable}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!editable) return;
                                setPbRowDetailOpen(false);
                                setPbSelectedMember(null);
                                openPbEditDialog(slot, row.memberId);
                              }}
                              className={`flex h-[52px] w-full items-center justify-between gap-1 rounded-xl border bg-zinc-950 px-2 text-left transition ${
                                isLord
                                  ? "border-yellow-500/70 hover:bg-zinc-900"
                                  : "border-zinc-700 hover:bg-zinc-900"
                              } ${!editable ? "cursor-not-allowed opacity-70" : ""}`}
                            >
                              <div className="shrink-0">
                                {slot.championName ? (
                                  <img
                                    src={getHeroImageUrl(slot.championName)}
                                    alt={slot.championName}
                                    className="h-8 w-8 rounded-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-[10px] text-zinc-500">
                                    ?
                                  </div>
                                )}
                              </div>

                              <div className="flex flex-1 items-center justify-end pr-2">
                                <div className="text-lg font-semibold tracking-tight text-white">
                                  {formatPbAverage(getDisplayedPbValue(slot, member))}
                                </div>
                              </div>
                            </button>
                          </div>
                        );
                      })}

                      <div className="flex items-center justify-center p-2 text-xs font-semibold text-zinc-200">
                        {formatPbAverage(row.top1)}
                      </div>
                      <div className="flex items-center justify-center p-3 text-sm font-semibold text-zinc-200">
                        {formatPbAverage(row.top3)}
                      </div>
                      <div className="flex items-center justify-center p-3 text-sm font-semibold text-zinc-200">
                        {formatPbAverage(row.top5)}
                      </div>
                      <div className="flex items-center justify-center gap-1 p-2 text-xs text-zinc-300">
                        <CalendarDays className="h-3.5 w-3.5 text-zinc-500" />
                        {formatShortDate(row.updatedAt)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={pbRowDetailOpen}
        onOpenChange={(open) => {
          setPbRowDetailOpen(open);
          if (!open) setPbSelectedMember(null);
        }}
      >
        <DialogContent className="w-[95vw] !max-w-[1400px] rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle>Detail PB - {pbSelectedMember?.name || "Membre"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="text-sm text-zinc-400">Profil</div>
              <div className="mt-1 flex items-center gap-2 text-lg font-semibold text-zinc-50">
                <UserRound className="h-5 w-5" />
                {pbSelectedMember?.name || "-"}
              </div>
              <div className="text-sm text-zinc-400">{pbSelectedMember?.assignment || "-"}</div>
            </div>

            <div className="grid gap-4 lg:grid-cols-5">
              {(pbRows.find((row) => String(row.memberId) === String(pbSelectedMember?.id))?.slots || []).map(
                (slot, index) => {
                  const awakeningValue =
                    slot?.championName && pbSelectedMember?.awakenings
                      ? pbSelectedMember.awakenings[slot.championName] ?? -1
                      : -1;

                  return (
                    <div key={slot?.id || `detail-slot-${index}`} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                      <div className="mb-3 text-sm text-zinc-400">Affi {index + 1}</div>

                      {slot?.championName ? (
                        <>
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <img
                                src={getHeroImageUrl(slot.championName)}
                                alt={slot.championName}
                                className="h-14 w-14 rounded-full object-cover"
                              />
                              <div className="min-w-0">
                                <div className="truncate font-medium text-zinc-50">{slot.championName}</div>
                                {slot.championLord === "lord" ? (
                                  <Badge className="mt-1 rounded-lg bg-yellow-500/15 text-yellow-300">
                                    <Crown className="mr-1 h-3.5 w-3.5" />
                                    Lord
                                  </Badge>
                                ) : null}
                              </div>
                            </div>

                            <div className="shrink-0 text-xl font-bold text-yellow-400">
                              {getAwakeningLabel(awakeningValue)}
                            </div>
                          </div>

                          <div className="mt-4 space-y-1 text-sm">
                            <div className="text-zinc-400">
                              Brut : <span className="font-semibold text-zinc-100">{formatPbAverage(Number(slot.pbRaw || 0))}</span>
                            </div>
                            <div className="text-zinc-400">
                              Calcule :{" "}
                              <span className="font-semibold text-zinc-100">
                                {formatPbAverage(getDisplayedPbValue(slot, pbSelectedMember))}
                              </span>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950 p-4 text-sm text-zinc-500">
                          Aucun heros
                        </div>
                      )}
                    </div>
                  );
                },
              )}
            </div>

            <div className="flex justify-end">
              <Button className="rounded-2xl" onClick={() => setPbRowDetailOpen(false)}>
                Fermer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pbEditDialogOpen} onOpenChange={setPbEditDialogOpen}>
        <DialogContent className="max-w-xl rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle>Modifier PB</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm text-zinc-400">Heros</div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <Input
                  value={pbHeroSearch}
                  onChange={(event) => setPbHeroSearch(event.target.value)}
                  placeholder="Rechercher un heros..."
                  className="h-11 rounded-2xl border-zinc-700 bg-zinc-900 pl-9 text-zinc-100"
                />
              </div>

              <div className="max-h-[240px] overflow-y-auto pr-2">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {filteredPbHeroResults.map((hero) => (
                    <button
                      key={hero}
                      type="button"
                      onClick={() => selectPbHero(hero)}
                      className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-3 text-left hover:bg-zinc-800"
                    >
                      <img src={getHeroImageUrl(hero)} alt={hero} className="h-10 w-10 rounded-full object-cover" />
                      <div className="truncate text-zinc-100">{hero}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm text-zinc-400">PB brut</div>
              <Input
                type="text"
                inputMode="decimal"
                value={pbRawInput}
                onChange={(event) => setPbRawInput(event.target.value)}
                placeholder="Ex: 125.5"
                className="h-11 rounded-2xl border-zinc-700 bg-zinc-900 text-zinc-100"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                className="rounded-2xl border-zinc-700 bg-zinc-900"
                onClick={() => {
                  setPbEditDialogOpen(false);
                  setPbSlotToEdit(null);
                  setPbHeroSearch("");
                  setPbRawInput("");
                }}
              >
                Annuler
              </Button>

              <Button className="rounded-2xl" onClick={savePbEdit}>
                Enregistrer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
