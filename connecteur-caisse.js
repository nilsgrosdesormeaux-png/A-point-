// Bloc « Ma caisse » de Paramètres (REFONTE.md § 4 bis, AMELIORATIONS.md).
// Autonome : la page fournit un <div id="blocCaisse"> et appelle
// ConnecteurCaisse.init(sbClient, commercantId, caisseCompte). Le parcours
// suit la caisse déclarée (inscription ou Paramètres) :
//  - SumUp, Zettle, Square, Loyverse, Tactill, Hiboutik : « clé personnelle »
//    (le commerçant crée une clé dans SON compte de caisse et la colle ici,
//    aucun compte développeur côté À Point) ; pour SumUp, Zettle et Square,
//    bouton « Brancher » (OAuth) en plus, seulement si l'app est configurée ;
//  - toute autre caisse : import guidé de l'historique (fichier d'export,
//    même gros) puis envoi automatique de l'export chaque jour par e-mail.
// Après branchement : progression de l'import des 12 mois d'historique.
//
// Lit l'état dans connexions_caisse (RLS) ; tout le reste passe par l'Edge
// Function connecter-caisse ou la fonction SQL importer_historique_ventes.
// Lecture des fichiers : LectureExport (lecture-export.js), Excel via
// SheetJS chargé seulement si besoin. Convention du site : IIFE, ES5.
(function () {
  var LIBELLES = { sumup: 'SumUp', zettle: 'Zettle', square: 'Square', hiboutik: 'Hiboutik', loyverse: 'Loyverse', tactill: 'Tactill', zelty: 'Zelty', popina: 'Popina', lightspeed_retail: 'Lightspeed Retail' };
  var OAUTH = ['sumup', 'zettle', 'square'];
  // Caisses à clé personnelle, dans l'ordre d'affichage. Tant que l'Edge
  // Function déployée ne les annonce pas (etat.cle), seul Hiboutik (déjà en
  // service) est proposé ; les autres s'affichent « bientôt ».
  var AVEC_CLE = ['sumup', 'zettle', 'square', 'loyverse', 'lightspeed_retail', 'tactill', 'zelty', 'popina', 'hiboutik'];
  // Formes de clé sans ambiguïté : elles priment sur la caisse choisie.
  var FORMES_SURES = ['sumup', 'tactill', 'square', 'zettle', 'zelty'];
  var LIEN_ZETTLE = 'https://my.zettle.com/apps/api-keys?name=' + encodeURIComponent('A Point') + '&scopes=' + encodeURIComponent('READ:PURCHASE READ:USERINFO');

  // Même règle que devinerFournisseur (supabase/functions/_shared/caisse/fournisseurs.ts).
  function devinerCaisse(cle) {
    var k = String(cle || '').trim();
    if (/^sup_(sk|pk)_/.test(k)) return 'sumup';
    if (/^sk_(live|test)_/.test(k)) return 'tactill';
    if (/^EAAA[A-Za-z0-9_-]{20,}$/.test(k)) return 'square';
    if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(k)) return 'zettle';
    if (/^[A-Za-z0-9+\/]{16,}={0,2}$/.test(k)) { try { if (/^\d+:/.test(atob(k))) return 'zelty'; } catch (e) { /* pas du base64 */ } }
    if (/^[A-Za-z0-9]{20,64}$/.test(k)) return 'loyverse';
    return null;
  }

  // Envoi quotidien automatique, caisses sans clé (docs/connecteurs-caisse.md).
  // etapes : mode d'emploi publié par l'éditeur ; sinon message prêt pour l'éditeur.
  var AUTO = {
    lightspeed: { nom: 'Lightspeed (Restaurant K)', etapes: [
      'Connecte-toi à ton Back Office Lightspeed.',
      'Menu <strong>Rapports</strong> &gt; <strong>Planifications de rapports</strong> (« Report schedules ») &gt; <strong>Créer</strong>.',
      'Destinataire : colle ton adresse d\'envoi ci-dessus, puis <strong>Ajouter</strong>.',
      'Rapport : <strong>Mix produits</strong> (« Product Mix »). Format : <strong>CSV</strong>. Fréquence : <strong>Quotidienne</strong>, tous les jours cochés.',
      '<strong>Enregistre</strong>. Chaque matin vers 5 h, les ventes de la veille arrivent seules.'] },
    tactill: { support: 'hello@tactill.com' },
    tiller: { texte: 'SumUp Caisse Pro (ex-Tiller) ne publie ni envoi programmé de l\'export ni clé que tu pourrais créer toi-même : sa connexion est réservée aux logiciels partenaires, et nous avons fait la demande. Demande aussi l\'envoi automatique au support, le message est prêt.' },
    laddition: { texte: 'L\'Addition ne publie pas d\'envoi programmé de l\'export, et sa clé de connexion (Reporting &gt; Intégration partenaires) ne sert qu\'aux logiciels partenaires. Demande l\'envoi automatique à L\'Addition, le message est prêt.' },
    cashpad: { support: 'support@cashpad.fr', texte: 'Cashpad ne publie pas d\'envoi programmé de l\'export ; son API est réservée aux logiciels partenaires. Demande l\'envoi automatique au support, le message est prêt.' },
    cashmag: { texte: 'Cashmag ne publie pas d\'envoi programmé de l\'export ; son API est une option payante pour les partenaires. Demande l\'envoi automatique à Cashmag, le message est prêt.' },
    autre: {}
  };

  // Marche à suivre dans le compte de caisse du boulanger (sources : docs
  // officielles, voir docs/connecteurs-caisse.md). HTML statique.
  var GUIDES = {
    sumup: {
      etapes: ['Ouvre <a href="https://me.sumup.com/settings/api-keys" target="_blank" rel="noopener">tes clés API SumUp</a> (sur téléphone ou ordinateur, dans le navigateur, pas dans l\'appli) et connecte-toi comme d\'habitude. Si la page ne s\'ouvre pas : profil &gt; <strong>Paramètres</strong> &gt; <strong>Pour les développeurs</strong> &gt; <strong>Toolkit</strong> &gt; <strong>Clés API</strong>.',
        'Appuie sur <strong>Créer</strong> et nomme la clé « À Point ».',
        'Copie la clé qui commence par <strong>sup_sk_</strong> (SumUp ne la remontre plus jamais) et colle-la ci-dessous.'],
      note: 'Les articles n\'arrivent que pour les ventes encaissées avec ton catalogue de produits SumUp (pas en « montant libre »).',
      champ: 'Clé API SumUp (sup_sk_…)'
    },
    zettle: {
      etapes: ['Ouvre ce lien, qui prépare la clé pour toi (sur téléphone ou ordinateur, dans le navigateur) : <a href="' + LIEN_ZETTLE + '" target="_blank" rel="noopener">créer ma clé Zettle pour À Point</a>. Connecte-toi comme d\'habitude si on te le demande.',
        'Vérifie le nom « A Point » et le droit de lecture des achats, puis valide la création.',
        'Copie la <strong>clé API</strong> (une très longue suite de caractères) et colle-la ci-dessous. L\'identifiant client n\'est pas utile.'],
      note: 'La page de connexion Zettle affiche PayPal : c\'est normal, Zettle appartient à PayPal.',
      champ: 'Clé API Zettle'
    },
    zelty: {
      etapes: ['Zelty donne la clé API sur demande : écris à ton contact Zelty ou au support <a href="mailto:?subject=' + encodeURIComponent('Clé API pour mon logiciel de prévision') + '&body=' + encodeURIComponent('Bonjour, je souhaite une clé API Zelty (lecture des commandes) pour brancher mon logiciel de prévision de production À Point sur mon restaurant. Merci !') + '">avec ce message prêt</a>.',
        'Colle ci-dessous la clé reçue (une longue suite de lettres et de chiffres, souvent terminée par « = »).'],
      note: 'Si Zelty te propose plutôt d\'activer une application dans la Marketplace de ton back-office, la clé s\'affiche une fois l\'application activée : copie-la.',
      champ: 'Clé API Zelty'
    },
    lightspeed_retail: {
      etapes: ['Ouvre ta boutique Lightspeed Retail dans le navigateur (adresse en <strong>….retail.lightspeed.app</strong>) avec un compte <strong>administrateur</strong>.',
        'Menu <strong>Configuration</strong> &gt; <strong>Jetons personnels</strong> (« Personal tokens ») &gt; <strong>Ajouter un jeton personnel</strong>. Nom : « À Point », sans date d\'expiration. Aide Lightspeed : <a href="https://x-series-support.lightspeedhq.com/hc/en-us/articles/204886420-Retail-POS-X-Series-Personal-Tokens" target="_blank" rel="noopener">jetons personnels</a>.',
        'Copie le jeton, puis colle ci-dessous l\'adresse de ta boutique et le jeton.'],
      note: 'Les jetons personnels sont réservés à la formule Plus de Lightspeed Retail. Sans elle, utilise l\'import de fichier.',
      champCompte: 'Adresse de ta boutique (ex. maboulangerie.retail.lightspeed.app)',
      champ: 'Jeton personnel Lightspeed'
    },
    popina: {
      etapes: ['Popina donne la clé API sur demande (option de ton abonnement) : appelle le support ou écris-lui <a href="mailto:?subject=' + encodeURIComponent('Clé API Popina') + '&body=' + encodeURIComponent('Bonjour, je souhaite une clé API Popina (lecture des commandes) pour brancher mon logiciel de prévision de production À Point. Merci !') + '">avec ce message prêt</a>.',
        'Colle ci-dessous la clé reçue.'],
      champ: 'Clé API Popina'
    },
    square: {
      etapes: ['Ouvre <a href="https://developer.squareup.com/apps" target="_blank" rel="noopener">developer.squareup.com/apps</a> et connecte-toi avec ton compte Square habituel (gratuit). Si Square affiche « S\'inscrire à Square », choisis <strong>Se connecter</strong> : c\'est le même compte. Possible sur téléphone, plus simple sur ordinateur.',
        'Crée une application (bouton <strong>+</strong>) et nomme-la « À Point ».',
        'Dans l\'application, ouvre <strong>Credentials</strong> dans le menu de gauche.',
        'En haut de la page, choisis <strong>Production</strong> (pas « Sandbox »).',
        'Dans <strong>Production Access token</strong>, clique sur <strong>Show</strong>, copie le jeton et colle-le ci-dessous.'],
      note: 'Ce jeton ouvre tout ton compte Square : À Point ne fait que lire tes ventes. Tu peux le révoquer à tout moment au même endroit.',
      champ: 'Jeton d\'accès Square (Production)'
    },
    loyverse: {
      etapes: ['Ouvre <a href="https://r.loyverse.com/dashboard/#/integrations/tokens" target="_blank" rel="noopener">tes jetons d\'accès Loyverse</a> (sur téléphone ou ordinateur, dans le navigateur) et connecte-toi comme d\'habitude. Sinon : Back Office &gt; Paramètres &gt; Jetons d\'accès.',
        'Clique sur <strong>+ Ajouter un jeton d\'accès</strong>, nomme-le « À Point », sans date d\'expiration, puis enregistre.',
        'Copie le jeton (il ne s\'affiche qu\'une fois) et colle-le ci-dessous.'],
      champ: 'Jeton d\'accès Loyverse'
    },
    tactill: {
      etapes: ['Pour la nouvelle version de Tactill (v5.tactill.com) : écris à <a href="mailto:hello@tactill.com?subject=' + encodeURIComponent('Clé API pour mon logiciel de prévision') + '&body=' + encodeURIComponent('Bonjour, je souhaite une clé API « live » avec le droit sale:read (lecture des ventes) pour brancher mon logiciel de prévision À Point. Merci !') + '">hello@tactill.com</a> depuis l\'adresse de ton compte (le message est prêt).',
        'Colle ci-dessous la clé reçue : elle commence par <strong>sk_live_</strong>.'],
      note: 'Tactill annonce la création de clé directement dans le Backoffice prochainement. Ancienne version de Tactill : utilise l\'import de fichier ci-dessous.',
      champ: 'Clé API Tactill (sk_live_…)'
    }
  };
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
      return pastille('erreur', 'En retard') + 'Dernières ventes reçues : ' + formaterJour(cx.derniere_date_synchronisee).replace(/\.$/, '') + '. Ça repart tout seul ; sinon, appuie sur « Récupérer les ventes maintenant ».';
    }
    return pastille('succes', 'À jour') + 'Ventes reçues jusqu\'au ' + formaterJour(cx.derniere_date_synchronisee || hier).replace(/\.$/, '') + '. Dernière mise à jour le ' + formaterDateHeure(cx.derniere_synchro) + '.';
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

  // Fichier -> liste de tableaux (une feuille par élément). CSV : encodage
  // détecté (UTF-8, Windows-1252, UTF-16) par LectureExport.decoderOctets.
  function lireTableaux(fichier) {
    var L = window.LectureExport;
    if (/\.(xlsx|xlsm|xls|ods)$/i.test(fichier.name)) {
      return chargerSheetJS().then(function (XLSX) {
        return fichier.arrayBuffer().then(function (tampon) {
          var classeur = XLSX.read(tampon, { type: 'array' });
          return classeur.SheetNames.map(function (nom) {
            return XLSX.utils.sheet_to_json(classeur.Sheets[nom], { header: 1, raw: true });
          });
        });
      });
    }
    return fichier.arrayBuffer().then(function (tampon) {
      return [L.lireCsv(L.decoderOctets(new Uint8Array(tampon)))];
    });
  }

  // Pas de jour par défaut : un historique a besoin de ses dates (colonne,
  // titre du rapport ou lignes-titres de jour).
  function lireFeuilles(feuilles, options) {
    return window.LectureExport.lignesDepuisFeuilles(feuilles, null, options);
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

  // ---------------------------------------------------------------------
  // Rapport de caisse en photo / PDF, et rapports reçus par e-mail « à
  // confirmer ». L'IA lit, le boulanger vérifie : rien n'entre dans les
  // ventes avant son « Confirmer ». Zone séparée du bloc caisse (#zonePhoto)
  // pour qu'un rafraîchissement du bloc n'efface jamais une correction en cours.
  // ---------------------------------------------------------------------
  var COTE_MAX_PHOTO = 1800;

  function lireEnBase64(fichier) {
    return new Promise(function (ok, ko) {
      var r = new FileReader();
      r.onload = function () { ok(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { ko(new Error('Fichier illisible')); };
      r.readAsDataURL(fichier);
    });
  }

  // Photo réduite (1800 px) en JPEG : plus rapide à envoyer, et lisible par
  // l'IA même si le téléphone donne du HEIC.
  function photoReduite(fichier) {
    return new Promise(function (ok, ko) {
      var url = URL.createObjectURL(fichier);
      var img = new Image();
      img.onload = function () {
        var f = Math.min(1, COTE_MAX_PHOTO / Math.max(img.width, img.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * f); canvas.height = Math.round(img.height * f);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        ok({ media_type: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.85).split(',')[1] });
      };
      img.onerror = function () { URL.revokeObjectURL(url); ko(new Error('Photo illisible : essaie en JPEG ou PNG')); };
      img.src = url;
    });
  }

  function preparerFichier(fichier) {
    if (fichier.type === 'application/pdf' || /\.pdf$/i.test(fichier.name)) {
      if (fichier.size > 5000000) return Promise.reject(new Error('PDF trop lourd (5 Mo au plus)'));
      return lireEnBase64(fichier).then(function (data) { return { media_type: 'application/pdf', data: data }; });
    }
    return photoReduite(fichier);
  }

  // Tableau de vérification : jour, articles et quantités modifiables.
  function revue(conteneur, donnees, libelleRefus, auConfirmer, auRefus, apres) {
    var aujourdhui = jourParis(new Date());
    var lignes = (donnees.lignes || []).map(function (l) { return { nom_produit: l.nom_produit, quantite: l.quantite }; });
    var jour = donnees.jour || jourParis(new Date(Date.now() - 86400000));

    function dessiner(erreur) {
      var html = '';
      if (donnees.deja_lu) html += '<p class="texte-aide"><strong>Tu as déjà envoyé ce rapport.</strong> Le confirmer remplace simplement les ventes du jour, sans doublon.</p>';
      if (donnees.remarques) html += '<p class="texte-aide">' + echapper(donnees.remarques) + '</p>';
      html += '<p class="texte-aide">Vérifie le jour et corrige ce qui est faux avant de confirmer.</p>'
        + '<label>Jour des ventes <input type="date" class="revue-jour" value="' + echapper(jour) + '" max="' + aujourdhui + '"></label>'
        + '<div style="overflow-x:auto;"><table class="tableau-journal"><thead><tr><th>Article</th><th>Quantité</th><th></th></tr></thead><tbody>'
        + lignes.map(function (l, i) {
          return '<tr><td data-label="Article"><input type="text" class="revue-nom" data-i="' + i + '" value="' + echapper(l.nom_produit) + '" maxlength="120"></td>'
            + '<td data-label="Quantité"><input type="number" step="any" class="revue-qte" data-i="' + i + '" value="' + echapper(l.quantite) + '" style="max-width:110px;"></td>'
            + '<td><button type="button" class="revue-suppr" data-i="' + i + '" aria-label="Retirer cette ligne" style="' + styleSecondaire() + ' padding:4px 10px;">✕</button></td></tr>';
        }).join('') + '</tbody></table></div>'
        + (erreur ? '<div class="erreur" style="padding:8px 10px; border-radius:6px; margin:8px 0;">' + echapper(erreur) + '</div>' : '')
        + '<div class="ligne-form" style="margin-top:10px;"><button type="button" class="revue-ok">Confirmer ces ventes</button>'
        + '<button type="button" class="revue-refus" style="' + styleSecondaire() + '">' + libelleRefus + '</button></div>';
      conteneur.innerHTML = html;
      conteneur.querySelector('.revue-jour').addEventListener('change', function (e) { jour = e.target.value; });
      Array.prototype.forEach.call(conteneur.querySelectorAll('.revue-nom'), function (el) {
        el.addEventListener('input', function () { lignes[Number(el.getAttribute('data-i'))].nom_produit = el.value; });
      });
      Array.prototype.forEach.call(conteneur.querySelectorAll('.revue-qte'), function (el) {
        el.addEventListener('input', function () { lignes[Number(el.getAttribute('data-i'))].quantite = el.value; });
      });
      Array.prototype.forEach.call(conteneur.querySelectorAll('.revue-suppr'), function (el) {
        el.addEventListener('click', function () { lignes.splice(Number(el.getAttribute('data-i')), 1); dessiner(); });
      });
      conteneur.querySelector('.revue-refus').addEventListener('click', function () {
        Promise.resolve(auRefus ? auRefus() : null).then(function () { conteneur.innerHTML = ''; if (apres) apres(); });
      });
      conteneur.querySelector('.revue-ok').addEventListener('click', function (e) {
        var propres = lignes.map(function (l) { return { nom_produit: String(l.nom_produit || '').trim(), quantite: Number(String(l.quantite).replace(',', '.')) }; })
          .filter(function (l) { return l.nom_produit && isFinite(l.quantite); });
        if (!propres.length) return dessiner('Il ne reste aucune ligne à enregistrer.');
        if (!jour || jour > aujourdhui) return dessiner('Choisis le jour des ventes (pas dans le futur).');
        e.target.disabled = true;
        auConfirmer(jour, propres).then(function (nb) {
          conteneur.innerHTML = '<div class="succes" style="padding:8px 10px; border-radius:6px;">Ventes du ' + echapper(formaterJour(jour)) + ' enregistrées (' + nb + ' articles). Tes prévisions en tiennent compte.</div>';
          if (apres) apres();
        }, function (err) { dessiner(err && err.message ? err.message : 'Enregistrement impossible, réessaie.'); });
      });
    }
    dessiner();
  }

  function initPhoto(sbClient, commercantId, zone, apres) {
    zone.innerHTML = '<h2 class="section-titre">Pas d\'export ? Photo du rapport de caisse</h2>'
      + '<p class="texte-aide">Prends en photo l\'écran ou le ticket des ventes du jour (ou dépose un PDF). On lit les articles et les quantités, tu vérifies, tu confirmes. 10 lectures par jour au plus.</p>'
      + '<label class="choix-fichier"><input type="file" id="fichierPhoto" accept="image/*,.pdf,application/pdf" multiple><span class="choix-fichier-texte">Prendre ou choisir une photo</span></label>'
      + '<p class="texte-aide" id="progressionPhoto" aria-live="polite"></p>'
      + '<div id="revuePhoto"></div>'
      + '<div id="rapportsAConfirmer"></div>';
    var entree = document.getElementById('fichierPhoto');
    var progression = document.getElementById('progressionPhoto');
    var revuePhoto = document.getElementById('revuePhoto');

    entree.addEventListener('change', function () {
      var fichiers = Array.prototype.slice.call(entree.files || [], 0, 4);
      if (!fichiers.length) return;
      entree.disabled = true;
      revuePhoto.innerHTML = '';
      progression.textContent = 'Lecture en cours… (quelques secondes)';
      Promise.all(fichiers.map(preparerFichier)).then(function (preparees) {
        return sbClient.functions.invoke('lire-ticket', { body: { fichiers: preparees } });
      }).then(function (res) {
        if (res.error) {
          var ctx = res.error.context;
          if (ctx && ctx.json) return ctx.json().then(function (j) { throw new Error(j.error || res.error.message); });
          throw res.error;
        }
        var r = res.data;
        progression.textContent = '';
        if (!r.lisible) {
          revuePhoto.innerHTML = '<div class="erreur" style="padding:8px 10px; border-radius:6px;">Impossible de lire ce rapport : ' + echapper(r.remarques || 'photo floue ou incomplète') + '. Reprends la photo de plus près, bien à plat, ou dépose l\'export.</div>';
          return;
        }
        revue(revuePhoto, r, 'Annuler', function (jour, lignes) {
          return sbClient.rpc('enregistrer_ventes_photo', { p_jour: jour, p_lignes: lignes, p_detail: fichiers.map(function (f) { return f.name; }).join(', ').slice(0, 150) })
            .then(function (x) { if (x.error) throw new Error(x.error.message); return x.data; });
        }, null, apres);
      }).catch(function (e) {
        progression.textContent = '';
        revuePhoto.innerHTML = '<div class="erreur" style="padding:8px 10px; border-radius:6px;">' + echapper(e && e.message ? e.message : 'Lecture impossible, réessaie.') + '</div>';
      }).then(function () { entree.disabled = false; entree.value = ''; });
    });

    // Rapports reçus par e-mail, lus par l'IA, en attente de ta vérification.
    function chargerAConfirmer() {
      var cible = document.getElementById('rapportsAConfirmer');
      return sbClient.from('rapports_a_confirmer').select('*').eq('commercant_id', commercantId).eq('statut', 'a_confirmer')
        .order('cree_le', { ascending: false }).limit(10).then(function (res) {
          if (res.error || !res.data || !res.data.length) { cible.innerHTML = ''; return; }
          cible.innerHTML = '<h3 class="section-titre" style="margin-top:20px;">À confirmer (reçus par e-mail)</h3>';
          res.data.forEach(function (rap) {
            var carte = document.createElement('div');
            carte.style.cssText = 'border:1px solid var(--bordure); border-radius:8px; padding:12px; margin:10px 0;';
            carte.innerHTML = '<p class="texte-aide">Reçu le ' + formaterDateHeure(rap.cree_le) + (rap.detail ? ' · ' + echapper(rap.detail) : '') + '</p><div class="zone-revue"></div>';
            cible.appendChild(carte);
            revue(carte.querySelector('.zone-revue'), { jour: rap.jour, lignes: rap.lignes, remarques: rap.remarques }, 'Ce n\'est pas ça : rejeter',
              function (jour, lignes) {
                return sbClient.rpc('confirmer_rapport', { p_id: rap.id, p_jour: jour, p_lignes: lignes })
                  .then(function (x) { if (x.error) throw new Error(x.error.message); return x.data; });
              },
              function () { return sbClient.rpc('rejeter_rapport', { p_id: rap.id }); },
              function () { if (apres) apres(); chargerAConfirmer(); });
          });
        });
    }
    chargerAConfirmer();
  }

  function init(sbClient, commercantId, caisseCompte) {
    var bloc = document.getElementById('blocCaisse');
    if (!bloc) return;
    var disponibles = null;
    var caisseChoisie = caisseCompte || null;
    var choixSurLaPage = false;
    var zonePhoto = document.getElementById('zonePhoto');
    if (zonePhoto) initPhoto(sbClient, commercantId, zonePhoto, function () { chargerJournal(); });

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

    function cleOuverte(nom) {
      return nom === 'hiboutik' || (disponibles.cle || []).indexOf(nom) !== -1;
    }

    function oauthOuvert(nom) {
      if (OAUTH.indexOf(nom) === -1) return false;
      return disponibles.oauth ? !!disponibles.oauth[nom] : !!disponibles[nom];
    }

    // Formulaire « clé personnelle » : marche à suivre + champ masqué. La clé
    // part chiffrée par HTTPS vers l'Edge Function et n'est jamais réaffichée.
    function formulaireCle(nom) {
      if (nom === 'hiboutik') return formulaireHiboutik();
      var g = GUIDES[nom];
      var surDemande = ['zelty', 'popina', 'tactill'].indexOf(nom) !== -1;
      return '<p class="texte-aide"><strong>Brancher ' + LIBELLES[nom] + '</strong>, ' + (surDemande
        ? 'avec une clé que ' + LIBELLES[nom] + ' te donne sur simple demande (une seule fois). Astuce téléphone'
        : 'en 5 minutes, avec une clé que tu crées toi-même dans ton compte. Astuce téléphone') + ' : garde cette page ouverte, fais les étapes dans un autre onglet, puis reviens coller la clé.</p>'
        + '<ol class="texte-aide" style="padding-left:20px;">' + g.etapes.map(function (e) { return '<li style="margin-bottom:4px;">' + e + '</li>'; }).join('') + '</ol>'
        + (g.note ? '<p class="texte-aide">' + g.note + '</p>' : '')
        + (g.champCompte ? '<label for="compteCaisse">' + g.champCompte + '</label><input type="text" id="compteCaisse" autocomplete="off" spellcheck="false" autocapitalize="none">' : '')
        + '<label for="cleCaisse">' + g.champ + '</label><input type="password" id="cleCaisse" autocomplete="off" spellcheck="false">'
        + '<p class="texte-aide" style="margin-top:4px;">Ta clé est chiffrée et gardée sur nos serveurs, jamais réaffichée. Pour couper l\'accès : supprime-la dans ta caisse, ou « Déconnecter » ici.</p>'
        + '<button type="button" id="btnBrancherCle" data-caisse="' + nom + '">Brancher ma caisse ' + LIBELLES[nom] + '</button>';
    }

    function formulaireHiboutik() {
      return '<p class="texte-aide">Active l\'API dans ton compte Hiboutik (leur aide explique comment, rubrique « activer l\'API »), puis colle ici ta clé API, le nom de ton compte (ce qui est avant « .hiboutik.com ») et ton e-mail Hiboutik.</p>'
        + '<label for="hibCompte">Nom du compte Hiboutik</label><input type="text" id="hibCompte" placeholder="maboulangerie" autocomplete="off">'
        + '<label for="hibUtilisateur">E-mail Hiboutik</label><input type="email" id="hibUtilisateur" placeholder="toi@exemple.fr" autocomplete="off">'
        + '<label for="hibCle">Clé API</label><input type="password" id="hibCle" autocomplete="off">'
        + '<button type="button" id="btnBrancherHiboutik">Brancher ma caisse Hiboutik</button>'
        + '<p class="texte-aide" style="margin-top:4px;">Ta clé est chiffrée et gardée sur nos serveurs, jamais réaffichée.</p>';
    }

    function sectionFichier(titre) {
      return '<p class="section-titre" style="margin-top:18px;">' + titre + '</p>'
        + '<p class="texte-aide">Dans ta caisse, exporte les <strong>ventes par article et par jour</strong> des 12 derniers mois (CSV ou Excel), puis dépose le fichier ici. Les colonnes sont reconnues seules (et tu peux les choisir si besoin) ; tu vois un aperçu avant l\'import. Les jours déjà présents sont remplacés, jamais doublés.</p>'
        + '<label class="choix-fichier"><input type="file" id="fichierHistorique" accept=".csv,.txt,.tsv,.xlsx,.xlsm,.xls,.ods"><span class="bouton-secondaire">Choisir le fichier</span> <span class="nom-fichier" data-nom-fichier>Aucun fichier choisi</span></label>'
        + '<p class="texte-aide" id="progressionFichier" aria-live="polite"></p>';
    }

    // Étape 2 des caisses sans clé : l'envoi quotidien automatique de
    // l'export vers l'adresse d'import, réglé une fois dans la caisse.
    var adresseDemandee = false;
    function sectionEmail(email, choix) {
      var titre = '<p class="section-titre" style="margin-top:18px;">Étape 2 : chaque jour, automatiquement</p>';
      if (!email) {
        if (!disponibles.email) {
          return titre + '<p class="texte-aide">L\'envoi automatique de tes ventes chaque jour ouvre très bientôt. Ton historique suffit pour démarrer.</p>';
        }
        // Adresse créée d'office : le boulanger n'a pas de bouton de plus à trouver.
        if (!adresseDemandee) {
          adresseDemandee = true;
          setTimeout(function () { appeler({ action: 'activer_import_email' }).then(charger, function () {}); }, 0);
        }
        return titre + '<p class="texte-aide">Préparation de ton adresse d\'envoi…</p>';
      }
      var guide = AUTO[choix] || AUTO.autre;
      var adresse = echapper(email.adresse_import);
      var html = titre
        + '<p class="texte-aide">Ton adresse d\'envoi personnelle (à ne donner qu\'à ta caisse) :</p>'
        + '<p style="word-break:break-all;"><strong id="adresseImport">' + adresse + '</strong> '
        + '<button type="button" id="btnCopierAdresse" style="' + styleSecondaire() + ' padding:4px 10px;">Copier</button></p>';
      if (guide.etapes) {
        html += '<p class="texte-aide"><strong>Dans ta caisse ' + echapper(guide.nom || '') + '</strong>, une seule fois :</p>'
          + '<ol class="texte-aide" style="padding-left:20px;">' + guide.etapes.map(function (e) { return '<li style="margin-bottom:4px;">' + e + '</li>'; }).join('') + '</ol>';
      } else {
        var corps = 'Bonjour,\n\nJe souhaite recevoir automatiquement, chaque jour, l\'export des ventes par article de la veille (fichier CSV ou Excel, avec la date, l\'article et la quantité), envoyé à cette adresse : '
          + email.adresse_import + '\n\nPouvez-vous me dire comment le programmer dans ma caisse, ou le régler pour moi ?\n\nMerci !';
        html += '<p class="texte-aide">' + (guide.texte || 'Ta caisse ne publie pas de mode d\'emploi pour cet envoi automatique. Le plus simple : demande-le à ton éditeur ou à ton revendeur, le message est prêt.') + '</p>'
          + '<p><a href="mailto:' + (guide.support || '') + '?subject=' + encodeURIComponent('Envoi automatique quotidien de l\'export des ventes')
          + '&body=' + encodeURIComponent(corps) + '">Écrire à mon éditeur de caisse</a></p>';
      }
      html += '<p class="texte-aide">' + (email.derniere_synchro ? etatConnexion(email) : 'Aucun envoi reçu pour l\'instant : le premier apparaîtra dans le journal ci-dessous.') + '</p>';
      return html;
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
            + '<button type="button" id="btnSynchroCaisse">Récupérer les ventes maintenant</button>'
            + '<button type="button" class="btnDeconnecter" data-caisse="' + cx.fournisseur + '" style="' + styleSecondaire() + '">Déconnecter</button>'
            + '</div>';
        });
      } else {
        var choix = (caisseChoisie || '').indexOf('autre') === 0 ? 'autre' : caisseChoisie;
        // Une seule entrée « SumUp » : la façon d'encaisser décide du chemin.
        if (choix === 'sumup' || choix === 'tiller') {
          html += '<fieldset class="choix-caisse"><legend class="texte-aide"><strong>Tu encaisses avec :</strong></legend>'
            + '<label class="choix-caisse__option"><input type="radio" name="sousChoixSumup" value="sumup"' + (choix === 'sumup' ? ' checked' : '') + '> le terminal ou l\'appli SumUp</label>'
            + '<label class="choix-caisse__option"><input type="radio" name="sousChoixSumup" value="tiller"' + (choix === 'tiller' ? ' checked' : '') + '> SumUp Caisse Pro sur iPad (ex-Tiller)</label></fieldset>';
        }
        html += !choix || AVEC_CLE.indexOf(choix) !== -1
          ? '<p class="texte-aide">Branche ta caisse : tes 12 derniers mois de ventes arrivent d\'un coup, puis chaque nuit les ventes de la veille. Tu n\'as plus rien à saisir.</p>'
          : '<p class="texte-aide">Ta caisse se règle en deux temps : tu déposes une seule fois ton historique, puis ta caisse envoie seule ses ventes chaque jour. Rien à refaire ensuite.</p>';
        var branchable = false;
        if (AVEC_CLE.indexOf(choix) !== -1) {
          if (oauthOuvert(choix)) {
            html += boutonBrancher(choix, true);
            branchable = true;
            if (cleOuverte(choix)) html += '<details style="margin-top:10px;"><summary class="texte-aide">Ou avec une clé personnelle</summary>' + formulaireCle(choix) + '</details>';
          } else if (cleOuverte(choix)) {
            html += formulaireCle(choix);
            branchable = true;
          } else {
            html += '<p class="texte-aide">Le branchement ' + LIBELLES[choix] + ' ouvre très bientôt. En attendant, importe ton historique ci-dessous : tes prévisions seront justes dès demain.</p>';
          }
        } else if (!choix) {
          html += '<p class="texte-aide">Choisis ta caisse ci-dessus pour voir le bon parcours. Déjà branchables :</p>';
          AVEC_CLE.forEach(function (nom) {
            if (cleOuverte(nom) || oauthOuvert(nom)) html += '<button type="button" class="btnChoixCaisse" data-caisse="' + nom + '" style="' + styleSecondaire() + ' margin:0 6px 6px 0;">J\'ai ' + LIBELLES[nom] + '</button>';
          });
        }
        var sansCle = !branchable && choix && choix !== 'aucune' && AVEC_CLE.indexOf(choix) === -1;
        var titre = branchable ? 'Ou bien : importer un fichier' : (sansCle ? 'Étape 1 : ton historique, une seule fois' : 'Importer ton historique');
        html += sectionFichier(titre);
        if (sansCle) html += sectionEmail(email, choix);
      }
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
      Array.prototype.forEach.call(bloc.querySelectorAll('.btnChoixCaisse'), function (btn) {
        btn.addEventListener('click', function () {
          caisseChoisie = btn.getAttribute('data-caisse'); choixSurLaPage = true;
          var select = document.getElementById('selectCaisse');
          if (select) { select.value = caisseChoisie; select.dispatchEvent(new Event('change')); } else charger();
        });
      });
      Array.prototype.forEach.call(bloc.querySelectorAll('input[name="sousChoixSumup"]'), function (radio) {
        radio.addEventListener('change', function () {
          var select = document.getElementById('selectCaisse');
          if (window.CaisseUtilisee && select) {
            window.CaisseUtilisee.definirSousChoix('selectCaisse', radio.value === 'tiller' ? 'tiller' : null);
            select.dispatchEvent(new Event('change')); // enregistre et redessine
          } else { caisseChoisie = radio.value; charger(); }
        });
      });
      var btnCle = document.getElementById('btnBrancherCle');
      if (btnCle) surClic(btnCle, function () {
        var champ = document.getElementById('cleCaisse');
        var cle = champ.value.trim();
        if (!cle) return Promise.reject(new Error('Colle d\'abord ta clé dans le champ.'));
        var prevue = btnCle.getAttribute('data-caisse');
        var devinee = devinerCaisse(cle);
        if (!devinee || (FORMES_SURES.indexOf(devinee) === -1 && devinee !== prevue)) devinee = prevue;
        if (/\s/.test(cle)) return Promise.reject(new Error('Cette clé contient un espace : copie-la en entier, d\'un seul bloc, et recolle-la.'));
        var champCompte = document.getElementById('compteCaisse');
        if (champCompte && !champCompte.value.trim()) return Promise.reject(new Error('Renseigne aussi l\'adresse de ta boutique.'));
        return appeler({ action: 'connecter_cle', fournisseur: devinee, cle: cle, compte: champCompte ? champCompte.value : undefined }).then(function (r) {
          champ.value = '';
          var nom = (r && r.fournisseur) || devinee;
          return charger().then(function () {
            message('Caisse ' + (LIBELLES[nom] || '') + ' branchée ! Tes 12 derniers mois de ventes arrivent : suis la progression ci-dessus.'
              + (nom !== prevue ? ' (C\'était une clé ' + LIBELLES[nom] + ', pas ' + LIBELLES[prevue] + ' : c\'est corrigé.)' : ''), false);
          });
        });
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
            if (!r.ok) message('La récupération des ventes a échoué : ' + r.erreur, true);
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
      var btnCopier = document.getElementById('btnCopierAdresse');
      if (btnCopier) btnCopier.addEventListener('click', function () {
        var texte = document.getElementById('adresseImport').textContent;
        var fait = function () { btnCopier.textContent = 'Copié !'; };
        if (navigator.clipboard) navigator.clipboard.writeText(texte).then(fait, function () {});
        else { var r = document.createRange(); r.selectNodeContents(document.getElementById('adresseImport')); getSelection().removeAllRanges(); getSelection().addRange(r); }
      });
      var entree = document.getElementById('fichierHistorique');
      if (entree) entree.addEventListener('change', function () { if (entree.files[0]) importerFichier(entree); });
    }

    // Import en trois temps : lecture, aperçu à valider (ou choix des
    // colonnes si la caisse a des en-têtes inconnus), envoi par mois.
    var fichierEnCours = null;

    function importerFichier(entree) {
      var progression = document.getElementById('progressionFichier');
      var fichier = entree.files[0];
      progression.textContent = 'Lecture du fichier…';
      lireTableaux(fichier).then(function (feuilles) {
        fichierEnCours = { nom: fichier.name, feuilles: feuilles };
        progression.textContent = '';
        afficherLecture(lireFeuilles(feuilles));
      }).catch(function (e) {
        progression.textContent = '';
        message(e && e.message ? e.message : 'Fichier illisible.', true);
      }).then(function () { entree.value = ''; });
    }

    function zoneApercu() {
      var zone = document.getElementById('apercuFichier');
      if (!zone) {
        zone = document.createElement('div');
        zone.id = 'apercuFichier';
        zone.style.marginTop = '10px';
        document.getElementById('progressionFichier').insertAdjacentElement('afterend', zone);
      }
      return zone;
    }

    function afficherLecture(lu) {
      var zone = zoneApercu();
      if (!lu.lignes.length) {
        if (lu.code === 'colonnes' || lu.code === 'date' || !lu.erreur) return choisirColonnes(lu.erreur || 'Aucune vente reconnue dans ce fichier.');
        zone.innerHTML = '';
        return message(lu.erreur, true);
      }
      var jours = lu.lignes.map(function (l) { return l.date_vente; }).sort();
      var produits = {};
      lu.lignes.forEach(function (l) { produits[l.nom_produit.trim().toLowerCase()] = l.nom_produit; });
      var noms = Object.keys(produits).map(function (k) { return produits[k]; });
      var nbJours = Object.keys(lu.lignes.reduce(function (o, l) { o[l.date_vente] = 1; return o; }, {})).length;
      zone.innerHTML = '<p class="texte-aide"><strong>Lu dans le fichier :</strong> ' + nbJours + ' jour' + (nbJours > 1 ? 's' : '') + ' de ventes, du '
        + new Date(jours[0] + 'T12:00:00').toLocaleDateString('fr-FR') + ' au ' + new Date(jours[jours.length - 1] + 'T12:00:00').toLocaleDateString('fr-FR')
        + ', ' + noms.length + ' article' + (noms.length > 1 ? 's' : '') + ' (' + echapper(noms.slice(0, 6).join(', ')) + (noms.length > 6 ? '…' : '') + ').'
        + (lu.ignorees ? ' ' + lu.ignorees + ' ligne' + (lu.ignorees > 1 ? 's' : '') + ' sans quantité ou annulée' + (lu.ignorees > 1 ? 's' : '') + ' ignorée' + (lu.ignorees > 1 ? 's' : '') + '.' : '')
        + '</p><div class="ligne-form"><button type="button" id="btnValiderImport">Importer</button>'
        + '<button type="button" id="btnColonnesImport" style="' + styleSecondaire() + '">Ce n\'est pas ça : choisir les colonnes</button></div>';
      surClic(document.getElementById('btnValiderImport'), function () { return envoyerLignes(lu.lignes); });
      document.getElementById('btnColonnesImport').addEventListener('click', function () { choisirColonnes(''); });
    }

    // Les colonnes au choix du commerçant, quand sa caisse a des en-têtes inconnus.
    function choisirColonnes(raison) {
      var zone = zoneApercu();
      var feuilles = fichierEnCours.feuilles;
      var iFeuille = 0;
      for (var i = 0; i < feuilles.length; i++) if (feuilles[i] && feuilles[i].length > 1) { iFeuille = i; break; }
      var a = window.LectureExport.analyser(feuilles[iFeuille]);
      var options = function (sel, facultatif) {
        return (facultatif ? '<option value="-1">(aucune)</option>' : '') + a.entetes.map(function (h, j) {
          return '<option value="' + j + '"' + (sel === j ? ' selected' : '') + '>' + echapper(h || 'Colonne ' + (j + 1)) + '</option>';
        }).join('');
      };
      var c = a.colonnes || {};
      zone.innerHTML = (raison ? '<p class="texte-aide">' + echapper(raison) + '</p>' : '')
        + '<p class="texte-aide">Indique quelles colonnes de ton fichier contiennent l\'article, la quantité vendue et la date :</p>'
        + '<label for="colArticle">Article</label><select id="colArticle">' + options(c.produit) + '</select>'
        + '<label for="colQuantite">Quantité vendue</label><select id="colQuantite">' + options(c.quantite) + '</select>'
        + '<label for="colDate">Date</label><select id="colDate">' + options(c.date === undefined ? -1 : c.date, true) + '</select>'
        + '<button type="button" id="btnLireColonnes" style="margin-top:8px;">Relire le fichier</button>';
      document.getElementById('btnLireColonnes').addEventListener('click', function () {
        var val = function (id) { return Number(document.getElementById(id).value); };
        var lu = window.LectureExport.lignesDepuisTableau(feuilles[iFeuille], null, {
          ligneEntete: a.ligneEntete, colonnes: { produit: val('colArticle'), quantite: val('colQuantite'), date: val('colDate') }
        });
        if (!lu.lignes.length) return message(lu.erreur || 'Toujours aucune vente avec ces colonnes : vérifie la quantité et la date.', true);
        afficherLecture(lu);
      });
    }

    function envoyerLignes(lignesLues) {
      var progression = document.getElementById('progressionFichier');
      var nomFichier = fichierEnCours ? fichierEnCours.nom : null;
      zoneApercu().innerHTML = '';
      var paquets = paquetsParMois(lignesLues);
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
        var jours = lignesLues.map(function (l) { return l.date_vente; }).sort();
        progression.textContent = '';
        sbClient.rpc('journaliser_import_fichier', { p_nb: total, p_du: jours[0], p_au: jours[jours.length - 1], p_erreur: null, p_detail: nomFichier })
          .then(chargerJournal, function () {});
        message('Historique importé : ' + nbMois + ' mois (du ' + new Date(jours[0] + 'T12:00:00').toLocaleDateString('fr-FR') + ' au '
          + new Date(jours[jours.length - 1] + 'T12:00:00').toLocaleDateString('fr-FR') + '), ' + total + ' ventes produit. Tes prévisions en tiennent compte dès maintenant.', false);
      }).catch(function (e) {
        progression.textContent = '';
        sbClient.rpc('journaliser_import_fichier', { p_nb: total, p_du: null, p_au: null, p_erreur: e && e.message ? e.message : 'Import impossible', p_detail: nomFichier })
          .then(chargerJournal, function () {});
        throw e;
      });
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
    var SOURCES = { api: 'Caisse (automatique)', email: 'E-mail (automatique)', fichier: 'Fichier déposé', branchement: 'Branchement', photo: 'Photo du rapport' };
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
              // data-label : sur téléphone, chaque ligne devient une carte (style.css).
              return '<tr><td data-label="Quand">' + formaterDateHeure(j.cree_le) + '</td><td data-label="Source">' + echapper(source) + '</td><td data-label="Ventes reçues">' + (j.source === 'branchement' ? '–' : Number(j.nb_ventes || 0).toLocaleString('fr-FR')) + '</td><td data-label="Période">' + (periode || '–') + '</td><td data-label="Résultat">' + resultat + '</td></tr>';
            }).join('') + '</tbody></table></div>';
        });
    }

    // La caisse choisie dans « Mon commerce » change le parcours tout de suite.
    var select = document.getElementById('selectCaisse');
    if (select) select.addEventListener('change', function () {
      caisseChoisie = window.CaisseUtilisee ? window.CaisseUtilisee.lire('selectCaisse', 'autreCaisse') : select.value;
      choixSurLaPage = true; charger();
    });

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
