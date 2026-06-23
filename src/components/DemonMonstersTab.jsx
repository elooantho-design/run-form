import React, { useEffect, useMemo, useState } from "react";
import { Search, Shield, Skull, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { logPortalActivity } from "@/lib/portalActivity";
import { filterByGuildScope } from "@/lib/guildScope";

const DEMON_RARITY_FILTERS = [
  { id: "Tous", label: "Tous", tone: "border-zinc-600 bg-zinc-900 text-zinc-100" },
  { id: "mythique", label: "Mythique", tone: "border-fuchsia-300 bg-fuchsia-300 text-black" },
  { id: "legendaire", label: "Legendaire", tone: "border-yellow-300 bg-yellow-300 text-black" },
  { id: "epique", label: "Epique", tone: "border-violet-300 bg-violet-300 text-black" },
  { id: "rare", label: "Rare", tone: "border-sky-300 bg-sky-300 text-black" },
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

export default function DemonMonstersTab({ session }) {
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

  const canEditDemonicMonsters = useMemo(() => {
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
        console.error("Erreur chargement membres monstres demoniaques:", error);
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

    async function loadDemonicMonsters() {
      setLoading(true);
      setErrorMessage("");

      const { data, error } = await supabase
        .from("demonic_monsters")
        .select("id, name, slug, rarity, image_url, sort_order, is_active")
        .eq("is_active", true)
        .order("rarity", { ascending: false })
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error("Erreur chargement monstres demoniaques:", error);
        setErrorMessage("Impossible de charger la bibliotheque des monstres demoniaques.");
        setLoading(false);
        return;
      }

      setDemonicMonsters(data || []);
      setLoading(false);
    }

    loadDemonicMonsters();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSelectedMemberDemonicEntries() {
      if (!selectedMember?.id) {
        setMemberDemonicEntries([]);
        return;
      }

      setEntriesLoading(true);

      const { data, error } = await supabase
        .from("member_demonic_monsters")
        .select(`
          id,
          member_id,
          monster_id,
          level,
          demonic_monsters (
            id,
            name,
            slug,
            rarity
          )
        `)
        .eq("member_id", selectedMember.id);

      if (cancelled) return;

      if (error) {
        console.error("Erreur chargement box monstres demoniaques:", error);
        setErrorMessage("Impossible de charger les niveaux de monstres pour ce joueur.");
        setEntriesLoading(false);
        return;
      }

      setMemberDemonicEntries(
        (data || []).map((row) => ({
          id: row.id,
          memberId: row.member_id,
          monsterId: row.monster_id,
          level: Number(row.level || 0),
          monsterName: row.demonic_monsters?.name || "",
          monsterSlug: row.demonic_monsters?.slug || "",
          rarity: row.demonic_monsters?.rarity || "",
        })),
      );
      setEntriesLoading(false);
    }

    loadSelectedMemberDemonicEntries();

    return () => {
      cancelled = true;
    };
  }, [selectedMember?.id]);

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

      const payload = {
        member_id: selectedMember.id,
        monster_id: selectedMonster.id,
        level: parsedLevel,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("member_demonic_monsters")
        .upsert(payload, {
          onConflict: "member_id,monster_id",
        })
        .select("id, member_id, monster_id, level")
        .single();

      if (error) {
        console.error("Erreur sauvegarde niveau monstre demoniaque:", error);
        alert(`Sauvegarde impossible : ${error.message || "erreur inconnue"}`);
        return;
      }

      const nextEntry = {
        id: data.id,
        memberId: data.member_id,
        monsterId: data.monster_id,
        level: Number(data.level || 0),
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

  return (
    <section className="space-y-6">
      <div className="relative overflow-hidden rounded-[1.35rem] border border-red-500/35 bg-zinc-950 p-6 shadow-[0_0_40px_rgba(127,29,29,0.22)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(239,68,68,0.18),transparent_30%),radial-gradient(circle_at_82%_18%,rgba(251,146,60,0.12),transparent_26%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(9,9,11,0.94))]" />
        <div className="relative z-10 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-red-400/30 bg-red-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-red-100">
              <Skull className="h-4 w-4" />
              Bibliotheque demoniaque
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-4xl">
              Monstres demoniaques
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300 md:text-base">
              Reprend le fonctionnement de l'ancien dashboard : bibliotheque, raretes, niveaux et sauvegarde par joueur.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:w-[520px]">
            <div className="rounded-2xl border border-zinc-800 bg-black/35 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Possedes</div>
              <div className="mt-2 text-2xl font-semibold text-zinc-50">{ownedCount}</div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-black/35 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Niveau 20</div>
              <div className="mt-2 text-2xl font-semibold text-amber-200">{maxLevelCount}</div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-black/35 p-4">
              <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Affiches</div>
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
                <div className="text-lg font-semibold text-zinc-50">Filtres</div>
                <div className="mt-1 text-sm text-zinc-500">Rarete et joueur actif</div>
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
                      {filter.label}
                    </button>
                  );
                })}
              </div>

              <div className="mt-6 space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500" htmlFor="demon-member">
                  Joueur du cluster
                </label>
                <div className="flex h-10 items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 ring-red-400/30 transition focus-within:border-red-400 focus-within:ring-2">
                  <Search className="h-4 w-4 shrink-0 text-zinc-500" />
                  <input
                    id="demon-member"
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
                              ? "border-red-300/60 bg-red-500/10 text-white"
                              : "border-transparent bg-zinc-900/70 text-zinc-300 hover:border-red-400/35 hover:bg-zinc-900"
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

              <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-400">
                <div className="flex items-center gap-2 font-medium text-zinc-200">
                  <Shield className="h-4 w-4 text-red-200" />
                  {selectedMember?.name || "Aucun membre"}
                </div>
                <div className="mt-1 text-xs text-zinc-500">{selectedMember?.guildCode || "Cluster"}</div>
                <p className="mt-2 leading-5">
                  Clique sur le niveau au centre d'une carte pour renseigner ou corriger le niveau du monstre.
                </p>
              </div>
            </aside>

            <div className="p-5">
              <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-lg font-semibold text-zinc-50">Box monstres demoniaques</div>
                  <div className="text-sm text-zinc-500">
                    {loading || entriesLoading ? "Chargement..." : `${demonicMonsterCards.length} monstre(s) affiche(s)`}
                  </div>
                </div>

                <div className="relative w-full lg:w-[340px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Rechercher un monstre"
                    className="h-11 rounded-xl border-zinc-800 bg-zinc-950 pl-9 text-zinc-100"
                  />
                </div>
              </div>

              {errorMessage ? (
                <div className="mb-5 rounded-2xl border border-red-500/35 bg-red-500/10 p-4 text-sm text-red-100">
                  {errorMessage}
                </div>
              ) : null}

              {loading ? (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-8 text-sm text-zinc-400">
                  Chargement de la bibliotheque...
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
                            {tone.label}
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
                            title={canEditDemonicMonsters ? "Renseigner le niveau" : "Modification non autorisee"}
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
                            Niv. {monster.level || 0}
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
            <DialogTitle>Renseigner le niveau</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="text-sm text-zinc-400">Monstre selectionne</div>
              <div className="mt-1 font-medium text-zinc-50">
                {selectedMonster?.name || selectedMonster?.slug || "-"}
              </div>
              <div className="text-sm text-zinc-400">Niveau actuel : {selectedMonster?.level || 0}</div>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-zinc-400" htmlFor="demon-level-input">
                Niveau du monstre
              </label>
              <Input
                id="demon-level-input"
                type="number"
                min="0"
                max="20"
                value={levelInput}
                onChange={(event) => setLevelInput(event.target.value)}
                placeholder="Entre 0 et 20"
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
                Annuler
              </Button>

              <Button className="rounded-2xl" onClick={saveDemonLevel} disabled={levelSaving}>
                {levelSaving ? "Enregistrement..." : "Enregistrer"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
