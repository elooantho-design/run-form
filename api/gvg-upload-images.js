import { createClient } from "@supabase/supabase-js";
import formidable from "formidable";
import fs from "fs";
import {
  applyPortalCorsHeaders,
  applyPortalSecurityHeaders,
  requirePortalAdminSession,
  sendPortalJson,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";
import { canUseRunTargetGuild, resolveRunScope } from "../src/lib/runScopeServer.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normalizeGuildCode(value) {
  const code = String(value || "").trim().toUpperCase().replace(/\s+/g, "_");
  return /^[A-Z0-9_-]{2,24}$/.test(code) ? code : null;
}

function isValidGuild(value) {
  return normalizeGuildCode(value) !== null;
}

function parseFileName(fileName) {
  const clean = String(fileName || "").toLowerCase();

  const bastionMatch = clean.match(/bastion_(\d+)/);
  const teamMatch = clean.match(/team_(\d+)/);
  const towerMatch = clean.match(/tower_(\d+)/);
  const isFortress = clean.includes("fortress");

  return {
    bastion: bastionMatch ? Number(bastionMatch[1]) : null,
    team: teamMatch ? Number(teamMatch[1]) : null,
    tower: towerMatch ? Number(towerMatch[1]) : null,
    type: isFortress ? "fortress" : "tower",
  };
}

export default async function handler(req, res) {
  applyPortalCorsHeaders(req, res);
  applyPortalSecurityHeaders(res);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return sendPortalJson(res, 405, { error: "method not allowed" }, req);
  }

  if (!verifyPortalRequestOrigin(req)) {
    return sendPortalJson(res, 403, { error: "origine invalide" }, req);
  }

  const sessionCheck = await requirePortalAdminSession(req, supabase);
  if (sessionCheck.error) {
    return sendPortalJson(res, sessionCheck.status || 401, { error: sessionCheck.error }, req);
  }

  const form = formidable({ multiples: true });

  form.parse(req, async (err, fields, files) => {
    try {
      if (err) {
        console.error("[gvg-upload-images] form parse error:", err);
        return sendPortalJson(res, 500, { error: "form parse error" }, req);
      }

      const guildRaw = Array.isArray(fields.guild) ? fields.guild[0] : fields.guild;
      const guild = normalizeGuildCode(guildRaw);

      if (!isValidGuild(guild)) {
        return sendPortalJson(res, 400, { error: "guild manquante ou invalide" }, req);
      }

      const runScope = await resolveRunScope(supabase, req, sessionCheck.member);
      if (!runScope.canUseGvg || !canUseRunTargetGuild(runScope, guild)) {
        return sendPortalJson(res, 403, { error: "acces gvg refuse" }, req);
      }

      const incomingFiles = Array.isArray(files.files)
        ? files.files
        : files.files
          ? [files.files]
          : [];

      if (!incomingFiles.length) {
        return sendPortalJson(res, 400, { error: "aucun fichier recu" }, req);
      }

      const results = [];

      for (const file of incomingFiles) {
        const fileName = file.originalFilename || "";
        const parsed = parseFileName(fileName);

        if (!parsed.bastion || !parsed.team || !parsed.type) {
          results.push({
            file: fileName,
            success: false,
            error: "nom de fichier invalide",
          });
          continue;
        }

        const buffer = fs.readFileSync(file.filepath);
        const storagePath = `${guild}/${Date.now()}_${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from("gvg-images")
          .upload(storagePath, buffer, {
            contentType: file.mimetype || "image/png",
            upsert: false,
          });

        if (uploadError) {
          results.push({
            file: fileName,
            success: false,
            error: uploadError.message,
          });
          continue;
        }

        const { data: publicUrlData } = supabase.storage
          .from("gvg-images")
          .getPublicUrl(storagePath);

        const imageUrl = publicUrlData?.publicUrl || null;

        if (!imageUrl) {
          results.push({
            file: fileName,
            success: false,
            error: "url publique introuvable",
          });
          continue;
        }

        let query = supabase
          .from("gvg_defense")
          .update({
            image_url: imageUrl,
            updated_at: new Date().toISOString(),
          })
          .eq("guild", guild)
          .eq("bastion", parsed.bastion)
          .eq("team", parsed.team)
          .eq("type", parsed.type);

        if (parsed.type === "tower") {
          query = query.eq("tower", parsed.tower);
        }

        const { data: updatedRows, error: updateError } = await query
          .select("id, guild, bastion, type, tower, team")
          .maybeSingle();

        if (updateError) {
          results.push({
            file: fileName,
            success: false,
            error: updateError.message,
          });
          continue;
        }

        if (!updatedRows) {
          results.push({
            file: fileName,
            success: false,
            error: "aucune défense correspondante trouvée",
          });
          continue;
        }

        results.push({
          file: fileName,
          success: true,
          imageUrl,
          match: updatedRows,
        });
      }

      return sendPortalJson(res, 200, {
        success: true,
        guild,
        results,
      }, req);
    } catch (e) {
      console.error("[gvg-upload-images] server error:", e);
      return sendPortalJson(res, e?.statusCode || 500, { error: e?.message || "server error" }, req);
    }
  });
}
