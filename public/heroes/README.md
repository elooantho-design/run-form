# Ajout de templates heros au VPS

Ce dossier contient les visuels utilises par le Portal. Pour que le bot de detection reconnaisse un nouveau heros, il faut aussi ajouter son template recadre dans le dossier `templates_heroes` du bot.

## Dossiers utiles

- Visuels Portal :
  `C:\Users\athon\OneDrive\Bureau\Bot Zizi\run-form\public\heroes`
- Templates bot locaux :
  `C:\Users\athon\OneDrive\Bureau\Bot Zizi\Bot-Paladin\data\templates\templates_heroes`
- Templates bot VPS :
  `/opt/gvg-paladin/reco/Bot-Paladin/data/templates/templates_heroes`
- Chemin vu par le worker Docker :
  `/workspace/Bot-Paladin/data/templates/templates_heroes`

## Regle de nommage

- Image Portal : `<slug>.png`
- Template bot : `<slug>_p1.png`
- Variante supplementaire : `<slug>2_p1.png`, `<slug>3_p1.png`, etc.

Exemples :

- `bayek.png` -> `bayek_p1.png`
- `darkezio.png` -> `darkezio_p1.png`
- `eviefrye.png` -> `eviefrye_p1.png`

## Procedure

1. Ajouter l'image du heros dans `public\heroes`.
2. Creer ou verifier le template recadre correspondant dans :
   `C:\Users\athon\OneDrive\Bureau\Bot Zizi\Bot-Paladin\data\templates\templates_heroes`
3. Comparer avec le VPS avant upload :

```powershell
$Key = "$env:USERPROFILE\.ssh\gvg_ovh_ed25519"
ssh -i $Key ubuntu@152.228.128.157 'sudo ls -1 /opt/gvg-paladin/reco/Bot-Paladin/data/templates/templates_heroes | grep "<slug>"'
```

4. Uploader uniquement les templates manquants :

```powershell
$Key = "$env:USERPROFILE\.ssh\gvg_ovh_ed25519"
$Local = "C:\Users\athon\OneDrive\Bureau\Bot Zizi\Bot-Paladin\data\templates\templates_heroes\<slug>_p1.png"

scp -i $Key -p $Local ubuntu@152.228.128.157:/tmp/<slug>_p1.png
ssh -i $Key ubuntu@152.228.128.157 'sudo install -m 0644 -o ubuntu -g ubuntu /tmp/<slug>_p1.png /opt/gvg-paladin/reco/Bot-Paladin/data/templates/templates_heroes/<slug>_p1.png && rm -f /tmp/<slug>_p1.png'
```

5. Verifier les empreintes local/VPS :

```powershell
Get-FileHash -Algorithm SHA256 "C:\Users\athon\OneDrive\Bureau\Bot Zizi\Bot-Paladin\data\templates\templates_heroes\<slug>_p1.png"

$Key = "$env:USERPROFILE\.ssh\gvg_ovh_ed25519"
ssh -i $Key ubuntu@152.228.128.157 'sudo sha256sum /opt/gvg-paladin/reco/Bot-Paladin/data/templates/templates_heroes/<slug>_p1.png'
```

6. Verifier que le VPS reconnait le fichier comme PNG :

```powershell
$Key = "$env:USERPROFILE\.ssh\gvg_ovh_ed25519"
ssh -i $Key ubuntu@152.228.128.157 'sudo file /opt/gvg-paladin/reco/Bot-Paladin/data/templates/templates_heroes/<slug>_p1.png'
```

7. Verifier que le worker de detection voit et charge le template :

```powershell
$Key = "$env:USERPROFILE\.ssh\gvg_ovh_ed25519"
ssh -i $Key ubuntu@152.228.128.157 'sudo docker exec gvg-paladin-reco-worker python3 -c "from pathlib import Path; import cv2; p=Path(\"/workspace/Bot-Paladin/data/templates/templates_heroes/<slug>_p1.png\"); img=cv2.imread(str(p), cv2.IMREAD_UNCHANGED); print(p.exists(), img is not None, None if img is None else img.shape)"'
```

## Points d'attention

- Ne pas supprimer ni remplacer les anciens templates sans raison.
- Ne pas uploader les images Portal brutes dans le dossier `templates_heroes`.
- Ne pas committer de cle SSH, token, `.env.local` ou fichier temporaire.
- Pas de restart worker par defaut : les nouveaux templates sont simplement ajoutes au dossier lu par le bot.
- Si un template ne ressort pas en detection, verifier d'abord le nom, le crop, les dimensions et la transparence du PNG.
