// Registre des caisses branchables : une même interface pour la connexion
// (OAuth ou clé) et la lecture des ventes d'un jour, quelle que soit la
// caisse. Ajouter une caisse = un module + une entrée ici.
//
// Deux façons de brancher une même caisse :
//  - oauth : bouton « Brancher », exige NOTRE app développeur (secrets
//    <CAISSE>_CLIENT_ID / _CLIENT_SECRET) ; masqué tant qu'ils manquent ;
//  - cle : le commerçant crée une clé dans SON compte de caisse et la colle
//    dans À Point. Aucun compte côté À Point. La clé est chiffrée
//    (CLE_CHIFFREMENT_CAISSE) dans connexions_caisse_secrets, jamais renvoyée
//    au navigateur. Une clé n'a jamais de refresh token : c'est ce qui la
//    distingue d'un jeton OAuth de la même caisse.

import { type LigneVente, ajouterJours, debutJourParisUTC } from './commun.ts';
import { type FetchFn, type Jetons } from './http.ts';
import * as sumup from './sumup.ts';
import * as zettle from './zettle.ts';
import * as square from './square.ts';
import * as hiboutik from './hiboutik.ts';
import * as loyverse from './loyverse.ts';
import * as tactill from './tactill.ts';

export type Identifiants = { clientId: string; clientSecret: string };

// Champs saisis par le commerçant (corps de l'action connecter_cle).
export type ChampsCle = Record<string, unknown>;

export type ModeCle = {
  // Contrôle de forme et texte à stocker (chiffré). Lève une Error lisible.
  lire: (champs: ChampsCle) => string;
  // Clé stockée -> jeton d'appel (Zettle : échange par assertion). Absent :
  // la clé s'utilise telle quelle.
  jetonDepuisCle?: (fetchFn: FetchFn, cle: string) => Promise<string>;
  // Il faut une ligne de migration (contrainte connexions_caisse) : sans
  // elle, la caisse est annoncée « bientôt ».
  migration?: string;
};

