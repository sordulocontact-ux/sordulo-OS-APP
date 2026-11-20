-- =============================================================================
-- Sordulo OS — 0004_finance_prospection
-- Devis, factures (émission numérotée, avoirs), paramètres de facturation de
-- l'organisation, prospection, rôle « finance » et lecture des données par rôle.
-- Miroir exact de src/shared/types.ts : toute modification de colonne se fait
-- aux deux endroits.
--
-- Rejouable : if not exists / create or replace / drop ... if exists.
-- Aucune suppression de données ni de colonne.
-- Ne pas mettre de BEGIN/COMMIT ici : scripts/db-migrate.mjs exécute chaque
-- fichier dans sa propre transaction (l'éditeur SQL Supabase aussi).
--
-- Montants en centimes entiers. Arrondi : round() sur numeric (demi vers l'extérieur).
--   HT ligne  = round(quantité × prix unitaire)
--   TVA       = somme, par taux, de round(somme HT du taux × taux / 100)
--   TTC       = HT + TVA
-- Le même calcul existe dans src/shared/billing.ts (aperçu) ; la base fait foi.
-- Les dates « du jour » (date de devis, d'émission) sont celles de Paris.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Rôle « finance » : devis, factures, lecture des clients et projets
-- -----------------------------------------------------------------------------

alter table public.members drop constraint if exists members_role_check;
alter table public.members add constraint members_role_check
  check (role in ('admin', 'membre', 'prospection', 'finance'));

-- -----------------------------------------------------------------------------
-- organizations : paramètres de facturation
-- -----------------------------------------------------------------------------

alter table public.organizations add column if not exists default_vat_rate numeric(5, 2) not null default 20
  constraint organizations_default_vat_rate_check check (default_vat_rate between 0 and 100);
-- 60 jours : plafond légal du délai de paiement entre professionnels (C. com. L441-10).
alter table public.organizations add column if not exists payment_terms_days integer not null default 30
  constraint organizations_payment_terms_days_check check (payment_terms_days between 0 and 60);
alter table public.organizations add column if not exists quote_validity_days integer not null default 30
  constraint organizations_quote_validity_days_check check (quote_validity_days between 1 and 365);
alter table public.organizations add column if not exists bank_iban text;
alter table public.organizations add column if not exists bank_bic  text;

-- -----------------------------------------------------------------------------
-- Nouvelles tables
-- -----------------------------------------------------------------------------

-- Compteurs des numéros de documents, par organisation, série (D devis, F factures et acomptes,
-- A avoirs) et année. Jamais lus ni écrits directement par le front.
create table if not exists public.document_counters (
  organization_id uuid    not null references public.organizations (id) on delete cascade,
  series          text    not null check (series in ('D', 'F', 'A')),
  year            integer not null check (year between 2000 and 2999),
  last_value      integer not null default 0 check (last_value >= 0),
  primary key (organization_id, series, year)
);

-- Devis. organization_id est rempli par un trigger à partir du client ; number et totaux aussi.
create table if not exists public.quotes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id       uuid not null references public.clients (id),
  project_id      uuid references public.projects (id) on delete set null,
  number          text not null,
  title           text not null check (btrim(title) <> ''),
  status          text not null default 'draft'
                    check (status in ('draft', 'sent', 'accepted', 'refused')),
  issue_date      date not null default ((now() at time zone 'Europe/Paris')::date),
  valid_until     date,
  lines           jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),
  notes           text,
  total_ht_cents  bigint not null default 0,
  total_vat_cents bigint not null default 0,
  total_ttc_cents bigint not null default 0,
  sent_at         timestamptz,
  accepted_at     timestamptz,
  refused_at      timestamptz,
  created_by      uuid references public.members (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint quotes_number_format_check check (number ~ '^D-[0-9]{4}-[0-9]{3,}$'),
  constraint quotes_valid_until_check check (valid_until is null or valid_until >= issue_date)
);

-- Factures, factures d'acompte et avoirs.
create table if not exists public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  client_id           uuid not null references public.clients (id),
  project_id          uuid references public.projects (id) on delete set null,
  quote_id            uuid references public.quotes (id) on delete set null,
  kind                text not null default 'invoice'
                        check (kind in ('invoice', 'deposit', 'credit_note')),
  status              text not null default 'draft'
                        check (status in ('draft', 'issued', 'paid', 'cancelled')),
  number              text,
  title               text not null check (btrim(title) <> ''),
  issue_date          date,
  due_date            date,
  lines               jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),
  notes               text,
  deposit_percent     numeric(5, 2) check (deposit_percent is null or (deposit_percent > 0 and deposit_percent <= 100)),
  credited_invoice_id uuid references public.invoices (id),
  seller              jsonb check (seller is null or jsonb_typeof(seller) = 'object'),
  buyer               jsonb check (buyer is null or jsonb_typeof(buyer) = 'object'),
  total_ht_cents      bigint not null default 0,
  total_vat_cents     bigint not null default 0,
  total_ttc_cents     bigint not null default 0,
  issued_at           timestamptz,
  paid_at             timestamptz,
  cancelled_at        timestamptz,
  created_by          uuid references public.members (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Numéro présent si et seulement si la facture n'est plus un brouillon.
  constraint invoices_number_status_check check ((status = 'draft') = (number is null)),
  constraint invoices_number_format_check check (
    number is null
    or (kind in ('invoice', 'deposit') and number ~ '^F-[0-9]{4}-[0-9]{4,}$')
    or (kind = 'credit_note' and number ~ '^A-[0-9]{4}-[0-9]{4,}$')
  ),
  -- Un avoir, et lui seul, référence la facture qu'il annule.
  constraint invoices_credit_note_check check ((kind = 'credit_note') = (credited_invoice_id is not null)),
  constraint invoices_dates_check check (due_date is null or issue_date is null or due_date >= issue_date)
);

-- Prospects (prospection commerciale). Pas de suppression : on passe en « perdu ».
create table if not exists public.prospects (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  company          text not null check (btrim(company) <> ''),
  website          text,
  contact_name     text,
  contact_email    text,
  contact_phone    text,
  source           text,
  stage            text not null default 'to_contact'
                     check (stage in ('to_contact', 'contacted', 'followed_up', 'meeting', 'won', 'lost')),
  next_action_date date,
  notes            text,
  owner_member_id  uuid references public.members (id) on delete set null,
  client_id        uuid references public.clients (id) on delete set null,
  -- Passage en « gagné » (posé par trigger) : compte des prospects gagnés sur une période.
  won_at           timestamptz,
  created_by       uuid references public.members (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Unicité et index
-- -----------------------------------------------------------------------------

create unique index if not exists quotes_org_number_key     on public.quotes (organization_id, number);
create index if not exists quotes_org_status_idx            on public.quotes (organization_id, status);
create index if not exists quotes_client_id_idx             on public.quotes (client_id);
create index if not exists quotes_project_id_idx            on public.quotes (project_id);
create index if not exists quotes_created_by_idx            on public.quotes (created_by);

create unique index if not exists invoices_org_number_key   on public.invoices (organization_id, number) where number is not null;
-- Une facture n'est annulée que par un seul avoir.
create unique index if not exists invoices_credited_key     on public.invoices (credited_invoice_id) where credited_invoice_id is not null;
create index if not exists invoices_org_status_idx          on public.invoices (organization_id, status);
create index if not exists invoices_client_id_idx           on public.invoices (client_id);
create index if not exists invoices_project_id_idx          on public.invoices (project_id, kind, status);
create index if not exists invoices_quote_id_idx            on public.invoices (quote_id);
create index if not exists invoices_created_by_idx          on public.invoices (created_by);

create index if not exists prospects_org_stage_idx          on public.prospects (organization_id, stage);
create index if not exists prospects_org_next_action_idx    on public.prospects (organization_id, next_action_date);
create index if not exists prospects_owner_member_id_idx    on public.prospects (owner_member_id);
create index if not exists prospects_client_id_idx          on public.prospects (client_id);
create index if not exists prospects_created_by_idx         on public.prospects (created_by);

-- -----------------------------------------------------------------------------
-- Appartenance et rôles (utilisés par les politiques RLS et les RPC)
-- Toujours utilisées en « organization_id in (select private.…()) » (initplan).
-- -----------------------------------------------------------------------------

-- Organisations où le membre connecté lit clients, contacts, projets et membres de projet
-- (admin, membre et finance actifs ; prospection exclu).
create or replace function private.user_reader_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.members m
  where m.user_id = (select auth.uid())
    and m.removed_at is null
    and m.role in ('admin', 'membre', 'finance');
$$;

-- Organisations où le membre connecté gère devis et factures (admin et finance actifs).
create or replace function private.user_finance_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.members m
  where m.user_id = (select auth.uid())
    and m.removed_at is null
    and m.role in ('admin', 'finance');
$$;

-- Organisations où le membre connecté gère les prospects (admin et prospection actifs).
create or replace function private.user_prospect_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.members m
  where m.user_id = (select auth.uid())
    and m.removed_at is null
    and m.role in ('admin', 'prospection');
$$;

-- Membre actif du compte connecté dans cette organisation (null s'il n'y en a pas).
create or replace function private.current_member_id(org uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.members m
  where m.user_id = (select auth.uid())
    and m.organization_id = org
    and m.removed_at is null
  limit 1;
$$;

revoke all on function private.user_reader_org_ids()    from public, anon;
revoke all on function private.user_finance_org_ids()   from public, anon;
revoke all on function private.user_prospect_org_ids()  from public, anon;
revoke all on function private.current_member_id(uuid)  from public, anon;
grant execute on function private.user_reader_org_ids()   to authenticated, service_role;
grant execute on function private.user_finance_org_ids()  to authenticated, service_role;
grant execute on function private.user_prospect_org_ids() to authenticated, service_role;
grant execute on function private.current_member_id(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Lignes, totaux, périmètre et numérotation des documents
-- -----------------------------------------------------------------------------

-- Contrôle les lignes (tableau jsonb) et calcule les totaux en centimes.
-- Chaque ligne : label (texte non vide), description (texte ou null, facultative),
-- quantity (> 0), unit (day, hour, flat, unit), unit_price_cents (entier, >= 0 sauf
-- si p_allow_negative : avoir, ou facture de solde qui déduit ses acomptes), vat_rate (0 à 100).
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

-- Organisation d'un document, déduite de son client, et contrôle que projet, devis
-- et facture d'origine appartiennent à la même organisation. p_org : organisation
-- actuelle du document (null à la création).
create or replace function private.document_scope(
  p_org uuid,
  p_client_id uuid,
  p_project_id uuid,
  p_quote_id uuid,
  p_invoice_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select c.organization_id into v_org
  from public.clients c
  where c.id = p_client_id;

  if v_org is null then
    raise exception 'Client introuvable' using errcode = '23503';
  end if;

  if p_org is not null and v_org <> p_org then
    raise exception 'Le client n''appartient pas à l''organisation du document' using errcode = '23514';
  end if;

  if p_project_id is not null and not exists (
    select 1 from public.projects p where p.id = p_project_id and p.organization_id = v_org
  ) then
    raise exception 'Le projet n''appartient pas à l''organisation du client' using errcode = '23514';
  end if;

  if p_quote_id is not null and not exists (
    select 1 from public.quotes q where q.id = p_quote_id and q.organization_id = v_org
  ) then
    raise exception 'Le devis n''appartient pas à l''organisation du client' using errcode = '23514';
  end if;

  if p_invoice_id is not null and not exists (
    select 1 from public.invoices i where i.id = p_invoice_id and i.organization_id = v_org
  ) then
    raise exception 'La facture d''origine n''appartient pas à l''organisation du client' using errcode = '23514';
  end if;

  return v_org;
end;
$$;

-- Prochain numéro d'une série : « D-2026-001 », « F-2026-0001 », « A-2026-0001 ».
-- L'upsert verrouille la ligne du compteur jusqu'à la fin de la transaction : deux
-- émissions simultanées ne reçoivent jamais le même numéro, et un numéro pris par une
-- transaction annulée est rendu (séries continues).
create or replace function private.next_document_number(p_org uuid, p_series text, p_year integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value integer;
  v_width integer := case when p_series = 'D' then 3 else 4 end;
begin
  insert into public.document_counters as dc (organization_id, series, year, last_value)
  values (p_org, p_series, p_year, 1)
  on conflict (organization_id, series, year)
    do update set last_value = dc.last_value + 1
  returning dc.last_value into v_value;

  return p_series || '-' || p_year::text || '-' || lpad(v_value::text, greatest(v_width, length(v_value::text)), '0');
end;
$$;

revoke all on function private.document_totals(jsonb, boolean)               from public, anon;
revoke all on function private.document_scope(uuid, uuid, uuid, uuid, uuid) from public, anon;
revoke all on function private.next_document_number(uuid, text, integer)     from public, anon, authenticated, service_role;
-- Appelées par le trigger des factures, qui s'exécute avec les droits de l'appelant.
grant execute on function private.document_totals(jsonb, boolean)               to authenticated, service_role;
grant execute on function private.document_scope(uuid, uuid, uuid, uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Triggers des devis
-- -----------------------------------------------------------------------------

-- Devis : organisation déduite du client, numéro attribué à la création, validité par
-- défaut, totaux recalculés, horodatage des changements de statut, devis accepté ou
-- refusé figé, suppression des brouillons seulement.
-- pg_trigger_depth() > 1 : modification en cascade d'une clé étrangère (« on delete set
-- null » d'un projet ou d'un membre supprimé), laissée passer.
create or replace function public.tg_quote_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_totals record;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' and pg_trigger_depth() = 1 then
      raise exception 'Seul un devis en brouillon peut être supprimé' using errcode = 'P0001';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if pg_trigger_depth() > 1 then
      return new;
    end if;

    if old.status in ('accepted', 'refused') then
      if (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
        raise exception 'Un devis accepté ou refusé ne peut plus être modifié : duplique-le pour en faire un nouveau'
          using errcode = 'P0001';
      end if;
      return new;
    end if;

    if new.organization_id is distinct from old.organization_id then
      raise exception 'quotes.organization_id ne peut pas être modifié' using errcode = '42501';
    end if;
    new.id         := old.id;
    new.number     := old.number;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;

  new.organization_id := private.document_scope(
    case when tg_op = 'UPDATE' then old.organization_id end,
    new.client_id, new.project_id, null, null
  );

  if tg_op = 'INSERT' then
    new.issue_date := coalesce(new.issue_date, (now() at time zone 'Europe/Paris')::date);
    new.number := private.next_document_number(new.organization_id, 'D', extract(year from new.issue_date)::integer);

    if new.valid_until is null then
      select new.issue_date + o.quote_validity_days into new.valid_until
      from public.organizations o
      where o.id = new.organization_id;
    end if;

    new.created_by := coalesce(new.created_by, private.current_member_id(new.organization_id));
    if new.created_by is not null and not exists (
      select 1 from public.members m where m.id = new.created_by and m.organization_id = new.organization_id
    ) then
      raise exception 'created_by n''est pas membre de l''organisation du devis' using errcode = '23514';
    end if;

    new.sent_at     := case when new.status = 'sent' then now() end;
    new.accepted_at := case when new.status = 'accepted' then now() end;
    new.refused_at  := case when new.status = 'refused' then now() end;
  elsif new.status is distinct from old.status then
    -- Retour en brouillon : l'envoi est oublié.
    new.sent_at     := case when new.status = 'sent' then now() when new.status = 'draft' then null else old.sent_at end;
    new.accepted_at := case when new.status = 'accepted' then now() end;
    new.refused_at  := case when new.status = 'refused' then now() end;
  else
    new.sent_at     := old.sent_at;
    new.accepted_at := old.accepted_at;
    new.refused_at  := old.refused_at;
  end if;

  select * into v_totals from private.document_totals(new.lines, false);
  new.total_ht_cents  := v_totals.total_ht_cents;
  new.total_vat_cents := v_totals.total_vat_cents;
  new.total_ttc_cents := v_totals.total_ttc_cents;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Triggers des factures
-- -----------------------------------------------------------------------------

-- Factures : un brouillon est modifiable, sauf number, seller, buyer, issued_at, paid_at,
-- cancelled_at et credited_invoice_id, posés par les RPC issue_invoice / create_credit_note.
-- Hors brouillon, plus rien ne change sauf le statut émise ↔ payée (paid_at suit), et
-- l'annulation, réservée à create_credit_note. Suppression des brouillons seulement.
--
-- Volontairement SANS security definer : current_user est le rôle de l'appelant
-- (authenticated via l'API, service_role pour /api, propriétaire des RPC security definer).
-- Seules ces RPC (ou l'éditeur SQL) sont « de confiance » et peuvent émettre ou annuler.
create or replace function public.tg_invoice_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_trusted boolean := current_user not in ('authenticated', 'anon', 'service_role');
  v_totals  record;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' and pg_trigger_depth() = 1 then
      raise exception 'Seule une facture en brouillon peut être supprimée : pour annuler une facture émise, crée un avoir'
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.status <> 'draft' then
    if pg_trigger_depth() > 1 then
      return new;
    end if;

    if (to_jsonb(new) - array['status', 'paid_at', 'cancelled_at', 'updated_at'])
       is distinct from (to_jsonb(old) - array['status', 'paid_at', 'cancelled_at', 'updated_at']) then
      raise exception 'Une facture émise ne peut plus être modifiée : crée un avoir pour la corriger'
        using errcode = 'P0001';
    end if;

    if new.status is distinct from old.status then
      if old.status = 'cancelled' then
        raise exception 'Une facture annulée ne peut plus changer de statut' using errcode = 'P0001';
      elsif new.status = 'draft' then
        raise exception 'Une facture émise ne peut pas repasser en brouillon' using errcode = 'P0001';
      elsif new.status = 'cancelled' and not v_trusted then
        raise exception 'Pour annuler une facture émise, crée un avoir' using errcode = 'P0001';
      end if;
    end if;

    new.paid_at := case
      when new.status = 'paid' and old.status = 'paid' then old.paid_at
      when new.status = 'paid' then now()
      when new.status = 'cancelled' then old.paid_at
    end;
    new.cancelled_at := case when new.status = 'cancelled' then coalesce(old.cancelled_at, now()) end;
    return new;
  end if;

  -- Création, ou modification d'un brouillon.
  if not v_trusted then
    if new.status <> 'draft' then
      raise exception 'Une facture se crée et se modifie en brouillon : utilise « Émettre » pour lui donner son numéro'
        using errcode = 'P0001';
    end if;
    if new.kind not in ('invoice', 'deposit') then
      raise exception 'Un avoir se crée depuis la facture qu''il annule' using errcode = 'P0001';
    end if;

    if tg_op = 'INSERT' then
      new.number              := null;
      new.seller              := null;
      new.buyer               := null;
      new.issued_at           := null;
      new.paid_at             := null;
      new.cancelled_at        := null;
      new.credited_invoice_id := null;
    else
      new.number              := old.number;
      new.seller              := old.seller;
      new.buyer               := old.buyer;
      new.issued_at           := old.issued_at;
      new.paid_at             := old.paid_at;
      new.cancelled_at        := old.cancelled_at;
      new.credited_invoice_id := old.credited_invoice_id;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id then
      raise exception 'invoices.organization_id ne peut pas être modifié' using errcode = '42501';
    end if;
    new.id         := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;

  new.organization_id := private.document_scope(
    case when tg_op = 'UPDATE' then old.organization_id end,
    new.client_id, new.project_id, new.quote_id, new.credited_invoice_id
  );

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, private.current_member_id(new.organization_id));
    if new.created_by is not null and not exists (
      select 1 from public.members m where m.id = new.created_by and m.organization_id = new.organization_id
    ) then
      raise exception 'created_by n''est pas membre de l''organisation de la facture' using errcode = '23514';
    end if;
  end if;

  -- Prix négatifs : permis sur un avoir, et sur une facture (déduction des acomptes d'une
  -- facture de solde) tant que son total reste positif ou nul ; jamais sur un acompte.
  -- Même règle dans src/shared/billing.ts (validateInvoiceLines).
  select * into v_totals from private.document_totals(new.lines, new.kind in ('credit_note', 'invoice'));
  if new.kind = 'invoice' and (v_totals.total_ht_cents < 0 or v_totals.total_ttc_cents < 0) then
    raise exception 'Le total d''une facture ne peut pas être négatif : crée un avoir.' using errcode = '23514';
  end if;
  new.total_ht_cents  := v_totals.total_ht_cents;
  new.total_vat_cents := v_totals.total_vat_cents;
  new.total_ttc_cents := v_totals.total_ttc_cents;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Statut du projet suivant ses devis et factures
-- Seulement vers l'avant (prospect < quote_sent < in_progress < delivered < paid),
-- jamais sur un projet archivé.
-- -----------------------------------------------------------------------------

create or replace function public.tg_document_project_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.project_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;

  if tg_table_name = 'quotes' then
    if new.status = 'sent' then
      update public.projects p
      set status = 'quote_sent'
      where p.id = new.project_id and p.status = 'prospect';
    elsif new.status = 'accepted' then
      update public.projects p
      set status = 'in_progress'
      where p.id = new.project_id and p.status in ('prospect', 'quote_sent');
    end if;

  elsif tg_table_name = 'invoices' then
    -- Payée, ou annulée par un avoir : si toutes les factures (hors acomptes et avoirs)
    -- non annulées du projet sont payées, et qu'il y en a au moins une, le projet est payé.
    if new.kind = 'invoice' and new.status in ('paid', 'cancelled')
       and exists (
         select 1 from public.invoices i
         where i.project_id = new.project_id and i.kind = 'invoice' and i.status = 'paid'
       )
       and not exists (
         select 1 from public.invoices i
         where i.project_id = new.project_id and i.kind = 'invoice' and i.status in ('draft', 'issued')
       ) then
      update public.projects p
      set status = 'paid'
      where p.id = new.project_id and p.status in ('prospect', 'quote_sent', 'in_progress', 'delivered');
    end if;
  end if;

  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Trigger des prospects
-- -----------------------------------------------------------------------------

-- Prospects : created_by et owner_member_id prennent par défaut le membre connecté ;
-- won_at suit le passage en « gagné » (remis à null s'il le quitte) ;
-- responsable et client restent dans l'organisation du prospect.
create or replace function public.tg_prospect_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id then
      raise exception 'prospects.organization_id ne peut pas être modifié' using errcode = '42501';
    end if;
    new.id         := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.won_at     := case
      when new.stage <> 'won' then null
      when old.stage = 'won' then old.won_at
      else now()
    end;
  else
    new.created_by      := coalesce(new.created_by, private.current_member_id(new.organization_id));
    new.owner_member_id := coalesce(new.owner_member_id, new.created_by);
    new.won_at          := case when new.stage = 'won' then now() end;
  end if;

  if tg_op = 'INSERT' or new.created_by is distinct from old.created_by then
    if new.created_by is not null and not exists (
      select 1 from public.members m where m.id = new.created_by and m.organization_id = new.organization_id
    ) then
      raise exception 'created_by n''est pas membre de l''organisation du prospect' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' or new.owner_member_id is distinct from old.owner_member_id then
    if new.owner_member_id is not null and not exists (
      select 1 from public.members m where m.id = new.owner_member_id and m.organization_id = new.organization_id
    ) then
      raise exception 'Le responsable doit être membre de l''organisation' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' or new.client_id is distinct from old.client_id then
    if new.client_id is not null and not exists (
      select 1 from public.clients c where c.id = new.client_id and c.organization_id = new.organization_id
    ) then
      raise exception 'Le client n''appartient pas à l''organisation du prospect' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

-- Les triggers d'une même table s'exécutent par ordre alphabétique de nom.
drop trigger if exists quotes_10_guard on public.quotes;
create trigger quotes_10_guard
  before insert or update or delete on public.quotes
  for each row execute function public.tg_quote_guard();

drop trigger if exists quotes_20_updated_at on public.quotes;
create trigger quotes_20_updated_at
  before update on public.quotes
  for each row execute function public.tg_set_updated_at();

drop trigger if exists quotes_30_project_status on public.quotes;
create trigger quotes_30_project_status
  after insert or update of status on public.quotes
  for each row execute function public.tg_document_project_status();

drop trigger if exists invoices_10_guard on public.invoices;
create trigger invoices_10_guard
  before insert or update or delete on public.invoices
  for each row execute function public.tg_invoice_guard();

drop trigger if exists invoices_20_updated_at on public.invoices;
create trigger invoices_20_updated_at
  before update on public.invoices
  for each row execute function public.tg_set_updated_at();

drop trigger if exists invoices_30_project_status on public.invoices;
create trigger invoices_30_project_status
  after insert or update of status on public.invoices
  for each row execute function public.tg_document_project_status();

drop trigger if exists prospects_10_guard on public.prospects;
create trigger prospects_10_guard
  before insert or update on public.prospects
  for each row execute function public.tg_prospect_guard();

drop trigger if exists prospects_20_updated_at on public.prospects;
create trigger prospects_20_updated_at
  before update on public.prospects
  for each row execute function public.tg_set_updated_at();

-- Fonctions de trigger : jamais appelables directement.
revoke all on function public.tg_quote_guard()             from public, anon, authenticated, service_role;
revoke all on function public.tg_invoice_guard()           from public, anon, authenticated, service_role;
revoke all on function public.tg_document_project_status() from public, anon, authenticated, service_role;
revoke all on function public.tg_prospect_guard()          from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RPC : émettre une facture (supabase.rpc('issue_invoice', { p_invoice_id }))
-- Appelant : admin ou finance actif de l'organisation. Renvoie la facture émise.
-- -----------------------------------------------------------------------------

create or replace function public.issue_invoice(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_invoice public.invoices;
  v_org     public.organizations;
  v_client  public.clients;
  v_contact public.client_contacts;
  v_today   date := (now() at time zone 'Europe/Paris')::date;
begin
  if v_uid is null then
    raise exception 'Non authentifié' using errcode = '42501';
  end if;

  select i.* into v_invoice
  from public.invoices i
  where i.id = p_invoice_id
  for update;

  -- Même message si la facture n'existe pas ou appartient à une autre organisation.
  if v_invoice.id is null or v_invoice.organization_id not in (select private.user_finance_org_ids()) then
    raise exception 'Réservé aux admins et à la finance de l''organisation' using errcode = '42501';
  end if;

  if v_invoice.status <> 'draft' then
    raise exception 'Cette facture est déjà émise' using errcode = 'P0001';
  end if;
  if v_invoice.kind not in ('invoice', 'deposit') then
    raise exception 'Seule une facture ou une facture d''acompte peut être émise' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_invoice.lines) = 0 then
    raise exception 'Ajoute au moins une ligne avant d''émettre la facture' using errcode = 'P0001';
  end if;

  select o.* into v_org from public.organizations o where o.id = v_invoice.organization_id;
  select c.* into v_client from public.clients c where c.id = v_invoice.client_id;
  select cc.* into v_contact
  from public.client_contacts cc
  where cc.client_id = v_invoice.client_id and cc.is_primary
  limit 1;

  update public.invoices i
  set number    = private.next_document_number(v_invoice.organization_id, 'F', extract(year from v_today)::integer),
      status    = 'issued',
      issue_date = v_today,
      due_date  = v_today + v_org.payment_terms_days,
      issued_at = now(),
      seller    = jsonb_build_object(
        'name', v_org.name,
        'legal_name', v_org.legal_name,
        'legal_form', v_org.legal_form,
        'siret', v_org.siret,
        'address_street', v_org.address_street,
        'address_postal_code', v_org.address_postal_code,
        'address_city', v_org.address_city,
        'address_country', v_org.address_country,
        'vat_mention', v_org.vat_mention,
        'bank_iban', v_org.bank_iban,
        'bank_bic', v_org.bank_bic
      ),
      buyer     = jsonb_build_object(
        'name', v_client.name,
        'siret', v_client.siret,
        'billing_street', v_client.billing_street,
        'billing_postal_code', v_client.billing_postal_code,
        'billing_city', v_client.billing_city,
        'billing_country', v_client.billing_country,
        'contact_name', v_contact.name,
        'contact_email', v_contact.email
      )
  where i.id = p_invoice_id
  returning i.* into v_invoice;

  return v_invoice;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC : avoir (supabase.rpc('create_credit_note', { p_invoice_id }))
-- Annule une facture émise ou payée par un avoir du même montant en négatif.
-- Appelant : admin ou finance actif de l'organisation. Renvoie l'avoir.
-- -----------------------------------------------------------------------------

create or replace function public.create_credit_note(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_invoice  public.invoices;
  v_credit   public.invoices;
  v_today    date := (now() at time zone 'Europe/Paris')::date;
begin
  if v_uid is null then
    raise exception 'Non authentifié' using errcode = '42501';
  end if;

  select i.* into v_invoice
  from public.invoices i
  where i.id = p_invoice_id
  for update;

  if v_invoice.id is null or v_invoice.organization_id not in (select private.user_finance_org_ids()) then
    raise exception 'Réservé aux admins et à la finance de l''organisation' using errcode = '42501';
  end if;

  if v_invoice.kind not in ('invoice', 'deposit') or v_invoice.status not in ('issued', 'paid') then
    raise exception 'Seule une facture émise ou payée peut être annulée par un avoir' using errcode = 'P0001';
  end if;

  insert into public.invoices (
    organization_id, client_id, project_id, quote_id, kind, status, number, title,
    issue_date, lines, credited_invoice_id, seller, buyer, issued_at, created_by
  )
  values (
    v_invoice.organization_id,
    v_invoice.client_id,
    v_invoice.project_id,
    v_invoice.quote_id,
    'credit_note',
    'issued',
    private.next_document_number(v_invoice.organization_id, 'A', extract(year from v_today)::integer),
    'Avoir sur ' || v_invoice.number,
    v_today,
    coalesce((
      select jsonb_agg(
               e.value || jsonb_build_object('unit_price_cents', -((e.value ->> 'unit_price_cents')::numeric))
               order by e.ordinality
             )
      from jsonb_array_elements(v_invoice.lines) with ordinality as e
    ), '[]'::jsonb),
    v_invoice.id,
    v_invoice.seller,
    v_invoice.buyer,
    now(),
    private.current_member_id(v_invoice.organization_id)
  )
  returning * into v_credit;

  update public.invoices i
  set status = 'cancelled'
  where i.id = v_invoice.id;

  return v_credit;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC : convertir un prospect en client (supabase.rpc('convert_prospect', { p_prospect_id }))
-- Appelant : admin ou prospection actif de l'organisation. Renvoie l'id du client.
-- Idempotent : un prospect déjà converti renvoie son client sans rien recréer.
-- -----------------------------------------------------------------------------

create or replace function public.convert_prospect(p_prospect_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_prospect  public.prospects;
  v_client_id uuid;
  v_name      text;
  v_email     text;
begin
  if v_uid is null then
    raise exception 'Non authentifié' using errcode = '42501';
  end if;

  select p.* into v_prospect
  from public.prospects p
  where p.id = p_prospect_id
  for update;

  if v_prospect.id is null or v_prospect.organization_id not in (select private.user_prospect_org_ids()) then
    raise exception 'Réservé aux admins et à la prospection de l''organisation' using errcode = '42501';
  end if;

  if v_prospect.client_id is not null then
    return v_prospect.client_id;
  end if;

  insert into public.clients (organization_id, name, website, notes)
  values (v_prospect.organization_id, btrim(v_prospect.company), nullif(btrim(v_prospect.website), ''), v_prospect.notes)
  returning id into v_client_id;

  v_name  := nullif(btrim(v_prospect.contact_name), '');
  v_email := nullif(btrim(v_prospect.contact_email), '');
  if v_name is not null or v_email is not null then
    insert into public.client_contacts (client_id, name, email, phone, is_primary)
    values (v_client_id, coalesce(v_name, v_email), v_email, nullif(btrim(v_prospect.contact_phone), ''), true);
  end if;

  update public.prospects p
  set stage = 'won', client_id = v_client_id
  where p.id = v_prospect.id;

  return v_client_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC : statut de connexion des membres (supabase.rpc('member_sign_in_status', { p_organization_id }))
-- /api/members/invite relie user_id dès l'invitation : user_id ne dit donc pas si
-- l'invité s'est connecté. signed_in = le compte relié s'est déjà connecté au moins
-- une fois (auth.users.last_sign_in_at). Appelant : admin actif de l'organisation.
-- -----------------------------------------------------------------------------

create or replace function public.member_sign_in_status(p_organization_id uuid)
returns table (member_id uuid, signed_in boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_org_admin(p_organization_id) then
    raise exception 'Réservé aux admins de l''organisation' using errcode = '42501';
  end if;

  return query
    select m.id,
           coalesce(u.last_sign_in_at is not null, false)
    from public.members m
    left join auth.users u on u.id = m.user_id
    where m.organization_id = p_organization_id
    order by m.created_at, m.id;
end;
$$;

revoke all on function public.member_sign_in_status(uuid) from public, anon, service_role;
grant execute on function public.member_sign_in_status(uuid) to authenticated;

revoke all on function public.issue_invoice(uuid)      from public, anon, service_role;
revoke all on function public.create_credit_note(uuid) from public, anon, service_role;
revoke all on function public.convert_prospect(uuid)   from public, anon, service_role;
grant execute on function public.issue_invoice(uuid)      to authenticated;
grant execute on function public.create_credit_note(uuid) to authenticated;
grant execute on function public.convert_prospect(uuid)   to authenticated;

-- -----------------------------------------------------------------------------
-- Droits (rien pour anon)
-- -----------------------------------------------------------------------------

alter table public.document_counters enable row level security;
alter table public.quotes            enable row level security;
alter table public.invoices          enable row level security;
alter table public.prospects         enable row level security;

-- organizations : modification par colonne (revoke puis grant : rejouable).
revoke update on public.organizations from authenticated;
grant update (name, legal_name, legal_form, siret, address_street, address_postal_code, address_city,
              address_country, vat_mention, default_daily_rate, default_hourly_rate,
              default_vat_rate, payment_terms_days, quote_validity_days, bank_iban, bank_bic)
  on public.organizations to authenticated;

revoke all on public.document_counters, public.quotes, public.invoices, public.prospects
  from public, anon, authenticated;

-- Compteurs : aucun accès côté client (seulement par les triggers et RPC).
grant select on public.document_counters to service_role;

-- Devis et factures : les règles d'état sont dans les triggers.
grant select, insert, update, delete on public.quotes, public.invoices to authenticated;

-- Prospects : pas de suppression ; client_id n'est posé que par convert_prospect.
grant select on public.prospects to authenticated;
grant insert (organization_id, company, website, contact_name, contact_email, contact_phone, source, stage,
              next_action_date, notes, owner_member_id)
  on public.prospects to authenticated;
grant update (company, website, contact_name, contact_email, contact_phone, source, stage, next_action_date,
              notes, owner_member_id)
  on public.prospects to authenticated;

grant all on public.quotes, public.invoices, public.prospects to service_role;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

-- Lecture des clients, contacts, projets et membres de projet : admin, membre, finance.
-- prospection n'y a plus accès (il ne voit que l'organisation, l'équipe et les prospects).
-- Écriture inchangée (admin et membre, 0003).
drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients
  for select to authenticated
  using (organization_id in (select private.user_reader_org_ids()));

drop policy if exists client_contacts_select on public.client_contacts;
create policy client_contacts_select on public.client_contacts
  for select to authenticated
  using (organization_id in (select private.user_reader_org_ids()));

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using (organization_id in (select private.user_reader_org_ids()));

drop policy if exists project_members_select on public.project_members;
create policy project_members_select on public.project_members
  for select to authenticated
  using (organization_id in (select private.user_reader_org_ids()));

-- Entrées, tickets, tâches : admin et membre seulement (ni finance, ni prospection).
drop policy if exists inputs_select on public.inputs;
create policy inputs_select on public.inputs
  for select to authenticated
  using (organization_id in (select private.user_writer_org_ids()));

drop policy if exists inputs_insert on public.inputs;
create policy inputs_insert on public.inputs
  for insert to authenticated
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists inputs_update on public.inputs;
create policy inputs_update on public.inputs
  for update to authenticated
  using (organization_id in (select private.user_writer_org_ids()))
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets
  for select to authenticated
  using (organization_id in (select private.user_writer_org_ids()));

drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets
  for update to authenticated
  using (organization_id in (select private.user_writer_org_ids()))
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists tickets_delete on public.tickets;
create policy tickets_delete on public.tickets
  for delete to authenticated
  using (organization_id in (select private.user_writer_org_ids()));

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (organization_id in (select private.user_writer_org_ids()));

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (organization_id in (select private.user_writer_org_ids()))
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated
  using (organization_id in (select private.user_writer_org_ids()));

-- quotes : admin et finance.
drop policy if exists quotes_select on public.quotes;
create policy quotes_select on public.quotes
  for select to authenticated
  using (organization_id in (select private.user_finance_org_ids()));

drop policy if exists quotes_insert on public.quotes;
create policy quotes_insert on public.quotes
  for insert to authenticated
  with check (organization_id in (select private.user_finance_org_ids()));

drop policy if exists quotes_update on public.quotes;
create policy quotes_update on public.quotes
  for update to authenticated
  using (organization_id in (select private.user_finance_org_ids()))
  with check (organization_id in (select private.user_finance_org_ids()));

drop policy if exists quotes_delete on public.quotes;
create policy quotes_delete on public.quotes
  for delete to authenticated
  using (organization_id in (select private.user_finance_org_ids()));

-- invoices : admin et finance.
drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated
  using (organization_id in (select private.user_finance_org_ids()));

drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices
  for insert to authenticated
  with check (organization_id in (select private.user_finance_org_ids()));

drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices
  for update to authenticated
  using (organization_id in (select private.user_finance_org_ids()))
  with check (organization_id in (select private.user_finance_org_ids()));

drop policy if exists invoices_delete on public.invoices;
create policy invoices_delete on public.invoices
  for delete to authenticated
  using (organization_id in (select private.user_finance_org_ids()));

-- prospects : admin et prospection, sans suppression.
drop policy if exists prospects_select on public.prospects;
create policy prospects_select on public.prospects
  for select to authenticated
  using (organization_id in (select private.user_prospect_org_ids()));

drop policy if exists prospects_insert on public.prospects;
create policy prospects_insert on public.prospects
  for insert to authenticated
  with check (organization_id in (select private.user_prospect_org_ids()));

drop policy if exists prospects_update on public.prospects;
create policy prospects_update on public.prospects
  for update to authenticated
  using (organization_id in (select private.user_prospect_org_ids()))
  with check (organization_id in (select private.user_prospect_org_ids()));
