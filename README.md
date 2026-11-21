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

## Production

- Site : **https://sordulo-os-app.vercel.app** (projet Vercel `sordulo-os-app`, compte sordulocontact).
- Chaque push sur `main` (repo `sordulocontact-ux/sordulo-OS-APP`) redéploie automatiquement.
- Supabase : Site URL = l'adresse du site ; Redirect URLs = `http://localhost:5173/**`, `sordulo://auth`, `https://sordulo-os-app.vercel.app/**`.
- Supabase Free n'envoie que quelques emails de connexion par heure : en cas de « Trop d'emails », attendre ou brancher un SMTP.

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
| `npm run desktop:build` | App de bureau installable (voir ci-dessous) |
| `npm run release -- <version>` | Nouvelle version de l'app de bureau (commit + tag) |

## App de bureau

App Tauri 2 (`src-tauri/`) : la même interface que le site, plus l'île, la détection et l'enregistrement des appels. Le front est embarqué dans l'app et appelle l'API Vercel (`VITE_API_BASE_URL`).

**Développer** : `npm run tauri dev` (front servi par Vite, `/api` en local, ni mise à jour ni lancement au démarrage).

**Construire en local** : `npm run desktop:build` construit pour la machine courante (`-- --target universal-apple-darwin` pour un Mac universel, `-- --dry-run` pour voir les commandes). Il compile le relais Claude Code (`sordulo-hook`, livré à côté de l'exécutable), puis lance `tauri build` avec `src-tauri/tauri.release.conf.json`. Installeurs dans `src-tauri/target/[<cible>/]release/bundle/`.

- Sans `TAURI_SIGNING_PRIVATE_KEY`, l'app est construite sans fichiers de mise à jour (suffisant pour tester). Pour les produire : `export TAURI_SIGNING_PRIVATE_KEY=~/.tauri/sordulo-os-updater.key` et `export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(security find-generic-password -s sordulo-os-updater-key-password -a sordulo-os -w)"`.
- Sans `APPLE_SIGNING_IDENTITY` (nom du certificat, voir `security find-identity -v -p codesigning`), l'app Mac est signée ad hoc : elle marche sur ce Mac seulement.

**Publier une version** : `npm run release -- 0.3.0` (ou `patch`, `minor`, `major` ; `--dry-run` pour simuler), depuis `main` avec un arbre propre. Le script monte la version (`package.json`, seule source lue par Tauri, recopiée dans `Cargo.toml`), commite « chore(release): vX.Y.Z » et crée le tag, sans pousser. Pousser ensuite branche et tag (GitHub Desktop pousse les tags, sinon `git push --follow-tags`) : le workflow `.github/workflows/release.yml` compile Mac (universel) et Windows, puis publie la release avec `latest.json`. Les apps installées se mettent à jour seules. Liens stables pour la page de téléchargement : `https://github.com/sordulocontact-ux/sordulo-OS-APP/releases/latest/download/Sordulo-OS-macOS.dmg` et `…/Sordulo-OS-Windows-setup.exe`.

Secrets du dépôt (Settings > Secrets and variables > Actions) :

| Secret | Contenu |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Contenu de `~/.tauri/sordulo-os-updater.key` (perdue = plus aucune mise à jour possible) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Son mot de passe (Trousseau `sordulo-os-updater-key-password`) |
| `APPLE_CERTIFICATE` | Certificat « Apple Development » exporté en .p12, en base64 (`base64 -i cert.p12 \| pbcopy`) |
| `APPLE_CERTIFICATE_PASSWORD` | Mot de passe choisi à l'export du .p12 |
| `APPLE_SIGNING_IDENTITY` | Nom complet du certificat (jamais écrit dans le dépôt) |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Mêmes valeurs que sur Vercel |

**Première installation** (app non notarisée, installeur Windows non signé) :

- Mac : ouvrir le .dmg, glisser l'app dans Applications, l'ouvrir une fois, puis **Réglages Système > Confidentialité et sécurité > Ouvrir quand même**.
- Windows : à l'avertissement SmartScreen, **Informations complémentaires > Exécuter quand même**. Installation pour l'utilisateur courant, sans droits administrateur.

Les mises à jour suivantes s'installent seules, sans ces étapes.

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
