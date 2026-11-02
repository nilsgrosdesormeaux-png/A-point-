# À Point — système de design

Direction : **« Fournil »**, chaleureuse et appétissante, lisible à 5 h du matin sur un téléphone.
Remplace la piste « moderne et tech » du 30 oct. 2026, jugée trop sombre et futuriste pour des boulangers.

## Références regardées (30 oct. 2026)

- **Poilâne** : fond clair, logotype serif, le pain en grand, très peu d'éléments autour.
- **King Arthur Baking** : grands titres serif chaleureux, une seule couleur d'action franche en pilule, beaucoup de crème.
- **Tartine** : photo de pain plein cadre, texte réduit au strict nécessaire.

Ce qu'on en retient : le produit (le pain, les chiffres de la fournée) au centre, un serif généreux pour les titres,
un fond crème plutôt que blanc, une seule couleur d'action. Ce qu'on ne reprend pas : leurs photos, logos et couleurs de marque.

## Pistes comparées

1. **Fournil** (retenue) — crème farine, brun mie de seigle pour le texte, **croûte dorée** pour l'action.
   Titres et grands chiffres en serif doux (Fraunces, axe SOFT), texte en sans serif lisible (Inter).
   Chaleureux sans être rétro, et les quantités du jour deviennent l'élément mémorable.
2. **Meunier** — papier kraft et blé, encre bleu sac de farine, tampons et filets. Plus graphique,
   mais le bleu éloigne de l'appétit et les tampons alourdissent un écran qui doit rester synthétique.
3. **Vitrine** — blanc chaud, photos de pain plein cadre, serif fine et élégante. Très haut de gamme,
   mais dépend de vraies photos qu'on n'a pas encore et prend trop de place sur un téléphone.

## Couleur

Le **mode clair est le mode par défaut**, même si le téléphone est en mode sombre.
Le mode sombre est chaud (brun de croûte, jamais noir) et ne s'active que par `data-theme="dark"`.

| Jeton | Clair | Sombre | Rôle |
|---|---|---|---|
| `--couleur-fond` | `#FBF5EA` | `#1F1712` | fond de page, crème farine |
| `--couleur-surface` | `#FFFDF8` | `#2A2019` | cartes, champs, barre d'onglets |
| `--couleur-surface-2` | `#F3E8D6` | `#33271E` | survol, pastilles, zones en retrait |
| `--couleur-bordure` | `#EADBC4` | `#43342A` | bordures 1 px |
| `--couleur-texte` | `#2B1D13` | `#F4E9D8` | texte, grands chiffres |
| `--couleur-texte-2` | `#6B5544` | `#CDB9A1` | texte secondaire |
| `--couleur-texte-3` | `#76614F` | `#AE9A84` | légendes, dates (≥ 4.5:1) |
| `--couleur-accent` | `#9E4C0C` | `#E89A4B` | **croûte dorée**, unique couleur d'action : bouton principal, onglet actif |
| `--couleur-accent-texte` | `#9E4C0C` | `#F0A65A` | liens et textes d'accent |
| `--couleur-sur-accent` | `#FFFDF8` | `#1F1712` | texte posé sur l'accent |
| `--couleur-accent-doux` | `#F7E4C8` | `#3D2A18` | fond d'une pastille ou d'un état actif |
| `--couleur-dore` | `#E2A23B` | `#E8B65A` | décor seulement (barres, points) : jamais du texte sur crème |
| `--couleur-succes` | `#3F7A2E` | `#8FCB72` | économie positive, synchro OK |
| `--couleur-alerte` | `#94600A` | `#E8B65A` | jour férié, vacances, à vérifier |
| `--couleur-erreur` | `#A8321E` | `#F08E7A` | erreur, suppression |

## Typographie

- **Fraunces** (serif douce, axe `SOFT` à 100, opsz automatique) : titres et **grands chiffres de production**. 500–600.
- **Inter** : tout le reste (texte, boutons, tableaux, étiquettes). 400/500/600, chiffres tabulaires.

| Jeton | Taille / interligne | Usage |
|---|---|---|
| `--texte-xs` | 12 / 16 | légendes, pastilles |
| `--texte-sm` | 14 / 20 | texte secondaire |
| `--texte-md` | 16 / 24 | texte courant (jamais moins sur mobile) |
| `--texte-lg` | 20 / 28 | titres de carte |
| `--texte-xl` | 30 / 36 | titre de page (serif) |
| `--texte-2xl` | 44 / 44 | chiffre de production (serif) |
| `--texte-3xl` | clamp(42px, 7vw, 72px) | titre de la page de vente (serif) |

