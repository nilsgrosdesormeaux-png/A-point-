-- Commandes clients (bûches, galettes, pièces montées, mairie, cantine) — 1er nov. 2026.
--
-- Une commande saisie ne disparaît jamais :
--   * aucune policy delete, droit delete retiré, et un trigger refuse toute
--     suppression faite par un utilisateur connecté (on annule : statut = 'annulee') ;
--   * chaque modification recopie l'ancienne version dans commandes_clients_historique.
-- Rôles (vérifiés ici, en base, pas seulement à l'écran) : on étend le
-- mécanisme de migration-espace-employe.sql (personnel.user_id) d'un champ
-- personnel.acces_app :
--   * patron (auth.uid() = commercant_id) et 'associe' (le conjoint) : tout ;
--   * 'vendeuse' : saisit, modifie, annule les commandes ; voit la Fournée
--     (ventes en quantités, fournées) et coche « épuisé » ; aucun accès aux
--     produits (prix), recettes (coûts), caisse, ni paramètres en écriture ;
--   * 'apprenti' : la production seulement (fournées, ventes en quantités,
--     commandes sans nom, téléphone ni euros via commandes_production()),
--     coche « enfourné ». Jamais de prix ni d'euros.
-- Personne ne supprime une commande ; chacun ne voit que sa boulangerie.
--
-- Idempotent (if not exists / drop ... if exists / create or replace).
-- A exécuter dans Supabase > SQL Editor. Non destructif.

create table if not exists public.commandes_clients (
  id uuid primary key default gen_random_uuid(),       -- choisi sur l'appareil (file hors connexion)
  commercant_id uuid not null references auth.users(id) on delete cascade,
  client_nom text not null check (length(btrim(client_nom)) > 0),
  client_telephone text,
  produit text not null check (length(btrim(produit)) > 0),
  quantite integer not null check (quantite > 0 and quantite <= 100000),
  date_retrait date not null,                          -- ponctuelle : le jour ; récurrente : le premier jour
  heure_retrait time,
  acompte_statut text not null default 'aucun' check (acompte_statut in ('aucun', 'encaisse', 'a_encaisser')),
  acompte_montant numeric(10,2) not null default 0 check (acompte_montant >= 0),
  jours_recurrence smallint[],                         -- null : ponctuelle ; {5} : chaque vendredi (0 = dimanche)
  date_fin date,
  dates_sautees date[] not null default '{}',          -- récurrente : « pas cette fois »
  dates_retirees date[] not null default '{}',         -- case « retiré » du comptoir
  statut text not null default 'active' check (statut in ('active', 'annulee', 'refusee')), -- refusee : « complet », pour l'an prochain
  parfum text,                                         -- variantes (commandes_catalogue)
  taille text,
  sauf_vacances boolean not null default false,        -- récurrente : sautée pendant les vacances scolaires
  note text,
  sms_envois jsonb not null default '{}'::jsonb,       -- { "2026-11-06": "2026-11-05T17:00:00Z" } : envoi SMS à venir
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),       -- dernier changement qui touche la production
  maj_le timestamptz not null default now(),           -- dernier changement, quel qu'il soit
  cree_par uuid default auth.uid(),
  maj_par uuid default auth.uid()
);

create index if not exists commandes_clients_commercant_date on public.commandes_clients (commercant_id, date_retrait);

create table if not exists public.commandes_clients_historique (
  id bigint generated always as identity primary key,
  commande_id uuid not null,
  commercant_id uuid not null references auth.users(id) on delete cascade,
  ancienne jsonb not null,
  remplacee_le timestamptz not null default now(),
  remplacee_par uuid
);
create index if not exists commandes_clients_historique_commande on public.commandes_clients_historique (commande_id);

alter table public.commandes_clients enable row level security;
alter table public.commandes_clients_historique enable row level security;

-- Catalogue des variantes (parfums, tailles, prix par taille) : créé une
-- fois, réutilisé d'une année sur l'autre.
create table if not exists public.commandes_catalogue (
  commercant_id uuid not null references auth.users(id) on delete cascade,
  produit text not null,
  parfums text[] not null default '{}',
  tailles text[] not null default '{}',
  prix_tailles jsonb not null default '{}'::jsonb,     -- { "6 parts": 32 }
  prix numeric(10,2),                                  -- prix unitaire sans taille
  maj_le timestamptz not null default now(),
  primary key (commercant_id, produit)
);
alter table public.commandes_catalogue enable row level security;

