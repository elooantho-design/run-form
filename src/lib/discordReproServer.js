const DISCORD_API_BASE = "https://discord.com/api/v10";
const DEFAULT_REPRO_CHANNEL_ID = "1501512158637457408";
const REPRO_REQUEST_TABLE = "gvg_discord_repro_requests";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeGuildCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "_");
}

function isG1EnemyDefRequest(defense) {
  return (
    normalizeGuildCode(defense?.guild) === "G1" &&
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

function getDiscordReproChannelId() {
  return String(process.env.DISCORD_REPRO_CHANNEL_ID || DEFAULT_REPRO_CHANNEL_ID).trim();
}

function getDiscordSendDelayMs() {
  const value = Number(process.env.DISCORD_REPRO_SEND_DELAY_MS || 1200);
  return Number.isFinite(value) && value >= 0 ? value : 1200;
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

function resolveDiscordImageUrl(imageUrl) {
  const value = String(imageUrl || "").trim();
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

function isAlreadyExistsError(error) {
  return error?.code === "23505";
}

async function discordRequest(pathname, options = {}, requestOptions = {}) {
  const token = getDiscordBotToken();
  if (!token) {
    const error = new Error("DISCORD_BOT_TOKEN manquant");
    error.code = "DISCORD_CONFIG_MISSING";
    throw error;
  }

  const method = options.method || "GET";
  const headers = {
    Authorization: `Bot ${token}`,
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${DISCORD_API_BASE}${pathname}`, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

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

function buildDiscordRequestPayload(defense, requestRow) {
  const title = formatDefenseTitle(defense);
  const rawName = String(defense?.raw_name || "").trim();
  const portalBaseUrl = getPortalBaseUrl();
  const dashboardUrl = portalBaseUrl ? `${portalBaseUrl}/portal` : "";
  const imageUrl = resolveDiscordImageUrl(defense?.image_url);

  const embed = {
    title: `Demande de repro - ${title}`,
    description: [
      rawName ? `Defense: ${rawName}` : null,
      "Reponds a cette demande en cliquant sur le bouton, puis remplis les informations.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    color: 0x22c55e,
  };

  if (imageUrl) {
    embed.image = { url: imageUrl };
  }

  if (dashboardUrl) {
    embed.url = dashboardUrl;
  }

  return {
    content: "**Demande de repro G1**",
    embeds: [embed],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            custom_id: `gvg_repro_take:${requestRow.id}`,
            label: "Remplir la repro",
          },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

async function getOrCreateReproRequestRow(supabase, defense, channelId) {
  const { data: existing, error: existingError } = await supabase
    .from(REPRO_REQUEST_TABLE)
    .select("*")
    .eq("gvg_defense_id", defense.id)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return existing;

  const payload = {
    guild: "G1",
    gvg_defense_id: defense.id,
    discord_channel_id: channelId,
    state: "requested",
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(REPRO_REQUEST_TABLE)
    .insert(payload)
    .select("*")
    .maybeSingle();

  if (error && isAlreadyExistsError(error)) {
    const retry = await supabase
      .from(REPRO_REQUEST_TABLE)
      .select("*")
      .eq("gvg_defense_id", defense.id)
      .maybeSingle();
    if (retry.error) throw retry.error;
    return retry.data;
  }

  if (error) throw error;
  return data;
}

async function markRequestSendFailed(supabase, requestId, error) {
  await supabase
    .from(REPRO_REQUEST_TABLE)
    .update({
      state: "send_failed",
      last_error: String(error?.message || error || "send failed").slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId);
}

async function sendReproRequestMessage(supabase, defense) {
  const channelId = getDiscordReproChannelId();
  const requestRow = await getOrCreateReproRequestRow(supabase, defense, channelId);

  if (requestRow?.discord_message_id) {
    return { skipped: true, reason: "already_sent", request_id: requestRow.id };
  }

  try {
    const payload = buildDiscordRequestPayload(defense, requestRow);
    const message = await discordRequest(`/channels/${encodeURIComponent(channelId)}/messages`, {
      method: "POST",
      body: payload,
    });

    await supabase
      .from(REPRO_REQUEST_TABLE)
      .update({
        discord_message_id: message?.id || null,
        state: "requested",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestRow.id);

    return {
      sent: true,
      request_id: requestRow.id,
      discord_message_id: message?.id || null,
    };
  } catch (error) {
    await markRequestSendFailed(supabase, requestRow.id, error);
    return {
      sent: false,
      request_id: requestRow.id,
      error: error?.message || "send failed",
    };
  }
}

export async function notifyDiscordReproRequestsForDefenses(supabase, defenses) {
  const eligibleDefenses = (defenses || []).filter(isG1EnemyDefRequest);

  if (!eligibleDefenses.length) {
    return { enabled: true, eligible: 0, sent: 0, skipped: 0, failed: 0 };
  }

  if (!getDiscordBotToken() || !getDiscordReproChannelId()) {
    return {
      enabled: false,
      reason: "missing_discord_config",
      eligible: eligibleDefenses.length,
      sent: 0,
      skipped: 0,
      failed: 0,
    };
  }

  const results = [];
  const delayMs = getDiscordSendDelayMs();

  try {
    for (const defense of eligibleDefenses) {
      const result = await sendReproRequestMessage(supabase, defense);
      results.push(result);
      if (delayMs > 0) await sleep(delayMs);
    }
  } catch (error) {
    if (isMissingReproRequestTable(error)) {
      return {
        enabled: false,
        reason: "missing_gvg_discord_repro_requests_table",
        eligible: eligibleDefenses.length,
        sent: 0,
        skipped: 0,
        failed: eligibleDefenses.length,
      };
    }

    return {
      enabled: true,
      eligible: eligibleDefenses.length,
      sent: results.filter((item) => item.sent).length,
      skipped: results.filter((item) => item.skipped).length,
      failed: results.filter((item) => item.error || item.sent === false).length,
      error: error?.message || "discord repro notification failed",
    };
  }

  return {
    enabled: true,
    eligible: eligibleDefenses.length,
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

export async function cleanupDiscordReproRequestsForDefenseIds(supabase, defenseIds) {
  const ids = (defenseIds || []).filter(Boolean);
  if (!ids.length) {
    return { enabled: true, deleted_messages: 0, deleted_rows: 0 };
  }

  const { data, error } = await supabase
    .from(REPRO_REQUEST_TABLE)
    .select("id, discord_channel_id, discord_message_id, discord_response_message_id")
    .in("gvg_defense_id", ids);

  if (error) {
    if (isMissingReproRequestTable(error)) {
      return { enabled: false, reason: "missing_gvg_discord_repro_requests_table" };
    }
    throw error;
  }

  let deletedMessages = 0;

  for (const row of data || []) {
    const channelId = row.discord_channel_id || getDiscordReproChannelId();
    const messageIds = [row.discord_message_id, row.discord_response_message_id].filter(Boolean);
    for (const messageId of messageIds) {
      try {
        await deleteDiscordMessage(channelId, messageId);
        deletedMessages += 1;
      } catch (error) {
        console.error("[discord-repro:cleanup] delete message error:", error);
      }
    }
  }

  const rowIds = (data || []).map((row) => row.id).filter(Boolean);
  if (rowIds.length) {
    const { error: deleteError } = await supabase
      .from(REPRO_REQUEST_TABLE)
      .delete()
      .in("id", rowIds);
    if (deleteError) throw deleteError;
  }

  return {
    enabled: true,
    deleted_messages: deletedMessages,
    deleted_rows: rowIds.length,
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

  const payload = {
    gvg_defense_id: gvgDefenseId,
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

  const { data, error } = await supabase
    .from("gvg_repro")
    .upsert(payload, { onConflict: "gvg_defense_id" })
    .select("id, gvg_defense_id, watcher_name, message_text")
    .maybeSingle();

  if (error) throw error;
  return data;
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
    .select("id, watcher_name, discord_id, guild_code")
    .eq("discord_id", discordId)
    .maybeSingle();

  if (error) throw error;
  return data;
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
  await supabase
    .from("gvg_defense")
    .update({
      status: "repro",
      repro_by: member.watcher_name || user?.username || "Joueur",
      updated_at: now,
    })
    .eq("id", requestRow.gvg_defense_id);

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
      record_status: "pas_record",
      updated_at: new Date().toISOString(),
    })
    .eq("id", defenseId)
    .select("id, record_status")
    .maybeSingle();

  if (error) throw error;
  return { item: data, already_open: false };
}

async function sendDiscordDm(userId, content) {
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

  const channelId = requestRow.discord_channel_id || event?.channelId || getDiscordReproChannelId();
  const messageIds = [
    requestRow.discord_message_id,
    requestRow.discord_response_message_id,
  ].filter(Boolean);

  let deletedMessages = 0;
  for (const id of messageIds) {
    try {
      await deleteDiscordMessage(channelId, id);
      deletedMessages += 1;
    } catch (deleteError) {
      console.error("[discord-repro:reaction] delete message error:", deleteError);
    }
  }

  const now = new Date().toISOString();
  await supabase
    .from(REPRO_REQUEST_TABLE)
    .update({
      state: "opened",
      opened_at: now,
      updated_at: now,
      last_error: null,
    })
    .eq("id", requestRow.id);

  return {
    success: true,
    request_id: requestRow.id,
    gvg_defense_id: requestRow.gvg_defense_id,
    opened,
    dm,
    deleted_messages: deletedMessages,
  };
}
