// Synchro d'une connexion caisse vers `ventes`, partagée entre la synchro
// nocturne (synchro-caisse) et le bouton « Synchroniser maintenant »
// (connecter-caisse).
//
// Fenêtre : du lendemain du dernier jour importé (ou 14 jours en arrière à
// la première synchro) jusqu'à hier inclus. Le jour en cours n'est jamais
// importé : ses ventes sont incomplètes.

import { agregerLignes, ajouterJours, debutJourParisUTC, jourParis } from './commun.ts';
import { chiffrer, dechiffrer } from './chiffrement.ts';
import * as sumup from './sumup.ts';

export var JOURS_HISTORIQUE_INITIAL = 14;

type Env = { cleChiffrement: string; sumupClientId: string; sumupClientSecret: string };
type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export async function enregistrerJetons(admin: any, commercantId: string, fournisseur: string, jetons: sumup.Jetons, cleChiffrement: string) {
  var res = await admin.from('connexions_caisse_secrets').upsert({
    commercant_id: commercantId,
    fournisseur: fournisseur,
    access_token: await chiffrer(jetons.access_token, cleChiffrement),
    refresh_token: jetons.refresh_token ? await chiffrer(jetons.refresh_token, cleChiffrement) : null,
    expire_a: jetons.expire_a
  });
  if (res.error) throw new Error(res.error.message);
}

async function lireJetons(admin: any, connexion: any, env: Env): Promise<sumup.Jetons> {
  var res = await admin.from('connexions_caisse_secrets').select('*')
    .eq('commercant_id', connexion.commercant_id).eq('fournisseur', connexion.fournisseur).single();
  if (res.error || !res.data) throw new Error('Jetons caisse introuvables : reconnecte ta caisse');
  return {
    access_token: await dechiffrer(res.data.access_token, env.cleChiffrement),
    refresh_token: res.data.refresh_token ? await dechiffrer(res.data.refresh_token, env.cleChiffrement) : null,
    expire_a: res.data.expire_a
  };
}

async function jetonValide(admin: any, connexion: any, env: Env, fetchFn: FetchFn, forcer: boolean): Promise<string> {
  var jetons = await lireJetons(admin, connexion, env);
  var bientotExpire = jetons.expire_a && Date.parse(jetons.expire_a) < Date.now() + 5 * 60000;
  if (jetons.refresh_token && (forcer || bientotExpire)) {
    jetons = await sumup.rafraichir(fetchFn, env.sumupClientId, env.sumupClientSecret, jetons.refresh_token);
    await enregistrerJetons(admin, connexion.commercant_id, connexion.fournisseur, jetons, env.cleChiffrement);
  }
  return jetons.access_token;
}

// Jour par jour : chaque jour importé est acquis (derniere_date_synchronisee
// avance), même si l'Edge Function est coupée ensuite. Passé `limite`
// (horodatage ms), on s'arrête proprement ; le passage suivant reprend au
// jour manquant. derniere_synchro n'est posée qu'une fois à jour, pour que
// la synchro nocturne reprenne cette connexion tant qu'il reste des jours.
export async function synchroniserConnexion(admin: any, connexion: any, env: Env, fetchFn: FetchFn, maintenant?: Date, limite?: number) {
  var aujourdhui = jourParis(maintenant || new Date());
  var hier = ajouterJours(aujourdhui, -1);
  var debut = connexion.derniere_date_synchronisee
    ? ajouterJours(connexion.derniere_date_synchronisee, 1)
    : ajouterJours(aujourdhui, -JOURS_HISTORIQUE_INITIAL);
  var finBudget = limite || Date.now() + 100000;
  var cible = connexion.fournisseur;

  function majConnexion(valeurs: Record<string, unknown>) {
    return admin.from('connexions_caisse').update(valeurs)
      .eq('commercant_id', connexion.commercant_id).eq('fournisseur', cible);
  }

  try {
    var nbLignes = 0;
    var jour = debut;
    var token = '';
    if (debut <= hier) {
      if (cible !== 'sumup') throw new Error('Fournisseur non pris en charge : ' + cible);
      token = await jetonValide(admin, connexion, env, fetchFn, false);
    }
    for (; jour <= hier && Date.now() < finBudget; jour = ajouterJours(jour, 1)) {
      var debutISO = debutJourParisUTC(jour);
      var finISO = debutJourParisUTC(ajouterJours(jour, 1));
      var brutes;
      try {
        brutes = await sumup.lignesVendues(fetchFn, token, connexion.compte_caisse, debutISO, finISO);
      } catch (e) {
        if (!(e instanceof sumup.ErreurAutorisation)) throw e;
        token = await jetonValide(admin, connexion, env, fetchFn, true);
        brutes = await sumup.lignesVendues(fetchFn, token, connexion.compte_caisse, debutISO, finISO);
      }
      var lignes = agregerLignes(brutes);
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
    var valeurs: Record<string, unknown> = { statut: 'active', nb_lignes_derniere_synchro: nbLignes, derniere_erreur: null };
    if (aJour) valeurs.derniere_synchro = new Date().toISOString();
    await majConnexion(valeurs);
    return { ok: true, lignes: nbLignes, du: debut, au: ajouterJours(jour, -1), complet: aJour };
  } catch (erreur) {
    // derniere_synchro n'est pas avancée : le passage suivant de la nuit
    // réessaiera (panne passagère de l'API caisse).
    await admin.from('connexions_caisse').update({
      statut: 'erreur', derniere_erreur: String((erreur as Error).message || erreur).slice(0, 500)
    }).eq('commercant_id', connexion.commercant_id).eq('fournisseur', connexion.fournisseur);
    return { ok: false, erreur: String((erreur as Error).message || erreur) };
  }
}
