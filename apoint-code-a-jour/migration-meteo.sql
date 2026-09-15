-- À exécuter une seule fois dans Supabase : Project "anti-gaspi" > SQL Editor > New query > coller > Run.
-- Ajoute les coordonnées géographiques (latitude/longitude), déduites une
-- seule fois et automatiquement du code postal déjà connu, pour interroger
-- une API météo gratuite (Open-Meteo, sans clé) sans jamais rien demander de
-- plus au commerçant. Mises en cache ici pour ne géocoder qu'une seule fois
-- par commerçant plutôt qu'à chaque chargement de page.

alter table parametres_commercant
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;
