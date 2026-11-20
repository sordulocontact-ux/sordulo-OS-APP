# Sordulo OS V0.2 : clients, projets et équipe

## Ticket d'origine
Fichier `ticket-v0-2-clients-projets-equipe.md` à la racine du repo (texte complet, non modifié).

## Contexte
MVP en production (web Vercel + bureau Windows) : entrées, tickets, validation, kanban. L'organisation, les membres, le client Ibé et le projet « App Ibé » viennent du seed : aucun écran pour en créer. Ce ticket rend l'app autonome et prépare les données des futurs devis (infos légales de l'organisation, adresse de facturation et SIRET des clients).

Existant réutilisé :
- Kit UI `src/components/ui/` (Button, Field, TextInput, Select, Textarea, Modal, SearchField, EmptyState, ErrorState, LoadingState, Badge, Avatar, Card, BackLink, Toast) et tokens `src/styles/tokens.css`.
- Tableau de `features/projects/ProjectsPage` (modèle Figma « Projet ») pour toutes les listes.
- RLS par organisation (`private.user_org_ids()`), triggers d'intégrité, `api/_lib/auth.ts` (`requireUser`, `requireOrgMember`), `route()` / `readJsonBody()` / `HttpError`.
- Le tone of voice est **déjà** envoyé à l'analyse : `api/_lib/pipeline.ts:329` → `api/_lib/analysis.ts:90` (`Ton de voix : …` dans le bloc `<projet>`). Reste à le couvrir par un test.
- Figma « SORDULO-OS » (5qgnyHkuGcwLc7Gb94ijgF) : pas d'écran Clients, Équipe, Paramètres, ni formulaire, ni modale. Patterns repris : tableau Projet, barre recherche + filtre + bouton, pastilles de statut, icône « groupe de personnes » (Équipe) et « poignée de main » (Clients) de la barre latérale. Aucune icône Paramètres : engrenage dessiné dans le même style (20 px, trait 2 px, extrémités carrées), à valider par Sacha.

## Décisions
- Attribution automatique : capacité hebdo et jours indisponibles **stockés seulement**, l'algorithme reste « le moins chargé + bonus d'habitude » (source : réponse de l'utilisateur).
- Clients et projets : créables et modifiables par admins **et** membres ; Équipe et Paramètres en écriture admin seulement, imposé par la RLS (source : réponse de l'utilisateur + ticket).
- Idées retenues : lien de connexion régénérable pour un invité jamais connecté, réintégrer un membre retiré, SIRET vérifié par clé de Luhn (exception La Poste), alerte de doublon client (même nom ou SIRET), rôle prospection exclu de l'attribution automatique, modifier le projet depuis sa page (source : réponse de l'utilisateur).
- Git : branche locale `feature/v0-2-clients-projets-equipe`, un commit par phase. Sacha pousse ; la production Vercel se déploie au push sur `main` du dépôt `sordulocontact-ux/sordulo-OS-APP`, inaccessible depuis le compte GitHub SaMo-Hub (source : réponse de l'utilisateur).
- Migration 0003 appliquée en production par l'éditeur SQL **par Sacha**, avant le push (source : ticket + réponse). Tests navigateur directement sur la base Supabase de production (source : réponse de l'utilisateur) : données de test nommées « Test V0.2 … » et archivées ou retirées à la fin.
- Rôle prospection : RLS d'écriture sur clients, contacts, projets et membres de projet réservée à admin et membre. La lecture reste ouverte à l'organisation (son espace viendra plus tard) ; l'interface lui masque Clients, Projets, Équipe et Paramètres et lui montre un état vide (choix par défaut, cohérent avec « la RLS reste la protection principale » sans casser les entrées/tickets existants).
- Retrait d'un membre = retrait doux (`members.removed_at`), jamais de suppression : la ligne reste (historique des entrées, tickets faits). `private.user_org_ids()` ignore les membres retirés, donc il ne voit plus rien et tombe sur « accès non autorisé » ; ses sessions Supabase sont révoquées ; `claim_membership`, le trigger `auth.users` et `requireOrgMember` ne relient plus un membre retiré (choix par défaut).
- Retrait : seules ses tâches **non terminées** passent en « non attribuée » ; les tâches faites gardent leur auteur (historique) (choix par défaut, l'objectif du ticket étant de ne pas perdre le travail à redistribuer).
- Un admin ne peut ni se retirer, ni retirer ou rétrograder le dernier admin actif : garde côté base (trigger + RPC), pas seulement dans l'interface (source : ticket).
- Retrait et réintégration par RPC SQL `remove_member` / `restore_member` (security definer, contrôle admin). Invitation et lien de connexion par `/api/members/invite` et `/api/members/link` (clé service, source : ticket).
- Lien de connexion : `auth.admin.generateLink({ type: 'magiclink' })` après création du compte (`email_confirm: true`), redirection vers l'origine de l'app (même mécanisme que pour Sacha, source : ticket). Régénération seulement pour un membre jamais connecté, pour qu'un admin ne puisse pas obtenir un accès au compte d'un membre actif (choix par défaut, sécurité).
- Membres d'un projet (`project_members`) : si le projet en a, l'attribution automatique se limite à eux (actifs, hors prospection), sinon à toute l'équipe active hors prospection (choix par défaut : c'est l'usage attendu de ce champ).
- Statuts de projet : `prospect`, `quote_sent`, `in_progress`, `delivered`, `paid`, `archived` ; `active` → `in_progress`, valeur inconnue → `in_progress` (seul `active` existe en base). Contrainte `check` ajoutée, défaut `in_progress` (source : ticket).
- `clients.contact_name` / `contact_email` **conservées** en base (jamais de suppression de données), reprises dans `client_contacts` comme contact principal, marquées obsolètes dans les types (source : ticket).
- Jours indisponibles = jours de la semaine récurrents (`unavailable_weekdays`, 1 = lundi … 7 = dimanche) (choix par défaut, « jours indisponibles réguliers »).
- Niveaux de compétence saisis de 1 à 5 dans l'interface (0 = ne pratique pas reste accepté par la base) (source : ticket).
- Client archivé : `archived_at`, masqué par défaut avec un filtre « Afficher les archivés » ; ses projets restent visibles (choix par défaut).
- Tests RLS durables : `supabase/tests/*.test.ts` sur PGlite, lancés par `npm test` (choix par défaut, les 46 tests du MVP n'avaient pas été gardés dans le repo).

## Hors périmètre
Devis, factures, catalogue, prospection (espace du rôle), tableau de bord, notifications, app de bureau macOS, version release Windows, prise en compte de la capacité dans l'attribution, envoi d'emails.

## Critères d'acceptation
- [x] Créer un nouveau client avec deux contacts, puis un projet pour ce client, sans toucher à la base.
  Preuve (Chrome, Supabase local, 20/11 14:40) : « Test V0.2 Atelier » (SIRET, adresse, Alice Test principale + Bruno Test), puis projet « Test V0.2 Site vitrine » depuis la fiche client.
- [x] Une entrée (texte ou réunion) fonctionne sur ce nouveau projet comme sur « App Ibé ».
  Preuve : retour écrit analysé (Claude) en quelques secondes, 1 ticket proposé, validé, tâche dans le kanban.
- [x] Ibé et « App Ibé » existent toujours, avec leur contact repris dans la nouvelle table et le statut « en cours ».
  Preuve : base locale remplie comme la prod avant la 0003 (Ibé avec `contact_name`/`contact_email`, App Ibé `active`), puis 0003 : contact repris en principal, App Ibé `in_progress`. À revérifier en prod après application.
- [x] Inviter un membre génère un lien qui le connecte directement, et il voit les données de Sordulo selon son rôle.
  Preuve : invitation « Test V0.2 Invité » (membre) → lien → connecté sur `/`, barre latérale Projets + Clients seulement. Réserve : l'invité apparaissait « Actif » avant sa connexion (corrigé en V0.3, RPC `member_sign_in_status`).
- [x] Un non-admin ne peut pas modifier l'équipe ni les paramètres, même en appelant Supabase directement (test RLS).
  Preuve : tests RLS + appels REST avec la session du membre invité : PATCH organizations et members → 0 ligne modifiée, `remove_member` → 403 « Réservé aux admins de l'organisation ».
- [x] Retirer un membre laisse ses tâches en « non attribuée ».
  Preuve : tâche attribuée à « Test V0.2 Membre », retrait depuis l'Équipe → kanban « Non attribuée ».
- [x] Le tone of voice d'un projet est bien pris en compte par l'analyse.
  Preuve : ton « Formel » + règle « chaque titre commence par Atelier : » → ticket « Atelier : Corriger le bouton Contact… ».
- [ ] Tests RLS de la migration 0003, typecheck, lint, tests et build passent. Déployé sur Vercel.
  Tests, typecheck, lint, build : OK (216 tests dont 20 RLS). Non coché : migration 0003 pas encore appliquée en production et déploiement fait par Sacha (push).
- [x] Toutes les valeurs de style viennent des tokens. Vérifié dans le navigateur sur chaque nouvel écran, états vides et erreurs compris.
  Preuve : Projets, Clients, fiche client, Équipe, invitation, retrait, page projet vus dans Chrome. Réserve : tableaux écrasés sous ~500 px de large (corrigé en V0.3 : défilement horizontal).

## Lots
| Lot | Objectif | Fichiers possédés | Dépend de | Modèle / effort | Statut |
|---|---|---|---|---|---|
| L0 | Socle : types, contrat API, SIRET, routes, navigation, icônes, garde de rôle, clés de requête, tokens, stubs | src/shared/types.ts, src/shared/api-contract.ts, src/shared/siret*, src/app/, src/assets/icons/, src/lib/queryKeys.ts, src/styles/tokens.css, src/features/auth/ (garde) | - | orchestrateur | validé |
| L1 | Base : migration 0003, RLS, RPC retrait/réintégration, tests RLS PGlite, seed, README supabase | supabase/, scripts/, package.json, package-lock.json | L0 (types) | opus / high | validé |
| L2 | API : invitation, lien de connexion, membres retirés exclus, attribution (prospection, membres du projet), test tone of voice, client API | api/, src/shared/assignment*, src/lib/api.ts | L0 (contrat) | opus / high | validé |
| L3 | Clients : liste, fiche, formulaire, contacts, archivage, doublons | src/features/clients/ | L0 | sonnet / medium | validé (code) |
| L4 | Projets : filtres, nouveau projet, formulaire (statut, dates, membres, tone of voice), modifier depuis la page projet | src/features/projects/ | L0 | sonnet / medium | validé (code) |
| L5 | Équipe et Paramètres : liste, invitation, modification, retrait/réintégration, lien ; paramètres de l'organisation | src/features/team/, src/features/settings/ | L0, L2 (client API) | sonnet / medium | validé (code) |
| L7 | Pages de liste façon Midday / Figma « Contrats » : cartes de chiffres, barre d'outils compacte, pastilles, avatar, échéance relative, menu « … » | src/components/ui/, src/features/projects/, clients/, team/ | L3–L5 | sonnet / medium | validé (code) |
| L6 | Intégration : membres retirés hors des listes d'attribution (kanban, validation), vérification navigateur, corrections | src/features/tasks/, src/features/review/, src/features/inputs/ + corrections ciblées | L1–L5 | orchestrateur | validé |

## Journal
- 12:30 Exploration, questions, branche créée. L0 : types, contrat API membres, `src/shared/siret.ts` (+ 5 tests).
- 12:35 L1 (base) et L2 (API) lancés.
- 12:45 L0 validé : icônes Clients (poignée de main) et Équipe (Figma), engrenage Paramètres (dessiné, à valider), navigation filtrée par rôle, routes sous `RequireRole`, `dataTable.module.css` partagé, `ProjectStatus`, stubs de pages et `ProjectFormModal` (interface figée), tokens `--color-success-dot` / `--color-warning-dot` (absents du Figma, à valider). Typecheck et lint OK.
- 12:50 L3 (Clients), L4 (Projets), L5 (Équipe, Paramètres) lancés.
- 12:58 L4 rendu : formulaire projet (statut, dates, membres, tone of voice avec 4 modèles et confirmation avant remplacement), filtres Statut/Client dans l'URL, « Modifier » sur la page projet. Typecheck, lint, 8 tests OK. Validé sur le code, navigateur après la 0003.
- 13:00 L3 rendu : liste, fiche (infos, contacts, projets), formulaires client et contact, archivage, doublons, contact principal unique. 13 tests, lint OK. Validé sur le code, navigateur après la 0003.
- 13:05 L5 rendu : Équipe (invitation avec lien à copier, nouveau lien, modification, retrait avec confirmation, réintégration) et Paramètres (3 sections, diff des champs). 15 tests, typecheck et lint OK. À recaler sur les messages d'erreur exacts de la 0003.
- 13:15 L2 rendu puis repris (1 aller-retour) : `/api/members/invite` et `/api/members/link`, `requireOrgAdmin`, membres retirés ignorés, attribution limitée aux membres actifs hors prospection (et aux membres du projet s'il en a), règle 15 du prompt (rédiger dans le ton de voix), test du ton jusqu'à Claude et Mistral. Décision : une invitation pour un email dont le compte s'est déjà connecté ajoute le membre sans lien (`link: null`), pour qu'un admin n'obtienne jamais l'accès au compte de quelqu'un d'autre. `APP_URL` documentée dans `.env.example`. 99 tests api/shared, tsc api OK. Validé.
- 13:16 L5 repris pour `link: null` (modale « Membre ajouté »). Typecheck, lint OK.
- 13:25 L1 rendu : migration 0003 (rejouable, aucune suppression), droits par colonne sur `members` et `organizations`, trigger `members_10_guard` (dernier admin, retrait de soi), RPC `remove_member` / `restore_member`, reprise des contacts, 20 tests RLS PGlite (cassage volontaire vérifié à 5 endroits). Orchestrateur : tests RLS branchés sur `npm test` (vite.config.ts), `test:rls` = `vitest run supabase`, `supabase/.temp` supprimé, messages d'erreur de l'Équipe calés sur ceux de la base (+ test). Typecheck, lint, 203/203 tests. Validé.
- 13:30 Migration 0003 copiée pour Sacha (éditeur SQL de production). Attente de `.env.local` pour la vérification navigateur.
- 13:40 L6 (partiel) : membres retirés et prospection hors des listes d'attribution (kanban, validation), filtre « Personne » garde un retiré s'il a encore des tâches. CLAUDE.md du projet mis à jour (écrans, rôles, migrations, tests RLS). Commit `c2192ec`.
- 13:45 Demande de Sacha : s'inspirer de l'écran « Invoices » de Midday pour les listes. Repris : cartes de chiffres, recherche compacte, pastilles de statut, avatar client, échéance relative, menu « … ». Écarté : cases à cocher (aucune action groupée), icône réglages (rien à régler), filtres cachés derrière l'entonnoir (2 filtres seulement, mieux visibles), « + » sans libellé (le ticket demande « Nouveau projet »). Tokens ajoutés : `--size-search-max`, `--size-menu-min` (remplace le `12rem` en dur du menu du compte), `--size-stat-card-min` ; icône `more.svg`. L7 lancé.
- 13:45 Migration 0003 pas encore en production ; `SUPABASE_DB_URL` à remplir dans `.env.local` pour `npm run db:migrate`.
- 13:55 L7 rendu : `StatCard`, `ActionsMenu` (clavier complet), `Avatar size="sm"`, statuts de projet en `Badge`, cartes sur Projets (cliquables, filtrent par statut), Clients (dont « Fiches à compléter » pour les futurs devis) et Équipe (capacité totale), échéance relative, menu « … ». Orchestrateur : tokens `--color-success-dot` / `--color-warning-dot` retirés (plus utilisés). Typecheck, lint, 216 tests, build OK.
- 14:30 Vérification sur un Supabase local (Docker, ports 565xx) : 0001 + 0002, données comme la prod, puis 0003 (reprise OK). Worktree de la branche sur le port 5180.
- 14:45 Chrome : client à deux contacts, projet avec ton de voix, entrée analysée, invitation + connexion par le lien, droits refusés en REST, retrait → tâche non attribuée. Bug : invité affiché « Actif » (le compte est relié dès l'invitation) → corrigé en V0.3.
- 15:40 Clôture : critères cochés, rapport, archivage. Suite dans `.tickets/2026-11-20-v0-3-devis-factures-accueil/`.

## Rapport

**Fait** : clients (liste, fiche, contacts avec un seul principal, archivage, doublons, SIRET Luhn), projets (statuts, dates, membres, ton de voix avec modèles, filtres dans l'URL, création depuis la fiche client et la liste, modification depuis la page projet), Équipe (invitation avec lien à usage unique via `/api/members/invite`, régénération, modification, retrait doux, réintégration), Paramètres de l'organisation, rôles dans la navigation et la RLS, attribution sans prospection ni membres retirés, ton de voix dans l'analyse. Pages de liste façon Midday / Figma.

**Fichiers** : `supabase/migrations/0003_clients_projects_team.sql` + `supabase/tests/rls.test.ts`, `api/members/*`, `api/_lib/{auth,members,pipeline,analysis}.ts`, `src/features/{clients,projects,team,settings}/`, `src/components/ui/` (StatCard, ActionsMenu, dataTable), `src/shared/{types,siret,api-contract,assignment}.ts`, `src/app/`, `CLAUDE.md`.

**Vérifications** : typecheck, lint, 216 tests (dont 20 RLS PGlite), build ; parcours complets dans Chrome sur un Supabase local (voir critères).

**Décisions prises sans demander** : invitation d'un email déjà connecté = membre ajouté sans lien ; tokens `--size-search-max`, `--size-menu-min`, `--size-stat-card-min` ; engrenage Paramètres dessiné (à valider par Sacha).

**Reste à faire** :
- Appliquer la 0003 en production (`npm run db:migrate` avec `SUPABASE_DB_URL`, ou éditeur SQL), PUIS pousser. Ajouter l'URL de l'app dans Supabase > Auth > Redirect URLs et `APP_URL` sur Vercel.
- Corrigés dans la V0.3 (même lot de push) : statut « invité » avant la première connexion, tableaux sur écran étroit.

**Idées non retenues** : cases à cocher et actions groupées dans les listes (aucune action groupée utile pour l'instant).
