import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import zlib from "node:zlib";
import {
  loadCosmeticsForMemberIds,
  saveProfileCosmeticFrameMetadata,
  saveProfileCosmeticsSelection,
  serializeProfileCosmeticsCatalog,
  validateProfileCosmeticSelection,
} from "../api/_portal-cosmetics.js";
import {
  inspectPngBuffer,
  publishProfileCosmeticAsset,
} from "../api/_portal-cosmetics-publish.js";
import {
  analyzeFrameAlphaGeometry,
  getFrameContentInset,
  getFrameRenderMetadata,
  normalizeFrameRenderMetadata,
  resolveProfileCosmeticSelection,
  validateFrameRenderMetadataForStorage,
} from "../src/lib/profileCosmetics.js";

const basicCollection = {
  id: "collection-basic",
  collection_key: "basic",
  display_name: "Basique",
  is_public: true,
  is_active: true,
  sort_order: 10,
};

function createAsset(index, assetType, overrides = {}) {
  return {
    id: `${assetType}-${index}`,
    collection_id: basicCollection.id,
    asset_key: `${assetType}_${index}`,
    display_name: `${assetType} ${index}`,
    asset_type: assetType,
    asset_url: `/profile-cosmetics/${assetType}s/${assetType}-${index}.png`,
    is_active: true,
    sort_order: index,
    metadata: assetType === "frame" ? { content_inset: 0.14 } : {},
    collection: basicCollection,
    ...overrides,
  };
}

const assets = [
  createAsset(1, "avatar"),
  createAsset(2, "avatar"),
  createAsset(3, "avatar"),
  createAsset(4, "avatar"),
  createAsset(5, "avatar"),
  createAsset(1, "frame"),
  createAsset(2, "frame"),
  createAsset(3, "frame"),
  createAsset(4, "frame"),
  createAsset(5, "frame"),
];

const catalog = serializeProfileCosmeticsCatalog(assets);
assert.equal(catalog.avatars.length, 5, "Basic exposes five avatars");
assert.equal(catalog.frames.length, 5, "Basic exposes five frames");
assert.equal(catalog.avatars.every((asset) => asset.unlocked), true, "public Basic avatars are unlocked");
assert.equal(catalog.frames.every((asset) => asset.unlocked), true, "public Basic frames are unlocked");
assert.equal(getFrameContentInset(catalog.frames[0]), 0.14, "frame inset comes from metadata");
assert.deepEqual(
  getFrameRenderMetadata(catalog.frames[0]).content_box,
  { x: 0.14, y: 0.14, width: 0.72, height: 0.72 },
  "legacy content_inset is converted to a normalized content box",
);

const frameV2 = createAsset(6, "frame", {
  metadata: {
    render_version: 2,
    content_box: { x: 0.08, y: 0.12, width: 0.8, height: 0.76 },
    content_radius: 0,
    avatar_fit: "cover",
    avatar_position: { x: 0.45, y: 0.55 },
    frame_box: { x: 0, y: 0, width: 1, height: 1 },
  },
});
const frameV2Metadata = getFrameRenderMetadata(frameV2);
assert.deepEqual(frameV2Metadata.content_box, { x: 0.08, y: 0.12, width: 0.8, height: 0.76 });
assert.deepEqual(frameV2Metadata.avatar_position, { x: 0.45, y: 0.55 });
assert.deepEqual(
  normalizeFrameRenderMetadata({ content_box: { x: -1, y: 2, width: 3, height: -1 } }).content_box,
  { x: 0.14, y: 0.14, width: 0.72, height: 0.72 },
  "metadata without render_version v2 falls back to the legacy inset",
);
assert.deepEqual(
  normalizeFrameRenderMetadata({ render_version: 2, content_box: { x: -1, y: 2, width: 3, height: -1 } }).content_box,
  { x: 0, y: 0.96, width: 1, height: 0.04 },
  "render metadata is clamped to normalized bounds",
);

