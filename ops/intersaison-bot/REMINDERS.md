# Rappels explicites du sondage 2

## Perimetre

Ce follow-up SQL reutilise la campagne et les destinataires existants. Il ne cree
ni campagne, ni destinataire, ni reponse. Appliquer le fichier de migration ne met
personne en file : seul un nouvel appel de confirmation explicite le fait.
Le sondage 1 conserve exactement son implementation de relance anterieure,
renommee en fonction privee. L'ancien point d'entree refuse le sondage 2.

Prerequis : migrations DM, surveys, objectives, choices et accounts deja posees.
Les roles previsionnels ne sont pas un prerequis de production de cette migration,
mais leur migration et des temoins non vides sont inclus dans les tests locaux.

## Contrat RPC

Les quatre RPC sont exclusivement accessibles au `service_role`. Le backend doit
deriver organisation et acteur de la session authentifiee, jamais du formulaire.

- `preview_intersaison_survey_two_reminders(p_org uuid, p_actor uuid, p_campaign uuid)`
  retourne `{campaignId, fingerprint, canQueue, counts, scopeGuilds, blockers}`.
- `queue_intersaison_survey_two_reminders(p_org uuid, p_actor uuid, p_campaign uuid,
  p_fingerprint text, p_request uuid, p_confirmed boolean)` retourne
  `{queuedCount, batchId, alreadyQueued}`.
- `refresh_intersaison_choice_delivery_counters(p_campaign uuid)` retourne `void`.
  Ici `p_campaign` est l'ID de la **campagne DM**, pas celui du sondage.
  Cette RPC interne accepte les campagnes choice officielles et techniques dont
  l'organisation et les liens sondage/saison correspondent.
- `intersaison_choice_delivery_attempts(p_dm_recipient uuid, p_reminder integer)`
  retourne le nombre entier de claims de livraison de la vague courante. Cette
  RPC interne est reservee aux rappels > 0 du sondage 2 officiel ; IDs, compte,
  organisation, campagne et sequence doivent tous correspondre exactement.

La previsualisation est globale G1..G7 et ignore les filtres de guilde de l'UI.
Elle exige un admin Paladin, un sondage 2 officiel ouvert, sa saison courante
non terminee, et une campagne DM officielle `intersaison_choice` coherente.
Une file `queued`/`sending` existante bloque une nouvelle vague.

Chaque destinataire est classe une seule fois, par priorite :

1. `responded` : marqueur de reponse ou reponse courante du compte.
2. `excluded` : excluded_duplicate, missing_invalid, not_included, cancelled.
3. `pending` : DM queued/sending.
4. `failed` : DM/sondage failed ou erreur non vide, y compris DELIVERY_UNCERTAIN.
5. `inactive` : compte absent, inactif ou hors effectifs Paladin.
6. `invalid` : IDs, rattachement, organisation, confirmation ou livraison incoherents.
7. `eligible` : DM sent avec sent_at/message ID, aucune confirmation/erreur,
   identite valide et egalites exactes de tous les IDs.

Un statut sondage `queued` seul n'exclut pas un DM deja `sent`.
`nonRespondents = total - responded`, ce n'est pas le nombre relancable.
Les secondaires restent des comptes distincts meme avec le meme Discord ID.
L'identite utilise `intersaison_choice_account_identity` et l'egalite
`D.account_member_key = S.member_id = coalesce(S.member_key,S.member_id)`.

## Confirmation Et Rejeu

L'empreinte MD5 couvre la campagne, tous les destinataires, leurs sequences et
identites, et les reponses (IDs, versions et contenu). Elle ne depend ni des seuls
totaux, ni des horodatages techniques updated_at/last_attempt/last_sent/reminder.
La serialisation des dates est fixee en UTC.

