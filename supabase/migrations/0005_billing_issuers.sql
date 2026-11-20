-- =============================================================================
-- Sordulo OS — 0005_billing_issuers
-- Émetteurs de facturation (les micro-entreprises qui facturent pour l'agence),
-- numérotation AAAA-NNN (devis par organisation, factures / acomptes / avoirs par
-- émetteur, en continuant les numéros déjà présents) et import des documents
-- historiques réservé au serveur.
-- Miroir de src/shared/types.ts (BillingIssuer, Quote.issuer_id, Invoice.issuer_id).
--
-- Rejouable : if not exists / create or replace / drop ... if exists.
-- Aucune suppression de données ni de colonne (seuls un index et une fonction
-- remplacés sont supprimés).
-- Ne pas mettre de BEGIN/COMMIT ici : scripts/db-migrate.mjs exécute chaque
-- fichier dans sa propre transaction (l'éditeur SQL Supabase aussi).
--
-- Import (serveur seulement) :
--   set local sordulo.import = 'on';   -- puis insert into public.quotes / public.invoices ...
-- Pris en compte seulement si le rôle n'est ni authenticated ni anon (connexion
-- postgres directe ou service_role). Voir private.is_trusted_import().
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Émetteurs de facturation
-- -----------------------------------------------------------------------------

create table if not exists public.billing_issuers (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  member_id           uuid references public.members (id) on delete set null,
  display_name        text not null check (btrim(display_name) <> ''),
  legal_name          text,
  legal_form          text,
  siret               text constraint billing_issuers_siret_check check (siret ~ '^[0-9]{14}$'),
  address_street      text,
  address_postal_code text,
  address_city        text,
  address_country     text,
  vat_mention         text,
  vat_number          text,
  bank_iban           text,
  bank_bic            text,
  email               text,
  phone               text,
  is_default          boolean not null default false,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Un émetteur archivé n'est plus proposé : il ne peut pas être celui par défaut.
  constraint billing_issuers_default_active_check check (not (is_default and archived_at is not null))
);

-- Un seul émetteur par défaut par organisation. Pour en changer : repasser l'ancien à false, puis le nouveau à true.
create unique index if not exists billing_issuers_default_key   on public.billing_issuers (organization_id) where is_default;
create index if not exists billing_issuers_org_idx               on public.billing_issuers (organization_id);
create index if not exists billing_issuers_member_id_idx         on public.billing_issuers (member_id);

-- -----------------------------------------------------------------------------
-- Émetteur des devis et factures
-- -----------------------------------------------------------------------------

alter table public.quotes   add column if not exists issuer_id uuid references public.billing_issuers (id);
alter table public.invoices add column if not exists issuer_id uuid references public.billing_issuers (id);

create index if not exists quotes_issuer_id_idx   on public.quotes (issuer_id);
create index if not exists invoices_issuer_id_idx on public.invoices (issuer_id);

-- Numéros : AAAA-NNN pour les nouveaux documents ; les documents importés gardent leur
-- numéro d'origine (« 2026_001 », « 2026-02 ») et ceux de la 0004 le leur (D-, F-, A-).
alter table public.quotes drop constraint if exists quotes_number_format_check;
alter table public.quotes add constraint quotes_number_format_check
  check (number ~ '^[A-Za-z0-9][A-Za-z0-9_./-]{0,39}$');

alter table public.invoices drop constraint if exists invoices_number_format_check;
alter table public.invoices add constraint invoices_number_format_check
  check (number is null or number ~ '^[A-Za-z0-9][A-Za-z0-9_./-]{0,39}$');

-- Factures : un numéro est unique dans la série de son émetteur (deux micro-entreprises
-- ont chacune leur « 2026-001 »). Sans émetteur : série de l'organisation.
drop index if exists public.invoices_org_number_key;
create unique index if not exists invoices_issuer_number_key
  on public.invoices (organization_id, coalesce(issuer_id, '00000000-0000-0000-0000-000000000000'::uuid), number)
  where number is not null;

-- Compteurs : séries de la 0004 (D, F, A, conservées) et nouvelles séries
-- 'quote' (devis de l'organisation), 'invoice' (factures sans émetteur) et
-- 'invoice:<id de l'émetteur>'.
alter table public.document_counters drop constraint if exists document_counters_series_check;
alter table public.document_counters add constraint document_counters_series_check
  check (series in ('D', 'F', 'A', 'quote', 'invoice')
         or series ~ '^invoice:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

-- -----------------------------------------------------------------------------
-- Import des documents historiques
-- -----------------------------------------------------------------------------

-- Vrai si la session a demandé l'import (set local sordulo.import = 'on') ET que l'appelant
-- n'est pas un client de l'API. Volontairement SANS security definer : current_user est
-- l'appelant. Dans un trigger ou une RPC security definer, current_user devient le
-- propriétaire : le réglage « role » (posé par set role, comme le fait PostgREST) garde
-- alors le vrai rôle de l'appelant et ferme la porte à authenticated et anon.
create or replace function private.is_trusted_import()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('sordulo.import', true), '') = 'on'
     and current_user not in ('authenticated', 'anon')
     and coalesce(nullif(current_setting('role', true), ''), 'none') not in ('authenticated', 'anon');
$$;

-- -----------------------------------------------------------------------------
-- Numérotation
-- -----------------------------------------------------------------------------

-- Lit l'année et le rang d'un numéro de document, quel que soit son format :
-- « 2026_001 », « 2026-001 », « 2026-02 », « D-2026-001 », « F-2026-0001 », « A-2026-0001 ».
-- (null, null) si le numéro n'a pas ce format.
create or replace function private.parse_document_number(p_number text, out year integer, out seq integer)
language sql
immutable
set search_path = ''
as $$
  select m[1]::integer, m[2]::integer
  from (
    select regexp_match(btrim(p_number), '^(?:[A-Za-z]{1,5}[-_]?)?([0-9]{4})[-_]([0-9]{1,9})$') as m
  ) as parsed;
$$;

-- La 0004 numérotait D-AAAA-NNN / F-AAAA-NNNN / A-AAAA-NNNN : remplacée par la version ci-dessous.
drop function if exists private.next_document_number(uuid, text, integer);

-- Prochain numéro « AAAA-NNN » (3 chiffres au moins) :
--   p_kind 'quote'   : devis, série de l'organisation ;
--   p_kind 'invoice' : factures, acomptes et avoirs, série de l'émetteur (ou de l'organisation sans émetteur).
-- Rang = max(compteur, plus grand rang déjà présent dans la série pour cette année) + 1 :
-- la série continue après les documents importés.
-- Le compteur est verrouillé (upsert) avant de lire les numéros existants : deux attributions
-- simultanées ne reçoivent jamais le même numéro, et un numéro pris par une transaction
-- annulée est rendu (séries continues).
create or replace function private.next_document_number(p_org uuid, p_kind text, p_issuer_id uuid, p_year integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series   text;
  v_counter  integer;
  v_existing integer;
  v_value    integer;
begin
  v_series := case p_kind
    when 'quote' then 'quote'
    when 'invoice' then 'invoice' || coalesce(':' || p_issuer_id::text, '')
  end;
  if v_series is null then
    raise exception 'Série de numérotation inconnue : %', p_kind using errcode = '22023';
  end if;

  insert into public.document_counters as dc (organization_id, series, year, last_value)
  values (p_org, v_series, p_year, 0)
  on conflict (organization_id, series, year)
    do update set last_value = dc.last_value
  returning dc.last_value into v_counter;

  if p_kind = 'quote' then
    select max(p.seq) into v_existing
    from public.quotes q
    cross join lateral private.parse_document_number(q.number) as p
    where q.organization_id = p_org and p.year = p_year;
  else
    select max(p.seq) into v_existing
    from public.invoices i
    cross join lateral private.parse_document_number(i.number) as p
    where i.organization_id = p_org
      and i.issuer_id is not distinct from p_issuer_id
      and i.number is not null
      and p.year = p_year;
  end if;

  v_value := greatest(v_counter, coalesce(v_existing, 0)) + 1;

  update public.document_counters dc
  set last_value = v_value
  where dc.organization_id = p_org and dc.series = v_series and dc.year = p_year;

  return p_year::text || '-' || lpad(v_value::text, greatest(3, length(v_value::text)), '0');
end;
$$;

-- -----------------------------------------------------------------------------
-- Émetteur d'un document, vendeur et acheteur
-- -----------------------------------------------------------------------------

-- Émetteur d'un document de l'organisation p_org.
-- p_issuer_id fourni : contrôlé (même organisation ; pas archivé sauf p_allow_archived).
-- p_issuer_id null et p_apply_default : émetteur du devis d'origine (p_quote_id) s'il est actif,
-- sinon l'émetteur par défaut de l'organisation, sinon null (l'organisation émet).
create or replace function private.document_issuer(
  p_org uuid,
  p_issuer_id uuid,
  p_quote_id uuid,
  p_apply_default boolean,
  p_allow_archived boolean
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_issuer public.billing_issuers;
  v_id     uuid;
begin
  if p_issuer_id is null then
    if not p_apply_default then
      return null;
    end if;
    if p_quote_id is not null then
      select b.id into v_id
      from public.quotes q
      join public.billing_issuers b on b.id = q.issuer_id
      where q.id = p_quote_id and q.organization_id = p_org and b.archived_at is null;
    end if;
    if v_id is null then
      select b.id into v_id
      from public.billing_issuers b
      where b.organization_id = p_org and b.is_default;
    end if;
    return v_id;
  end if;

  select b.* into v_issuer from public.billing_issuers b where b.id = p_issuer_id;
  if v_issuer.id is null or v_issuer.organization_id <> p_org then
    raise exception 'L''émetteur n''appartient pas à l''organisation du document' using errcode = '23514';
  end if;
  if v_issuer.archived_at is not null and not p_allow_archived then
    raise exception 'Cet émetteur est archivé : choisis-en un autre' using errcode = '23514';
  end if;
  return p_issuer_id;
end;
$$;

-- Vendeur copié dans une facture : l'émetteur s'il y en a un, sinon l'organisation
-- (vat_number, email et phone à null). Mêmes clés dans les deux cas.
create or replace function private.document_seller(p_org uuid, p_issuer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_issuer public.billing_issuers;
  v_org    public.organizations;
begin
  if p_issuer_id is not null then
    select b.* into v_issuer from public.billing_issuers b where b.id = p_issuer_id and b.organization_id = p_org;
    if v_issuer.id is null then
      raise exception 'L''émetteur n''appartient pas à l''organisation du document' using errcode = '23514';
    end if;
    return jsonb_build_object(
      'name', v_issuer.display_name,
      'legal_name', v_issuer.legal_name,
      'legal_form', v_issuer.legal_form,
      'siret', v_issuer.siret,
      'address_street', v_issuer.address_street,
      'address_postal_code', v_issuer.address_postal_code,
      'address_city', v_issuer.address_city,
      'address_country', v_issuer.address_country,
      'vat_mention', v_issuer.vat_mention,
      'vat_number', v_issuer.vat_number,
      'bank_iban', v_issuer.bank_iban,
      'bank_bic', v_issuer.bank_bic,
      'email', v_issuer.email,
      'phone', v_issuer.phone
    );
  end if;

  select o.* into v_org from public.organizations o where o.id = p_org;
  return jsonb_build_object(
    'name', v_org.name,
    'legal_name', v_org.legal_name,
    'legal_form', v_org.legal_form,
    'siret', v_org.siret,
    'address_street', v_org.address_street,
    'address_postal_code', v_org.address_postal_code,
    'address_city', v_org.address_city,
    'address_country', v_org.address_country,
    'vat_mention', v_org.vat_mention,
    'vat_number', null,
    'bank_iban', v_org.bank_iban,
    'bank_bic', v_org.bank_bic,
    'email', null,
    'phone', null
  );
end;
$$;

-- Acheteur copié dans une facture : le client et son contact principal à cette date.
create or replace function private.document_buyer(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_client  public.clients;
  v_contact public.client_contacts;
begin
  select c.* into v_client from public.clients c where c.id = p_client_id;
  select cc.* into v_contact
  from public.client_contacts cc
  where cc.client_id = p_client_id and cc.is_primary
  limit 1;

  return jsonb_build_object(
    'name', v_client.name,
    'siret', v_client.siret,
    'billing_street', v_client.billing_street,
    'billing_postal_code', v_client.billing_postal_code,
    'billing_city', v_client.billing_city,
    'billing_country', v_client.billing_country,
    'contact_name', v_contact.name,
    'contact_email', v_contact.email
  );
end;
$$;

revoke all on function private.is_trusted_import()                                  from public, anon;
revoke all on function private.parse_document_number(text)                          from public, anon, authenticated;
revoke all on function private.next_document_number(uuid, text, uuid, integer)      from public, anon, authenticated, service_role;
revoke all on function private.document_issuer(uuid, uuid, uuid, boolean, boolean)  from public, anon;
revoke all on function private.document_seller(uuid, uuid)                          from public, anon, authenticated;
revoke all on function private.document_buyer(uuid)                                from public, anon, authenticated;
-- Appelées par le trigger des factures, qui s'exécute avec les droits de l'appelant
-- (vendeur et acheteur : seulement à l'import, donc jamais pour authenticated).
grant execute on function private.is_trusted_import()                                 to authenticated, service_role;
grant execute on function private.parse_document_number(text)                         to service_role;
grant execute on function private.document_issuer(uuid, uuid, uuid, boolean, boolean) to authenticated, service_role;
grant execute on function private.document_seller(uuid, uuid)                         to service_role;
grant execute on function private.document_buyer(uuid)                                to service_role;

-- -----------------------------------------------------------------------------
-- Trigger des émetteurs
-- -----------------------------------------------------------------------------

-- Émetteurs : organisation figée, membre relié de la même organisation, un émetteur
-- archivé n'est pas celui par défaut (message clair avant la contrainte).
create or replace function public.tg_billing_issuer_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id then
      raise exception 'billing_issuers.organization_id ne peut pas être modifié' using errcode = '42501';
    end if;
    new.id         := old.id;
    new.created_at := old.created_at;
  end if;

  if new.is_default and new.archived_at is not null then
    raise exception 'L''émetteur par défaut ne peut pas être archivé : choisis d''abord un autre émetteur par défaut'
      using errcode = '23514';
  end if;

  if new.member_id is not null
     and (tg_op = 'INSERT' or new.member_id is distinct from old.member_id)
     and not exists (
       select 1 from public.members m where m.id = new.member_id and m.organization_id = new.organization_id
     ) then
    raise exception 'Le membre relié doit faire partie de l''organisation de l''émetteur' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists billing_issuers_10_guard on public.billing_issuers;
create trigger billing_issuers_10_guard
  before insert or update on public.billing_issuers
  for each row execute function public.tg_billing_issuer_guard();

drop trigger if exists billing_issuers_20_updated_at on public.billing_issuers;
create trigger billing_issuers_20_updated_at
  before update on public.billing_issuers
  for each row execute function public.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- Triggers des devis (remplace la 0004)
-- -----------------------------------------------------------------------------

-- Devis : organisation déduite du client, émetteur (défaut : celui de l'organisation),
-- numéro AAAA-NNN attribué à la création, validité par défaut, totaux recalculés,
-- horodatage des changements de statut, devis accepté ou refusé figé, suppression des
-- brouillons seulement.
-- Import (private.is_trusted_import()) : à la création, number, status et dates fournis sont gardés.
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
  v_import boolean := false;
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
  else
    v_import := private.is_trusted_import();
  end if;

  new.organization_id := private.document_scope(
    case when tg_op = 'UPDATE' then old.organization_id end,
    new.client_id, new.project_id, null, null
  );

  if tg_op = 'INSERT' then
    new.issuer_id := private.document_issuer(new.organization_id, new.issuer_id, null, true, v_import);
  elsif new.issuer_id is distinct from old.issuer_id then
    new.issuer_id := private.document_issuer(new.organization_id, new.issuer_id, null, false, false);
  end if;

  if tg_op = 'INSERT' then
    new.issue_date := coalesce(new.issue_date, (now() at time zone 'Europe/Paris')::date);
    if v_import and nullif(btrim(new.number), '') is not null then
      new.number := btrim(new.number);
    else
      new.number := private.next_document_number(new.organization_id, 'quote', null, extract(year from new.issue_date)::integer);
    end if;

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

    -- Import : les dates d'envoi, d'acceptation et de refus fournies sont gardées telles quelles.
    if not v_import then
      new.sent_at     := case when new.status = 'sent' then now() end;
      new.accepted_at := case when new.status = 'accepted' then now() end;
      new.refused_at  := case when new.status = 'refused' then now() end;
    end if;
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
-- Triggers des factures (remplace la 0004)
-- -----------------------------------------------------------------------------

-- Factures : un brouillon est modifiable, sauf number, seller, buyer, issued_at, paid_at,
-- cancelled_at et credited_invoice_id, posés par les RPC issue_invoice / create_credit_note.
-- Hors brouillon, plus rien ne change (émetteur compris) sauf le statut émise ↔ payée
-- (paid_at suit), et l'annulation, réservée à create_credit_note. Suppression des brouillons seulement.
-- Émetteur : défaut à la création (devis d'origine, puis émetteur par défaut) ; un avoir
-- prend toujours celui de la facture qu'il annule.
--
-- Volontairement SANS security definer : current_user est le rôle de l'appelant
-- (authenticated via l'API, service_role pour /api, propriétaire des RPC security definer).
-- Seules ces RPC (ou l'éditeur SQL) sont « de confiance » et peuvent émettre ou annuler ;
-- à la création, l'import (private.is_trusted_import()) l'est aussi, service_role compris :
-- statut, numéro, dates, vendeur et acheteur fournis sont gardés (vendeur et acheteur
-- complétés s'ils manquent sur une facture non brouillon).
create or replace function public.tg_invoice_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_import  boolean := false;
  v_trusted boolean;
  v_totals  record;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' and pg_trigger_depth() = 1 then
      raise exception 'Seule une facture en brouillon peut être supprimée : pour annuler une facture émise, crée un avoir'
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    v_import := private.is_trusted_import();
  end if;
  v_trusted := current_user not in ('authenticated', 'anon', 'service_role') or v_import;

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

  if new.kind = 'credit_note' then
    -- Un avoir reste dans la série de l'émetteur de la facture qu'il annule.
    select i.issuer_id into new.issuer_id from public.invoices i where i.id = new.credited_invoice_id;
  elsif tg_op = 'INSERT' then
    new.issuer_id := private.document_issuer(new.organization_id, new.issuer_id, new.quote_id, true, v_trusted);
  elsif new.issuer_id is distinct from old.issuer_id then
    new.issuer_id := private.document_issuer(new.organization_id, new.issuer_id, null, false, false);
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, private.current_member_id(new.organization_id));
    if new.created_by is not null and not exists (
      select 1 from public.members m where m.id = new.created_by and m.organization_id = new.organization_id
    ) then
      raise exception 'created_by n''est pas membre de l''organisation de la facture' using errcode = '23514';
    end if;

    if v_import and new.status <> 'draft' then
      new.seller := coalesce(new.seller, private.document_seller(new.organization_id, new.issuer_id));
      new.buyer  := coalesce(new.buyer, private.document_buyer(new.client_id));
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
-- Statut du projet suivant ses devis et factures (remplace la 0004)
-- Seulement vers l'avant (prospect < quote_sent < in_progress < delivered < paid),
-- jamais sur un projet archivé, jamais pendant un import (le statut du projet est fourni).
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
  if private.is_trusted_import() then
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

revoke all on function public.tg_billing_issuer_guard()     from public, anon, authenticated, service_role;
revoke all on function public.tg_quote_guard()              from public, anon, authenticated, service_role;
revoke all on function public.tg_invoice_guard()            from public, anon, authenticated, service_role;
revoke all on function public.tg_document_project_status()  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RPC : émettre une facture (remplace la 0004 ; même signature)
-- Numéro AAAA-NNN dans la série de l'émetteur, vendeur = l'émetteur (ou l'organisation).
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
  if v_invoice.issuer_id is not null and exists (
    select 1 from public.billing_issuers b where b.id = v_invoice.issuer_id and b.archived_at is not null
  ) then
    raise exception 'L''émetteur de cette facture est archivé : choisis-en un autre avant d''émettre' using errcode = 'P0001';
  end if;

  select o.* into v_org from public.organizations o where o.id = v_invoice.organization_id;

  update public.invoices i
  set number     = private.next_document_number(v_invoice.organization_id, 'invoice', v_invoice.issuer_id,
                                                extract(year from v_today)::integer),
      status     = 'issued',
      issue_date = v_today,
      due_date   = v_today + v_org.payment_terms_days,
      issued_at  = now(),
      seller     = private.document_seller(v_invoice.organization_id, v_invoice.issuer_id),
      buyer      = private.document_buyer(v_invoice.client_id)
  where i.id = p_invoice_id
  returning i.* into v_invoice;

  return v_invoice;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC : avoir (remplace la 0004 ; même signature)
-- Annule une facture émise ou payée par un avoir du même montant en négatif, numéroté
-- dans la série de l'émetteur de la facture, avec le même vendeur et le même acheteur.
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
    organization_id, client_id, project_id, quote_id, issuer_id, kind, status, number, title,
    issue_date, lines, credited_invoice_id, seller, buyer, issued_at, created_by
  )
  values (
    v_invoice.organization_id,
    v_invoice.client_id,
    v_invoice.project_id,
    v_invoice.quote_id,
    v_invoice.issuer_id,
    'credit_note',
    'issued',
    private.next_document_number(v_invoice.organization_id, 'invoice', v_invoice.issuer_id,
                                 extract(year from v_today)::integer),
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

revoke all on function public.issue_invoice(uuid)      from public, anon, service_role;
revoke all on function public.create_credit_note(uuid) from public, anon, service_role;
grant execute on function public.issue_invoice(uuid)      to authenticated;
grant execute on function public.create_credit_note(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Droits et RLS des émetteurs (rien pour anon ; pas de suppression : archivage)
-- -----------------------------------------------------------------------------

alter table public.billing_issuers enable row level security;

revoke all on public.billing_issuers from public, anon, authenticated, service_role;
grant select on public.billing_issuers to authenticated;
grant insert (organization_id, member_id, display_name, legal_name, legal_form, siret, address_street,
              address_postal_code, address_city, address_country, vat_mention, vat_number, bank_iban,
              bank_bic, email, phone, is_default)
  on public.billing_issuers to authenticated;
grant update (member_id, display_name, legal_name, legal_form, siret, address_street, address_postal_code,
              address_city, address_country, vat_mention, vat_number, bank_iban, bank_bic, email, phone,
              is_default, archived_at)
  on public.billing_issuers to authenticated;
grant select, insert, update on public.billing_issuers to service_role;

-- Lecture : admin et finance (ils émettent les documents). Écriture : admins.
drop policy if exists billing_issuers_select on public.billing_issuers;
create policy billing_issuers_select on public.billing_issuers
  for select to authenticated
  using (organization_id in (select private.user_finance_org_ids()));

drop policy if exists billing_issuers_insert on public.billing_issuers;
create policy billing_issuers_insert on public.billing_issuers
  for insert to authenticated
  with check (organization_id in (select private.user_admin_org_ids()));

drop policy if exists billing_issuers_update on public.billing_issuers;
create policy billing_issuers_update on public.billing_issuers
  for update to authenticated
  using (organization_id in (select private.user_admin_org_ids()))
  with check (organization_id in (select private.user_admin_org_ids()));
