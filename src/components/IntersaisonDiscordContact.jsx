import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getForecastDiscordContact, requestDiscordNativeProfile } from "@/lib/discordNativeContact";

export default function IntersaisonDiscordContact({ member, members, disabled = false, className = "" }) {
  const contact = getForecastDiscordContact(member, members);
  const [feedback, setFeedback] = useState(null);
  function openContact() {
    if (disabled || contact.status !== "ready") return;
    try {
      requestDiscordNativeProfile(contact.userId);
      setFeedback({ error: false, message: "Ouverture du profil Discord demandée, non confirmée. Discord doit être installé et les liens discord:// autorisés." });
    } catch (error) {
      setFeedback({ error: true, message: error.message });
    }
  }
  return <>
    <span className="max-w-full" title={contact.error || "Ouvrir le profil dans l'application Discord, puis Message. Le MP direct n'est pas disponible."}>
      <Button type="button" variant="outline" className={`${className} h-auto min-h-9 max-w-full whitespace-normal`} disabled={disabled || contact.status !== "ready"} onClick={openContact}>
        <MessageSquare aria-hidden="true" className="h-4 w-4 shrink-0" /> MP le joueur
      </Button>
    </span>
    {contact.status === "invalid" ? <p role="alert" className="basis-full break-words text-sm text-red-200">{contact.error}</p>
      : feedback ? <p role={feedback.error ? "alert" : "status"} className={`basis-full break-words text-sm ${feedback.error ? "text-red-200" : "text-zinc-400"}`}>{feedback.message}</p> : null}
  </>;
}
