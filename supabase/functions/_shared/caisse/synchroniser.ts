// Synchro d'une connexion caisse vers `ventes`, partagée entre la synchro
// en continu (synchro-caisse) et le bouton « Synchroniser maintenant »
// (connecter-caisse), pour toutes les caisses du registre.
//
// Fenêtre : du lendemain du dernier jour importé (ou 12 mois en arrière au
// branchement) jusqu'à hier inclus. Le jour en cours n'est jamais importé :
// ses ventes sont incomplètes.

import { type LigneVente, agregerHoraires, agregerLignes, ajouterJours, debutJourParisUTC, heureParis, jourParis } from './commun.ts';
import { chiffrer, dechiffrer } from './chiffrement.ts';
import { type FetchFn, type Jetons, ErreurAutorisation } from './http.ts';
import { FOURNISSEURS, identifiantsApp, jetonUtilisable } from './fournisseurs.ts';

// Une ligne par réception dans journal_caisse (page « Ma caisse »). Le
// journal ne doit jamais faire échouer une synchro : erreurs ignorées.
export async function journaliser(admin: any, entree: Record<string, unknown>) {
  try { await admin.from('journal_caisse').insert(entree); } catch (_e) { /* journal facultatif */ }
}

// 12 mois d'historique au branchement : des prévisions fiables (saisons,
// jours fériés, vacances) dès le lendemain.
export var JOURS_HISTORIQUE_INITIAL = 365;
// Ventes heure par heure (alerte rupture) : 4 mois d'historique suffisent.
export var JOURS_HISTORIQUE_HORAIRE = 120;
// Synchro dans la journée : de 6 h à 20 h, heure de Paris.
export var HEURE_DEBUT_JOURNEE = 6;
export var HEURE_FIN_JOURNEE = 20;

// Remplace les heures >= heureMin du jour. Jamais bloquant : sans la
// migration v6 (table absente), la synchro des ventes continue.
export async function enregistrerHoraires(admin: any, commercantId: string, jour: string, heureMin: number, lignes: LigneVente[]) {
  var horaires = agregerHoraires(lignes, jour).filter(function (h) { return h.heure >= heureMin; });
  try {
    var res = await admin.rpc('enregistrer_ventes_horaires', { p_commercant: commercantId, p_jour: jour, p_heure_min: heureMin, p_lignes: horaires });
    return res && res.error ? -1 : horaires.length;
  } catch (_e) {
    return -1;
  }
}

export type Env = { cleChiffrement: string; lireEnv: (cle: string) => string | undefined };

export function debutHistorique(aujourdhui: string): string {
  return ajouterJours(aujourdhui, -JOURS_HISTORIQUE_INITIAL);
}

export async function enregistrerJetons(admin: any, commercantId: string, fournisseur: string, jetons: Jetons, cleChiffrement: string) {
  var res = await admin.from('connexions_caisse_secrets').upsert({
    commercant_id: commercantId,
    fournisseur: fournisseur,
    access_token: await chiffrer(jetons.access_token, cleChiffrement),
    refresh_token: jetons.refresh_token ? await chiffrer(jetons.refresh_token, cleChiffrement) : null,
    expire_a: jetons.expire_a
  });
  if (res.error) throw new Error(res.error.message);
}

async function lireJetons(admin: any, connexion: any, env: Env): Promise<Jetons> {
  var res = await admin.from('connexions_caisse_secrets').select('*')
    .eq('commercant_id', connexion.commercant_id).eq('fournisseur', connexion.fournisseur).single();
  if (res.error || !res.data) throw new ErreurAutorisation('Accès à la caisse introuvables : reconnecte ta caisse');
  return {
    access_token: await dechiffrer(res.data.access_token, env.cleChiffrement),
    refresh_token: res.data.refresh_token ? await dechiffrer(res.data.refresh_token, env.cleChiffrement) : null,
    expire_a: res.data.expire_a
  };
}

