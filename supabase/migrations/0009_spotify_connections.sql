-- =============================================================================
-- Sordulo OS : 0009_spotify_connections
-- Connecteur Spotify : une connexion par compte Sordulo OS (pas par ordinateur), comme Vercel (0008).
-- Chacun crée son app sur developer.spotify.com et colle son Client ID dans la carte Spotify ; l'app de
-- bureau fait l'autorisation (OAuth PKCE, sans secret) et le jeton de rafraîchissement est gardé ici : il
-- suit le compte sur tous ses ordinateurs. Le jeton d'accès (1 h) reste dans la mémoire de chaque app.
--
-- refresh_token null : Client ID enregistré mais compte pas encore autorisé (account null), ou accès perdu
-- (account gardé : la carte affiche « À reconnecter »).
--
-- Rotation : Spotify peut renvoyer un nouveau jeton de rafraîchissement à chaque rafraîchissement. L'app le
-- remplace par spotify_replace_refresh_token(ancien, nouveau), qui ne touche la ligne que si elle contient
-- encore l'ancien (un autre ordinateur a pu le remplacer entre-temps) : les jetons passent dans le corps de
-- l'appel, jamais dans une URL.
--
-- Chaque compte ne voit, n'écrit et ne supprime QUE sa propre ligne (user_id = auth.uid()) : le jeton n'est
-- lisible ni par les autres membres ni par les admins de l'organisation.
--
-- Rejouable. Nouvelle table : aucune donnée existante n'est modifiée. Les comptes connectés avant cette
-- migration (jetons dans spotify.json sur l'ordinateur) sont à reconnecter : l'app supprime ce fichier.
-- Pas de BEGIN/COMMIT : scripts/db-migrate.mjs exécute chaque fichier dans sa transaction.
-- =============================================================================

create table if not exists public.spotify_connections (
  user_id       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- Client ID de l'app Spotify de la personne : 32 caractères hexadécimaux en pratique, alphanumérique
  -- court accepté (même règle que l'app de bureau, il part dans une URL).
  client_id     text not null check (client_id ~ '^[A-Za-z0-9]{1,64}$'),
  refresh_token text check (refresh_token is null or char_length(btrim(refresh_token)) between 1 and 2048),
  -- Nom affiché du compte Spotify, et compte Premium (commandes de lecture depuis l'île).
  account       text check (account is null or char_length(account) <= 200),
  premium       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists spotify_connections_updated_at on public.spotify_connections;
create trigger spotify_connections_updated_at
  before update on public.spotify_connections
  for each row execute function public.tg_set_updated_at();

-- Un jeton de rafraîchissement n'est valable que pour le Client ID qui l'a obtenu : changer de Client ID
-- sans fournir de nouveau jeton oublie l'ancien (et le compte qui allait avec).
create or replace function public.tg_spotify_client_id_changed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.client_id is distinct from old.client_id
     and new.refresh_token is not distinct from old.refresh_token then
    new.refresh_token := null;
    new.account := null;
    new.premium := false;
  end if;
  return new;
end;
$$;

drop trigger if exists spotify_connections_client_id_changed on public.spotify_connections;
create trigger spotify_connections_client_id_changed
  before update on public.spotify_connections
  for each row execute function public.tg_spotify_client_id_changed();

alter table public.spotify_connections enable row level security;

revoke all on public.spotify_connections from public, anon, authenticated;
grant select, insert, update, delete on public.spotify_connections to authenticated;
grant all on public.spotify_connections to service_role;

drop policy if exists spotify_connections_select on public.spotify_connections;
create policy spotify_connections_select on public.spotify_connections
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists spotify_connections_insert on public.spotify_connections;
create policy spotify_connections_insert on public.spotify_connections
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists spotify_connections_update on public.spotify_connections;
create policy spotify_connections_update on public.spotify_connections
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists spotify_connections_delete on public.spotify_connections;
create policy spotify_connections_delete on public.spotify_connections
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Remplace le jeton de rafraîchissement du compte connecté s'il vaut encore `previous` (rotation par
-- Spotify, ou accès perdu avec `next` null). Vrai si la ligne a changé. Security invoker : la RLS
-- s'applique, chacun ne touche que sa ligne.
create or replace function public.spotify_replace_refresh_token(previous text, next text)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with changed as (
    update public.spotify_connections
       set refresh_token = next
     where user_id = (select auth.uid())
       and refresh_token = previous
    returning 1
  )
  select exists (select 1 from changed);
$$;

revoke all on function public.spotify_replace_refresh_token(text, text) from public, anon;
grant execute on function public.spotify_replace_refresh_token(text, text) to authenticated, service_role;