const validRenderMetadata = {
  render_version: 2,
  content_box: { x: 0.09, y: 0.11, width: 0.82, height: 0.78 },
  content_radius: 0,
  avatar_fit: "cover",
  avatar_position: { x: 0.5, y: 0.5 },
  frame_box: { x: 0, y: 0, width: 1, height: 1 },
};
assert.deepEqual(validateFrameRenderMetadataForStorage(validRenderMetadata), validRenderMetadata);
assert.throws(
  () =>
    validateFrameRenderMetadataForStorage({
      ...validRenderMetadata,
      content_box: { ...validRenderMetadata.content_box, x: "0.1" },
    }),
  /nombre fini/,
  "storage validation refuses numeric strings",
);
assert.throws(
  () =>
    validateFrameRenderMetadataForStorage({
      ...validRenderMetadata,
      content_box: { ...validRenderMetadata.content_box, x: 0.3, width: 0.8 },
    }),
  /inferieur ou egal a 1/,
  "storage validation refuses boxes outside normalized bounds",
);
assert.throws(
  () => validateFrameRenderMetadataForStorage({ ...validRenderMetadata, content_radius: 0.75 }),
  /content_radius/,
  "storage validation limits content radius",
);
assert.throws(
  () => validateFrameRenderMetadataForStorage({ ...validRenderMetadata, asset_key: "basic_frame_001" }),
  /pas autorise/,
  "storage validation refuses unexpected metadata keys",
);
assert.throws(
  () =>
    validateFrameRenderMetadataForStorage({
      ...validRenderMetadata,
      frame_box: { ...validRenderMetadata.frame_box, extra: 1 },
    }),
  /pas autorise/,
  "storage validation refuses unexpected nested keys",
);

const alphaData = new Uint8ClampedArray(100 * 100);
for (let y = 0; y < 100; y += 1) {
  for (let x = 0; x < 100; x += 1) {
    if (x < 10 || x >= 90 || y < 10 || y >= 90) {
      alphaData[y * 100 + x] = 255;
    }
  }
}
const alphaAnalysis = analyzeFrameAlphaGeometry({ width: 100, height: 100, alphaData });
assert.equal(alphaAnalysis.metadata.render_version, 2, "alpha analysis returns render metadata v2");
assert.equal(alphaAnalysis.metadata.content_radius, 0, "alpha analysis keeps square content by default");
assert.equal(alphaAnalysis.analysis.confidence, "high", "closed rectangular frames are high confidence");
assert.ok(alphaAnalysis.metadata.content_box.x > 0.1 && alphaAnalysis.metadata.content_box.x < 0.14);
assert.ok(alphaAnalysis.metadata.content_box.width > 0.72 && alphaAnalysis.metadata.content_box.width < 0.8);

const validSelection = validateProfileCosmeticSelection({
  assets,
  selectedAvatarId: "avatar-1",
  selectedFrameId: "frame-1",
});
assert.equal(validSelection.selectedAvatarId, "avatar-1");
assert.equal(validSelection.selectedFrameId, "frame-1");

assert.throws(
  () => validateProfileCosmeticSelection({ assets, selectedAvatarId: "missing", selectedFrameId: "" }),
  /Avatar indisponible/,
  "unknown avatar must be refused",
);

assert.throws(
  () => validateProfileCosmeticSelection({ assets, selectedAvatarId: "", selectedFrameId: "frame-1" }),
  /cadre ne peut pas/i,
  "frame without avatar must be refused",
);

assert.throws(
  () =>
    validateProfileCosmeticSelection({
      assets: [createAsset(1, "avatar", { is_active: false })],
      selectedAvatarId: "avatar-1",
      selectedFrameId: "",
    }),
  /Avatar indisponible/,
  "inactive avatar must be refused",
);

