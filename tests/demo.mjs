// Harnais de démo À Point : toutes les pages, sur téléphone et ordinateur,
// avec un faux Supabase rempli d'une vraie boulangerie de quartier
// (« Le petit comptoire »). Aucune écriture dans la vraie base : toutes les
// requêtes vers *.supabase.co sont coupées, supabase-js est remplacé.
//
//   node tests/demo.mjs                 toutes les pages, mobile + ordinateur
//   node tests/demo.mjs --page fournee  une page (nom de scénario, partiel)
//   node tests/demo.mjs --mobile        téléphone seul (--ordi : ordinateur seul)
//   node tests/demo.mjs --liste         liste des scénarios
//
// Sortie : /home/user/apoint-captures/ (hors dépôt) ; pour chaque scénario et
// format : <nom>-<format>.png (pleine page), .txt (texte visible) et un
// rapport.txt (erreurs console, débordements, NaN/undefined, boutons trop
// petits, mots techniques).
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SORTIE = process.env.APOINT_CAPTURES || '/home/user/apoint-captures';
const PORT = Number(process.env.APOINT_PORT) || 4190;
const BASE = 'http://127.0.0.1:' + PORT;

// ---------- Arguments ----------
const args = process.argv.slice(2);
const filtrePage = args.includes('--page') ? args[args.indexOf('--page') + 1] : null;
const evaluer = args.includes('--eval') ? args[args.indexOf('--eval') + 1] : null;
const formats = args.includes('--mobile') ? ['mobile'] : args.includes('--ordi') ? ['ordi'] : ['mobile', 'ordi'];
const VIEWPORTS = {
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  ordi: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
};

// ---------- Jeu de données « Le petit comptoire » ----------
const ID = '00000000-0000-4000-8000-00000000c0de';
const ID_NOUVEAU = '00000000-0000-4000-8000-0000000000aa';

