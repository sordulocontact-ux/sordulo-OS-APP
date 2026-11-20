# Base de données (Supabase)

Schéma : `migrations/*.sql`, appliquées dans l'ordre. Il doit correspondre à `src/shared/types.ts`.

| Migration | Contenu |
|---|---|
| `0001_init.sql` | Tables, RLS par organisation, liaison compte ↔ membre, bucket audio |
| `0002_ticket_area.sql` | Partie du produit et raison de l'attribution d'un ticket |
| `0003_clients_projects_team.sql` | Infos légales de l'organisation, clients (SIRET, facturation, archivage) et `client_contacts`, statuts et dates de projet, `project_members`, équipe (jours indisponibles, retrait doux), RPC `remove_member` / `restore_member` |
| `0004_finance_prospection.sql` | Rôle `finance`, lecture par rôle, paramètres de facturation de l'organisation, `quotes`, `invoices`, `document_counters`, `prospects`, statut automatique des projets, RPC `issue_invoice` / `create_credit_note` / `convert_prospect` / `member_sign_in_status` |

Ordre d'application : 0001, 0002, 0003, 0004 (`npm run db:migrate` les prend dans l'ordre des noms). En production, appliquer la 0004 **avant** de pousser le front de la V0.3.

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

`tests/harness.ts` monte un Postgres en mémoire (PGlite, aucune base ni réseau), simule ce que fournit Supabase (rôles `anon` / `authenticated` / `service_role`, `auth.users`, `auth.sessions`, `auth.uid()`, `auth.jwt()`, `storage.buckets`) et applique toutes les migrations (`0003` et `0004` deux fois, pour vérifier qu'elles sont rejouables). `tests/rls.test.ts` vérifie les droits de 0001 à 0003, `tests/finance.test.ts` ceux de la 0004 (devis, factures, prospection). Chaque test tourne dans une transaction annulée. Pour se mettre dans la peau d'un utilisateur, le helper `q(personne, sql)` fait comme PostgREST : `request.jwt.claims` puis `set role authenticated`.

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
- Devis : numéro `D-AAAA-NNN` à la création (année de `issue_date`), `valid_until` par défaut = `issue_date` + `quote_validity_days`, `sent_at` / `accepted_at` / `refused_at` posés au changement de statut. Accepté ou refusé : plus rien ne change. Suppression des brouillons seulement.
- Factures : un brouillon se modifie librement (sauf `number`, `seller`, `buyer`, `issued_at`, `paid_at`, `cancelled_at`, `credited_invoice_id`, ignorés). `supabase.rpc('issue_invoice', { p_invoice_id })` lui donne son numéro `F-AAAA-NNNN` (série commune facture et acompte), `issue_date` = aujourd'hui (Paris), `due_date` = + `payment_terms_days`, et copie vendeur et acheteur. Ensuite seuls `issued` ↔ `paid` sont permis (`paid_at` suit), même pour `service_role`. `supabase.rpc('create_credit_note', { p_invoice_id })` crée l'avoir `A-AAAA-NNNN` (lignes en négatif) et passe la facture en `cancelled`. Suppression des brouillons seulement.
- Numéros continus par organisation, série et année (`document_counters`, aucun accès direct) : un numéro n'est consommé que si la transaction aboutit. Un devis brouillon supprimé laisse un trou dans la série D (sans obligation légale).
- Statut du projet, seulement vers l'avant et jamais s'il est archivé : devis envoyé → `quote_sent` ; devis accepté → `in_progress` ; toutes les factures (type `invoice`, non annulées) payées → `paid`.
- Prospects : pas de suppression ; `created_by` et `owner_member_id` = membre connecté par défaut ; `won_at` posé au passage en `won`, remis à null s'il le quitte. `client_id` n'est posé que par `supabase.rpc('convert_prospect', { p_prospect_id })`, qui crée le client et son contact principal, passe le prospect en `won` et renvoie l'id du client (idempotent).
- `supabase.rpc('member_sign_in_status', { p_organization_id })` (admins) : `{ member_id, signed_in }` par membre, `signed_in` = le compte relié s'est déjà connecté (`auth.users.last_sign_in_at`). `/api/members/invite` reliant `user_id` dès l'invitation, `user_id` seul ne le dit pas.
