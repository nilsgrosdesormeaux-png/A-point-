// Les Edge Functions connecter-caisse et import-export-caisse de bout en
// bout, sous Node, sans Deno ni Supabase ni réseau : Deno.serve, supabase-js
// et xlsx sont remplacés par des faux ; les caisses répondent comme leur doc.
// Lancement : node --test tests/caisse-fonctions.test.mjs   (Node 22.18+)

import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// 1. Les imports « npm:… » de Deno pointent vers nos faux.
var FAUX_SUPABASE = 'data:text/javascript,' + encodeURIComponent('export function createClient(u, k, o) { return globalThis.__fauxSupabase(k, o); }');
var FAUX_XLSX = 'data:text/javascript,' + encodeURIComponent('export function read() { throw new Error("xlsx absent des tests"); } export var utils = {};');
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, suite) {
    if (spec === 'npm:@supabase/supabase-js@2') return { url: ${JSON.stringify(FAUX_SUPABASE)}, shortCircuit: true };
    if (spec === 'npm:xlsx@0.18.5') return { url: ${JSON.stringify(FAUX_XLSX)}, shortCircuit: true };
    return suite(spec, ctx);
  }`), import.meta.url);

// 2. Base en mémoire, juste ce que les fonctions utilisent.
var base = { connexions_caisse: [], connexions_caisse_secrets: [], journal_caisse: [], etats_oauth_caisse: [] };
var rpcs = [];
function requete(table) {
  var filtres = [], action = 'select', valeurs = null;
  var garde = function (l) { return filtres.every(function (f) { return f(l); }); };
  var q = {
    select: function () { return q; },
    eq: function (c, v) { filtres.push(function (l) { return l[c] === v; }); return q; },
    neq: function (c, v) { filtres.push(function (l) { return l[c] !== v; }); return q; },
    order: function () { return q; }, limit: function () { return q; },
    upsert: function (v) { action = 'upsert'; valeurs = v; return q; },
    insert: function (v) { action = 'insert'; valeurs = v; return q; },
    update: function (v) { action = 'update'; valeurs = v; return q; },
    delete: function () { action = 'delete'; return q; },
    maybeSingle: function () { return executer().then(function (r) { return { data: r.data[0] || null, error: r.error }; }); },
    single: function () { return executer().then(function (r) { return { data: r.data[0] || null, error: r.data[0] ? null : { message: 'aucune ligne' } }; }); },
    then: function (ok, ko) { return executer().then(ok, ko); }
  };
  async function executer() {
    var t = base[table];
    if (action === 'upsert') {
      if (table === 'connexions_caisse' && ['sumup', 'zettle', 'square', 'hiboutik', 'loyverse', 'tactill', 'export_email'].indexOf(valeurs.fournisseur) === -1) {
        return { data: null, error: { message: 'new row violates check constraint "connexions_caisse_fournisseur_check"' } };
      }
      var i = t.findIndex(function (l) { return l.commercant_id === valeurs.commercant_id && l.fournisseur === valeurs.fournisseur; });
      if (i === -1) t.push(Object.assign({}, valeurs)); else t[i] = Object.assign({}, t[i], valeurs);
      return { data: null, error: null };
    }
    if (action === 'insert') { t.push(Object.assign({}, valeurs)); return { data: null, error: null }; }
    if (action === 'update') { t.filter(garde).forEach(function (l) { Object.assign(l, valeurs); }); return { data: null, error: null }; }
    if (action === 'delete') { base[table] = t.filter(function (l) { return !garde(l); }); return { data: null, error: null }; }
    return { data: t.filter(garde), error: null };
  }
  return q;
}
globalThis.__fauxSupabase = function (cle, options) {
  var auth = options && options.global && options.global.headers.Authorization;
  return {
    auth: { getUser: async function () { return auth === 'Bearer bon' ? { data: { user: { id: 'boulanger-1' } }, error: null } : { data: { user: null }, error: { message: 'jwt' } }; } },
    from: requete,
    rpc: async function (nom, p) { rpcs.push({ nom: nom, p: p }); return { data: p.p_lignes ? p.p_lignes.length : true, error: null }; }
  };
};

// 3. Deno : variables d'environnement et capture du gestionnaire de requêtes.
var CLE_CHIFFREMENT = Buffer.alloc(32, 3).toString('base64');
var ENV = { SUPABASE_URL: 'https://projet.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon',
  CLE_CHIFFREMENT_CAISSE: CLE_CHIFFREMENT, ADRESSE_IMPORT: 'apointapp.contact@gmail.com', CLE_IMPORT_EMAIL: 'cle-email' };
var gestionnaires = [];
globalThis.Deno = { env: { get: function (k) { return ENV[k]; } }, serve: function (f) { gestionnaires.push(f); } };

// 4. Caisses simulées (réponses conformes aux docs officielles).
var appelsCaisse = [];
globalThis.fetch = async function (url, init) {
  appelsCaisse.push({ url: url, init: init });
  var json = function (c, s) { return new Response(JSON.stringify(c), { status: s || 200 }); };
  var auth = init && init.headers && (init.headers.Authorization || init.headers['X-Api-Key']);
  if (url.startsWith('https://api.loyverse.com/v1.0/merchant/')) {
    return auth === 'Bearer jetonLoyverseValide12345678' ? json({ id: 'marchand-1' }) : json({ errors: [{ code: 'UNAUTHORIZED', details: 'Access token is not valid.' }] }, 401);
  }
  if (url.startsWith('https://api.pragma-project.dev/v1/orders/')) return json({ data: [], meta: { totalPage: 0 } });
  if (url.startsWith('https://api.zelty.fr/2.10/info')) return json({ version: '2.10', brand_id: 1, restaurant_id: 7, errno: 0 });
  if (url.startsWith('https://api.tactill.com/pos/v0/me')) return json({ status_code: 401, error: 'Unauthorized', message: 'Invalid API key', code: 'acc-052' }, 401);
  return json({}, 404);
};

var { dechiffrer } = await import('../supabase/functions/_shared/caisse/chiffrement.ts');
await import('../supabase/functions/connecter-caisse/index.ts');
await import('../supabase/functions/import-export-caisse/index.ts');
var [connecter, importer] = gestionnaires;

function appel(corps, jwt) {
  return connecter(new Request('https://projet.supabase.co/functions/v1/connecter-caisse', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: jwt || 'Bearer bon' }, body: JSON.stringify(corps)
  })).then(async function (r) { return { status: r.status, corps: await r.json() }; });
}

test('sans session : 401, comme la fonction déployée', async function () {
  var r = await appel({ action: 'etat' }, 'Bearer faux');
  assert.equal(r.status, 401);
  assert.deepEqual(r.corps, { error: 'Non authentifie' });
});

test('état : caisses à clé annoncées, OAuth fermé sans secrets, e-mail ouvert', async function () {
  var r = await appel({ action: 'etat' });
  assert.deepEqual(r.corps.cle.sort(), ['hiboutik', 'lightspeed_retail', 'loyverse', 'popina', 'square', 'sumup', 'tactill', 'zelty', 'zettle']);
  assert.equal(r.corps.oauth.sumup, false);
  assert.equal(r.corps.email, true);
});

test('clé Loyverse : vérifiée auprès de la caisse, stockée chiffrée, jamais renvoyée', async function () {
  var r = await appel({ action: 'connecter_cle', fournisseur: 'loyverse', cle: 'jetonLoyverseValide12345678' });
  assert.deepEqual(r, { status: 200, corps: { ok: true, fournisseur: 'loyverse' } });
  assert.ok(!JSON.stringify(r.corps).includes('jetonLoyverse'));
  var cx = base.connexions_caisse.find(function (c) { return c.fournisseur === 'loyverse'; });
  assert.equal(cx.compte_caisse, 'marchand-1');
  assert.ok(!JSON.stringify(cx).includes('jetonLoyverse')); // table lisible par le navigateur : aucune clé
  var secret = base.connexions_caisse_secrets.find(function (c) { return c.fournisseur === 'loyverse'; });
  assert.ok(secret.access_token.startsWith('v1:') && !secret.access_token.includes('jetonLoyverse'));
  assert.equal(await dechiffrer(secret.access_token, CLE_CHIFFREMENT), 'jetonLoyverseValide12345678');
});

test('mauvaise clé : message clair, rien d\'enregistré ; caisse devinée d\'après la clé', async function () {
  var avant = base.connexions_caisse.length;
  var r = await appel({ action: 'connecter_cle', fournisseur: 'sumup', cle: 'sk_live_mauvaiseCle' });
  assert.equal(r.status, 400);
  assert.match(r.corps.error, /refusé cette clé/);
  assert.ok(appelsCaisse.some(function (a) { return a.url === 'https://api.tactill.com/pos/v0/me'; })); // devinée : Tactill
  assert.equal(base.connexions_caisse.length, avant);
  var forme = await appel({ action: 'connecter_cle', fournisseur: 'sumup', cle: 'n\'importe quoi' });
  assert.equal(forme.status, 400);
  assert.match(forme.corps.error, /sup_sk_/);
});

test('adresse d\'import Gmail « +caisse- » puis export reçu par le relais : ventes enregistrées', async function () {
  var r = await appel({ action: 'activer_import_email' });
  assert.match(r.corps.adresse, /^apointapp\.contact\+caisse-[a-f0-9]{16}@gmail\.com$/);
  var jeton = r.corps.adresse.match(/caisse-([a-f0-9]{16})@/)[1];
  var csv = 'Date;Article;Qté\n29/10/2026;Baguette;80\n29/10/2026;Croissant;35\n';
  var rep = await importer(new Request('https://projet.supabase.co/functions/v1/import-export-caisse?cle=cle-email', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ MailboxHash: 'caisse-' + jeton, Attachments: [{ Name: 'ventes.csv', ContentType: 'text/csv', Content: Buffer.from(csv, 'latin1').toString('base64') }] })
  }));
  assert.deepEqual(await rep.json(), { lignes: 2, erreurs: [] });
  var enr = rpcs.filter(function (x) { return x.nom === 'enregistrer_ventes_caisse'; }).pop();
  assert.deepEqual(enr.p, { p_commercant: 'boulanger-1', p_source: 'export_email', p_lignes: [
    { nom_produit: 'Baguette', quantite: 80, date_vente: '2026-10-29' }, { nom_produit: 'Croissant', quantite: 35, date_vente: '2026-10-29' }] });
  var mauvaiseCle = await importer(new Request('https://x/functions/v1/import-export-caisse?cle=faux', { method: 'POST', body: '{}' }));
  assert.equal(mauvaiseCle.status, 401);
});

test('Zelty avant la migration v5 : « bientôt », rien d\'enregistré ; clé Popina choisie jamais prise pour Loyverse', async function () {
  var cleZelty = Buffer.from('19974:secretsecretsecret').toString('base64');
  var r = await appel({ action: 'connecter_cle', fournisseur: 'loyverse', cle: cleZelty }); // caisse devinée : Zelty
  assert.equal(r.status, 503);
  assert.match(r.corps.error, /Zelty ouvre très bientôt/);
  assert.ok(!base.connexions_caisse.some(function (c) { return c.fournisseur === 'zelty'; }));
  var avant = appelsCaisse.length;
  var p = await appel({ action: 'connecter_cle', fournisseur: 'popina', cle: 'AbCdEf0123456789AbCdEf' });
  assert.equal(p.status, 503); // Popina gardé (forme de clé ambiguë), contrainte v4 : bientôt
  assert.ok(appelsCaisse.slice(avant).every(function (a) { return a.url.indexOf('loyverse') === -1; }));
});
