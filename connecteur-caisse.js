// Bloc « Connecter ma caisse » de Paramètres (REFONTE.md § 4 bis).
// Autonome : la page fournit un <div id="blocCaisse"> (son contenu sert tant
// que rien n'est configuré) et
// appelle ConnecteurCaisse.init(sbClient, commercantId). La refonte peut
// déplacer ou restyler le bloc sans toucher à cette logique.
//
// Lit l'état dans connexions_caisse (RLS : le commerçant ne voit que ses
// lignes) et passe par l'Edge Function connecter-caisse pour tout le reste.
(function () {
  function echapper(texte) {
    var div = document.createElement('div');
    div.textContent = texte === null || texte === undefined ? '' : String(texte);
    return div.innerHTML;
  }

  function formaterDateHeure(iso) {
    if (!iso) return 'jamais';
    var d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  function etatSynchro(cx) {
    if (cx.statut === 'erreur') {
      return '<span class="erreur" style="display:inline-block; padding:2px 8px; border-radius:6px;">Dernière synchro en échec</span> ' + echapper(cx.derniere_erreur);
    }
    if (!cx.derniere_synchro) return 'Première synchro cette nuit.';
    return 'Dernière synchro : ' + formaterDateHeure(cx.derniere_synchro)
      + (cx.nb_lignes_derniere_synchro !== null ? ' (' + cx.nb_lignes_derniere_synchro + ' ventes produit importées)' : '') + '.';
  }

  function init(sbClient, commercantId) {
    var bloc = document.getElementById('blocCaisse');
    if (!bloc) return;

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
      el.className = estErreur ? 'erreur' : 'succes';
      el.style.cssText = 'padding:8px 10px; border-radius:6px; margin:8px 0 0;';
      el.textContent = texte;
    }

    function rendre(connexions, disponibles) {
      var sumup = connexions.filter(function (c) { return c.fournisseur === 'sumup'; })[0];
      var email = connexions.filter(function (c) { return c.fournisseur === 'export_email'; })[0];
      var html = '<p class="section-titre">Ma caisse</p>';

      if (sumup) {
        html += '<p><strong>Caisse SumUp connectée</strong>' + (sumup.compte_caisse ? ' (compte ' + echapper(sumup.compte_caisse) + ')' : '') + '. Tes ventes arrivent seules chaque nuit.</p>'
          + '<p class="texte-aide">' + etatSynchro(sumup) + '</p>'
          + '<div class="ligne-form">'
          + '<button type="button" id="btnSynchroCaisse">Synchroniser maintenant</button>'
          + '<button type="button" id="btnDeconnecterCaisse" style="background-color: var(--surface); color: var(--texte); border: 1px solid var(--bordure);">Déconnecter</button>'
          + '</div>';
      } else if (disponibles.sumup) {
        html += '<p class="texte-aide">Branche ta caisse : tes ventes arrivent seules chaque nuit, tu n\'as plus rien à saisir.</p>'
          + '<button type="button" id="btnConnecterSumup">Connecter ma caisse SumUp</button>';
      } else {
        html += '<p class="texte-aide">Bientôt : branche ta caisse SumUp et tes ventes arriveront seules chaque nuit.</p>';
      }

      if (email) {
        html += '<p class="texte-aide" style="margin-top:14px;">Ton adresse d\'import : programme l\'envoi automatique de l\'export des ventes (CSV) de ta caisse vers cette adresse.</p>'
          + '<p><strong>' + echapper(email.adresse_import) + '</strong></p>'
          + '<p class="texte-aide">' + (email.derniere_synchro ? etatSynchro(email) : 'Aucun export reçu pour l\'instant.') + '</p>';
      } else if (disponibles.email) {
        html += '<p class="texte-aide" style="margin-top:14px;">Autre caisse ? Si elle sait envoyer son export des ventes par e-mail, programme l\'envoi automatique de ton export des ventes (CSV) vers ton adresse d\'import personnelle.</p>'
          + '<button type="button" id="btnAdresseImport" style="background-color: var(--surface); color: var(--texte); border: 1px solid var(--bordure);">Obtenir mon adresse d\'import</button>';
      }
      html += '<div id="messageCaisse" aria-live="polite"></div>';
      bloc.innerHTML = html;

      brancher('btnConnecterSumup', function (btn) {
        return appeler({ action: 'demarrer', fournisseur: 'sumup' }).then(function (data) {
          window.location.href = data.url;
          return new Promise(function () {}); // la page part chez SumUp
        });
      });
      brancher('btnSynchroCaisse', function () {
        return appeler({ action: 'synchroniser' }).then(function (r) {
          return charger().then(function () {
            if (r.ok && !r.complet) message(r.lignes + ' ventes produit importées. La suite arrive cette nuit.', false);
            else if (r.ok) message(r.lignes ? r.lignes + ' ventes produit importées.' : 'Déjà à jour : les ventes jusqu\'à hier sont importées.', false);
            else message('La synchro a échoué : ' + r.erreur, true);
          });
        });
      });
      brancher('btnDeconnecterCaisse', function () {
        if (!window.confirm('Déconnecter ta caisse ? Les ventes déjà importées restent, mais plus rien n\'arrivera automatiquement.')) return Promise.resolve();
        return appeler({ action: 'deconnecter', fournisseur: 'sumup' }).then(charger);
      });
      brancher('btnAdresseImport', function () {
        return appeler({ action: 'activer_import_email' }).then(charger);
      });
    }

    function brancher(id, action) {
      var btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', function () {
        btn.disabled = true;
        action(btn).catch(function (e) {
          message(e && e.message ? e.message : 'Une erreur est survenue, réessaie.', true);
        }).then(function () { btn.disabled = false; });
      });
    }

    // Quelles connexions sont configurées côté serveur (app SumUp, adresse
    // de réception des e-mails) : demandé une seule fois par page.
    var disponibles = null;

    function charger() {
      var etat = disponibles
        ? Promise.resolve(disponibles)
        : appeler({ action: 'etat' }).catch(function () { return { sumup: false, email: false }; });
      return Promise.all([sbClient.from('connexions_caisse').select('*').eq('commercant_id', commercantId), etat]).then(function (r) {
        var res = r[0];
        disponibles = r[1];
        if (res.error || (!disponibles.sumup && !disponibles.email && !(res.data || []).length)) {
          // Rien de configuré : on laisse le contenu prévu par la page
          // (« Bientôt disponible ») plutôt qu'une erreur ou un bouton inutile.
          return;
        }
        rendre(res.data || [], disponibles);
      });
    }

    charger().then(function () {
      var retour = new URLSearchParams(window.location.search).get('caisse');
      if (!retour || !document.getElementById('messageCaisse')) return;
      window.history.replaceState(null, '', window.location.pathname + '#blocCaisse');
      if (retour === 'connectee') message('Caisse connectée ! Tes ventes des 14 derniers jours arrivent dans quelques minutes, puis chaque nuit.', false);
      else if (retour === 'refusee') message('Connexion annulée depuis SumUp.', true);
      else message('La connexion à SumUp a échoué. Réessaie dans un instant.', true);
      if (retour === 'connectee') appeler({ action: 'synchroniser' }).then(charger).catch(function () {});
    });
  }

  window.ConnecteurCaisse = { init: init };
})();
