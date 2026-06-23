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
import { supabase } from "@/lib/supabase";
import { logPortalActivity } from "@/lib/portalActivity";

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

function getActorMemberId(session) {
  return session?.memberId || session?.id || null;
}

function getActorName(session) {
  return session?.watcherName || session?.memberName || session?.name || "Admin";
}

function emptyIntersaisonState() {
  return {
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
  const actorMemberId = getActorMemberId(session);
  const actorName = getActorName(session);

  const [campaign, setCampaign] = useState(null);
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
  const [guildCountInput, setGuildCountInput] = useState("7");
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

  const resetState = useCallback(() => {
    const empty = emptyIntersaisonState();
    setCampaign(empty.campaign);
    setDashboards(empty.dashboards);
    setAssignments(empty.assignments);
    setNotes(empty.notes);
    setSelectedDashboardId("");
    setSourceFilter("Tous");
    setSearchQuery("");
    setHighlightedRowId(null);
  }, []);

  const loadIntersaisonData = useCallback(async () => {
    if (!canManage) return;

    setLoading(true);
    setMessage("");

    const { data: activeCampaign, error: campaignError } = await supabase
      .from("intersaison_campaigns")
      .select("*")
      .eq("status", "active")
      .maybeSingle();

    if (campaignError) {
      console.error("Erreur chargement campagne intersaison:", campaignError);
      resetState();
      setMessage(campaignError.message || "Impossible de charger la campagne intersaison.");
      setLoading(false);
      return;
    }

    if (!activeCampaign) {
      resetState();
      setLoading(false);
      return;
    }

    const { data: dashboardRows, error: dashboardsError } = await supabase
      .from("intersaison_dashboards")
      .select("*")
      .eq("campaign_id", activeCampaign.id)
      .order("sort_order", { ascending: true });

    if (dashboardsError) {
      console.error("Erreur chargement dashboards intersaison:", dashboardsError);
      resetState();
      setMessage(dashboardsError.message || "Impossible de charger les dashboards.");
      setLoading(false);
      return;
    }

    const { data: assignmentRows, error: assignmentsError } = await supabase
      .from("intersaison_assignments")
      .select(
        `
        id,
        campaign_id,
        dashboard_id,
        member_id,
        watcher_name,
        discord_id_raw,
        source_guild_code,
        target_guild_code,
        poll_choice,
        assignment_source,
        has_note,
        created_at,
        updated_at,
        is_manually_confirmed,
        wished_guild_codes
      `,
      )
      .eq("campaign_id", activeCampaign.id)
      .order("created_at", { ascending: true });

    if (assignmentsError) {
      console.error("Erreur chargement assignations intersaison:", assignmentsError);
      resetState();
      setMessage(assignmentsError.message || "Impossible de charger les assignations.");
      setLoading(false);
      return;
    }

    const assignmentIds = (assignmentRows || []).map((item) => item.id).filter(Boolean);
    let noteRows = [];

    if (assignmentIds.length > 0) {
      const { data: loadedNotes, error: notesError } = await supabase
        .from("intersaison_notes")
        .select("*")
        .in("assignment_id", assignmentIds)
        .order("updated_at", { ascending: false });

      if (notesError) {
        console.error("Erreur chargement notes intersaison:", notesError);
        setMessage(notesError.message || "Notes intersaison non chargees.");
      } else {
        noteRows = loadedNotes || [];
      }
    }

    const dashboardsList = dashboardRows || [];
    setCampaign(activeCampaign);
    setDashboards(dashboardsList);
    setAssignments(assignmentRows || []);
    setNotes(noteRows);
    setSelectedDashboardId((previous) => {
      if (previous && dashboardsList.some((dashboard) => String(dashboard.id) === String(previous))) {
        return previous;
      }

      const firstRealDashboard = dashboardsList.find((dashboard) => !dashboard.is_draft);
      return String(firstRealDashboard?.id || dashboardsList[0]?.id || "");
    });
    setLoading(false);
  }, [canManage, resetState]);

  useEffect(() => {
    void loadIntersaisonData();
  }, [loadIntersaisonData]);

  const guildCodes = useMemo(() => {
    const count = Number(campaign?.guild_count || 7);
    return Array.from({ length: Number.isFinite(count) && count > 0 ? count : 7 }, (_, index) => `G${index + 1}`);
  }, [campaign?.guild_count]);

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

    const confirmedAssignments = assignments.filter((assignment) => assignment.is_manually_confirmed);

    if (confirmedAssignments.length === 0) {
      return "Aucun transfert valide pour le moment.";
    }

    const lines = [];

    dashboards
      .filter((dashboard) => !dashboard.is_draft)
      .forEach((dashboard) => {
        const arrivals = confirmedAssignments.filter(
          (assignment) => String(assignment.dashboard_id) === String(dashboard.id),
        );
        const departures = confirmedAssignments.filter(
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

    return lines.join("\n").trim();
  }, [assignments, dashboards]);

  const createCampaign = async () => {
    if (!canManage || creating) return;

    const parsedGuildCount = Number(guildCountInput);

    if (!Number.isInteger(parsedGuildCount) || parsedGuildCount < 1 || parsedGuildCount > 20) {
      setMessage("Le nombre de guildes doit etre un entier entre 1 et 20.");
      return;
    }

    setCreating(true);
    setMessage("");

    const { error } = await supabase.rpc("create_intersaison_campaign", {
      p_guild_count: parsedGuildCount,
      p_poll_channel_id: null,
    });

    setCreating(false);

    if (error) {
      console.error("Erreur creation campagne intersaison:", error);
      setMessage(error.message || "Creation impossible.");
      return;
    }

    setCreateDialogOpen(false);
    await logPortalActivity(session, {
      actionType: "intersaison_campaign_create",
      entityType: "intersaison_campaign",
      summary: `${actorName} a lance une intersaison`,
      metadata: { guildCount: parsedGuildCount },
    });
    await loadIntersaisonData();
  };

  const openNoteDialog = (row) => {
    const existingNote = getNoteForAssignment(row.id);
    setSelectedNoteRow(row);
    setNoteInput(existingNote?.note || "");
    setNoteDialogOpen(true);
  };

  const saveNote = async () => {
    if (!selectedNoteRow?.id || savingNote) return;
    if (!actorMemberId) {
      setMessage("Impossible d'enregistrer la note sans membre admin identifie.");
      return;
    }

    const cleanNote = noteInput.trim();
    const existingNote = getNoteForAssignment(selectedNoteRow.id);

    setSavingNote(true);

    if (!cleanNote) {
      if (existingNote) {
        const { error } = await supabase.from("intersaison_notes").delete().eq("id", existingNote.id);

        if (error) {
          console.error("Erreur suppression note intersaison:", error);
          setMessage(error.message || "Suppression impossible.");
          setSavingNote(false);
          return;
        }

        setNotes((previous) => previous.filter((note) => String(note.id) !== String(existingNote.id)));
      }

      setSavingNote(false);
      setNoteDialogOpen(false);
      setSelectedNoteRow(null);
      setNoteInput("");
      return;
    }

    const nowIso = new Date().toISOString();

    if (existingNote) {
      const { error } = await supabase
        .from("intersaison_notes")
        .update({ note: cleanNote, updated_at: nowIso })
        .eq("id", existingNote.id);

      if (error) {
        console.error("Erreur mise a jour note intersaison:", error);
        setMessage(error.message || "Enregistrement impossible.");
        setSavingNote(false);
        return;
      }

      setNotes((previous) =>
        previous.map((note) =>
          String(note.id) === String(existingNote.id)
            ? { ...note, note: cleanNote, updated_at: nowIso }
            : note,
        ),
      );
    } else {
      const { data, error } = await supabase
        .from("intersaison_notes")
        .insert({
          assignment_id: selectedNoteRow.id,
          note: cleanNote,
          created_by_member_id: actorMemberId,
        })
        .select("*")
        .single();

      if (error) {
        console.error("Erreur creation note intersaison:", error);
        setMessage(error.message || "Creation impossible.");
        setSavingNote(false);
        return;
      }

      setNotes((previous) => [data, ...previous]);
    }

    setSavingNote(false);
    setNoteDialogOpen(false);
    setSelectedNoteRow(null);
    setNoteInput("");
  };

  const toggleConfirmation = async (assignmentId) => {
    if (!canManage || !assignmentId) return;

    const currentAssignment = assignments.find((assignment) => String(assignment.id) === String(assignmentId));
    if (!currentAssignment) return;

    const nextConfirmedValue = !currentAssignment.is_manually_confirmed;
    const nowIso = new Date().toISOString();

    const { error } = await supabase
      .from("intersaison_assignments")
      .update({
        is_manually_confirmed: nextConfirmedValue,
        updated_at: nowIso,
      })
      .eq("id", assignmentId);

    if (error) {
      console.error("Erreur toggle validation intersaison:", error);
      setMessage(error.message || "Changement impossible.");
      return;
    }

    setAssignments((previous) =>
      previous.map((assignment) =>
        String(assignment.id) === String(assignmentId)
          ? {
              ...assignment,
              is_manually_confirmed: nextConfirmedValue,
              updated_at: nowIso,
            }
          : assignment,
      ),
    );
  };

  const moveAssignment = async () => {
    if (!canManage || moving || !assignmentToMove?.id || !moveDashboardId) return;

    const nextDashboard = dashboards.find((dashboard) => String(dashboard.id) === String(moveDashboardId));
    if (!nextDashboard) return;

    const nextTargetGuildCode = nextDashboard.is_draft ? null : nextDashboard.code;
    const nowIso = new Date().toISOString();

    setMoving(true);

    const { error } = await supabase
      .from("intersaison_assignments")
      .update({
        dashboard_id: nextDashboard.id,
        target_guild_code: nextTargetGuildCode,
        is_manually_confirmed: true,
        updated_at: nowIso,
      })
      .eq("id", assignmentToMove.id);

    setMoving(false);

    if (error) {
      console.error("Erreur deplacement manuel intersaison:", error);
      setMessage(error.message || "Deplacement impossible.");
      return;
    }

    setAssignments((previous) =>
      previous.map((assignment) =>
        String(assignment.id) === String(assignmentToMove.id)
          ? {
              ...assignment,
              dashboard_id: nextDashboard.id,
              target_guild_code: nextTargetGuildCode,
              is_manually_confirmed: true,
              updated_at: nowIso,
            }
          : assignment,
      ),
    );
    setMoveDialogOpen(false);
    setAssignmentToMove(null);
    setMoveDashboardId("");
  };

  const saveWish = async () => {
    if (!wishRow?.id || savingWish) return;

    const cleaned = [...new Set(wishInput)].sort((a, b) => a.localeCompare(b, "fr"));
    setSavingWish(true);

    const { error } = await supabase
      .from("intersaison_assignments")
      .update({ wished_guild_codes: cleaned })
      .eq("id", wishRow.id);

    setSavingWish(false);

    if (error) {
      console.error("Erreur sauvegarde souhait intersaison:", error);
      setMessage(error.message || "Enregistrement impossible.");
      return;
    }

    setAssignments((previous) =>
      previous.map((assignment) =>
        String(assignment.id) === String(wishRow.id)
          ? { ...assignment, wished_guild_codes: cleaned }
          : assignment,
      ),
    );
    setWishRow(null);
    setWishInput([]);
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
      "Annuler completement la campagne active d'intersaison ? Cette action supprimera les dashboards previsionnels, les affectations et les notes.",
    );

    if (!confirmCancel) return;

    setFinalizing(true);

    const assignmentIds = assignments.map((assignment) => assignment.id).filter(Boolean);

    if (assignmentIds.length > 0) {
      const { error: notesError } = await supabase
        .from("intersaison_notes")
        .delete()
        .in("assignment_id", assignmentIds);

      if (notesError) {
        console.error("Erreur suppression notes intersaison:", notesError);
        setMessage(notesError.message || "Suppression des notes impossible.");
        setFinalizing(false);
        return;
      }
    }

    const { error: assignmentsError } = await supabase
      .from("intersaison_assignments")
      .delete()
      .eq("campaign_id", campaign.id);

    if (assignmentsError) {
      console.error("Erreur suppression assignations intersaison:", assignmentsError);
      setMessage(assignmentsError.message || "Suppression des assignations impossible.");
      setFinalizing(false);
      return;
    }

    const { error: dashboardsError } = await supabase
      .from("intersaison_dashboards")
      .delete()
      .eq("campaign_id", campaign.id);

    if (dashboardsError) {
      console.error("Erreur suppression dashboards intersaison:", dashboardsError);
      setMessage(dashboardsError.message || "Suppression des dashboards impossible.");
      setFinalizing(false);
      return;
    }

    const { error: campaignError } = await supabase
      .from("intersaison_campaigns")
      .delete()
      .eq("id", campaign.id);

    if (campaignError) {
      console.error("Erreur suppression campagne intersaison:", campaignError);
      setMessage(campaignError.message || "Suppression de la campagne impossible.");
      setFinalizing(false);
      return;
    }

    await logPortalActivity(session, {
      actionType: "intersaison_campaign_cancel",
      entityType: "intersaison_campaign",
      entityId: campaign.id,
      summary: `${actorName} a annule la campagne intersaison`,
      metadata: { assignmentCount: assignments.length },
    });

    setFinalizing(false);
    setFinalizeDialogOpen(false);
    resetState();
    setMessage("Campagne intersaison annulee.");
  };

  const launchRealTransfers = async () => {
    if (!canManage || !campaign?.id || finalizing) return;

    const unconfirmedAssignments = assignments.filter((assignment) => !assignment.is_manually_confirmed);
    if (unconfirmedAssignments.length > 0) {
      setMessage(
        `Impossible de lancer les transferts reels : ${unconfirmedAssignments.length} joueur(s) non valides.`,
      );
      return;
    }

    const confirmedAssignments = assignments.filter(
      (assignment) =>
        assignment.is_manually_confirmed && assignment.member_id && assignment.target_guild_code,
    );

    if (confirmedAssignments.length === 0) {
      setMessage("Aucun transfert reel a appliquer.");
      return;
    }

    const confirmLaunch = window.confirm(
      "Confirmer le lancement des transferts reels ? Cette action modifie les guildes actives.",
    );

    if (!confirmLaunch) return;

    setFinalizing(true);

    for (const assignment of confirmedAssignments) {
      const { error } = await supabase
        .from("guild_members")
        .update({ guild_code: assignment.target_guild_code })
        .eq("id", assignment.member_id);

      if (error) {
        console.error("Erreur transfert reel membre:", error, assignment);
        setMessage(`Erreur pendant le transfert reel de ${assignment.watcher_name}. Operation interrompue.`);
        setFinalizing(false);
        return;
      }
    }

    const assignmentIds = assignments.map((assignment) => assignment.id).filter(Boolean);

    if (assignmentIds.length > 0) {
      const { error: notesError } = await supabase
        .from("intersaison_notes")
        .delete()
        .in("assignment_id", assignmentIds);

      if (notesError) {
        console.error("Erreur suppression notes apres transferts reels:", notesError);
        setMessage(notesError.message || "Transferts faits, mais suppression des notes impossible.");
        setFinalizing(false);
        return;
      }
    }

    const { error: assignmentsError } = await supabase
      .from("intersaison_assignments")
      .delete()
      .eq("campaign_id", campaign.id);

    if (assignmentsError) {
      console.error("Erreur suppression assignations apres transferts reels:", assignmentsError);
      setMessage(assignmentsError.message || "Transferts faits, mais suppression des assignations impossible.");
      setFinalizing(false);
      return;
    }

    const { error: dashboardsError } = await supabase
      .from("intersaison_dashboards")
      .delete()
      .eq("campaign_id", campaign.id);

    if (dashboardsError) {
      console.error("Erreur suppression dashboards apres transferts reels:", dashboardsError);
      setMessage(dashboardsError.message || "Transferts faits, mais suppression des dashboards impossible.");
      setFinalizing(false);
      return;
    }

    const { error: campaignError } = await supabase
      .from("intersaison_campaigns")
      .delete()
      .eq("id", campaign.id);

    if (campaignError) {
      console.error("Erreur suppression campagne apres transferts reels:", campaignError);
      setMessage(campaignError.message || "Transferts faits, mais suppression de la campagne impossible.");
      setFinalizing(false);
      return;
    }

    await logPortalActivity(session, {
      actionType: "intersaison_transfers_apply",
      entityType: "intersaison_campaign",
      entityId: campaign.id,
      summary: `${actorName} a applique les transferts intersaison`,
      metadata: { transferCount: confirmedAssignments.length },
    });

    setFinalizing(false);
    setFinalizeDialogOpen(false);
    resetState();
    setMessage("Transferts reels appliques et campagne cloturee.");
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
            <label className="space-y-2 text-sm text-zinc-300">
              <span>Nombre de guildes prevues</span>
              <Input
                type="number"
                min="1"
                max="20"
                value={guildCountInput}
                onChange={(event) => setGuildCountInput(event.target.value)}
                className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100"
              />
            </label>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm text-zinc-400">
              Creation des dashboards previsionnels demandes, plus un dashboard brouillon.
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
                disabled={finalizing}
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
                onClick={() => {
                  setGuildCountInput("7");
                  setCreateDialogOpen(true);
                }}
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
                    <div className="text-sm text-zinc-500">{campaign.guild_count} guilde(s) prevues</div>
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
