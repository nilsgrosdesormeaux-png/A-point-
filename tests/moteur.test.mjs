// Tests du moteur de prévision (plan v2) : node --test tests/moteur.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

globalThis.window = {};
createRequire(import.meta.url)('../moteur-prevision.js');
const MP = globalThis.window.MoteurPrevision;

function jour(iso) { return new Date(iso + 'T00:00:00'); }

// Un an de samedis : 100 baguettes, sauf les samedis de galettes (2 au 15 janvier) à 150.
function historiqueSamedis(nom, normal, special, estSpecial) {
  const ventes = [];
  let d = jour('2025-11-01');
  while (d < jour('2027-01-01')) {
    if (d.getDay() === 6) {
      const iso = MP.versISO(d);
      ventes.push({ nom_produit: nom, date_vente: iso, quantite: estSpecial(d) ? special : normal });
    }
    d = MP.ajouterJours(d, 1);
  }
  return ventes;
}

test('calendrier boulanger : dates clés', () => {
  assert.equal(MP.feteBoulangere(jour('2027-01-06')).cle, 'epiphanie');
  assert.equal(MP.feteBoulangere(jour('2027-02-02')).cle, 'chandeleur');
  assert.equal(MP.feteBoulangere(jour('2027-03-28')).cle, 'paques');
  assert.equal(MP.feteBoulangere(jour('2027-05-30')).cle, 'fete-meres');
  assert.equal(MP.feteBoulangere(jour('2026-05-31')).cle, 'fete-meres');
  assert.equal(MP.feteBoulangere(jour('2027-12-24')).cle, 'noel');
  assert.equal(MP.feteBoulangere(jour('2027-03-10')), null);
});

test('ponts : vendredi après jeudi férié, lundi avant mardi férié', () => {
  assert.equal(MP.estPont(jour('2026-05-15')), true);   // Ascension jeudi 14
  assert.equal(MP.estPont(jour('2026-05-08')), false);  // le férié lui-même
  assert.equal(MP.estPont(jour('2027-11-12')), true);   // 11 nov. 2027 = jeudi
  assert.equal(MP.estPont(jour('2026-03-13')), false);
});

test("l'effet des galettes est appris sur l'historique et appliqué", () => {
  const estGalette = d => { const f = MP.feteBoulangere(d); return !!f && f.cle === 'epiphanie'; };
  const ventes = historiqueSamedis('Galette des rois', 100, 150, estGalette);
  const cible = jour('2027-01-09');
  const r = MP.calculerRecommandation(ventes, cible, null, {}, {}, {});
  const sig = r.signaux.find(s => s.cle === 'epiphanie');
  assert.ok(sig, 'signal Épiphanie présent');
  assert.ok(sig.ratio > 1.2, 'effet appris > +20 % : ' + sig.ratio);
  assert.ok(r.quantite > Math.round(100 * MP.MARGE_PRODUCTION), 'quantité relevée : ' + r.quantite);
});

test('sans historique du signal : affiché sans effet, quantité inchangée', () => {
  const ventes = historiqueSamedis('Baguette', 100, 100, () => false).filter(v => v.date_vente >= '2026-06-01');
  const r = MP.calculerRecommandation(ventes, jour('2027-01-09'), null, {}, {}, {});
  const sig = r.signaux.find(s => s.cle === 'epiphanie');
  assert.ok(sig);
  assert.equal(sig.ratio, null);
  assert.equal(r.quantite, Math.round(100 * MP.MARGE_PRODUCTION));
});

test('signaux externes absents : ignorés sans erreur', () => {
  const ventes = historiqueSamedis('Baguette', 100, 100, () => false);
  const r = MP.calculerRecommandation(ventes, jour('2026-12-05'), null, {}, {}, {}, undefined);
  assert.deepEqual(r.signaux, []);
});

test('la précision se mesure sans la marge de production', () => {
  const ventes = historiqueSamedis('Baguette', 100, 100, () => false);
  assert.equal(MP.calculerFiabilite(ventes).valeur, 100);
  assert.equal(MP.calculerEcartUnites(ventes).ecart, 1); // plancher à 1 pièce
});

test('fiabilité en unités : écart moyen réaliste', () => {
  const ventes = historiqueSamedis('Baguette', 100, 100, () => false).map((v, i) => ({ ...v, quantite: 100 + (i % 2 ? 4 : -4) }));
  const e = MP.calculerEcartUnites(ventes);
  assert.ok(e.ecart >= 3 && e.ecart <= 6, 'écart ' + e.ecart);
});

test('comparaison avec la moyenne simple seulement au-delà de 3 points', () => {
  assert.equal(MP.comparaisonUtile({ valeur: 88 }, { valeur: 87, nbPoints: 10 }), false);
  assert.equal(MP.comparaisonUtile({ valeur: 90 }, { valeur: 85, nbPoints: 10 }), true);
});

createRequire(import.meta.url)('../boulangerie.js');
const B = globalThis.window.Boulangerie;

test('rayons déduits du nom', () => {
  const cas = { 'Baguette tradition': 'Pains', 'Pain de campagne': 'Pains', 'Pain au chocolat': 'Viennoiseries', 'CROISSANT': 'Viennoiseries',
    'Éclair au café': 'Pâtisseries', 'Flan pâtissier': 'Pâtisseries', 'Sandwich jambon-beurre': 'Snacking', 'Café': 'Boissons',
    'Chocolat chaud': 'Boissons', 'Galette des rois': 'Pâtisseries', 'Truc inconnu': 'Autres' };
  for (const [nom, rayon] of Object.entries(cas)) assert.equal(B.deduireRayon(nom), rayon, nom);
});

