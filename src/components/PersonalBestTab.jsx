import React, { useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, Crown, Search, Trophy, UserRound } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { logPortalActivity } from "@/lib/portalActivity";
import { getChampionDisplayName, getChampionEnglishName } from "@/lib/championDisplay";
import { buildPublicHeroUrl } from "@/lib/vpsAssets";
import {
  PALADIN_CLUSTER_GUILD_CODES,
  filterByGuildScope,
  isPaladinSession,
  normalizeGuildCodeKey,
} from "@/lib/guildScope";
import { usePortalLanguage } from "@/lib/portalLanguage";

const PB_SORT_OPTIONS = [
  { id: "top1", label: "Top 1" },
  { id: "top3", label: "Top 3" },
  { id: "top5", label: "Top 5" },
];

const PB_BOX_AWAKENING_VALUE = "__box__";
const PB_ENTRY_SELECT_WITH_AWAKENING = `
  id,
  member_id,
  member_name,
  slot_index,
  pb_raw,
  awakening_level,
  champion_id,
  updated_at,
  champions (*)
`;
const PB_ENTRY_SELECT_FALLBACK = `
  id,
  member_id,
  member_name,
  slot_index,
  pb_raw,
  champion_id,
  updated_at,
  champions (*)
`;

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
  const fileName = `${normalizeHeroImageName(heroName)}.png`;
  return buildPublicHeroUrl(fileName) || `/heroes/${fileName}`;
}

function getSessionGuildCode(session) {
  return session?.guildCode || session?.guild_code || "G1";
}

function getSessionRole(session) {
  return normalizeText(session?.role || "");
}

function normalizeStoredPbRaw(value) {
  let number = Number(value || 0);

  if (!Number.isFinite(number) || number <= 0) return 0;

  while (number >= 1000) {
    number /= 1000;
  }

  return number;
}

function truncatePbValue(value) {
  const number = normalizeStoredPbRaw(value);

  if (!number) return 0;

  return Math.trunc((number + Number.EPSILON) * 1000) / 1000;
}

function formatPbAverage(value) {
  const truncated = truncatePbValue(value);

  if (!truncated) return "-";

  return truncated.toFixed(3).replace(".", ",");
}

function formatPbInputValue(value) {
  const formatted = formatPbAverage(value);

  return formatted === "-" ? "" : formatted;
}

function normalizePbRawInput(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 6);

  if (!digits) return NaN;

  if (digits.length <= 3) return Number(digits);

  return Number(`${digits.slice(0, 3)}.${digits.slice(3)}`);
}

function normalizePbAwakeningValue(value) {
  if (value === PB_BOX_AWAKENING_VALUE || value === undefined) return null;

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 5) return null;

  return parsed;
}

function hasPbSlotAwakening(value) {
  if (value === null || value === undefined || value === "") return false;

  return Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 5;
}