assert.throws(
  () =>
    validateProfileCosmeticSelection({
      assets: [
        createAsset(1, "avatar", {
          collection: {
            ...basicCollection,
            is_public: false,
          },
        }),
      ],
      selectedAvatarId: "avatar-1",
      selectedFrameId: "",
    }),
  /Avatar indisponible/,
  "locked/private asset must be refused",
);

const resolved = resolveProfileCosmeticSelection(
  {
    selected_avatar_id: "avatar-2",
    selected_frame_id: "frame-2",
  },
  catalog.assets,
);
assert.equal(resolved.avatar.id, "avatar-2");
assert.equal(resolved.frame.id, "frame-2");

function createFakeSupabase() {
  const assetRows = assets.map((asset) => ({ ...asset, metadata: { ...(asset.metadata || {}) } }));
  const selections = new Map([
    [
      "member-a",
      {
        member_id: "member-a",
        selected_avatar_id: "avatar-2",
        selected_frame_id: "frame-2",
        updated_at: "2026-08-23T00:00:00.000Z",
      },
    ],
  ]);
  const calls = [];

  function resolveQuery(state) {
    if (state.table === "portal_cosmetic_assets") {
      let rows = assetRows;
      if (state.inFilter?.column === "id") {
        const allowed = new Set(state.inFilter.values.map(String));
        rows = rows.filter((row) => allowed.has(String(row.id)));
      }
      if (state.eqFilter?.column === "id") {
        rows = rows.filter((row) => String(row.id) === String(state.eqFilter.value));
      }
      return { data: rows, error: null };
    }

    if (state.table === "portal_member_cosmetics") {
      let rows = [...selections.values()];
      if (state.eqFilter?.column === "member_id") {
        rows = rows.filter((row) => String(row.member_id) === String(state.eqFilter.value));
      }
      if (state.inFilter?.column === "member_id") {
        const allowed = new Set(state.inFilter.values.map(String));
        rows = rows.filter((row) => allowed.has(String(row.member_id)));
      }
      return { data: rows, error: null };
    }

    return { data: [], error: null };
  }

  function from(table) {
    const state = {
      table,
      eqFilter: null,
      inFilter: null,
      updatePayload: null,
    };
    const builder = {
      select() {
        return builder;
      },
      order() {
        return builder;
      },
      eq(column, value) {
        state.eqFilter = { column, value };
        return builder;
      },
      in(column, values) {
        state.inFilter = { column, values };
        return builder;
      },
      maybeSingle() {
        const result = resolveQuery(state);
        return Promise.resolve({
          data: result.data[0] || null,
          error: result.error,
        });
      },
      single() {
        if (state.table === "portal_cosmetic_assets" && state.updatePayload && state.eqFilter?.column === "id") {
          const row = assetRows.find((asset) => String(asset.id) === String(state.eqFilter.value));
          if (row) Object.assign(row, state.updatePayload);
          return Promise.resolve({ data: row || null, error: row ? null : new Error("missing asset") });
        }
        const result = resolveQuery(state);
        return Promise.resolve({
          data: result.data[0] || null,
          error: result.error,
        });
      },
      upsert(payload) {
        calls.push({ table, payload });
        selections.set(String(payload.member_id), {
          member_id: payload.member_id,
          selected_avatar_id: payload.selected_avatar_id,
          selected_frame_id: payload.selected_frame_id,
          updated_at: payload.updated_at,
        });
        return Promise.resolve({ error: null });
      },
      update(payload) {
        calls.push({ table, payload, operation: "update" });
        state.updatePayload = payload;
        return builder;
      },
      then(resolve, reject) {
        return Promise.resolve(resolveQuery(state)).then(resolve, reject);
      },
    };
    return builder;
  }

  return { calls, from };
}

function createPngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, typeBuffer, data, Buffer.alloc(4)]);
}

