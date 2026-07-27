import assert from "node:assert/strict";
import {
  CREATOR_PROFILE_BIO_MAX_LENGTH,
  CREATOR_PROFILE_LINK_LIMIT,
  detectCreatorLinkPlatform,
  normalizeCreatorBio,
  normalizeCreatorProfileLinks,
} from "../api/_pve-creator-profile.js";

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

assert.equal(detectCreatorLinkPlatform("https://youtu.be/abc"), "youtube");
assert.equal(detectCreatorLinkPlatform("https://twitch.tv/name"), "twitch");
assert.equal(detectCreatorLinkPlatform("https://x.com/name"), "x");
assert.equal(detectCreatorLinkPlatform("https://instagram.com/name"), "instagram");
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
