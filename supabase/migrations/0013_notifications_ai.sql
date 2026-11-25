-- =============================================================================
-- Sordulo OS : 0013_notifications_ai
-- Notifications in-app (cloche et île), créées par la base aux passages de main ou par la RPC
-- create_notification ; propositions de l'IA (réorganisation du planning) avec « Toujours »
-- (règles d'autonomie) et annulation ; brouillons de relance des devis et factures.
-- Miroir de src/shared/types.ts (AppNotification, AiProposal, AiAutonomyRule, Followup).
--
-- Règle commune des déclencheurs : on ne notifie jamais l'auteur de l'action (membre du compte
-- connecté) ; une action du serveur (clé service, sans compte) notifie tout le monde.
-- Les déclencheurs des commissions (0014) et des commentaires de livrables (0015) sont dans
-- leur migration, avec leur table.
--
-- Rejouable : if not exists / create or replace / drop ... if exists.
-- Nouvelles tables : aucune donnée existante n'est modifiée.
-- Pas de BEGIN/COMMIT : scripts/db-migrate.mjs exécute chaque fichier dans sa transaction.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Notifications
-- -----------------------------------------------------------------------------

create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Destinataire.
  member_id       uuid not null references public.members (id) on delete cascade,
  -- Type (« prospect.created », « task.assigned »…) : lettres minuscules, chiffres, « . » et « _ ».
  kind            text not null check (kind ~ '^[a-z0-9_.]{1,60}$'),
  title           text not null check (btrim(title) <> '' and char_length(title) <= 200),
  body            text check (body is null or char_length(body) <= 2000),
  -- Route de l'app (« /prospects/<id> »…).
  link            text check (link is null or (link ~ '^/' and char_length(link) <= 500)),
  payload         jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  -- Dédoublonnage : une seule notification par destinataire et clé (récap du lundi, relances…).
  dedupe_key      text check (dedupe_key is null or char_length(dedupe_key) between 1 and 200),
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

create unique index if not exists notifications_dedupe_key on public.notifications (member_id, dedupe_key) where dedupe_key is not null;
create index if not exists notifications_member_idx        on public.notifications (member_id, created_at desc);
create index if not exists notifications_unread_idx        on public.notifications (member_id) where read_at is null;
create index if not exists notifications_org_idx           on public.notifications (organization_id);

-- Crée une notification pour un membre actif (organisation déduite du membre). Renvoie l'id, ou
-- null si le membre est retiré ou si la clé de dédoublonnage existe déjà. Interne : une erreur
-- (titre vide…) n'empêche jamais l'action qui a déclenché la notification.
create or replace function private.notify(
  p_member_id  uuid,
  p_kind       text,
  p_title      text,
  p_body       text,
  p_link       text,
  p_payload    jsonb,
  p_dedupe_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id  uuid;
begin
  select m.organization_id into v_org
  from public.members m
  where m.id = p_member_id and m.removed_at is null;
  if v_org is null then
    return null;
  end if;

  begin
    insert into public.notifications (organization_id, member_id, kind, title, body, link, payload, dedupe_key)
    values (v_org, p_member_id, p_kind, left(btrim(p_title), 200), left(p_body, 2000), p_link,
            coalesce(p_payload, '{}'::jsonb), p_dedupe_key)
    on conflict (member_id, dedupe_key) where dedupe_key is not null do nothing
    returning id into v_id;
  exception when others then
    raise warning 'notify: notification % pour % non créée : %', p_kind, p_member_id, sqlerrm;
    return null;
  end;

  return v_id;
end;
$$;

-- Admins actifs d'une organisation.
create or replace function private.org_admin_ids(p_org uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id from public.members m
  where m.organization_id = p_org and m.role = 'admin' and m.removed_at is null;
$$;

-- Libellé français d'une étape de prospection (même texte que LABELS.prospectStage).
create or replace function private.prospect_stage_label(p_stage text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_stage
    when 'to_audit' then 'À auditer'
    when 'offer_ready' then 'Offre prête'
    when 'to_contact' then 'À contacter'
    when 'contacted' then 'Contacté'
    when 'followed_up' then 'Relancé'
    when 'meeting' then 'Rendez-vous'
    when 'won' then 'Gagné'
    when 'lost' then 'Perdu'
    else p_stage
  end;
$$;

revoke all on function private.notify(uuid, text, text, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function private.org_admin_ids(uuid)                              from public, anon, authenticated;
revoke all on function private.prospect_stage_label(text)                       from public, anon;
grant execute on function private.notify(uuid, text, text, text, text, jsonb, text) to service_role;
grant execute on function private.org_admin_ids(uuid)                              to service_role;
grant execute on function private.prospect_stage_label(text)                       to authenticated, service_role;

-- RPC : supabase.rpc('create_notification', { p_member_id, p_kind, p_title, p_body, p_link, p_payload, p_dedupe_key })
-- Appelant : membre actif de l'organisation du destinataire (soi-même compris : récap du lundi,
-- relances, seuils calculés à l'ouverture de l'app), ou le serveur (clé service).
-- Dédoublonnage silencieux : renvoie l'id créé, ou null si la clé existe déjà pour ce destinataire.
create or replace function public.create_notification(
  p_member_id  uuid,
  p_kind       text,
  p_title      text,
  p_body       text default null,
  p_link       text default null,
  p_payload    jsonb default '{}'::jsonb,
  p_dedupe_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_server boolean := auth.uid() is null and coalesce(auth.jwt() ->> 'role', '') = 'service_role';
  v_org    uuid;
begin
  if auth.uid() is null and not v_server then
    raise exception 'Non authentifié' using errcode = '42501';
  end if;

  select m.organization_id into v_org
  from public.members m
  where m.id = p_member_id and m.removed_at is null;

  if v_org is null or (not v_server and v_org not in (select private.user_org_ids())) then
    raise exception 'Destinataire inconnu dans ton organisation' using errcode = '42501';
  end if;

  if p_kind is null or p_kind !~ '^[a-z0-9_.]{1,60}$' then
    raise exception 'Type de notification invalide' using errcode = '22023';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'Le titre de la notification est obligatoire' using errcode = '22023';
  end if;
  if p_link is not null and p_link !~ '^/' then
    raise exception 'Le lien doit être une route de l''app (commence par /)' using errcode = '22023';
  end if;
  if p_payload is not null and jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload doit être un objet' using errcode = '22023';
  end if;

  return private.notify(p_member_id, p_kind, p_title, p_body, left(p_link, 500), p_payload, left(p_dedupe_key, 200));
end;
$$;

revoke all on function public.create_notification(uuid, text, text, text, text, jsonb, text) from public, anon;
grant execute on function public.create_notification(uuid, text, text, text, text, jsonb, text) to authenticated, service_role;

alter table public.notifications enable row level security;

revoke all on public.notifications from public, anon, authenticated;
-- Pas d'insertion directe : create_notification et les déclencheurs. Seul read_at change.
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.notifications to service_role;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (member_id in (select private.user_member_ids()));

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (member_id in (select private.user_member_ids()))
  with check (member_id in (select private.user_member_ids()));

-- Realtime : la RLS (notifications_select) filtre les événements par destinataire.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Déclencheurs des notifications (passages de main)
-- -----------------------------------------------------------------------------

-- Prospects : créé par un apporteur → admins ; étape changée par quelqu'un d'autre → l'apporteur
-- (« Offre prête » quand le pré-audit ou l'audit est fait et l'offre choisie).
create or replace function public.tg_notify_prospect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := private.current_member_id(new.organization_id);
  v_creator public.members;
  v_admin   uuid;
  v_link    text := '/prospects/' || new.id::text;
  v_payload jsonb := jsonb_build_object('prospect_id', new.id);
begin
  if tg_op = 'INSERT' then
    select m.* into v_creator from public.members m where m.id = new.created_by;
    if v_creator.role = 'prospection' then
      for v_admin in select private.org_admin_ids(new.organization_id) loop
        continue when v_admin = v_actor;
        perform private.notify(v_admin, 'prospect.created',
          v_creator.name || ' a ajouté un site : ' || new.company,
          new.website, v_link, v_payload, 'prospect.created:' || new.id::text);
      end loop;
    end if;
    return null;
  end if;

  if new.stage is distinct from old.stage
     and new.owner_member_id is not null
     and new.owner_member_id is distinct from v_actor then
    if new.stage = 'offer_ready' then
      perform private.notify(new.owner_member_id, 'prospect.offer_ready',
        'Offre prête pour ' || new.company,
        'L''audit est fait et l''offre est choisie : à toi de jouer.',
        v_link, v_payload || jsonb_build_object('stage', new.stage), null);
    else
      perform private.notify(new.owner_member_id, 'prospect.stage',
        new.company || ' : ' || private.prospect_stage_label(new.stage),
        'Étape précédente : ' || private.prospect_stage_label(old.stage),
        v_link, v_payload || jsonb_build_object('stage', new.stage), null);
    end if;
  end if;
  return null;
end;
$$;

-- Tâches : attribuée par quelqu'un d'autre → la personne attribuée. Pas pendant la proposition
-- (ticket « proposé » : l'attribution est une suggestion de l'IA, notifiée à la validation).
create or replace function public.tg_notify_task_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_by_name text;
begin
  if new.assignee_member_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.assignee_member_id is not distinct from old.assignee_member_id then
    return null;
  end if;
  if new.assigned_by_member_id is not distinct from new.assignee_member_id then
    return null;
  end if;
  if new.ticket_id is not null and exists (
    select 1 from public.tickets t where t.id = new.ticket_id and t.status = 'proposed'
  ) then
    return null;
  end if;

  select m.name into v_by_name from public.members m where m.id = new.assigned_by_member_id;
  perform private.notify(new.assignee_member_id, 'task.assigned',
    case when v_by_name is not null then v_by_name || ' t''a attribué une tâche : ' else 'Nouvelle tâche pour toi : ' end
      || new.title,
    null,
    '/projects/' || new.project_id::text || '/tasks',
    jsonb_build_object('task_id', new.id, 'project_id', new.project_id),
    null);
  return null;
end;
$$;

-- Tickets : validés → les personnes attribuées à leurs tâches (sauf l'auteur de la validation).
create or replace function public.tg_notify_ticket_validated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_member_id(new.organization_id);
  v_name  text;
  v_task  record;
begin
  if new.status <> 'validated' or old.status <> 'proposed' then
    return null;
  end if;
  select m.name into v_name from public.members m where m.id = v_actor;

  for v_task in
    select t.id, t.title, t.assignee_member_id
    from public.tasks t
    where t.ticket_id = new.id and t.assignee_member_id is not null
  loop
    continue when v_task.assignee_member_id = v_actor;
    perform private.notify(v_task.assignee_member_id, 'task.assigned',
      case when v_name is not null then v_name || ' t''a attribué une tâche : ' else 'Nouvelle tâche pour toi : ' end
        || v_task.title,
      new.title,
      '/projects/' || new.project_id::text || '/tasks',
      jsonb_build_object('task_id', v_task.id, 'project_id', new.project_id, 'ticket_id', new.id),
      null);
  end loop;
  return null;
end;
$$;

-- Entrées : prête avec des tickets proposés → son créateur.
create or replace function public.tg_notify_input_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if new.status <> 'ready' or old.status = 'ready' or new.created_by is null
     or new.created_by is not distinct from private.current_member_id(new.organization_id) then
    return null;
  end if;

  select count(*) into v_count from public.tickets t where t.input_id = new.id and t.status = 'proposed';
  if v_count = 0 then
    return null;
  end if;

  perform private.notify(new.created_by, 'input.ready',
    'Tickets à valider : ' || coalesce(nullif(btrim(new.title), ''), 'nouvelle entrée'),
    v_count || case when v_count > 1 then ' tickets proposés' else ' ticket proposé' end,
    '/projects/' || new.project_id::text || '/inputs/' || new.id::text || '/review',
    jsonb_build_object('input_id', new.id, 'project_id', new.project_id, 'ticket_count', v_count),
    null);
  return null;
end;
$$;

-- Dépôts : prêt à ranger → son créateur ; rangé seul par une règle « Toujours » → son créateur
-- (la notification permet d'annuler le rangement).
create or replace function public.tg_notify_file_intake()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  if new.created_by is null
     or (tg_op = 'UPDATE' and new.status is not distinct from old.status)
     or new.created_by is not distinct from private.current_member_id(new.organization_id) then
    return null;
  end if;

  v_payload := jsonb_build_object('intake_id', new.id, 'batch_id', new.batch_id, 'source', new.source);

  if new.status = 'ready' then
    perform private.notify(new.created_by, 'file.ready',
      'Fichier prêt à ranger : ' || new.name,
      case when new.confidence is not null then 'Confiance : ' || round(new.confidence * 100)::text || ' %' end,
      '/files/intake/' || new.id::text,
      v_payload || jsonb_build_object('confidence', new.confidence),
      null);
  elsif new.status = 'filed' and new.auto_filed then
    perform private.notify(new.created_by, 'file.auto_filed',
      'Rangé automatiquement : ' || new.name,
      'Grâce à une règle « Toujours ». Tu peux annuler ce rangement.',
      '/files/intake/' || new.id::text,
      v_payload || jsonb_build_object('file_id', new.filed_file_id, 'rule_id', new.rule_id),
      null);
  end if;
  return null;
end;
$$;

drop trigger if exists prospects_40_notify on public.prospects;
create trigger prospects_40_notify
  after insert or update of stage on public.prospects
  for each row execute function public.tg_notify_prospect();

drop trigger if exists tasks_40_notify_assignment on public.tasks;
create trigger tasks_40_notify_assignment
  after insert or update of assignee_member_id on public.tasks
  for each row execute function public.tg_notify_task_assignment();

drop trigger if exists tickets_40_notify_validated on public.tickets;
create trigger tickets_40_notify_validated
  after update of status on public.tickets
  for each row execute function public.tg_notify_ticket_validated();

drop trigger if exists inputs_40_notify_ready on public.inputs;
create trigger inputs_40_notify_ready
  after update of status on public.inputs
  for each row execute function public.tg_notify_input_ready();

drop trigger if exists file_intakes_40_notify on public.file_intakes;
create trigger file_intakes_40_notify
  after insert or update of status on public.file_intakes
  for each row execute function public.tg_notify_file_intake();

revoke all on function public.tg_notify_prospect()         from public, anon, authenticated, service_role;
revoke all on function public.tg_notify_task_assignment()  from public, anon, authenticated, service_role;
revoke all on function public.tg_notify_ticket_validated() from public, anon, authenticated, service_role;
revoke all on function public.tg_notify_input_ready()      from public, anon, authenticated, service_role;
revoke all on function public.tg_notify_file_intake()      from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Propositions de l'IA et règles d'autonomie (« Toujours »)
-- -----------------------------------------------------------------------------

-- Règle « Toujours » : les propositions de ce type (et de ce périmètre) s'appliquent seules.
create table if not exists public.ai_autonomy_rules (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind            text not null check (kind in ('reassign_task', 'move_due_date', 'reorder', 'other')),
  -- Périmètre (ex. { "project_id": "…" }) ; {} = toute l'organisation.
  scope           jsonb not null default '{}'::jsonb check (jsonb_typeof(scope) = 'object'),
  created_by      uuid references public.members (id) on delete set null,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz
);

-- Proposition de l'IA. payload : { operations: [{ task_id, before: {…}, after: {…} }], member_ids: [...] } ;
-- clés modifiables dans before / after : assignee_member_id, due_date, priority, position.
create table if not exists public.ai_proposals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id      uuid references public.projects (id) on delete cascade,
  kind            text not null check (kind in ('reassign_task', 'move_due_date', 'reorder', 'other')),
  title           text not null check (btrim(title) <> '' and char_length(title) <= 200),
  explanation     text check (explanation is null or char_length(explanation) <= 4000),
  payload         jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status          text not null default 'pending'
                    check (status in ('pending', 'accepted', 'refused', 'auto_applied', 'undone')),
  rule_id         uuid references public.ai_autonomy_rules (id) on delete set null,
  decided_by      uuid references public.members (id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists ai_autonomy_rules_org_idx on public.ai_autonomy_rules (organization_id, kind) where revoked_at is null;
create index if not exists ai_proposals_org_idx      on public.ai_proposals (organization_id, status, created_at desc);
create index if not exists ai_proposals_project_idx  on public.ai_proposals (project_id);
create index if not exists ai_proposals_rule_id_idx  on public.ai_proposals (rule_id);

-- ai_proposals : organisation du projet s'il y en a un, figée ; règle de la même organisation.
create or replace function public.tg_ai_proposal_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if tg_op = 'UPDATE' then
    new.id         := old.id;
    new.created_at := old.created_at;
  end if;

  if new.project_id is not null and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id) then
    select p.organization_id into v_org from public.projects p where p.id = new.project_id;
    if v_org is null then
      raise exception 'Projet % introuvable', new.project_id using errcode = '23503';
    end if;
    new.organization_id := v_org;
  end if;

  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception 'Une proposition ne peut pas changer d''organisation' using errcode = '42501';
  end if;

  if new.rule_id is not null
     and (tg_op = 'INSERT' or new.rule_id is distinct from old.rule_id)
     and not exists (
       select 1 from public.ai_autonomy_rules r where r.id = new.rule_id and r.organization_id = new.organization_id
     ) then
    raise exception 'La règle n''appartient pas à l''organisation de la proposition' using errcode = '23514';
  end if;

  if jsonb_typeof(new.payload -> 'operations') not in ('array', 'null')
     or jsonb_typeof(new.payload -> 'member_ids') not in ('array', 'null') then
    raise exception 'payload.operations et payload.member_ids doivent être des listes' using errcode = '23514';
  end if;

  return new;
end;
$$;

-- ai_autonomy_rules : auteur = membre connecté par défaut ; seule la révocation change ensuite.
create or replace function public.tg_ai_autonomy_rule_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.id              := old.id;
    new.organization_id := old.organization_id;
    new.kind            := old.kind;
    new.scope           := old.scope;
    new.created_by      := old.created_by;
    new.created_at      := old.created_at;
  else
    new.created_by := coalesce(new.created_by, private.current_member_id(new.organization_id));
    if new.created_by is not null and not exists (
      select 1 from public.members m where m.id = new.created_by and m.organization_id = new.organization_id
    ) then
      raise exception 'created_by n''est pas membre de l''organisation de la règle' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- Nouvelle proposition → membres visés (payload.member_ids, sinon les admins), sauf l'auteur.
create or replace function public.tg_notify_ai_proposal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := private.current_member_id(new.organization_id);
  v_member uuid;
  v_title  text;
begin
  v_title := case when new.status = 'auto_applied' then 'Appliqué automatiquement : ' else 'Proposition : ' end || new.title;

  for v_member in
    select m.id
    from public.members m
    where m.organization_id = new.organization_id
      and m.removed_at is null
      and (
        (jsonb_typeof(new.payload -> 'member_ids') = 'array'
         and jsonb_array_length(new.payload -> 'member_ids') > 0
         and m.id::text in (select jsonb_array_elements_text(new.payload -> 'member_ids')))
        or (coalesce(jsonb_array_length(case when jsonb_typeof(new.payload -> 'member_ids') = 'array'
                                             then new.payload -> 'member_ids' end), 0) = 0
            and m.role = 'admin')
      )
  loop
    continue when v_member = v_actor;
    perform private.notify(v_member, 'proposal.created', v_title, new.explanation, '/proposals',
      jsonb_build_object('proposal_id', new.id, 'project_id', new.project_id, 'status', new.status), null);
  end loop;
  return null;
end;
$$;

drop trigger if exists ai_proposals_10_guard on public.ai_proposals;
create trigger ai_proposals_10_guard
  before insert or update on public.ai_proposals
  for each row execute function public.tg_ai_proposal_guard();

drop trigger if exists ai_proposals_40_notify on public.ai_proposals;
create trigger ai_proposals_40_notify
  after insert on public.ai_proposals
  for each row execute function public.tg_notify_ai_proposal();

drop trigger if exists ai_autonomy_rules_10_guard on public.ai_autonomy_rules;
create trigger ai_autonomy_rules_10_guard
  before insert or update on public.ai_autonomy_rules
  for each row execute function public.tg_ai_autonomy_rule_guard();

revoke all on function public.tg_ai_proposal_guard()      from public, anon, authenticated, service_role;
revoke all on function public.tg_ai_autonomy_rule_guard() from public, anon, authenticated, service_role;
revoke all on function public.tg_notify_ai_proposal()     from public, anon, authenticated, service_role;

-- Applique un côté (« before » ou « after ») des opérations d'une proposition aux tâches de
-- l'organisation. Seules les clés présentes changent : assignee_member_id, due_date, priority,
-- position. Une tâche introuvable (supprimée, autre organisation) annule tout.
create or replace function private.apply_proposal_operations(p_org uuid, p_payload jsonb, p_side text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op      jsonb;
  v_values  jsonb;
  v_task_id uuid;
begin
  for v_op in
    select e.value from jsonb_array_elements(coalesce(p_payload -> 'operations', '[]'::jsonb)) as e
  loop
    if jsonb_typeof(v_op) <> 'object' or jsonb_typeof(v_op -> 'task_id') is distinct from 'string' then
      raise exception 'Opération invalide dans la proposition' using errcode = '23514';
    end if;
    v_values := v_op -> p_side;
    continue when v_values is null or jsonb_typeof(v_values) <> 'object';

    select t.id into v_task_id
    from public.tasks t
    where t.id::text = v_op ->> 'task_id' and t.organization_id = p_org
    for update;
    if v_task_id is null then
      raise exception 'Une tâche de la proposition n''existe plus' using errcode = 'P0001';
    end if;

    update public.tasks t
    set assignee_member_id = case when v_values ? 'assignee_member_id'
                                  then (v_values ->> 'assignee_member_id')::uuid else t.assignee_member_id end,
        due_date           = case when v_values ? 'due_date'
                                  then (v_values ->> 'due_date')::date else t.due_date end,
        priority           = case when v_values ? 'priority'
                                  then v_values ->> 'priority' else t.priority end,
        position           = case when v_values ? 'position'
                                  then (v_values ->> 'position')::double precision else t.position end
    where t.id = v_task_id;
  end loop;
end;
$$;

revoke all on function private.apply_proposal_operations(uuid, jsonb, text) from public, anon, authenticated, service_role;

-- RPC : supabase.rpc('apply_ai_proposal', { p_id, p_always }) → la proposition à jour.
-- Applique les valeurs « after » ; p_always crée la règle « Toujours » (même type, périmètre
-- payload.scope, sinon le projet de la proposition). Appelant : admin ou membre actif.
create or replace function public.apply_ai_proposal(p_id uuid, p_always boolean default false)
returns public.ai_proposals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal public.ai_proposals;
  v_member   uuid;
  v_rule_id  uuid;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié' using errcode = '42501';
  end if;

  select p.* into v_proposal from public.ai_proposals p where p.id = p_id for update;
  if v_proposal.id is null or v_proposal.organization_id not in (select private.user_writer_org_ids()) then
    raise exception 'Réservé aux admins et membres de l''organisation' using errcode = '42501';
  end if;
  if v_proposal.status <> 'pending' then
    raise exception 'Cette proposition a déjà été traitée' using errcode = 'P0001';
  end if;

  perform private.apply_proposal_operations(v_proposal.organization_id, v_proposal.payload, 'after');
  v_member := private.current_member_id(v_proposal.organization_id);

  if coalesce(p_always, false) then
    insert into public.ai_autonomy_rules (organization_id, kind, scope, created_by)
    values (
      v_proposal.organization_id,
      v_proposal.kind,
      coalesce(
        case when jsonb_typeof(v_proposal.payload -> 'scope') = 'object' then v_proposal.payload -> 'scope' end,
        case when v_proposal.project_id is not null then jsonb_build_object('project_id', v_proposal.project_id) end,
        '{}'::jsonb
      ),
      v_member
    )
    returning id into v_rule_id;
  end if;

  update public.ai_proposals p
  set status = 'accepted', decided_by = v_member, decided_at = now(), rule_id = coalesce(v_rule_id, p.rule_id)
  where p.id = p_id
  returning p.* into v_proposal;

  return v_proposal;
end;
$$;

-- RPC : supabase.rpc('refuse_ai_proposal', { p_id }) → la proposition à jour (rien n'est appliqué).
create or replace function public.refuse_ai_proposal(p_id uuid)
returns public.ai_proposals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal public.ai_proposals;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié' using errcode = '42501';
  end if;

  select p.* into v_proposal from public.ai_proposals p where p.id = p_id for update;
  if v_proposal.id is null or v_proposal.organization_id not in (select private.user_writer_org_ids()) then
    raise exception 'Réservé aux admins et membres de l''organisation' using errcode = '42501';
  end if;
  if v_proposal.status <> 'pending' then
    raise exception 'Cette proposition a déjà été traitée' using errcode = 'P0001';
  end if;

  update public.ai_proposals p
  set status = 'refused', decided_by = private.current_member_id(v_proposal.organization_id), decided_at = now()
  where p.id = p_id
  returning p.* into v_proposal;

  return v_proposal;
end;
$$;

-- RPC : supabase.rpc('undo_ai_proposal', { p_id }) → la proposition à jour.
-- Remet les valeurs « before » d'une proposition acceptée ou appliquée automatiquement.
create or replace function public.undo_ai_proposal(p_id uuid)
returns public.ai_proposals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal public.ai_proposals;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié' using errcode = '42501';
  end if;

  select p.* into v_proposal from public.ai_proposals p where p.id = p_id for update;
  if v_proposal.id is null or v_proposal.organization_id not in (select private.user_writer_org_ids()) then
    raise exception 'Réservé aux admins et membres de l''organisation' using errcode = '42501';
  end if;
  if v_proposal.status not in ('accepted', 'auto_applied') then
    raise exception 'Seule une proposition appliquée peut être annulée' using errcode = 'P0001';
  end if;

  perform private.apply_proposal_operations(v_proposal.organization_id, v_proposal.payload, 'before');

  update public.ai_proposals p
  set status = 'undone', decided_by = private.current_member_id(v_proposal.organization_id), decided_at = now()
  where p.id = p_id
  returning p.* into v_proposal;

  return v_proposal;
end;
$$;

revoke all on function public.apply_ai_proposal(uuid, boolean) from public, anon, service_role;
revoke all on function public.refuse_ai_proposal(uuid)         from public, anon, service_role;
revoke all on function public.undo_ai_proposal(uuid)           from public, anon, service_role;
grant execute on function public.apply_ai_proposal(uuid, boolean) to authenticated;
grant execute on function public.refuse_ai_proposal(uuid)         to authenticated;
grant execute on function public.undo_ai_proposal(uuid)           to authenticated;

alter table public.ai_proposals      enable row level security;
alter table public.ai_autonomy_rules enable row level security;

revoke all on public.ai_proposals, public.ai_autonomy_rules from public, anon, authenticated;

-- Propositions : décision seulement par les RPC (statut, decided_*, rule_id jamais écrits par le client).
grant select on public.ai_proposals to authenticated;
grant insert (organization_id, project_id, kind, title, explanation, payload) on public.ai_proposals to authenticated;

grant select on public.ai_autonomy_rules to authenticated;
grant insert (organization_id, kind, scope) on public.ai_autonomy_rules to authenticated;
grant update (revoked_at) on public.ai_autonomy_rules to authenticated;

grant all on public.ai_proposals, public.ai_autonomy_rules to service_role;

-- Rôles projet (admin, membre).
drop policy if exists ai_proposals_select on public.ai_proposals;
create policy ai_proposals_select on public.ai_proposals
  for select to authenticated
  using (organization_id in (select private.user_writer_org_ids()));

drop policy if exists ai_proposals_insert on public.ai_proposals;
create policy ai_proposals_insert on public.ai_proposals
  for insert to authenticated
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists ai_autonomy_rules_select on public.ai_autonomy_rules;
create policy ai_autonomy_rules_select on public.ai_autonomy_rules
  for select to authenticated
  using (organization_id in (select private.user_writer_org_ids()));

drop policy if exists ai_autonomy_rules_insert on public.ai_autonomy_rules;
create policy ai_autonomy_rules_insert on public.ai_autonomy_rules
  for insert to authenticated
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists ai_autonomy_rules_update on public.ai_autonomy_rules;
create policy ai_autonomy_rules_update on public.ai_autonomy_rules
  for update to authenticated
  using (organization_id in (select private.user_writer_org_ids()))
  with check (organization_id in (select private.user_writer_org_ids()));

-- -----------------------------------------------------------------------------
-- Relances (brouillons de mail pour un devis ou une facture)
-- -----------------------------------------------------------------------------

create table if not exists public.followups (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  target_type     text not null check (target_type in ('quote', 'invoice')),
  -- Devis ou facture relancé (selon target_type).
  target_id       uuid not null,
  draft           text not null default '' check (char_length(draft) <= 10000),
  status          text not null default 'draft' check (status in ('draft', 'sent', 'dismissed')),
  sent_at         timestamptz,
  created_by      uuid references public.members (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Un seul brouillon en cours par document.
create unique index if not exists followups_one_draft_key on public.followups (target_type, target_id) where status = 'draft';
create index if not exists followups_org_idx              on public.followups (organization_id, status);
create index if not exists followups_target_idx           on public.followups (target_type, target_id);

-- followups : organisation déduite du document relancé (qui doit exister), auteur = membre
-- connecté par défaut, sent_at suit le passage à « envoyée ».
create or replace function public.tg_followup_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if tg_op = 'UPDATE' then
    new.id          := old.id;
    new.target_type := old.target_type;
    new.target_id   := old.target_id;
    new.organization_id := old.organization_id;
    new.created_by  := old.created_by;
    new.created_at  := old.created_at;
  else
    if new.target_type = 'quote' then
      select q.organization_id into v_org from public.quotes q where q.id = new.target_id;
    else
      select i.organization_id into v_org from public.invoices i where i.id = new.target_id;
    end if;
    if v_org is null then
      raise exception 'Document à relancer introuvable' using errcode = '23503';
    end if;
    new.organization_id := v_org;
    new.created_by := coalesce(new.created_by, private.current_member_id(v_org));
  end if;

  new.sent_at := case
    when new.status = 'sent' and tg_op = 'UPDATE' and old.status = 'sent' then old.sent_at
    when new.status = 'sent' then now()
  end;
  return new;
end;
$$;

drop trigger if exists followups_10_guard on public.followups;
create trigger followups_10_guard
  before insert or update on public.followups
  for each row execute function public.tg_followup_guard();

drop trigger if exists followups_20_updated_at on public.followups;
create trigger followups_20_updated_at
  before update on public.followups
  for each row execute function public.tg_set_updated_at();

revoke all on function public.tg_followup_guard() from public, anon, authenticated, service_role;

alter table public.followups enable row level security;

revoke all on public.followups from public, anon, authenticated;
grant select, delete on public.followups to authenticated;
grant insert (target_type, target_id, draft, status) on public.followups to authenticated;
grant update (draft, status) on public.followups to authenticated;
grant all on public.followups to service_role;

-- Admin et finance (comme les devis et factures).
drop policy if exists followups_select on public.followups;
create policy followups_select on public.followups
  for select to authenticated
  using (organization_id in (select private.user_finance_org_ids()));

drop policy if exists followups_insert on public.followups;
create policy followups_insert on public.followups
  for insert to authenticated
  with check (organization_id in (select private.user_finance_org_ids()));

drop policy if exists followups_update on public.followups;
create policy followups_update on public.followups
  for update to authenticated
  using (organization_id in (select private.user_finance_org_ids()))
  with check (organization_id in (select private.user_finance_org_ids()));

drop policy if exists followups_delete on public.followups;
create policy followups_delete on public.followups
  for delete to authenticated
  using (organization_id in (select private.user_finance_org_ids()));
