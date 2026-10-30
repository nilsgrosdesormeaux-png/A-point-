# À Point — analyse page par page et plan v2

Analyse faite le 30 oct. 2026 sur apointapp.fr, compte « Le petit comptoire ».
Principe directeur : **rien de manuel quand la machine peut le faire.** Le boulanger ouvre l'appli, voit quoi enfourner et quoi commander, et c'est tout.

## Constats

| Page | Ce qui ne va pas |
|---|---|
| **Demain** | 11 cartes en vrac par ordre alphabétique, sans regroupement Pains / Viennoiseries / Pâtisseries / Snacking. Le badge « +8 » n'est pas expliqué. Les catégories se créent à la main (« + Catégorie »). « Pourquoi cette prévision ? » ne dit que le jour, le nombre de samedis et les vacances : rien sur la météo, aucun événement. La fiabilité « 88 % contre 87 % » dessert l'outil. |
| **Semaine** | Copie de Demain avec une barre de 7 jours au-dessus. N'apporte rien de plus. |
| **Ventes** | 100 % manuel : saisie produit par produit avec −/+ et import de fichier. L'icône en barres fait croire à des statistiques. |
| **Produits** | Création, renommage, rangement par glisser-déposer et fiches techniques : tout est à la main. |
| **Bilan** | Une grosse carte sombre « 0 € » en premier (aucun prix connu). « Ce mois-ci : pas encore de ventes ». Les invendus évités sont calculés face à une « production à l'instinct » théorique. |
| **Commandes** | Caché dans le menu du compte. Unités illisibles (« 65500 g » de salade). Ingrédients de restaurant. Pas de regroupement par fournisseur, pas d'envoi. |
| **Paramètres** | Le bloc caisse affiche « Bientôt disponible », normal tant que les comptes SumUp développeur et Postmark ne sont pas créés. |
| **Calculs** | Seuls la météo, les fériés et les vacances scolaires sont pris en compte. Les API d'événements et de matchs prévues n'ont jamais été branchées. |

## Nouvelle navigation (4 onglets)

| Onglet | Rôle |
|---|---|
| **Fournée** (ex-Demain) | Quoi enfourner demain, par rayon, en mode liste à cocher |
| **Commande** | Quoi commander, par fournisseur, prêt à envoyer |
| **Semaine** | Les 7 jours d'un coup d'œil : affluence, raisons, totaux |
| **Bilan** | Ce que l'appli a fait gagner, en euros et en kilos de pain |

**Ventes** et **Produits** quittent la navigation. Les ventes arrivent de la caisse ; la saisie et l'import restent en secours dans Paramètres > « Mes données », pour qui n'a pas encore de caisse branchée. Les produits se créent seuls à partir des ventes.

## Page par page

### Fournée (ex-Demain)
- Regroupement **automatique** par rayon (Pains, Viennoiseries, Pâtisseries, Snacking, Boissons), déduit du nom du produit (baguette → Pains, croissant → Viennoiseries…). Plus de « + Catégorie ».
- Une ligne par produit : nom, grand chiffre, petite flèche ↑/↓ avec « +8 vs samedi dernier » en clair.
- Case à cocher par ligne (« enfourné »), gardée pour la journée : la page devient la feuille de fournil.
- En haut, **3 raisons maximum** sous forme de pastilles avec leur effet : « ☀️ Beau temps +6 % », « 🏖️ Vacances −10 % », « 🎉 Marché de Noël +15 % ».
- « Pourquoi ? » par produit : chaque signal et son effet chiffré.
- Fiabilité reformulée en unités : « D'habitude, on tombe à ±4 baguettes près ». La comparaison avec la moyenne simple n'apparaît que si l'écart dépasse 3 points.
- Mode « Écran fournil » : plein écran, gros caractères, lisible avec les mains dans la farine.

### Commande (nouvel onglet)
- Besoins en matières premières calculés depuis la production prévue, grâce à une **bibliothèque de recettes boulangères pré-remplie** (baguette, tradition, croissant, pain au chocolat, brioche…). Le boulanger ne fait qu'ajuster.
- Regroupement par fournisseur (meunier, crémier, épicerie), unités lisibles (kg, L, plaques).
- Stock restant optionnel (« il me reste 2 sacs ») qui se soustrait.
- Envoi en un clic : PDF, e-mail ou WhatsApp au fournisseur.
- Rappel des jours de livraison de chaque fournisseur.

### Semaine
- Tableau produits × 7 jours, plus une barre d'affluence par jour avec sa raison (férié, pont, vacances, événement, match, météo).
- Totaux de la semaine, pour anticiper la commande.
- Plus de copie de Demain.

### Bilan
- En tête : **euros économisés** (invendus évités × prix de vente venu de la caisse) et **kilos de pain sauvés**. Si aucun prix n'est connu, afficher les pièces, jamais « 0 € ».
- Tendance semaine après semaine.
- Jours records et top produits gardés, mais plus bas.

## Signaux à brancher (tous gratuits)

| Signal | Source | Clé ? | Pourquoi c'est fort en boulangerie |
|---|---|---|---|
| **Calendrier boulanger** (Épiphanie, Chandeleur, Pâques, fête des Mères, Noël, rentrée) | calcul interne | non | Les galettes, les crêpes, les bûches : personne ne le fait |
| **Ponts** (vendredi après un jeudi férié…) | calcul interne | non | Forte baisse ou hausse selon le quartier |
| Événements locaux (marchés, fêtes, brocantes, concerts) | OpenAgenda | gratuite, à créer | Pics d'affluence ponctuels |
| Matchs (Ligue 1, Bleus) | football-data.org | gratuite, à créer | Sandwichs et baguettes du soir |
| Météo matin, midi et soir | Open-Meteo (déjà là) | non | À rendre visible dans « Pourquoi » |
| Fériés et vacances scolaires | déjà là | non | À rendre visible |

Chaque signal doit être **appris sur l'historique du commerce**, comme la météo aujourd'hui (« tes samedis de pluie vendent −12 % »), puis affiché avec son effet chiffré. Les clés passent par une Edge Function, jamais dans le navigateur.

## Ordre de réalisation

1. Moteur : calendrier boulanger, ponts, affichage de tous les signaux dans « Pourquoi », fiabilité en unités.
2. Fournée : rayons automatiques, liste à cocher, pastilles de raisons, écran fournil.
3. Commande : onglet dédié, recettes pré-remplies, fournisseurs, envoi.
4. Semaine et Bilan refaits.
5. Navigation à 4 onglets ; Ventes et Produits dans Paramètres > Mes données.
6. OpenAgenda et football-data (dès que les clés sont créées).
