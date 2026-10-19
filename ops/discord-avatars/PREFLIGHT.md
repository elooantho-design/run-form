# Preflight VPS des avatars Discord

Audit du 19 octobre 2026. Lecture seule sur le VPS et Supabase. Aucun deploiement,
redemarrage, commit, push, migration, MP ou telechargement Discord.

## Verdict

Infrastructure compatible et preparation locale prete pour un deploiement controle,
apres autorisation. Le service n'est PAS encore installe : Pillow, les variables
API et les handlers Caddy devront etre ajoutes pendant ce futur deploiement.
La synchronisation initiale reste une autorisation distincte.

## Etat observe

| Element | Observation |
| --- | --- |
| API | `gvg-paladin-api`, healthy, image inchangee depuis septembre |
| Bot | `paladin-intersaison-bot`, healthy, aucun redemarrage pendant l'audit |
| HTTPS | Caddy 2.11.4 sur 443, certificat accepte par le client HTTPS |
| Disque | ext4, 193 Go, 167 Go disponibles, 14 % occupes |
| CPU | 8 vCPU, charge 0,01 / 0,02 / 0,00 ; API environ 0,18 % sur l'echantillon |
| RAM | 22,91 Gio au total, environ 21,26 Gio disponibles ; API 273 Mio, bot 60 Mio |
| Reseau | 22/80/443 exposes ; bot 3222 et passerelle 8091 sur loopback |
| Permissions | storage/assets 0755 ubuntu:ubuntu ; API uid 0, lecture/ecriture |
| Secrets existants | fichiers `.env` API et bot en 0600, valeurs jamais affichees |
| Services annexes | reconnaissance, passerelle traduction et LibreTranslate actifs |

Le conteneur `portal-chat-translation-worker` est deja arrete (exit 137, depuis
environ six semaines). Il est hors perimetre : aucune tentative de remise en route.

L'API monte `/opt/gvg-paladin/storage` dans `/data/storage` en lecture/ecriture.
Caddy monte le meme repertoire dans `/srv/storage` en lecture seule. Les futures
images seront dans `/opt/gvg-paladin/storage/assets/discord-avatars/` et l'index
prive dans `/opt/gvg-paladin/storage/discord-avatar-cache/index.sqlite3`.
Ces chemins n'existent pas encore. Ils survivront aux recreations des conteneurs
grace aux bind mounts existants. Aucun volume ni conteneur supplementaire.

## Compatibilite et securite

- SQLite 3.46.1 est deja disponible. Transactions courtes, timeout de verrouillage
  de trois secondes, verrou fichier Linux couvrant toute l'iteration et lease
  persistant de 120 secondes. La reprise ne retelecharge pas les fichiers presents.
- Ecriture des WebP et du manifeste par fichier temporaire puis renommage atomique.
  Une publication de manifeste echouee reste marquee a reprendre en SQLite.
- Entrees PNG/JPEG/WebP uniquement, maximum 512 Kio et un megapixel. Sortie WebP
  64 x 64, maximum 32 Kio, pixels recopies sans metadonnees. Ancienne image conservee
  si la conversion ou la recuperation echoue.
- Un fichier par Discord ID, deduplication globale, controles de coherence des
  rattachements et de l'organisation. Aucun identifiant brut ni secret dans l'index
  public. Les ressources restent publiques et leurs cles sont calculables a partir
  d'un Discord ID connu : ce n'est pas un mecanisme d'autorisation privee.
- Administration protegee par le `require_token()` existant. Son endpoint actuel
  `/api/v1/status` retourne bien 401 sans token. Les nouveaux endpoints ne sont
  pas encore installes ; leurs refus anonymes ont ete testes localement.
- La CLI n'utilise que localhost dans le conteneur via SSH. Ne jamais transmettre
  un token d'administration par le port HTTP 80 public. Aucun routage administratif
  HTTPS supplementaire n'est requis pour les avatars.
- Sources reseau fixes en HTTPS, redirections et URLs arbitraires refusees.
  Les erreurs, 404 et 429 ont un report persistant. Aucun appel d'envoi de MP.
- Comptes nouveaux, rattaches ou corriges detectes au scan suivant, sans bloquer
  l'enregistrement. Apres activation seulement : trois lectures paginees toutes
  les cinq minutes, soit 864 GET/jour avec les effectifs actuels, pas par avatar.
  La periode reste configurable ; les incidents/rate limits peuvent retarder un scan.
- La consultation du plan utilise les membres deja charges et un manifeste partage
  par instance Vercel, cache 60 secondes, ETag, aucun appel Discord/per-avatar Vercel
  ou requete Supabase individuelle. Sans consultation, aucune lecture Vercel.

