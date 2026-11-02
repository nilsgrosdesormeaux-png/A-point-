// Commandes clients : fonctions (Node), parcours navigateur (faux Supabase
// du harnais de démo) et migration SQL (PGlite, si installé).
//   node tests/commandes-clients.test.mjs
// PGlite : npm i --no-save @electric-sql/pglite@0.3.7 (ou PGLITE=<chemin du module>).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.APOINT_PORT = process.env.APOINT_PORT || '4199';
const demo = await import('./demo.mjs');

let ok = 0, ko = 0;
async function test(nom, fn) {
  try { await fn(); ok++; console.log('✓ ' + nom); } catch (e) { ko++; console.log('✗ ' + nom + '\n    ' + String(e.message).split('\n').slice(0, 4).join('\n    ')); }
}

// ---------- 1. Fonctions ----------
const stock = {};
const bac = { window: {}, localStorage: { getItem: (k) => (k in stock ? stock[k] : null), setItem: (k, v) => { stock[k] = String(v); } }, crypto: globalThis.crypto };
vm.createContext(bac);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'moteur-prevision.js'), 'utf8'), bac);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'commandes-clients.js'), 'utf8'), bac);
const CC = bac.window.CommandesClients;
const MP = bac.window.MoteurPrevision;
const cmd = (o) => Object.assign({ id: 'x' + Math.random(), client_nom: 'Client', produit: 'Croissant', quantite: 10, date_retrait: '2026-11-06', statut: 'active', acompte_statut: 'aucun', acompte_montant: 0 }, o);

await test('récurrence : chaque vendredi, date de fin, « pas cette fois »', () => {
  const c = cmd({ produit: 'Sandwich', quantite: 120, date_retrait: '2026-10-01', jours_recurrence: [5], date_fin: '2026-12-31', dates_sautees: ['2026-11-13'] });
  assert.equal(CC.aLieuLe(c, '2026-11-06'), true);
  assert.equal(CC.aLieuLe(c, '2026-11-07'), false);
  assert.equal(CC.aLieuLe(c, '2026-11-13'), false);
  assert.equal(CC.aLieuLe(c, '2027-01-08'), false);
  assert.equal(CC.aLieuLe(c, '2026-09-25'), false);
});

await test('récurrence « pas pendant les vacances scolaires » (liste du moteur)', () => {
  const c = cmd({ produit: 'Baguette', date_retrait: '2026-09-01', jours_recurrence: [2, 4], sauf_vacances: true });
  CC.definirZone(MP.zoneVacancesPourCodePostal('75011'));
  assert.equal(MP.estEnVacances(new Date('2026-10-20T12:00:00'), 'C'), true, 'Toussaint 2026 dans la liste du moteur');
  assert.equal(CC.aLieuLe(c, '2026-10-20'), false);
  assert.equal(CC.aLieuLe(c, '2026-11-03'), true);
  assert.equal(CC.aLieuLe(Object.assign({}, c, { sauf_vacances: false }), '2026-10-20'), true);
});

await test('annulée ou refusée : ne compte plus, mais reste dans la liste', () => {
  const l = [cmd({ quantite: 40 }), cmd({ quantite: 5, statut: 'annulee' }), cmd({ quantite: 7, statut: 'refusee' })];
  assert.equal(CC.reserveesParCle(l, '2026-11-06').croissant.quantite, 40);
  assert.equal(l.length, 3);
});

await test('apprentissage : les pièces réservées sortent des ventes (jamais sous zéro)', () => {
  const ventes = [{ date_vente: '2026-11-06', nom_produit: 'Croissants', quantite: 130 }, { date_vente: '2026-11-06', nom_produit: 'Baguette', quantite: 50 }, { date_vente: '2026-11-07', nom_produit: 'Croissant', quantite: 20 }];
  const l = [cmd({ quantite: 40 }), cmd({ quantite: 30, date_retrait: '2026-11-07' }), cmd({ quantite: 99, statut: 'annulee' })];
  const r = CC.retirerDesVentes(ventes, l);
  assert.deepEqual(r.map((v) => v.quantite), [90, 50, 0]);
  assert.equal(ventes[0].quantite, 130, 'ventes d\'origine intactes (Bilan)');
});

