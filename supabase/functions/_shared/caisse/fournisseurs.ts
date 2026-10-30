// Registre des caisses branchables : une même interface pour la connexion
// (OAuth ou clé) et la lecture des ventes d'un jour, quelle que soit la
// caisse. Ajouter une caisse = un module + une entrée ici.

import { type LigneVente, ajouterJours, debutJourParisUTC } from './commun.ts';
import { type FetchFn, type Jetons } from './http.ts';
import * as sumup from './sumup.ts';
import * as zettle from './zettle.ts';
import * as square from './square.ts';
import * as hiboutik from './hiboutik.ts';

export type Identifiants = { clientId: string; clientSecret: string };

export type Fournisseur = {
  libelle: string;
  // oauth : bouton « Brancher » ; cle : le commerçant colle ses accès.
  mode: 'oauth' | 'cle';
  urlAutorisation?: (clientId: string, redirectUri: string, etat: string) => string;
  echangerCode?: (fetchFn: FetchFn, clientId: string, clientSecret: string, redirectUri: string, code: string) => Promise<Jetons>;
  rafraichir?: (fetchFn: FetchFn, clientId: string, clientSecret: string, refreshToken: string) => Promise<Jetons>;
  identifiantCompte: (fetchFn: FetchFn, jeton: string) => Promise<string>;
  lignesDuJour: (fetchFn: FetchFn, jeton: string, compte: string, jour: string) => Promise<LigneVente[]>;
};

function parInstants(lire: (f: FetchFn, j: string, c: string, d: string, fin: string) => Promise<LigneVente[]>) {
  return function (fetchFn: FetchFn, jeton: string, compte: string, jour: string) {
    return lire(fetchFn, jeton, compte, debutJourParisUTC(jour), debutJourParisUTC(ajouterJours(jour, 1)));
  };
}

export var FOURNISSEURS: Record<string, Fournisseur> = {
  sumup: {
    libelle: 'SumUp', mode: 'oauth',
    urlAutorisation: sumup.urlAutorisation, echangerCode: sumup.echangerCode, rafraichir: sumup.rafraichir,
    identifiantCompte: sumup.codeMarchand, lignesDuJour: parInstants(sumup.lignesVendues)
  },
  zettle: {
    libelle: 'Zettle', mode: 'oauth',
    urlAutorisation: zettle.urlAutorisation, echangerCode: zettle.echangerCode, rafraichir: zettle.rafraichir,
    identifiantCompte: zettle.identifiantCompte, lignesDuJour: parInstants(zettle.lignesVendues)
  },
  square: {
    libelle: 'Square', mode: 'oauth',
    urlAutorisation: square.urlAutorisation, echangerCode: square.echangerCode, rafraichir: square.rafraichir,
    identifiantCompte: square.identifiantCompte, lignesDuJour: parInstants(square.lignesVendues)
  },
  hiboutik: {
    libelle: 'Hiboutik', mode: 'cle',
    identifiantCompte: hiboutik.identifiantCompte, lignesDuJour: hiboutik.lignesVenduesDuJour
  }
};

// Secrets des apps OAuth : SUMUP_CLIENT_ID / SUMUP_CLIENT_SECRET, etc.
export function identifiantsApp(nom: string, lireEnv: (cle: string) => string | undefined): Identifiants {
  var prefixe = nom.toUpperCase();
  return { clientId: lireEnv(prefixe + '_CLIENT_ID') || '', clientSecret: lireEnv(prefixe + '_CLIENT_SECRET') || '' };
}

// Caisses branchables tout de suite : OAuth configuré, ou par clé.
export function disponibles(lireEnv: (cle: string) => string | undefined): Record<string, boolean> {
  var res: Record<string, boolean> = {};
  Object.keys(FOURNISSEURS).forEach(function (nom) {
    res[nom] = FOURNISSEURS[nom].mode === 'cle' || !!identifiantsApp(nom, lireEnv).clientId;
  });
  return res;
}
