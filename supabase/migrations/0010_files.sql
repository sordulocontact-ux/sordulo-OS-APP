-- =============================================================================
-- Sordulo OS : 0010_files
-- Fichiers des projets et rangement automatique des fichiers déposés (île ou app web).
--   * bucket Storage privé « files » (100 Mo) et ses politiques sur storage.objects ;
--   * project_files : fichiers rangés (dossier, type, résumé, empreinte, versions, lien
--     vers un devis ou une facture, corbeille par deleted_at) ;
--   * filing_rules : règles « Toujours » (client + type de document → projet / dossier) ;
--   * file_intakes : dépôts en attente de rangement (texte extrait, proposition de l'IA,
--     confiance, statut, lot de plusieurs fichiers).
-- Miroir de src/shared/types.ts (ProjectFile, FilingRule, FileIntake, FileIntakeProposal).
--
-- Chemins dans le bucket « files » (1er segment = organisation, comme les politiques) :
--   <organization_id>/<project_id>/<uuid>-<nom>          fichier rangé
--   <organization_id>/inbox/<member_id>/<uuid>-<nom>     dépôt en attente (dossier du membre)
--
-- Rejouable : if not exists / create or replace / drop ... if exists.
-- Nouvelles tables : aucune donnée existante n'est modifiée.
-- Pas de BEGIN/COMMIT : scripts/db-migrate.mjs exécute chaque fichier dans sa transaction.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Appartenance : identifiants de membre du compte connecté
-- -----------------------------------------------------------------------------

