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
- **Bureau** (Tauri 2) : la même interface, plus une icône soleil dans la zone de notification, la détection du micro (« Transcrire cet appel ? ») et l'enregistrement des appels. Windows marche. Sur macOS, l'île marche (collée à l'encoche de la caméra, variante `mac` du front choisie par Rust via `?platform=mac`, au-dessus de la barre des menus) ainsi que le relais Claude Code et la détection des appels : apps au micro et apps qui jouent du son par les processus Core Audio (macOS 14+, sans autorisation, chaque helper rattaché à son app), titre de l'onglet des navigateurs par AppleScript (une autorisation « Automatisation » par navigateur, refus = détection au son seulement). Enregistrement des appels sur Mac : micro par défaut + son de l'ordinateur par un « process tap » Core Audio (macOS 14.2+) dans un agrégé privé, seule la capture est propre au Mac (`platform/macos/capture.rs`) ; mix, MP3 et orchestration sont les modules purs de `platform/windows/` inclus par `#[path]` (les modifier vaut pour les deux systèmes). Autorisations micro et « Enregistrement audio du système » demandées au premier appel (textes dans `src-tauri/Info.plist`). Île déplaçable (`src-tauri/src/island_window/`) : on la glisse et on la lance vers le milieu d'un des 4 bords de n'importe quel écran (glisser piloté par Rust, l'île devient une flaque saisie par le curseur : contour irrégulier qui ondule, masse qui traîne et s'étire derrière le mouvement ; lancée sur un bord, elle s'écrase et s'étale le long du bord avant de prendre sa forme (vitesse envoyée par Rust à chaque tour, événement `island-motion`, physique dans `view/puddle.ts`, flaque centrée à `ISLAND_DRAG_BLOB / 2 + ISLAND_DRAG_INSET` du bord de la fenêtre pour ne pas être coupée ; labo : « Détacher l'île (flaque) », on la traîne à la souris et le lâcher la lance vers son bord comme dans l'app), ressort, sans aperçu de la place, place gardée dans `island-placement.json`, « Replacer l'île en haut » dans le menu du soleil) ; en bas forme miroir, à gauche et à droite pilule verticale au repos et carte horizontale à l'ouverture (`edge` dans `geometry.ts`, choix du bord dans le labo) ; encoche Mac seulement en haut. Musique dans l'île (`src-tauri/src/music.rs`, source `controller/sources/music.ts`) : lecteur du système, sans connecteur ; Windows par les contrôles multimédias du système (tous les lecteurs), Mac par MediaRemote (`platform/macos/media_remote.rs`, crate `media-remote` : adaptateur lancé par `/usr/bin/perl`, seul binaire autorisé depuis macOS 15.4, sans autorisation ; tous les lecteurs, navigateurs compris), repli si l'adaptateur ne répond pas en 5 s : AppleScript pour Spotify et Musique, interrogés seulement quand Core Audio les entend jouer ; clic sur la musique : sur Mac, l'onglet du navigateur qui joue est affiché (AppleScript, `open_player` dans `platform/macos/media.rs`), sinon l'app est seulement activée ; case « Afficher la musique dans l'île » dans le menu du soleil. Barres de l'égaliseur et hochement des Claude sur le vrai son : Windows seulement (écoute loopback de la sortie par défaut, `src-tauri/src/music_levels/`) ; sur Mac on garde la simulation (exception voulue par Maël : pas de voyant violet d'enregistrement), `platform::output_tap` y répond « non disponible ». Sans vrai temps (Mac, musique sur le téléphone, vrai son sans tempo stable) : tempo du morceau trouvé chez Deezer (`src-tauri/src/music_tempo.rs`, API publique sans clé, titre et artiste, cache de session, `tempoBpm` dans `MusicState`) et calé sur la position du morceau : bonne vitesse, coup pas forcément pile sur le temps ; à défaut, tempo fixe. Lancement à l'ouverture de session (`src-tauri/src/autostart.rs`, `tauri-plugin-autostart` : clé Run sous Windows, LaunchAgent sous macOS) : activé tout seul au premier lancement de la version installée (jamais en dev, le binaire debug dépend du serveur Vite), case « Lancer au démarrage » dans le menu de la zone de notification ; lancée ainsi (`--autostart`), l'app démarre sans sa fenêtre principale (cachée dans `tauri.conf.json`, montrée au démarrage normal). Déploiements Vercel dans l'île (`controller/sources/deployments.ts`) : déploiements de production du jeton Vercel du compte (carte Vercel de la page Connecteurs, table `vercel_connections` de la migration 0008, chaque compte ne lit que sa ligne), sondés par le front (API Vercel en CORS ouvert, pas de Rust) ; progression à l'anneau estimé, au nom du dépôt Git (repli : projet Vercel) ; fermée sur Mac, l'île s'élargit avec un rebond (clé `progressNamed`, ressort `BOUNCY_SPRING` de `geometry.ts`, sans rebond si « Réduire les animations ») : logo Vercel et nom du projet à gauche de l'encoche (coupé par « … », jamais dessous), anneau à droite ; avec au survol une vue ouverte (`progressOpen`, Windows et Mac) qui ajoute le message du commit et la branche, puis « X est en ligne » ou « X : échec » (X : le dépôt, message du commit en sous-titre, « Voir les logs ») ; case « Afficher les déploiements dans l'île » dans le menu du soleil. Spotify dans l'île (`src-tauri/src/spotify/`, source `controller/sources/spotify.ts`) : Client ID de l'app Spotify de chacun et jeton de rafraîchissement sur le compte (table `spotify_connections` de la migration 0009), autorisation PKCE par l'app de bureau, ligne relue par l'île et transmise à Rust (rien sur le disque), rotation enregistrée par `spotify_replace_refresh_token`. Page Connecteurs : seulement des comptes de l'utilisateur (Claude = relais Claude Code de l'ordinateur, Vercel, Spotify) ; les services internes de l'app (Claude API, Deepgram, Mistral, Supabase de l'app) n'y figurent pas. Rangement des fichiers déposés sur l'île (zone « Ranger », plusieurs fichiers d'un coup, source `controller/sources/filing.ts`, textes et choix dans `drop/filing.ts`, moteur `src/lib/filing.ts`) : progression « Classement de N fichiers », puis décision dans l'île pour un fichier sûr (nouvel état `choice`, `requestChoice` / `resolveChoice`, mis de côté après 20 s sans personne : « Fichier prêt à ranger ») avec Ranger / Modifier / case « Toujours », « 3 fichiers prêts à ranger » (Tout ranger / Vérifier), sinon « À vérifier » qui ouvre l'app (`/files/intake/:id` ou `/files/inbox?batch=`) ; chaque rangement s'annule. Notifications de la base dans l'île (`controller/sources/appNotifications.ts`, Realtime sur `notifications`) : passages de main, propositions de l'IA (Valider / Refuser / Toujours, puis Annuler) ; ignorées pour éviter les doublons : `task.assigned` (source attribution), `file.*` des lots de cette île, `input.ready` des entrées déjà suivies. Mises à jour de la version installée (`src-tauri/src/updater.rs`, GitHub Releases) : chaque push sur `main` qui touche l'app publie une release (`.github/workflows/release.yml`, version patch suivante calculée par la CI, tag créé sans commit, chaque système publié dès qu'il est prêt par `desktop-platform.yml` : Windows sans attendre le Mac ni son échec ; `npm run release` reste là pour choisir la version) ; vérifiées toutes les 15 min (et avant chaque installation : la dernière version publiée remplace celle déjà téléchargée, une seule mise à jour même après plusieurs releases), installées quand la fenêtre est fermée et qu'aucun appel n'est enregistré ; à la main par Paramètres > Application de bureau (rechercher, puis « Installer et redémarrer ») ou par le menu du soleil, qui se ferme au clic : le résultat arrive en notification, et une mise à jour prête change la ligne en « Installer la mise à jour X et redémarrer ».

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

