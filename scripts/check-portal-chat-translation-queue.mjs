#!/usr/bin/env node
/* global process */
import { createClient } from "@supabase/supabase-js";

function clean(value) {
  return String(value || "").trim();
}

const supabaseUrl = clean(process.env.SUPABASE_URL);
const serviceRoleKey = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);

if (!supabaseUrl || !serviceRoleKey) {
  console.error("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

async function countByStatus(status) {
  const { count, error } = await supabase
    .from("portal_chat_translation_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", status);

  if (error) throw error;
  return Number(count || 0);
}

async function oldestPendingAgeSeconds() {
  const { data, error } = await supabase
    .from("portal_chat_translation_jobs")
    .select("created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data?.created_at) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(data.created_at).getTime()) / 1000));
}

async function main() {
  const statuses = ["pending", "processing", "completed", "failed"];
  const counts = Object.fromEntries(await Promise.all(statuses.map(async (status) => [status, await countByStatus(status)])));
  const oldestPendingAge = await oldestPendingAgeSeconds();

  console.log(JSON.stringify({ counts, oldestPendingAgeSeconds: oldestPendingAge }, null, 2));
}

await main();