test('fournisseurs et unités lisibles', () => {
  assert.equal(B.fournisseurPour('Farine T65').cle, 'meunier');
  assert.equal(B.fournisseurPour('Œufs').cle, 'cremier');
  assert.equal(B.fournisseurPour('Beurre de tourage').cle, 'cremier');
  assert.equal(B.fournisseurPour('Barres de chocolat').cle, 'epicerie');
  const base = B.versUniteBase(65500, 'g');
  assert.equal(B.formaterQuantite(base.quantite, base.unite, 'Salade'), '65,5 kg');
  assert.equal(B.formaterQuantite(37.2, 'kg', 'Farine T65'), '37,2 kg (≈ 1,5 sacs de 25 kg)');
  assert.equal(B.formaterQuantite(64, 'pièce', 'Œufs'), '64 œufs (≈ 2,5 plaques de 30)');
});

test('invendus réels : cuit 120, vendu 112 → 8', () => {
  const fournees = [{ date_fournee: '2026-10-29', nom_produit: 'Baguette tradition', quantite_cuite: 120 }];
  const ventes = [{ date_vente: '2026-10-29', nom_produit: 'baguette tradition', quantite: 100 }, { date_vente: '2026-10-29', nom_produit: 'Baguette tradition', quantite: 12 }];
  const r = MP.calculerInvendusReels(fournees, ventes, '2026-10-01', '2026-10-30');
  assert.equal(r.invendus, 8);
  assert.equal(r.nbJours, 1);
});

test('invendus réels : jour sans ventes ou sans fournée ignoré', () => {
  const fournees = [{ date_fournee: '2026-10-30', nom_produit: 'Croissant', quantite_cuite: 50 }];
  const ventes = [{ date_vente: '2026-10-29', nom_produit: 'Croissant', quantite: 40 }];
  const r = MP.calculerInvendusReels(fournees, ventes, '2026-10-01', '2026-10-31');
  assert.equal(r.nbJours, 0);
  assert.equal(r.invendus, 0);
  assert.equal(MP.calculerInvendusReels([], ventes, '2026-10-01', '2026-10-31').nbJours, 0);
});

test('doublons : une ligne par produit et par jour, la plus récente', () => {
  const v = MP.dedoublonnerVentes([
    { id: 1, nom_produit: 'Croissant', date_vente: '2026-07-01', quantite: 26, created_at: '2026-09-09T20:56' },
    { id: 2, nom_produit: 'CROISSANT', date_vente: '2026-07-01', quantite: 26, created_at: '2026-09-09T21:56' },
    { id: 3, nom_produit: 'croissants', date_vente: '2026-07-02', quantite: 30, created_at: '2026-09-09T21:56' },
    { id: 4, nom_produit: 'Croissant', date_vente: '2026-07-03', quantite: 20, created_at: '2026-09-09T21:56' }
  ]);
  assert.equal(v.length, 3);
  assert.deepEqual([...new Set(v.map(x => x.nom_produit))], ['Croissant']);
  assert.equal(v.find(x => x.date_vente === '2026-07-01').quantite, 26);
});

// Samedis d'été (vacances, zone A) à 120, samedis hors vacances à 80.
function samedisEteEtHors() {
  const ventes = [];
  let d = jour('2026-05-02');
  while (d < jour('2026-10-17')) {
    if (d.getDay() === 6) {
      ventes.push({ nom_produit: 'Baguette', date_vente: MP.versISO(d), quantite: MP.estEnVacances(d, 'A') ? 120 : 80 });
    }
    d = MP.ajouterJours(d, 1);
  }
  return ventes;
}

test('vacances : un samedi de vacances se compare aux samedis de vacances', () => {
  const r = MP.calculerRecommandation(samedisEteEtHors(), jour('2026-10-24'), 'A', {}, {}, {});
  assert.equal(r.niveauReference, 1);
  assert.equal(r.quantite, Math.round(120 * MP.MARGE_PRODUCTION));
  const hors = MP.calculerRecommandation(samedisEteEtHors(), jour('2026-11-14'), 'A', {}, {}, {});
  assert.equal(hors.quantite, Math.round(80 * MP.MARGE_PRODUCTION));
});

test('historique insuffisant : moins de 3 mêmes jours de semaine', () => {
  const ventes = [{ nom_produit: 'Galette bretonne', date_vente: '2026-09-22', quantite: 14 }];
  const r = MP.calculerRecommandation(ventes, jour('2026-10-31'), null, {}, {}, {});
  assert.equal(r.insuffisant, true);
  assert.equal(r.nbMemeJour, 0);
});

test('un dimanche férié ne prend pas la moyenne de tous les jours', () => {
  const ventes = [];
  for (let d = jour('2026-09-01'); d < jour('2026-10-31'); d = MP.ajouterJours(d, 1)) {
    if (d.getDay() !== 0) ventes.push({ nom_produit: 'Baguette', date_vente: MP.versISO(d), quantite: 70 });
  }
  const r = MP.calculerRecommandation(ventes, jour('2026-11-01'), null, {}, {}, {});
  assert.equal(r.insuffisant, true);
});

test('recette : correspondance exacte d\'abord', () => {
  assert.notEqual(B.recetteType('Galette bretonne').poids, 0.6); // pas la galette des rois
  assert.equal(B.recetteType('Galette des rois').poids, 0.6);
  assert.equal(B.deduireRayon('Café'), 'Boissons');
});

test('référence avant : nationale estimée, réponses, farine achetée − vendue', () => {
  const nat = MP.referenceAvant(null, [], [], '2026-10-30');
  assert.equal(nat.nature, 'estimé'); assert.equal(nat.taux, 0.10); assert.ok(nat.source);
  const rep = MP.referenceAvant({ reference_avant: { production: 400, reste: 40 } }, [], [], '2026-10-30');
  assert.equal(rep.nature, 'estimé'); assert.equal(rep.taux, 0.1);
  const achats = { reference_avant: { achats: { farine_kg: 1000, debut: '2025-01-01', fin: '2025-12-31' } } };
  const calc = MP.referenceAvant(achats, [], [], '2026-10-30', () => 880);
  assert.equal(calc.nature, 'calculé'); assert.ok(Math.abs(calc.taux - 0.12) < 1e-9);
  assert.equal(MP.referenceAvant(achats, [], [], '2026-10-30', () => 0).nature, 'estimé');
});