export type Fournisseur = {
  libelle: string;
  // oauth : bouton « Brancher » (si l'app est configurée) ; cle : le commerçant colle ses accès.
  mode: 'oauth' | 'cle';
  cle?: ModeCle;
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

function texte(v: unknown) {
  return String(v === null || v === undefined ? '' : v).trim();
}

export var FOURNISSEURS: Record<string, Fournisseur> = {
  sumup: {
    libelle: 'SumUp', mode: 'oauth',
    cle: {
      lire: function (c) {
        var k = texte(c.cle);
        if (/^sup_pk_/.test(k)) throw new Error('C\'est la clé publique SumUp (sup_pk_…) : il faut une clé secrète, qui commence par sup_sk_');
        if (!/^sup_sk_[A-Za-z0-9_-]{8,}$/.test(k)) throw new Error('Clé API SumUp attendue : elle commence par sup_sk_');
        return k;
      }
    },
    urlAutorisation: sumup.urlAutorisation, echangerCode: sumup.echangerCode, rafraichir: sumup.rafraichir,
    identifiantCompte: sumup.codeMarchand, lignesDuJour: parInstants(sumup.lignesVendues)
  },
  zettle: {
    libelle: 'Zettle', mode: 'oauth',
    cle: {
      lire: function (c) { var k = texte(c.cle); zettle.clientIdDeCle(k); return k; },
      jetonDepuisCle: zettle.jetonDepuisCle
    },
    urlAutorisation: zettle.urlAutorisation, echangerCode: zettle.echangerCode, rafraichir: zettle.rafraichir,
    identifiantCompte: zettle.identifiantCompte, lignesDuJour: parInstants(zettle.lignesVendues)
  },
  square: {
    libelle: 'Square', mode: 'oauth',
    cle: {
      lire: function (c) {
        var k = texte(c.cle);
        if (!/^[A-Za-z0-9_-]{30,}$/.test(k)) throw new Error('Jeton d\'accès Square attendu (« Production access token », commence en général par EAAA)');
        return k;
      }
    },
    urlAutorisation: square.urlAutorisation, echangerCode: square.echangerCode, rafraichir: square.rafraichir,
    identifiantCompte: square.identifiantCompte, lignesDuJour: parInstants(square.lignesVendues)
  },
  hiboutik: {
    libelle: 'Hiboutik', mode: 'cle',
    cle: {
      lire: function (c) {
        var compte = texte(c.compte).toLowerCase().replace(/^https?:\/\//, '').replace(/\.hiboutik\.com.*$/, '');
        var utilisateur = texte(c.utilisateur);
        var cle = texte(c.cle);
        if (!/^[a-z0-9-]+$/.test(compte) || !utilisateur || !cle) throw new Error('Renseigne le compte, l\'e-mail et la clé API Hiboutik');
        return JSON.stringify({ compte: compte, utilisateur: utilisateur, cle: cle });
      }
    },
    identifiantCompte: hiboutik.identifiantCompte, lignesDuJour: hiboutik.lignesVenduesDuJour
  },
  loyverse: {
    libelle: 'Loyverse', mode: 'cle',
    cle: {
      lire: function (c) {
        var k = texte(c.cle);
        if (!/^[A-Za-z0-9]{20,64}$/.test(k)) throw new Error('Jeton d\'accès Loyverse attendu (suite de lettres et de chiffres, sans espace)');
        return k;
      },
      migration: 'migration-connecteurs-caisse-v4.sql'
    },
    identifiantCompte: loyverse.identifiantCompte, lignesDuJour: parInstants(loyverse.lignesVendues)
  },
  tactill: {
    libelle: 'Tactill', mode: 'cle',
    cle: {
      lire: function (c) {
        var k = texte(c.cle);
        if (/^sk_test_/.test(k)) throw new Error('Clé de test Tactill (sk_test_) : demande une clé « live » (sk_live_…)');
        if (!/^sk_live_[A-Za-z0-9_-]{8,}$/.test(k)) throw new Error('Clé API Tactill attendue : elle commence par sk_live_');
        return k;
      },
      migration: 'migration-connecteurs-caisse-v4.sql'
    },
    identifiantCompte: tactill.identifiantCompte, lignesDuJour: parInstants(tactill.lignesVendues)
  }
};

// Jeton à présenter à la caisse : la clé telle quelle, ou échangée
// (Zettle). Un jeton OAuth (avec refresh token) n'est jamais échangé.
export function jetonUtilisable(nom: string, fetchFn: FetchFn, jetons: Jetons): Promise<string> {
  var f = FOURNISSEURS[nom];
  if (f && f.cle && f.cle.jetonDepuisCle && !jetons.refresh_token) return f.cle.jetonDepuisCle(fetchFn, jetons.access_token);
  return Promise.resolve(jetons.access_token);
}

// Caisses branchables par clé personnelle (aucun secret côté À Point).
export function avecCle(): string[] {
  return Object.keys(FOURNISSEURS).filter(function (nom) { return !!FOURNISSEURS[nom].cle; });
}

// Secrets des apps OAuth : SUMUP_CLIENT_ID / SUMUP_CLIENT_SECRET, etc.
export function identifiantsApp(nom: string, lireEnv: (cle: string) => string | undefined): Identifiants {
  var prefixe = nom.toUpperCase();
  return { clientId: lireEnv(prefixe + '_CLIENT_ID') || '', clientSecret: lireEnv(prefixe + '_CLIENT_SECRET') || '' };
}

// Caisses branchables tout de suite. res[nom] : vrai si le bouton OAuth
// est ouvert ou si la caisse se branche par clé (compatibilité avec
// l'ancienne page) ; res.oauth[nom] : bouton OAuth ouvert ; res.cle :
// caisses branchables par clé personnelle.
export function disponibles(lireEnv: (cle: string) => string | undefined): Record<string, any> {
  var res: Record<string, any> = { oauth: {}, cle: avecCle() };
  Object.keys(FOURNISSEURS).forEach(function (nom) {
    var oauth = FOURNISSEURS[nom].mode === 'oauth' && !!identifiantsApp(nom, lireEnv).clientId;
    res.oauth[nom] = oauth;
    res[nom] = oauth || FOURNISSEURS[nom].mode === 'cle';
  });
  return res;
}

// Caisse devinée d'après la forme de la clé collée : le boulanger n'a qu'un
// champ à remplir, même s'il s'est trompé de caisse dans la liste.
//   sup_sk_… SumUp · sk_live_ / sk_test_… Tactill · EAAA… Square ·
//   JWT (eyJ….….…) Zettle · 20 à 64 lettres et chiffres : Loyverse.
// Hiboutik (compte + e-mail + clé) a son propre formulaire.
export function devinerFournisseur(cle: unknown): string | null {
  var k = String(cle === null || cle === undefined ? '' : cle).trim();
  if (/^sup_(sk|pk)_/.test(k)) return 'sumup';
  if (/^sk_(live|test)_/.test(k)) return 'tactill';
  if (/^EAAA[A-Za-z0-9_-]{20,}$/.test(k)) return 'square';
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(k)) return 'zettle';
  if (/^[A-Za-z0-9]{20,64}$/.test(k)) return 'loyverse';
  return null;
}
