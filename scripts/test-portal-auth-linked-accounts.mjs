import assert from "node:assert/strict";
import {
  buildPortalSession,
  hashPortalPassword,
  loadPortalPrincipalByDiscordId,
  PortalAuthResolutionError,
  verifyPortalPassword,
} from "../api/_portal-auth.js";

function projectRow(row, select) {
  const columns = String(select || "")
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);

  return columns.reduce((projected, column) => {
    projected[column] = row[column] ?? null;
    return projected;
  }, {});
}

function createFakeSupabase(rows) {
  const passwordReads = [];

  return {
    passwordReads,
    from(tableName) {
      assert.equal(tableName, "guild_members");

      return {
        select(select) {
          const selectedColumns = String(select || "")
            .split(",")
            .map((column) => column.trim())
            .filter(Boolean);
          const builder = {
            column: "",
            value: "",
            eq(column, value) {
              this.column = column;
              this.value = value;
              return this;
            },
            matchingRows() {
              const matches = rows.filter((row) => String(row[this.column] || "") === String(this.value || ""));
              if (selectedColumns.includes("password")) {
                passwordReads.push({
                  column: this.column,
                  value: this.value,
                  ids: matches.map((row) => row.id),
                });
              }
              return matches.map((row) => projectRow(row, select));
            },
            async maybeSingle() {
              const matches = this.matchingRows();
              if (matches.length > 1) {
                return {
                  data: null,
                  error: {
                    code: "PGRST116",
                    message: "Cannot coerce the result to a single JSON object",
                    details: `The result contains ${matches.length} rows`,
                  },
                };
              }
              return { data: matches[0] || null, error: null };
            },
            then(resolve, reject) {
              try {
                resolve({ data: this.matchingRows(), error: null });
              } catch (error) {
                reject(error);
              }
            },
          };

          return builder;
        },
      };
    },
  };
}

async function authenticate(rows, discordId, password) {
  const supabase = createFakeSupabase(rows);
  const member = await loadPortalPrincipalByDiscordId(supabase, discordId, { includePassword: true });
  return {
    member,
    passwordCheck: verifyPortalPassword(password, member?.password),
    passwordReads: supabase.passwordReads,
  };
}

const artysanPassword = "artysan-secret";
const dariusPassword = "darius-secret";
const dariusG2Password = "darius-g2-secret";

const artysan = {
  id: "artysan-id",
  watcher_name: "Artysan",
  discord_id: "discord-artysan",
  guild_code: "MAD G1",
  role: "admin",
  community_status: "active",
  password_change_required: false,
  primary_member_id: null,
  password: hashPortalPassword(artysanPassword),
};

const darius = {
  id: "darius-id",
  watcher_name: "Darius",
  discord_id: "discord-darius",
  guild_code: "G1",
  role: "leader",
  community_status: "active",
  password_change_required: false,
  primary_member_id: null,
  password: hashPortalPassword(dariusPassword),
};

const dariusG2 = {
  id: "darius-g2-id",
  watcher_name: "Darius G2",
  discord_id: "discord-darius",
  guild_code: "G2",
  role: "member",
  community_status: "active",
  password_change_required: false,
  primary_member_id: "darius-id",
  password: hashPortalPassword(dariusG2Password),
};

const dariusG3 = {
  ...dariusG2,
  id: "darius-g3-id",
  watcher_name: "Darius G3",
  guild_code: "G3",
};

{
  const result = await authenticate([artysan], "discord-artysan", artysanPassword);
  assert.equal(result.member.id, "artysan-id");
  assert.equal(result.passwordCheck.ok, true);
  assert.deepEqual(result.passwordReads.map((read) => read.ids), [["artysan-id"]]);
}

{
  const result = await authenticate([darius, dariusG2], "discord-darius", dariusPassword);
  assert.equal(result.member.id, "darius-id");
  assert.equal(result.member.role, "leader");
  assert.equal(result.passwordCheck.ok, true);
  assert.deepEqual(result.passwordReads.map((read) => read.ids), [["darius-id"]]);

  const session = buildPortalSession(result.member);
  assert.equal(session.memberId, "darius-id");
  assert.equal(session.role, "leader");
  assert.equal(session.isLeader, true);
}

{
  const result = await authenticate([dariusG2, darius, dariusG3], "discord-darius", dariusPassword);
  assert.equal(result.member.id, "darius-id");
  assert.equal(result.passwordCheck.ok, true);
  assert.deepEqual(result.passwordReads.map((read) => read.ids), [["darius-id"]]);
}

{
  const result = await authenticate([darius, dariusG2], "discord-darius", "wrong-password");
  assert.equal(result.member.id, "darius-id");
  assert.equal(result.passwordCheck.ok, false);
}

{
  const result = await authenticate([darius, dariusG2], "discord-darius", dariusG2Password);
  assert.equal(result.member.id, "darius-id");
  assert.equal(result.passwordCheck.ok, false, "secondary password must not authenticate the principal");
  assert.deepEqual(result.passwordReads.map((read) => read.ids), [["darius-id"]]);
}

{
  const supabase = createFakeSupabase([
    { ...darius, id: "principal-a" },
    { ...darius, id: "principal-b" },
    dariusG2,
  ]);

  await assert.rejects(
    () => loadPortalPrincipalByDiscordId(supabase, "discord-darius", { includePassword: true }),
    (error) => error instanceof PortalAuthResolutionError && error.code === "portal_auth_principal_ambiguous",
  );
  assert.equal(supabase.passwordReads.length, 0, "ambiguous principals must fail before password lookup");
}

{
  const supabase = createFakeSupabase([dariusG2]);

  await assert.rejects(
    () => loadPortalPrincipalByDiscordId(supabase, "discord-darius", { includePassword: true }),
    (error) => error instanceof PortalAuthResolutionError && error.code === "portal_auth_principal_missing",
  );
  assert.equal(supabase.passwordReads.length, 0, "missing principal must fail before password lookup");
}

{
  const supabase = createFakeSupabase([darius, dariusG2]);
  const member = await loadPortalPrincipalByDiscordId(supabase, "discord-darius");
  assert.equal(member.id, "darius-id");
  assert.equal(supabase.passwordReads.length, 0, "forgot-admins style lookup must not load passwords");
}

{
  const unlinkedDariusG2 = {
    ...dariusG2,
    primary_member_id: null,
  };
  const supabase = createFakeSupabase([darius, unlinkedDariusG2]);

  await assert.rejects(
    () => loadPortalPrincipalByDiscordId(supabase, "discord-darius", { includePassword: true }),
    (error) => error instanceof PortalAuthResolutionError && error.code === "portal_auth_principal_ambiguous",
  );
  assert.equal(supabase.passwordReads.length, 0, "unlinked accounts sharing Discord ID must not pick a principal");
}

console.log("portal auth linked account tests passed");
