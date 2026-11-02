// Alerte rupture dans la journée (nov. 2026).
//
// Pour chaque produit, à partir des ventes heure par heure d'aujourd'hui et
// de la courbe habituelle du même jour de semaine, projette l'heure où le
// stock cuit (fournées prévues comprises) sera épuisé. N'alerte que si :
//  - l'épuisement tombe avant la fermeture moins une marge (1 h) ;
//  - il reste le temps de fabriquer (pains 3 h, viennoiseries 2 h 30…) ;
//  - la confiance est haute : même la projection basse épuise le stock,
//    au moins 20 pièces vendues et 20 % de la journée habituelle écoulée,
//    et le relevé de l'heure précédente disait déjà la même chose.
// Mieux vaut une alerte manquée qu'une fausse alerte : après 2 fausses, le
// boulanger coupe les notifications.
//
// Fonction pure, sans réseau : AlerteRupture.alertesRupture(donnees).
// Ventes horaires attendues (une ligne par produit, jour et heure) :
//   { date_vente: 'AAAA-MM-JJ', heure: 0..23 (heure de Paris, tranche
//     [heure, heure+1[), nom_produit: 'Tradition', quantite: 12 }
// Convention : IIFE, ES5.
(function (racine) {
  // fabrication : du pétrin à la sortie du four ; cuisson : temps de four.
  var REGLAGES_RAYON = {
    pains: { fabrication: 3, cuisson: 0.5 },
    viennoiseries: { fabrication: 2.5, cuisson: 0.35 },
    snacking: { fabrication: 1, cuisson: 0 }
  };
  var SEUILS = {
    z: 1.65,             // projection basse = centre − 1,65 écart (≈ 95 %)
    minVendues: 20,      // pièces vendues aujourd'hui avant d'oser dire quoi que ce soit
    minPart: 0.25,       // part de la journée habituelle déjà écoulée
    minJours: 4,         // mêmes jours de semaine non épuisés, au minimum
    nbJours: 16,         // mêmes jours de semaine regardés, au plus
    margeFermeture: 1,   // épuisé moins d'1 h avant la fermeture : ce n'est pas une rupture
    sigmaMin: 0.06       // incertitude plancher de la projection
  };
  var NOMS_JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

  function rayonDe(nom) {
    var n = String(nom || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (/croissant|chocolat|brioche|viennois|chausson|raisin|suisse/.test(n)) return 'viennoiseries';
    if (/sandwich|panini|quiche|pizza|formule|menu|wrap|croque|salade/.test(n)) return 'snacking';
    return 'pains';
  }

  function cleNom(nom) { return String(nom || '').trim().toLowerCase(); }

  function jourSemaine(iso) { return new Date(iso + 'T00:00:00').getDay(); }

  // cum[h] = pièces vendues avant h heures (h de 0 à 24).
  function cumul(lignes) {
    var parHeure = [];
    for (var h = 0; h < 24; h++) parHeure.push(0);
    lignes.forEach(function (l) {
      var h = Number(l.heure);
      if (h >= 0 && h < 24) parHeure[h] += Number(l.quantite) || 0;
    });
    var cum = [0];
    for (var k = 0; k < 24; k++) cum.push(cum[k] + parHeure[k]);
    return cum;
  }

  // Courbe habituelle : les 8 derniers mêmes jours de semaine. La forme de
  // la journée et l'incertitude viennent des jours non épuisés (leur courbe
  // n'est pas coupée net) ; le « vendu d'habitude à cette heure » vient de
  // tous les jours (le matin d'un jour épuisé le soir reste juste).
  function profilHabituel(historique, nom, dateIso, joursExclus) {
    var j = jourSemaine(dateIso), parDate = {};
    historique.forEach(function (l) {
      if (cleNom(l.nom_produit) !== cleNom(nom) || l.date_vente >= dateIso) return;
      if (jourSemaine(l.date_vente) !== j) return;
      (parDate[l.date_vente] = parDate[l.date_vente] || []).push(l);
    });
    var tous = Object.keys(parDate).sort().slice(-SEUILS.nbJours).map(function (d) {
      var c = cumul(parDate[d]);
      return { date: d, cum: c, total: c[24], epuise: !!(joursExclus && joursExclus[d + '|' + cleNom(nom)]) };
    }).filter(function (x) { return x.total > 0; });
    var jours = tous.filter(function (x) { return !x.epuise; });
    if (jours.length < SEUILS.minJours) return null;
    var F = [], moyenneCum = [];
    var totalMoyen = jours.reduce(function (s, x) { return s + x.total; }, 0) / jours.length;
    for (var h = 0; h <= 24; h++) {
      var part = 0, c = 0;
      jours.forEach(function (x) { part += x.cum[h] / x.total; });
      tous.forEach(function (x) { c += x.cum[h]; });
      F.push(part / jours.length);
      moyenneCum.push(c / tous.length);
    }
    var fermeture = 0;
    for (var k = 24; k > 0; k--) { if (F[k - 1] < 0.999) { fermeture = k; break; } }
    return { jours: jours, F: F, moyenneCum: moyenneCum, totalMoyen: totalMoyen, fermeture: fermeture };
  }

  // Projection du total du jour à partir du cumul C à h0, et son incertitude
  // mesurée sur l'historique : écart entre « ce que la même règle aurait
  // projeté » et le total réel de chaque jour passé.
  function projeter(profil, C, h0) {
    var f = profil.F[h0];
    if (!(f > 0)) return null;
    var logs = [];
    profil.jours.forEach(function (x) {
      if (x.cum[h0] > 0) logs.push(Math.log(x.total / (x.cum[h0] / f)));
    });
    var moy = logs.reduce(function (s, v) { return s + v; }, 0) / (logs.length || 1);
    var sigma = Math.sqrt(logs.reduce(function (s, v) { return s + (v - moy) * (v - moy); }, 0) / Math.max(1, logs.length - 1));
    sigma = Math.max(SEUILS.sigmaMin, sigma);
    var centre = C / f;
    return { centre: centre, bas: Math.max(C, centre * Math.exp(-SEUILS.z * sigma)), sigma: sigma };
  }

  // Stock disponible à l'heure t : fournées sorties du four à t ou avant.
  function stockA(fournees, t) {
    return fournees.reduce(function (s, f) { return s + (f.heure <= t ? f.quantite : 0); }, 0);
  }

  // Première heure (au quart d'heure) où la demande projetée dépasse le stock.
  function heureEpuisement(profil, C, h0, total, fournees, fin) {
    var f0 = profil.F[h0];
    for (var t = h0; t <= fin; t += 0.25) {
      var h = Math.floor(t), Ft = profil.F[h] + (profil.F[Math.min(24, h + 1)] - profil.F[h]) * (t - h);
      var demande = C + (total - C) * Math.max(0, Ft - f0) / Math.max(1e-6, 1 - f0);
      if (demande >= stockA(fournees, t) + 0.5) return t;
    }
    return null;
  }

  // Évalue un produit au relevé de h0 heures (ventes connues jusqu'à h0).
  function evaluer(profil, aujourdhui, h0, fournees, fermeture) {
    var cum = cumul(aujourdhui), C = cum[h0];
    if (C < SEUILS.minVendues || profil.F[h0] < SEUILS.minPart) return null;
    if (C >= stockA(fournees, h0)) return null; // déjà épuisé : trop tard
    var p = projeter(profil, C, h0);
    if (!p || p.bas <= stockA(fournees, 24)) return null;
    var t = heureEpuisement(profil, C, h0, p.bas, fournees, fermeture);
    if (t === null || t > fermeture - SEUILS.margeFermeture) return null;
    return { C: C, projection: p, epuisement: t };
  }

  function formatHeure(t) {
    var quarts = Math.floor(t * 4 + 1e-9), h = Math.floor(quarts / 4), m = (quarts % 4) * 15;
    return h + ' h' + (m ? ' ' + m : '');
  }

  // donnees : {
  //   historique: ventes horaires des jours passés,
  //   aujourdhui: ventes horaires du jour (heures déjà closes),
  //   date: 'AAAA-MM-JJ', heure: relevé (ex. 10 = ventes jusqu'à 10 h),
  //   fournees: { 'Tradition': [{ heure: 5.5, quantite: 80 }, …] } (sorties du four prévues),
  //   fermeture: 19.5 (facultatif, sinon déduite de l'historique),
  //   joursEpuises: { 'AAAA-MM-JJ|tradition': true } (facultatif),
  //   reglages: { pains: { fabrication: 3, cuisson: 0.5 }, … } (facultatif)
  // }
  // Renvoie [{ nom, quantite, heureLancer, heureFour, heureEpuisement,
  //   vendues, habituel, message, preuve }], la plus urgente d'abord.
  //   ferme: true (facultatif) : jour de fermeture ou congés annuels.
  // Silence aussi du 20 au 24 décembre et le 31 : commandes et fournées de
  // fête, la courbe habituelle ne vaut rien ces jours-là.
  function jourDeSilence(iso) {
    var md = String(iso || '').slice(5);
    return (md >= '12-20' && md <= '12-24') || md === '12-31';
  }

  function alertesRupture(donnees) {
    if (!donnees || donnees.ferme || jourDeSilence(donnees.date)) return [];
    var h0 = Math.floor(donnees.heure);
    var alertes = [];
    Object.keys(donnees.fournees || {}).forEach(function (nom) {
      var fournees = (donnees.fournees[nom] || []).filter(function (f) { return f.quantite > 0; });
      if (!fournees.length) return;
      var profil = profilHabituel(donnees.historique || [], nom, donnees.date, donnees.joursEpuises);
      if (!profil) return;
      var fermeture = donnees.fermeture || profil.fermeture;
      var reg = (donnees.reglages && donnees.reglages[rayonDe(nom)]) || REGLAGES_RAYON[rayonDe(nom)];
      var duJour = (donnees.aujourdhui || []).filter(function (l) {
        return cleNom(l.nom_produit) === cleNom(nom) && l.date_vente === donnees.date;
      });
      var maintenant = evaluer(profil, duJour, h0, fournees, fermeture);
      if (!maintenant) return;
      // Le temps de fabriquer, en comptant depuis le relevé.
      if (maintenant.epuisement - reg.fabrication < h0) return;
      // Cohérence : le relevé d'une heure plus tôt disait déjà « rupture ».
      var avant = evaluer(profil, duJour.filter(function (l) { return Number(l.heure) < h0 - 1; }), h0 - 1, fournees, fermeture);
      if (!avant) return;
      // Quantité prudente : ce qui manque même dans l'hypothèse basse.
      var quantite = Math.max(5, Math.ceil((maintenant.projection.bas - stockA(fournees, 24)) / 5) * 5);
      var habituel = Math.round(profil.moyenneCum[h0]);
      var jour = NOMS_JOURS[jourSemaine(donnees.date)];
      var preuve = maintenant.C + ' vendu' + (maintenant.C > 1 ? 's' : '') + ' à ' + h0 + ' h contre ' + habituel + ' d\'habitude un ' + jour;
      var heureFour = maintenant.epuisement - reg.cuisson, heureLancer = maintenant.epuisement - reg.fabrication;
      alertes.push({
        nom: nom,
        quantite: quantite,
        heureLancer: heureLancer,
        heureFour: heureFour,
        heureEpuisement: maintenant.epuisement,
        vendues: maintenant.C,
        habituel: habituel,
        preuve: preuve,
        message: nom + ' : relance ' + quantite + ', à lancer avant ' + formatHeure(heureLancer) + ', au four avant ' + formatHeure(heureFour)
          + '. ' + preuve + ' : plus rien vers ' + formatHeure(maintenant.epuisement) + '.'
      });
    });
    return alertes.sort(function (a, b) { return a.heureLancer - b.heureLancer; });
  }

  racine.AlerteRupture = {
    alertesRupture: alertesRupture,
    profilHabituel: profilHabituel,
    cumul: cumul,
    rayonDe: rayonDe,
    formatHeure: formatHeure,
    jourDeSilence: jourDeSilence,
    REGLAGES_RAYON: REGLAGES_RAYON,
    SEUILS: SEUILS
  };
})(typeof window !== 'undefined' ? window : globalThis);
