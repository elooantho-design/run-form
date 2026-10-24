import { getForecastDiscordId } from "./intersaisonSurveyChoices.js";
import { requestDiscordNativeNavigation } from "./discordNativeNavigation.js";

function isDiscordId(value) {
  return /^[1-9]\d{14,19}$/.test(value) && BigInt(value) <= 18446744073709551615n;
}

export function getForecastDiscordContact(member, members = []) {
  const missing = { status: "missing", userId: "", error: "Aucun identifiant Discord associé à ce joueur." };
  const invalid = (error = "Identifiant Discord invalide pour ce joueur.") => ({ status: "invalid", userId: "", error });
  if (!member) return missing;
  const membersById = new Map(members.map((row) => [row.id, row]));
  const root = member.primary_member_id ? membersById.get(member.primary_member_id) : member;
  if (!root || root.primary_member_id) return invalid("Association Discord du compte secondaire introuvable ou incohérente.");
  if (root.discord_id != null && typeof root.discord_id !== "string") return invalid();
  if (member.discord_id != null && typeof member.discord_id !== "string") return invalid();
  const id = String(root.discord_id || "").trim();
  if (!id) return missing;
  if (!isDiscordId(id)) return invalid();
  if (getForecastDiscordId(member, membersById) !== id) return invalid("Association Discord du compte secondaire incohérente.");
  return { status: "ready", userId: id, error: "" };
}

export function requestDiscordNativeProfile(userId, { windowRef = typeof window === "undefined" ? null : window } = {}) {
  const id = typeof userId === "string" ? userId.trim() : "";
  if (!isDiscordId(id)) throw new Error("Identifiant Discord invalide pour ce joueur.");
  // A user ID identifies a profile, not the admin's private DM channel. Never use a bot DM here.
  requestDiscordNativeNavigation(`discord://-/users/${id}`, { windowRef });
  return { requested: true, mode: "native-profile" };
}
