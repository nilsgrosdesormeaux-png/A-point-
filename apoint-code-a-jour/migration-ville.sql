-- À exécuter une seule fois dans Supabase : Project "anti-gaspi" > SQL Editor > New query > coller > Run.
-- Ajoute le nom de la ville, renseigné librement par le commerçant en plus du
-- code postal. Un même code postal peut couvrir plusieurs communes voisines
-- (ex : 35000 recouvre Rennes mais aussi Saint-Grégoire et Cesson-Sévigné) ;
-- sans ce nom, la météo prenait par défaut la première commune renvoyée par
-- l'API de géocodage, ce qui pouvait correspondre à la commune d'à côté plutôt
-- qu'à celle du commerçant. Colonne facultative (peut rester vide).

alter table parametres_commercant
  add column if not exists ville text;
