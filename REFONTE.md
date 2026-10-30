# Refonte À Point — plan

Décisions validées (30 oct. 2026) :
- **Cible : boulangeries indépendantes uniquement.** Tout le vocabulaire, les exemples, les écrans et la page de vente parlent boulangerie : fournées, baguettes, viennoiseries, pâtisseries, snacking du midi. Plus aucune mention de restaurant, plat du jour, burger, menu.
- **Branchement direct sur la caisse = la fonction phare** : zéro saisie manuelle. C'est ce qui différencie À Point (voir § 4 bis).
- **Planning + espace employé : masqués** (retirés de la navigation, fichiers conservés).
- **Design : moderne et tech.**
- **Affluence : API gratuites d'abord**, BestTime plus tard si les pilotes le demandent. Pas de scraping Google Maps (contraire aux CGU, fragile).

## 1. Navigation (avant 7 onglets + 2 liens → après 5)

| Onglet | Contenu | Remplace |
|---|---|---|
| **Demain** | Quantités à produire pour le prochain jour ouvert, en grand, + bouton « Préparer la commande » | Accueil, Prévisions (jour) |
| **Semaine** | 7 jours, badge d'affluence par jour, événements signalés | Prévisions (semaine), semaine.html |
| **Ventes** | Saisie d'hier + import de fichier sur une seule page | Mes ventes, Imports |
| **Produits** | Liste, prix, fiche technique optionnelle | Produits vendus |
| **Bilan** | € économisés, invendus évités, précision, jours records | Statistiques + bloc résultats de l'accueil |

Paramètres, Aide et Achats & commandes passent dans le menu du compte.
Planning (`personnel.html`) et Espace employé (`espace-employe.html`) : retirés de `nav.js`, fichiers gardés.

## 2. Design « moderne et tech »

- Fond neutre clair, mode sombre, une seule couleur d'accent vive.
- Police sans serif unique (ex. Inter), chiffres tabulaires.
- Un grand chiffre par produit, moins de texte, explications repliées.
- Composants : carte, chiffre clé, pastille, bouton, tableau. Un seul `style.css` à jetons (`--couleur-*`, `--espace-*`).
- Mobile d'abord : le boulanger consulte sur téléphone à 5 h du matin.

## 3. Page de vente (`index.html`, aujourd'hui une simple redirection)

Promesse, capture, « comment ça marche » en 3 étapes, prix affiché, FAQ, inscription.
Texte : skill Website Copywriting. Aucune preuve ni témoignage inventés.

## 4. Données et API (après la refonte visuelle)

| Signal | Source | Coût | Priorité |
|---|---|---|---|
| Doublons à l'import | correction interne | — | 1 |
| Ventes directement depuis la caisse | API SumUp, Zettle, Square | gratuit | 1 |
| Événements locaux (fêtes, marchés, concerts) | OpenAgenda | gratuit (clé) | 2 |
| Matchs (affluence des soirs de match) | football-data.org | gratuit | 3 |
| Météo, fériés, vacances scolaires | déjà en place | — | — |
| Affluence par lieu et par heure | BestTime.app | à partir d'environ 29 $/mois | plus tard |

## 4 bis. Branchement caisse (chantier séparé, après la refonte)

Objectif : les ventes arrivent seules chaque nuit, le boulanger ne saisit plus rien.

- Caisses courantes en boulangerie : Bimedia (≈ 7 000 clients boulangerie), SumUp, Lightspeed, Hiboutik, Tactill, Toporder, Crisalid, Square, Zettle.
- Par caisse : vérifier l'API publique (OAuth ou clé), l'accès aux ventes par article, le coût et l'accès partenaire.
- Architecture : une Edge Function Supabase par connecteur, synchro nocturne vers `ventes`, dédoublonnage par (commerçant, produit normalisé, date).
- Repli si une caisse n'a pas d'API : import automatique de l'export envoyé par e-mail.
- La refonte doit déjà prévoir dans Paramètres un bloc « Connecter ma caisse » et, sur Ventes, l'état de la synchro.

## 5. Ce qui en fait un produit qui se vend

1. Afficher des **euros économisés**, pas des pourcentages.
2. **Import fait pour le client** à l'inscription : 0 saisie le premier jour.
3. **Branchement caisse** : plus de saisie quotidienne.
4. Prix simple : 29 à 39 €/mois, premier mois offert.
5. Validation sur 10 boulangeries pilotes avant d'ajouter des fonctions.
