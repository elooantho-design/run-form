import React, { useEffect, useMemo, useState } from "react";
import { Search, Shield, Skull, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getGuildDisplayName } from "@/lib/guildDisplay";
import { logPortalActivity } from "@/lib/portalActivity";
import { usePortalLanguage } from "@/lib/portalLanguage";

const DEMON_RARITY_FILTERS = [
  { id: "Tous", label: "Tous", labelKey: "common.all", tone: "border-zinc-600 bg-zinc-900 text-zinc-100" },
  { id: "mythique", label: "Mythique", labelKey: "demon.rarity.mythic", tone: "border-fuchsia-300 bg-fuchsia-300 text-black" },
  { id: "legendaire", label: "Legendaire", labelKey: "demon.rarity.legendary", tone: "border-yellow-300 bg-yellow-300 text-black" },
  { id: "epique", label: "Epique", labelKey: "demon.rarity.epic", tone: "border-violet-300 bg-violet-300 text-black" },
  { id: "rare", label: "Rare", labelKey: "demon.rarity.rare", tone: "border-sky-300 bg-sky-300 text-black" },
];

const DEMON_RARITY_TONES = {
  mythique: {
    label: "Mythique",
    border: "border-fuchsia-300/70",
    glow: "shadow-[0_0_34px_rgba(217,70,239,0.28)]",
    badge: "border-fuchsia-300/40 bg-fuchsia-300/12 text-fuchsia-100",
  },
  legendaire: {
    label: "Legendaire",
    border: "border-yellow-300/70",
    glow: "shadow-[0_0_34px_rgba(250,204,21,0.24)]",
    badge: "border-yellow-300/40 bg-yellow-300/12 text-yellow-100",
  },
  epique: {
    label: "Epique",
    border: "border-violet-300/70",
    glow: "shadow-[0_0_34px_rgba(167,139,250,0.24)]",
    badge: "border-violet-300/40 bg-violet-300/12 text-violet-100",
  },
  rare: {
    label: "Rare",
    border: "border-sky-300/70",
    glow: "shadow-[0_0_34px_rgba(56,189,248,0.22)]",
    badge: "border-sky-300/40 bg-sky-300/12 text-sky-100",
  },
};

