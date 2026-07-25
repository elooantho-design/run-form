/* global Buffer, process */
import { createClient } from "@supabase/supabase-js";
import formidable from "formidable";
import fs from "fs";
import {
  applyPortalCorsHeaders,
  getPortalMemberName,
  requirePortalSession,
  requirePortalLeaderSession,
  sendPortalJson,
  verifyCurrentPortalPasswordForSession,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const DEFAULT_GVG_SERVER_URL = "http://152.228.128.157";
const HERO_CALQUE_FOLDER = "hero-calques";
const HERO_CALQUE_MAX_BYTES = 2 * 1024 * 1024;
const HERO_CALQUE_UPLOAD_ENDPOINTS = [
  "/api/v1/calques/hero-calques/base64",
];
const ALLOWED_RARITIES = new Set(["legendary", "epic", "rare", "ordinary", "basic"]);
const ALLOWED_ROLES = new Set(["combattant", "heal", "soigneur", "mage", "tacticien", "tank", "tireur"]);
const ALLOWED_FACTIONS = new Set([
  "arbitre",
  "cauchemar",
  "chaotique",
  "cultiste",
  "esoterique",
  "infernal",
  "innommable",
  "nordiste",
  "perceur",
  "sentinelle",
]);
const ALLOWED_LORD_VALUES = new Set(["lord", "non-lord"]);

function sendJson(res, status, payload) {
  sendPortalJson(res, status, payload, res._portalReq || null);
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeText(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function parseJsonMaybe(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function normalizeFields(fields) {
  const body = {};

  Object.entries(fields || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      body[key] = value.length === 1 ? value[0] : value;
      return;
    }

    body[key] = value;
  });

  return body;
}

function getUploadedFile(files, names) {
  for (const name of names) {
    const value = files?.[name];
    if (!value) continue;
    if (Array.isArray(value)) return value[0] || null;
    return value;
  }

  return null;
}

function parseMultipart(req) {
  const form = formidable({
    multiples: false,
    allowEmptyFiles: false,
    maxFileSize: HERO_CALQUE_MAX_BYTES + 512 * 1024,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({
        body: normalizeFields(fields),
        heroCalqueFile: getUploadedFile(files, ["heroCalque", "hero_calque", "calque", "file"]),
      });
    });
  });
}

async function readRequestPayload(req) {
  const contentType = String(req.headers?.["content-type"] || "").toLowerCase();

  if (contentType.includes("multipart/form-data")) {
    return parseMultipart(req);
  }

  return {
    body: await readBody(req),
    heroCalqueFile: null,
  };
}

async function requireLeader(req, adminPassword) {
  if (!adminPassword) {
    return { error: "Mot de passe leader obligatoire.", status: 401 };
  }

  const sessionCheck = await requirePortalLeaderSession(req, supabase, { includePassword: true });
  if (sessionCheck.error) return sessionCheck;

  const passwordCheck = await verifyCurrentPortalPasswordForSession(
    supabase,
    sessionCheck.member,
    adminPassword
  );

  if (passwordCheck.error) return passwordCheck;
  if (passwordCheck.updatedMember) sessionCheck.member = passwordCheck.updatedMember;

  return { admin: sessionCheck.member };
}

function normalizeList(values, allowedValues) {
  if (typeof values === "string") {
    const trimmed = values.trim();

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return normalizeList(parsed, allowedValues);
      } catch {
        // Fall back to separator parsing below.
      }
    }
  }

  const items = Array.isArray(values)
    ? values
    : cleanText(values)
        .split(/[;,|]/)
        .map((item) => item.trim());

  return [
    ...new Set(
      items
        .map((item) => normalizeText(item))
        .filter((item) => item && allowedValues.has(item))
    ),
  ];
}