function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function jours(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

// Générateur pseudo-aléatoire reproductible (mêmes chiffres à chaque passage).
function alea(graine) { let s = graine >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// [nom, rayon, prix, ventes d'un mardi-vendredi, part de reste habituelle]
const CATALOGUE = [
  ['Baguette tradition', 'Pains', 1.30, 185, 0.06],
  ['Baguette', 'Pains', 1.10, 70, 0.07],
  ['Pain de campagne', 'Pains', 3.80, 16, 0.10],
  ['Pain complet', 'Pains', 3.60, 9, 0.12],
  ['Pain de seigle', 'Pains', 4.20, 6, 0.15],
  ['Croissant', 'Viennoiseries', 1.20, 72, 0.08],
  ['Pain au chocolat', 'Viennoiseries', 1.35, 84, 0.07],
  ['Pain aux raisins', 'Viennoiseries', 1.80, 14, 0.14],
  ['Chausson aux pommes', 'Viennoiseries', 2.20, 12, 0.12],
  ['Éclair au chocolat', 'Pâtisseries', 3.20, 13, 0.12],
  ['Flan pâtissier', 'Pâtisseries', 3.00, 11, 0.10],
  ['Tarte aux pommes', 'Pâtisseries', 3.50, 9, 0.15],
  ['Sandwich jambon-beurre', 'Snacking', 4.50, 34, 0.09],
  ['Quiche lorraine', 'Snacking', 4.20, 14, 0.12],
  ['Croque-monsieur', 'Snacking', 4.00, 11, 0.14],
  ['Café', 'Boissons', 1.50, 40, 0],
];
// Effet du jour de la semaine par rayon (0 = dimanche ; lundi fermé).
const JOUR = {
  Pains: [1.35, 0, 1, 0.95, 1, 1.05, 1.25],
  Viennoiseries: [1.85, 0, 0.9, 0.9, 0.95, 1, 1.45],
  Pâtisseries: [2.2, 0, 0.8, 0.85, 0.9, 1.1, 1.6],
  Snacking: [0.35, 0, 1.05, 1, 1.05, 1.1, 0.75],
  Boissons: [1.1, 0, 1, 1, 1, 1, 1.2],
};

function genererComptoire(aujourdhui) {
  const r = alea(20261101);
  const debut = jours(aujourdhui, -63); // 9 semaines d'historique
  const brancheLe = jours(aujourdhui, -20); // caisse branchée il y a 3 semaines
  const fourneesDepuis = jours(aujourdhui, -21);
  const cree = jours(aujourdhui, -64).toISOString();
  const categories = ['Pains', 'Viennoiseries', 'Pâtisseries', 'Snacking', 'Boissons'].map((nom, i) => ({ id: 'cat-' + i, commercant_id: ID, nom, ordre: i, created_at: cree }));
  const produits = CATALOGUE.map(([nom, rayon, prix], i) => ({
    id: 'prod-' + (i + 1), commercant_id: ID, nom, prix_vente: prix, categorie_id: 'cat-' + categories.findIndex((c) => c.nom === rayon), created_at: cree,
  }));
  const ventes = [];
  const fournees = [];
  let idVente = 1;
  for (let d = new Date(debut); d < aujourdhui; d = jours(d, 1)) {
    const j = d.getDay();
    if (j === 1) continue; // fermé le lundi
    const date = iso(d);
    const caisse = d >= brancheLe;
    const tendance = 1 + 0.04 * ((d - debut) / (aujourdhui - debut)); // légère hausse à l'automne
    const pluie = r() < 0.25 ? 0.93 : 1;
    // Vacances de la Toussaint (zone C, 17 oct. – 1er nov. 2026) : quartier plus calme.
    const vacances = date >= '2026-10-17' && date <= '2026-11-01' ? 0.88 : 1;
    CATALOGUE.forEach(([nom, rayon, , base, reste]) => {
      const attendu = base * JOUR[rayon][j] * tendance * pluie * vacances;
      const vendu = Math.max(0, Math.round(attendu * (0.9 + r() * 0.2)));
      const epuise = rayon !== 'Boissons' && r() < 0.06;
      const ligne = { id: idVente++, commercant_id: ID, date_vente: date, nom_produit: nom, quantite: vendu, source: caisse ? 'sumup' : 'manuel', created_at: date + 'T20:15:00Z' };
      ventes.push(ligne);
      if (d >= fourneesDepuis && rayon !== 'Boissons') {
        const cuit = epuise ? vendu : Math.round(vendu * (1 + reste * (0.6 + r() * 0.8)));
        fournees.push({ commercant_id: ID, date_fournee: date, nom_produit: nom, quantite_cuite: cuit, epuise, maj: date + 'T19:30:00Z' });
      }
    });
  }
  // Fiches techniques : recette type ajustée et validée pour 12 produits ; 3
  // restent « à vérifier » (seigle, tarte, croque) pour montrer l'état.
  const B = boulangerie();
  const PRIX_MATIERE = { 'farine': 0.98, 'seigle': 1.35, 'complete': 1.2, 'beurre de tourage': 9.8, 'beurre': 8.6, 'sucre': 1.1, 'sel': 0.45, 'levure': 4.2, 'lait': 1.05, 'oeufs': 0.28, 'barres de chocolat': 0.06, 'raisins': 6.4, 'compote': 3.2, 'jambon': 14.5, 'creme': 4.6, 'lardons': 9.2, 'chocolat de couverture': 12.5, 'graines': 5.2, 'poudre d amande': 14 };
  const prixMatiere = (nom) => { const n = B.normaliser(nom); const k = Object.keys(PRIX_MATIERE).filter((x) => n.includes(x)).sort((a, b) => b.length - a.length)[0]; return k ? PRIX_MATIERE[k] : 2; };
  const fiches = {};
  produits.forEach((p) => {
    if (['Pain de seigle', 'Tarte aux pommes', 'Croque-monsieur', 'Café'].includes(p.nom)) return;
    const type = B.recetteType(p.nom);
    if (!type) return;
    fiches[p.id] = type.ingredients.map(([n, q, u], k) => [n, k === 0 ? Math.round(q * 1.03 * 10000) / 10000 : q, u, prixMatiere(n)]);
  });
  const ingredients = [];
  let idIng = 1;
  Object.keys(fiches).forEach((pid) => fiches[pid].forEach(([nom_ingredient, quantite, unite, cout_unitaire]) => {
    ingredients.push({ id: idIng++, commercant_id: ID, produit_id: pid, nom_ingredient, quantite, unite, cout_unitaire, created_at: cree });
  }));
  const synchro = jours(aujourdhui, 0); synchro.setHours(6, 2, 0, 0);
  const journal = [];
  for (let k = 0; k < 6; k++) {
    const jour = jours(aujourdhui, -k); jour.setHours(6, 2, 0, 0);
    const veille = iso(jours(aujourdhui, -k - 1));
    if (jours(aujourdhui, -k - 1).getDay() === 1) continue;
    journal.push({ id: 100 + k, commercant_id: ID, cree_le: jour.toISOString(), source: 'api', fournisseur: 'sumup', nb_ventes: ventes.filter((v) => v.date_vente === veille).length, du: veille, au: veille, erreur: null, detail: null });
  }
  journal.push({ id: 99, commercant_id: ID, cree_le: brancheLe.toISOString(), source: 'branchement', fournisseur: 'sumup', nb_ventes: 0, du: null, au: null, erreur: null, detail: 'Caisse branchée avec une clé personnelle' });
  return {
    produits, categories_produit: categories, ventes, fournees, ingredients_produit: ingredients,
    parametres_commercant: [{
      commercant_id: ID, nom_restaurant: 'Le petit comptoire', code_postal: '75011', ville: 'Paris', latitude: 48.8589, longitude: 2.3801,
      jours_fermeture: [1], caisse: 'sumup', observation_debut: null, destination_invendus: 'don',
      reference_avant: { production: 900, reste: 110, dons: true },
      fournisseurs: { meunier: { email: 'commandes@moulin-exemple.fr', telephone: '01 23 45 67 89', jours: [2, 5] }, cremier: { email: 'pro@cremerie-exemple.fr', jours: [2, 4, 6] } },
      created_at: cree, updated_at: cree,
    }],
    evenements_commercant: [],
    connexions_caisse: [{ commercant_id: ID, fournisseur: 'sumup', statut: 'active', compte_caisse: 'MCXK42', debut_historique: iso(jours(aujourdhui, -63)), derniere_synchro: synchro.toISOString(), derniere_date_synchronisee: iso(jours(aujourdhui, -1)), nb_lignes_derniere_synchro: 15, derniere_erreur: null, created_at: brancheLe.toISOString() }],
    journal_caisse: journal,
  };
}

// Savoir-faire de boulangerie.js (recettes types), chargé tel quel.
import vm from 'vm';
let _B = null;
function boulangerie() {
  if (!_B) { const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'boulangerie.js'), 'utf8'), ctx); _B = ctx.window.Boulangerie; }
  return _B;
}

