-- =============================================================================
-- Sordulo OS — 0001_init
-- Schéma multi-organisation, RLS, liaison compte ↔ membre, bucket audio.
-- Miroir exact de src/shared/types.ts : toute modification de colonne se fait
-- aux deux endroits.
--
-- Rejouable : if not exists / create or replace / drop ... if exists.
-- Ne pas mettre de BEGIN/COMMIT ici : scripts/db-migrate.mjs exécute chaque
-- fichier dans sa propre transaction (l'éditeur SQL Supabase aussi).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.members (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete cascade,
  user_id                uuid references auth.users (id) on delete set null,
  name                   text not null,
  email                  text not null,
  role                   text not null default 'membre'
                           check (role in ('admin', 'membre', 'prospection')),
  skills                 jsonb not null default '{}'::jsonb
                           check (jsonb_typeof(skills) = 'object'),
  weekly_capacity_hours  numeric not null default 35
                           check (weekly_capacity_hours >= 0),
  created_at             timestamptz not null default now()
);

create table if not exists public.clients (
  id             uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name           text not null,
  contact_name   text,
  contact_email  text,
  created_at     timestamptz not null default now()
);

create table if not exists public.projects (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id       uuid references public.clients (id) on delete set null,
  name            text not null,
  status          text not null default 'active',
  tone_of_voice   text,
  created_at      timestamptz not null default now()
);

