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
