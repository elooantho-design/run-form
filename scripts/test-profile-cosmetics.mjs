import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  loadCosmeticsForMemberIds,
  saveProfileCosmeticFrameMetadata,
  saveProfileCosmeticsSelection,
  serializeProfileCosmeticsCatalog,
  validateProfileCosmeticSelection,
} from "../api/_portal-cosmetics.js";
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

const studioSource = await readFile(new URL("../src/components/ProfileCosmeticsTab.jsx", import.meta.url), "utf8");
assert.match(studioSource, /onPointerDown=\{\(event\) => startPointer\("move", event\)\}/, "studio exposes direct box dragging");
assert.match(studioSource, /startPointer\(handle, event\)/, "studio exposes resize handles");
assert.match(studioSource, /detectFrameMetadataFromUrl/, "studio has local alpha detection");
assert.match(studioSource, /save-frame-render-metadata/, "studio saves only on explicit metadata action");

console.log("profile cosmetics tests passed");
