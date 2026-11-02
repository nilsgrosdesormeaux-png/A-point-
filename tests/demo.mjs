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
    ...commandesClients(aujourdhui),
    connexions_caisse: [{ commercant_id: ID, fournisseur: 'sumup', statut: 'active', compte_caisse: 'MCXK42', debut_historique: iso(jours(aujourdhui, -63)), derniere_synchro: synchro.toISOString(), derniere_date_synchronisee: iso(jours(aujourdhui, -1)), nb_lignes_derniere_synchro: 15, derniere_erreur: null, created_at: brancheLe.toISOString() }],
    journal_caisse: journal,
  };
}

// Commandes clients : mairie aujourd'hui, café chaque vendredi, cantine hors
// vacances, bûche modifiée pour demain (alerte), bûches de l'an dernier
// (180 commandées, 20 refusées). Option noel : 200 bûches du 20 au 24 déc.
const ID_VENDEUSE = '00000000-0000-4000-8000-0000000000e1';
const ID_APPRENTI = '00000000-0000-4000-8000-0000000000e2';
function commandesClients(auj, noel) {
  const t = (d, h) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x.toISOString(); };
  const base = { commercant_id: ID, client_telephone: null, heure_retrait: null, acompte_statut: 'aucun', acompte_montant: 0, jours_recurrence: null, date_fin: null, dates_sautees: [], dates_retirees: [], statut: 'active', parfum: null, taille: null, sauf_vacances: false, sms_envois: {} };
  const c = (id, o, creeIlYa = 5) => Object.assign({}, base, { id: 'cc-' + id, cree_le: t(jours(auj, -creeIlYa), 9), modifie_le: t(jours(auj, -creeIlYa), 9), maj_le: t(jours(auj, -creeIlYa), 9) }, o);
  const l = [
    c('mairie', { client_nom: 'Mairie', client_telephone: '01 43 55 10 10', produit: 'Pain au chocolat', quantite: 40, date_retrait: iso(auj), heure_retrait: '11:30:00', acompte_statut: 'encaisse', acompte_montant: 20 }),
    c('cafe', { client_nom: 'Café du coin', client_telephone: '06 12 34 56 78', produit: 'Sandwich jambon-beurre', quantite: 120, date_retrait: iso(jours(auj, -30)), jours_recurrence: [5] }, 31),
    c('cantine', { client_nom: 'Cantine Jules-Ferry', produit: 'Baguette', quantite: 60, date_retrait: iso(jours(auj, -30)), jours_recurrence: [2, 4], sauf_vacances: true }, 31),
    c('martin', { client_nom: 'Mme Martin', client_telephone: '06 98 76 54 32', produit: 'Bûche', parfum: 'Praliné', taille: '6 parts', quantite: 1, date_retrait: iso(jours(auj, 1)), heure_retrait: '10:00:00', acompte_statut: 'a_encaisser', acompte_montant: 10,
      modifie_le: new Date(Date.now() - 3600000).toISOString(), maj_le: new Date(Date.now() - 3600000).toISOString() }, 3),
    c('durand', { client_nom: 'M. Durand', client_telephone: '07 11 22 33 44', produit: 'Pièce montée', quantite: 1, date_retrait: iso(jours(auj, 6)), heure_retrait: '15:00:00', acompte_statut: 'encaisse', acompte_montant: 60 }),
  ];
  const parfums = ['Praliné', 'Chocolat', 'Framboise', 'Marrons', 'Café', 'Vanille'];
  const tailles = ['4 parts', '6 parts', '8 parts'];
  const an = auj.getFullYear() - 1;
  for (let k = 0; k < 36; k++) l.push(c('an-' + k, { client_nom: 'Client ' + (k + 1), produit: 'Bûche', parfum: parfums[k % 6], taille: tailles[k % 3], quantite: 5, date_retrait: an + '-12-' + (20 + (k % 5)) }, 400));
  for (let k = 0; k < 4; k++) l.push(c('refus-' + k, { client_nom: 'Demande refusée', produit: 'Bûche', quantite: 5, date_retrait: an + '-12-24', statut: 'refusee' }, 400));
  if (noel) {
    const noms = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier'];
    for (let k = 0; k < 200; k++) {
      const d = 20 + (k % 5);
      l.push(c('noel-' + k, { client_nom: (k % 2 ? 'Mme ' : 'M. ') + noms[k % 20] + (k >= 20 ? ' ' + (Math.floor(k / 20) + 1) : ''), client_telephone: '06 ' + String(10 + (k % 89)).padStart(2, '0') + ' ' + String(k).padStart(2, '0') + ' 12 34',
        produit: 'Bûche', parfum: parfums[k % 6], taille: tailles[(k * 7) % 3], quantite: 1 + (k % 3 === 0 ? 1 : 0), date_retrait: auj.getFullYear() + '-12-' + d,
        heure_retrait: String(8 + (k % 10)).padStart(2, '0') + ':' + (k % 2 ? '30' : '00') + ':00', acompte_statut: k % 4 === 0 ? 'a_encaisser' : 'encaisse', acompte_montant: 10 }, 30));
    }
  }
  return {
    commandes_clients: l,
    commandes_catalogue: [
      { commercant_id: ID, produit: 'Bûche', parfums, tailles, prix_tailles: { '4 parts': 22, '6 parts': 32, '8 parts': 42 } },
      { commercant_id: ID, produit: 'Galette des rois', parfums: ['Frangipane', 'Pomme', 'Chocolat'], tailles: ['4 parts', '6 parts', '8 parts'], prix_tailles: { '4 parts': 16, '6 parts': 24, '8 parts': 32 } },
    ],
    personnel: [
      { id: 'pers-1', commercant_id: ID, prenom: 'Julie', nom: 'Petit', role: 'Vendeuse', user_id: ID_VENDEUSE, acces_app: 'vendeuse', statut_compte: 'actif' },
      { id: 'pers-2', commercant_id: ID, prenom: 'Léo', nom: 'Marchand', role: 'Apprenti', user_id: ID_APPRENTI, acces_app: 'apprenti', statut_compte: 'actif' },
    ],
  };
}

