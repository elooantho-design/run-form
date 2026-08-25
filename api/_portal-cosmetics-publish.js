/* global Buffer, process */
import crypto from "node:crypto";
import zlib from "node:zlib";
import {
  PROFILE_COSMETIC_AVATAR,
  PROFILE_COSMETIC_FRAME,
  cleanProfileCosmeticText,
  normalizeFrameRenderMetadataForStorage,
  normalizeProfileCosmeticMetadata,
  normalizeProfileCosmeticType,
} from "../src/lib/profileCosmetics.js";
import {
  PROFILE_COSMETIC_ASSET_SELECT,
  loadProfileCosmeticsState,
  serializeProfileCosmeticAsset,
} from "./_portal-cosmetics.js";

const TARGET_COSMETIC_SIZE = 1024;
const MAX_NORMALIZED_PNG_BYTES = 2_750_000;
const MAX_BASE64_CHARS = 3_750_000;
const PROFILE_COSMETIC_EFFECT = "effect";
const PROFILE_COSMETIC_EFFECTS_FOLDER = "effects";
const MAX_ANIMATED_WEBP_BYTES = 5 * 1024 * 1024;
const MAX_WEBP_BASE64_CHARS = 7_000_000;
const DEFAULT_GVG_SERVER_URL = "http://152.228.128.157";
const DEFAULT_PUBLIC_COSMETICS_BASE_URL = "https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics";
const DEFAULT_UPLOAD_ENDPOINT_TEMPLATE = "/api/v1/profile-cosmetics/{assetType}/base64";
const DEFAULT_EFFECT_UPLOAD_ENDPOINT_TEMPLATE = "/api/v1/profile-cosmetics/effects/base64";
const SAFE_COLLECTION_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;

function createPublishError(step, message, statusCode = 400) {
  const error = new Error(message);
  error.step = step;
  error.statusCode = statusCode;
  return error;
}

function assertAllowedKeys(payload, allowedKeys, path = "payload") {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  for (const key of Object.keys(source)) {
    if (!allowedKeys.has(key)) {
      throw createPublishError("validation", `${path}.${key} n'est pas autorise.`);
    }
  }
}

function decodePngPayload(body = {}) {
  const rawDataUrl = String(body.pngDataUrl || body.png_data_url || "").trim();
  const rawBase64 = String(body.pngBase64 || body.png_base64 || "").trim();
  let base64 = rawBase64;

  if (rawDataUrl) {
    const match = rawDataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      throw createPublishError("validation", "Le fichier normalise doit etre un PNG en base64.");
    }
    base64 = match[1];
  }

  if (!base64 || base64.length > MAX_BASE64_CHARS || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
    throw createPublishError("validation", "Payload PNG absent ou trop volumineux.");
  }

  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || buffer.length > MAX_NORMALIZED_PNG_BYTES) {
    throw createPublishError("validation", "PNG normalise absent ou trop volumineux.");
  }
  return buffer;
}

function decodeWebpPayload(body = {}) {
  const rawDataUrl = String(body.webpDataUrl || body.webp_data_url || "").trim();
  const rawBase64 = String(body.webpBase64 || body.webp_base64 || body.contentBase64 || body.content_base64 || "").trim();
  const mimeType = cleanProfileCosmeticText(body.mimeType || body.mime_type || body.contentType || body.content_type, 80).toLowerCase();
  let base64 = rawBase64;

  if (mimeType && mimeType !== "image/webp") {
    throw createPublishError("validation", "Le fichier doit etre un WebP anime.");
  }

  if (rawDataUrl) {
    const match = rawDataUrl.match(/^data:(image\/webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      throw createPublishError("validation", "Le fichier doit etre un WebP anime en base64.");
    }
    base64 = match[2];
  }

  if (!mimeType && !rawDataUrl) {
    throw createPublishError("validation", "Le type MIME image/webp est obligatoire.");
  }

  if (!base64 || base64.length > MAX_WEBP_BASE64_CHARS || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
    throw createPublishError("validation", "Payload WebP absent ou trop volumineux.");
  }

  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || buffer.length > MAX_ANIMATED_WEBP_BYTES) {
    throw createPublishError("validation", "WebP absent ou trop volumineux.");
  }

  const expectedSize = Number(body.size || body.bytes || body.fileSize || body.file_size || 0);
  if (expectedSize && expectedSize !== buffer.length) {
    throw createPublishError("validation", "Taille WebP incoherente.");
  }

  return buffer;
}

