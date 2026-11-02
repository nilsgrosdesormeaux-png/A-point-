// Edge Function : connexion d'un commerçant à sa caisse (REFONTE.md § 4 bis).
//
// Appelée depuis caisse.html (connecteur-caisse.js) :
//   POST { action: 'demarrer', fournisseur }            -> { url } de la page d'autorisation
//        (sumup, zettle, square : caisses en OAuth)
//   POST { action: 'synchroniser' }                     -> avance tout de suite les caisses branchées
//   POST { action: 'deconnecter', fournisseur }         -> supprime la connexion et ses jetons
//   POST { action: 'activer_import_email' }             -> { adresse } pour l'export envoyé par e-mail
//   POST { action: 'etat' }                             -> { oauth: { sumup, zettle, square… }, cle: [...], email }
//   POST { action: 'connecter_cle', fournisseur, cle [, compte, utilisateur] }
//        clé personnelle créée par le commerçant : sumup (sup_sk_…), zettle
//        (clé API, flux assertion), square (jeton d'accès personnel),
//        loyverse (jeton d'accès), tactill (sk_live_…), hiboutik (compte + e-mail + clé)
// Et par la caisse elle-même, au retour de l'autorisation :
//   GET ?code=…&state=…  -> échange le code, enregistre la connexion, renvoie vers Paramètres
//
// Le retour SumUp n'a pas de JWT : déployer avec
//   supabase functions deploy connecter-caisse --no-verify-jwt
// Le JWT est vérifié ici, à la main, pour toutes les requêtes POST.
//
// Secrets : <CAISSE>_CLIENT_ID et <CAISSE>_CLIENT_SECRET (SUMUP, ZETTLE, SQUARE),
// CLE_CHIFFREMENT_CAISSE,
// ADRESSE_IMPORT (adresse de réception, ex. abc123@inbound.postmarkapp.com :
// chaque commerçant reçoit abc123+<jeton>@inbound.postmarkapp.com).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { jourParis } from '../_shared/caisse/commun.ts';
import { type Jetons } from '../_shared/caisse/http.ts';
import { FORMES_SURES, FOURNISSEURS, devinerFournisseur, disponibles, identifiantsApp, jetonUtilisable } from '../_shared/caisse/fournisseurs.ts';
import { debutHistorique, enregistrerJetons, journaliser, synchroniserConnexion } from '../_shared/caisse/synchroniser.ts';

var CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

var URL_PAGE_CAISSE = 'https://apointapp.fr/caisse.html';
var ADRESSE_IMPORT = Deno.env.get('ADRESSE_IMPORT') || '';
var DUREE_ETAT_MS = 15 * 60000;