// Savoir-faire de boulangerie.js (recettes types), chargé tel quel.
import vm from 'vm';
let _B = null;
function boulangerie() {
  if (!_B) { const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'boulangerie.js'), 'utf8'), ctx); _B = ctx.window.Boulangerie; }
  return _B;
}

// Ventes heure par heure : 8 semaines d'historique (courbe d'un jour de
// boutique), et aujourd'hui une matinée bien plus forte sur la tradition.
function ventesHoraires(auj) {
  const r = alea(424242), lignes = [];
  const courbe = [0, 0, 0, 0, 0, 0, 0, 0.10, 0.14, 0.12, 0.09, 0.08, 0.11, 0.08, 0.04, 0.03, 0.04, 0.07, 0.07, 0.03, 0, 0, 0, 0];
  const produits = [['Baguette tradition', 185], ['Croissant', 72], ['Pain au chocolat', 84]];
  for (let k = 1; k <= 56; k++) {
    const d = jours(auj, -k);
    if (d.getDay() === 1) continue;
    const facteur = [1.35, 0, 1, 0.95, 1, 1.05, 1.25][d.getDay()];
    produits.forEach(([nom, base]) => courbe.forEach((part, h) => {
      const q = Math.round(base * facteur * part * (0.9 + r() * 0.2));
      if (q > 0) lignes.push({ commercant_id: ID, date_vente: iso(d), heure: h, nom_produit: nom, quantite: q });
    }));
  }
  // Aujourd'hui jusqu'à 10 h : la tradition part deux fois plus vite.
  const facteurJour = [1.35, 0, 1, 0.95, 1, 1.05, 1.25][auj.getDay()];
  [7, 8, 9].forEach((h) => produits.forEach(([nom, base]) => {
    const vite = nom === 'Baguette tradition' ? 2.1 : 1;
    lignes.push({ commercant_id: ID, date_vente: iso(auj), heure: h, nom_produit: nom, quantite: Math.round(base * facteurJour * courbe[h] * vite) });
  }));
  return lignes;
}