function readPngChunks(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(signature)) {
    throw createPublishError("validation", "Le fichier n'est pas un PNG valide.");
  }

  let offset = 8;
  let ihdr = null;
  const idatChunks = [];
  let hasIend = false;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const nextOffset = dataEnd + 4;
    if (dataEnd > buffer.length || nextOffset > buffer.length) {
      throw createPublishError("validation", "PNG tronque.");
    }

    const data = buffer.subarray(dataStart, dataEnd);
    if (type === "IHDR") ihdr = data;
    if (type === "IDAT") idatChunks.push(data);
    if (type === "IEND") {
      hasIend = true;
      break;
    }
    offset = nextOffset;
  }

  if (!ihdr || ihdr.length !== 13 || !hasIend || !idatChunks.length) {
    throw createPublishError("validation", "PNG incomplet.");
  }

  return { ihdr, idatChunks };
}

function getPngChannelCount(colorType) {
  if (colorType === 0) return 1;
  if (colorType === 2) return 3;
  if (colorType === 3) return 1;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  return 0;
}

function unfilterScanline(filter, current, previous, bytesPerPixel) {
  for (let index = 0; index < current.length; index += 1) {
    const left = index >= bytesPerPixel ? current[index - bytesPerPixel] : 0;
    const up = previous ? previous[index] : 0;
    const upLeft = previous && index >= bytesPerPixel ? previous[index - bytesPerPixel] : 0;
    let value = current[index];

    if (filter === 1) value = (value + left) & 0xff;
    else if (filter === 2) value = (value + up) & 0xff;
    else if (filter === 3) value = (value + Math.floor((left + up) / 2)) & 0xff;
    else if (filter === 4) {
      const p = left + up - upLeft;
      const pa = Math.abs(p - left);
      const pb = Math.abs(p - up);
      const pc = Math.abs(p - upLeft);
      const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      value = (value + predictor) & 0xff;
    } else if (filter !== 0) {
      throw createPublishError("validation", "Filtre PNG non supporte.");
    }

    current[index] = value;
  }
  return current;
}

function readAlphaStats(buffer, { width, height, bitDepth, colorType }) {
  if (![4, 6].includes(colorType)) return { hasAlphaChannel: false, hasVisiblePixels: false, hasTransparentPixels: false };
  if (bitDepth !== 8) {
    throw createPublishError("validation", "Les cadres doivent etre des PNG 8 bits avec alpha.");
  }

  const { idatChunks } = readPngChunks(buffer);
  const channels = getPngChannelCount(colorType);
  const rowBytes = width * channels;
  const bytesPerPixel = channels;
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const expectedBytes = (rowBytes + 1) * height;
  if (inflated.length < expectedBytes) {
    throw createPublishError("validation", "Donnees PNG compressees incompletes.");
  }

  let previous = null;
  let hasVisiblePixels = false;
  let hasTransparentPixels = false;
  const alphaOffset = colorType === 6 ? 3 : 1;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (rowBytes + 1);
    const filter = inflated[rowOffset];
    const row = Buffer.from(inflated.subarray(rowOffset + 1, rowOffset + 1 + rowBytes));
    const current = unfilterScanline(filter, row, previous, bytesPerPixel);

    for (let x = alphaOffset; x < current.length; x += channels) {
      const alpha = current[x];
      if (alpha > 8) hasVisiblePixels = true;
      if (alpha < 250) hasTransparentPixels = true;
      if (hasVisiblePixels && hasTransparentPixels) break;
    }
    previous = current;
    if (hasVisiblePixels && hasTransparentPixels) break;
  }

  return { hasAlphaChannel: true, hasVisiblePixels, hasTransparentPixels };
}

export function inspectPngBuffer(buffer, options = {}) {
  const { ihdr } = readPngChunks(buffer);
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const channels = getPngChannelCount(colorType);
  if (!channels) throw createPublishError("validation", "Type de couleur PNG non supporte.");

  const hasAlphaChannel = [4, 6].includes(colorType);
  const info = {
    width,
    height,
    bitDepth,
    colorType,
    bytes: buffer.length,
    hasAlphaChannel,
    hasVisiblePixels: true,
    hasTransparentPixels: false,
  };

  if (options.requireAlpha) {
    const alphaStats = readAlphaStats(buffer, info);
    Object.assign(info, alphaStats);
    if (!alphaStats.hasAlphaChannel || !alphaStats.hasVisiblePixels || !alphaStats.hasTransparentPixels) {
      throw createPublishError("validation", "Un cadre doit etre un PNG avec canal alpha et transparence.");
    }
  }

  return info;
}

