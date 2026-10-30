// Navigation commune à toutes les pages connectées.
// Injecte les 5 onglets dans <nav id="navPrincipale"></nav> et ajoute le
// menu du compte (Paramètres, Achats & commandes, Aide) dans le même
// <header class="entete-site">. Convention du site : IIFE, style ES5.
//
// Refonte oct. 2026 (voir REFONTE.md § 1) : Demain, Semaine, Ventes,
// Produits, Bilan. Planning (personnel.html) et Espace employé
// (espace-employe.html) sont retirés de la navigation, fichiers conservés.
// Sous 720px, style.css fixe les onglets en bas d'écran (pouce).
(function () {
  var ICONES = {
    demain: '<path d="M12 3v2M5.6 5.6l1.4 1.4M3 12h2M19 12h2M17 7l1.4-1.4M7 16a5 5 0 0 1 10 0"/><path d="M3 19h18"/>',
    semaine: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    ventes: '<path d="M4 19V9M10 19V5M16 19v-7M21 19H3"/>',
    produits: '<path d="M5 14c0-4 3-8 7-8s7 4 7 8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z"/><path d="M9 10l1 3M12 9v4M15 10l-1 3"/>',
    bilan: '<path d="M4 20h16"/><path d="M6 16l4-5 3 3 5-7"/><path d="M15 7h3v3"/>',
    compte: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1.2-3.6 4-5 7-5s5.8 1.4 7 5"/>'
  };

  // match : fichiers (et vue éventuelle ?vue=...) qui rendent l'onglet actif.
  var ONGLETS = [
    { href: 'previsions.html', label: 'Demain', icone: 'demain', match: ['previsions.html', 'tableau-de-bord.html'] },
    { href: 'previsions.html?vue=semaine', label: 'Semaine', icone: 'semaine', match: ['previsions.html?vue=semaine', 'semaine.html'] },
    { href: 'ventes.html', label: 'Ventes', icone: 'ventes', match: ['ventes.html', 'import.html'] },
    { href: 'produits.html', label: 'Produits', icone: 'produits' },
    { href: 'statistiques.html', label: 'Bilan', icone: 'bilan' }
  ];

  var LIENS_COMPTE = [
    { href: 'parametres.html', label: 'Paramètres' },
    { href: 'commandes.html', label: 'Achats & commandes' },
    { href: 'aide.html', label: 'Aide' }
  ];

  function icone(nom) {
    return '<svg class="nav-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONES[nom] + '</svg>';
  }

  // Page courante + vue (?vue=semaine) : Demain et Semaine partagent
  // previsions.html, seule la vue les distingue.
  function pageCourante() {
    var segments = window.location.pathname.split('/');
    var fichier = segments[segments.length - 1] || 'index.html';
    var vue = /[?&]vue=([a-z]+)/.exec(window.location.search);
    return vue ? fichier + '?vue=' + vue[1] : fichier;
  }

  function estActif(entree, courante) {
    var cibles = entree.match || [entree.href];
    return cibles.indexOf(courante) !== -1;
  }

  function construireOnglets(courante) {
    return ONGLETS.map(function (entree) {
      var actif = estActif(entree, courante);
      return '<a href="' + entree.href + '" class="nav-onglet' + (actif ? ' actif' : '') + '"' +
        (actif ? ' aria-current="page"' : '') + '>' + icone(entree.icone) + '<span>' + entree.label + '</span></a>';
    }).join('');
  }

  function construireMenuCompte(courante) {
    return LIENS_COMPTE.map(function (entree) {
      var actif = entree.href === courante;
      return '<a href="' + entree.href + '"' + (actif ? ' class="actif" aria-current="page"' : '') + '>' + entree.label + '</a>';
    }).join('') + '<hr><a href="cgu.html">Conditions d\'utilisation</a>';
  }

  function activerMenuCompte(bouton, menu) {
    function fermer() {
      menu.classList.remove('ouvert');
      bouton.setAttribute('aria-expanded', 'false');
    }
    bouton.addEventListener('click', function (e) {
      e.stopPropagation();
      var ouvert = menu.classList.toggle('ouvert');
      bouton.setAttribute('aria-expanded', ouvert ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) {
      if (!menu.contains(e.target)) fermer();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('ouvert')) { fermer(); bouton.focus(); }
    });
  }

  function initNav() {
    var nav = document.getElementById('navPrincipale');
    if (!nav) return;
    var entete = nav.parentElement;
    var courante = pageCourante();

    nav.className = 'nav-onglets';
    nav.setAttribute('aria-label', 'Navigation principale');
    nav.innerHTML = construireOnglets(courante);
    document.body.classList.add('avec-onglets');

    var compte = document.createElement('div');
    compte.className = 'compte';
    compte.innerHTML =
      '<button type="button" class="btn-compte" aria-haspopup="true" aria-expanded="false" aria-controls="menuCompte" aria-label="Mon compte">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONES.compte + '</svg>' +
      '</button>' +
      '<nav class="menu-compte" id="menuCompte" aria-label="Mon compte">' + construireMenuCompte(courante) + '</nav>';
    entete.appendChild(compte);

    activerMenuCompte(compte.querySelector('.btn-compte'), compte.querySelector('.menu-compte'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNav);
  } else {
    initNav();
  }
})();