## Corrections preparees pendant le preflight

1. Le handler generique actuel donne aussi aux 404 le cache d'un an. Les handlers
   locaux specifiques servent le manifeste present avec 60 secondes, les WebP
   presents avec un an, et les absences avec `no-store`. Les noms temporaires,
   chemins arbitraires et fichiers non WebP ne sont pas servis par la route avatars.
2. Le Compose actuel n'injecte pas les variables d'avatars. L'override prepare
   `compose.avatar-environment.yml` ajoute seulement les variables du service `api`,
   avec worker desactive par defaut. Ajouter les secrets seulement a `.env` ne suffit pas.
3. Le tag de base `python:3.12-slim` n'est plus present dans le cache Docker.
   Le paquet prepare derive desormais de l'image API exacte sauvegardee sous un tag
   unique. Il ne rejoue pas apt et conserve Python/systeme et dependances existants.

Image API de reference :
`sha256:2904bb5fc7bbf0101383f37681e271057ea01a83025eaed18f3e5b857f7f6a17`.
Empreintes des sources actuelles :

```text
main.py      0104c286b113219fdcbff2e91e9499cc6ecc4f4cbc11829fb0c28ed6c49e27b2
requirements bc9054374e547f29753004371c79d95880a3079db86986284a1619169873b752
Dockerfile   195ac81fc2d29e8fddc3dabd7a79163ebc8bdd19b7c4da0e8c8b8c99562b4bc0
Caddyfile    9cf2290b86fe3e049fb8d3596821199cec08c7caadd15c87166c59267b584ccf
```

Toute difference avant installation impose de refaire la comparaison, pas
d'ecraser une configuration concurrente.

## HTTPS et cache

HEAD reel sur une image WebP existante, puis sur la meme URL avec `?v=...` :
200, `Content-Type: image/webp`, `Cache-Control: public, max-age=31536000, immutable`,
ETag et Last-Modified presents. Gzip/zstd sont deja configures ; aucun recompressage
du WebP n'est necessaire. Le manifeste JSON peut utiliser la compression existante.

Les chemins futurs d'avatars sont actuellement en 404, ce qui est attendu avant
installation. Le chemin prive direct et trois variantes de parcours de repertoire
ont renvoye 404 ; aucune route ne sert la racine complete du stockage.

La configuration future a ete fournie par stdin a `caddy adapt` dans le conteneur
existant, sans fichier cree et sans rechargement. Le resultat confirme l'ordre :
manifest exact, WebP avatars, assets generiques. Les branches no-store sont presentes.
Cela valide le parsing/routage, PAS encore les headers des futurs fichiers en production.

Les tests Chrome locaux confirment cache a la revisite/au refresh, nouvelle version,
chargement lazy et affichage pendant un transfert lent. Le mapping Discord Activity
existant est conserve, sans modification CSP/CORS/auth.

## Simulation initiale

Trois GET Supabase seulement, avec garde refusant toute methode autre que GET/HEAD.
Les donnees de roster ont ensuite alimente le vrai code de cache dans un dossier
temporaire local, avec source Discord simulee et tous les acces HTTP Python interdits.

| Mesure | Resultat |
| --- | --- |
| Organisations actives / guildes actives | 3 / 9 |
| Comptes lus, tous statuts | 274 |
| Comptes eligibles selon les filtres du worker | 204 |
| Discord ID distincts | 196 |
| Groupes ayant plusieurs comptes | 7 |
| Comptes secondaires reutilisant un ID partage | 8 |
| Avatars deja presents sur le VPS | 0 |
| Avatars a tenter lors de la premiere sync autorisee | 196 |
| Simulation avant / apres reprise | 98 / 196 presents |
| Telechargements simules en double / echecs simules | 0 / 0 |
| Appels reels Discord | 0 |

Ces nombres couvrent les guildes actives du dashboard, pas uniquement Paladin.
La disponibilite reelle des 196 profils/images n'a volontairement pas ete testee.
Une suppression de compte Discord, une erreur ou une limitation peut reduire le
nombre effectivement disponible ; le fallback et la reprise sont prevus.

Dimensionnement, pas mesure d'avatars reels : environ 784 Kio (0,77 Mio) d'images
optimisees a 4 Kio/avatar et 19 Kio de manifeste, plus SQLite. Plafond images sur
disque : 6,13 Mio a 32 Kio/avatar. Une premiere visite de tous les avatars transfere
environ 0,77 Mio sous cette hypothese ; revisite en cache frais : zero corps image.
Le trafic initial ENTRANT Discord ne se deduit pas du poids WebP final : il reste
inconnu sans telechargement, borne a 98 Mio de fichiers source, hors profils JSON.
La sync fait au plus 196 GET profils et 196 GET images si tout manque et reussit.

