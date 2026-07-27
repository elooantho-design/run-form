export const CREATOR_PROFILE_BIO_MAX_LENGTH = 1000;
export const CREATOR_PROFILE_LINK_LIMIT = 10;
export const CREATOR_PROFILE_LINK_TITLE_MAX_LENGTH = 80;
export const CREATOR_PROFILE_LINK_URL_MAX_LENGTH = 2048;

export function cleanProfileText(value) {
  return String(value || "").replace(/\r\n?/g, "\n").trim();
}

export function makeProfileValidationError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function normalizeCreatorBio(value) {
  const bio = cleanProfileText(value);
  if (bio.length > CREATOR_PROFILE_BIO_MAX_LENGTH) {
    throw makeProfileValidationError(`La bio est limitee a ${CREATOR_PROFILE_BIO_MAX_LENGTH} caracteres.`);
  }
  return bio;
}

export function normalizeCreatorProfileUrl(value) {
  const raw = cleanProfileText(value);
  if (!raw) {
    throw makeProfileValidationError("URL obligatoire.");
  }
  if (raw.length > CREATOR_PROFILE_LINK_URL_MAX_LENGTH) {
    throw makeProfileValidationError(`URL limitee a ${CREATOR_PROFILE_LINK_URL_MAX_LENGTH} caracteres.`);
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw makeProfileValidationError("URL invalide.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw makeProfileValidationError("Seules les URLs http:// et https:// sont autorisees.");
  }

  return url.toString();
}

export function detectCreatorLinkPlatform(value) {
  const raw = cleanProfileText(value);
  if (!raw) return "link";

  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();

    if (host === "youtu.be" || host.endsWith("youtube.com")) return "youtube";
    if (host === "twitch.tv" || host.endsWith(".twitch.tv")) return "twitch";
    if (host === "discord.gg" || host === "discord.com" || host.endsWith(".discord.com")) return "discord";
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
    if (host === "x.com" || host === "twitter.com") return "x";
    if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  } catch {
    return "link";
  }

  return "link";
}

export function normalizeCreatorProfileLinks(links) {
  if (!Array.isArray(links)) return [];
  if (links.length > CREATOR_PROFILE_LINK_LIMIT) {
    throw makeProfileValidationError(`Un profil createur peut contenir au maximum ${CREATOR_PROFILE_LINK_LIMIT} liens.`);
  }

  return links.map((link, index) => {
    const title = cleanProfileText(link?.title);
    if (!title) {
      throw makeProfileValidationError("Le titre du lien est obligatoire.");
    }
    if (title.length > CREATOR_PROFILE_LINK_TITLE_MAX_LENGTH) {
      throw makeProfileValidationError(`Le titre du lien est limite a ${CREATOR_PROFILE_LINK_TITLE_MAX_LENGTH} caracteres.`);
    }

    const url = normalizeCreatorProfileUrl(link?.url);

    return {
      id: cleanProfileText(link?.id),
      title,
      url,
      sort_order: index,
      platform: detectCreatorLinkPlatform(url),
    };
  });
}

