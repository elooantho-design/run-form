# Portal Translator Pilot

Preparation locale du pilote LibreTranslate pour le Chat general.

Rien dans ce dossier ne doit etre lance sans validation explicite.

## Architecture pilote

- `libretranslate` : moteur CPU isole, image `libretranslate/libretranslate:v1.9.6`.
- `translator-gateway` : passerelle HTTP locale qui valide une signature HMAC avant de proxyfier vers LibreTranslate.
- `translation-worker` : worker Supabase qui reclame un seul job a la fois et remplit le cache.
- Exposition publique directe de LibreTranslate : aucune.
- Exposition prevue : Caddy HTTPS vers `127.0.0.1:8091`, uniquement sur `/portal-translator/translate`.

## Limites initiales

- LibreTranslate : 2 vCPU, 4 GiB RAM, 256 processus.
- Gateway : 0.5 vCPU, 256 MiB RAM.
- Worker : 0.5 vCPU, 256 MiB RAM, concurrence logique 1.
- Langues chargees au pilote : `fr,en`.
- Corps HTTP maximum : 4 KiB.
- Texte maximum : 1 000 caracteres.
- Rate limit gateway : 60 requetes/minute/IP.
- Une seule traduction simultanee cote worker.

## Variables Vercel serveur a prevoir

- `PORTAL_CHAT_TRANSLATION_ENABLED=false`
- `PORTAL_CHAT_TRANSLATION_PROVIDER=libretranslate`
- `PORTAL_CHAT_TRANSLATION_MODEL=argos-fr-en`
- `PORTAL_CHAT_TRANSLATOR_URL=https://<vps-host>/portal-translator/translate`
- `PORTAL_CHAT_TRANSLATOR_SECRET=<meme valeur que PORTAL_TRANSLATOR_SECRET cote VPS>`
- `PORTAL_CHAT_TRANSLATION_TIMEOUT_MS=5000`
- `PORTAL_CHAT_TRANSLATION_DAILY_CHAR_LIMIT=50000`

Ne jamais prefixer ces variables par `VITE_`.

## Commandes de validation sans lancement

Depuis ce dossier, sur le VPS uniquement :

```bash
docker compose config
```

Cette commande valide la syntaxe mais ne demarre pas les conteneurs.

## Commandes de deploiement pilote, a ne pas executer maintenant

```bash
cp .env.example .env
# renseigner PORTAL_TRANSLATOR_SECRET dans .env
docker compose pull libretranslate
docker compose build translator-gateway translation-worker
docker compose up -d
```

## Rollback pilote

```bash
docker compose down
```

Ne pas supprimer le volume `libretranslate-models` sauf si l'on veut retirer les modeles telecharges.
