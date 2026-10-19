# Cache persistant des avatars Discord

Preparation locale, non deployee. Aucun premier telechargement ne demarre au
deploiement : une commande d'administration explicite est indispensable.
Les sondages, MP, roles, placements et effectifs ne sont jamais modifies par ce cache.

## Infrastructure retenue

L'audit du VPS a confirme que `gvg-paladin-api` monte deja
`/opt/gvg-paladin/storage` dans `/data/storage`, en lecture/ecriture. Caddy monte ce
meme stockage en lecture seule et sert deja `/assets/*` en HTTPS avec un cache
long. Le bot `paladin-intersaison-bot` n'a aucun volume de stockage et reste hors
de cette integration : aucune modification de son code ni redemarrage requis.

Le module Python s'installe dans l'API FastAPI existante. Une seule tache de fond
traite les avatars, separement des requetes et des traitements GvG. Pillow 12.3.0
est l'unique dependance ajoutee dans l'image API, pas dans le projet JavaScript.
Un verrou fichier Linux protege toute l'iteration, y compris un scan long ; le
lease SQLite conserve l'election du processus entre iterations. Plusieurs workers
API ne traitent donc pas la meme file. Une reprise apres arret brutal peut attendre
jusqu'a 120 secondes.

Le cache prive utilise SQLite, dans
`/data/storage/discord-avatar-cache/index.sqlite3`, hors des chemins publics.
Il conserve l'identifiant Discord, le hash connu, les dates, echecs et prochaines
tentatives. Le dossier est en mode 0700, le fichier SQLite en mode 0600.

Les images sont stockees sous
`/data/storage/assets/discord-avatars/<sha256-du-discord-id>.webp`.
Il y a un seul fichier courant par identifiant Discord, pas par compte de jeu.
Les comptes secondaires reutilisent exactement la meme URL. Les images originales
ne sont pas sauvegardees. L'image et le manifeste sont remplaces par renommage
atomique ; le journal SQLite permet de reprendre la publication apres incident.

Le manifeste public `manifest.json` contient uniquement :

```json
{"version":1,"avatars":{"<sha256-du-discord-id>":"<version-contenu-16-hex>"}}
```

Pas de Discord ID brut, pseudo, guilde, etat de synchronisation ou secret dans ce
manifeste. Les fichiers restent des ressources publiques, comme les autres assets
du dashboard ; connaitre un Discord ID permet de calculer sa cle d'avatar.

## Lecture depuis le dashboard

Le backend lit le manifeste une seule fois pour tout le plan. Son cache partage
entre requetes dure 60 secondes et utilise `ETag`/`If-None-Match`. Une panne
conserve les URLs deja connues et provoque un delai de 15 secondes avant nouvel
essai. Un index absent donne des icones neutres, jamais un appel a Discord.

Les URLs sont ajoutees aux joueurs dans la reponse du workspace existant. Il n'y
a plus de requete Vercel par avatar, ni de requete Supabase supplementaire par
joueur. L'ancien endpoint de lecture est conserve pour les onglets deja ouverts,
mais ne lit lui aussi que le manifeste ; il ne lance aucune synchronisation.

L'URL d'une image est versionnee par son contenu :

```text
https://vps-aad12be0.vps.ovh.net/assets/discord-avatars/<cle>.webp?v=<version>
```

Le fichier courant est unique ; le parametre `v` change uniquement si les pixels
optimises changent. Un ancien parametre peut servir l'image courante, ce n'est pas
un acces a un historique d'avatars. Le navigateur peut conserver les anciennes
entrees de cache sans multiplier les fichiers sur le VPS.

Les images presentes conservent la politique existante
`Cache-Control: public, max-age=31536000, immutable`. Le manifeste present doit avoir
`public, max-age=60, must-revalidate` : inserer `Caddyfile.fragment` AVANT le handler
general des assets. Les deux handlers specifiques renvoient les fichiers absents
en 404 avec `Cache-Control: no-store`, pour eviter une erreur mise en cache un an.
Seuls les noms WebP generes de 64 caracteres hexadecimaux sont servis ; aucun
fichier temporaire, SQLite ou repertoire n'est expose dans cette route.

Le composant conserve `loading="lazy"`, une taille stable de 28 px et un fichier
de 64 px pour les ecrans a forte densite. Le resolver VPS central assure le mapping
Discord Activity existant ; aucune modification du mapping ou de la CSP.

## Synchronisation et nouveaux comptes

Une fois la premiere synchronisation explicitement autorisee, le worker scanne
les effectifs toutes les 300 secondes. Il fait trois lectures Supabase paginees
(organisations, guildes, membres), independamment du nombre de consultations.
Il ne lit ni campagnes, ni reponses, ni placements. Aucune ecriture Supabase.

