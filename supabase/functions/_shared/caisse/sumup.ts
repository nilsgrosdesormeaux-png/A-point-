// Connecteur SumUp (docs/connecteurs-caisse.md).
// Doc : https://developer.sumup.com/tools/authorization/oauth
//       https://developer.sumup.com/api/transactions/list/
//       https://developer.sumup.com/api/transactions/get/
//
// `fetchFn` est injecté pour pouvoir tester sans compte marchand réel.

import { type LigneVente, jourParis } from './commun.ts';

var API = 'https://api.sumup.com';
// transactions.history : historique et détail des transactions (accordé par
// défaut, sans validation SumUp). user.profile_readonly : retrouver le
// merchant_code du compte connecté.
var SCOPES = 'transactions.history user.profile_readonly';

export type Jetons = { access_token: string; refresh_token: string | null; expire_a: string | null };
type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export function urlAutorisation(clientId: string, redirectUri: string, etat: string): string {
  return API + '/authorize?response_type=code'
    + '&client_id=' + encodeURIComponent(clientId)
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&scope=' + encodeURIComponent(SCOPES)
    + '&state=' + encodeURIComponent(etat);
}

async function demanderJetons(fetchFn: FetchFn, params: Record<string, string>): Promise<Jetons> {
  var rep = await fetchFn(API + '/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  });
  var corps = await rep.json().catch(function () { return {}; });
  if (!rep.ok || !corps.access_token) {
    throw new Error('SumUp a refusé l\'autorisation (' + rep.status + ' ' + (corps.error || '') + ')');
  }
  return {
    access_token: corps.access_token,
    refresh_token: corps.refresh_token || null,
    expire_a: corps.expires_in ? new Date(Date.now() + corps.expires_in * 1000).toISOString() : null
  };
}

export function echangerCode(fetchFn: FetchFn, clientId: string, clientSecret: string, redirectUri: string, code: string): Promise<Jetons> {
  return demanderJetons(fetchFn, {
    grant_type: 'authorization_code', code: code, redirect_uri: redirectUri,
    client_id: clientId, client_secret: clientSecret
  });
}

// SumUp peut renvoyer un nouveau refresh_token : sinon on garde l'ancien.
export async function rafraichir(fetchFn: FetchFn, clientId: string, clientSecret: string, refreshToken: string): Promise<Jetons> {
  var jetons = await demanderJetons(fetchFn, {
    grant_type: 'refresh_token', refresh_token: refreshToken,
    client_id: clientId, client_secret: clientSecret
  });
  if (!jetons.refresh_token) jetons.refresh_token = refreshToken;
  return jetons;
}

async function lireJson(fetchFn: FetchFn, url: string, accessToken: string): Promise<any> {
  for (var essai = 0; essai < 4; essai++) {
    var rep = await fetchFn(url, { headers: { Authorization: 'Bearer ' + accessToken } });
    if (rep.status === 429) {
      await new Promise(function (r) { setTimeout(r, 1000 * (essai + 1)); });
      continue;
    }
    if (rep.status === 401) throw new ErreurAutorisation('SumUp : accès refusé (401)');
    if (!rep.ok) throw new Error('SumUp : erreur ' + rep.status + ' sur ' + url.replace(API, ''));
    return rep.json();
  }
  throw new Error('SumUp : trop de requêtes (429), réessai plus tard');
}

export class ErreurAutorisation extends Error {}

export async function codeMarchand(fetchFn: FetchFn, accessToken: string): Promise<string> {
  var adhesions = await lireJson(fetchFn, API + '/v0.1/memberships?kind=merchant&status=accepted', accessToken);
  var premier = adhesions && adhesions.items && adhesions.items[0];
  if (premier && premier.resource_id) return premier.resource_id;
  var moi = await lireJson(fetchFn, API + '/v0.1/me', accessToken);
  var code = moi && moi.merchant_profile && moi.merchant_profile.merchant_code;
  if (!code) throw new Error('SumUp : impossible de trouver le code commerçant du compte');
  return code;
}

// Ventes par article entre deux instants UTC [debut, fin[. La liste des
// transactions ne contient pas les articles : on lit le détail de chaque
// paiement réussi (`products[]`), quelques-uns à la fois.
export async function lignesVendues(fetchFn: FetchFn, accessToken: string, marchand: string, debutISO: string, finISO: string): Promise<LigneVente[]> {
  var base = API + '/v2.1/merchants/' + encodeURIComponent(marchand) + '/transactions';
  var ids: string[] = [];
  var requete = 'limit=100&order=ascending&statuses[]=SUCCESSFUL&types[]=PAYMENT'
    + '&oldest_time=' + encodeURIComponent(debutISO) + '&newest_time=' + encodeURIComponent(finISO);

  for (var pages = 0; pages < 200 && requete; pages++) {
    var page = await lireJson(fetchFn, base + '/history?' + requete, accessToken);
    (page.items || []).forEach(function (t: any) {
      if (t.status === 'SUCCESSFUL' && (!t.type || t.type === 'PAYMENT')) ids.push(t.id || t.transaction_id);
    });
    var suivant = (page.links || []).filter(function (l: any) { return l.rel === 'next'; })[0];
    requete = suivant ? suivant.href : '';
  }

  var lignes: LigneVente[] = [];
  var PARALLELE = 5;
  for (var i = 0; i < ids.length; i += PARALLELE) {
    var details = await Promise.all(ids.slice(i, i + PARALLELE).map(function (id) {
      return lireJson(fetchFn, base + '?id=' + encodeURIComponent(id), accessToken);
    }));
    details.forEach(function (t: any) {
      var jour = jourParis(t.timestamp);
      (t.products || []).forEach(function (p: any) {
        if (!p.name) return;
        lignes.push({ nom_produit: p.name, quantite: Number(p.quantity) || 0, date_vente: jour });
      });
    });
  }
  return lignes;
}