test('lot 9 : point de départ mesuré sur 2 semaines cochées, prioritaire sur les réponses', () => {
  const fournees = [], ventes = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(2026, 9, 1 + i), iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    fournees.push({ date_fournee: iso, nom_produit: 'Baguette', quantite_cuite: 100 });
    ventes.push({ date_vente: iso, nom_produit: 'Baguette', quantite: 85 });
  }
  const p = { observation_debut: '2026-10-01', reference_avant: { production: 400, reste: 40 } };
  const ref = MP.referenceAvant(p, fournees, ventes, '2026-10-20');
  assert.equal(ref.nature, 'mesuré'); assert.ok(Math.abs(ref.taux - 0.15) < 1e-9); assert.equal(ref.fin, '2026-10-15');
  // Pendant la mesure : les réponses restent la référence, la mesure est « en cours ».
  assert.equal(MP.referenceAvant(p, fournees, ventes, '2026-10-10').nature, 'estimé');
  assert.equal(MP.referenceMesuree(p, fournees, ventes, '2026-10-10').enCours, true);
  // Choix explicite des réponses : on le respecte.
  assert.equal(MP.referenceAvant({ observation_debut: '2026-10-01', reference_avant: { production: 400, reste: 40, choix: 'reponses' } }, fournees, ventes, '2026-10-20').nature, 'estimé');
});

test('lot 3 : non cuits, sarrasin, farines fusionnées', () => {
  for (const n of ['Café', 'Menu du jour', 'Burger maison', 'Tiramisu', 'Salade césar']) assert.equal(B.estCuit(n), false, n);
  assert.equal(B.estCuit('Baguette tradition'), true);
  assert.equal(B.recetteType('Galette bretonne').ingredients[0][0], 'Farine de sarrasin');
  assert.equal(B.recetteType('Galette bretonne').ingredients[0][1], 0.045);
  assert.equal(B.cleIngredient('Farine T65'), B.cleIngredient('farine de blé t 65'));
  assert.equal(B.cleIngredient('Farine de tradition'), 'farine tradition');
  assert.equal(B.uniteAchat('Farine T65', 'kg').taille, 25);
});

// ---------- Nov. 2026 : ruptures, veille de férié, saison, apprentissage boutique ----------

test('veille de férié : la veille seulement, pas le férié', () => {
  assert.equal(MP.estVeilleFerie(jour('2026-05-13')), true);  // Ascension jeudi 14 mai
  assert.equal(MP.estVeilleFerie(jour('2026-05-14')), false);
  assert.equal(MP.estVeilleFerie(jour('2026-12-24')), true);
  assert.equal(MP.estJourOrdinaire(jour('2026-12-24'), null), false);
});

test('ruptures : demande estimée sur les jours comparables, l\'heure, sinon prudente', () => {
  const ventes = [
    { nom_produit: 'Baguette', date_vente: '2026-09-05', quantite: 110 },
    { nom_produit: 'Baguette', date_vente: '2026-09-12', quantite: 120 },
    { nom_produit: 'Baguette', date_vente: '2026-09-19', quantite: 100 },  // épuisé, comparables 110 et 120
    { nom_produit: 'Baguette', date_vente: '2026-09-26', quantite: 130 },  // tout vendu, aucun comparable ≥ 130
    { nom_produit: 'Baguette', date_vente: '2026-10-03', quantite: 100, heure_derniere_vente: '12:00' }
  ];
  const fournees = [
    { date_fournee: '2026-09-19', nom_produit: 'baguette', quantite_cuite: 100, epuise: true },
    { date_fournee: '2026-09-26', nom_produit: 'Baguette', quantite_cuite: 130 },
    { date_fournee: '2026-10-03', nom_produit: 'Baguette', quantite_cuite: 100, epuise: true },
    { date_fournee: '2026-09-12', nom_produit: 'Baguette', quantite_cuite: 140 }
  ];
  const c = Object.fromEntries(MP.corrigerRuptures(ventes, fournees).map(v => [v.date_vente, v]));
  assert.equal(c['2026-09-12'].rupture, undefined);
  assert.equal(c['2026-09-19'].quantite, 115);
  assert.equal(c['2026-09-19'].quantiteVendue, 100);
  assert.equal(c['2026-09-26'].quantite, Math.round(130 * 1.03));
  assert.equal(c['2026-10-03'].rupture, 'heure');
  assert.equal(c['2026-10-03'].quantite, 140);  // 100 ÷ 55 % = 182, plafonné à +40 %
  assert.equal(MP.corrigerRuptures(ventes, []), ventes);
});

test('ruptures : la prévision remonte et « Pourquoi ? » le dit sans compter deux fois', () => {
  const ventes = historiqueSamedis('Baguette', 100, 100, () => false).filter(v => v.date_vente >= '2026-09-01' && v.date_vente < '2026-11-01');
  const fournees = ventes.map(v => ({ date_fournee: v.date_vente, nom_produit: v.nom_produit, quantite_cuite: 100, epuise: true }));
  const r0 = MP.calculerRecommandation(ventes, jour('2026-11-07'), null, {}, {}, {});
  const r1 = MP.calculerRecommandation(MP.corrigerRuptures(ventes, fournees), jour('2026-11-07'), null, {}, {}, {});
  const sig = r1.signaux.find(s => s.cle === 'rupture');
  assert.ok(sig && sig.dejaPrisEnCompte && sig.detail);
  assert.equal(r1.quantite, Math.round(110 * MP.MARGE_PRODUCTION));
  assert.ok(r1.quantite > r0.quantite);
});

