# Sordulo OS, MVP du 18 novembre (réunion → tickets → tâches)

## Ticket d'origine
Fichier `ticket-mvp-sordulo-os.md` à la racine du repo (texte complet, non modifié).

## Contexte
Repo vide au départ (LICENSE + ticket). Outil interne de l'agence Sordulo (Maël dev, Sacha design), multi-organisation dès la base.
Parcours visé : entrée (texte collé ou audio) → analyse Claude → tickets proposés avec tâches → validation → kanban attribué.
Socle posé par l'orchestrateur : Vite 8 + React 19 + TS 6 strict, ESLint 10, Vitest, React Router 7, TanStack Query, Supabase JS, zod 4, SDK Anthropic, `@vercel/functions`. Un plugin Vite (`vite-plugin-api.ts`) sert les fonctions `/api` en dev, sans CLI Vercel.

## Décisions
- Stack, Supabase, Vercel, Claude côté serveur, Storage isolé dans un module, tokens CSS, attribution par le code (source : ticket).
- Transcription : **Deepgram** (nova-3, `language=fr`, `diarize=true`, appel synchrone à partir d'une URL signée) (source : réponse de l'utilisateur).
- Supabase : clés + `SUPABASE_DB_URL` dans `.env.local`, migrations et seed appliqués par scripts Node (`npm run db:migrate`, `npm run db:seed`) (source : réponse de l'utilisateur).
- Emails du seed dans `SEED_MAEL_EMAIL` / `SEED_SACHA_EMAIL`, jamais dans git (source : réponse de l'utilisateur).
- Ajouts retenus : relance sans doublons, réattribution manuelle d'une tâche, noms des voix (`inputs.speaker_names`) (source : réponse de l'utilisateur). Ajout refusé : charge par personne.
- Déploiement : l'utilisateur connecte le repo à Vercel. Je fournis `vercel.json` + README de déploiement (source : réponse de l'utilisateur).
- Git : commits par phase directement sur `main` (source : réponse de l'utilisateur).
- TypeScript 6.0 et non 7 : typescript-eslint supporte au plus `<6.1` (choix par défaut).
- Fonctions `/api` : signature Web `export async function POST(request: Request)`. Les fichiers `api/_lib/*` ne sont pas des routes. Les imports relatifs dans `api/` et `src/shared/` finissent en `.js` (ESM Node) (choix par défaut).
- Traitement asynchrone : `/api/inputs/process` répond 202 et continue via `waitUntil` (`@vercel/functions`), `maxDuration` 300 s. Le front interroge la ligne `inputs` toutes les 2 s (polling plutôt que Realtime, plus simple et fiable ce soir) (choix par défaut).
- Les tâches sont créées en même temps que les tickets proposés, déjà attribuées. Le kanban ne montre que les tâches dont le ticket est `validated` ou `done`. Si on change la compétence d'une tâche à la validation, elle est réattribuée par la même fonction partagée `src/shared/assignment.ts` (choix par défaut).
- Validation, refus et kanban passent par le client Supabase avec la RLS. Seuls l'analyse, la transcription et l'URL d'upload passent par `/api` (clés secrètes) (choix par défaut).
- Modèle Claude : `ANTHROPIC_MODEL`, `claude-opus-5-5` par défaut dans `.env.example`. Sortie structurée via `messages.parse` + `zodOutputFormat`, effort `low` pour tenir sous la minute. Refus (`stop_reason: refusal`) → statut `error` avec message. Pas de `fallbacks` serveur, car le modèle est variable (choix par défaut).
- Liaison compte ↔ membre : trigger sur `auth.users` + RPC `claim_membership()` appelée après connexion (cas d'un compte auth déjà existant). Un email inconnu peut se connecter mais ne voit rien (écran « accès non autorisé ») (choix par défaut).
- Glisser-déposer : HTML5 natif + menu de statut accessible au clavier (pas de librairie) (choix par défaut).

## Hors périmètre
Devis, factures, contrats, prospection, catalogue, tableau de bord, fichiers projet hors audio, réorganisation auto des tâches, notifications, design final, charge par personne, R2.

## Critères d'acceptation
- [ ] Maël et Sacha se connectent et voient seulement les données de Sordulo.
- [ ] Coller un retour écrit d'Ibé crée des tickets proposés en moins d'une minute.
- [ ] Sur l'écran de validation, on peut modifier, valider ou refuser chaque ticket, et tout valider d'un coup.
- [ ] Les tâches validées apparaissent dans le kanban, attribuées selon la compétence.
- [ ] Une tâche dev qui dépend d'une tâche design l'indique dans le kanban.
- [ ] Un fichier audio d'environ 5 minutes est transcrit avec les voix séparées, puis analysé.
- [ ] Une erreur de transcription ou d'analyse s'affiche clairement, et on peut relancer.
- [ ] Typecheck, lint et build passent. L'app est déployée sur Vercel.
- [ ] Toutes les valeurs de style viennent du fichier de tokens.

## Lots
| Lot | Objectif | Fichiers possédés | Dépend de | Modèle / effort | Statut |
|---|---|---|---|---|---|
| L0 | Socle : config, tokens, contrat de données, client API, plugin dev /api | package.json, tsconfig*, eslint, vite*, vercel.json, .env.example, src/styles/, src/shared/types.ts, src/shared/api-contract.ts, src/lib/ | - | orchestrateur | validé |
| L1 | Base : migrations SQL, RLS, trigger, bucket, scripts migrate/seed | supabase/, scripts/ | L0 | opus / high | validé |
| L2 | Backend : /api (create, process), auth, storage, Deepgram, Claude, attribution, tests | api/, src/shared/* (sauf types.ts, api-contract.ts) | L0 | opus / high | validé |
| L3 | UI kit + shell + auth + liste projets + page projet (onglets, stubs) | src/components/, src/app/, src/features/auth/, src/features/projects/, src/main.tsx, src/features/*/index stubs | L0 | sonnet / medium | validé |
| L4 | Onglet Entrées : nouvelle entrée texte/audio, upload signé, statut, relance, fiche avec transcription et noms des voix | src/features/inputs/ | L3 | sonnet / medium | validé |
| L5 | Écran de validation + onglet Tickets | src/features/review/, src/features/tickets/ | L3 | sonnet / medium | validé |
| L6 | Onglet Tâches : kanban 4 colonnes, DnD + menu, filtre personne, dépendances, réattribution | src/features/tasks/ | L3 | sonnet / medium | validé |
| L7 | Intégration : README, test bout en bout, corrections | README.md + corrections ciblées | L1–L6 | orchestrateur | à faire |

## Journal
- 11:05 Lecture du ticket, exploration (repo vide), questions posées.
- 11:25 L0 socle validé (typecheck, lint, build OK).
- 11:35 L1 (opus/high), L2 (opus/high), L3 (sonnet/medium) lancés en parallèle.
- 11:50 L3 validé (tsc, eslint, 0 valeur en dur ; ajout token --opacity-disabled, import config .ts). L4, L5, L6 lancés.
- 11:55 L1 validé (46/46 tests RLS sur PGlite, lint OK). Reste : appliquer sur le vrai projet dès que .env.local existe.
- 12:05 L6 validé (eslint OK, 17/17 tests, 0 valeur en dur). .env.local créé (gabarit vide) à la demande de l'utilisateur.
- 12:10 L4 validé (tsc OK sur ses fichiers, eslint OK, 0 valeur en dur). À corriger en intégration : Échap pendant l'upload (Modal du kit).
- 12:15 L5 validé (tsc -b, eslint, 65/65 tests, build OK).
- 12:25 L2 validé (create + format.parse au lieu de messages.parse pour lire stop_reason avant parsing : accepté). Modal : prop dismissible. L7 intégration démarrée.
- 12:30 README commité. En attente : .env.local (toutes les clés vides) pour migrate/seed réels, test bout en bout et parcours navigateur.
