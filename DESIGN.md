# À Point — système de design

Direction : **moderne et tech**, lisible à 5 h du matin sur un téléphone.
Références regardées (oct. 2026) : Linear, Resend, Attio, Cal.com. Ce qu'on en retient :
fond neutre presque blanc (ou presque noir), texte quasi noir, bordures fines de 1 px
plutôt que des ombres, titres serrés et gras, une seule action principale par écran,
le produit montré dans une carte plutôt que des illustrations. Ce qu'on ne reprend pas :
leurs dégradés animés et leurs couleurs de marque.

Toutes les valeurs vivent dans `style.css` (`:root`). Les pages n'utilisent que les noms.

## Couleur

| Jeton | Clair | Sombre | Rôle |
|---|---|---|---|
| `--couleur-fond` | `#FAFAF9` | `#0C0C0D` | fond de page |
| `--couleur-surface` | `#FFFFFF` | `#161618` | cartes, champs, barre de nav |
| `--couleur-surface-2` | `#F4F4F2` | `#1E1E21` | survol, zones en retrait, pastilles |
| `--couleur-bordure` | `#E7E5E2` | `#2A2A2E` | bordures 1 px, séparateurs |
| `--couleur-texte` | `#141414` | `#F2F2F0` | texte, grands chiffres |
| `--couleur-texte-2` | `#5C5A57` | `#A3A3A0` | texte secondaire (≥ 4.5:1) |
| `--couleur-texte-3` | `#76736F` | `#8A8A86` | légendes, dates (≥ 4.5:1) |
| `--couleur-accent` | `#FF6A13` | `#FF7A2B` | **unique accent**, en aplat : bouton principal, barres, chiffre héros |
| `--couleur-accent-fort` | `#E85A05` | `#FF8F4D` | survol du bouton principal |
| `--couleur-accent-texte` | `#B83F00` | `#FF9A5C` | même orange, assez foncé pour du texte : liens, onglet actif (≥ 4.5:1) |
| `--couleur-accent-doux` | `#FFF0E5` | `#2B1A0F` | fond d'une pastille ou d'un état actif |
| `--couleur-sur-accent` | `#141414` | `#140A03` | texte posé sur l'accent (noir sur orange vif : 7:1) |
| `--couleur-succes` | `#15803D` | `#4ADE80` | économie positive, synchro OK |
| `--couleur-alerte` | `#B45309` | `#FBBF24` | prévision fragile, à vérifier |
| `--couleur-erreur` | `#B91C1C` | `#F87171` | erreur, suppression |

L'orange vif « four » est la seule couleur de marque, posé en aplat avec du texte noir (pas de terre cuite assourdie). Pas de dégradé, pas de violet.
Le mode sombre suit le système (`prefers-color-scheme`) et peut être forcé par `data-theme`.

## Typographie

Une seule famille : **Geist** (Google Fonts, 400/500/600/700), repli `system-ui`. Préférée à Inter : plus « outil technique », chiffres tabulaires nets.
Chiffres toujours tabulaires (`font-variant-numeric: tabular-nums`).

| Jeton | Taille / interligne | Usage |
|---|---|---|
| `--texte-xs` | 12 / 16 | légendes, pastilles |
| `--texte-sm` | 14 / 20 | texte secondaire, tableaux |
| `--texte-md` | 16 / 24 | texte courant (jamais moins sur mobile) |
| `--texte-lg` | 20 / 28 | titres de carte |
| `--texte-xl` | 28 / 34 | titre de page |
| `--texte-2xl` | 40 / 44 | chiffre clé |
| `--texte-3xl` | clamp(40px, 7vw, 64px) / 1.05 | titre de la page de vente |

Titres : 600–700, interlettrage −0.02em, en casse normale (jamais de petites capitales espacées). Lignes de texte : 65 caractères max.

## Espacement et largeur

Échelle en base 4 : `--espace-1` 4 · `-2` 8 · `-3` 12 · `-4` 16 · `-5` 24 · `-6` 32 · `-7` 48 · `-8` 64 · `-9` 96.
Gouttière mobile 16 px. Contenu app : 960 px max. Page de vente : 1120 px max, sections espacées de 96 px (64 px sur mobile).

## Forme et profondeur

Rayons : `--rayon-sm` 8 (champs, pastilles), `--rayon-md` 12 (cartes), `--rayon-lg` 20 (carte héros), `--rayon-rond` 999 (boutons pilule).
Une seule ombre `--ombre` très légère pour ce qui flotte (menu du compte, modale). Les cartes se contentent de la bordure.

## Composants

- **Bouton principal** : fond accent, texte `--couleur-sur-accent`, pilule, 44 px de haut min. Survol : légèrement plus foncé. Focus : anneau 2 px accent décalé de 2 px. Désactivé : opacité 0.45.
- **Bouton secondaire** : surface + bordure, texte normal. **Bouton discret** : texte seul, souligné au survol.
- **Lien** : couleur accent, soulignement au survol.
- **Champ** : surface, bordure, rayon sm, 44 px ; focus = bordure accent + anneau.
- **Carte** : surface, bordure 1 px, rayon md, padding 16 (mobile) / 24.
- **Chiffre clé** : étiquette 12 px en texte-3, valeur 40 px 700 tabulaire, détail 14 px.
- **Pastille** : 12 px 500, fond surface-2 (ou accent-doux pour l'état actif), pilule.
- **Tableau** : en-têtes 12 px texte-3 en capitales légères, lignes séparées par la bordure.
- **Navigation app** : barre du haut (logo, 5 onglets, menu du compte) sur ordinateur ; sur mobile, les 5 onglets passent en **barre fixe en bas d'écran** (atteignables au pouce), le menu du compte reste en haut à droite.
- **Explications** : repliées dans `<details>`, jamais affichées par défaut.

## Images et icônes

Pas de photos de stock ni d'emoji décoratifs dans l'interface. Icônes en traits fins (SVG inline, 1.75 px, `currentColor`).
La page de vente montre une **maquette de l'écran « Demain »** construite en HTML, avec des données d'exemple signalées comme telles.