const COMPTES = {
  comptoire: (auj) => ({
    user: { id: ID, email: 'contact@lepetitcomptoire.fr', user_metadata: { caisse: 'sumup', reference_avant: { production: 900, reste: 110, dons: true }, fournees: { ouverture: '07:00', tranches: [{ nom: 'Avant l\'ouverture', heure: '05:30' }, { nom: 'Mi-matinée', heure: '09:30' }, { nom: 'Réassort de midi', heure: '11:30' }] } } },
    tables: genererComptoire(auj),
  }),
  nouveau: () => ({
    user: { id: ID_NOUVEAU, email: 'nouveau@boulangerie.fr', user_metadata: { caisse: 'sumup', reference_avant: { production: 600, reste: 60, dons: false } } },
    tables: { produits: [], categories_produit: [], ventes: [], fournees: [], ingredients_produit: [], parametres_commercant: [], evenements_commercant: [], connexions_caisse: [], journal_caisse: [] },
  }),
  deconnecte: (auj) => ({ user: null, inscrit: COMPTES.comptoire(auj).user, tables: COMPTES.comptoire(auj).tables }),
};

// ---------- Faux Supabase (dans la page) ----------
// Filtres réellement appliqués (eq, in, gte…), écritures en mémoire gardées
// dans sessionStorage pour survivre aux changements de page d'un parcours.
function fauxSupabase(seed) {
  const CLE = '__demo_db';
  let etat;
  try { etat = JSON.parse(sessionStorage.getItem(CLE) || 'null'); } catch (e) { etat = null; }
  if (!etat) etat = { session: seed.user ? { user: seed.user, access_token: 'demo' } : null, inscrit: seed.inscrit || null, tables: seed.tables };
  function sauver() { try { sessionStorage.setItem(CLE, JSON.stringify(etat)); } catch (e) {} }
  sauver();
  window.__demo = etat;

  function table(nom) { if (!etat.tables[nom]) etat.tables[nom] = []; return etat.tables[nom]; }
  function requete(nom) {
    const filtres = [];
    let mode = 'select', charge = null, tri = null, limite = null, unique = null, conflit = null;
    const q = {
      select() { return q; },
      eq(c, v) { filtres.push((r) => String(r[c]) === String(v)); return q; },
      neq(c, v) { filtres.push((r) => String(r[c]) !== String(v)); return q; },
      gt(c, v) { filtres.push((r) => r[c] > v); return q; },
      gte(c, v) { filtres.push((r) => r[c] >= v); return q; },
      lt(c, v) { filtres.push((r) => r[c] < v); return q; },
      lte(c, v) { filtres.push((r) => r[c] <= v); return q; },
      in(c, l) { filtres.push((r) => l.map(String).indexOf(String(r[c])) !== -1); return q; },
      is(c, v) { filtres.push((r) => (r[c] === undefined ? null : r[c]) === v); return q; },
      not() { return q; }, or() { return q; }, ilike() { return q; }, match(o) { Object.keys(o).forEach((k) => q.eq(k, o[k])); return q; },
      order(c, o) { tri = { c, asc: !o || o.ascending !== false }; return q; },
      limit(n) { limite = n; return q; },
      range(a, b) { limite = b + 1; return q; },
      single() { unique = 'single'; return q; },
      maybeSingle() { unique = 'maybe'; return q; },
      insert(l) { mode = 'insert'; charge = Array.isArray(l) ? l : [l]; return q; },
      upsert(l, opt) { mode = 'upsert'; charge = Array.isArray(l) ? l : [l]; conflit = opt && opt.onConflict; return q; },
      update(p) { mode = 'update'; charge = p; return q; },
      delete() { mode = 'delete'; return q; },
      then(ok, ko) { return Promise.resolve().then(executer).then(ok, ko); },
      catch(ko) { return q.then(null, ko); },
    };
    const CLES = { fournees: ['commercant_id', 'date_fournee', 'nom_produit'], evenements_commercant: ['commercant_id', 'date_evenement'], parametres_commercant: ['commercant_id'], connexions_caisse: ['commercant_id', 'fournisseur'] };
    function executer() {
      const t = table(nom);
      const garde = (r) => filtres.every((f) => f(r));
      let data;
      if (mode === 'insert') {
        data = charge.map((l) => Object.assign({ id: 'demo-' + Math.random().toString(36).slice(2), created_at: new Date().toISOString() }, l));
        data.forEach((l) => t.push(l));
      } else if (mode === 'upsert') {
        const cles = conflit ? conflit.split(',') : (CLES[nom] || ['id']);
        data = charge.map((l) => {
          const ex = t.find((r) => cles.every((k) => String(r[k]) === String(l[k])));
          if (ex) { Object.assign(ex, l); return ex; }
          const n = Object.assign({}, l); t.push(n); return n;
        });
      } else if (mode === 'update') {
        data = t.filter(garde); data.forEach((r) => Object.assign(r, charge));
      } else if (mode === 'delete') {
        data = t.filter(garde);
        etat.tables[nom] = t.filter((r) => !garde(r));
      } else {
        data = t.filter(garde).map((r) => Object.assign({}, r));
        if (tri) data.sort((a, b) => (a[tri.c] > b[tri.c] ? 1 : a[tri.c] < b[tri.c] ? -1 : 0) * (tri.asc ? 1 : -1));
        if (limite !== null) data = data.slice(0, limite);
      }
      if (mode !== 'select') sauver();
      if (unique) return { data: data[0] || null, error: unique === 'single' && !data[0] ? { message: 'Aucune ligne' } : null };
      return { data, error: null, count: data.length };
    }
    return q;
  }
  const auditeurs = [];
  const client = {
    auth: {
      getSession: () => Promise.resolve({ data: { session: etat.session }, error: null }),
      getUser: () => Promise.resolve({ data: { user: etat.session && etat.session.user }, error: null }),
      signInWithPassword: ({ email }) => {
        const u = etat.inscrit || (etat.session && etat.session.user);
        if (!u || (email && u.email !== email && email !== 'demo')) return Promise.resolve({ data: {}, error: { message: 'Invalid login credentials' } });
        etat.session = { user: u, access_token: 'demo' }; sauver();
        return Promise.resolve({ data: { user: u, session: etat.session }, error: null });
      },
      signUp: ({ email, options }) => {
        const u = { id: '00000000-0000-4000-8000-0000000000bb', email, user_metadata: (options && options.data) || {} };
        etat.session = { user: u, access_token: 'demo' }; etat.tables = { produits: [], ventes: [], fournees: [] }; sauver();
        return Promise.resolve({ data: { user: u, session: etat.session }, error: null });
      },
      signOut: () => { etat.session = null; sauver(); return Promise.resolve({ error: null }); },
      updateUser: (p) => {
        const u = etat.session && etat.session.user;
        if (u && p && p.data) u.user_metadata = Object.assign({}, u.user_metadata, p.data);
        sauver();
        return Promise.resolve({ data: { user: u }, error: null });
      },
      resetPasswordForEmail: () => Promise.resolve({ data: {}, error: null }),
      onAuthStateChange: (cb) => { auditeurs.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      refreshSession: () => Promise.resolve({ data: { session: etat.session }, error: null }),
    },
    from: requete,
    rpc: () => Promise.resolve({ data: null, error: null }),
    functions: {
      invoke: (nom, opts) => {
        const corps = (opts && opts.body) || {};
        // Même format que supabase/functions/connecter-caisse (action etat) :
        // clé personnelle possible pour 6 caisses, pas d'OAuth, pas d'import e-mail.
        if (nom === 'connecter-caisse' && corps.action === 'etat') {
          const cle = ['sumup', 'zettle', 'square', 'loyverse', 'tactill', 'hiboutik'];
          const d = { oauth: { sumup: false, zettle: false, square: false }, cle, email: false };
          cle.forEach((c) => { d[c] = true; });
          return Promise.resolve({ data: d, error: null });
        }
        return Promise.resolve({ data: nom === 'signaux-locaux' ? { signaux: [] } : { ok: true }, error: null });
      },
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel() {},
  };
  window.supabase = { createClient: () => client };
  if (seed.theme) {
    const poser = () => document.documentElement && document.documentElement.setAttribute('data-theme', seed.theme);
    poser(); document.addEventListener('DOMContentLoaded', poser);
  }
}

// ---------- Réseau ----------
async function routes(contexte) {
  await contexte.route(/supabase-js@2|@supabase\/supabase-js/, (r) => r.fulfill({ contentType: 'text/javascript', body: '/* supabase-js remplacé par le harnais de démo */' }));
  await contexte.route(/\.supabase\.co/, (r) => r.abort()); // jamais la vraie base
  // Météo : réponses synthétiques (automne parisien), pour un écran complet.
  await contexte.route(/open-meteo\.com/, (r) => {
    const u = new URL(r.request().url());
    const debut = u.searchParams.get('start_date');
    const fin = u.searchParams.get('end_date');
    const dates = [];
    const d0 = debut ? new Date(debut + 'T12:00:00') : new Date();
    const n = debut && fin ? Math.round((new Date(fin + 'T12:00:00') - d0) / 86400000) + 1 : 8;
    for (let i = 0; i < n; i++) dates.push(iso(jours(d0, i)));
    const rnd = alea(dates.length * 7);
    const daily = { time: dates, temperature_2m_max: dates.map(() => Math.round(10 + rnd() * 8)), temperature_2m_min: dates.map(() => Math.round(4 + rnd() * 5)), precipitation_sum: dates.map(() => (rnd() < 0.3 ? Math.round(rnd() * 80) / 10 : 0)), weathercode: dates.map(() => [1, 2, 3, 61, 3][Math.floor(rnd() * 5)]), weather_code: dates.map(() => [1, 2, 3, 61, 3][Math.floor(rnd() * 5)]) };
    const heures = [];
    dates.forEach((d) => { for (let h = 0; h < 24; h++) heures.push(d + 'T' + String(h).padStart(2, '0') + ':00'); });
    const hourly = { time: heures, temperature_2m: heures.map((t) => { const h = Number(t.slice(11, 13)); return Math.round(9 + 5 * Math.sin((h - 9) / 24 * 2 * Math.PI) + rnd()); }), precipitation: heures.map(() => (rnd() < 0.1 ? 0.6 : 0)), precipitation_probability: heures.map(() => Math.round(rnd() * 60)), weathercode: heures.map(() => 3), weather_code: heures.map(() => 3) };
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ latitude: 48.86, longitude: 2.38, daily, hourly }) });
  });
}

