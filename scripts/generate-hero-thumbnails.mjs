import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

import {
  HERO_CALQUE_THUMBNAIL_QUALITY,
  HERO_CALQUE_THUMBNAIL_WIDTH,
  getHeroCalqueThumbnailFileName,
} from "../src/lib/vpsAssets.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(repoRoot, "public", "hero-calques");
const outputDir = path.join(repoRoot, "public", "HeroCalc", "thumbs");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/u);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const options = {
    allLocal: false,
    files: [],
    quality: HERO_CALQUE_THUMBNAIL_QUALITY,
    width: HERO_CALQUE_THUMBNAIL_WIDTH,
  };

  for (const arg of argv) {
    if (arg === "--all-local") {
      options.allLocal = true;
      continue;
    }

    if (arg.startsWith("--quality=")) {
      options.quality = Number(arg.slice("--quality=".length)) || options.quality;
      continue;
    }

    if (arg.startsWith("--width=")) {
      options.width = Number(arg.slice("--width=".length)) || options.width;
      continue;
    }

    options.files.push(arg);
  }

  options.quality = Math.min(100, Math.max(1, Math.round(options.quality)));
  options.width = Math.min(2048, Math.max(64, Math.round(options.width)));

  return options;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function getChampionField(champion, names) {
  for (const name of names) {
    const value = champion?.[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function getChampionPortalName(champion) {
  return String(
    getChampionField(champion, [
      "PortalName",
      "portalName",
      "portal_name",
      "portalname",
      "display_name",
      "displayName",
      "name",
    ]) || "",
  ).trim();
}

function normalizeHeroImageFile(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";

  const withoutQuery = rawValue.split(/[?#]/u)[0];
  const fileName = withoutQuery.split(/[\\/]/u).filter(Boolean).pop() || withoutQuery;
  if (!fileName) return "";

  try {
    const decodedFileName = decodeURIComponent(fileName);
    return /\.[a-z0-9]+$/iu.test(decodedFileName) ? decodedFileName : `${decodedFileName}.png`;
  } catch {
    return /\.[a-z0-9]+$/iu.test(fileName) ? fileName : `${fileName}.png`;
  }
}

function formatHeroFilterLabel(value) {
  return String(value || "")
    .replace(/[-_]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase()
    .replace(/(^|\s)\S/gu, (match) => match.toUpperCase());
}

function buildHeroImageCandidates(champion) {
  const portalName = getChampionPortalName(champion);
  const configuredFile = normalizeHeroImageFile(
    getChampionField(champion, ["image_file", "imageFile", "ImageFile", "calque_file", "CalqueFile"]),
  );

  return [
    configuredFile || normalizeHeroImageFile(portalName),
    normalizeHeroImageFile(portalName),
    normalizeHeroImageFile(formatHeroFilterLabel(portalName)),
  ].filter(Boolean).filter((value, index, items) => items.indexOf(value) === index);
}

async function getActiveHeroFiles(options) {
  const localFiles = fs
    .readdirSync(sourceDir)
    .filter((fileName) => /\.(png|webp|jpe?g)$/iu.test(fileName))
    .sort((left, right) => left.localeCompare(right, "fr", { sensitivity: "base" }));
  const localFileSet = new Set(localFiles);

  if (options.files.length) {
    return options.files.map((fileName) => normalizeHeroImageFile(fileName)).filter(Boolean);
  }

  if (options.allLocal) return localFiles;

  loadEnvFile(path.join(repoRoot, ".env.local"));
  loadEnvFile(path.join(repoRoot, ".env"));

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn("Supabase env unavailable; falling back to all local hero calques.");
    return localFiles;
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const { data, error } = await supabase.from("champions").select("*").order("id", { ascending: true });
  if (error) throw new Error(`Unable to read active champions: ${error.message}`);

  const files = (data || [])
    .map((champion) => buildHeroImageCandidates(champion).find((fileName) => localFileSet.has(fileName)))
    .filter(Boolean);

  return [...new Set(files)];
}

async function generateThumbnail(fileName, options) {
  const sourcePath = path.join(sourceDir, fileName);
  const thumbnailFileName = getHeroCalqueThumbnailFileName(fileName);
  const outputPath = path.join(outputDir, thumbnailFileName);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source image not found: ${fileName}`);
  }

  await sharp(sourcePath)
    .rotate()
    .resize({ width: options.width, withoutEnlargement: true })
    .webp({
      quality: options.quality,
      alphaQuality: Math.max(90, options.quality),
      effort: 6,
      smartSubsample: true,
    })
    .toFile(outputPath);

  const sourceStats = fs.statSync(sourcePath);
  const outputStats = fs.statSync(outputPath);
  const metadata = await sharp(outputPath).metadata();

  return {
    sourceFile: fileName,
    thumbnailFile: thumbnailFileName,
    sourceBytes: sourceStats.size,
    thumbnailBytes: outputStats.size,
    width: metadata.width,
    height: metadata.height,
    hasAlpha: Boolean(metadata.hasAlpha),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(sourceDir)) throw new Error(`Source folder not found: ${sourceDir}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const files = await getActiveHeroFiles(options);
  const results = [];
  const errors = [];

  for (const fileName of files) {
    try {
      const result = await generateThumbnail(fileName, options);
      results.push(result);
      console.log(
        `${result.thumbnailFile}: ${formatBytes(result.sourceBytes)} -> ${formatBytes(result.thumbnailBytes)} (${result.width}x${result.height})`,
      );
    } catch (error) {
      errors.push({ fileName, message: error?.message || String(error) });
      console.error(`ERROR ${fileName}: ${error?.message || error}`);
    }
  }

  const totalBefore = results.reduce((total, item) => total + item.sourceBytes, 0);
  const totalAfter = results.reduce((total, item) => total + item.thumbnailBytes, 0);
  const sizesAfter = results.map((item) => item.thumbnailBytes);
  const top20 = [...results]
    .sort((left, right) => right.thumbnailBytes - left.thumbnailBytes)
    .slice(0, 20)
    .map((item) => ({
      file: item.thumbnailFile,
      size: formatBytes(item.thumbnailBytes),
      dimensions: `${item.width}x${item.height}`,
    }));

  console.log("");
  console.log(
    JSON.stringify(
      {
        sourceDir,
        outputDir,
        width: options.width,
        quality: options.quality,
        generated: results.length,
        errors: errors.length,
        totalBefore: formatBytes(totalBefore),
        totalAfter: formatBytes(totalAfter),
        averageAfter: formatBytes(results.length ? totalAfter / results.length : 0),
        medianAfter: formatBytes(median(sizesAfter)),
        largestAfter: results.length ? formatBytes(Math.max(...sizesAfter)) : "0 B",
        smallestAfter: results.length ? formatBytes(Math.min(...sizesAfter)) : "0 B",
        invalidWidthCount: results.filter((item) => item.width !== options.width).length,
        missingAlphaCount: results.filter((item) => !item.hasAlpha).length,
        top20,
        failedFiles: errors,
      },
      null,
      2,
    ),
  );

  if (errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
