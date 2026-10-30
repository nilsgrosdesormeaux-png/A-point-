// Lecture d'un export CSV de caisse (repli pour les caisses sans API) :
// séparateur détecté (; , ou tabulation), colonnes produit / quantité / date
// reconnues avec les mêmes alias que import.html, dates françaises
// acceptées. Sans colonne date, toutes les lignes vont au `jourParDefaut`.

import { type LigneVente } from './commun.ts';

var ALIAS_PRODUIT = ['produit', 'plat', 'article', 'nomduproduit', 'nom_produit', 'produitvendu', 'item', 'designation', 'nomarticle', 'libelle'];
var ALIAS_QUANTITE = ['quantite', 'qte', 'nombre', 'nombrevendu', 'quantitevendue', 'qty', 'nbvendu', 'ventes', 'quantitevendu', 'vendu', 'vendus', 'vendue'];
var ALIAS_DATE = ['date', 'jour', 'datevente', 'datedevente', 'dateticket', 'datedujour', 'datetime', 'horodatage'];

function normaliserEntete(texte: string): string {
  return (texte || '').toString().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function detecterColonne(entetes: string[], aliases: string[]): number {
  var norm = entetes.map(normaliserEntete);
  for (var i = 0; i < norm.length; i++) if (aliases.indexOf(norm[i]) !== -1) return i;
  for (var j = 0; j < norm.length; j++) {
    for (var k = 0; k < aliases.length; k++) if (norm[j].indexOf(aliases[k]) !== -1) return j;
  }
  return -1;
}

function detecterSeparateur(premiereLigne: string): string {
  var candidats = [';', '\t', ','];
  var meilleur = ';', max = -1;
  candidats.forEach(function (c) {
    var n = premiereLigne.split(c).length;
    if (n > max) { max = n; meilleur = c; }
  });
  return meilleur;
}

export function lireCsv(texte: string): string[][] {
  texte = texte.replace(/^﻿/, '');
  var sep = detecterSeparateur(texte.split(/\r?\n/)[0] || '');
  var lignes: string[][] = [];
  var ligne: string[] = [];
  var champ = '';
  var entreGuillemets = false;
  for (var i = 0; i < texte.length; i++) {
    var c = texte[i];
    if (entreGuillemets) {
      if (c === '"' && texte[i + 1] === '"') { champ += '"'; i++; }
      else if (c === '"') entreGuillemets = false;
      else champ += c;
    } else if (c === '"') entreGuillemets = true;
    else if (c === sep) { ligne.push(champ); champ = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i++;
      ligne.push(champ); champ = '';
      if (ligne.some(function (v) { return v.trim() !== ''; })) lignes.push(ligne);
      ligne = [];
    } else champ += c;
  }
  ligne.push(champ);
  if (ligne.some(function (v) { return v.trim() !== ''; })) lignes.push(ligne);
  return lignes;
}

// "2026-10-29", "2026-10-29T08:12", "29/10/2026", "29-10-2026 08:12", "29/10/26".
export function lireDate(valeur: string): string | null {
  var v = (valeur || '').trim();
  var iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  var fr = v.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (fr) {
    var annee = fr[3].length === 2 ? '20' + fr[3] : fr[3];
    return annee + '-' + ('0' + fr[2]).slice(-2) + '-' + ('0' + fr[1]).slice(-2);
  }
  return null;
}

export function lignesDepuisExport(texte: string, jourParDefaut: string): { lignes: LigneVente[]; erreur?: string } {
  var tableau = lireCsv(texte);
  if (tableau.length < 2) return { lignes: [], erreur: 'Fichier vide ou sans en-tête' };
  var entetes = tableau[0];
  var colProduit = detecterColonne(entetes, ALIAS_PRODUIT);
  var colQuantite = detecterColonne(entetes, ALIAS_QUANTITE);
  var colDate = detecterColonne(entetes, ALIAS_DATE);
  if (colProduit === -1 || colQuantite === -1) {
    return { lignes: [], erreur: 'Colonnes produit ou quantité introuvables (en-têtes : ' + entetes.join(', ') + ')' };
  }
  var lignes: LigneVente[] = [];
  tableau.slice(1).forEach(function (cellules) {
    var nom = (cellules[colProduit] || '').trim();
    if (!nom || /^total/i.test(nom)) return;
    var quantite = Number((cellules[colQuantite] || '').replace(/\s/g, '').replace(',', '.'));
    if (!isFinite(quantite)) return;
    var jour = colDate === -1 ? jourParDefaut : lireDate(cellules[colDate] || '');
    if (!jour) return;
    lignes.push({ nom_produit: nom, quantite: quantite, date_vente: jour });
  });
  return { lignes: lignes };
}
