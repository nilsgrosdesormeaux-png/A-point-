-- La table "produits" n'avait que des policies RLS INSERT et SELECT :
-- modifier ou supprimer un produit depuis "Mes produits" ne provoquait
-- aucune erreur (la requête "réussissait") mais ne touchait 0 ligne, donc
-- rien ne se passait jamais réellement en base.
--
-- Déjà appliqué directement sur le projet Supabase "anti-gaspi" le 15 sept
-- 2026 ; ce fichier sert uniquement de trace dans l'historique du dépôt,
-- comme les autres migration-*.sql.

create policy "Un commercant peut modifier ses produits"
  on public.produits
  for update
  using (auth.uid() = commercant_id)
  with check (auth.uid() = commercant_id);

create policy "Un commercant peut supprimer ses produits"
  on public.produits
  for delete
  using (auth.uid() = commercant_id);
