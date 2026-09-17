-- Planning nominatif complet (revirement du 15 septembre 2026, voir
-- roadmap-produit.md section -2) : passe de la recommandation de renfort +
-- Gantt simple déjà en place à un vrai planning nominatif avec hiérarchie
-- Secteur > Poste, comptes employés (invitation), anti-chevauchement,
-- équité contrat/heures et esquisse automatique apprenante.
--
-- Non destructif : n'ajoute que des colonnes/tables, ne supprime ni ne
-- renomme rien d'existant (role/heures_disponibles restent en place pour la
-- recommandation de renfort déjà construite, qui n'est pas remplacée).
--
-- À exécuter dans Supabase : Project "anti-gaspi" > SQL Editor > New query
-- > coller > Run. Idempotent (if not exists / if not exists partout).

-- ---------- 1) Secteurs : couleur du Gantt, propres à chaque commerçant ----------
create table if not exists public.secteurs_personnel (
  id text not null,
  commercant_id uuid not null references auth.users(id),
  nom text not null,
  couleur text not null default '#8a7cc7',
  ordre integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (commercant_id, id)
);

alter table public.secteurs_personnel enable row level security;

drop policy if exists "Un commercant peut voir ses secteurs" on public.secteurs_personnel;
create policy "Un commercant peut voir ses secteurs" on public.secteurs_personnel
  for select using (auth.uid() = commercant_id);

drop policy if exists "Un commercant peut ajouter des secteurs" on public.secteurs_personnel;
create policy "Un commercant peut ajouter des secteurs" on public.secteurs_personnel
  for insert with check (auth.uid() = commercant_id);

drop policy if exists "Un commercant peut modifier ses secteurs" on public.secteurs_personnel;
create policy "Un commercant peut modifier ses secteurs" on public.secteurs_personnel
  for update using (auth.uid() = commercant_id) with check (auth.uid() = commercant_id);

drop policy if exists "Un commercant peut supprimer ses secteurs" on public.secteurs_personnel;
create policy "Un commercant peut supprimer ses secteurs" on public.secteurs_personnel
  for delete using (auth.uid() = commercant_id);

-- ---------- 2) Postes : rôle précis À L'INTÉRIEUR d'un secteur (ex: "Chef de
-- rang" dans Salle). Toujours au moins un poste "generique" par secteur
-- (créé côté app à la création du secteur, jamais imposé ici en dur). ----------
create table if not exists public.postes_personnel (
  id text not null,
  commercant_id uuid not null references auth.users(id),
  secteur_id text not null,
  nom text not null,
  ordre integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (commercant_id, secteur_id, id),
  foreign key (commercant_id, secteur_id) references public.secteurs_personnel(commercant_id, id) on delete cascade
);

alter table public.postes_personnel enable row level security;

drop policy if exists "Un commercant peut voir ses postes" on public.postes_personnel;
create policy "Un commercant peut voir ses postes" on public.postes_personnel
  for select using (auth.uid() = commercant_id);

drop policy if exists "Un commercant peut ajouter des postes" on public.postes_personnel;
create policy "Un commercant peut ajouter des postes" on public.postes_personnel
  for insert with check (auth.uid() = commercant_id);

drop policy if exists "Un commercant peut modifier ses postes" on public.postes_personnel;
create policy "Un commercant peut modifier ses postes" on public.postes_personnel
  for update using (auth.uid() = commercant_id) with check (auth.uid() = commercant_id);

drop policy if exists "Un commercant peut supprimer ses postes" on public.postes_personnel;
create policy "Un commercant peut supprimer ses postes" on public.postes_personnel
  for delete using (auth.uid() = commercant_id);

-- ---------- 3) Personnel : champs du profil nominatif complet ----------
-- secteur_id/poste_id (poste PRINCIPAL de la personne) restent en texte
-- libre SANS contrainte de clé étrangère, volontairement : si un secteur
-- est renommé/supprimé depuis, l'app retombe proprement sur le générique du
-- secteur principal (voir personnel.html), jamais une ligne bloquée ou
-- supprimée en cascade par erreur.
alter table public.personnel
  add column if not exists email text,
  add column if not exists statut_compte text not null default 'non_invite',
  add column if not exists type_contrat text not null default 'Fixe',
  add column if not exists niveau_hierarchie smallint not null default 2,
  add column if not exists contrat_hebdo numeric not null default 35,
  add column if not exists jours_repos text[] not null default '{}',
  add column if not exists alternance_weekend boolean not null default false,
  add column if not exists secteur_id text,
  add column if not exists poste_id text;

alter table public.personnel
  drop constraint if exists personnel_statut_compte_check;
alter table public.personnel
  add constraint personnel_statut_compte_check check (statut_compte in ('non_invite', 'invite', 'actif'));

alter table public.personnel
  drop constraint if exists personnel_type_contrat_check;
alter table public.personnel
  add constraint personnel_type_contrat_check check (type_contrat in ('Fixe', 'Saisonnier', 'Extra'));

alter table public.personnel
  drop constraint if exists personnel_niveau_hierarchie_check;
alter table public.personnel
  add constraint personnel_niveau_hierarchie_check check (niveau_hierarchie in (1, 2, 3));

-- ---------- 4) Créneaux : secteur/poste précis + pause, en plus du champ
-- role existant (conservé pour compatibilité, plus utilisé par le nouveau
-- Gantt qui écrit désormais secteur_id/poste_id). ----------
alter table public.creneaux_personnel
  add column if not exists secteur_id text,
  add column if not exists poste_id text,
  add column if not exists pause_debut time,
  add column if not exists pause_fin time;

-- ============================================================
-- Rien à ressaisir : la mémoire de l'esquisse automatique n'est pas une
-- table à part, elle lit directement les creneaux_personnel passés
-- (origine = 'manuel') du même commerçant — voir personnel.html.
-- ============================================================
