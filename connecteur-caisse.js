// Bloc « Ma caisse » de Paramètres (REFONTE.md § 4 bis, AMELIORATIONS.md).
// Autonome : la page fournit un <div id="blocCaisse"> et appelle
// ConnecteurCaisse.init(sbClient, commercantId, caisseCompte). Le parcours
// suit la caisse déclarée (inscription ou Paramètres) :
//  - SumUp, Zettle, Square : bouton « Brancher » (OAuth) ;
//  - Hiboutik : le commerçant colle ses accès API ;
//  - toute autre caisse : import guidé de l'historique (fichier d'export,
//    même gros) puis envoi automatique de l'export chaque jour par e-mail.
// Après branchement : progression de l'import des 12 mois d'historique.
//
// Lit l'état dans connexions_caisse (RLS) ; tout le reste passe par l'Edge
// Function connecter-caisse ou la fonction SQL importer_historique_ventes.
// Lecture des fichiers : LectureExport (lecture-export.js), Excel via
// SheetJS chargé seulement si besoin. Convention du site : IIFE, ES5.
(function () {
  var LIBELLES = { sumup: 'SumUp', zettle: 'Zettle', square: 'Square', hiboutik: 'Hiboutik' };
  var OAUTH = ['sumup', 'zettle', 'square'];
  var URL_SHEETJS = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  var LIGNES_PAR_ENVOI = 4000;
  var MOIS_HISTORIQUE = 12;

  function echapper(texte) {
    var div = document.createElement('div');
    div.textContent = texte === null || texte === undefined ? '' : String(texte);
    return div.innerHTML;
  }

  function formaterDateHeure(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  function jourParis(d) {
    return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }

  function joursEntre(a, b) {
    return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
  }

  function styleSecondaire() {
    return 'background-color: var(--surface); color: var(--texte); border: 1px solid var(--bordure);';
  }

  // « Import de ton historique : 4 mois sur 12… » tant que les 12 mois ne
  // sont pas arrivés, puis l'état de la dernière synchro.
  function pastille(classe, texte) {
    return '<span class="' + classe + '" style="display:inline-block; padding:2px 8px; border-radius:6px; font-weight:600;">' + texte + '</span> ';
  }

  function formaterJour(iso) {
    return iso ? new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '';
  }

  // État lisible : erreur, historique en cours, en retard ou à jour.
  function etatConnexion(cx) {
    var hier = jourParis(new Date(Date.now() - 86400000));
    var avantHier = jourParis(new Date(Date.now() - 2 * 86400000));
    if (cx.statut === 'erreur') {
      return pastille('erreur', 'Erreur') + echapper(cx.derniere_erreur);
    }
    if (cx.fournisseur === 'export_email') {
      if (!cx.derniere_synchro) return 'En attente du premier e-mail de ta caisse.';
      if (Date.now() - Date.parse(cx.derniere_synchro) > 36 * 3600000) {
        return pastille('erreur', 'En retard') + 'Aucun export reçu depuis le ' + formaterDateHeure(cx.derniere_synchro) + '. Vérifie l\'envoi automatique dans ta caisse.';
      }
      return pastille('succes', 'À jour') + 'Dernier export reçu le ' + formaterDateHeure(cx.derniere_synchro) + '.';
    }
    if (cx.debut_historique && !cx.derniere_synchro) {
      var total = Math.max(1, joursEntre(cx.debut_historique, hier) + 1);
      var faits = cx.derniere_date_synchronisee ? joursEntre(cx.debut_historique, cx.derniere_date_synchronisee) + 1 : 0;
      var mois = Math.min(MOIS_HISTORIQUE, Math.floor(faits / total * MOIS_HISTORIQUE));
      return 'Import de ton historique : <strong>' + mois + ' mois sur ' + MOIS_HISTORIQUE + '</strong>… Ça continue tout seul, même page fermée.';
    }
    if (!cx.derniere_synchro) return 'Branchée. Les ventes arrivent dans quelques minutes.';
    if (cx.derniere_date_synchronisee && cx.derniere_date_synchronisee < avantHier) {
      return pastille('erreur', 'En retard') + 'Dernières ventes reçues : ' + formaterJour(cx.derniere_date_synchronisee) + '. Ça repart tout seul ; sinon, appuie sur « Synchroniser maintenant ».';
    }
    return pastille('succes', 'À jour') + 'Ventes reçues jusqu\'au ' + formaterJour(cx.derniere_date_synchronisee || hier) + '. Dernière synchro le ' + formaterDateHeure(cx.derniere_synchro) + '.';
  }

  function chargerSheetJS() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise(function (ok, ko) {
      var s = document.createElement('script');
      s.src = URL_SHEETJS;
      s.onload = function () { ok(window.XLSX); };
      s.onerror = function () { ko(new Error('Lecture Excel indisponible : enregistre le fichier en CSV et réessaie.')); };
      document.head.appendChild(s);
    });
  }

  // CSV en UTF-8 ou, à défaut, en Windows-1252 (exports de caisse français).
  function lireTexte(fichier) {
    function lire(encodage) {
      return new Promise(function (ok, ko) {
        var r = new FileReader();
        r.onload = function () { ok(r.result); };
        r.onerror = function () { ko(new Error('Fichier illisible')); };
        r.readAsText(fichier, encodage);
      });
    }
    return lire('utf-8').then(function (texte) {
      return texte.indexOf('�') === -1 ? texte : lire('windows-1252');
    });
  }

  function lireFichier(fichier) {
    var hier = null; // pas de jour par défaut : un historique a besoin de sa colonne date
    if (/\.xlsx?$/i.test(fichier.name)) {
      return chargerSheetJS().then(function (XLSX) {
        return fichier.arrayBuffer().then(function (tampon) {
          var classeur = XLSX.read(tampon, { type: 'array' });
          var tableau = XLSX.utils.sheet_to_json(classeur.Sheets[classeur.SheetNames[0]], { header: 1, raw: true });
          return window.LectureExport.lignesDepuisTableau(tableau, hier);
        });
      });
    }
    return lireTexte(fichier).then(function (texte) { return window.LectureExport.lignesDepuisExport(texte, hier); });
  }

  // Paquets d'un mois (un même jour n'est jamais coupé en deux), redécoupés
  // si un mois dépasse la taille maximale d'un envoi.
  function paquetsParMois(lignes) {
    var parMois = {};
    lignes.forEach(function (l) {
      var mois = l.date_vente.slice(0, 7);
      (parMois[mois] = parMois[mois] || []).push(l);
    });
    var paquets = [];
    Object.keys(parMois).sort().forEach(function (mois) {
      var ls = parMois[mois].sort(function (a, b) { return a.date_vente < b.date_vente ? -1 : 1; });
      var courant = [];
      ls.forEach(function (l, i) {
        var nouveauJour = i > 0 && l.date_vente !== ls[i - 1].date_vente;
        if (courant.length >= LIGNES_PAR_ENVOI && nouveauJour) { paquets.push({ mois: mois, lignes: courant }); courant = []; }
        courant.push(l);
      });
      if (courant.length) paquets.push({ mois: mois, lignes: courant });
    });
    return paquets;
  }

  function init(sbClient, commercantId, caisseCompte) {
    var bloc = document.getElementById('blocCaisse');
    if (!bloc) return;
    var disponibles = null;
    var caisseChoisie = caisseCompte || null;
    var choixSurLaPage = false;

    function appeler(corps) {
      return sbClient.functions.invoke('connecter-caisse', { body: corps }).then(function (res) {
        if (res.error) {
          // Le message utile est dans le corps JSON de la réponse d'erreur.
          var contexte = res.error.context;
          if (contexte && contexte.json) {
            return contexte.json().then(function (j) { throw new Error(j.error || res.error.message); });
          }
          throw res.error;
        }
        return res.data;
      });
    }

    function message(texte, estErreur) {
      var el = document.getElementById('messageCaisse');
      if (!el) return;
      el.className = estErreur ? 'erreur' : 'succes';
      el.style.cssText = 'padding:8px 10px; border-radius:6px; margin:8px 0 0;';
      el.textContent = texte;
    }

    function boutonBrancher(nom, principal) {
      return '<button type="button" class="btnBrancher" data-caisse="' + nom + '"' + (principal ? '' : ' style="' + styleSecondaire() + '"') + '>Brancher ma caisse ' + LIBELLES[nom] + '</button>';
    }

    function formulaireHiboutik() {
      return '<p class="texte-aide">Active l\'API dans ton compte Hiboutik (leur aide explique comment, rubrique « activer l\'API »), puis colle ici ta clé API, le nom de ton compte (ce qui est avant « .hiboutik.com ») et ton e-mail Hiboutik.</p>'
        + '<label for="hibCompte">Nom du compte Hiboutik</label><input type="text" id="hibCompte" placeholder="maboulangerie" autocomplete="off">'
        + '<label for="hibUtilisateur">E-mail Hiboutik</label><input type="email" id="hibUtilisateur" placeholder="toi@exemple.fr" autocomplete="off">'
        + '<label for="hibCle">Clé API</label><input type="password" id="hibCle" autocomplete="off">'
        + '<button type="button" id="btnBrancherHiboutik">Brancher ma caisse Hiboutik</button>';
    }

    function sectionFichier(titre) {
      return '<p class="section-titre" style="margin-top:18px;">' + titre + '</p>'
        + '<p class="texte-aide">Dans ta caisse, exporte les <strong>ventes par article et par jour</strong> des 12 derniers mois (CSV ou Excel), puis dépose le fichier ici. Il faut au moins une colonne date, une colonne article et une colonne quantité. Les jours déjà présents sont remplacés, jamais doublés.</p>'
        + '<input type="file" id="fichierHistorique" accept=".csv,.txt,.xlsx,.xls">'
        + '<p class="texte-aide" id="progressionFichier" aria-live="polite"></p>';
    }

    function sectionEmail(email) {
      if (email) {
        return '<p class="section-titre" style="margin-top:18px;">Chaque jour, automatiquement</p>'
          + '<p class="texte-aide">Programme dans ta caisse l\'envoi quotidien de l\'export des ventes vers ton adresse d\'import :</p>'
          + '<p><strong>' + echapper(email.adresse_import) + '</strong></p>'
          + '<p class="texte-aide">' + (email.derniere_synchro ? etatConnexion(email) : 'Aucun export reçu pour l\'instant.') + '</p>';
      }
      if (!disponibles.email) return '';
      return '<p class="section-titre" style="margin-top:18px;">Chaque jour, automatiquement</p>'
        + '<p class="texte-aide">Si ta caisse sait envoyer son export des ventes par e-mail, programme cet envoi chaque jour : tes ventes arriveront seules.</p>'
        + '<button type="button" id="btnAdresseImport" style="' + styleSecondaire() + '">Obtenir mon adresse d\'import</button>';
    }

    function rendre(connexions) {
      var branchees = connexions.filter(function (c) { return c.fournisseur !== 'export_email'; });
      var email = connexions.filter(function (c) { return c.fournisseur === 'export_email'; })[0];
      var html = '<h2 class="section-titre" id="titreCaisse">Ma caisse</h2>';

      if (branchees.length) {
        branchees.forEach(function (cx) {
          html += '<p><strong>Caisse ' + echapper(LIBELLES[cx.fournisseur] || cx.fournisseur) + ' branchée.</strong> Tes ventes arrivent seules chaque nuit.</p>'
            + '<p class="texte-aide">' + etatConnexion(cx) + '</p>'
            + '<div class="ligne-form">'
            + '<button type="button" id="btnSynchroCaisse">Synchroniser maintenant</button>'
            + '<button type="button" class="btnDeconnecter" data-caisse="' + cx.fournisseur + '" style="' + styleSecondaire() + '">Déconnecter</button>'
            + '</div>';
        });
      } else {
        var choix = (caisseChoisie || '').indexOf('autre') === 0 ? 'autre' : caisseChoisie;
        html += '<p class="texte-aide">Branche ta caisse : tes 12 derniers mois de ventes arrivent d\'un coup, puis chaque nuit les ventes de la veille. Tu n\'as plus rien à saisir.</p>';
        if (OAUTH.indexOf(choix) !== -1) {
          html += disponibles[choix]
            ? boutonBrancher(choix, true)
            : '<p class="texte-aide">Le branchement ' + LIBELLES[choix] + ' ouvre très bientôt. En attendant, importe ton historique ci-dessous : tes prévisions seront justes dès demain.</p>';
        } else if (choix === 'hiboutik') {
          html += formulaireHiboutik();
        } else if (!choix) {
          html += '<p class="texte-aide">Choisis ta caisse ci-dessus pour voir le bon parcours. Déjà branchables :</p>';
          OAUTH.forEach(function (nom) { if (disponibles[nom]) html += boutonBrancher(nom, false) + ' '; });
          html += '<button type="button" class="btnHiboutik" style="' + styleSecondaire() + '">J\'ai Hiboutik</button>';
        }
        var titre = (OAUTH.indexOf(choix) !== -1 && disponibles[choix]) || choix === 'hiboutik'
          ? 'Ou bien : importer un fichier'
          : 'Étape 1 : importer ton historique';
        html += sectionFichier(titre);
      }
      if (!branchees.length) html += sectionEmail(email);
      html += '<div id="messageCaisse" aria-live="polite"></div>';
      bloc.innerHTML = html;
      brancherEvenements();
    }

    function brancherEvenements() {
      Array.prototype.forEach.call(bloc.querySelectorAll('.btnBrancher'), function (btn) {
        surClic(btn, function () {
          return appeler({ action: 'demarrer', fournisseur: btn.getAttribute('data-caisse') }).then(function (data) {
            window.location.href = data.url;
            return new Promise(function () {}); // la page part chez la caisse
          });
        });
      });
      Array.prototype.forEach.call(bloc.querySelectorAll('.btnHiboutik'), function (btn) {
        btn.addEventListener('click', function () { caisseChoisie = 'hiboutik'; choixSurLaPage = true; charger(); });
      });
      var btnHib = document.getElementById('btnBrancherHiboutik');
      if (btnHib) surClic(btnHib, function () {
        return appeler({
          action: 'connecter_cle', fournisseur: 'hiboutik',
          compte: document.getElementById('hibCompte').value,
          utilisateur: document.getElementById('hibUtilisateur').value,
          cle: document.getElementById('hibCle').value
        }).then(function () { return charger(); }).then(function () {
          message('Caisse branchée ! Ton historique arrive dans les prochaines minutes.', false);
        });
      });
      var btnSync = document.getElementById('btnSynchroCaisse');
      if (btnSync) surClic(btnSync, function () {
        return appeler({ action: 'synchroniser' }).then(function (r) {
          return charger().then(function () {
            if (!r.ok) message('La synchro a échoué : ' + r.erreur, true);
            else if (!r.complet) message(r.lignes + ' ventes produit importées. La suite continue toute seule.', false);
            else message(r.lignes ? r.lignes + ' ventes produit importées.' : 'Déjà à jour : les ventes jusqu\'à hier sont là.', false);
          });
        });
      });
      Array.prototype.forEach.call(bloc.querySelectorAll('.btnDeconnecter'), function (btn) {
        surClic(btn, function () {
          if (!window.confirm('Déconnecter ta caisse ? Les ventes déjà importées restent, mais plus rien n\'arrivera automatiquement.')) return Promise.resolve();
          return appeler({ action: 'deconnecter', fournisseur: btn.getAttribute('data-caisse') }).then(charger);
        });
      });
      var btnAdresse = document.getElementById('btnAdresseImport');
      if (btnAdresse) surClic(btnAdresse, function () { return appeler({ action: 'activer_import_email' }).then(charger); });
      var entree = document.getElementById('fichierHistorique');
      if (entree) entree.addEventListener('change', function () { if (entree.files[0]) importerFichier(entree); });
    }

    function importerFichier(entree) {
      var progression = document.getElementById('progressionFichier');
      entree.disabled = true;
      progression.textContent = 'Lecture du fichier…';
      lireFichier(entree.files[0]).then(function (lu) {
        if (lu.erreur) throw new Error(lu.erreur);
        if (!lu.lignes.length) throw new Error('Aucune vente trouvée dans ce fichier.');
        var paquets = paquetsParMois(lu.lignes);
        var nbMois = paquets.reduce(function (n, p, i) { return n + (i === 0 || p.mois !== paquets[i - 1].mois ? 1 : 0); }, 0);
        var moisFait = 0;
        var total = 0;
        var suite = Promise.resolve();
        paquets.forEach(function (p, i) {
          suite = suite.then(function () {
            if (i === 0 || p.mois !== paquets[i - 1].mois) moisFait++;
            progression.textContent = 'Import de ton historique : mois ' + moisFait + ' sur ' + nbMois + '…';
            return sbClient.rpc('importer_historique_ventes', { p_lignes: p.lignes }).then(function (res) {
              if (res.error) throw new Error(res.error.message);
              total += res.data || 0;
            });
          });
        });
        return suite.then(function () {
          var jours = lu.lignes.map(function (l) { return l.date_vente; }).sort();
          progression.textContent = '';
          sbClient.rpc('journaliser_import_fichier', { p_nb: total, p_du: jours[0], p_au: jours[jours.length - 1], p_erreur: null, p_detail: entree.files[0].name })
            .then(chargerJournal, function () {});
          message('Historique importé : ' + nbMois + ' mois (du ' + new Date(jours[0]).toLocaleDateString('fr-FR') + ' au '
            + new Date(jours[jours.length - 1]).toLocaleDateString('fr-FR') + '), ' + total + ' ventes produit. Tes prévisions en tiennent compte dès maintenant.', false);
        });
      }).catch(function (e) {
        progression.textContent = '';
        message(e && e.message ? e.message : 'Import impossible, réessaie.', true);
        sbClient.rpc('journaliser_import_fichier', { p_nb: 0, p_du: null, p_au: null, p_erreur: e && e.message ? e.message : 'Import impossible', p_detail: entree.files[0] ? entree.files[0].name : null })
          .then(chargerJournal, function () {});
      }).then(function () { entree.disabled = false; entree.value = ''; });
    }

    function surClic(btn, action) {
      btn.addEventListener('click', function () {
        btn.disabled = true;
        action().catch(function (e) {
          message(e && e.message ? e.message : 'Une erreur est survenue, réessaie.', true);
        }).then(function () { btn.disabled = false; });
      });
    }

    function charger() {
      var etat = disponibles
        ? Promise.resolve(disponibles)
        : appeler({ action: 'etat' }).catch(function () { return {}; });
      var requetes = [sbClient.from('connexions_caisse').select('*').eq('commercant_id', commercantId), etat];
      if (!choixSurLaPage) requetes.push(sbClient.from('parametres_commercant').select('caisse').eq('commercant_id', commercantId));
      return Promise.all(requetes).then(function (r) {
        disponibles = r[1] || {};
        if (r[2] && r[2].data && r[2].data[0]) caisseChoisie = r[2].data[0].caisse || caisseChoisie;
        // Table absente (migration pas encore passée) : on garde le contenu
        // prévu par la page plutôt qu'une erreur.
        if (r[0].error) return;
        rendre(r[0].data || []);
        chargerJournal();
        // Historique en cours d'import : l'avancement se met à jour seul.
        var enCours = (r[0].data || []).some(function (c) { return c.fournisseur !== 'export_email' && etatConnexion(c).indexOf('Import de ton historique') === 0; });
        clearTimeout(minuteur);
        if (enCours) minuteur = setTimeout(charger, 30000);
      });
    }
    var minuteur = null;

    // Journal de chaque réception (page « Ma caisse », #journalCaisse).
    var SOURCES = { api: 'Caisse (automatique)', email: 'E-mail (automatique)', fichier: 'Fichier déposé', branchement: 'Branchement' };
    function chargerJournal() {
      var zone = document.getElementById('journalCaisse');
      if (!zone) return Promise.resolve();
      return sbClient.from('journal_caisse').select('*').eq('commercant_id', commercantId)
        .order('cree_le', { ascending: false }).limit(50).then(function (res) {
          if (res.error) { zone.innerHTML = ''; return; }
          var lignes = res.data || [];
          if (!lignes.length) {
            zone.innerHTML = '<p class="texte-aide">Rien reçu pour l\'instant. Chaque arrivée de ventes s\'affichera ici.</p>';
            return;
          }
          zone.innerHTML = '<div style="overflow-x:auto;"><table class="tableau-journal"><thead><tr><th>Quand</th><th>Source</th><th>Ventes reçues</th><th>Période</th><th>Résultat</th></tr></thead><tbody>'
            + lignes.map(function (j) {
              var periode = j.du ? (j.du === j.au ? formaterJour(j.du) : formaterJour(j.du) + ' → ' + formaterJour(j.au)) : '';
              var source = SOURCES[j.source] || j.source;
              if (j.fournisseur && j.fournisseur !== 'export_email') source += ' · ' + (LIBELLES[j.fournisseur] || j.fournisseur);
              var resultat = j.erreur ? '<span class="erreur" style="padding:1px 6px; border-radius:4px;">' + echapper(j.erreur) + '</span>' : echapper(j.detail || 'OK');
              return '<tr><td>' + formaterDateHeure(j.cree_le) + '</td><td>' + echapper(source) + '</td><td>' + (j.source === 'branchement' ? '' : j.nb_ventes) + '</td><td>' + periode + '</td><td>' + resultat + '</td></tr>';
            }).join('') + '</tbody></table></div>';
        });
    }

    // La caisse choisie dans « Mon commerce » change le parcours tout de suite.
    var select = document.getElementById('selectCaisse');
    if (select) select.addEventListener('change', function () { caisseChoisie = select.value; choixSurLaPage = true; charger(); });

    charger().then(function () {
      var retour = new URLSearchParams(window.location.search).get('caisse');
      if (!retour || !document.getElementById('messageCaisse')) return;
      window.history.replaceState(null, '', window.location.pathname);
      if (retour === 'connectee') {
        message('Caisse branchée ! Tes 12 derniers mois de ventes arrivent : suis la progression ci-dessus.', false);
      } else if (retour === 'refusee') message('Branchement annulé depuis ta caisse.', true);
      else message('Le branchement a échoué. Réessaie dans un instant.', true);
    });
  }

  window.ConnecteurCaisse = { init: init };
})();
