import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const repo = fileURLToPath(new URL("../", import.meta.url));
const sha = (text) => createHash("sha256").update(text).digest("hex");

export async function prepareDiscordAvatarVps(sourceRoot, destination) {
  const source = path.resolve(sourceRoot), output = path.resolve(destination);
  for (const forbidden of [repo, source]) {
    const relative = path.relative(forbidden, output);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
      throw Error("Prepare into a fresh directory outside the repository and the source checkout.");
    }
  }
  const main = await readFile(path.join(source, "app/main.py"), "utf8");
  const requirements = await readFile(path.join(source, "requirements.txt"), "utf8");
  const dockerfile = await readFile(path.join(source, "Dockerfile"), "utf8");
  const constraints = await readFile(path.join(source, "runtime-constraints.txt"), "utf8");
  const runtimeImageId = (await readFile(path.join(source, "runtime-api-image-id.txt"), "utf8")).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(runtimeImageId)) throw Error("Expected immutable image ID of the currently running API.");
  if (!constraints.trim() || constraints.trim().split(/\r?\n/).some((line) => !/^[A-Za-z0-9_.-]+==[A-Za-z0-9.+_-]+$/.test(line))) {
    throw Error("Use a package-name/version-only snapshot of the currently running API dependencies.");
  }
  if (!/^app\s*=\s*FastAPI\(/m.test(main) || !/^def require_token\(/m.test(main)) throw Error("Expected API integration points missing.");
  if (main.includes("install_discord_avatar_cache")) throw Error("An integration already exists. Review instead of appending a duplicate.");
  if (/^Pillow\b/im.test(requirements)) throw Error("Existing Pillow dependency requires review.");
  const copyRequirements = /^COPY requirements\.txt \.\r?$/gm;
  if ([...dockerfile.matchAll(copyRequirements)].length !== 1 || !/^RUN pip install --no-cache-dir -r requirements\.txt\r?$/m.test(dockerfile)) {
    throw Error("Expected dependency installation in Dockerfile missing. Review before preparing.");
  }
  const baseImageReference = `gvg-paladin-api:pre-discord-avatars-${runtimeImageId.slice(7)}`;
  const template = await readFile(path.join(repo, "ops/discord-avatars/Dockerfile.existing-api-image"), "utf8");
  const preparedDockerfile = template.replace("__API_BASE_IMAGE__", baseImageReference);
  await mkdir(output); // Refuse to overwrite any pre-existing package or checkout.
  await mkdir(path.join(output, "app"));
  const integration = "\n\n# Discord avatar cache: independent, disabled until explicitly configured and armed.\nfrom .discord_avatar_cache import install_discord_avatar_cache\ninstall_discord_avatar_cache(app, require_token)\n";
  await writeFile(path.join(output, "app/main.py"), main + integration);
  for (const file of ["discord_avatar_cache.py", "discord_avatar_admin.py", "discord_avatar_limited_test.py"]) {
    await copyFile(path.join(repo, "ops/discord-avatars", file), path.join(output, "app", file));
  }
  const extra = await readFile(path.join(repo, "ops/discord-avatars/requirements.txt"), "utf8");
  await writeFile(path.join(output, "requirements.txt"), requirements.trimEnd() + "\n-c avatar-runtime-constraints.txt\n" + extra);
  await writeFile(path.join(output, "avatar-runtime-constraints.txt"), constraints);
  await writeFile(path.join(output, "Dockerfile"), preparedDockerfile);
  const fingerprint = { sourceMainSha256: sha(main), sourceRequirementsSha256: sha(requirements), sourceDockerfileSha256: sha(dockerfile), runtimeConstraintsSha256: sha(constraints), requiredBaseImageId: runtimeImageId, requiredBaseImageReference: baseImageReference, preparedMainSha256: sha(main + integration), preparedDockerfileSha256: sha(preparedDockerfile) };
  await writeFile(path.join(output, "source-fingerprints.json"), JSON.stringify(fingerprint, null, 2) + "\n");
  return { output, ...fingerprint };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw Error("Usage: node scripts/prepare-discord-avatar-vps.mjs <local-readonly-api-copy> <new-outside-repo-directory>");
  console.log(JSON.stringify(await prepareDiscordAvatarVps(process.argv[2], process.argv[3]), null, 2));
}
