-- =============================================================================
-- Sordulo OS : 0012_work
-- Travail de l'équipe : échéance et priorité des tâches, suivi du temps (minuteur, un seul
-- en cours par membre), absences (école, congé), affinités des membres, compétences ouvertes
-- (toute compétence, niveau 0 à 5) et barème de commission de chaque apporteur.
-- Miroir de src/shared/types.ts (Task, TimeEntry, MemberAbsence, Member, CommissionPlan).
--
-- Aucun barème n'est écrit ici : il est saisi dans l'app, par apporteur (données réelles hors git).
--
-- Rejouable : if not exists / create or replace / drop ... if exists.
-- Colonnes ajoutées avec une valeur par défaut ; la contrainte des compétences est élargie
-- (toutes les valeurs déjà acceptées le restent).
-- Pas de BEGIN/COMMIT : scripts/db-migrate.mjs exécute chaque fichier dans sa transaction.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- tasks : échéance et priorité
-- -----------------------------------------------------------------------------

alter table public.tasks add column if not exists due_date date;
alter table public.tasks add column if not exists priority text not null default 'medium'
  constraint tasks_priority_check check (priority in ('low', 'medium', 'high'));

create index if not exists tasks_assignee_due_date_idx on public.tasks (assignee_member_id, due_date)
  where status <> 'done';

-- tasks : droits par table de la 0001 (les nouvelles colonnes suivent la politique d'écriture
-- admin et membre de la 0004).

-- -----------------------------------------------------------------------------
-- members : affinités et compétences ouvertes
-- -----------------------------------------------------------------------------

-- Affinités : sujets que le membre aime traiter (« illustration », « e-commerce »…), 30 au plus.
alter table public.members add column if not exists affinities text[] not null default '{}'
  constraint members_affinities_check check (cardinality(affinities) <= 30);

-- Compétences : objet { "<compétence>": niveau }, toute clé de 1 à 30 caractères, niveau numérique
-- de 0 à 5 (« design » et « dev » restent valides). CASE : l'ordre d'évaluation est garanti,
-- le cast ne voit jamais une valeur qui n'est pas un nombre.
create or replace function private.valid_skill_levels(p_skills jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_skills) = 'object'
     and not exists (
       select 1
       from jsonb_each(p_skills) as e
       where case
               when char_length(btrim(e.key)) not between 1 and 30 then true
               when jsonb_typeof(e.value) <> 'number' then true
               else (e.value)::numeric not between 0 and 5
             end
     );
$$;

revoke all on function private.valid_skill_levels(jsonb) from public, anon;
grant execute on function private.valid_skill_levels(jsonb) to authenticated, service_role;

alter table public.members drop constraint if exists members_skills_levels_check;
alter table public.members add constraint members_skills_levels_check check (private.valid_skill_levels(skills));

-- Droits par colonne des membres (remplace la 0003) : + affinities.
revoke update on public.members from authenticated;
grant update (name, role, skills, weekly_capacity_hours, unavailable_weekdays, affinities)
  on public.members to authenticated;

-- -----------------------------------------------------------------------------
-- Suivi du temps
-- -----------------------------------------------------------------------------

