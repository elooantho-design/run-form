import { importGvgItems } from "./gvg-import.js";
import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import { createClient } from "@supabase/supabase-js";
import {
  buildDiscordReproModal,
  buildReproTemplateData,
  getDiscordReproRequestById,
  handleDiscordReproReaction,
  resolveMemberByDiscordUser,
  saveDiscordModalSubmission,
} from "../src/lib/discordReproServer.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

const DEFAULT_GVG_SERVER_URL = "http://152.228.128.157";
const DEFAULT_PUBLIC_ASSETS_BASE_URL = "https://vps-aad12be0.vps.ovh.net";
const VPS_REQUEST_TIMEOUT_MS = 12000;
const CALQUE_FOLDERS = {
  hero: "hero-calques",
  faction: "faction-calques",
  role: "role-calques",
};
const LAUNCHER_DOWNLOAD_FILE = "PaladinGVGLauncher.zip";
const RECORD_LAUNCHER_DOWNLOAD_FILE = "PaladinGVGRecordLauncher.zip";
const LAUNCHER_SCOPE_CACHE_MS = 15_000;
const LAUNCHER_SCOPE_LOG_LIMIT = 50;
const LAUNCHER_SCOPE_FALLBACK_LOOKBACK_HOURS = 12;
const LAUNCHER_SCOPE_JOB_BEFORE_MS = 90 * 60 * 1000;
const LAUNCHER_SCOPE_JOB_AFTER_MS = 15 * 60 * 1000;
const LAUNCHER_SCOPE_CANDIDATES_PER_JOB = 5;

let supabaseAdmin = null;
let launcherScopeCache = {
  expiresAt: 0,
  key: "",
  overrides: new Map(),
};

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-GVG-Token, X-Discord-Repro-Token, X-Signature-Ed25519, X-Signature-Timestamp"
  );
}

function getHeader(req, name) {
  const lower = name.toLowerCase();
  return req.headers?.[lower] || req.headers?.[name] || "";
}

async function readRawBody(req) {
  if (typeof req.rawBodyText === "string") return req.rawBodyText;
  if (Buffer.isBuffer(req.rawBody)) {
    const rawText = req.rawBody.toString("utf8");
    req.rawBodyText = rawText;
    return rawText;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  const buffer = Buffer.concat(chunks);
  const rawText = buffer.toString("utf8");
  req.rawBody = buffer;
  req.rawBodyText = rawText;
  return rawText;
}

async function ensureJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  const rawBody = await readRawBody(req);
  req.body = rawBody ? JSON.parse(rawBody) : {};
  return req.body;
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

function verifyDiscordSignature(req, rawBody) {
  const publicKeyHex = String(process.env.DISCORD_PUBLIC_KEY || "").trim();
  const signatureHex = String(getHeader(req, "x-signature-ed25519") || "").trim();
  const timestamp = String(getHeader(req, "x-signature-timestamp") || "").trim();

  if (!publicKeyHex || !signatureHex || !timestamp) return false;
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex)) return false;
  if (!/^[0-9a-f]+$/i.test(signatureHex)) return false;

  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  const publicKey = crypto.createPublicKey({
    key: Buffer.concat([spkiPrefix, Buffer.from(publicKeyHex, "hex")]),
    format: "der",
    type: "spki",
  });

  return crypto.verify(
    null,
    Buffer.from(`${timestamp}${rawBody}`, "utf8"),
    publicKey,
    Buffer.from(signatureHex, "hex")
  );
}

function getInteractionUser(interaction) {
  return interaction?.member?.user || interaction?.user || null;
}

function parseRequestIdFromCustomId(customId, prefix) {
  const value = String(customId || "");
  if (!value.startsWith(prefix)) return "";
  return value.slice(prefix.length).trim();
}

