-- =============================================================================
-- Sordulo OS : 0007_project_ai_instructions
-- Mémoire de l'IA par projet : consignes de l'équipe (qui fait quelles pages, façon de
-- regrouper ou de rédiger les tickets). Complétée par l'IA après chaque « note à l'IA » de
-- l'écran de validation, modifiable à la main dans le formulaire du projet, et lue par
-- chaque nouvelle analyse (rédaction et attribution des tickets).
--
-- Rejouable. Colonne facultative : aucune donnée existante n'est modifiée. Écriture par
-- admin et membre comme le reste du projet (politiques de 0003, droits par table de 0001).
-- Pas de BEGIN/COMMIT : scripts/db-migrate.mjs exécute chaque fichier dans sa transaction.
-- =============================================================================

alter table public.projects add column if not exists ai_instructions text;

alter table public.projects drop constraint if exists projects_ai_instructions_length;
alter table public.projects add constraint projects_ai_instructions_length
  check (ai_instructions is null or char_length(ai_instructions) <= 4000);
