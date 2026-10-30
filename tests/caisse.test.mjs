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
import * as zettle from '../supabase/functions/_shared/caisse/zettle.ts';
import * as square from '../supabase/functions/_shared/caisse/square.ts';
import * as hiboutik from '../supabase/functions/_shared/caisse/hiboutik.ts';
import { FOURNISSEURS, disponibles } from '../supabase/functions/_shared/caisse/fournisseurs.ts';
import { lignesDepuisTableau } from '../supabase/functions/_shared/caisse/export-csv.ts';

var CLE = Buffer.alloc(32, 7).toString('base64');
var ENV_VIDE = { cleChiffrement: CLE, lireEnv: function () { return undefined; } };

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
  var env = { cleChiffrement: CLE, lireEnv: function (k) { return { SUMUP_CLIENT_ID: 'cid', SUMUP_CLIENT_SECRET: 'sec' }[k]; } };
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
  var r = await synchroniserConnexion(admin, connexion, ENV_VIDE, fauxSumup(journal), new Date('2026-10-30T03:00:00Z'), Date.now() - 1);
  // 12 mois d'historique au premier branchement.
  assert.deepEqual(r, { ok: true, lignes: 0, du: '2025-10-30', au: '2025-10-29', complet: false });
  assert.equal(admin.appels.updates.pop().valeurs.derniere_synchro, undefined);
  assert.ok(!journal.some(function (u) { return u.includes('/transactions'); }));
});

test('synchro : déjà à jour, aucun appel à la caisse', async function () {
  var admin = fauxAdmin(null);
  var journal = [];
  var connexion = { commercant_id: 'c1', fournisseur: 'sumup', compte_caisse: 'M', derniere_date_synchronisee: '2026-10-29' };
  var r = await synchroniserConnexion(admin, connexion, ENV_VIDE, fauxSumup(journal), new Date('2026-10-30T03:00:00Z'));
  assert.equal(r.ok, true);
  assert.equal(journal.length, 0);
});

test('synchro : erreur caisse enregistrée sans faire échouer la nuit', async function () {
  var admin = fauxAdmin({ access_token: await chiffrer('x', CLE), refresh_token: null, expire_a: null });
  var enPanne = async function () { return new Response('{}', { status: 400 }); };
  var connexion = { commercant_id: 'c1', fournisseur: 'sumup', compte_caisse: 'M', derniere_date_synchronisee: null };
  var r = await synchroniserConnexion(admin, connexion, ENV_VIDE, enPanne, new Date('2026-10-30T03:00:00Z'));
  assert.equal(r.ok, false);
  var maj = admin.appels.updates.pop().valeurs;
  assert.equal(maj.statut, 'erreur');
  assert.match(maj.derniere_erreur, /400/);
  assert.ok(Date.parse(maj.reessayer_apres) > Date.now());
});

function json(corps, status) { return new Response(JSON.stringify(corps), { status: status || 200 }); }

test('Zettle : articles dans la liste, pagination, remboursement déduit, carte cadeau ignorée', async function () {
  var journal = [];
  var mille = [];
  for (var i = 0; i < 1000; i++) mille.push({ timestamp: '2026-10-29T07:00:00.000+0000', products: [{ name: 'Baguette', quantity: '1', type: 'PRODUCT' }] });
  var faux = async function (url) {
    journal.push(url);
    if (url.includes('lastPurchaseHash=h1')) {
      return json({ purchases: [
        { timestamp: '2026-10-29T22:30:00.000+0000', products: [{ name: 'Croissant', variantName: '', quantity: '3' }] },
        { timestamp: '2026-10-29T10:00:00.000+0000', refund: true, products: [{ name: 'Baguette', quantity: '-2' }] },
        { timestamp: '2026-10-29T10:00:00.000+0000', products: [{ name: 'Carte', quantity: '1', type: 'GIFTCARD' }] }
      ] });
    }
    return json({ purchases: mille, lastPurchaseHash: 'h1' });
  };
  var lignes = await zettle.lignesVendues(faux, 'tok', 'org', '2026-10-28T23:00:00.000Z', '2026-10-29T23:00:00.000Z');
  assert.deepEqual(agregerLignes(lignes), [
    { nom_produit: 'Baguette', quantite: 998, date_vente: '2026-10-29' },
    { nom_produit: 'Croissant', quantite: 3, date_vente: '2026-10-29' }
  ]);
  assert.ok(journal[0].includes('startDate=2026-10-28T23%3A00') && journal[0].includes('limit=1000'));
  assert.match(zettle.urlAutorisation('c', 'https://x/cb', 'e'), /^https:\/\/oauth\.zettle\.com\/authorize\?.*scope=READ%3APURCHASE%20READ%3AUSERINFO/);
});

