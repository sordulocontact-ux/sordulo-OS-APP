# Sordulo OS V0.3 : devis, factures, accueil, prospection et attribution par capacité

## Ticket d'origine

Demande de l'utilisateur (« fais tout ça », 20/11/2026), après la V0.2 :

1. Finir la V0.2 en cours (`.tickets/2026-11-20-v0-2-clients-projets-equipe/`) : migration 0003 (en prod dès que `SUPABASE_DB_URL` est fourni, sinon vérification sur un Supabase local Docker), vérification navigateur de tous les critères, rapport, archivage.
2. Devis et factures (réutilise SIRET, adresse de facturation, mention TVA, taux journalier/horaire, statuts projet « devis envoyé » et « payé »).
3. Attribution automatique qui tient compte de la capacité hebdomadaire et des jours indisponibles (déjà stockés).
4. Tableau de bord / Accueil (écran Accueil du Figma SORDULO-OS : contrats, finance).
5. Espace prospection (le rôle existe mais ne voit aucune page).

Hors périmètre : chantier de Maël (île, app de bureau, release Windows, macOS, `src-tauri`, `features/desktop`), notifications, réorganisation automatique des tâches.

## Contexte

- React 19 + Vite 8 + TS strict, TanStack Query, CSS Modules + `src/styles/tokens.css`, kit `src/components/ui/` (dont `StatCard`, `ActionsMenu`, `Icon`, `SearchField`, `dataTable.module.css`). Supabase (RLS = protection principale), fonctions `/api` pour les clés secrètes.
- V0.2 (branche `feature/v0-2-clients-projets-equipe`) : clients + contacts, projets à statuts (`prospect`, `quote_sent`, `in_progress`, `delivered`, `paid`, `archived`), équipe (rôles admin / membre / prospection, retrait doux), paramètres légaux de l'organisation (raison sociale, forme, SIRET, adresse, mention TVA, taux journalier / horaire).
- Figma « SORDULO-OS » (fichier `5qgnyHkuGcwLc7Gb94ijgF`) :
  - **Accueil** (node `1:1992`) : « Bonjour Sacha », « Voici un aperçu rapide : », 4 cartes bordées (icône + libellé gris, phrase où les chiffres et noms sont en noir et le reste en gris, lien gris « Voir … » en bas) : Contrats, Équipe, Finance (barres noires et grises sur 6 mois), Sortie. Barre de chat en bas (hors périmètre).
  - **Contrats** (node `61:2989`) : 3 cartes de chiffres (montant en serif, « En attente » / « Accepté » / « Refusé », « 1 entrée »), recherche + filtre + « + », tableau Contrat / Client / Montant / Statut (pastilles Non traité gris, En attente bleu, Accepté vert, Refusé rouge) / Priorité.
  - Barre latérale : Accueil (maison) en premier, puis Projets (mallette)… et une icône « document » (`Frame` 11:1106 et suivants) pour les contrats.
- Supabase local de test : `scratchpad/localdb` (ports 565xx, API `http://127.0.0.1:56521`, DB `postgresql://postgres:postgres@127.0.0.1:56522/postgres`), env dans `scratchpad/localdb/env.local`. Worktree V0.2 : `scratchpad/v02`.

## Décisions

