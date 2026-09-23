// Moteur de prévision — module partagé par tableau-de-bord.html, semaine.html,
// commandes.html et personnel.html.
//
// Avant le 16 septembre 2026, ce moteur (calcul de la moyenne pondérée,
// exclusion des valeurs aberrantes, jours fériés/vacances scolaires, météo,
// fourchette de confiance...) était copié-collé à l'identique dans ces 4
// fichiers : toute correction devait être répétée 4 fois, avec le risque
// qu'une page reste en retard sur les autres. Ce fichier centralise cette
// logique en un seul endroit, chargé via une simple balise <script> (le site
// reste volontairement sans bundler ni framework — convention du projet).
//
// Convention du site : IIFE, style ES5 (var, pas de const/let/arrow).
// Chaque page qui a besoin de ce moteur ajoute, juste après avoir chargé ce
// fichier :
//   var MP = window.MoteurPrevision;
// puis reprend localement les fonctions dont elle a besoin, par exemple :
//   var moyennePonderee = MP.moyennePonderee;
// Les call sites existants de chaque page n'ont ainsi pas besoin de changer.
(function () {
  var nomsJours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var nomsMois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var nomsJoursCourts = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  var nomsMoisCourts = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

  function capitaliser(texte) {
    return texte.charAt(0).toUpperCase() + texte.slice(1);
  }

  function formatDateLongue(date) {
    return capitaliser(nomsJours[date.getDay()]) + ' ' + date.getDate() + ' ' + nomsMois[date.getMonth()];
  }

  // Nettoie un nom de produit pour l'affichage (espaces superflus, casse
  // hétérogène après un import CSV un peu sale) sans jamais toucher à la
  // valeur brute stockée en base. Utilisée aussi comme clé de regroupement
  // pour qu'un même produit saisi sous plusieurs casses ("CROISSANT",
  // "croissant") ne s'affiche plus comme deux cartes.
  function formatNomAffichage(nom) {
    var propre = (nom || '').toString().trim();
    if (!propre) return propre;
    return propre.charAt(0).toUpperCase() + propre.slice(1).toLowerCase();
  }

  // Poids donné aux ventes récentes par rapport aux anciennes dans la moyenne
  // pondérée (voir moyennePonderee ci-dessous). Plus proche de 1 = quasi plate,
  // plus proche de 0 = très sensible aux dernières occurrences.
  var DECALAGE_PONDERATION = 0.75;

  // Détecte et écarte les valeurs aberrantes (méthode IQR) avant de calculer
  // la moyenne, pour qu'un jour exceptionnel (fermeture, événement, erreur de
  // saisie) ne fausse pas la recommandation. Ne s'applique qu'à partir de 5
  // points d'historique.
  function exclureValeursAberrantes(ventesTriees) {
    if (ventesTriees.length < 5) {
      return { ventesFiltrees: ventesTriees, nbExclus: 0 };
    }
    var quantites = ventesTriees.map(function (v) { return v.quantite; }).sort(function (a, b) { return a - b; });
    function percentile(p) {
      var idx = (quantites.length - 1) * p;
      var lo = Math.floor(idx), hi = Math.ceil(idx);
      if (lo === hi) return quantites[lo];
      return quantites[lo] + (quantites[hi] - quantites[lo]) * (idx - lo);
    }
    var q1 = percentile(0.25);
    var q3 = percentile(0.75);
    var iqr = q3 - q1;
    if (iqr === 0) {
      return { ventesFiltrees: ventesTriees, nbExclus: 0 };
    }
    var basMin = q1 - 1.5 * iqr;
    var hautMax = q3 + 1.5 * iqr;
    var filtrees = ventesTriees.filter(function (v) { return v.quantite >= basMin && v.quantite <= hautMax; });
    // Garde-fou : ne jamais descendre sous 3 points restants après filtrage.
    if (filtrees.length < 3) {
      return { ventesFiltrees: ventesTriees, nbExclus: 0 };
    }
    return { ventesFiltrees: filtrees, nbExclus: ventesTriees.length - filtrees.length };
  }

  // Moyenne pondérée : les ventes récentes comptent plus que les anciennes.
  // ventesTriees doit être triée par date croissante.
  function moyennePonderee(ventesTriees) {
    var n = ventesTriees.length;
    var sommePonderee = 0;
    var sommePoids = 0;
    ventesTriees.forEach(function (v, i) {
      var positionDepuisLaFin = n - 1 - i; // 0 = la plus récente
      var poids = Math.pow(DECALAGE_PONDERATION, positionDepuisLaFin);
      sommePonderee += v.quantite * poids;
      sommePoids += poids;
    });
    return sommePonderee / sommePoids;
  }

  // Régression linéaire pondérée (y = ordonnée + pente*x). Sépare une vraie
  // tendance du bruit jour à jour pour la fourchette de confiance ci-dessous.
  function regressionPonderee(ventesTriees) {
    var n = ventesTriees.length;
    var sommePoids = 0, sommePoidsX = 0, sommePoidsY = 0;
    ventesTriees.forEach(function (v, i) {
      var poids = Math.pow(DECALAGE_PONDERATION, n - 1 - i);
      sommePoids += poids;
      sommePoidsX += poids * i;
      sommePoidsY += poids * v.quantite;
    });
    var xMoyen = sommePoidsX / sommePoids;
    var yMoyen = sommePoidsY / sommePoids;
    var numerateur = 0, denominateur = 0;
    ventesTriees.forEach(function (v, i) {
      var poids = Math.pow(DECALAGE_PONDERATION, n - 1 - i);
      var dx = i - xMoyen;
      numerateur += poids * dx * (v.quantite - yMoyen);
      denominateur += poids * dx * dx;
    });
    var pente = denominateur === 0 ? 0 : numerateur / denominateur;
    return { pente: pente, ordonnee: yMoyen - pente * xMoyen };
  }

  // Écart-type des ventes autour de la moyenne pondérée (utilisé seulement
  // quand il y a trop peu de points pour une régression fiable).
  function ecartTypePondere(ventesTriees, moyenne) {
    var n = ventesTriees.length;
    if (n <= 1) return 0;
    var sommePonderee = 0, sommePoids = 0;
    ventesTriees.forEach(function (v, i) {
      var poids = Math.pow(DECALAGE_PONDERATION, n - 1 - i);
      var ecart = v.quantite - moyenne;
      sommePonderee += poids * ecart * ecart;
      sommePoids += poids;
    });
    return Math.sqrt(sommePonderee / sommePoids);
  }

  // Écart-type des résidus par rapport à la tendance calculée ci-dessus.
  function ecartTypeResidus(ventesTriees, regression) {
    var n = ventesTriees.length;
    var sommePonderee = 0, sommePoids = 0;
    ventesTriees.forEach(function (v, i) {
      var poids = Math.pow(DECALAGE_PONDERATION, n - 1 - i);
      var predit = regression.ordonnee + regression.pente * i;
      var ecart = v.quantite - predit;
      sommePonderee += poids * ecart * ecart;
      sommePoids += poids;
    });
    return Math.sqrt(sommePonderee / sommePoids);
  }

  // Fourchette indicative autour de la recommandation, plutôt qu'un seul
  // chiffre qui donnerait une fausse impression de certitude.
  function calculerFourchette(ventesTriees, moyenne, quantitePoint) {
    var n = ventesTriees.length;
    if (n < 2) return null;

    var ecartType;
    if (n >= 4) {
      ecartType = ecartTypeResidus(ventesTriees, regressionPonderee(ventesTriees));
    } else {
      ecartType = ecartTypePondere(ventesTriees, moyenne);
    }

    var facteur = 1 + 3 / Math.sqrt(n);
    var margeBrute = ecartType * facteur;
    var bas = Math.max(0, Math.round((moyenne - margeBrute) * 1.1));
    var haut = Math.round((moyenne + margeBrute) * 1.1);
    if (haut < quantitePoint) haut = quantitePoint;
    if (bas > quantitePoint) bas = quantitePoint;
    if (bas === haut) return null;

    var margeRelative = quantitePoint > 0 ? ((haut - bas) / 2) / quantitePoint : 0;
    var tier;
    if (n < 4) {
      tier = 'histo-court';
    } else if (margeRelative <= 0.18) {
      tier = 'resserree';
    } else if (margeRelative <= 0.4) {
      tier = 'moderee';
    } else {
      tier = 'irreguliere';
    }

    return { bas: bas, haut: haut, tier: tier };
  }

  // Jours fériés légaux français (dates fixes + dates mobiles dérivées du
  // dimanche de Pâques, algorithme de Meeus/Jones/Butcher). Simplification
  // assumée : ne couvre pas le Vendredi saint ni le 26 décembre (fériés
  // seulement en Alsace-Moselle) — à ajouter si un pilote y est situé.
  function datePaques(annee) {
    var a = annee % 19;
    var b = Math.floor(annee / 100);
    var c = annee % 100;
    var d = Math.floor(b / 4);
    var e = b % 4;
    var f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4);
    var k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var mois = Math.floor((h + l - 7 * m + 114) / 31);
    var jour = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(annee, mois - 1, jour);
  }

  function ajouterJours(date, n) {
    var d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function versISO(date) {
    var mm = ('0' + (date.getMonth() + 1)).slice(-2);
    var dd = ('0' + date.getDate()).slice(-2);
    return date.getFullYear() + '-' + mm + '-' + dd;
  }

  function joursFeriesAnnee(annee) {
    var paques = datePaques(annee);
    var dates = [
      new Date(annee, 0, 1),
      ajouterJours(paques, 1),
      new Date(annee, 4, 1),
      new Date(annee, 4, 8),
      ajouterJours(paques, 39),
      ajouterJours(paques, 50),
      new Date(annee, 6, 14),
      new Date(annee, 7, 15),
      new Date(annee, 10, 1),
      new Date(annee, 10, 11),
      new Date(annee, 11, 25)
    ];
    return dates.map(versISO);
  }

  var CACHE_JOURS_FERIES = {};
  function estJourFerie(date) {
    var annee = date.getFullYear();
    if (!CACHE_JOURS_FERIES[annee]) {
      CACHE_JOURS_FERIES[annee] = joursFeriesAnnee(annee);
    }
    return CACHE_JOURS_FERIES[annee].indexOf(versISO(date)) !== -1;
  }

  // Vacances scolaires : dates publiées chaque année par le ministère, zone
  // (A/B/C) propre à chaque académie. Codées en dur pour 2025-2026 et
  // 2026-2027 (sources : education.gouv.fr, vérifiées le 9 septembre 2026) ;
  // à compléter à la main chaque année scolaire suivante.
  var PERIODES_VACANCES = [
    // 2025-2026
    { debut: '2025-10-18', fin: '2025-11-03', zones: 'toutes' },   // Toussaint
    { debut: '2025-12-20', fin: '2026-01-05', zones: 'toutes' },   // Noël
    { debut: '2026-02-07', fin: '2026-02-23', zones: ['A'] },      // Hiver A
    { debut: '2026-02-14', fin: '2026-03-02', zones: ['B'] },      // Hiver B
    { debut: '2026-02-21', fin: '2026-03-09', zones: ['C'] },      // Hiver C
    { debut: '2026-04-04', fin: '2026-04-20', zones: ['A'] },      // Printemps A
    { debut: '2026-04-11', fin: '2026-04-27', zones: ['B'] },      // Printemps B
    { debut: '2026-04-18', fin: '2026-05-04', zones: ['C'] },      // Printemps C
    { debut: '2026-07-04', fin: '2026-08-31', zones: 'toutes' },   // Été 2026
    // 2026-2027
    { debut: '2026-10-17', fin: '2026-11-02', zones: 'toutes' },   // Toussaint
    { debut: '2026-12-19', fin: '2027-01-04', zones: 'toutes' },   // Noël
    { debut: '2027-02-13', fin: '2027-03-01', zones: ['A'] },      // Hiver A
    { debut: '2027-02-20', fin: '2027-03-08', zones: ['B'] },      // Hiver B
    { debut: '2027-02-06', fin: '2027-02-22', zones: ['C'] },      // Hiver C
    { debut: '2027-04-10', fin: '2027-04-26', zones: ['A'] },      // Printemps A
    { debut: '2027-04-17', fin: '2027-05-03', zones: ['B'] },      // Printemps B
    { debut: '2027-04-03', fin: '2027-04-19', zones: ['C'] },      // Printemps C
    { debut: '2027-07-03', fin: '2027-08-31', zones: 'toutes' }    // Été 2027 (fin indicative)
  ];

  // Correspondance département → académie → zone (académies au 9 sept 2026,
  // source education.gouv.fr). La Corse (2A/2B) et les départements/
  // collectivités d'outre-mer ne sont pas couverts : on préfère ne rien
  // affirmer plutôt que deviner.
  var DEPARTEMENT_VERS_ZONE = {};
  (function () {
    var parZone = {
      A: ['25','39','70','90', '24','33','40','47','64', '03','15','43','63', '21','58','71','89', '07','26','38','73','74', '19','23','87', '01','42','69', '16','17','79','86'],
      B: ['04','05','13', '02','60','80', '59','62', '54','55','57','88', '44','49','53','72','85', '06','83','84', '14','50','61','27','76', '18','28','36','37','41','45', '08','10','51','52', '22','29','35','56', '67','68'],
      C: ['77','93','94', '11','30','34','48','66', '75', '09','12','31','32','46','65','81','82', '78','91','92','95']
    };
    Object.keys(parZone).forEach(function (zone) {
      parZone[zone].forEach(function (dep) { DEPARTEMENT_VERS_ZONE[dep] = zone; });
    });
  })();

  function codePostalVersDepartement(codePostal) {
    var cp = (codePostal || '').trim();
    if (!/^[0-9]{5}$/.test(cp)) return null;
    if (cp.substring(0, 2) === '97' || cp.substring(0, 2) === '98') return cp.substring(0, 3);
    if (cp.substring(0, 2) === '20') return null; // Corse : non couvert
    return cp.substring(0, 2);
  }

  function zoneVacancesPourCodePostal(codePostal) {
    var dep = codePostalVersDepartement(codePostal);
    if (!dep) return null;
    return DEPARTEMENT_VERS_ZONE[dep] || null;
  }

  function estEnVacances(date, zone) {
    if (!zone) return false;
    var iso = versISO(date);
    for (var i = 0; i < PERIODES_VACANCES.length; i++) {
      var p = PERIODES_VACANCES[i];
      if (iso >= p.debut && iso <= p.fin) {
        if (p.zones === 'toutes' || p.zones.indexOf(zone) !== -1) return true;
      }
    }
    return false;
  }

  // Météo : automatique dès que le code postal est connu, sans aucune saisie
  // supplémentaire. Géocodage une seule fois via geo.api.gouv.fr (gratuit,
  // sans clé), mis en cache dans parametres_commercant. Météo passée et à
  // venir via Open-Meteo (gratuit, sans clé). Tout est best-effort : une
  // panne réseau ne bloque jamais l'affichage, la météo est simplement
  // absente ce chargement-là.
  //
  // Un même code postal peut correspondre à plusieurs communes (ex : 35000
  // recouvre Rennes mais aussi Saint-Grégoire et Cesson-Sévigné) ; quand le
  // commerçant a renseigné sa ville, on l'utilise pour choisir la bonne
  // commune parmi celles que retourne le code postal.
  function normaliserNomVille(texte) {
    return (texte === null || texte === undefined ? '' : texte.toString())
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  function choisirCommune(communes, ville) {
    if (communes.length <= 1 || !ville) return communes[0];
    var villeNorm = normaliserNomVille(ville);
    if (!villeNorm) return communes[0];
    var i, nomNorm;
    for (i = 0; i < communes.length; i++) {
      nomNorm = normaliserNomVille(communes[i].nom);
      if (nomNorm === villeNorm) return communes[i];
    }
    for (i = 0; i < communes.length; i++) {
      nomNorm = normaliserNomVille(communes[i].nom);
      if (nomNorm.indexOf(villeNorm) !== -1 || villeNorm.indexOf(nomNorm) !== -1) return communes[i];
    }
    return communes[0];
  }

  function geocoderCodePostal(codePostal, ville) {
    var url = 'https://geo.api.gouv.fr/communes?codePostal=' + encodeURIComponent(codePostal) + '&fields=nom,centre&format=json';
    return fetch(url).then(function (res) {
      return res.ok ? res.json() : [];
    }).then(function (communes) {
      if (!communes || communes.length === 0) return null;
      var commune = choisirCommune(communes, ville);
      if (!commune || !commune.centre || !commune.centre.coordinates) return null;
      var coords = commune.centre.coordinates; // [longitude, latitude]
      return { latitude: coords[1], longitude: coords[0] };
    }).catch(function () { return null; });
  }

  // Récupère, une seule fois par commerçant, les coordonnées géographiques à
  // partir du code postal (et de la ville si renseignée) — en cache si déjà
  // connues, sinon géocodées puis sauvegardées pour la prochaine fois
  // (écriture best-effort). sbClient est passé en paramètre (chaque page a
  // son propre client Supabase) plutôt que capturé par fermeture.
  function obtenirCoordonnees(sbClient, parametres, commercantId) {
    if (!parametres || !parametres.code_postal) return Promise.resolve(null);
    if (parametres.latitude != null && parametres.longitude != null) {
      return Promise.resolve({ latitude: parametres.latitude, longitude: parametres.longitude });
    }
    return geocoderCodePostal(parametres.code_postal, parametres.ville).then(function (coords) {
      if (!coords) return null;
      // Bug corrigé (sept. 2026) : cette écriture n'était jamais "then-ée"
      // ni attendue, donc jamais garantie de partir — les coordonnées
      // n'étaient en pratique jamais mises en cache en base, et chaque
      // page (Prévisions, Planning) re-géocodait indépendamment à chaque
      // chargement au lieu de réutiliser les mêmes coordonnées déjà
      // connues. Best-effort : une erreur ici ne doit jamais empêcher
      // d'afficher la météo qu'on vient d'obtenir.
      sbClient.from('parametres_commercant').update({ latitude: coords.latitude, longitude: coords.longitude }).eq('commercant_id', commercantId).then(function () {}, function () {});
      return coords;
    });
  }

  // Un jour est classé "pluvieux" si au moins 1mm de pluie est tombé, "chaud"
  // à partir de 26°C, sinon "normal" — seuils volontairement simples. Cette
  // catégorie sert uniquement au calcul (comparaison de jours passés/futurs
  // de même catégorie dans calculerRecommandation) ; l'affichage utilise
  // libelle/icone ci-dessous, dérivés du vrai code météo (WMO), pas de cette
  // catégorie à 3 valeurs.
  function categoriserMeteo(precipitation, temperatureMax) {
    if (precipitation !== null && precipitation !== undefined && precipitation >= 1) return 'pluvieux';
    if (temperatureMax !== null && temperatureMax !== undefined && temperatureMax >= 26) return 'chaud';
    return 'normal';
  }

  // Codes météo WMO (renvoyés par Open-Meteo) → libellé + pictogramme en
  // français. Table volontairement groupée par famille plutôt qu'un code par
  // code : suffisant pour un affichage honnête ("Ciel voilé, 17°C"), pas une
  // prévision météo détaillée.
  var LIBELLES_METEO = [
    { codes: [0], libelle: 'Ciel dégagé', icone: '☀️' },
    { codes: [1], libelle: 'Plutôt dégagé', icone: '🌤️' },
    { codes: [2], libelle: 'Ciel voilé', icone: '⛅' },
    { codes: [3], libelle: 'Couvert', icone: '☁️' },
    { codes: [45, 48], libelle: 'Brouillard', icone: '🌫️' },
    { codes: [51, 53, 55, 56, 57], libelle: 'Bruine', icone: '🌦️' },
    { codes: [61, 63, 65, 66, 67, 80, 81, 82], libelle: 'Pluie', icone: '🌧️' },
    { codes: [71, 73, 75, 77, 85, 86], libelle: 'Neige', icone: '🌨️' },
    { codes: [95, 96, 99], libelle: 'Orage', icone: '⛈️' }
  ];

  function libelleMeteo(code) {
    for (var i = 0; i < LIBELLES_METEO.length; i++) {
      if (LIBELLES_METEO[i].codes.indexOf(code) !== -1) return LIBELLES_METEO[i];
    }
    return { libelle: 'Météo', icone: '🌡️' };
  }

  // Heures représentatives pour le découpage matin/midi/soir affiché sur
  // Prévisions (retour utilisateur, sept. 2026 : la météo peut changer
  // dans la journée, une seule valeur ne suffit pas). Purement indicatif,
  // ne sert à aucun calcul.
  var HEURES_MOMENTS_JOURNEE = [
    { cle: 'matin', heure: 8, libelle: 'Matin' },
    { cle: 'midi', heure: 13, libelle: 'Midi' },
    { cle: 'soir', heure: 19, libelle: 'Soir' }
  ];

  // Extrait, pour un jour ISO donné, les températures/codes horaires que
  // l'API a renvoyés (data.hourly), et n'en garde que les 3 heures
  // représentatives ci-dessus. Renvoie null si la donnée horaire est
  // absente (ex. réponse "daily" seule de recupererMeteoPassee).
  function momentsJourneeDepuisHoraire(data, iso) {
    if (!data || !data.hourly || !data.hourly.time) return null;
    var moments = [];
    HEURES_MOMENTS_JOURNEE.forEach(function (moment) {
      var cible = iso + 'T' + ('0' + moment.heure).slice(-2) + ':00';
      var index = data.hourly.time.indexOf(cible);
      if (index === -1) return;
      var temperature = data.hourly.temperature_2m ? data.hourly.temperature_2m[index] : null;
      var code = data.hourly.weathercode ? data.hourly.weathercode[index] : null;
      var infos = libelleMeteo(code);
      moments.push({
        cle: moment.cle,
        libelle: moment.libelle,
        temperature: (temperature !== null && temperature !== undefined) ? Math.round(temperature) : null,
        icone: infos.icone
      });
    });
    return moments.length > 0 ? moments : null;
  }

  // Valeur par jour : .categorie reste la donnée simple à 3 valeurs utilisée
  // par le calcul (calculerRecommandation) ; .temperature/.code/.libelle/
  // .icone sont la donnée réelle pour l'affichage (ex. "Ciel voilé, 17°C").
  // .moments (matin/midi/soir), quand la réponse contient des données
  // horaires, est purement additif — ne change rien pour le code déjà
  // écrit qui ne lit pas ce champ.
  function meteoDepuisReponse(data) {
    var parJour = {};
    if (data && data.daily && data.daily.time) {
      data.daily.time.forEach(function (iso, i) {
        var precipitation = data.daily.precipitation_sum ? data.daily.precipitation_sum[i] : null;
        var temperatureMax = data.daily.temperature_2m_max ? data.daily.temperature_2m_max[i] : null;
        var code = data.daily.weathercode ? data.daily.weathercode[i] : null;
        var infos = libelleMeteo(code);
        parJour[iso] = {
          categorie: categoriserMeteo(precipitation, temperatureMax),
          temperature: (temperatureMax !== null && temperatureMax !== undefined) ? Math.round(temperatureMax) : null,
          code: code,
          libelle: infos.libelle,
          icone: infos.icone,
          moments: momentsJourneeDepuisHoraire(data, iso)
        };
      });
    }
    return parJour;
  }

  function recupererMeteoPassee(latitude, longitude, dateDebut, dateFin) {
    var url = 'https://archive-api.open-meteo.com/v1/archive?latitude=' + latitude + '&longitude=' + longitude +
      '&start_date=' + dateDebut + '&end_date=' + dateFin +
      '&daily=precipitation_sum,temperature_2m_max,weathercode&timezone=Europe%2FParis';
    return fetch(url).then(function (res) { return res.ok ? res.json() : null; }).then(meteoDepuisReponse).catch(function () { return {}; });
  }

  function recupererMeteoPrevue(latitude, longitude) {
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + latitude + '&longitude=' + longitude +
      '&daily=precipitation_sum,temperature_2m_max,weathercode&hourly=temperature_2m,weathercode&timezone=Europe%2FParis&forecast_days=10';
    return fetch(url).then(function (res) { return res.ok ? res.json() : null; }).then(meteoDepuisReponse).catch(function () { return {}; });
  }

  // Renvoie la prochaine date, à partir de depuisDate exclue, qui n'est pas
  // un jour de fermeture habituel. Garde-fou à 7 itérations.
  function prochainJourOuvert(depuisDate, joursFermeture) {
    var d = new Date(depuisDate);
    d.setDate(d.getDate() + 1);
    var securite = 0;
    while (joursFermeture && joursFermeture.indexOf(d.getDay()) !== -1 && securite < 7) {
      d.setDate(d.getDate() + 1);
      securite++;
    }
    return d;
  }

  // Les N prochains jours d'ouverture à partir d'aujourd'hui.
  function prochainsJoursOuverts(n, joursFermeture) {
    var dates = [];
    var courant = new Date();
    for (var i = 0; i < n; i++) {
      courant = prochainJourOuvert(courant, joursFermeture);
      dates.push(courant);
    }
    return dates;
  }

  // Calcule la recommandation pour un produit et un jour cible donnés, avec
  // la comparaison ("delta") par rapport à la dernière vente réelle du même
  // jour de la semaine.
  function calculerRecommandation(ventesDuProduit, jourCible, zoneVacances, evenements, meteoPassee, meteoPrevue) {
    var numeroJourCible = jourCible.getDay();
    var nomJourCible = nomsJours[numeroJourCible];
    var isoCible = versISO(jourCible);
    // Un événement signalé à la main sur le jour cible prime sur
    // férié/vacances scolaires : le commerçant sait quelque chose que
    // l'historique seul ne peut pas deviner.
    var evenementCible = evenements ? evenements[isoCible] : undefined;
    var cibleFeriee = !evenementCible && estJourFerie(jourCible);
    var cibleVacances = !evenementCible && !cibleFeriee && estEnVacances(jourCible, zoneVacances);
    // La météo n'ajuste le chiffre que si aucun autre signal ne s'applique
    // déjà — pas de cumul d'incertitudes.
    var meteoCible = (!evenementCible && !cibleFeriee && !cibleVacances && meteoPrevue) ? meteoPrevue[isoCible] : undefined;

    // Bug corrigé (audit sept. 2026) : new Date(iso) sans 'T00:00:00' parse
    // en UTC, ce qui peut décaler .getDay() d'un jour dans un fuseau à
    // l'ouest de l'UTC (Antilles/Guyane). Convention du projet respectée.
    var ventesMemeJour = ventesDuProduit.filter(function (vente) {
      var d = new Date(vente.date_vente + 'T00:00:00');
      return d.getDay() === numeroJourCible && !estJourFerie(d) && !estEnVacances(d, zoneVacances);
    });

    var baseVentes = ventesMemeJour.length > 0 ? ventesMemeJour : ventesDuProduit;
    var baseTriee = baseVentes.slice().sort(function (a, b) {
      return new Date(a.date_vente) - new Date(b.date_vente);
    });

    var filtrage = exclureValeursAberrantes(baseTriee);
    var baseFinale = filtrage.ventesFiltrees;
    var moyenne = moyennePonderee(baseFinale);
    var quantite = Math.round(moyenne * 1.1);

    // Ajustement météo : compare, parmi les jours de même jour de semaine,
    // ceux qui avaient la même catégorie météo à l'ensemble de ces jours-là.
    // Nécessite au moins 3 jours passés dans cette catégorie et 5 jours au
    // total ; l'écart est plafonné à ±40%.
    var categorieMeteoCible = meteoCible ? meteoCible.categorie : undefined;
    var ajustementMeteo = null;
    if (categorieMeteoCible && categorieMeteoCible !== 'normal' && meteoPassee && ventesMemeJour.length >= 5) {
      var joursAvecCategorie = ventesMemeJour.filter(function (v) {
        var meteoJourPasse = meteoPassee[v.date_vente];
        return meteoJourPasse && meteoJourPasse.categorie === categorieMeteoCible;
      });
      if (joursAvecCategorie.length >= 3) {
        var sommeCategorie = 0;
        joursAvecCategorie.forEach(function (v) { sommeCategorie += v.quantite; });
        var moyenneCategorie = sommeCategorie / joursAvecCategorie.length;
        var sommeGlobale = 0;
        ventesMemeJour.forEach(function (v) { sommeGlobale += v.quantite; });
        var moyenneGlobale = sommeGlobale / ventesMemeJour.length;
        if (moyenneGlobale > 0) {
          var ratio = Math.max(0.6, Math.min(1.4, moyenneCategorie / moyenneGlobale));
          if (Math.abs(ratio - 1) >= 0.08) {
            ajustementMeteo = { ratio: ratio, categorie: categorieMeteoCible, nbJours: joursAvecCategorie.length };
          }
        }
      }
    }
    if (ajustementMeteo) {
      quantite = Math.round(quantite * ajustementMeteo.ratio);
    }

    var fourchette = calculerFourchette(baseFinale, moyenne, quantite);

    var texteBase;
    if (ventesMemeJour.length > 0) {
      texteBase = "Basé sur tes " + baseVentes.length + " derniers " + nomJourCible + "s";
    } else {
      texteBase = "Basé sur tes " + baseVentes.length + " dernier(s) jour(s) de vente (pas encore de " + nomJourCible + " enregistré)";
    }
    if (filtrage.nbExclus > 0) {
      texteBase += " (" + filtrage.nbExclus + " jour" + (filtrage.nbExclus > 1 ? "s" : "") + " atypique" + (filtrage.nbExclus > 1 ? "s" : "") + " écarté" + (filtrage.nbExclus > 1 ? "s" : "") + " du calcul)";
    }
    if (evenementCible === 'plus') {
      quantite = Math.round(quantite * 1.15);
      fourchette = null;
      texteBase = "📅 Événement signalé (plus de monde attendu) : estimation manuelle, pas calculée. " + texteBase;
    } else if (evenementCible === 'moins') {
      quantite = Math.round(quantite * 0.85);
      fourchette = null;
      texteBase = "📅 Événement signalé (moins de monde attendu) : estimation manuelle, pas calculée. " + texteBase;
    } else if (cibleFeriee) {
      texteBase = "⚠️ Jour férié : l'activité peut différer d'un " + nomJourCible + " normal. " + texteBase;
    } else if (cibleVacances) {
      texteBase = "🏖️ Vacances scolaires : l'activité peut différer d'un " + nomJourCible + " normal. " + texteBase;
    } else if (ajustementMeteo) {
      var motMeteo = ajustementMeteo.categorie === 'pluvieux' ? 'pluie' : 'forte chaleur';
      var icone = ajustementMeteo.categorie === 'pluvieux' ? '🌧️' : '☀️';
      var sens = ajustementMeteo.ratio > 1 ? 'vendent plutôt plus' : 'vendent plutôt moins';
      texteBase = icone + " " + capitaliser(motMeteo) + " prévue : tes " + nomJourCible + "s de " + motMeteo + " " + sens + " que la moyenne (" + ajustementMeteo.nbJours + " observé(s)). " + texteBase;
    }

    var delta = null;
    if (ventesMemeJour.length > 0) {
      var trie = ventesMemeJour.slice().sort(function (a, b) {
        return new Date(b.date_vente) - new Date(a.date_vente);
      });
      delta = quantite - trie[0].quantite;
    }

    // Référence "instinct" (mémoire fatiguée) utilisée uniquement pour le
    // calcul d'économies : une moyenne simple, NON pondérée et SANS
    // exclusion des valeurs aberrantes, sur le même jour de semaine. Jamais
    // affichée comme recommandation.
    var sommeInstinct = 0;
    baseVentes.forEach(function (v) { sommeInstinct += v.quantite; });
    var quantiteInstinct = baseVentes.length > 0 ? Math.round(sommeInstinct / baseVentes.length) : quantite;

    return {
      quantite: quantite,
      quantiteInstinct: quantiteInstinct,
      nbJoursUtilises: baseVentes.length,
      memeJourSemaine: ventesMemeJour.length > 0,
      nomJourCible: nomJourCible,
      texteBase: texteBase,
      delta: delta,
      fourchette: fourchette,
      jourFerie: cibleFeriee,
      vacancesScolaires: cibleVacances,
      evenement: evenementCible
    };
  }

  // Traduit les recommandations par plat en consommation prévue par
  // ingrédient, via les fiches techniques optionnelles définies sur chaque
  // produit. Un plat sans fiche technique n'apparaît simplement pas ici.
  function calculerConsommationIngredients(recommandationsParNom, produits, ingredientsLignes) {
    var idParNom = {};
    produits.forEach(function (p) { idParNom[formatNomAffichage(p.nom)] = p.id; });

    var lignesParProduitId = {};
    ingredientsLignes.forEach(function (ligne) {
      if (!lignesParProduitId[ligne.produit_id]) lignesParProduitId[ligne.produit_id] = [];
      lignesParProduitId[ligne.produit_id].push(ligne);
    });

    var totaux = {};
    Object.keys(recommandationsParNom).forEach(function (nomProduit) {
      var produitId = idParNom[nomProduit];
      if (produitId === undefined) return;
      var lignes = lignesParProduitId[produitId];
      if (!lignes) return;
      var quantiteRecommandee = recommandationsParNom[nomProduit];

      lignes.forEach(function (ligne) {
        var uniteAffichee = ligne.unite || '';
        var cle = ligne.nom_ingredient.trim().toLowerCase() + '|' + uniteAffichee.trim().toLowerCase();
        if (!totaux[cle]) {
          totaux[cle] = { nom: ligne.nom_ingredient, unite: uniteAffichee, total: 0 };
        }
        totaux[cle].total += quantiteRecommandee * ligne.quantite;
      });
    });

    return Object.keys(totaux).map(function (cle) { return totaux[cle]; }).sort(function (a, b) {
      return b.total - a.total;
    });
  }

  // Économie réelle estimée pour UN jour (tableau de bord) : compare,
  // ingrédient par ingrédient, la consommation "instinct" à celle de
  // l'outil, valorisée avec le dernier coût unitaire mémorisé. Un ingrédient
  // sans coût renseigné est ignoré. Renvoie null tant qu'aucun coût n'est
  // connu nulle part.
  function calculerEconomieReelle(recommandationsParNom, recommandationsInstinctParNom, produits, ingredientsLignes) {
    var consommationPrevue = calculerConsommationIngredients(recommandationsParNom, produits, ingredientsLignes);
    var consommationInstinct = calculerConsommationIngredients(recommandationsInstinctParNom, produits, ingredientsLignes);

    var coutParCle = {};
    var aAuMoinsUnCout = false;
    ingredientsLignes.forEach(function (ligne) {
      if (ligne.cout_unitaire == null) return;
      aAuMoinsUnCout = true;
      var cle = ligne.nom_ingredient.trim().toLowerCase() + '|' + (ligne.unite || '').trim().toLowerCase();
      coutParCle[cle] = ligne.cout_unitaire;
    });

    if (!aAuMoinsUnCout) return null;

    var instinctParCle = {};
    consommationInstinct.forEach(function (ing) {
      var cle = ing.nom.trim().toLowerCase() + '|' + (ing.unite || '').trim().toLowerCase();
      instinctParCle[cle] = ing.total;
    });

    var economieTotale = 0;
    var nbIngredientsValorises = 0;
    consommationPrevue.forEach(function (ing) {
      var cle = ing.nom.trim().toLowerCase() + '|' + (ing.unite || '').trim().toLowerCase();
      var cout = coutParCle[cle];
      if (cout == null) return;
      var quantiteInstinctIng = instinctParCle[cle] || 0;
      economieTotale += (quantiteInstinctIng - ing.total) * cout;
      nbIngredientsValorises++;
    });

    return { economie: economieTotale, nbIngredients: nbIngredientsValorises };
  }

  // Économie réelle estimée, agrégée sur plusieurs jours (commandes) :
  // additionne la consommation "outil" et "instinct" de chaque jour couvert
  // avant de les comparer, plutôt que de sommer des économies calculées
  // séparément jour par jour.
  function calculerEconomieReellePeriode(recommandationsParJour, produits, ingredientsLignes) {
    var consommationPrevueTotale = {};
    var consommationInstinctTotale = {};

    function ajouter(cible, consommation) {
      consommation.forEach(function (ing) {
        var cle = ing.nom.trim().toLowerCase() + '|' + (ing.unite || '').trim().toLowerCase();
        if (!cible[cle]) cible[cle] = { nom: ing.nom, unite: ing.unite, total: 0 };
        cible[cle].total += ing.total;
      });
    }

    recommandationsParJour.forEach(function (jour) {
      ajouter(consommationPrevueTotale, calculerConsommationIngredients(jour.recommandationsParNom, produits, ingredientsLignes));
      ajouter(consommationInstinctTotale, calculerConsommationIngredients(jour.recommandationsInstinctParNom, produits, ingredientsLignes));
    });

    var coutParCle = {};
    var aAuMoinsUnCout = false;
    ingredientsLignes.forEach(function (ligne) {
      if (ligne.cout_unitaire == null) return;
      aAuMoinsUnCout = true;
      var cle = ligne.nom_ingredient.trim().toLowerCase() + '|' + (ligne.unite || '').trim().toLowerCase();
      coutParCle[cle] = ligne.cout_unitaire;
    });

    if (!aAuMoinsUnCout) return null;

    var economieTotale = 0;
    var nbIngredientsValorises = 0;
    Object.keys(consommationPrevueTotale).forEach(function (cle) {
      var cout = coutParCle[cle];
      if (cout == null) return;
      var quantiteInstinctIng = (consommationInstinctTotale[cle] && consommationInstinctTotale[cle].total) || 0;
      economieTotale += (quantiteInstinctIng - consommationPrevueTotale[cle].total) * cout;
      nbIngredientsValorises++;
    });

    return { economie: economieTotale, nbIngredients: nbIngredientsValorises };
  }

  // Invendus évités (estimation) : écart de QUANTITÉ (pas en €) entre la
  // production "instinct" et la prévision de l'outil, sommé sur tous les
  // produits et jours de la période, quand cet écart est positif. Jamais un
  // fait mesuré, toujours une estimation.
  function calculerInvendusEvitesPeriode(recommandationsParJour) {
    var total = 0;
    recommandationsParJour.forEach(function (jour) {
      Object.keys(jour.recommandationsParNom).forEach(function (nomProduit) {
        var instinct = jour.recommandationsInstinctParNom[nomProduit] || 0;
        var outil = jour.recommandationsParNom[nomProduit] || 0;
        var ecart = instinct - outil;
        if (ecart > 0) total += ecart;
      });
    });
    return total;
  }

  function percentileValeur(valeursTriees, p) {
    var idx = (valeursTriees.length - 1) * p;
    var lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return valeursTriees[lo];
    return valeursTriees[lo] + (valeursTriees[hi] - valeursTriees[lo]) * (idx - lo);
  }

  // Rétro-test générique : rejoue une méthode de prédiction sur l'historique
  // passé (pour chaque occurrence d'un jour de semaine donné, prédit à
  // partir des occurrences précédentes) et mesure l'erreur relative moyenne.
  function retroTesterMethode(ventes, fonctionPrediction) {
    var parProduit = {};
    ventes.forEach(function (v) {
      if (!parProduit[v.nom_produit]) parProduit[v.nom_produit] = [];
      parProduit[v.nom_produit].push(v);
    });

    var erreurs = [];
    Object.keys(parProduit).forEach(function (nom) {
      var lignes = parProduit[nom].slice().sort(function (a, b) {
        return new Date(a.date_vente) - new Date(b.date_vente);
      });
      var parJour = {};
      lignes.forEach(function (v) {
        // Bug corrigé (audit sept. 2026) : idem, .getDay() sur une date
        // parsée en UTC pouvait décaler le regroupement par jour de semaine.
        var jour = new Date(v.date_vente + 'T00:00:00').getDay();
        if (!parJour[jour]) parJour[jour] = [];
        parJour[jour].push(v);
      });
      Object.keys(parJour).forEach(function (jour) {
        var occurrences = parJour[jour];
        for (var i = 1; i < occurrences.length; i++) {
          var historique = occurrences.slice(0, i);
          var prediction = fonctionPrediction(historique);
          var reel = occurrences[i].quantite;
          if (reel > 0) {
            erreurs.push(Math.abs(prediction - reel) / reel);
          }
        }
      });
    });

    if (erreurs.length === 0) return null;
    var sommeErreurs = 0;
    erreurs.forEach(function (e) { sommeErreurs += e; });
    var erreurMoyenne = sommeErreurs / erreurs.length;
    return {
      valeur: Math.max(0, Math.round((1 - erreurMoyenne) * 100)),
      nbPoints: erreurs.length
    };
  }

  function calculerFiabilite(ventes) {
    return retroTesterMethode(ventes, function (historique) {
      var filtrage = exclureValeursAberrantes(historique);
      return Math.round(moyennePonderee(filtrage.ventesFiltrees) * 1.1);
    });
  }

  function calculerFiabiliteNaive(ventes) {
    return retroTesterMethode(ventes, function (historique) {
      var somme = 0;
      historique.forEach(function (h) { somme += h.quantite; });
      return Math.round(somme / historique.length);
    });
  }

  // Prévision d'affluence sur les 7 jours à venir (signal relatif, pas un
  // chiffre). Priorité : jour de fermeture > événement signalé à la main >
  // férié/vacances scolaires (déduits) > écart statistique (charge/calme).
  function calculerPrevisionSemaine(ventes, zoneVacances, joursFermeture, evenements) {
    var totauxParDate = {};
    ventes.forEach(function (v) {
      totauxParDate[v.date_vente] = (totauxParDate[v.date_vente] || 0) + v.quantite;
    });
    var historiqueTotal = Object.keys(totauxParDate).map(function (d) {
      return { date_vente: d, quantite: totauxParDate[d] };
    }).sort(function (a, b) { return new Date(a.date_vente) - new Date(b.date_vente); });

    if (historiqueTotal.length === 0) return [];

    var jours = [];
    for (var offset = 1; offset <= 7; offset++) {
      var dateCible = new Date();
      dateCible.setDate(dateCible.getDate() + offset);
      var numeroJour = dateCible.getDay();
      var isoCible = versISO(dateCible);
      var cibleFermee = !!(joursFermeture && joursFermeture.indexOf(numeroJour) !== -1);
      var evenementCible = !cibleFermee && evenements ? evenements[isoCible] : undefined;
      var cibleFeriee = !cibleFermee && !evenementCible && estJourFerie(dateCible);
      var cibleVacances = !cibleFermee && !evenementCible && !cibleFeriee && estEnVacances(dateCible, zoneVacances);

      var memeJour = historiqueTotal.filter(function (t) {
        var d = new Date(t.date_vente);
        return d.getDay() === numeroJour && !estJourFerie(d) && !estEnVacances(d, zoneVacances);
      });
      var base = memeJour.length > 0 ? memeJour : historiqueTotal;
      var moyenne = moyennePonderee(base);

      var tier = 'normal';
      if (cibleFermee) {
        tier = 'ferme';
      } else if (evenementCible === 'plus') {
        tier = 'evenement-plus';
      } else if (evenementCible === 'moins') {
        tier = 'evenement-moins';
      } else if (cibleFeriee) {
        tier = 'ferie';
      } else if (cibleVacances) {
        tier = 'vacances';
      } else if (memeJour.length >= 4) {
        var quantitesTriees = base.map(function (v) { return v.quantite; }).sort(function (a, b) { return a - b; });
        var q1 = percentileValeur(quantitesTriees, 0.25);
        var q3 = percentileValeur(quantitesTriees, 0.75);
        if (q3 > q1) {
          if (moyenne > q3) tier = 'charge';
          else if (moyenne < q1) tier = 'calme';
        }
      } else {
        tier = 'insuffisant';
      }

      jours.push({ date: dateCible, iso: isoCible, numeroJour: numeroJour, nomJour: nomsJours[numeroJour], tier: tier });
    }
    return jours;
  }

  window.MoteurPrevision = {
    nomsJours: nomsJours,
    nomsMois: nomsMois,
    nomsJoursCourts: nomsJoursCourts,
    nomsMoisCourts: nomsMoisCourts,
    capitaliser: capitaliser,
    formatDateLongue: formatDateLongue,
    formatNomAffichage: formatNomAffichage,
    exclureValeursAberrantes: exclureValeursAberrantes,
    moyennePonderee: moyennePonderee,
    regressionPonderee: regressionPonderee,
    ecartTypePondere: ecartTypePondere,
    ecartTypeResidus: ecartTypeResidus,
    calculerFourchette: calculerFourchette,
    datePaques: datePaques,
    ajouterJours: ajouterJours,
    versISO: versISO,
    joursFeriesAnnee: joursFeriesAnnee,
    estJourFerie: estJourFerie,
    codePostalVersDepartement: codePostalVersDepartement,
    zoneVacancesPourCodePostal: zoneVacancesPourCodePostal,
    estEnVacances: estEnVacances,
    normaliserNomVille: normaliserNomVille,
    choisirCommune: choisirCommune,
    geocoderCodePostal: geocoderCodePostal,
    obtenirCoordonnees: obtenirCoordonnees,
    categoriserMeteo: categoriserMeteo,
    libelleMeteo: libelleMeteo,
    meteoDepuisReponse: meteoDepuisReponse,
    recupererMeteoPassee: recupererMeteoPassee,
    recupererMeteoPrevue: recupererMeteoPrevue,
    prochainJourOuvert: prochainJourOuvert,
    prochainsJoursOuverts: prochainsJoursOuverts,
    calculerRecommandation: calculerRecommandation,
    calculerConsommationIngredients: calculerConsommationIngredients,
    calculerEconomieReelle: calculerEconomieReelle,
    calculerEconomieReellePeriode: calculerEconomieReellePeriode,
    calculerInvendusEvitesPeriode: calculerInvendusEvitesPeriode,
    percentileValeur: percentileValeur,
    retroTesterMethode: retroTesterMethode,
    calculerFiabilite: calculerFiabilite,
    calculerFiabiliteNaive: calculerFiabiliteNaive,
    calculerPrevisionSemaine: calculerPrevisionSemaine
  };
})();