Titres en casse normale, jamais de capitales espacées. Lignes de 65 caractères max.

## Espacement, forme, profondeur

Échelle base 4 : 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 (`--espace-1` à `--espace-9`). Gouttière mobile 16 px, contenu app 960 px max.
Rayons plus ronds que la piste précédente, comme une miche : `--rayon-sm` 10, `--rayon-md` 16, `--rayon-lg` 24, pilule 999.
Une ombre chaude et douce (`--ombre`) pour ce qui flotte ; les cartes ont une bordure crème et une ombre très légère.

## Composants

- **Bouton principal** : croûte dorée, texte crème, pilule, 44 px min. Un seul par écran.
- **Bouton secondaire** : surface + bordure. **Discret** : texte souligné.
- **Carte produit (Demain)** : nom en sans serif, quantité en Fraunces 44 px, fourchette en légende.
- **Chiffre héros (Bilan)** : carte brun mie, montant en Fraunces doré.
- **Pastille** : réservée aux actions et alertes (voir « Ce qui rend À Point humain ») ; sinon, du texte.
- **Navigation** : en-tête crème (logo, onglets, compte) sur ordinateur ; sur mobile, 5 onglets en barre fixe en bas.
- **Explications** : repliées dans `<details>`.

## Images et icônes

Icônes en traits fins (SVG inline, 1.75 px, `currentColor`), pas d'emoji décoratif.
La page de vente et la connexion montrent de **vraies captures** de l'appli (`images/capture-*.webp`),
prises avec le harnais `tests/demo.mjs` sur le compte de démonstration « Le petit comptoire » et signalées comme telles.
Pour les refaire : `node tests/demo.mjs --page fournee --mobile`, puis recadrer au-dessus de la barre d'onglets (y < 1560 px à 2x).

## Ce qui rend À Point humain (1er nov. 2026)

Le fondateur voulait qu'aucun boulanger ne puisse dire « c'est que de l'IA ». Ce qu'on a retiré, et pourquoi :

- **Maquette fictive** sur dégradé doré : remplacée par des captures réelles posées de travers sur du papier kraft (aplat + grain, aucun dégradé).
- **Pastilles partout** (« Phase de test », « Prêt », « Habituel », « estimé », météo) : une pastille ne sert plus qu'à une action ou une alerte.
  Le reste est du texte : « mesuré / estimé » souligné en pointillé comme une note au crayon, « Habituel » en légende, « Chargé » en gras croûte,
  la météo sur une seule ligne séparée par des points, l'état des caisses en texte vert avec une coche.
- **Cartes identiques en grille** (3 chiffres, 3 étapes, 4 écrans) : remplacées par une ligne d'arithmétique (0,20 € × 10 × 26 ≈ 52 €),
  une frise « Le soir / Dans la nuit / Au fournil » séparée par un filet de farine, et une galerie de captures décalées.
- **Slogans en double phrase** (« Enfournez juste. Jetez moins. ») et « gratuit » répété cinq fois : un titre qui dit ce que fait l'outil,
  la gratuité dite deux fois (sous le bouton, et dans la section Prix).
- **Tout centré** : seul le formulaire de connexion reste centré ; l'appel final est aligné à gauche comme le reste.
- **Aucune trace humaine** : un paragraphe « Pourquoi À Point » signé Nils, sans fait inventé (à relire par lui avant mise en ligne).

Les détails dessinés à la main, peu nombreux et à garder rares :

- `images/grigne.svg` : quatre coups de lame de baguette, jamais identiques. Sur la page de vente (surtitre) et en coin de l'en-tête de la Fournée.
- `images/filet-farine.svg` : une traînée irrégulière de farine, séparateur de la frise « Une journée ».
- **Étiquette ardoise** (CSS, `.v-ardoise`) : prix à la craie, trou et ficelle, pour 0,20 € et 0 €.
- **Papier kraft** (`.v-kraft`, `.connexion-kraft`) : support des captures.

Dans l'app : l'en-tête de la Fournée est un papier crème bordé d'un filet doré (plus de dégradé) ; l'onglet actif sur téléphone est marqué
d'un trait croûte au-dessus de l'icône, pas d'une pilule. Lisibilité à 5 h et logique des écrans inchangées.
