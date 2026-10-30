// Connecteur Hiboutik — docs/connecteurs-caisse.md.
// Doc officielle (Swagger) : https://test.hiboutik.com/api/
// Le commerçant active l'API dans Hiboutik et colle dans À Point le nom de
// son compte, son e-mail Hiboutik et sa clé API (authentification basic).
// GET /products_sold/{store_id}/{année}/{mois}/{jour} donne directement les
// quantités vendues par article pour un jour (250 lignes par page).
// Limite connue : Hiboutik ne donne rien d'antérieur au début de l'abonnement.

import { type LigneVente } from './commun.ts';
import { type FetchFn, appelJson } from './http.ts';

export type IdentifiantsHiboutik = { compte: string; utilisateur: string; cle: string };

// Le « jeton » stocké (chiffré) est le JSON des identifiants.
export function lireIdentifiants(jeton: string): IdentifiantsHiboutik {
  var id = JSON.parse(jeton);
  if (!/^[a-z0-9-]+$/i.test(id.compte || '')) throw new Error('Hiboutik : nom de compte invalide');
  return id;
}

function base(id: IdentifiantsHiboutik) {
  return 'https://' + id.compte.toLowerCase() + '.hiboutik.com/api';
}

function entetes(id: IdentifiantsHiboutik) {
  return { Authorization: 'Basic ' + btoa(id.utilisateur + ':' + id.cle), Accept: 'application/json' };
}

// Identifiant de compte = magasins, séparés par des virgules.
export async function identifiantCompte(fetchFn: FetchFn, jeton: string): Promise<string> {
  var id = lireIdentifiants(jeton);
  var magasins = await appelJson(fetchFn, 'Hiboutik', base(id) + '/stores', { headers: entetes(id) });
  var ids = (Array.isArray(magasins) ? magasins : []).map(function (m: any) { return m.store_id; }).filter(Boolean);
  if (!ids.length) throw new Error('Hiboutik : aucun magasin trouvé sur ce compte');
  return ids.join(',');
}

// Hiboutik travaille par jour calendaire du magasin : on interroge le jour
// de Paris demandé, sans passer par des instants UTC.
export async function lignesVenduesDuJour(fetchFn: FetchFn, jeton: string, compte: string, jour: string): Promise<LigneVente[]> {
  var id = lireIdentifiants(jeton);
  var morceaux = jour.split('-');
  var lignes: LigneVente[] = [];
  var magasins = compte.split(',').filter(Boolean);
  for (var m = 0; m < magasins.length; m++) {
    for (var p = 1; p <= 40; p++) {
      var url = base(id) + '/products_sold/' + encodeURIComponent(magasins[m]) + '/'
        + Number(morceaux[0]) + '/' + Number(morceaux[1]) + '/' + Number(morceaux[2]) + '?p=' + p;
      var page = await appelJson(fetchFn, 'Hiboutik', url, { headers: entetes(id) });
      var elements = Array.isArray(page) ? page : [];
      elements.forEach(function (e: any) {
        var nom = e.product_model || e.product_name || e.name || '';
        if (!nom) return;
        lignes.push({ nom_produit: nom, quantite: Number(String(e.quantity).replace(',', '.')) || 0, date_vente: jour });
      });
      if (elements.length < 250) break;
    }
  }
  return lignes;
}