-- ---------- Rôle dans la boutique ----------
alter table public.personnel add column if not exists acces_app text;
alter table public.personnel drop constraint if exists personnel_acces_app_check;
alter table public.personnel add constraint personnel_acces_app_check check (acces_app is null or acces_app in ('associe', 'vendeuse', 'apprenti'));
-- Première fois : déduit de l'intitulé du poste ; le patron corrige ensuite
-- (page Commandes clients > Qui fait quoi). Sans rôle : aucun accès.
update public.personnel set acces_app = case
    when role ilike '%appren%' then 'apprenti'
    when role ilike '%vend%' or role ilike '%comptoir%' or role ilike '%caiss%' then 'vendeuse'
  end
  where acces_app is null and user_id is not null;

-- 'patron', 'associe', 'vendeuse', 'apprenti' ou null. Security definer :
-- lit personnel sans dépendre de ses policies ; l'employé ne peut pas
-- changer son propre rôle (aucune policy update pour lui sur personnel).
create or replace function public.role_boutique(p_commercant uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when auth.uid() = p_commercant then 'patron' else (
    select acces_app from public.personnel
    where personnel.commercant_id = p_commercant and personnel.user_id = auth.uid() limit 1
  ) end
$$;
revoke all on function public.role_boutique(uuid) from public, anon;
grant execute on function public.role_boutique(uuid) to authenticated;

-- ---------- Commandes : patron, associé, vendeuse ----------
drop policy if exists "commandes_clients_lecture" on public.commandes_clients;
create policy "commandes_clients_lecture" on public.commandes_clients
  for select using (public.role_boutique(commercant_id) in ('patron', 'associe', 'vendeuse'));

drop policy if exists "commandes_clients_saisie" on public.commandes_clients;
create policy "commandes_clients_saisie" on public.commandes_clients
  for insert with check (public.role_boutique(commercant_id) in ('patron', 'associe', 'vendeuse'));

drop policy if exists "commandes_clients_modification" on public.commandes_clients;
create policy "commandes_clients_modification" on public.commandes_clients
  for update using (public.role_boutique(commercant_id) in ('patron', 'associe', 'vendeuse'))
  with check (public.role_boutique(commercant_id) in ('patron', 'associe', 'vendeuse'));

drop policy if exists "commandes_catalogue_lecture" on public.commandes_catalogue;
create policy "commandes_catalogue_lecture" on public.commandes_catalogue
  for select using (public.role_boutique(commercant_id) in ('patron', 'associe', 'vendeuse'));
drop policy if exists "commandes_catalogue_ecriture" on public.commandes_catalogue;
create policy "commandes_catalogue_ecriture" on public.commandes_catalogue
  for all using (public.role_boutique(commercant_id) in ('patron', 'associe'))
  with check (public.role_boutique(commercant_id) in ('patron', 'associe'));

-- Apprenti (et toute la boutique) : ce qu'il faut enfourner, sans nom,
-- téléphone, acompte ni prix.
create or replace function public.commandes_production(p_commercant uuid)
returns table (id uuid, produit text, parfum text, taille text, quantite integer, date_retrait date, heure_retrait time,
  jours_recurrence smallint[], date_fin date, dates_sautees date[], sauf_vacances boolean, statut text)
language sql stable security definer set search_path = public as $$
  select c.id, c.produit, c.parfum, c.taille, c.quantite, c.date_retrait, c.heure_retrait,
    c.jours_recurrence, c.date_fin, c.dates_sautees, c.sauf_vacances, c.statut
  from public.commandes_clients c
  where c.commercant_id = p_commercant and c.statut = 'active' and public.role_boutique(p_commercant) is not null
$$;
revoke all on function public.commandes_production(uuid) from public, anon;
grant execute on function public.commandes_production(uuid) to authenticated;

-- Règle d'acompte réglable (30 % au-dessus de 40 € par défaut). Lue par la
-- vendeuse (policy personnel_lecture_parametres_commercant), écrite par le patron.
alter table public.parametres_commercant add column if not exists commandes_acompte jsonb not null default '{"seuil": 40, "taux": 30}'::jsonb;

-- ---------- Rôles sur les tables existantes ----------
-- Associé (conjoint) : tout, comme le patron. Vendeuse et apprenti : voient
-- fournées, ventes (quantités) et événements, cochent « épuisé » / « enfourné ».
-- Rien d'autre n'est ouvert (ni produits/prix, ni recettes/coûts, ni caisse).
do $$
declare t text;
begin
  foreach t in array array['ventes', 'produits', 'fournees', 'parametres_commercant', 'evenements_commercant', 'ingredients_produit', 'categories_produit'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "associe_tout" on public.%I', t);
      execute format('create policy "associe_tout" on public.%I for all using (public.role_boutique(commercant_id) = ''associe'') with check (public.role_boutique(commercant_id) = ''associe'')', t);
    end if;
  end loop;
  if to_regclass('public.fournees') is not null then
    drop policy if exists "equipe_lecture_fournees" on public.fournees;
    create policy "equipe_lecture_fournees" on public.fournees for select using (public.role_boutique(commercant_id) in ('vendeuse', 'apprenti'));
    drop policy if exists "equipe_ajout_fournees" on public.fournees;
    create policy "equipe_ajout_fournees" on public.fournees for insert with check (public.role_boutique(commercant_id) in ('vendeuse', 'apprenti'));
    drop policy if exists "equipe_coche_fournees" on public.fournees;
    create policy "equipe_coche_fournees" on public.fournees for update using (public.role_boutique(commercant_id) in ('vendeuse', 'apprenti'))
      with check (public.role_boutique(commercant_id) in ('vendeuse', 'apprenti'));
  end if;
  foreach t in array array['ventes', 'evenements_commercant'] loop
    if to_regclass('public.' || t) is not null then
      -- Quantités seulement (aucun prix dans ces tables) : la Fournée de l'équipe.
      execute format('drop policy if exists "apprenti_lecture" on public.%I', t);
      execute format('drop policy if exists "equipe_lecture" on public.%I', t);
      execute format('create policy "equipe_lecture" on public.%I for select using (public.role_boutique(commercant_id) in (''vendeuse'', ''apprenti''))', t);
    end if;
  end loop;
end $$;

-- Aucune policy delete : sous RLS, toute suppression est refusée.
revoke delete on public.commandes_clients from anon, authenticated;

drop policy if exists "commandes_clients_historique_lecture" on public.commandes_clients_historique;
create policy "commandes_clients_historique_lecture" on public.commandes_clients_historique
  for select using (
    public.role_boutique(commercant_id) in ('patron', 'associe', 'vendeuse')
  );
-- L'historique ne s'écrit que par le trigger ci-dessous.
revoke insert, update, delete on public.commandes_clients_historique from anon, authenticated;

-- ---------- Garde-fous ----------
-- Avant modification : la boutique, l'id et la date de création ne bougent
-- pas ; l'ancienne version part dans l'historique.
create or replace function public.commandes_clients_avant_maj() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.id := old.id;
  new.commercant_id := old.commercant_id;
  new.cree_le := old.cree_le;
  new.cree_par := old.cree_par;
  new.maj_par := coalesce(auth.uid(), new.maj_par);
  insert into public.commandes_clients_historique (commande_id, commercant_id, ancienne, remplacee_par)
    values (old.id, old.commercant_id, to_jsonb(old), auth.uid());
  return new;
end $$;

drop trigger if exists commandes_clients_avant_maj on public.commandes_clients;
create trigger commandes_clients_avant_maj before update on public.commandes_clients
  for each row execute function public.commandes_clients_avant_maj();

-- Suppression : refusée à tout utilisateur connecté. Reste possible sans
-- utilisateur (service, suppression du compte entier par cascade).
create or replace function public.commandes_clients_pas_de_suppression() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null then
    raise exception 'Une commande client ne se supprime pas : annule-la.';
  end if;
  return old;
end $$;

drop trigger if exists commandes_clients_pas_de_suppression on public.commandes_clients;
create trigger commandes_clients_pas_de_suppression before delete on public.commandes_clients
  for each row execute function public.commandes_clients_pas_de_suppression();

-- ============================================================
-- SMS de la veille : pas encore d'envoi. Une Edge Function (compte SMS du
-- fondateur) lira les retraits du lendemain (CommandesClients.smsDeLaVeille
-- donne le texte) et notera sms_envois[date] ; aucune colonne à ajouter.
-- ============================================================
