# Caisse, lot 12 : ce qu'il reste à appliquer (rien n'est encore déployé)

Code sur `main`. Côté Supabase, état au 2 novembre : migrations appliquées jusqu'à la **v4** ; fonctions `connecter-caisse`, `synchro-caisse` et `import-export-caisse` déployées dans leur version d'avant le lot 10.

## 1. Migrations (SQL Editor, dans cet ordre, relançables sans risque)
1. `migration-connecteurs-caisse-v5.sql` : Zelty et Popina.
2. `migration-connecteurs-caisse-v6.sql` : Lightspeed Retail, ventes heure par heure (`ventes_horaires`), lectures de photo (`lectures_ticket`, `enregistrer_ventes_photo`), rapports « à confirmer » (`rapports_a_confirmer`, `confirmer_rapport`, `rejeter_rapport`).
3. Les autres de `REPRISE.md` (commandes clients, paramètres v3) ne sont pas de ce lot.

## 2. Fonctions à déployer (toutes avec `--no-verify-jwt`)
```bash
supabase functions deploy connecter-caisse --no-verify-jwt
supabase functions deploy synchro-caisse --no-verify-jwt
supabase functions deploy import-export-caisse --no-verify-jwt
supabase functions deploy lire-ticket --no-verify-jwt
```
`lire-ticket` est nouvelle (lecture d'une photo ou d'un PDF).

## 3. Secrets
- `ANTHROPIC_API_KEY` : clé de console.anthropic.com. Sans elle, photo et PDF affichent « ouvre très bientôt » ; tout le reste marche. Coût : environ 1 centime par photo, 10 lectures par jour et par boulangerie au plus (suivi dans `lectures_ticket`).
- `ADRESSE_IMPORT=apointapp.contact@gmail.com`, **seulement après** l'installation du script Gmail (point 5). `CLE_IMPORT_EMAIL` existe déjà.

## 4. Synchro dans la journée (de 6 h à 20 h)
Après la migration v6 et le déploiement : exécuter le bloc `cron.schedule('synchro-caisse-journee', …)` en commentaire à la fin de la v6 (une fois par heure). La synchro de nuit existante ne change pas.

## 5. Boîte e-mail universelle
Réinstaller `supabase/functions/import-export-caisse/relais-gmail.gs` dans Apps Script (coller le nouveau code, lancer `installer` une fois). Nouveau : photo, PDF et texte du message sont transmis ; relevé toutes les 30 minutes de 12 h à 23 h puis à 4 h ; logos et petites images écartés. Les tableaux CSV et Excel s'importent seuls ; photos, PDF et textes sont lus par l'IA et attendent un **« Confirmer »** sur la page Ma caisse (jamais d'écriture directe dans les ventes).

## 6. Vérifier après
Page Ma caisse : déposer une photo de rapport, corriger, confirmer ; envoyer un e-mail avec photo à son adresse d'import, la voir sous « À confirmer » ; le journal affiche chaque réception.
