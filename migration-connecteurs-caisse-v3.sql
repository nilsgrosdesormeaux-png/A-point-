-- Branchement caisse v3 : journal de chaque réception de ventes, affiché
-- sur la page « Ma caisse ». Idempotente. Rempli par les Edge Functions
-- synchro-caisse et connecter-caisse (source 'api', 'branchement'),
-- import-export-caisse ('email'), et par la page elle-même après un import
-- de fichier ('fichier', via journaliser_import_fichier).

create table if not exists journal_caisse (
  id bigint generated always as identity primary key,
  commercant_id uuid not null references auth.users(id) on delete cascade,
  cree_le timestamptz not null default now(),
  source text not null check (source in ('api', 'email', 'fichier', 'branchement')),
  fournisseur text,
  nb_ventes integer not null default 0,
  du date,
  au date,
  erreur text,
  detail text
);

create index if not exists journal_caisse_commercant_date on journal_caisse (commercant_id, cree_le desc);

alter table journal_caisse enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'journal_caisse' and policyname = 'Un commercant lit son journal caisse') then
    create policy "Un commercant lit son journal caisse" on journal_caisse
      for select to authenticated using (auth.uid() = commercant_id);
  end if;
end $$;

-- Import de fichier depuis la page : une seule ligne de journal à la fin,
-- toujours au nom du commerçant connecté.
create or replace function journaliser_import_fichier(p_nb integer, p_du date, p_au date, p_erreur text, p_detail text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if auth.uid() is null then
    raise exception 'Non authentifie';
  end if;
  insert into journal_caisse (commercant_id, source, nb_ventes, du, au, erreur, detail)
  values (auth.uid(), 'fichier', greatest(0, coalesce(p_nb, 0)), p_du, p_au, left(p_erreur, 500), left(p_detail, 200));
end;
$$;

revoke execute on function journaliser_import_fichier(integer, date, date, text, text) from public, anon;
grant execute on function journaliser_import_fichier(integer, date, date, text, text) to authenticated;
