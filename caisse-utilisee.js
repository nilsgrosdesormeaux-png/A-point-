// Question « Quelle caisse utilises-tu ? » (lot 1) : à l'inscription
// (facultative, gardée dans les métadonnées du compte) et dans Paramètres
// (colonne parametres_commercant.caisse). Sert à choisir le prochain
// connecteur sur des faits. Valeur : 'sumup', … , 'aucune' ou 'autre: <texte>'.
// Convention du site : IIFE, ES5.
(function () {
  // Une entrée par caisse, ordre alphabétique, sans doublon. SumUp est une
  // seule entrée : « terminal ou appli SumUp » (clé) et « SumUp Caisse Pro
  // sur iPad, ex-Tiller » se distinguent ensuite par une question sur la page
  // Ma caisse (valeur enregistrée 'tiller' pour la seconde).
  var CAISSES = [
    ['bimedia', 'Bimedia'], ['cashmag', 'Cashmag'], ['cashpad', 'Cashpad'], ['crisalid', 'Crisalid'],
    ['hiboutik', 'Hiboutik'], ['laddition', 'L\'Addition'], ['lightspeed', 'Lightspeed Restaurant (série K)'],
    ['lightspeed_retail', 'Lightspeed Retail (commerce)'], ['loyverse', 'Loyverse'], ['popina', 'Popina'],
    ['square', 'Square'], ['sumup', 'SumUp'], ['tactill', 'Tactill'], ['toporder', 'Toporder'],
    ['zelty', 'Zelty'], ['zettle', 'Zettle (PayPal)'],
    ['autre', 'Autre'], ['aucune', 'Pas de caisse']
  ];
  // Sous-choix de SumUp (pas d'entrée propre dans la liste).
  var SOUS_CHOIX = { tiller: 'sumup' };

  // Remplit <select id> et branche le champ texte « Autre » (#idAutre).
  function brancher(idSelect, idAutre, valeur) {
    var select = document.getElementById(idSelect);
    var autre = document.getElementById(idAutre);
    if (!select) return;
    select.innerHTML = '<option value="">Choisir (facultatif)</option>' + CAISSES.map(function (c) {
      return '<option value="' + c[0] + '">' + c[1] + '</option>';
    }).join('');
    function maj() { autre.hidden = select.value !== 'autre'; if (select.value !== 'sumup') select.removeAttribute('data-sous-choix'); }
    select.addEventListener('change', maj);
    definir(idSelect, idAutre, valeur);
    maj();
  }

  function definir(idSelect, idAutre, valeur) {
    var select = document.getElementById(idSelect);
    var autre = document.getElementById(idAutre);
    select.removeAttribute('data-sous-choix');
    if (!valeur) { select.value = ''; }
    else if (valeur.indexOf('autre:') === 0) { select.value = 'autre'; autre.value = valeur.slice(6).trim(); }
    else if (SOUS_CHOIX[valeur]) { select.value = SOUS_CHOIX[valeur]; select.setAttribute('data-sous-choix', valeur); }
    else { select.value = valeur; }
    autre.hidden = select.value !== 'autre';
  }

  // SumUp : « tiller » (Caisse Pro sur iPad) ou rien (terminal / appli).
  function definirSousChoix(idSelect, valeur) {
    var select = document.getElementById(idSelect);
    if (valeur) select.setAttribute('data-sous-choix', valeur); else select.removeAttribute('data-sous-choix');
  }

  function lire(idSelect, idAutre) {
    var v = document.getElementById(idSelect).value;
    if (!v) return null;
    var sous = document.getElementById(idSelect).getAttribute('data-sous-choix');
    if (sous && SOUS_CHOIX[sous] === v) return sous;
    if (v === 'autre') {
      var texte = document.getElementById(idAutre).value.trim().slice(0, 60);
      return texte ? 'autre: ' + texte : 'autre';
    }
    return v;
  }

  window.CaisseUtilisee = { brancher: brancher, definir: definir, definirSousChoix: definirSousChoix, lire: lire };
})();
