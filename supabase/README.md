# Base de données (Supabase)

Schéma : `migrations/*.sql`, appliquées dans l'ordre. Il doit correspondre à `src/shared/types.ts`.

| Migration | Contenu |
|---|---|
| `0001_init.sql` | Tables, RLS par organisation, liaison compte ↔ membre, bucket audio |
| `0002_ticket_area.sql` | Partie du produit et raison de l'attribution d'un ticket |
| `0003_clients_projects_team.sql` | Infos légales de l'organisation, clients (SIRET, facturation, archivage) et `client_contacts`, statuts et dates de projet, `project_members`, équipe (jours indisponibles, retrait doux), RPC `remove_member` / `restore_member` |
| `0004_finance_prospection.sql` | Rôle `finance`, lecture par rôle, paramètres de facturation de l'organisation, `quotes`, `invoices`, `document_counters`, `prospects`, statut automatique des projets, RPC `issue_invoice` / `create_credit_note` / `convert_prospect` / `member_sign_in_status` |
| `0005_billing_issuers.sql` | Émetteurs de facturation (`billing_issuers`, une micro-entreprise chacun), `issuer_id` des devis et factures, numérotation `AAAA-NNN` (factures par émetteur) qui continue après les numéros importés, vendeur copié depuis l'émetteur, import des documents historiques (serveur seulement) |

| `0006_task_assigned_by.sql` | Auteur et date de l'attribution d'une tâche, Realtime des tâches |
| `0007_project_ai_instructions.sql` | Mémoire de l'IA par projet (`ai_instructions`) |
| `0008_vercel_connections.sql` | Jeton Vercel de chaque compte |
| `0009_spotify_connections.sql` | Connexion Spotify de chaque compte, rotation du jeton |
| `0010_files.sql` | Bucket `files` + policies Storage, `project_files` (dossiers, versions, corbeille, lien devis / facture), `file_intakes` (dépôts à ranger), `filing_rules` (« Toujours ») |
| `0011_catalog_briefs.sql` | Catalogue `services`, `briefs`, projets (rounds de retours, diffusion, étude de cas, jeton du portail), `inputs.quote_id`, RPC `propose_tasks_from_quote` |
| `0012_work.sql` | Échéance et priorité des tâches, `time_entries`, `member_absences`, compétences ouvertes et affinités, `commission_plans` |
| `0013_notifications_ai.sql` | `notifications` (+ déclencheurs des passages de main, RPC `create_notification`), `ai_proposals` + `ai_autonomy_rules` (RPC apply / refuse / undo), `followups` |
| `0014_prospection.sql` | Pré-audit, audit, offre, argumentaire, refus, ne plus contacter, étapes `to_audit` / `offer_ready`, apporteur limité à ses prospects, `commissions` calculées au paiement |
| `0015_contracts_deliverables.sql` | `contracts`, `deliverables` / `deliverable_versions` / `deliverable_comments`, `api_tokens` (MCP) |
| `0016_task_done_at.sql` | Date de fin des tâches posée par la base |
| `0017_convert_prospect_project.sql` | `convert_prospect(uuid, text)` : membre autorisé, apporteur limité à ses prospects, projet créé |
| `0019_security_hardening.sql` | Correctifs de la revue de sécurité : contrats et fichiers de devis / factures / contrats réservés à admin et finance, responsable d'un prospect réservé à l'admin et figé après conversion, `create_notification` limitée, chemins Storage imposés |
| `0020_partners_notes.sql` | Réseau de partenaires (`partners`, `partner_projects`) et `notes` (perso ou équipe) |
| `0018_import_document_from_file.sql` | RPC serveur `import_document_from_file` : devis / facture importé d'un fichier, numéro d'origine gardé |

Ordre d'application : dans l'ordre des noms (`npm run db:migrate`). En production, appliquer chaque migration **avant** de pousser le code qui en dépend ; 0001 à 0020 sont appliquées en production et notées dans `sordulo_meta.migrations` (25/11/2026).

## Appliquer

Dans `.env.local` (jamais commité) :

```
SUPABASE_DB_URL=postgresql://postgres.<ref>:<mot de passe>@<host>:5432/postgres   # Project Settings > Database > Connection string, mode « Session »
SEED_MAEL_EMAIL=...
SEED_SACHA_EMAIL=...
```

Puis :

```bash
npm run db:migrate   # applique les migrations pas encore appliquées (une transaction par fichier)
npm run db:seed      # organisation Sordulo, Maël, Sacha, client Ibé, projet « App Ibé »
```

Les deux commandes peuvent être relancées sans risque. Les migrations appliquées sont notées dans `sordulo_meta.migrations`, un schéma que l'API Supabase n'expose pas.

**Sans Node** : coller les migrations une par une, dans l'ordre, dans Supabase > SQL Editor et les exécuter. Chaque fichier peut être relancé. Ensuite, créer les données de départ à la main ou lancer `npm run db:seed`.

## Ajouter une migration

Créer `migrations/000N_<sujet>.sql`, rejouable et sans `BEGIN`/`COMMIT`. Ne jamais modifier une migration déjà appliquée : le script le signale. Mettre à jour `src/shared/types.ts` et les tests RLS en même temps.

