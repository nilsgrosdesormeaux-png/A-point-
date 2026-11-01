// Connecteur Tactill (nouvelle version « v5 », v5.tactill.com) — docs/connecteurs-caisse.md.
// Doc officielle : https://documentation.api.tactill.com/ (Postman :
// https://documentation.api.tactill.com/postman_collection.json)
// Clé API propre au commerce (sk_live_…), en-tête X-Api-Key, portée
// « sale:read ». Selon la doc (novembre 2026), la création de clé en
// libre-service dans le Backoffice n'existe pas encore : le commerçant la
// demande à hello@tactill.com. Les clés sk_test_… lisent des données de test : refusées.
// POST /pos/v0/sale/request { filter: { created_at: { gte, lt } }, limit, next_token }
// renvoie les ventes avec lines[] (quantity, operation_type SALE/REFUND,
// details.name). Ventes supprimées (state DELETED) ignorées.

import { type LigneVente, jourParis } from './commun.ts';
import { type FetchFn, appelJson } from './http.ts';

var API = 'https://api.tactill.com/pos/v0';

function entetes(cle: string) {
  return { 'X-Api-Key': cle, 'Content-Type': 'application/json', Accept: 'application/json' };
}

export async function identifiantCompte(fetchFn: FetchFn, cle: string): Promise<string> {
  var moi = await appelJson(fetchFn, 'Tactill', API + '/me', { headers: entetes(cle) });
  if (moi && moi.test === true) throw new Error('Tactill : cette clé est une clé de test (sk_test_). Demande une clé « live ».');
  if (moi && Array.isArray(moi.scopes) && moi.scopes.length
    && moi.scopes.indexOf('sale:read') === -1 && moi.scopes.indexOf('sale:write') === -1) {
    throw new Error('Tactill : la clé doit avoir le droit « sale:read »');
  }
  return (moi && moi.company_id) || 'tactill';
}

export async function lignesVendues(fetchFn: FetchFn, cle: string, _compte: string, debutISO: string, finISO: string): Promise<LigneVente[]> {
  var lignes: LigneVente[] = [];
  var suite: string | null = null;
  for (var pages = 0; pages < 200; pages++) {
    var corps: any = { filter: { created_at: { gte: debutISO, lt: finISO } }, limit: 100 };
    if (suite) corps.next_token = suite;
    var page = await appelJson(fetchFn, 'Tactill', API + '/sale/request', {
      method: 'POST', headers: entetes(cle), body: JSON.stringify(corps)
    });
    (page.items || []).forEach(function (v: any) {
      if (v.state === 'DELETED' || v.deprecated === true) return;
      var jour = jourParis(v.created_at);
      (v.lines || []).forEach(function (l: any) {
        var nom = l.details && l.details.name;
        if (!nom) return;
        var q = Math.abs(Number(l.quantity) || 0);
        lignes.push({ nom_produit: nom, quantite: l.operation_type === 'REFUND' ? -q : q, date_vente: jour });
      });
    });
    if (!page.next_token) break;
    suite = page.next_token;
  }
  return lignes;
}
