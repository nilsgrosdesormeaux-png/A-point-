// Navigation commune à toutes les pages connectées.
// Injecte les 5 onglets dans <nav id="navPrincipale"></nav> et ajoute le
// menu du compte (Paramètres, Mes données, Aide) dans le même
// <header class="entete-site">. Convention du site : IIFE, style ES5.
//
// Plan v2 (AMELIORATIONS.md) : Fournée, Commande, Semaine, Bilan, Caisse. Planning
// (personnel.html) et Espace employé (espace-employe.html) restent hors
// navigation, fichiers conservés.
// Sous 720px, style.css fixe les onglets en bas d'écran (pouce).
(function () {
  var ICONES = {
    fournee: '<path d="M3 20h18"/><path d="M5 20v-7a7 7 0 0 1 14 0v7"/><path d="M9 20v-4a3 3 0 0 1 6 0v4"/>',
    commande: '<path d="M4 7h16l-1.5 12.5a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/>',
    semaine: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    bilan: '<path d="M4 20h16"/><path d="M6 16l4-5 3 3 5-7"/><path d="M15 7h3v3"/>',
    caisse: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M7 10V5h10v5"/><path d="M8 14h3M14 14h2M8 17h8"/>',
    compte: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1.2-3.6 4-5 7-5s5.8 1.4 7 5"/>'
  };

  // Plan v2 (oct. 2026) : 4 onglets. Ventes et Produits passent dans
  // Paramètres > Mes données (secours quand la caisse n'est pas branchée).
  // match : fichiers qui rendent l'onglet actif.
  var ONGLETS = [
    { href: 'previsions.html', label: 'Fournée', icone: 'fournee', match: ['previsions.html', 'tableau-de-bord.html'] },
    { href: 'commandes.html', label: 'Commande', icone: 'commande' },
    { href: 'semaine.html', label: 'Semaine', icone: 'semaine' },
    { href: 'statistiques.html', label: 'Bilan', icone: 'bilan' },
    { href: 'caisse.html', label: 'Caisse', icone: 'caisse' }
  ];

  var LIENS_COMPTE = [
    { href: 'parametres.html', label: 'Paramètres' },
    { href: 'parametres.html#donnees', label: 'Mes données', match: ['ventes.html', 'produits.html', 'import.html'] },
    { href: 'aide.html', label: 'Aide' }
  ];

  function icone(nom) {
    return '<svg class="nav-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONES[nom] + '</svg>';
  }

  function pageCourante() {
    var segments = window.location.pathname.split('/');
    return segments[segments.length - 1] || 'index.html';
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
      var actif = entree.href === courante || (entree.match || []).indexOf(courante) !== -1;
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
