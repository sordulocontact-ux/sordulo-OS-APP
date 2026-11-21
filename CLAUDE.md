# Sordulo OS : contexte du projet

## Le projet

Sordulo OS est l'outil interne de l'agence Sordulo (branding, sites, apps). Il sera vendu plus tard à d'autres agences, donc tout est déjà pensé multi-organisation.

Parcours principal : un projet client reçoit des **entrées** (un retour écrit collé ou l'audio d'une réunion). L'IA les transforme en **tickets** avec leurs **tâches**. On valide les tickets sur un écran de validation, puis les tâches arrivent dans un **kanban**, déjà attribuées à la personne la plus compétente (design ou dev).

Équipe :
- **Maël** : dev (front, back, API, app de bureau).
- **Sacha** : design system sur Figma, design des écrans, veille.

Premier client de test : **Ibé** (projet « App Ibé »).

L'app existe en deux versions avec le même code :
- **Web**, déployée sur Vercel (production = chaque push sur `main` du dépôt `sordulocontact-ux/sordulo-OS-APP`).
- **Bureau** (Tauri 2) : la même interface, plus une icône soleil dans la zone de notification, la détection du micro (« Transcrire cet appel ? ») et l'enregistrement des appels. Windows marche. Sur macOS, l'île marche (collée à l'encoche de la caméra, variante `mac` du front choisie par Rust via `?platform=mac`, au-dessus de la barre des menus) ainsi que le relais Claude Code et la détection des appels : apps au micro et apps qui jouent du son par les processus Core Audio (macOS 14+, sans autorisation, chaque helper rattaché à son app), titre de l'onglet des navigateurs par AppleScript (une autorisation « Automatisation » par navigateur, refus = détection au son seulement). Enregistrement des appels sur Mac : micro par défaut + son de l'ordinateur par un « process tap » Core Audio (macOS 14.2+) dans un agrégé privé, seule la capture est propre au Mac (`platform/macos/capture.rs`) ; mix, MP3 et orchestration sont les modules purs de `platform/windows/` inclus par `#[path]` (les modifier vaut pour les deux systèmes). Autorisations micro et « Enregistrement audio du système » demandées au premier appel (textes dans `src-tauri/Info.plist`). Musique dans l'île (`src-tauri/src/music.rs`, source `controller/sources/music.ts`) : lecteur du système, sans connecteur ; Windows par les contrôles multimédias du système (tous les lecteurs), Mac par AppleScript pour Spotify et Musique, interrogés seulement quand Core Audio les entend jouer ; case « Afficher la musique dans l'île » dans le menu du soleil. Barres de l'égaliseur et hochement des Claude sur le vrai son : Windows seulement (écoute loopback de la sortie par défaut, `src-tauri/src/music_levels/`) ; sur Mac on garde la simulation (exception voulue par Maël : pas de voyant violet d'enregistrement), `platform::output_tap` y répond « non disponible ».

Le design suit le Figma « SORDULO-OS », déjà appliqué via les tokens. Toute nouvelle page reprend ce design : mêmes tokens, mêmes composants, même structure que les écrans existants (par exemple le tableau de la page Projets).

Répartition actuelle : Sacha s'occupe des pages annexes (Clients, Équipe, Paramètres…) sur ses propres branches. Maël s'occupe de la page projet et de l'île de l'app de bureau sur `feature/ile`.

## Stack

- React 19 + Vite 8 + TypeScript 6 strict, React Router 7, TanStack Query
- Styles : **CSS Modules + variables CSS**, sans Tailwind ni librairie de composants
- Supabase (Postgres + RLS, Auth par lien magique, Storage pour l'audio)
- Fonctions serverless Vercel dans `api/` (clés secrètes uniquement côté serveur)
- Claude pour l'analyse, Deepgram pour la transcription
- Tauri 2 (Rust) dans `src-tauri/` pour l'app de bureau

## Démarrer

```bash
npm install
# demander à Maël le fichier .env.local (jamais dans git)
npm run dev        # http://localhost:5173, sert aussi /api
```

Connexion : email + mot de passe (défini dans le menu du compte), lien par email en secours. Seuls les emails enregistrés dans la base voient les données. Un autre email peut se connecter mais tombe sur « accès non autorisé » : demander à Maël de l'ajouter.

Vérifications avant de rendre un travail :

```bash
npm run typecheck
npm run lint
npm test           # inclut les tests RLS (supabase/tests, Postgres PGlite en mémoire) ; seuls : npm run test:rls
npm run build
```

Migrations : une nouvelle migration `supabase/migrations/000N_*.sql` est appliquée en production **avant** de pousser le code qui en dépend, par `npm run db:migrate` (`SUPABASE_DB_URL` = URI « Session pooler » dans `.env.local`, les migrations déjà passées sont sautées) ou par l'éditeur SQL Supabase. Production sans `sordulo_meta` (migrations collées à la main) : `node scripts/db-apply-files.mjs <nouvelles.sql> --mark <déjà appliquées.sql>` applique chaque fichier dans sa transaction et note les migrations. Pour tester sur une base jetable : un Supabase local (`supabase start`, ports libres) et un fichier `.env.<mode>.local` lu par `npx vite --mode <mode>` (jamais le `.env.local` de production).

## Organisation du code

```
src/styles/tokens.css    TOUTES les valeurs de style. C'est ici que se branche le design system
src/styles/global.css    Reset, typo de base (h1-h3), focus, classe .visually-hidden
src/components/ui/       Kit UI maison : Avatar, Badge, Button, Card, EmptyState, ErrorState,
                         Field, Icon, IconButton, ListToolbar, LoadingState, Modal, Select, Spinner,
                         StatCard, ActionsMenu, Tabs, Textarea, TextInput, Toast (export dans index.ts) ;
                         dataTable.module.css = styles partagés des pages de liste (tableau dans
                         .scroll, ligne cliquable). Toute liste utilise ListToolbar : recherche pleine
                         largeur + bouton filtre (panneau) + bouton « + » (Figma « Contrats » 61:2989)
src/app/                 Shell : routes, AppLayout (header), page 404
src/features/            Un dossier par fonctionnalité, chacun avec ses composants et leurs .module.css
  auth/                  Connexion, garde d'accès, rôles (roles.ts : ALL, PROJECT, CLIENT_READ, FINANCE,
                         PROSPECT, ADMIN ; RequireRole)
  home/                  Accueil : cartes selon le rôle (devis, factures, finance 6 mois, prospection, travail, équipe)
  quotes/                Devis : liste, édition, envoi / acceptation, duplication, facture et acompte, aperçu A4
  invoices/              Factures : brouillon, émission (numéro définitif), paiement, avoir, export CSV, aperçu A4
  billing/               Commun devis / factures : LinesEditor, DocumentPreview (A4 imprimable), PrintBar
  prospects/             Prospection : liste, étapes, prochaine action, conversion en client
  projects/              Liste des projets (filtres dans l'URL), page projet avec onglets, ProjectFormModal,
                         ProjectStatus (pastille de statut)
  clients/               Liste des clients, fiche client (infos, contacts, projets), formulaires
  team/                  Équipe (admins) : invitation avec lien à copier, modification, retrait, réintégration
  settings/              Paramètres de l'organisation (admins) : infos légales, adresse, facturation
  inputs/                Onglet Entrées, nouvelle entrée (texte ou audio), fiche d'une entrée
  review/                Écran de validation des tickets proposés
  tickets/               Onglet Tickets
  tasks/                 Onglet Tâches (kanban)
  desktop/               Fenêtre « Transcrire cet appel ? » de l'app de bureau
src/shared/              Types et logique partagés front/API (ne pas toucher pour le design)
src/lib/                 Client Supabase, appels API, pont avec l'app de bureau
api/                     Fonctions serveur (ne pas toucher pour le design)
supabase/                Schéma, RLS, migrations (ne pas toucher pour le design)
src-tauri/               App de bureau en Rust (ne pas toucher pour le design)
.tickets/                Tickets en cours et archivés (skill /ticket)
```

## Écrans

| Route | Écran | Fichiers |
|---|---|---|
| `/login` | Connexion (email, puis lien ou code) | `features/auth/LoginPage.tsx` |
| `/` | Accueil (cartes selon le rôle) | `features/home/HomePage.tsx` |
| `/projects` | Liste des projets : recherche, filtres statut et client (`?statut=&client=`), « + » | `features/projects/ProjectsPage.tsx` |
| `/quotes`, `/quotes/:id`, `/quotes/:id/print` | Devis (admin, finance) ; aperçu A4 hors barre latérale | `features/quotes/` |
| `/invoices`, `/invoices/:id`, `/invoices/:id/print` | Factures (admin, finance) | `features/invoices/` |
| `/prospects`, `/prospects/:id` | Prospection (admin, prospection) | `features/prospects/` |
| `/clients` | Liste des clients, archivés masqués par défaut | `features/clients/ClientsPage.tsx` |
| `/clients/:id` | Fiche client : infos, contacts (un seul principal), projets, archivage | `features/clients/ClientPage.tsx` |
| `/team` | Équipe (admins seulement) | `features/team/TeamPage.tsx` |
| `/settings` | Paramètres de l'organisation (admins seulement) | `features/settings/SettingsPage.tsx` |
| `/projects/:id/tickets` | Onglet Tickets : liste filtrable par statut et type, avec la citation d'origine | `features/tickets/` |
| `/projects/:id/tasks` | Onglet Tâches : kanban 4 colonnes (À faire, En cours, En relecture, Fait), glisser-déposer, filtre par personne, dépendances | `features/tasks/` |
| `/projects/:id/inputs` | Onglet Entrées : liste et statut des réunions et retours, bouton « Nouvelle entrée » | `features/inputs/` |
| `/projects/:id/inputs/:inputId` | Fiche d'une entrée : transcription, noms des voix, statut, relance | `features/inputs/InputDetailPage.tsx` |
| `/projects/:id/inputs/:inputId/review` | Validation : modifier, valider ou refuser chaque ticket, tout valider | `features/review/` |
| `/desktop/prompt` | Petite fenêtre de l'app de bureau près de la zone de notification : proposition de transcription, choix du projet, enregistrement en cours | `features/desktop/` |

Chaque écran a des états vides, de chargement et d'erreur (`EmptyState`, `LoadingState`, `ErrorState`). Ils font partie du design.

La fenêtre `/desktop/prompt` est petite : elle doit rester lisible à taille réduite.

## Rôles et droits

- **admin** : tout. **membre** : clients, projets, entrées, tâches. **finance** : Accueil, Devis, Factures ; lit clients et projets sans les modifier, ni tâches ni entrées. **prospection** : Accueil et Prospection seulement.
- La RLS est la protection principale (migrations `0003` et `0004`) : écriture des membres et de l'organisation réservée aux admins actifs, par colonne ; clients, contacts, projets et membres de projet en écriture pour admin et membre ; devis et factures pour admin et finance ; prospects pour admin et prospection. L'interface masque en plus les pages (`RequireRole`, barre latérale filtrée).
- Retirer un membre = `supabase.rpc('remove_member')` : retrait doux (`members.removed_at`), il ne voit plus rien, ses tâches non terminées passent en « non attribuée ». `restore_member` le réintègre. Jamais de suppression de membre.
- Inviter = `/api/members/invite` (clé service) : crée le membre et son compte (relié tout de suite), renvoie un lien de connexion à usage unique à envoyer soi-même (pas d'email). `/api/members/link` régénère le lien. « Invité, jamais connecté » vient de la RPC `member_sign_in_status` (admins). Les origines de retour autorisées sont dans `api/_lib/members.ts` (+ `APP_URL`) et doivent figurer dans Supabase > Auth > Redirect URLs.
- Attribution automatique : membres actifs admin ou membre, limités aux membres du projet s'il en a (`project_members`) ; charge relative à la capacité hebdo, capacité 0 = jamais, indisponible aujourd'hui (Paris) = en dernier.

## Facturation (migration 0004)

- Montants en centimes, lignes en jsonb, totaux calculés par la base (trigger) avec la même règle que `src/shared/billing.ts` (arrondi par taux de TVA). Le front n'envoie jamais numéro, totaux ni horodatages.
- Devis `D-AAAA-NNN` à la création. Factures et acomptes `F-AAAA-NNNN`, avoirs `A-AAAA-NNNN`, attribués par `issue_invoice` / `create_credit_note` : séries continues, facture figée après émission (correction = avoir), vendeur et acheteur copiés à l'émission.
- Statut du projet automatique, seulement vers l'avant : devis envoyé → « devis envoyé », accepté → « en cours », factures payées → « payé ».
- PDF = aperçu A4 + impression du navigateur. Export CSV comptable depuis la liste des factures.
- Émetteurs (migration 0005) : les micro-entreprises qui émettent (Sacha Moricet EI, Maël Auzenet EI), chacune avec ses infos légales, son IBAN et sa série de factures `AAAA-NNN` ; devis `AAAA-NNN` par organisation. Les documents importés (`sordulo.import`, serveur seulement) gardent leur numéro d'origine. Les données réelles ne sont jamais versionnées dans git.

## Règles de design (obligatoires)

1. **Une seule source de valeurs : `src/styles/tokens.css`.** Couleurs, typo, espacements, tailles, rayons, ombres, durées, z-index. Aucun fichier `.module.css` ne contient de valeur en dur (pas de `#hex`, pas de `px` ou `rem` hors tokens). Seules exceptions tolérées : `0`, `100%`, `1px` pour des cas techniques.
2. **Brancher le design system Figma = changer les valeurs des tokens, pas leurs noms.** Les composants utilisent déjà `var(--color-primary)`, `var(--space-4)`, etc. On change la valeur dans `tokens.css` et toute l'app suit. On ajoute un token seulement s'il manque vraiment, dans `tokens.css`, en suivant le nommage existant.
3. **Familles de tokens existantes** :
   - Couleurs neutres (`--color-bg`, `--color-surface*`, `--color-border*`, `--color-text*`)
   - Couleurs d'action (`--color-primary*`, `--color-focus-ring`)
   - Statuts (`--color-success`, `--color-warning`, `--color-danger`, `--color-info`, chacun avec sa version `-soft`)
   - **Couleurs métier** : types de ticket (`--color-type-bug`, `--color-type-modification`, `--color-type-new`) et compétences (`--color-skill-design`, `--color-skill-dev`), chacune avec sa version `-soft`
   - Typo (`--font-*`, `--font-size-xs` à `2xl`, `--font-weight-*`, `--line-height-*`)
   - Espacements sur une échelle de 4 px (`--space-0` à `--space-16`)
   - Tailles (`--size-control-sm/md`, `--size-avatar`, `--size-kanban-column`, largeurs max…)
   - Rayons, ombres, opacité, overlay, durées d'animation, z-index
4. **Réutiliser le kit `src/components/ui/` avant de créer un composant.** Un changement de style d'un composant se fait dans son `.module.css`, pas dans chaque écran. Un nouveau composant suit la même structure : `Nom.tsx` + `Nom.module.css`, exporté dans `index.ts`, props typées.
5. **Variantes existantes à conserver** : par exemple `Button` a `variant` (`primary`, `secondary`, `ghost`, `danger`) et `size` (`sm`, `md`), avec un état `loading`. Si le design system Figma a d'autres variantes, les ajouter sans supprimer celles utilisées dans le code.
6. **Accessibilité** : garder le focus visible (`--shadow-focus`), les contrastes lisibles, les menus utilisables au clavier (le kanban a un menu de statut en plus du glisser-déposer), et le respect de `prefers-reduced-motion` (déjà géré dans `tokens.css`).
7. **Pas de `letter-spacing`.** Textes de l'interface en français, sans tirets cadratins.
8. **Si le Figma ne couvre pas un cas** (état vide, erreur, écran de la fenêtre bureau) : reprendre le token ou le composant le plus proche, et le signaler à Sacha plutôt que d'inventer un style.

## Lire le design system Figma

Si un lien Figma est donné, le lire avec le MCP Figma avant de coder : variables (couleurs, typo, espacements, rayons), puis composants et leurs variantes. Faire la correspondance variable Figma → token existant, et la noter dans un commentaire en tête de `tokens.css` pour que la prochaine mise à jour soit simple.

## Conventions

- TypeScript strict, pas de `any`.
- Réutiliser avant de créer, et rester dans le périmètre demandé.
- Git : on développe directement sur `main` (demande de Sacha, 20/11/2026), pas de branche de fonctionnalité ; prévenir l'autre avant de pousser. Ne pas modifier les fichiers de l'autre chantier (pages annexes d'un côté, `src-tauri/` et `src/features/desktop/` de l'autre) sans le signaler.
- **App de bureau : toute fonctionnalité se code pour Windows ET macOS, dans le même travail.** Rien n'est livré pour un seul système avec un stub ou un « lot à venir » pour l'autre. Concrètement : chaque fonction de `src-tauri/src/platform/mod.rs` a une implémentation dans `platform/windows/` et dans `platform/macos/` ; le code sans appel système (calculs, mix, formats) est écrit une seule fois et partagé ; le front tient compte des deux (variante `win` / `mac` de l'île). On ne compile qu'un système à la fois : dire clairement lequel a été compilé et testé, et demander à l'autre de compiler le sien (Windows chez Maël, macOS chez Sacha) avant de fusionner.
- Pour un ticket complet, utiliser le skill `/ticket`. Les tickets vivent dans `.tickets/`, et le ticket archivé du MVP (`.tickets/archive/2026-11-18-mvp-sordulo-os/TICKET.md`) contient toutes les décisions prises.

## Hors périmètre pour le moment

Contrats, dépenses (carte « Sortie » de l'Accueil), barre de chat de l'Accueil, envoi des devis et factures par email, notifications, réorganisation automatique des tâches. Ils sont dans la roadmap mais pas encore codés : pas besoin de les designer dans l'app tant qu'ils n'ont pas de ticket.