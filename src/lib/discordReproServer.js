/* global process */
const DISCORD_API_BASE = "https://discord.com/api/v10";
const DEFAULT_REPRO_CHANNEL_IDS = {
  G1: "1501512158637457408",
  G2: "1517470861354078338",
};
const REPRO_REQUEST_TABLE = "gvg_discord_repro_requests";
const REPRO_CONTROL_TABLE = "gvg_discord_repro_controls";
const REPRO_PARTICIPANT_TABLE = "gvg_discord_repro_participants";
const DEFENSE_FOLLOWUP_TABLE = "guild_defense_discord_followups";
const DEFAULT_PUBLIC_ASSETS_BASE_URL = "https://vps-aad12be0.vps.ovh.net";
const DEFENSE_STATUS_VALID = "Valid\u00e9";
const DISCORD_STATUS_DONE = "\u2705";
const MAX_DISCORD_FIELD_VALUE = 1024;
const MAX_DISCORD_EMBEDS = 10;
const DISCORD_REQUEST_TIMEOUT_MS = 15000;
const DISCORD_PURGE_VERIFY_ATTEMPTS = 5;
const DISCORD_PURGE_VERIFY_DELAY_MS = 400;
const DISCORD_PURGE_VERIFY_LIMIT = 5;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function discordEphemeral(content) {
  return {
    type: 4,
    data: {
      content,
      flags: 64,
    },
  };
}

function discordMessageUpdate(content, options = {}) {
  return {
    type: 7,
    data: {
      content,
      embeds: options.embeds || [],
      components: options.components || [],
      allowed_mentions: { parse: [] },
    },
  };
}

function buildDiscordInteractionMessageResponse(content, options = {}) {
  const data = {
    content,
    embeds: options.embeds || [],
    components: options.components || [],
    allowed_mentions: { parse: [] },
  };

  if (!options.update) data.flags = 64;

  return {
    type: options.update ? 7 : 4,
    data,
  };
}

function parseRequestIdFromCustomId(customId, prefix) {
  const value = String(customId || "");
  if (!value.startsWith(prefix)) return "";
  return value.slice(prefix.length).trim();
}

function normalizeGuildCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "_");
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeGvgDefenseChampionName(name) {
  if (!name) return null;

  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\d+$/, "")
    .replace(/[^a-z0-9]/g, "")
    .trim() || null;
}

function normalizeGvgDefensePosition(position) {
  return String(position || "").trim().toUpperCase() || null;
}

function normalizeGvgDefenseDirection(direction) {
  const value = String(direction || "").trim().toUpperCase();

  if (["N", "NORD", "NORTH", "UP"].includes(value)) return "N";
  if (["S", "SUD", "SOUTH", "DOWN"].includes(value)) return "S";
  if (["E", "EST", "EAST", "RIGHT"].includes(value)) return "E";
  if (["O", "OUEST", "W", "WEST", "LEFT"].includes(value)) return "O";

  return value || null;
}

function makeGvgDefenseSignature(defense) {
  const heroes = Array.isArray(defense?.heroes) ? defense.heroes : [];

  const slots = heroes
    .map((hero) => {
      const champion = normalizeGvgDefenseChampionName(hero?.champion || hero?.name);
      const position = normalizeGvgDefensePosition(hero?.position);
      const direction = normalizeGvgDefenseDirection(hero?.direction);

      if (!champion || !position || !direction) return null;

      return `${position}:${direction}:${champion}`;
    })
    .filter(Boolean)
    .sort();

  if (slots.length !== 5) return null;

  return slots.join("|");
}

function canReceivePropagatedRepro(defense) {
  const status = String(defense?.status || "").toLowerCase();
  return !status || status === "def" || status === "repro";
}

function isAdminRole(role) {
  return ["admin", "administrateur", "leader"].includes(normalizeText(role));
}

function isOfficerRole(role) {
  return ["officier", "officer"].includes(normalizeText(role));
}

function isLeaderRole(role) {
  return normalizeText(role) === "leader";
}

function isPaladinGuildCode(value) {
  return /^G[1-7]$/.test(normalizeGuildCode(value));
}

function isDiscordReproEligibleDefense(defense) {
  const guild = normalizeGuildCode(defense?.guild);
  return (
    Boolean(getDiscordReproChannelId(guild)) &&
    defense?.is_ally !== true &&
    String(defense?.status || "").toLowerCase() === "def"
  );
}

function getDiscordBotToken() {
  return String(
    process.env.DISCORD_BOT_TOKEN ||
      process.env.DISCORD_DEFENSE_BOT_TOKEN ||
      process.env.DISCORD_TOKEN ||
      ""
  ).trim();
}

function getDiscordReproChannelId(guild) {
  const normalizedGuild = normalizeGuildCode(guild);
  const guildEnvKey = normalizedGuild ? `DISCORD_REPRO_CHANNEL_ID_${normalizedGuild}` : "";
  const legacyG1ChannelId =
    normalizedGuild === "G1" || !normalizedGuild
      ? process.env.DISCORD_REPRO_CHANNEL_ID
      : "";

  return String(
    (guildEnvKey ? process.env[guildEnvKey] : "") ||
      legacyG1ChannelId ||
      DEFAULT_REPRO_CHANNEL_IDS[normalizedGuild] ||
      ""
    ).trim();
}

function getDiscordReproRoleId(guild) {
  const normalizedGuild = normalizeGuildCode(guild);
  const guildEnvKey = normalizedGuild ? `DISCORD_REPRO_ROLE_ID_${normalizedGuild}` : "";
  return String((guildEnvKey ? process.env[guildEnvKey] : "") || "").trim();
}

function getDiscordPurgeMaxMessages() {
  const value = Number(process.env.DISCORD_REPRO_PURGE_MAX_MESSAGES || 1000);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1000;
}

function getPortalBaseUrl() {
  return String(
    process.env.PORTAL_PUBLIC_URL ||
      process.env.VERCEL_PROJECT_PRODUCTION_URL ||
      process.env.VERCEL_URL ||
      ""
  )
    .trim()
    .replace(/^([^:/]+\.vercel\.app)$/i, "https://$1")
    .replace(/\/$/, "");
}

function getPublicAssetsBaseUrl() {
  const raw = String(
    process.env.GVG_PUBLIC_ASSETS_BASE_URL ||
      process.env.VPS_PUBLIC_ASSETS_BASE_URL ||
      process.env.VITE_GVG_PUBLIC_ASSETS_BASE_URL ||
      process.env.VITE_ASSETS_BASE_URL ||
      DEFAULT_PUBLIC_ASSETS_BASE_URL
  ).trim();

  if (!raw || /^(0|false|off|disabled)$/i.test(raw)) return "";
  return raw.replace(/\/+$/, "");
}

function encodeUrlSegment(value) {
  return encodeURIComponent(String(value || "").trim());
}

function buildPublicPreviewUrl(guild, jobId, file) {
  const baseUrl = getPublicAssetsBaseUrl();
  if (!baseUrl || !guild || !jobId || !file) return "";

  return `${baseUrl}/public/jobs/${encodeUrlSegment(
    String(guild).trim().toLowerCase()
    )}/${encodeUrlSegment(jobId)}/previews/${encodeUrlSegment(file)}`;
}

function buildPublicHeroUrl(fileName) {
  const baseUrl = getPublicAssetsBaseUrl();
  if (!baseUrl || !fileName) return "";
  return `${baseUrl}/assets/heroes/${encodeUrlSegment(fileName)}?v=20260718-heroes-1`;
}

function slugHeroFileName(name) {
  const slug = normalizeGvgDefenseChampionName(name);
  return slug ? `${slug}.png` : "";
}

function truncateDiscordText(value, max = MAX_DISCORD_FIELD_VALUE) {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function safeJsonLog(details = {}) {
  try {
    return JSON.stringify(details, (_key, value) => {
      if (typeof value === "bigint") return value.toString();
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          status: value.status ?? value.statusCode ?? null,
          code: value.code ?? null,
        };
      }
      return value;
    });
  } catch {
    return "{}";
  }
}

function createReproSubmitTrace(context = {}) {
  let currentStage = "start";
  const base = {
    defense_id: context.defense_id || null,
    user_id: context.user_id || null,
    guild_id: context.guild_id || null,
  };

  return {
    stage(stage, details = {}) {
      currentStage = stage;
      console.log(`[REPRO SUBMIT] ${stage} ${safeJsonLog({ ...base, ...details })}`);
    },
    fail(error, details = {}) {
      console.error(
        `[REPRO SUBMIT] FAILED at ${currentStage} ${safeJsonLog({
          ...base,
          ...details,
          error,
        })}`
      );
    },
  };
}

function logReproTeamStage(stage, details = {}) {
  console.log(`[REPRO TEAM] ${stage} ${safeJsonLog(details)}`);
}

function resolvePublicAssetProxyUrl(imageUrl) {
  const value = String(imageUrl || "").trim();
  if (!value) return value;

  try {
    const parsed = new URL(value, "https://portal.local");
    if (parsed.pathname !== "/api/gvg-server") return value;
    if (parsed.searchParams.get("action") !== "preview") return value;

    return (
      buildPublicPreviewUrl(
        parsed.searchParams.get("guild") || parsed.searchParams.get("sourceGuild"),
        parsed.searchParams.get("jobId") || parsed.searchParams.get("job_id"),
        parsed.searchParams.get("file")
      ) || value
    );
  } catch {
    return value;
  }
}

function resolveDiscordImageUrl(imageUrl) {
  const value = resolvePublicAssetProxyUrl(imageUrl);
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;

  const portalBaseUrl = getPortalBaseUrl();
  if (!portalBaseUrl || !value.startsWith("/")) return "";

  try {
    return new URL(value, `${portalBaseUrl}/`).toString();
  } catch {
    return "";
  }
}

function isMissingReproRequestTable(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes(REPRO_REQUEST_TABLE)
  );
}

function isMissingReproWorkflowTable(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes(REPRO_CONTROL_TABLE) ||
    message.includes(REPRO_PARTICIPANT_TABLE)
  );
}

function isAlreadyExistsError(error) {
  return error?.code === "23505";
}

async function discordRequest(pathname, options = {}, requestOptions = {}) {
  const token = getDiscordBotToken();
  const useBotAuth = requestOptions.auth !== false;
  if (useBotAuth && !token) {
    const error = new Error("DISCORD_BOT_TOKEN manquant");
    error.code = "DISCORD_CONFIG_MISSING";
    throw error;
  }

  const method = options.method || "GET";
  const headers = {
    ...(useBotAuth ? { Authorization: `Bot ${token}` } : {}),
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(requestOptions.timeoutMs || DISCORD_REQUEST_TIMEOUT_MS));
    let response = null;
    try {
      response = await fetch(`${DISCORD_API_BASE}${pathname}`, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        const timeoutError = new Error(`Discord request timeout: ${method} ${pathname}`);
        timeoutError.code = "DISCORD_REQUEST_TIMEOUT";
        timeoutError.path = pathname;
        timeoutError.method = method;
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 429) {
      const payload = await response.json().catch(() => null);
      const retryAfterMs = Math.ceil(Number(payload?.retry_after || 1) * 1000) + 250;
      await sleep(retryAfterMs);
      continue;
    }

    if (requestOptions.ignoreNotFound && response.status === 404) {
      return null;
    }

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }

    if (!response.ok) {
      const error = new Error(payload?.message || `Discord HTTP ${response.status}`);
      error.status = response.status;
      error.data = payload;
      throw error;
    }

    return payload;
  }

  throw new Error("Discord rate limit retry exhausted");
}

function sanitizeDiscordUserId(value) {
  return String(value || "").trim();
}

function getDiscordDefaultAvatarIndex(userId, discriminator = null) {
  const legacyDiscriminator = String(discriminator || "").trim();
  if (/^\d{4}$/.test(legacyDiscriminator) && legacyDiscriminator !== "0000") {
    return Number(legacyDiscriminator) % 5;
  }

  try {
    return Number((BigInt(sanitizeDiscordUserId(userId)) >> 22n) % 6n);
  } catch {
    return 0;
  }
}

