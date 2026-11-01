// Question « Quelle caisse utilises-tu ? » (lot 1) : à l'inscription
// (facultative, gardée dans les métadonnées du compte) et dans Paramètres
// (colonne parametres_commercant.caisse). Sert à choisir le prochain
// connecteur sur des faits. Valeur : 'sumup', … , 'aucune' ou 'autre: <texte>'.
// Convention du site : IIFE, ES5.
(function () {
  var CAISSES = [
    ['sumup', 'SumUp (terminal et appli SumUp)'], ['zettle', 'Zettle'], ['bimedia', 'Bimedia'], ['lightspeed', 'Lightspeed'],
    ['hiboutik', 'Hiboutik'], ['tactill', 'Tactill'], ['toporder', 'Toporder'], ['crisalid', 'Crisalid'],
    ['square', 'Square'], ['loyverse', 'Loyverse'], ['tiller', 'SumUp Caisse Pro, ex-Tiller'], ['zelty', 'Zelty'],
    ['laddition', 'L\'Addition'], ['cashpad', 'Cashpad'], ['cashmag', 'Cashmag'],
    ['autre', 'Autre'], ['aucune', 'Pas de caisse']
  ];
  // Branchables par une clé que le commerçant crée lui-même (connecteur-caisse.js).
  var AVEC_CLE = ['sumup', 'zettle', 'square', 'loyverse', 'tactill', 'hiboutik'];

  // Remplit <select id> et branche le champ texte « Autre » (#idAutre).
  function brancher(idSelect, idAutre, valeur) {
    var select = document.getElementById(idSelect);
    var autre = document.getElementById(idAutre);
    if (!select) return;
    select.innerHTML = '<option value="">Choisir (facultatif)</option>' + CAISSES.map(function (c) {
      // Honnête sur le branchement : les caisses à clé personnelle se
      // branchent directement (sous réserve de mise en service, la page
      // Ma caisse dit « bientôt » sinon), les autres passent par un fichier.
      var mode = AVEC_CLE.indexOf(c[0]) !== -1 ? '' : (c[0] === 'autre' || c[0] === 'aucune' ? '' : ' (par fichier)');
      return '<option value="' + c[0] + '">' + c[1] + mode + '</option>';
    }).join('');
    function maj() { autre.hidden = select.value !== 'autre'; }
    select.addEventListener('change', maj);
    definir(idSelect, idAutre, valeur);
    maj();
  }

  function definir(idSelect, idAutre, valeur) {
    var select = document.getElementById(idSelect);
    var autre = document.getElementById(idAutre);
    if (!valeur) { select.value = ''; }
    else if (valeur.indexOf('autre:') === 0) { select.value = 'autre'; autre.value = valeur.slice(6).trim(); }
    else { select.value = valeur; }
    autre.hidden = select.value !== 'autre';
  }

  function lire(idSelect, idAutre) {
    var v = document.getElementById(idSelect).value;
    if (!v) return null;
    if (v === 'autre') {
      var texte = document.getElementById(idAutre).value.trim().slice(0, 60);
      return texte ? 'autre: ' + texte : 'autre';
    }
    return v;
  }

  window.CaisseUtilisee = { brancher: brancher, definir: definir, lire: lire };
})();
