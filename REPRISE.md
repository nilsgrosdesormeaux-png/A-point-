# Reprise — état au 2 nov. 2026 (session cloud)

Publié sur main : jusqu'à f809f6c (lot 10). Tout le reste est sur la branche `claude/travail-en-cours`, NON publié.

## Fini sur la branche (tests au vert : run.js 116/0, moteur 38/38, commandes-clients 25/25)
- Design « pas fait par IA » (index, vente.css, aide, connexion, style.css, images/). Paragraphe « Pourquoi À Point » à relire par Nils (`<!-- À RELIRE PAR NILS -->`).
- Retours fondateur lot 11 : prénom dans Paramètres, Semaine colorée selon la charge, Bilan replié (« Voir le calcul »), repli « Je sais quelque chose » stabilisé (à vérifier sur iPhone).
- Moteur : alerte-rupture.js (0 fausse alerte / 300 jours simulés, 37 % des ruptures annoncées ~4 h 30 avant), saison galette apprise, fêtes mobiles, congés/réouverture, fériés ouverts/fermés, périodes exceptionnelles, vacances jusqu'à été 2027 + API éducation (non vérifiée).
- Pages : bandeau alerte rupture, quantité de départ produits saisonniers, bloc Fermetures dans Paramètres.
- Commandes clients (commandes-clients.html/.js) : saisie ~18 s, variantes bûches, retraits du jour, récurrentes (hors vacances), rôles patron/associé/vendeuse/apprenti en RLS, hors connexion, rappels annuels.
- Caisses lot 11 : liste sans doublon, liens vérifiés, Zelty et Popina (clé), détection de la caisse par la clé. docs/vente/partenariats-caisses.md (couverture estimée 10-25 %).

## Interrompu (limite hebdo) — à reprendre
1. Agent caisse lot 12 : Lightspeed Retail (clé), photo du rapport (Edge Function `lire-ticket`, Claude vision, secret ANTHROPIC_API_KEY), table `ventes_horaires` + synchro horaire 6 h-20 h, boîte e-mail universelle (CSV/Excel/PDF/photo/corps) relevée toutes les 30 min 12 h-23 h + 4 h, rapports « à confirmer ». En était à la migration v6. Tests caisse : 3 échecs dans caisse.test.mjs, 1 dans caisse-fonctions.test.mjs (en cours de modif).
2. Commandes clients : FAIT et vérifié le 2 nov. (code de main, aucun changement nécessaire). Employé (vendeuse) : `contexte.charger()` passe par `boutiqueDe()` et charge la boutique du patron (nom, 10 produits, onglets et invitations caisse masqués) ; Commande matières : `productionDuJour()` ajoute les pièces réservées (3 × 100 baguettes tradition : farine T65 de 92,2 kg à 140,2 kg, soit 4 sacs → 6). Vérifié avec un faux Supabase ; la vraie base (RLS) n'est pas vérifiée tant que migration-commandes-clients.sql n'est pas appliquée. Tests : tests/commandes-clients.test.mjs et caisse-migration.test.mjs n'ont pas pu tourner ici (playwright et @electric-sql/pglite absents).
3. Vérification finale : boulanger sur une année entière (patron/vendeuse/apprenti) + testeur UX complet, puis corrections.

## À déployer avec l'accord du fondateur (rien n'est appliqué)
- Migrations : migration-commandes-clients.sql (tables commandes_clients, historique, catalogue ; colonne personnel.acces_app ; fonctions role_boutique et commandes_production ; policies vendeuse / apprenti / associé ; sans elle, les employés ne voient pas la boutique du patron et les commandes restent en file sur l'appareil), migration-parametres-v3.sql, migration-connecteurs-caisse-v5.sql (+ v6 caisse à finir).
- Fonctions : connecter-caisse, synchro-caisse, import-export-caisse (+ lire-ticket, signaux-locaux).
- Secrets : ADRESSE_IMPORT=apointapp.contact@gmail.com seulement APRÈS installation du script Gmail ; CLE_IMPORT_EMAIL ; ANTHROPIC_API_KEY.
- Compte démo : observation_debut remis à null (fait).

## Pour le fondateur
Script Gmail (guide docs/vente/guide-comptes-caisse.md), clé API Anthropic, relire le mot signé Nils, branche `claude/travail-en-cours` (supprimable après fusion).
