import { useState } from "react";
import { Crown, MessageCircle, Shield, UserRound } from "lucide-react";
import { PALADIN_GUILD_DISPLAY_NAMES } from "@/lib/guildDisplay";
import { FORECAST_ROLES } from "@/lib/intersaisonForecast";

function DiscordAvatar({ url }) {
  const [failed, setFailed] = useState(false);
  return <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-800 text-zinc-400">
    {url && !failed ? <img src={url} alt="" width="28" height="28" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={() => setFailed(true)} /> : <UserRound aria-hidden="true" className="h-4 w-4" />}
  </span>;
}

export default function IntersaisonForecastPlayer({ player, avatarUrl = "", onOpen, onComment }) {
  const role = player.forecastRole || "member";
  const color = role === "leader" ? "border-yellow-600/60 bg-yellow-500/10" : role === "officer" ? "border-purple-500/50 bg-purple-500/10" : "border-zinc-800 bg-zinc-950";
  const comment = player.answer?.comment_text || "";
  const second = player.answer?.second_choice_guild_code;
  return <div className={`flex w-full min-w-0 items-start gap-1 rounded border p-1 ${color}`} data-forecast-role={role}>
    <button type="button" onClick={onOpen} aria-label={`Ouvrir ${player.name}`} className="flex min-w-0 flex-1 items-start gap-2 rounded p-1 text-left text-sm hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-sky-400">
      <DiscordAvatar key={avatarUrl} url={avatarUrl} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-medium text-zinc-100">
          {role === "leader" ? <Crown aria-label="Leader prévisionnel" className="h-3.5 w-3.5 shrink-0 text-yellow-300" /> : role === "officer" ? <Shield aria-label="Officier prévisionnel" className="h-3.5 w-3.5 shrink-0 text-purple-300" /> : null}
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{player.name}</span>
          {player.currentGuild ? <span className="text-xs text-zinc-400">{player.currentGuild}</span> : null}
          {second ? <span className="text-xs font-normal text-zinc-400">· 2e : {PALADIN_GUILD_DISPLAY_NAMES[second] || second}</span> : null}
        </span>
        <span className="mt-1 block text-xs text-zinc-400">{player.manual ? "Placement admin" : player.answer ? "Choix du joueur" : "Sans réponse"}{role !== "member" ? ` · ${FORECAST_ROLES[role]} prévisionnel` : ""}{!player.activeNow ? " · Absent des effectifs actuels" : ""}</span>
        {player.hasDifference ? <span className="mt-0.5 block text-xs text-amber-200">Choix différent du placement</span> : null}
      </span>
    </button>
    {comment.trim() ? <button type="button" onClick={(event) => { event.stopPropagation(); onComment(); }} title="Lire le commentaire" aria-label={`Lire le commentaire de ${player.name}`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-sky-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-400"><MessageCircle aria-hidden="true" className="h-3.5 w-3.5" /></button> : null}
  </div>;
}
