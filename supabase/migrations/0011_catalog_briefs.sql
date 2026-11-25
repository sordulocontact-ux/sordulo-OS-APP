-- =============================================================================
-- Sordulo OS : 0011_catalog_briefs
-- Catalogue de prestations (services), brief structuré d'une entrée (briefs), droits de
-- diffusion, étude de cas, rounds de retours et portail client sur les projets, entrée
-- créée depuis un devis accepté (inputs.quote_id) et RPC propose_tasks_from_quote.
-- Lignes de devis : clés facultatives service_id (prestation du catalogue) et rebilled
-- (frais refacturés, exclus de la commission de l'apporteur), contrôlées par document_totals.
-- Miroir de src/shared/types.ts (Service, TaskTemplate, Brief, BriefContent, Project, Input,
-- DocumentLine).
--
-- Rejouable : if not exists / create or replace / drop ... if exists.
-- Colonnes ajoutées avec une valeur par défaut : aucune donnée existante n'est modifiée.
-- Pas de BEGIN/COMMIT : scripts/db-migrate.mjs exécute chaque fichier dans sa transaction.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Lignes de devis et factures : service_id et rebilled (remplace la 0004, mêmes règles sinon)
-- -----------------------------------------------------------------------------

-- Contrôle les lignes (tableau jsonb) et calcule les totaux en centimes.
-- Chaque ligne : label (texte non vide), description (texte ou null, facultative),
-- quantity (> 0), unit (day, hour, flat, unit), unit_price_cents (entier, >= 0 sauf
-- si p_allow_negative : avoir, ou facture de solde qui déduit ses acomptes), vat_rate (0 à 100),
-- service_id (uuid d'une prestation du catalogue, facultatif), rebilled (booléen, facultatif :
-- frais refacturés, comptés dans les totaux mais exclus de la commission).
-- Conditions imbriquées : PL/pgSQL n'évalue pas OR / AND en court-circuit, un cast
-- ne doit jamais voir une valeur qui n'est pas un nombre.
create or replace function private.document_totals(
  p_lines jsonb,
  p_allow_negative boolean,
  out total_ht_cents bigint,
  out total_vat_cents bigint,
  out total_ttc_cents bigint
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_line  jsonb;
  v_index integer;
  v_qty   numeric;
  v_price numeric;
  v_rate  numeric;
  v_ht    numeric;
  v_pos   integer;
  v_rates numeric[] := '{}';
  v_sums  numeric[] := '{}';
  v_total numeric := 0;
  v_vat   numeric := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Les lignes doivent être une liste' using errcode = '23514';
  end if;

  for v_line, v_index in
    select e.value, e.ordinality::integer from jsonb_array_elements(p_lines) with ordinality as e
  loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'Ligne % : format invalide', v_index using errcode = '23514';
    end if;

    if jsonb_typeof(v_line -> 'label') is distinct from 'string' then
      raise exception 'Ligne % : le libellé est obligatoire', v_index using errcode = '23514';
    end if;
    if btrim(v_line ->> 'label') = '' then
      raise exception 'Ligne % : le libellé est obligatoire', v_index using errcode = '23514';
    end if;

    if v_line ? 'description' and jsonb_typeof(v_line -> 'description') not in ('string', 'null') then
      raise exception 'Ligne % : la description doit être un texte', v_index using errcode = '23514';
    end if;

    if jsonb_typeof(v_line -> 'quantity') is distinct from 'number' then
      raise exception 'Ligne % : la quantité doit être un nombre supérieur à 0', v_index using errcode = '23514';
    end if;
    v_qty := (v_line ->> 'quantity')::numeric;
    if v_qty <= 0 then
      raise exception 'Ligne % : la quantité doit être un nombre supérieur à 0', v_index using errcode = '23514';
    end if;

    if jsonb_typeof(v_line -> 'unit') is distinct from 'string' then
      raise exception 'Ligne % : unité inconnue (jour, heure, forfait ou unité)', v_index using errcode = '23514';
    end if;
    if (v_line ->> 'unit') not in ('day', 'hour', 'flat', 'unit') then
      raise exception 'Ligne % : unité inconnue (jour, heure, forfait ou unité)', v_index using errcode = '23514';
    end if;

    if jsonb_typeof(v_line -> 'unit_price_cents') is distinct from 'number' then
      raise exception 'Ligne % : le prix unitaire doit être un nombre entier de centimes', v_index using errcode = '23514';
    end if;
    v_price := (v_line ->> 'unit_price_cents')::numeric;
    if v_price <> trunc(v_price) then
      raise exception 'Ligne % : le prix unitaire doit être un nombre entier de centimes', v_index using errcode = '23514';
    end if;
    if v_price < 0 and not p_allow_negative then
      raise exception 'Ligne % : le prix unitaire ne peut pas être négatif', v_index using errcode = '23514';
    end if;

    if jsonb_typeof(v_line -> 'vat_rate') is distinct from 'number' then
      raise exception 'Ligne % : le taux de TVA doit être compris entre 0 et 100', v_index using errcode = '23514';
    end if;
    v_rate := (v_line ->> 'vat_rate')::numeric;
    if v_rate < 0 or v_rate > 100 then
      raise exception 'Ligne % : le taux de TVA doit être compris entre 0 et 100', v_index using errcode = '23514';
    end if;

    -- 0011 : prestation du catalogue et frais refacturés (facultatifs).
    if v_line ? 'service_id' and jsonb_typeof(v_line -> 'service_id') not in ('string', 'null') then
      raise exception 'Ligne % : prestation du catalogue invalide', v_index using errcode = '23514';
    end if;
    if jsonb_typeof(v_line -> 'service_id') = 'string' then
      if (v_line ->> 'service_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Ligne % : prestation du catalogue invalide', v_index using errcode = '23514';
      end if;
    end if;
    if v_line ? 'rebilled' and jsonb_typeof(v_line -> 'rebilled') not in ('boolean', 'null') then
      raise exception 'Ligne % : « frais refacturés » doit être vrai ou faux', v_index using errcode = '23514';
    end if;

    v_ht := round(v_qty * v_price);
    v_total := v_total + v_ht;

    -- Cumul du HT par taux (20 et 20.00 sont le même taux).
    v_pos := array_position(v_rates, v_rate);
    if v_pos is null then
      v_rates := v_rates || v_rate;
      v_sums  := v_sums || v_ht;
    else
      v_sums[v_pos] := v_sums[v_pos] + v_ht;
    end if;
  end loop;

  for v_pos in 1 .. coalesce(array_length(v_rates, 1), 0) loop
    v_vat := v_vat + round(v_sums[v_pos] * v_rates[v_pos] / 100);
  end loop;

  total_ht_cents  := v_total;
  total_vat_cents := v_vat;
  total_ttc_cents := v_total + v_vat;
end;
$$;

revoke all on function private.document_totals(jsonb, boolean) from public, anon;
grant execute on function private.document_totals(jsonb, boolean) to authenticated, service_role;

-- Tâches types d'une prestation : [{ title, skill, estimate_hours, depends_on }].
-- title : texte non vide (200 car. max) ; skill : design ou dev (compétences des tâches) ;
-- estimate_hours : nombre >= 0 ou null ; depends_on : index (à partir de 0) d'une autre tâche
-- type de la même prestation, ou null.
create or replace function private.validate_task_templates(p_templates jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item  jsonb;
  v_index integer;
  v_count integer;
  v_dep   numeric;
begin
  if p_templates is null or jsonb_typeof(p_templates) <> 'array' then
    raise exception 'Les tâches types doivent être une liste' using errcode = '23514';
  end if;
  v_count := jsonb_array_length(p_templates);

  for v_item, v_index in
    select e.value, e.ordinality::integer from jsonb_array_elements(p_templates) with ordinality as e
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Tâche type % : format invalide', v_index using errcode = '23514';
    end if;
    if jsonb_typeof(v_item -> 'title') is distinct from 'string' then
      raise exception 'Tâche type % : le titre est obligatoire', v_index using errcode = '23514';
    end if;
    if btrim(v_item ->> 'title') = '' or char_length(v_item ->> 'title') > 200 then
      raise exception 'Tâche type % : le titre est obligatoire (200 caractères au plus)', v_index using errcode = '23514';
    end if;
    if jsonb_typeof(v_item -> 'skill') is distinct from 'string' then
      raise exception 'Tâche type % : compétence inconnue (design ou dev)', v_index using errcode = '23514';
    end if;
    if (v_item ->> 'skill') not in ('design', 'dev') then
      raise exception 'Tâche type % : compétence inconnue (design ou dev)', v_index using errcode = '23514';
    end if;
    if v_item ? 'estimate_hours' and jsonb_typeof(v_item -> 'estimate_hours') not in ('number', 'null') then
      raise exception 'Tâche type % : la durée doit être un nombre d''heures', v_index using errcode = '23514';
    end if;
    if jsonb_typeof(v_item -> 'estimate_hours') = 'number' then
      if (v_item ->> 'estimate_hours')::numeric < 0 then
        raise exception 'Tâche type % : la durée ne peut pas être négative', v_index using errcode = '23514';
      end if;
    end if;
    if v_item ? 'depends_on' and jsonb_typeof(v_item -> 'depends_on') not in ('number', 'null') then
      raise exception 'Tâche type % : dépendance invalide', v_index using errcode = '23514';
    end if;
    if jsonb_typeof(v_item -> 'depends_on') = 'number' then
      v_dep := (v_item ->> 'depends_on')::numeric;
      if v_dep <> trunc(v_dep) or v_dep < 0 or v_dep >= v_count or v_dep = v_index - 1 then
        raise exception 'Tâche type % : dépendance invalide', v_index using errcode = '23514';
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function private.validate_task_templates(jsonb) from public, anon;
grant execute on function private.validate_task_templates(jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Catalogue de prestations
-- -----------------------------------------------------------------------------

create table if not exists public.services (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (btrim(name) <> '' and char_length(name) <= 200),
  description      text check (description is null or char_length(description) <= 4000),
  category         text check (category is null or char_length(category) <= 80),
  unit             text not null default 'flat' check (unit in ('day', 'hour', 'flat', 'unit')),
  unit_price_cents bigint not null default 0 check (unit_price_cents >= 0),
  vat_rate         numeric(5, 2) not null default 20 check (vat_rate between 0 and 100),
  -- Lignes de devis types (même forme que quotes.lines).
  lines            jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),
  -- Tâches types (TaskTemplate[]), reprises par propose_tasks_from_quote.
  task_templates   jsonb not null default '[]'::jsonb check (jsonb_typeof(task_templates) = 'array'),
  active           boolean not null default true,
  position         integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists services_org_idx on public.services (organization_id, active, position);

-- -----------------------------------------------------------------------------
-- Brief structuré d'une entrée
-- -----------------------------------------------------------------------------

create table if not exists public.briefs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id      uuid not null references public.projects (id) on delete cascade,
  -- Entrée d'où vient le brief (un brief par entrée).
  input_id        uuid references public.inputs (id) on delete set null,
  -- Forme : BriefContent (src/shared/types.ts).
  content         jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  -- Brouillon de devis créé depuis le brief.
  quote_id        uuid references public.quotes (id) on delete set null,
  created_by      uuid references public.members (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists briefs_input_id_key on public.briefs (input_id) where input_id is not null;
create index if not exists briefs_project_id_idx      on public.briefs (project_id);
create index if not exists briefs_quote_id_idx        on public.briefs (quote_id);

-- -----------------------------------------------------------------------------
-- projects : rounds de retours, droits de diffusion, étude de cas, portail client
-- -----------------------------------------------------------------------------

alter table public.projects add column if not exists feedback_rounds_included integer not null default 2
  constraint projects_feedback_rounds_included_check check (feedback_rounds_included between 0 and 20);
alter table public.projects add column if not exists showcase text not null default 'unknown'
  constraint projects_showcase_check check (showcase in ('unknown', 'showable', 'nda'));
alter table public.projects add column if not exists case_study jsonb
  constraint projects_case_study_check check (case_study is null or jsonb_typeof(case_study) = 'object');
-- Jeton du portail client (lien secret) ; null = portail fermé. 32 caractères au moins.
alter table public.projects add column if not exists portal_token text
  constraint projects_portal_token_check check (portal_token is null or portal_token ~ '^[A-Za-z0-9_-]{32,128}$');

create unique index if not exists projects_portal_token_key on public.projects (portal_token) where portal_token is not null;

-- -----------------------------------------------------------------------------
-- inputs : entrée créée depuis un devis accepté (une seule par devis)
-- -----------------------------------------------------------------------------

alter table public.inputs add column if not exists quote_id uuid references public.quotes (id) on delete set null;

create unique index if not exists inputs_quote_id_key on public.inputs (quote_id) where quote_id is not null;

-- -----------------------------------------------------------------------------
-- Triggers d'intégrité
-- -----------------------------------------------------------------------------

-- services : organisation figée, lignes et tâches types contrôlées.
create or replace function public.tg_service_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id then
      raise exception 'services.organization_id ne peut pas être modifié' using errcode = '42501';
    end if;
    new.id         := old.id;
    new.created_at := old.created_at;
  end if;

  perform private.document_totals(new.lines, false);
  perform private.validate_task_templates(new.task_templates);
  return new;
end;
$$;

-- briefs : s'exécute après briefs_10_project_scope. Entrée du même projet, devis de la même
-- organisation, auteur = membre connecté par défaut.
create or replace function public.tg_brief_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id then
      raise exception 'Un brief ne peut pas changer d''organisation' using errcode = '42501';
    end if;
    new.id         := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  else
    new.created_by := coalesce(new.created_by, private.current_member_id(new.organization_id));
    if new.created_by is not null and not exists (
      select 1 from public.members m where m.id = new.created_by and m.organization_id = new.organization_id
    ) then
      raise exception 'created_by n''est pas membre de l''organisation du brief' using errcode = '23514';
    end if;
  end if;

  if new.input_id is not null
     and (tg_op = 'INSERT' or new.input_id is distinct from old.input_id or new.project_id is distinct from old.project_id)
     and not exists (
       select 1 from public.inputs i where i.id = new.input_id and i.project_id = new.project_id
     ) then
    raise exception 'L''entrée n''appartient pas au projet du brief' using errcode = '23514';
  end if;

  if new.quote_id is not null
     and (tg_op = 'INSERT' or new.quote_id is distinct from old.quote_id)
     and not exists (
       select 1 from public.quotes q where q.id = new.quote_id and q.organization_id = new.organization_id
     ) then
    raise exception 'Le devis n''appartient pas à l''organisation du brief' using errcode = '23514';
  end if;

  return new;
end;
$$;

-- inputs : le devis d'origine appartient à l'organisation de l'entrée. Security definer : un
-- membre ne lit pas les devis (réservés à admin et finance), la vérification doit les voir.
create or replace function public.tg_input_quote_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.quote_id is not null
     and (tg_op = 'INSERT' or new.quote_id is distinct from old.quote_id or new.organization_id is distinct from old.organization_id)
     and not exists (
       select 1 from public.quotes q where q.id = new.quote_id and q.organization_id = new.organization_id
     ) then
    raise exception 'Le devis n''appartient pas à l''organisation de l''entrée' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists services_10_guard on public.services;
create trigger services_10_guard
  before insert or update on public.services
  for each row execute function public.tg_service_guard();

drop trigger if exists services_20_updated_at on public.services;
create trigger services_20_updated_at
  before update on public.services
  for each row execute function public.tg_set_updated_at();

drop trigger if exists briefs_10_project_scope on public.briefs;
create trigger briefs_10_project_scope
  before insert or update on public.briefs
  for each row execute function public.tg_enforce_project_scope();

drop trigger if exists briefs_15_guard on public.briefs;
create trigger briefs_15_guard
  before insert or update on public.briefs
  for each row execute function public.tg_brief_guard();

drop trigger if exists briefs_20_updated_at on public.briefs;
create trigger briefs_20_updated_at
  before update on public.briefs
  for each row execute function public.tg_set_updated_at();

-- Après inputs_10_project_scope (organization_id fiable), avant inputs_20_updated_at.
drop trigger if exists inputs_15_quote_scope on public.inputs;
create trigger inputs_15_quote_scope
  before insert or update on public.inputs
  for each row execute function public.tg_input_quote_scope();

revoke all on function public.tg_service_guard()     from public, anon, authenticated, service_role;
revoke all on function public.tg_brief_guard()       from public, anon, authenticated, service_role;
revoke all on function public.tg_input_quote_scope() from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RPC : tickets proposés depuis un devis accepté
-- supabase.rpc('propose_tasks_from_quote', { p_quote_id }) → id de l'entrée.
-- Appelant : admin, membre ou finance actif de l'organisation (ou le serveur, clé service).
-- Crée l'entrée « Devis <numéro> accepté » (écrite, prête, reliée au devis) et, pour chaque
-- ligne qui porte une prestation du catalogue avec des tâches types, un ticket proposé
-- (nouvelle demande, priorité moyenne, citation = libellé de la ligne) et ses tâches
-- (compétence, durée, dépendances, sans personne attribuée). Les tickets passent ensuite par
-- l'écran de validation existant.
-- Idempotente : un devis qui a déjà son entrée la renvoie sans rien recréer.
-- -----------------------------------------------------------------------------

create or replace function public.propose_tasks_from_quote(p_quote_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_server    boolean := auth.uid() is null and coalesce(auth.jwt() ->> 'role', '') = 'service_role';
  v_quote     public.quotes;
  v_input_id  uuid;
  v_line      jsonb;
  v_service   public.services;
  v_ticket_id uuid;
  v_task_id   uuid;
  v_task_ids  uuid[];
  v_template  jsonb;
  v_t_index   integer;
  v_summary   text;
begin
  if v_uid is null and not v_server then
    raise exception 'Non authentifié' using errcode = '42501';
  end if;

  -- Verrou : deux appels simultanés ne créent pas deux entrées.
  select q.* into v_quote
  from public.quotes q
  where q.id = p_quote_id
  for update;

  if v_quote.id is null
     or (not v_server and v_quote.organization_id not in (select private.user_reader_org_ids())) then
    raise exception 'Réservé aux admins, membres et finance de l''organisation' using errcode = '42501';
  end if;
  if v_quote.status <> 'accepted' then
    raise exception 'Le devis doit être accepté' using errcode = 'P0001';
  end if;
  if v_quote.project_id is null then
    raise exception 'Rattache d''abord le devis à un projet' using errcode = 'P0001';
  end if;

  select i.id into v_input_id from public.inputs i where i.quote_id = p_quote_id;
  if v_input_id is not null then
    return v_input_id;
  end if;

  select string_agg(
           '- ' || btrim(e.value ->> 'label')
             || ' : ' || trim_scale((e.value ->> 'quantity')::numeric)::text
             || ' ' || case e.value ->> 'unit'
                         when 'day' then 'jour(s)'
                         when 'hour' then 'heure(s)'
                         when 'flat' then 'forfait'
                         else 'unité(s)'
                       end,
           E'\n' order by e.ordinality)
  into v_summary
  from jsonb_array_elements(v_quote.lines) with ordinality as e;

  -- « analyzing » pendant la création des tickets, puis « ready » : la notification
  -- « tickets à valider » (0013) voit les tickets.
  insert into public.inputs (project_id, kind, title, raw_text, status, created_by, quote_id)
  values (
    v_quote.project_id,
    'written',
    'Devis ' || v_quote.number || ' accepté',
    coalesce(v_summary, ''),
    'analyzing',
    private.current_member_id(v_quote.organization_id),
    v_quote.id
  )
  returning id into v_input_id;

  for v_line in
    select e.value from jsonb_array_elements(v_quote.lines) with ordinality as e order by e.ordinality
  loop
    continue when jsonb_typeof(v_line -> 'service_id') is distinct from 'string';

    v_service := null;
    select s.* into v_service
    from public.services s
    where s.id::text = v_line ->> 'service_id'
      and s.organization_id = v_quote.organization_id;

    continue when v_service.id is null or jsonb_array_length(v_service.task_templates) = 0;

    insert into public.tickets (project_id, input_id, title, description, type, priority, source_quote, status)
    values (
      v_quote.project_id,
      v_input_id,
      left(btrim(v_line ->> 'label'), 200),
      coalesce(nullif(btrim(v_line ->> 'description'), ''), v_service.description, ''),
      'new_request',
      'medium',
      btrim(v_line ->> 'label'),
      'proposed'
    )
    returning id into v_ticket_id;

    v_task_ids := '{}';
    for v_template, v_t_index in
      select e.value, e.ordinality::integer from jsonb_array_elements(v_service.task_templates) with ordinality as e
    loop
      insert into public.tasks (project_id, ticket_id, title, skill, estimate_hours, position)
      values (
        v_quote.project_id,
        v_ticket_id,
        btrim(v_template ->> 'title'),
        v_template ->> 'skill',
        case when jsonb_typeof(v_template -> 'estimate_hours') = 'number'
             then (v_template ->> 'estimate_hours')::numeric end,
        v_t_index
      )
      returning id into v_task_id;
      v_task_ids := v_task_ids || v_task_id;
    end loop;

    -- Dépendances : index de la tâche type → id de la tâche créée.
    for v_template, v_t_index in
      select e.value, e.ordinality::integer from jsonb_array_elements(v_service.task_templates) with ordinality as e
    loop
      if jsonb_typeof(v_template -> 'depends_on') = 'number' then
        update public.tasks t
        set depends_on_task_id = v_task_ids[(v_template ->> 'depends_on')::integer + 1]
        where t.id = v_task_ids[v_t_index];
      end if;
    end loop;
  end loop;

  update public.inputs i set status = 'ready' where i.id = v_input_id;

  return v_input_id;
end;
$$;

revoke all on function public.propose_tasks_from_quote(uuid) from public, anon;
grant execute on function public.propose_tasks_from_quote(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Droits (rien pour anon)
-- -----------------------------------------------------------------------------

alter table public.services enable row level security;
alter table public.briefs   enable row level security;

revoke all on public.services, public.briefs from public, anon, authenticated;

grant select, delete on public.services to authenticated;
grant insert (organization_id, name, description, category, unit, unit_price_cents, vat_rate, lines,
              task_templates, active, position)
  on public.services to authenticated;
grant update (name, description, category, unit, unit_price_cents, vat_rate, lines, task_templates, active, position)
  on public.services to authenticated;

grant select, delete on public.briefs to authenticated;
grant insert (project_id, input_id, content, quote_id) on public.briefs to authenticated;
grant update (content, quote_id) on public.briefs to authenticated;

grant all on public.services, public.briefs to service_role;

-- projects et inputs : droits par table de la 0001 (les nouvelles colonnes suivent la politique
-- d'écriture admin et membre de la 0003 / 0004).

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

-- services : lecture par toute l'organisation (l'apporteur voit les offres), écriture par
-- admin, membre et finance.
drop policy if exists services_select on public.services;
create policy services_select on public.services
  for select to authenticated
  using (organization_id in (select private.user_org_ids()));

drop policy if exists services_insert on public.services;
create policy services_insert on public.services
  for insert to authenticated
  with check (organization_id in (select private.user_reader_org_ids()));

drop policy if exists services_update on public.services;
create policy services_update on public.services
  for update to authenticated
  using (organization_id in (select private.user_reader_org_ids()))
  with check (organization_id in (select private.user_reader_org_ids()));

drop policy if exists services_delete on public.services;
create policy services_delete on public.services
  for delete to authenticated
  using (organization_id in (select private.user_reader_org_ids()));

-- briefs : admin et membre (comme les entrées).
drop policy if exists briefs_select on public.briefs;
create policy briefs_select on public.briefs
  for select to authenticated
  using (organization_id in (select private.user_writer_org_ids()));

drop policy if exists briefs_insert on public.briefs;
create policy briefs_insert on public.briefs
  for insert to authenticated
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists briefs_update on public.briefs;
create policy briefs_update on public.briefs
  for update to authenticated
  using (organization_id in (select private.user_writer_org_ids()))
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists briefs_delete on public.briefs;
create policy briefs_delete on public.briefs
  for delete to authenticated
  using (organization_id in (select private.user_writer_org_ids()));
