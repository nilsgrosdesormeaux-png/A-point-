-- À exécuter une seule fois dans Supabase : Project "anti-gaspi" > SQL Editor > New query > coller > Run.
-- Crée la table qui stocke les réglages ponctuels du commerçant (pour l'instant,
-- uniquement le code postal, utilisé pour déduire automatiquement la zone de
-- vacances scolaires A/B/C). Même logique de sécurité (RLS) que les autres
-- tables : chaque commerçant ne voit et ne modifie que sa propre ligne.
-- Une ligne par commerçant (commercant_id est la clé primaire) : le tableau
-- de bord fait un "upsert" (crée la ligne si elle n'existe pas, la met à jour
-- sinon) quand le code postal est enregistré.

create table parametres_commercant (
  commercant_id uuid primary key references auth.users(id) on delete cascade,
  code_postal text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table parametres_commercant enable row level security;

create policy "Les commerçants voient leurs propres réglages"
on parametres_commercant for select
using (auth.uid() = commercant_id);

create policy "Les commerçants créent leurs propres réglages"
on parametres_commercant for insert
with check (auth.uid() = commercant_id);

create policy "Les commerçants modifient leurs propres réglages"
on parametres_commercant for update
using (auth.uid() = commercant_id)
with check (auth.uid() = commercant_id);