// ---------- Scénarios ----------
const attendre = (p, ms) => p.waitForTimeout(ms);
const SCENARIOS = [
  { nom: 'connexion', url: 'connexion.html', compte: 'deconnecte' },
  { nom: 'inscription', url: 'connexion.html?inscription', compte: 'deconnecte' },
  { nom: 'inscription-erreur', url: 'connexion.html', compte: 'deconnecte', action: async (p) => { await p.fill('#email', 'faux@exemple.fr'); await p.fill('#motdepasse', 'mauvais-mdp'); await p.click('#btnAction'); await attendre(p, 400); } },
  { nom: 'reinitialiser', url: 'reinitialiser-mot-de-passe.html', compte: 'deconnecte' },
  { nom: 'fournee', url: 'previsions.html', compte: 'comptoire' },
  { nom: 'fournee-demain', url: 'previsions.html', compte: 'comptoire', action: async (p) => { const b = p.locator('[data-jour="demain"]'); if (await b.isVisible()) { await b.click(); await attendre(p, 500); } } },
  { nom: 'fournee-pourquoi', url: 'previsions.html', compte: 'comptoire', action: async (p) => { const d = p.locator('#listeRayons details').first(); if (await d.count()) { await d.locator('summary').click(); await attendre(p, 300); } } },
  { nom: 'fournil', url: 'previsions.html', compte: 'comptoire', action: async (p) => { await p.click('#btnEcranFournil'); await attendre(p, 500); } },
  { nom: 'commande', url: 'commandes.html', compte: 'comptoire' },
  { nom: 'semaine', url: 'semaine.html', compte: 'comptoire' },
  { nom: 'bilan', url: 'statistiques.html', compte: 'comptoire' },
  { nom: 'bilan-detail', url: 'statistiques.html', compte: 'comptoire', action: async (p) => { for (const s of await p.locator('details > summary').all()) { if (await s.isVisible()) await s.click().catch(() => {}); } await attendre(p, 300); } },
  { nom: 'caisse', url: 'caisse.html', compte: 'comptoire' },
  { nom: 'parametres', url: 'parametres.html', compte: 'comptoire' },
  { nom: 'ventes', url: 'ventes.html', compte: 'comptoire' },
  { nom: 'produits', url: 'produits.html', compte: 'comptoire' },
  { nom: 'menu-compte', url: 'previsions.html', compte: 'comptoire', action: async (p) => { await p.click('.btn-compte'); await attendre(p, 200); } },
  { nom: 'sombre-fournee', url: 'previsions.html', compte: 'comptoire', theme: 'dark' },
  { nom: 'sombre-bilan', url: 'statistiques.html', compte: 'comptoire', theme: 'dark' },
  { nom: 'sombre-commande', url: 'commandes.html', compte: 'comptoire', theme: 'dark' },
  { nom: 'nouveau-fournee', url: 'previsions.html', compte: 'nouveau' },
  { nom: 'nouveau-commande', url: 'commandes.html', compte: 'nouveau' },
  { nom: 'nouveau-semaine', url: 'semaine.html', compte: 'nouveau' },
  { nom: 'nouveau-bilan', url: 'statistiques.html', compte: 'nouveau' },
  { nom: 'nouveau-caisse', url: 'caisse.html', compte: 'nouveau' },
  { nom: 'nouveau-parametres', url: 'parametres.html', compte: 'nouveau' },
  { nom: 'deconnecte-fournee', url: 'previsions.html', compte: 'deconnecte' },
  // Parcours du critère 1 : inscription → caisse → Fournée → Commande → Semaine → Bilan.
  { nom: 'parcours', url: 'connexion.html?inscription', compte: 'deconnecte', parcours: true },
];

