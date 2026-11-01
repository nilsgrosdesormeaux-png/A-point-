# À Point : feuille de route « valeur » (nov. 2026)

**Le constat.** Un boulanger testeur paierait 15 €/mois, pas 29 €. Pour lui, l'outil aide sans changer sa journée. Pour justifier 29 €, À Point doit rapporter au moins 10 fois son prix, et le montrer.

**Boulangerie type retenue** (hypothèses prudentes) : 250 baguettes par jour, 1 100 € de chiffre d'affaires par jour, 26 jours ouverts par mois (28 600 €/mois). Les matières font 30 % du chiffre. On gagne 0,70 € sur chaque pièce vendue en plus, et chaque invendu coûte 0,35 €. Une heure du patron vaut 25 €.

## 1. Ce que le calcul prend en compte depuis cette version

| Signal | Statut | Ce que ça change |
|---|---|---|
| Ruptures (« Épuisé » coché, ou tout le cuit vendu) | **ajouté** | Ces jours-là, la vente sous-estime la demande. Le moteur estime la vraie demande : jours comparables, ou heure de la dernière vente quand la caisse la donne. |
| Veille de jour férié, Saint-Valentin | **ajouté** | L'effet est appris sur les ventes de la boutique. |
| Saison (creux d'août, montée de décembre) | **ajouté** | Elle est apprise sur l'an dernier, dès 12 mois d'historique. |
| Tendance des 3 dernières semaines | **ajouté** | On n'applique que la moitié de l'écart, et au plus ±12 %. |
| Produit nouveau un jour de fête | **ajouté** | Il reçoit la moitié de l'effet observé sur toute la boutique. |
| Événements locaux sans compte (données ouvertes OpenAgenda) | **ajouté** | Marchés, brocantes et fêtes à moins de 2 km. |
| Météo, fériés, ponts, vacances, galettes, Pâques, fête des Mères, Noël | déjà là | — |

Sur une boulangerie simulée de 22 mois (5 produits, ruptures fréquentes), l'écart moyen avec la vraie demande passe de **13,5 à 12,2 pièces par produit et par jour (−9 %)**. Il descend à 11,8 (−12 %) quand la caisse fournit l'heure de la dernière vente.

**Écartés.** L'affluence Google Maps n'a pas d'API officielle, aller la lire sur les pages Google est interdit par leurs conditions, et les revendeurs (BestTime et autres) sont payants. Surtout, la caisse mesure déjà la fréquentation réelle de la boutique. Les jours de marché hebdomadaires sont déjà dans l'historique du même jour de semaine. Les grèves n'ont pas de source fiable et gratuite. Les jours de paie (début de mois) ont un effet trop faible pour se distinguer du hasard en boulangerie : à réévaluer après 12 mois de données.

## 2. Les 5 fonctions qui justifient 29 €/mois

Elles sont classées par valeur pour le boulanger. L'effort est celui de l'équipe.

| # | Fonction | Ce que le boulanger y gagne | €/mois (prudent) | Effort |
|---|---|---|---|---|
| 1 | **Alerte rupture et réassort dans la journée** (« la tradition partira vers 16 h, relance 30 pièces à 14 h ») | Il manque 1,5 % de ventes l'après-midi (430 €) ; l'alerte en sauve un tiers, avec 0,70 € gagné par pièce, soit environ **100 €**. Les fournées du soir sont plus justes : moins d'invendus, environ **30 €**. | **≈ 130 €** | Moyen : il faut les ventes heure par heure depuis la caisse |
| 2 | **Marge par produit et hausse des matières** (« ton croissant rapporte 0,31 €, le beurre a pris 12 % : passe à 1,40 € ») | On repère 1 ou 2 produits peu rentables et on suit la hausse du beurre au lieu de l'encaisser 3 mois : environ 0,4 % du chiffre. | **≈ 110 €** | Faible : les prix viennent de la caisse, les recettes existent |
| 3 | **Commande fournisseurs prête et envoyée** (meunier, crémier, le bon jour) | 1 h 30 par mois de calcul et d'appels (≈ 40 €), moins de beurre et de crème perdus (≈ 30 €). | **≈ 70 €** | Moyen : il faut l'envoi par e-mail (compte Postmark) |
| 4 | **Fêtes et commandes spéciales** (galettes, bûches, Pâques, commandes prises en boutique) | En janvier, 5 % de galettes en trop ou en moins (600 galettes) représentent 150 à 300 €. Lissé sur l'année, avec Noël et Pâques : | **≈ 50 €** | Faible : le calendrier est fait, il reste un carnet de commandes |
| 5 | **Résumé du soir par SMS ou WhatsApp** (« demain : 262 baguettes, pluie −6 %, commande meunier envoyée ») | 5 minutes par jour sans ouvrir l'appli, environ **50 €**. Surtout, c'est l'habitude qui fait servir les 4 autres fonctions. | **≈ 50 €** | Faible pour le SMS (environ 0,05 € par message) ; WhatsApp demande un compte Meta Business |

**Total prudent : environ 400 € par mois, soit 14 fois le prix de 29 €.** À afficher chaque mois dans le Bilan, en euros, ligne par ligne.

**Plus tard.** La comparaison anonyme avec des boulangeries similaires sert peu tant qu'il n'y a pas au moins 30 boulangeries par type de quartier.

**Ordre conseillé.** D'abord 2 et 5, peu d'effort et une valeur visible tout de suite. Ensuite 3, puis 1 dès que la caisse remonte l'heure des ventes. La 4 doit être prête avant les galettes : à livrer avant le 15 décembre.
