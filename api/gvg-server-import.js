import { importGvgItems } from "./gvg-import.js";

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

async function fetchPayload(sourceGuild, jobId) {
  const { serverUrl, token } = getServerConfig();

  if (!token) {
    const error = new Error("GVG_API_TOKEN manquant cote serveur");
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch(
    `${serverUrl}/api/v1/jobs/${encodeURIComponent(sourceGuild)}/${encodeURIComponent(jobId)}/payload`,
    {
      headers: {
        "X-GVG-Token": token,
      },
    }
  );

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    const error = new Error(`Reponse VPS non JSON (${response.status})`);
    error.statusCode = 502;
    throw error;
  }

  if (!response.ok) {
    const error = new Error(data?.detail || data?.error || `Erreur VPS ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }

  return data;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const { targetGuild, sourceGuild, jobId, side } = req.body || {};

    if (!targetGuild || !sourceGuild || !jobId) {
      return res.status(400).json({ error: "targetGuild/sourceGuild/jobId manquant" });
    }

    const data = await fetchPayload(sourceGuild, jobId);
    const items = (data?.payload?.items || []).map((item) => {
      const previewFile = item?.preview_file;
      const imageUrl = previewFile
        ? `/api/gvg-server-preview?guild=${encodeURIComponent(sourceGuild)}&jobId=${encodeURIComponent(jobId)}&file=${encodeURIComponent(previewFile)}`
        : null;

      return {
        ...item,
        image_url: imageUrl,
      };
    });

    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "payload VPS vide ou invalide" });
    }

    const importResult = await importGvgItems({
      guild: targetGuild,
      items,
      is_ally: side === "ally",
    });

    return res.status(200).json({
      success: true,
      sourceGuild,
      jobId,
      side,
      imported: importResult.inserted,
      guild: importResult.guild,
    });
  } catch (error) {
    console.error("[gvg-server-import]", error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "server error",
    });
  }
}
