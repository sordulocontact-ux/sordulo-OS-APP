-- =============================================================================
-- Sordulo OS : 0021_invoice_paid_date
-- Date d'encaissement d'une facture modifiable. Jusqu'ici, la base posait paid_at à l'instant où
-- l'on cliquait « Marquer comme payée » et refusait toute autre valeur : un virement reçu la veille
-- ou noté en retard tombait au mauvais jour, voire au mauvais mois (encaissements du mois, CA
-- encaissé, seuils micro-entreprise et franchise de TVA, qui se comptent à l'encaissement).
--
-- Seul changement : dans tg_invoice_guard, une facture payée (ou qui le devient) accepte la date
-- d'encaissement fournie, entre le jour d'émission et maintenant. Sans date fournie, rien ne change
-- (maintenant au passage en payée, l'ancienne date ensuite). Le reste de la fonction est celui de la
-- 0005, mot pour mot. Les commissions de l'apporteur ne dépendent pas de cette date (déclencheur sur
-- le statut seulement).
--
-- Rejouable : create or replace. Aucune donnée existante n'est modifiée.
-- Pas de BEGIN/COMMIT : scripts/db-migrate.mjs exécute chaque fichier dans sa transaction.
-- =============================================================================

-- Factures : un brouillon est modifiable, sauf number, seller, buyer, issued_at, paid_at,
-- cancelled_at et credited_invoice_id, posés par les RPC issue_invoice / create_credit_note.
-- Hors brouillon, plus rien ne change (émetteur compris) sauf le statut émise ↔ payée
-- (paid_at suit, ou prend la date d'encaissement donnée), et l'annulation, réservée à create_credit_note. Suppression des brouillons seulement.
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

    -- Date d'encaissement : celle donnée par l'appelant si elle change (date réelle du virement,
    -- choisie au moment de marquer payée ou corrigée ensuite), sinon l'ancienne, sinon maintenant.
    -- Jamais dans le futur ni avant le jour d'émission (heure de Paris).
    if new.status = 'paid' and new.paid_at is not null and new.paid_at is distinct from old.paid_at then
      if new.paid_at > now() then
        raise exception 'La date d''encaissement ne peut pas être dans le futur' using errcode = '23514';
      end if;
      if old.issue_date is not null and (new.paid_at at time zone 'Europe/Paris')::date < old.issue_date then
        raise exception 'La date d''encaissement ne peut pas précéder la date d''émission de la facture'
          using errcode = '23514';
      end if;
    else
      new.paid_at := case
        when new.status = 'paid' and old.status = 'paid' then old.paid_at
        when new.status = 'paid' then now()
        when new.status = 'cancelled' then old.paid_at
      end;
    end if;
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

revoke all on function public.tg_invoice_guard() from public, anon, authenticated, service_role;
