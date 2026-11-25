-- =============================================================================
-- Sordulo OS : 0015_contracts_deliverables
-- Contrats (depuis un devis, signature notée à la main ou par le client sur le portail),
-- livrables du projet avec leurs versions et les commentaires épinglés sur l'image (membre ou
-- client), jetons personnels du serveur MCP.
-- Miroir de src/shared/types.ts (Contract, Deliverable, DeliverableVersion, DeliverableComment,
-- ApiToken).
--
-- Le portail client (lien secret projects.portal_token) passe par le serveur (clé service) :
-- aucune politique pour anon ici.
--
-- Rejouable : if not exists / create or replace / drop ... if exists.
-- Nouvelles tables : aucune donnée existante n'est modifiée.
-- Pas de BEGIN/COMMIT : scripts/db-migrate.mjs exécute chaque fichier dans sa transaction.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Contrats
-- -----------------------------------------------------------------------------

create table if not exists public.contracts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id      uuid references public.projects (id) on delete set null,
  client_id       uuid not null references public.clients (id),
  quote_id        uuid references public.quotes (id) on delete set null,
  title           text not null check (btrim(title) <> '' and char_length(title) <= 200),
  -- Texte du contrat en markdown.
  body            text not null default '' check (char_length(body) <= 200000),
  status          text not null default 'draft' check (status in ('draft', 'sent', 'signed', 'cancelled')),
  sent_at         timestamptz,
  signed_at       timestamptz,
  signed_by_name  text check (signed_by_name is null or char_length(signed_by_name) <= 200),
  signed_via      text check (signed_via is null or signed_via in ('manual', 'portal', 'yousign')),
  -- PDF signé rangé dans les fichiers du projet.
  file_id         uuid references public.project_files (id) on delete set null,
  created_by      uuid references public.members (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists contracts_org_status_idx on public.contracts (organization_id, status);
create index if not exists contracts_project_id_idx on public.contracts (project_id);
create index if not exists contracts_client_id_idx  on public.contracts (client_id);
create index if not exists contracts_quote_id_idx   on public.contracts (quote_id);
create index if not exists contracts_file_id_idx    on public.contracts (file_id);

-- contracts : organisation du client ; projet, devis et fichier de la même organisation ;
-- sent_at / signed_at suivent le statut (signed_at fourni gardé : signature papier antérieure) ;
-- contrat signé figé (seule l'annulation reste possible) ; suppression des brouillons seulement.
create or replace function public.tg_contract_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' and pg_trigger_depth() = 1 then
      raise exception 'Seul un contrat en brouillon peut être supprimé' using errcode = 'P0001';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if pg_trigger_depth() > 1 then
      return new;
    end if;
    if old.status = 'signed'
       and ((to_jsonb(new) - array['status', 'file_id', 'updated_at']) is distinct from (to_jsonb(old) - array['status', 'file_id', 'updated_at'])
            or new.status not in ('signed', 'cancelled')) then
      raise exception 'Un contrat signé ne se modifie plus : annule-le pour en refaire un' using errcode = 'P0001';
    end if;
    new.id         := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;

  new.organization_id := private.document_scope(
    case when tg_op = 'UPDATE' then old.organization_id end,
    new.client_id, new.project_id, new.quote_id, null
  );

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, private.current_member_id(new.organization_id));
    if new.created_by is not null and not exists (
      select 1 from public.members m where m.id = new.created_by and m.organization_id = new.organization_id
    ) then
      raise exception 'created_by n''est pas membre de l''organisation du contrat' using errcode = '23514';
    end if;
  end if;

  if new.file_id is not null
     and (tg_op = 'INSERT' or new.file_id is distinct from old.file_id)
     and not exists (
       select 1 from public.project_files f where f.id = new.file_id and f.organization_id = new.organization_id
     ) then
    raise exception 'Le fichier n''appartient pas à l''organisation du contrat' using errcode = '23514';
  end if;

  new.sent_at := case
    when new.status = 'draft' then null
    when tg_op = 'UPDATE' and old.sent_at is not null then old.sent_at
    when new.status in ('sent', 'signed') then coalesce(new.sent_at, now())
    else new.sent_at
  end;
  if new.status = 'signed' then
    new.signed_at  := coalesce(new.signed_at, now());
    new.signed_via := coalesce(new.signed_via, 'manual');
  elsif new.status in ('draft', 'sent') then
    new.signed_at      := null;
    new.signed_by_name := null;
    new.signed_via     := null;
  end if;

  return new;
end;
$$;

drop trigger if exists contracts_10_guard on public.contracts;
create trigger contracts_10_guard
  before insert or update or delete on public.contracts
  for each row execute function public.tg_contract_guard();

drop trigger if exists contracts_20_updated_at on public.contracts;
create trigger contracts_20_updated_at
  before update on public.contracts
  for each row execute function public.tg_set_updated_at();

revoke all on function public.tg_contract_guard() from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Livrables, versions, commentaires
-- -----------------------------------------------------------------------------

create table if not exists public.deliverables (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id      uuid not null references public.projects (id) on delete cascade,
  title           text not null check (btrim(title) <> '' and char_length(title) <= 200),
  description     text check (description is null or char_length(description) <= 4000),
  status          text not null default 'in_progress'
                    check (status in ('in_progress', 'in_review', 'approved', 'changes_requested')),
  position        double precision not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Version d'un livrable : un fichier du projet soumis au client. Numéro attribué par la base.
create table if not exists public.deliverable_versions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  deliverable_id  uuid not null references public.deliverables (id) on delete cascade,
  version         integer not null default 1 check (version >= 1),
  -- Un fichier utilisé par un livrable ne se supprime pas définitivement (corbeille seulement).
  file_id         uuid not null references public.project_files (id),
  note            text check (note is null or char_length(note) <= 4000),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'changes_requested')),
  decided_at      timestamptz,
  -- Nom tapé par le client sur le portail (ou membre qui a noté la décision).
  decided_by_name text check (decided_by_name is null or char_length(decided_by_name) <= 200),
  created_by      uuid references public.members (id) on delete set null,
  created_at      timestamptz not null default now()
);

