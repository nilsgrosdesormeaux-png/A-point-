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
import * as loyverse from '../supabase/functions/_shared/caisse/loyverse.ts';
import * as tactill from '../supabase/functions/_shared/caisse/tactill.ts';
var LectureExport = globalThis.LectureExport;

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
  var appels = { rpc: [], updates: [], upserts: [], journal: [] };
  function requete(table) {
    var q = {
      select: function () { return q; }, eq: function () { return q; },
      single: async function () { return { data: secrets, error: null }; },
      update: function (v) { appels.updates.push({ table: table, valeurs: v }); return q; },
      upsert: async function (v) { appels.upserts.push(v); return { error: null }; },
      insert: async function (v) { appels.journal.push({ table: table, valeurs: v }); return { error: null }; },
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

test('registre : 6 caisses, toutes en clé personnelle ; OAuth seulement si l\'app est configurée', function () {
  assert.deepEqual(Object.keys(FOURNISSEURS).sort(), ['hiboutik', 'loyverse', 'square', 'sumup', 'tactill', 'zettle']);
  var d = disponibles(function (k) { return k === 'ZETTLE_CLIENT_ID' ? 'z' : undefined; });
  assert.deepEqual(d.oauth, { sumup: false, zettle: true, square: false, hiboutik: false, loyverse: false, tactill: false });
  assert.deepEqual(d.cle.sort(), ['hiboutik', 'loyverse', 'square', 'sumup', 'tactill', 'zettle']);
  // Compatibilité avec l'ancienne page : vrai = bouton OAuth ouvert, ou caisse « clé » d'origine.
  assert.equal(d.sumup, false); assert.equal(d.zettle, true); assert.equal(d.hiboutik, true);
});

test('synchro Hiboutik via le registre : jour par jour, sans rafraîchissement', async function () {
  var admin = fauxAdmin({ access_token: await chiffrer(JSON.stringify({ compte: 'b', utilisateur: 'u', cle: 'k' }), CLE), refresh_token: null, expire_a: null });
  var faux = async function () { return json([{ product_model: 'Pain', quantity: '10' }]); };
  var connexion = { commercant_id: 'c1', fournisseur: 'hiboutik', compte_caisse: '1', derniere_date_synchronisee: '2026-10-27' };
  var r = await synchroniserConnexion(admin, connexion, ENV_VIDE, faux, new Date('2026-10-30T03:00:00Z'));
  assert.deepEqual(r, { ok: true, lignes: 2, du: '2026-10-28', au: '2026-10-29', complet: true });
  assert.deepEqual(admin.appels.rpc.map(function (a) { return a.params.p_lignes[0].date_vente; }), ['2026-10-28', '2026-10-29']);
  // Une ligne de journal pour cette réception.
  assert.deepEqual(admin.appels.journal, [{ table: 'journal_caisse', valeurs: {
    commercant_id: 'c1', source: 'api', fournisseur: 'hiboutik', nb_ventes: 2, du: '2026-10-28', au: '2026-10-29', detail: null } }]);
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

// ---------- Clé personnelle (aucun compte développeur côté À Point) ----------

function jwt(charge) {
  var b = function (o) { return Buffer.from(JSON.stringify(o)).toString('base64url'); };
  return b({ alg: 'RS256', typ: 'JWT' }) + '.' + b(charge) + '.signature';
}

test('clés personnelles : contrôle de forme, messages clairs', function () {
  var lire = function (nom, champs) { return FOURNISSEURS[nom].cle.lire(champs); };
  assert.equal(lire('sumup', { cle: ' sup_sk_ABCdef123456 ' }), 'sup_sk_ABCdef123456');
  assert.throws(function () { lire('sumup', { cle: 'sup_pk_ABCdef123456' }); }, /publique/);
  assert.throws(function () { lire('sumup', { cle: 'abc' }); }, /sup_sk_/);
  assert.equal(lire('square', { cle: 'EAAAl' + 'x'.repeat(60) }), 'EAAAl' + 'x'.repeat(60));
  assert.throws(function () { lire('square', { cle: 'court' }); });
  assert.equal(lire('loyverse', { cle: 'fMYgxHEYtcyT8cvtvgi1Za5DRs4vArSyvydlnd9f' }), 'fMYgxHEYtcyT8cvtvgi1Za5DRs4vArSyvydlnd9f');
  assert.throws(function () { lire('tactill', { cle: 'sk_test_abcdefghijk' }); }, /test/);
  assert.equal(lire('tactill', { cle: 'sk_live_abcdefghijk' }), 'sk_live_abcdefghijk');
  assert.throws(function () { lire('zettle', { cle: 'pas-un-jwt' }); }, /Zettle/);
  assert.equal(lire('hiboutik', { compte: 'https://MaBoulangerie.hiboutik.com/', utilisateur: 'a@b.fr', cle: 'K' }),
    JSON.stringify({ compte: 'maboulangerie', utilisateur: 'a@b.fr', cle: 'K' }));
});

test('Zettle clé API : assertion JWT avec le client_id de la clé, jamais de refresh token', async function () {
  var cle = jwt({ client_id: 'c55de605-48b6-42ef-b69e-cd9d14ded15a', scope: ['READ:PURCHASE'] });
  assert.equal(zettle.clientIdDeCle(cle), 'c55de605-48b6-42ef-b69e-cd9d14ded15a');
  var demandes = [];
  var faux = async function (url, init) {
    if (url === 'https://oauth.zettle.com/token') {
      demandes.push(Object.fromEntries(new URLSearchParams(init.body)));
      return json({ access_token: 'acces-2h', expires_in: 7200 });
    }
    assert.equal(init.headers.Authorization, 'Bearer acces-2h');
    if (url.endsWith('/users/self')) return json({ organizationUuid: 'org-1' });
    return json({ purchases: [{ timestamp: '2026-10-29T07:00:00.000+0000', products: [{ name: 'Baguette', quantity: '12' }] }] });
  };
  assert.equal(await zettle.jetonDepuisCle(faux, cle), 'acces-2h');
  assert.deepEqual(demandes[0], { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', client_id: 'c55de605-48b6-42ef-b69e-cd9d14ded15a', assertion: cle });
  assert.match(zettle.LIEN_CREATION_CLE, /^https:\/\/my\.zettle\.com\/apps\/api-keys\?name=A%20Point&scopes=READ%3APURCHASE%20READ%3AUSERINFO$/);
  // Synchro par le registre : la clé stockée (chiffrée) est échangée à chaque passage.
  var admin = fauxAdmin({ access_token: await chiffrer(cle, CLE), refresh_token: null, expire_a: null });
  var r = await synchroniserConnexion(admin, { commercant_id: 'c1', fournisseur: 'zettle', compte_caisse: 'org-1', derniere_date_synchronisee: '2026-10-28' },
    ENV_VIDE, faux, new Date('2026-10-30T03:00:00Z'));
  assert.equal(r.ok, true);
  assert.equal(demandes.length, 2);
  assert.equal(admin.appels.upserts.length, 0); // rien de réécrit : la clé reste la même
  assert.deepEqual(admin.appels.rpc[0].params.p_lignes, [{ nom_produit: 'Baguette', quantite: 12, date_vente: '2026-10-29' }]);
});

test('SumUp / Square en clé personnelle : jeton utilisé tel quel, sans rafraîchissement', async function () {
  var vus = [];
  var faux = async function (url, init) {
    vus.push(init.headers.Authorization);
    return json({ orders: [{ closed_at: '2026-10-29T09:00:00Z', line_items: [{ name: 'Baguette', quantity: '3' }] }] });
  };
  var admin = fauxAdmin({ access_token: await chiffrer('EAAAjeton-personnel', CLE), refresh_token: null, expire_a: null });
  var r = await synchroniserConnexion(admin, { commercant_id: 'c1', fournisseur: 'square', compte_caisse: 'L1', derniere_date_synchronisee: '2026-10-28' },
    ENV_VIDE, faux, new Date('2026-10-30T03:00:00Z'));
  assert.equal(r.ok, true);
  assert.ok(vus.every(function (a) { return a === 'Bearer EAAAjeton-personnel'; }));
});

test('Loyverse : tickets paginés par curseur, remboursement déduit, ticket annulé ignoré, variante', async function () {
  var urls = [];
  var faux = async function (url, init) {
    urls.push(url);
    assert.equal(init.headers.Authorization, 'Bearer jetonLoyverse');
    if (url.endsWith('/merchant/')) return json({ id: 'm-1', business_name: 'Boulangerie' });
    if (!url.includes('cursor=')) {
      return json({ receipts: [
        { receipt_type: 'SALE', created_at: '2026-10-29T06:00:00.000Z', cancelled_at: null, line_items: [{ item_name: 'Baguette', variant_name: null, quantity: 10 }] },
        { receipt_type: 'SALE', created_at: '2026-10-29T07:00:00.000Z', cancelled_at: '2026-10-29T07:01:00.000Z', line_items: [{ item_name: 'Baguette', quantity: 99 }] }
      ], cursor: 'c2' });
    }
    return json({ receipts: [
      { receipt_type: 'REFUND', created_at: '2026-10-29T09:00:00.000Z', line_items: [{ item_name: 'Baguette', quantity: 2 }] },
      { receipt_type: 'SALE', created_at: '2026-10-29T22:30:00.000Z', line_items: [{ item_name: 'Tarte', variant_name: 'Grande', quantity: 1 }] }
    ] });
  };
  assert.equal(await loyverse.identifiantCompte(faux, 'jetonLoyverse'), 'm-1');
  var lignes = await FOURNISSEURS.loyverse.lignesDuJour(faux, 'jetonLoyverse', 'm-1', '2026-10-29');
  assert.deepEqual(agregerLignes(lignes), [
    { nom_produit: 'Baguette', quantite: 8, date_vente: '2026-10-29' },
    { nom_produit: 'Tarte Grande', quantite: 1, date_vente: '2026-10-29' }
  ]);
  assert.ok(urls[1].includes('limit=250') && urls[1].includes('created_at_min=2026-10-28T23%3A00%3A00.000Z')
    && urls[1].includes('created_at_max=2026-10-29T22%3A59%3A59.999Z'));
  assert.ok(urls[2].endsWith('&cursor=c2'));
});

test('Tactill : clé X-Api-Key, ventes paginées, retour déduit, vente supprimée ignorée, clé de test refusée', async function () {
  var corps = [];
  var faux = async function (url, init) {
    assert.equal(init.headers['X-Api-Key'], 'sk_live_cle');
    if (url.endsWith('/me')) return json({ company_id: 'co-1', scopes: ['sale:read'], test: false });
    var c = JSON.parse(init.body);
    corps.push(c);
    if (!c.next_token) {
      return json({ items: [
        { state: 'CLOSED', created_at: '2026-10-29T07:00:00.000Z', lines: [{ quantity: 4, operation_type: 'SALE', details: { name: 'Croissant' } }] },
        { state: 'DELETED', created_at: '2026-10-29T07:10:00.000Z', lines: [{ quantity: 50, operation_type: 'SALE', details: { name: 'Croissant' } }] }
      ], next_token: 'p2' });
    }
    return json({ items: [{ state: 'CLOSED', created_at: '2026-10-29T10:00:00.000Z', lines: [{ quantity: 1, operation_type: 'REFUND', details: { name: 'Croissant' } }] }], next_token: null });
  };
  assert.equal(await tactill.identifiantCompte(faux, 'sk_live_cle'), 'co-1');
  var lignes = await FOURNISSEURS.tactill.lignesDuJour(faux, 'sk_live_cle', 'co-1', '2026-10-29');
  assert.deepEqual(agregerLignes(lignes), [{ nom_produit: 'Croissant', quantite: 3, date_vente: '2026-10-29' }]);
  assert.deepEqual(corps[0].filter.created_at, { gte: '2026-10-28T23:00:00.000Z', lt: '2026-10-29T23:00:00.000Z' });
  assert.equal(corps[1].next_token, 'p2');
  var test = async function () { return json({ company_id: 'co-1', test: true }); };
  await assert.rejects(tactill.identifiantCompte(test, 'sk_live_cle'), /test/);
});

// ---------- Import de fichier : exports de caisses courantes ----------

var lire = function (csv, jour) { return lignesDepuisExport(csv, jour === undefined ? null : jour); };

test('fichier Square (Détails des articles) : Qty, variante « Price Point Name », remboursement', function () {
  var csv = 'Date,Time,Time Zone,Category,Item,Qty,Price Point Name,SKU,Modifiers Applied,Gross Sales,Discounts,Net Sales,Tax,Transaction ID,Payment ID,Device Name,Notes,Details,Event Type,Location\n'
    + '2026-10-29,07:12:01,Paris,Pains,Baguette,3,Regular,,,"€3,30",€0.00,"€3,30",€0.17,T1,P1,Caisse,,,Payment,Boulangerie\n'
    + '2026-10-29,08:00:00,Paris,Pâtisserie,Tarte aux pommes,1,Grande,,,€18.00,€0.00,€18.00,€0.99,T2,P2,Caisse,,,Payment,Boulangerie\n'
    + '2026-10-29,09:00:00,Paris,Pains,Baguette,1,Regular,,,-€1.10,€0.00,-€1.10,€0.00,T3,P3,Caisse,,,Refund,Boulangerie\n';
  assert.deepEqual(agregerLignes(lire(csv).lignes), [
    { nom_produit: 'Baguette', quantite: 2, date_vente: '2026-10-29' },
    { nom_produit: 'Tarte aux pommes Grande', quantite: 1, date_vente: '2026-10-29' }
  ]);
});

test('fichier Loyverse (tickets par article) : Item, Variant, Quantity, ticket annulé ignoré', function () {
  var csv = 'Date,Receipt number,Receipt type,Category,SKU,Item,Variant,Modifiers applied,Quantity,Gross sales,Discounts,Net sales,Cost of goods,Gross profit,Taxes,POS,Store,Cashier name,Customer name,Customer contacts,Comment,Status\n'
    + '29/10/2026 07:05,1-1001,Sale,Viennoiserie,10001,Croissant,,,6,6.60,0.00,6.60,1.20,5.40,0.36,POS 1,Boulangerie,Marie,,,,Closed\n'
    + '29/10/2026 07:20,1-1002,Sale,Viennoiserie,10001,Croissant,,,4,4.40,0.00,4.40,0.80,3.60,0.24,POS 1,Boulangerie,Marie,,,,Cancelled\n'
    + '29/10/2026 08:00,1-1003,Refund,Viennoiserie,10001,Croissant,,,1,-1.10,0.00,-1.10,-0.20,-0.90,-0.06,POS 1,Boulangerie,Marie,,,,Closed\n';
  assert.deepEqual(agregerLignes(lire(csv).lignes), [{ nom_produit: 'Croissant', quantite: 5, date_vente: '2026-10-29' }]);
});

test('fichier Zettle / SumUp en Excel : produit, variante, quantité, jour lu dans le titre', function () {
  var r = lignesDepuisTableau([
    ['Rapport des ventes par produit'], ['Période : 29/10/2026 - 29/10/2026'], [],
    ['Produit', 'Variante', 'Catégorie', 'Quantité', 'Retours', 'Remises', 'TVA', 'Total'],
    ['Pain au chocolat', '', 'Viennoiseries', 42, 0, 0, '2,31', '46,20'],
    ['Flan', 'Part', 'Pâtisserie', '7', 0, 0, '0,96', '17,50'],
    ['Total', '', '', 49, 0, 0, '3,27', '63,70']
  ], null);
  assert.equal(r.erreur, undefined);
  assert.deepEqual(r.lignes, [
    { nom_produit: 'Pain au chocolat', quantite: 42, date_vente: '2026-10-29' },
    { nom_produit: 'Flan Part', quantite: 7, date_vente: '2026-10-29' }
  ]);
  // Plusieurs jours sans colonne date : refus clair plutôt qu'un mauvais jour.
  var plusieurs = lignesDepuisTableau([['Du 01/10/2026 au 31/10/2026'], ['Produit', 'Quantité'], ['Flan', 3]], null);
  assert.match(plusieurs.erreur, /plusieurs jours/);
});

test('exports français type Bimedia / Crisalid / Cashmag : Windows-1252, « Code article » écarté, CA écarté, 1 234,5', function () {
  var octets = Buffer.from('Ventes articles du 29/10/2026\r\nCode article;Désignation;Famille;Qté vendue;Qté remboursée;CA TTC\r\n'
    + '0001;Baguette tradition;PAIN;"1 234";2;"1 357,40"\r\n0002;Éclair café;PATISSERIE;12,5;0;"30,00"\r\n;TOTAL;;1246,5;2;1387,40\r\n', 'latin1');
  var texte = LectureExport.decoderOctets(new Uint8Array(octets));
  assert.ok(texte.includes('Désignation'));
  var r = lire(texte);
  assert.deepEqual(r.lignes, [
    { nom_produit: 'Baguette tradition', quantite: 1234, date_vente: '2026-10-29' },
    { nom_produit: 'Éclair café', quantite: 12.5, date_vente: '2026-10-29' }
  ]);
});

test('tableau croisé articles x jours (rapport Excel), et jours x articles', function () {
  var r = lignesDepuisTableau([
    ['Statistiques par article'],
    ['Article', '28/10/2026', '29/10/2026', 'Total'],
    ['Baguette', 80, 75, 155],
    ['Croissant', '', 40, 40],
    ['Total', 80, 115, 195]
  ], null);
  assert.deepEqual(r.lignes, [
    { nom_produit: 'Baguette', quantite: 80, date_vente: '2026-10-28' },
    { nom_produit: 'Baguette', quantite: 75, date_vente: '2026-10-29' },
    { nom_produit: 'Croissant', quantite: 40, date_vente: '2026-10-29' }
  ]);
  var t = lignesDepuisTableau([
    ['Jour', 'Baguette', 'Croissant', 'CA TTC', 'Nb tickets'],
    ['28/10/2026', 80, 30, '250,00', 120],
    ['29/10/2026', 75, 40, '260,00', 130]
  ], null);
  assert.equal(t.format, 'jours_x_articles');
  assert.deepEqual(agregerLignes(t.lignes).map(function (l) { return l.nom_produit + ' ' + l.date_vente + ' ' + l.quantite; }),
    ['Baguette 2026-10-28 80', 'Croissant 2026-10-28 30', 'Baguette 2026-10-29 75', 'Croissant 2026-10-29 40']);
});

test('lignes-titres de jour (« Date : … ») et en-têtes répétés à chaque page', function () {
  var csv = 'Journal des ventes\nDate : 28/10/2026\nArticle;Quantité\nBaguette;80\nCroissant;30\n'
    + 'Date : 29/10/2026\nArticle;Quantité\nBaguette;75\n';
  assert.deepEqual(lire(csv).lignes, [
    { nom_produit: 'Baguette', quantite: 80, date_vente: '2026-10-28' },
    { nom_produit: 'Croissant', quantite: 30, date_vente: '2026-10-28' },
    { nom_produit: 'Baguette', quantite: 75, date_vente: '2026-10-29' }
  ]);
});

test('séparateurs, guillemets, UTF-16, « sep=; », quantités vides ignorées', function () {
  var tab = 'Date\tArticle\tQuantité\n29/10/2026\tBaguette\t5\n29/10/2026\tViennoiseries\t\n';
  var utf16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(tab, 'utf16le')]);
  var r = lire(LectureExport.decoderOctets(new Uint8Array(utf16)));
  assert.deepEqual(r.lignes, [{ nom_produit: 'Baguette', quantite: 5, date_vente: '2026-10-29' }]);
  assert.equal(r.ignorees, 1);
  assert.deepEqual(lire('sep=,\nDate,Product,Qty\n2026-10-29,"Pain, seigle",2\n').lignes,
    [{ nom_produit: 'Pain, seigle', quantite: 2, date_vente: '2026-10-29' }]);
  assert.deepEqual(lire('Date|Article|Qte\n29/10/2026|Baguette|4\n').lignes,
    [{ nom_produit: 'Baguette', quantite: 4, date_vente: '2026-10-29' }]);
});

test('dates : formats courants, jour de Paris pour un instant UTC, mois/jour américain détecté', function () {
  assert.equal(lireDate('29.10.26'), '2026-10-29');
  assert.equal(lireDate('mer. 29/10/2026 07:12'), '2026-10-29');
  assert.equal(lireDate('Mercredi 29 octobre 2026'), '2026-10-29');
  assert.equal(lireDate('1er août 2026'), '2026-08-01');
  assert.equal(lireDate('29 oct. 2026'), '2026-10-29');
  assert.equal(lireDate('Oct 29, 2026'), '2026-10-29');
  assert.equal(lireDate('29-Oct-2026'), '2026-10-29');
  assert.equal(lireDate('20261029'), '2026-10-29');
  assert.equal(lireDate('2026-07-14T22:30:00Z'), '2026-07-15');
  assert.equal(lireDate('2026-07-14T22:30:00.000+0000'), '2026-07-15');
  assert.equal(lireDate(new Date('2026-10-29T10:00:00Z')), '2026-10-29');
  assert.equal(lireDate('31/02/2026'), null);
  assert.equal(lireDate('Baguette'), null);
  var us = lire('Date,Item,Qty\n10/29/2026,Baguette,3\n10/05/2026,Baguette,2\n');
  assert.deepEqual(us.lignes.map(function (l) { return l.date_vente; }), ['2026-10-29', '2026-10-05']);
});

test('nombres : formats français, anglais, unités, négatifs', function () {
  var q = LectureExport.lireQuantite;
  assert.equal(q('1 234,5'), 1234.5);
  assert.equal(q('1 234'), 1234);
  assert.equal(q('1.234,50'), 1234.5);
  assert.equal(q('1,234.50'), 1234.5);
  assert.equal(q('12,0'), 12);
  assert.equal(q('3 u'), 3);
  assert.equal(q('2,5 kg'), 2.5);
  assert.equal(q('(2)'), -2);
  assert.equal(q('-3'), -3);
  assert.ok(isNaN(q('')));
  assert.ok(isNaN(q('abc')));
});

test('colonnes choisies à la main quand la détection échoue, et classeur à plusieurs feuilles', function () {
  var tableau = [['Jour J', 'Libellé du bien', 'Vol.'], ['29/10/2026', 'Baguette', 7]];
  var auto = lignesDepuisTableau(tableau, null);
  assert.equal(auto.code, 'colonnes');
  assert.deepEqual(LectureExport.analyser(tableau).entetes, ['Jour J', 'Libellé du bien', 'Vol.']);
  var force = lignesDepuisTableau(tableau, null, { ligneEntete: 0, colonnes: { produit: 1, quantite: 2, date: 0 } });
  assert.deepEqual(force.lignes, [{ nom_produit: 'Baguette', quantite: 7, date_vente: '2026-10-29' }]);
  var classeur = LectureExport.lignesDepuisFeuilles([[['Synthèse'], ['CA', 1000]], [['Date', 'Article', 'Quantité'], ['29/10/2026', 'Pain', 3]]], null);
  assert.equal(classeur.feuille, 1);
  assert.deepEqual(classeur.lignes, [{ nom_produit: 'Pain', quantite: 3, date_vente: '2026-10-29' }]);
});

test('relais Gmail gratuit : jeton lu dans l\'adresse, pièce jointe transmise au format Postmark, message marqué lu', async function () {
  var vm = await import('node:vm');
  var fs = await import('node:fs');
  var envois = [];
  var lus = [];
  function message(id, to, pieces, nonLu) {
    return {
      isUnread: function () { return nonLu; }, markRead: function () { lus.push(id); },
      getTo: function () { return to; }, getCc: function () { return ''; }, getHeader: function () { return ''; },
      getAttachments: function () { return pieces; }
    };
  }
  var pj = { getName: function () { return 'ventes.csv'; }, getContentType: function () { return 'text/csv'; }, getBytes: function () { return [65, 66]; } };
  var image = { getName: function () { return 'logo.png'; }, getContentType: function () { return 'image/png'; }, getBytes: function () { return [1]; } };
  var ctx = {
    console: console,
    PropertiesService: { getScriptProperties: function () { return { getProperty: function () { return 'https://x/functions/v1/import-export-caisse?cle=K'; } }; } },
    GmailApp: { search: function () { return [{ getMessages: function () { return [
      message('ancien', 'apoint.ventes+0123456789abcdef@gmail.com', [pj], false),
      message('nouveau', 'Boulangerie <apoint.ventes+0123456789ABCDEF@gmail.com>', [pj, image], true),
      message('pub', 'apoint.ventes@gmail.com', [pj], true)
    ]; } }]; } },
    Utilities: { base64Encode: function (b) { return Buffer.from(b).toString('base64'); } },
    UrlFetchApp: { fetch: function (url, o) { envois.push({ url: url, corps: JSON.parse(o.payload) }); return { getResponseCode: function () { return 200; }, getContentText: function () { return ''; } }; } }
  };
  vm.runInNewContext(fs.readFileSync(new URL('../supabase/functions/import-export-caisse/relais-gmail.gs', import.meta.url), 'utf8') + '\nrelayer();', ctx);
  assert.deepEqual(envois, [{ url: 'https://x/functions/v1/import-export-caisse?cle=K',
    corps: { MailboxHash: '0123456789abcdef', Attachments: [{ Name: 'ventes.csv', ContentType: 'text/csv', Content: 'QUI=' }] } }]);
  assert.deepEqual(lus, ['nouveau', 'pub']);
});