Pour une nouvelle demande, verrouillage dans l'ordre saison, campagne sondage,
destinataires sondage, destinataires DM, campagne DM, membres/guildes/organisation.
L'empreinte et l'eligibilite sont recalculees sous ces verrous. Toute modification
entre apercu et confirmation provoque une erreur demandant d'actualiser la
previsualisation, sans ecriture. Les RPC de reponse existantes prennent d'abord
les memes verrous de saison/campagne.

Les verrous de reference membres, guildes et organisation sont tous
`FOR SHARE NOWAIT`, avant la premiere ecriture. En conflit, la RPC leve `55P03`
avec une erreur francaise demandant d'actualiser la previsualisation ; aucune
mise en file ni batch n'est ecrit. Le trigger existant de comptes lies verrouille
secondaire puis principal, ce qui peut inverser l'ordre UUID de la relance.
NOWAIT evite d'attendre ce trigger en conservant C/S/D deja verrouilles, sans
changer ce trigger ni l'ordre metier. Les verrous saison/campagne/destinataires
restent inchanges. Une erreur de verrou n'est pas une invitation a confirmer
automatiquement : refaire un apercu et demander une confirmation explicite.

Un verrou transactionnel sur la cle de requete serialise les appels concurrents.
Un batch conserve durablement acteur, campagne, organisation, empreinte et nombre.
Un rejeu du meme `requestId` pour le meme acteur/organisation/campagne retourne le
resultat initial avec `alreadyQueued=true`, meme avec une autre empreinte, une
reponse intervenue depuis ou des messages deja envoyes. Une autre campagne ou un
autre acteur avec cette cle est refuse. Ne jamais purger ces batches pour relancer.

Une nouvelle vague explicite est autorisee une fois la precedente terminee :
nouvel apercu, nouvelle confirmation, nouveau `requestId`. Ce n'est pas une limite
d'une seule vague a vie. La mise en file ne modifie que les statuts/sequences et
`S.last_reminder_at`; elle conserve noms, guildes, IDs, tentatives et historique.

## Journal Et Verrous

`intersaison_survey_delivery_events` est append-only, sans donnees de reponse.
Le BEFORE UPDATE sur DM officiel poll 2 capture OLD et NEW pour les transitions
de statut, sequence, tentative, message ID, erreur et metadonnees de livraison.
Le premier sent -> queued conserve ainsi la livraison initiale sans backfill.
Un premier envoi peut remplir un ID null. Ensuite l'ID initial reste sur D ;
le nouvel ID reel est dans `new_snapshot.discord_message_id` du journal, capture
apres la protection de confirmation et avant restauration de l'ID initial.
Les evenements portent leur horodatage effectif `clock_timestamp()`.

Le journal conserve les UUID S/C/D **sans FK vers ces trois tables**. Ses guards
verifient les liens et organisations a l'insertion par lectures MVCC sans verrou
parent. Sinon le worker, tenant D, prendrait un KEY SHARE implicite sur S/C via
les FK et pourrait interbloquer submit/close, qui tiennent C/S puis attendent D.
Les snapshots peuvent ainsi survivre a l'archivage des parents. La FK organisation
reste en place. Seul le service peut lire ; les ecritures directes sont refusees,
et UPDATE/DELETE/TRUNCATE sont interdits par trigger.

Une reponse courante, ses marqueurs ou une confirmation existante maintiennent
D confirmed et confirmed_at lors d'un retour worker tardif. Une annulation sans
reponse reste cancelled. Le worker peut enregistrer les seules metadonnees d'un
message revenu apres annulation, sans ecrire le statut : le journal recoit le
nouvel ID reel et D garde son ID initial ainsi que cancelled. Aucun trigger
n'ecrit dans les reponses. Les campagnes
poll 1, ack et techniques ne passent pas par ce journal.

Le guard d'identite conserve les invariants organisation/compte immuables. Il
verifie l'appartenance actuelle pour INSERT, changement d'identite et statut
queued/sending/sent, mais permet failed/cancelled/confirmed apres depart du joueur.
La desactivation de l'organisation reste un cas necessitant une intervention.

