-- 0018 : import d'un devis ou d'une facture déposé en fichier (rangement, action IA « classify » mode import).
-- La clé service ne peut pas ouvrir, par l'API REST, la transaction qui pose `sordulo.import = 'on'` puis insère
-- (migration 0005). Cette RPC le fait dans sa propre transaction : le numéro, le statut et les dates du document
-- d'origine sont gardés, comme pour les imports de scripts. Réservée au serveur (service_role) : un client
-- authentifié n'a pas le droit de l'exécuter, et même s'il l'avait, private.is_trusted_import() resterait faux
-- pour lui (réglage « role » = authenticated).
-- p_doc : { client_id, project_id?, quote_id?, issuer_id?, number, title?, status?, issue_date?, valid_until?,
--           due_date?, lines, notes?, created_by? }. Renvoie l'id du devis ou de la facture créé. Rejouable.

create or replace function public.import_document_from_file(p_kind text, p_doc jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id         uuid;
  v_status     text;
  v_issue_date date := nullif(p_doc ->> 'issue_date', '')::date;
  v_issued_ts  timestamptz;
  v_number     text := nullif(btrim(coalesce(p_doc ->> 'number', '')), '');
begin
  if v_number is null then
    raise exception 'Numéro du document d''origine manquant' using errcode = '23514';
  end if;
  if jsonb_typeof(coalesce(p_doc -> 'lines', '[]'::jsonb)) <> 'array' then
    raise exception 'Lignes invalides' using errcode = '23514';
  end if;
  v_issued_ts := coalesce(v_issue_date::timestamp at time zone 'Europe/Paris', now());

  perform set_config('sordulo.import', 'on', true);

  if p_kind = 'quote' then
    v_status := coalesce(nullif(p_doc ->> 'status', ''), 'sent');
    if v_status not in ('sent', 'accepted', 'refused') then
      raise exception 'Statut de devis importé invalide : %', v_status using errcode = '23514';
    end if;
    insert into public.quotes (
      client_id, project_id, issuer_id, number, title, status, issue_date, valid_until,
      sent_at, accepted_at, refused_at, lines, notes, created_by
    ) values (
      (p_doc ->> 'client_id')::uuid,
      nullif(p_doc ->> 'project_id', '')::uuid,
      nullif(p_doc ->> 'issuer_id', '')::uuid,
      v_number,
      coalesce(nullif(btrim(coalesce(p_doc ->> 'title', '')), ''), 'Devis importé'),
      v_status,
      v_issue_date,
      nullif(p_doc ->> 'valid_until', '')::date,
      v_issued_ts,
      case when v_status = 'accepted' then v_issued_ts end,
      case when v_status = 'refused' then v_issued_ts end,
      coalesce(p_doc -> 'lines', '[]'::jsonb),
      nullif(p_doc ->> 'notes', ''),
      nullif(p_doc ->> 'created_by', '')::uuid
    )
    returning id into v_id;
  elsif p_kind = 'invoice' then
    v_status := coalesce(nullif(p_doc ->> 'status', ''), 'issued');
    if v_status not in ('issued', 'paid') then
      raise exception 'Statut de facture importée invalide : %', v_status using errcode = '23514';
    end if;
    insert into public.invoices (
      client_id, project_id, quote_id, issuer_id, kind, status, number, title, issue_date, due_date,
      lines, notes, issued_at, paid_at, created_by
    ) values (
      (p_doc ->> 'client_id')::uuid,
      nullif(p_doc ->> 'project_id', '')::uuid,
      nullif(p_doc ->> 'quote_id', '')::uuid,
      nullif(p_doc ->> 'issuer_id', '')::uuid,
      'invoice',
      v_status,
      v_number,
      coalesce(nullif(btrim(coalesce(p_doc ->> 'title', '')), ''), 'Facture importée'),
      v_issue_date,
      nullif(p_doc ->> 'due_date', '')::date,
      coalesce(p_doc -> 'lines', '[]'::jsonb),
      nullif(p_doc ->> 'notes', ''),
      v_issued_ts,
      case when v_status = 'paid' then v_issued_ts end,
      nullif(p_doc ->> 'created_by', '')::uuid
    )
    returning id into v_id;
  else
    raise exception 'Type de document importable : quote ou invoice' using errcode = '22023';
  end if;

  perform set_config('sordulo.import', '', true);
  return v_id;
end;
$$;

revoke all on function public.import_document_from_file(text, jsonb) from public, anon, authenticated;
grant execute on function public.import_document_from_file(text, jsonb) to service_role;
