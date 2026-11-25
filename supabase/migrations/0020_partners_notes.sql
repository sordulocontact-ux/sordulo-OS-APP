-- =============================================================================
-- Sordulo OS : 0020_partners_notes
-- Réseau de partenaires et notes rattachées (lot L16).
--   * partners : carnet des freelances, sous-traitants, imprimeurs, développeurs, photographes,
--     apporteurs… (métier, compétences en étiquettes, tarif jour indicatif en centimes, contact,
--     note interne, évaluation 1 à 5, disponibilité, archivage) ;
--   * partner_projects : projets sur lesquels un partenaire a travaillé (rôle et montant facultatifs) ;
--   * notes : notes libres en Markdown léger, rattachables à un projet et / ou un client, visibilité
--     « perso » (l'auteur seul) ou « équipe », épinglage.
-- Miroir de src/shared/types.ts (Partner, PartnerProject, Note, PARTNER_CATEGORIES, NOTE_VISIBILITIES).
--
-- Droits :
--   partners, partner_projects : lecture admin, membre, finance ; écriture admin, membre. L'apporteur
--   (prospection) n'y a pas accès. Les tarifs ne sont pas des prix clients : le membre les voit.
--   notes : « perso » = l'auteur seul (quel que soit son rôle, admins compris) ; « équipe » = lue par
--   admin, membre, finance de l'organisation, modifiée et supprimée par l'auteur et les admins.
--   L'apporteur n'écrit que des notes perso, sans projet ni client (il ne lit ni l'un ni l'autre).
--   author_id est posé par la base (membre connecté), jamais par le front.
--
-- Rejouable : if not exists / create or replace / drop ... if exists.
-- Nouvelles tables : aucune donnée existante n'est modifiée.
-- Pas de BEGIN/COMMIT : scripts/db-migrate.mjs exécute chaque fichier dans sa transaction.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.partners (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null check (btrim(name) <> '' and char_length(name) <= 200),
  company         text check (company is null or char_length(company) <= 200),
  category        text not null default 'freelance'
                    check (category in ('freelance', 'subcontractor', 'developer', 'designer', 'photographer',
                                        'videographer', 'copywriter', 'printer', 'referrer', 'other')),
  -- Étiquettes de compétences (nettoyées par la base : sans espaces autour, sans vide ni doublon).
  skills          text[] not null default '{}',
  -- Tarif jour indicatif HT, en centimes (pas un prix client).
  day_rate_cents  integer check (day_rate_cents is null or day_rate_cents between 0 and 100000000),
  email           text check (email is null or (char_length(email) <= 320 and email ~ '^[^@[:space:]]+@[^@[:space:]]+$')),
  phone           text check (phone is null or char_length(phone) <= 40),
  -- Site ou portfolio : http(s) seulement (affiché comme lien).
  website         text check (website is null or (char_length(website) <= 500 and website ~* '^https?://')),
  city            text check (city is null or char_length(city) <= 120),
  -- Note interne (texte libre).
  notes           text check (notes is null or char_length(notes) <= 20000),
  rating          smallint check (rating is null or rating between 1 and 5),
  availability    text check (availability is null or char_length(availability) <= 200),
  archived_at     timestamptz,
  created_by      uuid references public.members (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.partner_projects (
  id              uuid primary key default gen_random_uuid(),
  -- Copiée du partenaire (trigger).
  organization_id uuid not null references public.organizations (id) on delete cascade,
  partner_id      uuid not null references public.partners (id) on delete cascade,
  project_id      uuid not null references public.projects (id) on delete cascade,
  role            text check (role is null or char_length(role) <= 200),
  -- Montant facturé par le partenaire sur ce projet, en centimes.
  amount_cents    integer check (amount_cents is null or amount_cents between 0 and 1000000000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.notes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Membre connecté à la création (trigger), jamais modifié.
  author_id       uuid not null references public.members (id) on delete cascade,
  project_id      uuid references public.projects (id) on delete set null,
  client_id       uuid references public.clients (id) on delete set null,
  title           text not null default '' check (char_length(title) <= 200),
  -- Markdown léger (titres, listes, gras, italique).
  body            text not null default '' check (char_length(body) <= 100000),
  visibility      text not null default 'personal' check (visibility in ('personal', 'team')),
  pinned          boolean not null default false,
  created_at      timestamptz not null default now(),
  -- Dernière modification du contenu (épingler ne la change pas).
  updated_at      timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Unicité et index
-- -----------------------------------------------------------------------------

create index if not exists partners_org_name_idx              on public.partners (organization_id, name);
create index if not exists partners_created_by_idx            on public.partners (created_by);
create index if not exists partners_skills_idx                on public.partners using gin (skills);

create unique index if not exists partner_projects_pair_key   on public.partner_projects (partner_id, project_id);
create index if not exists partner_projects_project_id_idx    on public.partner_projects (project_id);
create index if not exists partner_projects_org_idx           on public.partner_projects (organization_id);

create index if not exists notes_org_updated_idx              on public.notes (organization_id, updated_at desc);
create index if not exists notes_author_id_idx                on public.notes (author_id);
create index if not exists notes_project_id_idx               on public.notes (project_id);
create index if not exists notes_client_id_idx                on public.notes (client_id);

-- -----------------------------------------------------------------------------
-- Triggers d'intégrité
-- -----------------------------------------------------------------------------

-- partners : étiquettes nettoyées et bornées (30 au plus, 40 caractères chacune), auteur posé par la
-- base, id / auteur / création figés. L'organisation figée est gardée par tg_guard_org_owned.
create or replace function public.tg_partner_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.id         := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  else
    new.created_by := coalesce(private.current_member_id(new.organization_id), new.created_by);
    if new.created_by is not null and not exists (
      select 1 from public.members m where m.id = new.created_by and m.organization_id = new.organization_id
    ) then
      raise exception 'created_by n''est pas membre de l''organisation du partenaire' using errcode = '23514';
    end if;
  end if;

  -- Ordre de saisie gardé, doublons retirés sans tenir compte de la casse.
  select coalesce(array_agg(s.tag order by s.first_pos), '{}')
    into new.skills
  from (
    select min(t.pos) as first_pos, (array_agg(t.tag order by t.pos))[1] as tag
    from (
      select btrim(u.tag) as tag, u.pos
      from unnest(coalesce(new.skills, '{}')) with ordinality as u (tag, pos)
    ) t
    where t.tag is not null and t.tag <> ''
    group by lower(t.tag)
  ) s;

  if cardinality(new.skills) > 30 then
    raise exception 'Un partenaire a 30 compétences au plus' using errcode = '23514';
  end if;
  if exists (select 1 from unnest(new.skills) as t (tag) where char_length(t.tag) > 40) then
    raise exception 'Une compétence fait 40 caractères au plus' using errcode = '23514';
  end if;

  return new;
end;
$$;

-- partner_projects : organisation du partenaire, projet de la même organisation ; partenaire et
-- projet figés après création (seuls rôle et montant changent).
create or replace function public.tg_partner_project_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.id              := old.id;
    new.organization_id := old.organization_id;
    new.partner_id      := old.partner_id;
    new.project_id      := old.project_id;
    new.created_at      := old.created_at;
    return new;
  end if;

  select p.organization_id into new.organization_id from public.partners p where p.id = new.partner_id;
  if new.organization_id is null then
    raise exception 'Partenaire introuvable' using errcode = '23503';
  end if;

  if not exists (
    select 1 from public.projects p where p.id = new.project_id and p.organization_id = new.organization_id
  ) then
    raise exception 'Le projet n''appartient pas à l''organisation du partenaire' using errcode = '23514';
  end if;

  return new;
end;
$$;

-- notes : auteur = membre connecté (le serveur, sans compte, peut le fournir), id / organisation /
-- auteur / création figés ; projet et client de la même organisation, et seulement pour un rôle qui
-- les lit (admin, membre, finance) ; updated_at suit le contenu, pas l'épinglage.
create or replace function public.tg_note_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id then
      raise exception 'notes.organization_id ne peut pas être modifié' using errcode = '42501';
    end if;
    new.id         := old.id;
    new.author_id  := old.author_id;
    new.created_at := old.created_at;
    if (new.title, new.body, new.visibility, new.project_id, new.client_id)
       is distinct from (old.title, old.body, old.visibility, old.project_id, old.client_id) then
      new.updated_at := now();
    else
      new.updated_at := old.updated_at;
    end if;
  else
    if v_uid is not null then
      new.author_id := private.current_member_id(new.organization_id);
      if new.author_id is null then
        raise exception 'Tu n''es pas membre de cette organisation' using errcode = '42501';
      end if;
    elsif new.author_id is null or not exists (
      select 1 from public.members m where m.id = new.author_id and m.organization_id = new.organization_id
    ) then
      raise exception 'author_id doit être un membre de l''organisation de la note' using errcode = '23514';
    end if;
    new.created_at := now();
    new.updated_at := now();
  end if;

  -- Rattachement : seulement pour un rôle qui lit projets et clients (l'apporteur n'en a pas).
  if (new.project_id is not null and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id))
     or (new.client_id is not null and (tg_op = 'INSERT' or new.client_id is distinct from old.client_id)) then
    if v_uid is not null and new.organization_id not in (select private.user_reader_org_ids()) then
      raise exception 'Tu ne peux pas rattacher une note à un projet ou un client' using errcode = '42501';
    end if;
  end if;

  if new.project_id is not null
     and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id)
     and not exists (
       select 1 from public.projects p where p.id = new.project_id and p.organization_id = new.organization_id
     ) then
    raise exception 'Le projet n''appartient pas à l''organisation de la note' using errcode = '23514';
  end if;

  if new.client_id is not null
     and (tg_op = 'INSERT' or new.client_id is distinct from old.client_id)
     and not exists (
       select 1 from public.clients c where c.id = new.client_id and c.organization_id = new.organization_id
     ) then
    raise exception 'Le client n''appartient pas à l''organisation de la note' using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Les triggers d'une même table s'exécutent par ordre alphabétique de nom.
drop trigger if exists partners_05_org_owned on public.partners;
create trigger partners_05_org_owned
  before insert or update on public.partners
  for each row execute function public.tg_guard_org_owned();

drop trigger if exists partners_10_guard on public.partners;
create trigger partners_10_guard
  before insert or update on public.partners
  for each row execute function public.tg_partner_guard();

drop trigger if exists partners_20_updated_at on public.partners;
create trigger partners_20_updated_at
  before update on public.partners
  for each row execute function public.tg_set_updated_at();

drop trigger if exists partner_projects_10_guard on public.partner_projects;
create trigger partner_projects_10_guard
  before insert or update on public.partner_projects
  for each row execute function public.tg_partner_project_guard();

drop trigger if exists partner_projects_20_updated_at on public.partner_projects;
create trigger partner_projects_20_updated_at
  before update on public.partner_projects
  for each row execute function public.tg_set_updated_at();

-- notes : updated_at est géré par le guard (l'épinglage ne compte pas comme une modification).
drop trigger if exists notes_10_guard on public.notes;
create trigger notes_10_guard
  before insert or update on public.notes
  for each row execute function public.tg_note_guard();

-- Fonctions de trigger : jamais appelables directement.
revoke all on function public.tg_partner_guard()         from public, anon, authenticated, service_role;
revoke all on function public.tg_partner_project_guard() from public, anon, authenticated, service_role;
revoke all on function public.tg_note_guard()            from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Droits (rien pour anon)
-- -----------------------------------------------------------------------------

alter table public.partners         enable row level security;
alter table public.partner_projects enable row level security;
alter table public.notes            enable row level security;

revoke all on public.partners, public.partner_projects, public.notes from public, anon, authenticated;

grant select, delete on public.partners to authenticated;
grant insert (organization_id, name, company, category, skills, day_rate_cents, email, phone, website, city, notes,
              rating, availability, archived_at)
  on public.partners to authenticated;
grant update (name, company, category, skills, day_rate_cents, email, phone, website, city, notes, rating,
              availability, archived_at)
  on public.partners to authenticated;

grant select, delete on public.partner_projects to authenticated;
grant insert (partner_id, project_id, role, amount_cents) on public.partner_projects to authenticated;
grant update (role, amount_cents) on public.partner_projects to authenticated;

grant select, delete on public.notes to authenticated;
grant insert (organization_id, project_id, client_id, title, body, visibility, pinned) on public.notes to authenticated;
grant update (project_id, client_id, title, body, visibility, pinned) on public.notes to authenticated;

grant all on public.partners, public.partner_projects, public.notes to service_role;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

-- partners et partner_projects : lecture admin, membre, finance ; écriture admin, membre.
drop policy if exists partners_select on public.partners;
create policy partners_select on public.partners
  for select to authenticated
  using (organization_id in (select private.user_reader_org_ids()));

drop policy if exists partners_insert on public.partners;
create policy partners_insert on public.partners
  for insert to authenticated
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists partners_update on public.partners;
create policy partners_update on public.partners
  for update to authenticated
  using (organization_id in (select private.user_writer_org_ids()))
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists partners_delete on public.partners;
create policy partners_delete on public.partners
  for delete to authenticated
  using (organization_id in (select private.user_writer_org_ids()));

drop policy if exists partner_projects_select on public.partner_projects;
create policy partner_projects_select on public.partner_projects
  for select to authenticated
  using (organization_id in (select private.user_reader_org_ids()));

drop policy if exists partner_projects_insert on public.partner_projects;
create policy partner_projects_insert on public.partner_projects
  for insert to authenticated
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists partner_projects_update on public.partner_projects;
create policy partner_projects_update on public.partner_projects
  for update to authenticated
  using (organization_id in (select private.user_writer_org_ids()))
  with check (organization_id in (select private.user_writer_org_ids()));

drop policy if exists partner_projects_delete on public.partner_projects;
create policy partner_projects_delete on public.partner_projects
  for delete to authenticated
  using (organization_id in (select private.user_writer_org_ids()));

-- notes : perso = l'auteur seul ; équipe = lue par admin, membre, finance, écrite par l'auteur et les admins.
drop policy if exists notes_select on public.notes;
create policy notes_select on public.notes
  for select to authenticated
  using (
    (visibility = 'personal' and author_id in (select private.user_member_ids()))
    or (visibility = 'team' and organization_id in (select private.user_reader_org_ids()))
  );

-- Création : toujours en son nom ; une note d'équipe ou rattachée demande un rôle qui lit l'équipe.
drop policy if exists notes_insert on public.notes;
create policy notes_insert on public.notes
  for insert to authenticated
  with check (
    author_id in (select private.user_member_ids())
    and (
      (visibility = 'personal' and project_id is null and client_id is null)
      or organization_id in (select private.user_reader_org_ids())
    )
  );

-- Modification : l'auteur (sa note perso, ou sa note d'équipe s'il lit encore l'équipe) ou un admin
-- (notes d'équipe). Seul l'auteur peut rendre une note perso.
drop policy if exists notes_update on public.notes;
create policy notes_update on public.notes
  for update to authenticated
  using (
    (visibility = 'personal' and author_id in (select private.user_member_ids()))
    or (
      visibility = 'team'
      and organization_id in (select private.user_reader_org_ids())
      and (author_id in (select private.user_member_ids()) or organization_id in (select private.user_admin_org_ids()))
    )
  )
  with check (
    (visibility = 'personal' and author_id in (select private.user_member_ids())
      and ((project_id is null and client_id is null) or organization_id in (select private.user_reader_org_ids())))
    or (
      visibility = 'team'
      and organization_id in (select private.user_reader_org_ids())
      and (author_id in (select private.user_member_ids()) or organization_id in (select private.user_admin_org_ids()))
    )
  );

drop policy if exists notes_delete on public.notes;
create policy notes_delete on public.notes
  for delete to authenticated
  using (
    (visibility = 'personal' and author_id in (select private.user_member_ids()))
    or (
      visibility = 'team'
      and organization_id in (select private.user_reader_org_ids())
      and (author_id in (select private.user_member_ids()) or organization_id in (select private.user_admin_org_ids()))
    )
  );
