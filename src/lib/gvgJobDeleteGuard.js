export function normalizeGvgJobGuildKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_-]/g, "");
}

function cleanJobId(value) {
  return String(value || "").trim();
}

function normalizeVpsPreviewPath(pathname) {
  let decodedPath = "";
  try {
    decodedPath = decodeURIComponent(String(pathname || "").trim()).replace(/\\/g, "/");
  } catch {
    return null;
  }

  const match = /^\/?public\/jobs\/([^/]+)\/([^/]+)\/previews\/([^/]+)$/i.exec(decodedPath);
  if (!match) return null;

  const [, sourceGuild, jobId, file] = match;
  if (!sourceGuild || !jobId || !file) return null;

  return {
    sourceGuild,
    sourceGuildKey: normalizeGvgJobGuildKey(sourceGuild),
    jobId,
    sourcePath: `/public/jobs/${sourceGuild}/${jobId}/previews/${file}`,
  };
}

function extractPreviewProxyJobRef(parsed) {
  const action = parsed.searchParams.get("action");
  if (action !== "preview") return null;

  const sourceGuild = parsed.searchParams.get("guild") || parsed.searchParams.get("sourceGuild");
  const jobId = parsed.searchParams.get("jobId") || parsed.searchParams.get("job_id");
  const file = parsed.searchParams.get("file");

  if (!sourceGuild || !jobId || !file) return null;
  return normalizeVpsPreviewPath(`/public/jobs/${sourceGuild}/${jobId}/previews/${file}`);
}

function extractVpsApiPreviewJobRef(pathname) {
  let decodedPath = "";
  try {
    decodedPath = decodeURIComponent(String(pathname || "").trim()).replace(/\\/g, "/");
  } catch {
    return null;
  }

  const match = /^\/api\/v1\/jobs\/([^/]+)\/([^/]+)\/preview\/([^/]+)$/i.exec(decodedPath);
  if (!match) return null;
  return normalizeVpsPreviewPath(`/public/jobs/${match[1]}/${match[2]}/previews/${match[3]}`);
}

export function extractGvgJobRefFromImageUrl(imageUrl) {
  const raw = String(imageUrl || "").trim();
  if (!raw) return null;

  const directPath = normalizeVpsPreviewPath(raw);
  if (directPath) return directPath;

  try {
    const parsed = new URL(raw, "https://portal.local");
    if (parsed.pathname === "/api/gvg-server") {
      return extractPreviewProxyJobRef(parsed);
    }

    return normalizeVpsPreviewPath(parsed.pathname) || extractVpsApiPreviewJobRef(parsed.pathname);
  } catch {
    return null;
  }
}

export function doesGvgDefenseReferenceJob(defense, { sourceGuild = "", jobId = "" } = {}) {
  const wantedJobId = cleanJobId(jobId);
  if (!wantedJobId) return false;

  const ref = extractGvgJobRefFromImageUrl(defense?.image_url || defense?.imageUrl || "");
  if (!ref || cleanJobId(ref.jobId) !== wantedJobId) return false;

  const wantedGuildKey = normalizeGvgJobGuildKey(sourceGuild);
  return !wantedGuildKey || ref.sourceGuildKey === wantedGuildKey;
}

function formatGuilds(rows) {
  const guilds = [];
  const seen = new Set();

  for (const row of rows || []) {
    const label = String(row?.guild || "").trim() || "Guilde inconnue";
    const key = normalizeGvgJobGuildKey(label) || label;
    if (seen.has(key)) continue;
    seen.add(key);
    guilds.push(label);
  }

  return guilds;
}

function buildActiveGvgLock(rows) {
  const references = (rows || []).map((row) => {
    const ref = extractGvgJobRefFromImageUrl(row?.image_url || row?.imageUrl || "");
    return {
      id: row?.id || null,
      guild: row?.guild || null,
      raw_name: row?.raw_name || row?.name || null,
      is_ally: row?.is_ally === true,
      image_url: row?.image_url || row?.imageUrl || null,
      source_guild: ref?.sourceGuild || null,
      job_id: ref?.jobId || null,
      source_path: ref?.sourcePath || null,
    };
  });

  const guilds = formatGuilds(references);

  return {
    locked: references.length > 0,
    referenced_by_active_gvg: references.length > 0,
    deletion_allowed: references.length === 0,
    guilds,
    defense_count: references.length,
    references,
  };
}

function getJobKey(sourceGuild, jobId) {
  const guildKey = normalizeGvgJobGuildKey(sourceGuild);
  const id = cleanJobId(jobId);
  if (!guildKey || !id) return "";
  return `${guildKey}::${id}`;
}

export function getJobIdentity(job) {
  const sourceGuild = String(
    job?.resolved_guild ||
      job?.source_guild ||
      job?.server_guild ||
      job?.guild ||
      job?.target_guild ||
      job?.mode ||
      "",
  ).trim();
  const jobId = cleanJobId(job?.resolved_job_id || job?.job_id || job?.id || "");
  return { sourceGuild, jobId, key: getJobKey(sourceGuild, jobId) };
}

async function selectActiveGvgDefenseImageRows(supabase, jobId = "") {
  let query = supabase
    .from("gvg_defense")
    .select("id, guild, is_ally, raw_name, image_url");

  const cleanId = cleanJobId(jobId);
  if (cleanId) {
    query = query.ilike("image_url", `%${cleanId}%`);
  } else {
    query = query.not("image_url", "is", null).limit(5000);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function findActiveGvgJobReferences(supabase, { sourceGuild = "", jobId = "" } = {}) {
  const rows = await selectActiveGvgDefenseImageRows(supabase, jobId);
  const references = rows.filter((row) => doesGvgDefenseReferenceJob(row, { sourceGuild, jobId }));
  return buildActiveGvgLock(references);
}

export function buildJobLocksFromActiveGvgRows(jobs = [], activeDefenseRows = []) {
  const locksByKey = new Map();

  for (const row of activeDefenseRows || []) {
    const ref = extractGvgJobRefFromImageUrl(row?.image_url || row?.imageUrl || "");
    if (!ref?.jobId || !ref.sourceGuildKey) continue;

    const key = getJobKey(ref.sourceGuild, ref.jobId);
    if (!key) continue;

    const rows = locksByKey.get(key) || [];
    rows.push(row);
    locksByKey.set(key, rows);
  }

  return (jobs || []).map((job) => {
    const identity = getJobIdentity(job);
    const lock = buildActiveGvgLock(locksByKey.get(identity.key) || []);
    return {
      ...job,
      active_gvg_lock: lock,
      deletion_locked: lock.locked,
    };
  });
}

export async function annotateJobsWithActiveGvgLocks(supabase, jobs = []) {
  if (!Array.isArray(jobs) || jobs.length === 0) return jobs;
  const activeDefenseRows = await selectActiveGvgDefenseImageRows(supabase);
  return buildJobLocksFromActiveGvgRows(jobs, activeDefenseRows);
}

export function formatJobDeleteBlockedMessage(lock) {
  const guilds = Array.isArray(lock?.guilds) ? lock.guilds.filter(Boolean) : [];
  if (guilds.length === 1) {
    return `Ce job ne peut pas etre supprime car il est encore utilise par la GvG active ${guilds[0]}. Reset la GvG avant de supprimer ce job.`;
  }
  if (guilds.length > 1) {
    return `Ce job est encore utilise par les GvG actives ${guilds.join(", ")}. Reset les GvG avant de supprimer ce job.`;
  }
  return "Ce job ne peut pas etre supprime car il est encore utilise par une GvG active.";
}