- Facture : brouillon modifiable ; « Émettre » attribue le numéro définitif et fige la facture ; correction par **avoir** qui annule la facture (réponse utilisateur).
- Accès finance (devis, factures, chiffres de l'Accueil) : **admin et nouveau rôle `finance`** (réponse utilisateur). `finance` lit clients et projets (et leurs contacts / membres de projet), n'écrit que devis et factures, ne voit ni tâches, ni entrées, ni tickets, ni Équipe, ni Paramètres ; jamais attribué automatiquement (réponse utilisateur).
- PDF : page d'aperçu A4 + « Télécharger en PDF » par l'impression du navigateur, sans dépendance (réponse utilisateur).
- Statut projet automatique, seulement vers l'avant, jamais sur un projet archivé : devis envoyé → `quote_sent` (depuis `prospect`) ; devis accepté → `in_progress` (depuis `prospect` / `quote_sent`) ; toutes les factures (type facture, hors acompte et avoir, non annulées) du projet payées → `paid` (réponse utilisateur).
- Accueil : cartes sur les données réelles, selon le rôle ; sans dépenses ni barre de chat (réponse utilisateur).
- Prospection : liste + étapes (à contacter, contacté, relancé, rendez-vous, gagné, perdu) + date de prochaine action + conversion en client en un clic ; visible par prospection et admins (réponse utilisateur).
- Attribution : charge relative à la capacité (heures ouvertes ÷ capacité hebdo) ; un membre indisponible aujourd'hui (jour Europe/Paris) passe après les autres ; capacité 0 = jamais attribué (réponse utilisateur).
- Idées retenues : devis accepté → facture (ou facture d'acompte en %), mentions légales automatiques (échéance 30 j par défaut, pénalités de retard, indemnité 40 €, mention TVA, badge « En retard »), dupliquer un devis, export CSV comptable (réponse utilisateur).
- Migrations : l'utilisateur remplit `SUPABASE_DB_URL` ; tout est testé sur le Supabase local, puis `npm run db:migrate` en prod juste avant son push (réponse utilisateur).
- Git : branche `feature/v0-3-devis-factures-accueil` partie de la V0.2, un commit par phase ; l'utilisateur pousse (réponse utilisateur).
- Barre d'outils des listes (demande de Sacha en cours de ticket) : recherche sur toute la largeur, bouton carré « filtre » qui ouvre un panneau de filtres, bouton carré « + » à la place des boutons texte « Nouveau … », sur Projets, Clients, Équipe et toutes les nouvelles listes (réponse utilisateur, Figma 61:2989).
- Accueil devient la page `/` ; la liste des projets passe à `/projects` (Figma : maison en premier, mallette ensuite) (choix par défaut).
- Libellés : la page s'appelle « Devis » (le Figma dit « Contrats », mais un devis n'est pas un contrat : signalé à Sacha) ; statuts devis Brouillon / Envoyé / Accepté / Refusé, « Expiré » affiché quand la date de validité est passée sur un devis envoyé (choix par défaut).
- Montants en centimes entiers (`bigint`), TVA par ligne, arrondis : HT ligne = arrondi(quantité × PU) ; TVA = arrondi(somme HT du taux × taux / 100) par taux ; TTC = HT + TVA. Calcul identique en SQL (trigger, source de vérité) et dans `src/shared/billing.ts` (aperçu) (choix par défaut).
- Numérotation : devis `D-AAAA-NNN` à la création ; factures et acomptes `F-AAAA-NNNN` à l'émission ; avoirs `A-AAAA-NNNN` ; séries continues par organisation et par année, attribuées en base (choix par défaut, obligation légale de continuité).
- À l'émission, les infos du vendeur (organisation) et de l'acheteur (client, adresse de facturation, SIRET) sont copiées dans la facture : un changement d'adresse ultérieur ne modifie pas une facture émise (choix par défaut, obligation légale).

## Modèle de données (contrat pour tous les lots)

Migration `supabase/migrations/0004_finance_prospection.sql`.

- `members.role` : ajoute `'finance'`.
- `organizations` (+ écriture admin par colonne) : `default_vat_rate numeric(5,2) not null default 20`, `payment_terms_days int not null default 30` (0 à 60), `quote_validity_days int not null default 30`, `bank_iban text`, `bank_bic text`.
- Ligne de document (jsonb, tableau) : `{ "label": string, "description": string|null, "quantity": number > 0, "unit": "day"|"hour"|"flat"|"unit", "unit_price_cents": integer (HT, négatif seulement sur un avoir), "vat_rate": number 0..100 }`.
- `quotes` : `id, organization_id, client_id (not null), project_id, number text (D-AAAA-NNN, auto), title text not null, status ('draft','sent','accepted','refused') default 'draft', issue_date date default current_date, valid_until date, lines jsonb default '[]', notes text, total_ht_cents bigint, total_vat_cents bigint, total_ttc_cents bigint (calculés par trigger), sent_at, accepted_at, refused_at, created_by (members), created_at, updated_at`. Modifiable sauf si accepté ou refusé ; suppression des brouillons seulement.
- `invoices` : `id, organization_id, client_id (not null), project_id, quote_id, kind ('invoice','deposit','credit_note') default 'invoice', status ('draft','issued','paid','cancelled') default 'draft', number text (null en brouillon), title text not null, issue_date date, due_date date, lines jsonb, notes text, deposit_percent numeric(5,2), credited_invoice_id, seller jsonb, buyer jsonb, totals (comme quotes), issued_at, paid_at, cancelled_at, created_by, created_at, updated_at`. Hors brouillon, seuls `issued ↔ paid` (avec `paid_at`) sont permis par update ; suppression des brouillons seulement.
- RPC `issue_invoice(p_invoice_id uuid) returns invoices` et `create_credit_note(p_invoice_id uuid) returns invoices` (security definer, admin / finance).
- `prospects` : `id, organization_id, company text not null, website, contact_name, contact_email, contact_phone, source, stage ('to_contact','contacted','followed_up','meeting','won','lost') default 'to_contact', next_action_date date, notes, owner_member_id, client_id, created_by, created_at, updated_at`. Pas de suppression.
- RPC `convert_prospect(p_prospect_id uuid) returns uuid` (id du client ; admin / prospection ; idempotent).

## Hors périmètre

- Dépenses (« Sortie »), barre de chat de l'Accueil, envoi des devis / factures par email, paiement en ligne, relances automatiques, signature électronique.
- Chantier de Maël (île, app de bureau, `src-tauri`, `src/features/desktop`), notifications, réorganisation automatique des tâches.

## Critères d'acceptation

V0.2 :
- [x] Ticket V0.2 vérifié dans le navigateur (critères cochés avec preuves), rapport écrit, dossier archivé, commit sur sa branche.
  Preuve : `ab33953` sur `feature/v0-2-clients-projets-equipe`, fusionné dans la V0.3 (`72ae5d9`).
- [x] Migration 0003 appliquée en production (dès que `SUPABASE_DB_URL` est fourni).
  Preuve (MCP Supabase, lecture seule, projet `sordulo-os`) : `client_contacts` existe, App Ibé `in_progress`. Ibé n'avait ni nom ni email de contact en prod : rien à reprendre.

V0.3 :
- [x] Un admin ou un membre `finance` crée un devis pour un client (lignes, TVA, totaux), l'envoie, le marque accepté : le projet passe en « en cours ».
  Preuve (Chrome, base locale) : D-2026-001, 2 lignes à 20 % et 5,5 %, 2 226,95 € TTC identique front / base ; projet prospect → devis envoyé → en cours. Finance : lit et écrit les devis (REST).
- [x] Depuis un devis accepté : créer une facture complète ou une facture d'acompte en %. Dupliquer un devis.
  Preuve : acompte 30 % (561,10 € HT réparti par taux), facture de solde qui déduit l'acompte (1 558,86 €). Duplication : tests `quoteLogic` / `billing` (non rejouée dans le navigateur).
- [x] Émettre une facture lui donne un numéro continu et la fige (modification refusée par la base) ; un avoir l'annule ; payée → projet « payé » quand toutes ses factures le sont.
  Preuve : F-2026-0001, F-2026-0002, A-2026-0001 (−2 226,95 €, facture d'origine annulée), projet « payé » ; blocages vérifiés par 47 tests RLS et sur le Postgres local.
- [x] Aperçu A4 imprimable d'un devis et d'une facture, avec mentions légales (vendeur, acheteur, SIRET, TVA ou mention d'exonération, échéance, pénalités, indemnité de 40 €, IBAN si renseigné).
  Preuve : captures `11-apercu-devis`, `12-apercu-facture`, `23-apercu-solde` (+ n° TVA intracommunautaire calculé).
- [x] Export CSV des factures émises.
  Preuve : export capturé dans la page (BOM, `;`, virgule décimale, 3 lignes, brouillons exclus).
- [x] Accueil `/` avec cartes réelles selon le rôle ; Projets à `/projects`.
  Preuve : Accueil admin (devis accepté, encaissé 6 mois, équipe), finance et prospection vus.
- [x] Prospection : liste, étapes, prochaine action, conversion en client. Un `prospection` ne voit que Accueil et Prospection.
  Preuve : barre latérale « Accueil, Prospection », `/clients` → « Accès réservé », prospect créé (retard affiché), converti (client + contact principal, `won_at`).
- [x] Rôle `finance` : voit Accueil, Devis, Factures, Clients et Projets en lecture ; la base refuse toute écriture hors devis / factures (tests RLS).
  Preuve : barre latérale « Accueil, Projets, Clients, Devis, Factures », fiche client sans bouton, PATCH client → 0 ligne, 0 tâche et 0 entrée lisibles ; tests RLS.
- [x] L'attribution automatique tient compte de la capacité et des jours indisponibles (tests).
  Preuve : `assignment.test.ts` (charge relative, capacité 0, indisponible du jour, tous indisponibles, minuit à Paris).
- [x] Tests RLS de la 0004, typecheck, lint, tests, build OK ; toutes les valeurs de style viennent des tokens ; vérifié dans le navigateur (états vides, erreurs compris).
  Preuve : 375 tests (dont 47 RLS), typecheck, lint, build ; grep des CSS sans valeur en dur ; états vides vus (Devis, Accueil, Prospection), mobile 375 px.

## Lots

| Lot | Objectif | Fichiers possédés | Dépend de | Modèle / effort | Statut |
|---|---|---|---|---|---|
| L0 | Socle front : types, rôles, routes, navigation, clés de requête, icônes | `src/shared/types.ts`, `src/features/auth/roles.ts`, `src/features/auth/RequireRole.tsx`, `src/app/**`, `src/lib/queryKeys.ts`, `src/assets/icons/**`, liens « / » des projets | - | orchestrateur | validé |
| L1 | Migration 0004 + tests RLS + README | `supabase/**`, `scripts/db-seed.mjs` | - | opus / high | validé |
| L2 | Logique de facturation partagée + composants communs (lignes, aperçu A4, montants) | `src/shared/billing.ts`, `src/shared/billing.test.ts`, `src/features/billing/**` | L0 | sonnet / medium | validé |
| L3 | Attribution par capacité | `src/shared/assignment.ts`, `src/shared/assignment.test.ts`, `api/_lib/pipeline.ts`, `api/_lib/pipeline.test.ts`, `src/features/review/diff.ts` (+ test) | - | sonnet / medium | validé |
| L4 | Devis : liste, édition, envoi / acceptation, duplication, aperçu | `src/features/quotes/**` | L0, L2 | sonnet / medium | validé |
| L5 | Factures : liste, brouillon, émission, paiement, avoir, acompte, export CSV, aperçu | `src/features/invoices/**` | L0, L2 | sonnet / medium | validé |
| L6 | Prospection : liste, étapes, fiche, conversion | `src/features/prospects/**` | L0 | sonnet / medium | validé |
| L7 | Accueil | `src/features/home/**` | L0 | sonnet / medium | validé |
| L8 | Paramètres (facturation) et Équipe (rôle finance) | `src/features/settings/**`, `src/features/team/**` | L0 | sonnet / medium | validé |
| L10 | Barre d'outils des listes (recherche pleine largeur + bouton filtre + bouton « + », Figma 61:2989) sur Projets, Clients, Équipe ; lecture seule finance | `src/components/ui/ListToolbar.*`, `IconButton.*`, `index.ts`, `dataTable.module.css`, `src/features/projects/ProjectsPage.*`, `projectLogic.*`, `src/features/clients/**`, `src/features/team/TeamPage.*`, `teamFilters.*` | L0 | sonnet / medium | validé |
| L9 | Clôture V0.2 (navigateur, rapport, archive) | `.tickets/2026-11-20-v0-2-clients-projets-equipe/**` (worktree V0.2) | - | orchestrateur | validé |
| P1 | Finition des documents : vendeur, SIRET / IBAN groupés, n° TVA intracommunautaire, barre d'impression, lignes en lecture seule, export CSV dans l'en-tête | `src/features/billing/**`, `src/shared/vat.*`, `src/features/invoices/InvoicesPage.tsx`, `invoiceLogic.*` | L2, L5 | sonnet / medium | validé |
| P2 | Facture de solde (déduction des acomptes), lignes négatives sur facture si total ≥ 0 | `supabase/**` (0004), `src/shared/billing.*`, `src/features/quotes/**`, `src/features/invoices/InvoicePage.tsx` | L1, L4, L5 | opus / high | validé |
| L11 | Page Connecteurs (Figma « Connector », Midday « Apps ») | `src/features/connectors/**` | L0 | sonnet / medium | validé |

## Journal

- 14:25 Questions posées et répondues ; branche `feature/v0-3-devis-factures-accueil` créée depuis `b2a1fbb`.
- 14:30 Supabase local démarré (ports 565xx). V0.2 : 0001 + 0002 appliquées, données comme en prod (Ibé avec `contact_name`, App Ibé `active`), puis 0003 : contact repris en principal, App Ibé `in_progress`.
- 14:40 L1 (opus) et L3 (sonnet) lancés.
- 14:55 L3 rendu et validé (charge relative, capacité 0 exclue, indisponible du jour relégué ; 136 tests front OK). L0 fait (types, rôles ALL/CLIENT_READ/FINANCE/PROSPECT, routes, nav Accueil / Projets / Clients / Prospection / Devis / Factures / Équipe / Paramètres, icônes file-text, receipt, target dessinées). Commit `e58c617`.
- 14:58 Demande de Sacha : barre d'outils façon Figma « Contrats » partout → lot L10. L10, L2, L8 lancés.
- 15:05 L8 rendu et validé (carte Facturation : TVA, délais, IBAN mod 97, BIC ; rôle finance dans l'Équipe). L10 rendu et validé (`ListToolbar`, `IconButton`, Projets / Clients / Équipe, lecture seule finance). L6 lancé.
- 15:15 V0.2 dans Chrome (worktree) : critères vérifiés. Bug : invité « Actif » avant connexion → RPC `member_sign_in_status` demandée à L1.
- 15:20 L2 rendu et validé. L4, L5, L7 lancés. L6 rendu : `won_at` demandé à L1 pour « Gagnés ce mois ».
- 15:45 L4, L7, L1 (0004 + 45 tests RLS, vrai Postgres local), L5 rendus et validés. Statut « invité » branché (Équipe, Accueil). Typecheck, lint, 350 tests, build OK. Commit `5bedd33`.
- 16:00 Extension Chrome déconnectée (machine saturée) : vérification par Chrome sans interface piloté en CDP (script dans le scratchpad). Parcours complet admin : paramètres, devis D-2026-001 (totaux identiques front / base), envoi → projet « devis envoyé », accepté → « en cours », acompte 30 % F-2026-0001, facture F-2026-0002, payées → projet « payé », avoir A-2026-0001, aperçus A4, CSV. Prospection : création, conversion (client + contact principal). Finance : navigation, lecture seule, écritures refusées en REST. Corrigés : brouillons créés sans ligne, prospects (colonnes posées par la base), rafraîchissement du statut invité, tableaux sur mobile. Commit `a4f4ed3`.
- 16:10 Facture complète créée sans déduire l'acompte → lot P2 (facture de solde). Défauts d'aperçu → lot P1. V0.2 archivée. CLAUDE.md à jour (`b0766c8`).
- 16:30 P1 et P2 rendus et validés : solde vérifié dans le navigateur (1 558,86 € = 2 226,95 − 668,09), aperçu corrigé. 372 tests, build OK. Demande de Sacha : page Connecteurs → L11 lancé (route `/connectors` admin, icône `apps.svg` dessinée).
- 16:45 L11 rendu et validé dans le navigateur (catalogue honnête : 4 connectés, 10 à venir ; « À venir » au lieu de « Bientôt disponible » sur deux lignes ; Supabase en « Infrastructure »). 375 tests, build OK.
- 16:50 Production lue par le MCP Supabase (lecture seule) : 0003 déjà appliquée, 0004 non. Application de la 0004 laissée à la décision de Sacha.

## Rapport

**Fait** : devis (D-AAAA-NNN, lignes multi-TVA, envoi / acceptation / refus, duplication, facture complète, acompte en %, facture de solde qui déduit les acomptes), factures (brouillon, émission numérotée et figée, paiement, avoir, export CSV), aperçus A4 imprimables avec mentions légales et n° TVA intracommunautaire, Accueil par rôle (devis, factures, finance 6 mois, prospection, travail, équipe), Prospection (étapes, relances, conversion en client), rôle finance, attribution par capacité et jours indisponibles, paramètres de facturation (TVA, délais, IBAN / BIC), barre d'outils des listes façon Figma (recherche + filtre + « + ») sur toutes les listes, page Connecteurs, statut « invité » réel. Clôture et archivage de la V0.2.

**Fichiers** : `supabase/migrations/0004_finance_prospection.sql`, `supabase/tests/{harness,finance}.test.ts`, `src/shared/{types,billing,vat,assignment}.ts`, `src/features/{home,quotes,invoices,billing,prospects,connectors}/`, `src/features/{settings,team,projects,clients,auth}/`, `src/components/ui/{ListToolbar,IconButton,Icon}`, `src/app/`, `src/assets/icons/{file-text,receipt,target,apps}.svg`, `src/styles/tokens.css`, `api/_lib/pipeline.ts`, `CLAUDE.md`.

**Vérifications** : typecheck, lint, 375 tests (47 RLS), build ; parcours complets sur un Supabase local (Docker) dans Chrome (extension puis Chrome sans interface piloté en CDP quand l'extension a décroché).

**Décisions prises sans demander** : Accueil à `/` et Projets à `/projects` ; page « Devis » (le Figma dit « Contrats ») ; numérotation D / F / A ; facture de solde avec lignes négatives (total HT et TTC ≥ 0) ; avoir = annulation totale ; un avoir n'empêche pas le projet de passer « payé » ; montants TTC pour « à encaisser », HT pour le chiffre d'affaires ; « Gagnés ce mois » sur `won_at` ; prospection ne lit plus clients, projets, tâches (elle pouvait avant la 0004) ; catalogue de connecteurs honnête (rien d'installable).

**Reste à faire** :
- Appliquer la 0004 en production AVANT de pousser (MCP Supabase ou `npm run db:migrate` ; la 0003 y est déjà). Puis pousser `feature/v0-3-devis-factures-accueil` (contient la V0.2). Vérifier `APP_URL` sur Vercel et l'URL de l'app dans Supabase > Auth > Redirect URLs.
- Pour Sacha : vrais logos des connecteurs à exporter du Figma (`logo` dans `catalog.ts`) ; icônes dessinées (file-text, receipt, target, apps, settings) à valider ; « Devis » au lieu de « Contrats ».
- Limites connues : rien n'empêche deux factures de solde pour un même devis ; tâches sans date de fin (carte Équipe = tâches en cours) ; le garde-fou « modifications non enregistrées » du devis ne couvre pas le bouton retour du navigateur ; en mode dev, le premier chargement attend ~2 s (modules Vite non regroupés).

**Idées non retenues** : dépenses (carte « Sortie »), barre de chat de l'Accueil, envoi des documents par email, vrai flux d'installation des connecteurs.