await test('Noël : production par jour, parfum et taille', () => {
  const l = [cmd({ produit: 'Bûche', parfum: 'Praliné', taille: '6 parts', quantite: 2, date_retrait: '2026-12-24' }), cmd({ produit: 'Bûche', parfum: 'Praliné', taille: '6 parts', quantite: 1, date_retrait: '2026-12-24' }), cmd({ produit: 'Bûche', parfum: 'Chocolat', taille: '8 parts', quantite: 1, date_retrait: '2026-12-24' }), cmd({ produit: 'Bûche', quantite: 4, date_retrait: '2026-12-23' })];
  const p = CC.productionDuJour(l, '2026-12-24');
  assert.equal(p[0].quantite, 4);
  assert.deepEqual([...p[0].variantes].map((v) => v.libelle + '=' + v.quantite), ['Chocolat · 8 parts=1', 'Praliné · 6 parts=3']);
});

await test('recherche au comptoir : 2 lettres du nom ou 2 chiffres du téléphone', () => {
  const l = [cmd({ client_nom: 'Mme Bérénice Martin', client_telephone: '06 12 34 56 78' }), cmd({ client_nom: 'M. Durand', client_telephone: '07 99 88 77 66' })];
  assert.equal(CC.rechercher(l, 'be').length, 1);
  assert.equal(CC.rechercher(l, 'du').length, 1);
  assert.equal(CC.rechercher(l, '99').length, 1);
  assert.equal(CC.rechercher(l, 'm').length, 2, 'une lettre : pas de filtre');
});

await test('acompte : 30 % au-dessus de 40 €, réglable', () => {
  assert.equal(CC.acompteConseille(40), 0);
  assert.equal(CC.acompteConseille(84), 26);
  assert.equal(CC.acompteConseille(84, { seuil: 100, taux: 30 }), 0);
  assert.equal(CC.acompteConseille(200, { seuil: 50, taux: 50 }), 100);
  const cat = [{ produit: 'Bûche', tailles: ['6 parts'], prix_tailles: { '6 parts': 32 } }];
  assert.equal(CC.prixCommande({ produit: 'bûches', taille: '6 parts', quantite: 2 }, cat), 64);
});

await test('rappel de l\'acompte manquant', () => {
  const l = [cmd({ acompte_statut: 'a_encaisser', acompte_montant: 20, date_retrait: '2026-11-06' }), cmd({ acompte_statut: 'a_encaisser', acompte_montant: 20, date_retrait: '2026-10-01' }), cmd({ acompte_statut: 'encaisse', acompte_montant: 20 })];
  assert.equal(CC.acomptesManquants(l, '2026-11-01').length, 1);
});

await test('alerte du matin : modifiée pour demain, pas pour dans 10 jours ; « Vu » l\'éteint', () => {
  const maintenant = new Date('2026-11-05T03:30:00');
  const l = [
    cmd({ date_retrait: '2026-11-06', cree_le: '2026-11-01T10:00:00Z', modifie_le: '2026-11-04T18:00:00Z' }),
    cmd({ date_retrait: '2026-11-15', cree_le: '2026-11-01T10:00:00Z', modifie_le: '2026-11-04T18:00:00Z' }),
    cmd({ date_retrait: '2026-11-05', cree_le: '2026-11-04T19:00:00Z', modifie_le: '2026-11-04T19:00:00Z' }),
    cmd({ date_retrait: '2026-11-05', statut: 'annulee', cree_le: '2026-11-01T10:00:00Z', modifie_le: '2026-11-04T20:00:00Z' }),
  ];
  const a = CC.changementsProches(l, maintenant, null);
  assert.deepEqual([...a].map((x) => x.nature + '/' + x.pour), ['modifiée/demain', "nouvelle/aujourd'hui", "annulée/aujourd'hui"]);
  assert.equal(CC.changementsProches(l, maintenant, '2026-11-05T03:00:00Z').length, 0);
});

await test('hors période : bouton réduit ; jour de rush : 24 décembre', () => {
  const now = new Date('2026-03-10T05:00:00');
  assert.equal(CC.horsPeriode([cmd({ date_retrait: '2026-02-01', cree_le: '2026-01-20T10:00:00Z' })], now), true);
  assert.equal(CC.horsPeriode([cmd({ date_retrait: '2026-03-12', cree_le: '2026-01-20T10:00:00Z' })], now), false);
  assert.equal(CC.horsPeriode([cmd({ date_retrait: '2026-02-01', cree_le: '2026-03-05T10:00:00Z' })], now), false);
  assert.equal(CC.horsPeriode([cmd({ date_retrait: '2026-01-01', jours_recurrence: [5], cree_le: '2025-01-01T00:00:00Z' })], now), false);
  assert.equal(CC.jourDeRush(new Date('2026-12-24T05:00:00'), []), true);
  assert.equal(CC.jourDeRush(new Date('2026-12-23T05:00:00'), []), false);
});