function isMissingPbAwakeningColumn(error) {
  const message = normalizeText(`${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`);

  return (
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    (message.includes("awakening_level") &&
      (message.includes("schema cache") || message.includes("does not exist") || message.includes("column")))
  );
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

  const raw = normalizeStoredPbRaw(slot.pbRaw);

  if (slot.championLord !== "lord") {
    return raw;
  }

  const awakeningLevel = getSlotAwakeningLevel(slot, member);

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

function getSlotAwakeningLevel(slot, member) {
  if (!slot) return -1;

  if (hasPbSlotAwakening(slot.pbAwakeningLevel)) {
    return Number(slot.pbAwakeningLevel);
  }

  return slot.championName && member?.awakenings ? Number(member.awakenings[slot.championName] ?? -1) : -1;
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

function getPbChampionDisplayName(championName, championEnglishName, language) {
  return getChampionDisplayName(
    {
      name: championName,
      "English name": championEnglishName,
    },
    language,
  );
}

export default function PersonalBestTab({ session }) {
  const { language, t } = usePortalLanguage();
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
  const [pbAwakeningInput, setPbAwakeningInput] = useState(PB_BOX_AWAKENING_VALUE);
  const [pbAwakeningColumnReady, setPbAwakeningColumnReady] = useState(true);
  const [pbRowDetailOpen, setPbRowDetailOpen] = useState(false);
  const [pbSelectedMember, setPbSelectedMember] = useState(null);
  const [activeGuildCode, setActiveGuildCode] = useState(() => getSessionGuildCode(session));

  const guildCode = getSessionGuildCode(session);
  const isPaladinScope = isPaladinSession(session);
  const memberIds = useMemo(() => members.map((member) => member.id).filter(Boolean), [members]);

  const isAdmin = useMemo(() => {
    const role = getSessionRole(session);
    return (
      session?.isAdmin ||
      session?.admin ||
      role.includes("admin") ||
      role.includes("administrateur") ||
      role.includes("leader")
    );
  }, [session]);

  useEffect(() => {
    setActiveGuildCode((current) => {
      if (!isPaladinScope) return guildCode;
      if (PALADIN_CLUSTER_GUILD_CODES.includes(normalizeGuildCodeKey(current))) return current;
      if (PALADIN_CLUSTER_GUILD_CODES.includes(normalizeGuildCodeKey(guildCode))) return guildCode;
      return "G1";
    });
  }, [guildCode, isPaladinScope]);

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
              champions (*)
            )
          `)
          .order("watcher_name", { ascending: true }),
        supabase.from("champions").select("*").order("name", { ascending: true }),
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

      const scopedMembers = isPaladinScope
        ? (membersResult.data || []).filter(
            (row) => normalizeGuildCodeKey(row.guild_code) === normalizeGuildCodeKey(activeGuildCode),
          )
        : filterByGuildScope(membersResult.data || [], session, (row) => row.guild_code, {
            leaderSeesAll: false,
          });

      setMembers(
        scopedMembers.map((row) => ({
          id: row.id,
          name: row.watcher_name || "Joueur",
          discordId: row.discord_id || "",
          guildCode: row.guild_code || activeGuildCode || guildCode,
          assignment: row.assignment || "Tour",
          awakenings: buildMemberAwakenings(row.member_awakenings),
        })),
      );

      setAllHeroesData(
        (heroesResult.data || []).map((row) => ({
          id: row.id,
          name: row.name,
          englishName: getChampionEnglishName(row),
          lord: row.lord || "non-lord",
        })),
      );

      setLoading(false);
    }

    loadMembersAndHeroes();

    return () => {
      cancelled = true;
    };
  }, [activeGuildCode, guildCode, isPaladinScope, session]);

  useEffect(() => {
    let cancelled = false;

    async function loadPbEntries() {
      if (memberIds.length === 0) {
        setPbEntries([]);
        return;
      }

      let hasAwakeningColumn = true;
      let { data, error } = await supabase
        .from("member_pb_entries")
        .select(PB_ENTRY_SELECT_WITH_AWAKENING)
        .in("member_id", memberIds)
        .order("member_name", { ascending: true })
        .order("slot_index", { ascending: true });

      if (error && isMissingPbAwakeningColumn(error)) {
        hasAwakeningColumn = false;
        const fallbackResult = await supabase
          .from("member_pb_entries")
          .select(PB_ENTRY_SELECT_FALLBACK)
          .in("member_id", memberIds)
          .order("member_name", { ascending: true })
          .order("slot_index", { ascending: true });

        data = fallbackResult.data;
        error = fallbackResult.error;
      }

      if (cancelled) return;

      setPbAwakeningColumnReady(hasAwakeningColumn);

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
          pbRaw: normalizeStoredPbRaw(row.pb_raw),
          pbAwakeningLevel: hasPbSlotAwakening(row.awakening_level) ? Number(row.awakening_level) : null,
          championId: row.champion_id || null,
          championName: row.champions?.name || "",
          championEnglishName: getChampionEnglishName(row.champions),
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
        pbRaw: normalizeStoredPbRaw(entry.pbRaw),
        pbAwakeningLevel: hasPbSlotAwakening(entry.pbAwakeningLevel) ? Number(entry.pbAwakeningLevel) : null,
        championId: entry.championId,
        championName: entry.championName,
        championEnglishName: entry.championEnglishName,
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
    const heroes = allHeroesData
      .map((hero) => ({
        ...hero,
        displayName: getChampionDisplayName(hero, language),
      }))
      .filter((hero) => hero.name);

    if (!q) return heroes.slice(0, 20);

    return heroes
      .filter((hero) => normalizeText(`${hero.name} ${hero.displayName} ${hero.englishName || ""}`).includes(q))
      .slice(0, 20);
  }, [pbHeroSearch, allHeroesData, language]);

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
      currentChampionEnglishName: slot.championEnglishName || "",
      currentPbRaw: normalizeStoredPbRaw(slot.pbRaw),
      currentPbAwakeningLevel: hasPbSlotAwakening(slot.pbAwakeningLevel) ? Number(slot.pbAwakeningLevel) : null,
    });

    setPbHeroSearch(getPbChampionDisplayName(slot.championName || "", slot.championEnglishName || "", language));
    setPbRawInput(formatPbInputValue(slot.pbRaw));
    setPbAwakeningInput(hasPbSlotAwakening(slot.pbAwakeningLevel) ? String(slot.pbAwakeningLevel) : PB_BOX_AWAKENING_VALUE);
    setPbEditDialogOpen(true);
  }

  async function selectPbHero(champion) {
    if (!pbSlotToEdit?.entryId) return;

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
              championEnglishName: champion.englishName || "",
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
            currentChampionEnglishName: champion.englishName || "",
          }
        : previous,
    );
    setPbHeroSearch(getChampionDisplayName(champion, language));
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
        nextHeroDisplayName: getChampionDisplayName(champion, language),
        championId: champion.id,
      },
    });
  }

  async function updatePbRaw(entryId, nextValue, nextAwakeningValue) {
    const normalizedValue = normalizePbRawInput(nextValue);
    const normalizedAwakening = normalizePbAwakeningValue(nextAwakeningValue);
    const currentEntry = pbEntries.find((entry) => String(entry.id) === String(entryId));
    const targetMember = currentEntry
      ? members.find((member) => String(member.id) === String(currentEntry.memberId))
      : null;

    if (Number.isNaN(normalizedValue)) {
      setErrorMessage("Le PB brut doit etre une valeur numerique.");
      return false;
    }

    const now = new Date().toISOString();
    const updatePayload = {
      pb_raw: normalizedValue,
      updated_at: now,
    };

    if (pbAwakeningColumnReady) {
      updatePayload.awakening_level = normalizedAwakening;
    }

    const { error } = await supabase
      .from("member_pb_entries")
      .update(updatePayload)
      .eq("id", entryId);

    if (error) {
      if (isMissingPbAwakeningColumn(error)) {
        setPbAwakeningColumnReady(false);
      }
      console.error("Erreur mise a jour PB brut:", error);
      setErrorMessage(
        isMissingPbAwakeningColumn(error)
          ? "La colonne Supabase awakening_level manque sur member_pb_entries."
          : "Impossible de mettre a jour le PB brut.",
      );
      return false;
    }

    setPbEntries((previous) =>
      previous.map((entry) =>
        entry.id === entryId
          ? {
              ...entry,
              pbRaw: normalizedValue,
              pbAwakeningLevel: pbAwakeningColumnReady ? normalizedAwakening : entry.pbAwakeningLevel,
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
        summary: `${targetMember?.name || currentEntry.memberName || "Joueur"} : affi ${currentEntry.slotIndex} PB ${formatPbAverage(currentEntry.pbRaw)} -> ${formatPbAverage(normalizedValue)}`,
        metadata: {
          slotIndex: currentEntry.slotIndex,
          championName: currentEntry.championName,
          previousPbRaw: normalizeStoredPbRaw(currentEntry.pbRaw),
          nextPbRaw: normalizedValue,
          previousAwakeningLevel: currentEntry.pbAwakeningLevel,
          nextAwakeningLevel: pbAwakeningColumnReady ? normalizedAwakening : currentEntry.pbAwakeningLevel,
        },
      });
    }

    return true;
  }

  async function savePbEdit() {
    if (!pbSlotToEdit) return;

    const saved = await updatePbRaw(pbSlotToEdit.entryId, pbRawInput, pbAwakeningInput);
    if (!saved) return;

    setPbEditDialogOpen(false);
    setPbSlotToEdit(null);
    setPbHeroSearch("");
    setPbRawInput("");
    setPbAwakeningInput(PB_BOX_AWAKENING_VALUE);
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
              {t("pb.kicker", "Tableur PB")}
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-4xl">
              {t("pb.title", "Mes PB")}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300 md:text-base">
              {t("pb.description", "Classement des meilleurs scores, affis, top 1, top 3 et top 5 de la guilde.")}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:w-[600px]">
            <div className="rounded-2xl border border-zinc-800 bg-black/40 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">{t("pb.players", "Joueurs")}</div>
              <div className="mt-2 text-2xl font-semibold text-zinc-50">{summary.rowCount}</div>
            </div>
            <div className="rounded-2xl border border-emerald-300/20 bg-black/40 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">{t("pb.myTop1", "Mon Top 1")}</div>
              <div className="mt-2 text-2xl font-semibold text-emerald-200">
                {formatPbAverage(summary.connectedTop1)}
              </div>
            </div>
            <div className="rounded-2xl border border-amber-300/20 bg-black/40 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">{t("pb.averageTop3", "Top 3 moyen")}</div>
              <div className="mt-2 text-2xl font-semibold text-amber-200">{formatPbAverage(summary.averageTop3)}</div>
            </div>
          </div>
        </div>
      </div>

      <Card className="rounded-3xl border-zinc-800 bg-zinc-950/85 shadow-2xl">
        <CardHeader className="border-b border-zinc-800 pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-lg font-semibold text-zinc-50">{t("pb.ranking", "Classement PB")}</div>
              <div className="text-sm text-zinc-500">{t("pb.rowHelp", "Clique une ligne pour le detail, clique une affi pour modifier.")}</div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isPaladinScope ? (
                <div className="mr-2 flex flex-wrap gap-2">
                  {PALADIN_CLUSTER_GUILD_CODES.map((code) => (
                    <Button
                      key={code}
                      type="button"
                      variant={normalizeGuildCodeKey(activeGuildCode) === code ? "default" : "outline"}
                      className="rounded-2xl"
                      onClick={() => setActiveGuildCode(code)}
                    >
                      {code}
                    </Button>
                  ))}
                </div>
              ) : null}
              {PB_SORT_OPTIONS.map((option) => (
                <Button
                  key={option.id}
                  type="button"
                  variant={pbSortMode === option.id ? "default" : "outline"}
                  className="rounded-2xl"
                  onClick={() => setPbSortMode(option.id)}
                >
                  {t("pb.sort", "Trier")} {option.label}
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
            <div className="p-8 text-sm text-zinc-400">{t("pb.loading", "Chargement des PB...")}</div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[1080px]">
                <div className="grid grid-cols-[190px_repeat(5,142px)_82px_82px_82px_82px] border-b border-zinc-800 bg-zinc-950/70">
                  <div className="p-3 text-lg font-semibold text-zinc-50">{t("pb.name", "Nom")}</div>
                  {Array.from({ length: 5 }, (_, index) => (
                    <div key={index} className="p-3 text-center text-lg font-semibold text-zinc-50">
                      Affi {index + 1}
                    </div>
                  ))}
                  <div className="p-3 text-center text-sm font-semibold text-zinc-50">Top 1</div>
                  <div className="p-3 text-center text-sm font-semibold text-zinc-50">Top 3</div>
                  <div className="p-3 text-center text-sm font-semibold text-zinc-50">Top 5</div>
                  <div className="p-3 text-center text-sm font-semibold text-zinc-50">{t("pb.date", "Date")}</div>
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
                                {t("common.empty", "Vide")}
                              </div>
                            </div>
                          );
                        }

                        const isLord = slot.championLord === "lord";
                        const slotAwakening = getSlotAwakeningLevel(slot, member);
                        const slotDisplayName = getPbChampionDisplayName(
                          slot.championName,
                          slot.championEnglishName,
                          language,
                        );

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
                                    alt={slotDisplayName}
                                    className="h-8 w-8 rounded-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-[10px] text-zinc-500">
                                    ?
                                  </div>
                                )}
                              </div>

                              <div className="flex flex-1 items-center justify-end pr-2">
                                <div className="text-right">
                                  {isLord && slotAwakening >= 0 ? (
                                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-yellow-300">
                                      A{slotAwakening}
                                    </div>
                                  ) : null}
                                  <div className="text-lg font-semibold tracking-tight text-white">
                                    {formatPbAverage(getDisplayedPbValue(slot, member))}
                                  </div>
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
            <DialogTitle>{t("pb.detail", "Detail PB")} - {pbSelectedMember?.name || "Membre"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="text-sm text-zinc-400">{t("home.profile", "Profil")}</div>
              <div className="mt-1 flex items-center gap-2 text-lg font-semibold text-zinc-50">
                <UserRound className="h-5 w-5" />
                {pbSelectedMember?.name || "-"}
              </div>
              <div className="text-sm text-zinc-400">{pbSelectedMember?.assignment || "-"}</div>
            </div>

            <div className="grid gap-4 lg:grid-cols-5">
              {(pbRows.find((row) => String(row.memberId) === String(pbSelectedMember?.id))?.slots || []).map(
                (slot, index) => {
                  const awakeningValue = getSlotAwakeningLevel(slot, pbSelectedMember);
                  const slotDisplayName = getPbChampionDisplayName(
                    slot?.championName || "",
                    slot?.championEnglishName || "",
                    language,
                  );

                  return (
                    <div key={slot?.id || `detail-slot-${index}`} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                      <div className="mb-3 text-sm text-zinc-400">Affi {index + 1}</div>

                      {slot?.championName ? (
                        <>
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <img
                                src={getHeroImageUrl(slot.championName)}
                                alt={slotDisplayName}
                                className="h-14 w-14 rounded-full object-cover"
                              />
                              <div className="min-w-0">
                                <div className="truncate font-medium text-zinc-50">{slotDisplayName}</div>
                                {language === "en" && slotDisplayName !== slot.championName ? (
                                  <div className="truncate text-xs text-zinc-500">{slot.championName}</div>
                                ) : null}
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
                              {t("pb.raw", "Brut")} : <span className="font-semibold text-zinc-100">{formatPbAverage(Number(slot.pbRaw || 0))}</span>
                            </div>
                            <div className="text-zinc-400">
                              {t("pb.calculated", "Calcule")} :{" "}
                              <span className="font-semibold text-zinc-100">
                                {formatPbAverage(getDisplayedPbValue(slot, pbSelectedMember))}
                              </span>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950 p-4 text-sm text-zinc-500">
                          {t("pb.noHero", "Aucun heros")}
                        </div>
                      )}
                    </div>
                  );
                },
              )}
            </div>

            <div className="flex justify-end">
              <Button className="rounded-2xl" onClick={() => setPbRowDetailOpen(false)}>
                {t("common.close", "Fermer")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pbEditDialogOpen} onOpenChange={setPbEditDialogOpen}>
        <DialogContent className="max-w-xl rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle>{t("pb.editTitle", "Modifier PB")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm text-zinc-400">{t("common.hero", "Heros")}</div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <Input
                  value={pbHeroSearch}
                  onChange={(event) => setPbHeroSearch(event.target.value)}
                  placeholder={t("heroBox.searchHero", "Rechercher un heros...")}
                  className="h-11 rounded-2xl border-zinc-700 bg-zinc-900 pl-9 text-zinc-100"
                />
              </div>

              <div className="max-h-[240px] overflow-y-auto pr-2">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {filteredPbHeroResults.map((hero) => (
                    <button
                      key={hero.id || hero.name}
                      type="button"
                      onClick={() => selectPbHero(hero)}
                      className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-3 text-left hover:bg-zinc-800"
                    >
                      <img src={getHeroImageUrl(hero.name)} alt={hero.displayName} className="h-10 w-10 rounded-full object-cover" />
                      <div className="min-w-0">
                        <div className="truncate text-zinc-100">{hero.displayName}</div>
                        {language === "en" && hero.displayName !== hero.name ? (
                          <div className="truncate text-xs text-zinc-500">{hero.name}</div>
                        ) : null}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm text-zinc-400">{t("pb.raw", "PB brut")}</div>
              <Input
                type="text"
                inputMode="decimal"
                value={pbRawInput}
                onChange={(event) => setPbRawInput(event.target.value)}
                placeholder={t("pb.rawPlaceholder", "Ex: 138485")}
                className="h-11 rounded-2xl border-zinc-700 bg-zinc-900 text-zinc-100"
              />
            </div>

            <div className="space-y-2">
              <div className="text-sm text-zinc-400">{t("pb.slotAwakening", "Eveil utilise pour ce PB")}</div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!pbAwakeningColumnReady}
                  onClick={() => setPbAwakeningInput(PB_BOX_AWAKENING_VALUE)}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                    pbAwakeningInput === PB_BOX_AWAKENING_VALUE
                      ? "border-emerald-300/70 bg-emerald-400/15 text-emerald-100"
                      : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
                  } ${!pbAwakeningColumnReady ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  {t("pb.boxAwakening", "Box")}
                </button>
                {[0, 1, 2, 3, 4, 5].map((level) => (
                  <button
                    key={level}
                    type="button"
                    disabled={!pbAwakeningColumnReady}
                    onClick={() => setPbAwakeningInput(String(level))}
                    className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                      pbAwakeningInput === String(level)
                        ? "border-yellow-300/70 bg-yellow-400/15 text-yellow-100"
                        : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
                    } ${!pbAwakeningColumnReady ? "cursor-not-allowed opacity-50" : ""}`}
                  >
                    A{level}
                  </button>
                ))}
              </div>
              <div className="text-xs text-zinc-500">
                {pbAwakeningColumnReady
                  ? t("pb.slotAwakeningHelp", "Box garde l'eveil renseigne dans Ma box heros. A0-A5 force l'eveil de cet affi uniquement.")
                  : "Colonne Supabase awakening_level manquante sur member_pb_entries."}
              </div>
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
                  setPbAwakeningInput(PB_BOX_AWAKENING_VALUE);
                }}
              >
                {t("common.cancel", "Annuler")}
              </Button>

              <Button className="rounded-2xl" onClick={savePbEdit}>
                {t("common.save", "Enregistrer")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
