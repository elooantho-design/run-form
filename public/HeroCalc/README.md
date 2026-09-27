# HeroCalc / Hero Box assets

Ce dossier documente le pipeline obligatoire pour les images utilisees par la Hero Box du Portal.

## A. Structure des fichiers

Les PNG sources restent les originaux de reference :

```text
public/hero-calques/HeroName.png
```

Les vignettes optimisees pour la Hero Box sont generees ici :

```text
public/HeroCalc/thumbs/HeroName.webp
```

Sur le VPS public, les vignettes doivent etre publiees ici :

```text
/assets/calques/hero-calques/thumbs/HeroName.webp
```

URL publique attendue :

```text
https://vps-aad12be0.vps.ovh.net/assets/calques/hero-calques/thumbs/HeroName.webp
```

## B. Format source

- Format source recommande : PNG.
- La transparence alpha doit etre reelle.
- Ne jamais ajouter de fond opaque.
- Ne jamais supprimer ni remplacer les PNG originaux sans raison explicite.
- Le nom du fichier doit rester coherent avec le `portal_name` du champion.

## C. Generation thumbnail

Commande pour regenerer toutes les vignettes des champions actifs :

```bash
node scripts/generate-hero-thumbnails.mjs
```

Commande pour regenerer une seule vignette :

```bash
node scripts/generate-hero-thumbnails.mjs Gonkba.png
```

Parametres actuels :

- largeur : 320 px ;
- hauteur : ratio original conserve ;
- format : WebP ;
- qualite : 82 ;
- alpha conserve.

## D. Ajout d'un nouveau heros

Checklist obligatoire :

1. Ajouter le champion dans Supabase.
2. Ajouter le PNG original dans `public/hero-calques`.
3. Generer la thumbnail WebP avec `node scripts/generate-hero-thumbnails.mjs HeroName.png`.
4. Verifier que le nom du fichier source et celui de la thumbnail correspondent.
5. Verifier localement que `public/HeroCalc/thumbs/HeroName.webp` existe.
6. Uploader le PNG original sur le VPS si necessaire.
7. Uploader la thumbnail sur le VPS dans `/assets/calques/hero-calques/thumbs/`.
8. Verifier que l'URL publique repond en HTTP 200.
9. Verifier la Hero Box dans le Portal.
10. Verifier la Hero Box dans Discord Activity.

Upload manuel d'une thumbnail :

```powershell
$Key = "$env:USERPROFILE\.ssh\gvg_ovh_ed25519"
$File = "HeroName.webp"

scp -i $Key "public\HeroCalc\thumbs\$File" ubuntu@152.228.128.157:/tmp/$File
ssh -i $Key ubuntu@152.228.128.157 'sudo mkdir -p /opt/gvg-paladin/storage/assets/calques/hero-calques/thumbs && sudo install -m 0644 -o ubuntu -g ubuntu /tmp/HeroName.webp /opt/gvg-paladin/storage/assets/calques/hero-calques/thumbs/HeroName.webp && rm -f /tmp/HeroName.webp'
```

## E. Verification poids

Limites recommandees pour une thumbnail Hero Box :

- cible : moins de 100 KiB ;
- warning : plus de 150 KiB ;
- refus recommande : plus de 250 KiB sauf justification visuelle.

Le script affiche le poids avant/apres et le top des fichiers les plus lourds.

## F. Cache

Les thumbnails doivent etre servies par le VPS avec un cache long :

```text
Cache-Control: public, max-age=31536000, immutable
```

Verifier avec :

```bash
curl -I https://vps-aad12be0.vps.ovh.net/assets/calques/hero-calques/thumbs/HeroName.webp
```

## G. Fallback

La Hero Box tente les images dans cet ordre :

```text
thumbnail WebP
-> PNG original
```

Si une thumbnail manque ou retourne une erreur, l'image originale reste affichee.

## H. Ne pas faire

- Ne pas utiliser directement un PNG de 2 a 3 MiB dans la grille Hero Box.
- Ne pas supprimer l'original.
- Ne pas renommer arbitrairement les fichiers.
- Ne pas uploader uniquement le PNG sans generer la thumbnail.
- Ne pas casser la transparence alpha.
- Ne pas placer ces thumbnails dans les dossiers GvG, PVE ou templates de detection.
