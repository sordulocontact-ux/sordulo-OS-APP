-- =============================================================================
-- Sordulo OS : 0008_vercel_connections
-- Connecteur Vercel : un jeton d'accès Vercel par compte Sordulo OS (pas par ordinateur ni par
-- organisation). Collé dans la page Connecteurs, lu par l'île de l'app de bureau pour suivre les
-- déploiements de production (chargement, en ligne, échec).
--
-- Chaque compte ne voit, n'écrit et ne supprime QUE sa propre ligne (user_id = auth.uid()) :
-- le jeton n'est lisible ni par les autres membres ni par les admins de l'organisation.
--
-- Rejouable. Nouvelle table : aucune donnée existante n'est modifiée.
-- Pas de BEGIN/COMMIT : scripts/db-migrate.mjs exécute chaque fichier dans sa transaction.
-- =============================================================================

create table if not exists public.vercel_connections (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  token      text not null check (char_length(btrim(token)) between 1 and 512),
  -- Nom du compte Vercel (username), affiché dans la carte du connecteur.
  account    text check (account is null or char_length(account) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists vercel_connections_updated_at on public.vercel_connections;
create trigger vercel_connections_updated_at
  before update on public.vercel_connections
  for each row execute function public.tg_set_updated_at();

alter table public.vercel_connections enable row level security;

revoke all on public.vercel_connections from public, anon, authenticated;
grant select, insert, update, delete on public.vercel_connections to authenticated;
grant all on public.vercel_connections to service_role;

drop policy if exists vercel_connections_select on public.vercel_connections;
create policy vercel_connections_select on public.vercel_connections
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists vercel_connections_insert on public.vercel_connections;
create policy vercel_connections_insert on public.vercel_connections
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists vercel_connections_update on public.vercel_connections;
create policy vercel_connections_update on public.vercel_connections
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists vercel_connections_delete on public.vercel_connections;
create policy vercel_connections_delete on public.vercel_connections
  for delete to authenticated
  using (user_id = (select auth.uid()));