## Tests RLS

```bash
npm run test:rls
```

`tests/harness.ts` monte un Postgres en mémoire (PGlite, aucune base ni réseau), simule ce que fournit Supabase (rôles `anon` / `authenticated` / `service_role`, `auth.users`, `auth.sessions`, `auth.uid()`, `auth.jwt()`, `storage.buckets`) et applique toutes les migrations (de `0003` à la dernière deux fois chacune, pour vérifier qu'elles sont rejouables). `tests/rls.test.ts` vérifie les droits de 0001 à 0003, `tests/finance.test.ts` ceux de la 0004 (devis, factures, prospection), `tests/issuers.test.ts` ceux de la 0005 (émetteurs, numérotation, import) et de la 0018, puis un fichier par migration de la roadmap : `files`, `catalog`, `work` (0012 et 0016), `notifications`, `commissions` (0014 et 0017 dans `finance`), `deliverables`. Chaque test tourne dans une transaction annulée. Pour se mettre dans la peau d'un utilisateur, le helper `q(personne, sql)` fait comme PostgREST : `request.jwt.claims` puis `set role authenticated`.

Ajouter un test à chaque nouvelle politique, colonne protégée ou RPC.

## À savoir

- `organization_id` des tables `inputs`, `tickets` et `tasks` est rempli par un trigger à partir de `project_id`. Le client n'a pas à le fournir. Les références `ticket_id`, `depends_on_task_id`, `related_ticket_id`, `input_id`, `assignee_member_id` et `created_by` doivent rester dans le même projet ou la même organisation.
- RLS : un utilisateur ne voit que les organisations dont il est membre **actif** (`members.user_id = auth.uid()` et `removed_at is null`, fonction `private.user_org_ids()`). Les tickets sont créés uniquement côté serveur (`service_role`). Le rôle `anon` n'a accès à rien.
- Droits par rôle (`0003`, `0004`) : clients, contacts, projets et membres de projet sont modifiables par `admin` et `membre` (`private.user_writer_org_ids()`) et lisibles par `admin`, `membre` et `finance` (`private.user_reader_org_ids()`). Entrées, tickets et tâches : `admin` et `membre` seulement. `prospection` ne voit que l'organisation, l'équipe et les prospects (`private.user_prospect_org_ids()`). Devis et factures : `admin` et `finance` (`private.user_finance_org_ids()`). L'organisation et l'équipe ne sont modifiables que par les admins actifs (`private.user_admin_org_ids()`), et seulement certaines colonnes : `name`, `role`, `skills`, `weekly_capacity_hours`, `unavailable_weekdays` pour un membre. Création d'un membre : `/api` (service_role).
- Retrait d'un membre : `supabase.rpc('remove_member', { p_member_id })`, jamais un `update` de `removed_at` (refusé). La ligne reste ; ses tâches non terminées passent en « non attribuée » ; ses sessions sont supprimées. `restore_member` le réintègre. Un trigger refuse, pour tout le monde, de rétrograder ou retirer le dernier admin actif, et à un admin de se retirer lui-même.
- `organization_id` de `client_contacts` et `project_members` est rempli par un trigger depuis le client ou le projet. Un membre de projet doit être de la même organisation. Un seul contact principal par client (index unique partiel) : pour en changer, repasser l'ancien à `false` avant de mettre le nouveau à `true`.
- Liaison compte ↔ membre par email : trigger sur `auth.users`, plus `supabase.rpc('claim_membership')` à appeler après connexion (pour les comptes créés avant le seed). Un membre retiré n'est jamais relié, et `claim_membership` ne renvoie que les lignes actives.
- Bucket privé `audio` (200 Mo), sans politique côté client : tout passe par des URL signées générées par `/api`.

## Devis, factures, prospection (`0004`)

- Lignes (`lines`, tableau jsonb) contrôlées en base : `label` non vide, `quantity` > 0, `unit` parmi `day` / `hour` / `flat` / `unit`, `unit_price_cents` entier, `vat_rate` de 0 à 100. Erreur `23514` « Ligne N : … ». Prix négatif : permis sur un avoir, et sur une facture (`kind = 'invoice'`, lignes de déduction des acomptes d'une facture de solde) tant que son total HT et TTC reste positif ou nul (sinon `23514` « Le total d'une facture ne peut pas être négatif : crée un avoir. ») ; jamais sur un acompte.
- Totaux (`total_ht_cents`, `total_vat_cents`, `total_ttc_cents`) recalculés par trigger à chaque écriture : HT ligne = `round(quantité × prix)`, TVA = somme par taux de `round(HT du taux × taux / 100)`, TTC = HT + TVA. Ce que le client envoie est ignoré.
- `organization_id` d'un devis ou d'une facture vient du client ; projet, devis et facture d'origine doivent être de la même organisation.
- Devis : numéro `D-AAAA-NNN` à la création (`AAAA-NNN` depuis la 0005) (année de `issue_date`), `valid_until` par défaut = `issue_date` + `quote_validity_days`, `sent_at` / `accepted_at` / `refused_at` posés au changement de statut. Accepté ou refusé : plus rien ne change. Suppression des brouillons seulement.
- Factures : un brouillon se modifie librement (sauf `number`, `seller`, `buyer`, `issued_at`, `paid_at`, `cancelled_at`, `credited_invoice_id`, ignorés). `supabase.rpc('issue_invoice', { p_invoice_id })` lui donne son numéro `F-AAAA-NNNN` (série commune facture et acompte ; `AAAA-NNN` par émetteur depuis la 0005), `issue_date` = aujourd'hui (Paris), `due_date` = + `payment_terms_days`, et copie vendeur et acheteur. Ensuite seuls `issued` ↔ `paid` sont permis (`paid_at` suit), même pour `service_role`. `supabase.rpc('create_credit_note', { p_invoice_id })` crée l'avoir `A-AAAA-NNNN` (lignes en négatif) et passe la facture en `cancelled`. Suppression des brouillons seulement.
- Numéros continus par organisation, série et année (`document_counters`, aucun accès direct) : un numéro n'est consommé que si la transaction aboutit. Un devis brouillon supprimé laisse un trou dans la série D (sans obligation légale).
- Statut du projet, seulement vers l'avant et jamais s'il est archivé : devis envoyé → `quote_sent` ; devis accepté → `in_progress` ; toutes les factures (type `invoice`, non annulées) payées → `paid`.
- Prospects : pas de suppression ; `created_by` et `owner_member_id` = membre connecté par défaut ; `won_at` posé au passage en `won`, remis à null s'il le quitte. `client_id` n'est posé que par `supabase.rpc('convert_prospect', { p_prospect_id })`, qui crée le client et son contact principal, passe le prospect en `won` et renvoie l'id du client (idempotent).
- `supabase.rpc('member_sign_in_status', { p_organization_id })` (admins) : `{ member_id, signed_in }` par membre, `signed_in` = le compte relié s'est déjà connecté (`auth.users.last_sign_in_at`). `/api/members/invite` reliant `user_id` dès l'invitation, `user_id` seul ne le dit pas.

## Émetteurs de facturation, numérotation, import (`0005`)

- `billing_issuers` : les micro-entreprises qui facturent pour l'organisation (ex. Sacha Moricet EI, Maël Auzenet EI), avec SIRET (14 chiffres), adresse, mention et n° de TVA, IBAN / BIC, email, téléphone, membre relié (`member_id`, même organisation). Lecture : admin et finance ; création et modification : admins ; pas de suppression (`archived_at`). Un seul `is_default` par organisation (index unique partiel, `23505`) : pour en changer, repasser l'ancien à `false` puis le nouveau à `true`. L'émetteur par défaut ne peut pas être archivé (`23514`).
- `quotes.issuer_id`, `invoices.issuer_id` : contrôlés par trigger (même organisation, pas archivé, sinon `23514`). À la création, null devient l'émetteur du devis d'origine (`quote_id`, factures) s'il est actif, sinon l'émetteur par défaut, sinon reste null (l'organisation émet). Modifiable sur un brouillon (devis brouillon ou envoyé), figé ensuite. Un avoir prend toujours l'émetteur de la facture annulée. `issue_invoice` refuse un émetteur archivé depuis (`P0001`).
- Numéros `AAAA-NNN` (3 chiffres au moins) : devis par organisation (année de `issue_date`) ; factures, acomptes et avoirs dans une même série par émetteur (`document_counters.series` = `invoice:<id>`, ou `invoice` sans émetteur), année du jour d'émission. Le rang suivant = max(compteur, plus grand rang déjà présent dans la série pour l'année) + 1, lu par `private.parse_document_number` (`2026_001`, `2026-02`, `F-2026-0001`…) : la série continue après les documents importés et ceux de la 0004. Unicité des factures : (organisation, émetteur, numéro).
- Vendeur copié à l'émission : l'émetteur (`name` = `display_name`, `legal_name`, `legal_form`, `siret`, adresse, `vat_mention`, `vat_number`, `bank_iban`, `bank_bic`, `email`, `phone`), sinon l'organisation (mêmes clés, `vat_number` / `email` / `phone` à null).
- Import des documents historiques, depuis le serveur seulement (connexion `postgres` directe ou `service_role`) :

  ```sql
  begin;
  set local sordulo.import = 'on';
  insert into public.quotes (client_id, project_id, issuer_id, number, title, status, issue_date, sent_at, accepted_at, lines) values (...);
  insert into public.invoices (client_id, project_id, quote_id, issuer_id, kind, status, number, title, issue_date, due_date, issued_at, paid_at, lines, seller, buyer) values (...);
  commit;
  ```

  À la création seulement : `number`, `status`, dates et `seller` / `buyer` fournis sont gardés (vendeur et acheteur complétés depuis l'émetteur et le client s'ils manquent ; une facture non brouillon doit avoir son `number`) ; les totaux sont recalculés depuis les lignes ; le statut du projet n'est pas modifié. `private.is_trusted_import()` ignore le réglage pour `authenticated` et `anon`, y compris dans les triggers et RPC `security definer` (il lit aussi le réglage `role`, posé par PostgREST).
