import assert from "node:assert/strict";
import {
  loadCosmeticsForMemberIds,
  saveProfileCosmeticsSelection,
  serializeProfileCosmeticsCatalog,
  validateProfileCosmeticSelection,
} from "../api/_portal-cosmetics.js";
import {
  getFrameContentInset,
  resolveProfileCosmeticSelection,
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
      let rows = assets;
      if (state.inFilter?.column === "id") {
        const allowed = new Set(state.inFilter.values.map(String));
        rows = rows.filter((row) => allowed.has(String(row.id)));
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

console.log("profile cosmetics tests passed");
