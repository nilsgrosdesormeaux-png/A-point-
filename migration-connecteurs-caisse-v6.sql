-- Branchement caisse v6 (après v5). Idempotente : peut être relancée.
--  1. Lightspeed Retail (X-Series) en jeton personnel.
--  2. Photo du rapport de caisse : source « photo », plafond de lectures
--     par jour, enregistrement par le commerçant lui-même ; rapports lus
--     par l'IA dans un e-mail, « à confirmer » avant d'entrer dans les ventes.
--  3. Ventes heure par heure (alerte rupture) : table ventes_horaires,
--     remplie par les caisses branchées, synchro dans la journée.

-- 1. Caisses autorisées.
alter table connexions_caisse drop constraint if exists connexions_caisse_fournisseur_check;
alter table connexions_caisse add constraint connexions_caisse_fournisseur_check
  check (fournisseur in ('sumup', 'zettle', 'square', 'hiboutik', 'loyverse', 'tactill', 'zelty', 'popina',
                         'lightspeed_retail', 'export_email'));

-- 2a. Journal : nouvelle source « photo ».
alter table journal_caisse drop constraint if exists journal_caisse_source_check;
alter table journal_caisse add constraint journal_caisse_source_check
  check (source in ('api', 'email', 'fichier', 'branchement', 'photo'));

-- 2b. Chaque lecture de photo (coût et plafond). Écrite par l'Edge Function
--     lire-ticket (service role) ; le commerçant voit les siennes.
create table if not exists lectures_ticket (
  id bigint generated always as identity primary key,
  commercant_id uuid not null references auth.users(id) on delete cascade,
  cree_le timestamptz not null default now(),
  nb_photos integer not null,
  jetons_entree integer not null default 0,
  jetons_sortie integer not null default 0,
  cout_estime_usd numeric(10, 5) not null default 0,
  date_rapport date,
  empreinte text                              -- même ticket relu deux fois
);
create index if not exists lectures_ticket_commercant_date on lectures_ticket (commercant_id, cree_le desc);
alter table lectures_ticket enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'lectures_ticket' and policyname = 'Un commercant lit ses lectures de ticket') then
    create policy "Un commercant lit ses lectures de ticket" on lectures_ticket
      for select to authenticated using (auth.uid() = commercant_id);
  end if;
end $$;
revoke insert, update, delete, truncate, references, trigger on lectures_ticket from public, anon, authenticated;
grant select on lectures_ticket to authenticated;
grant all on lectures_ticket to service_role;

-- 2c. Enregistrement d'un rapport photographié, toujours pour le commerçant
--     connecté, avec le même dédoublonnage que la caisse (source « photo »)
--     et une ligne de journal.
create or replace function enregistrer_ventes_photo(p_jour date, p_lignes jsonb, p_detail text)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  nb integer;
  lignes jsonb;
begin
  if auth.uid() is null then
    raise exception 'Non authentifie';
  end if;
  if p_jour is null or p_jour > (now() at time zone 'Europe/Paris')::date or p_jour < (now() at time zone 'Europe/Paris')::date - 400 then
    raise exception 'Date du rapport invalide';
  end if;
  if jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 or jsonb_array_length(p_lignes) > 500 then
    raise exception 'Entre 1 et 500 lignes';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('nom_produit', l->>'nom_produit', 'quantite', (l->>'quantite')::numeric, 'date_vente', p_jour)), '[]'::jsonb)
    into lignes
  from jsonb_array_elements(p_lignes) l
  where coalesce(btrim(l->>'nom_produit'), '') <> '' and (l->>'quantite') ~ '^-?[0-9]+(\.[0-9]+)?$';
  nb := enregistrer_ventes_caisse(auth.uid(), lignes, 'photo');
  insert into journal_caisse (commercant_id, source, fournisseur, nb_ventes, du, au, detail)
  values (auth.uid(), 'photo', null, nb, p_jour, p_jour, left(coalesce(p_detail, 'Photo du rapport de caisse'), 200));
  return nb;
