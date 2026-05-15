import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const projectDir = process.cwd();
const port = Number(process.env.PORT || 3000);

function loadEnvFile(fileName) {
  const filePath = path.join(projectDir, fileName);
  if (!fs.existsSync(filePath)) return;

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1).replace(/^"|"$/g, "");

    process.env[key] = value;
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function shouldParseBody(req) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!contentType) return false;
  return (
    contentType.includes("application/json") ||
    contentType.includes("application/x-www-form-urlencoded")
  );
}

async function attachBody(req) {
  if (!shouldParseBody(req)) return;

  const bodyBuffer = await readBody(req);
  const rawBody = bodyBuffer.toString("utf8");

  if (!rawBody) {
    req.body = {};
    return;
  }

  const contentType = String(req.headers["content-type"] || "").toLowerCase();

  if (contentType.includes("application/json")) {
    req.body = JSON.parse(rawBody);
    return;
  }

  req.body = Object.fromEntries(new URLSearchParams(rawBody));
}

function attachResponseHelpers(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };

  res.json = (payload) => {
    if (!res.headersSent) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
    }

    res.end(JSON.stringify(payload));
  };

  res.send = (payload) => {
    if (Buffer.isBuffer(payload) || typeof payload === "string") {
      res.end(payload);
      return;
    }

    res.json(payload);
  };
}

async function handleRequest(req, res) {
  attachResponseHelpers(res);

  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (!requestUrl.pathname.startsWith("/api/")) {
    res.status(404).json({ error: "Route API introuvable" });
    return;
  }

  const routeName = requestUrl.pathname
    .slice("/api/".length)
    .replace(/\/$/, "");
  const handlerPath = path.join(projectDir, "api", `${routeName}.js`);

  if (!fs.existsSync(handlerPath)) {
    res.status(404).json({ error: `Handler API introuvable: ${routeName}` });
    return;
  }

  req.query = Object.fromEntries(requestUrl.searchParams.entries());

  try {
    await attachBody(req);

    const moduleUrl = `${pathToFileURL(handlerPath).href}?t=${Date.now()}`;
    const { default: handler } = await import(moduleUrl);

    await handler(req, res);

    if (!res.writableEnded) {
      res.end();
    }
  } catch (error) {
    console.error(`[dev-api] ${routeName}`, error);

    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "Erreur API locale" });
      return;
    }

    res.end();
  }
}

const server = http.createServer(handleRequest);

server.listen(port, () => {
  console.log(`API locale Paladin Control sur http://localhost:${port}`);
});
