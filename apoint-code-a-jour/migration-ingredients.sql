-- À exécuter une seule fois dans Supabase : Project "anti-gaspi" > SQL Editor > New query > coller > Run.
-- Crée la table qui stocke les fiches techniques (ingrédients par produit),
-- avec les mêmes règles de sécurité (RLS) que les tables produits/ventes :
-- chaque commerçant ne voit et ne modifie que ses propres données.

create table ingredients_produit (
  id bigint generated always as identity primary key,
  commercant_id uuid not null references auth.users(id) on delete cascade,
  produit_id text not null,
  nom_ingredient text not null,
  quantite numeric not null,
  unite text,
  created_at timestamptz not null default now()
);

alter table ingredients_produit enable row level security;

create policy "Les commerçants voient leurs propres ingrédients"
on ingredients_produit for select
using (auth.uid() = commercant_id);

create policy "Les commerçants ajoutent leurs propres ingrédients"
on ingredients_produit for insert
with check (auth.uid() = commercant_id);

create policy "Les commerçants suppriment leurs propres ingrédients"
on ingredients_produit for delete
using (auth.uid() = commercant_id);