function reponse(corps: unknown, status = 200) {
  return new Response(JSON.stringify(corps), { status: status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

function aleatoire(octets: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(octets)), function (o) { return o.toString(16).padStart(2, '0'); }).join('');
}

var SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
var REDIRECT_URI = SUPABASE_URL + '/functions/v1/connecter-caisse';
var ENV = {
  cleChiffrement: Deno.env.get('CLE_CHIFFREMENT_CAISSE') || '',
  lireEnv: function (cle: string) { return Deno.env.get(cle); }
};

// Vérifie l'accès (lecture du compte), puis enregistre la connexion : un
// nouveau branchement repart pour 12 mois d'historique.
async function enregistrerConnexion(admin: any, commercantId: string, fournisseur: string, jetons: Jetons) {
  var compte = await FOURNISSEURS[fournisseur].identifiantCompte(fetch, await jetonUtilisable(fournisseur, fetch, jetons));
  var res = await admin.from('connexions_caisse').upsert({
    commercant_id: commercantId, fournisseur: fournisseur, statut: 'active',
    compte_caisse: compte, derniere_erreur: null, derniere_synchro: null,
    derniere_date_synchronisee: null, debut_historique: debutHistorique(jourParis(new Date())),
    reessayer_apres: null, verrou_jusqua: null
  });
  if (res.error) throw new Error(res.error.message);
  await enregistrerJetons(admin, commercantId, fournisseur, jetons, ENV.cleChiffrement);
  await journaliser(admin, {
    commercant_id: commercantId, source: 'branchement', fournisseur: fournisseur,
    detail: 'Caisse branchée : import des 12 derniers mois lancé'
  });
}

// Retour de la caisse après « Autoriser » (ou « Refuser »).
async function retourOAuth(admin: any, url: URL) {
  var etat = url.searchParams.get('state') || '';
  var code = url.searchParams.get('code');
  var ligne = await admin.from('etats_oauth_caisse').select('*').eq('etat', etat).maybeSingle();
  if (ligne.data) await admin.from('etats_oauth_caisse').delete().eq('etat', etat);

  var resultat = 'erreur';
  if (code && ligne.data && Date.now() - Date.parse(ligne.data.created_at) < DUREE_ETAT_MS) {
    try {
      var f = FOURNISSEURS[ligne.data.fournisseur];
      var app = identifiantsApp(ligne.data.fournisseur, ENV.lireEnv);
      var jetons = await f.echangerCode!(fetch, app.clientId, app.clientSecret, REDIRECT_URI, code);
      await enregistrerConnexion(admin, ligne.data.commercant_id, ligne.data.fournisseur, jetons);
      resultat = 'connectee';
    } catch (e) {
      console.error('connecter-caisse retour OAuth', e);
    }
  } else if (url.searchParams.get('error')) {
    resultat = 'refusee';
  }
  return new Response(null, { status: 302, headers: { Location: URL_PAGE_CAISSE + '?caisse=' + resultat } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  var admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    if (req.method === 'GET') return await retourOAuth(admin, new URL(req.url));
    if (req.method !== 'POST') return reponse({ error: 'Methode non supportee' }, 405);

    var clientAppelant = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } }
    });
    var utilisateur = await clientAppelant.auth.getUser();
    if (utilisateur.error || !utilisateur.data.user) return reponse({ error: 'Non authentifie' }, 401);
    var commercantId = utilisateur.data.user.id;

    var corps = await req.json().catch(function () { return {}; });

    if (corps.action === 'demarrer') {
      var fo = FOURNISSEURS[corps.fournisseur];
      if (!fo || fo.mode !== 'oauth') return reponse({ error: 'Caisse non prise en charge' }, 400);
      var appO = identifiantsApp(corps.fournisseur, ENV.lireEnv);
      if (!appO.clientId) return reponse({ error: 'Branchement ' + fo.libelle + ' pas encore ouvert' }, 503);
      var etat = aleatoire(24);
      var ins = await admin.from('etats_oauth_caisse').insert({ etat: etat, commercant_id: commercantId, fournisseur: corps.fournisseur });
      if (ins.error) return reponse({ error: ins.error.message }, 400);
      return reponse({ url: fo.urlAutorisation!(appO.clientId, REDIRECT_URI, etat) });
    }

    if (corps.action === 'connecter_cle') {
      // Clé personnelle créée par le commerçant dans SON compte de caisse :
      // aucun compte développeur côté À Point. La clé n'est jamais renvoyée.
      // Caisse absente, ou clé d'une autre caisse que celle choisie : on se
      // fie à la forme de la clé (sup_sk_ = SumUp, sk_live_ = Tactill…).
      var devinee = devinerFournisseur(corps.cle);
      if (corps.fournisseur !== 'hiboutik' && devinee && devinee !== corps.fournisseur
        && (FORMES_SURES.indexOf(devinee) !== -1 || !FOURNISSEURS[corps.fournisseur])) corps.fournisseur = devinee;
      var fc = FOURNISSEURS[corps.fournisseur];
      if (!fc || !fc.cle) return reponse({ error: 'Cette clé ne ressemble à aucune caisse connue. Vérifie que tu as copié toute la clé, sans espace.' }, 400);
      if (!ENV.cleChiffrement) return reponse({ error: 'Branchement pas encore ouvert' }, 503);
      var jeton = '';
      try {
        jeton = fc.cle.lire(corps);
      } catch (e) {
        return reponse({ error: String((e as Error).message || e) }, 400);
      }
      try {
        await enregistrerConnexion(admin, commercantId, corps.fournisseur, { access_token: jeton, refresh_token: null, expire_a: null });
      } catch (e) {
        var msg = String((e as Error).message || e);
        // Contrainte connexions_caisse_fournisseur_check : migration v4 pas encore passée.
        if (/fournisseur_check|violates check constraint/i.test(msg)) {
          return reponse({ error: 'Le branchement ' + fc.libelle + ' ouvre très bientôt. En attendant, importe un fichier ci-dessous.' }, 503);
        }
        return reponse({ error: 'La caisse a refusé cette clé. Vérifie-la et réessaie. (' + msg.slice(0, 200) + ')' }, 400);
      }
      return reponse({ ok: true, fournisseur: corps.fournisseur });
    }

    if (corps.action === 'synchroniser') {
      var cxs = await admin.from('connexions_caisse').select('*').eq('commercant_id', commercantId).neq('fournisseur', 'export_email');
      if (!cxs.data || !cxs.data.length) return reponse({ error: 'Aucune caisse branchée' }, 404);
      var limite = Date.now() + 90000;
      var resultats = await Promise.all(cxs.data.map(function (cx: any) {
        return synchroniserConnexion(admin, cx, ENV, fetch, undefined, limite);
      }));
      return reponse({
        ok: resultats.every(function (r: any) { return r.ok; }),
        lignes: resultats.reduce(function (t: number, r: any) { return t + (r.lignes || 0); }, 0),
        complet: resultats.every(function (r: any) { return r.complet; }),
        erreur: (resultats.filter(function (r: any) { return !r.ok; })[0] as any || {}).erreur
      });
    }

    if (corps.action === 'deconnecter') {
      await admin.from('connexions_caisse').delete().eq('commercant_id', commercantId).eq('fournisseur', corps.fournisseur);
      await journaliser(admin, { commercant_id: commercantId, source: 'branchement', fournisseur: corps.fournisseur, detail: 'Caisse débranchée' });
      return reponse({ ok: true });
    }

    if (corps.action === 'etat') {
      var dispo: Record<string, boolean> = disponibles(ENV.lireEnv);
      dispo.email = !!ADRESSE_IMPORT;
      return reponse(dispo);
    }

    if (corps.action === 'activer_import_email') {
      if (!ADRESSE_IMPORT) return reponse({ error: 'Import par e-mail pas encore configuré' }, 503);
      var existante = await admin.from('connexions_caisse').select('adresse_import').eq('commercant_id', commercantId).eq('fournisseur', 'export_email').maybeSingle();
      if (existante.data) return reponse({ adresse: existante.data.adresse_import });
      var jeton = aleatoire(8);
      var morceaux = ADRESSE_IMPORT.split('@');
      // « +caisse-<jeton> » : le relais Gmail ne touche qu'à ces e-mails, même
      // dans une boîte partagée avec le courrier du fondateur.
      var adresse = morceaux[0] + '+caisse-' + jeton + '@' + morceaux[1];
      var cree = await admin.from('connexions_caisse').insert({ commercant_id: commercantId, fournisseur: 'export_email', jeton_import: jeton, adresse_import: adresse });
      if (cree.error) return reponse({ error: cree.error.message }, 400);
      return reponse({ adresse: adresse });
    }

    return reponse({ error: 'Action inconnue' }, 400);
  } catch (erreur) {
    return reponse({ error: String((erreur as Error).message || erreur) }, 500);
  }
});