function buildDiscordUserAvatarUrl(user) {
  const userId = sanitizeDiscordUserId(user?.id);
  if (!userId) return "";
  const avatarHash = String(user?.avatar || "").trim();
  if (avatarHash) {
    const ext = avatarHash.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${encodeUrlSegment(userId)}/${encodeUrlSegment(avatarHash)}.${ext}?size=128`;
  }
  return `https://cdn.discordapp.com/embed/avatars/${getDiscordDefaultAvatarIndex(userId, user?.discriminator)}.png`;
}

async function fetchDiscordUser(userId) {
  const id = sanitizeDiscordUserId(userId);
  if (!id) return null;
  return discordRequest(`/users/${encodeURIComponent(id)}`, { method: "GET" }).catch((error) => {
    console.warn("[discord-repro] user avatar fetch failed:", error?.message || error);
    return null;
  });
}

async function enrichParticipantsForDiscordDisplay(participants = []) {
  const enriched = [];
  for (const participant of participants) {
    const user = await fetchDiscordUser(participant.discord_user_id);
    enriched.push({
      ...participant,
      discord_avatar_url: buildDiscordUserAvatarUrl(user || { id: participant.discord_user_id }),
    });
  }
  return enriched;
}

async function editDeferredInteractionResponse(interaction, payload) {
  const applicationId = String(interaction?.application_id || "").trim();
  const token = String(interaction?.token || "").trim();
  if (!applicationId || !token) return null;
  return discordRequest(
    `/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(token)}/messages/@original`,
    {
      method: "PATCH",
      body: {
        content: "",
        embeds: [],
        components: [],
        allowed_mentions: { parse: [] },
        ...(typeof payload === "string" ? { content: payload } : payload || {}),
      },
    },
    { auth: false, ignoreNotFound: true }
  );
}

async function deleteDeferredInteractionResponse(interaction) {
  const applicationId = String(interaction?.application_id || "").trim();
  const token = String(interaction?.token || "").trim();
  if (!applicationId || !token) return null;
  return discordRequest(
    `/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(token)}/messages/@original`,
    { method: "DELETE" },
    { auth: false, ignoreNotFound: true }
  );
}

function discordDeferredEphemeral(interaction, action, options = {}) {
  const fallback = options.fallback || "Action impossible pour le moment.";
  return {
    type: 5,
    data: { flags: 64 },
    __discordDeferred: true,
    deferredTask: async () => {
      try {
        const payload = await action();
        await editDeferredInteractionResponse(interaction, payload || "Action terminee.");
      } catch (error) {
        console.error(`[discord-repro:${options.label || "deferred"}]`, error);
        await editDeferredInteractionResponse(interaction, error?.message || fallback);
      }
    },
  };
}

function discordDeferredMessageUpdate(interaction, action, options = {}) {
  const fallback = options.fallback || "Impossible de finaliser cette action. Tu peux reessayer.";
  return {
    type: 6,
    __discordDeferred: true,
    deferredTask: async () => {
      try {
        const payload = await action();
        if (options.deleteOnSuccess && !payload) {
          try {
            await deleteDeferredInteractionResponse(interaction);
          } catch (deleteError) {
            console.warn(`[discord-repro:${options.label || "deferred_update"}:delete_original_failed]`, deleteError?.message || deleteError);
          }
        } else {
          await editDeferredInteractionResponse(interaction, payload || "Action terminee.");
        }
        if (typeof options.onFinalize === "function") options.onFinalize();
      } catch (error) {
        if (typeof options.onError === "function") options.onError(error);
        console.error(`[discord-repro:${options.label || "deferred_update"}]`, error);
        try {
          await editDeferredInteractionResponse(interaction, {
            content: error?.publicMessage || error?.message || fallback,
            embeds: [],
            components: [],
          });
          if (typeof options.onErrorFinalize === "function") options.onErrorFinalize(error);
        } catch (editError) {
          console.error(`[discord-repro:${options.label || "deferred_update"}:finalize_failed]`, editError);
        }
      }
    },
  };
}

function serializeDiscordError(error, extra = {}) {
  const retryAfter = Number(error?.data?.retry_after ?? error?.payload?.retry_after ?? 0);
  const statusCode = error?.status ?? error?.statusCode ?? null;
  const retryText =
    statusCode === 429 && Number.isFinite(retryAfter) && retryAfter > 0
      ? ` Reessaie dans ${Math.ceil(retryAfter)}s.`
      : "";

  return {
    ...extra,
    statusCode,
    retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    message: `${error?.message || "Discord request failed"}${retryText}`,
  };
}

function formatDefenseTitle(defense) {
  const bastion = defense?.bastion ? `Bastion ${defense.bastion}` : "Bastion ?";
  const type =
    defense?.type === "fortress"
      ? "Forteresse"
      : defense?.tower
        ? `Tour ${defense.tower}`
        : "Tour ?";
  const team = defense?.team ? `Team ${defense.team}` : "Team ?";
  return `${bastion} - ${type} - ${team}`;
}

function formatDefenseShortTitle(defense) {
  const bastion = defense?.bastion ? `B${defense.bastion}` : "B?";
  const type =
    defense?.type === "fortress"
      ? "Forteresse"
      : defense?.tower
        ? `T${defense.tower}`
        : "Tour ?";
  const team = defense?.team ? `Team ${defense.team}` : "Team ?";
  return `${bastion} - ${type} - ${team}`;
}

function getDefenseKindLabel(defense) {
  if (defense?.type === "fortress") return "Forteresse";
  if (defense?.type === "tower") return "Tour";
  return "Defense";
}

function parseWizardLocation(value) {
  const location = String(value || "").trim().toLowerCase();
  if (location === "fort") return { type: "fortress", tower: null };
  const towerMatch = location.match(/^t([1-5])$/);
  if (towerMatch) return { type: "tower", tower: Number(towerMatch[1]) };
  return null;
}

function getHeroDisplayName(hero, index) {
  return String(hero?.champion || hero?.name || hero?.hero || `Heros ${index + 1}`).trim();
}

function getHeroLine(hero, index, minAwakenings = {}) {
  const name = getHeroDisplayName(hero, index);
  const position = normalizeGvgDefensePosition(hero?.position) || "?";
  const direction = normalizeGvgDefenseDirection(hero?.direction) || "?";
  const min = Number(minAwakenings?.[index] ?? minAwakenings?.[String(index)] ?? -1);
  const minimum = Number.isFinite(min) && min >= 0 ? ` - min A${min}` : "";
  return `${index + 1}. ${name} - ${position} ${direction}${minimum}`;
}

function normalizeMinAwakenings(value) {
  const source = value && typeof value === "object" ? value : {};
  const output = {};
  for (let index = 0; index < 5; index += 1) {
    const raw = source[index] ?? source[String(index)] ?? source[`hero_${index + 1}`];
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 5) output[String(index)] = parsed;
  }
  return output;
}

function parseAwakeningInput(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text || text === "AUCUN" || text === "NONE" || text === "-") return null;
  const match = text.match(/^A?\s*([0-5])$/);
  return match ? Number(match[1]) : null;
}

function buildMainControlPayload(guild) {
  const normalizedGuild = normalizeGuildCode(guild) || "GVG";
  return {
    content: "",
    embeds: [
      {
        title: "Demandes de reproduction GvG",
        description: [`Guild : **${normalizedGuild.replace("_", " ")}**`, "", "Clique sur le bouton pour demander une reproduction precise."].join("\n"),
        color: 0x22c55e,
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 1,
            custom_id: `gvg_repro_start:${normalizedGuild}`,
            label: "Demander une repro",
          },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

function formatWizardLocationLabel(location) {
  const value = String(location || "").trim().toLowerCase();
  if (value === "fort") return "Forteresse";
  const tower = value.match(/^t(\d+)$/)?.[1];
  return tower ? `Tour ${tower}` : "Position inconnue";
}

function buildBastionSelectResponse(guild, options = {}) {
  const normalizedGuild = normalizeGuildCode(guild) || "GVG";
  return buildDiscordInteractionMessageResponse("Choisis le bastion.", {
    update: options.update,
    components: [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `gvg_repro_bastion:${normalizedGuild}`,
            placeholder: "Bastion",
            min_values: 1,
            max_values: 1,
            options: [1, 2, 3, 4].map((bastion) => ({
              label: `Bastion ${bastion}`,
              value: String(bastion),
            })),
          },
        ],
      },
    ],
  });
}

function buildLocationSelectResponse(guild, bastion, options = {}) {
  const normalizedGuild = normalizeGuildCode(guild) || "GVG";
  const locationOptions = [
    { label: "Forteresse", value: "fort" },
    ...[1, 2, 3, 4, 5].map((tower) => ({ label: `Tour ${tower}`, value: `t${tower}` })),
  ];
  return buildDiscordInteractionMessageResponse(
    `Bastion ${bastion} choisi.\nSelectionne la forteresse ou la tour.`,
    {
      update: options.update,
      components: [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: `gvg_repro_location:${normalizedGuild}:${bastion}`,
              placeholder: "Forteresse / Tour",
              min_values: 1,
              max_values: 1,
              options: locationOptions,
            },
          ],
        },
      ],
    }
  );
}

function buildTeamSelectResponse(guild, bastion, location, options = {}) {
  const normalizedGuild = normalizeGuildCode(guild) || "GVG";
  return buildDiscordInteractionMessageResponse(
    [`Bastion ${bastion} choisi.`, `${formatWizardLocationLabel(location)} choisie.`, "Choisis la team."].join("\n"),
    {
      update: options.update,
      components: [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: `gvg_repro_team:${normalizedGuild}:${bastion}:${location}`,
              placeholder: "Team",
              min_values: 1,
              max_values: 1,
              options: [
                { label: "Team 1", value: "1" },
                { label: "Team 2", value: "2" },
              ],
            },
          ],
        },
      ],
    }
  );
}

function buildAlreadyOpenConfirmation(defense, options = {}) {
  return buildDiscordInteractionMessageResponse(
    `✅ **DEJA OUVERTE**\n\n${formatDefenseTitle(defense)} a deja ete ouverte. Es-tu sur de vouloir creer une nouvelle demande de reproduction ?`,
    {
      update: options.update,
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 3,
              custom_id: `gvg_repro_create_confirm:${defense.id}`,
              label: "Oui, continuer",
            },
            {
              type: 2,
              style: 2,
              custom_id: "gvg_repro_ephemeral_cancel",
              label: "Annuler",
            },
          ],
        },
      ],
    }
  );
}

function buildConditionsModal(defense, requestRow = null) {
  const heroes = Array.isArray(defense?.heroes) ? defense.heroes.slice(0, 5) : [];
  const minAwakenings = normalizeMinAwakenings(requestRow?.min_awakenings);
  return {
    type: 9,
    data: {
      custom_id: requestRow?.id
        ? `gvg_repro_conditions_submit:${requestRow.id}`
        : `gvg_repro_create:${defense.id}`,
      title: requestRow?.id ? "Modifier les conditions" : "Conditions de repro",
      components: heroes.map((hero, index) =>
        textInput(
          `hero_${index + 1}`,
          `${getHeroDisplayName(hero, index)} minimum`,
          Number.isInteger(minAwakenings[index]) ? `A${minAwakenings[index]}` : "",
          {
            style: 1,
            required: false,
            maxLength: 8,
            placeholder: "Aucun, A0, A1, A2, A3, A4 ou A5",
          }
        )
      ),
    },
  };
}

function buildWizardConditionsModal({ guild, bastion, location, team }) {
  const normalizedGuild = normalizeGuildCode(guild) || "GVG";
  const safeBastion = String(bastion || "").trim();
  const safeLocation = String(location || "").trim().toLowerCase();
  const safeTeam = String(team || "").trim();
  const heroes = [1, 2, 3, 4, 5].map((index) => ({ name: `Heros ${index}` }));

  return {
    type: 9,
    data: {
      custom_id: `gvg_repro_create_wizard:${normalizedGuild}:${safeBastion}:${safeLocation}:${safeTeam}`,
      title: "Conditions de repro",
      components: heroes.map((hero, index) =>
        textInput(
          `hero_${index + 1}`,
          `${getHeroDisplayName(hero, index)} minimum`,
          "",
          {
            style: 1,
            required: false,
            maxLength: 8,
            placeholder: "Aucun, A0, A1, A2, A3, A4 ou A5",
          }
        )
      ),
    },
  };
}

export async function reopenDiscordReproRequestForDefense(supabase, defense, options = {}) {
  return {
    enabled: true,
    skipped: true,
    reason: "interactive_workflow_no_auto_reopen",
    gvg_defense_id: defense?.id || null,
    source: options.source || null,
  };
}

