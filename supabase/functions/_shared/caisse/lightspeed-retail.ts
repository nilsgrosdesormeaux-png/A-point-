// Connecteur Lightspeed Retail (X-Series) — docs/connecteurs-caisse.md.
// Doc officielle : https://x-series-api.lightspeedhq.com/docs/authorization#personal-tokens
// Jeton personnel créé par un administrateur de la boutique (Configuration >
// Jetons personnels ; réservé à la formule Plus), en-tête Authorization:
// Bearer <jeton>. Adresse de la boutique : https://<préfixe>.retail.lightspeed.app,
// API datée https://<préfixe>.retail.lightspeed.app/api/2026-10.
// GET /search?type=sales&state=closed&date_from=&date_to=&page_size=&offset=
// (dates en UTC, 1000 ventes par page au plus) renvoie les ventes avec
// line_items[] (product.name, quantity, négative pour un retour).

import { type LigneVente, heureParis, jourParis } from './commun.ts';
import { type FetchFn, appelJson } from './http.ts';

var VERSION = '2026-10';
var PAGE = 1000;

export type IdentifiantsLightspeed = { prefixe: string; jeton: string };

// Le « jeton » stocké (chiffré) est le JSON { prefixe, jeton }.
export function lireIdentifiants(stocke: string): IdentifiantsLightspeed {
  var id = JSON.parse(stocke);
  if (!/^[a-z0-9-]+$/.test(id.prefixe || '')) throw new Error('Lightspeed : adresse de boutique invalide');
  return id;
}

// « maboutique », « maboutique.retail.lightspeed.app » ou l'adresse complète.
export function prefixeDepuisAdresse(adresse: string): string {
  return String(adresse || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    .replace(/\.retail\.lightspeed\.app$/, '').replace(/\.vendhq\.com$/, '');
}

function base(id: IdentifiantsLightspeed) {
  return 'https://' + id.prefixe + '.retail.lightspeed.app/api/' + VERSION;
}

function entetes(id: IdentifiantsLightspeed) {
  return { Authorization: 'Bearer ' + id.jeton, Accept: 'application/json' };
}

// Vérifie le jeton par une recherche d'une seule vente.
export async function identifiantCompte(fetchFn: FetchFn, stocke: string): Promise<string> {
  var id = lireIdentifiants(stocke);
  await appelJson(fetchFn, 'Lightspeed', base(id) + '/search?type=sales&page_size=1', { headers: entetes(id) });
  return id.prefixe;
}

export async function lignesVendues(fetchFn: FetchFn, stocke: string, _compte: string, debutISO: string, finISO: string): Promise<LigneVente[]> {
  var id = lireIdentifiants(stocke);
  var lignes: LigneVente[] = [];
  // date_to : borne haute, on s'arrête une seconde avant le jour suivant.
  var fin = new Date(Date.parse(finISO) - 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  var debut = new Date(debutISO).toISOString().replace(/\.\d{3}Z$/, 'Z');
  for (var offset = 0, pages = 0; pages < 50; pages++, offset += PAGE) {
    var url = base(id) + '/search?type=sales&state=closed&date_from=' + encodeURIComponent(debut)
      + '&date_to=' + encodeURIComponent(fin) + '&page_size=' + PAGE + '&offset=' + offset;
    var page = await appelJson(fetchFn, 'Lightspeed', url, { headers: entetes(id) });
    var ventes = (page && page.data) || [];
    ventes.forEach(function (v: any) {
      if (v.state && v.state !== 'closed') return;
      if (v.deleted_at) return;
      var instant = v.date || v.created_at;
      if (!instant) return;
      var jour = jourParis(instant);
      var heure = heureParis(instant);
      (v.line_items || []).forEach(function (l: any) {
        var nom = l.product && l.product.name;
        if (!nom) return;
        lignes.push({ nom_produit: nom, quantite: Number(l.quantity) || 0, date_vente: jour, heure: heure });
      });
    });
    if (ventes.length < PAGE) break;
  }
  return lignes;
}
