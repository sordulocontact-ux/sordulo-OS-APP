# Note à l'IA sur l'écran de validation, avec mémoire du projet

## Ticket d'origine
Écran de validation des tickets (/projects/:id/inputs/:inputId/review) : ajouter, à côté de « Tout valider », un bouton micro (et/ou saisie texte) pour laisser une note à l'IA avant de valider. La note sert à modifier les tickets proposés (contenu, regroupement…) et/ou leur attribution : par exemple Maël a l'habitude de certaines pages, Sacha d'autres, donc la note permet de réorganiser qui fait quel ticket. Ces préférences doivent être gardées en mémoire pour les prochains tickets du même projet (prochaines analyses et attributions automatiques).

## Contexte
- Analyse : `api/_lib/analysis.ts` (Claude, sortie structurée `AnalysisSchema`, repli Mistral), pipeline `api/_lib/pipeline.ts` (insère les tickets « proposés » + 1 tâche par ticket).
- Attribution faite par le code (`src/shared/assignment.ts`, `pickTicketAssignee`) : charge relative + bonus d'habitude par partie. Raison dans `tickets.assignment_note`.
- Écran de validation : `src/features/review/` (brouillons locaux, `planSave`, « Tout valider »).
- Transcription Deepgram depuis une URL (`api/_lib/transcription.ts`). Aucun enregistrement micro dans le navigateur jusqu'ici.
- Ton de voix du projet déjà passé à l'analyse (`projects.tone_of_voice`, formulaire `ProjectFormModal`).

## Décisions
- Mémoire = nouvelle colonne `projects.ai_instructions` (texte, 4000 car. max), migration 0007 (source : réponse utilisateur « champ dans le projet »).
- Champ « Consignes pour l'IA » dans le formulaire du projet, à côté du ton de voix (réponse utilisateur).
- Micro : la voix est transcrite dans une zone de texte modifiable, puis « Appliquer ». Saisie au clavier possible (réponse utilisateur).
- Idées retenues : encart « Ce que l'IA retient pour ce projet » sur l'écran de validation + raison d'attribution « Consigne du projet : … » ; les modifications non enregistrées sont envoyées à l'IA et rien n'est perdu (réponse utilisateur).
- Idées non retenues : chrono et limite 3 min (une limite technique de 10 min reste, pour les 4,5 Mo de Vercel), annuler la dernière note.
- La note peut tout changer sur les tickets proposés : contenu, fusion, découpage, suppression, attribution (source : ticket « contenu, regroupement »).
- L'attribution choisie par la mémoire passe par l'IA (`assignee_member_id` dans la sortie, validé contre les candidats) ; sinon le calcul de charge actuel (choix par défaut).
- Révision synchrone (Claude, ~10-30 s), sans repli Mistral (choix par défaut, l'analyse garde son repli).
- Transcription de la note : audio brut envoyé à `/api/voice/transcribe` (pas de stockage), Deepgram nova-3 fr (choix par défaut).
- Livraison : migration appliquée en production par le MCP Supabase, puis commit et push sur `main` (réponse utilisateur).

## Hors périmètre
- Annuler une note, historique des notes.
- Note à l'IA sur les tickets déjà validés.
- Note vocale dans l'île de l'app de bureau.

## Critères d'acceptation
- [x] Bouton « Note à l'IA » (icône micro) à côté de « Tout valider ».
- [x] Fenêtre : zone de texte + enregistrement micro transcrit dans la zone, puis « Appliquer ».
- [x] La note modifie les tickets proposés (contenu, regroupement, attribution), modifications locales non enregistrées comprises.
- [x] La mémoire du projet est mise à jour avec les préférences durables et affichée sur l'écran de validation.
- [x] Champ « Consignes pour l'IA » dans le formulaire du projet.
- [x] Les analyses suivantes du projet suivent la mémoire (rédaction et attribution, raison « Consigne du projet : … »).
- [x] États chargement / erreur / micro refusé gérés ; textes en français ; tokens seulement.
- [x] typecheck, lint, tests, build OK ; migration appliquée en production ; push sur main.

## Lots
| Lot | Objectif | Fichiers possédés | Dépend de | Modèle / effort | Statut |
|---|---|---|---|---|---|
| L0 | Socle : migration 0007, type `Project.ai_instructions`, contrat d'API | supabase/migrations/0007_*, supabase/tests/harness.ts, src/shared/types.ts, src/shared/api-contract.ts | - | orchestrateur | validé |
| L1 | Serveur : mémoire dans l'analyse et l'attribution, révision des tickets par note (`/api/review/revise`) | src/shared/analysis-schema*, api/_lib/analysis*, api/_lib/analysis-postprocess*, api/_lib/mistral*, api/_lib/pipeline*, api/_lib/revision* (nouveau), api/review/ (nouveau) | L0 | opus / high | validé |
| L2 | Serveur : transcription d'une note vocale (`/api/voice/transcribe`) | api/_lib/transcription*, api/voice/ (nouveau) | L0 | sonnet / medium | validé |
| L3 | Front : bouton, fenêtre de note, micro, encart mémoire, champ du projet | src/features/review/, src/features/projects/ProjectFormModal.tsx, src/features/projects/projectLogic*, src/lib/api.ts | L0 | opus / medium | validé |

## Journal
- L0 fait par l'orchestrateur.
- L1, L2, L3 lancés en parallèle.
- Migration 0007 appliquée en production par le MCP Supabase (transaction), colonne `projects.ai_instructions` vérifiée.
- L2 validé : /api/voice/transcribe (clé TRANSCRIPTION_API_KEY existante, 415/413/422/502), 21 tests.
- L3 validé : bouton, fenêtre AiNoteModal (dictée ajoutée à la fin, note gardée en cas d'erreur), encart mémoire, champ « Consignes pour l'IA ». Le serveur retire « ;codecs=opus » du Content-Type (réponse à la question de L3).
- Constat : des fichiers de `src/features/island/` sont modifiés dans le dossier de travail par une autre session (hors de ce ticket) : non touchés, non commités.
- L1 validé : règles 17-18 de l'analyse (consignes, attribution par consigne validée contre l'équipe), pipeline (« Consigne du projet : … »), /api/review/revise (révision R1-R6, créations puis mises à jour puis suppressions, 2e contrôle de traitement en cours après Claude). Correction de l'orchestrateur : une mémoire vide renvoyée par l'IA n'efface jamais la mémoire existante (test adapté).
- Validation finale : typecheck, lint, build OK ; tests 774/774 après ajout de `ai_instructions` dans la liste des colonnes de `supabase/tests/rls.test.ts`.
- Demande annexe de l'utilisateur (état « patiente : shell en cours » dans l'île) transmise à la session qui travaille sur l'île, à sa demande : hors de ce ticket.

