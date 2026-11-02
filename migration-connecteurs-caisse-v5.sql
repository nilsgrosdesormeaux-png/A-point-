-- Branchement caisse v5 : Zelty et Popina en clé (à exécuter après la v4).
-- Idempotente. La clé est demandée par le commerçant à son éditeur, collée
-- dans Ma caisse, chiffrée dans connexions_caisse_secrets comme les autres.
alter table connexions_caisse drop constraint if exists connexions_caisse_fournisseur_check;
alter table connexions_caisse add constraint connexions_caisse_fournisseur_check
  check (fournisseur in ('sumup', 'zettle', 'square', 'hiboutik', 'loyverse', 'tactill', 'zelty', 'popina', 'export_email'));