await test('d\'une année sur l\'autre : bûches début novembre, galettes en décembre, Pâques 4 semaines avant', () => {
  const l = [cmd({ produit: 'Bûche', quantite: 180, date_retrait: '2025-12-23' }), cmd({ produit: 'Bûches', quantite: 20, date_retrait: '2025-12-24', statut: 'refusee' }),
    cmd({ produit: 'Galette des rois', quantite: 300, date_retrait: '2026-01-06' }), cmd({ produit: 'Œuf en chocolat', quantite: 50, date_retrait: '2026-04-04' })];
  assert.equal(CC.rappelAnnuel(l, new Date('2026-11-03T05:00:00')).texte, 'L\'an dernier : 180 bûches commandées, 20 refusées faute de place.');
  assert.equal(CC.rappelAnnuel(l, new Date('2026-12-02T05:00:00')).texte, 'L\'an dernier : 300 galettes commandées.');
  // Pâques 2027 : 28 mars ; 2026 : 5 avril.
  assert.equal(CC.rappelAnnuel(l, new Date('2027-03-10T05:00:00')).commandees, 50);
  assert.equal(CC.rappelAnnuel(l, new Date('2027-02-10T05:00:00')), null);
});

await test('SMS de la veille : texte prêt, rien d\'envoyé', () => {
  const l = [cmd({ client_telephone: '0612345678', produit: 'Bûche', quantite: 1, heure_retrait: '10:30:00', date_retrait: '2026-12-24', acompte_statut: 'a_encaisser', acompte_montant: 10 }), cmd({ date_retrait: '2026-12-24' })];
  const s = CC.smsDeLaVeille(l, '2026-12-24', 'Le petit comptoire');
  assert.equal(s.length, 1);
  assert.match(s[0].texte, /Le petit comptoire : votre commande de 1 Bûche est prête jeudi à partir de 10 h 30\. Acompte de 10 € à régler au retrait\./);
});

await test('file hors connexion : rien ne part tant que la base n\'a pas confirmé', async () => {
  const ligne = cmd({ id: 'f1', maj_le: 'a' });
  CC.mettreEnFile('C1', ligne);
  const panne = { from: () => ({ upsert: () => Promise.resolve({ error: { message: 'TypeError: Failed to fetch' } }) }) };
  assert.deepEqual(JSON.parse(JSON.stringify(await CC.envoyer(panne, 'C1'))), { envoyees: 0, restantes: 1, absente: false });
  const recu = [];
  const ok = { from: () => ({ upsert: (l) => { recu.push(l); return Promise.resolve({ error: null }); } }) };
  assert.equal((await CC.envoyer(ok, 'C1')).restantes, 0);
  assert.equal(recu[0].id, 'f1');
  assert.equal(CC.estTableAbsente({ code: 'PGRST205', message: "Could not find the table 'public.commandes_clients' in the schema cache" }), true);
  assert.equal(CC.estTableAbsente({ message: 'TypeError: Failed to fetch' }), false);
});

// ---------- 2. Navigateur ----------
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const srv = await demo.serveur();
const browser = await chromium.launch();

async function ouvrir(compte, url, date = '2026-11-01T05:00:00', mobile = true) {
  const auj = new Date(date); auj.setHours(0, 0, 0, 0);
  const contexte = await browser.newContext(Object.assign({ locale: 'fr-FR', timezoneId: 'Europe/Paris' }, mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}));
  await demo.routes(contexte);
  await contexte.addInitScript(demo.fauxSupabase, Object.assign({}, demo.COMPTES[compte](auj), { theme: null }));
  const page = await contexte.newPage();
  await page.clock.setFixedTime(new Date(date));
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.goto(demo.BASE + '/' + url);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);
  return { page, contexte, erreurs };
}
const table = (page, nom) => page.evaluate((n) => window.__demo.tables[n] || [], nom);