export function inspectWebpBuffer(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20) {
    throw createPublishError("validation", "Le fichier n'est pas un WebP valide.");
  }
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    throw createPublishError("validation", "Le fichier n'est pas un WebP valide.");
  }

  const riffSize = buffer.readUInt32LE(4);
  const riffEnd = riffSize + 8;
  if (riffEnd > buffer.length) {
    throw createPublishError("validation", "WebP tronque.");
  }

  const chunks = [];
  let offset = 12;
  while (offset + 8 <= riffEnd) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    const nextOffset = dataEnd + (size % 2);
    if (dataEnd > riffEnd || nextOffset > buffer.length) {
      throw createPublishError("validation", "Chunk WebP tronque.");
    }
    chunks.push(type);
    offset = nextOffset;
  }

  const hasImageChunk = chunks.some((chunk) => ["VP8 ", "VP8L", "VP8X"].includes(chunk));
  if (!hasImageChunk) {
    throw createPublishError("validation", "WebP incomplet.");
  }

  const hasAnimation = chunks.includes("ANIM") || chunks.includes("ANMF");
  if (options.requireAnimation && !hasAnimation) {
    throw createPublishError("validation", "Le WebP doit contenir une animation.");
  }

  return {
    bytes: buffer.length,
    chunks,
    hasAnimation,
  };
}

function getServerConfig() {
  const serverUrl = String(process.env.GVG_SERVER_URL || process.env.GVG_VPS_URL || DEFAULT_GVG_SERVER_URL).replace(/\/$/, "");
  const token = process.env.GVG_API_TOKEN || process.env.GVG_SERVER_TOKEN || "";
  const endpointTemplate = process.env.PROFILE_COSMETICS_UPLOAD_ENDPOINT_TEMPLATE || DEFAULT_UPLOAD_ENDPOINT_TEMPLATE;
  const publicBaseUrl = String(process.env.PROFILE_COSMETICS_PUBLIC_BASE_URL || DEFAULT_PUBLIC_COSMETICS_BASE_URL).replace(/\/$/, "");
  return { serverUrl, token, endpointTemplate, publicBaseUrl };
}

function parseJsonMaybe(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

function getResponseValue(object, names, fallback = null) {
  for (const name of names) {
    if (object?.[name] !== undefined && object?.[name] !== null) return object[name];
  }
  return fallback;
}

async function uploadCosmeticToVps({ assetType, fileName, buffer, sha256 }) {
  const { serverUrl, token, endpointTemplate } = getServerConfig();
  if (!token) {
    throw createPublishError("upload VPS", "Token VPS manquant cote serveur.", 500);
  }

  const endpoint = new URL(
    endpointTemplate.replace("{assetType}", encodeURIComponent(assetType)).replace(/^\/+/, ""),
    `${serverUrl}/`,
  ).toString();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GVG-Token": token,
    },
    body: JSON.stringify({
      asset_type: assetType,
      fileName,
      file_name: fileName,
      content_base64: buffer.toString("base64"),
    }),
  });
  const text = await response.text();
  const data = parseJsonMaybe(text);

  if (!response.ok) {
    throw createPublishError("upload VPS", data?.detail || data?.error || `Upload VPS refuse (${response.status}).`, response.status);
  }

  const responseType = cleanProfileCosmeticText(getResponseValue(data, ["asset_type", "assetType"]));
  const responseFileName = cleanProfileCosmeticText(getResponseValue(data, ["filename", "file_name", "fileName"]));
  const responsePublicUrl = cleanProfileCosmeticText(getResponseValue(data, ["public_url", "publicUrl", "url", "asset_url", "assetUrl"], ""), 500);
  const expectedPublicUrl = buildPublicCosmeticUrl(assetType, fileName);
  const normalizedResponsePublicUrl = assertAllowedPublicCosmeticUrl(responsePublicUrl, { assetType, fileName });
  const responseSha = cleanProfileCosmeticText(getResponseValue(data, ["sha256"])).toLowerCase();
  const responseWidth = Number(getResponseValue(data, ["width"], 0));
  const responseHeight = Number(getResponseValue(data, ["height"], 0));
  const responseSize = Number(getResponseValue(data, ["size"], 0));
  const responseOk = Boolean(getResponseValue(data, ["success", "ok"], false));

  if (
    !responseOk ||
    responseType !== assetType ||
    responseFileName !== fileName ||
    normalizedResponsePublicUrl !== expectedPublicUrl ||
    responseSha !== sha256 ||
    responseWidth !== TARGET_COSMETIC_SIZE ||
    responseHeight !== TARGET_COSMETIC_SIZE ||
    responseSize !== buffer.length
  ) {
    throw createPublishError("verification VPS", "La reponse VPS ne correspond pas au PNG envoye.", 502);
  }

  return {
    endpoint,
    alreadyExists: Boolean(getResponseValue(data, ["already_exists", "alreadyExists"], false)),
    response: data,
  };
}

