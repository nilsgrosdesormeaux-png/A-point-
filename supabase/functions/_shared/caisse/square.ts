// Connecteur Square — docs/connecteurs-caisse.md.
// Doc : https://developer.squareup.com/docs/oauth-api/overview
//       https://developer.squareup.com/reference/square/orders-api/search-orders
// Commandes terminées (COMPLETED) filtrées par date de clôture, avec leurs
// lignes d'articles, jusqu'à 1 000 par page, 10 établissements par requête.

import { type LigneVente, jourParis } from './commun.ts';
import { type FetchFn, type Jetons, appelJson, demanderJetons } from './http.ts';

var API = 'https://connect.squareup.com';
var VERSION = '2025-01-23';
var SCOPES = 'ORDERS_READ MERCHANT_PROFILE_READ';

function entetes(accessToken: string) {
  return { Authorization: 'Bearer ' + accessToken, 'Square-Version': VERSION, 'Content-Type': 'application/json' };
}

export function urlAutorisation(clientId: string, redirectUri: string, etat: string): string {
  return API + '/oauth2/authorize?client_id=' + encodeURIComponent(clientId)
    + '&scope=' + encodeURIComponent(SCOPES)
    + '&session=false'
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&state=' + encodeURIComponent(etat);
}

export function echangerCode(fetchFn: FetchFn, clientId: string, clientSecret: string, redirectUri: string, code: string): Promise<Jetons> {
  return demanderJetons(fetchFn, 'Square', API + '/oauth2/token', {
    grant_type: 'authorization_code', code: code, redirect_uri: redirectUri,
    client_id: clientId, client_secret: clientSecret
  }, true);
}

// Le refresh token Square ne change pas : on garde l'ancien s'il n'est pas renvoyé.
export async function rafraichir(fetchFn: FetchFn, clientId: string, clientSecret: string, refreshToken: string): Promise<Jetons> {
  var jetons = await demanderJetons(fetchFn, 'Square', API + '/oauth2/token', {
    grant_type: 'refresh_token', refresh_token: refreshToken,
    client_id: clientId, client_secret: clientSecret
  }, true);
  if (!jetons.refresh_token) jetons.refresh_token = refreshToken;
  return jetons;
}

// Identifiant de compte = établissements actifs, séparés par des virgules.
export async function identifiantCompte(fetchFn: FetchFn, accessToken: string): Promise<string> {
  var res = await appelJson(fetchFn, 'Square', API + '/v2/locations', { headers: entetes(accessToken) });
  var ids = (res.locations || []).filter(function (l: any) { return l.status !== 'INACTIVE'; }).map(function (l: any) { return l.id; });
  if (!ids.length) throw new Error('Square : aucun établissement actif sur ce compte');
  return ids.join(',');
}

export async function lignesVendues(fetchFn: FetchFn, accessToken: string, compte: string, debutISO: string, finISO: string): Promise<LigneVente[]> {
  var lignes: LigneVente[] = [];
  var etablissements = compte.split(',').filter(Boolean);
  for (var i = 0; i < etablissements.length; i += 10) {
    var curseur = '';
    for (var pages = 0; pages < 100; pages++) {
      var corps: any = {
        location_ids: etablissements.slice(i, i + 10),
        limit: 1000,
        query: {
          filter: {
            date_time_filter: { closed_at: { start_at: debutISO, end_at: finISO } },
            state_filter: { states: ['COMPLETED'] }
          },
          sort: { sort_field: 'CLOSED_AT', sort_order: 'ASC' }
        }
      };
      if (curseur) corps.cursor = curseur;
      var page = await appelJson(fetchFn, 'Square', API + '/v2/orders/search', {
        method: 'POST', headers: entetes(accessToken), body: JSON.stringify(corps)
      });
      (page.orders || []).forEach(function (commande: any) {
        var jour = jourParis(commande.closed_at || commande.created_at);
        (commande.line_items || []).forEach(function (l: any) {
          var nom = l.variation_name && l.name && l.variation_name !== 'Regular' ? l.name + ' ' + l.variation_name : (l.name || '');
          if (!nom) return;
          lignes.push({ nom_produit: nom, quantite: Number(l.quantity) || 0, date_vente: jour });
        });
      });
      if (!page.cursor) break;
      curseur = page.cursor;
    }
  }
  return lignes;
}
