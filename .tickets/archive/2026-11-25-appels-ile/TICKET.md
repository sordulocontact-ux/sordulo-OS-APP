# Appels plus utiles dans l'île : validation, moments marqués, Google Agenda, Gmail

## Ticket d'origine
Demande de Maël (25/11), texte complet passé à /ticket : valider les tickets dans l'île (« Valider ici », un ticket à la fois, clavier), marquer un moment pendant l'appel (raccourci global + bouton, étoile, inputs.markers, ±30 s signalés à l'analyse, tickets.from_marker affiché partout), Google Agenda (carte Connecteurs, PKCE par l'app de bureau, présélection du projet d'après l'événement en cours, titre de l'entrée, rappel 5 min avant avec « Rejoindre »), Gmail (carte, mails des contacts clients avec projet actif, notification Analyser / Ignorer, entrée écrite avec corps nettoyé et pièces jointes PDF / Word, inputs.external_ref unique par organisation). Coordination : une autre session (notifications devis, paiement…, migration 0010) partage catalog.ts, catalog.test.ts, sources/index.ts, lab/fixtures.ts, lab/IslandLab.tsx (et, d'après elle, types.ts de l'île, source.ts, IslandController.tsx, garden/**, src/shared/types.ts, tokens.css, harness.ts) : ajouts courts faits par l'orchestrateur seulement, après l'avoir prévenue. Migration 0011 prévue, devenue 0024.

## Contexte
- Île : coordinateur (file, concentration, regroupement, interruptions), sources dans `controller/sources/`, catalogue des notifications, géométrie win / mac (encoche 186 × 32), labo `/desktop/ile-labo`.
- Validation web : `src/features/review/diff.ts` (planSave, makeTicketDraft, nextPosition) + `save.ts` (executePlan, sans React) : réutilisés tels quels. Les tâches sont créées par l'analyse ; valider = patch du ticket.
- Enregistrement : `src-tauri/src/recording.rs`, `WasapiRecorder` partagé Windows / macOS (`elapsed_secs` = position dans le MP3). Résultat `RecordingResult` gardé dans la file d'envoi de l'île.
- Analyse : Deepgram (utterances avec start / end), `formatTranscriptForPrompt`, Claude puis Mistral, `saveTickets` côté serveur (seul à insérer des tickets).
- Connecteurs : Spotify (PKCE boucle locale dans Rust, ligne par compte, rien sur le disque) sert de modèle ; cartes « Gmail » et « Google Agenda » déjà au catalogue en « Bientôt ».
- Documents : `extractDocumentText(file)` (unpdf, mammoth), utilisé par la zone de dépôt de l'île.

## Décisions
- Comptes Google : Workspace ou Gmail perso selon la personne ; même code ; en mode Test, l'accès expire après 7 jours : notification « Reconnecte Google Agenda / Gmail » et carte « À reconnecter » (réponse de Maël).
- App Google de l'agence : Client ID + secret (client « Application de bureau ») compilés dans l'app de bureau (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` au build : `.env.local` en local, secrets CI), pas de saisie dans la carte (réponse de Maël). Sans identifiants compilés : cartes « Indisponible dans cette version ».
- Raccourci : Ctrl+Alt+M (Windows), Ctrl+Cmd+M (macOS), enregistré seulement pendant un enregistrement ; Ctrl+Maj+M écarté (micro de Teams et Discord) (réponse de Maël).
- Ticket d'un moment marqué : garde sa priorité, seulement l'étoile (réponse de Maël).
- Gmail : tous les mails reçus d'un email de contact client dont le client a un projet en cours, sauf les miens, pas de libellé (réponse de Maël).
- Ajouts retenus (réponse de Maël) : annuler un refus dans l'île ; fenêtre principale rafraîchie après une validation dans l'île ; « Annuler » le dernier repère pendant 5 s ; mail non traité (notification partie sans clic ou regroupée) : UNE seule relance, regroupée (« 2 mails clients pas encore traités »), au prochain moment calme ou le lendemain matin.
- Une connexion par service (`google_connections`, clé user_id + service), chacune avec son scope en lecture seule (+ email). Jetons d'accès dans la mémoire de Rust ; Calendar et Gmail appelés par le front (CORS de googleapis.com, comme Vercel). Redirection en boucle locale sur un port libre (autorisé pour les clients de bureau Google) (choix par défaut).
- Dédoublonnage Gmail par l'en-tête `Message-ID` (identique dans toutes les boîtes) : un mail reçu par Maël et Sacha ne donne qu'une entrée (index unique organisation + external_ref) (choix par défaut).
- Curseur Gmail sur la ligne du compte (`cursor_at`) : à la connexion, les mails déjà reçus ne sont pas proposés (choix par défaut).
- « Valider ici » : bouton principal de « N tickets à valider », « Ouvrir » (écran de validation) en second. Notifications à deux boutons : champ `secondary` (choix par défaut).
- Mise à jour pendant que l'île valide : relecture des tickets toutes les 4 s tant que l'état est ouvert (tickets hors de la publication temps réel) (choix par défaut).
- Repères : secondes depuis le début de l'audio (f64), au plus 100 ; `from_marker` calculé par le serveur d'après le temps de la citation dans la transcription (±30 s), l'avis de Claude en repli quand la citation n'est pas retrouvée (choix par défaut).
- Présélection : participants (hors moi) ↔ emails des contacts → projet en cours le plus récent ; sinon titre ↔ noms des clients puis des projets ; sinon dernier projet. Événement « en cours » : de 5 min avant le début jusqu'à la fin. Le titre de l'événement devient le titre de l'entrée (choix par défaut, ticket).
- Rappel : 5 min avant, événement non refusé, pas sur la journée, avec un lien de visio (Meet, Zoom, Teams, Webex…), une fois par événement ; projet présélectionné affiché dans le sous-titre (choix par défaut).
- Socle posé par l'orchestrateur avant les lots (ajouts courts, l'autre session prévenue) : `src/shared/types.ts`, `api-contract.ts`, `desktop-contract.ts`, `src/lib/desktop.ts`, `src/lib/google.ts`, `src/lib/clientDirectory.ts`, types de l'île (état `review`, sortes `mailFeedback` / `mailReminder` / `googleReconnect`, actions, `secondary`, icône `mail`), `view/types.ts`, gestes (`source.ts`, `runtime.ts`, `IslandController.tsx`), catalogue + exemples du labo.

## Hors périmètre
- Écrire dans l'agenda ou répondre aux mails ; agendas autres que le principal ; pièces jointes autres que PDF, Word et texte.
- Vérification de l'app Google par Google (mode Production pour Gmail perso).

## Critères d'acceptation
- [x] « N tickets à valider » : « Valider ici » ouvre l'état review (type, titre, description raccourcie, avatar, extrait, « 2 sur 5 », étoile), Refuser / Valider / Tout valider / Modifier dans l'app, Annuler un refus, flèches / Entrée / Retour arrière / Échap ; enregistrement par review/diff + save ; relecture toutes les 4 s ; fenêtre principale rafraîchie (tests ticketReview, review.test, labo). À essayer avec de vraies données dans l'app de bureau.
- [x] État review : tailles win et mac, rien sous l'encoche, vérifié au labo (Windows et Mac avec encoche, clavier, refus annulable).
- [x] Pendant un enregistrement : raccourci et « Marquer » posent un repère ; étoile et compteur ; « Annuler » 5 s (labo, tests call / markers Rust). Raccourci réel à essayer : Windows par Maël, Ctrl+Cmd+M par Sacha sur Mac (non compilé).
- [x] Repères envoyés avec l'audio (inputs.markers), passages ±30 s signalés à l'analyse, tickets.from_marker calculé par le serveur ; étoile dans l'île, l'écran de validation, l'onglet Tickets, la fiche de l'entrée (tests api, transcript, pipeline, markers).
- [x] Cartes Google Agenda et Gmail : connexion PKCE par l'app de bureau, lignes par compte et service (RLS testée), rien sur le disque, À reconnecter. Connexion réelle à faire après création de l'app Google de l'agence.
- [x] Événements des 24 h relus toutes les 5 min ; présélection du projet avec la raison ; titre de l'entrée ; rappel 5 min avant avec Rejoindre, jamais refusé ni journée entière (tests calendar, calendarMatch, googleCalendar).
- [x] Gmail : mails des contacts clients (projet en cours), « X a envoyé un retour » Analyser / Ignorer, entrée écrite (corps nettoyé, PDF / Word), jamais deux fois (external_ref, 409), contenu envoyé seulement après Analyser, relance unique regroupée (tests gmail, mailText, gmailPending, create).
- [x] Nouvelles sortes au catalogue avec tests ; tout passe par le coordinateur.
- [x] Labo : boutons « Appel détecté (agenda) », « Appel avec repères », « Valider ici » et ses 4 variantes ; nouvelles notifications dans la liste « Envoyer ».
- [x] Migration 0024 (renumérotée : 0010 à 0021 prises par Sacha, 0022 et 0023 par la session des notifications) avec tests RLS, appliquée en production et notée dans sordulo_meta avant le push.
- [x] typecheck, lint, 2249 tests, build, cargo test (233) sur Windows. macOS non compilé : à faire par Sacha.

## Lots
| Lot | Objectif | Fichiers possédés | Dépend de | Modèle / effort | Statut |
|---|---|---|---|---|---|
| L0 | Socle (contrat, types, catalogue) | voir Décisions | - | orchestrateur | validé |
| L1 | Migration 0011 + tests RLS ; API (markers, externalRef) ; analyse (passages marqués, from_marker) | supabase/migrations/0024_* (d'abord 0011), supabase/tests/google.test.ts, supabase/tests/calls.test.ts, supabase/README.md, api/**, src/shared/{analysis-schema,transcript,quote}.ts, src/features/tickets/quote.ts | L0 | opus / high | validé |
| L2 | Rust : raccourci global + repères ; OAuth Google ; build et CI | src-tauri/**, .github/workflows/desktop-platform.yml, scripts/build-desktop.mjs, .env.example | L0 | opus / high | validé |
| L3 | Vue de l'île : état review, 2e bouton, Marquer / étoile / compteur / Annuler, raison de la présélection | src/features/island/view/** (sauf types.ts), geometry.ts, geometry.test.ts, art/** | L0 | opus / high | validé |
| L4 | Validation dans l'île (source) + écran de validation sur un ticket + rafraîchissement de la fenêtre principale ; étoile sur l'écran de validation, l'onglet Tickets et la fiche de l'entrée | controller/sources/ticketReview*.ts, src/features/review/**, src/features/tickets/** (sauf quote.ts), src/features/inputs/InputDetailPage.tsx (+ css), src/app/AppLayout.tsx (une ligne) | L0 | opus / high | validé |
| L5 | Repères (front) + Google Agenda (source, présélection, rappel) | controller/sources/{call,upload,calendar}*.ts, controller/{callFlow,calendarMatch,calendarStore}*.ts, controller/sources/desktopDeps.ts, src/features/inputs/uploadMeeting*.ts, src/lib/googleCalendar*.ts | L0 | opus / high | validé |
| L6 | Gmail (source, analyse, ignorer, relance) | controller/sources/gmail*.ts, src/lib/gmail*.ts | L0 | opus / high | validé |
| L7 | Cartes Google Agenda et Gmail de la page Connecteurs | src/features/connectors/** | L0 | sonnet / medium | validé |
| L8 | Branchement final (orchestrateur) : sources/index.ts, desktopDeps des sources L4 / L6, labo, harness.ts | fichiers partagés | L1-L7 | orchestrateur | validé |

## Journal
- 25/11 Exploration (3 agents), questions (2 tours). Correctif à part demandé en cours de route : sous-agents visibles quand Claude les attend (commit 920a892, poussé).
- 25/11 L0 posé par l'orchestrateur (autre session prévenue).
- 25/11 L1 à L7 lancés en parallèle (harness : ligne 0011 ajoutée par l'orchestrateur, fichier vide en attendant L1).
- 25/11 L7 validé (cartes Google ; textes passés au vouvoiement comme le reste de la page ; `showState` remplace le `c.id === 'vercel'` codé en dur).
- 25/11 L4 validé (source ticketReview réutilisant review/diff + save ; coordinateur : l'overlay review se met de côté devant une interruption puis revient ; ?ticket= ; useIslandReviewSync ; étoiles écran de validation, onglet Tickets, fiche de l'entrée). Orchestrateur : tests du catalogue et de la source analyse mis à jour (« Valider ici »), tests des nouvelles sortes ajoutés.
- 25/11 L5 validé (repères front, Google Agenda, présélection, rappel). Orchestrateur : `forceRefresh` ajouté au contrat de googleAccessToken (L2 et L6 prévenus) et nouvel essai avec jeton neuf après un 401 de l'agenda.
- 25/11 L1 validé (migration, RLS, API, analyse, from_marker serveur). L2 validé (raccourci, repères, OAuth Google, forceRefresh, build et CI ; Windows seulement). L3 validé (état review, 2e bouton, Marquer, étoile, raison) ; orchestrateur : tokens --island-type-* et --island-duration-mark-flash, nom de la personne jamais coupé par le bandeau du refus. L6 validé (Gmail).
- 25/11 L8 : sources branchées, labo, vérification au labo (Windows et Mac avec encoche). Session redémarrée pendant l'application de la migration (rien appliqué) ; entre-temps Sacha a poussé 0010 à 0021 : migration renumérotée 0024, commit préparé dans un worktree à partir d'origin/main avec seulement les morceaux de ce ticket (la session des notifications garde son travail dans l'arbre principal), conflits résolus avec l'état `choice` et la page Connecteurs (MCP) de l'amont, 0024 appliquée en production et notée dans sordulo_meta.

## Rapport
**Fait** : les quatre parties du ticket.
- Validation des tickets dans l'île : « Valider ici » (2e bouton « Ouvrir »), état `review` un ticket à la fois avec clavier, Tout valider, Modifier dans l'app (`?ticket=`), Annuler un refus, relecture toutes les 4 s, fenêtre principale rafraîchie ; enregistrement par `review/diff.ts` + `review/save.ts`.
- Moments marqués : raccourci global Ctrl+Alt+M / Ctrl+Cmd+M pendant l'enregistrement, « Marquer » et « Annuler » 5 s, étoile et compteur (aussi île fermée), repères dans le MP3 puis `inputs.markers`, passages ±30 s signalés à Claude, `tickets.from_marker` posé par le serveur, étoile dans l'île, l'écran de validation, l'onglet Tickets et la fiche de l'entrée (repères dans la transcription).
- Google Agenda : carte, OAuth PKCE par Rust, présélection du projet avec la raison, titre de l'entrée, rappel 5 min avant une visio.
- Gmail : carte, mails des contacts clients, Analyser / Ignorer, entrée écrite (corps nettoyé, PDF / Word), dédoublonnage par Message-ID, une seule relance regroupée.
- À côté : sous-agents d'arrière-plan visibles quand Claude les attend (commit 920a892).

**Vérifications** : typecheck, lint, 2249 tests (dont RLS 0024), build, `cargo test --lib` 233 sur Windows ; labo vérifié en Windows et Mac avec encoche.

**Décisions prises sans demander** : voir Décisions ; en plus : migration 0024 ; `forceRefresh` au contrat ; flèches bornées aux bouts ; textes des cartes Google au vouvoiement (comme la page) ; `--duration-highlight` repris de la session des notifications (surbrillance du ticket) ; un PDF de plus de 100 000 caractères est sauté (pas coupé).

**À faire** :
- Maël : créer l'app Google de l'agence dans Google Cloud (client « Application de bureau », API Google Calendar et Gmail activées, écran de consentement Externe en mode Test avec les comptes testeurs, scopes openid, email, calendar.readonly, gmail.readonly), mettre `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` dans `.env.local` et dans les secrets GitHub ; tant que ce n'est pas fait, les cartes disent « Indisponible dans cette version ».
- Maël : essayer sur Windows un vrai appel (raccourci, Marquer, analyse avec étoiles), la validation dans l'île avec de vraies données, Agenda et Gmail avec un vrai compte.
- Sacha : compiler et tester sur Mac (Ctrl+Cmd+M, sur AZERTY la touche M est prise aussi sous sa position QWERTY « ; » ; connexion Google), et regarder les styles non couverts par le Figma : badge « ★ Moment marqué », répliques à ±30 s sur `--color-warning-soft`, état review de l'île.
- Session des notifications : renuméroter sa migration (0022 / 0023, en cours) et reprendre ses ajouts aux fichiers partagés après ce push.

**Idées non retenues** : aucune (les quatre proposées ont été gardées, la relance des mails selon la règle de Maël).
