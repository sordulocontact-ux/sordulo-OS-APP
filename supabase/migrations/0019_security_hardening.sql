-- =============================================================================
-- Sordulo OS : 0019_security_hardening
-- Correctifs de la revue de sécurité entre rôles d'une même organisation (lot L15).
-- Principe : les prix (devis, factures, contrats, fichiers de devis / factures) sont réservés à
-- admin et finance ; le rôle membre n'y a pas accès ; l'apporteur (prospection) ne voit que ses
-- prospects et ses commissions.
--
--   1. contracts : lecture, écriture et suppression par admin et finance seulement (un contrat
--      reprend les prix du devis).
--   2. project_files de devis / facture (kind 'quote' ou 'invoice', ou relié à un devis / une
--      facture) : lecture, écriture et suppression par admin et finance seulement ; mêmes limites
--      sur leurs objets Storage (la politique retrouve la ligne par son chemin, unique).
--   3. prospects : owner_member_id et registered_at (ils font foi pour la commission) modifiables
--      par un admin seulement, et par personne une fois le prospect converti (client_id renseigné) ;
--      à la création, un membre ne choisit ni un autre responsable ni une autre date.
--   4. create_notification : un non-admin ne notifie que lui-même ; un admin, un membre de son
--      organisation ; le serveur (service_role), tout le monde. ai_proposals.payload.member_ids :
--      seulement des membres actifs de l'organisation de la proposition.
--   5. Chemins Storage : project_files.storage_path = <organization_id>/<project_id>/<nom sans />
--      (projet de la ligne), file_intakes.storage_path = <organization_id>/inbox/<created_by>/<nom
--      sans />, jamais de « .. ». Contrôlé à la création (le chemin ne change plus ensuite).
--
-- Rejouable : create or replace / drop ... if exists. Aucune donnée existante n'est modifiée.
-- Les contrôles de chemin ne portent que sur les nouvelles lignes.
-- Pas de BEGIN/COMMIT : scripts/db-migrate.mjs exécute chaque fichier dans sa transaction.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Contrats : admin et finance
-- -----------------------------------------------------------------------------

drop policy if exists contracts_select on public.contracts;
create policy contracts_select on public.contracts
  for select to authenticated
  using (organization_id in (select private.user_finance_org_ids()));

drop policy if exists contracts_insert on public.contracts;
create policy contracts_insert on public.contracts
  for insert to authenticated
  with check (organization_id in (select private.user_finance_org_ids()));

drop policy if exists contracts_update on public.contracts;
create policy contracts_update on public.contracts
  for update to authenticated
  using (organization_id in (select private.user_finance_org_ids()))
  with check (organization_id in (select private.user_finance_org_ids()));

drop policy if exists contracts_delete on public.contracts;
create policy contracts_delete on public.contracts
  for delete to authenticated
  using (organization_id in (select private.user_finance_org_ids()));

-- -----------------------------------------------------------------------------
-- 2. Fichiers de devis et de factures : admin et finance
-- -----------------------------------------------------------------------------

-- Fichier de devis, de facture ou de contrat (ils portent les prix) : par son type, ou par son lien vers un devis / une facture.
create or replace function private.is_billing_file(p_kind text, p_quote_id uuid, p_invoice_id uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_kind in ('quote', 'invoice', 'contract'), false) or p_quote_id is not null or p_invoice_id is not null;
$$;

revoke all on function private.is_billing_file(text, uuid, uuid) from public, anon;
grant execute on function private.is_billing_file(text, uuid, uuid) to authenticated, service_role;

-- Admin et finance : tous les fichiers ; membre : tous sauf ceux de devis / factures.
-- (Un membre qui range un devis voit donc son insertion refusée : 42501.)
drop policy if exists project_files_select on public.project_files;
create policy project_files_select on public.project_files
  for select to authenticated
  using (
    organization_id in (select private.user_finance_org_ids())
    or (organization_id in (select private.user_reader_org_ids())
        and not private.is_billing_file(kind, quote_id, invoice_id))
  );

drop policy if exists project_files_insert on public.project_files;
create policy project_files_insert on public.project_files
  for insert to authenticated
  with check (
    organization_id in (select private.user_finance_org_ids())
    or (organization_id in (select private.user_reader_org_ids())
        and not private.is_billing_file(kind, quote_id, invoice_id))
  );

drop policy if exists project_files_update on public.project_files;
create policy project_files_update on public.project_files
  for update to authenticated
  using (
    organization_id in (select private.user_finance_org_ids())
    or (organization_id in (select private.user_reader_org_ids())
        and not private.is_billing_file(kind, quote_id, invoice_id))
  )
  with check (
    organization_id in (select private.user_finance_org_ids())
    or (organization_id in (select private.user_reader_org_ids())
        and not private.is_billing_file(kind, quote_id, invoice_id))
  );

