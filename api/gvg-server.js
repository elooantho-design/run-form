import { importGvgItems } from "./gvg-import.js";

const DEFAULT_GVG_SERVER_URL = "http://152.228.128.157";

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
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

function isValidGuild(value) {
  return /^G[1-7]$/.test(String(value || "").toUpperCase());
}

function getJobGuildCode(job) {
  return String(job?.mode || job?.guild || "").toUpperCase();
}

function filterJobsByGuild(data, guild) {
  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
  if (!guild) return jobs;

  const wanted = String(guild).toUpperCase();
  return jobs.filter((job) => getJobGuildCode(job) === wanted);
}

async function requestVpsJson(path) {
  const { serverUrl, token } = getServerConfig();

  if (!token) {
    const error = new Error("GVG_API_TOKEN manquant cote serveur");
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch(`${serverUrl}${path}`, {
    headers: {
      "X-GVG-Token": token,
    },
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(data?.error || `Erreur VPS ${response.status}`);
    error.statusCode = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function requestVpsResponse(path) {
  const { serverUrl, token } = getServerConfig();

  if (!token) {
    const error = new Error("GVG_API_TOKEN manquant cote serveur");
    error.statusCode = 500;
    throw error;
  }

  return fetch(`${serverUrl}${path}`, {
    headers: {
      "X-GVG-Token": token,
    },
  });
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
  const guild = String(req.query?.guild || "").toUpperCase();
  const jobId = String(req.query?.jobId || req.query?.job_id || "");

  if (!isValidGuild(guild) || !jobId) {
    return res.status(400).json({ error: "guild ou jobId invalide" });
  }

  const data = await requestVpsJson(
    `/api/v1/jobs/${encodeURIComponent(guild)}/${encodeURIComponent(jobId)}/payload`
  );

  return res.status(200).json(data);
}

async function handlePreview(req, res) {
  const guild = String(req.query?.guild || "").toUpperCase();
  const jobId = String(req.query?.jobId || req.query?.job_id || "");
  const file = String(req.query?.file || "");

  if (!isValidGuild(guild) || !jobId || !file) {
    return res.status(400).json({ error: "parametres preview invalides" });
  }

  const response = await requestVpsResponse(
    `/api/v1/jobs/${encodeURIComponent(guild)}/${encodeURIComponent(jobId)}/preview/${encodeURIComponent(file)}`
  );

  if (!response.ok) {
    const text = await response.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    return res
      .status(response.status)
      .json({ error: data?.error || `Erreur preview VPS ${response.status}` });
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const lowerFile = file.toLowerCase();
  let contentType = response.headers.get("content-type") || "";

  if (!contentType || contentType.includes("text/plain")) {
    if (lowerFile.endsWith(".png")) contentType = "image/png";
    else if (lowerFile.endsWith(".jpg") || lowerFile.endsWith(".jpeg")) {
      contentType = "image/jpeg";
    } else if (lowerFile.endsWith(".webp")) contentType = "image/webp";
    else contentType = "application/octet-stream";
  }

  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).send(buffer);
}

async function fetchPayload(sourceGuild, jobId) {
  return requestVpsJson(
    `/api/v1/jobs/${encodeURIComponent(sourceGuild)}/${encodeURIComponent(jobId)}/payload`
  );
}

async function handleImport(req, res) {
  const body = req.body || {};
  const targetGuild = String(body.targetGuild || body.guild || "").toUpperCase();
  const sourceGuild = String(body.sourceGuild || "").toUpperCase();
  const jobId = String(body.jobId || "");
  const side = String(body.side || "enemy").toLowerCase();

  if (!isValidGuild(targetGuild) || !isValidGuild(sourceGuild) || !jobId) {
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

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const action = String(req.query?.action || req.body?.action || "jobs").toLowerCase();

  try {
    if (req.method === "GET") {
      if (action === "jobs" || action === "list") return handleJobs(req, res);
      if (action === "payload") return handlePayload(req, res);
      if (action === "preview") return handlePreview(req, res);

      return res.status(400).json({ error: "action GET inconnue" });
    }

    if (req.method === "POST") {
      if (action === "import") return handleImport(req, res);

      return res.status(400).json({ error: "action POST inconnue" });
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
