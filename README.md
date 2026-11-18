# Sordulo OS

Outil interne de Sordulo : une réunion ou un retour client devient des tickets, puis des tâches réparties entre l'équipe.

**Parcours** : Projet → Entrées (retour écrit collé ou audio de réunion) → l'IA propose des tickets et leurs tâches → écran de validation → kanban, avec chaque tâche déjà attribuée au membre le plus compétent.

## Stack

- React 19 + Vite + TypeScript strict, React Router, TanStack Query
- Supabase : Postgres + RLS multi-organisation, Auth par lien magique, Storage pour l'audio
- Fonctions serverless Vercel dans `api/` : tout ce qui utilise une clé secrète
- Claude (API Anthropic) pour l'analyse, Deepgram (nova-3, français, voix séparées) pour la transcription

## Démarrer en local

```bash
npm install
cp .env.example .env.local   # puis remplir les valeurs (voir ci-dessous)
npm run db:migrate           # applique supabase/migrations sur la base
npm run db:seed              # organisation Sordulo, Maël, Sacha, client Ibé, projet « App Ibé »
npm run dev                  # http://localhost:5173 (sert aussi /api, pas besoin du CLI Vercel)
```

Dans Supabase, sous **Authentication > URL Configuration**, ajoute `http://localhost:5173` (et l'URL Vercel) aux Redirect URLs.

À la première connexion, chaque compte est lié à son membre par l'email. Un email qui ne figure pas dans le seed peut se connecter, mais ne voit rien.

## Variables d'environnement

| Variable | Où | Rôle |
|---|---|---|
| `VITE_SUPABASE_URL` | front + serveur | URL du projet Supabase |
| `VITE_SUPABASE_ANON_KEY` | front | Clé publique (la RLS protège les données) |
| `SUPABASE_SERVICE_ROLE_KEY` | serveur uniquement | Fonctions `/api` |
| `ANTHROPIC_API_KEY` | serveur uniquement | Analyse IA |
| `ANTHROPIC_MODEL` | serveur uniquement | Modèle Claude (`claude-sonnet-5-5` conseillé : rapide et économique) |
| `TRANSCRIPTION_API_KEY` | serveur uniquement | Clé Deepgram |
| `SUPABASE_DB_URL` | local uniquement | Scripts de migration et de seed (Session pooler) |
| `SEED_MAEL_EMAIL`, `SEED_SACHA_EMAIL` | local uniquement | Emails du seed, jamais dans git |

## Déployer sur Vercel

1. Pousser le repo sur GitHub, puis **Add New Project** dans Vercel et importer le repo. Le framework Vite est détecté et `vercel.json` est déjà configuré : fonctions `api/**` avec 300 s max, fallback SPA.
2. Dans **Settings > Environment Variables**, ajouter les 6 premières variables du tableau. Les variables « local uniquement » ne vont pas sur Vercel.
3. Déployer, puis ajouter l'URL de production aux Redirect URLs de Supabase.
4. Le plan Hobby limite les fonctions à 300 s, ce qui suffit pour une réunion d'environ 5 min. Pour des réunions plus longues, passer en Pro ou découper l'audio.

## Scripts

| Commande | Effet |
|---|---|
| `npm run dev` | Front + `/api` en local |
| `npm run typecheck` | `tsc -b` (front, api, config) |
| `npm run lint` | ESLint |
| `npm test` | Vitest (attribution, transcription, post-traitement IA, diff de validation, kanban) |
| `npm run build` | Typecheck + build de production |
| `npm run db:migrate` / `db:seed` | Base Supabase (idempotents) |

## Organisation du code

```
api/                     Fonctions Vercel (POST /api/inputs/create, /api/inputs/process)
  _lib/                  Auth, stockage (seul module Storage, R2 prévu plus tard), Deepgram, Claude, pipeline
src/shared/              Contrat de données, contrat HTTP, attribution, transcription (partagés front/api)
src/styles/tokens.css    TOUTES les valeurs de style : brancher ici le design system Figma
src/components/ui/       Kit UI maison (CSS Modules, tokens uniquement)
src/features/            auth, projects, inputs, review, tickets, tasks
supabase/migrations/     Schéma, RLS, triggers, bucket
scripts/                 Migration et seed
```

## Plan B pour la réunion

Si la transcription échoue, transcris la réunion avec un autre outil, puis colle le texte dans **Nouvelle entrée > Retour écrit**. L'analyse et la validation fonctionnent de la même façon.