create table if not exists public.inputs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id      uuid not null references public.projects (id) on delete cascade,
  kind            text not null check (kind in ('meeting', 'written')),
  title           text,
  audio_path      text,
  raw_text        text,
  transcript      jsonb,
  speaker_names   jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(speaker_names) = 'object'),
  status          text not null default 'uploaded'
                    check (status in ('uploaded', 'transcribing', 'analyzing', 'ready', 'error')),
  error_message   text,
  created_by      uuid references public.members (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.tickets (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  project_id         uuid not null references public.projects (id) on delete cascade,
  input_id           uuid references public.inputs (id) on delete set null,
  title              text not null,
  description        text not null default '',
  type               text not null check (type in ('bug', 'modification', 'new_request')),
  priority           text not null default 'medium'
                       check (priority in ('low', 'medium', 'high')),
  source_quote       text,
  status             text not null default 'proposed'
                       check (status in ('proposed', 'validated', 'rejected', 'done')),
  related_ticket_id  uuid references public.tickets (id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint tickets_related_not_self check (related_ticket_id is null or related_ticket_id <> id)
);

create table if not exists public.tasks (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  project_id          uuid not null references public.projects (id) on delete cascade,
  -- Cascade : relancer une analyse supprime les tickets "proposed" et leurs tâches.
  ticket_id           uuid references public.tickets (id) on delete cascade,
  title               text not null,
  skill               text not null check (skill in ('design', 'dev')),
  estimate_hours      numeric check (estimate_hours is null or estimate_hours >= 0),
  assignee_member_id  uuid references public.members (id) on delete set null,
  status              text not null default 'todo'
                        check (status in ('todo', 'in_progress', 'review', 'done')),
  depends_on_task_id  uuid references public.tasks (id) on delete set null,
  position            double precision not null default 0,
  created_at          timestamptz not null default now(),
  constraint tasks_depends_not_self check (depends_on_task_id is null or depends_on_task_id <> id)
);

-- -----------------------------------------------------------------------------
-- Unicité et index
-- -----------------------------------------------------------------------------

create unique index if not exists members_org_email_key on public.members (organization_id, lower(email));
create unique index if not exists members_org_user_key  on public.members (organization_id, user_id);
create index if not exists members_user_id_idx           on public.members (user_id);
create index if not exists members_lower_email_idx       on public.members (lower(email));

create index if not exists clients_organization_id_idx   on public.clients (organization_id);

create index if not exists projects_organization_id_idx  on public.projects (organization_id);
create index if not exists projects_client_id_idx        on public.projects (client_id);
create index if not exists projects_status_idx           on public.projects (status);

create index if not exists inputs_organization_id_idx    on public.inputs (organization_id);
create index if not exists inputs_project_id_idx         on public.inputs (project_id, created_at desc);
create index if not exists inputs_status_idx             on public.inputs (status);
create index if not exists inputs_created_by_idx         on public.inputs (created_by);

create index if not exists tickets_organization_id_idx   on public.tickets (organization_id);
create index if not exists tickets_project_id_idx        on public.tickets (project_id, status);
create index if not exists tickets_input_id_idx          on public.tickets (input_id);
create index if not exists tickets_status_idx            on public.tickets (status);
create index if not exists tickets_related_ticket_id_idx on public.tickets (related_ticket_id);

create index if not exists tasks_organization_id_idx     on public.tasks (organization_id);
create index if not exists tasks_project_id_idx          on public.tasks (project_id, status, position);
create index if not exists tasks_ticket_id_idx           on public.tasks (ticket_id);
create index if not exists tasks_status_idx              on public.tasks (status);
create index if not exists tasks_assignee_member_id_idx  on public.tasks (assignee_member_id);
create index if not exists tasks_depends_on_task_id_idx  on public.tasks (depends_on_task_id);

-- -----------------------------------------------------------------------------
-- Triggers d'intégrité
-- -----------------------------------------------------------------------------

-- inputs.updated_at
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- clients, projects : organization_id ne change pas après création
-- (sinon les inputs/tickets/tasks d'un projet deviendraient incohérents).
-- projects : le client doit appartenir à la même organisation.
create or replace function public.tg_guard_org_owned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception '%.organization_id ne peut pas être modifié', tg_table_name
      using errcode = '42501';
  end if;

  -- Conditions imbriquées : PL/pgSQL n'évalue pas les AND en court-circuit,
  -- et new.client_id n'existe pas sur clients.
  if tg_table_name = 'projects' then
    if new.client_id is not null
       and (tg_op = 'INSERT' or new.client_id is distinct from old.client_id)
       and not exists (
         select 1 from public.clients c
         where c.id = new.client_id and c.organization_id = new.organization_id
       ) then
      raise exception 'Le client % n''appartient pas à l''organisation du projet', new.client_id
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

-- inputs, tickets, tasks : organization_id est toujours celui du projet
-- (le client n'a pas à le fournir et ne peut pas le falsifier), et les
-- références croisées restent dans le même projet / la même organisation.
--
-- En UPDATE, on ne revalide que les colonnes modifiées : les "on delete set null"
-- en cascade (suppression d'un projet, d'une entrée, d'une tâche) ne doivent
-- pas échouer parce que le projet est déjà en cours de suppression.
create or replace function public.tg_enforce_project_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_changed boolean := tg_op = 'INSERT' or new.project_id is distinct from old.project_id;
begin
  if v_project_changed then
    select p.organization_id into new.organization_id
    from public.projects p
    where p.id = new.project_id;

    if new.organization_id is null then
      raise exception 'Projet % introuvable', new.project_id using errcode = '23503';
    end if;
  else
    new.organization_id := old.organization_id;
  end if;

  if tg_table_name = 'inputs' then
    if new.created_by is not null
       and (v_project_changed or new.created_by is distinct from old.created_by)
       and not exists (
         select 1 from public.members m
         where m.id = new.created_by and m.organization_id = new.organization_id
       ) then
      raise exception 'created_by % n''est pas membre de l''organisation du projet', new.created_by
        using errcode = '23514';
    end if;

  elsif tg_table_name = 'tickets' then
    if new.input_id is not null
       and (v_project_changed or new.input_id is distinct from old.input_id)
       and not exists (
         select 1 from public.inputs i
         where i.id = new.input_id and i.project_id = new.project_id
       ) then
      raise exception 'L''entrée % n''appartient pas au projet %', new.input_id, new.project_id
        using errcode = '23514';
    end if;

    if new.related_ticket_id is not null
       and (v_project_changed or new.related_ticket_id is distinct from old.related_ticket_id)
       and not exists (
         select 1 from public.tickets t
         where t.id = new.related_ticket_id and t.project_id = new.project_id
       ) then
      raise exception 'Le ticket lié % n''appartient pas au projet %', new.related_ticket_id, new.project_id
        using errcode = '23514';
    end if;

  elsif tg_table_name = 'tasks' then
    if new.ticket_id is not null
       and (v_project_changed or new.ticket_id is distinct from old.ticket_id)
       and not exists (
         select 1 from public.tickets t
         where t.id = new.ticket_id and t.project_id = new.project_id
       ) then
      raise exception 'Le ticket % n''appartient pas au projet %', new.ticket_id, new.project_id
        using errcode = '23514';
    end if;

    if new.depends_on_task_id is not null
       and (v_project_changed or new.depends_on_task_id is distinct from old.depends_on_task_id)
       and not exists (
         select 1 from public.tasks t
         where t.id = new.depends_on_task_id and t.project_id = new.project_id
       ) then
      raise exception 'La tâche % n''appartient pas au projet %', new.depends_on_task_id, new.project_id
        using errcode = '23514';
    end if;

    if new.assignee_member_id is not null
       and (v_project_changed or new.assignee_member_id is distinct from old.assignee_member_id)
       and not exists (
         select 1 from public.members m
         where m.id = new.assignee_member_id and m.organization_id = new.organization_id
       ) then
      raise exception 'Le membre % n''appartient pas à l''organisation du projet', new.assignee_member_id
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

-- Les triggers d'une même table s'exécutent par ordre alphabétique de nom.
drop trigger if exists clients_10_guard_org on public.clients;
create trigger clients_10_guard_org
  before insert or update on public.clients
  for each row execute function public.tg_guard_org_owned();

drop trigger if exists projects_10_guard_org on public.projects;
create trigger projects_10_guard_org
  before insert or update on public.projects
  for each row execute function public.tg_guard_org_owned();

drop trigger if exists inputs_10_project_scope on public.inputs;
create trigger inputs_10_project_scope
  before insert or update on public.inputs
  for each row execute function public.tg_enforce_project_scope();

drop trigger if exists inputs_20_updated_at on public.inputs;
create trigger inputs_20_updated_at
  before update on public.inputs
  for each row execute function public.tg_set_updated_at();

drop trigger if exists tickets_10_project_scope on public.tickets;
create trigger tickets_10_project_scope
  before insert or update on public.tickets
  for each row execute function public.tg_enforce_project_scope();

drop trigger if exists tasks_10_project_scope on public.tasks;
create trigger tasks_10_project_scope
  before insert or update on public.tasks
  for each row execute function public.tg_enforce_project_scope();

-- Fonctions de trigger : jamais appelables directement.
revoke all on function public.tg_set_updated_at() from public;
revoke all on function public.tg_guard_org_owned() from public;
revoke all on function public.tg_enforce_project_scope() from public;

-- -----------------------------------------------------------------------------
-- Appartenance à une organisation (utilisée par toutes les politiques RLS)
-- -----------------------------------------------------------------------------

create or replace function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    where m.organization_id = org
      and m.user_id = auth.uid()
  );
$$;

revoke all on function public.is_org_member(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Liaison compte auth ↔ membre (par email, insensible à la casse)
-- -----------------------------------------------------------------------------

-- Nouveau compte auth : lie les membres qui portent cet email et ne sont pas encore liés.
-- Une erreur ici ne doit jamais bloquer la création du compte.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null and new.email <> '' then
    update public.members
    set user_id = new.id
    where lower(email) = lower(new.email)
      and user_id is null;
  end if;
  return new;
exception when others then
  raise warning 'handle_new_auth_user: liaison membre impossible pour %: %', new.id, sqlerrm;
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_link_member on auth.users;
create trigger on_auth_user_created_link_member
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Comptes auth créés avant le seed : le front appelle supabase.rpc('claim_membership')
-- après connexion. Lie les membres non liés portant l'email du JWT (si l'email du
-- compte est confirmé), puis renvoie les lignes members de l'utilisateur.
create or replace function public.claim_membership()
returns setof public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text := nullif(auth.jwt() ->> 'email', '');
begin
  if v_uid is null then
    raise exception 'Non authentifié' using errcode = '42501';
  end if;

  if v_email is not null and exists (
    select 1 from auth.users u
    where u.id = v_uid
      and lower(u.email) = lower(v_email)
      and u.email_confirmed_at is not null
  ) then
    update public.members m
    set user_id = v_uid
    where lower(m.email) = lower(v_email)
      and m.user_id is null;
  end if;

  return query
    select m.* from public.members m
    where m.user_id = v_uid
    order by m.created_at;
end;
$$;

revoke all on function public.claim_membership() from public, anon;
grant execute on function public.claim_membership() to authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.members       enable row level security;
alter table public.clients       enable row level security;
alter table public.projects      enable row level security;
alter table public.inputs        enable row level security;
alter table public.tickets       enable row level security;
alter table public.tasks         enable row level security;

-- Droits explicites : rien pour anon, le strict nécessaire pour authenticated.
-- service_role (fonctions /api) contourne la RLS et garde tous les droits.
revoke all on public.organizations, public.members, public.clients, public.projects,
              public.inputs, public.tickets, public.tasks
  from public, anon, authenticated;

grant select                         on public.organizations to authenticated;
grant select                         on public.members       to authenticated;
grant select, insert, update         on public.clients       to authenticated;
grant select, insert, update         on public.projects      to authenticated;
grant select, insert, update         on public.inputs        to authenticated;
grant select, update, delete         on public.tickets       to authenticated;
grant select, insert, update, delete on public.tasks         to authenticated;

grant all on public.organizations, public.members, public.clients, public.projects,
             public.inputs, public.tickets, public.tasks
  to service_role;

-- organizations
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated
  using (public.is_org_member(id));

-- members
drop policy if exists members_select on public.members;
create policy members_select on public.members
  for select to authenticated
  using (public.is_org_member(organization_id));

-- clients
drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients
  for select to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients
  for insert to authenticated
  with check (public.is_org_member(organization_id));

drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients
  for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- projects
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert to authenticated
  with check (public.is_org_member(organization_id));

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- inputs
drop policy if exists inputs_select on public.inputs;
create policy inputs_select on public.inputs
  for select to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists inputs_insert on public.inputs;
create policy inputs_insert on public.inputs
  for insert to authenticated
  with check (public.is_org_member(organization_id));

drop policy if exists inputs_update on public.inputs;
create policy inputs_update on public.inputs
  for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- tickets (création par /api en service_role uniquement)
drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets
  for select to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets
  for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists tickets_delete on public.tickets;
create policy tickets_delete on public.tickets
  for delete to authenticated
  using (public.is_org_member(organization_id));

-- tasks
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (public.is_org_member(organization_id));

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated
  using (public.is_org_member(organization_id));

-- -----------------------------------------------------------------------------
-- Storage : bucket privé pour les enregistrements de réunion (200 Mo max).
-- Aucune politique storage.objects pour les clients : l'upload et la lecture
-- passent par des URL signées générées côté serveur (service_role).
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('audio', 'audio', false, 209715200)
on conflict (id) do nothing;
