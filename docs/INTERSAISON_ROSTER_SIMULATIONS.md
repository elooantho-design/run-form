# Simulation des effectifs Paladin - Livraison 1

## Perimetre

Inter-saison > Simulation des effectifs. Scenarios independants des sondages et des anciens plans.
Creation a partir du roster actif, noms et guildes dynamiques, capacites du catalogue si configurees (sinon 30, comme le plan existant).
Un compte de jeu = une entree UUID = une place, y compris pour les comptes secondaires partageant un Discord ID.

Deplacements individuels/multiples, selection entre guildes, retour a l'origine, annulation de la derniere operation,
reinitialisation confirmee, guildes masquables sans suppression, renommage, archivage en lecture seule.
Toutes les operations sont enregistrees immediatement cote serveur avec revision optimiste et historique.
Les conflits entre administrateurs exigent une actualisation, sans fusion silencieuse.

Synchronisation a l'ouverture, au retour sur la fenetre et toutes les 30 secondes lorsque la page est visible.
Elle ajoute les nouveaux membres actifs et les nouvelles guildes sans remplacer les destinations deja choisies.
Les communautaires sont disponibles dans une recherche prefixe commune, mais ne sont ajoutes qu'a la demande.
Les comptes connus d'une autre organisation, meme devenus communautaires sans guilde, restent exclus.
Les changements reels de statut, guilde ou identite sont signales comme ecarts. Les comptes devenus hors perimetre
ne livrent aucune nouvelle donnee d'une organisation externe.

Export texte telechargeable ou copiable pour Discord, couvrant toutes les guildes, meme masquees.
L'export porte la mention SIMULATION - NON APPLIQUEE.

## Installation minimale

1. Executer `scripts/intersaison_roster_simulations_preflight.sql` dans Supabase SQL Editor.
   Lecture seule, 28 controles, un seul resultat JSON. Arreter si `all_checks_ok` n'est pas `true`.
2. Executer `scripts/intersaison_roster_simulations.sql`.
   Transaction additive : trois tables et cinq fonctions nouvelles, index et permissions sur ces seuls objets.
   Aucune fonction existante n'est remplacee, aucune ligne metier n'est modifiee. Reexecution idempotente.
3. Executer `scripts/intersaison_roster_simulations_verify.sql`.
   Lecture seule, 17 controles, un seul resultat JSON. Attendre `all_checks_ok: true`.
4. Apres validation SQL, publier uniquement le nouveau module, son API et l'integration dans `PortalIntersaisonTab.jsx`.
   Ne pas deployer l'interface avant l'installation de la fonction SQL.
5. Verifier les acces Leader/Admin Paladin, le refus membre/client, puis la creation et sauvegarde d'un scenario
   explicitement choisi par l'administrateur. Ne pas modifier les vrais effectifs pour ce controle.

Aucune intervention VPS, aucun worker, aucun redemarrage, aucune activation d'envoi Discord.
En cas de probleme apres deploiement : revenir au dashboard precedent ; conserver les trois tables pour ne pas perdre les scenarios.

## Limites explicites

- Aucun transfert reel disponible dans cette livraison : ni bouton actif, ni branche API/SQL d'application.
- L'integration reelle des communautaires est egalement impossible. Leur affectation reste virtuelle.
- La priorite 2 necessitera previsualisation figee, resolution des ecarts, controles des capacites finales,
  integration communautaire conforme au parcours existant et application transactionnelle idempotente.
- Les reponses DEUS/Imperatores ne sont pas affichees dans cette premiere livraison ; aucune lecture ou modification
  de leurs reponses n'est necessaire. Seuls les rattachements historiques servent au controle d'organisation.
- Pas d'images enrichies ou de comparaison graphique de scenarios dans cette livraison.
- Les filtres d'affichage sont sauvegardes dans le scenario, donc partages entre ses administrateurs.

## Validation locale

- `node scripts/test-roster-simulations.mjs` : API, identite serveur, methodes, protection origine, erreurs, projection et export.
- `node scripts/test-roster-simulations-sql.mjs` avec `PGLITE_MODULE_PATH` : PostgreSQL isole, aucune connexion production.
- `node scripts/test-roster-simulations-browser.mjs` avec `PGLITE_MODULE_PATH`, `PLAYWRIGHT_MODULE_PATH`, `ROSTER_TEST_OUTPUT` :
  vrai React/API/SQL local, 200 joueurs fictifs, 1440/768/390/320 pixels, APIs externes interdites.
- `node scripts/test-intersaison-plan-cycle.mjs` et tests des sondages : non-regression isolee.
- ESLint, build Vite et `git diff --check`.

La previsualisation `node scripts/roster-simulation-preview.mjs` utilise uniquement une base PostgreSQL en memoire,
des comptes fictifs et une session locale. Elle n'accede jamais aux tables de production.