-- Membres actifs du compte connecté (un par organisation). Toujours utilisée en
-- « member_id in (select private.user_member_ids()) » (initplan, pas d'appel par ligne).
create or replace function private.user_member_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.members m
  where m.user_id = (select auth.uid())
    and m.removed_at is null;
$$;

revoke all on function private.user_member_ids() from public, anon;
grant execute on function private.user_member_ids() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Types de documents (même liste dans project_files.kind et filing_rules.kind)
-- -----------------------------------------------------------------------------

create or replace function private.is_file_kind(p_kind text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_kind in ('quote', 'invoice', 'contract', 'brief', 'mockup', 'feedback', 'deliverable', 'asset', 'other');
$$;

revoke all on function private.is_file_kind(text) from public, anon;
grant execute on function private.is_file_kind(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

-- Fichier rangé dans un projet. organization_id est celui du projet (trigger).
-- Versions : la 1re version a version_group_id = son id ; une nouvelle version donne le
-- version_group_id de la 1re, et la base lui attribue le numéro suivant.
create table if not exists public.project_files (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  project_id       uuid not null references public.projects (id) on delete cascade,
  -- Dossiers types : Devis, Factures, Contrats, Briefs, Maquettes, Retours, Livrables, Divers.
  folder           text not null default 'Divers'
                     check (btrim(folder) <> '' and char_length(folder) <= 80),
  name             text not null check (btrim(name) <> '' and char_length(name) <= 255),
  storage_path     text not null check (char_length(storage_path) <= 1024),
  mime_type        text check (mime_type is null or char_length(mime_type) <= 255),
  size_bytes       bigint check (size_bytes is null or size_bytes >= 0),
  -- Empreinte SHA-256 en hexadécimal minuscule (détection des doublons).
  sha256           text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  kind             text not null default 'other' check (private.is_file_kind(kind)),
  summary          text check (summary is null or char_length(summary) <= 2000),
  version_group_id uuid not null,
  version          integer not null default 1 check (version >= 1),
  -- Ce qui change par rapport à la version précédente (résumé de l'IA).
  change_summary   text check (change_summary is null or char_length(change_summary) <= 2000),
  quote_id         uuid references public.quotes (id) on delete set null,
  invoice_id       uuid references public.invoices (id) on delete set null,
  uploaded_by      uuid references public.members (id) on delete set null,
  -- Corbeille : un rangement annulé ou un fichier supprimé garde sa ligne.
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Règle « Toujours » : les documents de ce type pour ce client vont dans ce projet / dossier.
-- project_id null = le projet détecté par l'IA ; folder null = le dossier proposé.
-- Une seule règle active par client et type (révoquer l'ancienne avant d'en créer une autre).
create table if not exists public.filing_rules (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id       uuid not null references public.clients (id) on delete cascade,
  kind            text not null check (private.is_file_kind(kind)),
  project_id      uuid references public.projects (id) on delete cascade,
  folder          text check (folder is null or (btrim(folder) <> '' and char_length(folder) <= 80)),
  created_by      uuid references public.members (id) on delete set null,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz
);

-- Dépôt en attente de rangement. Le serveur (clé service) écrit proposal, confidence,
-- extracted_text, error_message, auto_filed et les statuts classifying / ready / error.
create table if not exists public.file_intakes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by      uuid references public.members (id) on delete set null,
  source          text not null default 'web' check (source in ('island', 'web')),
  -- Fichiers déposés ensemble (validation en lot).
  batch_id        uuid,
  storage_path    text not null check (char_length(storage_path) <= 1024),
  name            text not null check (btrim(name) <> '' and char_length(name) <= 255),
  mime_type       text check (mime_type is null or char_length(mime_type) <= 255),
  size_bytes      bigint check (size_bytes is null or size_bytes >= 0),
  sha256          text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  extracted_text  text check (extracted_text is null or char_length(extracted_text) <= 20000),
  -- Forme : FileIntakeProposal (src/shared/types.ts).
  proposal        jsonb check (proposal is null or jsonb_typeof(proposal) = 'object'),
  confidence      numeric(3, 2) check (confidence is null or confidence between 0 and 1),
  status          text not null default 'uploaded'
                    check (status in ('uploaded', 'classifying', 'ready', 'filed', 'cancelled', 'error')),
  error_message   text check (error_message is null or char_length(error_message) <= 2000),
  filed_file_id   uuid references public.project_files (id) on delete set null,
  -- Rangé seul par une règle « Toujours » (annulable depuis la notification).
  auto_filed      boolean not null default false,
  rule_id         uuid references public.filing_rules (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Unicité et index
-- -----------------------------------------------------------------------------

create unique index if not exists project_files_storage_path_key  on public.project_files (storage_path);
create unique index if not exists project_files_version_key       on public.project_files (version_group_id, version);
create index if not exists project_files_org_sha256_idx           on public.project_files (organization_id, sha256);
create index if not exists project_files_project_folder_idx       on public.project_files (project_id, folder);
create index if not exists project_files_quote_id_idx             on public.project_files (quote_id);
create index if not exists project_files_invoice_id_idx           on public.project_files (invoice_id);
create index if not exists project_files_uploaded_by_idx          on public.project_files (uploaded_by);

create unique index if not exists filing_rules_active_key         on public.filing_rules (client_id, kind) where revoked_at is null;
create index if not exists filing_rules_org_idx                   on public.filing_rules (organization_id);
create index if not exists filing_rules_project_id_idx            on public.filing_rules (project_id);

create unique index if not exists file_intakes_storage_path_key   on public.file_intakes (storage_path);
create index if not exists file_intakes_org_status_idx            on public.file_intakes (organization_id, status);
create index if not exists file_intakes_created_by_idx            on public.file_intakes (created_by, created_at desc);
create index if not exists file_intakes_batch_id_idx              on public.file_intakes (batch_id) where batch_id is not null;
create index if not exists file_intakes_filed_file_id_idx         on public.file_intakes (filed_file_id);
create index if not exists file_intakes_rule_id_idx               on public.file_intakes (rule_id);

-- -----------------------------------------------------------------------------
-- Triggers d'intégrité
-- -----------------------------------------------------------------------------

-- project_files : s'exécute après project_files_10_project_scope (organization_id fiable).
-- Chemin dans le dossier de l'organisation, devis / facture / membre de la même organisation,
-- versions numérotées par la base.
create or replace function public.tg_project_file_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- Un fichier peut changer de projet, jamais d'organisation.
    if new.organization_id is distinct from old.organization_id then
      raise exception 'Un fichier ne peut pas changer d''organisation' using errcode = '42501';
    end if;
    new.id               := old.id;
    new.storage_path     := old.storage_path;
    new.version_group_id := old.version_group_id;
    new.version          := old.version;
    new.uploaded_by      := old.uploaded_by;
    new.created_at       := old.created_at;
  else
    if new.storage_path not like new.organization_id::text || '/%' then
      raise exception 'Le chemin du fichier doit être dans le dossier de son organisation' using errcode = '23514';
    end if;

    if new.version_group_id is null or new.version_group_id = new.id then
      new.version_group_id := new.id;
      new.version := 1;
    else
      -- Nouvelle version : le groupe existe dans la même organisation, numéro suivant.
      perform pg_advisory_xact_lock(hashtextextended('sordulo.project_files.version:' || new.version_group_id::text, 0));
      select coalesce(max(f.version), 0) + 1 into new.version
      from public.project_files f
      where f.version_group_id = new.version_group_id
        and f.organization_id = new.organization_id;
      if new.version = 1 then
        raise exception 'La version précédente de ce fichier est introuvable' using errcode = '23503';
      end if;
    end if;

    new.uploaded_by := coalesce(new.uploaded_by, private.current_member_id(new.organization_id));
    if new.uploaded_by is not null and not exists (
      select 1 from public.members m where m.id = new.uploaded_by and m.organization_id = new.organization_id
    ) then
      raise exception 'uploaded_by n''est pas membre de l''organisation du fichier' using errcode = '23514';
    end if;
  end if;

  if new.quote_id is not null
     and (tg_op = 'INSERT' or new.quote_id is distinct from old.quote_id)
     and not exists (
       select 1 from public.quotes q where q.id = new.quote_id and q.organization_id = new.organization_id
     ) then
    raise exception 'Le devis n''appartient pas à l''organisation du fichier' using errcode = '23514';
  end if;

  if new.invoice_id is not null
     and (tg_op = 'INSERT' or new.invoice_id is distinct from old.invoice_id)
     and not exists (
       select 1 from public.invoices i where i.id = new.invoice_id and i.organization_id = new.organization_id
     ) then
    raise exception 'La facture n''appartient pas à l''organisation du fichier' using errcode = '23514';
  end if;

  return new;
end;
$$;

-- filing_rules : organisation du client, projet de la même organisation, auteur = membre connecté.
create or replace function public.tg_filing_rule_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.id              := old.id;
    new.organization_id := old.organization_id;
    new.client_id       := old.client_id;
    new.kind            := old.kind;
    new.created_by      := old.created_by;
    new.created_at      := old.created_at;
  else
    select c.organization_id into new.organization_id from public.clients c where c.id = new.client_id;
    if new.organization_id is null then
      raise exception 'Client % introuvable', new.client_id using errcode = '23503';
    end if;
    new.created_by := coalesce(new.created_by, private.current_member_id(new.organization_id));
    if new.created_by is not null and not exists (
      select 1 from public.members m where m.id = new.created_by and m.organization_id = new.organization_id
    ) then
      raise exception 'created_by n''est pas membre de l''organisation de la règle' using errcode = '23514';
    end if;
  end if;

  if new.project_id is not null
     and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id)
     and not exists (
       select 1 from public.projects p where p.id = new.project_id and p.organization_id = new.organization_id
     ) then
    raise exception 'Le projet n''appartient pas à l''organisation de la règle' using errcode = '23514';
  end if;

  return new;
end;
$$;

-- file_intakes : auteur = membre connecté par défaut, chemin dans le dossier de l'organisation,
-- fichier rangé et règle de la même organisation.
-- Volontairement SANS security definer : current_user est l'appelant. Un client de l'API
-- (authenticated) ne pose que les statuts ready (rangement annulé), filed et cancelled ;
-- uploaded, classifying et error appartiennent au serveur (service_role) et aux RPC.
create or replace function public.tg_file_intake_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_restricted boolean := current_user in ('authenticated', 'anon');
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id then
      raise exception 'file_intakes.organization_id ne peut pas être modifié' using errcode = '42501';
    end if;
    new.id           := old.id;
    new.created_by   := old.created_by;
    new.storage_path := old.storage_path;
    new.created_at   := old.created_at;

    if v_restricted and new.status is distinct from old.status
       and new.status not in ('ready', 'filed', 'cancelled') then
      raise exception 'Ce statut est posé par le serveur' using errcode = '42501';
    end if;
  else
    if new.storage_path not like new.organization_id::text || '/%' then
      raise exception 'Le chemin du fichier doit être dans le dossier de son organisation' using errcode = '23514';
    end if;
    new.created_by := coalesce(new.created_by, private.current_member_id(new.organization_id));
    if new.created_by is not null and not exists (
      select 1 from public.members m where m.id = new.created_by and m.organization_id = new.organization_id
    ) then
      raise exception 'created_by n''est pas membre de l''organisation du dépôt' using errcode = '23514';
    end if;
  end if;

  -- Rangé = relié à son fichier (vérifié au passage à « filed » : la suppression définitive du
  -- fichier remet ensuite filed_file_id à null sans bloquer).
  if new.status = 'filed' and new.filed_file_id is null
     and (tg_op = 'INSERT' or old.status is distinct from 'filed') then
    raise exception 'Un dépôt rangé doit être relié au fichier créé' using errcode = '23514';
  end if;

  if new.filed_file_id is not null
     and (tg_op = 'INSERT' or new.filed_file_id is distinct from old.filed_file_id)
     and not exists (
       select 1 from public.project_files f where f.id = new.filed_file_id and f.organization_id = new.organization_id
     ) then
    raise exception 'Le fichier rangé n''appartient pas à l''organisation du dépôt' using errcode = '23514';
  end if;

  if new.rule_id is not null
     and (tg_op = 'INSERT' or new.rule_id is distinct from old.rule_id)
     and not exists (
       select 1 from public.filing_rules r where r.id = new.rule_id and r.organization_id = new.organization_id
     ) then
    raise exception 'La règle n''appartient pas à l''organisation du dépôt' using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Les triggers d'une même table s'exécutent par ordre alphabétique de nom.
drop trigger if exists project_files_10_project_scope on public.project_files;
create trigger project_files_10_project_scope
  before insert or update on public.project_files
  for each row execute function public.tg_enforce_project_scope();

drop trigger if exists project_files_15_guard on public.project_files;
create trigger project_files_15_guard
  before insert or update on public.project_files
  for each row execute function public.tg_project_file_guard();

drop trigger if exists project_files_20_updated_at on public.project_files;
create trigger project_files_20_updated_at
  before update on public.project_files
  for each row execute function public.tg_set_updated_at();

drop trigger if exists filing_rules_10_guard on public.filing_rules;
create trigger filing_rules_10_guard
  before insert or update on public.filing_rules
  for each row execute function public.tg_filing_rule_guard();

drop trigger if exists file_intakes_10_guard on public.file_intakes;
create trigger file_intakes_10_guard
  before insert or update on public.file_intakes
  for each row execute function public.tg_file_intake_guard();

drop trigger if exists file_intakes_20_updated_at on public.file_intakes;
create trigger file_intakes_20_updated_at
  before update on public.file_intakes
  for each row execute function public.tg_set_updated_at();

revoke all on function public.tg_project_file_guard() from public, anon, authenticated, service_role;
revoke all on function public.tg_filing_rule_guard()  from public, anon, authenticated, service_role;
revoke all on function public.tg_file_intake_guard()  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Droits (rien pour anon)
-- -----------------------------------------------------------------------------

alter table public.project_files enable row level security;
alter table public.filing_rules  enable row level security;
alter table public.file_intakes  enable row level security;

revoke all on public.project_files, public.filing_rules, public.file_intakes from public, anon, authenticated;

grant select, delete on public.project_files to authenticated;
grant insert (project_id, folder, name, storage_path, mime_type, size_bytes, sha256, kind, summary,
              version_group_id, change_summary, quote_id, invoice_id)
  on public.project_files to authenticated;
grant update (project_id, folder, name, kind, summary, change_summary, quote_id, invoice_id, deleted_at)
  on public.project_files to authenticated;

-- Règles : immuables, seulement révoquées.
grant select on public.filing_rules to authenticated;
grant insert (client_id, kind, project_id, folder) on public.filing_rules to authenticated;
grant update (revoked_at) on public.filing_rules to authenticated;

-- Dépôts : la proposition de l'IA, la confiance et le rangement automatique sont écrits par le serveur.
grant select, delete on public.file_intakes to authenticated;
grant insert (organization_id, source, batch_id, storage_path, name, mime_type, size_bytes, sha256, extracted_text)
  on public.file_intakes to authenticated;
grant update (status, filed_file_id, rule_id) on public.file_intakes to authenticated;

grant all on public.project_files, public.filing_rules, public.file_intakes to service_role;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

-- project_files : lecture et écriture par admin, membre et finance (pas la prospection).
drop policy if exists project_files_select on public.project_files;
create policy project_files_select on public.project_files
  for select to authenticated
  using (organization_id in (select private.user_reader_org_ids()));

drop policy if exists project_files_insert on public.project_files;
create policy project_files_insert on public.project_files
  for insert to authenticated
  with check (organization_id in (select private.user_reader_org_ids()));

drop policy if exists project_files_update on public.project_files;
create policy project_files_update on public.project_files
  for update to authenticated
  using (organization_id in (select private.user_reader_org_ids()))
  with check (organization_id in (select private.user_reader_org_ids()));

drop policy if exists project_files_delete on public.project_files;
create policy project_files_delete on public.project_files
  for delete to authenticated
  using (organization_id in (select private.user_reader_org_ids()));

-- filing_rules : admin, membre et finance.
drop policy if exists filing_rules_select on public.filing_rules;
create policy filing_rules_select on public.filing_rules
  for select to authenticated
  using (organization_id in (select private.user_reader_org_ids()));

drop policy if exists filing_rules_insert on public.filing_rules;
create policy filing_rules_insert on public.filing_rules
  for insert to authenticated
  with check (organization_id in (select private.user_reader_org_ids()));

drop policy if exists filing_rules_update on public.filing_rules;
create policy filing_rules_update on public.filing_rules
  for update to authenticated
  using (organization_id in (select private.user_reader_org_ids()))
  with check (organization_id in (select private.user_reader_org_ids()));

-- file_intakes : le membre qui a déposé (admin, membre ou finance), et les admins de l'organisation.
drop policy if exists file_intakes_select on public.file_intakes;
create policy file_intakes_select on public.file_intakes
  for select to authenticated
  using (
    (organization_id in (select private.user_reader_org_ids()) and created_by in (select private.user_member_ids()))
    or organization_id in (select private.user_admin_org_ids())
  );

drop policy if exists file_intakes_insert on public.file_intakes;
create policy file_intakes_insert on public.file_intakes
  for insert to authenticated
  with check (organization_id in (select private.user_reader_org_ids()) and created_by in (select private.user_member_ids()));

drop policy if exists file_intakes_update on public.file_intakes;
create policy file_intakes_update on public.file_intakes
  for update to authenticated
  using (
    (organization_id in (select private.user_reader_org_ids()) and created_by in (select private.user_member_ids()))
    or organization_id in (select private.user_admin_org_ids())
  )
  with check (
    (organization_id in (select private.user_reader_org_ids()) and created_by in (select private.user_member_ids()))
    or organization_id in (select private.user_admin_org_ids())
  );

drop policy if exists file_intakes_delete on public.file_intakes;
create policy file_intakes_delete on public.file_intakes
  for delete to authenticated
  using (
    (organization_id in (select private.user_reader_org_ids()) and created_by in (select private.user_member_ids()))
    or organization_id in (select private.user_admin_org_ids())
  );

-- -----------------------------------------------------------------------------
-- Storage : bucket privé « files » (100 Mo par fichier)
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 104857600)
on conflict (id) do nothing;

-- Accès d'un compte à un objet du bucket « files », d'après son chemin :
--   <org>/<project_id>/<fichier>         lecture et écriture : admin, membre, finance de <org> ;
--                                        écriture seulement si <project_id> est un projet de <org>
--                                        (la lecture survit à un projet supprimé ou changé) ;
--   <org>/inbox/<member_id>/<fichier>    écriture : seulement son propre dossier (admin, membre, finance) ;
--                                        lecture : son dossier, ou tout le dossier inbox pour un admin.
-- Tout autre chemin est refusé. Le serveur (service_role) contourne ces règles.
create or replace function private.can_access_file_object(p_name text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_folders text[] := storage.foldername(p_name);
  v_depth   integer := coalesce(array_length(v_folders, 1), 0);
  v_org     uuid;
  v_uuid    text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p_name is null or p_name like '%/' or v_depth < 2 or v_folders[1] !~ v_uuid then
    return false;
  end if;
  v_org := v_folders[1]::uuid;

  if v_org not in (select private.user_reader_org_ids()) then
    return false;
  end if;

  if v_folders[2] = 'inbox' then
    if v_depth <> 3 or v_folders[3] !~ v_uuid then
      return false;
    end if;
    if v_folders[3]::uuid = private.current_member_id(v_org) then
      return true;
    end if;
    return not p_write and private.is_org_admin(v_org);
  end if;

  if v_depth <> 2 or v_folders[2] !~ v_uuid then
    return false;
  end if;
  if not p_write then
    return true;
  end if;
  return exists (
    select 1 from public.projects p where p.id = v_folders[2]::uuid and p.organization_id = v_org
  );
end;
$$;

revoke all on function private.can_access_file_object(text, boolean) from public, anon;
grant execute on function private.can_access_file_object(text, boolean) to authenticated, service_role;

drop policy if exists files_select on storage.objects;
create policy files_select on storage.objects
  for select to authenticated
  using (bucket_id = 'files' and private.can_access_file_object(name, false));

drop policy if exists files_insert on storage.objects;
create policy files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'files' and private.can_access_file_object(name, true));

drop policy if exists files_update on storage.objects;
create policy files_update on storage.objects
  for update to authenticated
  using (bucket_id = 'files' and private.can_access_file_object(name, true))
  with check (bucket_id = 'files' and private.can_access_file_object(name, true));

drop policy if exists files_delete on storage.objects;
create policy files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'files' and private.can_access_file_object(name, true));
