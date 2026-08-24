[CmdletBinding()]
param(
  [switch] $Apply,
  [string] $LocalRoot,
  [string] $NormalizedRoot,
  [string] $BackupRoot,
  [string] $ManifestPath,
  [string] $PythonExe = "python"
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$repoRoot = Get-RepoRoot

if ([string]::IsNullOrWhiteSpace($LocalRoot)) {
  $LocalRoot = Join-Path $repoRoot "public\profile-cosmetics"
}

if ([string]::IsNullOrWhiteSpace($NormalizedRoot)) {
  $NormalizedRoot = Join-Path ([IO.Path]::GetTempPath()) ("profile-cosmetics-normalized-" + [Guid]::NewGuid().ToString("N"))
}

if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
  $repoParent = Split-Path -Parent $repoRoot
  $BackupRoot = Join-Path $repoParent ("profile-cosmetics-original-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
}

if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
  $ManifestPath = Join-Path $repoRoot "scripts\profile-cosmetics-normalization-manifest.json"
}

$pythonCode = @'
import argparse
import hashlib
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

TARGET_SIZE = 1024


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def has_alpha(image: Image.Image) -> bool:
    if image.mode in ("RGBA", "LA"):
        return True
    if image.mode == "P" and "transparency" in image.info:
        return True
    return False


def alpha_bbox(image: Image.Image):
    if not has_alpha(image):
        return None
    return image.convert("RGBA").getchannel("A").getbbox()


def alpha_stats(image: Image.Image):
    if not has_alpha(image):
        return {
            "has_alpha": False,
            "transparent_pixels": 0,
            "opaque_pixels": image.width * image.height,
            "center_alpha": None,
            "center_window_max_alpha": None,
        }

    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    values = alpha.getdata()
    transparent = 0
    opaque = 0
    for value in values:
        if value == 0:
            transparent += 1
        if value == 255:
            opaque += 1

    center_x = image.width // 2
    center_y = image.height // 2
    window_radius = 32
    left = max(0, center_x - window_radius)
    top = max(0, center_y - window_radius)
    right = min(image.width, center_x + window_radius)
    bottom = min(image.height, center_y + window_radius)
    center_window = alpha.crop((left, top, right, bottom))

    return {
        "has_alpha": True,
        "transparent_pixels": transparent,
        "opaque_pixels": opaque,
        "center_alpha": int(alpha.getpixel((center_x, center_y))),
        "center_window_max_alpha": int(max(center_window.getdata())),
    }


def safe_relative_path(path: Path, root: Path) -> Path:
    resolved_path = path.resolve()
    resolved_root = root.resolve()
    try:
        rel = resolved_path.relative_to(resolved_root)
    except ValueError as exc:
        raise RuntimeError(f"path outside root: {path}") from exc

    if any(part in ("", ".", "..") for part in rel.parts):
        raise RuntimeError(f"unsafe relative path: {rel}")
    return rel


def normalize_image(src: Path, dst: Path, asset_type: str):
    original_sha = sha256(src)
    with Image.open(src) as image:
        image.load()
        original_format = image.format
        original_mode = image.mode
        original_size = image.size
        original_alpha = has_alpha(image)
        original_bbox = alpha_bbox(image)
        method = "resize"
        padding = None

        if original_size[0] != original_size[1]:
            method = "transparent-padding-and-resize"
            rgba = image.convert("RGBA")
            width, height = rgba.size
            side = max(width, height)
            bbox = alpha_bbox(rgba)

            if bbox:
                bbox_center_x = (bbox[0] + bbox[2]) / 2
                bbox_center_y = (bbox[1] + bbox[3]) / 2
                offset_x = round(side / 2 - bbox_center_x)
                offset_y = round(side / 2 - bbox_center_y)
            else:
                offset_x = round((side - width) / 2)
                offset_y = round((side - height) / 2)

            offset_x = max(0, min(offset_x, side - width))
            offset_y = max(0, min(offset_y, side - height))
            canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            canvas.alpha_composite(rgba, (offset_x, offset_y))
            work = canvas
            padding = {
                "side": side,
                "offset_x": offset_x,
                "offset_y": offset_y,
                "visible_bbox": list(bbox) if bbox else None,
            }
        else:
            if asset_type == "frame" or original_alpha:
                work = image.convert("RGBA")
            else:
                work = image.convert("RGB")

        normalized = work.resize((TARGET_SIZE, TARGET_SIZE), Image.Resampling.LANCZOS)
        dst.parent.mkdir(parents=True, exist_ok=True)
        normalized.save(dst, format="PNG", optimize=False)

    normalized_sha = sha256(dst)
    with Image.open(dst) as output:
        output.load()
        normalized_format = output.format
        normalized_mode = output.mode
        normalized_size = output.size
        normalized_alpha = has_alpha(output)
        stats = alpha_stats(output)

    checks = {
        "png": normalized_format == "PNG",
        "dimensions_1024": normalized_size == (TARGET_SIZE, TARGET_SIZE),
        "readable": True,
        "alpha_preserved_when_present": (not original_alpha) or normalized_alpha,
        "frame_has_alpha": asset_type != "frame" or normalized_alpha,
        "frame_has_transparency": asset_type != "frame" or stats["transparent_pixels"] > 0,
        "frame_center_transparent": asset_type != "frame" or (
            stats["center_alpha"] is not None and stats["center_alpha"] <= 8
        ),
    }
    checks["all_ok"] = all(checks.values())

    return {
        "local_path": str(src),
        "asset_type": asset_type,
        "filename": src.name,
        "method": method,
        "original": {
            "width": original_size[0],
            "height": original_size[1],
            "format": original_format,
            "mode": original_mode,
            "has_alpha": original_alpha,
            "visible_bbox": list(original_bbox) if original_bbox else None,
            "sha256": original_sha,
        },
        "normalized": {
            "path": str(dst),
            "width": normalized_size[0],
            "height": normalized_size[1],
            "format": normalized_format,
            "mode": normalized_mode,
            "has_alpha": normalized_alpha,
            "sha256": normalized_sha,
            "alpha_stats": stats,
        },
        "padding": padding,
        "checks": checks,
    }