test('signal jamais vu par le produit : moitié de l\'effet appris sur la boutique', () => {
  const estGalette = d => { const f = MP.feteBoulangere(d); return !!f && f.cle === 'epiphanie'; };
  const boutique = MP.totauxParJour(historiqueSamedis('Baguette', 100, 150, estGalette).filter(v => v.date_vente < '2026-12-01'));
  const nouveau = historiqueSamedis('Pain nordique', 40, 40, () => false).filter(v => v.date_vente >= '2026-10-01' && v.date_vente < '2027-01-09');
  const r = MP.calculerRecommandation(nouveau, jour('2027-01-09'), null, {}, {}, {}, undefined, { totauxBoutique: boutique });
  const sig = r.signaux.find(s => s.cle === 'epiphanie');
  assert.ok(sig.detail && sig.ratio > 1.1 && sig.ratio < 1.3, 'ratio ' + sig.ratio);
  const sans = MP.calculerRecommandation(nouveau, jour('2027-01-09'), null, {}, {}, {});
  assert.ok(r.quantite > sans.quantite);
});

test('saison : le creux d\'août appris sur l\'an dernier', () => {
  const ventes = [];
  for (let d = jour('2025-05-01'); d < jour('2026-08-10'); d = MP.ajouterJours(d, 1)) {
    const iso = MP.versISO(d);
    const aout = iso.slice(5, 7) === '08' && iso.slice(8) >= '05';
    ventes.push({ nom_produit: 'Baguette', date_vente: iso, quantite: aout ? 80 : 100 });
  }
  const s = MP.effetSaison(ventes, jour('2026-08-18'), null);
  assert.ok(s && s.ratio < 0.95, JSON.stringify(s));
  assert.equal(MP.effetSaison(ventes.filter(v => v.date_vente >= '2026-01-01'), jour('2026-08-18'), null), null);
});

// Boulangerie simulée sur 22 mois (zone C) : 5 produits, jour de semaine,
// tendance, creux d'août, vacances, fériés, ponts, veilles de férié, Noël,
// bruit de 8 %. Le boulanger cuit « à l'instinct » (moyenne de ses 4 derniers
// mêmes jours vendus +5 %) : quand la demande dépasse, il ne vend que ce
// qu'il a cuit (rupture) et coche « Épuisé » 7 fois sur 10 (fournées notées
// depuis mars 2026). On mesure l'écart moyen entre la prévision (sans la
// marge) et la VRAIE demande, de mai à octobre 2026.
function simulerBoulangerie(graine) {
  let x = graine; const alea = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const gauss = () => Math.sqrt(-2 * Math.log(alea() + 1e-12)) * Math.cos(2 * Math.PI * alea());
  const produits = [['Baguette', 250, 'pains'], ['Tradition', 120, 'pains'], ['Croissant', 90, 'viennoiseries'], ['Pain au chocolat', 80, 'viennoiseries'], ['Sandwich jambon beurre', 40, 'snacking']];
  const ventes = [], fournees = [], demandes = {}, histo = {};
  const debut = jour('2025-01-06');
  for (let d = debut; d < jour('2026-11-01'); d = MP.ajouterJours(d, 1)) {
    const iso = MP.versISO(d);
    if (['01-01', '05-01', '12-25'].includes(iso.slice(5))) continue;
    const t = (d - debut) / 86400000, doy = Math.floor((d - new Date(d.getFullYear(), 0, 1)) / 86400000), j = d.getDay(), fete = MP.feteBoulangere(d);
    for (const [nom, base, rayon] of produits) {
      const v = rayon === 'viennoiseries';
      let m = base * (1 + 0.06 * t / 365) * (iso >= '2026-03-01' ? 1.08 : 1);
      m *= j === 0 ? (v ? 1.5 : 1.25) : j === 6 ? 1.15 : j === 1 ? 0.9 : 1;
      if (rayon === 'snacking' && (j === 0 || j === 6)) m *= 0.5;
      m *= 1 - 0.14 * Math.exp(-Math.pow((doy - 222) / 18, 2)) + 0.07 * Math.exp(-Math.pow((doy - 352) / 8, 2));
      if (MP.estEnVacances(d, 'C')) m *= rayon === 'snacking' ? 0.7 : 0.93;
      if (MP.estJourFerie(d)) m *= 0.75;
      if (MP.estPont(d)) m *= 0.88;
      if (MP.estVeilleFerie(d) && rayon === 'pains') m *= 1.25;
      if (fete && fete.cle === 'noel' && rayon === 'pains') m *= 1.2;
      if (fete && fete.cle === 'paques' && v) m *= 1.15;
      const dem = Math.max(0, Math.round(m * Math.exp(0.08 * gauss())));
      const h = histo[nom + j] || (histo[nom + j] = []);
      const cuit = h.length < 2 ? Math.round(m) : Math.round(h.slice(-4).reduce((a, b) => a + b, 0) / Math.min(4, h.length) * 1.05);
      const vendu = Math.min(dem, cuit); h.push(vendu);
      ventes.push({ nom_produit: nom, date_vente: iso, quantite: vendu });
      demandes[iso + '|' + nom] = dem;
      if (iso >= '2026-03-01') fournees.push({ date_fournee: iso, nom_produit: nom, quantite_cuite: cuit, epuise: dem > cuit && alea() < 0.7 });
    }
  }
  return { ventes, fournees, demandes };
}

