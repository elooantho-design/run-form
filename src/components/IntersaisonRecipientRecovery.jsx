import React, { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeIntersaisonDeliveryError } from "@/lib/intersaisonDelivery";

export default function IntersaisonRecipientRecovery({ recipientId, request, busy, onRetry }) {
  const [inspection, setInspection] = useState(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let disposed = false;
    request({ action: "inspect-survey-recipient", surveyRecipientId: recipientId })
      .then((data) => { if (!disposed) { setInspection(data.inspection); setError(""); } })
      .catch((failure) => { if (!disposed) { setError(failure.message); setInspection(null); } });
    return () => { disposed = true; };
  }, [recipientId, request, revision]);
  const deliveryError = describeIntersaisonDeliveryError(inspection?.lastError);
  function retry() {
    if (!inspection?.canRetry || busy || !deliveryError.retry) return;
    if (!window.confirm(`Envoyer le sondage uniquement pour ${inspection.accountName} (${inspection.guildCode}) ? Vérifie le rattachement affiché et corrige d’abord toute cause de refus Discord. Aucun autre compte ne sera relancé.`)) return;
    onRetry(inspection.fingerprint);
  }
  return <section className="space-y-3 border-t border-zinc-800 pt-3 text-sm">
    <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Compte et propriétaire Discord</h3>
      <Button type="button" variant="ghost" size="icon" title="Revérifier le rattachement" aria-label="Revérifier le rattachement" disabled={busy} onClick={() => { setInspection(null); setError(""); setRevision((v) => v + 1); }}><RefreshCw className="h-4 w-4" /></Button></div>
    {error ? <p className="text-red-200">{error}</p> : !inspection ? <p className="text-zinc-400">Vérification du rattachement…</p> : <>
      <p>{inspection.accountName} · {inspection.guildCode}</p>
      <p className="text-zinc-400">Compte principal : {inspection.primaryName || "Introuvable"}</p>
      <p className={inspection.eligible ? "text-emerald-200" : "text-amber-200"}>{inspection.reason}</p>
      {inspection.linkedAccounts?.length > 1 ? <ul className="space-y-1 text-xs text-zinc-400">{inspection.linkedAccounts.map((account) => <li key={account.memberId}>{account.name} · {account.guildCode}</li>)}</ul> : null}
      {inspection.lastError ? <p className="text-amber-200"><span className="block text-xs text-zinc-400">Dernier échec</span>{deliveryError.message}</p> : null}
      {inspection.blockReason ? <p className="text-amber-200">{inspection.blockReason}</p> : null}
      <Button type="button" className="w-full bg-red-600 text-white hover:bg-red-500" disabled={busy || !inspection.canRetry || !deliveryError.retry} onClick={retry}>Réessayer l’envoi</Button>
    </>}
  </section>;
}
