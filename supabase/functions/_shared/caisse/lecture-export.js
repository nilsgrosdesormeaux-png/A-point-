// Lecture d'un export de caisse (CSV, ou tableau déjà lu depuis un Excel).
// Solution universelle : doit lire l'export de n'importe quelle caisse.
//
//  - Encodage : UTF-8, Windows-1252, UTF-16 (« Texte Unicode » d'Excel).
//  - Séparateur détecté (; , tabulation |) sur la régularité des colonnes.
//  - En-tête cherché dans les 30 premières lignes (titres, nom du magasin…).
//  - Colonnes reconnues en français et en anglais, avec exclusions
//    (« Code article », « Catégorie produit », « Quantité remboursée »,
//    « Prix »… ne sont jamais pris pour l'article ou la quantité) et
//    vérification sur les valeurs.
//  - Variante ajoutée au nom comme le font les connecteurs API
//    (« Tarte Grande »), pour que fichier et branchement donnent les mêmes noms.
//  - Remboursements déduits (colonne type : Refund, Remboursement, Avoir…),
//    lignes annulées ignorées (colonne statut : Cancelled, Annulé…).
//  - Dates : 29/10/2026, 29.10.26, 2026-10-29, 2026-10-29T22:30:00Z (jour de
//    Paris), 29 oct. 2026, mer. 29 octobre 2026, Oct 29, 2026, 20261029,
//    numéro de jour Excel ; jour/mois ou mois/jour déduit du fichier.
//  - Nombres : 1 234,5 · 1.234,50 · 1,234.50 · 3 u · (2).
//  - Format « tableau croisé » : articles en lignes et jours en colonnes (ou
//    l'inverse), fréquent dans les rapports Bimedia, Crisalid, Excel maison.
//  - Sans colonne date : jour unique lu dans le titre (« Période : du
//    29/10/2026 au 29/10/2026 »), ou lignes-titres de jour (« Date : 29/10 »).
//  - Lignes de total, sous-total, en-têtes répétés et quantités vides ignorées.
//  - Colonnes imposées possibles (options.colonnes) quand la détection
//    automatique échoue : la page propose alors de les choisir.
//
// Un seul fichier pour trois usages : le site (page Ma caisse, chargé par
// <script>), les Edge Functions (export reçu par e-mail, via export-csv.ts)
// et les tests Node. ES5, sans dépendance.
(function (racine) {
  // Alias exacts (en-tête normalisé : minuscules, sans accents ni ponctuation), par priorité.
  var PRODUIT = ['article', 'produit', 'designation', 'libelle', 'libellearticle', 'libelleproduit', 'nomarticle',
    'nomdelarticle', 'nomduproduit', 'nomproduit', 'nom_produit', 'produitvendu', 'articlevendu', 'item', 'itemname',
    'product', 'productname', 'articles', 'produits', 'plat', 'designationarticle', 'nom', 'name', 'description'];
  var QUANTITE = ['quantite', 'qte', 'qt', 'qty', 'quantity', 'quantitevendue', 'quantitevendu', 'qtevendue', 'qtvendue',
    'qtevendu', 'quantitesvendues', 'quantitenette', 'qtenette', 'netquantity', 'quantitetotale', 'qtetotale',
    'nombrevendu', 'nbvendu', 'nbvendus', 'nombre', 'nb', 'nbre', 'itemssold', 'quantitysold', 'soldquantity', 'unitssold',
    'unitesvendues', 'articlesvendus', 'nombredarticles', 'nbarticles', 'vendu', 'vendus', 'vendue', 'count', 'ventes'];
  var DATE = ['date', 'jour', 'datevente', 'datedevente', 'dateticket', 'datedticket', 'datedujour', 'dateheure', 'datetime',
    'horodatage', 'datetransaction', 'datedetransaction', 'transactiondate', 'saledate', 'createdat', 'created',
    'datecreation', 'datedecreation', 'dateencaissement', 'datepaiement', 'datecloture', 'datefermeture', 'day',
    'businessday', 'journee', 'journeecommerciale', 'datecomptable', 'datedocument', 'receiptdate', 'dateticketcaisse'];
  var VARIANTE = ['variante', 'variant', 'variantname', 'nomvariante', 'pricepointname', 'declinaison', 'variation',
    'variationname', 'taille', 'format'];
  var TYPE = ['type', 'eventtype', 'typedevenement', 'receipttype', 'typedeticket', 'typeticket', 'typedetransaction',
    'transactiontype', 'typeoperation', 'typedoperation', 'operation', 'nature', 'sens', 'typedevente', 'typevente'];
  var STATUT = ['statut', 'status', 'etat', 'state', 'statutduticket', 'statutticket'];

  // Morceaux qui suffisent si aucun alias exact n'est trouvé, et exclusions.
  var PRODUIT_PARTIEL = ['article', 'produit', 'designation', 'libelle', 'item', 'product'];
  var PRODUIT_EXCLU = /^(id|code|ref|num|no)|(id|code|ref|reference|sku|ean|uuid|ean13)$|sku|ean|gencod|categ|famille|rayon|groupe|type|nombre|^nb|qte|quantit|qty|prix|price|montant|amount|total|tva|tax|remise|discount|vendeur|caissier|client|customer|employe|marge|cout|cost|stock|unite|variante|variant|option|modif|note|comment/;
  var QUANTITE_PARTIEL = ['quantit', 'qte', 'qty', 'vendu', 'sold', 'nombredevente', 'nbvente', 'nbdevente'];
  var QUANTITE_EXCLU = /^ca|eur|rembours|refund|retour|return|annul|cancel|offert|perte|prix|price|montant|amount|chiffre|ttc|tva|tax|valeur|value|stock|unitaire|moyen|pourcent|percent|cout|cost|marge|remise|discount/;
  var DATE_PARTIEL = ['date', 'jour'];
  var DATE_EXCLU = /maj|modif|update|naissance|birth|expir|export|impression|echeance|limite|^nb|nombre|jours/;

  // En-têtes qui ne sont jamais un article dans un tableau jours x articles.
  var ARGENT = /^(heure|time|ca|chiffre|montant|tva|ht|ttc|nbtickets?|tickets?|panier|prix|price|remise|discount|total|tax|amount|cout|cost|marge|moyen|especes?|cash|cb|carte|card|cheques?|paiement|payment|couverts?|clients?|fond|ecart|tr|ticketsrestaurant|avoirs?)/;
  var TOTAL = /^\s*(sous[- ]?)?totaux?\b|^\s*total|^\s*grand[- ]?total|^\s*somme\b|^\s*cumul\b|^\s*report\b|^\s*sum\b/i;
  var REMBOURSEMENT = /rembours|refund|retour|avoir|return|credit note/i;
  var ANNULE = /annul|cancel|supprim|deleted|void|echou|failed|refus|abandon/i;
  var VARIANTE_NEUTRE = /^(regular|normal|standard|defaut|default|unique|-|—|aucune?|none|n\/a)$/i;

  var MOIS = { jan: 1, janv: 1, janvier: 1, january: 1, fev: 2, fevr: 2, fevrier: 2, feb: 2, february: 2, mar: 3, mars: 3, march: 3,
    avr: 4, avril: 4, apr: 4, april: 4, mai: 5, may: 5, juin: 6, jun: 6, june: 6, juil: 7, juillet: 7, jul: 7, july: 7,
    aou: 8, aout: 8, aug: 8, august: 8, sep: 9, sept: 9, septembre: 9, september: 9, oct: 10, octobre: 10, october: 10,
    nov: 11, novembre: 11, november: 11, dec: 12, decembre: 12, december: 12 };

  function sansAccents(t) {
    return String(t).normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function normaliserEntete(texte) {
    return sansAccents(texte === null || texte === undefined ? '' : texte).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function cellule(c) {
    if (c === null || c === undefined) return '';
    if (c instanceof Date) return c.toISOString();
    return String(c);
  }

  // ---------- Encodage et CSV ----------

  // Octets d'un fichier -> texte : BOM UTF-8 / UTF-16, sinon UTF-8 strict,
  // sinon Windows-1252 (exports de caisses françaises).
  function decoderOctets(octets) {
    if (octets.length >= 2 && octets[0] === 0xFF && octets[1] === 0xFE) return new TextDecoder('utf-16le').decode(octets.subarray(2));
    if (octets.length >= 2 && octets[0] === 0xFE && octets[1] === 0xFF) return new TextDecoder('utf-16be').decode(octets.subarray(2));
    // UTF-16 sans BOM : un octet nul sur deux.
    if (octets.length >= 4 && octets[1] === 0 && octets[3] === 0 && octets[0] !== 0) return new TextDecoder('utf-16le').decode(octets);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(octets);
    } catch (_e) {
      return new TextDecoder('windows-1252').decode(octets);
    }
  }

  function decouper(texte, sep, maxLignes) {
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
      } else if (c === '"' && champ.trim() === '') { champ = ''; entreGuillemets = true; }
      else if (c === sep) { ligne.push(champ); champ = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && texte[i + 1] === '\n') i++;
        finirLigne();
        if (maxLignes && lignes.length >= maxLignes) return lignes;
      } else champ += c;
    }
    finirLigne();
    return lignes;
  }

  // Le séparateur qui donne le plus de lignes au même nombre de colonnes (> 1).
  function detecterSeparateur(texte) {
    var debut = texte.slice(0, 20000);
    var meilleur = ';', score = -1;
    [';', '\t', ',', '|'].forEach(function (sep) {
      var lignes = decouper(debut, sep, 40);
      var comptes = {};
      lignes.forEach(function (l) { if (l.length > 1) comptes[l.length] = (comptes[l.length] || 0) + 1; });
      Object.keys(comptes).forEach(function (n) {
        var s = comptes[n] * 1000 + Number(n);
        if (s > score) { score = s; meilleur = sep; }
      });
    });
    return meilleur;
  }

  function lireCsv(texte) {
    texte = String(texte || '').replace(/^﻿/, '');
    // « sep=; » en première ligne (exports Excel) : séparateur imposé.
    var impose = texte.match(/^sep=(.)\r?\n/);
    if (impose) return decouper(texte.slice(impose[0].length), impose[1]);
    return decouper(texte, detecterSeparateur(texte));
  }

  // ---------- Dates ----------

  var FORMAT_JOUR_PARIS = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });

  function jourValide(a, m, j) {
    a = Number(a); m = Number(m); j = Number(j);
    if (a < 100) a += 2000;
    if (!(a >= 1990 && a <= 2100 && m >= 1 && m <= 12 && j >= 1 && j <= 31)) return null;
    var d = new Date(Date.UTC(a, m - 1, j));
    if (d.getUTCMonth() !== m - 1) return null; // 31/02
    return a + '-' + ('0' + m).slice(-2) + '-' + ('0' + j).slice(-2);
  }

  // ordre : 'jma' (défaut, France) ou 'mja' (export américain), pour 05/03/26.
  function lireDate(valeur, ordre) {
    if (valeur instanceof Date) return isNaN(valeur.getTime()) ? null : FORMAT_JOUR_PARIS.format(valeur);
    if (typeof valeur === 'number') {
      if (valeur > 20000 && valeur < 80000) return new Date(Math.round((Math.floor(valeur) - 25569) * 86400000)).toISOString().slice(0, 10);
      if (valeur >= 19900101 && valeur <= 21001231) return lireDate(String(valeur), ordre);
      return null;
    }
    var v = sansAccents(valeur === null || valeur === undefined ? '' : valeur).trim().toLowerCase();
    if (!v) return null;
    // Instant ISO avec fuseau : jour de Paris (23 h 30 UTC = lendemain l'été).
    var instant = v.match(/^(\d{4})-(\d{2})-(\d{2})[t ](\d{2}):(\d{2})(:\d{2}(\.\d+)?)?\s*(z|[+-]\d{2}:?\d{2})$/);
    if (instant) {
      var t = Date.parse(v.toUpperCase().replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
      if (!isNaN(t)) return FORMAT_JOUR_PARIS.format(new Date(t));
    }
    var iso = v.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?!\d)/);
    if (iso) return jourValide(iso[1], iso[2], iso[3]);
    var compact = v.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) return jourValide(compact[1], compact[2], compact[3]);
    var anglais = v.match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?!\d)/);
    if (anglais && MOIS[anglais[1]]) return jourValide(anglais[3], MOIS[anglais[1]], anglais[2]);
    // Jour de semaine éventuel devant (« mer. 29/10/2026 », « Mercredi 29 octobre 2026 »).
    v = v.replace(/^[a-z]{3,9}\.?,?\s+(?=\d)/, '');
    var num = v.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})(?!\d)/);
    if (num) return ordre === 'mja' ? jourValide(num[3], num[1], num[2]) : jourValide(num[3], num[2], num[1]);
    var texteMois = v.match(/^(\d{1,2})(?:er)?[\s\-.]+([a-z]+)\.?[\s\-.]+(\d{2}|\d{4})(?!\d)/);
    if (texteMois && MOIS[texteMois[2]]) return jourValide(texteMois[3], MOIS[texteMois[2]], texteMois[1]);
    return null;
  }

  // Toutes les dates écrites dans un texte (titre « Période du … au … »).
  function datesDansTexte(texte) {
    var res = [];
    var v = sansAccents(cellule(texte)).toLowerCase();
    var motif = /(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/.\-]\d{1,2}[\/.\-](?:\d{4}|\d{2})(?!\d)|\d{1,2}(?:er)?\s+[a-z]+\.?\s+\d{4})/g;
    var m;
    while ((m = motif.exec(v))) {
      var d = lireDate(m[1]);
      if (d) res.push(d);
    }
    return res;
  }

  // Jour/mois ou mois/jour : un premier nombre > 12 tranche (13/02 = jour/mois).
  function ordreDates(valeurs) {
    var jma = 0, mja = 0;
    valeurs.forEach(function (v) {
      if (typeof v !== 'string') return;
      var m = v.trim().match(/^(?:[a-z]{3,9}\.?,?\s+)?(\d{1,2})[\/.\-](\d{1,2})[\/.\-]\d{2,4}/i);
      if (!m) return;
      if (Number(m[1]) > 12) jma++;
      if (Number(m[2]) > 12) mja++;
    });
    return mja > 0 && jma === 0 ? 'mja' : 'jma';
  }

  // ---------- Nombres ----------

  function lireQuantite(valeur) {
    if (typeof valeur === 'number') return isFinite(valeur) ? valeur : NaN;
    var v = cellule(valeur).trim();
    if (!v) return NaN;
    var negatif = /^\(.*\)$/.test(v) || /-\s*$/.test(v) || /^[-−]/.test(v);
    v = v.replace(/[\s  '’]/g, '').replace(/^\((.*)\)$/, '$1').replace(/^[-−+]|-$/g, '')
      .replace(/^(x|qte|qty)/i, '').replace(/(x|u|un|unites?|pcs?|pieces?|kg|g|l|ex)$/i, '');
    if (!/^[\d.,]+$/.test(v)) return NaN;
    var virgule = v.lastIndexOf(','), point = v.lastIndexOf('.');
    if (virgule !== -1 && point !== -1) {
      v = virgule > point ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '');
    } else if (virgule !== -1) {
      v = (v.match(/,/g).length > 1) ? v.replace(/,/g, '') : v.replace(',', '.');
    } else if (point !== -1 && v.match(/\./g).length > 1) {
      v = v.replace(/\./g, '');
    }
    var n = Number(v);
    return isFinite(n) ? (negatif ? -n : n) : NaN;
  }

  // ---------- Colonnes ----------

  function candidats(entetes, exacts, partiels, exclu) {
    var norm = entetes.map(normaliserEntete);
    var res = [];
    exacts.forEach(function (a) {
      norm.forEach(function (h, i) { if (h === a && res.indexOf(i) === -1) res.push(i); });
    });
    (partiels || []).forEach(function (a) {
      norm.forEach(function (h, i) {
        if (h.indexOf(a) !== -1 && !(exclu && exclu.test(h)) && res.indexOf(i) === -1) res.push(i);
      });
    });
    return res;
  }

  function part(lignes, col, test) {
    var n = 0, ok = 0;
    lignes.forEach(function (l) {
      var c = l[col];
      if (c === null || c === undefined || cellule(c).trim() === '') return;
      n++;
      if (test(c)) ok++;
    });
    return n === 0 ? 0 : ok / n;
  }

  function estTexte(c) { return typeof c === 'string' && isNaN(lireQuantite(c)) && !lireDate(c); }
  function estNombre(c) { return !isNaN(lireQuantite(c)); }
  function estDate(c) { return !!lireDate(c, 'jma') || !!lireDate(c, 'mja'); }

  // Premier candidat dont les valeurs ressemblent au contenu attendu.
  function choisir(liste, donnees, test, seuil, pris) {
    for (var i = 0; i < liste.length; i++) {
      if (pris.indexOf(liste[i]) !== -1) continue;
      if (!donnees.length || part(donnees, liste[i], test) >= seuil) return liste[i];
    }
    return -1;
  }

  function premier(liste, pris) {
    for (var i = 0; i < liste.length; i++) if (pris.indexOf(liste[i]) === -1) return liste[i];
    return -1;
  }

  // Colonnes d'une ligne d'en-tête candidate, vérifiées sur les lignes suivantes.
  function colonnesDe(tableau, iEntete) {
    var entetes = tableau[iEntete].map(cellule);
    var donnees = tableau.slice(iEntete + 1, iEntete + 201).filter(function (l) { return !estEnteteRepete(l, entetes); });
    var pris = [];
    var produit = choisir(candidats(entetes, PRODUIT, PRODUIT_PARTIEL, PRODUIT_EXCLU), donnees, estTexte, 0.5, pris);
    if (produit !== -1) pris.push(produit);
    var quantite = choisir(candidats(entetes, QUANTITE, QUANTITE_PARTIEL, QUANTITE_EXCLU), donnees, estNombre, 0.8, pris);
    if (quantite !== -1) pris.push(quantite);
    var date = choisir(candidats(entetes, DATE, DATE_PARTIEL, DATE_EXCLU), donnees, estDate, 0.6, pris);
    if (date !== -1) pris.push(date);
    var variante = premier(candidats(entetes, VARIANTE), pris);
    if (variante !== -1) pris.push(variante);
    var type = premier(candidats(entetes, TYPE), pris);
    if (type !== -1) pris.push(type);
    var statut = premier(candidats(entetes, STATUT), pris);
    return { produit: produit, quantite: quantite, date: date, variante: variante, type: type, statut: statut };
  }

  // Tableau croisé : au moins 2 en-têtes sont des jours.
  function colonnesJours(entetes) {
    var res = [];
    entetes.forEach(function (c, i) {
      var d = typeof c === 'number' ? lireDate(c) : (/\d/.test(cellule(c)) ? lireDate(cellule(c).trim()) : null);
      if (d) res.push({ col: i, jour: d });
    });
    return res.length >= 2 ? res : [];
  }

  function trouverEntete(tableau) {
    var max = Math.min(30, tableau.length);
    for (var i = 0; i < max; i++) {
      var c = colonnesDe(tableau, i);
      if (c.produit !== -1 && c.quantite !== -1) return { ligne: i, colonnes: c, format: 'lignes' };
    }
    for (var k = 0; k < max; k++) {
      var jours = colonnesJours(tableau[k]);
      if (jours.length) {
        var entetes = tableau[k].map(cellule);
        var donnees = tableau.slice(k + 1, k + 201);
        var colsJours = jours.map(function (j) { return j.col; });
        var p = choisir(candidats(entetes, PRODUIT, PRODUIT_PARTIEL, PRODUIT_EXCLU), donnees, estTexte, 0.5, colsJours);
        if (p === -1) {
          // Sans titre : première colonne de texte à gauche des jours.
          for (var x = 0; x < colsJours[0]; x++) if (part(donnees, x, estTexte) >= 0.8) { p = x; break; }
        }
        if (p !== -1) return { ligne: k, colonnes: { produit: p }, jours: jours, format: 'articles_x_jours' };
      }
    }
    // Jours en lignes, articles en colonnes : une colonne date, le reste numérique.
    for (var r = 0; r < max; r++) {
      var ent = tableau[r].map(cellule);
      var don = tableau.slice(r + 1, r + 201);
      var d = choisir(candidats(ent, DATE, DATE_PARTIEL, DATE_EXCLU), don, estDate, 0.8, []);
      // Une colonne « Article » existe : ce n'est pas un tableau croisé.
      if (d === -1 || !don.length || candidats(ent, PRODUIT, PRODUIT_PARTIEL, PRODUIT_EXCLU).length) continue;
      var articles = [];
      ent.forEach(function (h, i) {
        if (i === d || !h.trim() || TOTAL.test(h) || ARGENT.test(normaliserEntete(h))) return;
        if (part(don, i, estNombre) >= 0.8) articles.push({ col: i, nom: h.trim() });
      });
      if (articles.length >= 2) return { ligne: r, colonnes: { date: d }, articles: articles, format: 'jours_x_articles' };
    }
    return null;
  }

  // Ce que la page affiche pour choisir les colonnes à la main.
  function analyser(tableau) {
    var e = trouverEntete(tableau || []);
    var ligne = e ? e.ligne : 0;
    var entetes = ((tableau || [])[ligne] || []).map(cellule);
    return { ligneEntete: ligne, entetes: entetes, colonnes: e ? e.colonnes : null, format: e ? e.format : null };
  }

  // ---------- Lecture ----------

  function jourDuTitre(tableau, jusqua) {
    var jours = {};
    tableau.slice(0, jusqua).forEach(function (l) {
      l.forEach(function (c) {
        (typeof c === 'number' ? [lireDate(c)].filter(Boolean) : datesDansTexte(c)).forEach(function (d) { jours[d] = true; });
      });
    });
    var liste = Object.keys(jours);
    return { unique: liste.length === 1 ? liste[0] : null, plusieurs: liste.length > 1 };
  }

  function nomAvecVariante(nom, variante) {
    var v = cellule(variante).trim();
    if (!v || VARIANTE_NEUTRE.test(sansAccents(v)) || normaliserEntete(v) === normaliserEntete(nom)) return nom;
    return nom + ' ' + v;
  }

  function estEnteteRepete(cellules, entetes) {
    var n = 0;
    for (var i = 0; i < entetes.length; i++) if (entetes[i] && cellule(cellules[i]).trim() === entetes[i].trim()) n++;
    return n >= 2;
  }

  // options : { colonnes: { produit, quantite, date, variante }, ligneEntete }
  // (indices imposés par le commerçant). Retour : { lignes, erreur?, format, colonnes, ignorees }.
  function lignesDepuisTableau(tableau, jourParDefaut, options) {
    options = options || {};
    tableau = (tableau || []).filter(function (l) { return l && l.some(function (c) { return cellule(c).trim() !== ''; }); });
    if (tableau.length < 2) return { lignes: [], erreur: 'Fichier vide ou sans en-tête' };

    var trouve;
    if (options.colonnes && options.colonnes.produit >= 0 && options.colonnes.quantite >= 0) {
      var auto = colonnesDe(tableau, options.ligneEntete || 0);
      trouve = { ligne: options.ligneEntete || 0, format: 'lignes', colonnes: {
        produit: options.colonnes.produit, quantite: options.colonnes.quantite,
        date: options.colonnes.date === undefined ? -1 : options.colonnes.date,
        variante: options.colonnes.variante === undefined ? -1 : options.colonnes.variante,
        type: auto.type, statut: auto.statut } };
    } else {
      trouve = trouverEntete(tableau);
    }
    if (!trouve) {
      return { lignes: [], code: 'colonnes', erreur: 'Colonnes article ou quantité introuvables (en-têtes : ' + tableau[0].map(cellule).join(', ').slice(0, 300) + ')' };
    }

    var entetes = tableau[trouve.ligne].map(cellule);
    var donnees = tableau.slice(trouve.ligne + 1);
    var c = trouve.colonnes;
    var lignes = [];
    var ignorees = 0;

    if (trouve.format === 'articles_x_jours') {
      donnees.forEach(function (cellules) {
        var nom = cellule(cellules[c.produit]).trim();
        if (!nom || TOTAL.test(nom)) return;
        trouve.jours.forEach(function (j) {
          var q = lireQuantite(cellules[j.col]);
          if (isNaN(q)) return;
          lignes.push({ nom_produit: nom, quantite: q, date_vente: j.jour });
        });
      });
      return { lignes: lignes, format: trouve.format, colonnes: c, ignorees: 0 };
    }

    if (trouve.format === 'jours_x_articles') {
      var ordreJ = ordreDates(donnees.map(function (l) { return l[c.date]; }));
      donnees.forEach(function (cellules) {
        var jour = lireDate(cellules[c.date], ordreJ);
        if (!jour) return;
        trouve.articles.forEach(function (a) {
          var q = lireQuantite(cellules[a.col]);
          if (!isNaN(q)) lignes.push({ nom_produit: a.nom, quantite: q, date_vente: jour });
        });
      });
      return { lignes: lignes, format: trouve.format, colonnes: c, ignorees: 0 };
    }

    var ordre = c.date === -1 ? 'jma' : ordreDates(donnees.map(function (l) { return l[c.date]; }));
    var titre = jourDuTitre(tableau, trouve.ligne);
    var jourSection = null;
    var defaut = titre.unique || jourParDefaut;

    donnees.forEach(function (cellules) {
      var nom = cellule(cellules[c.produit]).trim();
      var quantite = lireQuantite(cellules[c.quantite]);
      if (c.date === -1 && isNaN(quantite)) {
        // Ligne-titre de jour (« Date : 29/10/2026 », « Mercredi 29 octobre 2026 »).
        var dates = [];
        cellules.forEach(function (x) { dates = dates.concat(typeof x === 'number' ? [] : datesDansTexte(x)); });
        if (dates.length === 1) { jourSection = dates[0]; return; }
      }
      if (!nom || TOTAL.test(nom) || estEnteteRepete(cellules, entetes)) return;
      if (isNaN(quantite)) { ignorees++; return; }
      if (c.statut !== -1 && c.statut !== undefined && ANNULE.test(sansAccents(cellule(cellules[c.statut])))) { ignorees++; return; }
      if (c.type !== -1 && c.type !== undefined && REMBOURSEMENT.test(sansAccents(cellule(cellules[c.type]))) && quantite > 0) quantite = -quantite;
      var jour = c.date === -1 ? (jourSection || defaut) : lireDate(cellules[c.date], ordre);
      if (!jour) { ignorees++; return; }
      lignes.push({ nom_produit: c.variante >= 0 ? nomAvecVariante(nom, cellules[c.variante]) : nom, quantite: quantite, date_vente: jour });
    });

    if (!lignes.length && c.date === -1 && !defaut && !jourSection) {
      return { lignes: [], code: 'date', erreur: titre.plusieurs
        ? 'Ce fichier couvre plusieurs jours sans colonne date : exporte les ventes « par jour » (ou un fichier par jour)'
        : 'Colonne date introuvable : exporte les ventes « par jour »', format: 'lignes', colonnes: c };
    }
    return { lignes: lignes, format: 'lignes', colonnes: c, ignorees: ignorees };
  }

  function lignesDepuisExport(texte, jourParDefaut, options) {
    return lignesDepuisTableau(lireCsv(texte), jourParDefaut, options);
  }

  // Classeur Excel : la première feuille qui contient des ventes.
  function lignesDepuisFeuilles(feuilles, jourParDefaut, options) {
    var premiere = null;
    for (var i = 0; i < feuilles.length; i++) {
      var r = lignesDepuisTableau(feuilles[i], jourParDefaut, options);
      if (r.lignes.length) { r.feuille = i; return r; }
      if (!premiere) premiere = r;
    }
    return premiere || { lignes: [], erreur: 'Classeur vide' };
  }

  var api = {
    lireCsv: lireCsv, lireDate: lireDate, lireQuantite: lireQuantite, decoderOctets: decoderOctets, analyser: analyser,
    lignesDepuisTableau: lignesDepuisTableau, lignesDepuisExport: lignesDepuisExport, lignesDepuisFeuilles: lignesDepuisFeuilles
  };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  racine.LectureExport = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