-- Une entrée de temps : minuteur en cours (ended_at null, duration_minutes null) ou terminé
-- (durée calculée à l'arrêt), ou entrée manuelle (started_at + duration_minutes : la base pose
-- ended_at). organization_id est celui du projet (trigger).
create table if not exists public.time_entries (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  project_id       uuid not null references public.projects (id) on delete cascade,
  task_id          uuid references public.tasks (id) on delete set null,
  member_id        uuid not null references public.members (id) on delete cascade,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  duration_minutes integer check (duration_minutes is null or duration_minutes between 0 and 100000),
  note             text check (note is null or char_length(note) <= 1000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint time_entries_dates_check check (ended_at is null or ended_at >= started_at),
  constraint time_entries_running_check check (ended_at is not null or duration_minutes is null)
);

-- Un seul minuteur en cours par membre.
create unique index if not exists time_entries_one_running_key on public.time_entries (member_id) where ended_at is null;
create index if not exists time_entries_org_idx              on public.time_entries (organization_id, started_at desc);
create index if not exists time_entries_project_idx          on public.time_entries (project_id, started_at desc);
create index if not exists time_entries_member_idx           on public.time_entries (member_id, started_at desc);
create index if not exists time_entries_task_id_idx          on public.time_entries (task_id);

-- -----------------------------------------------------------------------------
-- Absences (école, congé)
-- -----------------------------------------------------------------------------

create table if not exists public.member_absences (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  member_id       uuid not null references public.members (id) on delete cascade,
  start_date      date not null,
  end_date        date not null,
  kind            text not null default 'leave' check (kind in ('school', 'leave', 'other')),
  note            text check (note is null or char_length(note) <= 500),
  created_at      timestamptz not null default now(),
  constraint member_absences_dates_check check (end_date >= start_date)
);

create index if not exists member_absences_member_idx on public.member_absences (member_id, start_date);
create index if not exists member_absences_org_idx    on public.member_absences (organization_id, start_date);

-- -----------------------------------------------------------------------------
-- Barème de commission d'un apporteur
-- -----------------------------------------------------------------------------

-- Tranches : [{ "up_to_cents": entier > 0 ou null, "rate": % de 0 à 100 }], plafonds strictement
-- croissants, la dernière (et elle seule) sans plafond (null). Ex. : 12 % jusqu'à 3 000 €, 10 %
-- jusqu'à 10 000 €, 8 % au-delà. Même règle dans src/shared/commission.ts (validateTiers).
create or replace function private.valid_commission_tiers(p_tiers jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_tier  jsonb;
  v_index integer;
  v_count integer;
  v_prev  numeric := 0;
  v_cap   numeric;
  v_rate  numeric;
begin
  if p_tiers is null or jsonb_typeof(p_tiers) <> 'array' then
    return false;
  end if;
  v_count := jsonb_array_length(p_tiers);
  if v_count = 0 then
    return false;
  end if;

  for v_tier, v_index in
    select e.value, e.ordinality::integer from jsonb_array_elements(p_tiers) with ordinality as e
  loop
    if jsonb_typeof(v_tier) <> 'object' or jsonb_typeof(v_tier -> 'rate') is distinct from 'number' then
      return false;
    end if;
    v_rate := (v_tier ->> 'rate')::numeric;
    if v_rate < 0 or v_rate > 100 then
      return false;
    end if;

    if v_index = v_count then
      if jsonb_typeof(v_tier -> 'up_to_cents') is distinct from 'null' and v_tier ? 'up_to_cents' then
        return false;
      end if;
    else
      if jsonb_typeof(v_tier -> 'up_to_cents') is distinct from 'number' then
        return false;
      end if;
      v_cap := (v_tier ->> 'up_to_cents')::numeric;
      if v_cap <> trunc(v_cap) or v_cap <= v_prev then
        return false;
      end if;
      v_prev := v_cap;
    end if;
  end loop;

  return true;
end;
$$;

revoke all on function private.valid_commission_tiers(jsonb) from public, anon;
grant execute on function private.valid_commission_tiers(jsonb) to authenticated, service_role;

create table if not exists public.commission_plans (
  member_id              uuid primary key references public.members (id) on delete cascade,
  organization_id        uuid not null references public.organizations (id) on delete cascade,
  -- Barème du premier devis signé (CommissionTier[]), cumulatif sur l'encaissé.
  tiers                  jsonb not null
                           constraint commission_plans_tiers_check check (private.valid_commission_tiers(tiers)),
  -- % sur l'encaissé des devis suivants signés dans followup_window_months après le premier.
  followup_rate          numeric(5, 2) not null check (followup_rate between 0 and 100),
  -- Le client doit signer son premier devis dans ce délai après son enregistrement (prospects.registered_at).
  sign_window_months     integer not null default 6 check (sign_window_months between 1 and 120),
  followup_window_months integer not null default 12 check (followup_window_months between 0 and 120),
  active                 boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists commission_plans_org_idx on public.commission_plans (organization_id);

-- -----------------------------------------------------------------------------
-- Triggers d'intégrité
-- -----------------------------------------------------------------------------

-- time_entries : s'exécute après time_entries_10_project_scope. Tâche du même projet, membre de
-- l'organisation (membre connecté par défaut), durée calculée à l'arrêt, fin posée pour une
-- entrée manuelle.
create or replace function public.tg_time_entry_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id then
      raise exception 'Une entrée de temps ne peut pas changer d''organisation' using errcode = '42501';
    end if;
    new.id         := old.id;
    new.created_at := old.created_at;
  else
    new.member_id := coalesce(new.member_id, private.current_member_id(new.organization_id));
  end if;

  if tg_op = 'INSERT' or new.member_id is distinct from old.member_id then
    if new.member_id is null or not exists (
      select 1 from public.members m where m.id = new.member_id and m.organization_id = new.organization_id
    ) then
      raise exception 'Le membre n''appartient pas à l''organisation du projet' using errcode = '23514';
    end if;
  end if;

  if new.task_id is not null
     and (tg_op = 'INSERT' or new.task_id is distinct from old.task_id or new.project_id is distinct from old.project_id)
     and not exists (
       select 1 from public.tasks t where t.id = new.task_id and t.project_id = new.project_id
     ) then
    raise exception 'La tâche n''appartient pas au projet' using errcode = '23514';
  end if;

  if new.ended_at is null then
    -- Entrée manuelle : début + durée.
    if new.duration_minutes is not null then
      new.ended_at := new.started_at + make_interval(mins => new.duration_minutes);
    end if;
  elsif (tg_op = 'INSERT' and new.duration_minutes is null)
     or (tg_op = 'UPDATE'
         and (new.ended_at is distinct from old.ended_at or new.started_at is distinct from old.started_at)
         and new.duration_minutes is not distinct from old.duration_minutes) then
    -- Arrêt du minuteur (ou dates corrigées) : durée arrondie à la minute.
    new.duration_minutes := greatest(0, round(extract(epoch from new.ended_at - new.started_at) / 60))::integer;
  end if;

  return new;
end;
$$;

-- member_absences : organisation du membre.
create or replace function public.tg_member_absence_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.id         := old.id;
    new.member_id  := old.member_id;
    new.organization_id := old.organization_id;
    new.created_at := old.created_at;
  else
    select m.organization_id into new.organization_id from public.members m where m.id = new.member_id;
    if new.organization_id is null then
      raise exception 'Membre % introuvable', new.member_id using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

-- commission_plans : organisation du membre, figée.
create or replace function public.tg_commission_plan_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.member_id       := old.member_id;
    new.organization_id := old.organization_id;
    new.created_at      := old.created_at;
  else
    select m.organization_id into new.organization_id from public.members m where m.id = new.member_id;
    if new.organization_id is null then
      raise exception 'Membre % introuvable', new.member_id using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists time_entries_10_project_scope on public.time_entries;
create trigger time_entries_10_project_scope
  before insert or update on public.time_entries
  for each row execute function public.tg_enforce_project_scope();

drop trigger if exists time_entries_15_guard on public.time_entries;
create trigger time_entries_15_guard
  before insert or update on public.time_entries
  for each row execute function public.tg_time_entry_guard();

drop trigger if exists time_entries_20_updated_at on public.time_entries;
create trigger time_entries_20_updated_at
  before update on public.time_entries
  for each row execute function public.tg_set_updated_at();

drop trigger if exists member_absences_10_guard on public.member_absences;
create trigger member_absences_10_guard
  before insert or update on public.member_absences
  for each row execute function public.tg_member_absence_guard();

drop trigger if exists commission_plans_10_guard on public.commission_plans;
create trigger commission_plans_10_guard
  before insert or update on public.commission_plans
  for each row execute function public.tg_commission_plan_guard();

drop trigger if exists commission_plans_20_updated_at on public.commission_plans;
create trigger commission_plans_20_updated_at
  before update on public.commission_plans
  for each row execute function public.tg_set_updated_at();

revoke all on function public.tg_time_entry_guard()      from public, anon, authenticated, service_role;
revoke all on function public.tg_member_absence_guard()  from public, anon, authenticated, service_role;
revoke all on function public.tg_commission_plan_guard() from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Droits (rien pour anon)
-- -----------------------------------------------------------------------------

alter table public.time_entries     enable row level security;
alter table public.member_absences  enable row level security;
alter table public.commission_plans enable row level security;

revoke all on public.time_entries, public.member_absences, public.commission_plans from public, anon, authenticated;

grant select, delete on public.time_entries to authenticated;
grant insert (project_id, task_id, member_id, started_at, ended_at, duration_minutes, note)
  on public.time_entries to authenticated;
grant update (project_id, task_id, started_at, ended_at, duration_minutes, note)
  on public.time_entries to authenticated;

grant select, delete on public.member_absences to authenticated;
grant insert (member_id, start_date, end_date, kind, note) on public.member_absences to authenticated;
grant update (start_date, end_date, kind, note) on public.member_absences to authenticated;

grant select, delete on public.commission_plans to authenticated;
grant insert (member_id, tiers, followup_rate, sign_window_months, followup_window_months, active)
  on public.commission_plans to authenticated;
grant update (tiers, followup_rate, sign_window_months, followup_window_months, active)
  on public.commission_plans to authenticated;

grant all on public.time_entries, public.member_absences, public.commission_plans to service_role;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

-- time_entries : lecture par admin, membre et finance ; écriture de ses propres entrées
-- (admin et membre), ou de toutes par un admin.
drop policy if exists time_entries_select on public.time_entries;
create policy time_entries_select on public.time_entries
  for select to authenticated
  using (organization_id in (select private.user_reader_org_ids()));

drop policy if exists time_entries_insert on public.time_entries;
create policy time_entries_insert on public.time_entries
  for insert to authenticated
  with check (
    (organization_id in (select private.user_writer_org_ids()) and member_id in (select private.user_member_ids()))
    or organization_id in (select private.user_admin_org_ids())
  );

drop policy if exists time_entries_update on public.time_entries;
create policy time_entries_update on public.time_entries
  for update to authenticated
  using (
    (organization_id in (select private.user_writer_org_ids()) and member_id in (select private.user_member_ids()))
    or organization_id in (select private.user_admin_org_ids())
  )
  with check (
    (organization_id in (select private.user_writer_org_ids()) and member_id in (select private.user_member_ids()))
    or organization_id in (select private.user_admin_org_ids())
  );

drop policy if exists time_entries_delete on public.time_entries;
create policy time_entries_delete on public.time_entries
  for delete to authenticated
  using (
    (organization_id in (select private.user_writer_org_ids()) and member_id in (select private.user_member_ids()))
    or organization_id in (select private.user_admin_org_ids())
  );

-- member_absences : lecture par toute l'organisation ; écriture par un admin, ou soi-même.
drop policy if exists member_absences_select on public.member_absences;
create policy member_absences_select on public.member_absences
  for select to authenticated
  using (organization_id in (select private.user_org_ids()));

drop policy if exists member_absences_insert on public.member_absences;
create policy member_absences_insert on public.member_absences
  for insert to authenticated
  with check (
    member_id in (select private.user_member_ids())
    or organization_id in (select private.user_admin_org_ids())
  );

drop policy if exists member_absences_update on public.member_absences;
create policy member_absences_update on public.member_absences
  for update to authenticated
  using (
    member_id in (select private.user_member_ids())
    or organization_id in (select private.user_admin_org_ids())
  )
  with check (
    member_id in (select private.user_member_ids())
    or organization_id in (select private.user_admin_org_ids())
  );

drop policy if exists member_absences_delete on public.member_absences;
create policy member_absences_delete on public.member_absences
  for delete to authenticated
  using (
    member_id in (select private.user_member_ids())
    or organization_id in (select private.user_admin_org_ids())
  );

-- commission_plans : lecture par admin, finance et l'apporteur concerné ; écriture par les admins.
drop policy if exists commission_plans_select on public.commission_plans;
create policy commission_plans_select on public.commission_plans
  for select to authenticated
  using (
    organization_id in (select private.user_finance_org_ids())
    or member_id in (select private.user_member_ids())
  );

drop policy if exists commission_plans_insert on public.commission_plans;
create policy commission_plans_insert on public.commission_plans
  for insert to authenticated
  with check (organization_id in (select private.user_admin_org_ids()));

drop policy if exists commission_plans_update on public.commission_plans;
create policy commission_plans_update on public.commission_plans
  for update to authenticated
  using (organization_id in (select private.user_admin_org_ids()))
  with check (organization_id in (select private.user_admin_org_ids()));

drop policy if exists commission_plans_delete on public.commission_plans;
create policy commission_plans_delete on public.commission_plans
  for delete to authenticated
  using (organization_id in (select private.user_admin_org_ids()));
