import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export async function testAllyDeliverySql({ db, query, one, scenario, fails, equal, ok, id, g2, g8, g9, gx, admin, thanatos, d1, d2, foreign }) {
  const script = async name => (await query(await readFile(new URL(name, import.meta.url), "utf8"))).rows[0];
  const pre = (await script("./gvg_ally_delivery_preflight.sql")).gvg_ally_delivery_preflight;
  equal(pre.all_checks_ok, true);
  await db.exec(await readFile(new URL("./gvg_ally_delivery.sql", import.meta.url), "utf8"));
  const verify = (await script("./gvg_ally_delivery_verify.sql")).gvg_ally_delivery_verify;
  equal(verify.all_checks_ok, true, JSON.stringify(verify.checks));
  equal(verify.fingerprints, pre.fingerprints, "Installation preserves existing players, defenses and opening states");
  equal(verify.protected_functions, pre.protected_functions, "No reset, preparation or similarity function replaced");
  equal(verify.receipts, 0); equal(verify.delivery_enabled, true);
  const read = (gid = g2, actor = admin) => one("select read_gvg_ally_delivery($1,$2)", [gid, actor]);
  const prepare = async (defense = d1) => {
    const v = await read();
    await one("select save_gvg_ally_followup($1,$2,$3,'opened',$4,$5,$6)",
      [g2, admin, defense, { opened: true }, v.states.find(s => s.defense_id === defense)?.revision || 0, v.roster_version]);
    return read();
  };
  const payload = { owner_member_id: thanatos, thread_url: "https://discord.com/channels/111111111111111111/222222222222222222", content: "Isolated feedback, never delivered." };
  let serial = 2000;
  const claim = async (defense = d1, snapshot = null, value = payload, gid = g2, actor = admin) => {
    const v = snapshot || await read(gid, actor);
    return one("select claim_gvg_ally_delivery($1,$2,$3,$4,$5,$6,$7)", [gid, actor, defense, v.snapshot_version, value, id(serial++), id(serial++)]);
  };
  const finish = (receipt, status = "sent", token = receipt.claim_token) => one("select finish_gvg_ally_delivery($1,$2,$3,$4,$5)",
    [receipt.receipt_id, token, status, status === "sent" ? "333333333333333333" : null, status === "sent" ? null : "Isolated failure"]);

  await scenario("Delivery claim is unique per defense, not per player; sent receipts cannot be requeued", async () => {
    await prepare(); const v = await read(); const first = await claim(d1, v); equal(first.claimed, true);
    equal((await claim(d1, v)).claimed, false, "A second concurrent claimant cannot also own this defense");
    equal((await read()).deliveries[0].status, "sending");
    equal((await finish(first)).status, "sent");
    equal((await claim()).status, "sent");
    await prepare(d2); equal((await claim(d2)).claimed, true, "The same player's team 2 gets its own message");
    equal(await one("select count(*)::integer from gvg_ally_deliveries"), 2);
    equal((await finish(first, "failed")).status, "sent", "A late error cannot overwrite successful evidence");
  });
  await scenario("Definite rejection is retryable, but uncertain and abandoned sends are never requeued", async () => {
    await prepare(); const first = await claim(); await finish(first, "failed");
    const retry = await claim(); equal(retry.claimed, true); ok(retry.claim_token !== first.claim_token);
    await fails(() => finish(first), /Recu non autorise/);
    await finish(retry, "uncertain"); equal((await claim()).status, "uncertain");
    await prepare(d2); const pending = await claim(d2);
    await query("update gvg_ally_deliveries set updated_at=now()-interval '3 hours' where id=$1", [pending.receipt_id]);
    equal((await claim(d2)).claimed, false, "Time passing alone cannot prove non-delivery");
  });
  await scenario("Ownership, thread, full preview snapshot, organization and reset scope are enforced", async () => {
    await fails(() => claim(), /non ouverte/);
    await prepare(); const stale = await read();
    await query("update guild_members set personal_forum_post_url=personal_forum_post_url||'/' where id=$1", [thanatos]);
    await fails(() => claim(d1, stale), /ont change/);
    await fails(() => claim(), /Destinataire/);
    await query("update guild_members set personal_forum_post_url=$2 where id=$1", [thanatos, payload.thread_url]);
    await fails(() => claim(d1, null, { ...payload, thread_url: "https://evil.invalid" }), /Destinataire/);
    await fails(() => claim(d1, null, { ...payload, owner_member_id: id(110) }), /Destinataire/);
    await fails(() => claim(foreign), /Defense alliee/);
    await fails(() => read(gx), /organization_forbidden/);
    await query("insert into gvg_reset_operations values($1,$2,'prepared')", [id(2800), g2]);
    await fails(() => claim(), /Reset en cours/);
    equal(await one("select count(*)::integer from gvg_ally_deliveries"), 0);
  });
  await scenario("A receipt survives reset, finishes after permission loss, and does not suppress a newly imported defense", async () => {
    await prepare(); const first = await claim();
    await query("delete from gvg_defense where id=$1", [d1]);
    equal(await one("select count(*)::integer from gvg_ally_followup_state where defense_id=$1", [d1]), 0);
    equal(await one("select count(*)::integer from gvg_ally_deliveries"), 1);
    await query("update guild_members set role='member' where id=$1", [admin]);
    equal((await finish(first)).status, "sent", "An existing server capability can finalize, but cannot initiate another delivery");
    await fails(() => read(), /actor_forbidden/);
    await query("update guild_members set role='admin' where id=$1", [admin]);
    await query("insert into gvg_defense select $1,guild,bastion,type,tower,team,is_ally,heroes,youtube_url,record_status,now() from gvg_defense where id=$2", [id(2900), d2]);
    await prepare(id(2900)); equal((await claim(id(2900))).claimed, true);
  });
  await scenario("All historical and dynamic guilds are scoped by catalog, and delivery can be disabled without touching campaigns", async () => {
    for (const gid of [g2, g8, g9]) equal((await read(gid)).delivery_version, 1);
    await prepare(); await query("update gvg_ally_delivery_settings set delivery_enabled=false");
    await fails(() => claim(), /desactives/); equal((await read()).delivery_enabled, false);
    await fails(() => finish({ receipt_id: id(9990), claim_token: id(9991) }), /Recu non autorise/);
    equal(await one("select count(*)::integer from gvg_ally_deliveries"), 0);
  });
  assert.equal(verify.checks.length, 16);
  console.log(`Delivery SQL: additive verify ${verify.checks.length}/${verify.checks.length}, protected function and business fingerprints unchanged; no network.`);
}