function getServerConfig() {
  const serverUrl = String(
    process.env.GVG_SERVER_URL ||
      process.env.GVG_VPS_URL ||
      DEFAULT_GVG_SERVER_URL
  ).replace(/\/$/, "");
  const token = process.env.GVG_API_TOKEN || process.env.GVG_SERVER_TOKEN || "";

  return { serverUrl, token };
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

function buildPublicAssetUrl(parts) {
  const baseUrl = getPublicAssetsBaseUrl();
  if (!baseUrl) return "";
  return `${baseUrl}/${parts.map(encodeUrlSegment).join("/")}`;
}

function buildPublicPreviewUrl(guild, jobId, file) {
  if (!guild || !jobId || !file) return "";

  return buildPublicAssetUrl([
    "public",
    "jobs",
    String(guild).trim().toLowerCase(),
    jobId,
    "previews",
    file,
  ]);
}

function buildPublicCalqueUrl(kind, file) {
  const folder = CALQUE_FOLDERS[kind];
  if (!folder || !file) return "";
  return buildPublicAssetUrl(["assets", "calques", folder, file]);
}

function buildPublicDownloadUrl(file) {
  if (!file) return "";
  return buildPublicAssetUrl(["downloads", file]);
}

function redirectToPublicAsset(res, url, cacheControl = "public, max-age=300") {
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("Location", url);
  return res.status(307).end();
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null;

  if (!supabaseAdmin) {
    supabaseAdmin = createClient(url, key, { auth: { persistSession: false } });
  }

  return supabaseAdmin;
}

function normalizeGuildCode(value) {
  const code = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_-]/g, "");
  return /^[A-Z0-9_-]{2,24}$/.test(code) ? code : null;
}

function isValidGuild(value) {
  return normalizeGuildCode(value) !== null;
}

function normalizeTargetGuild(value) {
  return normalizeGuildCode(value);
}

function isValidJobRef(value) {
  return /^[A-Za-z0-9._-]{1,160}$/.test(String(value || ""));
}

function isValidSessionId(value) {
  return /^[A-Za-z0-9_-]{12,96}$/.test(String(value || ""));
}

function isValidCalqueFile(value) {
  return /^[A-Za-z0-9À-ÿ ._'()-]{1,180}\.(png|webp|jpg|jpeg)$/i.test(
    String(value || "")
  );
}

function getJobId(job) {
  return String(job?.resolved_job_id || job?.job_id || job?.id || "").trim();
}

function getJobSourceGuild(job) {
  return String(
    job?.source_guild ||
      job?.server_guild ||
      job?.guild ||
      job?.target_guild ||
      job?.mode ||
      ""
  ).trim();
}

function getJobGuildCode(job) {
  return (
    normalizeTargetGuild(job?.target_guild) ||
    normalizeTargetGuild(job?.mode) ||
    normalizeTargetGuild(job?.guild) ||
    String(job?.mode || job?.guild || "").toUpperCase()
  );
}

function normalizeJob(job) {
  const targetGuild =
    normalizeTargetGuild(job?.target_guild) ||
    normalizeTargetGuild(job?.mode) ||
    normalizeTargetGuild(job?.guild);
  const sourceGuild = getJobSourceGuild(job);
  const jobId = getJobId(job);

  return {
    ...job,
    target_guild: targetGuild,
    source_guild: sourceGuild,
    resolved_guild: sourceGuild,
    resolved_job_id: jobId,
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = [];
  let index = 0;

  async function next() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => next())
  );

  return results;
}

function withTimeout(promise, timeoutMs, fallbackValue) {
  let timeoutId = null;

  return new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      resolve(fallbackValue);
    }, timeoutMs);

    promise
      .then((value) => resolve(value))
      .catch((error) => {
        console.warn("[gvg-server] operation skipped after error:", error.message);
        resolve(fallbackValue);
      })
      .finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
      });
  });
}

function getLogSessionId(log) {
  return String(log?.metadata?.sessionId || log?.entity_id || "").trim();
}

function getLogTargetGuild(log) {
  return normalizeTargetGuild(log?.metadata?.guild);
}

function getJobTimeRange(jobs) {
  const timestamps = jobs
    .flatMap((job) => [job?.created_at, job?.updated_at])
    .map((value) => {
      const timestamp = value ? new Date(value).getTime() : Number.NaN;
      return Number.isFinite(timestamp) ? timestamp : null;
    })
    .filter((value) => value !== null);

  if (!timestamps.length) {
    const now = Date.now();
    return {
      since: new Date(
        now - LAUNCHER_SCOPE_FALLBACK_LOOKBACK_HOURS * 60 * 60 * 1000
      ).toISOString(),
      until: new Date(now + LAUNCHER_SCOPE_JOB_AFTER_MS).toISOString(),
    };
  }

  return {
    since: new Date(Math.min(...timestamps) - LAUNCHER_SCOPE_JOB_BEFORE_MS).toISOString(),
    until: new Date(Math.max(...timestamps) + LAUNCHER_SCOPE_JOB_AFTER_MS).toISOString(),
  };
}