// ---------- Contrôles automatiques ----------
const MOTS_TECHNIQUES = /\b(undefined|null|NaN|Infinity|object Object|error|erreur inconnue|supabase|token|jeton|session|api|json|uuid|id produit|commercant_id|edge function|rls|stub|timeout|fetch|http|bug|debug|console|localStorage|invalid|failed|login)\b/i;
async function controler(page) {
  return page.evaluate((motsSrc) => {
    const mots = new RegExp(motsSrc, 'i');
    const W = document.documentElement.clientWidth;
    const pb = [];
    if (document.documentElement.scrollWidth > W + 1) pb.push('Débordement horizontal : page de ' + document.documentElement.scrollWidth + ' px pour ' + W + ' px');
    const visibles = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0; };
    const dehors = new Set();
    document.querySelectorAll('body *').forEach((el) => {
      if (!visibles(el)) return;
      const r = el.getBoundingClientRect();
      if (r.right > W + 1 && !el.closest('[class*="tableau"], .table-scroll, table, pre') && getComputedStyle(el).position !== 'fixed') {
        let parent = el.parentElement, scroll = false;
        while (parent) { const ov = getComputedStyle(parent).overflowX; if (ov === 'auto' || ov === 'scroll' || ov === 'hidden') { scroll = true; break; } parent = parent.parentElement; }
        if (!scroll) dehors.add((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + [...el.classList].join('.')) + ' (' + Math.round(r.right) + ' px)');
      }
      // Texte coupé : contenu plus large que la boîte sans défilement prévu.
      const s = getComputedStyle(el);
      if (el.children.length === 0 && el.textContent.trim() && r.width > 2 && r.height > 2 && el.scrollWidth > el.clientWidth + 2 && (s.overflow === 'hidden' || s.textOverflow === 'ellipsis') && s.overflowX !== 'auto')
        pb.push('Texte coupé : « ' + el.textContent.trim().slice(0, 50) + ' »');
    });
    [...dehors].slice(0, 8).forEach((d) => pb.push('Sort de l\'écran : ' + d));
    const petits = [];
    document.querySelectorAll('button, a.bouton-principal, a.bouton-secondaire, [role="button"], input[type="checkbox"], input[type="radio"], select, input:not([type="hidden"]), .nav-onglet, summary').forEach((el) => {
      if (!visibles(el) || el.closest('.menu-compte:not(.ouvert)')) return;
      const r = el.getBoundingClientRect();
      // Une case dans un <label> cliquable compte pour la taille du label.
      const lab = el.closest('label') || (el.id && document.querySelector('label[for="' + el.id + '"]'));
      const rr = lab && (el.type === 'checkbox' || el.type === 'radio' || el.type === 'file') ? lab.getBoundingClientRect() : r;
      if (rr.height < 43.5 || rr.width < 43.5) petits.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '')) + ' « ' + (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 30) + ' » ' + Math.round(rr.width) + '×' + Math.round(rr.height));
    });
    if (petits.length) pb.push('Cibles < 44 px (' + petits.length + ') : ' + [...new Set(petits)].slice(0, 12).join(' ; '));
    const texte = document.body.innerText;
    const lignesSuspectes = texte.split('\n').filter((l) => mots.test(l)).slice(0, 10);
    lignesSuspectes.forEach((l) => pb.push('Mot suspect : « ' + l.trim().slice(0, 120) + ' »'));
    if (texte.trim().length < 80) pb.push('Écran presque vide (' + texte.trim().length + ' caractères)');
    if (/Chargement…/.test(texte)) pb.push('« Chargement… » encore affiché');
    return pb;
  }, MOTS_TECHNIQUES.source);
}

