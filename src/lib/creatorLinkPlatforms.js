export const CREATOR_LINK_PLATFORM_DEFINITIONS = [
  {
    key: "discord",
    label: "Discord",
    domains: ["discord.gg", "discord.com", "discordapp.com"],
    icon: "local",
    iconClassName: "text-indigo-300",
  },
  {
    key: "youtube",
    label: "YouTube",
    domains: ["youtube.com", "youtu.be"],
    icon: "local",
    iconClassName: "text-red-300",
  },
  {
    key: "twitch",
    label: "Twitch",
    domains: ["twitch.tv"],
    icon: "local",
    iconClassName: "text-violet-300",
  },
  {
    key: "tiktok",
    label: "TikTok",
    domains: ["tiktok.com"],
    icon: "local",
    iconClassName: "text-cyan-300",
  },
  {
    key: "x",
    label: "X",
    domains: ["x.com", "twitter.com"],
    icon: "local",
    iconClassName: "text-zinc-100",
  },
  {
    key: "instagram",
    label: "Instagram",
    domains: ["instagram.com"],
    icon: "local",
    iconClassName: "text-pink-300",
  },
  {
    key: "facebook",
    label: "Facebook",
    domains: ["facebook.com", "fb.com"],
    icon: "local",
    iconClassName: "text-blue-300",
  },
  {
    key: "github",
    label: "GitHub",
    domains: ["github.com"],
    icon: "local",
    iconClassName: "text-zinc-100",
  },
  {
    key: "patreon",
    label: "Patreon",
    domains: ["patreon.com"],
    icon: "local",
    iconClassName: "text-orange-300",
  },
  {
    key: "reddit",
    label: "Reddit",
    domains: ["reddit.com"],
    icon: "favicon",
    iconClassName: "text-orange-300",
  },
  {
    key: "bluesky",
    label: "Bluesky",
    domains: ["bsky.app", "bsky.social"],
    icon: "favicon",
    iconClassName: "text-sky-300",
  },
  {
    key: "kick",
    label: "Kick",
    domains: ["kick.com"],
    icon: "favicon",
    iconClassName: "text-lime-300",
  },
  {
    key: "steam",
    label: "Steam",
    domains: ["steamcommunity.com", "store.steampowered.com"],
    icon: "favicon",
    iconClassName: "text-slate-200",
  },
  {
    key: "telegram",
    label: "Telegram",
    domains: ["t.me", "telegram.me", "telegram.org"],
    icon: "favicon",
    iconClassName: "text-sky-300",
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    domains: ["linkedin.com"],
    icon: "favicon",
    iconClassName: "text-blue-300",
  },
];

const PLATFORM_BY_KEY = new Map(
  CREATOR_LINK_PLATFORM_DEFINITIONS.map((platform) => [platform.key, platform]),
);

function cleanString(value) {
  return String(value || "").trim();
}

export function normalizeCreatorLinkHostname(value) {
  const raw = cleanString(value);
  if (!raw) return "";

  const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;

  try {
    const url = new URL(withProtocol);
    return url.hostname.replace(/\.+$/g, "").replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

export function creatorLinkHostnameMatchesDomain(hostname, domain) {
  const normalizedHostname = normalizeCreatorLinkHostname(hostname);
  const normalizedDomain = normalizeCreatorLinkHostname(domain);
  if (!normalizedHostname || !normalizedDomain) return false;
  return normalizedHostname === normalizedDomain || normalizedHostname.endsWith(`.${normalizedDomain}`);
}

export function detectCreatorLinkPlatformInfo(value) {
  const hostname = normalizeCreatorLinkHostname(value);
  if (!hostname) {
    return {
      key: "custom",
      label: "Lien",
      hostname: "",
      known: false,
      icon: "fallback",
      iconClassName: "text-zinc-300",
    };
  }

  const platform = CREATOR_LINK_PLATFORM_DEFINITIONS.find((definition) =>
    definition.domains.some((domain) => creatorLinkHostnameMatchesDomain(hostname, domain)),
  );

  if (platform) {
    return {
      key: platform.key,
      label: platform.label,
      hostname,
      known: true,
      icon: platform.icon,
      iconClassName: platform.iconClassName,
    };
  }

  return {
    key: "custom",
    label: hostname,
    hostname,
    known: false,
    icon: "favicon",
    iconClassName: "text-zinc-300",
  };
}

export function detectCreatorLinkPlatform(value) {
  const platform = detectCreatorLinkPlatformInfo(value);
  return platform.known ? platform.key : "link";
}

export function getCreatorLinkPlatformMeta(platform) {
  return PLATFORM_BY_KEY.get(cleanString(platform).toLowerCase()) || null;
}

export function getCreatorLinkPlatformLabel(platform, value = "") {
  const meta = getCreatorLinkPlatformMeta(platform);
  if (meta) return meta.label;

  const detected = detectCreatorLinkPlatformInfo(value);
  return detected.label || "Lien";
}

export function getCreatorLinkIconClassName(platform, value = "") {
  const meta = getCreatorLinkPlatformMeta(platform);
  if (meta?.iconClassName) return meta.iconClassName;

  const detected = detectCreatorLinkPlatformInfo(value);
  return detected.iconClassName || "text-zinc-300";
}

export function getCreatorLinkFaviconApiUrl(value) {
  const raw = cleanString(value);
  if (!raw || !normalizeCreatorLinkHostname(raw)) return "";
  return `/api/creator-link-icon?url=${encodeURIComponent(raw)}`;
}