function createTestPng({ width = 1024, height = 1024, frame = false, opaque = false } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowBytes = width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  const border = Math.max(1, Math.floor(Math.min(width, height) * 0.12));
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (rowBytes + 1);
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = rowOffset + 1 + x * 4;
      const isBorder = x < border || y < border || x >= width - border || y >= height - border;
      raw[pixel] = frame ? 40 : 120;
      raw[pixel + 1] = frame ? 170 : 80;
      raw[pixel + 2] = frame ? 250 : 190;
      raw[pixel + 3] = opaque || !frame || isBorder ? 255 : 0;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    createPngChunk("IHDR", ihdr),
    createPngChunk("IDAT", zlib.deflateSync(raw)),
    createPngChunk("IEND"),
  ]);
}

function createPublishingFakeSupabase(options = {}) {
  const assetRows = (options.assets || assets).map((asset) => ({ ...asset, metadata: { ...(asset.metadata || {}) } }));
  const selections = new Map();
  const inserts = [];
  const collections = [basicCollection];

  function applyQuery(state, rows) {
    let result = [...rows];
    for (const filter of state.eqFilters) {
      result = result.filter((row) => row?.[filter.column] === filter.value);
    }
    if (state.inFilter) {
      const allowed = new Set(state.inFilter.values.map(String));
      result = result.filter((row) => allowed.has(String(row?.[state.inFilter.column])));
    }
    if (state.orderBy) {
      result.sort((left, right) => {
        const leftValue = left?.[state.orderBy.column] ?? 0;
        const rightValue = right?.[state.orderBy.column] ?? 0;
        return state.orderBy.ascending ? leftValue - rightValue : rightValue - leftValue;
      });
    }
    if (Number.isInteger(state.limitCount)) result = result.slice(0, state.limitCount);
    return result;
  }

  function resolveRows(state) {
    if (state.table === "portal_cosmetic_collections") return applyQuery(state, collections);
    if (state.table === "portal_cosmetic_assets") return applyQuery(state, assetRows);
    if (state.table === "portal_member_cosmetics") return applyQuery(state, [...selections.values()]);
    return [];
  }

  function from(table) {
    const state = {
      table,
      eqFilters: [],
      inFilter: null,
      orderBy: null,
      limitCount: null,
      insertPayload: null,
    };
    const builder = {
      select() {
        return builder;
      },
      eq(column, value) {
        state.eqFilters.push({ column, value });
        return builder;
      },
      in(column, values) {
        state.inFilter = { column, values };
        return builder;
      },
      order(column, options = {}) {
        state.orderBy = { column, ascending: options.ascending !== false };
        return builder;
      },
      limit(count) {
        state.limitCount = count;
        return builder;
      },
      maybeSingle() {
        const rows = resolveRows(state);
        return Promise.resolve({ data: rows[0] || null, error: null });
      },
      single() {
        if (state.table === "portal_cosmetic_assets" && state.insertPayload) {
          if (options.insertError) return Promise.resolve({ data: null, error: new Error("insert failed") });
          const row = {
            id: `asset-upload-${assetRows.length + 1}`,
            collection: basicCollection,
            ...state.insertPayload,
          };
          assetRows.push(row);
          inserts.push(row);
          return Promise.resolve({ data: row, error: null });
        }
        const rows = resolveRows(state);
        return Promise.resolve({ data: rows[0] || null, error: null });
      },
      insert(payload) {
        state.insertPayload = payload;
        return builder;
      },
      then(resolve, reject) {
        return Promise.resolve({ data: resolveRows(state), error: null }).then(resolve, reject);
      },
    };
    return builder;
  }

  return { from, inserts, assetRows };
}

async function withMockedFetchAndEnv(fetchImplementation, callback) {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.GVG_API_TOKEN;
  process.env.GVG_API_TOKEN = "test-token";
  globalThis.fetch = fetchImplementation;
  try {
    return await callback();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.GVG_API_TOKEN;
    else process.env.GVG_API_TOKEN = previousToken;
  }
}

