// Navigation commune à toutes les pages connectées.
// Injecte le HTML de la barre de nav dans <nav id="navPrincipale"></nav>
// et marque l'entrée active selon le fichier courant (window.location.pathname).
// Convention du site : IIFE, style ES5 (var, pas de const/let/arrow).
(function () {
  var PAGES = [
    { href: 'tableau-de-bord.html', label: 'Tableau de bord' },
    {
      label: 'Activité',
      match: ['semaine.html', 'personnel.html'],
      sousLiens: [
        { href: 'semaine.html', label: 'Affluence' },
        { href: 'personnel.html#equipe', label: 'Équipe', match: 'personnel.html' },
        { href: 'personnel.html#planning', label: 'Planning', match: 'personnel.html' }
      ]
    },
    { href: 'produits.html', label: 'Produits' },
    { href: 'commandes.html', label: 'Commandes', match: ['commandes.html', 'import.html'] },
    { href: 'parametres.html', label: 'Paramètres' }
  ];

  function nomFichierCourant() {
    var chemin = window.location.pathname;
    var segments = chemin.split('/');
    var dernier = segments[segments.length - 1];
    return dernier || 'index.html';
  }

  function estActif(entree, fichierCourant) {
    var cibles = entree.match || entree.href;
    if (typeof cibles === 'string') cibles = [cibles];
    for (var i = 0; i < cibles.length; i++) {
      if (cibles[i].split('#')[0] === fichierCourant) return true;
    }
    return false;
  }

  function construireLienPrincipal(entree, actif) {
    if (entree.sousLiens) {
      var html = '<div class="nav-menu' + (actif ? ' nav-menu--actif' : '') + '">';
      html += '<button type="button" class="nav-lien nav-lien--menu' + (actif ? ' nav-actif' : '') + '" aria-haspopup="true" aria-expanded="false">' + entree.label + ' <span class="nav-menu-fleche">▾</span></button>';
      html += '<div class="nav-sous-menu">';
      entree.sousLiens.forEach(function (sl) {
        var sousActif = window.location.pathname.split('/').pop() === (sl.match || sl.href.split('#')[0]) && (sl.href.indexOf('#') === -1 || window.location.hash === '#' + sl.href.split('#')[1]);
        html += '<a href="' + sl.href + '" class="nav-sous-lien' + (sousActif ? ' nav-actif' : '') + '">' + sl.label + '</a>';
      });
      html += '</div></div>';
      return html;
    }
    return '<a href="' + entree.href + '" class="nav-lien' + (actif ? ' nav-actif' : '') + '">' + entree.label + '</a>';
  }

  function construireNav() {
    var fichierCourant = nomFichierCourant();
    var html = '';
    PAGES.forEach(function (entree) {
      html += construireLienPrincipal(entree, estActif(entree, fichierCourant));
    });
    var aideActif = fichierCourant === 'aide.html';
    html += '<a href="aide.html" class="nav-lien nav-lien--discret' + (aideActif ? ' nav-actif' : '') + '" title="Aide">? Aide</a>';
    return html;
  }

  function activerMenusMobiles(nav) {
    // Au clic (tap mobile / desktop), bascule le sous-menu ; au survol
    // (souris), le CSS gère déjà l'ouverture. On ferme au clic ailleurs.
    var menus = nav.querySelectorAll('.nav-menu');
    menus.forEach(function (menu) {
      var bouton = menu.querySelector('.nav-lien--menu');
      bouton.addEventListener('click', function (e) {
        e.stopPropagation();
        var ouvert = menu.classList.contains('nav-menu--ouvert');
        menus.forEach(function (m) { m.classList.remove('nav-menu--ouvert'); });
        if (!ouvert) menu.classList.add('nav-menu--ouvert');
        bouton.setAttribute('aria-expanded', ouvert ? 'false' : 'true');
      });
    });
    document.addEventListener('click', function () {
      menus.forEach(function (m) { m.classList.remove('nav-menu--ouvert'); });
    });
  }

  function initNav() {
    var nav = document.getElementById('navPrincipale');
    if (!nav) return;
    nav.innerHTML = construireNav();
    activerMenusMobiles(nav);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNav);
  } else {
    initNav();
  }
})();
