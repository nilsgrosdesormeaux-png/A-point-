// Tests du connecteur caisse, sans compte marchand réel ni réseau : l'API
// SumUp et Supabase sont remplacées par des faux.
// Lancement : node --test tests/caisse.test.mjs   (Node 22.18+ ou 24 : lit le TypeScript tel quel)

import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliserNomProduit, jourParis, debutJourParisUTC, ajouterJours, agregerLignes } from '../supabase/functions/_shared/caisse/commun.ts';
import { lireDate, lignesDepuisExport } from '../supabase/functions/_shared/caisse/export-csv.ts';
import { chiffrer, dechiffrer } from '../supabase/functions/_shared/caisse/chiffrement.ts';
import * as sumup from '../supabase/functions/_shared/caisse/sumup.ts';
import { synchroniserConnexion } from '../supabase/functions/_shared/caisse/synchroniser.ts';

var CLE = Buffer.alloc(32, 7).toString('base64');

test('normalisation identique à import.html', function () {
  assert.equal(normaliserNomProduit('  Croissants '), 'croissant');
  assert.equal(normaliserNomProduit('CROISSANT'), 'croissant');
  assert.equal(normaliserNomProduit('Éclair café'), 'eclair cafe');
  assert.equal(normaliserNomProduit('Gâteaux'), 'gateau');
  assert.equal(normaliserNomProduit('Bus'), 'bus');
  assert.equal(normaliserNomProduit(null), '');
});

test('jour de Paris, pas jour UTC', function () {
  assert.equal(jourParis('2026-10-29T22:30:00Z'), '2026-10-29'); // 23 h 30 à Paris (heure d'hiver)
  assert.equal(jourParis('2026-07-14T22:30:00Z'), '2026-07-15'); // 00 h 30 à Paris (heure d'été)
  assert.equal(debutJourParisUTC('2026-07-15'), '2026-07-14T22:00:00.000Z');
  assert.equal(debutJourParisUTC('2026-12-01'), '2026-11-30T23:00:00.000Z');
  assert.equal(ajouterJours('2026-03-01', -1), '2026-02-28');
});

test('agrégation par (jour, nom normalisé)', function () {
  var r = agregerLignes([
    { nom_produit: 'Croissant', quantite: 2, date_vente: '2026-10-29' },
    { nom_produit: 'croissants', quantite: 3, date_vente: '2026-10-29' },
    { nom_produit: 'Croissant', quantite: 1, date_vente: '2026-10-30' },
    { nom_produit: '', quantite: 9, date_vente: '2026-10-29' }
  ]);
  assert.deepEqual(r, [
    { nom_produit: 'Croissant', quantite: 5, date_vente: '2026-10-29' },
    { nom_produit: 'Croissant', quantite: 1, date_vente: '2026-10-30' }
  ]);
});

test('export CSV : séparateur, guillemets, dates françaises, total ignoré', function () {
  var csv = '﻿Date;Désignation;Qté;Montant\r\n29/10/2026 07:12;"Pain au chocolat";3;3,90\r\n29/10/2026;Baguette;"1,0";1,20\r\n30/10/2026;Baguette;2;2,40\r\nTOTAL;;6;7,50\r\n';
  var r = lignesDepuisExport(csv, '2026-01-01');
  assert.equal(r.erreur, undefined);
  assert.deepEqual(r.lignes, [
    { nom_produit: 'Pain au chocolat', quantite: 3, date_vente: '2026-10-29' },
    { nom_produit: 'Baguette', quantite: 1, date_vente: '2026-10-29' },
    { nom_produit: 'Baguette', quantite: 2, date_vente: '2026-10-30' }
  ]);
});

test('export CSV sans colonne date : jour par défaut', function () {
  var r = lignesDepuisExport('article,quantite\nTradition,40\n', '2026-10-29');
  assert.deepEqual(r.lignes, [{ nom_produit: 'Tradition', quantite: 40, date_vente: '2026-10-29' }]);
  assert.match(lignesDepuisExport('a;b\n1;2\n', '2026-10-29').erreur, /introuvables/);
  assert.equal(lireDate('2026-10-29T08:00'), '2026-10-29');
  assert.equal(lireDate('5/3/26'), '2026-03-05');
});