async function jetonValide(admin: any, connexion: any, env: Env, fetchFn: FetchFn, forcer: boolean): Promise<string> {
  var f = FOURNISSEURS[connexion.fournisseur];
  var jetons = await lireJetons(admin, connexion, env);
  var bientotExpire = jetons.expire_a && Date.parse(jetons.expire_a) < Date.now() + 5 * 60000;
  if (f.rafraichir && jetons.refresh_token && (forcer || bientotExpire)) {
    var app = identifiantsApp(connexion.fournisseur, env.lireEnv);
    jetons = await f.rafraichir(fetchFn, app.clientId, app.clientSecret, jetons.refresh_token);
    await enregistrerJetons(admin, connexion.commercant_id, connexion.fournisseur, jetons, env.cleChiffrement);
  }
  // Clé personnelle Zettle : échangée contre un jeton de 2 h à chaque passage.
  return jetonUtilisable(connexion.fournisseur, fetchFn, jetons);
}

// Jour par jour : chaque jour importé est acquis (derniere_date_synchronisee
// avance), même si l'Edge Function est coupée ensuite. Passé `limite`
// (horodatage ms), on s'arrête proprement ; le passage suivant reprend au
// jour manquant.
export async function synchroniserConnexion(admin: any, connexion: any, env: Env, fetchFn: FetchFn, maintenant?: Date, limite?: number) {
  var aujourdhui = jourParis(maintenant || new Date());
  var hier = ajouterJours(aujourdhui, -1);
  var debut = connexion.derniere_date_synchronisee
    ? ajouterJours(connexion.derniere_date_synchronisee, 1)
    : (connexion.debut_historique || debutHistorique(aujourdhui));
  var finBudget = limite || Date.now() + 100000;
  var cible = connexion.fournisseur;
  var f = FOURNISSEURS[cible];

  function majConnexion(valeurs: Record<string, unknown>) {
    return admin.from('connexions_caisse').update(valeurs)
      .eq('commercant_id', connexion.commercant_id).eq('fournisseur', cible);
  }

  var nbLignes = 0;
  var jour = debut;
  try {
    if (!f) throw new Error('Caisse non prise en charge : ' + cible);
    var jeton = debut <= hier ? await jetonValide(admin, connexion, env, fetchFn, false) : '';
    for (; jour <= hier && Date.now() < finBudget; jour = ajouterJours(jour, 1)) {
      var brutes;
      try {
        brutes = await f.lignesDuJour(fetchFn, jeton, connexion.compte_caisse, jour);
      } catch (e) {
        if (!(e instanceof ErreurAutorisation) || !f.rafraichir) throw e;
        jeton = await jetonValide(admin, connexion, env, fetchFn, true);
        brutes = await f.lignesDuJour(fetchFn, jeton, connexion.compte_caisse, jour);
      }
      var lignes = agregerLignes(brutes);
      if (jour >= ajouterJours(aujourdhui, -JOURS_HISTORIQUE_HORAIRE) && brutes.some(function (l: LigneVente) { return typeof l.heure === 'number'; })) {
        await enregistrerHoraires(admin, connexion.commercant_id, jour, 0, brutes);
      }
      if (lignes.length > 0) {
        var rpc = await admin.rpc('enregistrer_ventes_caisse', {
          p_commercant: connexion.commercant_id, p_lignes: lignes, p_source: cible
        });
        if (rpc.error) throw new Error(rpc.error.message);
        nbLignes += rpc.data;
      }
      await majConnexion({ derniere_date_synchronisee: jour });
    }
    var aJour = jour > hier;
    var valeurs: Record<string, unknown> = {
      statut: 'active', nb_lignes_derniere_synchro: nbLignes, derniere_erreur: null,
      reessayer_apres: null, verrou_jusqua: null
    };
    if (aJour) valeurs.derniere_synchro = new Date().toISOString();
    await majConnexion(valeurs);
    if (jour > debut) {
      await journaliser(admin, {
        commercant_id: connexion.commercant_id, source: 'api', fournisseur: cible,
        nb_ventes: nbLignes, du: debut, au: ajouterJours(jour, -1),
        detail: aJour ? null : 'Historique en cours d\'import'
      });
    }
    return { ok: true, lignes: nbLignes, du: debut, au: ajouterJours(jour, -1), complet: aJour };
  } catch (erreur) {
    // Accès refusé : inutile d'insister avant que le commerçant reconnecte
    // sa caisse. Autre erreur (panne passagère) : nouvel essai dans 30 min.
    var acces = erreur instanceof ErreurAutorisation;
    var message = String((erreur as Error).message || erreur);
    await majConnexion({
      statut: 'erreur',
      derniere_erreur: (acces ? 'Reconnecte ta caisse : ' : '') + message.slice(0, 480),
      reessayer_apres: new Date(Date.now() + (acces ? 6 * 3600000 : 30 * 60000)).toISOString(),
      verrou_jusqua: null
    });
    await journaliser(admin, {
      commercant_id: connexion.commercant_id, source: 'api', fournisseur: cible,
      nb_ventes: nbLignes, du: jour > debut ? debut : null, au: jour > debut ? ajouterJours(jour, -1) : null,
      erreur: ((acces ? 'Reconnecte ta caisse : ' : '') + message).slice(0, 500)
    });
    return { ok: false, erreur: message, lignes: nbLignes };
  }
}

