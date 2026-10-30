# Connecteurs caisse — étude et choix du premier branchement

Objectif (REFONTE.md § 4 bis) : les ventes par article arrivent seules chaque nuit dans `ventes`, sans saisie.
Étude faite le 30 octobre 2026 à partir des documentations officielles quand elles existent. Les conditions commerciales changent : à revérifier avant signature.

## Tableau comparatif

| Caisse | API publique | Authentification | Ventes par article et par jour | Coût / accès partenaire | Verdict |
|---|---|---|---|---|---|
| **SumUp** (app de caisse SumUp + terminal) | Oui, doc publique complète | OAuth 2.0 (code d'autorisation + refresh token) ; clé API `sup_sk_…` pour son propre compte | Oui : `GET /v2.1/merchants/{code}/transactions/history` (filtres `oldest_time` / `newest_time`), puis le détail de chaque transaction (`GET /v2.1/merchants/{code}/transactions?id=…`) renvoie `products[]` avec `name` et `quantity` | Gratuit. Création d'app OAuth en libre-service ; seul le scope `payments` demande une validation manuelle par SumUp (on n'en a pas besoin : `transactions.history` est accordé par défaut) | **Premier connecteur** |
| **Zettle** (PayPal) | Oui | OAuth 2.0 (code d'autorisation pour une app publique, assertion pour son propre compte) | Oui, le plus simple : `GET https://purchase.izettle.com/purchases/v2?startDate=…&endDate=…` renvoie directement `products[]` (`name`, `quantity`) dans la liste, jusqu'à 1 000 achats par page, 3 ans d'historique ; remboursements en quantité négative | Gratuit, compte développeur sur le portail Zettle | Deuxième connecteur (code très proche) |
| **Square** | Oui | OAuth 2.0, permission `ORDERS_READ` | Oui : `POST /v2/orders/search` avec filtre `closed_at`, commandes complètes avec `line_items` (nom, quantité), jusqu'à 1 000 par page | Gratuit (compte développeur) | Faisable, mais peu présent en boulangerie française |
| **Lightspeed** (Restaurant K-Series) | Oui, mais réservée aux partenaires | OAuth 2.0 (code d'autorisation) | Oui : endpoints « Financial » (ventes d'une journée d'activité, par établissement) | Accès après candidature au programme partenaire et validation par un Partner Manager ; environnement de démo `api.trial.lsk.lightspeed.app` | Plus tard (dossier partenaire à monter) |
| **Hiboutik** | Oui, REST/JSON, activable par le commerçant | Basic (compte + utilisateur + clé API) ou OAuth | Oui (ventes et lignes de vente) ; pas d'historique antérieur à l'abonnement | Inclus dans l'abonnement Hiboutik, le commerçant active l'API lui-même | Bon candidat « clé API » : le commerçant colle sa clé dans Paramètres |
| **Tactill** | API mentionnée mais **pas de documentation publique trouvée** | Inconnue | Inconnue ; export des ventes et rapport quotidien par e-mail disponibles | API réservée à la formule haute (≈ 79 € HT/mois selon des comparatifs, à confirmer) | Repli export e-mail ; contacter Tactill |
| **Toporder** (myPOS) | **Aucune doc publique trouvée** | — | — ; intégrations existantes : comptabilité (Pennylane, Cegid, Sage), e-commerce | Contact commercial nécessaire | Repli export e-mail |
| **Crisalid** (ALIRIS) | **Aucune doc publique trouvée** | — | Logiciel installé en local (Windows + base Firebird) | Contact commercial nécessaire | Repli export e-mail |
| **Bimedia** (groupe Orisha) | **Aucune doc publique trouvée** | — | — | Contact commercial / partenariat Orisha nécessaire | Plus grosse base en boulangerie (≈ 7 000 clients d'après les comparatifs) : **ouvrir la discussion partenariat dès maintenant**, repli export e-mail en attendant |

## Recommandation : SumUp d'abord

1. **Facilité** : seules SumUp, Zettle et Square offrent une API publique, gratuite, en OAuth libre-service. Les caisses spécialisées boulangerie (Bimedia, Crisalid, Toporder) n'en publient aucune ; Lightspeed exige un dossier partenaire.
2. **Présence chez nos cibles** : parmi les trois caisses ouvertes, SumUp est la plus répandue chez les petits commerçants français indépendants (terminal + app de caisse gratuite), donc chez les boulangeries indépendantes qui n'ont pas de caisse « métier ». Je n'ai pas trouvé de chiffre public de part de marché en boulangerie par marque : ce point reste à confirmer sur les 10 boulangeries pilotes (leur demander leur caisse dès l'inscription).
3. **Limite à connaître** : SumUp ne donne le détail par article que si le boulanger encaisse avec le catalogue produits de l'app SumUp (pas en « montant libre »). La liste des transactions ne contient pas les articles : il faut un appel de détail par ticket (≈ 300 à 600 appels par nuit et par boulangerie), géré par la synchro.
4. **Zettle ensuite** : son API renvoie les articles dès la liste, le connecteur se branche sur la même table et la même fonction d'enregistrement, en une demi-journée.
5. **En parallèle, hors code** : écrire à Bimedia/Orisha pour un accès partenaire (c'est là qu'est la masse des boulangeries), et proposer le repli « export par e-mail » à tous les autres.

## Repli pour les caisses sans API : export envoyé par e-mail

Presque toutes ces caisses savent envoyer un export ou un rapport des ventes par e-mail (CSV). Chaque commerçant reçoit une adresse personnelle (adresse de réception Postmark suivie de `+<jeton>`, plus tard `ventes+<jeton>@import.apointapp.fr` avec un enregistrement MX) à mettre en destinataire de l'export automatique de sa caisse. Un service d'e-mail entrant (Postmark Inbound, offre gratuite limitée à 100 e-mails par mois) transmet chaque e-mail à l'Edge Function `import-export-caisse`, qui lit la pièce jointe CSV, reconnaît les colonnes produit / quantité / date et enregistre les ventes avec le même dédoublonnage que la synchro.

## Architecture livrée

- `migration-connecteurs-caisse.sql` : tables `connexions_caisse` (visible par le commerçant) et `connexions_caisse_secrets` (jetons, service role uniquement), `etats_oauth_caisse` (anti-CSRF), colonne `ventes.source`, fonctions `normaliser_nom_produit` et `enregistrer_ventes_caisse` (dédoublonnage par commerçant, nom normalisé, date), tâche pg_cron nocturne (à activer).
- `supabase/functions/connecter-caisse` : démarrage OAuth, retour OAuth, déconnexion, synchro immédiate.
- `supabase/functions/synchro-caisse` : synchro nocturne de toutes les connexions actives.
- `supabase/functions/import-export-caisse` : repli par e-mail.
- `supabase/functions/_shared/caisse/` : code commun testé (`node tests/caisse.test.mjs`).
- `connecteur-caisse.js` + bloc `#blocCaisse` dans `parametres.html`.

Mise en service et tests : voir `supabase/functions/README-caisse.md`.

## Sources

- SumUp — OAuth 2.0 et scopes : https://developer.sumup.com/tools/authorization/oauth
- SumUp — liste des transactions : https://developer.sumup.com/api/transactions/list/
- SumUp — détail d'une transaction (`products`) : https://developer.sumup.com/api/transactions/get/
- SumUp — documentation complète : https://developer.sumup.com/llms-full.txt
- Zettle — Purchase API : https://github.com/iZettle/api-documentation/blob/master/purchase.adoc et https://developer.zettle.com/docs/api/purchase/overview
- Zettle — OAuth : https://github.com/iZettle/api-documentation/blob/master/authorization.md
- Square — SearchOrders : https://developer.squareup.com/reference/square/orders-api/search-orders
- Square — Orders API : https://developer.squareup.com/docs/orders-api/what-it-does
- Lightspeed K-Series — référence API : https://api-docs.lsk.lightspeed.app/ et portail https://api-portal.lsk.lightspeed.app/
- Lightspeed K-Series — accès partenaire (intégrateur tiers) : https://docs.codat.io/integrations/commerce/lightspeed-k/commerce-lightspeed-k-setup
- Hiboutik — page développeurs : https://www.hiboutik.com/en/api-developers/ ; librairie officielle (auth basic / OAuth) : https://github.com/hiboutik/hiboutikapi
- Hiboutik — limite d'historique (intégrateur Chift) : https://docs.chift.eu/help/connectors/pos/hiboutik
- Tactill — formules et API (comparatifs, non officiel) : https://tool-advisor.fr/logiciel-de-caisse/comparatif/tactill/ et https://independant.io/avis/tactill/
- Toporder — intégrations : https://www.mypos.com/fr-fr/appmarket/application/26948 et https://www.lafabriquedunet.fr/logiciel/toporder-by-mypos
- Crisalid — produit et installation locale : https://www.hellopro.fr/crisalid-167832-profil-fr-societe.html
- Bimedia — positionnement boulangerie et nombre de clients (comparatif, non officiel) : https://tool-advisor.fr/logiciel-de-caisse/comparatif/logiciel-de-caisse-boulangerie/
