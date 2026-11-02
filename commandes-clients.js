// Commandes clients (bûches, galettes, pièces montées, mairie, cantine…).
// Partagé par commandes-clients.html (saisie, retraits), previsions.html
// (réservées à part dans la Fournée, alerte du matin) et contexte.js (les
// pièces réservées sortent des ventes qui servent à apprendre).
//
// Fiabilité : une commande saisie n'est jamais perdue. Chaque écriture passe
// par une file en localStorage, envoyée au retour du réseau ; la table n'a
// pas de suppression (annulation seulement) et garde un historique.
// Convention : IIFE, ES5. Fonctions pures testables sous Node (window factice).
(function () {
  var TABLE = 'commandes_clients';

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function versISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function depuisISO(iso) { return new Date(iso + 'T12:00:00'); }
  function ajouterJours(iso, n) { var d = depuisISO(iso); d.setDate(d.getDate() + n); return versISO(d); }

  // Même règle que MoteurPrevision.cleProduit : minuscules, sans accents,
  // sans « s »/« x » final. Recopiée pour rester utilisable seule.
  function cle(nom) {
    var p = (nom === null || nom === undefined ? '' : String(nom)).trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (p.length > 3 && /[sx]$/.test(p)) p = p.slice(0, -1);
    return p;
  }

  function nouvelId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }

  // ---------- Occurrences ----------
  // Une commande ponctuelle a lieu à sa date de retrait ; une récurrente
  // (jours_recurrence : 0 = dimanche … 6 = samedi) chaque jour coché, de
  // date_retrait (début) à date_fin, sauf les dates sautées (« pas cette fois »).
  // Zone de vacances scolaires (A, B, C) de la boutique, pour les
  // récurrentes « pas pendant les vacances » (cantines, écoles). La liste
  // des vacances est celle du moteur (MoteurPrevision.estEnVacances).
  var zoneCourante = null;
  function definirZone(zone) { if (zone !== undefined) zoneCourante = zone; }
  function enVacances(iso) {
    var MP = typeof window !== 'undefined' && window.MoteurPrevision;
    return !!(MP && MP.estEnVacances && zoneCourante && MP.estEnVacances(depuisISO(iso), zoneCourante));
  }

  function aLieuLe(c, iso) {
    if (!c || (c.statut && c.statut !== 'active')) return false; // annulée ou refusée
    var jours = c.jours_recurrence;
    if (!jours || !jours.length) return c.date_retrait === iso;
    if (iso < c.date_retrait) return false;
    if (c.date_fin && iso > c.date_fin) return false;
    if ((c.dates_sautees || []).indexOf(iso) !== -1) return false;
    if (jours.map(Number).indexOf(depuisISO(iso).getDay()) === -1) return false;
    return !(c.sauf_vacances && enVacances(iso));
  }

  function estRecurrente(c) { return !!(c.jours_recurrence && c.jours_recurrence.length); }
  // « Praliné · 6 parts » : parfum et taille choisis d'une touche.
  function libelleVariante(c) { return [c.parfum, c.taille].filter(function (x) { return x; }).join(' · '); }

  function duJour(commandes, iso) {
    return (commandes || []).filter(function (c) { return aLieuLe(c, iso); }).sort(function (a, b) {
      return String(a.heure_retrait || '99').localeCompare(String(b.heure_retrait || '99')) || String(a.client_nom).localeCompare(String(b.client_nom));
    });
  }

  // { cle produit : { nom, quantite } } des pièces réservées ce jour-là.
  function reserveesParCle(commandes, iso) {
    var r = {};
    duJour(commandes, iso).forEach(function (c) {
      var k = cle(c.produit);
      if (!r[k]) r[k] = { nom: String(c.produit).trim(), quantite: 0, variantes: {} };
      r[k].quantite += Number(c.quantite) || 0;
      var v = libelleVariante(c);
      if (v) r[k].variantes[v] = (r[k].variantes[v] || 0) + (Number(c.quantite) || 0);
    });
    return r;
  }

  function nbDuJour(commandes, iso) { return duJour(commandes, iso).length; }

  // Production d'un jour de retrait : un total par produit, puis par parfum
  // et taille, du plus gros au plus petit. [{ nom, quantite, variantes: [{ libelle, quantite }] }]
  function productionDuJour(commandes, iso) {
    var r = reserveesParCle(commandes, iso);
    return Object.keys(r).map(function (k) {
      var x = r[k];
      return { nom: x.nom, quantite: x.quantite, variantes: Object.keys(x.variantes).sort().map(function (l) { return { libelle: l, quantite: x.variantes[l] }; }) };
    }).sort(function (a, b) { return b.quantite - a.quantite; });
  }

  // Recherche au comptoir : 2 lettres du nom ou 2 chiffres du téléphone.
  function sansAccent(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function rechercher(commandes, q) {
    q = String(q || '').trim();
    if (q.length < 2) return commandes;
    var chiffres = q.replace(/\D/g, '');
    var texte = sansAccent(q);
    return commandes.filter(function (c) {
      if (sansAccent(c.client_nom).indexOf(texte) !== -1) return true;
      return chiffres.length >= 2 && chiffres.length === q.replace(/\s/g, '').length && String(c.client_telephone || '').replace(/\D/g, '').indexOf(chiffres) !== -1;
    });
  }

  // Acompte conseillé : 30 % au-dessus de 40 € (réglable par le patron).
  var REGLE_ACOMPTE = { seuil: 40, taux: 30 };
  function acompteConseille(total, regle) {
    regle = regle || REGLE_ACOMPTE;
    if (!(total > regle.seuil)) return 0;
    return Math.ceil(total * regle.taux / 100);
  }

  // Prix d'une commande : prix de la taille (variantes), sinon prix du produit.
  // catalogue : [{ produit, parfums, tailles, prix_tailles }] ; prixProduits : { cle: prix }.
  function prixCommande(c, catalogue, prixProduits) {
    var fiche = (catalogue || []).filter(function (f) { return cle(f.produit) === cle(c.produit); })[0];
    var unitaire = fiche && c.taille && fiche.prix_tailles && Number(fiche.prix_tailles[c.taille]);
    if (!unitaire && fiche && fiche.prix) unitaire = Number(fiche.prix);
    if (!unitaire && prixProduits) unitaire = Number(prixProduits[cle(c.produit)]);
    return unitaire > 0 ? Math.round(unitaire * (Number(c.quantite) || 0) * 100) / 100 : null;
  }

  // Bouton de la Fournée : hors période (rien à venir et rien saisi depuis
  // 10 jours), il se réduit à un lien discret. Aucune relance.
  function horsPeriode(commandes, maintenant) {
    var iso = versISO(maintenant);
    var limite = new Date(maintenant.getTime() - 10 * 86400000);
    return !(commandes || []).some(function (c) {
      if (c.cree_le && new Date(c.cree_le) > limite) return true;
      if (c.statut && c.statut !== 'active') return false;
      return estRecurrente(c) ? (!c.date_fin || c.date_fin >= iso) : c.date_retrait >= iso;
    });
  }

  // Jour de rush (24 décembre, ou 30 retraits et plus) : rien qui gêne dans la
  // Fournée, aucun rappel de saisie.
  function jourDeRush(maintenant, commandes) {
    if (maintenant.getMonth() === 11 && maintenant.getDate() === 24) return true;
    return nbDuJour(commandes, versISO(maintenant)) >= 30;
  }

  // D'une année sur l'autre : début novembre pour les bûches (retraits de
  // décembre), décembre pour les galettes (janvier), 4 semaines avant Pâques.
  // « L'an dernier : 180 bûches commandées, 20 refusées faute de place. »
  var SAISONS = [
    { nom: 'bûches', motif: /buche/, actif: function (d) { return d.getMonth() === 10; }, periode: function (a) { return [a - 1 + '-12-01', a - 1 + '-12-31']; } },
    { nom: 'galettes', motif: /galette/, actif: function (d) { return d.getMonth() === 11; }, periode: function (a) { return [a + '-01-01', a + '-01-31']; } },
    { nom: 'commandes de Pâques', motif: null, actif: function (d) { var p = paques(d.getFullYear()); var j = (p - d) / 86400000; return j > 0 && j <= 28; },
      periode: function (a) { var p = paques(a - 1); return [versISO(new Date(p.getTime() - 10 * 86400000)), versISO(new Date(p.getTime() + 86400000))]; } }
  ];
  function paques(annee) {
    var MP = typeof window !== 'undefined' && window.MoteurPrevision;
    if (MP && MP.datePaques) return MP.datePaques(annee);
    var a = annee % 19, b = Math.floor(annee / 100), c = annee % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mois = Math.floor((h + l - 7 * m + 114) / 31), jour = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(annee, mois - 1, jour);
  }
  function rappelAnnuel(commandes, maintenant) {
    var annee = maintenant.getFullYear();
    var res = null;
    SAISONS.some(function (s) {
      if (!s.actif(maintenant)) return false;
      var p = s.periode(annee);
      var commandees = 0, refusees = 0;
      (commandes || []).forEach(function (c) {
        if (estRecurrente(c) || c.date_retrait < p[0] || c.date_retrait > p[1]) return;
        if (s.motif && !s.motif.test(sansAccent(c.produit))) return;
        if (c.statut === 'refusee') refusees += Number(c.quantite) || 0;
        else if (c.statut !== 'annulee') commandees += Number(c.quantite) || 0;
      });
      if (!commandees && !refusees) return false;
      res = { saison: s.nom, commandees: commandees, refusees: refusees,
        texte: 'L\'an dernier : ' + commandees + ' ' + s.nom + ' commandées' + (refusees ? ', ' + refusees + ' refusées faute de place' : '') + '.' };
      return true;
    });
    return res;
  }

  // Point d'accroche de contexte.js : les pièces réservées ne sont pas de la
  // demande boutique. On les retire des ventes du jour (jamais sous zéro)
  // pour que le moteur n'apprenne pas deux fois la même commande.
  function retirerDesVentes(ventes, commandes, zone) {
    definirZone(zone);
    if (!commandes || !commandes.length || !ventes || !ventes.length) return ventes;
    var parDate = {};
    return ventes.map(function (v) {
      if (!parDate[v.date_vente]) parDate[v.date_vente] = reserveesParCle(commandes, v.date_vente);
      var res = parDate[v.date_vente][cle(v.nom_produit)];
      if (!res || !res.quantite) return v;
      var copie = {};
      Object.keys(v).forEach(function (k) { copie[k] = v[k]; });
      copie.quantite = Math.max(0, (Number(v.quantite) || 0) - res.quantite);
      copie.reservees = Math.min(Number(v.quantite) || 0, res.quantite);
      return copie;
    });
  }

  // ---------- Alertes ----------
  // Acompte prévu mais pas encore encaissé, pour une commande encore à venir.
  function acomptesManquants(commandes, isoAujourdhui) {
    return (commandes || []).filter(function (c) {
      if ((c.statut && c.statut !== 'active') || c.acompte_statut !== 'a_encaisser') return false;
      return (c.jours_recurrence && c.jours_recurrence.length) ? (!c.date_fin || c.date_fin >= isoAujourdhui) : c.date_retrait >= isoAujourdhui;
    });
  }

  // Commandes nouvelles, modifiées ou annulées depuis le dernier « Vu » du
  // patron (sinon depuis 36 h), qui touchent aujourd'hui ou demain : c'est ce
  // qu'il doit voir en ouvrant la Fournée à 3 h 30.
  function changementsProches(commandes, maintenant, vuLe) {
    var iso = versISO(maintenant);
    var jours = [iso, ajouterJours(iso, 1)];
    var depuis = vuLe ? new Date(vuLe) : new Date(maintenant.getTime() - 36 * 3600000);
    var res = [];
    (commandes || []).forEach(function (c) {
      if (!c.modifie_le || new Date(c.modifie_le) <= depuis || c.statut === 'refusee') return;
      var active = Object.assign({}, c, { statut: 'active', dates_sautees: [] });
      var jour = jours.filter(function (j) { return aLieuLe(active, j); })[0];
      if (!jour) return;
      var nature = c.statut === 'annulee' ? 'annulée'
        : (c.dates_sautees || []).indexOf(jour) !== -1 ? 'annulée ce jour-là'
        : (c.cree_le && Math.abs(new Date(c.modifie_le) - new Date(c.cree_le)) < 60000 ? 'nouvelle' : 'modifiée');
      res.push({ commande: c, nature: nature, pour: jour === iso ? "aujourd'hui" : 'demain' });
    });
    return res;
  }

  // ---------- SMS de la veille (emplacement) ----------
  // L'envoi viendra avec le compte SMS du fondateur (Edge Function à venir) :
  // elle prendra smsDeLaVeille(commandes, demain) et notera sms_envois[date].
  var JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  function euros(n) { return (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €'; }
  function heureCourte(h) { if (!h) return ''; var p = String(h).split(':'); return Number(p[0]) + ' h' + (p[1] && p[1] !== '00' ? ' ' + p[1] : ''); }

  function texteSMS(c, iso, boutique) {
    var t = 'Bonjour, ' + (boutique || 'votre boulangerie') + ' : votre commande de ' + c.quantite + ' ' + c.produit +
      ' est prête ' + JOURS[depuisISO(iso).getDay()] + (c.heure_retrait ? ' à partir de ' + heureCourte(c.heure_retrait) : '') + '.';
    if (c.acompte_statut === 'a_encaisser' && c.acompte_montant > 0) t += ' Acompte de ' + euros(c.acompte_montant) + ' à régler au retrait.';
    else if (c.acompte_statut === 'encaisse' && c.acompte_montant > 0) t += ' Acompte reçu : ' + euros(c.acompte_montant) + '.';
    return t + ' À demain !';
  }

  function smsDeLaVeille(commandes, isoDemain, boutique) {
    return duJour(commandes, isoDemain).filter(function (c) {
      return c.client_telephone && !(c.sms_envois && c.sms_envois[isoDemain]);
    }).map(function (c) { return { commande_id: c.id, telephone: c.client_telephone, texte: texteSMS(c, isoDemain, boutique) }; });
  }

  // ---------- File hors connexion ----------
  // Chaque écriture est d'abord posée ici (localStorage), puis envoyée.
  // Elle ne quitte la file qu'une fois confirmée par la base. Les lignes
  // portent un id choisi sur l'appareil : renvoyer deux fois ne crée pas de doublon.
  function cleFile(id) { return 'apoint-cc-file:' + id; }
  function cleCache(id) { return 'apoint-cc-cache:' + id; }
  function lire(k, defaut) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v === null ? defaut : v; } catch (e) { return defaut; } }
  function ecrire(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

  function file(commercantId) { return lire(cleFile(commercantId), []); }

  function mettreEnFile(commercantId, ligne) {
    var f = file(commercantId).filter(function (l) { return l.id !== ligne.id; });
    f.push(ligne);
    ecrire(cleFile(commercantId), f);
    // Cache local aussi, pour réafficher sans réseau.
    var cache = lire(cleCache(commercantId), []).filter(function (l) { return l.id !== ligne.id; });
    cache.push(ligne);
    ecrire(cleCache(commercantId), cache);
  }

  function estTableAbsente(err) {
    if (!err) return false;
    var m = String(err.message || '') + ' ' + String(err.code || '');
    return /42P01|PGRST205|PGRST202|does not exist|schema cache/i.test(m);
  }

  // Envoie la file dans l'ordre. Rend { envoyees, restantes, absente }.
  function envoyer(sb, commercantId) {
    var f = file(commercantId);
    if (!f.length) return Promise.resolve({ envoyees: 0, restantes: 0, absente: false });
    var envoyees = 0, absente = false;
    var chaine = Promise.resolve();
    f.forEach(function (ligne) {
      chaine = chaine.then(function () {
        if (absente) return;
        return sb.from(TABLE).upsert(ligne).then(function (r) {
          if (r && r.error) { if (estTableAbsente(r.error)) absente = true; return; }
          envoyees++;
          ecrire(cleFile(commercantId), file(commercantId).filter(function (l) { return !(l.id === ligne.id && l.maj_le === ligne.maj_le); }));
        }, function () {});
      });
    });
    return chaine.then(function () { return { envoyees: envoyees, restantes: file(commercantId).length, absente: absente }; });
  }

  // Base + file locale (la version en attente l'emporte : c'est la plus récente).
  function fusionner(base, enAttente) {
    var parId = {};
    (base || []).forEach(function (c) { parId[c.id] = c; });
    (enAttente || []).forEach(function (c) { parId[c.id] = Object.assign({}, c, { _enAttente: true }); });
    return Object.keys(parId).map(function (k) { return parId[k]; });
  }

  // Charge les commandes : { etat: 'ok' | 'hors-ligne' | 'absente', commandes }.
  // Envoie d'abord ce qui attend. Ne rejette jamais.
  function charger(sb, commercantId) {
    return envoyer(sb, commercantId).then(function (env) {
      if (env.absente) return { etat: 'absente', commandes: [] };
      return sb.from(TABLE).select('*').eq('commercant_id', commercantId).then(function (r) {
        if (r && r.error) {
          if (estTableAbsente(r.error)) return { etat: 'absente', commandes: [] };
          throw r.error;
        }
        ecrire(cleCache(commercantId), r.data || []);
        return { etat: 'ok', commandes: fusionner(r.data, file(commercantId)) };
      });
    }).catch(function () {
      return { etat: 'hors-ligne', commandes: fusionner(lire(cleCache(commercantId), []), file(commercantId)) };
    });
  }

  // Pour contexte.js : seulement les commandes (tableau), jamais d'erreur.
  // Apprenti : pas d'accès à la table (noms, téléphones, euros) ; la base lui
  // donne la production seule (commandes_production).
  function chargerPourApprentissage(sb, commercantId, role) {
    if (role === 'apprenti') {
      return Promise.resolve(sb.rpc('commandes_production', { p_commercant: commercantId })).then(function (r) { return (r && !r.error && r.data) || []; }, function () { return []; });
    }
    return charger(sb, commercantId).then(function (r) { var l = r.commandes; l.etat = r.etat; return l; }, function () { return []; });
  }

  // Patron : son propre id. Vendeuse (espace employé) : le commerçant de sa
  // fiche personnel. Rend { commercantId, role }.
  // role : 'patron', 'associe' (conjoint), 'vendeuse', 'apprenti' ou 'aucun'
  // (employé sans rôle). Les droits réels sont vérifiés en base (RLS).
  function resoudreCommercant(sb, session) {
    var uid = session.user.id;
    function lire(colonnes) { return Promise.resolve(sb.from('personnel').select(colonnes).eq('user_id', uid)); }
    return lire('commercant_id, acces_app').then(function (r) {
      return r && r.error ? lire('commercant_id') : r;
    }).then(function (r) {
      var l = r && !r.error && r.data && r.data[0];
      if (!l || !l.commercant_id || l.commercant_id === uid) return { commercantId: uid, role: 'patron' };
      return { commercantId: l.commercant_id, role: l.acces_app || 'aucun' };
    }, function () { return { commercantId: uid, role: 'patron' }; });
  }

  // Champs de la saisie au comptoir (le chronométrage des tests s'appuie dessus).
  var CHAMPS_SAISIE = ['nom', 'telephone', 'produit', 'quantite', 'jour', 'heure', 'acompte'];

  window.CommandesClients = {
    TABLE: TABLE,
    REGLE_ACOMPTE: REGLE_ACOMPTE,
    definirZone: definirZone,
    estRecurrente: estRecurrente,
    libelleVariante: libelleVariante,
    productionDuJour: productionDuJour,
    rechercher: rechercher,
    acompteConseille: acompteConseille,
    prixCommande: prixCommande,
    horsPeriode: horsPeriode,
    jourDeRush: jourDeRush,
    rappelAnnuel: rappelAnnuel,
    CHAMPS_SAISIE: CHAMPS_SAISIE,
    cle: cle,
    versISO: versISO,
    ajouterJours: ajouterJours,
    nouvelId: nouvelId,
    aLieuLe: aLieuLe,
    duJour: duJour,
    nbDuJour: nbDuJour,
    reserveesParCle: reserveesParCle,
    retirerDesVentes: retirerDesVentes,
    acomptesManquants: acomptesManquants,
    changementsProches: changementsProches,
    texteSMS: texteSMS,
    smsDeLaVeille: smsDeLaVeille,
    euros: euros,
    heureCourte: heureCourte,
    file: file,
    mettreEnFile: mettreEnFile,
    envoyer: envoyer,
    fusionner: fusionner,
    charger: charger,
    chargerPourApprentissage: chargerPourApprentissage,
    resoudreCommercant: resoudreCommercant,
    estTableAbsente: estTableAbsente
  };
})();
