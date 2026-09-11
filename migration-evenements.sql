-- À exécuter une seule fois dans Supabase : Project "anti-gaspi" > SQL Editor > New query > coller > Run.
-- Table pour le signalement manuel d'un événement inhabituel sur un jour précis
-- (ex : mariage, fermeture exceptionnelle, événement local) — une porte de
-- sortie rare, jamais une saisie régulière. Le commerçant indique seulement
-- une direction ("plus de monde attendu" / "moins de monde attendu"), jamais
-- un chiffre : l'algorithme ne peut pas deviner l'ampleur exacte, donc on ne
-- prétend pas le contraire. Utilisée par la page "Semaine".

create table evenements_commercant (
  commercant_id uuid not null references auth.users(id) on delete cascade,
  date_evenement date not null,
  direction text not null check (direction in ('plus', 'moins')),
  created_at timestamptz not null default now(),
  primary key (commercant_id, date_evenement)
);

alter table evenements_commercant enable row level security;

create policy "Les commerçants voient leurs propres événements"
on evenements_commercant for select
using (auth.uid() = commercant_id);

create policy "Les commerçants signalent leurs propres événements"
on evenements_commercant for insert
with check (auth.uid() = commercant_id);

create policy "Les commerçants modifient leurs propres événements"
on evenements_commercant for update
using (auth.uid() = commercant_id)
with check (auth.uid() = commercant_id);

create policy "Les commerçants retirent leurs propres événements"
on evenements_commercant for delete
using (auth.uid() = commercant_id);