const fakeSupabase = createFakeSupabase();
const savedState = await saveProfileCosmeticsSelection(
  fakeSupabase,
  { id: "member-a", watcher_name: "Darius" },
  {
    memberId: "member-b",
    selectedAvatarId: "avatar-1",
    selectedFrameId: "frame-1",
  },
);
assert.equal(fakeSupabase.calls[0].payload.member_id, "member-a", "save uses server session member id");
assert.equal(savedState.selection.selectedAvatarId, "avatar-1", "saved avatar is persisted and reloaded");
assert.equal(savedState.selection.selectedFrameId, "frame-1", "saved frame is persisted and reloaded");

const cosmeticsByMember = await loadCosmeticsForMemberIds(fakeSupabase, ["member-a", "member-a", "missing"]);
assert.equal(cosmeticsByMember.size, 1, "cosmetics are loaded in batch by unique member id");
assert.equal(cosmeticsByMember.get("member-a").avatar.id, "avatar-1");
assert.equal(cosmeticsByMember.get("member-a").frame.id, "frame-1");

const frameMetadataState = await saveProfileCosmeticFrameMetadata(
  fakeSupabase,
  { id: "member-a", watcher_name: "Darius" },
  {
    assetId: "frame-1",
    metadata: {
      render_version: 2,
      content_box: { x: 0.09, y: 0.11, width: 0.82, height: 0.78 },
      content_radius: 0,
      avatar_fit: "cover",
      avatar_position: { x: 0.5, y: 0.5 },
      frame_box: { x: 0, y: 0, width: 1, height: 1 },
    },
  },
);
const frameUpdateCall = fakeSupabase.calls.find((call) => call.operation === "update" && call.table === "portal_cosmetic_assets");
assert.equal(frameUpdateCall.payload.metadata.render_version, 2, "admin frame save stores render metadata v2");
assert.deepEqual(frameUpdateCall.payload.metadata.content_box, { x: 0.09, y: 0.11, width: 0.82, height: 0.78 });
assert.equal(frameMetadataState.catalog.frames.find((frame) => frame.id === "frame-1").metadata.render_version, 2);
assert.equal(frameMetadataState.savedAsset.id, "frame-1", "admin frame save returns the reloaded saved asset");

await assert.rejects(
  () =>
    saveProfileCosmeticFrameMetadata(fakeSupabase, { id: "member-a", watcher_name: "Darius" }, {
      assetId: "avatar-1",
      metadata: {},
    }),
  /Cadre introuvable/,
  "admin metadata save only accepts frame assets",
);

await assert.rejects(
  () =>
    saveProfileCosmeticFrameMetadata(fakeSupabase, { id: "member-a", watcher_name: "Darius" }, {
      assetId: "frame-1",
      asset_key: "basic_frame_001",
      metadata: validRenderMetadata,
    }),
  /pas autorise/,
  "admin metadata save refuses attempts to alter asset identity fields",
);

await assert.rejects(
  () =>
    saveProfileCosmeticFrameMetadata(fakeSupabase, { id: "member-a", watcher_name: "Darius" }, {
      assetId: "frame-1",
      metadata: {
        ...validRenderMetadata,
        content_box: { x: Number.NaN, y: 0.1, width: 0.8, height: 0.8 },
      },
    }),
  /nombre fini/,
  "admin metadata save refuses NaN before updating Supabase",
);

const validFramePng = createTestPng({ frame: true });
const validFrameSha = crypto.createHash("sha256").update(validFramePng).digest("hex");
const validFrameInfo = inspectPngBuffer(validFramePng, { requireAlpha: true });
assert.equal(validFrameInfo.width, 1024, "server PNG inspection keeps normalized width");
assert.equal(validFrameInfo.height, 1024, "server PNG inspection keeps normalized height");
assert.equal(validFrameInfo.hasTransparentPixels, true, "frame inspection validates alpha transparency");
assert.throws(() => inspectPngBuffer(Buffer.from("not-a-png")), /PNG valide/, "fake PNGs are refused");
assert.throws(
  () => inspectPngBuffer(createTestPng({ width: 1024, height: 1024, frame: true, opaque: true }), { requireAlpha: true }),
  /canal alpha/,
  "frames without transparency are refused",
);

