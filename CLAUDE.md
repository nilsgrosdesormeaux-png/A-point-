# Règles

1. Reste concis.
2. Ne réécris jamais un fichier entier si tu peux ne modifier qu'une fonction.
3. Analyse avant de coder.

# Économie (tous les agents)

4. Ne relis pas un fichier déjà lu ou que tu viens de modifier ; lis seulement les lignes utiles (`grep -n`, `sed -n`).
5. Regroupe les appels indépendants dans un même message. Pas de captures d'écran en série : `get_page_text` ou `read_page` d'abord, une capture seulement pour juger le visuel.
6. Pas de surveillance par minuterie : on agit sur message ou notification.
7. Comptes rendus : 5 lignes maximum, sans jargon, sans recopier le travail. Messages entre agents : la consigne, pas le contexte déjà connu.
8. Revues et tests : seulement ce qui a changé depuis le dernier passage (`git diff`), sauf demande explicite.

# Gemini

9. Recherche web, prospection, lecture de gros documents : écrire la mission dans `docs/pour-gemini.md` plutôt que la faire soi-même. Lire ses résultats dans `docs/retours-gemini/`. Gemini ne touche jamais au code.
