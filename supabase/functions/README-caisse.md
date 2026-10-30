# Connecteur caisse — mise en service et tests

Étude et choix : `docs/connecteurs-caisse.md`. Rien n'est encore appliqué ni déployé sur Supabase.

## Ce que fait chaque morceau

| Fichier | Rôle |
|---|---|
| `migration-connecteurs-caisse.sql` | Tables `connexions_caisse`, `connexions_caisse_secrets`, `etats_oauth_caisse`, colonne `ventes.source`, fonctions `normaliser_nom_produit` et `enregistrer_ventes_caisse`, tâche pg_cron (commentée) |
| `connecter-caisse` | OAuth SumUp, Zettle, Square (départ + retour), clé API Hiboutik, synchro immédiate, déconnexion, adresse d'import e-mail |
| `synchro-caisse` | Synchro en continu (pg_cron chaque minute) : 12 mois d'historique au branchement, puis la veille chaque nuit |
| `import-export-caisse` | Repli : reçoit l'export CSV envoyé par e-mail (webhook Postmark Inbound) |
| `_shared/caisse/` | Code commun : normalisation, dates de Paris, client SumUp, chiffrement des jetons, lecture CSV, synchro |
| `connecteur-caisse.js` + `#blocCaisse` | Bloc « Ma caisse » de Paramètres |

Dédoublonnage : pour chaque (commerçant, nom de produit normalisé, date), `enregistrer_ventes_caisse` remplace les lignes existantes (saisie manuelle comprise) par le total de la caisse. Relancer une synchro ne crée jamais de doublon.

## Tests déjà possibles sans compte marchand

```bash
node --test tests/caisse.test.mjs
```

Faux SumUp et faux Supabase : pagination, réessai sur 429, détail par ticket, jour de Paris, rafraîchissement du jeton, fenêtre jusqu'à hier, erreurs, CSV, chiffrement.

```bash
npm i --no-save @electric-sql/pglite@0.3.7 && node tests/caisse-migration.test.mjs
```

La migration dans un Postgres en mémoire : normalisation identique au JS, dédoublonnage, relance, droits (anon/authenticated ne peuvent pas appeler `enregistrer_ventes_caisse`), RLS.

## Mise en service (avec ton accord, dans cet ordre)

1. **Migration** : SQL Editor > coller `migration-connecteurs-caisse.sql` (sans la partie 7) > Run.
2. **App SumUp** : me.sumup.com > Paramètres > Pour les développeurs > Toolkit : créer une app OAuth, URI de redirection
   `https://eqvbksxfwlgbcxgqljqn.supabase.co/functions/v1/connecter-caisse`. Noter client id et secret.
3. **Secrets** des Edge Functions :
   ```bash
   supabase secrets set SUMUP_CLIENT_ID=… SUMUP_CLIENT_SECRET=… CLE_CHIFFREMENT_CAISSE=$(openssl rand -base64 32) CLE_IMPORT_EMAIL=$(openssl rand -hex 24)
   ```
   Garder `CLE_CHIFFREMENT_CAISSE` : la changer rend les jetons enregistrés illisibles (il faudrait reconnecter les caisses).
4. **Déploiement** (les trois s'authentifient eux-mêmes, d'où `--no-verify-jwt`) :
   ```bash
   supabase functions deploy connecter-caisse --no-verify-jwt
   supabase functions deploy synchro-caisse --no-verify-jwt
   supabase functions deploy import-export-caisse --no-verify-jwt
   ```
5. **Synchro nocturne** : activer pg_cron, puis exécuter la partie 7 de la migration (clé générée dans Vault, fonction `verifier_cle_synchro`, `cron.schedule`).
6. **Repli e-mail** : compte Postmark, serveur > Inbound : copier l'adresse de réception (`…@inbound.postmarkapp.com`, aucun réglage DNS) dans le secret `ADRESSE_IMPORT`, et régler le webhook Inbound sur
   `https://eqvbksxfwlgbcxgqljqn.supabase.co/functions/v1/import-export-caisse?cle=<CLE_IMPORT_EMAIL>`.

## Premier test réel (ton propre compte SumUp, sans app OAuth)

Créer une clé API sur me.sumup.com (Paramètres > Pour les développeurs > Toolkit > Clés API), encaisser 2 ou 3 articles du catalogue avec l'app SumUp, puis le lendemain, depuis la console du navigateur sur Paramètres, connecté à À Point :

```js
sb = supabase.createClient('https://eqvbksxfwlgbcxgqljqn.supabase.co', 'sb_publishable_Dlh12BadZ13vHrUR0o7O7Q_i3aN2VMc');
await sb.functions.invoke('connecter-caisse', { body: { action: 'connecter_cle', cle: 'sup_sk_…' } });
await sb.functions.invoke('connecter-caisse', { body: { action: 'synchroniser' } });
```

Les ventes d'hier apparaissent dans Ventes avec `source = 'sumup'`. Tester ensuite le parcours OAuth avec le bouton « Connecter ma caisse SumUp ».

Test de la synchro nocturne à la main (SQL Editor) :

```sql
select net.http_post(url := 'https://eqvbksxfwlgbcxgqljqn.supabase.co/functions/v1/synchro-caisse', headers := jsonb_build_object('x-cle-synchro', (select decrypted_secret from vault.decrypted_secrets where name = 'cle_synchro_caisse')));
```

Test du repli e-mail sans Postmark (`<jeton>` : affiché dans Paramètres après « Obtenir mon adresse d'import ») :

```bash
curl -X POST "https://eqvbksxfwlgbcxgqljqn.supabase.co/functions/v1/import-export-caisse?cle=<CLE_IMPORT_EMAIL>" \
  -H "Content-Type: application/json" \
  -d "{\"MailboxHash\":\"<jeton>\",\"Attachments\":[{\"Name\":\"ventes.csv\",\"ContentType\":\"text/csv\",\"Content\":\"$(printf 'Date;Article;Qte\n29/10/2026;Baguette;80\n' | base64)\"}]}"
```

## Limites connues

- SumUp ne détaille les articles que pour les ventes encaissées avec le catalogue produits de l'app (pas en montant libre).
- Un appel API par ticket : environ 300 à 600 appels par boulangerie et par nuit ; la synchro s'étale sur plusieurs passages pg_cron si besoin.
- Seuls les paiements réussis sont comptés ; un remboursement après coup n'est pas déduit.
- Le CSV est le seul format d'export lu (pas d'Excel `.xlsx`).

## v2 (1er novembre 2026) : Zettle, Square, Hiboutik, historique 12 mois

- `migration-connecteurs-caisse-v2.sql` appliquée ; tâche pg_cron `synchro-caisse` chaque minute (remplace la tâche de nuit).
- Ouvrir le bouton d'une caisse OAuth = créer son app développeur, URI de redirection `https://eqvbksxfwlgbcxgqljqn.supabase.co/functions/v1/connecter-caisse`, puis ajouter dans Supabase > Edge Functions > Secrets : `ZETTLE_CLIENT_ID` / `ZETTLE_CLIENT_SECRET` (developer.zettle.com) ou `SQUARE_CLIENT_ID` / `SQUARE_CLIENT_SECRET` (developer.squareup.com). Aucun redéploiement nécessaire.
- Hiboutik : rien à configurer, le commerçant colle ses accès.
- Import de fichier (toute caisse) : fonction SQL `importer_historique_ventes`, appelée depuis Paramètres.
