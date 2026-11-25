-- 0016 : date de fin des tâches (tasks.done_at).
-- Sert au récap du lundi (tâches faites la semaine passée) et au bloc « faites récemment » de Mes tâches.
-- Posée par la base quand la tâche passe à « Fait », effacée quand elle en sort ; jamais écrite par le client
-- (toute valeur envoyée est remplacée). Les tâches déjà faites avant cette migration restent sans date.
-- Rejouable.

alter table public.tasks add column if not exists done_at timestamptz;

create index if not exists tasks_done_at_idx on public.tasks (organization_id, done_at) where done_at is not null;

create or replace function public.tg_track_task_done()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'done' then
    new.done_at := null;
  elsif tg_op = 'INSERT' or old.status is distinct from 'done' then
    new.done_at := now();
  else
    new.done_at := old.done_at;
  end if;
  return new;
end;
$$;

revoke all on function public.tg_track_task_done() from public;

drop trigger if exists tasks_25_track_done on public.tasks;
create trigger tasks_25_track_done
  before insert or update on public.tasks
  for each row execute function public.tg_track_task_done();
