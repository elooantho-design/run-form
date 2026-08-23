# Profile cosmetics staging

This directory is only a local staging area for new profile cosmetic PNG files.
Production catalog rows must use the public VPS URL stored in Supabase
`portal_cosmetic_assets.asset_url`.

Current VPS layout:

```text
/opt/gvg-paladin/storage/assets/profile-cosmetics/avatars/
/opt/gvg-paladin/storage/assets/profile-cosmetics/frames/
```

Public URL layout:

```text
https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/avatars/<file>.png
https://vps-aad12be0.vps.ovh.net/assets/profile-cosmetics/frames/<file>.png
```

Workflow for new assets:

1. Drop the PNG in `public/profile-cosmetics/avatars/` or `public/profile-cosmetics/frames/`.
2. Verify it is a PNG and keep the exact filename.
3. Upload it to the matching VPS folder under `/opt/gvg-paladin/storage/assets/profile-cosmetics/`.
4. Refuse overwrite if the remote file already exists unless the replacement is intentional.
5. Verify the public HTTPS URL returns `200` with `Content-Type: image/png`.
6. Add the asset to `scripts/profile_cosmetics.sql` with the final VPS URL.
7. Run the Supabase preflight and migration only after the VPS URLs are verified.
8. After production validation, the local staging PNG may be removed without breaking the dashboard.

Do not put profile cosmetics in `assets/calques` or `hero-calques`.
Do not commit secrets or local `.env` files.
