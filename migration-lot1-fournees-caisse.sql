-- Lot 1 (revue investisseur, oct. 2026) : mesurer les vrais invendus et
-- connaître la caisse de chaque boulangerie. Idempotente.

-- Quantité réellement cuite, par produit et par jour, saisie en cochant la
-- Fournée. Invendus réels = cuit − vendu (Bilan).
create table if not exists fournees (
  commercant_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date_fournee date not null,
  nom_produit text not null,
  quantite_cuite integer not null check (quantite_cuite >= 0),
  maj timestamptz not null default now(),
  primary key (commercant_id, date_fournee, nom_produit)
);
alter table fournees enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'fournees' and policyname = 'Un commercant gere ses fournees') then
    create policy "Un commercant gere ses fournees" on fournees
      for all to authenticated
      using (auth.uid() = commercant_id)
      with check (auth.uid() = commercant_id);
  end if;
end $$;

-- Caisse utilisée (question à l'inscription, modifiable dans Paramètres) :
-- sumup, zettle, bimedia, lightspeed, hiboutik, tactill, toporder, crisalid,
-- square, aucune, ou « autre: <texte> ». Sert à choisir le prochain connecteur.
alter table parametres_commercant add column if not exists caisse text;