async function fetchRecentLauncherLogs(jobs) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];

  const { since, until } = getJobTimeRange(jobs);

  const { data, error } = await supabase
    .from("portal_activity_logs")
    .select("created_at, actor_name, entity_id, summary, metadata")
    .eq("action_type", "gvg_launcher_start")
    .gte("created_at", since)
    .lte("created_at", until)
    .order("created_at", { ascending: false })
    .limit(LAUNCHER_SCOPE_LOG_LIMIT);

  if (error) {
    console.warn("[gvg-server] launcher logs unavailable:", error.message);
    return [];
  }

  return data || [];
}

async function fetchLauncherScope(log) {
  const sessionId = getLogSessionId(log);
  const targetGuild = getLogTargetGuild(log);

  if (!isValidSessionId(sessionId) || !targetGuild) return null;

  try {
    const data = await requestVpsJson(
      `/api/v1/launcher/sessions/${encodeURIComponent(sessionId)}`,
      { timeoutMs: 1500 }
    );
    const session = data?.session || data || {};
    const jobId = getJobId(session);

    if (!jobId) return null;

    return {
      jobId,
      targetGuild,
      sessionId,
      actorName: String(log?.actor_name || "").trim(),
      side: String(log?.metadata?.side || session?.side || "").trim(),
      createdAt: log?.created_at || null,
    };
  } catch (error) {
    if (Number(error.statusCode) !== 404) {
      console.warn("[gvg-server] launcher session scope unavailable:", error.message);
    }
    return null;
  }
}

function getLauncherScopeCacheKey(jobs) {
  return jobs.map(getJobId).filter(Boolean).sort().join("|");
}

function getEventTimestamp(value) {
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getJobCreatedTimestamp(job) {
  return getEventTimestamp(job?.created_at || job?.updated_at);
}

function pickLauncherCandidateLogs(logs, jobs) {
  const candidatesBySession = new Map();

  for (const job of jobs) {
    const jobTimestamp = getJobCreatedTimestamp(job);
    if (jobTimestamp === null) continue;

    logs
      .map((log) => {
        const logTimestamp = getEventTimestamp(log?.created_at);
        if (logTimestamp === null) return null;

        const delta = jobTimestamp - logTimestamp;
        if (delta < -LAUNCHER_SCOPE_JOB_AFTER_MS || delta > LAUNCHER_SCOPE_JOB_BEFORE_MS) {
          return null;
        }

        return { log, distance: Math.abs(delta) };
      })
      .filter(Boolean)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, LAUNCHER_SCOPE_CANDIDATES_PER_JOB)
      .forEach(({ log }) => {
        const sessionId = getLogSessionId(log);
        if (sessionId && !candidatesBySession.has(sessionId)) {
          candidatesBySession.set(sessionId, log);
        }
      });
  }

  if (candidatesBySession.size) {
    return [...candidatesBySession.values()];
  }

  return logs.slice(0, LAUNCHER_SCOPE_CANDIDATES_PER_JOB);
}

async function getLauncherJobScopeOverrides(jobs) {
  const cacheKey = getLauncherScopeCacheKey(jobs);

  if (cacheKey && launcherScopeCache.key === cacheKey && Date.now() < launcherScopeCache.expiresAt) {
    return launcherScopeCache.overrides;
  }

  const wantedJobIds = new Set(jobs.map(getJobId).filter(Boolean));
  const logs = await fetchRecentLauncherLogs(jobs);
  const seenSessions = new Set();
  const scopedLogs = logs.filter((log) => {
    const sessionId = getLogSessionId(log);
    const targetGuild = getLogTargetGuild(log);

    if (!sessionId || !targetGuild || seenSessions.has(sessionId)) return false;
    seenSessions.add(sessionId);
    return true;
  });

  const candidateLogs = pickLauncherCandidateLogs(scopedLogs, jobs);
  const scopes = await mapWithConcurrency(candidateLogs, 8, fetchLauncherScope);
  const overrides = new Map();

  for (const scope of scopes) {
    if (scope?.jobId && scope.targetGuild && wantedJobIds.has(scope.jobId)) {
      overrides.set(scope.jobId, scope);
    }
  }

  launcherScopeCache = {
    expiresAt: Date.now() + LAUNCHER_SCOPE_CACHE_MS,
    key: cacheKey,
    overrides,
  };

  return overrides;
}

