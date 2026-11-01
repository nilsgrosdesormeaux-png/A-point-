# Brancher les caisses : les comptes à créer (guide du fondateur)

Tout le reste est prêt et en ligne : la page **Ma caisse**, l'import de fichier, Hiboutik et le journal des réceptions marchent déjà. Il ne manque que trois comptes, que toi seul peux créer. Compte une heure en tout. Fais-les dans l'ordre : le 2 a besoin du 1.

| Compte | À quoi il sert | Prix |
|---|---|---|
| 1. ImprovMX | Crée l'adresse contact@apointapp.fr, qui renvoie tout vers ton Gmail | Gratuit |
| 2. Postmark | Reçoit les fichiers de ventes que les caisses envoient chaque jour par e-mail (Bimedia, Crisalid, Toporder, Tactill…) | Gratuit jusqu'à 100 e-mails par mois |
| 3. SumUp développeur | Fait apparaître le bouton « Brancher ma caisse SumUp » | Gratuit |

Garde pour toi les deux fichiers posés sur ton Bureau : `cles-a-point-caisse.txt` et `adresse-webhook-postmark.txt`. Ils contiennent des clés secrètes.

---

## 1. L'adresse contact@apointapp.fr (ImprovMX)

Postmark refuse les adresses Gmail. Il faut une adresse à ton nom de domaine.

1. Va sur **improvmx.com**. Tape `apointapp.fr` dans le premier champ, et ton adresse Gmail dans le second. Crée le compte.
2. ImprovMX affiche deux lignes « MX » à recopier, en principe `mx1.improvmx.com` (priorité 10) et `mx2.improvmx.com` (priorité 20). Laisse cette page ouverte.
3. Dans un autre onglet, ouvre **Hostinger** (là où tu as acheté le nom de domaine). Va dans **Domaines**, puis **apointapp.fr**, puis **DNS / Zone DNS**.
4. Ajoute deux lignes : type **MX**, nom **@**, avec pour chacune la valeur et la priorité données par ImprovMX. Enregistre.
5. Reviens sur ImprovMX et clique sur **Check again**. Ça peut prendre de quelques minutes à une heure. Quand tout est vert, écris-toi un e-mail à contact@apointapp.fr : il doit arriver dans ton Gmail.

Le site n'est pas touché : ces lignes ne concernent que les e-mails.

## 2. La réception des e-mails de caisse (Postmark)

1. Va sur **postmarkapp.com** et inscris-toi avec **contact@apointapp.fr**. L'e-mail de confirmation arrive dans ton Gmail.
2. Sur la page **Servers**, clique sur **Create Server**. Nom : `A Point`. Si on te demande un type, choisis **Live**.
3. Dans le serveur, ouvre **Default Inbound Stream**, puis l'onglet **Settings**. Les deux autres « streams » servent à envoyer : ne t'en occupe pas.
4. En haut de la page, copie l'adresse qui finit par **@inbound.postmarkapp.com**, et **envoie-la-moi**. Elle n'est pas secrète.
5. Dans le champ **Webhook** de la même page, colle tout le contenu du fichier `adresse-webhook-postmark.txt` de ton Bureau. Clique sur **Save changes**.
6. Si Postmark te demande de « valider ton compte » ou d'ajouter un domaine d'envoi, tu peux passer : la réception marche sans.

Ensuite, je m'occupe du reste : je règle l'adresse, je fais un vrai test, et je vérifie qu'il apparaît dans le journal de **Ma caisse**. Le bouton « Obtenir mon adresse d'import » apparaît alors pour les boulangers.

## 3. Le bouton « Brancher ma caisse SumUp » (SumUp développeur)

Il faut un compte SumUp. Ça peut être le tien, même sans terminal.

1. Connecte-toi sur **me.sumup.com**. Ouvre **Paramètres**, puis la rubrique pour les développeurs (**Pour les développeurs**, ou « Toolkit »).
2. Crée une **application OAuth**. Nom : `A Point`. Site : `https://apointapp.fr`.
3. Comme **adresse de redirection** (« Redirect URI »), colle exactement :
   `https://eqvbksxfwlgbcxgqljqn.supabase.co/functions/v1/connecter-caisse`
4. Crée les identifiants (« client credentials »). SumUp te donne deux codes : un **client ID** et un **client secret**.
5. Ouvre **supabase.com**, puis le projet **anti-gaspi**, puis **Edge Functions**, puis **Secrets**. Ajoute deux secrets, en recopiant les noms à la lettre :
   - `SUMUP_CLIENT_ID` = le client ID
   - `SUMUP_CLIENT_SECRET` = le client secret
6. C'est tout : le bouton apparaît tout seul sur la page **Ma caisse** pour les boulangers qui ont choisi SumUp. Préviens-moi, et je fais un essai avec ton compte.

Ne m'envoie pas le client secret par message : colle-le directement dans Supabase.

## Plus tard, si un boulanger en a besoin

Même principe que SumUp. L'adresse de redirection est la même, et seuls les noms des secrets changent :

| Caisse | Où créer l'app | Secrets à ajouter dans Supabase |
|---|---|---|
| Zettle | developer.zettle.com | `ZETTLE_CLIENT_ID`, `ZETTLE_CLIENT_SECRET` |
| Square | developer.squareup.com | `SQUARE_CLIENT_ID`, `SQUARE_CLIENT_SECRET` |

Hiboutik n'a besoin d'aucun compte : le boulanger colle lui-même sa clé sur la page **Ma caisse**.

## Ce que voit le boulanger une fois tout créé

- **SumUp, Zettle, Square** : un bouton « Brancher ». Ses 12 derniers mois arrivent tout seuls, puis chaque nuit les ventes de la veille.
- **Hiboutik** : il colle sa clé. Même résultat.
- **Toute autre caisse** : il dépose une fois son fichier d'export (12 mois), puis programme dans sa caisse l'envoi quotidien vers son adresse d'import.
- Dans tous les cas, la page **Ma caisse** montre l'état (à jour, en retard, erreur) et le journal de chaque réception.
