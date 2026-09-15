-- À exécuter une seule fois dans Supabase : Project "anti-gaspi" > SQL Editor > New query > coller > Run.
-- Suite de migration-parametres.sql (qui doit avoir été exécutée avant celle-ci).
-- Ajoute deux nouveaux réglages à la table parametres_commercant, gérés
-- depuis la nouvelle page "Paramètres" du site :
--   - nom_restaurant : affiché sur le tableau de bord.
--   - jours_fermeture : jours de la semaine où le commerce est habituellement
--     fermé, au format JS Date.getDay() (0 = dimanche, 1 = lundi, ... 6 =
--     samedi), pour ne jamais recommander de production un jour de fermeture
--     et ne pas fausser le calcul de fiabilité avec des jours sans vente
--     attendue.

alter table parametres_commercant
  add column if not exists nom_restaurant text,
  add column if not exists jours_fermeture integer[] not null default '{}';