const COMPTES = {
  comptoire: (auj) => ({
    user: { id: ID, email: 'contact@lepetitcomptoire.fr', user_metadata: { prenom: 'Martine', caisse: 'sumup', reference_avant: { production: 900, reste: 110, dons: true }, fournees: { ouverture: '07:00', tranches: [{ nom: 'Avant l\'ouverture', heure: '05:30' }, { nom: 'Mi-matinée', heure: '09:30' }, { nom: 'Réassort de midi', heure: '11:30' }] } } },
    tables: genererComptoire(auj),
  }),
  nouveau: () => ({
    user: { id: ID_NOUVEAU, email: 'nouveau@boulangerie.fr', user_metadata: { caisse: 'sumup', reference_avant: { production: 600, reste: 60, dons: false } } },
    tables: { produits: [], categories_produit: [], ventes: [], fournees: [], ingredients_produit: [], parametres_commercant: [], evenements_commercant: [], connexions_caisse: [], journal_caisse: [] },
  }),
  deconnecte: (auj) => ({ user: null, inscrit: COMPTES.comptoire(auj).user, tables: COMPTES.comptoire(auj).tables }),
  // Commandes clients : table pas encore créée, vendeuse, apprenti, Noël.
  'sans-table': (auj) => Object.assign(COMPTES.comptoire(auj), { absentes: ['commandes_clients', 'commandes_catalogue'] }),
  vendeuse: (auj) => Object.assign(COMPTES.comptoire(auj), { user: { id: ID_VENDEUSE, email: 'julie@lepetitcomptoire.fr', user_metadata: {} } }),
  apprenti: (auj) => Object.assign(COMPTES.comptoire(auj), { user: { id: ID_APPRENTI, email: 'leo@lepetitcomptoire.fr', user_metadata: {} } }),
  noel: (auj) => { const c = COMPTES.comptoire(auj); Object.assign(c.tables, commandesClients(auj, true)); return c; },
  // Lot 12 : alerte rupture (ventes heure par heure), produit de saison à fixer, congés.
  alerte: (auj) => { const c = COMPTES.comptoire(auj); c.tables.ventes_horaires = ventesHoraires(auj); return c; },
  saison: (auj) => { const c = COMPTES.comptoire(auj); c.tables.produits.push({ id: 'prod-galette', commercant_id: ID, nom: 'Galette des rois', prix_vente: 18, categorie_id: 'cat-2', created_at: iso(auj) + 'T08:00:00Z' }); return c; },
  conges: (auj) => {
    const c = COMPTES.comptoire(auj);
    Object.assign(c.tables.parametres_commercant[0], {
      conges: [{ debut: iso(jours(auj, 1)), fin: iso(jours(auj, 9)) }, { debut: '2027-08-02', fin: '2027-08-22' }],
      feries_fermes: ['1-mai', 'noel', 'jour-an'],
      periodes_exceptionnelles: [{ debut: iso(jours(auj, -30)), fin: iso(jours(auj, -26)), libelle: 'Travaux dans la rue' }],
    });
    return c;
  },
  'hors-periode': (auj) => { const c = COMPTES.comptoire(auj); c.tables.commandes_clients = c.tables.commandes_clients.filter((x) => x.id.startsWith('cc-an-') || x.id.startsWith('cc-refus-')); return c; },
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
      // Hors connexion (Playwright setOffline) : comme supabase-js, une erreur réseau.
      if (navigator.onLine === false) return { data: null, error: { message: 'TypeError: Failed to fetch' } };
      if ((seed.absentes || []).includes(nom)) return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public." + nom + "' in the schema cache" } };
      // RLS de migration-commandes-clients.sql, en résumé : ce qu'un employé ne lit ni n'écrit pas.
      const uid = etat.session && etat.session.user.id;
      const fiche = (etat.tables.personnel || []).find((x) => x.user_id === uid && x.commercant_id !== uid);
      const BLOQUEES = { vendeuse: ['produits', 'ingredients_produit', 'connexions_caisse', 'journal_caisse', 'categories_produit'],
        apprenti: ['produits', 'ingredients_produit', 'connexions_caisse', 'journal_caisse', 'categories_produit', 'commandes_clients', 'commandes_clients_historique', 'commandes_catalogue'] };
      if (fiche && fiche.acces_app !== 'associe' && nom !== 'personnel' && nom !== 'parametres_commercant' && (!BLOQUEES[fiche.acces_app] || BLOQUEES[fiche.acces_app].includes(nom))) {
        return mode === 'select' ? { data: unique ? null : [], error: null } : { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
      }
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
    rpc: (nom, args) => {
      // Production des commandes pour l'apprenti : sans nom, téléphone ni euros.
      if (nom === 'commandes_production') {
        if ((seed.absentes || []).includes('commandes_clients')) return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function in the schema cache' } });
        const champs = ['id', 'produit', 'parfum', 'taille', 'quantite', 'date_retrait', 'heure_retrait', 'jours_recurrence', 'date_fin', 'dates_sautees', 'sauf_vacances', 'statut'];
        return Promise.resolve({ data: table('commandes_clients').filter((c) => c.commercant_id === args.p_commercant && c.statut === 'active').map((c) => Object.fromEntries(champs.map((k) => [k, c[k]]))), error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
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
  // Calendrier scolaire officiel (dates simulées au-delà de la liste du moteur) : vide.
  await contexte.route(/data\.education\.gouv\.fr/, (r) => r.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"results":[]}' }));
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
  // Lot 11 : ouvrir puis fermer « Je sais quelque chose… » ne doit rien faire sauter.
  { nom: 'fournee-repli', url: 'previsions.html', compte: 'comptoire', action: async (p) => {
    const s = p.locator('#actionsAffluence summary');
    const pos = async () => p.evaluate(() => ['#titreFournee', '#actionsAffluence summary', '#listeRayons'].map((q) => Math.round(document.querySelector(q).getBoundingClientRect().top)).join('/') + ' y=' + Math.round(scrollY));
    const releves = ['avant ' + await pos()];
    await s.tap().catch(() => s.click());
    for (const t of [0, 100, 300]) { await p.waitForTimeout(t); releves.push('ouvert+' + t + ' ' + await pos()); await p.screenshot({ path: path.join(SORTIE, 'fournee-repli-ouvert-' + t + '.png') }); }
    await s.tap().catch(() => s.click());
    await p.waitForTimeout(200); releves.push('fermé ' + await pos());
    const tops = releves.map((r) => r.split(' ')[1].split('/').slice(0, 2).join('/'));
    if (new Set(tops).size > 1) throw new Error('Le repli fait bouger la page : ' + releves.join(' | '));
    await s.tap().catch(() => s.click());
  } },
  // Lot 12
  { nom: 'alerte-rupture', url: 'previsions.html', compte: 'alerte', date: '2026-11-03T10:05:00' },
  { nom: 'alerte-sans-table', url: 'previsions.html', compte: 'comptoire', date: '2026-11-03T10:05:00' },
  { nom: 'saison-a-fixer', url: 'previsions.html', compte: 'saison', date: '2027-01-05T08:00:00' },
  { nom: 'conges-fournee', url: 'previsions.html', compte: 'conges', date: '2026-11-03T15:00:00' },
  { nom: 'conges-parametres', url: 'parametres.html', compte: 'conges', date: '2026-11-03T15:00:00', action: async (p) => { await p.locator('#fermetures').scrollIntoViewIfNeeded(); } },
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
  // Commandes clients
  { nom: 'commandes-clients', url: 'commandes-clients.html', compte: 'comptoire' },
  { nom: 'commandes-clients-saisie', url: 'commandes-clients.html', compte: 'comptoire', action: async (p) => {
    await p.fill('#cNom', 'Mme Leroy'); await p.fill('#cTel', '0612345678'); await p.click('[data-produit="Bûche"]');
    await p.click('[data-parfum="Chocolat"]'); await p.click('[data-taille="8 parts"]'); await p.fill('#cQuantite', '2'); await p.fill('#cHeure', '11:30'); await attendre(p, 200);
  } },
  { nom: 'commandes-clients-hors-ligne', url: 'commandes-clients.html', compte: 'comptoire', action: async (p) => {
    await p.context().setOffline(true);
    await p.fill('#cNom', 'École'); await p.fill('#cProduit', 'Croissant'); await p.fill('#cQuantite', '30'); await p.click('#btnEnregistrer'); await attendre(p, 300);
  } },
  { nom: 'commandes-clients-vendeuse', url: 'commandes-clients.html', compte: 'vendeuse' },
  { nom: 'commandes-clients-apprenti', url: 'commandes-clients.html', compte: 'apprenti' },
  // Rôles : la vendeuse et l'apprenti n'ont que la Fournée (le reste redirige).
  ...['previsions.html', 'statistiques.html', 'commandes.html', 'semaine.html', 'caisse.html', 'parametres.html'].flatMap((u) => ['vendeuse', 'apprenti'].map((r) => ({ nom: r + '-' + u.replace('.html', ''), url: u, compte: r }))),
  { nom: 'commandes-clients-bientot', url: 'commandes-clients.html', compte: 'sans-table' },
  { nom: 'fournee-sans-table', url: 'previsions.html', compte: 'sans-table' },
  { nom: 'fournee-hors-periode', url: 'previsions.html', compte: 'hors-periode' },
  { nom: 'commandes-clients-noel', url: 'commandes-clients.html', compte: 'noel', date: '2026-12-24T05:00:00', action: async (p) => { await p.fill('#recherche', 'be'); await attendre(p, 200); } },
  { nom: 'fournee-noel', url: 'previsions.html', compte: 'noel', date: '2026-12-24T05:00:00' },
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
  const auj = sc.date ? new Date(sc.date) : new Date(); auj.setHours(0, 0, 0, 0);
  const seed = Object.assign({}, COMPTES[sc.compte](auj), { theme: sc.theme || null });
  const contexte = await browser.newContext(Object.assign({ locale: 'fr-FR', timezoneId: 'Europe/Paris' }, VIEWPORTS[format]));
  await routes(contexte);
  await contexte.addInitScript(fauxSupabase, seed);
  const page = await contexte.newPage();
  if (sc.date) await page.clock.setFixedTime(new Date(sc.date));
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

// Réutilisé par tests/commandes-clients.test.mjs (import sans lancer la démo).
export { COMPTES, fauxSupabase, routes, serveur, BASE, ID, ID_VENDEUSE, ID_APPRENTI, iso, jours };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
