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
