# Base de données (Supabase)

Schéma : `migrations/0001_init.sql`. Il doit correspondre à `src/shared/types.ts`.

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

**Sans Node** : coller `migrations/0001_init.sql` dans Supabase > SQL Editor et l'exécuter. Ce fichier peut être relancé. Ensuite, créer les données de départ à la main ou lancer `npm run db:seed`.

## Ajouter une migration

Créer `migrations/0002_<sujet>.sql`, sans `BEGIN`/`COMMIT`. Ne jamais modifier une migration déjà appliquée : le script le signale. Mettre à jour `src/shared/types.ts` en même temps.

## À savoir

- `organization_id` des tables `inputs`, `tickets` et `tasks` est rempli par un trigger à partir de `project_id`. Le client n'a pas à le fournir. Les références `ticket_id`, `depends_on_task_id`, `related_ticket_id`, `input_id`, `assignee_member_id` et `created_by` doivent rester dans le même projet ou la même organisation.
- RLS : un utilisateur ne voit que les organisations dont il est membre (`members.user_id = auth.uid()`). Les tickets sont créés uniquement côté serveur (`service_role`). Le rôle `anon` n'a accès à rien.
- Liaison compte ↔ membre par email : trigger sur `auth.users`, plus `supabase.rpc('claim_membership')` à appeler après connexion (pour les comptes créés avant le seed).
- Bucket privé `audio` (200 Mo), sans politique côté client : tout passe par des URL signées générées par `/api`.
