import { createClient } from "@supabase/supabase-js";
import {
  applyPortalCorsHeaders,
  applyPortalSecurityHeaders,
  requirePortalSession,
  sendPortalJson,
} from "./_portal-auth.js";
import { canUseRunTargetGuild, resolveRunScope } from "../src/lib/runScopeServer.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export default async function handler(req, res) {
  applyPortalCorsHeaders(req, res);
  applyPortalSecurityHeaders(res);

  if (req.method !== "GET") {
    return sendPortalJson(res, 405, { error: "method not allowed" }, req);
  }

  try {
    const sessionCheck = await requirePortalSession(req, supabase);
    if (sessionCheck.error) {
      return sendPortalJson(res, sessionCheck.status || 401, { error: sessionCheck.error }, req);
    }

    const defenseId = req.query?.gvgDefenseId;

    if (!defenseId) {
      return sendPortalJson(res, 400, { error: "gvgDefenseId manquant" }, req);
    }

    const { data, error } = await supabase
      .from("gvg_defense")
      .select("id, guild, strat_data")
      .eq("id", defenseId)
      .maybeSingle();

    if (error) {
      return sendPortalJson(res, 500, { error: error.message }, req);
    }

    if (!data) {
      return sendPortalJson(res, 404, { error: "defense introuvable" }, req);
    }

    const runScope = await resolveRunScope(supabase, req, sessionCheck.member);
    if (!runScope.canUseGvg || !canUseRunTargetGuild(runScope, data.guild)) {
      return sendPortalJson(res, 403, { error: "acces gvg refuse" }, req);
    }

    return sendPortalJson(res, 200, {
      success: true,
      strat: data?.strat_data || null,
    }, req);
  } catch (err) {
    return sendPortalJson(res, err?.statusCode || 500, { error: err?.message || "server error" }, req);
  }
}
