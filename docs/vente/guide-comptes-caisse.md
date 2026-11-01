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
| Toutes les autres | Historique déposé une seule fois, puis envoi automatique chaque jour par e-mail depuis la caisse | Ta boîte apointapp.contact@gmail.com et un script de 10 minutes (étape 2) |

Chaque nouvelle caisse reste **à confirmer avec le premier boulanger** qui l'utilise : je l'ai testée sur des réponses simulées conformes à la documentation officielle, pas sur un vrai compte.

---

## 1. Mettre en service (l'orchestrateur, avec ton accord)

Migration v4 et fonctions sont en ligne. Pour ce lot, il reste à redéployer `connecter-caisse`, `synchro-caisse` et `import-export-caisse` (aucune migration), puis à régler deux secrets dans Supabase > Edge Functions > Secrets :

- `ADRESSE_IMPORT` = `apointapp.contact@gmail.com`
- `CLE_IMPORT_EMAIL` : s'il n'existe pas encore, une suite au hasard (`openssl rand -hex 24`). L'orchestrateur te donne l'adresse complète à coller à l'étape 2.4.

## 2. L'envoi automatique par e-mail, gratuit (moins de 10 minutes)

Tu gardes ta boîte **apointapp.contact@gmail.com**. Chaque boulanger reçoit une adresse à lui, du type `apointapp.contact+caisse-3f9a…@gmail.com` : Gmail la livre dans ta boîte habituelle. Un petit script Google, installé une fois, relève ces e-mails toutes les 10 minutes, envoie les fichiers à À Point, puis les range sous l'étiquette « A Point ventes ». **Ton courrier normal n'est jamais touché** (ni lu, ni déplacé). Aucun filtre Gmail à créer.

1. Sur un ordinateur, connecté à **apointapp.contact@gmail.com**, ouvre **script.google.com** et clique sur **Nouveau projet**.
2. Efface tout le texte de l'éditeur, puis colle le contenu du fichier `supabase/functions/import-export-caisse/relais-gmail.gs` (je te l'envoie si besoin). Clique sur l'icône **disquette** pour enregistrer ; nomme le projet « A Point ventes ».
3. À gauche, clique sur la **roue dentée** (Paramètres du projet), descends jusqu'à **Propriétés du script**, puis **Ajouter une propriété du script** :
   - Propriété : `URL_IMPORT`
   - Valeur : `https://eqvbksxfwlgbcxgqljqn.supabase.co/functions/v1/import-export-caisse?cle=` suivi de la valeur du secret `CLE_IMPORT_EMAIL`.
   Clique sur **Enregistrer les propriétés du script**.
4. À gauche, reviens sur **Éditeur** (icône `< >`). En haut, dans la liste des fonctions, choisis **installer**, puis clique sur **Exécuter**.
5. Google demande une autorisation : **Examiner les autorisations** > choisis ton compte > « Google n'a pas validé cette application » : **Paramètres avancés** > **Accéder à A Point ventes (non sécurisé)** > **Autoriser**. C'est normal : c'est ton propre script.
6. C'est fini. Pour vérifier : menu de gauche **Déclencheurs** (icône réveil), une ligne « relayer, toutes les 10 minutes » doit apparaître.

Pour l'arrêter un jour : **Déclencheurs** > les trois points > **Supprimer le déclencheur**.

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
- **Toute autre caisse** : il dépose une seule fois son historique (colonnes reconnues seules, aperçu avant d'importer), puis règle dans sa caisse l'envoi automatique quotidien vers son adresse (mode d'emploi pas à pas pour Lightspeed ; pour les autres caisses, un message prêt à envoyer à son éditeur). Plus jamais de fichier à déposer.
- Dans tous les cas, la page **Ma caisse** montre l'état (à jour, en retard, erreur) et le journal de chaque réception. Sa clé est chiffrée sur nos serveurs et n'est jamais réaffichée.