try {
  await test('saisie au comptoir en moins de 20 s (7 champs, touches comptées)', async () => {
    const { page, contexte, erreurs } = await ouvrir('comptoire', 'commandes-clients.html');
    // Champs visibles hors récurrence repliée : nom, téléphone, produit, quantité, date, heure (+ montant si acompte).
    const champs = await page.$$eval('#formCommande input:not([type=checkbox])', (l) => l.filter((x) => x.offsetParent && !x.closest('details')).map((x) => x.id));
    assert.deepEqual(champs, ['cNom', 'cTel', 'cProduit', 'cQuantite', 'cDate', 'cHeure']);
    assert.equal(CC.CHAMPS_SAISIE.length, 7);
    // Parcours chronométré : touches réellement tapées + touchers d'écran.
    let touches = 0, touchers = 0;
    const taper = async (sel, t) => { await page.click(sel); touchers++; await page.keyboard.type(t); touches += t.replace(/:/g, '').length; };
    const toucher = async (sel) => { await page.click(sel); touchers++; };
    const debut = Date.now();
    await taper('#cNom', 'Mairie');
    await taper('#cTel', '0143551010');
    await taper('#cProduit', 'Galette');
    await taper('#cQuantite', '40');
    await toucher('#choixJour [data-decalage="1"]');
    await page.fill('#cHeure', '11:30'); touchers++; touches += 4;
    await toucher('#choixAcompte [data-acompte="encaisse"]');
    await taper('#cMontant', '50');
    await toucher('#btnEnregistrer');
    const machine = Date.now() - debut;
    // Comptoir : 0,3 s par touche, 1 s par toucher (lecture comprise).
    const estime = touches * 0.3 + touchers * 1;
    console.log('    parcours : ' + touches + ' touches, ' + touchers + ' touchers ≈ ' + estime.toFixed(1) + ' s au comptoir (' + machine + ' ms en automate)');
    assert.ok(estime < 20, 'estimé ' + estime + ' s');
    const l = (await table(page, 'commandes_clients')).find((c) => c.client_nom === 'Mairie' && c.produit === 'Galette');
    assert.ok(l, 'enregistrée en base');
    assert.equal(l.quantite, 40); assert.equal(l.acompte_statut, 'encaisse'); assert.equal(l.acompte_montant, 50);
    assert.equal(l.date_retrait, '2026-11-02'); assert.equal(l.heure_retrait, '11:30');
    assert.match(await page.textContent('#etatSynchro'), /Tout est enregistré/);
    assert.deepEqual(erreurs, []);
    await contexte.close();
  });

  await test('Noël : bûche parfum + taille en 2 touches, acompte 30 % proposé', async () => {
    const { page, contexte } = await ouvrir('comptoire', 'commandes-clients.html');
    await page.fill('#cNom', 'Mme Leroy');
    await page.click('[data-produit="Bûche"]');
    await page.click('[data-parfum="Chocolat"]');
    await page.click('[data-taille="8 parts"]');
    await page.fill('#cQuantite', '2');
    assert.match(await page.textContent('#texteTotal'), /Total 84 € · acompte conseillé 26 €/);
    assert.equal(await page.inputValue('#cMontant'), '26');
    await page.click('#btnEnregistrer');
    const l = (await table(page, 'commandes_clients')).find((c) => c.client_nom === 'Mme Leroy');
    assert.equal(l.parfum + '|' + l.taille + '|' + l.acompte_statut, 'Chocolat|8 parts|a_encaisser');
    await contexte.close();
  });

  await test('demande refusée (complet) notée en 2 touches', async () => {
    const { page, contexte } = await ouvrir('comptoire', 'commandes-clients.html');
    await page.click('[data-produit="Bûche"]');
    await page.click('#btnRefusee');
    const l = (await table(page, 'commandes_clients')).filter((c) => c.statut === 'refusee' && c.date_retrait === '2026-11-02');
    assert.equal(l.length, 1);
    await contexte.close();
  });

  await test('hors connexion puis reprise : « en attente d\'envoi », puis enregistré', async () => {
    const { page, contexte } = await ouvrir('comptoire', 'commandes-clients.html');
    await contexte.setOffline(true);
    await page.fill('#cNom', 'École'); await page.fill('#cProduit', 'Croissant'); await page.fill('#cQuantite', '30');
    await page.click('#btnEnregistrer');
    await page.waitForTimeout(200);
    assert.match(await page.textContent('#etatSynchro'), /1 en attente d'envoi/);
    assert.match(await page.textContent('#listeProduction'), /Croissant/);
    assert.equal((await table(page, 'commandes_clients')).filter((c) => c.client_nom === 'École').length, 0, 'pas encore en base');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('apoint-cc-file:00000000-0000-4000-8000-00000000c0de')).length), 1);
    await contexte.setOffline(false);
    await page.waitForTimeout(500);
    assert.equal((await table(page, 'commandes_clients')).filter((c) => c.client_nom === 'École').length, 1, 'envoyée au retour du réseau');
    assert.match(await page.textContent('#etatSynchro'), /Tout est enregistré/);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('apoint-cc-file:00000000-0000-4000-8000-00000000c0de')).length), 0);
    await contexte.close();
  });

  await test('récurrence : chaque vendredi, sauf vacances, avec date de fin', async () => {
    const { page, contexte } = await ouvrir('comptoire', 'commandes-clients.html');
    await page.fill('#cNom', 'Café voisin'); await page.fill('#cProduit', 'Sandwich jambon-beurre'); await page.fill('#cQuantite', '120');
    await page.click('#repliRecurrence summary');
    await page.check('#joursRecurrence input[value="5"]');
    await page.check('#cSaufVacances');
    await page.fill('#cFin', '2027-06-30');
    await page.click('#btnEnregistrer');
    const l = (await table(page, 'commandes_clients')).find((c) => c.client_nom === 'Café voisin');
    assert.deepEqual([l.jours_recurrence, l.sauf_vacances, l.date_fin], [[5], true, '2027-06-30']);
    assert.match(await page.textContent('#listeRecurrentes'), /Café voisin[\s\S]*chaque vendredi jusqu'au/);
    await contexte.close();
  });

  await test('annulation : confirmation demandée, rien n\'est effacé, rétablissable', async () => {
    const { page, contexte } = await ouvrir('comptoire', 'commandes-clients.html');
    page.once('dialog', (d) => d.dismiss());
    await page.click('#listeRetraits [data-id="cc-mairie"] [data-action="annuler"]');
    assert.equal((await table(page, 'commandes_clients')).find((c) => c.id === 'cc-mairie').statut, 'active');
    page.once('dialog', (d) => d.accept());
    await page.click('#listeRetraits [data-id="cc-mairie"] [data-action="annuler"]');
    const c = (await table(page, 'commandes_clients')).find((x) => x.id === 'cc-mairie');
    assert.equal(c.statut, 'annulee', 'annulée, pas supprimée');
    assert.match(await page.textContent('#listeAnnulees'), /Mairie/);
    await page.click('#repliAnnulees summary');
    await page.click('#listeAnnulees [data-id="cc-mairie"] [data-action="retablir"]');
    assert.equal((await table(page, 'commandes_clients')).find((x) => x.id === 'cc-mairie').statut, 'active');
    await contexte.close();
  });

  await test('retrait et acompte au comptoir', async () => {
    const { page, contexte } = await ouvrir('comptoire', 'commandes-clients.html');
    await page.check('#listeRetraits [data-id="cc-mairie"] .case-retire');
    assert.deepEqual((await table(page, 'commandes_clients')).find((x) => x.id === 'cc-mairie').dates_retirees, ['2026-11-01']);
    await page.click('#jourRetraits [data-decalage="1"]');
    await page.click('#listeRetraits [data-id="cc-martin"] [data-action="encaisse"]');
    assert.equal((await table(page, 'commandes_clients')).find((x) => x.id === 'cc-martin').acompte_statut, 'encaisse');
    await contexte.close();
  });

  await test('Fournée : « 40 réservées + N boutique », dans la liste de cuisson ; bouton et alerte', async () => {
    const { page, contexte, erreurs } = await ouvrir('comptoire', 'previsions.html', '2026-11-01T03:30:00');
    const ligne = page.locator('.ligne-fournee[data-nom="Pain au chocolat"]');
    const texte = await ligne.textContent();
    const m = texte.match(/40 réservées \+ (\d+) boutique/);
    assert.ok(m, texte);
    assert.equal(Number(await ligne.getAttribute('data-prevu')), 40 + Number(m[1]));
    assert.match(await page.textContent('#lienCommandesClients'), /Commandes clients · 1 aujourd'hui/);
    assert.equal(await page.getAttribute('#lienCommandesClients', 'class'), 'bouton-secondaire');
    assert.match(await page.textContent('#alerteCommandes'), /Mme Martin, 1 Bûche pour demain \(modifiée\)/);
    assert.match(await page.textContent('#rappelCommandes'), /180 bûches commandées, 20 refusées/);
    await page.click('#btnVuCommandes');
    assert.equal(await page.isHidden('#alerteCommandes'), true);
    assert.deepEqual(erreurs, []);
    await contexte.close();
  });

  await test('Fournée hors période : lien discret ; table absente : « bientôt disponible »', async () => {
    let o = await ouvrir('hors-periode', 'previsions.html', '2026-03-10T05:00:00');
    assert.equal(await o.page.getAttribute('#lienCommandesClients', 'class'), 'lien-discret');
    assert.equal(await o.page.isHidden('#alerteCommandes'), true);
    await o.contexte.close();
    o = await ouvrir('sans-table', 'commandes-clients.html');
    assert.match(await o.page.textContent('#bientot'), /bientôt disponibles/);
    assert.equal(await o.page.isHidden('#formCommande'), true);
    assert.deepEqual(o.erreurs, []);
    await o.contexte.close();
    o = await ouvrir('sans-table', 'previsions.html');
    assert.match(await o.page.textContent('#listeRayons'), /Pain au chocolat/);
    assert.deepEqual(o.erreurs, []);
    await o.contexte.close();
  });

  await test('24 décembre, 5 h : aucun rappel de saisie, retraits avant la saisie, recherche 2 lettres', async () => {
    let o = await ouvrir('noel', 'previsions.html', '2026-12-24T05:00:00');
    assert.equal(await o.page.isHidden('#carteSaisieHier'), true);
    assert.equal(await o.page.isHidden('#bandeauReglages'), true);
    assert.match(await o.page.textContent('#listeRayons'), /Bûche[\s\S]*réservées/);
    await o.contexte.close();
    o = await ouvrir('noel', 'commandes-clients.html', '2026-12-24T05:00:00');
    const ordre = await o.page.evaluate(() => document.getElementById('titreRetraits').parentNode.compareDocumentPosition(document.getElementById('formCommande')) & Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(ordre, 'retraits avant le formulaire');
    const heures = await o.page.$$eval('#listeRetraits .ligne-commande .texte-aide--discret', (l) => l.map((x) => x.textContent.split(' · ')[0]));
    assert.ok(heures.length >= 40);
    const minutes = heures.filter((h) => /h/.test(h)).map((h) => { const [a, b] = h.split(' h'); return Number(a) * 60 + (Number(b) || 0); });
    assert.deepEqual(minutes, [...minutes].sort((a, b) => a - b), 'triés par heure');
    await o.page.fill('#recherche', 'Be');
    assert.match(await o.page.textContent('#resumeRetraits'), /trouvée/);
    await o.page.fill('#recherche', '06 1');
    assert.ok((await o.page.$$('#listeRetraits .ligne-commande')).length > 0);
    await o.contexte.close();
  });

  await test('rôles à l\'écran : vendeuse sans chiffres ni réglages, apprenti sans nom ni euros', async () => {
    let o = await ouvrir('vendeuse', 'commandes-clients.html');
    assert.equal(await o.page.isHidden('#navPrincipale'), true);
    assert.equal(await o.page.isHidden('#repliReglages'), true);
    assert.equal(await o.page.isHidden('#blocAVenir'), true);
    assert.equal(await o.page.isVisible('#formCommande'), true);
    await o.contexte.close();
    o = await ouvrir('apprenti', 'commandes-clients.html');
    const t = await o.page.innerText('#contenu');
    assert.doesNotMatch(t, /€|Mairie|Martin|0143/);
    assert.match(await o.page.textContent('#listeProduction'), /Pain au chocolat[\s\S]*40/);
    await o.contexte.close();
  });
  await test('Commande de matières : les pièces réservées des jours couverts comptent', async () => {
    const { page, contexte, erreurs } = await ouvrir('comptoire', 'commandes.html');
    const farine = async () => {
      const t = await page.innerText('#listeFournisseurs');
      const m = t.match(/Farine T65\n([\d,]+) kg/);
      return m ? Number(m[1].replace(',', '.')) : 0;
    };
    const avant = await farine();
    assert.ok(avant > 0);
    // 400 baguettes pour la cantine mercredi 4 (couvert par la livraison de mardi).
    await page.evaluate(() => {
      window.__demo.tables.commandes_clients.push({ id: 'cc-test', commercant_id: '00000000-0000-4000-8000-00000000c0de', client_nom: 'Cantine', produit: 'Baguettes', quantite: 400, date_retrait: '2026-11-04', statut: 'active', acompte_statut: 'aucun', acompte_montant: 0, dates_sautees: [], dates_retirees: [] });
      sessionStorage.setItem('__demo_db', JSON.stringify(window.__demo));
    });
    await page.reload(); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(300);
    const apres = await farine();
    console.log('    farine T65 : ' + avant + ' kg → ' + apres + ' kg avec 400 baguettes réservées');
    assert.ok(apres - avant > 400 * 0.15 && apres - avant < 400 * 0.4, avant + ' → ' + apres);
    assert.deepEqual(erreurs, []);
    await contexte.close();
  });

  await test('équipe : vendeuse et apprenti chargent la boutique du patron, sans aucun euro ni chiffre d\'affaires', async () => {
    for (const role of ['vendeuse', 'apprenti']) {
      for (const page of ['previsions.html', 'statistiques.html', 'commandes.html', 'semaine.html', 'caisse.html', 'parametres.html', 'commandes-clients.html']) {
        const o = await ouvrir(role, page);
        await o.page.waitForTimeout(300);
        const t = await o.page.innerText('body');
        assert.doesNotMatch(t, /€|chiffre d'affaires|marge/i, role + ' sur ' + page + ' → ' + o.page.url());
        if (['statistiques.html', 'commandes.html', 'semaine.html'].includes(page)) assert.match(o.page.url(), /previsions\.html$/, role + ' renvoyé vers la Fournée');
        if (page === 'previsions.html') {
          assert.match(t, /Baguette tradition/, role + ' voit la fournée du patron');
          assert.doesNotMatch(t, /Branche ta caisse|Saisir les ventes/, role + ' : pas d\'invitations du patron');
          assert.equal(await o.page.isVisible('.nav-onglets'), false, role + ' : pas d\'onglets');
          assert.match(t, /40 réservées \+ \d+ boutique/, role + " voit les commandes dans la fournée");
        }
        assert.deepEqual(o.erreurs, [], role + ' ' + page);
        await o.contexte.close();
      }
    }
  });
} finally {
  await browser.close();
  srv.close();
}

// ---------- 3. Migration (PGlite) ----------
let PGlite = null;
for (const m of [process.env.PGLITE, '@electric-sql/pglite', '/tmp/pgl/node_modules/@electric-sql/pglite/dist/index.js']) {
  if (!m) continue;
  try { ({ PGlite } = await import(m.startsWith('/') ? pathToFileURL(m).href : m)); break; } catch (e) { /* suivant */ }
}
if (!PGlite) console.log('- migration non testée (PGlite absent : npm i --no-save @electric-sql/pglite@0.3.7)');
else await test('migration : idempotente, RLS par rôle, aucune suppression, historique', async () => {
  const db = new PGlite();
  const P = '00000000-0000-0000-0000-00000000000a', V = '00000000-0000-0000-0000-00000000000b', A = '00000000-0000-0000-0000-00000000000c', X = '00000000-0000-0000-0000-00000000000d', S = '00000000-0000-0000-0000-00000000000e';
  await db.exec(`
    create schema auth; create table auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create role anon; create role authenticated;
    grant usage on schema public, auth to authenticated; grant execute on function auth.uid() to authenticated;
    insert into auth.users values ('${P}'), ('${V}'), ('${A}'), ('${X}'), ('${S}');
    create table personnel (id bigint generated by default as identity primary key, commercant_id uuid, nom text, role text, user_id uuid);
    alter table personnel enable row level security;
    create policy p on personnel for all using (auth.uid() = commercant_id);
    create table ventes (id bigint generated by default as identity primary key, commercant_id uuid, nom_produit text, quantite int, date_vente date);
    create table fournees (commercant_id uuid, date_fournee date, nom_produit text, quantite_cuite int, primary key (commercant_id, date_fournee, nom_produit));
    create table parametres_commercant (commercant_id uuid primary key, nom_restaurant text);
    create table produits (id bigint generated by default as identity primary key, commercant_id uuid, nom text, prix_vente numeric);
    do $$ declare t text; begin foreach t in array array['ventes','fournees','parametres_commercant','produits'] loop
      execute format('alter table %I enable row level security', t);
      execute format('create policy patron on %I for all using (auth.uid() = commercant_id)', t); end loop; end $$;
    insert into personnel (commercant_id, nom, role, user_id) values ('${P}', 'Julie', 'Vendeuse', '${V}'), ('${P}', 'Léo', 'Apprenti boulanger', '${A}'), ('${P}', 'Sam', 'Associé', '${S}');
    insert into ventes (commercant_id, nom_produit, quantite, date_vente) values ('${P}', 'Baguette', 100, '2026-11-01'); insert into produits (commercant_id, nom, prix_vente) values ('${P}', 'Baguette', 1.1);
  `);
  const sql = fs.readFileSync(path.join(ROOT, 'migration-commandes-clients.sql'), 'utf8');
  await db.exec(sql);
  await db.exec(sql); // idempotente
  await db.exec(`update personnel set acces_app = 'associe' where nom = 'Sam';
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant execute on all functions in schema public to authenticated;
    revoke delete on public.commandes_clients from authenticated;
    revoke insert, update, delete on public.commandes_clients_historique from authenticated;`);
  const en = async (uid, q, p) => { await db.exec(`reset role; select set_config('test.uid', '${uid}', false); set role authenticated;`); try { return (await db.query(q, p)).rows; } finally { await db.exec('reset role'); } };
  const nouvelle = `insert into commandes_clients (id, commercant_id, client_nom, produit, quantite, date_retrait, acompte_statut, acompte_montant) values ($1, '${P}', 'Mairie', 'Galette', 40, '2026-11-06', 'encaisse', 20)`;
  assert.equal((await db.query(`select acces_app from personnel order by id`)).rows.map((r) => r.acces_app).join(','), 'vendeuse,apprenti,associe');
  await en(V, nouvelle, ['11111111-1111-1111-1111-111111111111']);
  assert.equal((await en(P, 'select count(*)::int n from commandes_clients')).at(0).n, 1, 'patron voit la saisie de la vendeuse');
  assert.equal((await en(S, 'select count(*)::int n from commandes_clients')).at(0).n, 1, 'associé aussi');
  assert.equal((await en(A, 'select count(*)::int n from commandes_clients')).at(0).n, 0, 'apprenti : pas de noms ni d\'euros');
  const prod = await en(A, `select * from commandes_production('${P}')`);
  assert.equal(prod.length, 1); assert.equal('client_nom' in prod[0] || 'acompte_montant' in prod[0], false);
  assert.equal((await en(X, `select * from commandes_production('${P}')`)).length, 0, 'autre boutique : rien');
  assert.equal((await en(X, 'select count(*)::int n from commandes_clients')).at(0).n, 0);
  await assert.rejects(en(X, nouvelle, ['22222222-2222-2222-2222-222222222222']), /row-level security/);
  await assert.rejects(en(A, nouvelle, ['33333333-3333-3333-3333-333333333333']), /row-level security/);
  await en(V, `update commandes_clients set quantite = 45, commercant_id = '${X}'`);
  const apres = (await db.query('select quantite, commercant_id from commandes_clients')).rows[0];
  assert.equal(apres.quantite, 45); assert.equal(apres.commercant_id, P, 'la boutique ne change pas');
  assert.equal((await en(P, 'select (ancienne->>\'quantite\')::int q from commandes_clients_historique')).at(0).q, 40, 'ancienne version gardée');
  await assert.rejects(en(P, 'delete from commandes_clients'), /permission denied|ne se supprime pas/);
  await db.exec(`select set_config('test.uid', '${P}', false)`);
  await assert.rejects(db.query('delete from commandes_clients'), /ne se supprime pas/);
  assert.equal((await en(V, 'select count(*)::int n from ventes')).at(0).n, 1, 'vendeuse : quantités pour la Fournée');
  assert.equal((await en(V, 'select count(*)::int n from produits')).at(0).n, 0, 'vendeuse : pas de prix');
  assert.equal((await en(A, 'select count(*)::int n from produits')).at(0).n, 0, 'apprenti : pas de prix');
  assert.equal((await en(A, 'select count(*)::int n from ventes')).at(0).n, 1, 'apprenti : quantités pour la production');
  assert.equal((await en(S, 'select count(*)::int n from ventes')).at(0).n, 1, 'associé : tout');
  await en(A, `insert into fournees values ('${P}', '2026-11-01', 'Baguette', 90)`);
  await assert.rejects(en(V, `update personnel set acces_app = 'associe' where user_id = '${V}' returning id`).then((r) => { if (!r.length) throw new Error('row-level security : rien modifié'); }), /row-level security/);
});

console.log('\n' + ok + ' réussis, ' + ko + ' en échec');
process.exit(ko ? 1 : 0);