test('Square : commandes terminées par établissement, curseur, variantes', async function () {
  var corps = [];
  var faux = async function (url, init) {
    if (url.endsWith('/v2/locations')) return json({ locations: [{ id: 'L1', status: 'ACTIVE' }, { id: 'L2', status: 'INACTIVE' }] });
    var c = JSON.parse(init.body);
    corps.push(c);
    if (!c.cursor) return json({ orders: [{ closed_at: '2026-10-29T08:00:00Z', line_items: [{ name: 'Tarte', variation_name: 'Grande', quantity: '2' }] }], cursor: 'k2' });
    return json({ orders: [{ closed_at: '2026-10-29T09:00:00Z', line_items: [{ name: 'Baguette', variation_name: 'Regular', quantity: '5' }] }] });
  };
  assert.equal(await square.identifiantCompte(faux, 'tok'), 'L1');
  var lignes = await square.lignesVendues(faux, 'tok', 'L1', '2026-10-28T23:00:00.000Z', '2026-10-29T23:00:00.000Z');
  assert.deepEqual(lignes, [
    { nom_produit: 'Tarte Grande', quantite: 2, date_vente: '2026-10-29' },
    { nom_produit: 'Baguette', quantite: 5, date_vente: '2026-10-29' }
  ]);
  assert.deepEqual(corps[0].query.filter.state_filter.states, ['COMPLETED']);
  assert.equal(corps[0].query.filter.date_time_filter.closed_at.start_at, '2026-10-28T23:00:00.000Z');
});

test('Hiboutik : clé collée, magasins, produits vendus du jour paginés', async function () {
  var urls = [];
  var page250 = [];
  for (var i = 0; i < 250; i++) page250.push({ product_model: 'Baguette', quantity: '1' });
  var faux = async function (url, init) {
    urls.push(url);
    assert.equal(init.headers.Authorization, 'Basic ' + btoa('moi@x.fr:CLE'));
    if (url.endsWith('/stores')) return json([{ store_id: 1 }, { store_id: 2 }]);
    if (url.includes('/products_sold/1/') && url.endsWith('p=1')) return json(page250);
    if (url.includes('/products_sold/1/')) return json([{ product_model: 'Éclair', quantity: '4' }]);
    return json([]);
  };
  var jeton = JSON.stringify({ compte: 'maboulangerie', utilisateur: 'moi@x.fr', cle: 'CLE' });
  assert.equal(await hiboutik.identifiantCompte(faux, jeton), '1,2');
  var lignes = await hiboutik.lignesVenduesDuJour(faux, jeton, '1,2', '2026-03-05');
  assert.deepEqual(agregerLignes(lignes), [
    { nom_produit: 'Baguette', quantite: 250, date_vente: '2026-03-05' },
    { nom_produit: 'Éclair', quantite: 4, date_vente: '2026-03-05' }
  ]);
  assert.ok(urls.some(function (u) { return u === 'https://maboulangerie.hiboutik.com/api/products_sold/1/2026/3/5?p=2'; }));
  assert.throws(function () { hiboutik.lireIdentifiants(JSON.stringify({ compte: 'evil.com/x', utilisateur: 'a', cle: 'b' })); });
});

test('registre : les 4 caisses ; OAuth disponible seulement si l\'app est configurée', function () {
  assert.deepEqual(Object.keys(FOURNISSEURS).sort(), ['hiboutik', 'square', 'sumup', 'zettle']);
  assert.deepEqual(disponibles(function (k) { return k === 'ZETTLE_CLIENT_ID' ? 'z' : undefined; }),
    { sumup: false, zettle: true, square: false, hiboutik: true });
});

test('synchro Hiboutik via le registre : jour par jour, sans rafraîchissement', async function () {
  var admin = fauxAdmin({ access_token: await chiffrer(JSON.stringify({ compte: 'b', utilisateur: 'u', cle: 'k' }), CLE), refresh_token: null, expire_a: null });
  var faux = async function () { return json([{ product_model: 'Pain', quantity: '10' }]); };
  var connexion = { commercant_id: 'c1', fournisseur: 'hiboutik', compte_caisse: '1', derniere_date_synchronisee: '2026-10-27' };
  var r = await synchroniserConnexion(admin, connexion, ENV_VIDE, faux, new Date('2026-10-30T03:00:00Z'));
  assert.deepEqual(r, { ok: true, lignes: 2, du: '2026-10-28', au: '2026-10-29', complet: true });
  assert.deepEqual(admin.appels.rpc.map(function (a) { return a.params.p_lignes[0].date_vente; }), ['2026-10-28', '2026-10-29']);
});

test('export : en-tête après des lignes de titre, dates Excel, sous-total ignoré', function () {
  var r = lignesDepuisTableau([
    ['Boulangerie du Marché'], ['Période : octobre 2026'],
    ['Date', 'Article', 'Quantité vendue'],
    [46325, 'Baguette', 80],
    ['30/10/2026', 'Croissant', '12,0'],
    ['', 'Sous-total', 92]
  ], null);
  assert.deepEqual(r.lignes, [
    { nom_produit: 'Baguette', quantite: 80, date_vente: '2026-10-30' },
    { nom_produit: 'Croissant', quantite: 12, date_vente: '2026-10-30' }
  ]);
  assert.match(lignesDepuisTableau([['Article', 'Qte'], ['Pain', 1]], null).erreur, /date/);
  // Titre « Ventes par article » sans séparateur avant le vrai en-tête.
  assert.deepEqual(lignesDepuisExport('Ventes par article\nDate;Désignation;Qté\n02/01/2026;Baguette;71\n', null).lignes,
    [{ nom_produit: 'Baguette', quantite: 71, date_vente: '2026-01-02' }]);
});