## Rapport
**Fait** : bouton « Note à l'IA » (micro) à côté de « Tout valider » ; fenêtre de note (saisie ou dictée transcrite par Deepgram, ajoutée à la fin, relue avant « Appliquer ») ; `/api/review/revise` applique la note aux tickets proposés (modifier, fusionner, découper, supprimer, réattribuer) à partir de l'état affiché, brouillons compris ; mémoire du projet `projects.ai_instructions` mise à jour avec les préférences durables, affichée dans un encart sur l'écran de validation et modifiable dans le formulaire du projet (« Consignes pour l'IA ») ; chaque nouvelle analyse lit cette mémoire (rédaction, regroupement, attribution « Consigne du projet : … »).

**Fichiers** : migration 0007 ; src/shared (types, api-contract, analysis-schema) ; api/_lib (analysis, analysis-postprocess, mistral, pipeline, transcription, revision) ; api/review/revise.ts ; api/voice/transcribe.ts ; src/features/review (ReviewPage, AiNoteModal, useVoiceRecorder, voiceNote, diff) ; src/features/projects (ProjectFormModal, projectLogic) ; src/lib/api.ts ; tests associés ; supabase/tests (harness, rls).

**Vérifications** : typecheck, lint, 774 tests, build. Migration appliquée en production (MCP Supabase). Pas d'essai dans le navigateur ni d'appel réel à Claude ou Deepgram (l'environnement local pointe sur la base de production).

**Décisions prises sans demander** : révision synchrone sans repli Mistral ; une mémoire vide renvoyée par l'IA n'efface jamais la mémoire existante ; une personne désignée par une consigne reçoit le ticket même si sa capacité hebdo est 0 (demande explicite de l'équipe) ; si l'écran envoie une autre personne que la base, la raison d'attribution est effacée ; plafond technique d'enregistrement 10 min (4 Mo).

**Reste / points d'attention** : pas de transaction sur l'application d'une note (état partiel possible si une écriture échoue) ; `api/_lib/revision.ts` importe `isProcessingInProgress` de la route `api/inputs/process.ts` ; micro dans l'app de bureau à essayer (WebView2 sous Windows, WKWebView sous macOS) ; la fenêtre et l'encart ne sont pas dans le Figma : à signaler à Sacha.

**Idées non retenues** : chrono et limite 3 min, annuler la dernière note.
