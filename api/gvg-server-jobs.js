const DEFAULT_GVG_SERVER_URL = "http://152.228.128.157";

function getServerConfig() {
  const serverUrl = (
    process.env.GVG_SERVER_URL ||
    process.env.GVG_VPS_URL ||
    DEFAULT_GVG_SERVER_URL
  ).replace(/\/$/, "");
  const token = process.env.GVG_API_TOKEN || process.env.GVG_SERVER_TOKEN || "";
  return { serverUrl, token };
}

async function requestVps(path) {
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
    const error = new Error(`Reponse VPS non JSON (${response.status})`);
    error.statusCode = 502;
    error.rawText = text;
    throw error;
  }

  if (!response.ok) {
    const error = new Error(data?.detail || data?.error || `Erreur VPS ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }

  return data;
}

function isValidGuild(value) {
  return /^G[1-7]$/.test(String(value || "").toUpperCase());
}

function getJobGuildCode(job) {
  return String(job?.mode || job?.guild || "").toUpperCase();
}

function filterJobsByGuild(data, guild) {
  if (!guild || !Array.isArray(data?.jobs)) return data;

  const jobs = data.jobs.filter((job) => getJobGuildCode(job) === guild);

  return {
    ...data,
    jobs,
    target_guild: guild,
    hidden_count: data.jobs.length - jobs.length,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const action = String(req.query?.action || "list");

    if (action === "payload") {
      const guild = encodeURIComponent(String(req.query?.guild || ""));
      const jobId = encodeURIComponent(String(req.query?.jobId || ""));

      if (!guild || !jobId) {
        return res.status(400).json({ error: "guild/jobId manquant" });
      }

      const data = await requestVps(`/api/v1/jobs/${guild}/${jobId}/payload`);
      return res.status(200).json(data);
    }

    const targetGuild = String(req.query?.guild || "").toUpperCase();

    if (targetGuild && !isValidGuild(targetGuild)) {
      return res.status(400).json({ error: "guild manquante ou invalide" });
    }

    const limit = Math.max(1, Math.min(Number(req.query?.limit || 25), 100));
    const data = await requestVps(`/api/v1/jobs?limit=${limit}`);
    return res.status(200).json(filterJobsByGuild(data, targetGuild));
  } catch (error) {
    console.error("[gvg-server-jobs]", error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "server error",
    });
  }
}