function getDemonicMonsterImageUrl(slug) {
  return `/demonic-monsters/${slug}.png`;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getSessionRole(session) {
  return normalizeText(session?.role || "");
}

async function callPortalPlayerData(payload) {
  const configuredBase = import.meta.env?.VITE_API_BASE_URL;
  const isLocal =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  const apiBase = configuredBase ? configuredBase.replace(/\/$/, "") : isLocal ? "http://localhost:3000" : "";
  const response = await fetch(`${apiBase}/api/portal-player-data`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json?.ok === false) {
    throw new Error(json?.error || "Erreur API Portal.");
  }
  return json;
}

export default function DemonMonstersTab({ session }) {
  const { t } = usePortalLanguage();
  const [members, setMembers] = useState([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [demonicMonsters, setDemonicMonsters] = useState([]);
  const [memberDemonicEntries, setMemberDemonicEntries] = useState([]);
  const [rarityFilter, setRarityFilter] = useState("Tous");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [levelDialogOpen, setLevelDialogOpen] = useState(false);
  const [selectedMonster, setSelectedMonster] = useState(null);
  const [levelInput, setLevelInput] = useState("");
  const [levelSaving, setLevelSaving] = useState(false);
  const [ownerSearchOpen, setOwnerSearchOpen] = useState(false);
  const [ownerSearchGuildCode, setOwnerSearchGuildCode] = useState("");
  const [ownerSearchMonsterId, setOwnerSearchMonsterId] = useState("");
  const [ownerSearchMonsterQuery, setOwnerSearchMonsterQuery] = useState("");
  const [ownerSearchMinimumLevel, setOwnerSearchMinimumLevel] = useState("");
  const [ownerSearchLoading, setOwnerSearchLoading] = useState(false);
  const [ownerSearchError, setOwnerSearchError] = useState("");
  const [ownerSearchResults, setOwnerSearchResults] = useState([]);
  const [ownerSearchSearched, setOwnerSearchSearched] = useState(false);
  const sessionMemberId = session?.memberId || session?.id || "";
  const sessionOrganizationKey = session?.organizationKey || session?.organization_key || "";

  const selectedMember = useMemo(() => {
    return (
      members.find((member) => String(member.id) === String(selectedMemberId)) ||
      members.find((member) => sessionMemberId && String(member.id) === String(sessionMemberId)) ||
      members[0] ||
      null
    );
  }, [members, selectedMemberId, sessionMemberId]);

  const memberSuggestions = useMemo(() => {
    const normalizedQuery = normalizeText(memberQuery);

    return members
      .filter((member) => {
        if (!normalizedQuery) return true;
        return normalizeText(`${member.name} ${member.discordId} ${member.guildCode}`).includes(normalizedQuery);
      })
      .slice(0, 8);
  }, [memberQuery, members]);

  const accessibleGuildOptions = useMemo(() => {
    const guildsByCode = new Map();

    members.forEach((member) => {
      const guildCode = String(member.guildCode || "").trim();
      if (!guildCode || guildCode === "COMMUNITY") return;
      if (guildsByCode.has(guildCode)) return;
      guildsByCode.set(guildCode, {
        guildCode,
        label: getGuildDisplayName({
          guildCode,
          organizationKey: sessionOrganizationKey,
        }),
      });
    });

    return Array.from(guildsByCode.values()).sort((left, right) =>
      left.guildCode.localeCompare(right.guildCode, "fr", { numeric: true, sensitivity: "base" }),
    );
  }, [members, sessionOrganizationKey]);

  const ownerSearchMonsterOptions = useMemo(() => {
    const normalizedQuery = normalizeText(ownerSearchMonsterQuery);

    return demonicMonsters
      .filter((monster) => {
        if (!normalizedQuery) return true;
        return normalizeText(`${monster.name} ${monster.slug} ${monster.rarity}`).includes(normalizedQuery);
      })
      .slice(0, 10);
  }, [demonicMonsters, ownerSearchMonsterQuery]);

  const selectedOwnerSearchMonster = useMemo(() => {
    return demonicMonsters.find((monster) => String(monster.id) === String(ownerSearchMonsterId)) || null;
  }, [demonicMonsters, ownerSearchMonsterId]);

  const canEditDemonicMonsters = useMemo(() => {
    if (typeof selectedMember?.permissions?.canEdit === "boolean") {
      return selectedMember.permissions.canEdit;
    }

    const role = getSessionRole(session);
    const isAdmin =
      session?.isAdmin ||
      session?.admin ||
      role.includes("admin") ||
      role.includes("administrateur") ||
      role.includes("leader");
    const isOwnProfile =
      selectedMember?.id && sessionMemberId
        ? String(selectedMember.id) === String(sessionMemberId)
        : true;

    return isAdmin || isOwnProfile;
  }, [selectedMember, session, sessionMemberId]);

  useEffect(() => {
    if (!ownerSearchOpen) return;
    const selectedGuildStillAvailable = accessibleGuildOptions.some(
      (guild) => String(guild.guildCode) === String(ownerSearchGuildCode),
    );
    if (!selectedGuildStillAvailable && accessibleGuildOptions[0]?.guildCode) {
      setOwnerSearchGuildCode(accessibleGuildOptions[0].guildCode);
    } else if (!selectedGuildStillAvailable) {
      setOwnerSearchGuildCode("");
    }
  }, [accessibleGuildOptions, ownerSearchGuildCode, ownerSearchOpen]);

  useEffect(() => {
    let cancelled = false;

    async function loadSelectedMemberDemonicEntries() {
      setLoading(true);
      setEntriesLoading(true);
      setErrorMessage("");

      try {
        const data = await callPortalPlayerData({
          action: "demonicMonsters",
          memberId: selectedMemberId,
        });
        if (cancelled) return;

        const mappedMembers = (data.members || []).map((row) => ({
          id: row.id,
          name: row.name || row.watcher_name || "Joueur",
          discordId: row.discord_id || row.discordId || "",
          guildCode: row.guild_code || row.guildCode || "",
          primaryMemberId: row.primary_member_id || row.primaryMemberId || null,
          permissions: row.permissions || null,
        }));
        setMembers(mappedMembers);
        let nextSelectedMemberId = data.selectedMemberId || "";
        if (!nextSelectedMemberId && selectedMemberId) {
          const currentMember = mappedMembers.find((member) => String(member.id) === String(selectedMemberId));
          if (currentMember) nextSelectedMemberId = currentMember.id;
        }
        if (!nextSelectedMemberId && sessionMemberId) {
          const sessionMember = mappedMembers.find((member) => String(member.id) === String(sessionMemberId));
          if (sessionMember) nextSelectedMemberId = sessionMember.id;
        }
        if (!nextSelectedMemberId) {
          nextSelectedMemberId = mappedMembers[0]?.id || "";
        }
        if (String(nextSelectedMemberId) !== String(selectedMemberId)) {
          setSelectedMemberId(nextSelectedMemberId);
        }
        setDemonicMonsters(data.monsters || []);
        setMemberDemonicEntries(
          (data.entries || []).map((row) => ({
            id: row.id,
            memberId: row.member_id,
            monsterId: row.monster_id,
            level: Number(row.level || 0),
            monsterName: row.demonic_monsters?.name || "",
            monsterSlug: row.demonic_monsters?.slug || "",
            rarity: row.demonic_monsters?.rarity || "",
          })),
        );
      } catch (error) {
        if (!cancelled) {
          console.error("Erreur chargement monstres demoniaques:", error);
          setErrorMessage(error?.message || "Impossible de charger les monstres demoniaques.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setEntriesLoading(false);
        }
      }
    }

    loadSelectedMemberDemonicEntries();

    return () => {
      cancelled = true;
    };
  }, [selectedMemberId, sessionMemberId]);

  const demonicMonsterCards = useMemo(() => {
    const normalizedQuery = normalizeText(query);

    return demonicMonsters
      .filter((monster) => {
        const rarityMatches = rarityFilter === "Tous" || monster.rarity === rarityFilter;
        const queryMatches =
          !normalizedQuery ||
          normalizeText(monster.name).includes(normalizedQuery) ||
          normalizeText(monster.slug).includes(normalizedQuery);

        return rarityMatches && queryMatches;
      })
      .map((monster) => {
        const memberEntry = memberDemonicEntries.find(
          (entry) => String(entry.monsterId) === String(monster.id),
        );

        return {
          ...monster,
          level: memberEntry?.level ?? 0,
          entryId: memberEntry?.id ?? null,
          isOwned: (memberEntry?.level ?? 0) > 0,
          image: monster.image_url || getDemonicMonsterImageUrl(monster.slug),
        };
      });
  }, [demonicMonsters, memberDemonicEntries, query, rarityFilter]);

  const ownedCount = useMemo(() => {
    return memberDemonicEntries.filter((entry) => entry.level > 0).length;
  }, [memberDemonicEntries]);

  const maxLevelCount = useMemo(() => {
    return memberDemonicEntries.filter((entry) => entry.level >= 20).length;
  }, [memberDemonicEntries]);

  function openLevelDialog(monster) {
    if (!canEditDemonicMonsters) return;

    setSelectedMonster(monster);
    setLevelInput(monster.level > 0 ? String(monster.level) : "");
    setLevelDialogOpen(true);
  }

  async function saveDemonLevel() {
    if (!selectedMember?.id || !selectedMonster?.id) return;

    const parsedLevel = Number(levelInput);
    const previousLevel = Number(selectedMonster.level || 0);

    if (!Number.isInteger(parsedLevel) || parsedLevel < 0 || parsedLevel > 20) {
      alert("Le niveau doit etre un nombre entier entre 0 et 20.");
      return;
    }

    try {
      setLevelSaving(true);

      const data = await callPortalPlayerData({
        action: "setDemonicMonsterLevel",
        memberId: selectedMember.id,
        monsterId: selectedMonster.id,
        level: parsedLevel,
      });
      const savedEntry = data.entry;

      const nextEntry = {
        id: savedEntry.id,
        memberId: savedEntry.member_id,
        monsterId: savedEntry.monster_id,
        level: Number(savedEntry.level || 0),
        monsterName: selectedMonster.name || "",
        monsterSlug: selectedMonster.slug || "",
        rarity: selectedMonster.rarity || "",
      };

      setMemberDemonicEntries((previousEntries) => {
        const existingIndex = previousEntries.findIndex(
          (entry) =>
            String(entry.memberId) === String(selectedMember.id) &&
            String(entry.monsterId) === String(selectedMonster.id),
        );

        if (existingIndex === -1) {
          return [...previousEntries, nextEntry];
        }

        return previousEntries.map((entry, index) => (index === existingIndex ? nextEntry : entry));
      });

      void logPortalActivity(session, {
        targetMemberId: selectedMember.id,
        targetName: selectedMember.name,
        actionType: "demon_monster_update",
        entityType: "demonic_monster",
        entityId: String(selectedMonster.id),
        summary: `${selectedMember.name} : ${selectedMonster.name || selectedMonster.slug} niveau ${previousLevel} -> ${parsedLevel}`,
        metadata: {
          monsterId: selectedMonster.id,
          monsterName: selectedMonster.name || "",
          previousLevel,
          nextLevel: parsedLevel,
        },
      });
      setLevelDialogOpen(false);
      setSelectedMonster(null);
      setLevelInput("");
    } catch (error) {
      console.error("Erreur sauvegarde monstre demoniaque:", error);
      alert("Une erreur est survenue pendant la sauvegarde.");
    } finally {
      setLevelSaving(false);
    }
  }

  async function runOwnerSearch() {
    if (!ownerSearchGuildCode) {
      setOwnerSearchError(t("demon.ownerSearchMissingGuild", "Selectionne une guilde."));
      return;
    }
    if (!ownerSearchMonsterId) {
      setOwnerSearchError(t("demon.ownerSearchMissingMonster", "Selectionne un monstre."));
      return;
    }

    try {
      setOwnerSearchLoading(true);
      setOwnerSearchError("");
      setOwnerSearchSearched(true);

      const data = await callPortalPlayerData({
        action: "searchDemonicMonsterOwners",
        guildCode: ownerSearchGuildCode,
        monsterId: ownerSearchMonsterId,
        minimumLevel: ownerSearchMinimumLevel.trim() ? ownerSearchMinimumLevel.trim() : null,
      });

      setOwnerSearchResults(data.results || []);
    } catch (error) {
      console.error("Erreur recherche proprietaires monstre demoniaque:", error);
      setOwnerSearchResults([]);
      setOwnerSearchError(error?.message || t("demon.ownerSearchError", "Une erreur est survenue."));
    } finally {
      setOwnerSearchLoading(false);
    }
  }

  function openOwnerSearchResult(result) {
    if (!result?.memberId) return;
    setSelectedMemberId(result.memberId);
    setMemberQuery(result.watcherName || "");
    setOwnerSearchOpen(false);
  }

  return (
    <section className="space-y-6">
      <div className="relative overflow-hidden rounded-[1.35rem] border border-red-500/35 bg-zinc-950 p-6 shadow-[0_0_40px_rgba(127,29,29,0.22)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(239,68,68,0.18),transparent_30%),radial-gradient(circle_at_82%_18%,rgba(251,146,60,0.12),transparent_26%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(9,9,11,0.94))]" />
        <div className="relative z-10 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-red-400/30 bg-red-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-red-100">
              <Skull className="h-4 w-4" />
              {t("demon.eyebrow", "Bibliotheque demoniaque")}
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-4xl">
              {t("demon.title", "Monstres demoniaques")}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300 md:text-base">
              {t("demon.description", "Reprend le fonctionnement de l'ancien dashboard : bibliotheque, raretes, niveaux et sauvegarde par joueur.")}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:w-[520px]">
            <div className="rounded-2xl border border-zinc-800 bg-black/35 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">{t("demon.owned", "Possedes")}</div>
              <div className="mt-2 text-2xl font-semibold text-zinc-50">{ownedCount}</div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-black/35 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">{t("demon.level20", "Niveau 20")}</div>
              <div className="mt-2 text-2xl font-semibold text-amber-200">{maxLevelCount}</div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-black/35 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">{t("demon.displayed", "Affiches")}</div>
              <div className="mt-2 text-2xl font-semibold text-red-100">{demonicMonsterCards.length}</div>
            </div>
          </div>
        </div>
      </div>

      <Card className="rounded-3xl border-zinc-800 bg-zinc-950/80 shadow-2xl">
        <CardContent className="p-0">
          <div className="grid min-h-[720px] grid-cols-1 xl:grid-cols-[260px_1fr]">
            <aside className="border-b border-zinc-800 p-5 xl:border-b-0 xl:border-r">
              <div>
                <div className="text-lg font-semibold text-zinc-50">{t("common.filters", "Filtres")}</div>
                <div className="mt-1 text-sm text-zinc-500">{t("demon.filtersHelp", "Rarete et joueur actif")}</div>
              </div>

              <div className="mt-5 space-y-3">
                {DEMON_RARITY_FILTERS.map((filter) => {
                  const selected = rarityFilter === filter.id;

                  return (
                    <button
                      key={filter.id}
                      type="button"
                      onClick={() => setRarityFilter(filter.id)}
                      className={`w-full rounded-2xl border px-4 py-3 text-left font-medium transition ${
                        selected
                          ? filter.tone
                          : "border-zinc-800 bg-zinc-900/70 text-zinc-300 hover:border-red-400/50 hover:bg-zinc-900"
                      }`}
                    >
                      {t(filter.labelKey, filter.label)}
                    </button>
                  );
                })}
              </div>

              <div className="mt-6 space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500" htmlFor="demon-member">
                  {t("common.clusterPlayer", "Joueur du cluster")}
                </label>
                <div className="flex h-10 items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 ring-red-400/30 transition focus-within:border-red-400 focus-within:ring-2">
                  <Search className="h-4 w-4 shrink-0 text-zinc-500" />
                  <input
                    id="demon-member"
                    type="search"
                    value={memberQuery}
                    onChange={(event) => setMemberQuery(event.target.value)}
                    placeholder={t("common.searchPlayer", "Rechercher un joueur")}
                    className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
                  />
                </div>

                <div className="max-h-64 space-y-2 overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950/80 p-2">
                  {memberSuggestions.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-zinc-500">{t("common.noPlayerFound", "Aucun joueur trouve.")}</div>
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
                              ? "border-red-300/60 bg-red-500/10 text-white"
                              : "border-transparent bg-zinc-900/70 text-zinc-300 hover:border-red-400/35 hover:bg-zinc-900"
                          }`}
                        >
                          <span className="block truncate text-sm font-semibold">{member.name}</span>
                          <span className="mt-0.5 block truncate text-xs text-zinc-500">
                            {getGuildDisplayName({
                              guildCode: member.guildCode,
                              emptyFallback: t("common.community", "Communauté"),
                            })}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-400">
                <div className="flex items-center gap-2 font-medium text-zinc-200">
                  <Shield className="h-4 w-4 text-red-200" />
                  {selectedMember?.name || t("common.noMember", "Aucun membre")}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {getGuildDisplayName({
                    guildCode: selectedMember?.guildCode,
                    emptyFallback: t("common.community", "Communauté"),
                  })}
                </div>
                <p className="mt-2 leading-5">
                  {t("demon.levelHelp", "Clique sur le niveau au centre d'une carte pour renseigner ou corriger le niveau du monstre.")}
                </p>
              </div>
            </aside>

            <div className="p-5">
              <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-lg font-semibold text-zinc-50">{t("demon.boxTitle", "Box monstres demoniaques")}</div>
                  <div className="text-sm text-zinc-500">
                    {loading || entriesLoading
                      ? t("common.loading", "Chargement...")
                      : `${demonicMonsterCards.length} ${t("demon.monstersDisplayed", "monstre(s) affiche(s)")}`}
                  </div>
                </div>

                <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 rounded-xl border-red-400/40 bg-red-500/10 text-red-50 hover:bg-red-500/20"
                    onClick={() => setOwnerSearchOpen(true)}
                  >
                    <Search className="mr-2 h-4 w-4" />
                    {t("demon.ownerSearchButton", "Rechercher qui possede")}
                  </Button>

                  <div className="relative w-full sm:w-[340px]">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={t("demon.searchMonster", "Rechercher un monstre")}
                      className="h-11 rounded-xl border-zinc-800 bg-zinc-950 pl-9 text-zinc-100"
                    />
                  </div>
                </div>
              </div>

              {errorMessage ? (
                <div className="mb-5 rounded-2xl border border-red-500/35 bg-red-500/10 p-4 text-sm text-red-100">
                  {errorMessage}
                </div>
              ) : null}

              {loading ? (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-8 text-sm text-zinc-400">
                  {t("demon.libraryLoading", "Chargement de la bibliotheque...")}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                  {demonicMonsterCards.map((monster) => {
                    const tone = DEMON_RARITY_TONES[monster.rarity] || DEMON_RARITY_TONES.rare;

                    return (
                      <article
                        key={monster.id}
                        className={`rounded-3xl border bg-zinc-950 p-4 ${tone.border} ${monster.level > 0 ? tone.glow : "border-zinc-800"}`}
                      >
                        <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-black">
                          <img
                            src={monster.image}
                            alt={monster.name}
                            className={`h-[260px] w-full object-contain transition duration-300 ${
                              monster.level > 0 ? "" : "grayscale opacity-40"
                            }`}
                          />
                          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black via-black/55 to-transparent" />
                          <Badge className={`absolute left-3 top-3 rounded-full ${tone.badge}`}>
                            {t(`demon.rarity.${monster.rarity}`, tone.label)}
                          </Badge>
                          <button
                            type="button"
                            onClick={() => openLevelDialog(monster)}
                            disabled={!canEditDemonicMonsters}
                            className={`absolute bottom-4 left-1/2 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full border-2 text-xl font-bold text-white shadow-lg transition ${
                              canEditDemonicMonsters
                                ? "border-zinc-500 bg-zinc-800/95 hover:scale-105 hover:border-red-200 hover:bg-red-950"
                                : "cursor-not-allowed border-zinc-700 bg-zinc-800 opacity-60"
                            }`}
                            title={canEditDemonicMonsters ? t("demon.setLevel", "Renseigner le niveau") : t("common.editNotAllowed", "Modification non autorisee")}
                          >
                            {monster.level > 0 ? monster.level : "?"}
                          </button>
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-3">
                          <div>
                            <div className="text-base font-semibold text-zinc-50">{monster.name}</div>
                            <div className="text-sm text-zinc-500">{monster.slug}</div>
                          </div>
                          <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                            <Sparkles className="h-4 w-4" />
                            {t("demon.levelShort", "Niv.")} {monster.level || 0}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={levelDialogOpen} onOpenChange={setLevelDialogOpen}>
        <DialogContent className="max-w-md rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle>{t("demon.setLevel", "Renseigner le niveau")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="text-sm text-zinc-400">{t("demon.selectedMonster", "Monstre selectionne")}</div>
              <div className="mt-1 font-medium text-zinc-50">
                {selectedMonster?.name || selectedMonster?.slug || "-"}
              </div>
              <div className="text-sm text-zinc-400">{t("demon.currentLevel", "Niveau actuel")} : {selectedMonster?.level || 0}</div>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-zinc-400" htmlFor="demon-level-input">
                {t("demon.monsterLevel", "Niveau du monstre")}
              </label>
              <Input
                id="demon-level-input"
                type="number"
                min="0"
                max="20"
                value={levelInput}
                onChange={(event) => setLevelInput(event.target.value)}
                placeholder={t("demon.levelPlaceholder", "Entre 0 et 20")}
                className="h-11 rounded-2xl border-zinc-700 bg-zinc-900 text-zinc-100"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                className="rounded-2xl border-zinc-700 bg-zinc-900"
                onClick={() => {
                  setLevelDialogOpen(false);
                  setSelectedMonster(null);
                  setLevelInput("");
                }}
                disabled={levelSaving}
              >
                {t("common.cancel", "Annuler")}
              </Button>

              <Button className="rounded-2xl" onClick={saveDemonLevel} disabled={levelSaving}>
                {levelSaving ? t("common.saving", "Enregistrement...") : t("common.save", "Enregistrer")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={ownerSearchOpen} onOpenChange={setOwnerSearchOpen}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-hidden rounded-3xl border-zinc-800 bg-zinc-950 p-0 text-zinc-100">
          <DialogHeader className="border-b border-zinc-800 px-5 py-4">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Search className="h-5 w-5 text-red-200" />
              {t("demon.ownerSearchTitle", "Rechercher qui possede un monstre")}
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[calc(92vh-74px)] space-y-5 overflow-y-auto p-5">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_180px]">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500" htmlFor="demon-owner-guild">
                  {t("demon.ownerSearchGuild", "Guilde")}
                </label>
                <select
                  id="demon-owner-guild"
                  value={ownerSearchGuildCode}
                  onChange={(event) => {
                    setOwnerSearchGuildCode(event.target.value);
                    setOwnerSearchResults([]);
                    setOwnerSearchSearched(false);
                  }}
                  className="h-11 w-full rounded-xl border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none ring-red-400/30 transition focus:border-red-400 focus:ring-2"
                >
                  {accessibleGuildOptions.map((guild) => (
                    <option key={guild.guildCode} value={guild.guildCode} className="bg-black text-zinc-100">
                      {guild.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500" htmlFor="demon-owner-monster">
                  {t("demon.ownerSearchMonster", "Monstre demoniaque")}
                </label>
                <div className="flex h-11 items-center gap-2 rounded-xl border border-zinc-800 bg-black px-3 text-sm text-zinc-100 ring-red-400/30 transition focus-within:border-red-400 focus-within:ring-2">
                  <Search className="h-4 w-4 shrink-0 text-zinc-500" />
                  <input
                    id="demon-owner-monster"
                    type="search"
                    value={ownerSearchMonsterQuery}
                    onChange={(event) => setOwnerSearchMonsterQuery(event.target.value)}
                    placeholder={t("demon.ownerSearchMonsterPlaceholder", "Chercher un monstre")}
                    className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500" htmlFor="demon-owner-min-level">
                  {t("demon.ownerSearchMinimumLevel", "Niveau minimum")}
                </label>
                <Input
                  id="demon-owner-min-level"
                  type="number"
                  min="1"
                  max="20"
                  value={ownerSearchMinimumLevel}
                  onChange={(event) => {
                    setOwnerSearchMinimumLevel(event.target.value);
                    setOwnerSearchResults([]);
                    setOwnerSearchSearched(false);
                  }}
                  placeholder={t("demon.ownerSearchNoMinimum", "Optionnel")}
                  className="h-11 rounded-xl border-zinc-800 bg-black text-zinc-100"
                />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/45 p-3">
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  {t("demon.ownerSearchMonsterList", "Monstres")}
                </div>
                <div className="grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                  {ownerSearchMonsterOptions.length === 0 ? (
                    <div className="rounded-xl border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-zinc-500">
                      {t("demon.ownerSearchNoMonster", "Aucun monstre trouve.")}
                    </div>
                  ) : (
                    ownerSearchMonsterOptions.map((monster) => {
                      const selected = String(monster.id) === String(ownerSearchMonsterId);
                      const tone = DEMON_RARITY_TONES[monster.rarity] || DEMON_RARITY_TONES.rare;
                      return (
                        <button
                          key={monster.id}
                          type="button"
                          onClick={() => {
                            setOwnerSearchMonsterId(monster.id);
                            setOwnerSearchResults([]);
                            setOwnerSearchSearched(false);
                          }}
                          className={`flex min-w-0 items-center gap-3 rounded-xl border p-2 text-left transition ${
                            selected
                              ? "border-red-300/70 bg-red-500/15 text-white"
                              : "border-zinc-800 bg-black/35 text-zinc-300 hover:border-red-400/35"
                          }`}
                        >
                          <img
                            src={monster.image_url || getDemonicMonsterImageUrl(monster.slug)}
                            alt=""
                            className="h-12 w-12 shrink-0 rounded-lg border border-zinc-800 object-cover"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{monster.name}</span>
                            <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] ${tone.badge}`}>
                              {t(`demon.rarity.${monster.rarity}`, tone.label)}
                            </span>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/45 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  {t("demon.ownerSearchSelectedMonster", "Monstre selectionne")}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  {selectedOwnerSearchMonster ? (
                    <>
                      <img
                        src={selectedOwnerSearchMonster.image_url || getDemonicMonsterImageUrl(selectedOwnerSearchMonster.slug)}
                        alt=""
                        className="h-16 w-16 rounded-xl border border-zinc-800 object-cover"
                      />
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-zinc-50">{selectedOwnerSearchMonster.name}</div>
                        <div className="truncate text-sm text-zinc-500">{selectedOwnerSearchMonster.slug}</div>
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-zinc-500">{t("demon.ownerSearchPickMonster", "Selectionne un monstre.")}</div>
                  )}
                </div>

                <Button
                  type="button"
                  className="mt-5 h-11 w-full rounded-xl"
                  disabled={ownerSearchLoading || !ownerSearchGuildCode || !ownerSearchMonsterId}
                  onClick={runOwnerSearch}
                >
                  <Search className="mr-2 h-4 w-4" />
                  {ownerSearchLoading ? t("demon.ownerSearchLoading", "Recherche...") : t("common.search", "Rechercher")}
                </Button>
              </div>
            </div>

            {ownerSearchError ? (
              <div className="rounded-2xl border border-red-500/35 bg-red-500/10 p-4 text-sm text-red-100">
                {ownerSearchError}
              </div>
            ) : null}

            <div className="rounded-2xl border border-zinc-800 bg-black/35">
              <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
                <div className="font-semibold text-zinc-50">{t("demon.ownerSearchResults", "Resultats")}</div>
                <div className="text-sm text-zinc-500">
                  {ownerSearchSearched
                    ? t("demon.ownerSearchFoundCount", "{count} joueur(s) trouve(s)").replace("{count}", String(ownerSearchResults.length))
                    : t("demon.ownerSearchReady", "Pret a rechercher")}
                </div>
              </div>

              <div className="max-h-80 overflow-y-auto p-2">
                {ownerSearchLoading ? (
                  <div className="px-3 py-5 text-sm text-zinc-400">{t("demon.ownerSearchLoading", "Recherche...")}</div>
                ) : ownerSearchSearched && ownerSearchResults.length === 0 ? (
                  <div className="px-3 py-5 text-sm text-zinc-500">{t("demon.ownerSearchNoResults", "Aucun joueur trouve.")}</div>
                ) : (
                  ownerSearchResults.map((result) => (
                    <button
                      key={`${result.memberId}:${result.monsterId}`}
                      type="button"
                      onClick={() => openOwnerSearchResult(result)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-zinc-900"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-zinc-100">{result.watcherName}</span>
                        <span className="mt-0.5 block truncate text-xs text-zinc-500">
                          {getGuildDisplayName({
                            guildCode: result.guildCode,
                            organizationKey: sessionOrganizationKey,
                          })}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full border border-red-300/35 bg-red-500/10 px-3 py-1 text-sm font-semibold text-red-100">
                        {t("demon.ownerSearchLevel", "Niveau")} {result.level}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
