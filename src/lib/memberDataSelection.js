export const MEMBER_IDENTITY_ERROR = "Compte joueur introuvable dans les donn\u00e9es autoris\u00e9es. Aucun autre profil n'a \u00e9t\u00e9 s\u00e9lectionn\u00e9.";

export function resolvePersonalMemberId(members, actorId, requestedId = "") {
  const actorKey = String(actorId || "");
  if (!actorKey || !members.some((member) => String(member.id) === actorKey)) return "";
  const targetKey = String(requestedId || actorKey);
  return members.some((member) => String(member.id) === targetKey) ? targetKey : "";
}

export function assertPersonalDataActor(data, actorId) {
  if (!actorId || String(data?.actorMemberId || "") !== String(actorId)) throw new Error(MEMBER_IDENTITY_ERROR);
}