end;
$$;
revoke execute on function enregistrer_ventes_photo(date, jsonb, text) from public, anon;
grant execute on function enregistrer_ventes_photo(date, jsonb, text) to authenticated;

-- 2d. Rapports « à confirmer » : photo, PDF ou texte reçus par e-mail,
--     lus par l'IA. Rien n'entre dans `ventes` avant que le boulanger ait
--     corrigé et confirmé (page Ma caisse). Écrits par import-export-caisse
--     (service role) ; le commerçant voit les siens et les traite par les
--     deux fonctions ci-dessous.
create table if not exists rapports_a_confirmer (
  id bigint generated always as identity primary key,
  commercant_id uuid not null references auth.users(id) on delete cascade,
  cree_le timestamptz not null default now(),
  source text not null default 'email' check (source in ('email')),
  statut text not null default 'a_confirmer' check (statut in ('a_confirmer', 'confirme', 'rejete')),
  jour date,
  lignes jsonb not null default '[]'::jsonb,
  remarques text,
  detail text
);
create index if not exists rapports_a_confirmer_commercant on rapports_a_confirmer (commercant_id, statut, cree_le desc);
alter table rapports_a_confirmer enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'rapports_a_confirmer' and policyname = 'Un commercant lit ses rapports a confirmer') then
    create policy "Un commercant lit ses rapports a confirmer" on rapports_a_confirmer
      for select to authenticated using (auth.uid() = commercant_id);
  end if;
end $$;
revoke insert, update, delete, truncate, references, trigger on rapports_a_confirmer from public, anon, authenticated;
grant select on rapports_a_confirmer to authenticated;
grant all on rapports_a_confirmer to service_role;

-- Confirme un rapport (jour et lignes éventuellement corrigés par le
-- boulanger) : mêmes contrôles et même dédoublonnage que la photo, source
-- « export_email », une ligne de journal.
create or replace function confirmer_rapport(p_id bigint, p_jour date, p_lignes jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  nb integer;
  lignes jsonb;
begin
  if auth.uid() is null then
    raise exception 'Non authentifie';
  end if;
  if not exists (select 1 from rapports_a_confirmer where id = p_id and commercant_id = auth.uid() and statut = 'a_confirmer') then
    raise exception 'Rapport introuvable ou déjà traité';
  end if;
  if p_jour is null or p_jour > (now() at time zone 'Europe/Paris')::date or p_jour < (now() at time zone 'Europe/Paris')::date - 400 then
    raise exception 'Date du rapport invalide';
  end if;
  if jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 or jsonb_array_length(p_lignes) > 500 then
    raise exception 'Entre 1 et 500 lignes';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('nom_produit', l->>'nom_produit', 'quantite', (l->>'quantite')::numeric, 'date_vente', p_jour)), '[]'::jsonb)
    into lignes
  from jsonb_array_elements(p_lignes) l
  where coalesce(btrim(l->>'nom_produit'), '') <> '' and (l->>'quantite') ~ '^-?[0-9]+(\.[0-9]+)?$';
  nb := enregistrer_ventes_caisse(auth.uid(), lignes, 'export_email');
  update rapports_a_confirmer set statut = 'confirme', jour = p_jour, lignes = p_lignes where id = p_id;
  insert into journal_caisse (commercant_id, source, fournisseur, nb_ventes, du, au, detail)
  values (auth.uid(), 'email', 'export_email', nb, p_jour, p_jour, 'Rapport confirmé par toi');
  return nb;
end;
$$;
revoke execute on function confirmer_rapport(bigint, date, jsonb) from public, anon;
grant execute on function confirmer_rapport(bigint, date, jsonb) to authenticated;