Plancher d'espacement : 6 min 30 s, hors latence/encodage. Estimation operationnelle
indicative : 10 a 20 minutes avec 3 a 5 secondes par identifiant. Ce n'est pas un
temps mesure ; erreurs et 429 peuvent l'allonger fortement.

## Procedure future, uniquement apres autorisation

1. Relever de nouveau campagnes/reponses/destinataires/objectifs/placements/roles
   et empreintes. Verifier le sondage 2 ouvert, les 41 reponses du sondage 1 et
   l'absence de captures/uploads GvG ou YouTube pendant la recreation de l'API.
2. Sauvegarder dans un repertoire prive 0700 : sources API, Dockerfile, requirements,
   Compose, environnement 0600, Caddyfile et metadonnees d'images. Tagger l'image API
   exacte avec le nom `requiredBaseImageReference` du paquet et verifier que le tag
   pointe bien sur `requiredBaseImageId`. Conserver une copie exportee de l'image
   si une restauration apres suppression du cache Docker doit etre possible.
   Les sauvegardes existantes sont ponctuelles ; aucune sauvegarde recurrente de
   ce cache n'est observee dans cron/timers. Les snapshots OVH externes ne sont pas verifies.
3. Fournir a l'API uniquement `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `DISCORD_AVATAR_BOT_TOKEN` et les quatre options `DISCORD_AVATAR_*`. Aucun secret
   dans Vercel, le manifeste, les commandes publiques ou le depot. Conserver le `.env` 0600.
4. Installer le paquet genere apres controle des empreintes et l'override Compose.
   Construire seulement `api`, avec l'image actuelle taggee comme base. Inspecter
   les versions et la capacite WebP dans l'image construite avant la bascule.
   Ne pas executer de `docker compose down`, de `--build` global ou de prune.
5. Recreer uniquement `api` avec `--no-deps --no-build`. Le conteneur API unique
   implique une courte coupure de ses endpoints : zero interruption de cette API
   ne peut pas etre garanti sans une strategie blue/green supplementaire. Le bot
   et les services statiques restent actifs. Arreter et restaurer si la sante echoue.
6. Valider Caddy puis le recharger gracieusement, sans recreer son conteneur.
   Les nouveaux handlers doivent preceder les assets generiques. Verifier les
   anciennes images, le manifeste absent en 404/no-store, puis les images produites
   apres autorisation de sync. Rien ne doit exposer le SQLite.
7. Verifier `armed=false`. Worker 0 : aucun travail possible. Une activation
   configuree a 1 avec un index neuf reste SANS aucun GET tant qu'une commande
   `sync-missing --confirm` n'a pas ete autorisee et executee. Ne pas traiter une
   base deja armee comme neuve ; la mettre en pause avant une intervention future.
8. Demander separement l'autorisation de synchronisation initiale ; suivre le statut,
   les recuperations, echecs et delais. Puis valider HTTPS, cache et une reprise.
9. Seulement apres manifeste valide : autorisation de commit/push cible, Vercel READY,
   test dashboard/Discord Activity. Les fichiers PB et Rorkesh restent exclus.
10. Refaire les empreintes de protection en distinguant les nouvelles reponses
    naturelles ; aucun sondage ni compte n'est modifie par le deploiement.

Exemples de controles FUTURS, non executes pour les endpoints encore absents :

```bash
docker exec gvg-paladin-api python -c 'import PIL; from PIL import features; print(PIL.__version__, features.check("webp"))'
docker exec gvg-paladin-api python -m app.discord_avatar_admin status
docker exec gvg-paladin-api curl -fsS http://127.0.0.1:8000/health
docker exec gvg-paladin-api curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/api/v1/discord-avatars/status
curl -I https://vps-aad12be0.vps.ovh.net/assets/discord-avatars/manifest.json
curl -I https://vps-aad12be0.vps.ovh.net/discord-avatar-cache/index.sqlite3
```

Attendus : sante 200, statut anonyme 401, chemin prive 404. Avant sync, manifeste
404/no-store ; apres sync, 200/application-json/cache 60 secondes. Une URL WebP
valide doit donner 200/image-webp/cache un an, une URL manquante 404/no-store.
Tester egalement ETag/304 et l'ancienne navigation avant de basculer Vercel.

Commandes de bascule FUTURES, pas une autorisation de les executer. L'override
local sera installe dans `/opt/gvg-paladin/compose.discord-avatars.yml`, les fichiers
du paquet dans `/opt/gvg-paladin/api/`, apres sauvegarde et verification des hashes.

