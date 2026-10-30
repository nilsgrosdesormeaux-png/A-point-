// Chargement commun aux écrans Fournée, Commande, Semaine et Bilan (plan v2) :
// session, ventes, produits, fiches techniques, réglages, météo et signaux
// locaux (événements, matchs). Chaque source externe est facultative : si
// elle échoue ou n'est pas configurée, l'écran s'affiche sans elle.
// Dépend de moteur-prevision.js et boulangerie.js. Convention : IIFE, ES5.
(function () {
  var SUPABASE_URL = "https://eqvbksxfwlgbcxgqljqn.supabase.co";
  var SUPABASE_KEY = "sb_publishable_Dlh12BadZ13vHrUR0o7O7Q_i3aN2VMc";
  var MP = window.MoteurPrevision;
  var B = window.Boulangerie;

  function client() {
    if (!window.__sbClient) window.__sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    return window.__sbClient;
  }

  // Événements locaux (OpenAgenda) et matchs (football-data.org), via
  // l'Edge Function signaux-locaux : les clés restent côté serveur. Sans clé,
  // la fonction renvoie une liste vide ; en cas d'erreur, on ignore.
  function recupererSignauxExternes(sb, coords, dateDebut, dateFin) {
    if (!coords || !sb.functions) return Promise.resolve({});
    return sb.functions.invoke('signaux-locaux', {
      body: { latitude: coords.latitude, longitude: coords.longitude, debut: dateDebut, fin: dateFin }
    }).then(function (res) {
      var carte = {};
      ((res && res.data && res.data.signaux) || []).forEach(function (s) {
        if (!s || !s.date || !s.type) return;
        if (!carte[s.date]) carte[s.date] = [];
        carte[s.date].push({ type: s.type, libelle: s.libelle || (s.type === 'match' ? 'Match' : 'Événement local') });
      });
      return carte;
    }).catch(function () { return {}; });
  }

  // Résout l'utilisateur et charge tout ; rejette avec { nonConnecte: true }
  // si personne n'est connecté.
  function charger() {
    var sb = client();
    return sb.auth.getSession().then(function (res) {
      var session = res.data.session;
      if (!session) throw { nonConnecte: true };
      var id = session.user.id;
      return Promise.all([
        sb.from('ventes').select('*').eq('commercant_id', id),
        sb.from('produits').select('*').eq('commercant_id', id),
        sb.from('ingredients_produit').select('*').eq('commercant_id', id),
        sb.from('parametres_commercant').select('*').eq('commercant_id', id),
        sb.from('evenements_commercant').select('*').eq('commercant_id', id)
      ]).then(function (r) {
        var parametres = (r[3].data && r[3].data[0]) || null;
        // Caisse déclarée à l'inscription : recopiée une fois dans les réglages.
        var caisseInscription = session.user.user_metadata && session.user.user_metadata.caisse;
        if (caisseInscription && !(parametres && parametres.caisse)) {
          sb.from('parametres_commercant').upsert({ commercant_id: id, caisse: caisseInscription }).then(function () {}, function () {});
          if (parametres) parametres.caisse = caisseInscription;
        }
        var evenements = {};
        (r[4].data || []).forEach(function (e) { evenements[e.date_evenement] = e.direction; });
        var ctx = {
          sb: sb,
          session: session,
          commercantId: id,
          // Une ligne par produit et par jour (doublons de casse et imports relancés).
          ventes: MP.dedoublonnerVentes(r[0].data || []),
          produits: r[1].data || [],
          ingredients: r[2].data || [],
          parametres: parametres,
          zoneVacances: parametres ? MP.zoneVacancesPourCodePostal(parametres.code_postal) : null,
          joursFermeture: (parametres && parametres.jours_fermeture) || [],
          evenements: evenements,
          meteoPassee: {},
          meteoPrevue: {},
          signauxExternes: {}
        };
        ctx.parProduit = {};
        ctx.ventes.forEach(function (v) {
          var nom = MP.formatNomAffichage(v.nom_produit);
          if (!ctx.parProduit[nom]) ctx.parProduit[nom] = [];
          ctx.parProduit[nom].push(v);
        });
        return ctx;
      });
    });
  }

  // Météo et signaux locaux : en second temps, pour afficher vite puis affiner.
  function enrichir(ctx) {
    return MP.obtenirCoordonnees(ctx.sb, ctx.parametres, ctx.commercantId).catch(function () { return null; }).then(function (coords) {
      if (!coords || ctx.ventes.length === 0) return ctx;
      var dates = ctx.ventes.map(function (v) { return v.date_vente; }).sort();
      var fin = MP.versISO(MP.ajouterJours(new Date(), 8));
      return Promise.all([
        MP.recupererMeteoPassee(coords.latitude, coords.longitude, dates[0], MP.versISO(new Date())).catch(function () { return {}; }),
        MP.recupererMeteoPrevue(coords.latitude, coords.longitude).catch(function () { return {}; }),
        recupererSignauxExternes(ctx.sb, coords, dates[0], fin)
      ]).then(function (res) {
        ctx.meteoPassee = res[0] || {};
        ctx.meteoPrevue = res[1] || {};
        ctx.signauxExternes = res[2] || {};
        return ctx;
      });
    });
  }

  // Prévision de tous les produits pour un jour : [{ nom, rayon, r }].
  function prevoirJour(ctx, date) {
    return Object.keys(ctx.parProduit).map(function (nom) {
      var r = MP.calculerRecommandation(ctx.parProduit[nom], date, ctx.zoneVacances, ctx.evenements, ctx.meteoPassee, ctx.meteoPrevue, ctx.signauxExternes);
      return { nom: nom, rayon: B.deduireRayon(nom), r: r };
    });
  }

  // Les signaux du jour, agrégés sur tous les produits (effet moyen pondéré
  // par la quantité), triés par effet le plus fort : les « raisons » du jour.
  function raisonsDuJour(previsions) {
    var parCle = {};
    previsions.forEach(function (p) {
      if (p.r.insuffisant) return;
      (p.r.signaux || []).forEach(function (s) {
        if (!parCle[s.cle]) parCle[s.cle] = { cle: s.cle, icone: s.icone, libelle: s.libelle, poids: 0, somme: 0 };
        if (s.ratio !== null) { parCle[s.cle].somme += s.ratio * p.r.quantite; parCle[s.cle].poids += p.r.quantite; }
      });
    });
    return Object.keys(parCle).map(function (k) {
      var x = parCle[k];
      return { cle: x.cle, icone: x.icone, libelle: x.libelle, ratio: x.poids > 0 ? x.somme / x.poids : null };
    }).filter(function (r) {
      // Un effet appris de moins de 3 % n'est pas une raison : on le tait.
      return r.ratio === null || Math.abs(r.ratio - 1) >= 0.03;
    }).sort(function (a, b) {
      return Math.abs((b.ratio || 1) - 1) - Math.abs((a.ratio || 1) - 1);
    });
  }

  // Ventes périmées : dernière date de vente, et vrai si plus de 3 jours.
  function dernieresVentes(ctx) {
    var derniere = ctx.ventes.reduce(function (m, v) { return v.date_vente > m ? v.date_vente : m; }, '');
    if (!derniere) return null;
    var ecart = Math.round((new Date(MP.versISO(new Date()) + 'T00:00:00') - new Date(derniere + 'T00:00:00')) / 86400000);
    return { date: derniere, perimees: ecart > 3 };
  }

  function prochainJourOuvert(ctx) {
    return MP.prochainJourOuvert(new Date(), ctx.joursFermeture);
  }

  window.ContexteBoulangerie = {
    client: client,
    charger: charger,
    enrichir: enrichir,
    prevoirJour: prevoirJour,
    raisonsDuJour: raisonsDuJour,
    dernieresVentes: dernieresVentes,
    prochainJourOuvert: prochainJourOuvert
  };
})();
