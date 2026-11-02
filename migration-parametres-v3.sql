-- Lot 12 (nov. 2026) : fermetures choisies par le boulanger.
-- Idempotente, à appliquer à la main dans Supabase (SQL Editor). Tant qu'elle
-- n'est pas passée, l'application garde ces réglages sur l'appareil et dans
-- le compte, et la prévision fonctionne sans eux.
--   conges : [{ "debut": "AAAA-MM-JJ", "fin": "AAAA-MM-JJ" }] (jours fermés inclus)
--   feries_fermes : ["1-mai", "noel", …] (clés MP.CLES_FERIES ; absent = ouvert)
--   periodes_exceptionnelles : [{ "debut", "fin", "libelle" }] (travaux, neige…)
alter table parametres_commercant add column if not exists conges jsonb not null default '[]'::jsonb;
alter table parametres_commercant add column if not exists feries_fermes jsonb not null default '[]'::jsonb;
alter table parametres_commercant add column if not exists periodes_exceptionnelles jsonb not null default '[]'::jsonb;
