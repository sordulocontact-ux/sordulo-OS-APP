-- =============================================================================
-- Sordulo OS : 0024_calls_google
-- Appels plus utiles dans l'île : moments marqués pendant l'appel, entrées venues d'un mail Gmail,
-- connexions Google (Agenda, Gmail).
--
-- Contenu :
--   1. inputs.markers : moments marqués pendant l'enregistrement (raccourci ou bouton « Marquer » de
--      l'île), en secondes depuis le début de l'audio, triés, au plus 100. Les passages à ±30 s d'un
--      repère sont signalés à l'analyse comme importants.
--   2. inputs.external_ref : origine externe d'une entrée (en-tête Message-ID du mail Gmail analysé,
--      identique dans toutes les boîtes). Unique par organisation (index partiel) : un mail reçu par
--      deux personnes de l'agence ne donne qu'une entrée. Null pour les entrées saisies dans l'app.
--   3. tickets.from_marker : ticket tiré d'un passage autour d'un repère (étoile dans l'île, l'écran de
--      validation, l'onglet Tickets). Calculé par le serveur (citation retrouvée dans la transcription),
--      jamais par le front.
--   4. public.google_connections : une connexion par compte Sordulo OS et par service Google
--      (calendar, gmail), comme Spotify (0009). L'app de bureau fait l'autorisation (OAuth PKCE, client
--      « Application de bureau » de l'agence) ; le jeton de rafraîchissement est gardé ici et suit le
--      compte sur tous ses ordinateurs, le jeton d'accès reste dans la mémoire de chaque app.
--      refresh_token null : accès perdu (account gardé : la carte affiche « À reconnecter »).
--      cursor_at : curseur Gmail, les mails reçus avant ne sont jamais proposés.
--      Chaque compte ne voit, n'écrit et ne supprime QUE ses propres lignes (user_id = auth.uid()) : les
--      jetons ne sont lisibles ni par les autres membres ni par les admins de l'organisation.
--
-- Droits de inputs et tickets inchangés (0001, 0004) : les nouvelles colonnes suivent les droits par
-- table (entrées et tickets écrits par l'API en service_role, lus par admin et membre).
--
-- Rejouable. Colonnes avec valeur par défaut et nouvelle table : aucune donnée existante n'est modifiée
-- (les entrées existantes ont markers = [], external_ref null ; les tickets existants from_marker false).
-- Pas de BEGIN/COMMIT : scripts/db-migrate.mjs exécute chaque fichier dans sa transaction.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Moments marqués d'une entrée
-- -----------------------------------------------------------------------------

alter table public.inputs add column if not exists markers jsonb not null default '[]'::jsonb;

-- Un tableau d'au plus 100 nombres >= 0 (jsonb n'a ni NaN ni infini). Le chemin JSON trouve tout
-- élément qui n'est pas un nombre (texte, null, objet, tableau imbriqué) ou qui est négatif.
alter table public.inputs drop constraint if exists inputs_markers_valid;
alter table public.inputs add constraint inputs_markers_valid check (
  jsonb_typeof(markers) = 'array'
  and jsonb_array_length(markers) <= 100
  and not jsonb_path_exists(markers, 'strict $[*] ? (@.type() != "number" || @ < 0)')
);

-- -----------------------------------------------------------------------------
-- 2. Origine externe d'une entrée (Message-ID d'un mail)
-- -----------------------------------------------------------------------------

alter table public.inputs add column if not exists external_ref text;

alter table public.inputs drop constraint if exists inputs_external_ref_length;
alter table public.inputs add constraint inputs_external_ref_length check (
  external_ref is null or (char_length(external_ref) between 1 and 512 and btrim(external_ref) <> '')
);

create unique index if not exists inputs_org_external_ref_key
  on public.inputs (organization_id, external_ref)
  where external_ref is not null;

-- -----------------------------------------------------------------------------
-- 3. Ticket tiré d'un moment marqué
-- -----------------------------------------------------------------------------

alter table public.tickets add column if not exists from_marker boolean not null default false;

-- -----------------------------------------------------------------------------
-- 4. Connexions Google (Agenda, Gmail)
-- -----------------------------------------------------------------------------

create table if not exists public.google_connections (
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  service       text not null check (service in ('calendar', 'gmail')),
  refresh_token text check (refresh_token is null or char_length(btrim(refresh_token)) between 1 and 2048),
  -- Adresse du compte Google, affichée dans la carte du connecteur.
  account       text check (account is null or char_length(account) <= 320),
  -- Gmail : date du dernier mail déjà vu (les mails reçus avant ne sont pas proposés).
  cursor_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, service)
);

drop trigger if exists google_connections_updated_at on public.google_connections;
create trigger google_connections_updated_at
  before update on public.google_connections
  for each row execute function public.tg_set_updated_at();

alter table public.google_connections enable row level security;

revoke all on public.google_connections from public, anon, authenticated;
grant select, insert, update, delete on public.google_connections to authenticated;
grant all on public.google_connections to service_role;

drop policy if exists google_connections_select on public.google_connections;
create policy google_connections_select on public.google_connections
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists google_connections_insert on public.google_connections;
create policy google_connections_insert on public.google_connections
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists google_connections_update on public.google_connections;
create policy google_connections_update on public.google_connections
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists google_connections_delete on public.google_connections;
create policy google_connections_delete on public.google_connections
  for delete to authenticated
  using (user_id = (select auth.uid()));
