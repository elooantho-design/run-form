import assert from "node:assert/strict";
import {
  CREATOR_PROFILE_BIO_MAX_LENGTH,
  CREATOR_PROFILE_LINK_LIMIT,
  detectCreatorLinkPlatform,
  normalizeCreatorBio,
  normalizeCreatorProfileLinks,
} from "../api/_pve-creator-profile.js";
import {
  creatorLinkHostnameMatchesDomain,
  detectCreatorLinkPlatformInfo,
  getCreatorLinkFaviconApiUrl,
  getCreatorLinkPlatformLabel,
  normalizeCreatorLinkHostname,
} from "../src/lib/creatorLinkPlatforms.js";

const validLinks = normalizeCreatorProfileLinks([
  { title: "YouTube", url: "https://www.youtube.com/@creator" },
  { title: "Discord", url: "https://discord.gg/example" },
  { title: "Site", url: "http://example.com" },
]);

assert.equal(normalizeCreatorBio("a".repeat(CREATOR_PROFILE_BIO_MAX_LENGTH)).length, CREATOR_PROFILE_BIO_MAX_LENGTH);
assert.throws(() => normalizeCreatorBio("a".repeat(CREATOR_PROFILE_BIO_MAX_LENGTH + 1)), /1000/);

assert.equal(validLinks.length, 3);
assert.equal(validLinks[0].sort_order, 0);
assert.equal(validLinks[1].platform, "discord");
assert.equal(validLinks[2].platform, "link");

assert.equal(new URL("https://discord.gg/js8T7yNUwq").hostname.toLowerCase(), "discord.gg");
const knownPlatforms = [
  ["https://discord.gg/js8T7yNUwq", "discord", "Discord"],
  ["https://www.discord.com/invite/example", "discord", "Discord"],
  ["https://subdomain.discord.com/example", "discord", "Discord"],
  ["https://twitch.tv/example", "twitch", "Twitch"],
  ["https://www.youtube.com/@example", "youtube", "YouTube"],
  ["https://youtu.be/example", "youtube", "YouTube"],
  ["https://x.com/example", "x", "X"],
  ["https://twitter.com/example", "x", "X"],
  ["https://instagram.com/example", "instagram", "Instagram"],
  ["https://tiktok.com/@example", "tiktok", "TikTok"],
  ["https://github.com/example", "github", "GitHub"],
  ["https://patreon.com/example", "patreon", "Patreon"],
  ["https://reddit.com/r/example", "reddit", "Reddit"],
  ["https://bsky.app/profile/example", "bluesky", "Bluesky"],
  ["https://kick.com/example", "kick", "Kick"],
  ["https://steamcommunity.com/id/example", "steam", "Steam"],
  ["https://t.me/example", "telegram", "Telegram"],
  ["https://linkedin.com/in/example", "linkedin", "LinkedIn"],
];

for (const [url, key, label] of knownPlatforms) {
  assert.equal(detectCreatorLinkPlatform(url), key);
  assert.deepEqual(
    {
      key: detectCreatorLinkPlatformInfo(url).key,
      label: detectCreatorLinkPlatformInfo(url).label,
      known: detectCreatorLinkPlatformInfo(url).known,
    },
    { key, label, known: true },
  );
  assert.equal(getCreatorLinkPlatformLabel("link", url), label);
}

const falsePositiveCases = [
  ["https://discord.gg.example.com", "discord.gg"],
  ["https://notdiscord.gg", "discord.gg"],
  ["https://discord.com.evil.example", "discord.com"],
  ["https://youtube.com.evil.example", "youtube.com"],
  ["https://notyoutube.com", "youtube.com"],
  ["https://twitch.tv.example.com", "twitch.tv"],
  ["https://instagram.com.evil.example", "instagram.com"],
  ["https://github.com.evil.example", "github.com"],
  ["https://patreon.com.evil.example", "patreon.com"],
];

for (const [url, platformDomain] of falsePositiveCases) {
  assert.equal(creatorLinkHostnameMatchesDomain(new URL(url).hostname, platformDomain), false);
  assert.equal(detectCreatorLinkPlatformInfo(url).known, false);
}

assert.equal(normalizeCreatorLinkHostname("https://www.discord.com/invite/example"), "discord.com");
assert.equal(detectCreatorLinkPlatformInfo("https://example.com/path").key, "custom");
assert.equal(detectCreatorLinkPlatformInfo("https://example.com/path").label, "example.com");
assert.equal(getCreatorLinkPlatformLabel("link", "https://example.com/path"), "example.com");
assert.match(getCreatorLinkFaviconApiUrl("https://example.com/path"), /^\/api\/creator-link-icon\?url=/);
assert.equal(detectCreatorLinkPlatform("not-an-url"), "link");

assert.throws(() => normalizeCreatorProfileLinks([{ title: "", url: "https://example.com" }]), /titre/i);
assert.throws(() => normalizeCreatorProfileLinks([{ title: "Bad", url: "javascript:alert(1)" }]), /http/i);
assert.throws(() => normalizeCreatorProfileLinks([{ title: "Bad", url: "file:///tmp/a" }]), /http/i);
assert.throws(
  () =>
    normalizeCreatorProfileLinks(
      Array.from({ length: CREATOR_PROFILE_LINK_LIMIT + 1 }, (_, index) => ({
        title: `Link ${index}`,
        url: `https://example.com/${index}`,
      })),
    ),
  /maximum/i,
);

console.log("pve creator profile validation ok");
