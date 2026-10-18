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
