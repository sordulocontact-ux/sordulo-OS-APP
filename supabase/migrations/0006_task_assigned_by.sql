-- =============================================================================
-- Sordulo OS : 0006_task_assigned_by
-- Garde qui a attribué une tâche et quand, pour la notification « X t'a assigné une
-- tâche » de l'île de l'app de bureau, et publie public.tasks sur Supabase Realtime.
--
-- Rejouable. Colonnes facultatives : aucune donnée existante n'est modifiée (les tâches
-- déjà attribuées gardent assigned_by_member_id et assigned_at à null, donc aucune
-- notification rétroactive).
-- Pas de BEGIN/COMMIT : scripts/db-migrate.mjs exécute chaque fichier dans sa transaction.
-- =============================================================================

alter table public.tasks add column if not exists assigned_by_member_id uuid
  references public.members (id) on delete set null;
alter table public.tasks add column if not exists assigned_at timestamptz;

create index if not exists tasks_assigned_by_member_id_idx on public.tasks (assigned_by_member_id);

-- Remplit assigned_by_member_id / assigned_at à chaque changement d'assigné. Le client ne
-- peut pas les falsifier : les valeurs fournies sont toujours écrasées.
-- Auteur = le membre du compte connecté dans l'organisation de la tâche (null sans
-- utilisateur : service_role, scripts). S'exécute après tasks_10_project_scope
-- (ordre alphabétique) : organization_id est donc déjà fiable.
create or replace function public.tg_track_task_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignee_member_id is null then
    new.assigned_by_member_id := null;
    new.assigned_at := null;
  elsif tg_op = 'INSERT' or new.assignee_member_id is distinct from old.assignee_member_id then
    new.assigned_at := now();
    select m.id into new.assigned_by_member_id
    from public.members m
    where m.user_id = (select auth.uid())
      and m.organization_id = new.organization_id
    limit 1;
  else
    -- Assigné inchangé (changement de statut, de position…) : on garde l'historique.
    new.assigned_by_member_id := old.assigned_by_member_id;
    new.assigned_at := old.assigned_at;
  end if;
  return new;
end;
$$;

revoke all on function public.tg_track_task_assignment() from public;

drop trigger if exists tasks_20_track_assignment on public.tasks;
create trigger tasks_20_track_assignment
  before insert or update on public.tasks
  for each row execute function public.tg_track_task_assignment();

-- Realtime : la RLS de public.tasks (tasks_select) filtre les événements par organisation.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
     ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
end;
$$;
