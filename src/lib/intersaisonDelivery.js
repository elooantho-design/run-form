export function describeIntersaisonDeliveryError(value) {
  const raw = String(value || "");
  if (/DELIVERY_UNCERTAIN/i.test(raw)) return { kind: "uncertain", retry: false,
    message: "Discord a reçu le message, mais la confirmation technique a échoué. Vérifier le MP avant toute intervention ; ne pas le renvoyer." };
  if (/50278|no mutual guilds/i.test(raw)) return { kind: "intervention", retry: true,
    message: "Discord refuse le MP : aucun serveur commun avec le bot. Vérifier le compte Discord et rejoindre le serveur avant de réessayer." };
  if (/50007|cannot send messages to this user/i.test(raw)) return { kind: "intervention", retry: true,
    message: "MP refusé par Discord. Le joueur doit autoriser les messages privés du serveur avant un nouvel essai." };
  if (/10013|unknown user/i.test(raw)) return { kind: "intervention", retry: true,
    message: "Utilisateur Discord introuvable. Corriger le rattachement dans Gestion guilde avant de réessayer." };
  if (/HTTP 401|HTTP 403|missing permissions|50013/i.test(raw)) return { kind: "intervention", retry: true,
    message: "Accès Discord refusé. Vérifier la configuration et les permissions du bot avant de réessayer." };
  if (/429|rate limit|HTTP 5\d\d|ECONNRESET|ETIMEDOUT|temporar/i.test(raw)) return { kind: "temporary", retry: true,
    message: "Erreur temporaire Discord ou réseau. Un nouvel essai individuel est possible ; les tentatives restent limitées." };
  return { kind: "technical", retry: true, message: raw || "L’envoi n’a pas abouti. Vérifier le détail avant de réessayer." };
}
