"""Restore only the API image/source and Caddy configuration from a verified backup."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("backup")
    parser.add_argument("--confirm", action="store_true")
    args = parser.parse_args()
    root = Path("/opt/gvg-paladin")
    backup = Path(args.backup).resolve()
    if not backup.is_relative_to(root / "backups"):
        raise SystemExit("Backup must be inside the known private backup directory")
    proof = json.loads((backup / "backup-verification.json").read_text())
    if not proof.get("verified"):
        raise SystemExit("Backup not verified")
    image = json.loads(subprocess.check_output(["docker", "image", "inspect", proof["image_tag"]], text=True))[0]
    if image["Id"] != proof["image_id"]:
        raise SystemExit("Rollback image mismatch")
    for relative, digest in proof["source_hashes"].items():
        saved = backup / ("Caddyfile" if relative == "caddy/Caddyfile" else relative)
        if hashlib.sha256(saved.read_bytes()).hexdigest() != digest:
            raise SystemExit("Rollback source integrity check failed")
    if not args.confirm:
        print("Rollback verified; no action without --confirm")
        return
    for relative in ["app/main.py", "requirements.txt", "Dockerfile"]:
        shutil.copy2(backup / "api" / relative, root / "api" / relative)
    subprocess.run(["docker", "image", "tag", proof["image_id"], "gvg-paladin-api"], check=True)
    subprocess.run(["docker", "compose", "--env-file", str(root / ".env"), "-f", str(root / "docker-compose.yml"),
        "up", "-d", "--no-deps", "--no-build", "--force-recreate", "api"], check=True)
    # Preserve the inode of the individual Caddyfile bind mount.
    (root / "caddy/Caddyfile").write_bytes((backup / "Caddyfile").read_bytes())
    subprocess.run(["docker", "exec", "gvg-paladin-assets-caddy", "caddy", "validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"], check=True)
    subprocess.run(["docker", "exec", "gvg-paladin-assets-caddy", "caddy", "reload", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"], check=True)
    print("Previous API and Caddy restored. Avatar cache and survey data were not removed.")


if __name__ == "__main__":
    main()