Les compteurs choice sont recalcules sous FOR UPDATE de la campagne DM, sans
verrouiller les destinataires. Une mise en file recente ne peut pas etre ecrasee
par un ancien calcul JS. cancelled est conserve ; sent_at utilise
`coalesce(ancien_sent_at,min(destinataire.sent_at))`. Les classiques gardent leur
chemin existant. Le worker doit appeler cette RPC uniquement pour choice.

## Budget 429 Par Vague

`D.send_attempts` reste un historique cumulatif : aucune colonne, aucun reset ou
backfill supplementaire. Il ne sert pas de budget 429 aux rappels successifs.
`intersaison_choice_delivery_attempts` compte le journal durable du seul DM et de
sa sequence courante : OLD queued, NEW sending, send_attempts modifie, et le meme
reminder_count sur l'evenement et les deux snapshots. Les mises a jour de seules
metadonnees, un passage sans increment de tentative et les autres comptes ne sont
pas des claims. L'envoi initial (sequence 0), les anciennes/futures sequences, les
campagnes classiques/tests et les liens d'identite incoherents sont refuses.

Le worker appelle ce helper **uniquement sur HTTP 429 d'un rappel > 0**. Il peut
retenter si le resultat est strictement positif et < 5 ; a 5, zero ou en cas
d'erreur, pas de requeue automatique. L'envoi initial conserve son ancien budget
cumulatif. Par exemple, apres quatre tentatives initiales puis un succes de la
premiere vague, D.send_attempts vaut 5 mais la deuxieme vague a encore 0 claim.
Son premier claim porte le cumul a 6 et son budget de vague a 1, pas a 6.

Ce helper est une lecture, pas une autorisation d'envoyer ni de requeue. Les
controles pre-send et les CAS statut/send_attempts/reminder_count du worker restent
necessaires. Son erreur ne doit jamais declencher un recours a une autre sequence
ou a un compteur d'un autre compte partageant le meme Discord ID.

## Avant Toute Intervention Future

Ces controles sont une procedure pour une intervention future explicitement
autorisee, pas une autorisation d'acceder au VPS ou de redemarrer le worker.
Aucune operation de production n'a ete effectuee dans ce chantier local.

Identifier le **vrai worker execute sur le VPS** : service/conteneur, chemin absolu
du code charge, repertoire de travail, volumes/bind mounts, image et digest exacts,
commande de demarrage et chemins des fichiers prives de configuration. Ne pas
supposer que `ops/intersaison-bot` est le code effectivement execute. Comparer les
empreintes SHA-256 des fichiers reellement utilises avec celles du livrable local
attendu ; consigner les chemins VPS et les ecarts. Un ecart non explique bloque
l'intervention, meme si les tests locaux sont verts.

Avant modification, constituer une sauvegarde restaurable du code reel, de
l'image exacte (ID/digest et disponibilite de restauration) et des fichiers prives
du worker, avec chemins, proprietaires et permissions. Conserver les sauvegardes,
exports et configurations sensibles dans un emplacement prive controle, **hors
du depot**. Aucun .env, token, secret ou contenu de fichier prive dans Git, les
rapports ou les journaux de verification ; ne rapporter que les references et
empreintes necessaires, sans afficher les secrets.

Prendre un snapshot de reference en transaction **READ ONLY**, scope par
organisation/saison/campagne : reponses avec versions, choix et commentaires,
objectifs avec versions/items/snapshots, placements, roles previsionnels, effectifs
avec roles reels et rattachements de comptes. Inclure l'etat des campagnes et de
la file DM, ainsi que les batches/evenements existants. Garder les exports prives ;
consigner les IDs, totaux et empreintes deterministes ordonnees pour comparaison.
Apres migration et deploiement applicatif en pause, reprendre le meme snapshot
read-only : reponses/objectifs/placements/roles/effectifs doivent etre inchanges,
et aucune mise en file ne doit avoir ete produite par le deploiement. Tout ecart
inattendu bloque la reprise et exige un audit, sans reparation automatique.

