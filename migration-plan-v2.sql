-- Plan v2 (AMELIORATIONS.md) : prix de vente, fournisseurs, cache des signaux locaux.
-- Idempotente. Appliquée sur Supabase le 31 oct. 2026.

-- Prix de vente par produit (rempli par la caisse ou dans Mes données) :
-- sert au Bilan en euros. Vide = le Bilan montre des pièces, jamais « 0 € ».
alter table produits add column if not exists prix_vente numeric check (prix_vente is null or prix_vente >= 0);

-- Coordonnées et jours de livraison des fournisseurs (onglet Commande) :
-- { "meunier": { "email": "...", "telephone": "...", "jours": [2, 5] }, ... }
alter table parametres_commercant add column if not exists fournisseurs jsonb;

-- Cache des réponses OpenAgenda / football-data (Edge Function signaux-locaux).
-- Lu et écrit uniquement par la fonction (rôle service) : RLS activée, sans politique.
create table if not exists cache_signaux (
  cle text primary key,
  donnees jsonb not null default '[]'::jsonb,
  maj timestamptz not null default now()
);
alter table cache_signaux enable row level security;
