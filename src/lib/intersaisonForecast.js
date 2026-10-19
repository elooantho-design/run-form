import { getPublicAssetsBaseUrl, resolveVpsAssetUrlForRuntime } from "./vpsAssets.js";
export { FORECAST_ROLES, getForecastDiscordId } from "./intersaisonSurveyChoices.js";

export function resolveForecastAvatarUrl(value, options = {}) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash || url.searchParams.size !== 1
      || url.origin !== new URL(getPublicAssetsBaseUrl()).origin
      || !/^\/assets\/discord-avatars\/[a-f0-9]{64}\.webp$/.test(url.pathname)
      || !/^[a-f0-9]{16}$/.test(url.searchParams.get("v") || "")) return "";
    return resolveVpsAssetUrlForRuntime(url.toString(), options);
  } catch { return ""; }
}