function erreurMoyenne(sim, apres) {
  const ventes = apres ? MP.corrigerRuptures(sim.ventes, sim.fournees) : sim.ventes;
  const sans = apres ? {} : { tendance: true, saison: true, veille: true, boutique: true };
  let somme = 0, n = 0;
  for (let d = jour('2026-05-01'); d < jour('2026-11-01'); d = MP.ajouterJours(d, 1)) {
    const iso = MP.versISO(d);
    const histo = ventes.filter(v => v.date_vente < iso);
    const options = { totauxBoutique: MP.totauxParJour(histo), sans };
    for (const nom of ['Baguette', 'Tradition', 'Croissant', 'Pain au chocolat', 'Sandwich jambon beurre']) {
      const dem = sim.demandes[iso + '|' + nom];
      if (dem === undefined) continue;
      const r = MP.calculerRecommandation(histo.filter(v => v.nom_produit === nom), d, 'C', {}, {}, {}, undefined, options);
      somme += Math.abs(r.quantite / MP.MARGE_PRODUCTION - dem); n++;
    }
  }
  return somme / n;
}

test('boulangerie simulée : écart moyen à la vraie demande, avant / après', (t) => {
  const sim = simulerBoulangerie(7);
  const avant = erreurMoyenne(sim, false), apres = erreurMoyenne(sim, true);
  t.diagnostic('écart moyen par produit et par jour : avant ' + avant.toFixed(1) + ' pièces, après ' + apres.toFixed(1) + ' (' + Math.round((apres / avant - 1) * 100) + ' %)');
  assert.ok(apres < avant * 0.95, 'avant ' + avant + ', après ' + apres);
});

// ---------- Alerte rupture dans la journée ----------
createRequire(import.meta.url)('../alerte-rupture.js');
const AR = globalThis.window.AlerteRupture;

// Parts horaires de 7 h à 19 h.
const PARTS = { pains: [6, 9, 8, 7, 8, 11, 8, 3, 3, 4, 9, 12, 12], viennoiseries: [16, 18, 15, 10, 7, 6, 4, 3, 3, 4, 5, 5, 4] };
function lignesJour(iso, nom, total, rayon = 'pains', facteurMatin = 1) {
  const somme = PARTS[rayon].reduce((a, b) => a + b, 0);
  return PARTS[rayon].map((p, k) => ({ date_vente: iso, heure: 7 + k, nom_produit: nom, quantite: Math.round(total * p / somme * (k < 5 ? facteurMatin : 1)) }));
}
function mardisPasses(nom, total, n = 16) {
  const h = [];
  for (let i = n; i >= 1; i--) {
    const iso = MP.versISO(MP.ajouterJours(jour('2026-11-03'), -7 * i));
    h.push(...lignesJour(iso, nom, total * (1 + 0.05 * Math.sin(i))));
  }
  return h;
}

