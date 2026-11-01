# Programme final — À Point prêt à présenter aux boulangers

Lancé le 1er nov. 2026 par le fondateur, avec un budget d'environ 100 $ de tokens. Objectif : une version **parfaite à présenter**, sans gaspiller. Règles « Économie » de `CLAUDE.md` obligatoires.

## Définition de « parfait » (critères de fin)

Le programme est terminé quand **tous** ces points sont vrais et vérifiés en ligne par les testeurs :

1. **Démo de 5 minutes sans accroc** sur le compte « Le petit comptoire », sur téléphone et sur ordinateur : inscription → caisse → Fournée → Commande → Semaine → Bilan, sans écran vide, sans chiffre absurde, sans mot technique.
2. **Chaque chiffre est explicable** à voix haute par le fondateur : il sait d'où il vient (mesuré, caisse, estimé, saisi) et c'est écrit à l'écran.
3. **Le testeur boulanger dit « je paie 29 € »**, avec une raison concrète.
4. **Le testeur UX ne trouve plus ni problème bloquant ni problème gênant** ; les problèmes mineurs sont listés et acceptés.
5. **Visuel homogène** sur toutes les pages (direction « Fournil »), y compris la page de vente, l'Aide, les CGU, la connexion et le mode fournil.
6. **Page de vente honnête et convaincante** : promesse, preuve (démo), prix 29 € avec garantie, FAQ, aucune affirmation non prouvée.
7. **Kit de présentation** prêt dans `docs/vente/` : script de démo de 5 minutes, réponses aux 10 objections les plus probables, fiche A4 imprimable, déroulé d'un pilote gratuit d'un mois.
8. **CGU et mentions légales** rédigées. Les seules zones laissées vides sont celles que le fondateur doit remplir lui-même (identité, SIRET), clairement signalées.
9. **Caisse** : le parcours de branchement et le journal fonctionnent ; ce qui manque ne dépend plus que de comptes à créer par le fondateur, avec un guide pas à pas.

## Équipe et circuit

| Agent | Rôle |
|---|---|
| Analyste investisseur | Chef de projet. Découpe en lots, envoie, juge, relance la boucle jusqu'aux critères. Seul à donner des consignes au développeur. |
| Refonte | Développeur de l'application (pages connectées, moteur, mode fournil). |
| Commercial et légal | Page de vente, Aide, CGU, mentions légales, kit `docs/vente/`. Ne touche pas aux pages de l'application. |
| Agent caisse | Branchement, journal, guide des comptes à créer. |
| Testeur UX (Sonnet) | Vérifie chaque mise en ligne, de bout en bout à la fin. |
| Testeur boulanger (Sonnet) | Juge l'utilité métier et le prix. |

Boucle : lot → mise en ligne → test ciblé → correction → … puis un **test complet final** des deux testeurs. Un agent nouveau n'est créé que si un manque précis le justifie ; l'analyste le propose au fondateur.

## Économie
- Pas de surveillance par minuterie ; on agit sur message.
- Tests ciblés sur ce qui a changé, sauf le passage final.
- Comptes rendus de 5 lignes ; au fondateur, uniquement les décisions et les étapes qui dépendent de lui.
