-- Lot 2 point 9 : mesure honnête du gaspillage, avant / après. Idempotente.
-- Période d'observation (2 semaines où le boulanger produit comme d'habitude
-- et note ce qu'il enfourne) et réponses « avant À Point » (production d'un
-- samedi normal, reste habituel le soir, dons / Too Good To Go).
alter table parametres_commercant add column if not exists observation_debut date;
alter table parametres_commercant add column if not exists reference_avant jsonb;
-- « Épuisé avant la fermeture » (rupture), facultatif, sur la Fournée.
alter table fournees add column if not exists epuise boolean not null default false;