test('alerte rupture : message chiffré, quantité, heures limites', () => {
  const historique = mardisPasses('Tradition', 160);
  const aujourdhui = lignesJour('2026-11-03', 'Tradition', 270, 'pains', 1).filter(l => l.heure < 12);
  const fournees = { Tradition: [{ heure: 5.5, quantite: 95 }, { heure: 9.5, quantite: 40 }, { heure: 11.5, quantite: 35 }] };
  const a = AR.alertesRupture({ historique, aujourdhui, date: '2026-11-03', heure: 12, fournees, fermeture: 19.5 });
  assert.equal(a.length, 1);
  assert.match(a[0].message, /^Tradition : relance \d+, à lancer avant .*au four avant .* vendus à 12 h contre \d+ d'habitude un mardi/);
  assert.ok(a[0].quantite >= 5 && a[0].heureLancer >= 12 && a[0].heureEpuisement < 18.5, JSON.stringify(a[0]));
  // Journée habituelle : rien.
  const calme = lignesJour('2026-11-03', 'Tradition', 160).filter(l => l.heure < 12);
  assert.deepEqual(AR.alertesRupture({ historique, aujourdhui: calme, date: '2026-11-03', heure: 12, fournees, fermeture: 19.5 }), []);
  // Un seul relevé alarmant (l'heure d'avant était normale) : on attend.
  const pic = lignesJour('2026-11-03', 'Tradition', 160).filter(l => l.heure < 11).concat([{ date_vente: '2026-11-03', heure: 11, nom_produit: 'Tradition', quantite: 60 }]);
  assert.deepEqual(AR.alertesRupture({ historique, aujourdhui: pic, date: '2026-11-03', heure: 12, fournees, fermeture: 19.5 }), []);
  // Silence : 20-24 et 31 décembre, boutique fermée.
  assert.deepEqual(AR.alertesRupture({ historique, aujourdhui, date: '2026-12-22', heure: 12, fournees, fermeture: 19.5 }), []);
  assert.deepEqual(AR.alertesRupture({ historique, aujourdhui, date: '2026-11-03', heure: 12, fournees, fermeture: 19.5, ferme: true }), []);
});

// 420 jours simulés (300 rejoués), 3 produits, fermé le lundi. Journées
// normales, calmes (−25 %), chargées (+30 %), matin fort puis après-midi
// mou, après-midi fort ; bruit par heure de 20 %, demande aléatoire. Le
// boulanger cuit son habitude +8 % en 3 fournées (5 h 30, 9 h 30, 11 h 30).
function simulerJournees(graine, nbJours) {
  let x = graine; const alea = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const gauss = () => Math.sqrt(-2 * Math.log(alea() + 1e-12)) * Math.cos(2 * Math.PI * alea());
  const poisson = l => Math.max(0, Math.round(l + Math.sqrt(l) * gauss()));
  const produits = [['Tradition', 160, 'pains'], ['Baguette', 250, 'pains'], ['Croissant', 110, 'viennoiseries']];
  const jours = [];
  for (let i = 0; i < nbJours; i++) {
    const d = MP.ajouterJours(jour('2025-09-01'), i), iso = MP.versISO(d), j = d.getDay();
    if (j === 1) continue;
    const u = alea(), type = u < 0.12 ? 'calme' : u < 0.27 ? 'charge' : u < 0.35 ? 'matin-fort' : u < 0.42 ? 'apres-midi-fort' : 'normal';
    const jourSim = { iso, produits: {} };
    for (const [nom, base, rayon] of produits) {
      const usuel = base * (j === 0 ? 1.3 : j === 6 ? 1.15 : 1);
      let f = Math.exp(0.10 * gauss());
      if (type === 'calme') f *= 0.75; if (type === 'charge') f *= 1.3 + 0.1 * gauss();
      const parts = PARTS[rayon].map((p, k) => p * Math.exp(0.2 * gauss()) * (type === 'matin-fort' ? (k < 5 ? 1.35 : 0.85) : 1) * (type === 'apres-midi-fort' && k >= 6 ? 1.4 : 1));
      const somme = PARTS[rayon].reduce((a, b) => a + b, 0);
      const prevu = Math.round(usuel * 1.08);
      const fournees = [{ heure: 5.5, quantite: Math.round(prevu * 0.55) }, { heure: 9.5, quantite: Math.round(prevu * 0.25) }];
      fournees.push({ heure: 11.5, quantite: prevu - fournees[0].quantite - fournees[1].quantite });
      const stockA = t => fournees.reduce((s, x) => s + (x.heure <= t ? x.quantite : 0), 0);
      let vendu = 0, rupture = null; const ventes = [];
      parts.forEach((p, k) => {
        const h = 7 + k, dem = poisson(usuel * f * p / somme), dispo = stockA(h + 0.5) - vendu, v = Math.min(dem, Math.max(0, dispo));
        if (rupture === null && dem > dispo) rupture = h + Math.max(0, dispo) / Math.max(1, dem);
        vendu += v;
        if (v > 0) ventes.push({ date_vente: iso, heure: h, nom_produit: nom, quantite: v });
      });
      jourSim.produits[nom] = { ventes, fournees, rupture, rayon };
    }
    jours.push(jourSim);
  }
  return jours;
}

function rejouerAlertes(jours) {
  const historique = [], joursEpuises = {};
  const r = { jours: 0, alertes: 0, sansRupture: 0, ruptureTardive: 0, ruptures: 0, actionnables: 0, detectees: 0, avance: 0 };
  jours.forEach((j, i) => {
    if (i >= 60) {
      r.jours++;
      const fournees = {}, premieres = {};
      Object.keys(j.produits).forEach(n => { fournees[n] = j.produits[n].fournees; });
      for (let h = 8; h <= 18; h++) {
        const aujourdhui = []; Object.values(j.produits).forEach(p => p.ventes.forEach(v => { if (v.heure < h) aujourdhui.push(v); }));
        AR.alertesRupture({ historique: historique.slice(-3000), aujourdhui, date: j.iso, heure: h, fournees, fermeture: 19.5, joursEpuises })
          .forEach(a => { if (!premieres[a.nom]) premieres[a.nom] = h; });
      }
      Object.entries(j.produits).forEach(([nom, p]) => {
        const fab = AR.REGLAGES_RAYON[p.rayon].fabrication, h = premieres[nom];
        const reelle = p.rupture !== null && p.rupture < 18.5, actionnable = reelle && p.rupture - fab >= 9;
        if (reelle) r.ruptures++;
        if (actionnable) r.actionnables++;
        if (h !== undefined) {
          r.alertes++;
          if (p.rupture === null) r.sansRupture++; else if (!reelle) r.ruptureTardive++;
          if (actionnable && h <= p.rupture - fab) { r.detectees++; r.avance += p.rupture - h; }
        }
      });
    }
    Object.entries(j.produits).forEach(([nom, p]) => { historique.push(...p.ventes); if (p.rupture !== null) joursEpuises[j.iso + '|' + nom.toLowerCase()] = true; });
  });
  return r;
}

test('alerte rupture : fiabilité rejouée sur 300 journées simulées', (t) => {
  const r = rejouerAlertes(simulerJournees(5, 420));
  const fausses = (r.sansRupture + r.ruptureTardive) / r.alertes;
  t.diagnostic(`${r.jours} jours × 3 produits : ${r.alertes} alertes, ${r.sansRupture} sans rupture, ${r.ruptureTardive} rupture après 18 h 30 ; `
    + `${r.detectees}/${r.actionnables} ruptures détectées à temps, avance moyenne ${(r.avance / r.detectees).toFixed(1)} h`);
  assert.ok(r.jours >= 300);
  assert.ok(fausses < 0.05, 'fausses alertes ' + fausses);
  assert.ok(r.detectees / r.actionnables > 0.2);
});

// ---------- Retours d'un boulanger sur une année complète ----------

test('galettes : fin de saison apprise sur le produit, fin janvier par défaut', () => {
  const ventes = [];
  for (let d = jour('2026-01-02'); d <= jour('2026-01-31'); d = MP.ajouterJours(d, 1)) {
    ventes.push({ nom_produit: 'Galette frangipane', date_vente: MP.versISO(d), quantite: MP.versISO(d) <= '2026-01-15' ? 120 : 50 });
  }
  assert.equal(MP.finSaisonGalettes(ventes, 2027), '01-31');
  assert.equal(MP.feteDuProduit(jour('2027-01-25'), ventes).cle, 'epiphanie');
  const courte = ventes.filter(v => v.date_vente <= '2026-01-18');
  assert.equal(MP.feteDuProduit(jour('2027-01-25'), courte), null);
  assert.equal(MP.feteBoulangere(jour('2027-01-28')).cle, 'epiphanie');  // sans historique : fin janvier
  assert.equal(MP.finSaisonGalettes(historiqueSamedis('Baguette', 100, 100, () => false), 2027), null);
});

test('produit de saison : quantité de l\'an dernier à la même fête, sinon à fixer, jamais « zéro hier »', () => {
  const ventes = ['2025-12-20', '2025-12-21', '2025-12-22', '2025-12-23', '2025-12-24'].map((iso, i) => ({ nom_produit: 'Bûche', date_vente: iso, quantite: 40 + 10 * i }));
  const boutique = MP.totauxParJour(historiqueSamedis('Baguette', 100, 100, () => false));
  const opt = { totauxBoutique: boutique };
  const r = MP.calculerRecommandation(ventes, jour('2026-12-21'), null, {}, {}, {}, undefined, opt);
  assert.equal(r.repriseSaison, true);
  assert.equal(r.quantite, 50);  // 2e jour de la fête, comme le 21 décembre 2025
  assert.match(r.texteBase, /l'an dernier/);
  const hors = MP.calculerRecommandation(ventes, jour('2026-10-10'), null, {}, {}, {}, undefined, opt);
  assert.equal(hors.horsSaison, true);
  assert.equal(hors.quantite, 0);
  const decale = ventes.map(v => ({ ...v, date_vente: v.date_vente.replace('-12-2', '-12-0') }));
  const aFixer = MP.calculerRecommandation(decale, jour('2026-12-21'), null, {}, {}, {}, undefined, opt);
  assert.equal(aFixer.aFixer, true);
  assert.equal(aFixer.insuffisant, true);
});

test('produit de saison du catalogue jamais vendu : la page demande la quantité de départ', () => {
  globalThis.window.supabase = { createClient: () => ({}) };
  createRequire(import.meta.url)('../contexte.js');
  const C = globalThis.window.ContexteBoulangerie;
  const ctx = { session: { user: { user_metadata: {} } }, parProduit: {}, demandeParProduit: {}, produits: [{ nom: 'Bûche pâtissière' }, { nom: 'Fraisier' }],
    zoneVacances: null, evenements: {}, meteoPassee: {}, meteoPrevue: {}, signauxExternes: {}, optionsPrevision: {} };
  const liste = C.prevoirJour(ctx, jour('2026-12-22'));
  assert.equal(liste.length, 1);
  assert.equal(liste[0].r.aFixer, true);
});

test('Pâques 2026 contre 2027 : comparé par la fête, pas par la date', () => {
  const ventes = historiqueSamedis('Pain au chocolat', 100, 150, d => MP.versISO(d) === '2026-04-04').filter(v => v.date_vente <= '2027-03-20');
  const r = MP.calculerRecommandation(ventes, jour('2027-03-27'), null, {}, {}, {});
  const sig = r.signaux.find(s => s.cle === 'paques');
  assert.ok(sig && sig.ratio > 1.2, JSON.stringify(sig));
  const memeDate = MP.calculerRecommandation(ventes, jour('2027-04-03'), null, {}, {}, {});
  assert.equal(memeDate.signaux.find(s => s.cle === 'paques'), undefined);
  assert.equal(MP.versISO(MP.equivalentAnDernier(jour('2027-03-27'))), '2026-04-04');
});

test('fête des Mères une année « Pentecôte » : reculée d\'une semaine, et apprise par la fête', () => {
  assert.equal(MP.versISO(MP.dateFeteDesMeres(2023)), '2023-06-04');  // Pentecôte le 28 mai 2023
  assert.equal(MP.versISO(MP.dateFeteDesMeres(2034)), '2034-06-04');
  assert.equal(MP.feteBoulangere(jour('2034-05-28')), null);
  const ventes = [];
  for (let d = jour('2033-03-06'); d <= jour('2034-05-28'); d = MP.ajouterJours(d, 7)) {
    const f = MP.feteBoulangere(d);
    ventes.push({ nom_produit: 'Fraisier', date_vente: MP.versISO(d), quantite: f && f.cle === 'fete-meres' ? 40 : 20 });
  }
  const r = MP.calculerRecommandation(ventes, jour('2034-06-04'), null, {}, {}, {});
  const sig = r.signaux.find(s => s.cle === 'fete-meres');
  assert.ok(sig && sig.ratio > 1.3, JSON.stringify(sig));
});

test('congés annuels : rien pendant, réouverture comparée à l\'an dernier, pas à juillet', () => {
  const ventes = [];
  for (let d = jour('2025-06-01'); d <= jour('2026-08-01'); d = MP.ajouterJours(d, 1)) {
    const iso = MP.versISO(d);
    if (iso >= '2025-08-04' && iso <= '2025-08-24') continue;  // fermé l'an dernier aussi
    const juillet = iso.slice(5, 7) === '07';
    const reprise = iso >= '2025-08-25' && iso <= '2025-09-30';
    ventes.push({ nom_produit: 'Baguette', date_vente: iso, quantite: juillet ? 140 : reprise ? 90 : 110 });
  }
  const opt = { conges: [{ debut: '2025-08-04', fin: '2025-08-24' }, { debut: '2026-08-03', fin: '2026-08-23' }], totauxBoutique: MP.totauxParJour(ventes) };
  const pendant = MP.calculerRecommandation(ventes, jour('2026-08-10'), null, {}, {}, {}, undefined, opt);
  assert.equal(pendant.ferme, true);
  assert.equal(pendant.quantite, 0);
  const r = MP.calculerRecommandation(ventes, jour('2026-08-25'), null, {}, {}, {}, undefined, opt);
  assert.equal(r.quantite, Math.round(90 * MP.MARGE_PRODUCTION));
  assert.match(r.texteBase, /Réouverture après les congés/);
});

test('fériés : réglage férié par férié (le 11 novembre, il travaille)', () => {
  const opt = { feriesFermes: ['1-mai', 'noel'] };
  assert.equal(MP.raisonFermeture(jour('2026-11-11'), opt), null);
  assert.equal(MP.raisonFermeture(jour('2026-05-01'), opt), 'Férié : boutique fermée');
  assert.equal(MP.cleFerie(jour('2027-05-06')), 'ascension');
  const ventes = historiqueSamedis('Baguette', 100, 100, () => false).filter(v => v.date_vente < '2026-11-14');
  const r = MP.calculerRecommandation(ventes, jour('2026-11-14'), null, {}, {}, {}, undefined, opt);
  assert.ok(!r.ferme && r.quantite > 0);
  // Comparé au même férié l'an dernier : l'Ascension 2026 (−40 %) pour l'Ascension 2027.
  const jeudis = [];
  for (let d = jour('2026-03-05'); d <= jour('2027-04-29'); d = MP.ajouterJours(d, 7)) {
    const iso = MP.versISO(d);
    jeudis.push({ nom_produit: 'Baguette', date_vente: iso, quantite: iso === '2026-05-14' ? 60 : iso === '2026-12-25' ? 150 : 100 });
  }
  const asc = MP.calculerRecommandation(jeudis, jour('2027-05-06'), null, {}, {}, {});
  const sig = asc.signaux.find(s => s.cle === 'ferie');
  assert.equal(sig.libelle, 'Ascension');
  assert.ok(sig.ratio < 0.85, JSON.stringify(sig));
});

test('vacances scolaires : calendrier officiel lu en plus de la liste en dur', () => {
  assert.equal(MP.estEnVacances(jour('2026-05-15'), 'B'), true);  // pont de l'Ascension
  const p = MP.periodesDepuisCalendrierOfficiel([
    { zones: 'Zone A', population: 'Élèves', start_date: '2029-10-19T22:00:00+00:00', end_date: '2029-11-04T23:00:00+00:00' },
    { zones: 'Zone A', population: 'Élèves', start_date: '2029-10-19T22:00:00+00:00', end_date: '2029-11-04T23:00:00+00:00' },
    { zones: 'Zone A', population: 'Enseignants', start_date: '2029-10-18T22:00:00+00:00', end_date: '2029-11-04T23:00:00+00:00' },
    { zones: 'Polynésie', population: '-', start_date: '2029-10-01T10:00:00+00:00', end_date: '2029-10-08T10:00:00+00:00' }
  ]);
  assert.deepEqual(p, [{ debut: '2029-10-20', fin: '2029-11-05', zones: ['A'] }]);
  assert.equal(MP.estEnVacances(jour('2029-10-25'), 'A'), false);
  assert.equal(MP.ajouterPeriodesVacances(p), 1);
  assert.equal(MP.ajouterPeriodesVacances(p), 0);
  assert.equal(MP.estEnVacances(jour('2029-10-25'), 'A'), true);
  assert.equal(MP.estEnVacances(jour('2029-10-25'), 'B'), false);
});

test('période exceptionnelle (travaux) : hors apprentissage, puis la tendance corrige', () => {
  const ventes = [];
  for (let d = jour('2026-06-01'); d < jour('2026-10-20'); d = MP.ajouterJours(d, 1)) {
    const iso = MP.versISO(d);
    const travaux = iso >= '2026-09-07' && iso <= '2026-09-27';
    ventes.push({ nom_produit: 'Baguette', date_vente: iso, quantite: travaux ? 60 : iso > '2026-09-27' ? 90 : 100 });
  }
  const exclues = [{ debut: '2026-09-07', fin: '2026-09-27', libelle: 'Travaux' }];
  const avant = ventes.filter(v => v.date_vente < '2026-09-29');
  const marque = MP.calculerRecommandation(avant, jour('2026-09-29'), null, {}, {}, {}, undefined, { periodesExclues: exclues });
  const nonMarque = MP.calculerRecommandation(avant, jour('2026-09-29'), null, {}, {}, {});
  assert.equal(marque.quantite, Math.round(100 * MP.MARGE_PRODUCTION));
  assert.ok(nonMarque.quantite < marque.quantite);
  // Trois semaines après, clientèle un peu perdue (−10 %) : la tendance le voit.
  const r = MP.calculerRecommandation(ventes, jour('2026-10-20'), null, {}, {}, {}, undefined, { periodesExclues: exclues });
  const t = r.signaux.find(s => s.cle === 'tendance');
  assert.ok(t && t.ratio < 1, JSON.stringify(r.signaux));
});

test('météo : canicule −15 %, neige −30 % par défaut, appris sinon', () => {
  assert.equal(MP.categoriserMeteo(0, 35, 0), 'canicule');
  assert.equal(MP.categoriserMeteo(2, 1, 4), 'neige');
  const ventes = historiqueSamedis('Baguette', 100, 100, () => false).filter(v => v.date_vente < '2026-07-11');
  const base = Math.round(100 * MP.MARGE_PRODUCTION);
  const canicule = MP.calculerRecommandation(ventes, jour('2026-07-11'), 'C', {}, {}, { '2026-07-11': { categorie: 'canicule' } });
  assert.equal(canicule.quantite, Math.round(base * 0.85));  // même en vacances
  assert.match(canicule.signaux[0].detail, /habituel/);
  const neige = MP.calculerRecommandation(ventes.filter(v => v.date_vente < '2026-01-10'), jour('2026-01-10'), null, {}, {}, { '2026-01-10': { categorie: 'neige' } });
  assert.equal(neige.quantite, Math.round(base * 0.7));
  // Appris chez lui : ses 2 samedis de canicule à −25 %.
  const passee = { '2026-06-20': { categorie: 'canicule' }, '2026-06-27': { categorie: 'canicule' } };
  const appris = ventes.map(v => passee[v.date_vente] ? { ...v, quantite: 75 } : v);
  const r = MP.calculerRecommandation(appris, jour('2026-07-11'), 'C', {}, passee, { '2026-07-11': { categorie: 'canicule' } });
  assert.ok(r.signaux[0].ratio < 0.85 && !r.signaux[0].detail, JSON.stringify(r.signaux[0]));
});
