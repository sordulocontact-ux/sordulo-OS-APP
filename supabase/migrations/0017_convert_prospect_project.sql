-- 0017 : conversion d'un prospect gagné (roadmap : « Signé : client et projet créés, commission calculée »).
-- Remplace convert_prospect(uuid) de 0004 par convert_prospect(uuid, text) :
-- - droits alignés sur 0014 : admin et membre pour tout prospect de l'organisation ; l'apporteur (rôle
--   prospection) seulement pour SES prospects (responsable ou créateur), alors que 0004 lui ouvrait tous ceux
--   de l'organisation ;
-- - crée aussi le projet du client (statut « prospect », nom donné ou nom de la société) s'il n'en a aucun ;
-- - idempotente : un prospect déjà converti renvoie son client sans rien recréer.
-- Renvoie toujours l'id du client (comme 0004). Rejouable.

drop function if exists public.convert_prospect(uuid);

create or replace function public.convert_prospect(p_prospect_id uuid, p_project_name text default null)
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
  v_allowed   boolean;
begin
  if v_uid is null then
    raise exception 'Non authentifié' using errcode = '42501';
  end if;

  select p.* into v_prospect
  from public.prospects p
  where p.id = p_prospect_id
  for update;

  v_allowed := v_prospect.id is not null and (
    v_prospect.organization_id in (select private.user_writer_org_ids())
    or (
      v_prospect.organization_id in (select private.user_prospect_org_ids())
      and (
        v_prospect.owner_member_id in (select private.user_member_ids())
        or v_prospect.created_by in (select private.user_member_ids())
      )
    )
  );
  if not v_allowed then
    raise exception 'Réservé aux admins, aux membres et à l''apporteur du prospect' using errcode = '42501';
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

  if not exists (select 1 from public.projects pr where pr.client_id = v_client_id) then
    insert into public.projects (organization_id, client_id, name, status)
    values (
      v_prospect.organization_id,
      v_client_id,
      left(coalesce(nullif(btrim(p_project_name), ''), btrim(v_prospect.company)), 200),
      'prospect'
    );
  end if;

  update public.prospects p
  set stage = 'won', client_id = v_client_id
  where p.id = v_prospect.id;

  return v_client_id;
end;
$$;

revoke all on function public.convert_prospect(uuid, text) from public, anon, service_role;
grant execute on function public.convert_prospect(uuid, text) to authenticated;
