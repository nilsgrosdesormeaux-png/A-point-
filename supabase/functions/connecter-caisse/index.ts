// Edge Function : connexion d'un commerçant à sa caisse (REFONTE.md § 4 bis).
//
// Appelée depuis parametres.html (connecteur-caisse.js) :
//   POST { action: 'demarrer', fournisseur: 'sumup' }  -> { url } de la page d'autorisation SumUp
//   POST { action: 'synchroniser' }                     -> synchro immédiate (jusqu'à hier)
//   POST { action: 'deconnecter', fournisseur }         -> supprime la connexion et ses jetons
//   POST { action: 'activer_import_email' }             -> { adresse } pour l'export envoyé par e-mail
//   POST { action: 'connecter_cle', cle: 'sup_sk_…' }   -> branche un compte SumUp par clé API
//        (tests sans app OAuth, ou pilote qui préfère coller sa clé)
// Et par SumUp lui-même, au retour de l'autorisation :
//   GET ?code=…&state=…  -> échange le code, enregistre la connexion, renvoie vers Paramètres
//
// Le retour SumUp n'a pas de JWT : déployer avec
//   supabase functions deploy connecter-caisse --no-verify-jwt
// Le JWT est vérifié ici, à la main, pour toutes les requêtes POST.
//
// Secrets : SUMUP_CLIENT_ID, SUMUP_CLIENT_SECRET, CLE_CHIFFREMENT_CAISSE.

import { createClient } from 'npm:@supabase/supabase-js@2';
import * as sumup from '../_shared/caisse/sumup.ts';
import { enregistrerJetons, synchroniserConnexion } from '../_shared/caisse/synchroniser.ts';

var CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

var URL_PARAMETRES = 'https://apointapp.fr/parametres.html';
var DOMAINE_IMPORT = 'import.apointapp.fr';
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
  sumupClientId: Deno.env.get('SUMUP_CLIENT_ID') || '',
  sumupClientSecret: Deno.env.get('SUMUP_CLIENT_SECRET') || ''
};

async function enregistrerConnexionSumup(admin: any, commercantId: string, jetons: sumup.Jetons) {
  var compte = await sumup.codeMarchand(fetch, jetons.access_token);
  var res = await admin.from('connexions_caisse').upsert({
    commercant_id: commercantId, fournisseur: 'sumup', statut: 'active',
    compte_caisse: compte, derniere_erreur: null
  });
  if (res.error) throw new Error(res.error.message);
  await enregistrerJetons(admin, commercantId, 'sumup', jetons, ENV.cleChiffrement);
}

// Retour de SumUp après « Autoriser » (ou « Refuser »).
async function retourOAuth(admin: any, url: URL) {
  var etat = url.searchParams.get('state') || '';
  var code = url.searchParams.get('code');
  var ligne = await admin.from('etats_oauth_caisse').select('*').eq('etat', etat).maybeSingle();
  if (ligne.data) await admin.from('etats_oauth_caisse').delete().eq('etat', etat);

  var resultat = 'erreur';
  if (code && ligne.data && Date.now() - Date.parse(ligne.data.created_at) < DUREE_ETAT_MS) {
    try {
      var jetons = await sumup.echangerCode(fetch, ENV.sumupClientId, ENV.sumupClientSecret, REDIRECT_URI, code);
      await enregistrerConnexionSumup(admin, ligne.data.commercant_id, jetons);
      resultat = 'connectee';
    } catch (e) {
      console.error('connecter-caisse retour OAuth', e);
    }
  } else if (url.searchParams.get('error')) {
    resultat = 'refusee';
  }
  return new Response(null, { status: 302, headers: { Location: URL_PARAMETRES + '?caisse=' + resultat + '#blocCaisse' } });
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
      if (corps.fournisseur !== 'sumup') return reponse({ error: 'Caisse non prise en charge' }, 400);
      if (!ENV.sumupClientId) return reponse({ error: 'Connexion SumUp pas encore configurée' }, 503);
      var etat = aleatoire(24);
      var ins = await admin.from('etats_oauth_caisse').insert({ etat: etat, commercant_id: commercantId, fournisseur: 'sumup' });
      if (ins.error) return reponse({ error: ins.error.message }, 400);
      return reponse({ url: sumup.urlAutorisation(ENV.sumupClientId, REDIRECT_URI, etat) });
    }

    if (corps.action === 'connecter_cle') {
      var cle = String(corps.cle || '').trim();
      if (!/^sup_sk_/.test(cle)) return reponse({ error: 'Clé API SumUp attendue (sup_sk_…)' }, 400);
      await enregistrerConnexionSumup(admin, commercantId, { access_token: cle, refresh_token: null, expire_a: null });
      return reponse({ ok: true });
    }

    if (corps.action === 'synchroniser') {
      var cx = await admin.from('connexions_caisse').select('*').eq('commercant_id', commercantId).eq('fournisseur', 'sumup').maybeSingle();
      if (!cx.data) return reponse({ error: 'Aucune caisse connectée' }, 404);
      return reponse(await synchroniserConnexion(admin, cx.data, ENV, fetch));
    }

    if (corps.action === 'deconnecter') {
      await admin.from('connexions_caisse').delete().eq('commercant_id', commercantId).eq('fournisseur', corps.fournisseur);
      return reponse({ ok: true });
    }

    if (corps.action === 'activer_import_email') {
      var existante = await admin.from('connexions_caisse').select('jeton_import').eq('commercant_id', commercantId).eq('fournisseur', 'export_email').maybeSingle();
      var jeton = existante.data ? existante.data.jeton_import : aleatoire(8);
      if (!existante.data) {
        var cree = await admin.from('connexions_caisse').insert({ commercant_id: commercantId, fournisseur: 'export_email', jeton_import: jeton });
        if (cree.error) return reponse({ error: cree.error.message }, 400);
      }
      return reponse({ adresse: 'ventes+' + jeton + '@' + DOMAINE_IMPORT });
    }

    return reponse({ error: 'Action inconnue' }, 400);
  } catch (erreur) {
    return reponse({ error: String((erreur as Error).message || erreur) }, 500);
  }
});