Migrations 0010 à 0020 (roadmap V0 à V2, sécurité, partenaires et notes) : **appliquées en production le 25/11/2026** (par le MCP Supabase ; `sordulo_meta.migrations` note 0001 à 0020, schéma vérifié identique à une base locale qui a exécuté les fichiers).

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
src/app/                 Shell : routes, AppLayout (barre latérale du Figma 88:3236 : sections repliables, mode replié
                         en icônes, icônes de la maquette dans src/assets/nav), page 404
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
  files/                 Onglet Fichiers du projet (dossiers, versions, corbeille), écran de rangement d'un dépôt,
                         boîte de dépôt, dépôt web (moteur : src/lib/filing.ts + src/shared/filing.ts)
  catalog/               Catalogue de prestations (lignes de devis et tâches types)
  briefs/                Brief structuré d'une entrée, puis brouillon de devis (fiche d'une entrée)
  my-tasks/ time/ rounds/  Mes tâches, suivi du temps (minuteur, onglet Temps), rounds de retours
  notifications/ proposals/  Cloche + /notifications ; propositions de l'IA (Valider / Refuser / Toujours / Annuler)
  finance/ followups/ recap/  Finance (CA, seuils, 50/50), relances (brouillons), récap du lundi
  commissions/           Commissions de l'apporteur
  contracts/ showcase/   Contrats (depuis un devis, signature notée), diffusion et étude de cas
  deliverables/ portal/  Livrables (versions, épingles) ; portail client public /p/:token
  search/ voice/         Palette Cmd+K (sources extensibles) ; commandes vocales
  files-all/ email/      Fichiers de toute l'agence ; page Email (Gmail à venir)
  partners/ notes/       Réseau de partenaires ; notes (page + onglet du projet, NotesWorkspace)
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
| `/my-tasks` | Mes tâches de tous les projets, par échéance, minuteur | `features/my-tasks/` |
| `/projects/:id/files`, `/deliverables`, `/contracts`, `/time`, `/share` | Onglets Fichiers, Livrables (versions, commentaires épinglés), Contrats, Temps (vendu vs réel), Partage (portail client, diffusion, étude de cas) | `features/{files,deliverables,contracts,time}`, `projects/ProjectShareTab.tsx` |
| `/files/intake/:id`, `/files/inbox` | Rangement d'un fichier déposé (proposition de l'IA modifiable), boîte de dépôt et validation en lot | `features/files/` |
| `/catalog` | Catalogue de prestations | `features/catalog/` |
| `/contracts`, `/contracts/:id`, `/contracts/:id/print` | Contrats (admin, finance : ils portent les prix) ; aperçu A4 hors barre latérale | `features/contracts/` |
| `/finance` | CA, encaissements, impayés, seuils micro / TVA par émetteur, répartition 50/50, relances (admin, finance) | `features/finance/` |
| `/recap` | Récap de la semaine (notification le lundi) | `features/recap/` |
| `/commissions` | Commissions (admin, finance ; l'apporteur voit les siennes) | `features/commissions/` |
| `/notifications`, `/proposals` | Toutes les notifications ; propositions de réorganisation de l'IA | `features/{notifications,proposals}/` |
| `/files`, `/email` | Tous les fichiers de l'agence ; Email (Gmail « Bientôt » : relances et « Coller un mail client » en attendant) | `features/{files-all,email}/` |
| `/partners`, `/partners/:id` | Réseau de partenaires (freelances, sous-traitants, imprimeurs…), projets liés (admin, membre, finance) | `features/partners/` |
| `/notes`, `/projects/:id/notes` | Notes rattachables à un projet / client, perso ou équipe, Markdown léger | `features/notes/` |
| `/p/:token` | Portail client public (sans connexion) : avancement, livrables, devis à accepter, contrats à signer, factures | `features/portal/`, `api/portal.ts` |
| `/desktop/prompt` | Petite fenêtre de l'app de bureau près de la zone de notification : proposition de transcription, choix du projet, enregistrement en cours | `features/desktop/` |

Chaque écran a des états vides, de chargement et d'erreur (`EmptyState`, `LoadingState`, `ErrorState`). Ils font partie du design.

La fenêtre `/desktop/prompt` est petite : elle doit rester lisible à taille réduite.

## Rôles et droits

- **admin** : tout. **membre** : clients, projets, entrées, tâches, prospects (audit et offre), catalogue. **finance** : Accueil, Devis, Factures, Contrats, Finance, Commissions ; lit clients et projets sans les modifier, ni tâches ni entrées. **prospection** (apporteur d'affaires) : Accueil, « Mes sites » (seulement SES prospects, créés « À auditer », sans toucher l'audit ni l'offre) et « Mes commissions ». Connecteurs : tous les rôles (comptes de l'utilisateur, jetons MCP).
- Commissions de l'apporteur (migration 0014) : calculées par la base au paiement d'une facture (barème par tranches cumulatif sur le premier devis signé, taux fixe sur les devis suivants, fenêtres en mois, lignes « refacturées » exclues, avoirs déduits), barème saisi par apporteur dans l'Équipe (`commission_plans`), jamais en dur dans le code. Miroir TS : `src/shared/commission.ts`.
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
- **Île sur Mac : penser à l'encoche de la caméra.** L'île Mac entoure l'encoche, un rectangle opaque au milieu du bord haut : 186 × 32 px, tokens `--island-garden-notch-width` / `--island-garden-notch-height`, `GARDEN.notch` côté simulation. Rien d'utile ne doit être dessiné dessous ni s'y arrêter : texte, boutons, Claude. Et ce qui masque l'encoche ne doit pas déborder sur l'île ouverte : une bande pleine hauteur a déjà caché le titre et la progression de la musique. Tout ajout à l'île se vérifie dans le labo (`/desktop/ile-labo`, plateforme « Mac avec encoche »), fermée et ouverte. L'encoche est un tunnel court, de la largeur d'un Claude (`NOTCH_TUNNEL`), qui commence aux plans de deux portails posés devant ses bords (`tunnelSpan` = encoche élargie de `GARDEN.notch.portal.inset`) : le Claude entre dans un portail de sa couleur jusqu'à disparaître en entier, puis ressort aussitôt par celui de l'autre côté, petit à petit, sans marcher les 186 px cachés ; jamais visible des deux côtés à la fois (demande de Sacha : coupé en deux, ça faisait bizarre), coupé au plan du portail, jamais dessiné dessous, et personne ne s'arrête dedans ni à cheval sur un plan (`throughNotch` et `portalOf` dans `garden/simulation.ts`, coordonnée repliée ; tout déplacement hors marche passe par `place` / `teleport`). Portails : `sim.portals` (`NotchPortal`, un par Claude, ouvert `lead` s avant le contact, fermé `linger` s après la sortie, durées d'animation = tokens `--island-garden-duration-portal-*`) et `portalVisual` pour le dessin.
- **Claude de l'île et du jardin** : ils jouent ce que fait la session, d'après `activity` de `ClaudeSession` (tirée de l'outil en cours par `toolActivity` dans `claude/steps.ts` : lit, fouille, écrit, commande, web, réfléchit, sous-agent). Accessoires en pixel art partagés : dessins dans `art/pixelArt.ts` (une case = un pixel de la grille 16 × 16), couleurs et animations en images dans `art/pixelArt.module.css` (engrenages : deux images, dents droites puis en diagonale ; tokens `--island-mascot-*`), accessoire de chaque activité dans `art/props.ts`. Île (`view/ClaudeMascot`) : scènes (activités, variations, moments réveil / fin / erreur / attente) dans `view/mascotScenes.ts`, pur et testé ; la scène suivante part à la fin réelle des animations, pas sur une minuterie ; corps propre, sans les bras (pièces à part) et **plein à la place des yeux** (avec les trous du masque du jardin, l'œil qui regarde ailleurs paraissait dédoublé). Jardin : un Claude dont la session travaille marche, se pose (`busy`, `GARDEN.work`) avec l'accessoire de son activité, puis repart se poser ailleurs ; dessins créés par `renderer.ts` au premier besoin, montrés par `data-prop`. Tout accessoire reste à gauche de l'encoche du Mac (environ 10 cases à droite de l'icône) ; un Claude du jardin ne se pose jamais contre l'encoche. Labo : groupe « Claude de l'île », sessions du labo avec des activités variées.
- **Serveur de dev figé** (toute requête CSS reste sans réponse, la page ne charge pas) : pour voir le labo quand même, `NODE_ENV=development npx vite build --mode development --outDir <dossier temporaire>` puis `npx vite preview --outDir <même dossier>` (le labo n'existe qu'en mode développement).
- **12 fonctions Vercel sur 12 (offre gratuite).** Jamais de nouveau fichier dans `api/`. Toute action IA passe par `POST /api/ai/run { action }` : nom dans `src/shared/ai-actions.ts`, module `api/_lib/ai/actions/<nom>.ts` (`defineAiAction`, droits vérifiés par l'action avec `ctx.requireMember` dès l'objet chargé), types dans `src/shared/ai/<nom>.ts`, appel front `runAi` de `src/lib/ai.ts`. Les deux autres nouvelles fonctions : `api/portal.ts` (portail client, par jeton) et `api/mcp.ts` (serveur MCP, jeton personnel `sdo_…` haché en base). Contenu d'un fichier, d'un site ou d'une transcription envoyé à Claude = donnée non fiable, dit dans le prompt système ; aucune écriture sans validation humaine (« L'IA propose, vous validez »).
- **Rangement d'un fichier déposé** (île ou web) : `src/lib/filing.ts` (`startBatch`, `fileIntake`, `undoFiling` = corbeille, `importFromIntake`), action `classify` (type, client, projet, dossier, numéro rapproché exactement des devis / factures, doublon sha256, version + résumé des changements, règle « Toujours » qui range seule), validation dans l'île si `needsReview` est faux (confiance ≥ 0,75, projet non ambigu, pas de doublon), sinon `/files/intake/:id`. Import d'un devis / d'une facture d'un autre outil : RPC serveur `import_document_from_file` (0018), numéro d'origine gardé.
- **Seuils légaux** (`src/shared/thresholds.ts`) : plafond micro-entreprise et franchise de TVA par année, à revérifier chaque 1er janvier (sources dans le fichier).
- Pour un ticket complet, utiliser le skill `/ticket`. Les tickets vivent dans `.tickets/`, et le ticket archivé du MVP (`.tickets/archive/2026-11-18-mvp-sordulo-os/TICKET.md`) contient toutes les décisions prises.

## Hors périmètre pour le moment

Dépenses (carte « Sortie » de l'Accueil), barre de chat de l'Accueil, envoi de mails par l'app (les relances sont des brouillons à copier), intégrations réelles Stripe, Gmail, Google Agenda, Yousign, GitHub et plateforme de facture électronique (cartes « Bientôt » des Connecteurs ; signature des contrats notée à la main ou sur le portail), V3 (multi-organisation activée, onboarding et abonnement, app mobile). Ils sont dans la roadmap mais pas encore codés : pas besoin de les designer dans l'app tant qu'ils n'ont pas de ticket.