async function applyLauncherSessionScopes(jobs) {
  const normalizedJobs = jobs.map(normalizeJob);
  if (!normalizedJobs.length) return normalizedJobs;

  const overrides = await getLauncherJobScopeOverrides(normalizedJobs);
  if (!overrides.size) return normalizedJobs;

  return normalizedJobs.map((job) => {
    const jobId = getJobId(job);
    const scope = overrides.get(jobId);

    if (!scope) return job;

    const reportedGuild = getJobGuildCode(job);

    return {
      ...job,
      target_guild: scope.targetGuild,
      launcher_session_id: scope.sessionId,
      launcher_actor: scope.actorName || null,
      launcher_side: scope.side || null,
      launcher_created_at: scope.createdAt,
      launcher_reported_guild: reportedGuild,
      launcher_scope_corrected: reportedGuild !== scope.targetGuild,
    };
  });
}

function filterJobsByGuild(data, guild) {
  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
  if (!guild) return jobs;

  const wanted = normalizeTargetGuild(guild);
  if (!wanted) return [];

  return jobs.filter((job) => getJobGuildCode(job) === wanted);
}

function parseJsonMaybe(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

async function requestVpsJson(path, options = {}) {
  const { serverUrl, token } = getServerConfig();
  const method = options.method || "GET";
  const timeoutMs = options.timeoutMs || VPS_REQUEST_TIMEOUT_MS;

  if (!token) {
    const error = new Error("GVG_API_TOKEN manquant cote serveur");
    error.statusCode = 500;
    throw error;
  }

  const bodyText =
    options.body !== undefined ? JSON.stringify(options.body) : undefined;
  const headers = {
    "X-GVG-Token": token,
  };

  if (bodyText !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(bodyText);
  }

  return new Promise((resolve, reject) => {
    const url = new URL(path, `${serverUrl}/`);
    const client = url.protocol === "https:" ? https : http;
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const request = client.request(
      url,
      {
        method,
        headers,
      },
      (response) => {
        const chunks = [];

        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const data = parseJsonMaybe(text);

          if (response.statusCode < 200 || response.statusCode >= 300) {
            const error = new Error(
              data?.error || `Erreur VPS ${response.statusCode}`
            );
            error.statusCode = response.statusCode;
            error.data = data;
            finish(reject, error);
            return;
          }

          finish(resolve, data);
        });
      }
    );

    request.setTimeout(timeoutMs, () => {
      const error = new Error(`Timeout VPS apres ${timeoutMs / 1000}s`);
      error.statusCode = 504;
      request.destroy(error);
    });

    request.on("error", (error) => {
      if (!error.statusCode && /^Timeout VPS/.test(error.message)) {
        error.statusCode = 504;
      }

      finish(reject, error);
    });

    if (bodyText !== undefined) request.write(bodyText);
    request.end();
  });
}

