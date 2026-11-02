// Connecteur Popina — docs/connecteurs-caisse.md.
// Doc officielle : https://www.pragma-project.dev/docs (« Popina API »).
// Clé API fournie au commerçant par le support Popina (option de l'abonnement),
// en-tête Authorization: Bearer <clé> ; une clé par établissement.
// GET https://api.pragma-project.dev/v1/orders/?since=&until=&index=&size=100
// renvoie les commandes avec items[] (description, quantity, isCanceled, isLoss) ;
// commandes annulées (isCanceled) et de formation (isTraining) ignorées.

import { type LigneVente, heureParis, jourParis } from './commun.ts';
import { type FetchFn, appelJson } from './http.ts';

var API = 'https://api.pragma-project.dev/v1';

function entetes(cle: string) {
  return { Authorization: 'Bearer ' + cle, Accept: 'application/json', 'Content-Type': 'application/json' };
}

export async function identifiantCompte(fetchFn: FetchFn, cle: string): Promise<string> {
  // Lecture d'une page vide : vérifie la clé (401 sinon) sans dépendre d'un autre chemin.
  var page = await appelJson(fetchFn, 'Popina', API + '/orders/?index=0&size=1', { headers: entetes(cle) });
  var premiere = page && page.data && page.data[0];
  return (premiere && premiere.locationId) || 'popina';
}

export async function lignesVendues(fetchFn: FetchFn, cle: string, _compte: string, debutISO: string, finISO: string): Promise<LigneVente[]> {
  var lignes: LigneVente[] = [];
  var fin = new Date(Date.parse(finISO) - 1).toISOString(); // « until » est inclus
  for (var index = 0; index < 500; index++) {
    var url = API + '/orders/?since=' + encodeURIComponent(debutISO) + '&until=' + encodeURIComponent(fin) + '&size=100&index=' + index;
    var page = await appelJson(fetchFn, 'Popina', url, { headers: entetes(cle) });
    (page.data || []).forEach(function (c: any) {
      if (c.isCanceled || c.isTraining || !(c.createdAt || c.closedAt)) return;
      var jour = jourParis(c.createdAt || c.closedAt);
      var heure = heureParis(c.createdAt || c.closedAt);
      (c.items || []).forEach(function (i: any) {
        if (!i.description || i.isCanceled || i.isLoss) return;
        lignes.push({ nom_produit: i.description, quantite: Number(i.quantity) || 0, date_vente: jour, heure: heure });
      });
    });
    var meta = page.meta || {};
    if (!(page.links && page.links.next) || index + 1 >= Number(meta.totalPage || 0)) break;
  }
  return lignes;
}
