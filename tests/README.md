# Tests À Point

- `node tests/run.js` : suite navigateur (serveur statique + Chromium, faux Supabase, aucun appel à la vraie base). Les tests de l'ancienne interface (avant oct. 2026) sont listés dans `OBSOLETES` et annoncés « ignorés ».
- `node --test tests/moteur.test.mjs` : moteur de prévision.
- `node tests/demo.mjs [--page fournee] [--mobile|--ordi] [--liste]` : harnais de démo. Compte « Le petit comptoire » (9 semaines de ventes, fournées, recettes, caisse par e-mail), compte neuf, déconnecté, mode fournil, mode sombre, parcours inscription → caisse → Fournée → Commande → Semaine → Bilan. Écrit captures pleine page (390×844 et 1280×800), texte visible et `rapport.txt` (erreurs console, débordements, cibles < 44 px, mots techniques) dans `/home/user/apoint-captures/` (hors dépôt, `APOINT_CAPTURES` pour changer).

Non couvert : la vraie base Supabase (connexion, RLS, écritures).