function buildUploadEndpoint(endpointTemplate, assetType) {
  const { serverUrl } = getServerConfig();
  return new URL(
    endpointTemplate.replace("{assetType}", encodeURIComponent(assetType)).replace(/^\/+/, ""),
    `${serverUrl}/`,
  ).toString();
}

function getEffectUploadEndpoints() {
  const { endpointTemplate } = getServerConfig();
  return [
    buildUploadEndpoint(DEFAULT_EFFECT_UPLOAD_ENDPOINT_TEMPLATE, PROFILE_COSMETIC_EFFECTS_FOLDER),
    buildUploadEndpoint(endpointTemplate, PROFILE_COSMETIC_EFFECTS_FOLDER),
    buildUploadEndpoint(endpointTemplate, PROFILE_COSMETIC_EFFECT),
  ].filter((endpoint, index, endpoints) => endpoints.indexOf(endpoint) === index);
}

async function uploadEffectToVps({ fileName, buffer, sha256 }) {
  const { token } = getServerConfig();
  if (!token) {
    throw createPublishError("upload VPS", "Token VPS manquant cote serveur.", 500);
  }

  const attempts = [];
  for (const endpoint of getEffectUploadEndpoints()) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GVG-Token": token,
      },
      body: JSON.stringify({
        asset_type: PROFILE_COSMETIC_EFFECT,
        assetType: PROFILE_COSMETIC_EFFECT,
        folder: PROFILE_COSMETIC_EFFECTS_FOLDER,
        fileName,
        file_name: fileName,
        content_type: "image/webp",
        mime_type: "image/webp",
        content_base64: buffer.toString("base64"),
      }),
    });
    const text = await response.text();
    const data = parseJsonMaybe(text);

    if (!response.ok) {
      attempts.push({
        endpoint,
        status: response.status,
        error: data?.detail || data?.error || data?.raw || `Erreur VPS ${response.status}`,
      });
      if ([404, 405, 501].includes(response.status)) continue;
      throw createPublishError("upload VPS", data?.detail || data?.error || `Upload VPS refuse (${response.status}).`, response.status);
    }

    const responseType = cleanProfileCosmeticText(getResponseValue(data, ["asset_type", "assetType"], PROFILE_COSMETIC_EFFECT));
    const responseFileName = cleanProfileCosmeticText(getResponseValue(data, ["filename", "file_name", "fileName"]));
    const responsePublicUrl = cleanProfileCosmeticText(getResponseValue(data, ["public_url", "publicUrl", "url", "asset_url", "assetUrl"], ""), 500);
    const expectedPublicUrl = buildPublicCosmeticUrl(PROFILE_COSMETIC_EFFECT, fileName);
    const normalizedResponsePublicUrl = assertAllowedPublicCosmeticUrl(responsePublicUrl, {
      assetType: PROFILE_COSMETIC_EFFECT,
      fileName,
    });
    const responseSha = cleanProfileCosmeticText(getResponseValue(data, ["sha256"])).toLowerCase();
    const responseSize = Number(getResponseValue(data, ["size"], 0));
    const responseOk = Boolean(getResponseValue(data, ["success", "ok"], false));
    const alreadyExists = Boolean(getResponseValue(data, ["already_exists", "alreadyExists"], false));

    if (
      !responseOk ||
      ![PROFILE_COSMETIC_EFFECT, PROFILE_COSMETIC_EFFECTS_FOLDER].includes(responseType) ||
      responseFileName !== fileName ||
      normalizedResponsePublicUrl !== expectedPublicUrl ||
      responseSha !== sha256 ||
      responseSize !== buffer.length ||
      alreadyExists
    ) {
      throw createPublishError("verification VPS", "La reponse VPS ne correspond pas au WebP envoye.", alreadyExists ? 409 : 502);
    }

    return { endpoint, response: data };
  }

  const error = createPublishError("upload VPS", "Upload WebP indisponible cote VPS : aucune route effects n'a repondu.", 501);
  error.data = { attempts };
  throw error;
}

