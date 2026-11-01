// Connecteur Zettle (PayPal) — docs/connecteurs-caisse.md.
// Doc : https://github.com/iZettle/api-documentation/blob/master/authorization.md
//       https://github.com/iZettle/api-documentation/blob/master/purchase.adoc
// Les achats arrivent avec leurs articles dans la liste (un appel par
// tranche de 1 000 tickets), jusqu'à 3 ans d'historique. Les
// remboursements ont une quantité négative et viennent en déduction.

import { type LigneVente, jourParis } from './commun.ts';
import { type FetchFn, type Jetons, appelJson, demanderJetons } from './http.ts';

var OAUTH = 'https://oauth.zettle.com';
var ACHATS = 'https://purchase.izettle.com/purchases/v2';
var SCOPES = 'READ:PURCHASE READ:USERINFO';

export function urlAutorisation(clientId: string, redirectUri: string, etat: string): string {
  return OAUTH + '/authorize?response_type=code'
    + '&client_id=' + encodeURIComponent(clientId)
    + '&scope=' + encodeURIComponent(SCOPES)
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&state=' + encodeURIComponent(etat);
}

export function echangerCode(fetchFn: FetchFn, clientId: string, clientSecret: string, redirectUri: string, code: string): Promise<Jetons> {
  return demanderJetons(fetchFn, 'Zettle', OAUTH + '/token', {
    grant_type: 'authorization_code', code: code, redirect_uri: redirectUri,
    client_id: clientId, client_secret: clientSecret
  });
}

export async function rafraichir(fetchFn: FetchFn, clientId: string, clientSecret: string, refreshToken: string): Promise<Jetons> {
  var jetons = await demanderJetons(fetchFn, 'Zettle', OAUTH + '/token', {
    grant_type: 'refresh_token', refresh_token: refreshToken,
    client_id: clientId, client_secret: clientSecret
  });
  if (!jetons.refresh_token) jetons.refresh_token = refreshToken;
  return jetons;
}

export async function identifiantCompte(fetchFn: FetchFn, accessToken: string): Promise<string> {
  var moi = await appelJson(fetchFn, 'Zettle', OAUTH + '/users/self', { headers: { Authorization: 'Bearer ' + accessToken } });
  return moi.organizationUuid || moi.uuid || 'zettle';
}

export async function lignesVendues(fetchFn: FetchFn, accessToken: string, _compte: string, debutISO: string, finISO: string): Promise<LigneVente[]> {
  var lignes: LigneVente[] = [];
  var suite = '';
  for (var pages = 0; pages < 100; pages++) {
    var url = ACHATS + '?limit=1000&startDate=' + encodeURIComponent(debutISO.slice(0, 16))
      + '&endDate=' + encodeURIComponent(finISO.slice(0, 16))
      + (suite ? '&lastPurchaseHash=' + encodeURIComponent(suite) : '');
    var page = await appelJson(fetchFn, 'Zettle', url, { headers: { Authorization: 'Bearer ' + accessToken } });
    var achats = page.purchases || [];
    achats.forEach(function (achat: any) {
      var jour = jourParis(achat.timestamp);
      (achat.products || []).forEach(function (p: any) {
        var nom = p.variantName && p.name ? p.name + ' ' + p.variantName : (p.name || '');
        if (!nom || p.type === 'GIFTCARD') return;
        lignes.push({ nom_produit: nom, quantite: Number(String(p.quantity).replace(',', '.')) || 0, date_vente: jour });
      });
    });
    if (achats.length < 1000 || !page.lastPurchaseHash) break;
    suite = page.lastPurchaseHash;
  }
  return lignes;
}

// Mode « clé personnelle » (assertion grant) : le commerçant crée une clé
// API dans my.zettle.com/apps/api-keys, sans aucune app développeur de
// notre côté. La clé est un JWT qui contient le client_id à renvoyer ; elle
// ne donne pas de refresh token : on redemande un jeton (2 h) à chaque synchro.
export var LIEN_CREATION_CLE = 'https://my.zettle.com/apps/api-keys?name=' + encodeURIComponent('A Point')
  + '&scopes=' + encodeURIComponent('READ:PURCHASE READ:USERINFO');

function base64UrlVersTexte(morceau: string): string {
  var b64 = morceau.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  var bin = atob(b64);
  var octets = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(octets);
}

export function clientIdDeCle(cle: string): string {
  var morceaux = String(cle || '').trim().split('.');
  if (morceaux.length !== 3) throw new Error('Zettle : clé API attendue (longue suite de caractères en trois parties séparées par des points)');
  var charge: any;
  try { charge = JSON.parse(base64UrlVersTexte(morceaux[1])); } catch (_e) { throw new Error('Zettle : clé API illisible'); }
  var id = charge.client_id || charge.clientId || charge.cid || (typeof charge.aud === 'string' ? charge.aud : '') || charge.sub;
  if (!id) throw new Error('Zettle : identifiant client introuvable dans la clé');
  return String(id);
}

export async function jetonDepuisCle(fetchFn: FetchFn, cle: string): Promise<string> {
  var jetons = await demanderJetons(fetchFn, 'Zettle', OAUTH + '/token', {
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    client_id: clientIdDeCle(cle),
    assertion: String(cle).trim()
  });
  return jetons.access_token;
}
