import { importGvgItems } from "./gvg-import.js";
import http from "node:http";
import https from "node:https";

const DEFAULT_GVG_SERVER_URL = "http://152.228.128.157";
const VPS_REQUEST_TIMEOUT_MS = 12000;
const CALQUE_FOLDERS = {
  hero: "hero-calques",
  faction: "faction-calques",
  role: "role-calques",
};
const LAUNCHER_DOWNLOAD_FILE = "PaladinGVGLauncher.zip";
const RECORD_LAUNCHER_DOWNLOAD_FILE = "PaladinGVGRecordLauncher.zip";

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-GVG-Token");
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

function normalizeGuildCode(value) {
  const code = String(value || "").trim().toUpperCase();
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

function filterJobsByGuild(data, guild) {
  const jobs = Array.isArray(data?.jobs) ? data.jobs.map(normalizeJob) : [];
  if (!guild) return jobs;

  const wanted = String(guild).toUpperCase();
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
  const targetGuild = String(req.query?.guild || "").toUpperCase();

  if (targetGuild && !isValidGuild(targetGuild)) {
    return res.status(400).json({ error: "guild invalide" });
  }

  const limit = Math.min(
    Math.max(Number(req.query?.limit || 50) || 50, 1),
    100
  );

  const data = await requestVpsJson(`/api/v1/jobs?limit=${limit}`);
  const jobs = filterJobsByGuild(data, targetGuild);

  return res.status(200).json({
    ...data,
    jobs,
    filtered_guild: targetGuild || null,
    total_before_filter: Array.isArray(data?.jobs) ? data.jobs.length : 0,
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
  const targetGuild = String(body.targetGuild || body.guild || "").toUpperCase();
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
        ? `/api/gvg-server?action=preview&guild=${encodeURIComponent(sourceGuild)}&jobId=${encodeURIComponent(jobId)}&file=${encodeURIComponent(previewFile)}`
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

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const action = String(req.query?.action || req.body?.action || "jobs").toLowerCase();

  try {
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
