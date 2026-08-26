begin;

do $$
begin
  if to_regclass('public.portal_cosmetic_assets') is null then
    raise exception 'Table public.portal_cosmetic_assets introuvable.';
  end if;

  if exists (
    select 1
    from public.portal_cosmetic_assets asset
    where not (
      (
        asset.asset_type = 'avatar'
        and (
          asset.asset_url ~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/profile-cosmetics/avatars/[^/]+\.png$'
          or asset.asset_url ~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/profile-cosmetics/avatar-videos/[^/]+\.(mp4|webm)$'
        )
      )
      or (
        asset.asset_type = 'frame'
        and asset.asset_url ~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/profile-cosmetics/frames/[^/]+\.png$'
      )
    )
  ) then
    raise exception 'Des URLs de cosmetiques existantes ne respectent pas la nouvelle contrainte.';
  end if;
end;
$$;

alter table public.portal_cosmetic_assets
  drop constraint if exists portal_cosmetic_assets_url_check;

alter table public.portal_cosmetic_assets
  add constraint portal_cosmetic_assets_url_check check (
    (
      asset_type = 'avatar'
      and (
        asset_url ~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/profile-cosmetics/avatars/[^/]+\.png$'
        or asset_url ~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/profile-cosmetics/avatar-videos/[^/]+\.(mp4|webm)$'
      )
    )
    or (
      asset_type = 'frame'
      and asset_url ~ '^https://vps-aad12be0\.vps\.ovh\.net/assets/profile-cosmetics/frames/[^/]+\.png$'
    )
  );

commit;
