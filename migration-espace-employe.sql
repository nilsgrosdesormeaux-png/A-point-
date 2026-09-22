-- Espace employe (etape 7 du cahier des charges) : lie chaque ligne
-- personnel a un vrai compte Supabase Auth, et isole les acces pour qu'un
-- employe connecte ne voie jamais que son propre profil et ses propres
-- creneaux (jamais les autres employes, jamais les ventes/previsions/
-- parametres du commercant).
--
-- Non destructif : n'ajoute que des colonnes/policies, ne supprime ni ne
-- renomme rien d'existant.
--
-- A executer dans Supabase : Project "anti-gaspi" > SQL Editor > New query
-- > coller > Run. Idempotent (if not exists / drop policy if exists partout).

-- ---------- 1) Lien vers le vrai compte Auth de l'employe ----------
-- Nullable : reste null tant que l'employe n'a pas encore de compte
-- (statut_compte = 'non_invite' ou 'invite' en attente). Rempli une fois
-- pour toutes par l'Edge Function d'invitation, jamais modifiable depuis le
-- client (aucune policy update ne couvre cette colonne pour l'employe).
alter table public.personnel
  add column if not exists user_id uuid references auth.users(id);

create unique index if not exists personnel_user_id_unique
  on public.personnel(user_id) where user_id is not null;

-- ---------- 2) Lecture seule de son propre profil par l'employe ----------
drop policy if exists "Un employe peut voir sa propre ligne personnel" on public.personnel;
create policy "Un employe peut voir sa propre ligne personnel" on public.personnel
  for select using (auth.uid() = user_id);

-- ---------- 3) Lecture seule de ses propres creneaux ----------
-- S'ajoute a la policy existante du commercant (for select using (auth.uid()
-- = commercant_id)) : Postgres combine plusieurs policies "select" en OR,
-- donc le commercant garde tout son acces habituel, et l'employe gagne
-- seulement l'acces a ses propres creneaux, jamais ceux des autres.
drop policy if exists "Un employe peut voir ses propres creneaux" on public.creneaux_personnel;
create policy "Un employe peut voir ses propres creneaux" on public.creneaux_personnel
  for select using (
    auth.uid() = (select user_id from public.personnel where personnel.id = creneaux_personnel.personnel_id)
  );

-- ---------- 4) Secteurs/postes : necessaires pour afficher le nom du
-- secteur/poste et sa couleur dans le planning de l'employe (lecture seule,
-- jamais de creation/modification/suppression). ----------
drop policy if exists "Un employe peut voir les secteurs de son commercant" on public.secteurs_personnel;
create policy "Un employe peut voir les secteurs de son commercant" on public.secteurs_personnel
  for select using (
    auth.uid() in (select user_id from public.personnel where personnel.commercant_id = secteurs_personnel.commercant_id and personnel.user_id is not null)
  );

drop policy if exists "Un employe peut voir les postes de son commercant" on public.postes_personnel;
create policy "Un employe peut voir les postes de son commercant" on public.postes_personnel
  for select using (
    auth.uid() in (select user_id from public.personnel where personnel.commercant_id = postes_personnel.commercant_id and personnel.user_id is not null)
  );

-- ============================================================
-- Volontairement absent de cette migration : aucune policy insert/update/
-- delete pour l'employe sur quelque table que ce soit (espace employe en
-- lecture seule pour l'instant, conforme au cahier des charges : "vue
-- planning hebdomadaire complete", pas de saisie). Aucun acces employe a
-- ventes, produits, parametres_commercant, evenements_commercant,
-- categories_produit, ingredients_produit : ces tables restent strictement
-- limitees au commercant (auth.uid() = commercant_id), rien n'y est ajoute.
-- ============================================================
