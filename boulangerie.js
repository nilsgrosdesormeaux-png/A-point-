// Savoir-faire boulanger partagé par les pages (plan v2, oct. 2026) :
// rayon déduit du nom du produit, poids typique, recettes types pré-remplies,
// fournisseur de chaque matière première et unités lisibles.
// Rien de manuel quand la machine peut le faire : le boulanger n'ajuste que
// ce qui diffère chez lui (fiche technique dans Paramètres > Mes données).
// Convention du site : IIFE, style ES5.
(function () {
  function normaliser(texte) {
    return (texte || '').toString().toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function contient(nom, mots) {
    for (var i = 0; i < mots.length; i++) {
      if ((' ' + nom + ' ').indexOf(' ' + mots[i]) !== -1) return true;
    }
    return false;
  }

  // ---------- Rayons ----------
  var RAYONS = ['Pains', 'Viennoiseries', 'Pâtisseries', 'Snacking', 'Boissons', 'Autres', 'Hors fournée'];
  // Rayons qui ne sortent pas du four : exclus de la Fournée, de la Semaine et de la Commande.
  var RAYONS_NON_CUITS = ['Boissons', 'Hors fournée'];
  function estCuit(nomProduit) { return RAYONS_NON_CUITS.indexOf(deduireRayon(nomProduit)) === -1; }

  // L'ordre compte : « pain au chocolat » est une viennoiserie avant d'être un pain,
  // « chocolat chaud » une boisson avant d'être une viennoiserie.
  var REGLES_RAYON = [
    ['Hors fournée', ['menu', 'formule', 'burger', 'tiramisu', 'salade', 'plat du jour', 'glace', 'yaourt']],
    ['Boissons', ['chocolat chaud', 'cappuccino', 'expresso', 'espresso', 'latte', 'smoothie', 'boisson']],
    ['Snacking', ['sandwich', 'jambon', 'panini', 'quiche', 'pizza', 'croque', 'wrap', 'club', 'bagel', 'friand', 'feuillete', 'pan bagnat', 'tartine']],
    ['Viennoiseries', ['croissant', 'pain au chocolat', 'pains au chocolat', 'chocolatine', 'pain aux raisins', 'brioche', 'chausson', 'viennois', 'suisse', 'kouign', 'oranais', 'abricotine', 'torsade', 'pain au lait']],
    ['Pâtisseries', ['eclair', 'flan', 'tarte', 'tartelette', 'mille feuille', 'millefeuille', 'religieuse', 'paris brest', 'macaron', 'entremet', 'galette des rois', 'galette', 'buche', 'chou', 'chouquette', 'cookie', 'muffin', 'financier', 'madeleine', 'cannele', 'fraisier', 'opera', 'gateau', 'beignet', 'crepe', 'brownie', 'meringue', 'baba']],
    // « Éclair au café » est une pâtisserie : les boissons simples passent après.
    ['Boissons', ['cafe', 'the', 'jus', 'eau', 'soda', 'coca', 'limonade', 'orangina', 'cidre']],
    ['Pains', ['baguette', 'tradition', 'trad', 'ficelle', 'pain', 'campagne', 'complet', 'seigle', 'cereale', 'boule', 'batard', 'fougasse', 'couronne', 'epi', 'miche', 'levain', 'flute', 'polka', 'bucheron']]
  ];

  function deduireRayon(nomProduit) {
    var nom = normaliser(nomProduit);
    for (var i = 0; i < REGLES_RAYON.length; i++) {
      if (contient(nom, REGLES_RAYON[i][1])) return REGLES_RAYON[i][0];
    }
    return 'Autres';
  }

  // ---------- Recettes types (par pièce vendue) ----------
  // Ordres de grandeur d'une fabrication artisanale courante, à ajuster.
  // Quantités en kg, L ou pièces. L'eau n'est pas commandée, donc absente.
  var RECETTES_TYPES = [
    // Pâte levée feuilletée courante : 1 kg de farine, 500 g de beurre de
    // tourage, 120 g de sucre, 20 g de sel, 40 g de levure, 50 cl de lait et
    // d'eau pour une trentaine de pièces de 60 à 70 g, dorure à l'œuf.
    { mots: ['pain au chocolat', 'pains au chocolat', 'chocolatine'], poids: 0.07, ingredients: [['Farine T45', 0.033, 'kg'], ['Beurre de tourage', 0.017, 'kg'], ['Barres de chocolat', 2, 'pièce'], ['Sucre', 0.004, 'kg'], ['Sel', 0.0007, 'kg'], ['Lait', 0.009, 'L'], ['Levure fraîche', 0.0013, 'kg'], ['Œufs', 0.05, 'pièce']] },
    { mots: ['pain aux raisins'], poids: 0.09, ingredients: [['Farine T45', 0.026, 'kg'], ['Beurre de tourage', 0.013, 'kg'], ['Raisins secs', 0.012, 'kg'], ['Lait', 0.03, 'L'], ['Sucre', 0.008, 'kg'], ['Œufs', 0.15, 'pièce']] },
    { mots: ['croissant'], poids: 0.06, ingredients: [['Farine T45', 0.033, 'kg'], ['Beurre de tourage', 0.017, 'kg'], ['Sucre', 0.004, 'kg'], ['Sel', 0.0007, 'kg'], ['Lait', 0.009, 'L'], ['Levure fraîche', 0.0013, 'kg'], ['Œufs', 0.05, 'pièce']] },
    { mots: ['brioche', 'pain au lait'], poids: 0.06, ingredients: [['Farine T45', 0.025, 'kg'], ['Beurre', 0.012, 'kg'], ['Œufs', 0.3, 'pièce'], ['Sucre', 0.004, 'kg'], ['Levure fraîche', 0.001, 'kg']] },
    { mots: ['chausson'], poids: 0.1, ingredients: [['Farine T45', 0.03, 'kg'], ['Beurre de tourage', 0.02, 'kg'], ['Compote de pommes', 0.04, 'kg']] },
    { mots: ['galette bretonne', 'galette de sarrasin', 'galette sarrasin', 'sarrasin', 'ble noir'], poids: 0.06, ingredients: [['Farine de sarrasin', 0.045, 'kg'], ['Sel', 0.001, 'kg'], ['Œufs', 0.1, 'pièce']] },
    { mots: ['crepe'], poids: 0.06, ingredients: [['Farine T45', 0.02, 'kg'], ['Lait', 0.05, 'L'], ['Œufs', 0.2, 'pièce'], ['Sucre', 0.004, 'kg'], ['Beurre', 0.003, 'kg']] },
    { mots: ['galette des rois', 'galette frangipane', 'frangipane'], poids: 0.6, ingredients: [['Farine T45', 0.12, 'kg'], ['Beurre de tourage', 0.12, 'kg'], ['Poudre d\'amande', 0.1, 'kg'], ['Sucre', 0.08, 'kg'], ['Œufs', 2, 'pièce']] },
    { mots: ['eclair'], poids: 0.08, ingredients: [['Farine T45', 0.006, 'kg'], ['Beurre', 0.005, 'kg'], ['Œufs', 0.3, 'pièce'], ['Lait', 0.05, 'L'], ['Sucre', 0.01, 'kg'], ['Chocolat de couverture', 0.008, 'kg']] },
    { mots: ['flan'], poids: 0.15, ingredients: [['Lait', 0.12, 'L'], ['Sucre', 0.02, 'kg'], ['Œufs', 0.3, 'pièce'], ['Farine T45', 0.012, 'kg'], ['Beurre', 0.006, 'kg']] },
    { mots: ['tarte', 'tartelette'], poids: 0.12, ingredients: [['Farine T45', 0.03, 'kg'], ['Beurre', 0.015, 'kg'], ['Sucre', 0.015, 'kg'], ['Œufs', 0.2, 'pièce']] },
    { mots: ['sandwich', 'jambon'], poids: 0.25, ingredients: [['Farine T65', 0.075, 'kg'], ['Jambon blanc', 0.04, 'kg'], ['Beurre', 0.01, 'kg']] },
    { mots: ['quiche'], poids: 0.15, ingredients: [['Farine T45', 0.025, 'kg'], ['Beurre', 0.012, 'kg'], ['Œufs', 0.5, 'pièce'], ['Crème', 0.04, 'L'], ['Lardons', 0.02, 'kg']] },
    { mots: ['pain de seigle', 'seigle'], poids: 0.4, ingredients: [['Farine de seigle', 0.17, 'kg'], ['Farine T80', 0.07, 'kg'], ['Sel', 0.005, 'kg'], ['Levure fraîche', 0.001, 'kg']] },
    { mots: ['campagne', 'miche', 'boule', 'levain'], poids: 0.4, ingredients: [['Farine T80', 0.19, 'kg'], ['Farine de seigle', 0.04, 'kg'], ['Sel', 0.005, 'kg'], ['Levure fraîche', 0.001, 'kg']] },
    { mots: ['complet', 'cereale'], poids: 0.4, ingredients: [['Farine complète T150', 0.2, 'kg'], ['Graines', 0.02, 'kg'], ['Sel', 0.005, 'kg'], ['Levure fraîche', 0.002, 'kg']] },
    { mots: ['ficelle'], poids: 0.125, ingredients: [['Farine T65', 0.075, 'kg'], ['Sel', 0.0015, 'kg'], ['Levure fraîche', 0.0008, 'kg']] },
    { mots: ['tradition', 'trad'], poids: 0.25, ingredients: [['Farine de tradition', 0.15, 'kg'], ['Sel', 0.003, 'kg'], ['Levure fraîche', 0.0008, 'kg']] },
    { mots: ['baguette', 'flute', 'epi', 'batard', 'pain'], poids: 0.25, ingredients: [['Farine T65', 0.15, 'kg'], ['Sel', 0.003, 'kg'], ['Levure fraîche', 0.0015, 'kg']] }
  ];

  function recetteType(nomProduit) {
    var nom = normaliser(nomProduit);
    // Correspondance exacte d'abord, puis par mot (« galette bretonne » ne
    // reçoit pas la recette de la galette des rois).
    for (var e = 0; e < RECETTES_TYPES.length; e++) {
      if (RECETTES_TYPES[e].mots.indexOf(nom) !== -1) return RECETTES_TYPES[e];
    }
    for (var i = 0; i < RECETTES_TYPES.length; i++) {
      if (contient(nom, RECETTES_TYPES[i].mots)) return RECETTES_TYPES[i];
    }
    return null;
  }

  function poidsTypique(nomProduit) {
    var r = recetteType(nomProduit);
    return r ? r.poids : null;
  }

  // ---------- Fournisseurs ----------
  var FOURNISSEURS = [
    { cle: 'meunier', nom: 'Meunier', mots: ['farine', 'levure', 'sel', 'levain', 'graine', 'gluten', 'malt', 'seigle'] },
    { cle: 'cremier', nom: 'Crémier', mots: ['beurre', 'lait', 'creme', 'oeuf', 'fromage', 'emmental', 'yaourt'] },
    { cle: 'charcutier', nom: 'Charcutier', mots: ['jambon', 'lardon', 'poulet', 'saucisson', 'thon', 'bacon'] },
    { cle: 'epicerie', nom: 'Épicerie', mots: [] }
  ];

  function fournisseurPour(nomIngredient) {
    var nom = normaliser(nomIngredient);
    for (var i = 0; i < FOURNISSEURS.length - 1; i++) {
      if (contient(nom, FOURNISSEURS[i].mots.map(normaliser))) return FOURNISSEURS[i];
    }
    return FOURNISSEURS[FOURNISSEURS.length - 1];
  }

  // ---------- Unités lisibles ----------
  // Ramène g → kg, ml/cl → L, et ajoute un repère de conditionnement
  // (sacs de 25 kg de farine, plaques de 30 œufs).
  function versUniteBase(quantite, unite) {
    var u = normaliser(unite);
    if (u === 'g') return { quantite: quantite / 1000, unite: 'kg' };
    if (u === 'mg') return { quantite: quantite / 1e6, unite: 'kg' };
    if (u === 'kg' || u === 'kilo' || u === 'kilos') return { quantite: quantite, unite: 'kg' };
    if (u === 'ml') return { quantite: quantite / 1000, unite: 'L' };
    if (u === 'cl') return { quantite: quantite / 100, unite: 'L' };
    if (u === 'l' || u === 'litre' || u === 'litres') return { quantite: quantite, unite: 'L' };
    return { quantite: quantite, unite: 'pièce' };
  }

  function nombre(n, decimales) {
    return n.toLocaleString('fr-FR', { maximumFractionDigits: decimales, minimumFractionDigits: 0 });
  }

  function formaterQuantite(quantite, unite, nomIngredient) {
    var nom = normaliser(nomIngredient);
    if (unite === 'kg') {
      if (quantite < 1) return nombre(Math.ceil(quantite * 1000 / 10) * 10, 0) + ' g';
      var texte = nombre(Math.ceil(quantite * 10) / 10, 1) + ' kg';
      if (nom.indexOf('farine') !== -1 && quantite >= 12) texte += ' (≈ ' + nombre(Math.ceil(quantite / 25 * 2) / 2, 1) + ' sac' + (quantite > 25 ? 's' : '') + ' de 25 kg)';
      return texte;
    }
    if (unite === 'L') {
      if (quantite < 1) return nombre(Math.ceil(quantite * 100) * 10, 0) + ' mL';
      return nombre(Math.ceil(quantite * 10) / 10, 1) + ' L';
    }
    var pieces = Math.ceil(quantite);
    if (nom.indexOf('oeuf') !== -1 && pieces >= 30) return pieces + ' œufs (≈ ' + nombre(Math.ceil(pieces / 30 * 2) / 2, 1) + ' plaques de 30)';
    return pieces + (nom.indexOf('oeuf') !== -1 ? ' œufs' : ' pièce' + (pieces > 1 ? 's' : ''));
  }

  // Clé d'ingrédient : les farines se regroupent par référence (T45, T65,
  // tradition, seigle, sarrasin…), quel que soit le libellé saisi.
  function cleIngredient(nom) {
    var n = normaliser(nom);
    if (n.indexOf('farine') !== -1 || n.indexOf('ble noir') !== -1) {
      var ref = /\bt ?(\d{2,3})\b/.exec(n);
      if (ref) return 'farine t' + ref[1];
      var types = ['tradition', 'seigle', 'sarrasin', 'complete', 'epeautre', 'mais', 'riz'];
      for (var i = 0; i < types.length; i++) if (n.indexOf(types[i]) !== -1) return 'farine ' + types[i];
      if (n.indexOf('ble noir') !== -1) return 'farine sarrasin';
    }
    return n.replace(/s\b/g, '');
  }

  // Unité d'achat : ce qu'on commande vraiment au fournisseur.
  function uniteAchat(nomIngredient, unite) {
    var n = normaliser(nomIngredient);
    if (unite === 'kg' && n.indexOf('farine') !== -1) return { taille: 25, libelle: 'sac', pluriel: 'sacs', detail: 'de 25 kg' };
    if (unite === 'kg' && n.indexOf('beurre') !== -1) return { taille: 1, libelle: 'plaque', pluriel: 'plaques', detail: "d'1 kg" };
    if (unite === 'kg' && n.indexOf('levure') !== -1) return { taille: 0.5, libelle: 'pain', pluriel: 'pains', detail: 'de 500 g' };
    if (unite === 'pièce' && n.indexOf('oeuf') !== -1) return { taille: 30, libelle: 'plaque', pluriel: 'plaques', detail: 'de 30' };
    if (unite === 'L' && n.indexOf('lait') !== -1) return { taille: 1, libelle: 'litre', pluriel: 'litres', detail: '' };
    return null;
  }

  // Fournées horaires (lot 4) : trois tranches par défaut, réparties selon le
  // rayon (viennoiseries surtout à l'ouverture, snacking pour midi).
  // Modifiables par produit dans la Fournée.
  var TRANCHES = [
    { heure: '5 h', libelle: 'Ouverture' },
    { heure: '8 h', libelle: 'Coup de feu' },
    { heure: '11 h', libelle: 'Midi' }
  ];
  var REPARTITION_PAR_RAYON = {
    'Pains': [40, 35, 25],
    'Viennoiseries': [60, 30, 10],
    'Pâtisseries': [20, 40, 40],
    'Snacking': [0, 30, 70]
  };
  function repartitionParDefaut(rayon) {
    return (REPARTITION_PAR_RAYON[rayon] || [40, 35, 25]).slice();
  }
  // Découpe un total en pièces entières selon des parts (plus forts restes) :
  // la somme des tranches est toujours égale au total.
  function repartir(total, parts) {
    var somme = parts.reduce(function (s, p) { return s + (p > 0 ? p : 0); }, 0) || 1;
    var exacts = parts.map(function (p) { return total * (p > 0 ? p : 0) / somme; });
    var entiers = exacts.map(Math.floor);
    var manque = total - entiers.reduce(function (s, n) { return s + n; }, 0);
    exacts.map(function (x, i) { return { i: i, reste: x - entiers[i] }; })
      .sort(function (a, b) { return b.reste - a.reste; })
      .slice(0, manque).forEach(function (x) { entiers[x.i]++; });
    return entiers;
  }

  // Versions précédentes des recettes types (lot 6) : une fiche copiée
  // d'une ancienne version reste reconnue comme « proposée par À Point ».
  var ANCIENNES_RECETTES_TYPES = [
    { mots: ['croissant'], ingredients: [['Farine T45', 0.026, 'kg'], ['Beurre de tourage', 0.013, 'kg'], ['Sucre', 0.003, 'kg'], ['Lait', 0.007, 'L'], ['Levure fraîche', 0.001, 'kg'], ['Œufs', 0.05, 'pièce']] },
    { mots: ['pain au chocolat', 'pains au chocolat', 'chocolatine'], ingredients: [['Farine T45', 0.026, 'kg'], ['Beurre de tourage', 0.013, 'kg'], ['Barres de chocolat', 2, 'pièce'], ['Sucre', 0.003, 'kg'], ['Lait', 0.007, 'L'], ['Levure fraîche', 0.001, 'kg'], ['Œufs', 0.05, 'pièce']] }
  ];
  function versionsRecetteType(nomProduit) {
    var actuelle = recetteType(nomProduit);
    var nom = normaliser(nomProduit);
    return (actuelle ? [actuelle] : []).concat(ANCIENNES_RECETTES_TYPES.filter(function (r) { return contient(nom, r.mots); }));
  }

  // Suggestions d'ingrédients dans l'éditeur de recettes.
  var INGREDIENTS_COURANTS = ['Farine T45', 'Farine T55', 'Farine T65', 'Farine T80', 'Farine T110', 'Farine T150', 'Farine de tradition', 'Farine de seigle', 'Farine de sarrasin', 'Farine d\'épeautre',
    'Levure fraîche', 'Levain', 'Sel', 'Sucre', 'Beurre', 'Beurre de tourage', 'Lait', 'Crème', 'Œufs', 'Barres de chocolat', 'Chocolat de couverture', 'Poudre d\'amande', 'Raisins secs', 'Jambon blanc', 'Graines'];

  window.Boulangerie = {
    INGREDIENTS_COURANTS: INGREDIENTS_COURANTS,
    versionsRecetteType: versionsRecetteType,
    TRANCHES: TRANCHES,
    repartitionParDefaut: repartitionParDefaut,
    repartir: repartir,
    RAYONS: RAYONS,
    RAYONS_NON_CUITS: RAYONS_NON_CUITS,
    estCuit: estCuit,
    cleIngredient: cleIngredient,
    uniteAchat: uniteAchat,
    deduireRayon: deduireRayon,
    recetteType: recetteType,
    poidsTypique: poidsTypique,
    FOURNISSEURS: FOURNISSEURS,
    fournisseurPour: fournisseurPour,
    versUniteBase: versUniteBase,
    formaterQuantite: formaterQuantite,
    normaliser: normaliser
  };
})();