-- Commentaire épinglé sur l'image (x, y entre 0 et 1, ou les deux null : commentaire général).
create table if not exists public.deliverable_comments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  version_id       uuid not null references public.deliverable_versions (id) on delete cascade,
  x                numeric check (x is null or x between 0 and 1),
  y                numeric check (y is null or y between 0 and 1),
  body             text not null check (btrim(body) <> '' and char_length(body) <= 5000),
  author_member_id uuid references public.members (id) on delete set null,
  -- Nom du client (commentaire posté sur le portail).
  author_name      text check (author_name is null or char_length(author_name) <= 200),
  from_client      boolean not null default false,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  constraint deliverable_comments_pin_check check ((x is null) = (y is null)),
  constraint deliverable_comments_client_check check (not from_client or author_name is not null)
);

create index if not exists deliverables_project_idx               on public.deliverables (project_id, position);
create unique index if not exists deliverable_versions_version_key on public.deliverable_versions (deliverable_id, version);
create index if not exists deliverable_versions_file_id_idx       on public.deliverable_versions (file_id);
create index if not exists deliverable_versions_org_idx           on public.deliverable_versions (organization_id);
create index if not exists deliverable_comments_version_idx       on public.deliverable_comments (version_id, created_at);
create index if not exists deliverable_comments_org_idx           on public.deliverable_comments (organization_id);
create index if not exists deliverable_comments_author_idx        on public.deliverable_comments (author_member_id);

-- deliverable_versions : organisation du livrable, fichier du même projet, numéro suivant,
-- decided_at suit la décision ; le livrable suit sa dernière version (nouvelle version → « en
-- relecture », décision → « validé » ou « modifications demandées »).
create or replace function public.tg_deliverable_version_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid;
begin
  if tg_op = 'UPDATE' then
    new.id             := old.id;
    new.organization_id := old.organization_id;
    new.deliverable_id := old.deliverable_id;
    new.version        := old.version;
    new.created_by     := old.created_by;
    new.created_at     := old.created_at;
  else
    select d.organization_id, d.project_id into new.organization_id, v_project
    from public.deliverables d where d.id = new.deliverable_id;
    if new.organization_id is null then
      raise exception 'Livrable % introuvable', new.deliverable_id using errcode = '23503';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('sordulo.deliverable_versions:' || new.deliverable_id::text, 0));
    select coalesce(max(v.version), 0) + 1 into new.version
    from public.deliverable_versions v where v.deliverable_id = new.deliverable_id;

    new.created_by := coalesce(new.created_by, private.current_member_id(new.organization_id));
    if new.created_by is not null and not exists (
      select 1 from public.members m where m.id = new.created_by and m.organization_id = new.organization_id
    ) then
      raise exception 'created_by n''est pas membre de l''organisation du livrable' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' or new.file_id is distinct from old.file_id then
    select d.project_id into v_project from public.deliverables d where d.id = new.deliverable_id;
    if not exists (select 1 from public.project_files f where f.id = new.file_id and f.project_id = v_project) then
      raise exception 'Le fichier n''appartient pas au projet du livrable' using errcode = '23514';
    end if;
  end if;

  new.decided_at := case
    when new.status = 'pending' then null
    when tg_op = 'UPDATE' and old.status = new.status then old.decided_at
    else now()
  end;
  if new.status = 'pending' then
    new.decided_by_name := null;
  end if;

  return new;
