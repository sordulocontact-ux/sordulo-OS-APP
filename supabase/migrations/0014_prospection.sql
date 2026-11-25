-- =============================================================================
-- Sordulo OS : 0014_prospection
-- Prospection avec apporteurs d'affaires : date d'enregistrement (fait foi pour la commission),
-- pré-audit IA du site, audit humain, offre du catalogue, argumentaire, raison de refus,
-- « ne plus contacter » (RGPD), étapes « À auditer » et « Offre prête » ; l'apporteur
-- (rôle prospection) ne voit et ne modifie que ses prospects, jamais l'audit ni l'offre.
-- Commissions calculées par la base à l'encaissement d'une facture (barème par tranches cumulatif
-- sur le premier devis signé, taux fixe sur les devis suivants, avoirs déduits, frais refacturés
-- exclus). Même calcul dans src/shared/commission.ts.
-- Miroir de src/shared/types.ts (Prospect, ProspectAudit, Commission).
--
-- Règles de commission (contrat d'apporteur, barème saisi par apporteur dans commission_plans) :
--   * client apporté : prospect dont le responsable (owner_member_id) a un barème actif, devenu
--     client (prospects.client_id) ;
--   * premier devis : premier devis accepté du client, accepté entre registered_at et
--     registered_at + sign_window_months (sinon le client n'est pas apporté : aucune commission) ;
--   * facture du premier devis (invoices.quote_id) payée → « first » : barème cumulatif sur tout
--     l'encaissé de ce devis (montant = barème(cumul après) − barème(cumul avant)) ;
--   * facture d'un autre devis du client accepté dans followup_window_months après le premier
--     → « followup » : followup_rate % de la base ;
--   * base = total HT de la facture moins ses lignes « rebilled » ; un avoir sur une facture
--     commissionnée donne une ligne négative ; une facture qui repasse de payée à émise retire
--     ses commissions encore « dues » ;
--   * payer_issuer_id = l'émetteur qui a encaissé (il paie la commission).
--
-- Rejouable : if not exists / create or replace / drop ... if exists.
-- Colonnes ajoutées ; registered_at des prospects existants = leur date de création.
-- Pas de BEGIN/COMMIT : scripts/db-migrate.mjs exécute chaque fichier dans sa transaction.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- prospects : enregistrement, audit, offre, argumentaire, refus, opposition
-- -----------------------------------------------------------------------------

-- Date du premier contact (Paris) : fait foi pour la fenêtre de signature de la commission.
alter table public.prospects add column if not exists registered_at date;
update public.prospects
set registered_at = (created_at at time zone 'Europe/Paris')::date
where registered_at is null;
alter table public.prospects alter column registered_at set default ((now() at time zone 'Europe/Paris')::date);
alter table public.prospects alter column registered_at set not null;

-- Pré-audit IA (forme : ProspectAudit) et son état ; écrits par le serveur.
alter table public.prospects add column if not exists audit jsonb
  constraint prospects_audit_check check (audit is null or jsonb_typeof(audit) = 'object');
alter table public.prospects add column if not exists audit_status text not null default 'none'
  constraint prospects_audit_status_check check (audit_status in ('none', 'running', 'done', 'error'));
-- Audit humain (admin, membre) ; audited_at / audited_by posés par la base.
alter table public.prospects add column if not exists audit_notes text
  constraint prospects_audit_notes_check check (audit_notes is null or char_length(audit_notes) <= 10000);
alter table public.prospects add column if not exists audited_at timestamptz;
alter table public.prospects add column if not exists audited_by uuid references public.members (id) on delete set null;
-- Offre recommandée (catalogue) et ses notes (admin, membre).
alter table public.prospects add column if not exists recommended_service_id uuid references public.services (id) on delete set null;
alter table public.prospects add column if not exists offer_notes text
  constraint prospects_offer_notes_check check (offer_notes is null or char_length(offer_notes) <= 4000);
-- Argumentaire (IA ou apporteur), raison du refus, opposition à tout nouveau contact (RGPD).
alter table public.prospects add column if not exists pitch text
  constraint prospects_pitch_check check (pitch is null or char_length(pitch) <= 10000);
alter table public.prospects add column if not exists lost_reason text
  constraint prospects_lost_reason_check check (lost_reason is null or char_length(lost_reason) <= 1000);
alter table public.prospects add column if not exists do_not_contact boolean not null default false;

create index if not exists prospects_audited_by_idx             on public.prospects (audited_by);
create index if not exists prospects_recommended_service_id_idx on public.prospects (recommended_service_id);
create index if not exists prospects_org_owner_idx              on public.prospects (organization_id, owner_member_id);

-- Étapes : « À auditer » et « Offre prête » en tête de la démarche.
alter table public.prospects drop constraint if exists prospects_stage_check;
alter table public.prospects add constraint prospects_stage_check
  check (stage in ('to_audit', 'offer_ready', 'to_contact', 'contacted', 'followed_up', 'meeting', 'won', 'lost'));

-- -----------------------------------------------------------------------------
-- Trigger des prospects (remplace la 0004)
-- -----------------------------------------------------------------------------

-- Prospects : created_by et owner_member_id prennent par défaut le membre connecté ;
-- won_at suit le passage en « gagné » ; responsable, client et offre restent dans l'organisation ;
-- audited_at / audited_by suivent l'audit humain (audit_notes).
-- Apporteur (rôle prospection) :
--   * à la création : étape « À auditer », enregistré aujourd'hui, responsable = lui, sans audit ni offre ;
--   * ensuite : jamais l'audit, l'offre, la date d'enregistrement ni le responsable ; seulement les
--     étapes de démarche (À contacter → Perdu), et rien d'autre que « Perdu » tant que l'audit n'est pas fait.
-- Le serveur (clé service, sans compte) et les RPC n'ont pas ces limites.
create or replace function public.tg_prospect_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor     public.members;
  v_apporteur boolean;
begin
  select m.* into v_actor
  from public.members m
  where m.user_id = (select auth.uid())
    and m.organization_id = new.organization_id
    and m.removed_at is null
  limit 1;
  v_apporteur := coalesce(v_actor.role = 'prospection', false);

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

    if v_apporteur then
      if new.audit is distinct from old.audit
         or new.audit_status is distinct from old.audit_status
         or new.audit_notes is distinct from old.audit_notes
         or new.recommended_service_id is distinct from old.recommended_service_id
         or new.offer_notes is distinct from old.offer_notes then
        raise exception 'L''audit et l''offre sont réservés à l''agence' using errcode = '42501';
      end if;
      if new.registered_at is distinct from old.registered_at then
        raise exception 'La date d''enregistrement ne se modifie pas' using errcode = '42501';
      end if;
      if new.owner_member_id is distinct from old.owner_member_id then
        raise exception 'Le responsable du prospect ne se modifie pas' using errcode = '42501';
      end if;
      if new.stage is distinct from old.stage then
        if new.stage in ('to_audit', 'offer_ready') then
          raise exception 'Cette étape est posée par l''agence' using errcode = '42501';
        end if;
        if old.stage = 'to_audit' and new.stage <> 'lost' then
          raise exception 'Attends l''audit de l''agence avant de démarcher ce prospect' using errcode = 'P0001';
        end if;
      end if;
    end if;

    if new.audit_notes is distinct from old.audit_notes then
      new.audited_at := case when new.audit_notes is null then null else now() end;
      new.audited_by := case when new.audit_notes is null then null else v_actor.id end;
    else
      new.audited_at := old.audited_at;
      new.audited_by := old.audited_by;
    end if;
  else
    new.created_by      := coalesce(new.created_by, v_actor.id);
    new.owner_member_id := coalesce(new.owner_member_id, new.created_by);

    if v_apporteur then
      new.created_by             := v_actor.id;
      new.owner_member_id        := v_actor.id;
      new.stage                  := 'to_audit';
      new.registered_at          := (now() at time zone 'Europe/Paris')::date;
      new.audit                  := null;
      new.audit_status           := 'none';
      new.audit_notes            := null;
      new.recommended_service_id := null;
      new.offer_notes            := null;
    end if;

    new.registered_at := coalesce(new.registered_at, (now() at time zone 'Europe/Paris')::date);
    new.audited_at    := case when new.audit_notes is not null then now() end;
    new.audited_by    := case when new.audit_notes is not null then v_actor.id end;
    new.won_at        := case when new.stage = 'won' then now() end;
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

  if tg_op = 'INSERT' or new.recommended_service_id is distinct from old.recommended_service_id then
    if new.recommended_service_id is not null and not exists (
      select 1 from public.services s where s.id = new.recommended_service_id and s.organization_id = new.organization_id
    ) then
      raise exception 'L''offre n''appartient pas à l''organisation du prospect' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.tg_prospect_guard() from public, anon, authenticated, service_role;

-- Droits par colonne des prospects (remplace la 0004). audit, audit_status, audited_at et
-- audited_by : serveur et base seulement. Les limites de l'apporteur sont dans le trigger.
revoke insert, update on public.prospects from authenticated;
grant insert (organization_id, company, website, contact_name, contact_email, contact_phone, source, stage,
              next_action_date, notes, owner_member_id, registered_at, audit_notes, recommended_service_id,
              offer_notes, pitch, lost_reason, do_not_contact)
  on public.prospects to authenticated;
grant update (company, website, contact_name, contact_email, contact_phone, source, stage, next_action_date,
              notes, owner_member_id, registered_at, audit_notes, recommended_service_id, offer_notes, pitch,
              lost_reason, do_not_contact)
  on public.prospects to authenticated;

-- RLS des prospects (remplace la 0004) : admin et membre voient et modifient tous les prospects
-- de l'organisation (audit, offre) ; l'apporteur seulement ceux dont il est responsable ou auteur.
drop policy if exists prospects_select on public.prospects;
create policy prospects_select on public.prospects
  for select to authenticated
  using (
    organization_id in (select private.user_writer_org_ids())
    or (
      organization_id in (select private.user_prospect_org_ids())
      and (owner_member_id in (select private.user_member_ids()) or created_by in (select private.user_member_ids()))
    )
  );

drop policy if exists prospects_insert on public.prospects;
create policy prospects_insert on public.prospects
  for insert to authenticated
  with check (
    organization_id in (select private.user_writer_org_ids())
    or organization_id in (select private.user_prospect_org_ids())
  );

drop policy if exists prospects_update on public.prospects;
create policy prospects_update on public.prospects
  for update to authenticated
  using (
    organization_id in (select private.user_writer_org_ids())
    or (
      organization_id in (select private.user_prospect_org_ids())
      and (owner_member_id in (select private.user_member_ids()) or created_by in (select private.user_member_ids()))
    )
  )
  with check (
    organization_id in (select private.user_writer_org_ids())
    or (
      organization_id in (select private.user_prospect_org_ids())
      and (owner_member_id in (select private.user_member_ids()) or created_by in (select private.user_member_ids()))
    )
  );

-- -----------------------------------------------------------------------------
-- Commissions
-- -----------------------------------------------------------------------------

create table if not exists public.commissions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Apporteur.
  member_id       uuid not null references public.members (id),
  prospect_id     uuid references public.prospects (id) on delete set null,
  client_id       uuid not null references public.clients (id),
  quote_id        uuid references public.quotes (id) on delete set null,
  invoice_id      uuid not null references public.invoices (id),
  kind            text not null check (kind in ('first', 'followup')),
  -- Encaissé HT pris en compte (hors frais refacturés), négatif pour un avoir. Centimes.
  base_cents      bigint not null,
  amount_cents    bigint not null,
  status          text not null default 'due' check (status in ('due', 'invoiced', 'paid', 'cancelled')),
  -- Émetteur qui a encaissé : c'est lui qui paie la commission.
  payer_issuer_id uuid references public.billing_issuers (id) on delete set null,
  invoiced_at     timestamptz,
  paid_at         timestamptz,
  note            text check (note is null or char_length(note) <= 1000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists commissions_invoice_member_key on public.commissions (invoice_id, member_id);
create index if not exists commissions_org_status_idx            on public.commissions (organization_id, status);
create index if not exists commissions_member_idx                on public.commissions (member_id, created_at desc);
create index if not exists commissions_quote_idx                 on public.commissions (member_id, quote_id, kind);
create index if not exists commissions_prospect_id_idx           on public.commissions (prospect_id);
create index if not exists commissions_client_id_idx             on public.commissions (client_id);
create index if not exists commissions_payer_issuer_id_idx       on public.commissions (payer_issuer_id);

-- Base de commission d'une facture : HT des lignes (même arrondi que document_totals), sans
-- les lignes « rebilled » (frais refacturés).
create or replace function private.commission_base_cents(p_lines jsonb)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum(round((e.value ->> 'quantity')::numeric * (e.value ->> 'unit_price_cents')::numeric)), 0)::bigint
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as e
  where coalesce((e.value ->> 'rebilled')::boolean, false) = false;
$$;

-- Barème par tranches appliqué à un montant cumulé (centimes, arrondi à l'entier).
-- Ex. tranches 12 % jusqu'à 300 000, 10 % jusqu'à 1 000 000, 8 % au-delà : 800 000 → 86 000.
create or replace function private.commission_tier_amount(p_tiers jsonb, p_cents numeric)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_tier  jsonb;
  v_prev  numeric := 0;
  v_cap   numeric;
  v_total numeric := 0;
begin
  if p_cents is null or p_cents <= 0 then
    return 0;
  end if;
  for v_tier in
    select e.value from jsonb_array_elements(p_tiers) with ordinality as e order by e.ordinality
  loop
    v_cap := case when jsonb_typeof(v_tier -> 'up_to_cents') = 'number' then (v_tier ->> 'up_to_cents')::numeric end;
    if v_cap is null or p_cents <= v_cap then
      v_total := v_total + (p_cents - v_prev) * (v_tier ->> 'rate')::numeric / 100;
      return round(v_total)::bigint;
    end if;
    v_total := v_total + (v_cap - v_prev) * (v_tier ->> 'rate')::numeric / 100;
    v_prev := v_cap;
  end loop;
  return round(v_total)::bigint;
end;
$$;

-- Date d'acceptation d'un devis (Paris), date du devis à défaut (devis importés).
create or replace function private.quote_accepted_on(p_quote public.quotes)
returns date
language sql
stable
set search_path = ''
as $$
  select coalesce((p_quote.accepted_at at time zone 'Europe/Paris')::date, p_quote.issue_date);
$$;

-- Calcule et enregistre la commission d'une facture payée, ou d'un avoir (voir l'en-tête).
-- Idempotent : une seule ligne par facture et apporteur.
create or replace function private.compute_commission(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice    public.invoices;
  v_prospect   public.prospects;
  v_plan       public.commission_plans;
  v_first      public.quotes;
  v_quote      public.quotes;
  v_first_on   date;
  v_quote_on   date;
  v_base       bigint;
  v_before     bigint;
  v_amount     bigint;
  v_kind       text;
  v_commission public.commissions;
begin
  select i.* into v_invoice from public.invoices i where i.id = p_invoice_id;
  if v_invoice.id is null then
    return;
  end if;
  v_base := private.commission_base_cents(v_invoice.lines);

  -- Avoir : déduit chaque commission de la facture annulée.
  if v_invoice.kind = 'credit_note' then
    for v_commission in
      select c.* from public.commissions c
      where c.invoice_id = v_invoice.credited_invoice_id and c.status <> 'cancelled'
    loop
      v_plan := null;
      select cp.* into v_plan from public.commission_plans cp where cp.member_id = v_commission.member_id;
      if v_commission.kind = 'first' and v_plan.member_id is not null then
        select coalesce(sum(c.base_cents), 0) into v_before
        from public.commissions c
        where c.member_id = v_commission.member_id
          and c.quote_id is not distinct from v_commission.quote_id
          and c.kind = 'first'
          and c.status <> 'cancelled';
        v_amount := private.commission_tier_amount(v_plan.tiers, v_before + v_base)
                  - private.commission_tier_amount(v_plan.tiers, v_before);
      else
        v_amount := -v_commission.amount_cents;
      end if;

      insert into public.commissions (organization_id, member_id, prospect_id, client_id, quote_id, invoice_id,
                                      kind, base_cents, amount_cents, payer_issuer_id)
      values (v_invoice.organization_id, v_commission.member_id, v_commission.prospect_id, v_commission.client_id,
              v_commission.quote_id, v_invoice.id, v_commission.kind, v_base, v_amount, v_invoice.issuer_id)
      on conflict (invoice_id, member_id) do nothing;
    end loop;
    return;
  end if;

  if v_invoice.quote_id is null then
    return;
  end if;

  -- Client apporté : prospect converti dont le responsable a un barème actif.
  select p.* into v_prospect
  from public.prospects p
  join public.commission_plans cp on cp.member_id = p.owner_member_id and cp.active
  where p.client_id = v_invoice.client_id and p.organization_id = v_invoice.organization_id
  order by p.registered_at, p.created_at
  limit 1;
  if v_prospect.id is null then
    return;
  end if;
  select cp.* into v_plan from public.commission_plans cp where cp.member_id = v_prospect.owner_member_id;

  -- Premier devis accepté du client, dans la fenêtre de signature.
  select q.* into v_first
  from public.quotes q
  where q.client_id = v_invoice.client_id and q.status = 'accepted'
  order by private.quote_accepted_on(q), q.created_at
  limit 1;
  if v_first.id is null then
    return;
  end if;
  v_first_on := private.quote_accepted_on(v_first);
  if v_first_on < v_prospect.registered_at
     or v_first_on > (v_prospect.registered_at + make_interval(months => v_plan.sign_window_months))::date then
    return;
  end if;

  if v_invoice.quote_id = v_first.id then
    v_kind := 'first';
    select coalesce(sum(c.base_cents), 0) into v_before
    from public.commissions c
    where c.member_id = v_plan.member_id and c.quote_id = v_first.id and c.kind = 'first' and c.status <> 'cancelled';
    v_amount := private.commission_tier_amount(v_plan.tiers, v_before + v_base)
              - private.commission_tier_amount(v_plan.tiers, v_before);
  else
    select q.* into v_quote
    from public.quotes q
    where q.id = v_invoice.quote_id and q.client_id = v_invoice.client_id and q.status = 'accepted';
    if v_quote.id is null then
      return;
    end if;
    v_quote_on := private.quote_accepted_on(v_quote);
    if v_quote_on < v_first_on
       or v_quote_on > (v_first_on + make_interval(months => v_plan.followup_window_months))::date then
      return;
    end if;
    v_kind := 'followup';
    v_amount := round(v_base * v_plan.followup_rate / 100)::bigint;
  end if;

  if v_base = 0 and v_amount = 0 then
    return;
  end if;

  insert into public.commissions (organization_id, member_id, prospect_id, client_id, quote_id, invoice_id,
                                  kind, base_cents, amount_cents, payer_issuer_id)
  values (v_invoice.organization_id, v_plan.member_id, v_prospect.id, v_invoice.client_id, v_invoice.quote_id,
          v_invoice.id, v_kind, v_base, v_amount, v_invoice.issuer_id)
  on conflict (invoice_id, member_id) do nothing;
end;
$$;

revoke all on function private.commission_base_cents(jsonb)          from public, anon;
revoke all on function private.commission_tier_amount(jsonb, numeric) from public, anon;
revoke all on function private.quote_accepted_on(public.quotes)      from public, anon, authenticated;
revoke all on function private.compute_commission(uuid)              from public, anon, authenticated, service_role;
grant execute on function private.commission_base_cents(jsonb)          to authenticated, service_role;
grant execute on function private.commission_tier_amount(jsonb, numeric) to authenticated, service_role;

-- Factures : payée (facture ou acompte), ou avoir émis → commission. Repasse de payée à émise →
-- les commissions encore « dues » de cette facture sont retirées (recalculées au prochain paiement).
-- Jamais pendant un import (documents historiques).
create or replace function public.tg_invoice_commission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_trusted_import() then
    return null;
  end if;

  if new.kind in ('invoice', 'deposit') then
    if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
      perform private.compute_commission(new.id);
    elsif tg_op = 'UPDATE' and old.status = 'paid' and new.status = 'issued' then
      delete from public.commissions c where c.invoice_id = new.id and c.status = 'due';
    end if;
  elsif new.kind = 'credit_note' and new.status in ('issued', 'paid')
        and (tg_op = 'INSERT' or old.status = 'draft') then
    perform private.compute_commission(new.id);
  end if;
  return null;
end;
$$;

-- commissions : seuls le statut et la note changent ; invoiced_at / paid_at suivent le statut.
create or replace function public.tg_commission_guard()
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
    new.prospect_id     := old.prospect_id;
    new.client_id       := old.client_id;
    new.quote_id        := old.quote_id;
    new.invoice_id      := old.invoice_id;
    new.kind            := old.kind;
    new.base_cents      := old.base_cents;
    new.amount_cents    := old.amount_cents;
    new.payer_issuer_id := old.payer_issuer_id;
    new.created_at      := old.created_at;
    new.invoiced_at := case
      when new.status in ('invoiced', 'paid') then coalesce(old.invoiced_at, now())
    end;
    new.paid_at := case
      when new.status = 'paid' then coalesce(old.paid_at, now())
    end;
  end if;
  return new;
end;
$$;

-- Nouvelle commission → l'apporteur et les admins (sauf l'auteur de l'action).
create or replace function public.tg_notify_commission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := private.current_member_id(new.organization_id);
  v_name    text;
  v_company text;
  v_amount  text;
  v_member  uuid;
begin
  select m.name into v_name from public.members m where m.id = new.member_id;
  select p.company into v_company from public.prospects p where p.id = new.prospect_id;
  v_amount := replace(to_char(abs(new.amount_cents) / 100.0, 'FM999999990.00'), '.', ',') || ' €';

  for v_member in
    select new.member_id
    union
    select private.org_admin_ids(new.organization_id)
  loop
    continue when v_member = v_actor;
    perform private.notify(v_member, 'commission.created',
      case when new.amount_cents < 0 then 'Commission déduite : -' else 'Commission : ' end || v_amount
        || case when v_company is not null then ' (' || v_company || ')' else '' end,
      case when v_member = new.member_id then null else 'Apporteur : ' || coalesce(v_name, '?') end,
      '/commissions',
      jsonb_build_object('commission_id', new.id, 'invoice_id', new.invoice_id, 'member_id', new.member_id),
      null);
  end loop;
  return null;
end;
$$;

drop trigger if exists invoices_40_commission on public.invoices;
create trigger invoices_40_commission
  after insert or update of status on public.invoices
  for each row execute function public.tg_invoice_commission();

drop trigger if exists commissions_10_guard on public.commissions;
create trigger commissions_10_guard
  before update on public.commissions
  for each row execute function public.tg_commission_guard();

drop trigger if exists commissions_20_updated_at on public.commissions;
create trigger commissions_20_updated_at
  before update on public.commissions
  for each row execute function public.tg_set_updated_at();

drop trigger if exists commissions_40_notify on public.commissions;
create trigger commissions_40_notify
  after insert on public.commissions
  for each row execute function public.tg_notify_commission();

revoke all on function public.tg_invoice_commission() from public, anon, authenticated, service_role;
revoke all on function public.tg_commission_guard()   from public, anon, authenticated, service_role;
revoke all on function public.tg_notify_commission()  from public, anon, authenticated, service_role;

alter table public.commissions enable row level security;

revoke all on public.commissions from public, anon, authenticated;
-- Pas d'insertion côté client : calculées par la base (ou ajoutées par le serveur).
grant select on public.commissions to authenticated;
grant update (status, note) on public.commissions to authenticated;
grant all on public.commissions to service_role;

-- Lecture : admin, finance et l'apporteur (ses lignes) ; statut et note : admin et finance.
drop policy if exists commissions_select on public.commissions;
create policy commissions_select on public.commissions
  for select to authenticated
  using (
    organization_id in (select private.user_finance_org_ids())
    or member_id in (select private.user_member_ids())
  );

drop policy if exists commissions_update on public.commissions;
create policy commissions_update on public.commissions
  for update to authenticated
  using (organization_id in (select private.user_finance_org_ids()))
  with check (organization_id in (select private.user_finance_org_ids()));