test('chiffrement des jetons : aller-retour, jamais en clair', async function () {
  var stocke = await chiffrer('sup_sk_secret', CLE);
  assert.ok(!stocke.includes('sup_sk_secret'));
  assert.equal(await dechiffrer(stocke, CLE), 'sup_sk_secret');
  await assert.rejects(dechiffrer(stocke, Buffer.alloc(32, 8).toString('base64')));
});

// Faux SumUp : 3 transactions sur 2 pages, une en échec, un 429 au passage.
function fauxSumup(journal) {
  var deja429 = false;
  var details = {
    t1: { timestamp: '2026-10-29T06:10:00Z', products: [{ name: 'Croissant', quantity: 2 }, { name: 'Baguette', quantity: 1 }] },
    t2: { timestamp: '2026-10-29T16:00:00Z', products: [{ name: 'croissants', quantity: 3 }] },
    t3: { timestamp: '2026-10-28T23:30:00Z', products: [{ name: 'Baguette', quantity: 4 }] } // 00 h 30 le 29 à Paris
  };
  return async function (url, init) {
    journal.push(url);
    var json = function (corps, status) { return new Response(JSON.stringify(corps), { status: status || 200 }); };
    if (url.endsWith('/token')) {
      var params = new URLSearchParams(init.body);
      return json({ access_token: 'nouveau-' + params.get('grant_type'), expires_in: 3599 });
    }
    if (url.includes('/v0.1/memberships')) return json({ items: [{ resource_id: 'MH4H92C7' }] });
    if (url.includes('/transactions/history')) {
      if (!deja429) { deja429 = true; return json({}, 429); }
      if (url.includes('oldest_ref=p2')) return json({ items: [{ id: 't3', status: 'SUCCESSFUL', type: 'PAYMENT' }], links: [] });
      return json({
        items: [{ id: 't1', status: 'SUCCESSFUL', type: 'PAYMENT' }, { id: 't2', status: 'SUCCESSFUL', type: 'PAYMENT' }, { id: 'tx', status: 'FAILED', type: 'PAYMENT' }],
        links: [{ rel: 'next', href: 'limit=100&oldest_ref=p2' }]
      });
    }
    var id = new URL(url).searchParams.get('id');
    if (details[id]) return json(details[id]);
    return json({}, 404);
  };
}

test('SumUp : pagination, 429 réessayé, détail par ticket, échecs ignorés', async function () {
  var journal = [];
  var lignes = await sumup.lignesVendues(fauxSumup(journal), 'tok', 'MH4H92C7', '2026-10-28T23:00:00.000Z', '2026-10-29T23:00:00.000Z');
  assert.deepEqual(agregerLignes(lignes), [
    { nom_produit: 'Croissant', quantite: 5, date_vente: '2026-10-29' },
    { nom_produit: 'Baguette', quantite: 5, date_vente: '2026-10-29' }
  ]);
  assert.ok(journal[0].includes('oldest_time=2026-10-28T23%3A00%3A00.000Z'));
  assert.ok(!journal.some(function (u) { return u.includes('id=tx'); }));
  assert.match(sumup.urlAutorisation('cid', 'https://x/cb', 'e1'), /scope=transactions\.history%20user\.profile_readonly&state=e1$/);
  assert.equal(await sumup.codeMarchand(fauxSumup([]), 'tok'), 'MH4H92C7');
});

// Faux client Supabase : juste ce que synchroniser.ts utilise.
function fauxAdmin(secrets) {
  var appels = { rpc: [], updates: [], upserts: [] };
  function requete(table) {
    var q = {
      select: function () { return q; }, eq: function () { return q; },
      single: async function () { return { data: secrets, error: null }; },
      update: function (v) { appels.updates.push({ table: table, valeurs: v }); return q; },
      upsert: async function (v) { appels.upserts.push(v); return { error: null }; },
      then: function (ok) { return Promise.resolve({ error: null }).then(ok); }
    };
    return q;
  }
  return {
    appels: appels,
    from: requete,
    rpc: async function (nom, params) { appels.rpc.push({ nom: nom, params: params }); return { data: params.p_lignes.length, error: null }; }
  };
}