end;
$$;

create or replace function public.tg_deliverable_version_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Seule la dernière version pilote le statut du livrable.
  if exists (
    select 1 from public.deliverable_versions v
    where v.deliverable_id = new.deliverable_id and v.version > new.version
  ) then
    return null;
  end if;

  update public.deliverables d
  set status = case new.status
                 when 'approved' then 'approved'
                 when 'changes_requested' then 'changes_requested'
                 else 'in_review'
               end
  where d.id = new.deliverable_id;
  return null;
end;
$$;

-- deliverable_comments : organisation de la version ; commentaire d'un membre : auteur = membre
-- connecté par défaut.
create or replace function public.tg_deliverable_comment_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.id               := old.id;
    new.organization_id  := old.organization_id;
    new.version_id       := old.version_id;
    new.author_member_id := old.author_member_id;
    new.author_name      := old.author_name;
    new.from_client      := old.from_client;
    new.created_at       := old.created_at;
  else
    select v.organization_id into new.organization_id from public.deliverable_versions v where v.id = new.version_id;
    if new.organization_id is null then
      raise exception 'Version % introuvable', new.version_id using errcode = '23503';
    end if;
    if not new.from_client then
      new.author_member_id := coalesce(new.author_member_id, private.current_member_id(new.organization_id));
    end if;
    if new.author_member_id is not null and not exists (
      select 1 from public.members m where m.id = new.author_member_id and m.organization_id = new.organization_id
    ) then
      raise exception 'L''auteur n''est pas membre de l''organisation' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- Commentaire du client sur un livrable → membres du projet (sinon admins et membres actifs).
create or replace function public.tg_notify_deliverable_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid;
  v_title   text;
  v_member  uuid;
begin
  if not new.from_client then
    return null;
  end if;

  select d.project_id, d.title into v_project, v_title
  from public.deliverable_versions v
  join public.deliverables d on d.id = v.deliverable_id
  where v.id = new.version_id;

  for v_member in
    select pm.member_id
    from public.project_members pm
    join public.members m on m.id = pm.member_id
    where pm.project_id = v_project and m.removed_at is null and m.role in ('admin', 'membre')
    union
    select m.id
    from public.members m
    where m.organization_id = new.organization_id
      and m.removed_at is null
      and m.role = 'admin'
      and not exists (select 1 from public.project_members pm where pm.project_id = v_project)
  loop
    perform private.notify(v_member, 'deliverable.comment',
      coalesce(new.author_name, 'Le client') || ' a commenté « ' || v_title || ' »',
      left(new.body, 300),
      '/projects/' || v_project::text || '/deliverables',
      jsonb_build_object('comment_id', new.id, 'version_id', new.version_id, 'project_id', v_project),
      null);
  end loop;
  return null;
end;
$$;

drop trigger if exists deliverables_10_project_scope on public.deliverables;
create trigger deliverables_10_project_scope
  before insert or update on public.deliverables
  for each row execute function public.tg_enforce_project_scope();

drop trigger if exists deliverables_20_updated_at on public.deliverables;
create trigger deliverables_20_updated_at
  before update on public.deliverables
  for each row execute function public.tg_set_updated_at();

drop trigger if exists deliverable_versions_10_guard on public.deliverable_versions;
create trigger deliverable_versions_10_guard
  before insert or update on public.deliverable_versions
  for each row execute function public.tg_deliverable_version_guard();

