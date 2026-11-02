// Connecteur Zelty — docs/connecteurs-caisse.md.
// API REST https://api.zelty.fr/<version>/, en-tête Authorization: Bearer <clé>.
// La clé est remise au commerçant par l'équipe technique Zelty (page
// officielle « Integrating with Zelty » : https://zelty.notion.site/Integrating-with-Zelty-25c9c28d925180cb8851cfce5e17a8f7)
// ou générée en activant une application dans la Marketplace Zelty.
// La documentation d'API est réservée : chemins et champs relevés dans des
// intégrations publiques de restaurateurs (GitHub) et des notes de référence
// (GET /orders?from=&to=&expand[]=items, limit 200, offset ; GET /info).
// À CONFIRMER avec le premier boulanger Zelty.

import { type LigneVente, jourEtHeure } from './commun.ts';
import { type FetchFn, appelJson } from './http.ts';

var API = 'https://api.zelty.fr/2.10';

function entetes(cle: string) {
  return { Authorization: 'Bearer ' + cle, Accept: 'application/json' };
}

// Une clé Zelty est du base64 de « <identifiant>:<secret> ».
export function ressembleCleZelty(cle: string): boolean {
  var k = String(cle || '').trim();
  if (!/^[A-Za-z0-9+/]{16,}={0,2}$/.test(k)) return false;
  try { return /^\d+:/.test(atob(k)); } catch (_e) { return false; }
}

export async function identifiantCompte(fetchFn: FetchFn, cle: string): Promise<string> {
  var info = await appelJson(fetchFn, 'Zelty', API + '/info', { headers: entetes(cle) });
  return String((info && (info.restaurant_id || info.brand_id)) || 'zelty');
}

// Zelty filtre par date de journée (from / to inclus) : on interroge le jour demandé.
export async function lignesVenduesDuJour(fetchFn: FetchFn, cle: string, _compte: string, jour: string): Promise<LigneVente[]> {
  var lignes: LigneVente[] = [];
  for (var offset = 0, pages = 0; pages < 100; pages++) {
    var url = API + '/orders?from=' + jour + '&to=' + jour + '&expand[]=items&limit=200&offset=' + offset;
    var page = await appelJson(fetchFn, 'Zelty', url, { headers: entetes(cle) });
    var commandes = (page && page.orders) || [];
    commandes.forEach(function (c: any) {
      if (c.status === 'cancelled' || c.status === 'canceled') return;
      var moment = jourEtHeure(c.closed_at || c.created_at);
      var heure = moment && moment.jour === jour ? moment.heure : undefined;
      (c.items || []).forEach(function (i: any) {
        var nom = i.name || '';
        if (!nom) return;
        var q = i.quantity === undefined || i.quantity === null ? 1 : Number(i.quantity);
        lignes.push({ nom_produit: nom, quantite: isFinite(q) ? q : 0, date_vente: jour, heure: heure });
      });
    });
    if (commandes.length < 200) break;
    offset += commandes.length;
  }
  return lignes;
}
