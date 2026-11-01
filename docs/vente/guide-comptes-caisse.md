# Brancher les caisses : ce qu'il reste à faire (guide du fondateur)

**Bonne nouvelle : tu n'as plus besoin de compte développeur, ni d'entreprise, ni de nom de domaine e-mail.** C'est le boulanger qui crée une clé dans SON compte de caisse et la colle sur la page **Ma caisse** (comme Hiboutik). La page lui montre où cliquer, pas à pas.

| Caisse | Comment le boulanger la branche | Compte à toi |
|---|---|---|
| SumUp | Clé API créée dans me.sumup.com | Aucun |
| Zettle | Clé API créée dans my.zettle.com (lien tout prêt sur la page) | Aucun |
| Square | Jeton d'accès personnel (developer.squareup.com, avec son compte Square) | Aucun |
| Loyverse | Jeton d'accès créé dans son Back Office | Aucun |
| Tactill (nouvelle version) | Clé demandée par e-mail à Tactill (message prêt) | Aucun |
| Hiboutik | Clé API (déjà en service) | Aucun |
| Toutes les autres | Fichier d'export déposé sur la page, ou envoyé chaque jour par e-mail | Une adresse Gmail gratuite (étape 2) |

Chaque nouvelle caisse reste **à confirmer avec le premier boulanger** qui l'utilise : je l'ai testée sur des réponses simulées conformes à la documentation officielle, pas sur un vrai compte.

---

## 1. Mettre en service (avec moi, 15 minutes)

Rien n'est encore en ligne. Quand tu me donnes ton accord, dans cet ordre :

1. **Base de données** : Supabase > projet **anti-gaspi** > **SQL Editor** > coller `migration-connecteurs-caisse-v4.sql` > **Run**. Elle peut être relancée sans risque.
2. **Les trois fonctions** (je peux le faire pour toi) :
   `supabase functions deploy connecter-caisse --no-verify-jwt`, puis la même chose pour `synchro-caisse` et `import-export-caisse`.
3. **Vérifier le secret `CLE_CHIFFREMENT_CAISSE`** dans Supabase > Edge Functions > Secrets. S'il manque : `openssl rand -base64 32`, et le garder précieusement (le changer oblige à rebrancher toutes les caisses).

Tant que ce n'est pas fait, la page **Ma caisse** affiche « bientôt » pour les nouvelles caisses, et l'import de fichier marche normalement.

## 2. L'envoi automatique par e-mail, gratuit (10 minutes)

Remplace Postmark : une boîte Gmail ordinaire reçoit les exports, un petit script Google la relève toutes les 10 minutes.

1. Crée une adresse Gmail **dédiée**, par exemple `apoint.ventes@gmail.com` (pas ta boîte perso).
2. Connecté avec elle, va sur **script.google.com** > **Nouveau projet**. Efface le contenu et colle le fichier `supabase/functions/import-export-caisse/relais-gmail.gs`.
3. Roue dentée **Paramètres du projet** > **Propriétés du script** > ajoute `URL_IMPORT` avec pour valeur le contenu du fichier `adresse-webhook-postmark.txt` de ton Bureau (l'adresse de la fonction avec `?cle=…`).
4. Reviens à l'éditeur, choisis la fonction **installer** et clique sur **Exécuter**. Accepte les autorisations Gmail (Google prévient que l'app n'est pas vérifiée : c'est ton propre script, clique sur « Paramètres avancés » puis « Accéder »).
5. Dans Supabase > Edge Functions > Secrets, mets `ADRESSE_IMPORT` = `apoint.ventes@gmail.com`.

Le bouton « Obtenir mon adresse d'import » apparaît alors pour les boulangers : chacun reçoit `apoint.ventes+<code>@gmail.com`.

## 3. Plus tard, en option : les boutons « Brancher » (OAuth)

Un seul clic pour le boulanger au lieu de coller une clé, mais il faut un compte développeur à ton nom chez chaque caisse (SumUp demande un compte professionnel). À faire quand tu auras ton entreprise. Le bouton reste caché tant que les secrets manquent.

| Caisse | Où créer l'app | Secrets à ajouter dans Supabase |
|---|---|---|
| SumUp | me.sumup.com > Paramètres > Pour les développeurs | `SUMUP_CLIENT_ID`, `SUMUP_CLIENT_SECRET` |
| Zettle | developer.zettle.com | `ZETTLE_CLIENT_ID`, `ZETTLE_CLIENT_SECRET` |
| Square | developer.squareup.com | `SQUARE_CLIENT_ID`, `SQUARE_CLIENT_SECRET` |

Adresse de redirection, la même pour toutes : `https://eqvbksxfwlgbcxgqljqn.supabase.co/functions/v1/connecter-caisse`

## Ce que voit le boulanger

- **SumUp, Zettle, Square, Loyverse, Tactill, Hiboutik** : la marche à suivre dans sa caisse, un champ pour coller sa clé, puis ses 12 derniers mois arrivent tout seuls, et chaque nuit les ventes de la veille.
- **Toute autre caisse** : il dépose son fichier d'export ; les colonnes sont reconnues seules (il peut les choisir sinon) et il voit un aperçu avant d'importer. Puis, si sa caisse sait le faire, l'envoi quotidien vers son adresse d'import.
- Dans tous les cas, la page **Ma caisse** montre l'état (à jour, en retard, erreur) et le journal de chaque réception. Sa clé est chiffrée sur nos serveurs et n'est jamais réaffichée.
