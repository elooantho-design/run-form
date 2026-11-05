import { useState } from "react";
import { ArrowRight, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function GvgResetDialog({ guildName, busy, error, choice = null, resume = false, onCancel, onConfirm }) {
  const [step, setStep] = useState(choice === null ? 1 : 2);

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-950 text-zinc-100 sm:max-w-lg" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{resume ? "Reprendre le nettoyage" : step === 1 ? "Reset GvG" : "Sauvegarde des d\u00e9fenses adverses"}</DialogTitle>
          <DialogDescription className="break-words text-zinc-300">
            {resume ? `Terminer le nettoyage de l'operation deja validee pour ${guildName} ? Aucun nouveau reset ne sera lance.` : step === 1
              ? `\u00cates-vous s\u00fbr de vouloir r\u00e9initialiser la GvG de ${guildName} ?`
              : "Voulez-vous sauvegarder les d\u00e9fenses adverses avant de r\u00e9initialiser la GvG ?"}
          </DialogDescription>
        </DialogHeader>
        {!resume && step === 2 ? (
          <div className="space-y-3">
            <Button type="button" variant="outline" className="h-auto w-full justify-start whitespace-normal rounded-md px-3 py-3 text-left" disabled={busy || choice === false} onClick={() => onConfirm(true)}>
              <Save className="size-4 shrink-0" />
              <span className="min-w-0">
                <span className="block">Oui, sauvegarder les défenses adverses</span>
                <span className="mt-1 block text-xs font-normal text-zinc-400">{"Conserver les d\u00e9fenses et leurs statistiques, puis r\u00e9initialiser."}</span>
              </span>
            </Button>
            <Button type="button" variant="destructive" className="h-auto w-full justify-start whitespace-normal rounded-md px-3 py-3 text-left" disabled={busy || choice === true} onClick={() => onConfirm(false)}>
              <Trash2 className="size-4 shrink-0" />
              <span className="min-w-0">
                <span className="block">{"Non, r\u00e9initialiser sans sauvegarder"}</span>
                <span className="mt-1 block text-xs font-normal">{"Reset technique : aucun ajout aux biblioth\u00e8ques ni aux compteurs adverses."}</span>
              </span>
            </Button>
          </div>
        ) : null}
        {error ? <p role="alert" className="break-words text-sm text-red-300">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" className="rounded-md" disabled={busy} onClick={onCancel}>{!resume && choice !== null ? "Fermer" : "Annuler"}</Button>
          {resume ? (
            <Button type="button" className="rounded-md" disabled={busy} onClick={() => onConfirm(choice)}>Reprendre le nettoyage</Button>
          ) : step === 1 ? (
            <Button type="button" className="rounded-md" onClick={() => setStep(2)}>Oui, continuer <ArrowRight className="size-4" /></Button>
          ) : null}
          {busy ? <span role="status" className="self-center text-sm text-zinc-400">{"R\u00e9initialisation en cours..."}</span> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
