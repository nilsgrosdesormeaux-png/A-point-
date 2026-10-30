-- Branchement caisse v2 (à exécuter après migration-connecteurs-caisse.sql).
-- Idempotente. Ajoute Zettle, Square et Hiboutik, l'historique de 12 mois
-- au branchement, la reprise en continu (plusieurs passages en parallèle
-- sans traiter deux fois la même caisse) et l'import guidé d'un historique
-- de fichier par le commerçant lui-même.

-- 1. Nouvelles caisses.
alter table connexions_caisse drop constraint if exists connexions_caisse_fournisseur_check;
alter table connexions_caisse add constraint connexions_caisse_fournisseur_check
  check (fournisseur in ('sumup', 'zettle', 'square', 'hiboutik', 'export_email'));

-- 2. Suivi de l'import de l'historique et de la reprise.
alter table connexions_caisse add column if not exists debut_historique date;     -- premier jour à importer (12 mois avant le branchement)
alter table connexions_caisse add column if not exists reessayer_apres timestamptz; -- pause après une erreur
alter table connexions_caisse add column if not exists verrou_jusqua timestamptz;   -- un passage de synchro travaille dessus

-- 3. Réserve jusqu'à p_limite connexions à synchroniser : en retard d'au
--    moins un jour, sans pause d'erreur en cours, pas déjà prises par un
--    autre passage. Le verrou expire seul (passage coupé = repris plus tard).
create or replace function prendre_connexions_caisse(p_hier date, p_limite integer)
returns setof connexions_caisse
language sql
set search_path = public, pg_catalog
as $$
  update connexions_caisse c
  set verrou_jusqua = now() + interval '3 minutes'
  from (
    select commercant_id, fournisseur
    from connexions_caisse
    where fournisseur <> 'export_email'
      and (derniere_date_synchronisee is null or derniere_date_synchronisee < p_hier)
      and (reessayer_apres is null or reessayer_apres < now())
      and (verrou_jusqua is null or verrou_jusqua < now())
    order by derniere_date_synchronisee nulls first
    limit p_limite
    for update skip locked
  ) a
  where c.commercant_id = a.commercant_id and c.fournisseur = a.fournisseur
  returning c.*
$$;

revoke execute on function prendre_connexions_caisse(date, integer) from public, anon, authenticated;
grant execute on function prendre_connexions_caisse(date, integer) to service_role;

-- 4. Import guidé de l'historique depuis un fichier (Paramètres) : le
--    commerçant connecté envoie ses ventes par paquets, toujours pour
--    lui-même (auth.uid()), avec le même dédoublonnage que la caisse.
create or replace function importer_historique_ventes(p_lignes jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if auth.uid() is null then
    raise exception 'Non authentifie';
  end if;
  if jsonb_array_length(p_lignes) > 5000 then
    raise exception 'Paquet trop gros (5000 lignes maximum)';
  end if;
  return enregistrer_ventes_caisse(auth.uid(), p_lignes, 'import_fichier');
end;
$$;

revoke execute on function importer_historique_ventes(jsonb) from public, anon;
grant execute on function importer_historique_ventes(jsonb) to authenticated;

-- 5. Synchro en continu : un passage par minute. Chaque passage ne fait
--    rien s'il n'y a rien à rattraper ; sinon il avance l'historique des
--    caisses branchées (12 mois en quelques heures) puis, chaque nuit après
--    minuit, la journée de la veille.
--    (Remplace la tâche nocturne de la v1.)
--
-- select cron.unschedule('synchro-caisse-nocturne');
-- select cron.schedule(
--   'synchro-caisse',
--   '* * * * *',
--   $$
--   select net.http_post(
--     url := 'https://eqvbksxfwlgbcxgqljqn.supabase.co/functions/v1/synchro-caisse',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-cle-synchro', (select decrypted_secret from vault.decrypted_secrets where name = 'cle_synchro_caisse')
--     ),
--     body := '{}'::jsonb,
--     timeout_milliseconds := 150000
--   );
--   $$
-- );
