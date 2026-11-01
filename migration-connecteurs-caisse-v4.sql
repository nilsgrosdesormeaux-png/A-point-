-- Branchement caisse v4 : « clé personnelle » (à exécuter après les v1 à v3).
-- Idempotente : peut être relancée sans risque.
--
-- Le commerçant crée une clé dans SON compte de caisse et la colle dans
-- À Point : aucun compte développeur côté À Point. SumUp, Zettle et Square
-- en clé personnelle n'ont besoin d'aucune migration (déjà autorisées) ;
-- Loyverse et Tactill, si. Les clés vont, chiffrées par l'Edge Function
-- (CLE_CHIFFREMENT_CAISSE), dans connexions_caisse_secrets, comme Hiboutik.

-- 1. Nouvelles caisses.
alter table connexions_caisse drop constraint if exists connexions_caisse_fournisseur_check;
alter table connexions_caisse add constraint connexions_caisse_fournisseur_check
  check (fournisseur in ('sumup', 'zettle', 'square', 'hiboutik', 'loyverse', 'tactill', 'export_email'));

-- 2. Sécurité, en plus des RLS existantes (défense en profondeur) :
--    - connexions_caisse : lecture de SES lignes seulement, aucune écriture
--      depuis le navigateur (seules les Edge Functions, en service role) ;
--    - connexions_caisse_secrets et etats_oauth_caisse : invisibles pour
--      anon et authenticated, même si une policy était ajoutée par erreur ;
--    - journal_caisse : lecture de SES lignes seulement.
alter table connexions_caisse enable row level security;
alter table connexions_caisse_secrets enable row level security;
alter table etats_oauth_caisse enable row level security;
alter table journal_caisse enable row level security;

revoke all on connexions_caisse_secrets from public, anon, authenticated;
revoke all on etats_oauth_caisse from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on connexions_caisse from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on journal_caisse from public, anon, authenticated;
grant select on connexions_caisse to authenticated;
grant select on journal_caisse to authenticated;
grant all on connexions_caisse, connexions_caisse_secrets, etats_oauth_caisse, journal_caisse to service_role;

-- Les policies de lecture existent déjà (v1, v3) ; on les recrée si absentes.
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'connexions_caisse' and cmd = 'SELECT') then
    create policy "Les commerçants voient leurs propres connexions caisse" on connexions_caisse
      for select to authenticated using (auth.uid() = commercant_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'journal_caisse' and cmd = 'SELECT') then
    create policy "Un commercant lit son journal caisse" on journal_caisse
      for select to authenticated using (auth.uid() = commercant_id);
  end if;
end $$;

-- Vérification après exécution (doit renvoyer 0 ligne) : aucune policy sur
-- les secrets, aucune policy d'écriture sur les connexions.
-- select tablename, policyname, cmd from pg_policies
-- where tablename = 'connexions_caisse_secrets'
--    or (tablename in ('connexions_caisse', 'journal_caisse') and cmd <> 'SELECT');
