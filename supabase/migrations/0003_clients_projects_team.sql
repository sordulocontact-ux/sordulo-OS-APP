-- =============================================================================
-- Sordulo OS — 0003_clients_projects_team
-- Clients (adresse de facturation, SIRET, contacts), projets (statuts, dates,
-- membres du projet), équipe (rôles, retrait doux, jours indisponibles) et
-- paramètres de l'organisation (infos légales pour les futurs devis).
-- Miroir exact de src/shared/types.ts : toute modification de colonne se fait
-- aux deux endroits.
--
-- Rejouable : if not exists / create or replace / drop ... if exists.
-- Aucune suppression de données ni de colonne (clients.contact_name et
-- contact_email restent en base, reprises dans client_contacts).
-- Ne pas mettre de BEGIN/COMMIT ici : scripts/db-migrate.mjs exécute chaque
-- fichier dans sa propre transaction (l'éditeur SQL Supabase aussi).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Colonnes des tables existantes
-- (les contraintes déclarées dans « add column if not exists » ne sont créées
-- qu'une fois : si la colonne existe déjà, toute la clause est ignorée)
-- -----------------------------------------------------------------------------

-- organizations : infos légales, utilisées par les futurs devis et factures.
alter table public.organizations add column if not exists legal_name          text;
alter table public.organizations add column if not exists legal_form          text;
alter table public.organizations add column if not exists siret               text
  constraint organizations_siret_check check (siret ~ '^[0-9]{14}$');
alter table public.organizations add column if not exists address_street      text;
alter table public.organizations add column if not exists address_postal_code text;
alter table public.organizations add column if not exists address_city        text;
alter table public.organizations add column if not exists address_country     text;
alter table public.organizations add column if not exists vat_mention         text;
alter table public.organizations add column if not exists default_daily_rate  numeric
  constraint organizations_default_daily_rate_check check (default_daily_rate >= 0);
alter table public.organizations add column if not exists default_hourly_rate numeric
  constraint organizations_default_hourly_rate_check check (default_hourly_rate >= 0);
alter table public.organizations add column if not exists updated_at          timestamptz not null default now();

-- members : jours indisponibles (1 = lundi … 7 = dimanche), invitation, retrait doux.
alter table public.members add column if not exists unavailable_weekdays smallint[] not null default '{}'
  constraint members_unavailable_weekdays_check
  check (unavailable_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]);
alter table public.members add column if not exists invited_at timestamptz;
alter table public.members add column if not exists removed_at timestamptz;
alter table public.members add column if not exists updated_at timestamptz not null default now();

-- Niveaux de compétence : nombre de 0 à 5 pour design et dev quand ils sont présents
-- (l'interface saisit 1 à 5, 0 = ne pratique pas reste accepté).
-- CASE plutôt que AND/OR : l'ordre d'évaluation est garanti, le cast ne voit jamais une chaîne.
alter table public.members drop constraint if exists members_skills_levels_check;
alter table public.members add constraint members_skills_levels_check check (
  (case
     when not (skills ? 'design') then true
     when jsonb_typeof(skills -> 'design') <> 'number' then false
     else (skills -> 'design')::numeric between 0 and 5
   end)
  and
  (case
     when not (skills ? 'dev') then true
     when jsonb_typeof(skills -> 'dev') <> 'number' then false
     else (skills -> 'dev')::numeric between 0 and 5
   end)
);

-- clients : SIRET, adresse de facturation, site, notes, archivage.
alter table public.clients add column if not exists siret               text
  constraint clients_siret_check check (siret ~ '^[0-9]{14}$');
alter table public.clients add column if not exists billing_street      text;
alter table public.clients add column if not exists billing_postal_code text;
alter table public.clients add column if not exists billing_city        text;
alter table public.clients add column if not exists billing_country     text;
alter table public.clients add column if not exists website             text;
alter table public.clients add column if not exists notes               text;
alter table public.clients add column if not exists archived_at         timestamptz;
alter table public.clients add column if not exists updated_at          timestamptz not null default now();

-- projects : dates, statut contrôlé.
alter table public.projects add column if not exists start_date date;
alter table public.projects add column if not exists due_date   date;
alter table public.projects add column if not exists updated_at timestamptz not null default now();

alter table public.projects drop constraint if exists projects_dates_check;
alter table public.projects add constraint projects_dates_check
  check (start_date is null or due_date is null or due_date >= start_date);

-- Statuts : l'ancien « active » (et toute valeur inconnue) devient « in_progress »,
-- AVANT d'ajouter la contrainte.
update public.projects
set status = 'in_progress'
where status not in ('prospect', 'quote_sent', 'in_progress', 'delivered', 'paid', 'archived');

alter table public.projects alter column status set default 'in_progress';
alter table public.projects drop constraint if exists projects_status_check;
alter table public.projects add constraint projects_status_check
  check (status in ('prospect', 'quote_sent', 'in_progress', 'delivered', 'paid', 'archived'));

-- -----------------------------------------------------------------------------
-- Nouvelles tables
-- -----------------------------------------------------------------------------

-- Contacts d'un client. organization_id est rempli par un trigger à partir du client.
create table if not exists public.client_contacts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id       uuid not null references public.clients (id) on delete cascade,
  name            text not null check (btrim(name) <> ''),
  email           text,
  phone           text,
  role            text,
  is_primary      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Membres affectés à un projet. organization_id est rempli par un trigger à partir du projet.
create table if not exists public.project_members (
  project_id      uuid not null references public.projects (id) on delete cascade,
  member_id       uuid not null references public.members (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (project_id, member_id)
);

-- -----------------------------------------------------------------------------
-- Unicité et index
-- -----------------------------------------------------------------------------

-- Un seul contact principal par client. Pour en changer : passer l'ancien à false, puis le nouveau à true.
create unique index if not exists client_contacts_one_primary_key on public.client_contacts (client_id) where is_primary;
create index if not exists client_contacts_client_id_idx       on public.client_contacts (client_id);
create index if not exists client_contacts_organization_id_idx on public.client_contacts (organization_id);

create index if not exists project_members_member_id_idx       on public.project_members (member_id);
create index if not exists project_members_organization_id_idx on public.project_members (organization_id);

-- Membres actifs d'une organisation (listes d'attribution, comptage des admins).
create index if not exists members_org_active_idx on public.members (organization_id, role) where removed_at is null;

-- Recherche et alerte de doublon client (même nom ou même SIRET).
create index if not exists clients_org_lower_name_idx on public.clients (organization_id, lower(name));
create index if not exists clients_org_siret_idx      on public.clients (organization_id, siret) where siret is not null;

-- Filtres de la page Projets (statut, client).
create index if not exists projects_org_status_idx on public.projects (organization_id, status);

-- -----------------------------------------------------------------------------
-- Reprise des données : contact_name / contact_email → contact principal
-- Idempotent : rien n'est ajouté pour un client qui a déjà au moins un contact
-- (migration rejouée, ou contacts saisis entre-temps dans l'app).
-- -----------------------------------------------------------------------------

insert into public.client_contacts (organization_id, client_id, name, email, is_primary)
select c.organization_id,
       c.id,
       coalesce(nullif(btrim(c.contact_name), ''), btrim(c.contact_email)),
       nullif(btrim(c.contact_email), ''),
       true
from public.clients c
where (nullif(btrim(c.contact_name), '') is not null or nullif(btrim(c.contact_email), '') is not null)
  and not exists (select 1 from public.client_contacts cc where cc.client_id = c.id);

-- -----------------------------------------------------------------------------
-- Appartenance et rôles (utilisés par les politiques RLS et les RPC)
-- -----------------------------------------------------------------------------

-- Organisations du membre connecté, membres retirés exclus : un membre retiré ne voit plus rien.
-- Toujours utilisée en « organization_id in (select private.user_org_ids()) » (initplan).
create or replace function private.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.members m
  where m.user_id = (select auth.uid())
    and m.removed_at is null;
$$;

-- Organisations où le membre connecté peut écrire clients, contacts, projets et membres de projet
-- (admin et membre actifs ; prospection exclu).
create or replace function private.user_writer_org_ids()
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
    and m.role in ('admin', 'membre');
$$;

-- Organisations où le membre connecté est admin actif (équipe, paramètres).
create or replace function private.user_admin_org_ids()
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
    and m.role = 'admin';
$$;

-- Le membre connecté est-il admin actif de cette organisation ? (RPC de retrait / réintégration)
create or replace function private.is_org_admin(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    where m.user_id = (select auth.uid())
      and m.organization_id = org
      and m.removed_at is null
      and m.role = 'admin'
  );
$$;

revoke all on function private.user_org_ids()         from public, anon;
revoke all on function private.user_writer_org_ids()  from public, anon;
revoke all on function private.user_admin_org_ids()   from public, anon;
revoke all on function private.is_org_admin(uuid)     from public, anon;
grant execute on function private.user_org_ids()        to authenticated, service_role;
grant execute on function private.user_writer_org_ids() to authenticated, service_role;
grant execute on function private.user_admin_org_ids()  to authenticated, service_role;
grant execute on function private.is_org_admin(uuid)    to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Triggers d'intégrité
-- -----------------------------------------------------------------------------

-- client_contacts : organization_id est toujours celui du client (le front n'a pas à le fournir
-- et ne peut pas le falsifier ; la RLS vérifie ensuite que c'est une organisation de l'utilisateur).
create or replace function public.tg_enforce_client_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.client_id is distinct from old.client_id then
    select c.organization_id into new.organization_id
    from public.clients c
    where c.id = new.client_id;

    if new.organization_id is null then
      raise exception 'Client % introuvable', new.client_id using errcode = '23503';
    end if;

    if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
      raise exception 'Un contact ne peut pas changer d''organisation' using errcode = '42501';
    end if;
  else
    new.organization_id := old.organization_id;
  end if;

  return new;
end;
$$;

-- project_members : organization_id est celui du projet, et le membre doit être de la même organisation.
create or replace function public.tg_enforce_project_member_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.project_id is distinct from old.project_id then
    select p.organization_id into new.organization_id
    from public.projects p
    where p.id = new.project_id;

    if new.organization_id is null then
      raise exception 'Projet % introuvable', new.project_id using errcode = '23503';
    end if;
  else
    new.organization_id := old.organization_id;
  end if;

  if not exists (
    select 1 from public.members m
    where m.id = new.member_id and m.organization_id = new.organization_id
  ) then
    raise exception 'Le membre % n''appartient pas à l''organisation du projet', new.member_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- members : gardes côté base, quel que soit le chemin (front, /api, RPC, éditeur SQL).
--
-- 1. Pour authenticated / anon, organization_id, user_id, email, invited_at, removed_at, id et
--    created_at ne sont pas modifiables. Les droits par colonne (plus bas) le refusent déjà ;
--    ce trigger le garantit même si un « grant update » plus large était ajouté un jour.
--    removed_at ne change donc QUE par les RPC remove_member / restore_member (ou service_role),
--    qui appliquent les règles ci-dessous.
-- 2. Pour tout le monde : impossible de rétrograder, retirer ou déplacer le dernier admin actif
--    d'une organisation.
-- 3. Pour un utilisateur connecté : impossible de se retirer soi-même.
--
-- Volontairement SANS security definer : current_user doit être le rôle de l'appelant
-- (authenticated via l'API Supabase, service_role pour /api, postgres pour les RPC et l'éditeur SQL).
-- Le comptage des admins passe par la RLS de members, qui montre toute l'organisation à un admin
-- (seuls les admins passent la politique members_update).
-- La suppression d'une ligne members n'est pas gardée : authenticated n'a pas le droit delete,
-- et la suppression d'une organisation doit pouvoir supprimer ses membres en cascade.
create or replace function public.tg_guard_member()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_restricted boolean := current_user in ('authenticated', 'anon');
begin
  if v_restricted and (
       new.id is distinct from old.id
       or new.organization_id is distinct from old.organization_id
       or new.user_id is distinct from old.user_id
       or new.email is distinct from old.email
       or new.invited_at is distinct from old.invited_at
       or new.removed_at is distinct from old.removed_at
       or new.created_at is distinct from old.created_at
     ) then
    raise exception 'Seuls le nom, le rôle, les compétences, la capacité et les jours indisponibles d''un membre sont modifiables'
      using errcode = '42501';
  end if;

  if old.removed_at is null and new.removed_at is not null
     and old.user_id is not null and old.user_id = (select auth.uid()) then
    raise exception 'Tu ne peux pas te retirer toi-même de l''organisation' using errcode = 'P0001';
  end if;

  -- L'admin actif cesse de l'être (rétrogradé, retiré ou déplacé) : il doit en rester un autre.
  if old.role = 'admin' and old.removed_at is null
     and (new.role <> 'admin' or new.removed_at is not null
          or new.organization_id is distinct from old.organization_id) then
    -- Sérialise les changements d'admins d'une même organisation (deux admins qui se rétrogradent en même temps).
    perform pg_advisory_xact_lock(hashtextextended('sordulo.members.admins:' || old.organization_id::text, 0));

    if not exists (
      select 1 from public.members m
      where m.organization_id = old.organization_id
        and m.id <> old.id
        and m.role = 'admin'
        and m.removed_at is null
    ) then
      raise exception 'L''organisation doit garder au moins un admin actif' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

-- Les triggers d'une même table s'exécutent par ordre alphabétique de nom.
drop trigger if exists organizations_20_updated_at on public.organizations;
create trigger organizations_20_updated_at
  before update on public.organizations
  for each row execute function public.tg_set_updated_at();

drop trigger if exists members_10_guard on public.members;
create trigger members_10_guard
  before update on public.members
  for each row execute function public.tg_guard_member();

drop trigger if exists members_20_updated_at on public.members;
create trigger members_20_updated_at
  before update on public.members
  for each row execute function public.tg_set_updated_at();

drop trigger if exists clients_20_updated_at on public.clients;
create trigger clients_20_updated_at
  before update on public.clients
  for each row execute function public.tg_set_updated_at();

drop trigger if exists projects_20_updated_at on public.projects;
create trigger projects_20_updated_at
  before update on public.projects
  for each row execute function public.tg_set_updated_at();

drop trigger if exists client_contacts_10_client_scope on public.client_contacts;
create trigger client_contacts_10_client_scope
  before insert or update on public.client_contacts
  for each row execute function public.tg_enforce_client_scope();

drop trigger if exists client_contacts_20_updated_at on public.client_contacts;
create trigger client_contacts_20_updated_at
  before update on public.client_contacts
  for each row execute function public.tg_set_updated_at();

drop trigger if exists project_members_10_project_scope on public.project_members;
create trigger project_members_10_project_scope
  before insert or update on public.project_members
  for each row execute function public.tg_enforce_project_member_scope();

-- Fonctions de trigger : jamais appelables directement.
revoke all on function public.tg_enforce_client_scope()         from public, anon, authenticated;
revoke all on function public.tg_enforce_project_member_scope() from public, anon, authenticated;
revoke all on function public.tg_guard_member()                 from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Liaison compte auth ↔ membre : jamais un membre retiré
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null and new.email <> '' then
    update public.members
    set user_id = new.id
    where lower(email) = lower(new.email)
      and user_id is null
      and removed_at is null;
  end if;
  return new;
exception when others then
  raise warning 'handle_new_auth_user: liaison membre impossible pour %: %', new.id, sqlerrm;
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

-- Lie les membres actifs non liés portant l'email (confirmé) du JWT, puis renvoie les lignes
-- members ACTIVES de l'utilisateur : un membre retiré reçoit une liste vide (« accès non autorisé »).
create or replace function public.claim_membership()
returns setof public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text := nullif(auth.jwt() ->> 'email', '');
begin
  if v_uid is null then
    raise exception 'Non authentifié' using errcode = '42501';
  end if;

  if v_email is not null and exists (
    select 1 from auth.users u
    where u.id = v_uid
      and lower(u.email) = lower(v_email)
      and u.email_confirmed_at is not null
  ) then
    update public.members m
    set user_id = v_uid
    where lower(m.email) = lower(v_email)
      and m.user_id is null
      and m.removed_at is null;
  end if;

  return query
    select m.* from public.members m
    where m.user_id = v_uid
      and m.removed_at is null
    order by m.created_at;
end;
$$;

revoke all on function public.claim_membership() from public, anon;
grant execute on function public.claim_membership() to authenticated;

-- -----------------------------------------------------------------------------
-- RPC : retirer / réintégrer un membre (supabase.rpc('remove_member', { p_member_id }))
-- Appelant : admin actif de l'organisation du membre. Renvoient la ligne members à jour.
-- -----------------------------------------------------------------------------

-- Retrait doux : la ligne reste (historique), removed_at = now(). Ses tâches non terminées
-- passent en « non attribuée », les tâches faites gardent leur auteur. Ses sessions sont
-- supprimées (les refresh tokens partent en cascade) : il ne peut plus renouveler sa session,
-- et la RLS lui ferme déjà toutes les données (private.user_org_ids ignore les membres retirés).
create or replace function public.remove_member(p_member_id uuid)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_member public.members;
begin
  if v_uid is null then
    raise exception 'Non authentifié' using errcode = '42501';
  end if;

  select m.* into v_member
  from public.members m
  where m.id = p_member_id
  for update;

  -- Même message si le membre n'existe pas ou appartient à une autre organisation.
  if v_member.id is null or not private.is_org_admin(v_member.organization_id) then
    raise exception 'Réservé aux admins de l''organisation' using errcode = '42501';
  end if;

  if v_member.user_id = v_uid then
    raise exception 'Tu ne peux pas te retirer toi-même de l''organisation' using errcode = 'P0001';
  end if;

  if v_member.removed_at is not null then
    return v_member; -- déjà retiré : rien à refaire
  end if;

  -- Le trigger members_10_guard refuse le retrait du dernier admin actif.
  update public.members m
  set removed_at = now()
  where m.id = p_member_id
  returning m.* into v_member;

  update public.tasks t
  set assignee_member_id = null
  where t.assignee_member_id = p_member_id
    and t.status <> 'done';

  -- auth.sessions n'existe que sur Supabase (absente des tests PGlite si non simulée).
  if v_member.user_id is not null and to_regclass('auth.sessions') is not null then
    begin
      execute 'delete from auth.sessions where user_id = $1' using v_member.user_id;
    exception when insufficient_privilege or undefined_table then
      raise warning 'remove_member: sessions de % non révoquées : %', v_member.user_id, sqlerrm;
    end;
  end if;

  return v_member;
end;
$$;

-- Réintégration : removed_at = null. Le membre retrouve l'accès à sa prochaine connexion
-- (ses tâches retirées ne lui sont pas réattribuées).
create or replace function public.restore_member(p_member_id uuid)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_member public.members;
begin
  if v_uid is null then
    raise exception 'Non authentifié' using errcode = '42501';
  end if;

  select m.* into v_member
  from public.members m
  where m.id = p_member_id
  for update;

  if v_member.id is null or not private.is_org_admin(v_member.organization_id) then
    raise exception 'Réservé aux admins de l''organisation' using errcode = '42501';
  end if;

  if v_member.removed_at is null then
    return v_member; -- déjà actif
  end if;

  update public.members m
  set removed_at = null
  where m.id = p_member_id
  returning m.* into v_member;

  return v_member;
end;
$$;

revoke all on function public.remove_member(uuid)  from public, anon;
revoke all on function public.restore_member(uuid) from public, anon;
grant execute on function public.remove_member(uuid)  to authenticated, service_role;
grant execute on function public.restore_member(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Droits (rien pour anon)
-- -----------------------------------------------------------------------------

alter table public.client_contacts enable row level security;
alter table public.project_members enable row level security;

-- organizations, members : modification par colonne seulement (revoke puis grant : rejouable).
revoke update on public.organizations from authenticated;
grant update (name, legal_name, legal_form, siret, address_street, address_postal_code, address_city,
              address_country, vat_mention, default_daily_rate, default_hourly_rate)
  on public.organizations to authenticated;

-- Pas d'insert ni de delete côté client : l'invitation passe par /api (service_role),
-- le retrait par la RPC remove_member.
revoke insert, update, delete on public.members from authenticated;
grant update (name, role, skills, weekly_capacity_hours, unavailable_weekdays)
  on public.members to authenticated;

revoke all on public.client_contacts, public.project_members from public, anon, authenticated;
grant select, insert, update, delete on public.client_contacts to authenticated;
grant select, insert, delete         on public.project_members to authenticated;
grant all on public.client_contacts, public.project_members to service_role;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

-- organizations : paramètres modifiables par les admins actifs seulement.
drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations
  for update to authenticated
  using (id in (select private.user_admin_org_ids()))
  with check (id in (select private.user_admin_org_ids()));

-- members : modification par les admins actifs seulement (insertion par /api en service_role).
drop policy if exists members_update on public.members;
create policy members_update on public.members
  for update to authenticated
  using (organization_id in (select private.user_admin_org_ids()))
  with check (organization_id in (select private.user_admin_org_ids()));

-- clients : lecture par l'organisation (inchangée), écriture par admin et membre.
drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients
  for insert to authenticated
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients
  for update to authenticated
  using (organization_id in (select private.user_writer_org_ids()))
  with check (organization_id in (select private.user_writer_org_ids()));

-- client_contacts
drop policy if exists client_contacts_select on public.client_contacts;
create policy client_contacts_select on public.client_contacts
  for select to authenticated
  using (organization_id in (select private.user_org_ids()));

drop policy if exists client_contacts_insert on public.client_contacts;
create policy client_contacts_insert on public.client_contacts
  for insert to authenticated
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists client_contacts_update on public.client_contacts;
create policy client_contacts_update on public.client_contacts
  for update to authenticated
  using (organization_id in (select private.user_writer_org_ids()))
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists client_contacts_delete on public.client_contacts;
create policy client_contacts_delete on public.client_contacts
  for delete to authenticated
  using (organization_id in (select private.user_writer_org_ids()));

-- projects : lecture par l'organisation (inchangée), écriture par admin et membre.
drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert to authenticated
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update to authenticated
  using (organization_id in (select private.user_writer_org_ids()))
  with check (organization_id in (select private.user_writer_org_ids()));

-- project_members
drop policy if exists project_members_select on public.project_members;
create policy project_members_select on public.project_members
  for select to authenticated
  using (organization_id in (select private.user_org_ids()));

drop policy if exists project_members_insert on public.project_members;
create policy project_members_insert on public.project_members
  for insert to authenticated
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists project_members_delete on public.project_members;
create policy project_members_delete on public.project_members
  for delete to authenticated
  using (organization_id in (select private.user_writer_org_ids()));
