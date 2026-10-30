// Lecture d'un export de caisse (CSV, ou tableau déjà lu depuis un Excel) :
// séparateur détecté (; , ou tabulation), colonnes produit / quantité / date
// reconnues avec les mêmes alias que import.html, dates françaises
// acceptées, lignes de total ignorées.
//
// Un seul fichier pour trois usages : le site (Paramètres, import guidé de
// l'historique, chargé par <script>), les Edge Functions (export reçu par
// e-mail, via export-csv.ts) et les tests Node. ES5, sans dépendance.
(function (racine) {
  var ALIAS_PRODUIT = ['produit', 'plat', 'article', 'nomduproduit', 'nom_produit', 'produitvendu', 'item', 'designation', 'nomarticle', 'libelle'];
  var ALIAS_QUANTITE = ['quantite', 'qte', 'nombre', 'nombrevendu', 'quantitevendue', 'qty', 'nbvendu', 'ventes', 'quantitevendu', 'vendu', 'vendus', 'vendue'];
  var ALIAS_DATE = ['date', 'jour', 'datevente', 'datedevente', 'dateticket', 'datedujour', 'datetime', 'horodatage'];

  function normaliserEntete(texte) {
    return (texte === null || texte === undefined ? '' : String(texte)).toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  function detecterColonne(entetes, aliases) {
    var norm = entetes.map(normaliserEntete);
    for (var i = 0; i < norm.length; i++) if (aliases.indexOf(norm[i]) !== -1) return i;
    for (var j = 0; j < norm.length; j++) {
      for (var k = 0; k < aliases.length; k++) if (norm[j].indexOf(aliases[k]) !== -1) return j;
    }
    return -1;
  }

  // Séparateur le plus présent sur les premières lignes (la toute première
  // est parfois un simple titre, sans séparateur).
  function detecterSeparateur(debut) {
    var candidats = [';', '\t', ','];
    var meilleur = ';', max = -1;
    candidats.forEach(function (c) {
      var n = debut.split(c).length;
      if (n > max) { max = n; meilleur = c; }
    });
    return meilleur;
  }

  function lireCsv(texte) {
    texte = String(texte || '').replace(/^﻿/, '');
    var sep = detecterSeparateur(texte.split(/\r?\n/).slice(0, 15).join('\n'));
    var lignes = [];
    var ligne = [];
    var champ = '';
    var entreGuillemets = false;
    function finirLigne() {
      ligne.push(champ); champ = '';
      if (ligne.some(function (v) { return v.trim() !== ''; })) lignes.push(ligne);
      ligne = [];
    }
    for (var i = 0; i < texte.length; i++) {
      var c = texte[i];
      if (entreGuillemets) {
        if (c === '"' && texte[i + 1] === '"') { champ += '"'; i++; }
        else if (c === '"') entreGuillemets = false;
        else champ += c;
      } else if (c === '"') entreGuillemets = true;
      else if (c === sep) { ligne.push(champ); champ = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && texte[i + 1] === '\n') i++;
        finirLigne();
      } else champ += c;
    }
    finirLigne();
    return lignes;
  }

  // "2026-10-29", "2026-10-29T08:12", "29/10/2026", "29-10-2026 08:12",
  // "29/10/26", ou un numéro de jour Excel (45958).
  function lireDate(valeur) {
    if (typeof valeur === 'number' && valeur > 20000 && valeur < 80000) {
      return new Date(Math.round((valeur - 25569) * 86400000)).toISOString().slice(0, 10);
    }
    var v = (valeur === null || valeur === undefined ? '' : String(valeur)).trim();
    var iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
    var fr = v.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (fr) {
      var annee = fr[3].length === 2 ? '20' + fr[3] : fr[3];
      return annee + '-' + ('0' + fr[2]).slice(-2) + '-' + ('0' + fr[1]).slice(-2);
    }
    return null;
  }

  function lireQuantite(valeur) {
    if (typeof valeur === 'number') return valeur;
    return Number(String(valeur === null || valeur === undefined ? '' : valeur).replace(/\s/g, '').replace(',', '.'));
  }

  // Cherche la ligne d'en-tête parmi les 15 premières (certains exports
  // commencent par le nom du magasin ou la période).
  function trouverEntete(tableau) {
    for (var i = 0; i < Math.min(15, tableau.length); i++) {
      var cellules = tableau[i].map(function (c) { return c === null || c === undefined ? '' : String(c); });
      var p = detecterColonne(cellules, ALIAS_PRODUIT);
      var q = detecterColonne(cellules, ALIAS_QUANTITE);
      if (p !== -1 && q !== -1 && p !== q) return i;
    }
    return -1;
  }

  function lignesDepuisTableau(tableau, jourParDefaut) {
    if (!tableau || tableau.length < 2) return { lignes: [], erreur: 'Fichier vide ou sans en-tête' };
    var iEntete = trouverEntete(tableau);
    if (iEntete === -1) {
      return { lignes: [], erreur: 'Colonnes produit ou quantité introuvables (en-têtes : ' + tableau[0].join(', ') + ')' };
    }
    var entetes = tableau[iEntete].map(function (c) { return c === null || c === undefined ? '' : String(c); });
    var colProduit = detecterColonne(entetes, ALIAS_PRODUIT);
    var colQuantite = detecterColonne(entetes, ALIAS_QUANTITE);
    var colDate = detecterColonne(entetes, ALIAS_DATE);
    if (colDate === -1 && !jourParDefaut) {
      return { lignes: [], erreur: 'Colonne date introuvable : exporte les ventes « par jour »' };
    }
    var lignes = [];
    tableau.slice(iEntete + 1).forEach(function (cellules) {
      var nom = String(cellules[colProduit] === null || cellules[colProduit] === undefined ? '' : cellules[colProduit]).trim();
      if (!nom || /^(sous[- ]?)?total/i.test(nom)) return;
      var quantite = lireQuantite(cellules[colQuantite]);
      if (!isFinite(quantite)) return;
      var jour = colDate === -1 ? jourParDefaut : lireDate(cellules[colDate]);
      if (!jour) return;
      lignes.push({ nom_produit: nom, quantite: quantite, date_vente: jour });
    });
    return { lignes: lignes };
  }

  function lignesDepuisExport(texte, jourParDefaut) {
    return lignesDepuisTableau(lireCsv(texte), jourParDefaut);
  }

  var api = {
    lireCsv: lireCsv, lireDate: lireDate,
    lignesDepuisTableau: lignesDepuisTableau, lignesDepuisExport: lignesDepuisExport
  };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  racine.LectureExport = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
