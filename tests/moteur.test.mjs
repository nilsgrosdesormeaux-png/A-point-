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

test('lot 3 : non cuits, sarrasin, farines fusionnées', () => {
  for (const n of ['Café', 'Menu du jour', 'Burger maison', 'Tiramisu', 'Salade césar']) assert.equal(B.estCuit(n), false, n);
  assert.equal(B.estCuit('Baguette tradition'), true);
  assert.equal(B.recetteType('Galette bretonne').ingredients[0][0], 'Farine de sarrasin');
  assert.equal(B.recetteType('Galette bretonne').ingredients[0][1], 0.045);
  assert.equal(B.cleIngredient('Farine T65'), B.cleIngredient('farine de blé t 65'));
  assert.equal(B.cleIngredient('Farine de tradition'), 'farine tradition');
  assert.equal(B.uniteAchat('Farine T65', 'kg').taille, 25);
});