create or replace function rejeter_rapport(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if auth.uid() is null then
    raise exception 'Non authentifie';
  end if;
  update rapports_a_confirmer set statut = 'rejete' where id = p_id and commercant_id = auth.uid() and statut = 'a_confirmer';
end;
$$;
revoke execute on function rejeter_rapport(bigint) from public, anon;
grant execute on function rejeter_rapport(bigint) to authenticated;

-- 3a. Ventes heure par heure. heure = 0 à 23 (ventes de h:00 à h:59, heure
--     de Paris). nom_produit : même nom que dans ventes (nom du produit
--     connu, retrouvé par normaliser_nom_produit). Rempli seulement par les
--     caisses branchées : ni le fichier ni la photo n'y écrivent.
create table if not exists ventes_horaires (
  commercant_id uuid not null references auth.users(id) on delete cascade,
  date_vente date not null,
  heure smallint not null check (heure between 0 and 23),
  nom_produit text not null,
  quantite numeric not null,
  constraint ventes_horaires_unique unique (commercant_id, date_vente, heure, nom_produit)
);
alter table ventes_horaires enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ventes_horaires' and policyname = 'Un commercant lit ses ventes horaires') then
    create policy "Un commercant lit ses ventes horaires" on ventes_horaires
      for select to authenticated using (auth.uid() = commercant_id);
  end if;
end $$;
revoke insert, update, delete, truncate, references, trigger on ventes_horaires from public, anon, authenticated;
grant select on ventes_horaires to authenticated;
grant all on ventes_horaires to service_role;

-- Jusqu'où les heures du jour sont définitives (synchro dans la journée).
alter table connexions_caisse add column if not exists horaire_jusqua timestamptz;

-- 3b. Remplace les heures >= p_heure_min du jour p_jour par p_lignes
--     ([{nom_produit, heure, quantite}]) : relancer ne double jamais.
create or replace function enregistrer_ventes_horaires(p_commercant uuid, p_jour date, p_heure_min integer, p_lignes jsonb)
returns integer
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  nb integer;
begin
  delete from ventes_horaires
  where commercant_id = p_commercant and date_vente = p_jour and heure >= p_heure_min;
  insert into ventes_horaires (commercant_id, date_vente, heure, nom_produit, quantite)
  select p_commercant, p_jour, a.heure, coalesce(p.nom, a.nom), a.quantite
  from (
    select normaliser_nom_produit(l->>'nom_produit') as cle, min(btrim(l->>'nom_produit')) as nom,
           (l->>'heure')::smallint as heure, sum((l->>'quantite')::numeric) as quantite
    from jsonb_array_elements(p_lignes) l
    where coalesce(btrim(l->>'nom_produit'), '') <> '' and (l->>'heure')::int between p_heure_min and 23
    group by 1, 3
  ) a
  left join lateral (
    select pr.nom from produits pr
    where pr.commercant_id = p_commercant and normaliser_nom_produit(pr.nom) = a.cle
    order by pr.id limit 1
  ) p on true;
  get diagnostics nb = row_count;
  return nb;
end;
$$;
revoke execute on function enregistrer_ventes_horaires(uuid, date, integer, jsonb) from public, anon, authenticated;
grant execute on function enregistrer_ventes_horaires(uuid, date, integer, jsonb) to service_role;

-- 3c. Synchro dans la journée : toutes les heures, l'Edge Function
--     synchro-caisse en mode « journee » lit seulement les ventes du jour
--     depuis la dernière heure close (horaire_jusqua), caisse par caisse,
--     et ne fait rien hors de 6 h - 20 h à Paris. pg_cron compte en UTC :
--     on l'appelle de 4 h à 19 h UTC (couvre l'heure d'été et d'hiver).
--     La synchro de nuit (« synchro-caisse », chaque minute, v2) reste
--     inchangée pour la veille et l'historique.
-- select cron.schedule(
--   'synchro-caisse-journee',
--   '7 4-19 * * *',
--   $$
--   select net.http_post(
--     url := 'https://eqvbksxfwlgbcxgqljqn.supabase.co/functions/v1/synchro-caisse',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-cle-synchro', (select decrypted_secret from vault.decrypted_secrets where name = 'cle_synchro_caisse')
--     ),
--     body := '{"mode": "journee"}'::jsonb,
--     timeout_milliseconds := 150000
--   );
--   $$
-- );
