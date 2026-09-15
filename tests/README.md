# Tests À Point

`node tests/run.js` — lance la suite (démarre un serveur statique + Chromium, aucune dépendance npm à installer).

## Limitation connue

Ce sandbox bloque `cdn.jsdelivr.net` (politique réseau), donc `supabase-js` ne se charge jamais ici. Les tests injectent un faux `window.supabase` (`stubSupabase`) qui ne fait aucun vrai appel réseau, juste pour laisser tourner la logique client (validation de formulaire, onglets, nav.js, redirections).

**Non couvert par cette suite** : l'intégration Supabase réelle (connexion, lecture/écriture de données, RLS). À tester manuellement ou en CI avec accès réseau complet.