## Deploiement Coordonne

1. Faire valider le deploiement et les controles/sauvegardes ci-dessus ; mettre le
   vrai worker en pause, empecher sa reprise automatique et desactiver le bouton
   de relance. Verifier l'arret effectif et l'absence d'appel d'envoi encore en
   cours. Ne pas declencher une relance pour tester la migration.
2. Executer `scripts/intersaison_survey_reminders_preflight.sql` en lecture seule.
   Traiter les ERROR de schema ; aucun echantillon live n'est necessaire.
3. Appliquer `scripts/intersaison_survey_reminders.sql`, puis le fichier verify.
   La migration est transactionnelle, reexecutable et sans backfill/enqueue.
4. Deployer de facon coordonnee le worker compatible et backend/UI : apercu puis
   confirmation ; RPC compteurs choice ; second controle immediatement avant
   l'envoi ; mises a jour conditionnelles des livraisons et tentatives ; budget
   429 de vague via le nouveau helper pour les rappels > 0 uniquement.
5. Avant toute reprise, comparer les snapshots read-only et recontroler les
   empreintes, chemins et image du worker cible. Verifier en lecture seule la
   file reellement consommee par ce worker, y compris les campagnes classiques
   ou techniques partagees : aucun `sending`, aucun appel HTTP en cours et aucune
   ligne `queued` susceptible de partir implicitement au demarrage. Une file
   preexistante ou un etat incertain bloque la reprise : auditer et obtenir une
   decision operateur distincte, sans purger, drainer ni reinitialiser les statuts.
   Seulement apres validation explicite du redemarrage, reprendre de facon
   controlee puis activer le bouton. Aucun rappel automatique ni appel queue ne
   fait partie du deploiement.

En incident : desactiver le bouton et mettre le worker en pause. Conserver les
batches, le journal, les guards et le blocage legacy poll 2. Ne pas restaurer un
ancien worker choice utilisant les compteurs JS. Corriger en avant ou revenir a
une version applicative compatible en gardant l'envoi en pause ; pas de reset de
statuts, suppression d'historique ou relance implicite.

Limite connue : aucun verrou SQL ne peut annuler un appel HTTP Discord deja
parti. Une reponse ou un depart survenant apres le dernier controle pre-send peut
encore croiser cet envoi. Les CAS et le trigger preservent l'etat confirme et
l'historique, pas l'annulation du transport. DELIVERY_UNCERTAIN exige un audit,
jamais une relance automatique.

## Validation Locale

```powershell
$env:PGLITE_MODULE_PATH='C:\Users\athon\AppData\Local\Temp\runform-objectives-sql-tests\node_modules\@electric-sql\pglite\dist\index.js'
node scripts/test-intersaison-survey-reminders-sql.mjs
```

La suite execute le vrai SQL en memoire, sans reseau ni envoi. Elle couvre la
classification, les comptes secondaires, les courses de consentement, les rejeux,
les vagues successives, les IDs initiaux, les confirmations/annulations, les sorties
d'organisation, les compteurs, les budgets 429 de deux vagues avec cumul >= 5,
les identites forgees, poll 1/tests, les guards/RLS et l'idempotence DDL.
Des temoins non vides prouvent la preservation des reponses/commentaires, placements,
roles previsionnels, objectifs et membres. Preflight/verify passent aussi sans
donnees live dans une transaction read-only. PGlite n'execute pas plusieurs
sessions PostgreSQL concurrentes : le test de verrous verifie notamment l'absence
des FK inversant l'ordre et la structure des trois NOWAIT avec erreur 55P03 avant
ecriture. Ce n'est pas un stress test multi-session du trigger de comptes lies.