```bash
cd /opt/gvg-paladin
BASE_ID=sha256:2904bb5fc7bbf0101383f37681e271057ea01a83025eaed18f3e5b857f7f6a17
BASE_TAG=gvg-paladin-api:pre-discord-avatars-2904bb5fc7bbf0101383f37681e271057ea01a83025eaed18f3e5b857f7f6a17
test "$(docker inspect --format='{{.Image}}' gvg-paladin-api)" = "$BASE_ID" || exit 1
docker image tag "$BASE_ID" "$BASE_TAG"
docker image save "$BASE_TAG" -o "$PRIVATE_BACKUP_DIR/api-image.tar"
docker compose --env-file .env -f docker-compose.yml -f compose.discord-avatars.yml build --pull=false api
# Inspecter/tester l'image construite avant la recreation ciblee.
docker compose --env-file .env -f docker-compose.yml -f compose.discord-avatars.yml up -d --no-deps --no-build api
docker exec gvg-paladin-api curl -fsS http://127.0.0.1:8000/health
docker exec gvg-paladin-api python -m app.discord_avatar_admin status
docker exec gvg-paladin-assets-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec gvg-paladin-assets-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

`PRIVATE_BACKUP_DIR` doit etre un chemin absolu existant, prive, cree dans l'etape
de sauvegarde autorisee. Le Caddyfile vise par validate/reload doit etre la version
preparee et sauvegardee selon l'etape 6. Ne pas afficher un `compose config` complet
ou un inspect d'environnement contenant les secrets. Pour les commandes de
recreation futures, conserver une execution deploiement exclusive afin de ne pas
confondre l'image candidate avec une construction concurrente.

## Retour arriere et incidents

- Pause immediate du travail reseau avec la CLI `pause --confirm` ; les images deja
  presentes restent utilisables. Cette action n'arrete pas le bot ni les sondages.
- Pour desactiver rapidement le nouveau chargement : rollback Vercel sur la version
  pre-avatars, sans ecriture Supabase. Cela restaure temporairement l'ancien flux
  d'avatars Discord, pas une modification des reponses ou de l'effectif.
- Restaurer seulement l'image/tag API, les sources/Compose/environnement sauvegardes
  si l'API rencontre un probleme. Refaire la recreation ciblee et le healthcheck.
- Restaurer le Caddyfile sauvegarde et le recharger si son routage est en cause.
  Garder les fichiers cache : aucune migration inverse ni suppression de donnees.
- Pour sauvegarder un SQLite deja utilise, employer l'API SQLite `backup()` apres
  mise en pause, pas une copie brute au milieu d'une transaction. Le cache reste
  reconstructible en cas de perte ; jamais de donnees de sondage dans cet index.
- En panne VPS, un reader Vercel chaud conserve les URLs connues ; un reader froid
  retourne des icones neutres apres un timeout borne de 1,5 s, puis attend 15 s
  avant nouvel essai. Aucun fallback reseau vers Discord. Le plan reste accessible.

## Limites de ce preflight

Pillow 12.3.0 dispose bien d'une wheel publique CPython 3.12/Linux x86-64 selon
les metadonnees PyPI consultees, mais aucun pip install ni build image n'a ete fait
sur le VPS. La sante de l'image reconstruite, les vrais profils Discord et les
headers des nouveaux fichiers resteront a verifier pendant les phases autorisees.
Le certificat/HTTPS et les headers des ressources deja presentes ont ete testes.

Le type d'authentification, les mappings Discord, CORS/CSP et les cookies restent
inchanges. Aucun SQL requis. Le service de traduction deja arrete n'est pas corrige.

## Resultats de cloture de l'audit

Les empreintes avant/apres sont identiques pour les onze ensembles controles :
campagnes et destinataires des sondages, toutes les versions de reponses,
campagnes/destinataires DM, versions et items d'objectifs, effectifs, placements,
roles previsionnels et saisons. Sondage 2 toujours ouvert : 210 destinataires,
91 reponses courantes. Sondage 1 : 41 reponses conservees.

Validation locale : 13 tests Python, tests du reader forecast, paquet/URLs/cache
Chrome (dont chargement lent), ESLint cible, syntaxes et build OK. Le build conserve
l'avertissement de bundle volumineux deja present, non bloquant.
Le nouveau fragment Caddy et l'override Compose ont ete acceptes par les parseurs
reels du VPS via stdin, avec des valeurs fictives pour les nouvelles variables.
Aucun fichier ou service de production n'a ete remplace ou recharge.