async function requestVpsFile(path, options = {}) {
  const { serverUrl, token } = getServerConfig();
  const timeoutMs = options.timeoutMs || VPS_REQUEST_TIMEOUT_MS;
  const headers = {};

  if (options.auth !== false) {
    if (!token) {
      const error = new Error("GVG_API_TOKEN manquant cote serveur");
      error.statusCode = 500;
      throw error;
    }
    headers["X-GVG-Token"] = token;
  }

  return new Promise((resolve, reject) => {
    const url = new URL(path, `${serverUrl}/`);
    const client = url.protocol === "https:" ? https : http;
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const request = client.request(
      url,
      {
        method: "GET",
        headers,
      },
      (response) => {
        const chunks = [];

        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const buffer = Buffer.concat(chunks);

          if (response.statusCode < 200 || response.statusCode >= 300) {
            const data = parseJsonMaybe(buffer.toString("utf8"));
            const error = new Error(
              data?.error || data?.detail || `Erreur VPS ${response.statusCode}`
            );
            error.statusCode = response.statusCode;
            error.data = data;
            finish(reject, error);
            return;
          }

          finish(resolve, {
            buffer,
            contentType: response.headers["content-type"] || "",
            cacheControl: response.headers["cache-control"] || "",
          });
        });
      }
    );

    request.setTimeout(timeoutMs, () => {
      const error = new Error(`Timeout VPS apres ${timeoutMs / 1000}s`);
      error.statusCode = 504;
      request.destroy(error);
    });

    request.on("error", (error) => {
      if (!error.statusCode && /^Timeout VPS/.test(error.message)) {
        error.statusCode = 504;
      }

      finish(reject, error);
    });

    request.end();
  });
}

async function deleteVpsJob(sourceGuild, jobId) {
  const encodedGuild = encodeURIComponent(sourceGuild);
  const encodedJobId = encodeURIComponent(jobId);
  const attempts = [
    {
      path: `/api/v1/jobs/${encodedGuild}/${encodedJobId}/delete`,
      options: { method: "POST", timeoutMs: 5000 },
    },
    {
      path: `/api/v1/jobs/${encodedGuild}/${encodedJobId}`,
      options: { method: "DELETE", timeoutMs: 5000 },
    },
    {
      path: "/api/v1/jobs/delete",
      options: {
        method: "POST",
        body: {
          sourceGuild,
          guild: sourceGuild,
          jobId,
          job_id: jobId,
        },
        timeoutMs: 5000,
      },
    },
  ];

  const errors = [];
  const statuses = [];

  for (const attempt of attempts) {
    try {
      return await requestVpsJson(attempt.path, attempt.options);
    } catch (error) {
      statuses.push(Number(error.statusCode) || 0);
      errors.push(`${attempt.options.method} ${attempt.path}: ${error.message}`);
      if (![404, 405, 501, 504].includes(Number(error.statusCode))) {
        throw error;
      }
    }
  }

  if (statuses.length && statuses.every((status) => status === 404)) {
    const error = new Error("Probe introuvable ou deja supprime cote VPS.");
    error.statusCode = 404;
    throw error;
  }

  const error = new Error(
    `Suppression indisponible cote VPS : aucune route serveur ne supprime encore les probes. ${errors.join(" | ")}`
  );
  error.statusCode = 501;
  throw error;
}

async function handleJobs(req, res) {
  const rawGuild = req.query?.guild || "";
  const targetGuild = rawGuild ? normalizeTargetGuild(rawGuild) : "";

  if (rawGuild && !targetGuild) {
    return res.status(400).json({ error: "guild invalide" });
  }

  const limit = Math.min(
    Math.max(Number(req.query?.limit || 50) || 50, 1),
    100
  );

  const data = await requestVpsJson(`/api/v1/jobs?limit=${limit}`);
  const rawJobs = Array.isArray(data?.jobs) ? data.jobs : [];
  let scopedJobs = rawJobs.map(normalizeJob);

  scopedJobs = await withTimeout(
    applyLauncherSessionScopes(rawJobs),
    4500,
    scopedJobs
  );

  const jobs = filterJobsByGuild({ jobs: scopedJobs }, targetGuild);

  return res.status(200).json({
    ...data,
    jobs,
    filtered_guild: targetGuild || null,
    total_before_filter: rawJobs.length,
  });
}

async function handlePayload(req, res) {
  const guild = String(req.query?.sourceGuild || req.query?.guild || "").trim();
  const jobId = String(req.query?.jobId || req.query?.job_id || "");

  if (!isValidJobRef(guild) || !isValidJobRef(jobId)) {
    return res.status(400).json({ error: "guild ou jobId invalide" });
  }

  const data = await requestVpsJson(
    `/api/v1/jobs/${encodeURIComponent(guild)}/${encodeURIComponent(jobId)}/payload`
  );

  return res.status(200).json(data);
}

