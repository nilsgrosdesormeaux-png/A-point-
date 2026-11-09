# Cinéma : accueil sur mesure pour Fire TV Stick Lite

Un accueil natif très léger (APK de ~45 Ko, aucune bibliothèque) qui remplace l'interface Amazon.
Style cinéma sombre, grandes tuiles arrondies, sans heure, sans météo, sans pubs ni recommandations.

## Installer (depuis le Mac)
```bash
cd firetv-launcher && ./installer.sh
```
L'IP par défaut est `10.192.26.3`. Pour en utiliser une autre : `FIRETV_IP=x.x.x.x ./installer.sh`.

## Ce que fait l'accueil
- **Lignes** : Favoris (TVMate, YouTube, Disney+, Canal+, Netflix), Replay (M6, France TV, TF1),
  Musique et live (Spotify, Twitch), puis Toutes les applis et Réglages.
- **14 thèmes vivants** : Snowfall (coucher de soleil sur L.A., palmiers, neige qui tombe), Rouge cinéma,
  Console, Nuit étoilée, Hyperespace, Néon 2077, Matrice, Aurore boréale, Forêt enchantée, Dune,
  Arcade 8-bit, Abysses, Épuré, Mes images (tes photos en diaporama). Thème au hasard possible, à chaque
  allumage ou chaque jour, ou avec la tuile « Thème au hasard ».
- **Tuiles** : bannières officielles, ou « couleurs de marque » (l'icône sur la couleur de l'appli).
  Trois tailles, noms facultatifs, fond animé facultatif.
- **Halo** : la lumière derrière le titre prend la couleur de l'appli sélectionnée.
- **Organiser** : appui long sur OK (ou touche Menu) sur une tuile pour la déplacer, la changer de ligne
  ou la masquer.

## Cinéma partout, tout le temps
Le service Accueil tourne dans un petit processus séparé. Un gardien le relance tout seul si Fire OS
le coupe, et Cinéma s'ouvre au démarrage. Pour revenir à Amazon : Réglages > Personnaliser >
Accueil Amazon > Autorisé. `./installer.sh etat` affiche un diagnostic.

## Bouton Accueil
Un service d'accessibilité capte le bouton Accueil **avant** Amazon et ouvre Cinéma directement.
Un appui long ouvre les Paramètres Fire TV. Si l'accueil Amazon apparaît malgré tout (au démarrage
par exemple), il est remplacé aussitôt. Désactiver `com.amazon.tv.launcher` n'est donc pas nécessaire.
C'est disponible en option : `./installer.sh amazon-off`, et `amazon-on` pour revenir en arrière.

## Annuler
`./installer.sh retour` réactive l'accueil Amazon, coupe le service et désinstalle Cinéma.

## Recompiler
`ANDROID_HOME=/chemin/sdk ./build.sh` (build-tools 35, plateforme android-34). La signature
`cinema.keystore` doit rester la même pour que les mises à jour s'installent par-dessus.