test('synchro : jeton rafraîchi si expiré, fenêtre jusqu\'à hier, ventes enregistrées', async function () {
  var admin = fauxAdmin({
    access_token: await chiffrer('ancien', CLE),
    refresh_token: await chiffrer('refresh', CLE),
    expire_a: '2026-10-30T00:00:00Z'
  });
  var journal = [];
  var connexion = { commercant_id: 'c1', fournisseur: 'sumup', compte_caisse: 'MH4H92C7', derniere_date_synchronisee: '2026-10-28' };
  var env = { cleChiffrement: CLE, sumupClientId: 'cid', sumupClientSecret: 'sec' };
  var r = await synchroniserConnexion(admin, connexion, env, fauxSumup(journal), new Date('2026-10-30T03:00:00Z'));

  assert.deepEqual(r, { ok: true, lignes: 2, du: '2026-10-29', au: '2026-10-29', complet: true });
  assert.equal(admin.appels.rpc[0].nom, 'enregistrer_ventes_caisse');
  assert.equal(admin.appels.rpc[0].params.p_source, 'sumup');
  assert.equal(await dechiffrer(admin.appels.upserts[0].access_token, CLE), 'nouveau-refresh_token');
  var maj = admin.appels.updates.pop().valeurs;
  assert.equal(maj.statut, 'active');
  assert.ok(maj.derniere_synchro);
  assert.equal(admin.appels.updates.pop().valeurs.derniere_date_synchronisee, '2026-10-29');
});

test('synchro : jour par jour, s\'arrête au budget de temps et reprendra au jour manquant', async function () {
  var admin = fauxAdmin({ access_token: await chiffrer('x', CLE), refresh_token: null, expire_a: null });
  var journal = [];
  var connexion = { commercant_id: 'c1', fournisseur: 'sumup', compte_caisse: 'M', derniere_date_synchronisee: null };
  var r = await synchroniserConnexion(admin, connexion, { cleChiffrement: CLE }, fauxSumup(journal), new Date('2026-10-30T03:00:00Z'), Date.now() - 1);
  assert.deepEqual(r, { ok: true, lignes: 0, du: '2026-10-16', au: '2026-10-15', complet: false });
  assert.equal(admin.appels.updates.pop().valeurs.derniere_synchro, undefined);
  assert.ok(!journal.some(function (u) { return u.includes('/transactions'); }));
});

test('synchro : déjà à jour, aucun appel à la caisse', async function () {
  var admin = fauxAdmin(null);
  var journal = [];
  var connexion = { commercant_id: 'c1', fournisseur: 'sumup', compte_caisse: 'M', derniere_date_synchronisee: '2026-10-29' };
  var r = await synchroniserConnexion(admin, connexion, { cleChiffrement: CLE }, fauxSumup(journal), new Date('2026-10-30T03:00:00Z'));
  assert.equal(r.ok, true);
  assert.equal(journal.length, 0);
});

test('synchro : erreur caisse enregistrée sans faire échouer la nuit', async function () {
  var admin = fauxAdmin({ access_token: await chiffrer('x', CLE), refresh_token: null, expire_a: null });
  var enPanne = async function () { return new Response('{}', { status: 500 }); };
  var connexion = { commercant_id: 'c1', fournisseur: 'sumup', compte_caisse: 'M', derniere_date_synchronisee: null };
  var r = await synchroniserConnexion(admin, connexion, { cleChiffrement: CLE }, enPanne, new Date('2026-10-30T03:00:00Z'));
  assert.equal(r.ok, false);
  var maj = admin.appels.updates.pop().valeurs;
  assert.equal(maj.statut, 'erreur');
  assert.match(maj.derniere_erreur, /500/);
});
