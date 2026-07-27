import React, { useEffect, useMemo, useState } from "react";
import { Globe2 } from "lucide-react";
import {
  detectCreatorLinkPlatformInfo,
  getCreatorLinkFaviconApiUrl,
  getCreatorLinkIconClassName,
  getCreatorLinkPlatformMeta,
} from "@/lib/creatorLinkPlatforms";

function joinClasses(...classes) {
  return classes.filter(Boolean).join(" ");
}

function BrandSvg({ className = "", viewBox = "0 0 24 24", children }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox={viewBox} className={className} fill="currentColor">
      {children}
    </svg>
  );
}

function DiscordIcon({ className = "" }) {
  return (
    <BrandSvg className={className} viewBox="0 0 127.14 96.36">
      <path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.35 2.66-2.05a75.57 75.57 0 0 0 64.3 0c.87.71 1.76 1.39 2.66 2.05a68.68 68.68 0 0 1-10.87 5.19 77.02 77.02 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.15c2.64-27.36-4.51-51.1-18.88-72.14ZM42.45 65.69c-6.28 0-11.43-5.78-11.43-12.88s5.04-12.88 11.43-12.88c6.43 0 11.54 5.84 11.43 12.88 0 7.1-5.04 12.88-11.43 12.88Zm42.24 0c-6.28 0-11.43-5.78-11.43-12.88S78.3 39.93 84.69 39.93c6.43 0 11.54 5.84 11.43 12.88 0 7.1-5.04 12.88-11.43 12.88Z" />
    </BrandSvg>
  );
}

function YouTubeIcon({ className = "" }) {
  return (
    <BrandSvg className={className}>
      <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.4 31.4 0 0 0 0 12a31.4 31.4 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.4 31.4 0 0 0 24 12a31.4 31.4 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.2 3.6-6.2 3.6Z" />
    </BrandSvg>
  );
}

function TwitchIcon({ className = "" }) {
  return (
    <BrandSvg className={className}>
      <path d="M2.15 0 0 5.39v17.22h5.98V24h3.37l3.17-3.17h4.85L24 14.2V0H2.15Zm19.7 13.13-3.77 3.77h-6.04l-3.17 3.17V16.9H3.77V2.15h18.08v10.98ZM16.95 6.46h2.15v6.46h-2.15V6.46Zm-5.92 0h2.15v6.46h-2.15V6.46Z" />
    </BrandSvg>
  );
}

function TikTokIcon({ className = "" }) {
  return (
    <BrandSvg className={className}>
      <path d="M16.6 1.9c.4 3 2.1 4.8 5 5v4.1a8.9 8.9 0 0 1-5-1.5v7.4c0 9.4-10.3 12.4-14.5 5.6-2.7-4.4-1-12.1 7.6-12.4v4.4c-.7.1-1.5.3-2.1.7-2 1.3-1.7 4.4.6 5.2 2.2.7 4.2-.8 4.2-3.8V1.9h4.2Z" />
    </BrandSvg>
  );
}

function XIcon({ className = "" }) {
  return (
    <BrandSvg className={className}>
      <path d="M18.9 2h3.3l-7.3 8.3L23.5 22h-6.7l-5.2-6.8L5.6 22H2.3l7.8-8.9L1.9 2h6.9l4.7 6.2L18.9 2Zm-1.2 18h1.8L7.8 3.9H5.9L17.7 20Z" />
    </BrandSvg>
  );
}

function InstagramIcon({ className = "" }) {
  return (
    <BrandSvg className={className}>
      <path d="M7.8 2h8.4A5.8 5.8 0 0 1 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8A5.8 5.8 0 0 1 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2Zm0 2A3.8 3.8 0 0 0 4 7.8v8.4A3.8 3.8 0 0 0 7.8 20h8.4a3.8 3.8 0 0 0 3.8-3.8V7.8A3.8 3.8 0 0 0 16.2 4H7.8Zm8.7 2.1a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6ZM12 7.2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6Zm0 2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z" />
    </BrandSvg>
  );
}

function FacebookIcon({ className = "" }) {
  return (
    <BrandSvg className={className}>
      <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.03 1.79-4.7 4.53-4.7 1.31 0 2.68.24 2.68.24v2.96h-1.51c-1.49 0-1.96.93-1.96 1.89v2.27h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07Z" />
    </BrandSvg>
  );
}

function GitHubIcon({ className = "" }) {
  return (
    <BrandSvg className={className}>
      <path d="M12 .3A12 12 0 0 0 8.2 23.7c.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.4-1.3-5.4-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.4 11.4 0 0 1 6 0C16 4.1 17 4.4 17 4.4c.6 1.6.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.4 5.9.4.4.8 1.1.8 2.2v4.2c0 .3.2.7.8.6A12 12 0 0 0 12 .3Z" />
    </BrandSvg>
  );
}

function PatreonIcon({ className = "" }) {
  return (
    <BrandSvg className={className}>
      <path d="M15.7 2.1a6.3 6.3 0 1 0 0 12.6 6.3 6.3 0 0 0 0-12.6ZM2.3 21.9h4.1V2.1H2.3v19.8Z" />
    </BrandSvg>
  );
}

const LOCAL_PLATFORM_ICONS = {
  discord: DiscordIcon,
  youtube: YouTubeIcon,
  twitch: TwitchIcon,
  tiktok: TikTokIcon,
  x: XIcon,
  instagram: InstagramIcon,
  facebook: FacebookIcon,
  github: GitHubIcon,
  patreon: PatreonIcon,
};

export default function CreatorLinkIcon({ url = "", platform = "", className = "h-4 w-4" }) {
  const detected = useMemo(() => detectCreatorLinkPlatformInfo(url || platform), [platform, url]);
  const storedMeta = getCreatorLinkPlatformMeta(platform);
  const platformKey = detected.known ? detected.key : storedMeta?.key || "custom";
  const LocalIcon = LOCAL_PLATFORM_ICONS[platformKey] || null;
  const faviconUrl = useMemo(() => getCreatorLinkFaviconApiUrl(url), [url]);
  const [faviconFailed, setFaviconFailed] = useState(false);

  useEffect(() => {
    setFaviconFailed(false);
  }, [faviconUrl, platformKey]);

  if (LocalIcon) {
    return (
      <LocalIcon
        className={joinClasses(className, getCreatorLinkIconClassName(platformKey, url))}
      />
    );
  }

  if (faviconUrl && !faviconFailed) {
    return (
      <img
        src={faviconUrl}
        alt=""
        className={joinClasses(className, "rounded-sm bg-zinc-900 object-contain")}
        loading="lazy"
        decoding="async"
        onError={() => setFaviconFailed(true)}
      />
    );
  }

  return <Globe2 className={joinClasses(className, "text-zinc-300")} />;
}
