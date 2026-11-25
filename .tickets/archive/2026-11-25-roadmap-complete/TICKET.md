# Roadmap complète (interne V0 à V2) + rangement automatique des fichiers déposés sur l'île

## Ticket d'origine
« Je voudrais que tu me développes toute la roadmap de sordulo OS. Donc toutes les fonctionnalités. Je voudrais aussi que tu me développes le fait que quand on met un fichier dans l'île, l'IA détecte quel type de fichier et peut le ranger automatiquement. Il nous demande de vérifier. Par exemple, je passe un devis, une facture du projet Pdos d'ibé Je voudrais qu'il détecte automatiquement de quel projet il s'agit, de quel objet il s'agit, de quel client il s'agit, etc., etc. Comme ça, après, il se range automatiquement. On nous le dit. Ça va voir si on fait valider dans l'île ou ça ouvre l'application AutoMedia. Voilà, tu peux rajouter des fonctionnalités que tu penses nécessaires. Vas-y, développe-le. » (Sacha, 25/11/2026)

Référence : roadmap PDF « Sordulo OS · Roadmap » (17/11/2026, Maël), V0 à V3. Contrat d'apporteur d'affaires de Gabriela (04/11/2026) pour les commissions : pas versionné (données réelles), seules les règles sont reprises ici.

## Contexte
Déjà fait (inventaire du 25/11) : clients, contacts, projets (tone of voice + presets, ai_instructions), devis, factures, émetteurs, prospection simple (étapes, prochaine action, conversion), équipe (compétences design/dev, capacité, jours indisponibles), accueil à cartes, entrées → tickets → tâches avec validation, kanban, notetaker de bureau, île (musique, Spotify, Vercel, Claude Code), attribution par compétence et charge.
L'île sait déjà recevoir un fichier : zones Transcrire (audio), Analyser (document → retour écrit), Claude Code ; une zone « Fichiers » existe mais est masquée (`zonesFor` dans `island/drop/logic.ts`). Le projet est aujourd'hui le dernier utilisé, sans détection.
Cadrage design : niveau 0 (réponse de Sacha). Les écrans reprennent les modèles existants (tableau `dataTable`, fiche, onglets du projet, ListToolbar) ; l'île reprend le modèle de « Transcrire cet appel ? ».

