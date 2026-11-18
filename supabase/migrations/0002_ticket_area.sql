-- Partie du produit concernée par un ticket (« Finance », « Juridique »…) et raison de l'attribution.
-- Sert à attribuer un ticket à la personne la moins chargée, avec un bonus pour celle qui a déjà
-- travaillé sur la même partie du projet. Ajout de colonnes facultatives : aucune donnée existante touchée.
alter table public.tickets add column if not exists area text;
alter table public.tickets add column if not exists assignment_note text;

create index if not exists tickets_project_area_idx on public.tickets (project_id, lower(area));
