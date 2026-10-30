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
  var RAYONS = ['Pains', 'Viennoiseries', 'Pâtisseries', 'Snacking', 'Boissons', 'Autres'];

  // L'ordre compte : « pain au chocolat » est une viennoiserie avant d'être un pain,
  // « chocolat chaud » une boisson avant d'être une viennoiserie.
  var REGLES_RAYON = [
    ['Boissons', ['chocolat chaud', 'cappuccino', 'expresso', 'espresso', 'latte', 'smoothie', 'boisson']],
    ['Snacking', ['sandwich', 'jambon', 'panini', 'quiche', 'pizza', 'croque', 'wrap', 'salade', 'formule', 'club', 'bagel', 'friand', 'feuillete', 'pan bagnat', 'tartine']],
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
    { mots: ['pain au chocolat', 'pains au chocolat', 'chocolatine'], poids: 0.07, ingredients: [['Farine T45', 0.026, 'kg'], ['Beurre de tourage', 0.013, 'kg'], ['Barres de chocolat', 2, 'pièce'], ['Sucre', 0.003, 'kg'], ['Lait', 0.007, 'L'], ['Levure fraîche', 0.001, 'kg'], ['Œufs', 0.05, 'pièce']] },
    { mots: ['pain aux raisins'], poids: 0.09, ingredients: [['Farine T45', 0.026, 'kg'], ['Beurre de tourage', 0.013, 'kg'], ['Raisins secs', 0.012, 'kg'], ['Lait', 0.03, 'L'], ['Sucre', 0.008, 'kg'], ['Œufs', 0.15, 'pièce']] },
    { mots: ['croissant'], poids: 0.06, ingredients: [['Farine T45', 0.026, 'kg'], ['Beurre de tourage', 0.013, 'kg'], ['Sucre', 0.003, 'kg'], ['Lait', 0.007, 'L'], ['Levure fraîche', 0.001, 'kg'], ['Œufs', 0.05, 'pièce']] },
    { mots: ['brioche', 'pain au lait'], poids: 0.06, ingredients: [['Farine T45', 0.025, 'kg'], ['Beurre', 0.012, 'kg'], ['Œufs', 0.3, 'pièce'], ['Sucre', 0.004, 'kg'], ['Levure fraîche', 0.001, 'kg']] },
    { mots: ['chausson'], poids: 0.1, ingredients: [['Farine T45', 0.03, 'kg'], ['Beurre de tourage', 0.02, 'kg'], ['Compote de pommes', 0.04, 'kg']] },
    { mots: ['galette des rois', 'galette frangipane', 'frangipane'], poids: 0.6, ingredients: [['Farine T45', 0.12, 'kg'], ['Beurre de tourage', 0.12, 'kg'], ['Poudre d\'amande', 0.1, 'kg'], ['Sucre', 0.08, 'kg'], ['Œufs', 2, 'pièce']] },
    { mots: ['eclair'], poids: 0.08, ingredients: [['Farine T45', 0.006, 'kg'], ['Beurre', 0.005, 'kg'], ['Œufs', 0.3, 'pièce'], ['Lait', 0.05, 'L'], ['Sucre', 0.01, 'kg'], ['Chocolat de couverture', 0.008, 'kg']] },
    { mots: ['flan'], poids: 0.15, ingredients: [['Lait', 0.12, 'L'], ['Sucre', 0.02, 'kg'], ['Œufs', 0.3, 'pièce'], ['Farine T45', 0.012, 'kg'], ['Beurre', 0.006, 'kg']] },
    { mots: ['tarte', 'tartelette'], poids: 0.12, ingredients: [['Farine T45', 0.03, 'kg'], ['Beurre', 0.015, 'kg'], ['Sucre', 0.015, 'kg'], ['Œufs', 0.2, 'pièce']] },
    { mots: ['sandwich', 'jambon'], poids: 0.25, ingredients: [['Farine T65', 0.075, 'kg'], ['Jambon blanc', 0.04, 'kg'], ['Beurre', 0.01, 'kg']] },
    { mots: ['quiche'], poids: 0.15, ingredients: [['Farine T45', 0.025, 'kg'], ['Beurre', 0.012, 'kg'], ['Œufs', 0.5, 'pièce'], ['Crème', 0.04, 'L'], ['Lardons', 0.02, 'kg']] },
    { mots: ['campagne', 'seigle', 'miche', 'boule', 'levain'], poids: 0.4, ingredients: [['Farine T65', 0.19, 'kg'], ['Farine de seigle', 0.04, 'kg'], ['Sel', 0.005, 'kg'], ['Levure fraîche', 0.001, 'kg']] },
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

  window.Boulangerie = {
    RAYONS: RAYONS,
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