async function verifyPublicCosmeticUrl({ publicUrl, buffer, sha256, assetType }) {
  const response = await fetch(publicUrl, {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) {
    throw createPublishError("verification VPS", `Verification HTTP impossible (${response.status}).`, 502);
  }

  const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
  if (!contentType.includes("image/png")) {
    throw createPublishError("verification VPS", "Le VPS ne sert pas un PNG.", 502);
  }

  const remoteBuffer = Buffer.from(await response.arrayBuffer());
  if (remoteBuffer.length > MAX_NORMALIZED_PNG_BYTES) {
    throw createPublishError("verification VPS", "Le PNG servi par le VPS est trop volumineux.", 502);
  }

  const remoteSha = crypto.createHash("sha256").update(remoteBuffer).digest("hex");
  const remoteInfo = inspectPngBuffer(remoteBuffer, { requireAlpha: assetType === PROFILE_COSMETIC_FRAME });
  if (remoteSha !== sha256 || remoteInfo.width !== TARGET_COSMETIC_SIZE || remoteInfo.height !== TARGET_COSMETIC_SIZE) {
    throw createPublishError("verification VPS", "Le fichier public VPS ne correspond pas au PNG envoye.", 502);
  }
  if (!remoteBuffer.equals(buffer)) {
    throw createPublishError("verification VPS", "Le contenu public VPS differe du PNG envoye.", 502);
  }
  return remoteInfo;
}

function buildPublicCosmeticUrl(assetType, fileName) {
  const { publicBaseUrl } = getServerConfig();
  const folder = getPublicCosmeticFolder(assetType);
  const publicUrl = `${publicBaseUrl}/${folder}/${encodeURIComponent(fileName)}`;
  assertAllowedPublicCosmeticUrl(publicUrl, { assetType, fileName });
  return publicUrl;
}

function getPublicCosmeticFolder(assetType) {
  if (assetType === PROFILE_COSMETIC_AVATAR) return "avatars";
  if (assetType === PROFILE_COSMETIC_FRAME) return "frames";
  if (assetType === PROFILE_COSMETIC_EFFECT) return PROFILE_COSMETIC_EFFECTS_FOLDER;
  throw createPublishError("verification VPS", "Type de dossier cosmetique invalide.", 500);
}

function assertAllowedPublicCosmeticUrl(publicUrl, { assetType, fileName }) {
  const { publicBaseUrl } = getServerConfig();
  const expectedFolder = getPublicCosmeticFolder(assetType);
  const expectedExtension = assetType === PROFILE_COSMETIC_EFFECT ? ".webp" : ".png";
  let expectedUrl;
  let actualUrl;
  try {
    const baseUrl = new URL(`${publicBaseUrl}/`);
    expectedUrl = new URL(`${expectedFolder}/${encodeURIComponent(fileName)}`, baseUrl);
    actualUrl = new URL(publicUrl);
  } catch {
    throw createPublishError("verification VPS", "URL publique VPS invalide.", 502);
  }

  if (
    actualUrl.protocol !== "https:" ||
    actualUrl.origin !== expectedUrl.origin ||
    actualUrl.pathname !== expectedUrl.pathname ||
    actualUrl.search ||
    actualUrl.hash ||
    !actualUrl.pathname.toLowerCase().endsWith(expectedExtension)
  ) {
    throw createPublishError("verification VPS", "URL publique VPS hors domaine ou dossier autorise.", 502);
  }

  return actualUrl.toString();
}

function buildSafeEffectFileSlug(value, fallback = "effect") {
  const withoutQuery = cleanProfileCosmeticText(value, 180).split(/[?#]/)[0];
  const fileName = withoutQuery.split(/[\\/]/).filter(Boolean).pop() || withoutQuery;
  const baseName = fileName.replace(/\.[a-z0-9]+$/i, "");
  const slug = baseName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || fallback;
}

function buildEffectFileName(body, sha256) {
  const sourceName = body.fileName || body.file_name || body.displayName || body.display_name || "effect";
  const slug = buildSafeEffectFileSlug(sourceName);
  const suffix = crypto.randomBytes(6).toString("hex");
  const hashHint = sha256.slice(0, 8);
  return `${slug}-${hashHint}-${suffix}.webp`;
}

function hasUnsafeDisplayNameCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const code = value.charCodeAt(index);
    if (code < 32 || character === "<" || character === ">") return true;
  }
  return false;
}

function sanitizeDisplayName(value, fallback) {
  const name = cleanProfileCosmeticText(value, 80).replace(/\s+/g, " ");
  if (!name) return fallback;
  if (hasUnsafeDisplayNameCharacter(name)) {
    throw createPublishError("validation", "Nom affiche invalide.");
  }
  return name;
}

function validateCollectionKey(value) {
  const collectionKey = cleanProfileCosmeticText(value || "basic", 64).toLowerCase();
  if (!SAFE_COLLECTION_KEY_PATTERN.test(collectionKey)) {
    throw createPublishError("validation", "Collection invalide.");
  }
  return collectionKey;
}

function ensurePlainObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createPublishError("validation", `${path} doit etre un objet.`);
  }
  return value;
}