Les IDs sont dedupliques globalement. Les membres actifs de guildes/organisations
actives sont retenus ; les codes de guilde ambigus et les rattachements secondaires
hors organisation, cycliques ou incoherents sont exclus. Le Discord ID du
principal peut etre herite si celui du secondaire est vide.

La creation, le rattachement et la correction d'un compte sont detectes au scan
suivant, au plus tard cinq minutes apres la modification. Aucun hook n'est ajoute
a `portal-access.js` et aucune indisponibilite Discord ne bloque la sauvegarde
d'un compte. Avant la premiere synchronisation autorisee, aucune detection ni
recuperation automatique ne demarre.

Le rythme est d'une tache a la fois, avec deux secondes minimum entre profils.
Les nouveaux IDs et images manquantes sont prioritaires. Apres un succes, le
profil est recontrole apres sept jours configurables. Si le hash Discord est
identique et le fichier present, aucun telechargement d'image n'a lieu.

Les erreurs utilisent un delai croissant, au plus cinq tentatives rapprochees
avant une attente d'au moins sept jours. Un 404 attend egalement sept jours.
Un 429 respecte `retry_after` et suspend toute la file. L'ancien avatar et son
URL sont conserves si une nouvelle recuperation echoue. Le worker ne contourne
pas les [limitations Discord](https://docs.discord.com/developers/topics/rate-limits).

Les commandes de reprise ne remettent pas les avatars presents en telechargement.
`refresh-due` demande uniquement un nouveau scan des echeances, pas un forcage
massif. Les IDs retires des effectifs ne sont plus actualises ; leurs fichiers
existants restent disponibles pour les anciennes vues.

## Securite des sources

Les seules requetes Discord sont des GET sur le profil officiel, puis le CDN.
Les URLs ne sont jamais fournies par l'utilisateur. HTTPS, hostname et port sont
verifies ; les redirections sont refusees. Maximum 512 KiB par image et 1 megapixel
decode. PNG/JPEG/WebP uniquement, premiere image statique, sortie WebP 64 x 64,
qualite 78, maximum 32 KiB. Les pixels sont copies dans une image neuve pour
eliminer les metadonnees ; voir les
[limites de decodage Pillow](https://pillow.readthedocs.io/en/stable/reference/Image.html).

Les appels API/CDN Discord identifient explicitement le client avec le User-Agent
`DiscordBot` conforme a la [reference Discord](https://github.com/discord/discord-api-docs/blob/main/developers/reference.mdx).
Le token reste reserve a l'API Discord et n'est jamais transmis au CDN.

Les operations d'administration reutilisent `require_token()` et `GVG_API_TOKEN`.
Elles ne sont pas exposees dans le frontend. La CLI requiert l'acces administrateur
SSH/Docker, utilise uniquement l'API locale et n'affiche pas le token.
Les endpoints refusent les champs supplementaires, IDs et URLs arbitraires.
Les logs donnent uniquement des compteurs et codes techniques, jamais les secrets,
les reponses des joueurs ou le contenu des profils Discord.

Une erreur de configuration ou de stockage du cache n'empeche pas le demarrage
de l'API principale. Une image absente ne bloque jamais le plan ni les interactions
du bot. Aucun nouvel acces Supabase n'est accorde aux utilisateurs.

## Configuration VPS a preparer apres autorisation

Utiliser `environment.example` comme liste de variables, sans ecraser l'environnement
existant. L'API a besoin de `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` et
`DISCORD_AVATAR_BOT_TOKEN`, qui ne lui sont pas actuellement fournis. Reutiliser les
secrets deja valides du bot, sans les imprimer. Garder `GVG_API_TOKEN` et les mounts
existants. Aucun nouveau volume Docker n'est necessaire.

Le Compose actuel transmet une liste explicite de variables a `api` : les ajouter
seulement dans `.env` ne suffit pas. `compose.avatar-environment.yml` est un override
local prepare pour ce service uniquement. Il exige les trois valeurs privees et
conserve le worker desactive par defaut. Il ne change ni ports, ni volumes, ni bot.
Voir `PREFLIGHT.md` pour l'ordre des operations et les controles avant activation.

Valeurs par defaut : worker desactive, refresh 604800 secondes, scan 300 secondes,
espacement 2 secondes. Une activation future avec `DISCORD_AVATAR_WORKER_ENABLED=1`
ne demarre pas la premiere synchronisation tant que l'index n'est pas arme par
une commande explicite.

## Preparation locale du paquet

Copier en lecture seule `api/app/main.py`, `api/requirements.txt` et `api/Dockerfile` depuis le VPS
dans un dossier local hors depot. Ajouter `runtime-constraints.txt` : la liste
`nom==version` des distributions Python du conteneur API actuellement execute,
sans URLs ni secrets. Ce fichier fige aussi les dependances transitives existantes.
Ajouter `runtime-api-image-id.txt` : uniquement l'ID `sha256:...` de l'image du
conteneur API execute. Le paquet derive de cette image, sauvegardee sous un tag
unique avant le rebuild, plutot que de tirer une nouvelle base `python:3.12-slim`.
Puis :

```powershell
node scripts/prepare-discord-avatar-vps.mjs <copie-locale-api> <nouveau-dossier-paquet>
```

Le script ne contacte aucun service. Il conserve tout le `main.py`, ajoute seulement
l'installation du module a la fin, ajoute Pillow aux requirements et copie les deux
nouveaux modules. `avatar-runtime-constraints.txt` est reference par les requirements
pour ne pas mettre a jour les autres dependances pendant le rebuild. Le Dockerfile
prepare herite de l'image API actuelle et copie les contraintes avant pip. Python,
les bibliotheques systeme, la commande de lancement et les fichiers API non modifies
restent herites de l'image en production ; aucune commande apt n'est rejouee.
Il refuse d'ecraser un dossier existant ou une integration deja
presente. Les empreintes des sources sont ecrites dans `source-fingerprints.json`.
Une difference avec le VPS au moment du deploiement impose une nouvelle preparation,
pas un ecrasement des changements concurrents.

## Deploiement futur sans interruption des sondages

1. Autorisation explicite et snapshots en lecture seule des campagnes, reponses,
   destinataires, objectifs, roles previsionnels et placements. Aucune commande MP.
2. Sauvegarder l'image API, `app/main.py`, requirements, environnement prive et
   Caddyfile sur le VPS. Ne pas sauvegarder les secrets dans le depot ou le paquet.
3. Verifier les empreintes source, l'image de base et les versions Python du paquet. Installer uniquement les fichiers
   prevus dans l'API existante. Ajouter les variables sans toucher au bot.
4. Apres autorisation, rebuild/recreation controles du seul service API, avec
   verification de `/health` et des anciennes routes. Le bot ne redemarre pas et
   continue a accepter les reponses Discord pendant cette intervention. Utiliser
   le Dockerfile prepare, qui derive de la sauvegarde exacte de l'image API et
   copie les contraintes avant pip.
5. Valider et recharger la configuration Caddy avec le fragment du manifeste.
   Verifier le cache court de l'index et le cache long d'une image test, sans sync.
6. Avant toute premiere recuperation, activer explicitement le worker et verifier
   `armed=false`. Demander l'autorisation DISTINCTE de synchronisation initiale.
7. Apres cette autorisation uniquement, lancer la commande ci-dessous et suivre
   les compteurs. Ne pas basculer le frontend tant que le manifeste n'est pas pret.
8. Apres validation du cache, autorisation commit/push cible du frontend, Vercel
   READY, controles navigateur/Discord Activity, puis comparaison des empreintes.
   Les fichiers PB et Rorkesh restent hors commit.

Commandes d'administration futures, jamais lancees par le deploiement :

```bash
docker exec gvg-paladin-api python -m app.discord_avatar_admin status
docker exec gvg-paladin-api python -m app.discord_avatar_admin sync-missing --confirm
docker exec gvg-paladin-api python -m app.discord_avatar_admin pause --confirm
docker exec gvg-paladin-api python -m app.discord_avatar_admin resume --confirm
docker exec gvg-paladin-api python -m app.discord_avatar_admin refresh-due --confirm
```

`total_ids`, `present`, `recovered` (cumul), `queued`, `unavailable`, `failures`,
`last_scan`, `last_error` et `retry_at` permettent de suivre et reprendre la file.
L'index et les fichiers survivent au remplacement du conteneur grace au volume
de stockage deja existant.

## Test ponctuel limite a trois identifiants

La commande privee `python -m app.discord_avatar_limited_test --confirm` lit sur
stdin uniquement `{"discord_ids":["<id1>","<id2>","<id3>"]}`. Elle refuse plus de
trois IDs, les doublons, les IDs hors effectif actif, un worker automatique actif
ou un index principal deja arme. Acces SSH/Docker administrateur uniquement.

Elle utilise la meme recuperation/optimisation, dans une file temporaire bornee
aux IDs autorises, puis recopie leurs seules metadonnees dans l'index principal.
Elle ne lance aucun thread, ne publie pas le manifeste temporaire, n'arme jamais
l'index principal et ne cree aucune planification. Un rate limit long interrompt
le test sans retry automatique. Les compteurs distinguent Discord API, CDN et
lectures Supabase ; aucune valeur de profil ou de token n'est imprimee.

Apres le test, `enabled=false` et `armed=false` doivent toujours etre verifies.
Les avatars deja frais sont reutilises lors d'une nouvelle execution explicite.
Cette commande n'autorise pas la synchronisation generale.

## Retour arriere

Mettre la file d'avatars en pause, restaurer le precedent frontend si necessaire,
puis desactiver le worker et restaurer l'image/source API sauvegardee apres
autorisation. Conserver SQLite et les WebP : aucune suppression ou migration inverse
n'est requise. Le fragment de cache du manifeste peut rester en place. Aucun
redemarrage du bot, transfert ou changement des donnees de sondage.

## Couts estimes

Hypothese de dimensionnement : 4 KiB par WebP 64 px, non une mesure des profils
reels. Le poids exact sera releve apres une synchronisation autorisee.

| IDs Discord distincts | Images sur disque | Premiere visite de tous les avatars | Revisite avec cache frais |
| --- | --- | --- | --- |
| 250 | 0,98 MiB | au plus 0,98 MiB | 0 octet image |
| 500 | 1,95 MiB | au plus 1,95 MiB | 0 octet image |
| 1 000 | 3,91 MiB | au plus 3,91 MiB | 0 octet image |

Ajouter environ 100 octets par entree de manifeste et quelques pages SQLite par
ensemble de comptes. Ces couts sont fondes sur les IDs uniques, pas sur les comptes
secondaires. Le chargement differe reduit encore les transferts des listes non vues.

Avant : lots Vercel par joueurs visibles, GET Discord par identifiant lors des
caches froids, PNG CDN et cache serveur uniquement en memoire. Apres : zero GET
Discord a l'affichage, une lecture conditionnelle du manifeste par instance Vercel
au maximum par minute, zero appel Vercel individuel, WebP servis directement par
le VPS. Le controle hebdomadaire fait un GET profil par ID ; seuls les avatars
modifies sont retelecharges.

## Tests locaux

Toutes les sources Discord/Supabase sont simulees ; aucun MP n'est possible.
Pillow 12.3.0 et FastAPI 0.124.0 correspondent aux versions testees.

```powershell
python scripts/test-discord-avatar-cache.py -v
node scripts/test-intersaison-forecast.mjs
node scripts/test-discord-avatar-assets.mjs
```

Le test navigateur optionnel utilise `PLAYWRIGHT_MODULE_PATH`, pointant vers le
package Playwright du runtime local. Il ne contacte qu'un serveur HTTP temporaire
local : cache a la revisite, absence de nouveau corps image au refresh, nouvelle
version, chargement differe hors ecran et rendu pendant un transfert lent. Les autres suites Inter-saison et le build
restent obligatoires avant livraison. Le test Python utilise des dossiers temporaires
et refuse toutes les connexions reseau reelles.

## Fichiers de cette preparation

Modifies :

- `api/_intersaison-forecast-avatars.js` : lecteur partage du manifeste VPS.
- `api/_intersaison-survey-choices.js` : URLs jointes a la projection deja chargee.
- `src/lib/vpsAssets.js` : construction des URLs publiques versionnees.
- `src/lib/intersaisonForecast.js` : validation/resolution des URLs VPS.
- `src/lib/intersaisonSurveyChoices.js` : champ visuel `avatarUrl`.
- `src/components/IntersaisonForecastPlayer.jsx` : image lazy sans demande API.
- `src/components/IntersaisonSurveyTwoWorkspace.jsx` : suppression de la file navigateur.
- `scripts/test-intersaison-forecast.mjs` : regressions metier et lecteur de cache.

Ajoutes :

- `ops/discord-avatars/discord_avatar_cache.py` : file, stockage, optimisation, endpoints prives.
- `ops/discord-avatars/discord_avatar_admin.py` : commandes administrateur explicites.
- `ops/discord-avatars/discord_avatar_limited_test.py` : test ponctuel strictement borne, sans file generale.
- `ops/discord-avatars/requirements.txt` : encodeur uniquement.
- `ops/discord-avatars/environment.example` : variables sans secrets.
- `ops/discord-avatars/Caddyfile.fragment` : manifeste court, WebP longs, 404 non conserves.
- `ops/discord-avatars/compose.avatar-environment.yml` : variables du seul service API.
- `ops/discord-avatars/Dockerfile.existing-api-image` : base API conservee sans mise a jour systeme.
- `ops/discord-avatars/PREFLIGHT.md` : mesures reelles et procedure conditionnelle.
- `ops/discord-avatars/README.md` : audit, configuration, couts, deploiement, rollback.
- `scripts/prepare-discord-avatar-vps.mjs` : paquet hors depot, empreintes et contraintes.
- `scripts/test-discord-avatar-cache.py` : tests Python isoles.
- `scripts/test-discord-avatar-assets.mjs` : paquet, mapping et cache navigateur.

Les modifications PB et le thumbnail Rorkesh preexistants ne font pas partie de
cette preparation. Aucun fichier SQL n'est necessaire.
