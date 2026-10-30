-- À exécuter une seule fois dans Supabase : Project "anti-gaspi" > SQL Editor > New query > coller > Run.
-- Branchement caisse (REFONTE.md § 4 bis, docs/connecteurs-caisse.md) :
-- les ventes arrivent seules chaque nuit depuis la caisse (SumUp d'abord),
-- ou par l'export envoyé par e-mail pour les caisses sans API.
--
-- Rien ici ne touche aux ventes existantes : on ajoute seulement une colonne
-- `source` (valeur par défaut 'manuel', donc les saisies et imports actuels
-- ne changent pas).

-- 1. Connexion d'un commerçant à sa caisse. Lisible par le commerçant (pour
--    afficher l'état dans Paramètres et Ventes), jamais modifiable depuis le
--    navigateur : seules les Edge Functions (service role) écrivent ici.
create table connexions_caisse (
  commercant_id uuid not null references auth.users(id) on delete cascade,
  fournisseur text not null check (fournisseur in ('sumup', 'export_email')),
  statut text not null default 'active' check (statut in ('active', 'erreur')),
  compte_caisse text,                 -- ex. merchant_code SumUp
  jeton_import text unique,           -- partie <jeton> de ventes+<jeton>@import.apointapp.fr
  derniere_synchro timestamptz,
  derniere_date_synchronisee date,    -- dernier jour complet importé
  nb_lignes_derniere_synchro integer,
  derniere_erreur text,
  created_at timestamptz not null default now(),
  primary key (commercant_id, fournisseur)
);

alter table connexions_caisse enable row level security;

create policy "Les commerçants voient leurs propres connexions caisse"
on connexions_caisse for select
using (auth.uid() = commercant_id);

-- 2. Jetons OAuth (chiffrés par l'Edge Function avec CLE_CHIFFREMENT_CAISSE).
--    RLS active sans aucune policy : invisible pour anon et authenticated,
--    seul le service role y accède.
create table connexions_caisse_secrets (
  commercant_id uuid not null,
  fournisseur text not null,
  access_token text not null,
  refresh_token text,
  expire_a timestamptz,
  primary key (commercant_id, fournisseur),
  foreign key (commercant_id, fournisseur)
    references connexions_caisse(commercant_id, fournisseur) on delete cascade
);

alter table connexions_caisse_secrets enable row level security;

-- 3. Paramètre `state` OAuth (anti-CSRF) : relie le retour de SumUp au
--    commerçant qui a cliqué sur « Connecter ». Service role uniquement.
create table etats_oauth_caisse (
  etat text primary key,
  commercant_id uuid not null references auth.users(id) on delete cascade,
  fournisseur text not null,
  created_at timestamptz not null default now()
);

alter table etats_oauth_caisse enable row level security;

-- 4. Origine de chaque ligne de vente : 'manuel' (saisie / import, défaut),
--    'sumup', 'export_email'… Sert à afficher l'état de la synchro.
alter table ventes add column if not exists source text not null default 'manuel';

-- 5. Même normalisation que cleNormaliseeProduit (import.html) :
--    espaces de bord retirés, minuscules, accents retirés, s/x final retiré
--    au-delà de 3 lettres ("Croissants" = "croissant" = "CROISSANT ").
create or replace function normaliser_nom_produit(nom text)
returns text
language sql
immutable
as $$
  select case when length(p) > 3 and p ~ '[sx]$' then left(p, -1) else p end
  from (
    select translate(
      lower(btrim(coalesce(nom, ''))),
      'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ',
      'aaaaaaceeeeiiiinooooouuuuyy'
    ) as p
  ) s
$$;

create index if not exists ventes_commercant_date_nom_normalise
on ventes (commercant_id, date_vente, normaliser_nom_produit(nom_produit));

-- 6. Enregistrement dédoublonné des ventes venues de la caisse.
--    p_lignes : [{"nom_produit": "...", "quantite": 12, "date_vente": "2026-10-29"}, ...]
--    Pour chaque (commerçant, nom normalisé, date) : les lignes existantes
--    (saisie manuelle comprise) sont remplacées par le total de la caisse,
--    qui fait foi. Relancer la synchro d'un même jour ne crée donc jamais de
--    doublon. Le nom enregistré reprend celui du produit déjà connu dans
--    Produits ; un produit inconnu y est ajouté (comme l'import de fichier).
create or replace function enregistrer_ventes_caisse(p_commercant uuid, p_lignes jsonb, p_source text)
returns integer
language plpgsql
as $$
declare
  ligne record;
  nom_canonique text;
  nb integer := 0;
begin
  for ligne in
    select normaliser_nom_produit(l->>'nom_produit') as cle,
           min(btrim(l->>'nom_produit')) as nom,
           (l->>'date_vente')::date as jour,
           greatest(0, round(sum((l->>'quantite')::numeric)))::bigint as quantite
    from jsonb_array_elements(p_lignes) l
    where coalesce(btrim(l->>'nom_produit'), '') <> ''
    group by 1, 3
  loop
    select p.nom into nom_canonique
    from produits p
    where p.commercant_id = p_commercant and normaliser_nom_produit(p.nom) = ligne.cle
    order by p.id
    limit 1;

    if nom_canonique is null then
      insert into produits (commercant_id, nom) values (p_commercant, ligne.nom);
      nom_canonique := ligne.nom;
    end if;

    delete from ventes
    where commercant_id = p_commercant
      and date_vente = ligne.jour
      and normaliser_nom_produit(nom_produit) = ligne.cle;

    insert into ventes (commercant_id, nom_produit, quantite, date_vente, source)
    values (p_commercant, nom_canonique, ligne.quantite, ligne.jour, p_source);

    nb := nb + 1;
  end loop;
  return nb;
end;
$$;

-- Appelable uniquement par les Edge Functions (service role) : sinon
-- n'importe quel compte pourrait écrire des ventes chez un autre commerçant.
revoke execute on function enregistrer_ventes_caisse(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function enregistrer_ventes_caisse(uuid, jsonb, text) to service_role;

-- 7. Synchro nocturne : À FAIRE APRÈS le déploiement des Edge Functions.
--    a) Database > Extensions : activer pg_cron (pg_net est déjà actif).
--    b) Créer le secret partagé avec la fonction (même valeur que
--       CLE_SYNCHRO_CAISSE dans les secrets des Edge Functions) :
--         select vault.create_secret('<valeur>', 'cle_synchro_caisse');
--    c) Planifier : toutes les 10 min entre 1 h et 3 h 50 UTC (3 h à 5 h 50
--       à Paris en été). Chaque appel traite les connexions pas encore
--       synchronisées aujourd'hui, dans la limite de temps d'une fonction :
--       les appels suivants finissent le travail.
--
-- select cron.schedule(
--   'synchro-caisse-nocturne',
--   '*/10 1-3 * * *',
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