async function getOrCreateReproControlRow(supabase, guild, channelId) {
  const normalizedGuild = normalizeGuildCode(guild);
  const { data: existing, error: existingError } = await supabase
    .from(REPRO_CONTROL_TABLE)
    .select("*")
    .eq("guild", normalizedGuild)
    .in("state", ["active", "send_failed"])
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return existing;

  const { data, error } = await supabase
    .from(REPRO_CONTROL_TABLE)
    .insert({
      guild: normalizedGuild,
      discord_channel_id: channelId,
      state: "active",
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .maybeSingle();

  if (error && isAlreadyExistsError(error)) {
    const retry = await supabase
      .from(REPRO_CONTROL_TABLE)
      .select("*")
      .eq("guild", normalizedGuild)
      .in("state", ["active", "send_failed"])
      .maybeSingle();
    if (retry.error) throw retry.error;
    return retry.data;
  }

  if (error) throw error;
  return data;
}

async function ensureDiscordReproMainMessageForGuild(supabase, guild) {
  const normalizedGuild = normalizeGuildCode(guild);
  const channelId = getDiscordReproChannelId(normalizedGuild);
  if (!channelId) {
    return { skipped: true, reason: "missing_repro_channel", guild: normalizedGuild };
  }

  if (!getDiscordBotToken()) {
    return { enabled: false, reason: "missing_discord_config", guild: normalizedGuild, channel_id: channelId };
  }

  let controlRow = null;
  try {
    controlRow = await getOrCreateReproControlRow(supabase, normalizedGuild, channelId);
  } catch (error) {
    if (isMissingReproWorkflowTable(error)) {
      return { enabled: false, reason: "missing_gvg_discord_interactive_repro_workflow_sql", guild: normalizedGuild };
    }
    throw error;
  }

  if (controlRow?.discord_message_id && controlRow.state === "active") {
    return {
      enabled: true,
      skipped: true,
      reason: "main_message_already_active",
      guild: normalizedGuild,
      control_id: controlRow.id,
      discord_message_id: controlRow.discord_message_id,
    };
  }

  try {
    const message = await discordRequest(`/channels/${encodeURIComponent(channelId)}/messages`, {
      method: "POST",
      body: buildMainControlPayload(normalizedGuild),
    });

    await supabase
      .from(REPRO_CONTROL_TABLE)
      .update({
        discord_message_id: message?.id || null,
        state: "active",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", controlRow.id);

    return {
      enabled: true,
      sent: true,
      guild: normalizedGuild,
      control_id: controlRow.id,
      discord_message_id: message?.id || null,
    };
  } catch (error) {
    await supabase
      .from(REPRO_CONTROL_TABLE)
      .update({
        state: "send_failed",
        last_error: String(error?.message || error || "send failed").slice(0, 1000),
        updated_at: new Date().toISOString(),
      })
      .eq("id", controlRow.id);

    return {
      enabled: true,
      sent: false,
      guild: normalizedGuild,
      control_id: controlRow.id,
      error: error?.message || "send failed",
    };
  }
}

export async function notifyDiscordReproRequestsForDefenses(supabase, defenses) {
  const eligibleDefenses = (defenses || []).filter(isDiscordReproEligibleDefense);

  if (!eligibleDefenses.length) {
    return { enabled: true, eligible: 0, controls: 0, sent: 0, skipped: 0, failed: 0 };
  }

  const guilds = [...new Set(eligibleDefenses.map((defense) => normalizeGuildCode(defense?.guild)).filter(Boolean))];
  const results = [];

  try {
    for (const guild of guilds) {
      const result = await ensureDiscordReproMainMessageForGuild(supabase, guild);
      results.push(result);
    }
  } catch (error) {
    if (isMissingReproRequestTable(error) || isMissingReproWorkflowTable(error)) {
      return {
        enabled: false,
        reason: "missing_gvg_discord_interactive_repro_workflow_sql",
        eligible: eligibleDefenses.length,
        controls: guilds.length,
        sent: 0,
        skipped: 0,
        failed: guilds.length,
      };
    }

    return {
      enabled: true,
      eligible: eligibleDefenses.length,
      controls: guilds.length,
      sent: results.filter((item) => item.sent).length,
      skipped: results.filter((item) => item.skipped).length,
      failed: results.filter((item) => item.error || item.sent === false).length,
      error: error?.message || "discord repro main message failed",
    };
  }

  return {
    enabled: true,
    eligible: eligibleDefenses.length,
    controls: guilds.length,
    sent: results.filter((item) => item.sent).length,
    skipped: results.filter((item) => item.skipped).length,
    failed: results.filter((item) => item.error || item.sent === false).length,
    items: results,
  };
}

async function deleteDiscordMessage(channelId, messageId) {
  if (!channelId || !messageId || !getDiscordBotToken()) return { skipped: true };
  await discordRequest(
    `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
    { method: "DELETE" },
    { ignoreNotFound: true }
  );
  return { deleted: true };
}

async function listDiscordChannelMessages(channelId, options = {}) {
  const params = new URLSearchParams({
    limit: String(Math.min(Math.max(Number(options.limit || 100), 1), 100)),
  });

  if (options.before) params.set("before", String(options.before));

  return discordRequest(
    `/channels/${encodeURIComponent(channelId)}/messages?${params.toString()}`,
    { method: "GET" }
  );
}

function getDiscordSnowflakeTimestamp(messageId) {
  try {
    return Number((BigInt(String(messageId)) >> 22n) + 1420070400000n);
  } catch {
    return null;
  }
}

function canBulkDeleteDiscordMessage(messageId) {
  const timestamp = getDiscordSnowflakeTimestamp(messageId);
  if (!timestamp) return false;

  const thirteenDaysMs = 13 * 24 * 60 * 60 * 1000;
  return Date.now() - timestamp < thirteenDaysMs;
}

async function bulkDeleteDiscordMessages(channelId, messageIds) {
  const ids = (messageIds || []).map(String).filter(Boolean);
  if (!ids.length) return { deleted: 0 };

  if (ids.length === 1) {
    const result = await deleteDiscordMessage(channelId, ids[0]);
    return { deleted: result?.deleted ? 1 : 0 };
  }

  await discordRequest(
    `/channels/${encodeURIComponent(channelId)}/messages/bulk-delete`,
    {
      method: "POST",
      body: { messages: ids.slice(0, 100) },
    }
  );

  return { deleted: ids.length };
}

async function markGuildReproRequestsDeleted(supabase, guild, metadata = {}) {
  const now = new Date().toISOString();
  const { data: activeRequests, error: readError } = await supabase
    .from(REPRO_REQUEST_TABLE)
    .select("id")
    .eq("guild", normalizeGuildCode(guild))
    .in("state", ["requested", "send_failed", "repro_active"]);

  if (readError) {
    if (isMissingReproRequestTable(readError)) {
      return { enabled: false, reason: "missing_gvg_discord_repro_requests_table" };
    }
    throw readError;
  }

  const requestIds = (activeRequests || []).map((row) => row.id).filter(Boolean);
  if (requestIds.length) {
    const { error: participantError } = await supabase
      .from(REPRO_PARTICIPANT_TABLE)
      .update({ state: "deleted", updated_at: now })
      .in("request_id", requestIds)
      .in("state", ["pending", "active"]);

    if (participantError && !isMissingReproWorkflowTable(participantError)) {
      throw participantError;
    }
  }

  const { error, count } = await supabase
    .from(REPRO_REQUEST_TABLE)
    .update({
      state: "deleted",
      discord_message_id: null,
      discord_response_message_id: null,
      last_error: null,
      updated_at: now,
    }, { count: "exact" })
    .eq("guild", normalizeGuildCode(guild))
    .in("state", ["requested", "send_failed", "repro_active"]);

  if (error) {
    if (isMissingReproRequestTable(error)) {
      return { enabled: false, reason: "missing_gvg_discord_repro_requests_table" };
    }
    throw error;
  }

  const { error: controlError } = await supabase
    .from(REPRO_CONTROL_TABLE)
    .update({ state: "deleted", discord_message_id: null, updated_at: now })
    .eq("guild", normalizeGuildCode(guild))
    .in("state", ["active", "send_failed"]);

  if (controlError && !isMissingReproWorkflowTable(controlError)) {
    throw controlError;
  }

  return {
    enabled: true,
    marked_rows: count || 0,
    ...metadata,
  };
}

async function logDiscordChannelPurge(supabase, metadata) {
  try {
    const { error } = await supabase.from("portal_activity_logs").insert({
      actor_name: "Discord repro",
      action_type: "gvg_discord_repro_channel_purge",
      entity_type: "discord_channel",
      entity_id: metadata?.discord_channel_id || null,
      summary: `Purge channel repro Discord (${metadata?.guild || "GVG"})`,
      metadata,
    });

    if (error) {
      console.warn("[discord-repro:channel-purge] activity log unavailable:", error.message);
    }
  } catch (error) {
    console.warn("[discord-repro:channel-purge] activity log failed:", error?.message || error);
  }
}

export async function purgeDiscordReproChannelForGuild(supabase, guild, options = {}) {
  const normalizedGuild = normalizeGuildCode(guild);
  const channelId = getDiscordReproChannelId(normalizedGuild);
  const source = options.source || "gvg-reset";
  const reason = options.reason || "gvg_reset";

  if (!channelId) {
    return { enabled: true, skipped: true, reason: "missing_repro_channel", guild: normalizedGuild };
  }

  if (!getDiscordBotToken()) {
    return { enabled: false, reason: "missing_discord_config", guild: normalizedGuild, channel_id: channelId };
  }

  const maxMessages = getDiscordPurgeMaxMessages();
  const errors = [];
  let before = null;
  let scannedMessages = 0;
  let deletedMessages = 0;
  let bulkDeletedMessages = 0;
  let singleDeletedMessages = 0;
  let remainingMessages = null;
  let remainingMessageIds = [];
  let verificationAttempts = 0;
  let channelEmptyConfirmed = false;

  while (scannedMessages < maxMessages) {
    const limit = Math.min(100, maxMessages - scannedMessages);
    const messages = await listDiscordChannelMessages(channelId, { before, limit });
    const page = Array.isArray(messages) ? messages : [];
    if (!page.length) break;

    scannedMessages += page.length;
    before = page[page.length - 1]?.id || before;

    const messageIds = page.map((message) => String(message?.id || "")).filter(Boolean);
    const bulkIds = messageIds.filter(canBulkDeleteDiscordMessage);
    const singleIds = messageIds.filter((id) => !canBulkDeleteDiscordMessage(id));

    for (let index = 0; index < bulkIds.length; index += 100) {
      const chunk = bulkIds.slice(index, index + 100);
      try {
        const result = await bulkDeleteDiscordMessages(channelId, chunk);
        const deleted = result?.deleted || 0;
        bulkDeletedMessages += deleted;
        deletedMessages += deleted;
      } catch (bulkError) {
        errors.push({ mode: "bulk", count: chunk.length, error: bulkError?.message || "bulk delete failed" });

        for (const messageId of chunk) {
          try {
            const result = await deleteDiscordMessage(channelId, messageId);
            if (result?.deleted) {
              singleDeletedMessages += 1;
              deletedMessages += 1;
            }
          } catch (singleError) {
            errors.push({ mode: "single_after_bulk", message_id: messageId, error: singleError?.message || "delete failed" });
          }
        }
      }
    }

    for (const messageId of singleIds) {
      try {
        const result = await deleteDiscordMessage(channelId, messageId);
        if (result?.deleted) {
          singleDeletedMessages += 1;
          deletedMessages += 1;
        }
      } catch (singleError) {
        errors.push({ mode: "single", message_id: messageId, error: singleError?.message || "delete failed" });
      }
    }

    if (page.length < 100) break;
    await sleep(350);
  }

  try {
    for (let attempt = 1; attempt <= DISCORD_PURGE_VERIFY_ATTEMPTS; attempt += 1) {
      verificationAttempts = attempt;
      if (attempt > 1) await sleep(DISCORD_PURGE_VERIFY_DELAY_MS);

      const remaining = await listDiscordChannelMessages(channelId, { limit: DISCORD_PURGE_VERIFY_LIMIT });
      const remainingPage = Array.isArray(remaining) ? remaining : [];
      remainingMessages = remainingPage.length;
      remainingMessageIds = remainingPage.map((message) => String(message?.id || "")).filter(Boolean);

      if (remainingMessages === 0) {
        channelEmptyConfirmed = true;
        break;
      }
    }
  } catch (verifyError) {
    remainingMessages = null;
    remainingMessageIds = [];
    channelEmptyConfirmed = false;
    errors.push({ mode: "verify_empty", error: verifyError?.message || "channel empty verification failed" });
  }

  let requestRowsUpdate = null;
  try {
    requestRowsUpdate = await markGuildReproRequestsDeleted(supabase, normalizedGuild, {
      reason,
      source,
    });
  } catch (error) {
    errors.push({ mode: "db_mark_deleted", error: error?.message || "db update failed" });
  }

  const result = {
    enabled: true,
    guild: normalizedGuild,
    channel_id: channelId,
    scanned_messages: scannedMessages,
    deleted_messages: deletedMessages,
    bulk_deleted_messages: bulkDeletedMessages,
    single_deleted_messages: singleDeletedMessages,
    max_messages: maxMessages,
    remaining_messages: remainingMessages,
    remaining_message_ids: remainingMessageIds,
    channel_empty_confirmed: channelEmptyConfirmed,
    verification_attempts: verificationAttempts,
    warnings: channelEmptyConfirmed ? errors : [],
    fatal_errors: channelEmptyConfirmed ? [] : errors,
    request_rows_update: requestRowsUpdate,
    errors,
  };

  await logDiscordChannelPurge(supabase, {
    guild: normalizedGuild,
    discord_channel_id: channelId,
    reason,
    source,
    ...result,
  });

  console.log(
    `[discord-repro:channel-purge] guild=${normalizedGuild} channel=${channelId} scanned=${scannedMessages} deleted=${deletedMessages} remaining=${remainingMessages} empty=${channelEmptyConfirmed} verify_attempts=${verificationAttempts} errors=${errors.length} remaining_ids=${remainingMessageIds.join(",") || "-"}`
  );

  return result;
}

function getRequestMessageIds(requestRow) {
  return [
    requestRow?.discord_message_id,
    requestRow?.discord_response_message_id,
    requestRow?.compatible_message_id,
  ]
    .filter(Boolean)
    .map((id) => String(id))
    .filter((id, index, list) => list.indexOf(id) === index);
}

async function logDiscordReproCleanup(supabase, { requestRow, reason, source, deletedMessages, deleteErrors, dm }) {
  const metadata = {
    reason,
    source,
    request_id: requestRow?.id || null,
    guild: requestRow?.guild || null,
    gvg_defense_id: requestRow?.gvg_defense_id || null,
    discord_channel_id: requestRow?.discord_channel_id || null,
    discord_message_id: requestRow?.discord_message_id || null,
    discord_response_message_id: requestRow?.discord_response_message_id || null,
    state_before: requestRow?.state || null,
    deleted_messages: deletedMessages,
    delete_errors: deleteErrors,
    dm,
  };

  try {
    const { error } = await supabase.from("portal_activity_logs").insert({
      actor_name: "Discord repro",
      action_type: "gvg_discord_repro_cleanup",
      entity_type: "gvg_defense",
      entity_id: requestRow?.gvg_defense_id || null,
      summary: `Nettoyage demande repro Discord (${reason})`,
      metadata,
    });

    if (error) {
      console.warn("[discord-repro:cleanup] activity log unavailable:", error.message);
    }
  } catch (error) {
    console.warn("[discord-repro:cleanup] activity log failed:", error?.message || error);
  }
}

async function cleanupDiscordMessagesForRequest(supabase, requestRow, options = {}) {
  const reason = options.reason || "unknown";
  const source = options.source || "unknown";
  const channelId =
    requestRow?.discord_channel_id ||
    options.channelId ||
    getDiscordReproChannelId(requestRow?.guild);
  const participantRows = await fetchActiveParticipants(supabase, requestRow.id).catch(() => []);
  const messageIds = [
    ...getRequestMessageIds(requestRow),
    ...participantRows.map((participant) => participant.ping_message_id),
  ]
    .filter(Boolean)
    .map((id) => String(id))
    .filter((id, index, list) => list.indexOf(id) === index);
  const deleteErrors = [];
  let deletedMessages = 0;

  for (const messageId of messageIds) {
    try {
      const result = await deleteDiscordMessage(channelId, messageId);
      if (result?.deleted) deletedMessages += 1;
    } catch (error) {
      const message = error?.message || "delete failed";
      deleteErrors.push({ message_id: messageId, error: message });
      console.error(`[discord-repro:cleanup] delete message error reason=${reason} message=${messageId}:`, error);
    }
  }

  const now = new Date().toISOString();
  const updatePayload = {
    updated_at: now,
    last_error: deleteErrors.length
      ? `cleanup ${reason}: ${deleteErrors.map((item) => item.error).join(" | ")}`.slice(0, 1000)
      : null,
  };

  if (options.nextState) updatePayload.state = options.nextState;
  if (options.markOpened) updatePayload.opened_at = now;

  const { error: updateError } = await supabase
    .from(REPRO_REQUEST_TABLE)
    .update(updatePayload)
    .eq("id", requestRow.id);

  if (updateError) {
    deleteErrors.push({ message_id: null, error: updateError.message || "db update failed" });
    console.error(`[discord-repro:cleanup] db update error reason=${reason} request=${requestRow.id}:`, updateError);
  }

  if (["opened", "deleted"].includes(String(options.nextState || ""))) {
    const { error: participantUpdateError } = await supabase
      .from(REPRO_PARTICIPANT_TABLE)
      .update({ state: "deleted", updated_at: now })
      .eq("request_id", requestRow.id)
      .in("state", ["pending", "active"]);

    if (participantUpdateError && !isMissingReproWorkflowTable(participantUpdateError)) {
      deleteErrors.push({ message_id: null, error: participantUpdateError.message || "participant cleanup failed" });
    }
  }

  await logDiscordReproCleanup(supabase, {
    requestRow,
    reason,
    source,
    deletedMessages,
    deleteErrors,
    dm: options.dm || null,
  });

  console.log(
    `[discord-repro:cleanup] reason=${reason} source=${source} request=${requestRow.id} defense=${requestRow.gvg_defense_id} messages=${deletedMessages}/${messageIds.length} errors=${deleteErrors.length}`
  );

  return {
    request_id: requestRow.id,
    gvg_defense_id: requestRow.gvg_defense_id,
    deleted_messages: deletedMessages,
    message_count: messageIds.length,
    errors: deleteErrors,
  };
}

export async function cleanupDiscordReproRequestForDefenseId(supabase, defenseId, options = {}) {
  if (!defenseId) return { skipped: true, reason: "missing_defense_id" };

  const { data: requestRow, error } = await supabase
    .from(REPRO_REQUEST_TABLE)
    .select("*")
    .eq("gvg_defense_id", defenseId)
    .maybeSingle();

  if (error) {
    if (isMissingReproRequestTable(error)) {
      return { enabled: false, reason: "missing_gvg_discord_repro_requests_table" };
    }
    throw error;
  }

  if (!requestRow) return { skipped: true, reason: "request_not_found" };

  let dm = null;
  if (options.notifyReproducer && requestRow.reproducer_discord_id) {
    try {
      dm = await sendDiscordDm(
        requestRow.reproducer_discord_id,
        "Ta repro est ouverte. Tu peux passer a une autre repro si tu veux."
      );
    } catch (dmError) {
      dm = { sent: false, error: dmError?.message || "dm failed" };
    }
  }

  const cleanup = await cleanupDiscordMessagesForRequest(supabase, requestRow, {
    reason: options.reason || "portal_panel_open",
    source: options.source || "portal",
    nextState: options.nextState || "opened",
    markOpened: options.markOpened !== false,
    dm,
  });

  return {
    enabled: true,
    ...cleanup,
    dm,
  };
}

export async function cleanupDiscordReproRequestsForDefenseIds(supabase, defenseIds) {
  const ids = (defenseIds || []).filter(Boolean);
  if (!ids.length) {
    return { enabled: true, deleted_messages: 0, deleted_rows: 0, marked_rows: 0 };
  }

  const { data, error } = await supabase
    .from(REPRO_REQUEST_TABLE)
    .select("*")
    .in("gvg_defense_id", ids);

  if (error) {
    if (isMissingReproRequestTable(error)) {
      return { enabled: false, reason: "missing_gvg_discord_repro_requests_table" };
    }
    throw error;
  }

  let deletedMessages = 0;
  const results = [];

  for (const row of data || []) {
    const result = await cleanupDiscordMessagesForRequest(supabase, row, {
      reason: "gvg_reset",
      source: "gvg-reset",
      nextState: "deleted",
      markOpened: false,
    });
    results.push(result);
    deletedMessages += result.deleted_messages || 0;
  }

  return {
    enabled: true,
    deleted_messages: deletedMessages,
    deleted_rows: 0,
    marked_rows: results.length,
    items: results,
  };
}

function normalizeChampionName(name) {
  if (!name) return "";
  return String(name)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\d+$/, "");
}

export function buildReproMessageText({
  watcherName,
  playerPb,
  enemyPb,
  heroLines,
  artifact,
}) {
  const safeWatcher = watcherName || "Joueur";
  const safePlayerPb = playerPb || "...";
  const safeEnemyPb = enemyPb || "...";
  const safeArtifact = artifact || "...";

  const heroText = (heroLines || [])
    .map((line, index) => {
      const heroName = line?.hero || `heros ${index + 1}`;
      const awakening =
        Number.isFinite(Number(line?.awakening)) && Number(line?.awakening) >= 0
          ? `A${Number(line.awakening)}`
          : "A?";
      const stuff = line?.stuff || "...";

      return `Heros ${index + 1} : ${heroName} ${awakening} stuff en : ${stuff}`;
    })
    .join("\n");

  return [
    `Repro sur ${safeWatcher}`,
    "",
    `Repro ${safePlayerPb} k PB / Adversaire ${safeEnemyPb} k PB`,
    "",
    heroText,
    "",
    `Artefact : ${safeArtifact}`,
  ].join("\n");
}

export async function buildReproTemplateData(supabase, { gvgDefenseId, memberId, watcherName }) {
  if (!gvgDefenseId) {
    const error = new Error("gvgDefenseId manquant");
    error.statusCode = 400;
    throw error;
  }

  if (!memberId) {
    const error = new Error("memberId manquant");
    error.statusCode = 400;
    throw error;
  }

  const { data: defense, error: defenseError } = await supabase
    .from("gvg_defense")
    .select("id, heroes")
    .eq("id", gvgDefenseId)
    .maybeSingle();

  if (defenseError) throw defenseError;
  if (!defense) {
    const error = new Error("defense introuvable");
    error.statusCode = 404;
    throw error;
  }

  const heroes = Array.isArray(defense.heroes) ? defense.heroes : [];
  const normalizedHeroNames = heroes
    .map((hero) => normalizeChampionName(hero?.champion || hero?.name))
    .filter(Boolean);

  const { data: awakenings, error: awakeningsError } = await supabase
    .from("member_awakenings")
    .select(`
      awakening_level,
      champions (
        name
      )
    `)
    .eq("member_id", memberId);

  if (awakeningsError) throw awakeningsError;

  const awakeningMap = new Map();
  for (const row of awakenings || []) {
    const heroName = normalizeChampionName(row?.champions?.name || "");
    if (!heroName) continue;
    awakeningMap.set(heroName, Number(row?.awakening_level ?? -1));
  }

  const heroLines = normalizedHeroNames.map((heroName, index) => ({
    slot: index + 1,
    hero: heroName,
    awakening: awakeningMap.has(heroName) ? awakeningMap.get(heroName) : -1,
    stuff: "",
  }));

  return {
    watcherName: watcherName || "Joueur",
    gvgDefenseId,
    heroLines,
  };
}

export async function saveReproSubmission(
  supabase,
  { gvgDefenseId, memberId, watcherName, playerPb, enemyPb, heroLines, artifact }
) {
  if (!gvgDefenseId) {
    const error = new Error("gvgDefenseId manquant");
    error.statusCode = 400;
    throw error;
  }

  if (!watcherName) {
    const error = new Error("watcherName manquant");
    error.statusCode = 400;
    throw error;
  }

  if (!Array.isArray(heroLines) || heroLines.length !== 5) {
    const error = new Error("heroLines invalide");
    error.statusCode = 400;
    throw error;
  }

  const messageText = buildReproMessageText({
    watcherName,
    playerPb,
    enemyPb,
    heroLines,
    artifact,
  });

  const payloadBase = {
    member_id: memberId || null,
    watcher_name: watcherName,
    player_pb: playerPb || null,
    enemy_pb: enemyPb || null,
    stuff_1: heroLines[0]?.stuff || null,
    stuff_2: heroLines[1]?.stuff || null,
    stuff_3: heroLines[2]?.stuff || null,
    stuff_4: heroLines[3]?.stuff || null,
    stuff_5: heroLines[4]?.stuff || null,
    artifact: artifact || null,
    message_text: messageText,
    updated_at: new Date().toISOString(),
  };

  const { data: targetDefense, error: targetError } = await supabase
    .from("gvg_defense")
    .select("id, guild, is_ally, heroes, status")
    .eq("id", gvgDefenseId)
    .maybeSingle();

  if (targetError) throw targetError;
  if (!targetDefense) {
    const error = new Error("defense introuvable");
    error.statusCode = 404;
    throw error;
  }

  const targetIds = await findMatchingReproDefenseIds(supabase, targetDefense);
  const payload = targetIds.map((targetId) => ({
    ...payloadBase,
    gvg_defense_id: targetId,
  }));

  const { data, error } = await supabase
    .from("gvg_repro")
    .upsert(payload, { onConflict: "gvg_defense_id" })
    .select("id, gvg_defense_id, watcher_name, message_text");

  if (error) throw error;

  return (
    (data || []).find((row) => String(row.gvg_defense_id) === String(gvgDefenseId)) ||
    (data || [])[0] ||
    null
  );
}

export async function getDiscordReproRequestById(supabase, requestId) {
  const { data, error } = await supabase
    .from(REPRO_REQUEST_TABLE)
    .select("*")
    .eq("id", requestId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function resolveMemberByDiscordUser(supabase, user) {
  const discordId = String(user?.id || "").trim();
  if (!discordId) return null;

  const { data, error } = await supabase
    .from("guild_members")
    .select("id, watcher_name, discord_id, guild_code, role")
    .eq("discord_id", discordId)
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) throw error;
  const rows = data || [];
  return (
    rows.find((member) => isLeaderRole(member.role)) ||
    rows.find((member) => isAdminRole(member.role)) ||
    rows[0] ||
    null
  );
}

async function resolveMemberByDiscordUserForGuild(supabase, user, guild) {
  const discordId = String(user?.id || "").trim();
  const normalizedGuild = normalizeGuildCode(guild);
  if (!discordId || !normalizedGuild) return null;

  const { data, error } = await supabase
    .from("guild_members")
    .select("id, watcher_name, discord_id, guild_code, role")
    .eq("discord_id", discordId)
    .limit(50);

  if (error) throw error;

  const rows = (data || []).filter((member) => normalizeGuildCode(member.guild_code) === normalizedGuild);
  return (
    rows.find((member) => isLeaderRole(member.role)) ||
    rows.find((member) => isAdminRole(member.role)) ||
    rows[0] ||
    null
  );
}

async function loadGvgDefenseById(supabase, defenseId) {
  const { data, error } = await supabase
    .from("gvg_defense")
    .select("id, guild, bastion, type, tower, team, raw_name, heroes, image_url, status, repro_by, record_status, is_ally")
    .eq("id", defenseId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function loadGvgDefenseByWizard(supabase, { guild, bastion, location, team }) {
  const normalizedGuild = normalizeGuildCode(guild);
  const parsedLocation = parseWizardLocation(location);
  if (!normalizedGuild || !parsedLocation || !bastion || !team) return null;

  let query = supabase
    .from("gvg_defense")
    .select("id, guild, bastion, type, tower, team, raw_name, heroes, image_url, status, repro_by, record_status, is_ally")
    .eq("guild", normalizedGuild)
    .eq("bastion", Number(bastion))
    .eq("team", Number(team))
    .eq("type", parsedLocation.type)
    .or("is_ally.is.false,is_ally.is.null")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (parsedLocation.type === "tower") {
    query = query.eq("tower", parsedLocation.tower);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data?.[0] || null;
}

async function getActiveRequestForDefense(supabase, defenseId) {
  const { data, error } = await supabase
    .from(REPRO_REQUEST_TABLE)
    .select("*")
    .eq("gvg_defense_id", defenseId)
    .in("state", ["requested", "repro_active"])
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function buildJumpUrl(interaction, requestRow) {
  const guildId = String(interaction?.guild_id || "@me").trim() || "@me";
  if (!requestRow?.discord_channel_id || !requestRow?.discord_message_id) return "";
  return `https://discord.com/channels/${guildId}/${requestRow.discord_channel_id}/${requestRow.discord_message_id}`;
}

function parseConditionsModalValues(components) {
  const values = flattenModalValues(components);
  const minAwakenings = {};
  for (let index = 0; index < 5; index += 1) {
    const parsed = parseAwakeningInput(values[`hero_${index + 1}`]);
    if (parsed !== null) minAwakenings[String(index)] = parsed;
  }
  return minAwakenings;
}

async function fetchChampionIdsForDefense(supabase, defense) {
  const heroes = Array.isArray(defense?.heroes) ? defense.heroes.slice(0, 5) : [];
  const heroNames = heroes.map((hero) => getHeroDisplayName(hero, 0)).filter(Boolean);
  if (!heroNames.length) return [];

  const { data, error } = await supabase
    .from("champions")
    .select("id, name")
    .in("name", heroNames);

  if (error) throw error;

  const byName = new Map((data || []).map((row) => [normalizeGvgDefenseChampionName(row.name), row]));
  return heroes.map((hero, index) => {
    const name = getHeroDisplayName(hero, index);
    const champion = byName.get(normalizeGvgDefenseChampionName(name));
    return {
      index,
      champion_id: champion?.id ? String(champion.id) : null,
      champion_name: name,
    };
  });
}

async function fetchMemberAwakeningsForHeroes(supabase, memberIds, heroRows) {
  const championIds = heroRows.map((hero) => hero.champion_id).filter(Boolean);
  if (!memberIds.length || !championIds.length) return new Map();

  const { data, error } = await supabase
    .from("member_awakenings")
    .select("member_id, champion_id, awakening_level")
    .in("member_id", memberIds)
    .in("champion_id", championIds);

  if (error) throw error;

  const byMember = new Map();
  for (const row of data || []) {
    const memberKey = String(row.member_id);
    const championKey = String(row.champion_id);
    if (!byMember.has(memberKey)) byMember.set(memberKey, new Map());
    byMember.get(memberKey).set(championKey, Number(row.awakening_level ?? -1));
  }
  return byMember;
}

function evaluateAwakeningCompliance(heroRows, memberAwakenings, minAwakenings = {}) {
  return heroRows.map((hero) => {
    const actual = hero.champion_id && memberAwakenings.has(hero.champion_id)
      ? Number(memberAwakenings.get(hero.champion_id))
      : -1;
    const min = Number(minAwakenings?.[hero.index] ?? minAwakenings?.[String(hero.index)] ?? -1);
    const hasHero = actual >= 0;
    const minOk = !Number.isFinite(min) || min < 0 || actual >= min;
    return {
      ...hero,
      awakening: actual,
      minAwakening: Number.isFinite(min) && min >= 0 ? min : null,
      hasHero,
      minOk,
      ok: hasHero && minOk,
    };
  });
}

async function fetchActiveParticipants(supabase, requestId) {
  const { data, error } = await supabase
    .from(REPRO_PARTICIPANT_TABLE)
    .select("*")
    .eq("request_id", requestId)
    .eq("state", "active")
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function fetchRequestDefense(supabase, requestRow) {
  return loadGvgDefenseById(supabase, requestRow?.gvg_defense_id);
}

function buildHeroPreviewEmbed(hero, index, minAwakenings = {}) {
  const name = getHeroDisplayName(hero, index);
  const position = normalizeGvgDefensePosition(hero?.position) || "?";
  const direction = normalizeGvgDefenseDirection(hero?.direction) || "?";
  const min = Number(minAwakenings?.[index] ?? minAwakenings?.[String(index)] ?? -1);
  const minimum = Number.isFinite(min) && min >= 0 ? `Min A${min}` : "Aucun minimum";
  const heroUrl = buildPublicHeroUrl(slugHeroFileName(name));
  const embed = {
    title: `${index + 1}. ${name}`,
    description: `${position} ${direction} · ${minimum}`,
    color: 0x0ea5e9,
  };
  if (heroUrl) embed.thumbnail = { url: heroUrl };
  return embed;
}

function buildParticipantPreviewEmbed(participant) {
  const warning = participant.warning_active
    ? "⚠️ **Attention : certains eveils minimum demandes ne sont pas respectes.**\n"
    : "";
  const comment = String(participant.comment || "").trim();
  return {
    author: {
      name: `Reproduction - ${participant.display_name}`,
      icon_url: participant.discord_avatar_url || buildDiscordUserAvatarUrl({ id: participant.discord_user_id }),
    },
    description: truncateDiscordText(`${warning}${comment ? `Commentaire :\n${comment}` : "Commentaire : -"}`),
    color: 0x3b82f6,
  };
}

function buildReproRequestMessagePayload(defense, requestRow, participants = []) {
  const minAwakenings = normalizeMinAwakenings(requestRow?.min_awakenings);
  const heroes = Array.isArray(defense?.heroes) ? defense.heroes.slice(0, 5) : [];
  const statusText = participants.length ? "🔵 Reproduction en cours" : "🟠 En attente de reproduction";
  const imageUrl = resolveDiscordImageUrl(defense?.image_url);
  const heroEmbeds = heroes.map((hero, index) => buildHeroPreviewEmbed(hero, index, minAwakenings));
  const maxParticipantEmbeds = Math.max(0, MAX_DISCORD_EMBEDS - 1 - heroEmbeds.length);
  const participantEmbeds = participants
    .slice(0, maxParticipantEmbeds)
    .map((participant) => buildParticipantPreviewEmbed(participant));
  const hiddenParticipants = participants.slice(maxParticipantEmbeds);

  const fields = [
    {
      name: "Position",
      value: `${formatDefenseTitle(defense)}\nType : ${getDefenseKindLabel(defense)}`,
      inline: false,
    },
    {
      name: "Demandeur",
      value: requestRow?.requester_discord_id
        ? `<@${requestRow.requester_discord_id}>`
        : requestRow?.requester_name || "Inconnu",
      inline: true,
    },
    {
      name: "Heros",
      value: truncateDiscordText(heroes.map((hero, index) => getHeroLine(hero, index, minAwakenings)).join("\n") || "Aucun heros"),
      inline: false,
    },
  ];

  if (requestRow?.conditions_updated) {
    fields.push({ name: "Conditions", value: "Conditions mises a jour", inline: false });
  }

  if (hiddenParticipants.length) {
    fields.push({
      name: "Autres reproducteurs",
      value: truncateDiscordText(hiddenParticipants.map((participant) => `- ${participant.display_name}`).join("\n")),
      inline: false,
    });
  }

  const embed = {
    title: "📌 DEMANDE DE REPRO ACTIVE",
    description: [`GVG - ${normalizeGuildCode(defense?.guild).replace("_", " ")}`, "", `STATUT : ${statusText}`].join("\n"),
    color: participants.length ? 0x3b82f6 : 0xf97316,
    fields,
  };

  if (imageUrl) embed.thumbnail = { url: imageUrl };

  return {
    content: "",
    embeds: [embed, ...heroEmbeds, ...participantEmbeds].slice(0, MAX_DISCORD_EMBEDS),
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 1, custom_id: `gvg_repro_take:${requestRow.id}`, label: "Je la repro" },
          { type: 2, style: 3, custom_id: `gvg_repro_open:${requestRow.id}`, label: "C'est ouvert" },
          { type: 2, style: 2, custom_id: `gvg_repro_conditions:${requestRow.id}`, label: "Modifier conditions" },
          { type: 2, style: 4, custom_id: `gvg_repro_cancel_request:${requestRow.id}`, label: "Annuler demande" },
        ],
      },
      {
        type: 1,
        components: [
          { type: 2, style: 2, custom_id: `gvg_repro_cancel_mine:${requestRow.id}`, label: "Annuler ma repro" },
          { type: 2, style: 2, custom_id: `gvg_repro_cleanup_public:${requestRow.id}`, label: "Nettoyer annonces" },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

async function updateReproRequestMessage(supabase, requestRow, defense = null) {
  const loadedDefense = defense || (await fetchRequestDefense(supabase, requestRow));
  if (!loadedDefense || !requestRow?.discord_channel_id || !requestRow?.discord_message_id) return { skipped: true };
  const participants = await fetchActiveParticipants(supabase, requestRow.id);
  const displayParticipants = await enrichParticipantsForDiscordDisplay(participants);
  const payload = buildReproRequestMessagePayload(loadedDefense, requestRow, displayParticipants);
  await discordRequest(
    `/channels/${encodeURIComponent(requestRow.discord_channel_id)}/messages/${encodeURIComponent(requestRow.discord_message_id)}`,
    { method: "PATCH", body: payload },
    { ignoreNotFound: true }
  );
  return { updated: true, participants: participants.length };
}

async function postGuildReproAnnouncementMessage(supabase, requestRow, defense) {
  const previousMessageId = requestRow?.compatible_message_id;
  if (previousMessageId) {
    await deleteDiscordMessage(requestRow.discord_channel_id, previousMessageId).catch((error) => {
      console.warn("[discord-repro] announcement cleanup failed:", error?.message || error);
    });
  }

  const roleId = getDiscordReproRoleId(requestRow.guild);
  const roleMention = roleId ? `<@&${roleId}>` : `@${normalizeGuildCode(requestRow.guild).replace("_", " ")}`;
  const content = [
    roleMention,
    "",
    `🔔 Nouvelle demande de reproduction : ${formatDefenseShortTitle(defense)}.`,
    "",
    "La fiche contient la composition et les conditions d'eveil demandees.",
  ].join("\n");

  const message = await discordRequest(`/channels/${encodeURIComponent(requestRow.discord_channel_id)}/messages`, {
    method: "POST",
    body: {
      content,
      message_reference: { message_id: requestRow.discord_message_id, fail_if_not_exists: false },
      allowed_mentions: roleId ? { roles: [roleId] } : { parse: [] },
    },
  });

  await supabase
    .from(REPRO_REQUEST_TABLE)
    .update({
      compatible_message_id: message?.id || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestRow.id);

  return message?.id || null;
}

async function syncDashboardReproState(supabase, requestRow) {
  const participants = await fetchActiveParticipants(supabase, requestRow.id);
  const names = participants.map((participant) => participant.display_name).filter(Boolean);
  const now = new Date().toISOString();
  if (names.length) {
    await markMatchingGvgDefensesAsRepro(supabase, {
      defenseId: requestRow.gvg_defense_id,
      reproBy: names.join(", ").slice(0, 200),
      updatedAt: now,
    });
  } else {
    await supabase
      .from("gvg_defense")
      .update({ status: "def", repro_by: null, updated_at: now })
      .eq("id", requestRow.gvg_defense_id);
  }
}

async function createDiscordReproRequest(supabase, { defense, member, user, minAwakenings, interaction, trace }) {
  const normalizedGuild = normalizeGuildCode(defense?.guild);
  const channelId = getDiscordReproChannelId(normalizedGuild);
  if (!channelId) {
    const error = new Error("Aucun salon repro configure pour cette guilde.");
    error.statusCode = 400;
    throw error;
  }

  const activeRequest = await getActiveRequestForDefense(supabase, defense.id);
  if (activeRequest?.discord_message_id) {
    return { alreadyActive: true, request: activeRequest };
  }

  if (defense.record_status) {
    await supabase
      .from("gvg_defense")
      .update({ record_status: null, updated_at: new Date().toISOString() })
      .eq("id", defense.id);
    defense = { ...defense, record_status: null };
  }

  const now = new Date().toISOString();
  let requestRow = activeRequest;
  trace?.stage("database creation start", { defense_id: defense.id, reused_request: Boolean(requestRow) });
  if (!requestRow) {
    const { data, error } = await supabase
      .from(REPRO_REQUEST_TABLE)
      .insert({
        guild: normalizedGuild,
        gvg_defense_id: defense.id,
        discord_channel_id: channelId,
        requester_member_id: member.id,
        requester_discord_id: String(user?.id || "").trim() || null,
        requester_name: member.watcher_name || user?.username || "Joueur",
        min_awakenings: minAwakenings || {},
        state: "requested",
        updated_at: now,
      })
      .select("*")
      .maybeSingle();

    if (error && isAlreadyExistsError(error)) {
      requestRow = await getActiveRequestForDefense(supabase, defense.id);
    } else if (error) {
      throw error;
    } else {
      requestRow = data;
    }
  } else {
    const { data, error } = await supabase
      .from(REPRO_REQUEST_TABLE)
      .update({
        discord_channel_id: channelId,
        requester_member_id: member.id,
        requester_discord_id: String(user?.id || "").trim() || null,
        requester_name: member.watcher_name || user?.username || "Joueur",
        min_awakenings: minAwakenings || {},
        state: "requested",
        opened_at: null,
        conditions_updated: false,
        updated_at: now,
      })
      .eq("id", requestRow.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    requestRow = data;
  }
  trace?.stage("database creation ok", { request_id: requestRow?.id || null });

  let message = null;
  try {
    trace?.stage("heroes rendering start", {
      request_id: requestRow?.id || null,
      hero_count: Array.isArray(defense?.heroes) ? defense.heroes.slice(0, 5).length : 0,
    });
    const payload = buildReproRequestMessagePayload(defense, requestRow, []);
    trace?.stage("heroes rendering ok", {
      request_id: requestRow?.id || null,
      embeds: Array.isArray(payload.embeds) ? payload.embeds.length : 0,
    });

    trace?.stage("discord message creation start", { request_id: requestRow?.id || null, channel_id: channelId });
    message = await discordRequest(`/channels/${encodeURIComponent(channelId)}/messages`, {
      method: "POST",
      body: payload,
    });
    trace?.stage("discord message creation ok", {
      request_id: requestRow?.id || null,
      message_id: message?.id || null,
    });

    trace?.stage("message ids persistence start", { request_id: requestRow?.id || null });
    const { data: updated, error: updateError } = await supabase
      .from(REPRO_REQUEST_TABLE)
      .update({
        discord_message_id: message?.id || null,
        discord_response_message_id: null,
        state: "requested",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestRow.id)
      .select("*")
      .maybeSingle();
    if (updateError) throw updateError;
    trace?.stage("message ids persistence ok", { request_id: updated?.id || null });

    trace?.stage("guild role ping start", { request_id: updated?.id || null, role_configured: Boolean(getDiscordReproRoleId(updated?.guild)) });
    await postGuildReproAnnouncementMessage(supabase, updated, defense);
    trace?.stage("guild role ping ok", { request_id: updated?.id || null });
    trace?.stage("persistence finalized", { request_id: updated?.id || null });
    return { request: updated, interaction };
  } catch (error) {
    console.error(`[discord-repro:create] request=${requestRow?.id || "?"} defense=${defense?.id || "?"}`, error);
    if (message?.id) {
      await deleteDiscordMessage(channelId, message.id).catch((deleteError) => {
        console.warn("[discord-repro:create] rollback message delete failed:", deleteError?.message || deleteError);
      });
    }
    if (requestRow?.id) {
      try {
        await supabase
          .from(REPRO_REQUEST_TABLE)
          .update({
            state: "deleted",
            discord_message_id: null,
            compatible_message_id: null,
            last_error: error?.message || "creation failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", requestRow.id);
      } catch (rollbackError) {
        console.warn("[discord-repro:create] rollback db update failed:", rollbackError?.message || rollbackError);
      }
    }
    throw error;
  }
}

function textInput(customId, label, value, options = {}) {
  return {
    type: 1,
    components: [
      {
        type: 4,
        custom_id: customId,
        label,
        style: options.style || 2,
        required: options.required !== false,
        min_length: 0,
        max_length: options.maxLength || 1000,
        value: value || "",
        placeholder: options.placeholder || "",
      },
    ],
  };
}

function formatHeroStuffLine(line, index) {
  const awakening =
    Number.isFinite(Number(line?.awakening)) && Number(line.awakening) >= 0
      ? `A${Number(line.awakening)}`
      : "A?";
  return `${index + 1}. ${line?.hero || `heros ${index + 1}`} ${awakening} : `;
}

export function buildDiscordReproModal(requestRow, member, template) {
  const heroLines = Array.isArray(template?.heroLines) ? template.heroLines : [];
  const firstHeroBlock = heroLines
    .slice(0, 3)
    .map((line, index) => formatHeroStuffLine(line, index))
    .join("\n");
  const secondHeroBlock = heroLines
    .slice(3, 5)
    .map((line, index) => formatHeroStuffLine(line, index + 3))
    .join("\n");

  return {
    type: 9,
    data: {
      custom_id: `gvg_repro_submit:${requestRow.id}`,
      title: "Repro GVG",
      components: [
        textInput("pb_block", "PB repro / adversaire", "Repro k PB : \nAdversaire k PB : ", {
          maxLength: 300,
        }),
        textInput("stuff_1_3", "Stuff heros 1 a 3", firstHeroBlock, {
          maxLength: 1200,
        }),
        textInput("stuff_4_5", "Stuff heros 4 a 5", secondHeroBlock, {
          maxLength: 900,
          required: false,
        }),
        textInput("artifact", "Artefact", "", {
          style: 1,
          maxLength: 200,
        }),
        textInput("note", "Note optionnelle", `Repro sur ${member?.watcher_name || "Joueur"}`, {
          maxLength: 500,
          required: false,
        }),
      ],
    },
  };
}

function buildJoinReproModal(requestRow, existingParticipant = null) {
  return {
    type: 9,
    data: {
      custom_id: `gvg_repro_join:${requestRow.id}`,
      title: "Je la repro",
      components: [
        textInput(
          "comment",
          "Commentaire optionnel",
          existingParticipant?.comment || "",
          {
            required: false,
            maxLength: 900,
            placeholder: "Precision libre pour les autres joueurs",
          }
        ),
      ],
    },
  };
}

async function loadParticipantForMember(supabase, requestId, memberId) {
  const { data, error } = await supabase
    .from(REPRO_PARTICIPANT_TABLE)
    .select("*")
    .eq("request_id", requestId)
    .eq("member_id", memberId)
    .in("state", ["pending", "active"])
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function evaluateMemberForRequest(supabase, requestRow, member) {
  const defense = await fetchRequestDefense(supabase, requestRow);
  const heroRows = await fetchChampionIdsForDefense(supabase, defense);
  const awakeningsByMember = await fetchMemberAwakeningsForHeroes(supabase, [member.id], heroRows);
  const status = evaluateAwakeningCompliance(
    heroRows,
    awakeningsByMember.get(String(member.id)) || new Map(),
    normalizeMinAwakenings(requestRow?.min_awakenings)
  );
  return {
    defense,
    status,
    warningActive: !status.every((hero) => hero.ok),
  };
}

async function activateParticipant(supabase, participantId) {
  const { data: participant, error } = await supabase
    .from(REPRO_PARTICIPANT_TABLE)
    .select("*")
    .eq("id", participantId)
    .maybeSingle();
  if (error) throw error;
  if (!participant) throw new Error("reproduction introuvable");

  const requestRow = await getDiscordReproRequestById(supabase, participant.request_id);
  if (!requestRow) throw new Error("demande de repro introuvable");

  const defense = await fetchRequestDefense(supabase, requestRow);

  const { data: updated, error: updateError } = await supabase
    .from(REPRO_PARTICIPANT_TABLE)
    .update({
      state: "active",
      ping_message_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", participant.id)
    .select("*")
    .maybeSingle();
  if (updateError) throw updateError;

  await supabase
    .from(REPRO_REQUEST_TABLE)
    .update({
      state: "repro_active",
      reproducer_member_id: updated.member_id,
      reproducer_discord_id: updated.discord_user_id,
      reproducer_name: updated.display_name,
      repro_submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestRow.id);

  const refreshedRequest = await getDiscordReproRequestById(supabase, requestRow.id);
  await syncDashboardReproState(supabase, refreshedRequest);
  await updateReproRequestMessage(supabase, refreshedRequest, defense);

  if (requestRow.requester_discord_id && requestRow.requester_discord_id !== updated.discord_user_id) {
    await sendDiscordDm(
      requestRow.requester_discord_id,
      `${updated.display_name} vient de prendre ta demande de repro ${formatDefenseShortTitle(defense)}.`
    ).catch((dmError) => {
      console.warn("[discord-repro] requester DM failed:", dmError?.message || dmError);
    });
  }

  return updated;
}

async function saveParticipantFromModal(supabase, { requestId, user, modalComponents }) {
  const requestRow = await getDiscordReproRequestById(supabase, requestId);
  if (!requestRow) throw new Error("demande de repro introuvable");
  if (!["requested", "repro_active", "send_failed"].includes(String(requestRow.state || ""))) {
    throw new Error("cette demande n'est plus active");
  }

  const member = await resolveMemberByDiscordUserForGuild(supabase, user, requestRow.guild);
  if (!member) {
    const error = new Error("Ton compte Discord n'est pas lie au dashboard pour cette guilde.");
    error.statusCode = 403;
    throw error;
  }

  const values = flattenModalValues(modalComponents);
  const comment = String(values.comment || "").trim();
  const evaluation = await evaluateMemberForRequest(supabase, requestRow, member);
  const existing = await loadParticipantForMember(supabase, requestRow.id, member.id);
  const payload = {
    request_id: requestRow.id,
    member_id: member.id,
    discord_user_id: String(user?.id || "").trim(),
    display_name: member.watcher_name || user?.username || "Joueur",
    comment,
    warning_active: evaluation.warningActive,
    state: evaluation.warningActive ? "pending" : "active",
    updated_at: new Date().toISOString(),
  };

  let participant = existing;
  if (existing) {
    const { data, error } = await supabase
      .from(REPRO_PARTICIPANT_TABLE)
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    participant = data;
  } else {
    const { data, error } = await supabase
      .from(REPRO_PARTICIPANT_TABLE)
      .insert(payload)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    participant = data;
  }

  if (evaluation.warningActive) {
    return { pending: true, participant, request: requestRow };
  }

  const activeParticipant = await activateParticipant(supabase, participant.id);
  return { pending: false, participant: activeParticipant, request: requestRow };
}

async function cancelParticipant(supabase, requestRow, member, options = {}) {
  const participant = await loadParticipantForMember(supabase, requestRow.id, member.id);
  if (!participant || participant.state !== "active") {
    throw new Error("aucune reproduction active a annuler");
  }

  if (participant.ping_message_id) {
    await deleteDiscordMessage(requestRow.discord_channel_id, participant.ping_message_id).catch((error) => {
      console.warn("[discord-repro] ping cleanup failed:", error?.message || error);
    });
  }

  await supabase
    .from(REPRO_PARTICIPANT_TABLE)
    .update({ state: "cancelled", ping_message_id: null, updated_at: new Date().toISOString() })
    .eq("id", participant.id);

  const activeParticipants = await fetchActiveParticipants(supabase, requestRow.id);
  const nextState = activeParticipants.length ? "repro_active" : "requested";
  await supabase
    .from(REPRO_REQUEST_TABLE)
    .update({
      state: nextState,
      reproducer_member_id: activeParticipants[0]?.member_id || null,
      reproducer_discord_id: activeParticipants[0]?.discord_user_id || null,
      reproducer_name: activeParticipants[0]?.display_name || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestRow.id);

  const refreshedRequest = await getDiscordReproRequestById(supabase, requestRow.id);
  const defense = await fetchRequestDefense(supabase, refreshedRequest);
  await syncDashboardReproState(supabase, refreshedRequest);
  await updateReproRequestMessage(supabase, refreshedRequest, defense);

  if (requestRow.requester_discord_id && !options.silentRequesterDm) {
    await sendDiscordDm(
      requestRow.requester_discord_id,
      `${participant.display_name} a annule sa reproduction de ${formatDefenseShortTitle(defense)}.`
    ).catch((dmError) => {
      console.warn("[discord-repro] requester cancel DM failed:", dmError?.message || dmError);
    });
  }

  return participant;
}

async function closeRequestAsOpened(supabase, requestRow, user) {
  const member = await resolveMemberByDiscordUserForGuild(supabase, user, requestRow.guild);
  if (!member) throw new Error("Ton compte Discord n'est pas lie au dashboard pour cette guilde.");

  const defense = await fetchRequestDefense(supabase, requestRow);
  const participants = await fetchActiveParticipants(supabase, requestRow.id);
  const opened = await openDefenseInPanel(supabase, requestRow.gvg_defense_id);

  for (const participant of participants) {
    await sendDiscordDm(
      participant.discord_user_id,
      `✅ La defense que tu reproduisais a ete ouverte.\n\nTu peux passer sur une autre demande de reproduction si tu le souhaites.\n\n👉 https://discord.com/channels/${user?.guild_id || "@me"}/${requestRow.discord_channel_id}`
    ).catch((dmError) => {
      console.warn("[discord-repro] participant opened DM failed:", dmError?.message || dmError);
    });
  }

  if (requestRow.requester_discord_id) {
    await sendDiscordDm(
      requestRow.requester_discord_id,
      `Ta demande de repro ${formatDefenseShortTitle(defense)} a ete ouverte.`
    ).catch((dmError) => {
      console.warn("[discord-repro] requester opened DM failed:", dmError?.message || dmError);
    });
  }

  await supabase
    .from(REPRO_PARTICIPANT_TABLE)
    .update({ state: "deleted", updated_at: new Date().toISOString() })
    .eq("request_id", requestRow.id)
    .eq("state", "active");

  const cleanup = await cleanupDiscordMessagesForRequest(supabase, requestRow, {
    reason: "discord_open_button",
    source: "discord_interaction",
    nextState: "opened",
    markOpened: true,
  });

  return { opened, cleanup };
}

function isRequestManager(member, requestRow) {
  if (!member) return false;
  if (isAdminRole(member.role)) return true;
  return String(member.id) === String(requestRow?.requester_member_id);
}

function canCancelEmptyRequest(member, requestRow) {
  return isRequestManager(member, requestRow) || isOfficerRole(member?.role);
}

async function cancelRequest(supabase, requestRow, user, options = {}) {
  const member = await resolveMemberByDiscordUserForGuild(supabase, user, requestRow.guild);
  if (!member) throw new Error("Ton compte Discord n'est pas lie au dashboard pour cette guilde.");

  const activeParticipants = await fetchActiveParticipants(supabase, requestRow.id);
  const hasActive = activeParticipants.length > 0;
  const isAdmin = isAdminRole(member.role);

  if (hasActive && !isAdmin) {
    throw new Error("Seul un admin peut supprimer une demande avec reproduction active.");
  }

  if (!hasActive && !canCancelEmptyRequest(member, requestRow)) {
    throw new Error("Seul le createur, un officier ou un admin peut annuler cette demande.");
  }

  const defense = await fetchRequestDefense(supabase, requestRow);
  for (const participant of activeParticipants) {
    if (isAdmin && options.forced) {
      await sendDiscordDm(
        participant.discord_user_id,
        `⚠️ La demande de reproduction sur laquelle tu travaillais a ete supprimee par un administrateur.\n\nTu peux choisir une autre reproduction ici :\n\n👉 https://discord.com/channels/${user?.guild_id || "@me"}/${requestRow.discord_channel_id}`
      ).catch((dmError) => {
        console.warn("[discord-repro] forced delete DM failed:", dmError?.message || dmError);
      });
    }
  }

  await supabase
    .from(REPRO_PARTICIPANT_TABLE)
    .update({ state: "deleted", updated_at: new Date().toISOString() })
    .eq("request_id", requestRow.id)
    .in("state", ["pending", "active"]);

  await syncDashboardReproState(supabase, requestRow);

  const cleanup = await cleanupDiscordMessagesForRequest(supabase, requestRow, {
    reason: isAdmin && options.forced ? "discord_admin_force_delete" : "discord_request_cancel",
    source: "discord_interaction",
    nextState: "deleted",
  });

  return { defense, cleanup };
}

async function cleanupStoredPublicMessagesForRequest(supabase, requestRow, user) {
  const member = await resolveMemberByDiscordUserForGuild(supabase, user, requestRow.guild);
  if (!isAdminRole(member?.role)) {
    throw new Error("Seul un admin peut nettoyer les annonces publiques.");
  }

  const { data: participantRows, error } = await supabase
    .from(REPRO_PARTICIPANT_TABLE)
    .select("id, ping_message_id")
    .eq("request_id", requestRow.id)
    .not("ping_message_id", "is", null);
  if (error && !isMissingReproWorkflowTable(error)) throw error;

  const messageIds = [
    requestRow.compatible_message_id,
    ...(participantRows || []).map((row) => row.ping_message_id),
  ].filter(Boolean);

  const deleted = [];
  const failed = [];
  for (const messageId of messageIds) {
    try {
      await deleteDiscordMessage(requestRow.discord_channel_id, messageId);
      deleted.push(messageId);
    } catch (deleteError) {
      failed.push({ message_id: messageId, error: deleteError?.message || "delete failed" });
    }
  }

  await supabase
    .from(REPRO_REQUEST_TABLE)
    .update({ compatible_message_id: null, updated_at: new Date().toISOString() })
    .eq("id", requestRow.id);

  if ((participantRows || []).length) {
    await supabase
      .from(REPRO_PARTICIPANT_TABLE)
      .update({ ping_message_id: null, updated_at: new Date().toISOString() })
      .eq("request_id", requestRow.id)
      .not("ping_message_id", "is", null);
  }

  return { deleted: deleted.length, failed };
}

export async function handleDiscordReproComponentInteraction(supabase, interaction) {
  const customId = String(interaction?.data?.custom_id || "");
  const user = interaction?.member?.user || interaction?.user || null;

  if (customId.startsWith("gvg_repro_start:")) {
    return buildBastionSelectResponse(parseRequestIdFromCustomId(customId, "gvg_repro_start:"));
  }

  if (customId.startsWith("gvg_repro_bastion:")) {
    const guild = parseRequestIdFromCustomId(customId, "gvg_repro_bastion:");
    const bastion = interaction?.data?.values?.[0];
    return buildLocationSelectResponse(guild, bastion, { update: true });
  }

  if (customId.startsWith("gvg_repro_location:")) {
    const [, guild, bastion] = customId.split(":");
    const location = interaction?.data?.values?.[0];
    return buildTeamSelectResponse(guild, bastion, location, { update: true });
  }

  if (customId.startsWith("gvg_repro_team:")) {
    const [, guild, bastion, location] = customId.split(":");
    const team = interaction?.data?.values?.[0];
    logReproTeamStage("start", {
      guild: normalizeGuildCode(guild),
      bastion,
      location,
      team,
      user_id: user?.id || null,
    });
    const parsedLocation = parseWizardLocation(location);
    logReproTeamStage("context available", {
      guild: normalizeGuildCode(guild),
      bastion: bastion ? Number(bastion) : null,
      location,
      type: parsedLocation?.type || null,
      tower: parsedLocation?.tower || null,
      team: team ? Number(team) : null,
    });
    logReproTeamStage("external fetch skipped", { reason: "modal_context_is_encoded" });
    const response = buildWizardConditionsModal({ guild, bastion, location, team });
    logReproTeamStage("modal response sent", {
      type: response.type,
      custom_id: "gvg_repro_create_wizard",
    });
    return response;
  }

  if (customId.startsWith("gvg_repro_create_confirm:")) {
    const defenseId = parseRequestIdFromCustomId(customId, "gvg_repro_create_confirm:");
    const defense = await loadGvgDefenseById(supabase, defenseId);
    if (!defense) return discordMessageUpdate("Defense introuvable.");
    if (!getDiscordReproChannelId(defense.guild)) {
      return discordMessageUpdate("Aucun salon repro n'est configure pour cette guilde.");
    }
    return buildConditionsModal(defense);
  }

  if (customId === "gvg_repro_ephemeral_cancel") {
    return discordMessageUpdate("Operation annulee.");
  }

  if (customId.startsWith("gvg_repro_take:")) {
    const requestId = parseRequestIdFromCustomId(customId, "gvg_repro_take:");
    const requestRow = await getDiscordReproRequestById(supabase, requestId);
    if (!requestRow) return discordEphemeral("Cette demande de repro n'existe plus.");
    const member = await resolveMemberByDiscordUserForGuild(supabase, user, requestRow.guild);
    if (!member) return discordEphemeral("Ton compte Discord n'est pas lie au dashboard pour cette guilde.");
    const existing = await loadParticipantForMember(supabase, requestRow.id, member.id);
    return buildJoinReproModal(requestRow, existing);
  }

  if (customId.startsWith("gvg_repro_confirm_join:")) {
    const participantId = parseRequestIdFromCustomId(customId, "gvg_repro_confirm_join:");
    return discordDeferredEphemeral(interaction, async () => {
      await activateParticipant(supabase, participantId);
      return "Repro enregistree malgre les eveils insuffisants.";
    }, { label: "confirm_join" });
  }

  if (customId.startsWith("gvg_repro_cancel_join:")) {
    const participantId = parseRequestIdFromCustomId(customId, "gvg_repro_cancel_join:");
    return discordDeferredEphemeral(interaction, async () => {
      await supabase.from(REPRO_PARTICIPANT_TABLE).update({ state: "cancelled" }).eq("id", participantId);
      return "Repro annulee.";
    }, { label: "cancel_join" });
  }

  if (customId.startsWith("gvg_repro_open:")) {
    const requestId = parseRequestIdFromCustomId(customId, "gvg_repro_open:");
    return {
      type: 4,
      data: {
        content: "Confirmer que cette defense est ouverte ?\n\nCette action cloturera la demande et toutes les reproductions actives.",
        flags: 64,
        components: [
          {
            type: 1,
            components: [
              { type: 2, style: 3, custom_id: `gvg_repro_confirm_open:${requestId}`, label: "Confirmer" },
              { type: 2, style: 2, custom_id: "gvg_repro_ephemeral_cancel", label: "Annuler" },
            ],
          },
        ],
      },
    };
  }

  if (customId.startsWith("gvg_repro_confirm_open:")) {
    const requestId = parseRequestIdFromCustomId(customId, "gvg_repro_confirm_open:");
    return discordDeferredEphemeral(interaction, async () => {
      const requestRow = await getDiscordReproRequestById(supabase, requestId);
      if (!requestRow) throw new Error("Cette demande n'existe plus.");
      await closeRequestAsOpened(supabase, requestRow, { ...user, guild_id: interaction?.guild_id });
      return "Defense marquee ouverte. La fiche Discord a ete nettoyee.";
    }, { label: "confirm_open" });
  }

  if (customId.startsWith("gvg_repro_conditions:")) {
    const requestId = parseRequestIdFromCustomId(customId, "gvg_repro_conditions:");
    const requestRow = await getDiscordReproRequestById(supabase, requestId);
    if (!requestRow) return discordEphemeral("Cette demande n'existe plus.");
    const member = await resolveMemberByDiscordUserForGuild(supabase, user, requestRow.guild);
    if (!isRequestManager(member, requestRow)) return discordEphemeral("Tu ne peux pas modifier ces conditions.");
    const defense = await fetchRequestDefense(supabase, requestRow);
    return buildConditionsModal(defense, requestRow);
  }

  if (customId.startsWith("gvg_repro_cancel_mine:")) {
    const requestId = parseRequestIdFromCustomId(customId, "gvg_repro_cancel_mine:");
    return discordDeferredEphemeral(interaction, async () => {
      const requestRow = await getDiscordReproRequestById(supabase, requestId);
      if (!requestRow) throw new Error("Cette demande n'existe plus.");
      const member = await resolveMemberByDiscordUserForGuild(supabase, user, requestRow.guild);
      if (!member) throw new Error("Ton compte Discord n'est pas lie au dashboard pour cette guilde.");
      await cancelParticipant(supabase, requestRow, member);
      return "Ta reproduction a ete annulee.";
    }, { label: "cancel_mine" });
  }

  if (customId.startsWith("gvg_repro_cleanup_public:")) {
    const requestId = parseRequestIdFromCustomId(customId, "gvg_repro_cleanup_public:");
    return discordDeferredEphemeral(interaction, async () => {
      const requestRow = await getDiscordReproRequestById(supabase, requestId);
      if (!requestRow) throw new Error("Cette demande n'existe plus.");
      const result = await cleanupStoredPublicMessagesForRequest(supabase, requestRow, user);
      const warning = result.failed.length ? ` (${result.failed.length} erreur(s) conservees dans les logs)` : "";
      return `Annonces publiques nettoyees : ${result.deleted}${warning}. La demande et les reproducteurs sont inchanges.`;
    }, { label: "cleanup_public_messages" });
  }

  if (customId.startsWith("gvg_repro_cancel_request:")) {
    const requestId = parseRequestIdFromCustomId(customId, "gvg_repro_cancel_request:");
    const requestRow = await getDiscordReproRequestById(supabase, requestId);
    if (!requestRow) return discordEphemeral("Cette demande n'existe plus.");
    const activeParticipants = await fetchActiveParticipants(supabase, requestRow.id);
    if (activeParticipants.length) {
      return {
        type: 4,
        data: {
          content: `Cette demande possede ${activeParticipants.length} reproduction(s) active(s).\n\nForcer la suppression annulera toutes les reproductions associees.`,
          flags: 64,
          components: [
            {
              type: 1,
              components: [
                { type: 2, style: 4, custom_id: `gvg_repro_force_cancel:${requestId}`, label: "Forcer la suppression" },
                { type: 2, style: 2, custom_id: "gvg_repro_ephemeral_cancel", label: "Annuler" },
              ],
            },
          ],
        },
      };
    }
    return discordDeferredEphemeral(interaction, async () => {
      await cancelRequest(supabase, requestRow, user);
      return "Demande annulee.";
    }, { label: "cancel_request" });
  }

  if (customId.startsWith("gvg_repro_force_cancel:")) {
    const requestId = parseRequestIdFromCustomId(customId, "gvg_repro_force_cancel:");
    return discordDeferredEphemeral(interaction, async () => {
      const requestRow = await getDiscordReproRequestById(supabase, requestId);
      if (!requestRow) throw new Error("Cette demande n'existe plus.");
      await cancelRequest(supabase, requestRow, { ...user, guild_id: interaction?.guild_id }, { forced: true });
      return "Demande supprimee par admin.";
    }, { label: "force_cancel" });
  }

  return discordEphemeral("Interaction Discord non geree.");
}

export async function handleDiscordReproModalInteraction(supabase, interaction) {
  const customId = String(interaction?.data?.custom_id || "");
  const user = interaction?.member?.user || interaction?.user || null;

  if (customId.startsWith("gvg_repro_create:") || customId.startsWith("gvg_repro_create_wizard:")) {
    const isWizardCreate = customId.startsWith("gvg_repro_create_wizard:");
    const defenseId = isWizardCreate ? "" : parseRequestIdFromCustomId(customId, "gvg_repro_create:");
    const wizardParts = isWizardCreate ? customId.split(":") : [];
    const wizardContext = isWizardCreate
      ? {
          guild: wizardParts[1] || "",
          bastion: wizardParts[2] || "",
          location: wizardParts[3] || "",
          team: wizardParts[4] || "",
        }
      : null;
    const modalComponents = interaction?.data?.components || [];
    const trace = createReproSubmitTrace({
      defense_id: defenseId,
      user_id: user?.id,
      guild_id: interaction?.guild_id,
    });
    return discordDeferredMessageUpdate(interaction, async () => {
      trace.stage("start", {
        custom_id: isWizardCreate ? "gvg_repro_create_wizard" : "gvg_repro_create",
        wizard_context: wizardContext,
      });
      try {
        trace.stage("context resolve start");
        const defense = isWizardCreate
          ? await loadGvgDefenseByWizard(supabase, wizardContext)
          : await loadGvgDefenseById(supabase, defenseId);
        if (!defense) throw new Error("Defense introuvable.");
        trace.stage("context resolved", {
          defense_id: defense.id,
          guild: normalizeGuildCode(defense.guild),
          bastion: defense.bastion || null,
          tower: defense.tower || null,
          type: defense.type || null,
          team: defense.team || null,
        });

        trace.stage("validation start", { channel_configured: Boolean(getDiscordReproChannelId(defense.guild)) });
        const member = await resolveMemberByDiscordUserForGuild(supabase, user, defense.guild);
        if (!member) throw new Error("Ton compte Discord n'est pas lie au dashboard pour cette guilde.");
        if (!getDiscordReproChannelId(defense.guild)) throw new Error("Aucun salon repro n'est configure pour cette guilde.");
        const activeRequest = await getActiveRequestForDefense(supabase, defense.id);
        if (activeRequest?.discord_message_id) {
          const url = buildJumpUrl(interaction, activeRequest);
          const error = new Error(
            [
              "Une demande de repro est deja active pour cette defense.",
              url ? `[Voir la demande active](${url})` : null,
            ].filter(Boolean).join("\n")
          );
          error.publicMessage = error.message;
          throw error;
        }
        if (defense.record_status) {
          trace.stage("already open confirmation", { defense_id: defense.id });
          return buildAlreadyOpenConfirmation(defense, { update: true }).data;
        }

        const minAwakenings = parseConditionsModalValues(modalComponents);
        trace.stage("validation ok", {
          request_member_id: member.id || null,
          min_awakenings_count: Object.keys(minAwakenings).length,
        });

        const result = await createDiscordReproRequest(supabase, {
          defense,
          member,
          user,
          minAwakenings,
          interaction,
          trace,
        });
        if (result.alreadyActive) {
          const url = buildJumpUrl(interaction, result.request);
          const error = new Error(
            [
              "Une demande de repro est deja active pour cette defense.",
              url ? `[Voir la demande active](${url})` : null,
            ].filter(Boolean).join("\n")
          );
          error.publicMessage = error.message;
          throw error;
        }

        return null;
      } catch (error) {
        trace.fail(error);
        const publicError = new Error("Impossible de creer la demande de repro. La tentative a ete annulee, tu peux reessayer.");
        publicError.publicMessage = error?.publicMessage || publicError.message;
        throw publicError;
      }
    }, {
      label: "repro_submit",
      deleteOnSuccess: true,
      fallback: "Impossible de creer la demande de repro. La tentative a ete annulee, tu peux reessayer.",
      onFinalize: () => trace.stage("interaction finalized", { outcome: "success" }),
      onErrorFinalize: () => trace.stage("interaction finalized", { outcome: "error" }),
    });
  }

  if (customId.startsWith("gvg_repro_conditions_submit:")) {
    const requestId = parseRequestIdFromCustomId(customId, "gvg_repro_conditions_submit:");
    const modalComponents = interaction?.data?.components || [];
    return discordDeferredEphemeral(interaction, async () => {
      const requestRow = await getDiscordReproRequestById(supabase, requestId);
      if (!requestRow) throw new Error("Cette demande n'existe plus.");
      const member = await resolveMemberByDiscordUserForGuild(supabase, user, requestRow.guild);
      if (!isRequestManager(member, requestRow)) throw new Error("Tu ne peux pas modifier ces conditions.");

      const minAwakenings = parseConditionsModalValues(modalComponents);
      const { data: updated, error } = await supabase
        .from(REPRO_REQUEST_TABLE)
        .update({
          min_awakenings: minAwakenings,
          conditions_updated: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestRow.id)
        .select("*")
        .maybeSingle();
      if (error) throw error;

      const defense = await fetchRequestDefense(supabase, updated);

      const participants = await fetchActiveParticipants(supabase, updated.id);
      const heroRows = await fetchChampionIdsForDefense(supabase, defense);
      const awakeningsByMember = await fetchMemberAwakeningsForHeroes(
        supabase,
        participants.map((participant) => participant.member_id),
        heroRows
      );
      for (const participant of participants) {
        const status = evaluateAwakeningCompliance(
          heroRows,
          awakeningsByMember.get(String(participant.member_id)) || new Map(),
          minAwakenings
        );
        await supabase
          .from(REPRO_PARTICIPANT_TABLE)
          .update({
            warning_active: !status.every((hero) => hero.ok),
            updated_at: new Date().toISOString(),
          })
          .eq("id", participant.id);
      }
      await updateReproRequestMessage(supabase, updated, defense);
      return "Conditions mises a jour.";
    }, { label: "conditions_submit" });
  }

  if (customId.startsWith("gvg_repro_join:")) {
    const requestId = parseRequestIdFromCustomId(customId, "gvg_repro_join:");
    const modalComponents = interaction?.data?.components || [];
    return discordDeferredEphemeral(interaction, async () => {
      const result = await saveParticipantFromModal(supabase, {
        requestId,
        user,
        modalComponents,
      });
      if (result.pending) {
        return {
          content: "⚠️ Vous ne respectez pas tous les eveils demandes.\n\nVoulez-vous confirmer malgre tout cette reproduction ?",
          components: [
            {
              type: 1,
              components: [
                { type: 2, style: 4, custom_id: `gvg_repro_confirm_join:${result.participant.id}`, label: "Confirmer malgre tout" },
                { type: 2, style: 2, custom_id: `gvg_repro_cancel_join:${result.participant.id}`, label: "Annuler" },
              ],
            },
          ],
        };
      }
      return "Repro enregistree dans la fiche.";
    }, { label: "join_submit" });
  }

  return discordEphemeral("Modal Discord non gere.");
}

function parsePbBlock(value) {
  const text = String(value || "");
  const playerMatch = text.match(/repro\s*k?\s*pb\s*:\s*([^\n\r]+)/i);
  const enemyMatch = text.match(/adversaire\s*k?\s*pb\s*:\s*([^\n\r]+)/i);

  return {
    playerPb: playerMatch?.[1]?.trim() || "",
    enemyPb: enemyMatch?.[1]?.trim() || "",
  };
}

function parseStuffLines(value, heroLines, startIndex) {
  const rows = String(value || "")
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);

  rows.forEach((row, offset) => {
    const target = heroLines[startIndex + offset];
    if (!target) return;

    const colonIndex = row.indexOf(":");
    target.stuff = colonIndex >= 0 ? row.slice(colonIndex + 1).trim() : row.trim();
  });
}

function flattenModalValues(components) {
  const values = {};

  for (const row of components || []) {
    for (const component of row?.components || []) {
      if (component?.custom_id) values[component.custom_id] = component.value || "";
    }
  }

  return values;
}

async function findMatchingReproDefenseIds(supabase, targetDefense) {
  const targetId = targetDefense?.id;
  if (!targetId) return [];

  const signature = makeGvgDefenseSignature(targetDefense);
  const guild = normalizeGuildCode(targetDefense?.guild);

  if (!signature || !guild) return [targetId];

  const { data, error } = await supabase
    .from("gvg_defense")
    .select("id, heroes, status, is_ally")
    .eq("guild", guild);

  if (error) throw error;

  const ids = new Set([targetId]);

  for (const defense of data || []) {
    if (!defense?.id) continue;
    if ((defense?.is_ally === true) !== (targetDefense?.is_ally === true)) continue;
    if (!canReceivePropagatedRepro(defense)) continue;
    if (makeGvgDefenseSignature(defense) !== signature) continue;
    ids.add(defense.id);
  }

  return [...ids];
}

async function markMatchingGvgDefensesAsRepro(supabase, { defenseId, reproBy, updatedAt }) {
  const { data: targetDefense, error: readError } = await supabase
    .from("gvg_defense")
    .select("id, guild, is_ally, heroes, status")
    .eq("id", defenseId)
    .maybeSingle();

  if (readError) throw readError;
  if (!targetDefense) {
    const error = new Error("defense introuvable");
    error.statusCode = 404;
    throw error;
  }

  const targetIds = await findMatchingReproDefenseIds(supabase, targetDefense);
  const { data, error } = await supabase
    .from("gvg_defense")
    .update({
      status: "repro",
      repro_by: reproBy,
      updated_at: updatedAt,
    })
    .in("id", targetIds)
    .select("id, status, repro_by");

  if (error) throw error;

  return {
    item: (data || []).find((row) => String(row.id) === String(defenseId)) || (data || [])[0] || null,
    items: data || [],
    updated_count: (data || []).length,
  };
}

export async function saveDiscordModalSubmission(supabase, { requestId, user, modalComponents }) {
  const requestRow = await getDiscordReproRequestById(supabase, requestId);
  if (!requestRow) {
    const error = new Error("demande de repro introuvable");
    error.statusCode = 404;
    throw error;
  }

  const member = await resolveMemberByDiscordUser(supabase, user);
  if (!member) {
    const error = new Error("aucun joueur Portal lie a cet ID Discord");
    error.statusCode = 403;
    throw error;
  }

  const template = await buildReproTemplateData(supabase, {
    gvgDefenseId: requestRow.gvg_defense_id,
    memberId: member.id,
    watcherName: member.watcher_name || user?.username || "Joueur",
  });

  const values = flattenModalValues(modalComponents);
  const { playerPb, enemyPb } = parsePbBlock(values.pb_block);
  const heroLines = template.heroLines.map((line) => ({ ...line }));
  parseStuffLines(values.stuff_1_3, heroLines, 0);
  parseStuffLines(values.stuff_4_5, heroLines, 3);

  const saved = await saveReproSubmission(supabase, {
    gvgDefenseId: requestRow.gvg_defense_id,
    memberId: member.id,
    watcherName: member.watcher_name || user?.username || "Joueur",
    playerPb,
    enemyPb,
    heroLines,
    artifact: String(values.artifact || "").trim(),
  });

  const now = new Date().toISOString();
  await markMatchingGvgDefensesAsRepro(supabase, {
    defenseId: requestRow.gvg_defense_id,
    reproBy: member.watcher_name || user?.username || "Joueur",
    updatedAt: now,
  });

  await supabase
    .from(REPRO_REQUEST_TABLE)
    .update({
      state: "repro_active",
      reproducer_member_id: member.id,
      reproducer_discord_id: String(user?.id || "").trim() || null,
      reproducer_name: member.watcher_name || user?.username || "Joueur",
      repro_submitted_at: now,
      updated_at: now,
      last_error: null,
    })
    .eq("id", requestRow.id);

  return { saved, request: requestRow, member };
}

async function openDefenseInPanel(supabase, defenseId) {
  const { data: defense, error: readError } = await supabase
    .from("gvg_defense")
    .select("id, record_status")
    .eq("id", defenseId)
    .maybeSingle();

  if (readError) throw readError;
  if (!defense) {
    const error = new Error("defense introuvable");
    error.statusCode = 404;
    throw error;
  }

  if (defense.record_status) {
    return { item: defense, already_open: true };
  }

  const { data, error } = await supabase
    .from("gvg_defense")
    .update({
      record_status: "open",
      updated_at: new Date().toISOString(),
    })
    .eq("id", defenseId)
    .select("id, record_status")
    .maybeSingle();

  if (error) throw error;
  return { item: data, already_open: false };
}

export async function sendDiscordDm(userId, content) {
  if (!userId || !getDiscordBotToken()) return { skipped: true };
  const channel = await discordRequest("/users/@me/channels", {
    method: "POST",
    body: { recipient_id: String(userId) },
  });

  if (!channel?.id) return { skipped: true };

  const message = await discordRequest(`/channels/${encodeURIComponent(channel.id)}/messages`, {
    method: "POST",
    body: {
      content,
      allowed_mentions: { parse: [] },
    },
  });

  return { sent: true, message_id: message?.id || null };
}

function isWhiteCheckEmoji(emojiName) {
  return ["✅", "white_check_mark", ":white_check_mark:"].includes(String(emojiName || "").trim());
}

function isMissingDefenseFollowupTable(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes(DEFENSE_FOLLOWUP_TABLE)
  );
}

function canValidateDefenseFollowup(admin, followup) {
  if (!admin || !isAdminRole(admin.role)) return false;
  if (isLeaderRole(admin.role)) return true;

  const adminGuild = normalizeGuildCode(admin.guild_code);
  const targetGuild = normalizeGuildCode(followup.guild_code);
  if (!adminGuild || !targetGuild) return false;

  if (isPaladinGuildCode(adminGuild) && isPaladinGuildCode(targetGuild)) return true;
  return adminGuild === targetGuild;
}

function buildDiscordStatusChannelName(currentName, targetName, statusEmoji) {
  const cleanCurrent = String(currentName || "").trim();
  const cleanTarget = String(targetName || "").trim();
  const strippedCurrent = cleanCurrent
    .replace(/^\s*(?:\u2705|\u274c|\u26a0\uFE0F?|\u26a0)\s*(?:[-\u2013\u2014]\s*)?/u, "")
    .trim();
  const baseName = strippedCurrent || cleanTarget || cleanCurrent || "Joueur";

  return `${statusEmoji} - ${baseName}`.slice(0, 100);
}

async function renameDiscordChannelStatus(channelId, targetName, statusEmoji) {
  if (!channelId || !getDiscordBotToken()) return { skipped: true, reason: "missing_channel_or_token" };

  const channel = await discordRequest(`/channels/${encodeURIComponent(channelId)}`, {
    method: "GET",
  });
  const before = String(channel?.name || "").trim();
  const after = buildDiscordStatusChannelName(before, targetName, statusEmoji);

  if (!after || before === after) {
    return { skipped: true, reason: "already_named", channel_id: channelId, before, after };
  }

  await discordRequest(`/channels/${encodeURIComponent(channelId)}`, {
    method: "PATCH",
    body: { name: after },
  });

  return { renamed: true, channel_id: channelId, before, after };
}

async function findDefenseFollowupByDiscordMessage(supabase, messageId) {
  const readLatest = async (queryBuilder) => {
    const { data, error } = await queryBuilder
      .neq("state", "deleted")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      if (isMissingDefenseFollowupTable(error)) {
        return { missingTable: true, followup: null };
      }
      throw error;
    }

    return { missingTable: false, followup: data?.[0] || null };
  };

  const checks = [
    () => readLatest(supabase.from(DEFENSE_FOLLOWUP_TABLE).select("*").contains("discord_message_ids", [messageId])),
    () => readLatest(supabase.from(DEFENSE_FOLLOWUP_TABLE).select("*").contains("dm_message_ids", [messageId])),
    () => readLatest(supabase.from(DEFENSE_FOLLOWUP_TABLE).select("*").eq("discord_message_id", messageId)),
  ];

  for (const check of checks) {
    const result = await check();
    if (result.missingTable || result.followup) return result;
  }

  return { missingTable: false, followup: null };
}

export async function handleGuildDefenseFollowupReaction(supabase, event) {
  if (!isWhiteCheckEmoji(event?.emojiName)) {
    return { ignored: true, reason: "emoji_not_supported" };
  }

  const messageId = String(event?.messageId || "").trim();
  const discordUserId = String(event?.userId || "").trim();
  if (!messageId) {
    const error = new Error("messageId manquant");
    error.statusCode = 400;
    throw error;
  }

  const { missingTable, followup } = await findDefenseFollowupByDiscordMessage(supabase, messageId);
  if (missingTable) return { ignored: true, reason: "missing_guild_defense_discord_followups_table" };
  if (!followup) return { ignored: true, reason: "followup_not_found" };
  if (followup.state === "validated") return { ignored: true, reason: "already_validated" };

  const admin = await resolveMemberByDiscordUser(supabase, { id: discordUserId });
  if (!canValidateDefenseFollowup(admin, followup)) {
    return { ignored: true, reason: "not_admin_or_wrong_scope" };
  }

  const now = new Date().toISOString();
  const warnings = [];
  let rename = null;
  try {
    rename = await renameDiscordChannelStatus(
      followup.discord_channel_id || event?.channelId,
      followup.member_name,
      DISCORD_STATUS_DONE
    );
  } catch (renameError) {
    const warning = serializeDiscordError(renameError, {
      type: "discord_channel_rename_failed",
      discordChannelId: followup.discord_channel_id || event?.channelId || null,
    });
    warnings.push(warning);
    console.warn("[guild-defense-followup] channel rename failed:", warning.message);
  }

  const { error: memberError } = await supabase
    .from("guild_members")
    .update({ status: DEFENSE_STATUS_VALID })
    .eq("id", followup.member_id);
  if (memberError) throw memberError;

  const { error: followupError } = await supabase
    .from(DEFENSE_FOLLOWUP_TABLE)
    .update({
      state: "validated",
      validated_by_member_id: admin.id,
      validated_by_discord_id: discordUserId || null,
      validated_by_name: admin.watcher_name || admin.discord_id || "Admin",
      validated_at: now,
      thread_name_after: rename?.after || followup.thread_name_after || null,
      updated_at: now,
      last_error: warnings.length ? JSON.stringify(warnings).slice(0, 1000) : null,
    })
    .eq("id", followup.id);
  if (followupError) throw followupError;

  try {
    await supabase.from("portal_activity_logs").insert({
      actor_member_id: admin.id,
      actor_name: admin.watcher_name || admin.discord_id || "Admin",
      target_member_id: followup.member_id,
      target_name: followup.member_name || "Joueur",
      action_type: "guild_management_defenses_validated_discord",
      entity_type: "guild_defense_discord_followups",
      entity_id: followup.id,
      summary: `${admin.watcher_name || admin.discord_id || "Admin"} a valide les defenses de ${followup.member_name || "Joueur"} via Discord`,
      metadata: {
        guildCode: followup.guild_code,
        discordMessageId: messageId,
        discordChannelId: followup.discord_channel_id || event?.channelId || null,
        rename,
        warnings,
      },
    });
  } catch (logError) {
    console.warn("[guild-defense-followup] activity log failed:", logError?.message || logError);
  }

  return {
    success: true,
    followup_id: followup.id,
    member_id: followup.member_id,
    guild_code: followup.guild_code,
    rename,
    warnings,
  };
}

export async function handleDiscordReproReaction(supabase, event) {
  if (!isWhiteCheckEmoji(event?.emojiName)) {
    return { ignored: true, reason: "emoji_not_supported" };
  }

  const messageId = String(event?.messageId || "").trim();
  if (!messageId) {
    const error = new Error("messageId manquant");
    error.statusCode = 400;
    throw error;
  }

  const { data: requestRow, error } = await supabase
    .from(REPRO_REQUEST_TABLE)
    .select("*")
    .eq("discord_message_id", messageId)
    .maybeSingle();

  if (error) throw error;
  if (!requestRow) return { ignored: true, reason: "request_not_found" };
  if (requestRow.state === "opened") return { ignored: true, reason: "already_opened" };

  const opened = await openDefenseInPanel(supabase, requestRow.gvg_defense_id);

  let dm = null;
  if (requestRow.reproducer_discord_id) {
    try {
      dm = await sendDiscordDm(
        requestRow.reproducer_discord_id,
        "Ta repro est ouverte. Tu peux passer a une autre repro si tu veux."
      );
    } catch (dmError) {
      dm = { sent: false, error: dmError?.message || "dm failed" };
    }
  }

  const cleanup = await cleanupDiscordMessagesForRequest(supabase, requestRow, {
    reason: "discord_reaction",
    source: "discord_gateway",
    channelId: event?.channelId,
    nextState: "opened",
    markOpened: true,
    dm,
  });

  return {
    success: true,
    request_id: requestRow.id,
    gvg_defense_id: requestRow.gvg_defense_id,
    opened,
    dm,
    deleted_messages: cleanup.deleted_messages,
    cleanup,
  };
}
