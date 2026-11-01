# Inter-saison : preparation du sondage 2

## Etat de cette preparation

Code local seulement. Aucun redemarrage, rebuild, changement de configuration,
envoi Discord ou migration de production n'est effectue par les scripts de test.

Le 18 octobre 2026, les sources actives ont ete lues sur le VPS :

- `/opt/gvg-paladin/intersaison-bot/services/guildDmCampaigns.js`
- `/opt/gvg-paladin/intersaison-bot/server.js`
- conteneur `paladin-intersaison-bot`, discord.js installe : `14.27.0`.

`services/guildDmCampaigns.cjs` est la copie du worker actif avec deux points
d'integration : selection du payload du sondage 2 dans la livraison existante,
et routage des interactions `interchoice`. La file, le claim CAS `queued -> sending`,
les compteurs, les cadences et les retries 429 sont conserves.

Le `server.js` actuel attend deja `handleGuildDmInteraction()`. Aucun changement
de ce fichier n'est necessaire. Le nouveau service reutilise les helpers ESM du
Portal, copies dans le paquet de preparation : pas de deuxieme moteur de sondage.

Les modals utilisent des Label (type 18), deux String Select (type 3) et un Text
Input facultatif. Le bouton ouvre directement le modal, sans acces Supabase.
Reference : [composants des modals Discord](https://github.com/discord/discord-api-docs/blob/main/developers/components/using-modal-components.mdx).
Le custom_id transporte le destinataire et son proprietaire ; la soumission
reverifie l'identite, la campagne, l'organisation et l'ouverture dans une RPC.

## Controles locaux

Fichiers du lot :

- API : `api/portal-intersaison.js`, `api/_intersaison-survey-objectives.js`,
  `api/_intersaison-survey-choices.js`.
- Interface : `src/components/PortalIntersaisonSurveyCenter.jsx`,
  `src/components/IntersaisonObjectivesPreparation.jsx`,
  `src/components/IntersaisonSurveyTwoWorkspace.jsx`.
- Helpers partages : `src/lib/intersaisonSurveyObjectives.js`,
  `src/lib/intersaisonSurveyChoices.js`, `src/lib/discordReproServer.js`.
- Bot prepare : `ops/intersaison-bot/services/guildDmCampaigns.cjs`,
  `ops/intersaison-bot/services/intersaisonChoice.cjs`,
  `scripts/prepare-intersaison-bot.mjs`.
- SQL : les trois scripts `scripts/intersaison_survey_choices*.sql`.
- Tests : les trois scripts `scripts/test-intersaison-survey-choice*.mjs`,
  et adaptation de `scripts/test-intersaison-surveys.mjs`.

Hors perimetre, laisses intacts : `api/portal-access.js`,
`scripts/test-member-pb-initialization.mjs`, `scripts/vekt_member_pb_entries_repair.sql`.

Les seules dependances de validation sont installees dans un dossier temporaire,
pas dans les dependencies du projet ni sur le VPS. Aucun client Discord n'est
connecte par les tests.

```powershell
$env:PGLITE_MODULE_PATH = "$env:TEMP\runform-objectives-sql-tests\node_modules\@electric-sql\pglite\dist\index.js"
$env:DISCORD_TEST_NODE_MODULES = "$env:TEMP\runform-intersaison-bot-tests\node_modules"
node scripts/test-intersaison-survey-choices.mjs
node scripts/test-intersaison-survey-choices-sql.mjs
node scripts/test-intersaison-survey-choice-worker.mjs
```

Le test SQL cree une base PostgreSQL en memoire, applique les migrations dans
cette base et teste notamment les echecs transactionnels, les ajouts tardifs,
les choix modifies, les placements, les droits et les exports. Il ne lit pas
`.env` et ne peut pas ecrire dans Supabase Production.

## Regles ajoutees

- Lancement officiel : sondage 1 cloture explicitement, derniere version validee,
  sept objectifs complets, effectifs courants et confirmation de leur empreinte.
- Objectifs, campagne et file DM publies dans la meme transaction. Les anciens
  textes historiques ne sont pas reecrits ; le snapshot de campagne est immuable.
- Une future saison capture les derniers objectifs officiels comme reference.
  Les saisons existantes ne sont pas backfillees et leur ancienne reference est
  conservee. Les exports du sondage 1 utilisent ce snapshot lorsqu'il existe.
- Les IDs Discord absents/invalides sont suivis en rouge. Tous les comptes
  partageant un meme ID sont exclus des MP officiels plutot que de choisir
  arbitrairement un joueur. Le modal de confirmation donne les nombres exacts.
- Le test personnel est une vraie campagne `is_test`, avec un seul destinataire
  derive du membre connecte cote serveur. Il ne publie pas les objectifs et ne
  bloque pas la campagne officielle.
- Les nouveaux membres sont detectes par synchronisation en lecture seule.
  L'ajout a la file requiert une selection et une confirmation administratives.
  Cela fonctionne pour les sondages 1 et 2 ouverts, sans reinitialiser les autres.
- Le placement administratif est un journal append-only avec auteur, date et
  revision. Il ne devient jamais une reponse et ne transfere aucun membre.
- Une decision administrative active reste prioritaire dans le plan, mais le
  premier choix du joueur est conserve et une divergence est signalee.
  Retirer la decision reactive le premier choix, sans effacer l'historique.
- Le plan se recalcule en lecture seule, avec un seul emplacement par joueur.
  Les anciens destinataires absents des effectifs sont conserves et signales.
  Le seuil de 30 est indicatif et ne bloque pas les reponses.
- Les reponses sans commentaire sont valides. Les exports officiels excluent les
  tests et conservent le snapshot, les choix et les placements distinctement.

## Deploiement ulterieur, apres autorisation explicite

1. Relire le diff et laisser les trois modifications PB hors commit.
2. Executer manuellement le preflight, puis la migration, puis le verify :
   `scripts/intersaison_survey_choices_preflight.sql`,
   `scripts/intersaison_survey_choices.sql`,
   `scripts/intersaison_survey_choices_verify.sql`.
   Le preflight/verify sont en lecture seule. Aucun ancien destinataire ou
   reponse n'est mis a jour par la migration.
3. Apres validation des controles et nouvelle autorisation, commit/push du Portal
   et verification du deploiement Vercel Production READY.
4. Creer le paquet local hors depot :

   ```powershell
   node scripts/prepare-intersaison-bot.mjs "$env:TEMP\paladin-intersaison-survey-two-release"
   ```

5. Verifier en lecture seule qu'aucun recipient n'est `queued` ou `sending` avant
   le redemarrage du bot. Reprendre une sauvegarde du dossier/image courants.
6. Comparer le worker actif a sa version auditee pour conserver toute modification
   concurrente. Copier `services/`, `shared/` et le `Dockerfile` du paquet prepare dans
   un dossier de staging du bot. Ne PAS remplacer le package.json du bot par celui
   du paquet de tests, ni son `.env`, `server.js` ou ses autres services.
   Le Dockerfile conserve celui du bot et ajoute uniquement `COPY shared ./shared`.
7. Apres autorisation, remplacer les fichiers prevus, rebuild/restart du seul
   conteneur `paladin-intersaison-bot`. Conserver les dependencies existantes.
8. Verifier sante, logs et tests sans creer de campagne. Le premier envoi personnel
   doit etre declenche manuellement par l'admin depuis le dashboard.

La migration doit preceder le code Portal, notamment pour les relances atomiques.
Ne jamais lancer le sondage 2 tant que le nouveau worker n'est pas actif.
Ne pas retablir l'ancien worker pendant qu'une campagne `intersaison_choice` est
en file : il ne sait pas la traiter. Un rollback exige d'abord de controler ce
perimetre, sans toucher aux autres services ni supprimer les reponses.

Le sondage 1 actuellement ouvert n'est pas cloture par le deploiement. Sa cloture
reste une action distincte, explicite, avant un futur lancement officiel du n 2.

## Preparation comptes secondaires et recuperation (non deployee)

Le suivi reste fonde sur le compte de jeu, jamais sur un regroupement des reponses
par Discord ID. Le serveur valide les liens `guild_members.primary_member_id` :
un seul principal dans Paladin, pas de cycle/chaine, Discord du secondaire absent
ou identique a celui du principal, et aucune autre famille active partageant cet ID.
Une ambiguite demande une correction explicite dans Gestion guilde ; l'interface
de recuperation ne propose ni saisie de Discord ID ni derogation manuelle.

Scripts a examiner puis executer uniquement apres autorisation :

- `scripts/intersaison_survey_accounts_preflight.sql` (lecture seule).
- `scripts/intersaison_survey_accounts.sql` (transaction).
- `scripts/intersaison_survey_accounts_verify.sql` (lecture seule).

La migration ajoute `guild_dm_recipients.account_member_key`, initialise cette
identite uniquement sur les lignes du sondage 2 existantes, puis remplace l'index
Discord global par deux index uniques partiels : campagne/compte pour le sondage 2,
campagne/Discord pour les campagnes classiques. Les IDs de destinataires restent
identiques. Aucun statut, objectif, reponse, historique ou file n'est reinitialise.
Les triggers protegent l'identite et les nouvelles reponses. Les RPC de lecture,
reprise individuelle et verification avant envoi sont service-only.

Chaque futur MP du sondage 2 inclut le pseudo et la guilde du compte concerne.
Le worker lit les snapshots de compte dans la file existante, verifie l'autorisation
avant d'appeler Discord et garde les memes components/interactions. Les MP deja
envoyes ne sont ni edites ni renvoyes. Les autres campagnes gardent leur payload.
Les retries 429 du sondage 2 s'arretent apres cinq tentatives ; aucun retry infini
n'est ajoute aux autres echecs. Une erreur apres transmission mais avant sauvegarde
est marquee `DELIVERY_UNCERTAIN` : reprise bloquee, audit du MP indispensable.

Procedure ulterieure sans recreation ni fermeture du sondage ouvert :

1. Conserver les snapshots/exports des reponses et objectifs, lancer le preflight.
   Ne declencher aucun nouvel envoi administratif pendant la maintenance.
2. Apres autorisation SQL, appliquer la migration et le verify. Les anciennes
   interactions restent disponibles et les reponses existantes ne sont pas modifiees.
3. Verifier la file vide avant toute intervention sur le bot. Sauvegarder sources
   et image. Preparer le paquet hors depot, comparer le worker actif puis deployer
   uniquement les services/shared et le Dockerfile prevus ; aucune nouvelle dependance.
   Rebuild/restart du seul bot apres autorisation, tests mockes et controle de sante.
4. Apres autorisation commit/push, deployer le Portal et verifier Vercel READY.
   Ne pas activer les reprises tant que le nouveau worker n'est pas confirme actif.
5. Dans le sondage 2, ouvrir chaque compte rouge, examiner le principal et les
   comptes lies, puis confirmer individuellement « Reessayer l'envoi ».
   La RPC revalide le lien et son empreinte, refuse les reponses deja presentes,
   messages deja recus et envois deja en file, puis ajoute UN recipient a la campagne
   existante ou reprend sa ligne en echec, avec le meme snapshot officiel.
   Les relances collectives ne recuperent pas les echecs du sondage 2.
6. Pour un refus Discord 50278, faire rejoindre le serveur au bon compte Discord.
   Pour 50007, faire autoriser les MP. Corriger un ID introuvable dans Gestion guilde.
   Aucun renvoi automatique, aucune nouvelle campagne, aucune modification d'objectif.

Le rollback ne doit pas restaurer l'ancien index unique Discord une fois plusieurs
comptes d'un meme proprietaire mis en file. Ne pas retablir un worker sans la
personnalisation/verification pendant ces envois. Garder la campagne ouverte,
arreter les actions administratives et auditer avant tout retour de version.

Validation isolee supplementaire : `node scripts/test-intersaison-survey-accounts.mjs`
(meme `PGLITE_MODULE_PATH` que ci-dessus). Aucune migration de production n'est
executee par les tests et tous les envois du worker sont mockes.

## Sondages de guilde autonomes (preparation locale, non deployee)

Le module Gestion des guildes propose **Creer un sondage** et **Sondages**.
Les membres repondent dans **Mes sondages**, ou depuis le lien authentifie
`/portal?guildSurvey=<uuid>` de l'invitation Discord. L'UUID n'est pas un jeton
d'acces : la session et l'identite du participant sont toujours verifiees.

Les tables `guild_surveys` et `guild_survey_*` sont independantes de l'Inter-saison.
Aucune fonction du nouveau module ne modifie une table Inter-saison, un effectif,
un objectif, un placement, un role reel ou une donnee personnelle.
Les sept tables nouvelles sont sous RLS et sans acces direct pour anon,
authenticated ou service_role ; les deux RPC publiques sont reservees au service.
Les fonctions privees et triggers ont un search_path fixe et ne sont pas appelables
par les clients. La session serveur fournit l'acteur, jamais le corps de requete.

Leader et Admin gerent les guildes actives de leur organisation, comme pour les MP
de guilde. Un Admin peut consulter mais pas administrer un sondage cree par un
Leader. Toute action d'administration revalide le role et l'organisation en SQL.
Les guildes viennent de `portal_guilds`, sans limite G1-G7/G9 dans ce module.
Un code de guilde ambigu entre organisations bloque la previsualisation et les
envois. L'inactivite de l'organisation ou du compte bloque aussi la livraison.

Un participant correspond au compte principal stable. Ses comptes secondaires
explicitement lies sont regroupes : une invitation et une reponse commune, avec
le nombre de comptes affiche avant confirmation. Un Discord partage sans lien
explicite ou une association contradictoire est exclu des MP et signale pour
verification ; les reponses ne sont jamais fusionnees sur le seul Discord ID.
Les comptes sans Discord conservent leur acces nominatif depuis le portail.
La guilde au lancement reste un snapshot ; un transfert ne reassocie pas la reponse
a un autre joueur. Une sortie de l'organisation bloque les envois suivants.

Les brouillons et previsualisations n'ajoutent aucune campagne MP. A la publication,
une RPC verrouille le sondage, revalide l'empreinte du roster et cree les participants
et une vague technique dans la file MP existante, atomiquement. Chaque confirmation
a un UUID idempotent. Une relance cree une nouvelle vague technique du MEME sondage,
sans reinitialiser ni ecraser la livraison initiale. Son historique est conserve
dans `guild_survey_waves`, `guild_survey_deliveries` et les evenements de livraison.
Le filtre de consultation ne limite pas l'envoi confirme aux guildes selectionnees
lors de la creation du sondage. Les erreurs permanentes/incertaines, comptes modifies,
repondants, destinataires deja en attente et invitations de moins d'une heure sont
exclus. Une erreur HTTP 429 peut etre reprise par une nouvelle confirmation apres
ce delai ; aucune reprise automatique d'une erreur permanente n'est prevue.

Le worker n'emprunte la nouvelle branche que pour `interaction_payload.kind =
guild_survey_v1`, avec `interaction_type = none`. Les interactions Inter-saison,
les boutons de reponse Discord et les MP classiques gardent leur parcours actuel.
Le nouvel adaptateur `services/guildSurvey.cjs` construit une invitation avec lien,
sans bouton d'acquittement pouvant etre confondu avec une reponse au sondage.
L'identite, la cloture et l'absence de reponse sont revalidees avant la prise en
charge puis apres la recherche Discord, juste avant l'envoi. La prise en charge
SQL exige une autorisation recente de l'adaptateur : un ancien worker ne peut pas
envoyer les nouveaux sondages. Cinq tentatives maximum, y compris sur HTTP 429.
Une transmission Discord acceptee mais non confirmee en base est marquee
DELIVERY_UNCERTAIN et n'est pas renvoyee automatiquement.

La modification des reponses utilise un numero de version pour eviter les ecrasements.
Questions et destinataires sont figes apres publication. Une date limite depassee
bloque reponses et envois sans necessiter de cron. La cloture conserve toutes les
reponses et annule les transmissions encore en attente. Aucune garantie d'annulation
retroactive d'une requete deja acceptee par Discord n'est possible.

### Ordre de mise en production, apres une nouvelle autorisation

1. Executer `scripts/guild_surveys_preflight.sql` (un seul JSON, lecture seule).
   Comparer le schema avec le miroir teste et conserver les empreintes. Verifier
   qu'aucun traitement MP n'est actif avant toute intervention sur le worker.
2. Installer `scripts/guild_surveys.sql`, puis executer `guild_surveys_verify.sql`.
   A ce stade `delivery_enabled=false` est NORMAL. Aucune campagne n'est creee.
3. Sauvegarder le bot actif et son image. Preparer le paquet HORS depot avec
   `node scripts/prepare-intersaison-bot.mjs <dossier-de-preparation>`.
   Les seuls changements worker sont le fichier guildDmCampaigns et l'ajout de
   guildSurvey.cjs. Aucun changement de dependance, du moteur GvG ou des templates.
   Comparer avec les sources VPS actives, tester le paquet, puis seulement apres
   autorisation deployer/redemarrer le service MP concerne. Ne pas purger la file.
4. Publier les seuls fichiers du nouveau module/API apres autorisation, verifier
   Vercel READY et la session autorisee. Relancer les tests de non-regression.
5. Une fois le worker adapte confirme actif, executer SEULEMENT sur autorisation
   `scripts/guild_surveys_enable_delivery.sql`. Cette activation ne cree pas de vague.
6. Creer le premier brouillon en choisissant le modele Paladin x DEUS ; verifier
   les questions et les destinataires reels. La premiere publication/confirmation
   et tout test personnel reel restent des actions manuelles distinctes a autoriser.

Retour arriere : desactiver d'abord `delivery_enabled`, ne pas supprimer les tables,
reponses ou historiques. Garder les garde-fous SQL. Attendre l'inactivite de la file
avant de retablir une version sauvegardee du worker ; ne jamais rendre une ligne
incertaine ou annulee eligible automatiquement. Le flag ne rappelle pas un MP deja
accepte par Discord. Les anciens sondages et les autres services ne sont pas touches.

### Tests isoles

- `node scripts/test-guild-surveys.mjs` : API, identite serveur, methodes, CSV et modele.
- `node scripts/test-guild-surveys-sql.mjs` : PostgreSQL reel isole via PGLITE_MODULE_PATH.
- `node scripts/test-guild-survey-worker.mjs` : worker/Discord strictement mockes,
  avec DISCORD_TEST_NODE_MODULES pointant vers un runtime de test discord.js.
- `node scripts/test-guild-surveys-browser.mjs` : Playwright local via
  PLAYWRIGHT_MODULE_PATH, captures desktop/mobile ; tous les envois sont fictifs.
- `node scripts/guild-survey-preview.mjs` : interface locale sur le port 5192,
  route `/__guild-surveys-preview` ; toutes les routes API reelles y sont bloquees.

Verifier aussi test-guild-dm-campaigns, test-intersaison-surveys et
test-intersaison-survey-choice-worker. Aucun de ces tests n'exige une migration
de production, un compte Discord reel, une capture GvG ni un envoi de MP.

### Inventaire du lot local

Fichiers crees :

- `api/portal-guild-surveys.js`
- `src/lib/guildSurveys.js`
- `src/lib/guildSurveyApi.js`
- `src/components/GuildSurveyQuestions.jsx`
- `src/components/GuildSurveyWorkspace.jsx`
- `src/components/GuildSurveyInbox.jsx`
- `scripts/guild_surveys.sql`
- `scripts/guild_surveys_preflight.sql`
- `scripts/guild_surveys_verify.sql`
- `scripts/guild_surveys_enable_delivery.sql`
- `scripts/guild-survey-preview.mjs`
- `scripts/test-guild-surveys.mjs`
- `scripts/test-guild-surveys-sql.mjs`
- `scripts/test-guild-surveys-browser.mjs`
- `scripts/test-guild-survey-worker.mjs`
- `ops/intersaison-bot/services/guildSurvey.cjs`

Fichiers existants modifies :

- `src/components/PortalGuildManagementTab.jsx` : acces creation et liste.
- `src/SaasPortal.jsx` : boite personnelle des sondages authentifies.
- `ops/intersaison-bot/services/guildDmCampaigns.cjs` : branche opt-in de livraison.
- `scripts/prepare-intersaison-bot.mjs` : inclusion de l'adaptateur dans le paquet.
- `ops/intersaison-bot/README.md` : procedure et limites.

Validation locale initiale (avant le correctif d'eligibilite) : 97 assertions PostgreSQL isolees, tests API/worker, tests
navigateur 1440/768/390/320 px et non-regressions des MP/sondages Inter-saison.
ESLint cible sans erreur (quatre avertissements preexistants dans SaasPortal),
build et git diff --check conformes. Les envois et publications des tests sont
uniquement simules. Le verrouillage SQL et l'idempotence sont exerces dans une
instance isolee ; ce n'est pas un test de charge PostgreSQL multi-processus.
La compatibilite du schema reel et du bot VPS actif devra encore etre confirmee
par le preflight et la comparaison des sources avant un deploiement autorise.

### Correctif d'eligibilite apres le controle reel du 1er novembre 2026

Le premier controle reel a revele que `community_status=inactive` est aussi une
valeur normale pour un membre actif rattache a une guilde. Il ne faut jamais
modifier ces comptes pour contourner un refus du nouveau module. Le controle API
existant est correct : seuls les comptes de type community, ou de role
community_member/content_creator/vip, sont bloques par leur statut communautaire.

Le correctif local couvre cinq fonctions du module : acteur, roster, etat d'un
destinataire, requete publique (compteurs) et autorisation de livraison. Pour les
comptes de guilde, les controles roster_status, guilde/organisation actives et
identite restent applicables. Les comptes communautaires ne sont pas inclus dans
un roster de guilde, meme si un ancien rattachement de guilde subsiste.

Nouveaux fichiers :

- `scripts/guild_surveys_eligibility_fix.sql` : correctif transactionnel cible.
- `scripts/guild_surveys_eligibility_verify.sql` : dix controles et diagnostic
  dynamique, strictement en lecture seule, avec empreintes des donnees existantes.
- `scripts/test-guild-survey-eligibility.mjs` : 355 assertions, reproduction anonyme du roster
  observe (231 comptes, dont 114 affectes, 3 Leaders et 11 Admins) et vrai parcours
  API/SQL dans PostgreSQL isole. G8=21, G9=13, G1-G7 verifies, comptes lies,
  comptes inactifs, separation des organisations et autorisation avant envoi.

`guild_surveys.sql` est aussi corrige pour les futures installations neuves.
Il ne doit PAS etre rejoue sur l'installation de production existante.
Le patch conserve le texte non concerne, les signatures, proprietaires, grants
et search_path des fonctions. Aucune table, aucun trigger et aucune donnee ne sont
modifies. Il refuse une definition inattendue ou un flag d'envoi deja active ;
il n'active ni ne desactive ce flag lui-meme. Les tests de livraison positive
utilisent une transaction jetable, annulee ensuite, sans client Discord reel.

Reprise minimale, SEULEMENT apres autorisation :

1. Executer le correctif cible `guild_surveys_eligibility_fix.sql`.
2. Executer `guild_surveys_eligibility_verify.sql`, transmettre le JSON et verifier
   les dix controles OK, les compteurs dynamiques, les empreintes comparees au
   releve precedent et `delivery_enabled=false`. Ne pas forcer en cas d'erreur.
3. Reprendre les controles du worker et de la file, sa sauvegarde puis le
   deploiement cible autorise ; deployer ensuite le dashboard/API sur Vercel.
4. Garder les envois desactives et ne creer aucun sondage de test en production.
   Ne PAS executer `guild_surveys_enable_delivery.sql` a ce stade.

Tests locaux : `node scripts/test-guild-survey-eligibility.mjs` avec
PGLITE_MODULE_PATH. GUILD_SURVEY_ELIGIBILITY_REPORT peut designer un fichier JSON
de resultat hors depot. Relancer aussi test-guild-surveys-sql (99 assertions),
test-guild-surveys, test-guild-survey-worker et les non-regressions Inter-saison.
