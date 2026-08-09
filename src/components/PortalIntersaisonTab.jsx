import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  CheckCircle2,
  ClipboardCopy,
  MessageSquare,
  Play,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

function getApiBase() {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:3001";
}

async function callPortalIntersaison(payload) {
  const response = await fetch(`${getApiBase()}/api/portal-intersaison`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `Erreur Portal (${response.status})`);
  }
  return data;
}

function normalizeRoleValue(role) {
  return String(role || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function canManageIntersaison(session) {
  const role = normalizeRoleValue(session?.role);

  return Boolean(
    session?.isAdmin ||
      session?.admin ||
      session?.isLeader ||
      session?.leader ||
      role.includes("admin") ||
      role.includes("administrateur") ||
      role.includes("leader"),
  );
}

function emptyIntersaisonState() {
  return {
    organization: null,
    guilds: [],
    campaign: null,
    dashboards: [],
    assignments: [],
    notes: [],
  };
}

function sortByName(a, b) {
  return String(a.watcher_name || "").localeCompare(String(b.watcher_name || ""), "fr", {
    sensitivity: "base",
  });
}

export default function PortalIntersaisonTab({ session }) {
  const canManage = canManageIntersaison(session);

  const [campaign, setCampaign] = useState(null);
  const [organization, setOrganization] = useState(null);
  const [guilds, setGuilds] = useState([]);
  const [dashboards, setDashboards] = useState([]);
  const [selectedDashboardId, setSelectedDashboardId] = useState("");
  const [assignments, setAssignments] = useState([]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("Tous");
  const [highlightedRowId, setHighlightedRowId] = useState(null);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [selectedNoteRow, setSelectedNoteRow] = useState(null);
  const [noteInput, setNoteInput] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [assignmentToMove, setAssignmentToMove] = useState(null);
  const [moveDashboardId, setMoveDashboardId] = useState("");
  const [moving, setMoving] = useState(false);

  const [wishRow, setWishRow] = useState(null);
  const [wishInput, setWishInput] = useState([]);
  const [savingWish, setSavingWish] = useState(false);

  const [finalizeDialogOpen, setFinalizeDialogOpen] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [validationPreview, setValidationPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const resetState = useCallback(() => {
    const empty = emptyIntersaisonState();
    setOrganization(empty.organization);
    setGuilds(empty.guilds);
    setCampaign(empty.campaign);
    setDashboards(empty.dashboards);
    setAssignments(empty.assignments);
    setNotes(empty.notes);
    setSelectedDashboardId("");
    setSourceFilter("Tous");
    setSearchQuery("");
    setHighlightedRowId(null);
  }, []);

  const applyLoadedState = useCallback((state = emptyIntersaisonState()) => {
    const dashboardsList = state.dashboards || [];
    setOrganization(state.organization || null);
    setGuilds(state.guilds || []);
    setCampaign(state.campaign || null);
    setDashboards(dashboardsList);
    setAssignments(state.assignments || []);
    setNotes(state.notes || []);
    setSelectedDashboardId((previous) => {
      if (previous && dashboardsList.some((dashboard) => String(dashboard.id) === String(previous))) {
        return previous;
      }

      const draftDashboard = dashboardsList.find((dashboard) => dashboard.is_draft);
      const firstRealDashboard = dashboardsList.find((dashboard) => !dashboard.is_draft);
      return String(draftDashboard?.id || firstRealDashboard?.id || dashboardsList[0]?.id || "");
    });
    setValidationPreview(null);
  }, []);

  const runIntersaisonAction = useCallback(
    async (action, payload = {}) => {
      const data = await callPortalIntersaison({ action, ...payload });
      if (data.state) {
        const state = data.state || emptyIntersaisonState();
        applyLoadedState(state);
      }
      return data;
    },
    [applyLoadedState],
  );

  const loadIntersaisonData = useCallback(async () => {
    if (!canManage) return;

    setLoading(true);
    setMessage("");

    try {
      await runIntersaisonAction("load");
    } catch (error) {
      console.error("Erreur chargement intersaison:", error);
      resetState();
      setMessage(error.message || "Impossible de charger l'intersaison.");
    } finally {
      setLoading(false);
    }
  }, [canManage, resetState, runIntersaisonAction]);

  useEffect(() => {
    void loadIntersaisonData();
  }, [loadIntersaisonData]);

  const guildCodes = useMemo(() => {
    return (guilds || []).map((guild) => guild.guild_code).filter(Boolean);
  }, [guilds]);

  const selectedDashboard = useMemo(
    () => dashboards.find((dashboard) => String(dashboard.id) === String(selectedDashboardId)) || null,
    [dashboards, selectedDashboardId],
  );

  const selectedRows = useMemo(() => {
    if (!selectedDashboardId) return [];

    return assignments
      .filter((assignment) => String(assignment.dashboard_id) === String(selectedDashboardId))
      .filter((assignment) =>
        sourceFilter === "Tous" ? true : assignment.source_guild_code === sourceFilter,
      );
  }, [assignments, selectedDashboardId, sourceFilter]);

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];

    return assignments
      .filter((assignment) => String(assignment.watcher_name || "").toLowerCase().includes(query))
      .sort(sortByName)
      .slice(0, 8);
  }, [assignments, searchQuery]);

  const confirmedCount = useMemo(
    () => assignments.filter((assignment) => assignment.is_manually_confirmed).length,
    [assignments],
  );

  const getNoteForAssignment = useCallback(
    (assignmentId) =>
      notes.find((note) => String(note.assignment_id) === String(assignmentId)) || null,
    [notes],
  );

  const buildTransferSummary = useCallback(() => {
    if (!dashboards.length || !assignments.length) {
      return "Aucune donnee intersaison disponible.";
    }

    const lines = [];

    dashboards
      .filter((dashboard) => !dashboard.is_draft)
      .forEach((dashboard) => {
        const arrivals = assignments.filter(
          (assignment) => String(assignment.dashboard_id) === String(dashboard.id),
        );
        const departures = assignments.filter(
          (assignment) =>
            assignment.source_guild_code === dashboard.code &&
            assignment.target_guild_code !== dashboard.code,
        );

        lines.push(`${dashboard.name}`);
        lines.push("");
        lines.push("Arrivees :");
        if (arrivals.length > 0) {
          arrivals.forEach((assignment) => {
            lines.push(
              `- ${assignment.watcher_name} (${assignment.source_guild_code || "-"} -> ${
                assignment.target_guild_code || "BROUILLON"
              })`,
            );
          });
        } else {
          lines.push("- Aucune");
        }

        lines.push("");
        lines.push("Departs :");
        if (departures.length > 0) {
          departures.forEach((assignment) => {
            lines.push(
              `- ${assignment.watcher_name} (${assignment.source_guild_code || "-"} -> ${
                assignment.target_guild_code || "BROUILLON"
              })`,
            );
          });
        } else {
          lines.push("- Aucun");
        }

        lines.push("");
        lines.push("---");
        lines.push("");
      });

    const draftDashboard = dashboards.find((dashboard) => dashboard.is_draft);
    const draftRows = draftDashboard
      ? assignments.filter((assignment) => String(assignment.dashboard_id) === String(draftDashboard.id))
      : [];
    lines.push("Sorties vers communaute :");
    if (draftRows.length > 0) {
      draftRows.forEach((assignment) => {
        lines.push(`- ${assignment.watcher_name} (${assignment.source_guild_code || "-"} -> Communauté)`);
      });
    } else {
      lines.push("- Aucune");
    }

    return lines.join("\n").trim();
  }, [assignments, dashboards]);

  const createCampaign = async () => {
    if (!canManage || creating) return;

    if (!guildCodes.length) {
      setMessage("Aucune guilde active disponible pour ton organisation.");
      return;
    }

    setCreating(true);
    setMessage("");

    try {
      await runIntersaisonAction("create-campaign");
      setCreateDialogOpen(false);
    } catch (error) {
      console.error("Erreur creation campagne intersaison:", error);
      setMessage(error.message || "Creation impossible.");
    } finally {
      setCreating(false);
    }
  };

  const openNoteDialog = (row) => {
    const existingNote = getNoteForAssignment(row.id);
    setSelectedNoteRow(row);
    setNoteInput(existingNote?.note || "");
    setNoteDialogOpen(true);
  };

  const saveNote = async () => {
    if (!selectedNoteRow?.id || savingNote) return;

    setSavingNote(true);

    try {
      await runIntersaisonAction("save-note", {
        assignmentId: selectedNoteRow.id,
        note: noteInput.trim(),
      });
      setNoteDialogOpen(false);
      setSelectedNoteRow(null);
      setNoteInput("");
    } catch (error) {
      console.error("Erreur enregistrement note intersaison:", error);
      setMessage(error.message || "Enregistrement impossible.");
    } finally {
      setSavingNote(false);
    }
  };

  const toggleConfirmation = async (assignmentId) => {
    if (!canManage || !assignmentId) return;

    try {
      await runIntersaisonAction("toggle-confirmation", { assignmentId });
    } catch (error) {
      console.error("Erreur toggle validation intersaison:", error);
      setMessage(error.message || "Changement impossible.");
    }
  };

  const moveAssignment = async () => {
    if (!canManage || moving || !assignmentToMove?.id || !moveDashboardId) return;

    setMoving(true);

    try {
      await runIntersaisonAction("move-assignment", {
        assignmentId: assignmentToMove.id,
        dashboardId: moveDashboardId,
      });
      setMoveDialogOpen(false);
      setAssignmentToMove(null);
      setMoveDashboardId("");
    } catch (error) {
      console.error("Erreur deplacement manuel intersaison:", error);
      setMessage(error.message || "Deplacement impossible.");
    } finally {
      setMoving(false);
    }
  };

  const saveWish = async () => {
    if (!wishRow?.id || savingWish) return;

    const cleaned = [...new Set(wishInput)].sort((a, b) => a.localeCompare(b, "fr"));
    setSavingWish(true);

    try {
      await runIntersaisonAction("save-wish", {
        assignmentId: wishRow.id,
        wishedGuildCodes: cleaned,
      });
      setWishRow(null);
      setWishInput([]);
    } catch (error) {
      console.error("Erreur sauvegarde souhait intersaison:", error);
      setMessage(error.message || "Enregistrement impossible.");
    } finally {
      setSavingWish(false);
    }
  };

  const copyTransferSummary = async () => {
    const summary = buildTransferSummary();

    try {
      if (!navigator?.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(summary);
      setMessage("Resume des transferts copie.");
    } catch (error) {
      console.warn("Erreur copie resume intersaison:", error);
      setMessage(summary);
    }
  };

  const cancelActiveCampaign = async () => {
    if (!canManage || !campaign?.id || finalizing) return;

    const confirmCancel = window.confirm(
      "Mettre hors service la campagne active d'intersaison ? Les donnees seront conservees en historique.",
    );

    if (!confirmCancel) return;

    setFinalizing(true);

    try {
      await runIntersaisonAction("cancel-campaign", {
        campaignId: campaign.id,
      });
      setFinalizeDialogOpen(false);
      setMessage("Campagne intersaison mise hors service.");
    } catch (error) {
      console.error("Erreur suppression campagne intersaison:", error);
      setMessage(error.message || "Suppression de la campagne impossible.");
    } finally {
      setFinalizing(false);
    }
  };

  const loadValidationPreview = useCallback(async () => {
    if (!canManage || !campaign?.id) return null;

    setPreviewLoading(true);

    try {
      const data = await runIntersaisonAction("preview-validation");
      setValidationPreview(data.preview || null);
      return data.preview || null;
    } catch (error) {
      console.error("Erreur preview validation intersaison:", error);
      setValidationPreview(null);
      setMessage(error.message || "Preview validation impossible.");
      return null;
    } finally {
      setPreviewLoading(false);
    }
  }, [campaign?.id, canManage, runIntersaisonAction]);

  useEffect(() => {
    if (finalizeDialogOpen && campaign?.id) {
      void loadValidationPreview();
    }
  }, [campaign?.id, finalizeDialogOpen, loadValidationPreview]);

  const launchRealTransfers = async () => {
    if (!canManage || !campaign?.id || finalizing) return;

    const preview = validationPreview || (await loadValidationPreview());
    if (!preview) return;

    if ((preview.blockedAssignments || []).length > 0) {
      setMessage(
        `Validation bloquee : ${preview.blockedAssignments.length} assignation(s) hors perimetre ou invalide(s).`,
      );
      return;
    }

    const confirmLaunch = window.confirm(
      `Confirmer la validation finale ? ${preview.guildTransfers.length} transfert(s), ${preview.communityConversions.length} sortie(s) vers communaute.`,
    );

    if (!confirmLaunch) return;

    setFinalizing(true);

    try {
      await runIntersaisonAction("launch-transfers", {
        campaignId: campaign.id,
      });
      setFinalizeDialogOpen(false);
      setMessage("Intersaison validee, transferts et sorties communaute appliques.");
    } catch (error) {
      console.error("Erreur lancement transferts intersaison:", error);
      setMessage(error.message || "Transfert impossible.");
    } finally {
      setFinalizing(false);
    }
  };

  if (!canManage) {
    return (
      <Card className="rounded-xl border-zinc-800 bg-zinc-950/90">
        <CardContent className="p-5 text-sm text-zinc-400">
          Cet onglet est reserve aux admins et leaders.
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-5">
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-md rounded-xl border-zinc-800 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle>Lancer une intersaison</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm text-zinc-400">
              La campagne sera creee pour {organization?.display_name || "ton organisation"} avec les guildes actives :
              <div className="mt-2 flex flex-wrap gap-2">
                {guildCodes.length > 0 ? (
                  guildCodes.map((code) => (
                    <Badge key={code} className="rounded-md bg-emerald-500/15 text-emerald-300">
                      {code}
                    </Badge>
                  ))
                ) : (
                  <span className="text-zinc-500">aucune guilde active</span>
                )}
              </div>
              <div className="mt-2">Tous les joueurs eligibles seront places dans BROUILLON.</div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100"
                onClick={() => setCreateDialogOpen(false)}
              >
                Annuler
              </Button>
              <Button type="button" className="rounded-lg" onClick={createCampaign} disabled={creating}>
                {creating ? "Creation..." : "Creer"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={noteDialogOpen}
        onOpenChange={(open) => {
          setNoteDialogOpen(open);
          if (!open) {
            setSelectedNoteRow(null);
            setNoteInput("");
          }
        }}
      >
        <DialogContent className="max-w-lg rounded-xl border-zinc-800 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle>Note joueur</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Joueur selectionne</div>
              <div className="mt-1 font-medium text-zinc-50">{selectedNoteRow?.watcher_name || "-"}</div>
            </div>
            <label className="space-y-2 text-sm text-zinc-300">
              <span>Message / note</span>
              <textarea
                value={noteInput}
                onChange={(event) => setNoteInput(event.target.value)}
                placeholder="Ecris une note sur ce joueur..."
                className="min-h-[140px] w-full resize-y rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100"
                onClick={() => setNoteDialogOpen(false)}
              >
                Annuler
              </Button>
              <Button type="button" className="rounded-lg" onClick={saveNote} disabled={savingNote}>
                {savingNote ? "Enregistrement..." : "Enregistrer"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={moveDialogOpen}
        onOpenChange={(open) => {
          setMoveDialogOpen(open);
          if (!open) {
            setAssignmentToMove(null);
            setMoveDashboardId("");
          }
        }}
      >
        <DialogContent className="max-w-md rounded-xl border-zinc-800 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle>Deplacer un joueur</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Joueur</div>
              <div className="mt-1 font-medium text-zinc-50">{assignmentToMove?.watcher_name || "-"}</div>
            </div>
            <label className="space-y-2 text-sm text-zinc-300">
              <span>Nouvelle destination</span>
              <select
                value={moveDashboardId}
                onChange={(event) => setMoveDashboardId(event.target.value)}
                className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none"
              >
                <option value="">Choisir un dashboard</option>
                {dashboards
                  .filter((dashboard) => String(dashboard.id) !== String(assignmentToMove?.dashboard_id))
                  .map((dashboard) => (
                    <option key={dashboard.id} value={String(dashboard.id)}>
                      {dashboard.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100"
                onClick={() => setMoveDialogOpen(false)}
              >
                Annuler
              </Button>
              <Button
                type="button"
                className="rounded-lg"
                onClick={moveAssignment}
                disabled={!moveDashboardId || moving}
              >
                {moving ? "Transfert..." : "Confirmer"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(wishRow)}
        onOpenChange={(open) => {
          if (!open) {
            setWishRow(null);
            setWishInput([]);
          }
        }}
      >
        <DialogContent className="max-w-md rounded-xl border-zinc-800 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle>Souhait de guilde</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Joueur</div>
              <div className="mt-1 font-medium text-zinc-50">{wishRow?.watcher_name || "-"}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {guildCodes.map((code) => {
                const active = wishInput.includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() =>
                      setWishInput((previous) =>
                        previous.includes(code)
                          ? previous.filter((item) => item !== code)
                          : [...previous, code],
                      )
                    }
                    className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                      active
                        ? "border-sky-400 bg-sky-500/20 text-sky-100"
                        : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                    }`}
                  >
                    {code}
                  </button>
                );
              })}
            </div>
            <div className="text-xs text-zinc-500">Selection : {wishInput.join(", ") || "aucune"}</div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100"
                onClick={() => setWishRow(null)}
              >
                Annuler
              </Button>
              <Button type="button" className="rounded-lg" onClick={saveWish} disabled={savingWish}>
                {savingWish ? "Enregistrement..." : "Enregistrer"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={finalizeDialogOpen} onOpenChange={setFinalizeDialogOpen}>
        <DialogContent className="max-w-2xl rounded-xl border-zinc-800 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle>Valider les transferts intersaison</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
              Cette etape peut modifier les guildes actives. Verifie les validations avant de continuer.
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-100">Preview de validation</div>
                  <div className="text-xs text-zinc-500">
                    Les joueurs en BROUILLON deviendront des comptes communaute.
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-lg border-zinc-700 bg-zinc-950 text-zinc-100"
                  onClick={loadValidationPreview}
                  disabled={previewLoading}
                >
                  <RefreshCw className={`h-4 w-4 ${previewLoading ? "animate-spin" : ""}`} />
                  Recalculer
                </Button>
              </div>

              {previewLoading ? (
                <div className="mt-3 text-sm text-zinc-500">Calcul de la preview...</div>
              ) : validationPreview ? (
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3">
                    <div className="text-xs uppercase tracking-wide text-emerald-300">Transferts</div>
                    <div className="mt-1 text-2xl font-semibold text-emerald-100">
                      {validationPreview.guildTransfers?.length || 0}
                    </div>
                    <div className="mt-2 max-h-28 space-y-1 overflow-y-auto text-xs text-emerald-100/80">
                      {(validationPreview.guildTransfers || []).slice(0, 8).map((item) => (
                        <div key={item.assignmentId}>
                          {item.watcherName} : {item.from || "-"} -&gt; {item.to}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-sky-500/20 bg-sky-500/10 p-3">
                    <div className="text-xs uppercase tracking-wide text-sky-300">Vers communaute</div>
                    <div className="mt-1 text-2xl font-semibold text-sky-100">
                      {validationPreview.communityConversions?.length || 0}
                    </div>
                    <div className="mt-2 max-h-28 space-y-1 overflow-y-auto text-xs text-sky-100/80">
                      {(validationPreview.communityConversions || []).slice(0, 8).map((item) => (
                        <div key={item.assignmentId}>
                          {item.watcherName} depuis {item.from || "-"}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div
                    className={`rounded-lg border p-3 ${
                      (validationPreview.blockedAssignments || []).length > 0
                        ? "border-red-500/30 bg-red-500/10"
                        : "border-zinc-700 bg-zinc-950"
                    }`}
                  >
                    <div className="text-xs uppercase tracking-wide text-red-300">Blocages</div>
                    <div className="mt-1 text-2xl font-semibold text-zinc-100">
                      {validationPreview.blockedAssignments?.length || 0}
                    </div>
                    <div className="mt-2 max-h-28 space-y-1 overflow-y-auto text-xs text-red-100/80">
                      {(validationPreview.blockedAssignments || []).slice(0, 8).map((item) => (
                        <div key={item.assignmentId}>
                          {item.watcherName || item.memberId || "Assignation"} : {item.reason}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-3 text-sm text-zinc-500">Preview non calculee.</div>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Button type="button" className="rounded-lg" onClick={copyTransferSummary}>
                <ClipboardCopy className="h-4 w-4" />
                Copier les transferts
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                onClick={cancelActiveCampaign}
                disabled={finalizing}
              >
                <Trash2 className="h-4 w-4" />
                Annuler la campagne
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="rounded-lg bg-red-700 text-white hover:bg-red-600 md:col-span-2"
                onClick={launchRealTransfers}
                disabled={
                  finalizing ||
                  previewLoading ||
                  (validationPreview?.blockedAssignments || []).length > 0
                }
              >
                <Play className="h-4 w-4" />
                {finalizing ? "Traitement..." : "Lancer les transferts reels"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Card className="rounded-xl border-zinc-800 bg-zinc-950/90 shadow-2xl">
        <CardHeader className="gap-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle className="text-zinc-50">Intersaison</CardTitle>
              <p className="mt-1 text-sm text-zinc-500">
                Dashboards previsionnels sans impact direct avant validation finale.
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100"
                onClick={loadIntersaisonData}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Actualiser
              </Button>
              <Button
                type="button"
                className="rounded-lg"
                onClick={() => setCreateDialogOpen(true)}
              >
                <Play className="h-4 w-4" />
                Lancer une intersaison
              </Button>
              {campaign ? (
                <Button
                  type="button"
                  variant="destructive"
                  className="rounded-lg bg-red-700 text-white hover:bg-red-600"
                  onClick={() => setFinalizeDialogOpen(true)}
                >
                  Valider les transferts
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {message ? (
            <div className="whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm text-zinc-300">
              {message}
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-400">
              Chargement de l'intersaison...
            </div>
          ) : !campaign ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-400">
              Aucune campagne intersaison active.
            </div>
          ) : (
            <>
              <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                    <div className="text-xs uppercase tracking-wide text-zinc-500">Campagne active</div>
                    <div className="mt-1 text-lg font-semibold text-zinc-50">{campaign.label}</div>
                    <div className="text-sm text-zinc-500">
                      {organization?.display_name || "Organisation"} - {guildCodes.length} guilde(s) active(s)
                    </div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                    <div className="text-xs uppercase tracking-wide text-zinc-500">Joueurs</div>
                    <div className="mt-1 text-lg font-semibold text-zinc-50">{assignments.length}</div>
                    <div className="text-sm text-zinc-500">dans la campagne</div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                    <div className="text-xs uppercase tracking-wide text-zinc-500">Validations</div>
                    <div className="mt-1 text-lg font-semibold text-zinc-50">
                      {confirmedCount} / {assignments.length}
                    </div>
                    <div className="text-sm text-zinc-500">transferts confirmes</div>
                  </div>
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                  <label className="space-y-2 text-sm text-zinc-300">
                    <span className="flex items-center gap-2">
                      <Search className="h-4 w-4 text-zinc-500" />
                      Recherche rapide joueur
                    </span>
                    <Input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Rechercher un joueur..."
                      className="rounded-lg border-zinc-700 bg-zinc-950 text-zinc-100"
                    />
                  </label>
                  {searchQuery.trim() ? (
                    <div className="mt-3 space-y-2">
                      {searchResults.length > 0 ? (
                        searchResults.map((row) => {
                          const dashboard = dashboards.find(
                            (item) => String(item.id) === String(row.dashboard_id),
                          );

                          return (
                            <button
                              key={row.id}
                              type="button"
                              onClick={() => {
                                setSelectedDashboardId(String(row.dashboard_id));
                                setHighlightedRowId(String(row.id));
                                setSearchQuery("");
                              }}
                              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-left transition hover:bg-zinc-800"
                            >
                              <div className="font-medium text-zinc-50">{row.watcher_name}</div>
                              <div className="text-sm text-zinc-500">Dashboard : {dashboard?.name || "-"}</div>
                            </button>
                          );
                        })
                      ) : (
                        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-500">
                          Aucun joueur trouve.
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                <label className="min-w-[220px] flex-1 space-y-2 text-sm text-zinc-300">
                  <span>Dashboard affiche</span>
                  <select
                    value={selectedDashboardId}
                    onChange={(event) => {
                      setSelectedDashboardId(event.target.value);
                      setHighlightedRowId(null);
                    }}
                    className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none"
                  >
                    {dashboards.map((dashboard) => (
                      <option key={dashboard.id} value={String(dashboard.id)}>
                        {dashboard.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="min-w-[180px] space-y-2 text-sm text-zinc-300">
                  <span>Provenance</span>
                  <select
                    value={sourceFilter}
                    onChange={(event) => setSourceFilter(event.target.value)}
                    className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none"
                  >
                    <option value="Tous">Tous</option>
                    {guildCodes.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedDashboard ? (
                  <div className="text-sm text-zinc-500">
                    {selectedRows.length} joueur(s) dans {selectedDashboard.name}
                  </div>
                ) : null}
              </div>

              <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
                <div className="overflow-x-auto">
                  <div className="min-w-[980px]">
                    <div className="grid grid-cols-[64px_minmax(220px,1fr)_120px_120px_170px_120px_110px] items-center border-b border-zinc-800 bg-zinc-900/70 px-4 py-3 text-sm font-semibold text-zinc-300">
                      <div>N</div>
                      <div>Joueur</div>
                      <div className="text-center">Provenance</div>
                      <div className="text-center">Destination</div>
                      <div className="text-center">Souhait</div>
                      <div className="text-center">Validation</div>
                      <div className="text-center">Transfert</div>
                    </div>

                    {selectedRows.length > 0 ? (
                      selectedRows.map((row, index) => {
                        const note = getNoteForAssignment(row.id);
                        const highlighted = String(highlightedRowId) === String(row.id);

                        return (
                          <div
                            key={row.id}
                            onClick={() => {
                              if (highlighted) setHighlightedRowId(null);
                            }}
                            className={`grid grid-cols-[64px_minmax(220px,1fr)_120px_120px_170px_120px_110px] items-center border-b border-zinc-800 px-4 py-3 text-sm last:border-b-0 ${
                              highlighted
                                ? "bg-sky-500/20 ring-1 ring-sky-400"
                                : row.is_manually_confirmed
                                  ? "bg-emerald-500/10"
                                  : "bg-red-500/10"
                            }`}
                          >
                            <div className="font-semibold text-zinc-500">{index + 1}</div>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openNoteDialog(row);
                              }}
                              className="flex min-w-0 items-center gap-2 text-left font-medium text-zinc-100 hover:text-sky-300"
                            >
                              <span className="truncate">{row.watcher_name}</span>
                              {note ? (
                                <MessageSquare className="h-4 w-4 shrink-0 text-sky-300" aria-label="Note" />
                              ) : null}
                              {row.discord_id_raw ? (
                                <span className="truncate text-xs text-zinc-500">{row.discord_id_raw}</span>
                              ) : null}
                            </button>
                            <div className="text-center text-zinc-300">{row.source_guild_code || "-"}</div>
                            <div className="text-center text-zinc-300">
                              {row.target_guild_code || "BROUILLON"}
                            </div>
                            <div className="flex justify-center">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setWishRow(row);
                                  setWishInput(row.wished_guild_codes || []);
                                }}
                                className="flex min-h-[36px] min-w-[130px] flex-wrap items-center justify-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 hover:bg-zinc-800"
                              >
                                {(row.wished_guild_codes || []).length > 0 ? (
                                  row.wished_guild_codes.map((code) => (
                                    <Badge
                                      key={`${row.id}-${code}`}
                                      className="rounded-md bg-sky-500/15 text-sky-300"
                                    >
                                      {code}
                                    </Badge>
                                  ))
                                ) : (
                                  <span className="text-zinc-500">-</span>
                                )}
                              </button>
                            </div>
                            <div className="flex justify-center">
                              <Button
                                type="button"
                                size="sm"
                                className={
                                  row.is_manually_confirmed
                                    ? "rounded-lg bg-red-600 text-white hover:bg-red-500"
                                    : "rounded-lg bg-emerald-600 text-white hover:bg-emerald-500"
                                }
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void toggleConfirmation(row.id);
                                }}
                              >
                                {row.is_manually_confirmed ? (
                                  <XCircle className="h-4 w-4" />
                                ) : (
                                  <CheckCircle2 className="h-4 w-4" />
                                )}
                                {row.is_manually_confirmed ? "Annuler" : "Valider"}
                              </Button>
                            </div>
                            <div className="flex justify-center">
                              <button
                                type="button"
                                className="rounded-lg p-2 text-amber-300 transition hover:bg-zinc-800 hover:text-amber-200"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setAssignmentToMove(row);
                                  setMoveDashboardId("");
                                  setMoveDialogOpen(true);
                                }}
                                title="Transferer ce joueur"
                              >
                                <ArrowRightLeft className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="px-4 py-6 text-sm text-zinc-500">
                        Aucun joueur dans ce dashboard previsionnel.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
