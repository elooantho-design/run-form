import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, relative, join, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";

export async function prepareIntersaisonBot(destination) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const output = resolve(destination);
  const inside = relative(root, output);
  if (!inside || (inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))) {
    throw new Error("Prepare the bot outside the repository, never in the live VPS checkout.");
  }
  await mkdir(join(output, "services"), { recursive: true });
  await mkdir(join(output, "shared"), { recursive: true });
  await copyFile(join(root, "ops/intersaison-bot/Dockerfile"), join(output, "Dockerfile"));
  await copyFile(join(root, "ops/intersaison-bot/services/guildDmCampaigns.cjs"), join(output, "services/guildDmCampaigns.js"));
  await copyFile(join(root, "ops/intersaison-bot/services/intersaisonChoice.cjs"), join(output, "services/intersaisonChoice.cjs"));
  for (const name of ["intersaisonSurveyChoices.js", "intersaisonSurveyObjectives.js", "guildDisplay.js", "guildScope.js"]) {
    await copyFile(join(root, "src/lib", name), join(output, "shared", name));
  }
  await writeFile(join(output, "shared/package.json"), JSON.stringify({ type: "module" }) + "\n");
  await writeFile(join(output, "package.json"), JSON.stringify({ type: "commonjs" }) + "\n");
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Usage: node scripts/prepare-intersaison-bot.mjs <outside-repo-output-directory>");
  console.log(await prepareIntersaisonBot(process.argv[2]));
}