function readBoundedNumber(value, path, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw createPublishError("validation", `${path} doit etre un nombre fini.`);
  }
  if (value < min || value > max) {
    throw createPublishError("validation", `${path} doit etre compris entre ${min} et ${max}.`);
  }
  return value;
}

function validateAvatarMetadataForStorage(value) {
  if (value === undefined || value === null) return {};
  const metadata = ensurePlainObject(value, "metadata");
  assertAllowedKeys(metadata, new Set(["crop", "avatar_fit", "avatar_position"]), "metadata");

  const normalized = {};
  if (metadata.crop !== undefined) {
    const crop = ensurePlainObject(metadata.crop, "metadata.crop");
    assertAllowedKeys(crop, new Set(["zoom", "offset_x", "offset_y"]), "metadata.crop");
    normalized.crop = {
      zoom: readBoundedNumber(crop.zoom, "metadata.crop.zoom", 1, 2.5),
      offset_x: readBoundedNumber(crop.offset_x, "metadata.crop.offset_x", -0.5, 0.5),
      offset_y: readBoundedNumber(crop.offset_y, "metadata.crop.offset_y", -0.5, 0.5),
    };
  }

  if (metadata.avatar_fit !== undefined) {
    const fit = cleanProfileCosmeticText(metadata.avatar_fit, 16).toLowerCase();
    if (!["cover", "contain"].includes(fit)) {
      throw createPublishError("validation", "metadata.avatar_fit doit etre cover ou contain.");
    }
    normalized.avatar_fit = fit;
  }

  if (metadata.avatar_position !== undefined) {
    const position = ensurePlainObject(metadata.avatar_position, "metadata.avatar_position");
    assertAllowedKeys(position, new Set(["x", "y"]), "metadata.avatar_position");
    normalized.avatar_position = {
      x: readBoundedNumber(position.x, "metadata.avatar_position.x", 0, 1),
      y: readBoundedNumber(position.y, "metadata.avatar_position.y", 0, 1),
    };
  }

  return normalized;
}

function buildStoredMetadata({ assetType, metadata, sha256, info, originalFileName }) {
  if (assetType === PROFILE_COSMETIC_FRAME) {
    const renderMetadata = normalizeFrameRenderMetadataForStorage(metadata);
    return {
      ...renderMetadata,
      source_sha256: sha256,
      source_file_name: cleanProfileCosmeticText(originalFileName, 180) || null,
      normalized_width: info.width,
      normalized_height: info.height,
      published_via: "portal_studio",
    };
  }

  const avatarMetadata = validateAvatarMetadataForStorage(metadata);
  return {
    ...avatarMetadata,
    source_sha256: sha256,
    source_file_name: cleanProfileCosmeticText(originalFileName, 180) || null,
    normalized_width: info.width,
    normalized_height: info.height,
    published_via: "portal_studio",
  };
}