const publishFakeSupabase = createPublishingFakeSupabase();
let postCount = 0;
await withMockedFetchAndEnv(
  async (url, options = {}) => {
    if (options.method === "POST") {
      postCount += 1;
      const request = JSON.parse(String(options.body || "{}"));
      assert.equal(options.headers["X-GVG-Token"], "test-token", "VPS token stays server-side in a header");
      assert.equal(request.asset_type, "frame", "VPS upload receives the frame type");
      assert.ok(request.file_name.startsWith("basic_frame_"), "remote filename contains the stable hash key");
      return new Response(
        JSON.stringify({
          ok: true,
          asset_type: request.asset_type,
          file_name: request.file_name,
          public_url: `https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/${request.file_name}`,
          sha256: validFrameSha,
          width: 1024,
          height: 1024,
          size: validFramePng.length,
          already_exists: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    assert.match(String(url), /\/assets\/profile-cosmetics\/frames\/basic_frame_/, "public verification uses the VPS asset URL");
    return new Response(validFramePng, { status: 200, headers: { "content-type": "image/png" } });
  },
  async () => {
    const state = await publishProfileCosmeticAsset(publishFakeSupabase, { id: "member-a", watcher_name: "Darius" }, {
      action: "publish-cosmetic-asset",
      assetType: "frame",
      collectionKey: "basic",
      displayName: "Cadre Upload",
      fileName: "source-frame.png",
      metadata: validRenderMetadata,
      pngBase64: validFramePng.toString("base64"),
      sha256: validFrameSha,
    });

    assert.equal(state.publish.status, "published", "successful publish returns a published status");
    assert.equal(publishFakeSupabase.inserts.length, 1, "publish inserts exactly one Supabase row");
    assert.equal(publishFakeSupabase.inserts[0].metadata.source_sha256, validFrameSha, "source SHA is stored in metadata");
    assert.equal(state.catalog.frames.some((frame) => frame.id === state.publishedAsset.id), true, "catalog reload includes the new frame");
  },
);
assert.equal(postCount, 1, "successful publish uploads exactly once");

const existingAssetKey = `basic_frame_${validFrameSha.slice(0, 16)}`;
const alreadyPublishedSupabase = createPublishingFakeSupabase({
  assets: [
    ...assets,
    createAsset(99, "frame", {
      id: "existing-upload",
      asset_key: existingAssetKey,
      asset_url: `https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/${existingAssetKey}.png`,
      metadata: { ...validRenderMetadata, source_sha256: validFrameSha },
    }),
  ],
});
let duplicateUploadCount = 0;
await withMockedFetchAndEnv(
  async () => {
    duplicateUploadCount += 1;
    throw new Error("duplicate publish should not call the VPS");
  },
  async () => {
    const state = await publishProfileCosmeticAsset(alreadyPublishedSupabase, { id: "member-a", watcher_name: "Darius" }, {
      action: "publish-cosmetic-asset",
      assetType: "frame",
      collectionKey: "basic",
      displayName: "Cadre Upload",
      fileName: "source-frame.png",
      metadata: validRenderMetadata,
      pngBase64: validFramePng.toString("base64"),
      sha256: validFrameSha,
    });
    assert.equal(state.publish.status, "already_published", "same SHA returns the existing asset");
  },
);
assert.equal(duplicateUploadCount, 0, "idempotent publish skips the VPS when Supabase already has the asset");

await assert.rejects(
  () =>
    publishProfileCosmeticAsset(createPublishingFakeSupabase(), { id: "member-a" }, {
      action: "publish-cosmetic-asset",
      assetType: "avatar",
      collectionKey: "basic",
      displayName: "Wrong size",
      fileName: "small.png",
      metadata: {},
      pngBase64: createTestPng({ width: 512, height: 512 }).toString("base64"),
    }),
  /1024x1024/,
  "publication refuses PNGs that were not normalized to 1024x1024",
);

await assert.rejects(
  () =>
    publishProfileCosmeticAsset(createPublishingFakeSupabase(), { id: "member-a" }, {
      action: "publish-cosmetic-asset",
      assetType: "avatar",
      collectionKey: "basic",
      displayName: "Unexpected",
      fileName: "avatar.png",
      metadata: {},
      assetKey: "client-forbidden",
      pngBase64: createTestPng().toString("base64"),
    }),
  /pas autorise/,
  "publication refuses unexpected payload fields such as client asset keys",
);

await assert.rejects(
  () =>
    publishProfileCosmeticAsset(createPublishingFakeSupabase(), { id: "member-a" }, {
      action: "publish-cosmetic-asset",
      assetType: "avatar",
      collectionKey: "basic",
      displayName: "Bad metadata",
      fileName: "avatar.png",
      metadata: {
        crop: { zoom: 99, offset_x: 0, offset_y: 0 },
        avatar_fit: "cover",
        avatar_position: { x: 0.5, y: 0.5 },
      },
      pngBase64: createTestPng().toString("base64"),
    }),
  /metadata.crop.zoom/,
  "publication refuses out-of-bounds avatar crop metadata",
);

await assert.rejects(
  () =>
    withMockedFetchAndEnv(
      async (url, options = {}) => {
        if (options.method === "POST") {
          const request = JSON.parse(String(options.body || "{}"));
          return new Response(
            JSON.stringify({
              ok: true,
              asset_type: request.asset_type,
              file_name: request.file_name,
              public_url: `https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/${request.file_name}`,
              sha256: "0".repeat(64),
              width: 1024,
              height: 1024,
              size: validFramePng.length,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(validFramePng, { status: 200, headers: { "content-type": "image/png" } });
      },
      () =>
        publishProfileCosmeticAsset(createPublishingFakeSupabase(), { id: "member-a" }, {
          action: "publish-cosmetic-asset",
          assetType: "frame",
          collectionKey: "basic",
          displayName: "Bad VPS",
          fileName: "frame.png",
          metadata: validRenderMetadata,
          pngBase64: validFramePng.toString("base64"),
          sha256: validFrameSha,
        }),
    ),
  /URL publique|reponse VPS/,
  "publication refuses an incoherent VPS response",
);

await assert.rejects(
  () =>
    withMockedFetchAndEnv(
      async (url, options = {}) => {
        if (options.method === "POST") {
          const request = JSON.parse(String(options.body || "{}"));
          return new Response(
            JSON.stringify({
              ok: true,
              asset_type: request.asset_type,
              file_name: request.file_name,
              public_url: "https://evil.example/assets/profile-cosmetics/frames/bad.png",
              sha256: validFrameSha,
              width: 1024,
              height: 1024,
              size: validFramePng.length,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(validFramePng, { status: 200, headers: { "content-type": "image/png" } });
      },
      () =>
        publishProfileCosmeticAsset(createPublishingFakeSupabase(), { id: "member-a" }, {
          action: "publish-cosmetic-asset",
          assetType: "frame",
          collectionKey: "basic",
          displayName: "Bad VPS URL",
          fileName: "frame.png",
          metadata: validRenderMetadata,
          pngBase64: validFramePng.toString("base64"),
          sha256: validFrameSha,
        }),
    ),
  /URL publique|reponse VPS/,
  "publication refuses a VPS response that points outside the allowed public URL",
);

await assert.rejects(
  () =>
    withMockedFetchAndEnv(
      async (url, options = {}) => {
        if (options.method === "POST") {
          const request = JSON.parse(String(options.body || "{}"));
          return new Response(
            JSON.stringify({
              ok: true,
              asset_type: request.asset_type,
              file_name: request.file_name,
              public_url: `https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/${request.file_name}`,
              sha256: validFrameSha,
              width: 1024,
              height: 1024,
              size: validFramePng.length,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(validFramePng, { status: 200, headers: { "content-type": "image/png" } });
      },
      () =>
        publishProfileCosmeticAsset(createPublishingFakeSupabase({ insertError: true }), { id: "member-a" }, {
          action: "publish-cosmetic-asset",
          assetType: "frame",
          collectionKey: "basic",
          displayName: "Insert fails",
          fileName: "frame.png",
          metadata: validRenderMetadata,
          pngBase64: validFramePng.toString("base64"),
          sha256: validFrameSha,
        }),
    ),
  /insert failed/,
  "publication surfaces Supabase insertion failures without false success",
);

const portalCosmeticsSource = await readFile(new URL("../api/portal-cosmetics.js", import.meta.url), "utf8");
assert.match(
  portalCosmeticsSource,
  /requirePortalAdminSession\(req, supabase\)/,
  "metadata endpoint rechecks the admin session server-side",
);
assert.match(
  portalCosmeticsSource,
  /save-frame-render-metadata/,
  "metadata endpoint exposes only the explicit frame metadata action",
);
assert.match(
  portalCosmeticsSource,
  /publish-cosmetic-asset/,
  "publication endpoint exposes an explicit publish action",
);
assert.match(
  portalCosmeticsSource,
  /sizeLimit: "4mb"/,
  "publication route declares a bounded JSON body size",
);
assert.match(
  portalCosmeticsSource,
  /MAX_PROFILE_COSMETICS_BODY_BYTES = 4_000_000/,
  "publication route keeps a server-side safety margin under the platform payload limit",
);

const publishSource = await readFile(new URL("../api/_portal-cosmetics-publish.js", import.meta.url), "utf8");
assert.match(publishSource, /public_url/, "publisher validates the public URL returned by the VPS");
assert.match(publishSource, /assertAllowedPublicCosmeticUrl/, "publisher restricts VPS URLs to the expected public domain and folder");

const studioSource = await readFile(new URL("../src/components/ProfileCosmeticsTab.jsx", import.meta.url), "utf8");
assert.match(studioSource, /onPointerDown=\{\(event\) => startPointer\("move", event\)\}/, "studio exposes direct box dragging");
assert.match(studioSource, /startPointer\(handle, event\)/, "studio exposes resize handles");
assert.match(studioSource, /detectFrameMetadataFromUrl/, "studio has local alpha detection");
assert.match(studioSource, /save-frame-render-metadata/, "studio saves only on explicit metadata action");

const uploadStudioSource = await readFile(new URL("../src/components/ProfileCosmeticUploadStudio.jsx", import.meta.url), "utf8");
assert.match(uploadStudioSource, /normalizeFrameFile/, "upload studio normalizes frames locally");
assert.match(uploadStudioSource, /normalizeAvatarFile/, "upload studio normalizes avatars locally");
assert.match(uploadStudioSource, /TARGET_COSMETIC_SIZE = 1024/, "upload studio targets 1024x1024 PNGs");
assert.match(uploadStudioSource, /MAX_NORMALIZED_PNG_BYTES = 2_750_000/, "upload studio rejects oversized normalized PNGs before upload");
assert.match(uploadStudioSource, /publishingDraftIdsRef/, "upload studio prevents duplicate publishes for the same draft");
assert.match(uploadStudioSource, /existingDisplayNames/, "upload studio warns when a draft name resembles an existing catalog asset");
assert.match(uploadStudioSource, /publish-cosmetic-asset/, "upload studio publishes only through the explicit server action");
assert.match(uploadStudioSource, /Valider et publier/, "upload studio keeps an explicit publish button");

console.log("profile cosmetics tests passed");