// Synchro dans la journée (toutes les heures de 6 h à 20 h) : seulement les
// ventes du jour, seulement ventes_horaires (la table ventes ne prend
// jamais un jour incomplet). On relit depuis la dernière heure close
// (horaire_jusqua) : peu d'appels, et relancer ne double rien.
export async function synchroniserJournee(admin: any, connexion: any, env: Env, fetchFn: FetchFn, maintenant?: Date) {
  var now = maintenant || new Date();
  var heure = heureParis(now);
  if (heure < HEURE_DEBUT_JOURNEE || heure > HEURE_FIN_JOURNEE) return { ok: true, ignoree: 'hors horaires' };
  var f = FOURNISSEURS[connexion.fournisseur];
  if (!f || (!f.lignesEntre && !f.horairesParJour)) return { ok: true, ignoree: 'pas d\'heure pour cette caisse' };
  var jour = jourParis(now);
  var debutHeure = new Date(Math.floor(now.getTime() / 3600000) * 3600000); // heure de Paris pile (décalages entiers)
  var depuis = connexion.horaire_jusqua && jourParis(connexion.horaire_jusqua) === jour
    ? new Date(Math.floor(Date.parse(connexion.horaire_jusqua) / 3600000) * 3600000)
    : null;
  var heureMin = depuis ? heureParis(depuis) : 0;
  try {
    var jeton = await jetonValide(admin, connexion, env, fetchFn, false);
    var lignes: LigneVente[];
    if (f.lignesEntre) {
      var debutISO = depuis ? depuis.toISOString() : debutJourParisUTC(jour);
      lignes = await f.lignesEntre(fetchFn, jeton, connexion.compte_caisse, debutISO, now.toISOString());
    } else {
      lignes = await f.lignesDuJour(fetchFn, jeton, connexion.compte_caisse, jour);
    }
    var nb = await enregistrerHoraires(admin, connexion.commercant_id, jour, heureMin, lignes);
    if (nb >= 0) {
      await admin.from('connexions_caisse').update({ horaire_jusqua: debutHeure.toISOString() })
        .eq('commercant_id', connexion.commercant_id).eq('fournisseur', connexion.fournisseur);
    }
    return { ok: nb >= 0, lignes: nb, heureMin: heureMin };
  } catch (e) {
    // La synchro de nuit reste la référence : pas de changement de statut ici.
    return { ok: false, erreur: String((e as Error).message || e) };
  }
}