async function loadActiveCollection(supabase, collectionKey) {
  const { data, error } = await supabase
    .from("portal_cosmetic_collections")
    .select("id, collection_key, display_name, is_public, is_active")
    .eq("collection_key", collectionKey)
    .eq("is_active", true)
    .eq("is_public", true)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) {
    throw createPublishError("validation", "Collection Basic introuvable ou inactive.", 400);
  }
  return data;
}

async function loadAssetByAssetKey(supabase, assetKey) {
  const { data, error } = await supabase
    .from("portal_cosmetic_assets")
    .select(PROFILE_COSMETIC_ASSET_SELECT)
    .eq("asset_key", assetKey)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function ensureNoUrlCollision(supabase, publicUrl, sha256) {
  const { data, error } = await supabase
    .from("portal_cosmetic_assets")
    .select(PROFILE_COSMETIC_ASSET_SELECT)
    .eq("asset_url", publicUrl)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const metadata = normalizeProfileCosmeticMetadata(data.metadata);
  if (metadata.source_sha256 === sha256) return data;
  throw createPublishError("insertion Supabase", "Une URL d'asset existe deja avec un contenu different.", 409);
}

async function getNextSortOrder(supabase, collectionId, assetType) {
  const { data, error } = await supabase
    .from("portal_cosmetic_assets")
    .select("sort_order")
    .eq("collection_id", collectionId)
    .eq("asset_type", assetType)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (error) throw error;
  const current = Number(data?.[0]?.sort_order || 0);
  return current + 10;
}

async function insertCosmeticAsset(supabase, row) {
  const { data, error } = await supabase
    .from("portal_cosmetic_assets")
    .insert(row)
    .select(PROFILE_COSMETIC_ASSET_SELECT)
    .single();

  if (error) throw error;
  if (!data?.id) {
    throw createPublishError("insertion Supabase", "Insertion Supabase non confirmee.", 500);
  }
  return data;
}

export async function publishProfileCosmeticAsset(supabase, member, body = {}) {
  assertAllowedKeys(
    body,
    new Set([
      "action",
      "assetType",
      "asset_type",
      "collectionKey",
      "collection_key",
      "displayName",
      "display_name",
      "fileName",
      "file_name",
      "metadata",
      "pngBase64",
      "png_base64",
      "pngDataUrl",
      "png_data_url",
      "sha256",
      "clientSha256",
      "client_sha256",
    ]),
  );

  const assetType = normalizeProfileCosmeticType(body.assetType || body.asset_type);
  if (!assetType) {
    throw createPublishError("validation", "Type de cosmetique invalide.");
  }

  const buffer = decodePngPayload(body);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const expectedSha = cleanProfileCosmeticText(body.sha256 || body.clientSha256 || body.client_sha256, 128).toLowerCase();
  if (expectedSha && expectedSha !== sha256) {
    throw createPublishError("validation", "SHA-256 client incoherent.");
  }

  const info = inspectPngBuffer(buffer, {
    requireAlpha: assetType === PROFILE_COSMETIC_FRAME,
  });
  if (info.width !== TARGET_COSMETIC_SIZE || info.height !== TARGET_COSMETIC_SIZE) {
    throw createPublishError("validation", "Le PNG normalise doit faire exactement 1024x1024.");
  }

  const collectionKey = validateCollectionKey(body.collectionKey || body.collection_key || "basic");
  const collection = await loadActiveCollection(supabase, collectionKey);
  const hashPrefix = sha256.slice(0, 16);
  const assetKey = `${collectionKey}_${assetType}_${hashPrefix}`;
  const fileName = `${assetKey}.png`;
  const publicUrl = buildPublicCosmeticUrl(assetType, fileName);
  const displayFallback = assetType === PROFILE_COSMETIC_AVATAR ? "Avatar" : "Cadre";
  const displayName = sanitizeDisplayName(body.displayName || body.display_name, `${displayFallback} ${hashPrefix.slice(0, 6)}`);
  const metadata = buildStoredMetadata({
    assetType,
    metadata: body.metadata || {},
    sha256,
    info,
    originalFileName: body.fileName || body.file_name,
  });

  const existingByKey = await loadAssetByAssetKey(supabase, assetKey);
  if (existingByKey) {
    const existingMetadata = normalizeProfileCosmeticMetadata(existingByKey.metadata);
    if (existingMetadata.source_sha256 !== sha256) {
      throw createPublishError("insertion Supabase", "Collision asset_key avec un contenu different.", 409);
    }
    const state = await loadProfileCosmeticsState(supabase, member);
    return {
      ...state,
      publishedAsset: serializeProfileCosmeticAsset(existingByKey),
      publish: {
        status: "already_published",
        step: "relecture catalogue",
        sha256,
        url: existingByKey.asset_url,
        width: info.width,
        height: info.height,
      },
    };
  }

  await ensureNoUrlCollision(supabase, publicUrl, sha256);
  await uploadCosmeticToVps({ assetType, fileName, buffer, sha256 });
  await verifyPublicCosmeticUrl({ publicUrl, buffer, sha256, assetType });

  const inserted = await insertCosmeticAsset(supabase, {
    collection_id: collection.id,
    asset_key: assetKey,
    display_name: displayName,
    asset_type: assetType,
    asset_url: publicUrl,
    is_active: true,
    sort_order: await getNextSortOrder(supabase, collection.id, assetType),
    metadata,
  });

  const state = await loadProfileCosmeticsState(supabase, member);
  const publishedAsset = serializeProfileCosmeticAsset(inserted);
  const catalogHasAsset = state.catalog.assets.some((asset) => String(asset.id) === String(publishedAsset.id));
  if (!catalogHasAsset) {
    throw createPublishError("relecture catalogue", "Asset publie introuvable apres relecture du catalogue.", 500);
  }

  return {
    ...state,
    publishedAsset,
    publish: {
      status: "published",
      step: "relecture catalogue",
      sha256,
      url: publicUrl,
      width: info.width,
      height: info.height,
    },
  };
}

export async function publishProfileCosmeticEffect(body = {}) {
  assertAllowedKeys(
    body,
    new Set([
      "action",
      "displayName",
      "display_name",
      "fileName",
      "file_name",
      "mimeType",
      "mime_type",
      "contentType",
      "content_type",
      "size",
      "bytes",
      "fileSize",
      "file_size",
      "webpBase64",
      "webp_base64",
      "webpDataUrl",
      "webp_data_url",
      "contentBase64",
      "content_base64",
      "sha256",
      "clientSha256",
      "client_sha256",
    ]),
  );

  const buffer = decodeWebpPayload(body);
  const info = inspectWebpBuffer(buffer, { requireAnimation: true });
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const expectedSha = cleanProfileCosmeticText(body.sha256 || body.clientSha256 || body.client_sha256, 128).toLowerCase();
  if (expectedSha && expectedSha !== sha256) {
    throw createPublishError("validation", "SHA-256 client incoherent.");
  }

  const fileName = buildEffectFileName(body, sha256);
  const publicUrl = buildPublicCosmeticUrl(PROFILE_COSMETIC_EFFECT, fileName);
  await uploadEffectToVps({ fileName, buffer, sha256 });
  const remoteInfo = await verifyPublicCosmeticEffectUrl({ publicUrl, buffer, sha256 });

  return {
    ok: true,
    url: publicUrl,
    filename: fileName,
    publish: {
      status: "published",
      step: "verification VPS",
      sha256,
      size: buffer.length,
      animated: Boolean(info.hasAnimation && remoteInfo.hasAnimation),
    },
  };
}

async function verifyPublicCosmeticEffectUrl({ publicUrl, buffer, sha256 }) {
  const response = await fetch(publicUrl, {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) {
    throw createPublishError("verification VPS", `Verification HTTP impossible (${response.status}).`, 502);
  }

  const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
  if (!contentType.includes("image/webp")) {
    throw createPublishError("verification VPS", "Le VPS ne sert pas un WebP.", 502);
  }

  const remoteBuffer = Buffer.from(await response.arrayBuffer());
  if (remoteBuffer.length > MAX_ANIMATED_WEBP_BYTES) {
    throw createPublishError("verification VPS", "Le WebP servi par le VPS est trop volumineux.", 502);
  }

  const remoteSha = crypto.createHash("sha256").update(remoteBuffer).digest("hex");
  const remoteInfo = inspectWebpBuffer(remoteBuffer, { requireAnimation: true });
  if (remoteSha !== sha256 || !remoteBuffer.equals(buffer)) {
    throw createPublishError("verification VPS", "Le fichier public VPS ne correspond pas au WebP envoye.", 502);
  }
  return remoteInfo;
}