async function handlePreview(req, res) {
  const guild = String(req.query?.sourceGuild || req.query?.guild || "").trim();
  const jobId = String(req.query?.jobId || req.query?.job_id || "");
  const file = String(req.query?.file || "");

  if (!isValidJobRef(guild) || !isValidJobRef(jobId) || !isValidJobRef(file)) {
    return res.status(400).json({ error: "parametres preview invalides" });
  }

  const publicUrl = buildPublicPreviewUrl(guild, jobId, file);
  if (publicUrl) {
    return redirectToPublicAsset(res, publicUrl, "public, max-age=300");
  }

  const fileResponse = await requestVpsFile(
    `/api/v1/jobs/${encodeURIComponent(guild)}/${encodeURIComponent(jobId)}/preview/${encodeURIComponent(file)}`
  );
  const lowerFile = file.toLowerCase();
  let contentType = fileResponse.contentType || "";

  if (!contentType || contentType.includes("text/plain")) {
    if (lowerFile.endsWith(".png")) contentType = "image/png";
    else if (lowerFile.endsWith(".jpg") || lowerFile.endsWith(".jpeg")) {
      contentType = "image/jpeg";
    } else if (lowerFile.endsWith(".webp")) contentType = "image/webp";
    else contentType = "application/octet-stream";
  }

  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).send(fileResponse.buffer);
}

async function handleCalque(req, res) {
  const kind = String(req.query?.kind || "").toLowerCase();
  const file = String(req.query?.file || "");
  const folder = CALQUE_FOLDERS[kind];

  if (!folder || !isValidCalqueFile(file)) {
    return res.status(400).json({ error: "calque invalide" });
  }

  const publicUrl = buildPublicCalqueUrl(kind, file);
  if (publicUrl) {
    return redirectToPublicAsset(res, publicUrl, "public, max-age=86400, immutable");
  }

  const fileResponse = await requestVpsFile(
    `/assets/calques/${folder}/${encodeURIComponent(file)}`,
    { auth: false, timeoutMs: 8000 }
  );
  const lowerFile = file.toLowerCase();
  let contentType = fileResponse.contentType || "";

  if (!contentType || contentType.includes("text/plain")) {
    if (lowerFile.endsWith(".png")) contentType = "image/png";
    else if (lowerFile.endsWith(".jpg") || lowerFile.endsWith(".jpeg")) {
      contentType = "image/jpeg";
    } else if (lowerFile.endsWith(".webp")) contentType = "image/webp";
    else contentType = "application/octet-stream";
  }

  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");
  return res.status(200).send(fileResponse.buffer);
}

async function handleLauncherCreate(req, res) {
  const body = req.body || {};
  const sessionId = String(body.sessionId || body.session_id || "").trim();
  const guild = normalizeTargetGuild(body.guild);
  const side = String(body.side || "enemy").toLowerCase();
  const mode = String(body.mode || guild || "").toLowerCase();

  if (!isValidSessionId(sessionId) || !guild) {
    return res.status(400).json({ error: "session ou guilde invalide" });
  }

  if (!["enemy", "ally"].includes(side)) {
    return res.status(400).json({ error: "side invalide" });
  }

  const data = await requestVpsJson("/api/v1/launcher/sessions", {
    method: "POST",
    body: {
      session_id: sessionId,
      guild,
      mode,
      side,
    },
  });

  return res.status(200).json(data);
}

async function handleLauncherStatus(req, res) {
  const sessionId = String(req.query?.session || req.query?.sessionId || "").trim();

  if (!isValidSessionId(sessionId)) {
    return res.status(400).json({ error: "session invalide" });
  }

  const data = await requestVpsJson(
    `/api/v1/launcher/sessions/${encodeURIComponent(sessionId)}`,
    { timeoutMs: 5000 }
  );

  return res.status(200).json(data);
}