drop trigger if exists deliverable_versions_30_sync on public.deliverable_versions;
create trigger deliverable_versions_30_sync
  after insert or update of status on public.deliverable_versions
  for each row execute function public.tg_deliverable_version_sync();

drop trigger if exists deliverable_comments_10_guard on public.deliverable_comments;
create trigger deliverable_comments_10_guard
  before insert or update on public.deliverable_comments
  for each row execute function public.tg_deliverable_comment_guard();

drop trigger if exists deliverable_comments_40_notify on public.deliverable_comments;
create trigger deliverable_comments_40_notify
  after insert on public.deliverable_comments
  for each row execute function public.tg_notify_deliverable_comment();

revoke all on function public.tg_deliverable_version_guard()  from public, anon, authenticated, service_role;
revoke all on function public.tg_deliverable_version_sync()   from public, anon, authenticated, service_role;
revoke all on function public.tg_deliverable_comment_guard()  from public, anon, authenticated, service_role;
revoke all on function public.tg_notify_deliverable_comment() from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Jetons personnels du serveur MCP
-- -----------------------------------------------------------------------------

-- Le jeton n'est jamais stocké : seulement son empreinte SHA-256 (hexadécimal) et ses 8 premiers
-- caractères pour l'affichage. Droits du jeton = ceux du membre.
create table if not exists public.api_tokens (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  member_id       uuid not null references public.members (id) on delete cascade,
  name            text not null check (btrim(name) <> '' and char_length(name) <= 100),
  token_hash      text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  prefix          text not null check (char_length(prefix) between 4 and 16),
  last_used_at    timestamptz,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz
);

create unique index if not exists api_tokens_token_hash_key on public.api_tokens (token_hash);
create index if not exists api_tokens_member_idx            on public.api_tokens (member_id);
create index if not exists api_tokens_org_idx               on public.api_tokens (organization_id);

-- api_tokens : membre connecté par défaut, organisation du membre ; seule la révocation change.
create or replace function public.tg_api_token_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.id              := old.id;
    new.organization_id := old.organization_id;
    new.member_id       := old.member_id;
    new.token_hash      := old.token_hash;
    new.prefix          := old.prefix;
    new.created_at      := old.created_at;
    -- Un jeton révoqué le reste.
    new.revoked_at      := coalesce(old.revoked_at, new.revoked_at);
  else
    if new.member_id is null then
      select m.id into new.member_id
      from public.members m
      where m.user_id = (select auth.uid()) and m.removed_at is null
        and (new.organization_id is null or m.organization_id = new.organization_id)
      order by m.created_at
      limit 1;
    end if;
    select m.organization_id into new.organization_id from public.members m where m.id = new.member_id;
    if new.organization_id is null then
      raise exception 'Membre introuvable' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists api_tokens_10_guard on public.api_tokens;
create trigger api_tokens_10_guard
  before insert or update on public.api_tokens
  for each row execute function public.tg_api_token_guard();

revoke all on function public.tg_api_token_guard() from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Droits (rien pour anon)
-- -----------------------------------------------------------------------------

alter table public.contracts            enable row level security;
alter table public.deliverables         enable row level security;
alter table public.deliverable_versions enable row level security;
alter table public.deliverable_comments enable row level security;
alter table public.api_tokens           enable row level security;

revoke all on public.contracts, public.deliverables, public.deliverable_versions, public.deliverable_comments,
              public.api_tokens
  from public, anon, authenticated;

grant select, delete on public.contracts to authenticated;
grant insert (project_id, client_id, quote_id, title, body, status, sent_at, signed_at, signed_by_name, signed_via, file_id)
  on public.contracts to authenticated;
grant update (project_id, client_id, quote_id, title, body, status, sent_at, signed_at, signed_by_name, signed_via, file_id)
  on public.contracts to authenticated;

grant select, delete on public.deliverables to authenticated;
grant insert (project_id, title, description, status, position) on public.deliverables to authenticated;
grant update (title, description, status, position) on public.deliverables to authenticated;

grant select, delete on public.deliverable_versions to authenticated;
grant insert (deliverable_id, file_id, note, status, decided_by_name) on public.deliverable_versions to authenticated;
grant update (file_id, note, status, decided_by_name) on public.deliverable_versions to authenticated;

