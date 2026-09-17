// Navigation commune à toutes les pages connectées.
// Injecte le HTML de la barre de nav dans <nav id="navPrincipale"></nav>
// et marque l'entrée active selon le fichier courant (window.location.pathname).
// Convention du site : IIFE, style ES5 (var, pas de const/let/arrow).
//
// Structure (refonte sept. 2026, maquette validée "Maquette À Point") :
// Accueil / Prévisions / Planning restent TOUJOURS visibles dans
// #navPrincipale.nav-globale (jamais dupliqués dans le ☰) ; Mes produits /
// Commandes / Imports passent en "repli" sous 720px. Paramètres et Aide
// forment une nav secondaire (.nav-secondaire) ajoutée ici comme SIBLING de
// #navPrincipale, à l'intérieur du même <header class="entete-site"> —
// jamais imbriquée dedans. C'est ce qui permet à style.css de garder les
// 4 blocs (logo, nav-globale, nav-secondaire, ☰) sur une seule ligne en
// desktop, et de replier le ☰ juste à côté du logo en mobile (voir
// maquette : .entete-interieure). Le panneau ☰ (.panneau-hamburger) est lui
// inséré comme sibling du <header> lui-même, pour s'afficher en pleine
// largeur sous la barre plutôt qu'en dropdown accroché au bouton.
(function () {
  var LIENS_PRINCIPAUX = [
    { href: 'tableau-de-bord.html', label: 'Accueil' },
    { href: 'previsions.html', label: 'Prévisions', match: ['previsions.html', 'semaine.html'] },
    { href: 'personnel.html', label: 'Planning' }
  ];

  var LIENS_REPLI = [
    { href: 'produits.html', label: 'Mes produits' },
    { href: 'commandes.html', label: 'Commandes' },
    { href: 'import.html', label: 'Imports' }
  ];

  var LIENS_SECONDAIRES = [
    { href: 'parametres.html', label: 'Paramètres' },
    { href: 'aide.html', label: '? Aide' }
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

  function lienHTML(entree, actif, classe) {
    return '<a href="' + entree.href + '" class="' + classe + (actif ? ' actif' : '') + '">' + entree.label + '</a>';
  }

  function construireNavGlobale(fichierCourant) {
    var html = '';
    LIENS_PRINCIPAUX.forEach(function (entree) {
      html += lienHTML(entree, estActif(entree, fichierCourant), 'nav-lien-g');
    });
    LIENS_REPLI.forEach(function (entree) {
      html += lienHTML(entree, estActif(entree, fichierCourant), 'nav-lien-g nav-lien-g--repli');
    });
    return html;
  }

  function construireNavSecondaire(fichierCourant) {
    var html = '';
    LIENS_SECONDAIRES.forEach(function (entree) {
      html += lienHTML(entree, estActif(entree, fichierCourant), 'nav-lien-s');
    });
    return html;
  }

  // Panneau ☰ (mobile uniquement, voir style.css) : reprend les liens de
  // repli + la nav secondaire, jamais les 3 liens principaux (déjà visibles
  // sous le logo en permanence).
  function construireLiensHamburger(fichierCourant) {
    var html = '';
    LIENS_REPLI.forEach(function (entree) {
      html += lienHTML(entree, estActif(entree, fichierCourant), 'nav-lien-h');
    });
    LIENS_SECONDAIRES.forEach(function (entree) {
      html += lienHTML(entree, estActif(entree, fichierCourant), 'nav-lien-h');
    });
    return html;
  }

  function activerHamburger(bouton, panneau) {
    bouton.addEventListener('click', function (e) {
      e.stopPropagation();
      var ouvert = panneau.classList.contains('panneau-hamburger--ouvert');
      panneau.classList.toggle('panneau-hamburger--ouvert', !ouvert);
      bouton.setAttribute('aria-expanded', ouvert ? 'false' : 'true');
    });
    document.addEventListener('click', function (e) {
      if (!panneau.contains(e.target) && e.target !== bouton) {
        panneau.classList.remove('panneau-hamburger--ouvert');
        bouton.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function initNav() {
    var nav = document.getElementById('navPrincipale');
    if (!nav) return;
    var entete = nav.parentElement;
    var fichierCourant = nomFichierCourant();

    // style.css cible .nav-globale pour le layout flex (espacement des
    // liens) ; sans cette classe, la nav retombe en display:block et les
    // liens s'affichent collés (bug retour utilisateur, sept. 2026).
    nav.classList.add('nav-globale');
    nav.innerHTML = construireNavGlobale(fichierCourant);

    // .nav-secondaire et .btn-hamburger : SIBLINGS de #navPrincipale dans
    // le même <header>, jamais imbriqués dedans (voir maquette validée) —
    // sinon le ☰ finit seul sur sa propre ligne au lieu de rester à côté
    // du logo en mobile (bug retour utilisateur, sept. 2026).
    var navSecondaire = document.createElement('nav');
    navSecondaire.className = 'nav-secondaire';
    navSecondaire.innerHTML = construireNavSecondaire(fichierCourant);
    entete.appendChild(navSecondaire);

    var bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'btn-hamburger';
    bouton.setAttribute('aria-haspopup', 'true');
    bouton.setAttribute('aria-expanded', 'false');
    bouton.setAttribute('aria-label', 'Plus de pages');
    bouton.textContent = '☰';
    entete.appendChild(bouton);

    // .panneau-hamburger : sibling du <header> lui-même (pleine largeur
    // sous la barre, jamais un dropdown accroché au bouton — voir maquette).
    var panneau = document.createElement('nav');
    panneau.className = 'panneau-hamburger';
    panneau.innerHTML = construireLiensHamburger(fichierCourant);
    entete.parentNode.insertBefore(panneau, entete.nextSibling);

    activerHamburger(bouton, panneau);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNav);
  } else {
    initNav();
  }
})();