async function handleLauncherDownload(req, res) {
  const publicUrl = buildPublicDownloadUrl(LAUNCHER_DOWNLOAD_FILE);
  if (publicUrl) {
    return redirectToPublicAsset(res, publicUrl, "public, max-age=3600");
  }

  const fileResponse = await requestVpsFile(`/downloads/${LAUNCHER_DOWNLOAD_FILE}`, {
    auth: false,
    timeoutMs: 30000,
  });

  res.setHeader("Content-Type", fileResponse.contentType || "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${LAUNCHER_DOWNLOAD_FILE}"`
  );
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(fileResponse.buffer);
}

async function handleRecordLauncherDownload(req, res) {
  const publicUrl = buildPublicDownloadUrl(RECORD_LAUNCHER_DOWNLOAD_FILE);
  if (publicUrl) {
    return redirectToPublicAsset(res, publicUrl, "public, max-age=3600");
  }

  const fileResponse = await requestVpsFile(`/downloads/${RECORD_LAUNCHER_DOWNLOAD_FILE}`, {
    auth: false,
    timeoutMs: 30000,
  });

  res.setHeader("Content-Type", fileResponse.contentType || "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${RECORD_LAUNCHER_DOWNLOAD_FILE}"`
  );
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(fileResponse.buffer);
}

async function fetchPayload(sourceGuild, jobId) {
  if (!isValidJobRef(sourceGuild) || !isValidJobRef(jobId)) {
    const error = new Error("reference job invalide");
    error.statusCode = 400;
    throw error;
  }

  return requestVpsJson(
    `/api/v1/jobs/${encodeURIComponent(sourceGuild)}/${encodeURIComponent(jobId)}/payload`
  );
}

async function handleImport(req, res) {
  const body = req.body || {};
  const targetGuild = normalizeTargetGuild(body.targetGuild || body.guild || "");
  const sourceGuild = String(body.sourceGuild || body.resolved_guild || "").trim();
  const jobId = String(body.jobId || "");
  const side = String(body.side || "enemy").toLowerCase();

  if (!isValidGuild(targetGuild) || !isValidJobRef(sourceGuild) || !isValidJobRef(jobId)) {
    return res.status(400).json({ error: "targetGuild, sourceGuild ou jobId invalide" });
  }

  const data = await fetchPayload(sourceGuild, jobId);
  const rawItems = Array.isArray(data?.payload?.items)
    ? data.payload.items
    : Array.isArray(data?.items)
      ? data.items
      : [];

  const items = rawItems.map((item) => {
    const previewFile = item?.preview_file || item?.image_file || "";

    return {
      ...item,
      image_url: previewFile
        ? buildPublicPreviewUrl(sourceGuild, jobId, previewFile) ||
          `/api/gvg-server?action=preview&guild=${encodeURIComponent(sourceGuild)}&jobId=${encodeURIComponent(jobId)}&file=${encodeURIComponent(previewFile)}`
        : item?.image_url || null,
    };
  });

  const result = await importGvgItems({
    guild: targetGuild,
    items,
    is_ally: side === "ally",
  });

  return res.status(200).json({
    success: true,
    sourceGuild,
    jobId,
    side,
    imported: result.inserted,
    guild: result.guild,
    discord_repro: result.discord_repro || null,
  });
}

async function handleDeleteJob(req, res) {
  const body = req.method === "GET" ? req.query || {} : req.body || {};
  const sourceGuild = String(body.sourceGuild || body.resolved_guild || body.guild || "").trim();
  const jobId = String(body.jobId || body.job_id || body.resolved_job_id || "");

  if (!isValidJobRef(sourceGuild) || !isValidJobRef(jobId)) {
    return res.status(400).json({ error: "sourceGuild ou jobId invalide" });
  }

  const data = await deleteVpsJob(sourceGuild, jobId);

  return res.status(200).json({
    success: true,
    sourceGuild,
    jobId,
    server: data || null,
  });
}

async function handleDiscordReproButton(supabase, interaction) {
  const customId = interaction?.data?.custom_id || "";
  const requestId = parseRequestIdFromCustomId(customId, "gvg_repro_take:");

  if (!requestId) {
    return discordEphemeral("Bouton de repro inconnu.");
  }

  const requestRow = await getDiscordReproRequestById(supabase, requestId);
  if (!requestRow) {
    return discordEphemeral("Cette demande de repro n'existe plus.");
  }

  const user = getInteractionUser(interaction);
  const member = await resolveMemberByDiscordUser(supabase, user);

  if (!member) {
    return discordEphemeral(
      "Ton ID Discord n'est pas relie a un joueur Portal. Demande a un admin de verifier ton profil."
    );
  }

  const template = await buildReproTemplateData(supabase, {
    gvgDefenseId: requestRow.gvg_defense_id,
    memberId: member.id,
    watcherName: member.watcher_name || user?.username || "Joueur",
  });

  return buildDiscordReproModal(requestRow, member, template);
}

