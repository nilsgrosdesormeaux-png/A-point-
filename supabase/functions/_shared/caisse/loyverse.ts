// Connecteur Loyverse — docs/connecteurs-caisse.md.
// Doc officielle : https://developer.loyverse.com/docs/ (API-Reference__v1.0.yaml)
// Le commerçant crée un « jeton d'accès personnel » dans son Back Office
// (Paramètres > Jetons d'accès, r.loyverse.com/dashboard/#/integrations/tokens)
// et le colle dans À Point : en-tête Authorization: Bearer <jeton>.
// GET /v1.0/receipts?created_at_min=&created_at_max=&limit=250&cursor=…
// renvoie les tickets avec line_items (item_name, variant_name, quantity).
// Tickets annulés (cancelled_at) ignorés ; remboursements (receipt_type
// REFUND) déduits. Limite : 300 requêtes / 300 s par compte (429 réessayé).

import { type LigneVente, heureParis, jourParis } from './commun.ts';
import { type FetchFn, appelJson } from './http.ts';

var API = 'https://api.loyverse.com/v1.0';

function entetes(jeton: string) {
  return { Authorization: 'Bearer ' + jeton, Accept: 'application/json' };
}

export async function identifiantCompte(fetchFn: FetchFn, jeton: string): Promise<string> {
  var m = await appelJson(fetchFn, 'Loyverse', API + '/merchant/', { headers: entetes(jeton) });
  return (m && (m.id || m.business_name)) || 'loyverse';
}

export async function lignesVendues(fetchFn: FetchFn, jeton: string, _compte: string, debutISO: string, finISO: string): Promise<LigneVente[]> {
  var lignes: LigneVente[] = [];
  var curseur = '';
  // created_at_max est inclusif : on s'arrête une milliseconde avant le jour suivant.
  var fin = new Date(Date.parse(finISO) - 1).toISOString();
  for (var pages = 0; pages < 200; pages++) {
    var url = API + '/receipts?limit=250&created_at_min=' + encodeURIComponent(debutISO)
      + '&created_at_max=' + encodeURIComponent(fin) + (curseur ? '&cursor=' + encodeURIComponent(curseur) : '');
    var page = await appelJson(fetchFn, 'Loyverse', url, { headers: entetes(jeton) });
    (page.receipts || []).forEach(function (r: any) {
      if (r.cancelled_at) return;
      // Même instant que le filtre (created_at) : un ticket n'est jamais rangé hors de sa fenêtre.
      var jour = jourParis(r.created_at || r.receipt_date);
      var heure = heureParis(r.created_at || r.receipt_date);
      var signe = r.receipt_type === 'REFUND' ? -1 : 1;
      (r.line_items || []).forEach(function (l: any) {
        var nom = l.variant_name && l.item_name ? l.item_name + ' ' + l.variant_name : (l.item_name || '');
        if (!nom) return;
        lignes.push({ nom_produit: nom, quantite: signe * Math.abs(Number(l.quantity) || 0), date_vente: jour, heure: heure });
      });
    });
    if (!page.cursor) break;
    curseur = page.cursor;
  }
  return lignes;
}
