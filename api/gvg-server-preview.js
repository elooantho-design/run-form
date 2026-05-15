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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const { serverUrl, token } = getServerConfig();

    if (!token) {
      return res.status(500).json({ error: "GVG_API_TOKEN manquant cote serveur" });
    }

    const guild = String(req.query?.guild || "");
    const jobId = String(req.query?.jobId || "");
    const file = String(req.query?.file || "");

    if (!guild || !jobId || !file) {
      return res.status(400).json({ error: "guild/jobId/file manquant" });
    }

    const response = await fetch(
      `${serverUrl}/api/v1/jobs/${encodeURIComponent(guild)}/${encodeURIComponent(jobId)}/preview/${encodeURIComponent(file)}`,
      {
        headers: {
          "X-GVG-Token": token,
        },
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: `preview VPS introuvable (${response.status})` });
    }

    let contentType = response.headers.get("content-type") || "";
    if (!contentType || contentType.startsWith("text/plain")) {
      const lowerFile = file.toLowerCase();
      if (lowerFile.endsWith(".png")) contentType = "image/png";
      else if (lowerFile.endsWith(".jpg") || lowerFile.endsWith(".jpeg")) contentType = "image/jpeg";
      else contentType = "image/webp";
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("[gvg-server-preview]", error);
    return res.status(500).json({ error: error.message || "server error" });
  }
}