grant select, delete on public.deliverable_comments to authenticated;
grant insert (version_id, x, y, body) on public.deliverable_comments to authenticated;
grant update (body, resolved_at) on public.deliverable_comments to authenticated;

grant select on public.api_tokens to authenticated;
grant insert (organization_id, name, token_hash, prefix) on public.api_tokens to authenticated;
grant update (revoked_at) on public.api_tokens to authenticated;

grant all on public.contracts, public.deliverables, public.deliverable_versions, public.deliverable_comments,
             public.api_tokens
  to service_role;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

-- contracts : admin, membre et finance.
drop policy if exists contracts_select on public.contracts;
create policy contracts_select on public.contracts
  for select to authenticated
  using (organization_id in (select private.user_reader_org_ids()));

drop policy if exists contracts_insert on public.contracts;
create policy contracts_insert on public.contracts
  for insert to authenticated
  with check (organization_id in (select private.user_reader_org_ids()));

drop policy if exists contracts_update on public.contracts;
create policy contracts_update on public.contracts
  for update to authenticated
  using (organization_id in (select private.user_reader_org_ids()))
  with check (organization_id in (select private.user_reader_org_ids()));

drop policy if exists contracts_delete on public.contracts;
create policy contracts_delete on public.contracts
  for delete to authenticated
  using (organization_id in (select private.user_reader_org_ids()));

-- Livrables, versions, commentaires : rôles projet (admin, membre).
drop policy if exists deliverables_select on public.deliverables;
create policy deliverables_select on public.deliverables
  for select to authenticated
  using (organization_id in (select private.user_writer_org_ids()));

drop policy if exists deliverables_insert on public.deliverables;
create policy deliverables_insert on public.deliverables
  for insert to authenticated
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists deliverables_update on public.deliverables;
create policy deliverables_update on public.deliverables
  for update to authenticated
  using (organization_id in (select private.user_writer_org_ids()))
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists deliverables_delete on public.deliverables;
create policy deliverables_delete on public.deliverables
  for delete to authenticated
  using (organization_id in (select private.user_writer_org_ids()));

drop policy if exists deliverable_versions_select on public.deliverable_versions;
create policy deliverable_versions_select on public.deliverable_versions
  for select to authenticated
  using (organization_id in (select private.user_writer_org_ids()));

drop policy if exists deliverable_versions_insert on public.deliverable_versions;
create policy deliverable_versions_insert on public.deliverable_versions
  for insert to authenticated
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists deliverable_versions_update on public.deliverable_versions;
create policy deliverable_versions_update on public.deliverable_versions
  for update to authenticated
  using (organization_id in (select private.user_writer_org_ids()))
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists deliverable_versions_delete on public.deliverable_versions;
create policy deliverable_versions_delete on public.deliverable_versions
  for delete to authenticated
  using (organization_id in (select private.user_writer_org_ids()));

drop policy if exists deliverable_comments_select on public.deliverable_comments;
create policy deliverable_comments_select on public.deliverable_comments
  for select to authenticated
  using (organization_id in (select private.user_writer_org_ids()));

drop policy if exists deliverable_comments_insert on public.deliverable_comments;
create policy deliverable_comments_insert on public.deliverable_comments
  for insert to authenticated
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists deliverable_comments_update on public.deliverable_comments;
create policy deliverable_comments_update on public.deliverable_comments
  for update to authenticated
  using (organization_id in (select private.user_writer_org_ids()))
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists deliverable_comments_delete on public.deliverable_comments;
create policy deliverable_comments_delete on public.deliverable_comments
  for delete to authenticated
  using (organization_id in (select private.user_writer_org_ids()));

-- api_tokens : chacun lit, crée et révoque les siens ; les admins lisent ceux de l'organisation.
drop policy if exists api_tokens_select on public.api_tokens;
create policy api_tokens_select on public.api_tokens
  for select to authenticated
  using (
    member_id in (select private.user_member_ids())
    or organization_id in (select private.user_admin_org_ids())
  );

drop policy if exists api_tokens_insert on public.api_tokens;
create policy api_tokens_insert on public.api_tokens
  for insert to authenticated
  with check (member_id in (select private.user_member_ids()));

drop policy if exists api_tokens_update on public.api_tokens;
create policy api_tokens_update on public.api_tokens
  for update to authenticated
  using (member_id in (select private.user_member_ids()))
  with check (member_id in (select private.user_member_ids()));
