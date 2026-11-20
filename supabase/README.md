# Base de données (Supabase)

Schéma : `migrations/*.sql`, appliquées dans l'ordre. Il doit correspondre à `src/shared/types.ts`.

| Migration | Contenu |
|---|---|
| `0001_init.sql` | Tables, RLS par organisation, liaison compte ↔ membre, bucket audio |
| `0002_ticket_area.sql` | Partie du produit et raison de l'attribution d'un ticket |
| `0003_clients_projects_team.sql` | Infos légales de l'organisation, clients (SIRET, facturation, archivage) et `client_contacts`, statuts et dates de projet, `project_members`, équipe (jours indisponibles, retrait doux), RPC `remove_member` / `restore_member` |

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

`tests/rls.test.ts` monte un Postgres en mémoire (PGlite, aucune base ni réseau), simule ce que fournit Supabase (rôles `anon` / `authenticated` / `service_role`, `auth.users`, `auth.sessions`, `auth.uid()`, `auth.jwt()`, `storage.buckets`), applique toutes les migrations (la `0003` deux fois, pour vérifier qu'elle est rejouable) puis vérifie les droits de chaque rôle. Chaque test tourne dans une transaction annulée. Pour se mettre dans la peau d'un utilisateur, le helper `q(personne, sql)` fait comme PostgREST : `request.jwt.claims` puis `set role authenticated`.

Ajouter un test à chaque nouvelle politique, colonne protégée ou RPC.

## À savoir

- `organization_id` des tables `inputs`, `tickets` et `tasks` est rempli par un trigger à partir de `project_id`. Le client n'a pas à le fournir. Les références `ticket_id`, `depends_on_task_id`, `related_ticket_id`, `input_id`, `assignee_member_id` et `created_by` doivent rester dans le même projet ou la même organisation.
- RLS : un utilisateur ne voit que les organisations dont il est membre **actif** (`members.user_id = auth.uid()` et `removed_at is null`, fonction `private.user_org_ids()`). Les tickets sont créés uniquement côté serveur (`service_role`). Le rôle `anon` n'a accès à rien.
- Droits par rôle (`0003`) : clients, contacts, projets et membres de projet sont modifiables par `admin` et `membre` (`private.user_writer_org_ids()`), pas par `prospection`, qui garde la lecture. L'organisation et l'équipe ne sont modifiables que par les admins actifs (`private.user_admin_org_ids()`), et seulement certaines colonnes : `name`, `role`, `skills`, `weekly_capacity_hours`, `unavailable_weekdays` pour un membre. Création d'un membre : `/api` (service_role).
- Retrait d'un membre : `supabase.rpc('remove_member', { p_member_id })`, jamais un `update` de `removed_at` (refusé). La ligne reste ; ses tâches non terminées passent en « non attribuée » ; ses sessions sont supprimées. `restore_member` le réintègre. Un trigger refuse, pour tout le monde, de rétrograder ou retirer le dernier admin actif, et à un admin de se retirer lui-même.
- `organization_id` de `client_contacts` et `project_members` est rempli par un trigger depuis le client ou le projet. Un membre de projet doit être de la même organisation. Un seul contact principal par client (index unique partiel) : pour en changer, repasser l'ancien à `false` avant de mettre le nouveau à `true`.
- Liaison compte ↔ membre par email : trigger sur `auth.users`, plus `supabase.rpc('claim_membership')` à appeler après connexion (pour les comptes créés avant le seed). Un membre retiré n'est jamais relié, et `claim_membership` ne renvoie que les lignes actives.
- Bucket privé `audio` (200 Mo), sans politique côté client : tout passe par des URL signées générées par `/api`.