// ---------- Serveur statique ----------
function serveur() {
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
  const s = http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    const f = path.join(ROOT, u);
    if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); res.end('Introuvable'); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((ok) => s.listen(PORT, '127.0.0.1', () => ok(s)));
}

async function attendreCalme(page) {
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function lancer(browser, sc, format, rapport) {
  const auj = new Date(); auj.setHours(0, 0, 0, 0);
  const seed = Object.assign({}, COMPTES[sc.compte](auj), { theme: sc.theme || null });
  const contexte = await browser.newContext(Object.assign({ locale: 'fr-FR', timezoneId: 'Europe/Paris' }, VIEWPORTS[format]));
  await routes(contexte);
  await contexte.addInitScript(fauxSupabase, seed);
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push('[console ' + m.type() + '] ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => erreurs.push('[exception] ' + e.message.slice(0, 200)));
  page.on('requestfailed', (r) => { if (!/supabase\.co/.test(r.url())) erreurs.push('[réseau] ' + r.url().slice(0, 120) + ' ' + (r.failure() || {}).errorText); });
  const etapes = [];
  async function capturer(nom) {
    await attendreCalme(page);
    const base = path.join(SORTIE, nom + '-' + format);
    await page.screenshot({ path: base + '.png', fullPage: true });
    const texte = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync(base + '.txt', texte);
    const pb = await controler(page);
    etapes.push({ nom, url: page.url().replace(BASE + '/', ''), pb });
  }
  try {
    await page.goto(BASE + '/' + sc.url);
    if (sc.parcours) {
      await capturer('parcours-1-inscription');
      await page.fill('#email', 'contact@lepetitcomptoire.fr');
      await page.fill('#motdepasse', 'croissant2026');
      if (await page.locator('#caseCgu').count()) await page.check('#caseCgu');
      await page.click('#btnAction');
      await page.waitForURL(/previsions/, { timeout: 8000 }).catch(() => {});
      await capturer('parcours-2-premiere-fournee');
      // On passe sur le compte rempli (caisse branchée depuis 3 semaines).
      await page.evaluate((s) => { sessionStorage.setItem('__demo_db', JSON.stringify({ session: { user: s.user, access_token: 'demo' }, tables: s.tables })); }, COMPTES.comptoire(auj));
      for (const [n, u] of [['3-caisse', 'caisse.html'], ['4-fournee', 'previsions.html'], ['5-commande', 'commandes.html'], ['6-semaine', 'semaine.html'], ['7-bilan', 'statistiques.html']]) {
        await page.goto(BASE + '/' + u);
        await capturer('parcours-' + n);
      }
    } else {
      await attendreCalme(page);
      if (sc.action) await sc.action(page);
      if (evaluer) console.log(sc.nom + ' [' + format + '] ', JSON.stringify(await page.evaluate(evaluer)));
      await capturer(sc.nom);
    }
  } catch (e) {
    erreurs.push('[harnais] ' + e.message.split('\n')[0]);
  }
  await contexte.close();
  etapes.forEach((e, i) => rapport.push({ nom: e.nom, format, url: e.url, pb: e.pb, erreurs: i === etapes.length - 1 ? erreurs : [] }));
  if (!etapes.length) rapport.push({ nom: sc.nom, format, url: sc.url, pb: [], erreurs });
}

async function main() {
  if (args.includes('--liste')) { SCENARIOS.forEach((s) => console.log(s.nom + '  (' + s.url + ', ' + s.compte + ')')); return; }
  fs.mkdirSync(SORTIE, { recursive: true });
  const choisis = SCENARIOS.filter((s) => !filtrePage || s.nom.includes(filtrePage) || s.url.includes(filtrePage));
  if (!choisis.length) { console.error('Aucun scénario pour « ' + filtrePage + ' ». node tests/demo.mjs --liste'); process.exit(1); }
  const srv = await serveur();
  const browser = await chromium.launch();
  const rapport = [];
  try {
    for (const sc of choisis) for (const f of formats) await lancer(browser, sc, f, rapport);
  } finally {
    await browser.close();
    srv.close();
  }
  const lignes = [];
  rapport.forEach((r) => {
    const tout = r.pb.concat(r.erreurs);
    lignes.push((tout.length ? '✗ ' : '✓ ') + r.nom + ' [' + r.format + '] ' + r.url);
    tout.forEach((p) => lignes.push('    ' + p));
  });
  const texte = lignes.join('\n') + '\n';
  const fichier = path.join(SORTIE, filtrePage ? 'rapport-' + filtrePage + '.txt' : 'rapport.txt');
  fs.writeFileSync(fichier, texte);
  console.log(texte + '\nCaptures et textes : ' + SORTIE + '  (rapport : ' + fichier + ')');
}

main().catch((e) => { console.error(e); process.exit(1); });