## Décisions
- Périmètre : tout l'interne V0 à V2. Les services externes (Yousign, Stripe, Gmail, Google Calendar, GitHub, plateforme agréée de facture électronique) deviennent des connecteurs « Bientôt ». Hors périmètre : V3 (multi-organisation activée, onboarding + abonnement, app mobile). (Sacha)
- Validation du rangement : dans l'île si l'IA est sûre (confiance ≥ 0,75 et projet non ambigu) avec Ranger / Modifier ; sinon, ou sur Modifier, l'app s'ouvre sur l'écran de rangement (`/files/intake/:intakeId`, par `open_main_at`). (Sacha)
- Devis / facture déposé : rangé dans Fichiers › Devis (ou Factures) du projet ; si son numéro correspond à un devis ou une facture de l'app, le fichier y est relié ; sinon l'app propose de le créer comme document importé (numéro d'origine gardé). (Sacha)
- Ajouts retenus : « Toujours » + annuler (règle de rangement par client et type, chaque rangement s'annule depuis la notification) ; doublons (empreinte SHA-256) et versions (résumé de ce qui change) ; dépôt aussi dans l'app web ; plusieurs fichiers d'un coup (validation en lot). (Sacha)
- Stockage : Supabase Storage, bucket privé `files`. (Sacha)
- Commission de l'apporteur : règles du contrat (barème par tranches sur l'encaissé du premier devis signé : 0 à 3 000 € 12 %, 3 000 à 10 000 € 10 %, au-delà 8 % ; hors frais refacturés ; 5 % sur les devis suivants signés dans les 12 mois suivant le premier ; client apporté = enregistré par l'apporteur, qui signe dans les 6 mois ; due à l'encaissement, payée par celui qui a encaissé ; remboursement = déduite). Barème saisi dans l'app (par apporteur), jamais en dur dans le code ni dans git. (Sacha + contrat)
- Prospect qui s'oppose à tout nouveau contact : case « Ne plus contacter » (RGPD, contrat art. 09). (contrat)
- Répartition entre associés : toujours 50/50 sur une mission commune. (Sacha)
- Vercel offre gratuite (12 fonctions) : toute la nouvelle API tient en 3 fonctions : `api/ai/run.ts` (toutes les actions IA, routeur par `action`), `api/portal.ts` (portail client public), `api/mcp.ts` (serveur MCP). (Sacha)
- Migrations : écrites et testées (PGlite), PAS appliquées en production ; Sacha les applique par `npm run db:migrate` avant de pousser. (Sacha)
- Commits sur `main`, un par grande partie, sans push. (Sacha)
- Code de Maël (île, page projet) : on y touche, chaque fichier touché est listé dans le rapport. Rien dans `src-tauri` sauf indispensable (et alors Windows + macOS). (Sacha)
- Aucun cron Vercel : récap du lundi, relances et seuils sont calculés à l'ouverture de l'app (notification dédupliquée par `dedupe_key`). (choix par défaut : pas de fonction de plus)
- « L'IA propose, vous validez » partout : devis accepté → tickets proposés sur l'écran de validation existant (une entrée « Devis D-… accepté ») ; réorganisation du planning → propositions Valider / Refuser / Toujours. (roadmap)
- Signature des contrats : notée à la main ou par le client sur le portail (nom tapé + case), en attendant Yousign. (choix par défaut, Yousign = externe)
- Relances : brouillon de mail dans le tone of voice du projet, à copier ou ouvrir dans le client mail (`mailto:`), marquée envoyée à la main. (Gmail = externe)
- Seuils micro-entreprise et franchise TVA : valeurs légales en constantes datées dans `src/shared/thresholds.ts`, CA encaissé par émetteur et par année civile. (choix par défaut)
- Pré-audit IA d'un site : page récupérée côté serveur + PageSpeed Insights (API publique, sans clé) ; repli sur l'analyse du HTML seul. (choix par défaut)
- Commandes vocales : bouton micro dans la palette Cmd+K (transcription existante `/api/voice/transcribe`), l'IA traduit en action, confirmation avant d'écrire. Pas de mot d'éveil. (choix par défaut)
- Serveur MCP : HTTP sans état (JSON-RPC « streamable HTTP »), jeton personnel créé dans Connecteurs (haché en base, montré une fois), droits = ceux du membre. (choix par défaut)

## Modèle de données (lot L1)
Migrations 0010 à 0015, rejouables (comme les autres), testées dans `supabase/tests`. Types miroirs dans `src/shared/types.ts`.
- **0010_files** : bucket `files` (privé, 100 Mo) + policies `storage.objects` par organisation (1er segment du chemin = organization_id) ; `project_files` (dossier texte, type, résumé, sha256, versions par `version_group_id` + `version`, `change_summary`, lien `quote_id` / `invoice_id`, `deleted_at` pour annuler) ; `file_intakes` (dépôt en attente : chemin `inbox`, texte extrait, `proposal` jsonb, confiance, statut, `batch_id`, `source` île / web, `filed_file_id`, `auto_filed`) ; `filing_rules` (« Toujours » : client + type → projet / dossier, `revoked_at`).
- **0011_catalog_briefs** : `services` (catalogue : prix, unité, TVA, lignes de devis types, tâches types avec compétence, durée, dépendance) ; `briefs` (brief structuré d'une entrée, devis brouillon créé) ; `projects` + `feedback_rounds_included`, `showcase` (unknown / showable / nda), `case_study` jsonb, `portal_token` ; `inputs.quote_id` ; RPC `propose_tasks_from_quote`.
- **0012_work** : `tasks.due_date`, `tasks.priority` ; `time_entries` (minuteur, un seul en cours par membre) ; `member_absences` (école, congé) ; `members.affinities` ; compétences ouvertes (toute clé, niveau 0 à 5) ; `commission_plans` (barème par apporteur, admin + l'intéressé).
- **0013_notifications_ai** : `notifications` (destinataire, lien, `dedupe_key`, `read_at`, Realtime) + RPC `create_notification` + déclencheurs des passages de main ; `ai_proposals` + `ai_autonomy_rules` (« Toujours ») + RPC `apply_ai_proposal` / `undo_ai_proposal` ; `followups` (relances).
- **0014_prospection** : `prospects` + `registered_at`, pré-audit (`audit`, `audit_status`), audit humain, offre (`recommended_service_id`), `pitch`, `lost_reason`, `do_not_contact`, étapes `to_audit` et `offer_ready` ; apporteur limité à ses prospects ; `commissions` calculées par la base au paiement d'une facture (barème cumulatif, avoirs déduits).
- **0015_contracts_deliverables** : `contracts` ; `deliverables`, `deliverable_versions`, `deliverable_comments` (épingles x / y sur l'image, auteur membre ou client) ; `api_tokens` (MCP).

## Hors périmètre
- V3 : multi-organisation activée (sélecteur, création), onboarding + abonnement Stripe, app mobile, notifications mobiles.
- Intégrations réelles Yousign, Stripe, Gmail, Google Calendar, GitHub, plateforme de facture électronique (cartes « Bientôt »).
- Envoi d'emails par l'app (les relances sont des brouillons).
- Mot d'éveil « OK Sordulo ».

## Critères d'acceptation
- [x] Déposer un ou plusieurs fichiers sur l'île : chaque fichier est envoyé, classé par l'IA (type, client, projet, dossier, numéro), et l'île propose « Ranger » quand elle est sûre ; sinon l'app s'ouvre sur l'écran de rangement.
- [x] Un devis / une facture dont le numéro existe est relié au document de l'app ; sinon proposition d'import.
- [x] Doublon signalé ; nouvelle version d'un fichier détectée avec résumé des changements.
- [x] « Toujours » range seul la fois suivante ; chaque rangement s'annule depuis la notification.
- [x] Même rangement depuis l'app web (bouton « Déposer un fichier »).
- [x] Onglet Fichiers du projet : dossiers, envoi, aperçu (image, PDF), versions, corbeille.
- [x] Catalogue de prestations utilisable dans le devis ; devis accepté → tickets proposés.
- [x] Entrée → brief structuré → brouillon de devis.
- [x] Mes tâches (toutes les miennes, par échéance), échéance et priorité sur les tâches, suivi du temps.
- [x] Profils : compétences ouvertes avec niveau, affinités, absences ; l'attribution en tient compte.
- [x] Prospection : pré-audit IA, audit, offre du catalogue, argumentaire, raison de refus, ne plus contacter, commissions ; l'apporteur ne voit que ses prospects et ses commissions.
- [x] Notifications in-app (cloche) et dans l'île ; propositions IA Valider / Refuser / Toujours, annulables.
- [x] Finance : CA, encaissements, seuils, répartition 50/50 ; relances (brouillons) ; récap du lundi ; accueil complété (tâches du jour, CA du mois).
- [x] Rounds de retours comptés avec alerte de dépassement.
- [x] Contrats depuis un devis, signature notée ; portail client par lien (avancement, livrables, commentaires sur image, validation, acceptation de devis, signature simple).
- [x] Droits de diffusion + étude de cas proposée à la clôture.
- [x] Recherche Cmd+K + commandes vocales.
- [x] Serveur MCP avec jeton personnel.
- [x] Connecteurs « Bientôt » pour les services externes.
- [x] typecheck, lint, tests (RLS compris), build OK.

## Lots
| Lot | Objectif | Fichiers possédés | Dépend de | Modèle / effort | Statut |
|---|---|---|---|---|---|
| L1 | Modèle de données 0010-0015 + types + tests RLS + logique commission | supabase/**, src/shared/types.ts, src/shared/commission*.ts | - | opus / high | validé |
| L2 | Palette Cmd+K (recherche globale, sources extensibles) | src/features/search/** | - | sonnet / medium | validé |
| L0 | Routeur IA `api/ai/run.ts` + squelette des actions | api/ai/run.ts, api/_lib/ai/** (squelette), src/lib/ai.ts | - | orchestrateur | validé |
| L5 | Rangement : action `classify`, lib client de dépôt, règles, annuler, doublons, versions | api/_lib/ai/actions/classify.ts, api/_lib/files/**, src/lib/filing*.ts, src/shared/filing*.ts | L1, L0 | opus / high | validé |
| L5b | Fichiers (web) : onglet du projet, écran de rangement, dépôt web | src/features/files/** | L5 | sonnet / medium | validé |
| L6 | Île : zone Fichiers, plusieurs fichiers, proposition Ranger / Modifier, Toujours, annuler, notifications de la base | src/features/island/** | L5 | opus / high | validé |
| L7 | Catalogue + devis (insertion, frais refacturés) + devis accepté → tickets | src/features/catalog/**, src/features/quotes/**, src/features/billing/** | L1 | sonnet / medium | validé |
| L8 | Entrée → brief → devis | src/features/briefs/**, src/features/inputs/**, api/_lib/ai/actions/{brief,quoteDraft}.ts | L1, L0 | sonnet / medium | validé |
| L9 | Tâches : mes tâches, échéance, priorité, temps, rounds | src/features/tasks/**, src/features/my-tasks/**, src/features/time/**, src/features/rounds/** | L1 | sonnet / medium | validé |
| L9b | Équipe : profils, absences, affinités, barème apporteur ; attribution | src/features/team/**, src/shared/assignment*.ts | L1 | sonnet / medium | validé |
| L10 | Prospection : pré-audit, audit, offre, argumentaire, commissions | src/features/prospects/**, src/features/commissions/**, api/_lib/ai/actions/{prospectAudit,pitch}.ts | L1, L0 | sonnet / high | validé |
| L11 | Notifications (cloche) + propositions IA + réorganisation | src/features/notifications/**, src/features/proposals/**, api/_lib/ai/actions/replan.ts, src/shared/replan*.ts | L1, L0 | opus / high | validé |
| L12 | Finance, seuils, 50/50, relances, récap du lundi, accueil | src/features/finance/**, src/features/followups/**, src/features/recap/**, src/features/home/**, src/shared/thresholds*.ts, src/shared/revenueSplit*.ts, api/_lib/ai/actions/followupDraft.ts | L1, L0 | sonnet / medium | validé |
| L13 | Contrats + diffusion / étude de cas | src/features/contracts/**, src/features/showcase/**, api/_lib/ai/actions/{contractDraft,caseStudy}.ts | L1, L0 | sonnet / medium | validé |
| L13b | Livrables + portail client | src/features/deliverables/**, src/features/portal/**, api/portal.ts, api/_lib/portal/** | L1 | opus / medium | validé |
| L14 | Serveur MCP + jetons + commandes vocales + connecteurs « Bientôt » | api/mcp.ts, api/_lib/mcp/**, src/features/connectors/**, src/features/voice/**, api/_lib/ai/actions/voiceCommand.ts | L1, L0, L2 | opus / medium | validé |
| INT | Routes, barre latérale, onglets du projet, rôles, montage des composants, CLAUDE.md | src/app/**, src/features/projects/ProjectPage.tsx, src/features/auth/roles.ts, CLAUDE.md | tous | orchestrateur | à faire |

## Journal
- 25/11 nuit : questions posées (2 tours + contrat de l'apporteur), ticket écrit.
- 25/11 01:30 L1 (opus) et L2 (sonnet) lancés.
- 25/11 01:40 L0 fait par l'orchestrateur : `src/shared/ai-actions.ts` (liste des actions), `api/ai/run.ts` (routeur, test), `api/_lib/ai/{types,registry}.ts`, une action squelette par nom (501), `src/lib/ai.ts` (`runAi`), `post` exporté de `src/lib/api.ts`, `callClaudeStructured` accepte des blocs (image / PDF).
- 25/11 01:45 L2 validé (lint, 14 tests, aucune valeur en dur). À brancher : `<CommandPalette />` dans AppLayout, `?nouveau=1` sur /projects, route /my-tasks.
- 25/11 02:15 L1 validé : migrations 0010-0015 (3 792 lignes), types, commission.ts, 6 fichiers de tests SQL ; typecheck, lint, 98 fichiers / 1 208 tests OK. Écarts acceptés : le rôle membre voit la Prospection (roles.ts à ouvrir), apporteur plus strict, taux en %, versions numérotées par la base, une règle Toujours par client + type. Doublon possible de la notification d'attribution dans l'île (à régler en L6).
- 25/11 02:20 Phase B lancée : L5, L7, L8, L9, L9b, L10, L11, L12, L13, L13b, L14.
- 25/11 L8 validé : actions brief et quoteDraft (prix repris du catalogue, devis brouillon par la clé service compatible avec tg_quote_guard), BriefPanel monté sur la fiche d'une entrée ; 31 tests.
- 25/11 L9b validé : compétences ouvertes, affinités, absences, barème de l'apporteur (vide), MyAbsences ; attribution par niveau / absences / affinités, chargées dans pipeline.ts et revision.ts ; 187 tests. Orchestrateur : 3 valeurs rem en dur remplacées par des tokens.
- 25/11 L7 validé : page Catalogue, « Ajouter depuis le catalogue », case Refacturé (LinesEditor), propose_tasks_from_quote à l'acceptation + bouton ; source Cmd+K Prestations ; 44 tests. Une seule ligne par prestation porte service_id (un ticket par prestation). Reste : lien vers la validation affiché à un utilisateur finance qui n'y a pas accès.
- 25/11 L9 validé : échéance et priorité au kanban (+ filtres), Mes tâches, minuteur / saisie / onglet Temps, FeedbackRounds, champs rounds et diffusion dans la fiche projet ; 68 tests. Orchestrateur : libellés de diffusion de types.ts alignés (À définir / Montrable / Sous NDA). Limite : pas de date de fin des tâches (tri des tâches faites par création).
- 25/11 L13 validé : contrats (liste, onglet projet, création IA depuis un devis accepté avec prix repris par le code, éditeur, statuts, PDF signé, aperçu A4, source Cmd+K), ShowcaseCard + étude de cas contrôlée (chiffres et citations vérifiés) ; 26 tests.
- 25/11 L12 validé : /finance (CA, encaissements, impayés, seuils par émetteur, 50/50), relances (followupDraft + FollowupsPanel), /recap + notification du lundi, cartes d'accueil ; 80 tests. Orchestrateur : seuils 2026 vérifiés (TVA 37 500 / 41 250 € sur impots.gouv.fr ; plafond micro services 83 600 € sur legifiscal.fr, à recouper sur service-public.fr), `verified: true`.
- 25/11 Orchestrateur : migration 0016_task_done_at (date de fin posée par la base, test SQL), done_at dans le type Task (optionnel), récap et Mes tâches s'en servent (repli sur le temps saisi pour les tâches finies avant 0016).
- 25/11 L10 validé : prospectAudit (SSRF : DNS résolu une fois, adresses privées refusées, redirections revérifiées ; PageSpeed toléré), pitch, écrans prospection (étapes, audit, offre, argumentaire, refus, ne plus contacter, rappel), /commissions ; 179 tests.
- 25/11 Orchestrateur : migration 0017_convert_prospect_project : convert_prospect(uuid, text) ouverte au membre, apporteur limité à SES prospects (0004 lui ouvrait toute l'org), crée aussi le projet (statut prospect) ; tests SQL ; écran : conversion proposée au membre, « Client et projet créés ».
- 25/11 L11 validé : NotificationBell (Realtime, clavier), /notifications, /proposals (Valider / Refuser / Toujours / Annuler, règles), replan (analyse déterministe src/shared/replan.ts + Claude limité aux candidats) ; 53 tests.
- 25/11 L5 validé : classify (contexte org, fichier non fiable, rapprochement exact des numéros, doublon sha256, version + résumé, règle Toujours qui range seule), src/lib/filing.ts (startBatch, fileIntake, undoFiling = corbeille, cancel), src/shared/filing.ts ; 70 tests. Mode import en 501 faute de RPC d'import serveur.
- 25/11 L14 validé : api/mcp.ts (12e fonction, JSON-RPC sans état, jetons sha256, droits par rôle), jetons dans Connecteurs, connecteurs Bientôt (Yousign, GitHub, Facture électronique…), transcribe sans projectId, VoiceCommandButton + voiceCommand ; 92 tests. Orchestrateur : 4 tests reformatés par un prettier par défaut remis au style du projet.
- 25/11 L13b validé : livrables (versions, épingles), PortalShareCard, api/portal.ts (11e fonction : jeton vérifié avant requête, brouillons jamais exposés, objets du projet seulement, débit limité), PortalPage publique ; 42 tests.
- 25/11 L5b et L6 lancés.
- 25/11 Orchestrateur : migration 0018_import_document_from_file (RPC réservée au service_role, numéro d'origine gardé, test SQL) ; L5c lancé (mode import de classify).
- 25/11 INT (partiel) : routes (/my-tasks, /proposals, /notifications, /catalog, /contracts(+print), /recap, /finance, /commissions, /connectors pour tous, /p/:token public), onglets du projet (Livrables, Contrats, Temps, Partage = PortalShareCard + ShowcaseCard ; Fichiers en attente de L5b), FeedbackRounds dans l'en-tête, barre latérale (16 entrées, défilante, « Mes sites » / « Mes commissions » pour l'apporteur, bouton Rechercher), cloche au-dessus du compte, minuteur flottant, palette + bouton vocal, récap du lundi, sources Cmd+K Prestations et Contrats, « Mes absences » et « Récap » dans le menu du compte, PROSPECT_ROLES + membre, COMMISSION_ROLES, ?nouveau=1 sur /projects, lien de validation masqué pour finance. 6 icônes ajoutées (check-square, pen-file, chart, package, percent, upload) au style des existantes.
- 25/11 L5c validé : mode import de classify (lignes extraites par Claude, validées par billing.ts, RPC 0018, fichier relié, avertissement d'écart de total) ; 46 tests. Orchestrateur : champ `warning` facultatif dans ImportFromIntakeResponse.
- 25/11 L5b validé : onglet Fichiers (dossiers, doublons et versions à l'envoi, aperçu, historique, corbeille), FileIntakePage, FileInboxPage (Tout ranger), FileDropDialog, source Cmd+K Fichiers ; 24 tests. Branché : onglet files, /files/intake/:id, /files/inbox, bouton « Déposer un fichier » dans la barre latérale.
- 25/11 Orchestrateur : CLAUDE.md (fonctionnalités, écrans, rôles, 12 fonctions Vercel, rangement, seuils, hors périmètre, migrations à appliquer) et supabase/README.md mis à jour ; revue de sécurité indépendante (opus) lancée.
- 25/11 Revue de sécurité (opus, lecture seule) : aucune fuite entre organisations, portail et MCP sains, SSRF solide. 5 failles entre rôles : (1) un membre peut faire recracher devis / factures via un dépôt piégé, (2) un membre lit les prix via un contrat, (3) un membre peut détourner une commission (owner / registered_at), (4) la finance crée des tickets par propose_tasks_from_quote, (5) fausses notifications. L15 (opus) lancé : migration 0019 + correctifs serveur ; (4) accepté tel quel (la finance accepte les devis, les tickets restent à valider). Orchestrateur : contrats réservés à admin / finance dans l'interface (routes, barre latérale, onglet du projet, source Cmd+K, CLAUDE.md).
- 25/11 L6 validé : zone Ranger (plusieurs fichiers), état `choice` (décision dans l'île, mise de côté après 20 s), Tout ranger / Vérifier / À vérifier, Annuler, notifications de la base dans l'île sans doublon, labo (7 cas de rangement + 8 notifications) vérifié dans Chrome en « Mac avec encoche » (rien sous l'encoche) ; 558 tests île. Front seulement, même code Windows et macOS, aucun Rust. CLAUDE.md complété.
- 25/11 L15 validé : migration 0019_security_hardening (contrats et fichiers de devis / factures réservés à admin et finance, responsable et date d'enregistrement d'un prospect réservés à l'admin et figés après conversion, create_notification limitée, member_ids des propositions contrôlés, chemins Storage imposés), classify sans devis / factures pour un membre, contractDraft admin / finance, pré-audit de l'apporteur limité, lots MCP ≤ 20 et corps ≤ 1 Mo ; 1 909 tests. Orchestrateur : fichiers de contrat ajoutés aux fichiers réservés (+ test), champ Responsable réservé à l'admin et figé après conversion, safeFileName des contrats, message 42501 explicite dans filing.ts.
- 25/11 Vérification réelle : base Supabase jetable locale (scratchpad, ports 56521-56524, projet sordulo_os_local, à côté de celle de PDS_OS qui n'a pas été touchée) : les migrations 0001 à 0019 passent sur un vrai Postgres Supabase (0019 rejouée deux fois). Données de démo et 3 comptes de test (admin x2, apporteuse).
- 25/11 matin, Sacha réveillé : comptes de test donnés ; navigation refaite d'après le Figma « SORDULO-OS » 88:3236 (barre dépliée 218 px, groupe du haut + sections repliables Ton espace / Entreprise / Finance / Agence, Rechercher ⌘K et Déposer un fichier en tête, mode replié en icônes sans logo (demande de Sacha), pied Compte + cloche ronde à pastille bleue, fondu au-dessus du pied ; préférences gardées en localStorage ; icônes de la maquette téléchargées dans src/assets/nav (Sacha les aime) ; tokens ajoutés : --size-sidebar-expanded, --size-nav-item, --size-brand-mark, --size-icon-sm, --size-notification-dot, --color-notification-dot). Erreur HTML corrigée (div dans un p de l'en-tête du projet).
- 25/11 Nouvelles pages demandées par Sacha (questions posées) : Réseau = partenaires (freelances, sous-traitants…), Notes rattachées (projet / client, perso ou équipe), Fichiers de toute l'agence, Email (écran + Bientôt, Gmail = externe). L16 (opus : 0020 partners / notes + écrans) et L17 (sonnet : /files et /email) lancés.
- 25/11 L17 validé : /files (tous les fichiers, filtres, aperçu, dépôts en attente) et /email (écran Bientôt + relances + coller un mail client) ; 17 tests ; branchés (Email dans « Ton espace », Fichiers et Réseau dans « Entreprise », Notes dans « Ton espace » ; routes /notes et /partners à venir avec L16).
- 25/11 L16 validé : 0020 partners / notes (RLS : réseau admin, membre, finance ; notes perso ou équipe), Réseau (/partners, fiche, projets liés), Notes (/notes + onglet du projet, enregistrement auto) ; 37 tests. Branchés + sources Cmd+K ; données fictives ajoutées en local.
- 25/11 Validation finale : typecheck, lint, npm test (154 fichiers, 1 963 tests dont RLS), build : OK. Parcours dans Chrome sur la base jetable : toutes les pages se chargent sans erreur (script sur 21 routes), écrans vérifiés à l'œil (accueil, finance, commissions, prospect, livrables, portail public, réseau, notes, barre dépliée / repliée).

## Rapport

**Fait.** Toute la roadmap interne V0 à V2 et le rangement automatique des fichiers déposés sur l'île :
- Rangement : dépôt d'un ou plusieurs fichiers sur l'île (zone Ranger) ou dans l'app ; Claude reconnaît type, client, projet, dossier, numéro ; numéro rapproché exactement des devis / factures ; doublon (SHA-256) et nouvelle version (résumé des changements) ; validation dans l'île si sûr, sinon écran de rangement ; « Toujours » ; annulation ; import d'un devis / d'une facture d'un autre outil (numéro gardé).
- V0 : fichiers par projet, catalogue + insertion dans le devis + devis accepté → tickets proposés, entrée → brief → brouillon de devis, mes tâches, échéance / priorité, profils (compétences ouvertes, affinités, absences), prospection complète (pré-audit IA avec protection SSRF, audit, offre, argumentaire, refus, ne plus contacter), commissions selon le contrat de l'apporteur, notifications in-app, accueil complété.
- V1 : contrats (signature notée ou sur le portail), suivi du temps, rounds de retours, relances (brouillons), finance (CA, seuils micro / TVA vérifiés, 50/50), récap du lundi, Cmd+K, propositions IA Valider / Refuser / Toujours / Annuler, connecteurs « Bientôt ».
- V2 : réorganisation du planning par l'IA, portail client, livrables (versions, épingles), diffusion + étude de cas, serveur MCP (jeton personnel), commandes vocales, notifications de la base dans l'île.
- Ajouts du matin (Sacha) : barre latérale du Figma 88:3236, Réseau de partenaires, Notes, Fichiers de l'agence, Email (écran, Gmail à venir).

**Migrations à appliquer en production, dans l'ordre, AVANT de pousser** : 0010 à 0020 (`npm run db:migrate`). Toutes passent sur un vrai Postgres Supabase (base jetable locale) et dans PGlite (deux fois chacune).

**Vérifications.** typecheck, lint, 1 963 tests (dont tous les tests RLS), build ; revue de sécurité indépendante (5 failles entre rôles corrigées par 0019, aucune fuite entre organisations) ; parcours dans Chrome sur une base locale remplie de données fictives. Aucun Rust modifié : l'île est du front (même code Windows et macOS) ; rien à compiler côté Tauri.

**Décisions prises sans demander** (détail dans le Journal) : 12 fonctions Vercel sur 12 (IA par un routeur unique) ; aucun cron (récap, relances, seuils à l'ouverture de l'app) ; propose_tasks_from_quote ouvert à la finance ; contrats et fichiers de devis / factures / contrats réservés à admin et finance ; Connecteurs ouverts à tous les rôles ; onglet Partage du projet (portail + diffusion) ; minuteur flottant en bas à droite ; seuils 2026 vérifiés sur sources (plafond micro 83 600 € à recouper sur service-public.fr) ; date de fin des tâches (0016) ; conversion d'un prospect qui crée aussi le projet (0017) ; notes laissées vides non supprimées automatiquement ; notes de l'onglet projet partagées avec l'équipe par défaut.

**Fichiers de Maël touchés (à lui signaler)** : `src/features/island/**` (zone Ranger, état `choice`, sources rangement et notifications, labo), `src/features/projects/ProjectPage.tsx` (onglets, compteur de retours), `src/app/AppLayout.tsx` (nouvelle barre). Rien dans `src-tauri/`.

**Reste / hors périmètre.** Intégrations réelles Stripe, Gmail, Google Agenda, Yousign, GitHub, facture électronique ; V3 (multi-organisation activée, onboarding, abonnement, app mobile) ; envoi de mails par l'app. À valider par Sacha côté design : écrans non couverts par le Figma (portail, visionneuse, décision dans l'île, catalogue, finance…), icônes ajoutées au style des existantes (check-square, pen-file, chart, package, percent, upload), tokens ajoutés (barre latérale, pastille de notification). À vérifier à la main : un vrai dépôt sur l'île (Windows et Mac), une vraie analyse Claude d'un PDF de devis, PageSpeed sur un vrai site.

**Idées non retenues.** Animation du repli de la barre latérale (geste fréquent) ; suppression auto des notes vides ; masquer les `file.ready` des dépôts web dans l'île ; retenir les propositions IA pendant un appel en mode concentration.
