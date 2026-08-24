# Profile Cosmetics Staging

`public/profile-cosmetics/` is a temporary local staging area for new profile cosmetic PNG files.

It is not the production storage location. The canonical production files live on the VPS:

```text
/opt/gvg-paladin/storage/assets/profile-cosmetics/avatars/
/opt/gvg-paladin/storage/assets/profile-cosmetics/frames/
```

Public URLs must use the VPS asset host:

```text
https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/<file>.png
https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/<file>.png
```

Never use `/profile-cosmetics/...` or a Vercel-local path in `portal_cosmetic_assets.asset_url`.

## Import Workflow

1. Generate the avatar or frame PNG.
2. Drop avatars in `public/profile-cosmetics/avatars/`.
3. Drop frames in `public/profile-cosmetics/frames/`.
4. Run a dry-run first:

   ```powershell
   .\scripts\upload-profile-cosmetics.ps1 -DryRun -KeepLocal
   ```

5. Review the report and manifest: filenames, type, dimensions, PNG mode, alpha, SHA-256, upload endpoint, and target URL.
6. Run the real upload through the dedicated VPS profile-cosmetics endpoint:

   ```powershell
   .\scripts\upload-profile-cosmetics.ps1 -KeepLocal
   ```

   The script uses `X-GVG-Token` with the same token configuration as the existing hero-calques upload workflow. It does not copy files through SSH and does not send a destination path to the server.

   After the SQL and application validation are complete, a cleanup run can be performed without `-KeepLocal` if the exact current-run manifest is still valid:

   ```powershell
   .\scripts\upload-profile-cosmetics.ps1
   ```

7. The script writes a manifest to `scripts/profile-cosmetics-upload-manifest.json` and verifies each uploaded file through the public HTTPS URL:

   - HTTP `200`
   - `Content-Type: image/png`
   - same dimensions as local
   - same SHA-256 as local
   - alpha preserved for frames

8. Only files uploaded and verified during the current run can be removed from local staging.
9. Run the SQL preflight.
10. Run the additive SQL insert.
11. Run the SQL verify.
12. The new cosmetics should appear automatically in `Mon profil`.

## Safety Rules

- Local missing file does not mean the asset should be removed from the catalog.
- The workflow is additive only.
- Never delete a VPS asset automatically from this staging workflow.
- Never delete a Supabase `portal_cosmetic_assets` row automatically from this staging workflow.
- Never modify player selections from this staging workflow.
- Do not put profile cosmetics in `assets/calques` or `hero-calques`.
- Do not commit secrets or local `.env` files.

## Access Configuration

The upload script reads the VPS URL and token from command-line arguments, environment variables, or `.env.local`:

```text
GVG_SERVER_URL
GVG_VPS_URL
GVG_API_TOKEN
GVG_SERVER_TOKEN
```

The expected endpoint is:

```text
/api/v1/profile-cosmetics/{assetType}/base64
```

where `{assetType}` is exactly `avatar` or `frame`.

The current deployed GvG HTTP upload API only supports hero calques. Profile cosmetics must not be uploaded through the hero-calques endpoint or any generic calques route.
