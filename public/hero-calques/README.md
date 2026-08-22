# Upload des calques héros vers le VPS

Ce dossier contient les PNG source des calques héros utilisés par le moteur GvG.

Workflow habituel :

1. placer le nouveau PNG dans `public/hero-calques/` ;
2. vérifier son nom exact ;
3. lancer le script d'upload ;
4. vérifier l'URL publique côté VPS.

Exemples de fichiers :

```text
public/hero-calques/Corven.png
public/hero-calques/Eivor.png
public/hero-calques/Kassandra.png
```

## Endpoint d'upload

```text
POST http://152.228.128.157/api/v1/calques/hero-calques/base64
```

Le serveur peut aussi être configuré via :

```text
GVG_SERVER_URL
GVG_VPS_URL
```

## Authentification

L'upload utilise le header :

```text
X-GVG-Token
```

Le token est lu depuis l'environnement ou depuis `.env.local` :

```text
GVG_API_TOKEN
```

Ne jamais hardcoder le token et ne jamais l'afficher dans les logs.

## Payload

Le script envoie un JSON de cette forme :

```json
{
  "kind": "hero",
  "folder": "hero-calques",
  "fileName": "NomDuHero.png",
  "file_name": "NomDuHero.png",
  "content_base64": "..."
}
```

## Verification publique

Après upload, le fichier doit être accessible via :

```text
https://vps-aad12be0.vps.ovh.net/assets/calques/hero-calques/
```

Exemple :

```text
https://vps-aad12be0.vps.ovh.net/assets/calques/hero-calques/Corven.png
```

## Limite de taille

Comportement observé :

- `Corven.png` : upload direct validé.
- `Kassandra.png` : upload direct validé.
- `Eivor.png` : original autour de 2,1 Mo refusé avec `hero-calques file too large`.

Si l'upload est refusé pour taille excessive :

- conserver le format PNG ;
- conserver le nom du fichier envoyé ;
- ne pas écraser l'original local ;
- réduire progressivement la dimension maximale ;
- `900 px` sur le plus grand côté a été validé avec succès pour Eivor.

`900 px` est une valeur de travail validée, pas une limite serveur officiellement documentée.

## Script

Syntaxe :

```powershell
.\scripts\upload-hero-calques.ps1 Eivor.png Kassandra.png
```

Mode dry-run, sans upload :

```powershell
.\scripts\upload-hero-calques.ps1 -DryRun Eivor.png Kassandra.png
```

Le script :

- lit les fichiers depuis `public/hero-calques/` ;
- vérifie leur existence ;
- lit `GVG_API_TOKEN` depuis l'environnement ou `.env.local` ;
- n'affiche jamais le token ;
- envoie uniquement les fichiers explicitement demandés ;
- tente d'abord l'upload original ;
- si le VPS refuse pour taille excessive, crée une copie temporaire compressée/redimensionnée ;
- conserve le nom final envoyé au VPS ;
- vérifie ensuite l'URL publique ;
- retourne une erreur si un upload échoue.

Le script ne supprime jamais de calque existant sur le VPS.
