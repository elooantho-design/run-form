import React from "react";
import { DndContext, closestCenter } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Users,
  Search,
  AlertTriangle,
  CheckCircle2,
  Pencil,
  Trash2,
  Plus,
  Star,
  ArrowRightLeft,
  Send,
  ImagePlus,
  Upload
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";

import {
  getMemberDefenseCompletion,
  getMemberTrackedDefenseScore,
  getAssignedDefenseTone,
  getMetaDefenseCounters,
  normalizeDefenseTier,
  getDefenseRootId,
  analyzeDefenseCompatibility,
  getDefenseAwakeningScore,
  canShowDefenseForMember,
  getHeroImageUrl,
  getDefenseConditionRequirements,
  getDefenseLikeTargetId
} from "../calculations";

function SortableDefenseCard({ defense, children }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: defense.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

export default function OldDefenseTab({
  activeGuildCode,
  clusterMemberSearchQuery,
  setClusterMemberSearchQuery,
  clusterMemberSearchResults,
  setActiveGuildCode,
  memberLimitExceeded,
  latestMember,
  filteredMembers,
  selectedId,
  setSelectedId,
  trackedMetaDefense,
  setScoreDetailMember,
  setScoreDetailDefense,
  setScoreDetailOpen,
  isAdmin,
  setMemberAssignment,
  selectedMember,
  forumPostUrlInput,
  setForumPostUrlInput,
  savePersonalForumPostUrl,
  setTodoMember,
  setVerifyMember,
  validateMember,
  setMessageDialogOpen,
  sendingDefense,
  sendDefenseToMember,
  requestAwakeningUpdate,
  selectedDefense1,
  openDefensePreview,
  clearAssignedDefense,
  selectedDefense2,
  visibleCompatibleDefenses,
  compatibleTierFilter,
  setCompatibleTierFilter,
  assignDefense,
  metaCounterFilter,
  setMetaCounterFilter,
  metaDefenseCounters,
  openMetaCounterDialog,
  selectedMetaDefenseForCompletion,
  setSelectedMetaDefenseForCompletion,
  defenseFactionFilter,
  setDefenseFactionFilter,
  defenseTypeFilter,
  setDefenseTypeFilter,
  workspaceTierFilter,
  setWorkspaceTierFilter,
  defenses,
  handleDragEnd,
  setRenameDefenseTarget,
  setRenameDefenseName,
  setRenameDefenseFaction,
  setRenameDefenseDialogOpen,
  setEditingDefense,
  setEditorOpen,
  setDefenseToDelete,
  setDeleteDefenseMode,
  setDeleteDefenseDialogOpen,
  canDeleteDefense,
  likedDefenseRootIds,
  defenseLikesCountByRootId,
  toggleDefenseLike,
  activeDashboardDefenseRootIds,
  conditionDefenseId,
  setConditionDefenseId,
  selectedConditionDefense,
  availableConditionHeroes,
  newCondition,
  setNewCondition,
  addCondition,
  removeCondition,
  reproHeroes,
  setReproHero,
  reproConditions,
  setReproCondition,
  findReproMatches,
  openTransferDialog,
  libraryLoading,
  clusterLibraryDefenses,
  importDefenseToActiveGuild
}) {
  const defense1Tone = getAssignedDefenseTone(selectedDefense1, selectedMember);
  const defense2Tone = getAssignedDefenseTone(selectedDefense2, selectedMember);

  return (
    <>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <Card className="rounded-3xl border-zinc-800 bg-zinc-900/70 shadow-2xl xl:col-span-7">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-zinc-50">
                  <Users className="h-5 w-5" /> Membres
                </CardTitle>
                <CardDescription>Vue bibliothèque / liste principale</CardDescription>
              </div>
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <Input
                  value={clusterMemberSearchQuery}
                  onChange={(e) => setClusterMemberSearchQuery(e.target.value)}
                  placeholder="Rechercher un membre..."
                  className="rounded-2xl border-zinc-700 bg-zinc-950 pl-9"
                />
              </div>
              {clusterMemberSearchQuery.trim() && (
                <div className="mt-2 space-y-2">
                  {clusterMemberSearchResults.length > 0 ? (
                    clusterMemberSearchResults.map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => {
                          setActiveGuildCode(member.guild_code);
                          setClusterMemberSearchQuery("");
                        }}
                        className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 p-3 text-left hover:bg-zinc-800"
                      >
                        <div className="font-medium text-zinc-50">{member.watcher_name}</div>
                        <div className="text-sm text-zinc-400">Guilde : {member.guild_code}</div>
                      </button>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3 text-sm text-zinc-500">
                      Aucun joueur trouvé.
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {memberLimitExceeded && (
              <div className="mb-4 rounded-2xl border border-red-500/40 bg-red-500/10 p-4">
                <div className="flex items-center gap-2 text-red-300">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="font-medium">Alerte : ce dashboard contient plus de 30 membres.</span>
                </div>
              </div>
            )}
            <div className="overflow-hidden rounded-2xl border border-zinc-800">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="text-zinc-300 font-semibold">Nom</TableHead>
                    <TableHead className="text-zinc-300 font-semibold">Statut</TableHead>
                    <TableHead className="text-zinc-300 font-semibold">Complétion</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead className="w-[120px] text-left pl-2">Éveils</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMembers.map((member, index) => {
                    const completion = trackedMetaDefense ? getMemberDefenseCompletion(member, trackedMetaDefense) : 0;
                    return (
                      <TableRow
                        key={member.id}
                        className={`cursor-pointer border-zinc-800 ${selectedId === member.id ? "bg-zinc-800/60" : "hover:bg-zinc-900"}`}
                        onClick={() => setSelectedId(member.id)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="rounded-2xl">
                              <AvatarFallback className="rounded-2xl bg-zinc-800 text-zinc-200">{index + 1}</AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="flex items-center gap-2">
                                <div className="font-medium text-zinc-50">{member.name}</div>
                                <Select
                                  value={member.assignment || "Tour"}
                                  onValueChange={(value) => setMemberAssignment(member.id, value)}
                                  disabled={!isAdmin}
                                >
                                  <SelectTrigger className="h-6 w-[80px] rounded-lg border-zinc-700 bg-zinc-900 text-xs" onClick={(e) => e.stopPropagation()}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent onClick={(e) => e.stopPropagation()}>
                                    <SelectItem value="Tour">Tour</SelectItem>
                                    <SelectItem value="Bastion">Bastion</SelectItem>
                                    <SelectItem value="Bulle">Bulle</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="text-xs text-zinc-300">{member.defense1} / {member.defense2}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={member.status === "Validé" ? "rounded-xl bg-emerald-500/15 text-emerald-300" : member.status === "À vérifier" ? "rounded-xl bg-amber-500/15 text-amber-300" : "rounded-xl bg-red-500/15 text-red-300"}>
                            {member.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-24 overflow-hidden rounded-full bg-zinc-800">
                              <div className={completion === 100 ? "h-full bg-emerald-400" : completion === 50 ? "h-full bg-amber-400" : "h-full bg-zinc-600"} style={{ width: `${completion}%` }} />
                            </div>
                            <span className={completion === 100 ? "text-sm font-medium text-emerald-300" : completion === 50 ? "text-sm font-medium text-amber-300" : "text-sm font-medium text-zinc-400"}>{completion}%</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {trackedMetaDefense ? (() => {
                            const score = getMemberTrackedDefenseScore(member, trackedMetaDefense);
                            if (score === null) return <span className="text-zinc-500">Null</span>;
                            return (
                              <button type="button" onClick={() => { setScoreDetailMember(member); setScoreDetailDefense(trackedMetaDefense); setScoreDetailOpen(true); }} className="rounded-xl px-2 py-1 text-sm text-emerald-300 hover:bg-zinc-800">
                                {score}
                              </button>
                            );
                          })() : <span className="text-zinc-500">—</span>}
                        </TableCell>
                        <TableCell className="w-[120px] pl-2">
                          <div className="relative flex items-center justify-start">
                            <Badge className={member.awakeningStatus === "OK" ? "rounded-xl bg-emerald-500/15 text-emerald-300" : "rounded-xl bg-sky-500/15 text-sky-300"}>{member.awakeningStatus === "OK" ? "OK" : "En attente"}</Badge>
                            <Button size="icon" variant="ghost" className="absolute right-0 rounded-xl text-amber-300 hover:text-amber-200" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openTransferDialog(member); }} disabled={!isAdmin} title="Transférer ce joueur"><ArrowRightLeft className="h-4 w-4" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="h-full rounded-3xl border-zinc-800 bg-zinc-900/70 shadow-2xl xl:col-span-5">
          <CardHeader>
            <CardTitle className="text-zinc-50">Profil sélectionné</CardTitle>
            <CardDescription>Édition rapide des éveils et aperçu du joueur</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {!selectedMember ? (
              <div className="flex flex-col gap-4">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-zinc-300">Aucun membre sélectionné.</div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-14 w-14 rounded-2xl">
                      <AvatarFallback className="rounded-2xl bg-zinc-800 text-lg">{selectedMember.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="text-xl font-semibold text-zinc-50">{selectedMember.name}</div>
                      <div className="text-sm text-zinc-300">{selectedMember.assignment}</div>
                      <div className="mt-2 space-y-2">
                        <div className="text-xs text-zinc-400">Post forum personnel</div>
                        <div className="flex gap-2">
                          <Input value={forumPostUrlInput} onChange={(e) => setForumPostUrlInput(e.target.value)} placeholder="https://..." className="h-9 rounded-xl border-zinc-600 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500" />
                          <Button size="sm" variant="outline" className="rounded-xl border-zinc-700 bg-zinc-900" onClick={() => savePersonalForumPostUrl(selectedMember.id)} disabled={!isAdmin}>Enregistrer</Button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="rounded-xl bg-red-600 text-white hover:bg-red-500" onClick={() => setTodoMember(selectedMember.id)} disabled={!isAdmin}>À faire</Button>
                    <Button size="sm" className="rounded-xl bg-amber-500 text-black hover:bg-amber-400" onClick={() => setVerifyMember(selectedMember.id)} disabled={!isAdmin}>À vérifier</Button>
                    <Button size="sm" className="rounded-xl bg-emerald-600 text-white hover:bg-emerald-500" onClick={() => validateMember(selectedMember.id)} disabled={!isAdmin}>Valider</Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className={`rounded-2xl border p-4 ${defense1Tone.card}`}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-xs text-zinc-400">Défense 1</div>
                      <Badge className={defense1Tone.badge}>{selectedDefense1 ? defense1Tone.label : "Aucune"}</Badge>
                    </div>
                    <div className="font-medium text-zinc-50">{selectedDefense1?.name || "—"}</div>
                    {selectedDefense1 && (
                      <div className="mt-4 flex justify-between gap-2">
                        <Button size="sm" variant="outline" className="rounded-xl border-zinc-700 bg-transparent" onClick={() => openDefensePreview(selectedDefense1)} disabled={!selectedDefense1?.image}>👀</Button>
                        <Button size="sm" variant="outline" className="rounded-xl border-zinc-700 bg-transparent" onClick={() => clearAssignedDefense(1)} disabled={!isAdmin}>Retirer</Button>
                      </div>
                    )}
                  </div>
                  <div className={`rounded-2xl border p-4 ${defense2Tone.card}`}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-xs text-zinc-400">Défense 2</div>
                      <Badge className={defense2Tone.badge}>{selectedDefense2 ? defense2Tone.label : "Aucune"}</Badge>
                    </div>
                    <div className="font-medium text-zinc-50">{selectedDefense2?.name || "—"}</div>
                    {selectedDefense2 && (
                      <div className="mt-4 flex justify-between gap-2">
                        <Button size="sm" variant="outline" className="rounded-xl border-zinc-700 bg-transparent" onClick={() => openDefensePreview(selectedDefense2)} disabled={!selectedDefense2?.image}>👀</Button>
                        <Button size="sm" variant="outline" className="rounded-xl border-zinc-700 bg-transparent" onClick={() => clearAssignedDefense(2)} disabled={!isAdmin}>Retirer</Button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-1 flex-col space-y-3 overflow-hidden">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-3">
                      <div className="font-medium text-zinc-50">Défenses compatibles</div>
                    </div>
                    <Select value={compatibleTierFilter} onValueChange={setCompatibleTierFilter}>
                      <SelectTrigger className="w-[180px] rounded-2xl border-zinc-700 bg-zinc-900 text-zinc-100">
                        <SelectValue placeholder="Filtrer par tier" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Tous">Tous les tiers</SelectItem>
                        <SelectItem value="meta_s">Meta S</SelectItem>
                        <SelectItem value="meta_a">Meta A</SelectItem>
                        <SelectItem value="secondaire">Secondaire</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <ScrollArea className="flex-1 pr-3">
                    <div className="space-y-3">
                      {visibleCompatibleDefenses.map((defense) => (
                        <div key={defense.id} className={`rounded-2xl border p-4 ${defense.analysis.isCompatible ? "border-emerald-500/30 bg-emerald-500/10" : "border-red-500/30 bg-red-500/10"}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-medium text-zinc-50">{defense.name}</div>
                              <div className="text-sm text-zinc-300">{defense.tier} • {defense.type} • Score : {defense.awakeningScore}</div>
                            </div>
                            <Badge className={defense.analysis.isCompatible ? "rounded-xl bg-emerald-500/15 text-emerald-300" : "rounded-xl bg-red-500/15 text-red-300"}>
                              {defense.analysis.isCompatible ? "Compatible" : "Incompatible"}
                            </Badge>
                          </div>
                          <div className="mt-4 flex flex-wrap items-center gap-2">
                            <Button size="sm" className="rounded-xl bg-zinc-950 text-zinc-100 hover:bg-zinc-900" onClick={() => assignDefense(1, defense)} disabled={!isAdmin}>Déf 1</Button>
                            <Button size="sm" className="rounded-xl bg-zinc-950 text-zinc-100 hover:bg-zinc-900" onClick={() => assignDefense(2, defense)} disabled={!isAdmin}>Déf 2</Button>
                            <Button size="sm" variant="outline" className="rounded-xl border-zinc-700 bg-transparent" onClick={() => openDefensePreview(defense)} disabled={!defense?.image}>👀</Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="workspace" className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <TabsList className="rounded-2xl border border-zinc-800 bg-zinc-900 p-1">
            <TabsTrigger value="workspace" className="rounded-xl px-4 py-2 text-zinc-400 transition-all hover:bg-zinc-800 hover:text-zinc-100 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-50">Liste</TabsTrigger>
            <TabsTrigger value="library" className="rounded-xl px-4 py-2 text-zinc-400 transition-all hover:bg-zinc-800 hover:text-zinc-100 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-50">Bibliothèque</TabsTrigger>
            <TabsTrigger value="rules" disabled={!isAdmin} className="rounded-xl px-4 py-2 text-zinc-400 transition-all hover:bg-zinc-800 hover:text-zinc-100 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-50">Conditions</TabsTrigger>
            <TabsTrigger value="repro" className="rounded-xl px-4 py-2 text-zinc-400 transition-all hover:bg-zinc-800 hover:text-zinc-100 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-50">Qui peut repro</TabsTrigger>
          </TabsList>

          <div className="mb-3 flex flex-wrap gap-2">
            <Button variant={metaCounterFilter === "all" ? "default" : "outline"} className="rounded-2xl" onClick={() => setMetaCounterFilter("all")}>Toutes</Button>
            <Button variant={metaCounterFilter === "meta_s" ? "default" : "outline"} className="rounded-2xl" onClick={() => setMetaCounterFilter("meta_s")}>Meta S</Button>
            <Button variant={metaCounterFilter === "meta_a" ? "default" : "outline"} className="rounded-2xl" onClick={() => setMetaCounterFilter("meta_a")}>Meta A</Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {metaDefenseCounters.map((counter) => {
              const isTracked = String(selectedMetaDefenseForCompletion) === String(counter.id);
              return (
                <div key={counter.id} className={`min-w-[170px] rounded-2xl border px-4 py-3 transition ${isTracked ? "border-amber-400 bg-amber-500/10" : "border-zinc-800 bg-zinc-900"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <button type="button" onClick={() => openMetaCounterDialog(counter)} className="flex-1 text-left">
                      <div className="text-xs text-zinc-500">{counter.label}</div>
                      <div className="mt-1 text-lg font-semibold text-zinc-50">{counter.count}</div>
                      <div className="truncate text-xs text-zinc-400">{counter.name}</div>
                    </button>
                    <button type="button" onClick={() => setSelectedMetaDefenseForCompletion((prev) => String(prev) === String(counter.id) ? null : String(counter.id))} className="rounded-xl p-1 hover:bg-zinc-800">
                      <Star className={`h-4 w-4 ${isTracked ? "fill-amber-400 text-amber-400" : "text-zinc-500"}`} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <TabsContent value="workspace">
          <div className="mb-4 flex flex-wrap justify-end gap-3">
            <Select value={defenseFactionFilter} onValueChange={setDefenseFactionFilter}>
              <SelectTrigger className="w-[220px] rounded-2xl border-zinc-700 bg-zinc-900 text-zinc-100"><SelectValue placeholder="Faction" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Tous">Toutes les factions</SelectItem>
                {["nordiste", "cauchemar", "sentinelle", "esoterique", "perceur", "chaotique", "cultiste", "infernal", "innommable", "arbitre"].map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={defenses.map(d => d.id)} strategy={verticalListSortingStrategy}>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {defenses.filter(d => (defenseFactionFilter === "Tous" || d.faction === defenseFactionFilter) && (defenseTypeFilter === "Tous" || d.type === defenseTypeFilter)).map((defense) => (
                  <SortableDefenseCard key={defense.id} defense={defense}>
                    <Card className={`rounded-3xl border shadow-2xl ${normalizeDefenseTier(defense.tier).includes("meta") ? "border-emerald-500 bg-emerald-900/35" : "border-zinc-800 bg-zinc-900/70"}`}>
                      <CardHeader>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <CardTitle className="cursor-pointer text-lg text-zinc-50 hover:text-emerald-300" onClick={() => { setRenameDefenseTarget(defense); setRenameDefenseName(defense.name); setRenameDefenseFaction(defense.faction); setRenameDefenseDialogOpen(true); }}>{defense.name}</CardTitle>
                            <CardDescription>{defense.tier} • {defense.type}</CardDescription>
                          </div>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => toggleDefenseLike(defense)} className={`rounded-xl border px-3 py-1 text-sm ${likedDefenseRootIds.has(getDefenseLikeTargetId(defense)) ? "border-pink-500/40 bg-pink-500/15 text-pink-300" : "border-zinc-700 bg-zinc-900 text-zinc-300"}`}>❤ {defenseLikesCountByRootId.get(getDefenseLikeTargetId(defense)) || 0}</button>
                            <Button size="icon" variant="ghost" onClick={() => { setEditingDefense(defense); setEditorOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" className="text-red-400" onClick={() => { setDefenseToDelete(defense); setDeleteDefenseMode("local"); setDeleteDefenseDialogOpen(true); }} disabled={!canDeleteDefense(defense)}><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="flex flex-wrap gap-2">{defense.slots.map(s => <Badge key={s} variant="outline" className="rounded-xl border-zinc-700 text-zinc-200">{s}</Badge>)}</div>
                        {defense.image ? <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950"><img src={defense.image} alt={defense.name} className="h-40 w-full object-contain" /></div> : <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 text-sm text-zinc-500">Aucune image</div>}
                      </CardContent>
                    </Card>
                  </SortableDefenseCard>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </TabsContent>

        <TabsContent value="library">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {clusterLibraryDefenses.map((defense) => {
              const alreadyImported = activeDashboardDefenseRootIds.has(getDefenseRootId(defense));
              return (
                <Card key={`lib-${defense.id}`} className="rounded-3xl border border-zinc-800 bg-zinc-900/70">
                  <CardHeader><CardTitle className="text-lg text-zinc-50">{defense.name}</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">{defense.slots.map(s => <Badge key={s} variant="outline">{s}</Badge>)}</div>
                    <Button className="w-full rounded-2xl" disabled={!isAdmin || alreadyImported} onClick={() => importDefenseToActiveGuild(defense)}>{alreadyImported ? "Déjà importée" : "Importer"}</Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="rules">
          <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
            <Select value={conditionDefenseId} onValueChange={setConditionDefenseId}>
              <SelectTrigger className="rounded-2xl border-zinc-700 bg-zinc-900 text-zinc-100"><SelectValue placeholder="Défense" /></SelectTrigger>
              <SelectContent>{defenses.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}</SelectContent>
            </Select>
            {selectedConditionDefense && (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                <div className="mb-4 font-medium text-zinc-50">Conditions pour {selectedConditionDefense.name}</div>
                <div className="space-y-3">
                  {selectedConditionDefense.conditions.map(c => (
                    <div key={c} className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                      <span className="text-zinc-300">{c}</span>
                      <Button size="sm" variant="outline" className="text-red-300" onClick={() => removeCondition(selectedConditionDefense.id, c)} disabled={!canDeleteDefense(selectedConditionDefense)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <Select value={newCondition.hero} onValueChange={(v) => setNewCondition(p => ({ ...p, hero: v }))}><SelectTrigger className="rounded-2xl bg-zinc-900"><SelectValue placeholder="Héros" /></SelectTrigger><SelectContent>{availableConditionHeroes.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent></Select>
                  <Select value={newCondition.minAwakening} onValueChange={(v) => setNewCondition(p => ({ ...p, minAwakening: v }))}><SelectTrigger className="rounded-2xl bg-zinc-900"><SelectValue placeholder="Éveil" /></SelectTrigger><SelectContent>{[0, 1, 2, 3, 4, 5].map(n => <SelectItem key={n} value={String(n)}>A{n}</SelectItem>)}</SelectContent></Select>
                  <Button onClick={addCondition} disabled={!canDeleteDefense(selectedConditionDefense)}><Plus className="h-4 w-4" /></Button>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="repro">
          <div className="grid gap-4 md:grid-cols-5">
            {reproHeroes.map((hero, i) => (
              <div key={i} className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                <Input value={hero} onChange={(e) => setReproHero(i, e.target.value)} placeholder={`Héros ${i + 1}`} className="bg-zinc-900" />
                <Select value={String(reproConditions[i])} onValueChange={(v) => setReproCondition(i, v)}><SelectTrigger className="bg-zinc-900"><SelectValue /></SelectTrigger><SelectContent>{[0, 1, 2, 3, 4, 5].map(n => <SelectItem key={n} value={String(n)}>A{n}</SelectItem>)}</SelectContent></Select>
              </div>
            ))}
          </div>
          <Button onClick={findReproMatches} className="mt-4 rounded-2xl">Rechercher</Button>
        </TabsContent>
      </Tabs>
    </>
  );
}