async function handleDiscordReproModalSubmit(supabase, interaction) {
  const customId = interaction?.data?.custom_id || "";
  const requestId = parseRequestIdFromCustomId(customId, "gvg_repro_submit:");

  if (!requestId) {
    return discordEphemeral("Modal de repro inconnu.");
  }

  try {
    await saveDiscordModalSubmission(supabase, {
      requestId,
      user: getInteractionUser(interaction),
      modalComponents: interaction?.data?.components || [],
    });

    return discordEphemeral("Repro enregistree dans Portal. Merci !");
  } catch (error) {
    console.error("[gvg-server:discord-repro-modal] save error:", error);
    return discordEphemeral(error?.message || "Impossible d'enregistrer la repro.");
  }
}

async function handleDiscordReproInteraction(req, res, supabase, rawBody) {
  if (!verifyDiscordSignature(req, rawBody)) {
    return res.status(401).json({ error: "invalid discord signature" });
  }

  let interaction = null;
  try {
    interaction = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return res.status(400).json({ error: "invalid json" });
  }

  if (interaction?.type === 1) {
    return res.status(200).json({ type: 1 });
  }

  if (interaction?.type === 3) {
    const response = await handleDiscordReproButton(supabase, interaction);
    return res.status(200).json(response);
  }

  if (interaction?.type === 5) {
    const response = await handleDiscordReproModalSubmit(supabase, interaction);
    return res.status(200).json(response);
  }

  return res.status(200).json(discordEphemeral("Interaction Discord non geree."));
}

async function handleDiscordReproInternal(req, res, supabase, rawBody) {
  const expectedTokens = [
    process.env.DISCORD_REPRO_INTERNAL_TOKEN,
    process.env.GVG_API_TOKEN,
    process.env.GVG_SERVER_TOKEN,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const receivedToken = String(getHeader(req, "x-discord-repro-token") || "").trim();

  if (!receivedToken || !expectedTokens.includes(receivedToken)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  let payload = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return res.status(400).json({ error: "invalid json" });
  }

  if (payload?.action === "reaction_add") {
    const result = await handleDiscordReproReaction(supabase, payload);
    return res.status(200).json(result);
  }

  return res.status(400).json({ error: "action invalide" });
}

async function handleDiscordRepro(req, res) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({ error: "configuration Supabase manquante" });
  }

  const rawBody = await readRawBody(req);

  if (getHeader(req, "x-discord-repro-token")) {
    return await handleDiscordReproInternal(req, res, supabase, rawBody);
  }

  return await handleDiscordReproInteraction(req, res, supabase, rawBody);
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    if (req.method !== "GET") {
      await ensureJsonBody(req);
    }

    const action = String(req.query?.action || req.body?.action || "jobs").toLowerCase();

    if (action === "discord-repro") {
      return await handleDiscordRepro(req, res);
    }

    if (req.method === "GET") {
      if (action === "jobs" || action === "list") return await handleJobs(req, res);
      if (action === "payload") return await handlePayload(req, res);
      if (action === "preview") return await handlePreview(req, res);
      if (action === "calque") return await handleCalque(req, res);
      if (action === "launcher-status") return await handleLauncherStatus(req, res);
      if (action === "launcher-download") return await handleLauncherDownload(req, res);
      if (action === "record-launcher-download") return await handleRecordLauncherDownload(req, res);

      return res.status(400).json({ error: "action GET inconnue" });
    }

    if (req.method === "POST") {
      if (action === "import") return await handleImport(req, res);
      if (action === "delete") return await handleDeleteJob(req, res);
      if (action === "launcher-create") return await handleLauncherCreate(req, res);

      return res.status(400).json({ error: "action POST inconnue" });
    }

    if (req.method === "DELETE") {
      return await handleDeleteJob(req, res);
    }

    return res.status(405).json({ error: "methode non autorisee" });
  } catch (error) {
    console.error("[gvg-server] Error:", error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "Erreur serveur",
      details: error.data || undefined,
    });
  }
}