drop policy if exists project_files_delete on public.project_files;
create policy project_files_delete on public.project_files
  for delete to authenticated
  using (
    organization_id in (select private.user_finance_org_ids())
    or (organization_id in (select private.user_reader_org_ids())
        and not private.is_billing_file(kind, quote_id, invoice_id))
  );

-- Accès à un objet du bucket « files » (remplace la 0010) : mêmes règles, plus
--   * aucun segment « . » ou « .. », aucun « .. » dans le chemin ;
--   * objet d'un fichier de devis / facture (ligne project_files de même chemin) : admin et
--     finance seulement, en lecture comme en écriture. Un objet sans ligne (envoi en cours, avant
--     la création de la ligne) garde les règles de la 0010.
create or replace function private.can_access_file_object(p_name text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_folders text[] := storage.foldername(p_name);
  v_depth   integer := coalesce(array_length(v_folders, 1), 0);
  v_org     uuid;
  v_uuid    text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p_name is null or p_name like '%/' or position('..' in p_name) > 0 or p_name ~ '(^|/)\.(/|$)'
     or v_depth < 2 or v_folders[1] !~ v_uuid then
    return false;
  end if;
  v_org := v_folders[1]::uuid;

  if v_org not in (select private.user_reader_org_ids()) then
    return false;
  end if;

  if v_folders[2] = 'inbox' then
    if v_depth <> 3 or v_folders[3] !~ v_uuid then
      return false;
    end if;
    if v_folders[3]::uuid = private.current_member_id(v_org) then
      return true;
    end if;
    return not p_write and private.is_org_admin(v_org);
  end if;

  if v_depth <> 2 or v_folders[2] !~ v_uuid then
    return false;
  end if;

  if v_org not in (select private.user_finance_org_ids()) and exists (
    select 1 from public.project_files f
    where f.storage_path = p_name and private.is_billing_file(f.kind, f.quote_id, f.invoice_id)
  ) then
    return false;
  end if;

  if not p_write then
    return true;
  end if;
  return exists (
    select 1 from public.projects p where p.id = v_folders[2]::uuid and p.organization_id = v_org
  );
end;
$$;

revoke all on function private.can_access_file_object(text, boolean) from public, anon;
grant execute on function private.can_access_file_object(text, boolean) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Prospects : responsable et date d'enregistrement (remplace la fonction de la 0014)
-- -----------------------------------------------------------------------------

-- Prospects : created_by et owner_member_id prennent par défaut le membre connecté ;
-- won_at suit le passage en « gagné » ; responsable, client et offre restent dans l'organisation ;
-- audited_at / audited_by suivent l'audit humain (audit_notes).
-- Responsable (owner_member_id) et date d'enregistrement (registered_at) : ils font foi pour la
-- commission de l'apporteur.
--   * modification : admin seulement, et par personne une fois le prospect converti (client_id
--     renseigné avant la modification) ;
--   * création par un membre : responsable = lui (ou vide), enregistré aujourd'hui.
-- Apporteur (rôle prospection) :
--   * à la création : étape « À auditer », enregistré aujourd'hui, responsable = lui, sans audit ni offre ;
--   * ensuite : jamais l'audit, l'offre, la date d'enregistrement ni le responsable ; seulement les
--     étapes de démarche (À contacter → Perdu), et rien d'autre que « Perdu » tant que l'audit n'est pas fait.
-- Le serveur (clé service, sans compte) n'a pas ces limites.
create or replace function public.tg_prospect_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor     public.members;
  v_apporteur boolean;
  v_today     date := (now() at time zone 'Europe/Paris')::date;
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

    -- Responsable et date d'enregistrement : commission de l'apporteur.
    if v_actor.id is not null
       and (new.owner_member_id is distinct from old.owner_member_id
            or new.registered_at is distinct from old.registered_at) then
      if old.client_id is not null then
        raise exception 'Prospect devenu client : le responsable et la date d''enregistrement ne se modifient plus'
          using errcode = '42501';
      end if;
      if v_actor.role <> 'admin' then
        raise exception 'Seul un admin modifie le responsable ou la date d''enregistrement d''un prospect'
          using errcode = '42501';
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
      new.registered_at          := v_today;
      new.audit                  := null;
      new.audit_status           := 'none';
      new.audit_notes            := null;
      new.recommended_service_id := null;
      new.offer_notes            := null;
    elsif v_actor.id is not null and v_actor.role <> 'admin' then
      -- Membre : il ne confie pas le prospect à un autre (apporteur compris) et ne l'antidate pas.
      if new.owner_member_id is distinct from v_actor.id then
        raise exception 'Seul un admin choisit un autre responsable pour un prospect' using errcode = '42501';
      end if;
      if new.registered_at is not null and new.registered_at <> v_today then
        raise exception 'Seul un admin choisit la date d''enregistrement d''un prospect' using errcode = '42501';
      end if;
      new.created_by := v_actor.id;
    end if;

    new.registered_at := coalesce(new.registered_at, v_today);
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

-- -----------------------------------------------------------------------------
-- 4. Notifications : destinataire selon le rôle (remplace la RPC de la 0013)
-- -----------------------------------------------------------------------------

-- RPC : supabase.rpc('create_notification', { p_member_id, p_kind, p_title, p_body, p_link, p_payload, p_dedupe_key })
-- Destinataire : soi-même pour un non-admin (récap du lundi, relances, seuils calculés à l'ouverture
-- de l'app) ; un membre actif de son organisation pour un admin ; n'importe quel membre actif pour le
-- serveur (clé service). Un titre libre envoyé à un autre membre servirait à l'hameçonner.
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

  if not v_server
     and p_member_id not in (select private.user_member_ids())
     and v_org not in (select private.user_admin_org_ids()) then
    raise exception 'Tu ne peux créer une notification que pour toi-même' using errcode = '42501';
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

-- Propositions de l'IA : payload.member_ids (destinataires de la notification) ne contient que des
-- membres actifs de l'organisation de la proposition. S'exécute après ai_proposals_10_guard
-- (organisation fiable). Refus (23514) plutôt que filtre : une liste fausse est une erreur.
create or replace function public.tg_ai_proposal_members_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.payload is not distinct from old.payload then
    return new;
  end if;
  if jsonb_typeof(new.payload -> 'member_ids') = 'array' and exists (
    select 1
    from jsonb_array_elements(new.payload -> 'member_ids') as e
    where not coalesce(
      case
        when jsonb_typeof(e.value) = 'string'
             and (e.value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then exists (
          select 1 from public.members m
          where m.id = (e.value #>> '{}')::uuid
            and m.organization_id = new.organization_id
            and m.removed_at is null
        )
      end,
      false
    )
  ) then
    raise exception 'payload.member_ids ne doit contenir que des membres actifs de l''organisation' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists ai_proposals_15_members_guard on public.ai_proposals;
create trigger ai_proposals_15_members_guard
  before insert or update on public.ai_proposals
  for each row execute function public.tg_ai_proposal_members_guard();

revoke all on function public.tg_ai_proposal_members_guard() from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Chemins Storage des fichiers et des dépôts
-- -----------------------------------------------------------------------------

-- project_files : <organization_id>/<project_id>/<nom sans />, projet de la ligne, jamais « .. ».
-- S'exécute après project_files_10_project_scope et project_files_15_guard (organisation fiable).
-- Le chemin ne change plus ensuite (le guard le fige) : contrôle à la création seulement. Vaut aussi
-- pour le serveur : le rangement automatique déplace l'objet vers ce chemin, l'admin qui range le
-- dépôt d'un autre le copie vers ce chemin.
create or replace function public.tg_project_file_storage_path()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_prefix text := new.organization_id::text || '/' || new.project_id::text || '/';
begin
  if new.storage_path is null
     or left(new.storage_path, length(v_prefix)) <> v_prefix
     or substr(new.storage_path, length(v_prefix) + 1) !~ '^[^/]+$'
     or substr(new.storage_path, length(v_prefix) + 1) = '.'
     or position('..' in new.storage_path) > 0 then
    raise exception 'Le chemin du fichier doit être <organisation>/<projet du fichier>/<nom>, sans « .. »'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists project_files_16_storage_path on public.project_files;
create trigger project_files_16_storage_path
  before insert on public.project_files
  for each row execute function public.tg_project_file_storage_path();

-- file_intakes : <organization_id>/inbox/<created_by>/<nom sans />, jamais « .. ». S'exécute après
-- file_intakes_10_guard (auteur = membre connecté par défaut) ; un dépôt a toujours un auteur.
create or replace function public.tg_file_intake_storage_path()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_prefix text := new.organization_id::text || '/inbox/' || coalesce(new.created_by::text, '') || '/';
begin
  if new.created_by is null then
    raise exception 'Un dépôt doit avoir un auteur (created_by)' using errcode = '23514';
  end if;
  if new.storage_path is null
     or left(new.storage_path, length(v_prefix)) <> v_prefix
     or substr(new.storage_path, length(v_prefix) + 1) !~ '^[^/]+$'
     or substr(new.storage_path, length(v_prefix) + 1) = '.'
     or position('..' in new.storage_path) > 0 then
    raise exception 'Le chemin du dépôt doit être <organisation>/inbox/<auteur>/<nom>, sans « .. »'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists file_intakes_15_storage_path on public.file_intakes;
create trigger file_intakes_15_storage_path
  before insert on public.file_intakes
  for each row execute function public.tg_file_intake_storage_path();

revoke all on function public.tg_project_file_storage_path() from public, anon, authenticated, service_role;
revoke all on function public.tg_file_intake_storage_path()  from public, anon, authenticated, service_role;