def copy_exact_files(records, root: Path, backup_root: Path):
    copied = []
    for record in records:
        src = Path(record["local_path"])
        rel = safe_relative_path(src, root)
        dst = backup_root / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied.append(str(dst))
    return copied


def replace_exact_files(records):
    replaced = []
    for record in records:
        src = Path(record["normalized"]["path"])
        dst = Path(record["local_path"])
        shutil.copy2(src, dst)
        replaced.append(str(dst))
    return replaced


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--local-root", required=True)
    parser.add_argument("--normalized-root", required=True)
    parser.add_argument("--backup-root", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    local_root = Path(args.local_root)
    normalized_root = Path(args.normalized_root)
    backup_root = Path(args.backup_root)
    manifest_path = Path(args.manifest)

    folders = [
        ("avatar", "avatars"),
        ("frame", "frames"),
    ]

    records = []
    for asset_type, folder in folders:
        folder_path = local_root / folder
        for src in sorted(folder_path.glob("*.png"), key=lambda p: p.name.lower()):
            rel = safe_relative_path(src, local_root)
            dst = normalized_root / rel
            records.append(normalize_image(src, dst, asset_type))

    all_ok = len(records) == 35 and all(record["checks"]["all_ok"] for record in records)
    backup_files = []
    replaced_files = []

    if args.apply:
        if not all_ok:
            raise RuntimeError("normalization checks failed; refusing to replace originals")
        backup_files = copy_exact_files(records, local_root, backup_root)
        replaced_files = replace_exact_files(records)

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "applied": bool(args.apply),
        "local_root": str(local_root),
        "normalized_root": str(normalized_root),
        "backup_root": str(backup_root),
        "summary": {
            "total_assets": len(records),
            "avatars": sum(1 for record in records if record["asset_type"] == "avatar"),
            "frames": sum(1 for record in records if record["asset_type"] == "frame"),
            "checks_ok": all_ok,
            "backup_files": len(backup_files),
            "replaced_files": len(replaced_files),
        },
        "assets": records,
        "backup_files": backup_files,
        "replaced_files": replaced_files,
    }

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(manifest["summary"], ensure_ascii=False))
    print(f"manifest={manifest_path}")
    if args.apply:
        print(f"backup_root={backup_root}")
    if not all_ok:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
'@

$tempScript = Join-Path ([IO.Path]::GetTempPath()) ("normalize-profile-cosmetics-" + [Guid]::NewGuid().ToString("N") + ".py")
Set-Content -LiteralPath $tempScript -Value $pythonCode -Encoding UTF8

try {
  $arguments = @(
    $tempScript,
    "--local-root", $LocalRoot,
    "--normalized-root", $NormalizedRoot,
    "--backup-root", $BackupRoot,
    "--manifest", $ManifestPath
  )

  if ($Apply) {
    $arguments += "--apply"
  }

  Write-Host "Profile cosmetics source: $LocalRoot"
  Write-Host "Normalized output: $NormalizedRoot"
  Write-Host "Backup root: $BackupRoot"
  Write-Host "Manifest: $ManifestPath"
  Write-Host "Apply: $([bool] $Apply)"

  & $PythonExe @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Normalization failed with exit code $LASTEXITCODE"
  }
} finally {
  Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue
}
