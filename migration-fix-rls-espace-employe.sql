-- Correctif RLS espace employé — 23 septembre 2026.
--
-- Bug trouvé en pilote : espace-employe.html affichait toujours le sous-titre
-- générique et jamais la météo du jour, malgré un déploiement à jour. Cause
-- réelle : parametres_commercant n'avait qu'une policy de lecture pour le
-- commerçant lui-même (auth.uid() = commercant_id), aucune pour un employé.
-- La requête de la page employé revenait donc silencieusement vide.
--
-- Ce correctif a été appliqué directement dans l'éditeur SQL Supabase le
-- 23 septembre 2026 et vérifié en base à l'époque, mais n'avait jamais été
-- capturé dans une migration versionnée avec le reste du dépôt — cet écart
-- est comblé ici. Idempotent (drop if exists) : peut être rejoué sans risque
-- sur un projet où la policy existe déjà.
drop policy if exists "personnel_lecture_parametres_commercant" on public.parametres_commercant;
create policy "personnel_lecture_parametres_commercant" on public.parametres_commercant
  for select using (
    auth.uid() in (select user_id from public.personnel where personnel.commercant_id = parametres_commercant.commercant_id and personnel.user_id is not null)
  );
