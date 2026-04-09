import { createClient } from "@supabase/supabase-js";
import formidable from "formidable";
import fs from "fs";

export const config = {
  api: {
    bodyParser: false,
  },
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  const form = formidable({ multiples: true });

  form.parse(req, async (err, fields, files) => {
    try {
      if (err) {
        console.error("[gvg-upload-images] form parse error:", err);
        return res.status(500).json({ error: "form parse error" });
      }

      const guildRaw = Array.isArray(fields.guild) ? fields.guild[0] : fields.guild;
      const guild = String(guildRaw || "").toUpperCase();

      if (!guild || !["G1", "G2"].includes(guild)) {
        return res.status(400).json({ error: "guild manquante ou invalide" });
      }

      const incomingFiles = Array.isArray(files.files)
        ? files.files
        : files.files
          ? [files.files]
          : [];

      if (!incomingFiles.length) {
        return res.status(400).json({ error: "aucun fichier reçu" });
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

      return res.status(200).json({
        success: true,
        guild,
        results,
      });
    } catch (e) {
      console.error("[gvg-upload-images] server error:", e);
      return res.status(500).json({ error: "server error" });
    }
  });
}