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
- [ ] Ticket V0.2 vérifié dans le navigateur (critères cochés avec preuves), rapport écrit, dossier archivé, commit sur sa branche.
- [ ] Migration 0003 appliquée en production (dès que `SUPABASE_DB_URL` est fourni).

V0.3 :
- [ ] Un admin ou un membre `finance` crée un devis pour un client (lignes, TVA, totaux), l'envoie, le marque accepté : le projet passe en « en cours ».
- [ ] Depuis un devis accepté : créer une facture complète ou une facture d'acompte en %. Dupliquer un devis.
- [ ] Émettre une facture lui donne un numéro continu et la fige (modification refusée par la base) ; un avoir l'annule ; payée → projet « payé » quand toutes ses factures le sont.
- [ ] Aperçu A4 imprimable d'un devis et d'une facture, avec mentions légales (vendeur, acheteur, SIRET, TVA ou mention d'exonération, échéance, pénalités, indemnité de 40 €, IBAN si renseigné).
- [ ] Export CSV des factures émises.
- [ ] Accueil `/` avec cartes réelles selon le rôle ; Projets à `/projects`.
- [ ] Prospection : liste, étapes, prochaine action, conversion en client. Un `prospection` ne voit que Accueil et Prospection.
- [ ] Rôle `finance` : voit Accueil, Devis, Factures, Clients et Projets en lecture ; la base refuse toute écriture hors devis / factures (tests RLS).
- [ ] L'attribution automatique tient compte de la capacité et des jours indisponibles (tests).
- [ ] Tests RLS de la 0004, typecheck, lint, tests, build OK ; toutes les valeurs de style viennent des tokens ; vérifié dans le navigateur (états vides, erreurs compris).

## Lots

| Lot | Objectif | Fichiers possédés | Dépend de | Modèle / effort | Statut |
|---|---|---|---|---|---|
| L0 | Socle front : types, rôles, routes, navigation, clés de requête, icônes | `src/shared/types.ts`, `src/features/auth/roles.ts`, `src/features/auth/RequireRole.tsx`, `src/app/**`, `src/lib/queryKeys.ts`, `src/assets/icons/**`, liens « / » des projets | - | orchestrateur | validé |
| L1 | Migration 0004 + tests RLS + README | `supabase/**`, `scripts/db-seed.mjs` | - | opus / high | à faire |
| L2 | Logique de facturation partagée + composants communs (lignes, aperçu A4, montants) | `src/shared/billing.ts`, `src/shared/billing.test.ts`, `src/features/billing/**` | L0 | sonnet / medium | à faire |
| L3 | Attribution par capacité | `src/shared/assignment.ts`, `src/shared/assignment.test.ts`, `api/_lib/pipeline.ts`, `api/_lib/pipeline.test.ts`, `src/features/review/diff.ts` (+ test) | - | sonnet / medium | validé |
| L4 | Devis : liste, édition, envoi / acceptation, duplication, aperçu | `src/features/quotes/**` | L0, L2 | sonnet / medium | à faire |
| L5 | Factures : liste, brouillon, émission, paiement, avoir, acompte, export CSV, aperçu | `src/features/invoices/**` | L0, L2 | sonnet / medium | à faire |
| L6 | Prospection : liste, étapes, fiche, conversion | `src/features/prospects/**` | L0 | sonnet / medium | à faire |
| L7 | Accueil | `src/features/home/**` | L0 | sonnet / medium | à faire |
| L8 | Paramètres (facturation) et Équipe (rôle finance) | `src/features/settings/**`, `src/features/team/**` | L0 | sonnet / medium | à faire |
| L10 | Barre d'outils des listes (recherche pleine largeur + bouton filtre + bouton « + », Figma 61:2989) sur Projets, Clients, Équipe ; lecture seule finance | `src/components/ui/ListToolbar.*`, `IconButton.*`, `index.ts`, `dataTable.module.css`, `src/features/projects/ProjectsPage.*`, `projectLogic.*`, `src/features/clients/**`, `src/features/team/TeamPage.*`, `teamFilters.*` | L0 | sonnet / medium | en cours |
| L9 | Clôture V0.2 (navigateur, rapport, archive) | `.tickets/2026-11-20-v0-2-clients-projets-equipe/**` (worktree V0.2) | - | orchestrateur | en cours |

## Journal

- 14:25 Questions posées et répondues ; branche `feature/v0-3-devis-factures-accueil` créée depuis `b2a1fbb`.
- 14:30 Supabase local démarré (ports 565xx). V0.2 : 0001 + 0002 appliquées, données comme en prod (Ibé avec `contact_name`, App Ibé `active`), puis 0003 : contact repris en principal, App Ibé `in_progress`.
- 14:40 L1 (opus) et L3 (sonnet) lancés.
- 14:55 L3 rendu et validé (charge relative, capacité 0 exclue, indisponible du jour relégué ; 136 tests front OK). L0 fait (types, rôles ALL/CLIENT_READ/FINANCE/PROSPECT, routes, nav Accueil / Projets / Clients / Prospection / Devis / Factures / Équipe / Paramètres, icônes file-text, receipt, target dessinées). Commit `e58c617`.
- 14:58 Demande de Sacha : barre d'outils façon Figma « Contrats » partout → lot L10. L10, L2, L8 lancés.