function normalizeHeroCalqueFileName(value) {
  const rawValue = cleanText(value);
  if (!rawValue) return "";

  const withoutQuery = rawValue.split(/[?#]/)[0];
  const fileName = withoutQuery.split(/[\\/]/).filter(Boolean).pop() || withoutQuery;
  const baseName = fileName.replace(/\.[a-z0-9]+$/i, "").trim();

  return baseName ? `${baseName}.png` : "";
}

function isValidHeroCalqueFileName(value) {
  return /^[A-Za-z0-9À-ÖØ-öø-ÿ ._'()-]{1,180}\.png$/u.test(cleanText(value));
}

function getGvgServerConfig() {
  const serverUrl = String(
    process.env.GVG_SERVER_URL ||
      process.env.GVG_VPS_URL ||
      DEFAULT_GVG_SERVER_URL
  ).replace(/\/$/, "");
  const token = process.env.GVG_API_TOKEN || process.env.GVG_SERVER_TOKEN || "";

  return { serverUrl, token };
}

async function uploadHeroCalqueToVps({ fileName, buffer }) {
  const { serverUrl, token } = getGvgServerConfig();

  if (!token) {
    const error = new Error("GVG_API_TOKEN manquant cote serveur.");
    error.statusCode = 500;
    throw error;
  }

  const attempts = [];

  for (const endpoint of HERO_CALQUE_UPLOAD_ENDPOINTS) {
    const body = JSON.stringify({
      kind: "hero",
      folder: HERO_CALQUE_FOLDER,
      fileName,
      file_name: fileName,
      content_base64: buffer.toString("base64"),
    });

    const response = await fetch(new URL(endpoint, `${serverUrl}/`).toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GVG-Token": token,
      },
      body,
    });

    const text = await response.text();
    const data = parseJsonMaybe(text);

    if (response.ok) {
      return {
        endpoint,
        response: data,
      };
    }

    attempts.push({
      endpoint,
      status: response.status,
      error: data?.detail || data?.error || data?.raw || `Erreur VPS ${response.status}`,
    });

    if (![404, 405, 501].includes(response.status)) {
      const error = new Error(
        data?.detail || data?.error || `Upload hero-calques refuse par le VPS (${response.status}).`
      );
      error.statusCode = response.status;
      error.data = data;
      throw error;
    }
  }

  const error = new Error(
    "Upload hero-calques indisponible cote VPS : la route base64 d'ecriture n'a pas repondu."
  );
  error.statusCode = 501;
  error.data = { attempts };
  throw error;
}

async function prepareHeroCalque(file, expectedFileName) {
  if (!file) {
    const error = new Error("Calque hero-calc obligatoire.");
    error.statusCode = 400;
    throw error;
  }

  if (!isValidHeroCalqueFileName(expectedFileName)) {
    const error = new Error("Nom de calque hero-calc invalide.");
    error.statusCode = 400;
    throw error;
  }

  const buffer = fs.readFileSync(file.filepath);

  if (!buffer.length) {
    const error = new Error("Calque hero-calc vide.");
    error.statusCode = 400;
    throw error;
  }

  if (buffer.length > HERO_CALQUE_MAX_BYTES) {
    const error = new Error("Calque hero-calc trop lourd apres compression. Seuil max : 2 Mo.");
    error.statusCode = 413;
    throw error;
  }

  return {
    fileName: expectedFileName,
    bytes: buffer.length,
    buffer,
  };
}

async function handleCreate(body, heroCalqueFile, res) {
  const adminPassword = cleanText(body.adminPassword || body.admin_password);
  const adminCheck = await requireLeader(res._portalReq, adminPassword);

  if (adminCheck.error) {
    sendJson(res, adminCheck.status, { error: adminCheck.error });
    return;
  }

  const name = cleanText(body.name);
  const portalName = cleanText(body.portalName || body.PortalName || body.portal_name);
  const rarity = normalizeText(body.rarity || body.Rarity);
  const role = normalizeText(body.role);
  const factions = normalizeList(body.factions || body.faction, ALLOWED_FACTIONS);
  const lord = normalizeText(body.lord || "non-lord");
  const expectedCalqueFileName = normalizeHeroCalqueFileName(portalName);

  if (!name || !portalName) {
    sendJson(res, 400, { error: "Name technique et PortalName sont obligatoires." });
    return;
  }

  if (!ALLOWED_RARITIES.has(rarity)) {
    sendJson(res, 400, { error: "Rarete invalide." });
    return;
  }

  if (!ALLOWED_ROLES.has(role)) {
    sendJson(res, 400, { error: "Role invalide." });
    return;
  }

  if (factions.length === 0) {
    sendJson(res, 400, { error: "Faction invalide." });
    return;
  }

  if (!ALLOWED_LORD_VALUES.has(lord)) {
    sendJson(res, 400, { error: "Valeur lord invalide." });
    return;
  }

  if (!isValidHeroCalqueFileName(expectedCalqueFileName)) {
    sendJson(res, 400, { error: "PortalName incompatible avec le nom de fichier hero-calc." });
    return;
  }

  const { data: existingTechnical, error: existingTechnicalError } = await supabase
    .from("champions")
    .select("id, name, portal_name")
    .eq("name", name)
    .maybeSingle();

  if (existingTechnicalError) {
    sendJson(res, 500, { error: existingTechnicalError.message || "Verification champion impossible." });
    return;
  }

  if (existingTechnical) {
    sendJson(res, 409, { error: `Le name technique existe deja : ${existingTechnical.name}.` });
    return;
  }

  const { data: existingPortal, error: existingPortalError } = await supabase
    .from("champions")
    .select("id, name, portal_name")
    .eq("portal_name", portalName)
    .maybeSingle();

  if (existingPortalError) {
    sendJson(res, 500, { error: existingPortalError.message || "Verification PortalName impossible." });
    return;
  }

  if (existingPortal) {
    sendJson(res, 409, { error: `Le PortalName existe deja : ${existingPortal.portal_name}.` });
    return;
  }

  let preparedCalque;
  try {
    preparedCalque = await prepareHeroCalque(heroCalqueFile, expectedCalqueFileName);
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || "Calque hero-calc invalide." });
    return;
  }

  let vpsUpload;
  try {
    vpsUpload = await uploadHeroCalqueToVps(preparedCalque);
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.message || "Upload hero-calques impossible.",
      details: error.data || undefined,
    });
    return;
  }

  const payload = {
    name,
    portal_name: portalName,
    rarity,
    role,
    faction: factions.join(";"),
    lord,
  };

  const { data, error } = await supabase
    .from("champions")
    .insert(payload)
    .select("id, name, portal_name, rarity, role, faction, lord")
    .single();

  if (error) {
    sendJson(res, 500, { error: error.message || "Creation du champion impossible." });
    return;
  }

  const adminName = getPortalMemberName(adminCheck.admin);

  await supabase.from("portal_activity_logs").insert({
    actor_member_id: adminCheck.admin.id,
    actor_name: adminName,
    target_member_id: null,
    target_name: portalName,
    action_type: "champion_create",
    entity_type: "champions",
    entity_id: data.id,
    summary: `${adminName} a ajoute le heros ${portalName}`,
    metadata: {
      name,
      portal_name: portalName,
      rarity,
      role,
      faction: factions,
      lord,
      hero_calque_file: preparedCalque.fileName,
      hero_calque_bytes: preparedCalque.bytes,
    },
  });

  sendJson(res, 201, {
    champion: data,
    calque: {
      fileName: preparedCalque.fileName,
      bytes: preparedCalque.bytes,
      vps: vpsUpload,
    },
  });
}

async function handleList(req, res) {
  const sessionCheck = await requirePortalSession(req, supabase);
  if (sessionCheck.error) {
    sendJson(res, sessionCheck.status, { error: sessionCheck.error });
    return;
  }

  const { data, error } = await supabase
    .from("champions")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    sendJson(res, 500, { error: error.message || "Chargement champions impossible." });
    return;
  }

  sendJson(res, 200, { champions: data || [] });
}

export default async function handler(req, res) {
  res._portalReq = req;
  applyPortalCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    if (!verifyPortalRequestOrigin(req)) {
      sendJson(res, 403, { error: "Origine de requete refusee." });
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    const { body, heroCalqueFile } = await readRequestPayload(req);
    const action = cleanText(body.action || "create");

    if (action === "list") {
      await handleList(req, res);
      return;
    }

    if (action === "create") {
      await handleCreate(body, heroCalqueFile, res);
      return;
    }

    sendJson(res, 400, { error: "Action inconnue." });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || "Erreur portal champions." });
  }
}
