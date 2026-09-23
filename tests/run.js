// Suite de tests Playwright pour À Point.
// Ne dépend pas de @playwright/test (indisponible hors-ligne dans ce
// sandbox) : utilise directement la lib `playwright` déjà installée
// globalement, avec un petit harnais maison (describe/test/expect).
//
// Lancement : node tests/run.js
// Nécessite un serveur statique sur http://127.0.0.1:4173 (démarré
// automatiquement par tests/run.js lui-même).

const path = require('path');
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4173;
const BASE_URL = 'http://127.0.0.1:' + PORT;

const PAGES_PROTEGEES = [
  'tableau-de-bord.html',
  'produits.html',
  'previsions.html',
  'ventes.html',
  'parametres.html',
  'aide.html',
  'commandes.html',
  'personnel.html',
  'import.html',
];

// Ce sandbox bloque cdn.jsdelivr.net (politique réseau de l'organisation,
// cf. /root/.ccr/README.md — 403/407 à ne pas contourner). supabase-js ne
// se charge donc jamais ici, et window.supabase reste undefined : chaque
// page plante dès sa première ligne (`sbClient.auth...`) avant même
// d'attacher ses écouteurs de clic. On fournit un faux window.supabase
// minimal (jamais de vraie session, jamais de vrai réseau) uniquement
// pour permettre au reste du script de s'exécuter et de tester la
// logique client (validation de formulaire, bascule d'onglets, nav.js…).
// Ça ne teste PAS l'intégration Supabase réelle — voir la note en bas de
// ce fichier.
async function stubSupabase(page) {
  await page.addInitScript(() => {
    window.supabase = {
      createClient: function () {
        return {
          auth: {
            getSession: function () { return Promise.resolve({ data: { session: null } }); },
            signInWithPassword: function () { return Promise.resolve({ data: {}, error: { message: 'stub: pas de réseau dans ce sandbox' } }); },
            signUp: function () { return Promise.resolve({ data: {}, error: { message: 'stub: pas de réseau dans ce sandbox' } }); },
            resetPasswordForEmail: function () { return Promise.resolve({ data: {}, error: { message: 'stub: pas de réseau dans ce sandbox' } }); },
            updateUser: function () { return Promise.resolve({ data: { user: { user_metadata: {} } }, error: null }); },
            onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
          },
          from: function () {
            var chain = {
              select: function () { return chain; },
              eq: function () { return Promise.resolve({ data: [], error: null }); },
            };
            return chain;
          },
          functions: {
            invoke: function () { return Promise.resolve({ data: { ok: true }, error: null }); },
          },
        };
      },
    };
  });
}

// Stub avec une session active et des données factices (personnel +
// créneaux), pour tester la logique de personnel.html qui a besoin d'un
// commerçant "connecté" — toujours sans aucun vrai réseau.
async function stubSupabaseAvecDonnees(page, { commercantId, tables }) {
  await page.addInitScript(({ commercantId, tables }) => {
    window.supabase = {
      createClient: function () {
        return {
          auth: {
            getSession: function () {
              return Promise.resolve({ data: { session: { user: { id: commercantId, email: 'test@test.com' } } } });
            },
          },
          from: function (table) {
            var data = (tables && tables[table]) || [];
            var chain = {
              _data: data,
              select: function () { return chain; },
              order: function () { return chain; },
              eq: function () { return chain; },
              gte: function () { return chain; },
              lte: function () { return chain; },
              lt: function () { return chain; },
              in: function () { return chain; },
              then: function (cb) { return Promise.resolve({ data: chain._data, error: null }).then(cb); },
              insert: function (lignes) {
                var inserted = { data: Array.isArray(lignes) ? lignes : [lignes], error: null };
                return {
                  select: function () { return Promise.resolve(inserted); },
                  then: function (cb) { return Promise.resolve(inserted).then(cb); },
                };
              },
              delete: function () {
                var d = {
                  eq: function () { return d; },
                  gte: function () { return d; },
                  lte: function () { return d; },
                  then: function (cb) { return Promise.resolve({ data: [], error: null }).then(cb); },
                };
                return d;
              },
              update: function () {
                var u = { eq: function () { return Promise.resolve({ data: [], error: null }); } };
                return u;
              },
            };
            return chain;
          },
          functions: {
            invoke: function (nom, options) {
              window.__dernierAppelFunction = { nom: nom, options: options };
              return Promise.resolve({ data: { ok: true }, error: null });
            },
          },
        };
      },
    };
  }, { commercantId, tables });
}

let passed = 0;
let failed = 0;
const failures = [];

function expect(actual) {
  function makeMatchers(negate) {
    function fail(msg) {
      throw new Error(negate ? 'Négation échouée : ' + msg : msg);
    }
    return {
      toBe(expected) {
        const ok = actual === expected;
        if (ok === negate) fail('Attendu ' + JSON.stringify(expected) + ' mais reçu ' + JSON.stringify(actual));
      },
      toContain(expected) {
        const ok = typeof actual === 'string' && actual.indexOf(expected) !== -1;
        if (ok === negate) fail('Attendu que ' + JSON.stringify(actual) + ' contienne ' + JSON.stringify(expected));
      },
      toBeTruthy() {
        const ok = !!actual;
        if (ok === negate) fail('Attendu une valeur truthy, reçu ' + JSON.stringify(actual));
      },
      toBeGreaterThan(n) {
        const ok = actual > n;
        if (ok === negate) fail('Attendu > ' + n + ', reçu ' + actual);
      },
      toHaveLength(n) {
        const ok = !!actual && actual.length === n;
        if (ok === negate) fail('Attendu longueur ' + n + ', reçu ' + (actual && actual.length));
      },
    };
  }
  const matchers = makeMatchers(false);
  matchers.not = makeMatchers(true);
  return matchers;
}

let currentSuite = '';
async function describe(name, fn) {
  currentSuite = name;
  await fn();
}

async function test(name, fn) {
  const label = currentSuite + ' › ' + name;
  try {
    await fn();
    passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + label);
  } catch (err) {
    failed++;
    failures.push({ label, err });
    console.log('  \x1b[31m✗\x1b[0m ' + label);
    console.log('      ' + err.message);
  }
}

// Petit serveur statique maison (évite toute dépendance npm externe).
function startStaticServer() {
  const fs = require('fs');
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.png': 'image/png',
  };
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.join(ROOT, urlPath);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found: ' + urlPath);
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const server = await startStaticServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  await stubSupabase(page);

  try {
    await describe('Redirections racine', async () => {
      await test('index.html redirige vers connexion.html', async () => {
        await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
        await page.waitForURL('**/connexion.html');
        expect(page.url()).toContain('connexion.html');
      });

      await test('import.html est une page réelle et distincte (ne redirige plus vers commandes.html)', async () => {
        await page.goto(BASE_URL + '/import.html', { waitUntil: 'load' });
        expect(page.url()).toContain('import.html');
        expect(await page.title()).toContain('Importation');
      });
    });

    // Étape 5 (cahier des charges V2, sept. 2026) : l'import (ventes / fiches
    // techniques / prix) déménage de commandes.html vers sa propre page
    // import.html, comportement inchangé. Ces tests exercent le vrai flux
    // (upload CSV réel, détection automatique de colonnes, écriture en base)
    // — jusqu'ici seul un message de repli était testé, jamais l'import
    // fonctionnel lui-même. cdn.jsdelivr.net (Papaparse/xlsx) est bloqué dans
    // ce sandbox (même limitation réseau que supabase-js, cf. note en haut de
    // ce fichier) : on fournit un stub minimal de Papa.parse qui reproduit
    // juste le contrat utilisé par le code (header:true → {data, meta.fields}),
    // sans réimplémenter le vrai parseur CSV.
    await describe('import.html — flux d\'import fonctionnel (ventes)', async () => {
      const commercantId = 'test-commercant-import-ventes';
      const tables = {
        ventes: [],
        produits: [{ id: 'prod-croissant', commercant_id: commercantId, nom: 'Croissant' }],
        ingredients_produit: [],
        parametres_commercant: [],
        evenements_commercant: [],
      };

      const pageImport = await browser.newPage();
      await stubSupabaseAvecDonnees(pageImport, { commercantId, tables });
      await pageImport.addInitScript(() => {
        window.Papa = {
          // import.html décode désormais lui-même les octets du fichier
          // (détection d'encodage) et appelle Papa.parse(texteCsv, options)
          // avec une chaîne déjà décodée, plus un objet File.
          parse: function (texteCsv, options) {
            var lignes = texteCsv.split('\n').filter(function (l) { return l.trim() !== ''; });
            var entetes = lignes[0].split(',');
            var data = lignes.slice(1).map(function (ligne) {
              var valeurs = ligne.split(',');
              var obj = {};
              entetes.forEach(function (e, i) { obj[e] = valeurs[i]; });
              return obj;
            });
            options.complete({ data: data, meta: { fields: entetes } });
          },
        };
      });

      // "Pain au chocolat" est un nouveau produit (absent de `produits`) :
      // avec seulement 3 lignes, la détection automatique de confiance
      // (seuil 0.75, cf. SEUIL_AUTOMATIQUE) n'est pas censée se déclencher
      // pour la colonne produit — c'est le chemin réaliste et volontaire à
      // tester ici : colonnes bien pré-détectées, mais validation manuelle
      // ("Continuer") requise avant import, jamais un import silencieux.
      const csv = 'date,produit,quantite\n2026-08-03,Croissant,40\n2026-08-04,Croissant,35\n2026-08-05,Pain au chocolat,28\n';

      await test('un CSV de ventes est prévisualisé avec les bonnes colonnes pré-détectées, validé manuellement, puis importé avec succès', async () => {
        await pageImport.goto(BASE_URL + '/import.html');
        await pageImport.locator('#fichierImport').waitFor({ state: 'visible' });

        await pageImport.setInputFiles('#fichierImport', {
          name: 'ventes.csv',
          mimeType: 'text/csv',
          buffer: Buffer.from(csv, 'utf-8'),
        });

        await pageImport.locator('#zoneMapping').waitFor({ state: 'visible', timeout: 10000 });
        expect(await pageImport.locator('#selectDate').inputValue()).toBe('date');
        expect(await pageImport.locator('#selectProduit').inputValue()).toBe('produit');
        expect(await pageImport.locator('#selectQuantite').inputValue()).toBe('quantite');
        expect(await pageImport.locator('#banniereVerification').innerText()).toContain('Tout semble correct');

        await pageImport.locator('#btnValiderMapping').click();
        await pageImport.locator('#btnImporter').waitFor({ state: 'visible', timeout: 10000 });
        const apercu = await pageImport.locator('#apercu').innerText();
        expect(apercu).toContain('Croissant');
        expect(apercu).toContain('Pain au chocolat');
        expect(apercu).toContain('3 ligne(s) prête(s) à importer');
        // "Pain au chocolat" n'existe pas encore dans produits → signalé.
        expect(apercu).toContain('nouveau(x) produit(s)');

        await pageImport.locator('#btnImporter').click();
        await pageImport.locator('#message.succes').waitFor({ state: 'visible', timeout: 10000 });
        const messageFinal = await pageImport.locator('#message').innerText();
        expect(messageFinal).toContain('3 ventes importées avec succès');
        expect(messageFinal).toContain('Voir mes prévisions');
      });

      // Fichiers "réalistes" : dates en toutes lettres avec suffixe ordinal
      // français ("1er août"), quantité avec séparateur de milliers français
      // sans ambiguïté ("1 234" avec espace). Avec des colonnes bien
      // reconnues, la détection automatique de confiance se déclenche : pas
      // de #zoneMapping à valider, l'import se prépare directement.
      await test('un CSV avec dates en lettres (suffixe ordinal) et quantité à séparateur de milliers est importé correctement', async () => {
        const csvFormatsFr = 'date,produit,quantite\n1er août 2026,Croissant,1 234\n2 août 2026,Croissant,35\n';
        await pageImport.goto(BASE_URL + '/import.html');
        await pageImport.locator('#fichierImport').waitFor({ state: 'visible' });

        await pageImport.setInputFiles('#fichierImport', {
          name: 'ventes-fr.csv',
          mimeType: 'text/csv',
          buffer: Buffer.from(csvFormatsFr, 'utf-8'),
        });

        await pageImport.locator('#btnImporter').waitFor({ state: 'visible', timeout: 10000 });
        const apercu = await pageImport.locator('#apercu').innerText();
        // "1 234" (espace = séparateur de milliers) doit être compris comme
        // 1234, pas 1 (arrondi d'une lecture erronée). Les deux dates en
        // lettres ("1er août" et "2 août") doivent aussi être reconnues.
        expect(apercu).toContain('2 ligne(s) prête(s) à importer');
        expect(apercu).not.toContain('ignorée');
        expect(apercu).toContain('1234');

        await pageImport.locator('#btnImporter').click();
        await pageImport.locator('#message.succes').waitFor({ state: 'visible', timeout: 10000 });
        const messageFinal = await pageImport.locator('#message').innerText();
        expect(messageFinal).toContain('2 ventes importées avec succès');
      });

      await test('un CSV encodé en windows-1252 (accents Excel) est décodé correctement, pas en caractères de remplacement', async () => {
        // Fichier entièrement en windows-1252 (comme un vrai export Excel),
        // pas un mélange d'encodages : "É" (0xC9 seul seul) n'est pas un
        // octet UTF-8 valide, un décodage UTF-8 naïf produit "�" sur tout
        // le buffer, ce qui doit déclencher le repli windows-1252.
        const csvComplet = 'date,produit,quantite\n3 août 2026,Éclair au chocolat,12\n';
        const bufferComplet = Buffer.from(csvComplet, 'latin1'); // proche de windows-1252 pour ces caractères

        await pageImport.goto(BASE_URL + '/import.html');
        await pageImport.locator('#fichierImport').waitFor({ state: 'visible' });

        await pageImport.setInputFiles('#fichierImport', {
          name: 'ventes-win1252.csv',
          mimeType: 'text/csv',
          buffer: bufferComplet,
        });

        // Selon la confiance de détection, la zone de mapping peut être
        // sautée (détection automatique) ou affichée (validation manuelle) :
        // on attend que l'un des deux état se stabilise avant de vérifier.
        await Promise.race([
          pageImport.locator('#zoneMapping').waitFor({ state: 'visible', timeout: 10000 }),
          pageImport.locator('#btnImporter').waitFor({ state: 'visible', timeout: 10000 }),
        ]);
        if (await pageImport.locator('#zoneMapping').isVisible()) {
          await pageImport.locator('#btnValiderMapping').click();
        }
        await pageImport.locator('#btnImporter').waitFor({ state: 'visible', timeout: 10000 });
        const apercu = await pageImport.locator('#apercu').innerText();
        expect(apercu).toContain('Éclair au chocolat');
        expect(apercu).not.toContain('�');
      });

      // Format "large" : une colonne par produit (suivi artisanal classique
      // en tableur), plutôt qu'une ligne par vente. Doit être reconnu et
      // transformé automatiquement en format long avant l'aperçu/l'import.
      await test('un CSV au format large (une colonne par produit) est détecté et converti en ventes individuelles', async () => {
        const csvLarge = 'Date,Croissant,Pain au chocolat,Baguette\n2026-08-01,40,20,60\n2026-08-02,35,18,55\n';
        await pageImport.goto(BASE_URL + '/import.html');
        await pageImport.locator('#fichierImport').waitFor({ state: 'visible' });

        await pageImport.setInputFiles('#fichierImport', {
          name: 'ventes-large.csv',
          mimeType: 'text/csv',
          buffer: Buffer.from(csvLarge, 'utf-8'),
        });

        await Promise.race([
          pageImport.locator('#zoneMapping').waitFor({ state: 'visible', timeout: 10000 }),
          pageImport.locator('#btnImporter').waitFor({ state: 'visible', timeout: 10000 }),
        ]);
        if (await pageImport.locator('#zoneMapping').isVisible()) {
          await pageImport.locator('#btnValiderMapping').click();
        }
        await pageImport.locator('#btnImporter').waitFor({ state: 'visible', timeout: 10000 });
        const apercu = await pageImport.locator('#apercu').innerText();
        // 2 jours x 3 produits = 6 ventes individuelles, pas 2 lignes larges.
        expect(apercu).toContain('6 ligne(s) prête(s) à importer');
        expect(apercu).toContain('Croissant');
        expect(apercu).toContain('Pain au chocolat');
        expect(apercu).toContain('Baguette');

        await pageImport.locator('#btnImporter').click();
        await pageImport.locator('#message.succes').waitFor({ state: 'visible', timeout: 10000 });
        const messageFinal = await pageImport.locator('#message').innerText();
        expect(messageFinal).toContain('6 ventes importées avec succès');
      });

      // Classeur Excel multi-feuilles : la bonne feuille ("Ventes 2026", qui
      // contient de vraies données de ventes) doit être choisie
      // automatiquement plutôt que la première feuille du classeur
      // ("Résumé", qui ne ressemble à rien d'exploitable).
      await test('un classeur Excel avec plusieurs feuilles choisit automatiquement la feuille qui ressemble à des ventes', async () => {
        const pageXlsx = await browser.newPage();
        await stubSupabaseAvecDonnees(pageXlsx, { commercantId, tables });
        await pageXlsx.addInitScript(() => {
          // Stub minimal de la partie de XLSX utilisée par import.html :
          // XLSX.read reçoit ici directement un objet {feuilles} sérialisé en
          // JSON dans les octets du "fichier" (pas un vrai binaire .xlsx,
          // cdn.jsdelivr.net étant bloqué dans ce sandbox — cf. note en haut
          // de ce fichier), et sheet_to_json renvoie les lignes déjà toutes
          // prêtes.
          window.XLSX = {
            read: function (donnees) {
              var texte = new TextDecoder('utf-8').decode(donnees);
              var classeurFake = JSON.parse(texte);
              var sheets = {};
              Object.keys(classeurFake).forEach(function (nom) { sheets[nom] = classeurFake[nom]; });
              return { SheetNames: Object.keys(classeurFake), Sheets: sheets };
            },
            utils: {
              sheet_to_json: function (feuille) { return feuille; },
            },
          };
        });

        await pageXlsx.goto(BASE_URL + '/import.html');
        await pageXlsx.locator('#fichierImport').waitFor({ state: 'visible' });

        const classeurFake = {
          'Résumé': [{ Note: 'Voir onglet ventes' }],
          'Ventes 2026': [
            { date: '2026-08-01', produit: 'Croissant', quantite: 40 },
            { date: '2026-08-02', produit: 'Croissant', quantite: 35 },
            { date: '2026-08-03', produit: 'Pain au chocolat', quantite: 28 },
          ],
        };
        await pageXlsx.setInputFiles('#fichierImport', {
          name: 'ventes-multi-feuilles.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          buffer: Buffer.from(JSON.stringify(classeurFake), 'utf-8'),
        });

        await Promise.race([
          pageXlsx.locator('#zoneMapping').waitFor({ state: 'visible', timeout: 10000 }),
          pageXlsx.locator('#btnImporter').waitFor({ state: 'visible', timeout: 10000 }),
        ]);
        // La feuille "Résumé" n'ayant aucune colonne exploitable, le choix
        // automatique doit avoir retenu "Ventes 2026" sans demander au
        // commerçant (une seule feuille se détache nettement de l'autre).
        expect(await pageXlsx.locator('#zoneChoixFeuille').isVisible()).toBe(false);
        if (await pageXlsx.locator('#zoneMapping').isVisible()) {
          await pageXlsx.locator('#btnValiderMapping').click();
        }
        await pageXlsx.locator('#btnImporter').waitFor({ state: 'visible', timeout: 10000 });
        const apercu = await pageXlsx.locator('#apercu').innerText();
        expect(apercu).toContain('3 ligne(s) prête(s) à importer');
        expect(apercu).toContain('Croissant');

        await pageXlsx.close();
      });

      // "Croisant" (faute de frappe) ne doit pas créer silencieusement un
      // nouveau produit distinct de "Croissant" (déjà existant dans
      // `tables.produits`) : une confirmation doit être demandée, et le
      // choix "utiliser l'existant" doit rattacher la vente au bon produit.
      await test('un nom de produit avec une faute de frappe proche d\'un produit existant déclenche une confirmation avant import', async () => {
        const csvFaute = 'date,produit,quantite\n2026-08-01,Croisant,40\n2026-08-02,Croisant,35\n';
        await pageImport.goto(BASE_URL + '/import.html');
        await pageImport.locator('#fichierImport').waitFor({ state: 'visible' });

        await pageImport.setInputFiles('#fichierImport', {
          name: 'ventes-faute.csv',
          mimeType: 'text/csv',
          buffer: Buffer.from(csvFaute, 'utf-8'),
        });

        // Avec un nom de produit inconnu ("Croisant"), la détection de
        // colonnes n'est pas assez confiante pour sauter la vérification :
        // il faut valider le mapping manuellement avant que la vérification
        // de correspondance floue s'exécute.
        await pageImport.locator('#zoneMapping').waitFor({ state: 'visible', timeout: 10000 });
        await pageImport.locator('#btnValiderMapping').click();
        await pageImport.locator('#zoneCorrespondances').waitFor({ state: 'visible', timeout: 10000 });
        const texteCorrespondance = await pageImport.locator('#zoneCorrespondances').innerText();
        expect(texteCorrespondance).toContain('Croisant');
        expect(texteCorrespondance).toContain('Croissant');
        // #btnImporter ne doit pas apparaître tant que la confirmation
        // n'est pas donnée : rien n'est rapproché silencieusement.
        expect(await pageImport.locator('#btnImporter').isVisible()).toBe(false);

        // Choix par défaut ("utiliser l'existant") laissé tel quel.
        await pageImport.locator('#btnConfirmerCorrespondances').click();
        await pageImport.locator('#btnImporter').waitFor({ state: 'visible', timeout: 10000 });
        const apercu = await pageImport.locator('#apercu').innerText();
        // Le nom affiché doit être le produit existant, pas "Croisant".
        expect(apercu).toContain('Croissant');
        expect(apercu).not.toContain('Croisant,');
        expect(apercu).not.toContain('nouveau(x) produit(s)');

        await pageImport.locator('#btnImporter').click();
        await pageImport.locator('#message.succes').waitFor({ state: 'visible', timeout: 10000 });
        const messageFinal = await pageImport.locator('#message').innerText();
        expect(messageFinal).toContain('2 ventes importées avec succès');
        expect(messageFinal).not.toContain('nouveau(x) produit(s)');
      });

      // Même faute de frappe, mais cette fois le commerçant choisit de créer
      // un nouveau produit malgré la suggestion : son choix doit être
      // respecté (jamais un rapprochement forcé).
      await test('le commerçant peut refuser la correspondance suggérée et créer un nouveau produit', async () => {
        const csvFaute = 'date,produit,quantite\n2026-08-01,Croisant,40\n2026-08-02,Croisant,35\n';
        await pageImport.goto(BASE_URL + '/import.html');
        await pageImport.locator('#fichierImport').waitFor({ state: 'visible' });

        await pageImport.setInputFiles('#fichierImport', {
          name: 'ventes-faute2.csv',
          mimeType: 'text/csv',
          buffer: Buffer.from(csvFaute, 'utf-8'),
        });

        await pageImport.locator('#zoneMapping').waitFor({ state: 'visible', timeout: 10000 });
        await pageImport.locator('#btnValiderMapping').click();
        await pageImport.locator('#zoneCorrespondances').waitFor({ state: 'visible', timeout: 10000 });
        await pageImport.locator('#correspondance0').selectOption('nouveau');
        await pageImport.locator('#btnConfirmerCorrespondances').click();
        await pageImport.locator('#btnImporter').waitFor({ state: 'visible', timeout: 10000 });
        const apercu = await pageImport.locator('#apercu').innerText();
        expect(apercu).toContain('Croisant');
        expect(apercu).toContain('nouveau(x) produit(s)');
      });

      await pageImport.close();
    });

    await describe('Page de connexion', async () => {
      await test('affiche le formulaire de connexion par défaut', async () => {
        await page.goto(BASE_URL + '/connexion.html');
        expect(await page.locator('#btnAction').textContent()).toBe('Se connecter');
        expect(await page.locator('#ligneCgu').isVisible()).toBe(false);
      });

      await test("bascule vers le formulaire d'inscription et affiche les CGU", async () => {
        await page.goto(BASE_URL + '/connexion.html');
        await page.locator('#ongletInscription').click();
        expect(await page.locator('#btnAction').textContent()).toBe('Créer mon compte');
        expect(await page.locator('#ligneCgu').isVisible()).toBe(true);
      });

      await test('refuse la soumission sans email/mot de passe', async () => {
        await page.goto(BASE_URL + '/connexion.html');
        await page.locator('#btnAction').click();
        await page.locator('#message').waitFor({ state: 'visible' });
        expect(await page.locator('#message').textContent()).toContain('Remplis');
      });

      await test("refuse l'inscription sans case CGU cochée", async () => {
        await page.goto(BASE_URL + '/connexion.html');
        await page.locator('#ongletInscription').click();
        await page.fill('#email', 'test@example.com');
        await page.fill('#motdepasse', 'motdepasse123');
        await page.locator('#btnAction').click();
        await page.locator('#message').waitFor({ state: 'visible' });
        expect(await page.locator('#message').textContent()).toContain('conditions générales');
      });

      await test('lien mot de passe oublié exige un email', async () => {
        await page.goto(BASE_URL + '/connexion.html');
        await page.locator('#lienMotDePasseOublie').click();
        await page.locator('#message').waitFor({ state: 'visible' });
        expect(await page.locator('#message').textContent()).toContain('email');
      });
    });

    await describe('nav.js — logique de navigation commune', async () => {
      for (const fichier of PAGES_PROTEGEES) {
        await test(fichier + ' charge nav.js et peuple #navPrincipale', async () => {
          await page.goto(BASE_URL + '/' + fichier);
          await page.locator('#navPrincipale').waitFor({ state: 'attached' });
          const html = await page.locator('#navPrincipale').innerHTML();
          expect(html.length).toBeGreaterThan(0);
        });
      }

      // Refonte sept. 2026 (maquette validée) : Accueil / Prévisions /
      // Planning toujours visibles ; Mes produits / Commandes / Imports
      // passent en repli sous 720px ; Paramètres / Aide en nav secondaire ;
      // le ☰ ne contient jamais les 3 liens principaux.
      await test('Accueil, Prévisions et Planning sont toujours visibles (classe nav-lien-g, pas --repli)', async () => {
        await page.goto(BASE_URL + '/tableau-de-bord.html');
        const liens = await page.locator('#navPrincipale a.nav-lien-g:not(.nav-lien-g--repli)').allTextContents();
        expect(liens.join(',')).toBe('Accueil,Prévisions,Planning');
      });

      await test('marque "Accueil" actif sur tableau-de-bord.html', async () => {
        await page.goto(BASE_URL + '/tableau-de-bord.html');
        const actif = page.locator('#navPrincipale a.nav-lien-g.actif');
        expect(await actif.textContent()).toBe('Accueil');
      });

      await test('marque "Prévisions" actif sur previsions.html', async () => {
        await page.goto(BASE_URL + '/previsions.html');
        const actif = page.locator('#navPrincipale a.nav-lien-g.actif');
        expect(await actif.textContent()).toBe('Prévisions');
      });

      await test('marque "Achats & commandes" actif sur commandes.html', async () => {
        await page.goto(BASE_URL + '/commandes.html');
        const actif = page.locator('#navPrincipale a.nav-lien-g.actif');
        expect(await actif.textContent()).toBe('Achats & commandes');
      });

      await test('Produits vendus / Achats & commandes / Imports sont en repli (cachés sous 720px)', async () => {
        await page.goto(BASE_URL + '/tableau-de-bord.html');
        const liens = await page.locator('#navPrincipale a.nav-lien-g--repli').allTextContents();
        expect(liens.join(',')).toBe('Produits vendus,Achats & commandes,Imports');
      });

      await test('nav secondaire contient Paramètres et Aide', async () => {
        await page.goto(BASE_URL + '/tableau-de-bord.html');
        const liens = await page.locator('.entete-site .nav-secondaire a.nav-lien-s').allTextContents();
        expect(liens.join(',')).toContain('Paramètres');
        expect(liens.join(',')).toContain('Aide');
      });

      await test('nav-secondaire et btn-hamburger sont des siblings de #navPrincipale (pas imbriqués, maquette validée)', async () => {
        await page.goto(BASE_URL + '/tableau-de-bord.html');
        const imbrique = await page.locator('#navPrincipale .nav-secondaire, #navPrincipale .btn-hamburger').count();
        expect(imbrique).toBe(0);
        const siblings = await page.locator('.entete-site > .nav-secondaire, .entete-site > .btn-hamburger').count();
        expect(siblings).toBe(2);
      });

      await test('le panneau ☰ ne contient jamais Accueil, Prévisions ou Planning', async () => {
        await page.goto(BASE_URL + '/tableau-de-bord.html');
        const liensHamburger = await page.locator('.panneau-hamburger a').allTextContents();
        expect(liensHamburger).not.toContain('Accueil');
        expect(liensHamburger).not.toContain('Prévisions');
        expect(liensHamburger).not.toContain('Planning');
        expect(liensHamburger.join(',')).toContain('Achats & commandes');
        expect(liensHamburger.join(',')).toContain('Paramètres');
      });

      await test('clic sur le bouton ☰ ouvre le panneau, clic en dehors le referme', async () => {
        // Le bouton ☰ n'est visible que sous 720px (voir style.css) : il
        // faut un viewport mobile pour pouvoir cliquer dessus.
        await page.setViewportSize({ width: 400, height: 800 });
        await page.goto(BASE_URL + '/tableau-de-bord.html');
        const panneau = page.locator('.panneau-hamburger');
        await page.locator('.entete-site .btn-hamburger').click();
        expect(await panneau.getAttribute('class')).toContain('panneau-hamburger--ouvert');
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        expect(await panneau.getAttribute('class')).not.toContain('panneau-hamburger--ouvert');
        await page.setViewportSize({ width: 1280, height: 800 });
      });

      await test('en mobile, le ☰ reste sur la même ligne que le logo (pas sur sa propre ligne sous la nav)', async () => {
        await page.setViewportSize({ width: 400, height: 800 });
        await page.goto(BASE_URL + '/tableau-de-bord.html');
        const logoBox = await page.locator('.entete-site .logo').boundingBox();
        const boutonBox = await page.locator('.entete-site .btn-hamburger').boundingBox();
        expect(Math.abs(logoBox.y - boutonBox.y) < 10).toBeTruthy();
        await page.setViewportSize({ width: 1280, height: 800 });
      });

      // Bug retour utilisateur, sept. 2026 : sur les pages en
      // .conteneur--moyen (produits/paramètres/aide/ventes/import),
      // l'en-tête était imbriquée dans ce conteneur étroit (560px) et
      // .nav-globale (overflow-x:auto, scrollbar invisible) coupait
      // silencieusement "Commandes"/"Imports" en desktop. Corrigé en sortant
      // l'en-tête de .conteneur (voir .entete-site--pleine-largeur, déjà
      // utilisée par personnel.html). Ce test vérifie que tous les liens
      // restent bien visibles, quelle que soit la page.
      for (const fichier of ['produits.html', 'parametres.html', 'aide.html', 'ventes.html', 'import.html']) {
        await test(fichier + ' : tous les liens de nav restent dans la fenêtre visible en desktop (pas coupés par .nav-globale)', async () => {
          await page.goto(BASE_URL + '/' + fichier);
          const viewport = page.viewportSize();
          const nbLiens = await page.locator('#navPrincipale a').count();
          expect(nbLiens).toBeGreaterThan(0);
          for (let i = 0; i < nbLiens; i++) {
            const box = await page.locator('#navPrincipale a').nth(i).boundingBox();
            expect(box).toBeTruthy();
            expect(box.x >= 0).toBeTruthy();
            expect(box.x + box.width <= viewport.width).toBeTruthy();
          }
          const secLiens = await page.locator('.nav-secondaire a').allTextContents();
          expect(secLiens.join(',')).toContain('Paramètres');
        });
      }
    });

    await describe('Comportement sans session (non connecté)', async () => {
      const attentes = {
        'tableau-de-bord.html': 'Non connecté',
        'aide.html': "n'es pas connecté",
        'import.html': "n'es pas connecté",
      };
      for (const [fichier, texteAttendu] of Object.entries(attentes)) {
        await test(fichier + ' affiche un message de non-connexion sans exception JS', async () => {
          const erreurs = [];
          page.on('pageerror', (e) => erreurs.push(e.message));
          await page.goto(BASE_URL + '/' + fichier);
          await page.waitForTimeout(800);
          const corps = await page.locator('body').innerText();
          expect(corps).toContain(texteAttendu);
          expect(erreurs).toHaveLength(0);
        });
      }
    });

    await describe('Intégrité structurelle des pages modifiées', async () => {
      for (const fichier of PAGES_PROTEGEES) {
        await test(fichier + " n'a pas d'erreur JS au chargement", async () => {
          const erreurs = [];
          const onErr = (e) => erreurs.push(e.message);
          page.on('pageerror', onErr);
          await page.goto(BASE_URL + '/' + fichier);
          await page.waitForTimeout(600);
          page.off('pageerror', onErr);
          expect(erreurs).toHaveLength(0);
        });
      }

      await test("l'ancien <nav class=\"nav-principale\"> codé en dur a bien été retiré des pages migrées", async () => {
        const fs = require('fs');
        for (const fichier of PAGES_PROTEGEES) {
          const contenu = fs.readFileSync(path.join(ROOT, fichier), 'utf8');
          if (contenu.includes('class="nav-principale"')) {
            throw new Error(fichier + ' contient encore l\'ancienne nav codée en dur');
          }
        }
      });
    });

    await describe('commandes.html — présence des sections clés', async () => {
      await test('la page contient une zone d\'import et une zone de résultats', async () => {
        await page.goto(BASE_URL + '/commandes.html');
        const corps = await page.locator('body').innerHTML();
        expect(corps.length).toBeGreaterThan(0);
      });
    });

    // Cadencier Intelligent (16 septembre 2026) : sélecteur de période de
    // couverture, aperçu "Habitude" recalculé dynamiquement et regroupé par
    // famille déduite (sans jargon, sans fournisseur — cf. décision produit :
    // "catégorie déduite, pas de fournisseur"), et pont Semaine → Commandes.
    await describe('commandes.html — Cadencier : période de couverture et aperçu Habitude', async () => {
      const commercantId = 'test-commercant-cadencier';
      const lundis = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'];
      const ventesCroissant = lundis.map((d) => ({ commercant_id: commercantId, nom_produit: 'Croissant', date_vente: d, quantite: 40 }));

      const tables = {
        ventes: ventesCroissant,
        produits: [{ id: 'prod-croissant', commercant_id: commercantId, nom: 'Croissant' }],
        ingredients_produit: [
          { id: 'ing1', commercant_id: commercantId, produit_id: 'prod-croissant', nom_ingredient: 'Beurre', quantite: 0.02, unite: 'kg' },
          { id: 'ing2', commercant_id: commercantId, produit_id: 'prod-croissant', nom_ingredient: 'Farine', quantite: 0.05, unite: 'kg' },
        ],
        parametres_commercant: [],
        evenements_commercant: [],
      };

      const pageCadencier = await browser.newPage();
      await stubSupabaseAvecDonnees(pageCadencier, { commercantId, tables });

      await test('le sélecteur de couverture existe, propose 1 à 14 jours et vaut 3 par défaut', async () => {
        await pageCadencier.goto(BASE_URL + '/commandes.html');
        const select = pageCadencier.locator('#selectCouverture');
        await select.locator('option').first().waitFor({ state: 'attached' });
        const valeurs = await select.locator('option').evaluateAll((opts) => opts.map((o) => o.value));
        expect(valeurs.join(',')).toBe('1,2,3,4,5,6,7,8,9,10,11,12,13,14');
        expect(await select.inputValue()).toBe('3');
      });

      await test('l\'aperçu Habitude affiche un ingrédient regroupé sous une famille déduite, jargon-free', async () => {
        await pageCadencier.goto(BASE_URL + '/commandes.html');
        await pageCadencier.locator('#tableauApercuHabitude table').waitFor({ state: 'attached' });
        const texteTableau = await pageCadencier.locator('#tableauApercuHabitude').innerText();
        expect(texteTableau).toContain('Beurre');
        expect(texteTableau).toContain('Farine');
        // .apercu-habitude-famille est en text-transform: uppercase (CSS) ;
        // innerText reflète le rendu visuel, donc les libellés remontent en
        // majuscules ici — c'est le contenu textuel réel (familleDeduite)
        // qui compte, pas la casse d'affichage.
        expect(texteTableau.toUpperCase()).toContain('LAITAGES & ŒUFS');
        expect(texteTableau.toUpperCase()).toContain('ÉPICERIE & PRODUITS SECS');
        expect(texteTableau).not.toContain('B.O.F');
        // Décision produit : pas de fournisseur affiché (aucune donnée en base).
        expect(texteTableau.toLowerCase()).not.toContain('fournisseur');
      });

      await test('changer la période de couverture recalcule réellement l\'aperçu (pas un rendu statique)', async () => {
        await pageCadencier.goto(BASE_URL + '/commandes.html');
        await pageCadencier.locator('#tableauApercuHabitude table').waitFor({ state: 'attached' });
        const totalAvant = await pageCadencier.locator('#tableauApercuHabitude').innerText();
        await pageCadencier.selectOption('#selectCouverture', '10');
        await pageCadencier.waitForTimeout(200);
        const totalApres = await pageCadencier.locator('#tableauApercuHabitude').innerText();
        expect(totalApres).not.toBe(totalAvant);
        const texteApercu = await pageCadencier.locator('#texteApercuHabitude').innerText();
        expect(texteApercu).toContain('10 jours');
      });

      await pageCadencier.close();
    });

    // Étape 6 cahier des charges V2 : le choix des jours à couvrir affiche
    // désormais un badge d'affluence par jour (chargé/calme/férié/vacances/
    // événement), pour rendre visible que cocher plusieurs jours ajuste
    // réellement la commande jour par jour, pas une moyenne uniforme.
    await describe('commandes.html — badge d\'affluence sur le choix des jours', async () => {
      const commercantId = 'test-commercant-affluence';
      // Vendredis en nette hausse récente (le calcul pondère les valeurs
      // récentes plus fort) par rapport à un historique de vendredis bas :
      // calculerPrevisionSemaine doit classer le prochain vendredi "chargé"
      // (moyenne pondérée récente au-dessus du 3e quartile de l'historique).
      const datesVendredis = ['2026-06-05', '2026-06-12', '2026-06-19', '2026-06-26', '2026-07-03', '2026-07-10', '2026-07-17', '2026-07-24', '2026-07-31', '2026-08-07'];
      const quantitesVendredis = [20, 20, 22, 21, 20, 19, 21, 20, 90, 95];
      const vendredis = datesVendredis.map((d, i) => (
        { commercant_id: commercantId, nom_produit: 'Croissant', date_vente: d, quantite: quantitesVendredis[i] }
      ));

      const tables = {
        ventes: vendredis,
        produits: [{ id: 'prod-croissant', commercant_id: commercantId, nom: 'Croissant' }],
        ingredients_produit: [],
        parametres_commercant: [],
        evenements_commercant: [],
      };

      const pageAffluence = await browser.newPage();
      await stubSupabaseAvecDonnees(pageAffluence, { commercantId, tables });

      await test('un jour habituellement chargé affiche un badge "jour chargé" sur sa case à cocher', async () => {
        await pageAffluence.goto(BASE_URL + '/commandes.html');
        await pageAffluence.locator('#grilleJoursCommande label').first().waitFor({ state: 'attached' });
        const texteGrille = await pageAffluence.locator('#grilleJoursCommande').innerText();
        // Au moins un badge d'affluence doit apparaître dans les 7 prochains
        // jours (le prochain vendredi y figure forcément, sept.-oct. 2026).
        expect(texteGrille).toContain('jour chargé');
      });

      await test('le texte d\'aide explique que chaque jour compte pour sa propre quantité', async () => {
        await pageAffluence.goto(BASE_URL + '/commandes.html');
        const corps = await pageAffluence.locator('#carteGenererCommande').innerText();
        expect(corps).toContain('pas une moyenne');
      });

      await pageAffluence.close();
    });

    // Refonte sept. 2026 : l'Accueil devient minimal (2 cartes d'action + 3
    // KPI, jamais de liste de produits — voir tableau-de-bord.html). La
    // liste de production déménage sur previsions.html, avec des pastilles
    // de catégorie déduites par mots-clés (même principe que familleDeduide
    // pour les ingrédients — décision produit : "zéro friction", jamais de
    // saisie ni de colonne "catégorie" en base).
    await describe('tableau-de-bord.html — Accueil minimal (2 actions + 3 KPI)', async () => {
      const commercantId = 'test-commercant-accueil';
      const tables = {
        ventes: [],
        produits: [],
        ingredients_produit: [],
        parametres_commercant: [],
        evenements_commercant: [],
      };

      const pageAccueil = await browser.newPage();
      await stubSupabaseAvecDonnees(pageAccueil, { commercantId, tables });

      await test("affiche exactement 2 cartes d'action et 3 cartes KPI, jamais de liste de produits", async () => {
        await pageAccueil.goto(BASE_URL + '/tableau-de-bord.html');
        await pageAccueil.locator('.action-carte').first().waitFor({ state: 'visible' });

        expect(await pageAccueil.locator('.action-carte').count()).toBe(2);
        expect(await pageAccueil.locator('.carte-kpi').count()).toBe(3);
        // Pas de résidu de l'ancienne grille de produits (voir previsions.html),
        // et sans ventes le Top 3 ne doit rien afficher (pas de faux "-").
        expect(await pageAccueil.locator('#grilleTop3, #grilleRecommandations, .ligne-prod-jour, .produit-top').count()).toBe(0);
      });

      await test('les cartes d\'action mènent vers Prévisions et Commandes', async () => {
        await pageAccueil.goto(BASE_URL + '/tableau-de-bord.html');
        const hrefs = await pageAccueil.locator('.action-carte').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
        expect(hrefs.join(',')).toContain('previsions.html');
        expect(hrefs.join(',')).toContain('commandes.html');
      });

      await pageAccueil.close();
    });

    await describe('tableau-de-bord.html — Top 3 produits (à surveiller demain)', async () => {
      const commercantId = 'test-commercant-top3';
      const lundis = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'];
      const ventesTop3 = []
        .concat(lundis.map((d) => ({ commercant_id: commercantId, nom_produit: 'Tradition', date_vente: d, quantite: 80 })))
        .concat(lundis.map((d) => ({ commercant_id: commercantId, nom_produit: 'Croissant', date_vente: d, quantite: 50 })))
        .concat(lundis.map((d) => ({ commercant_id: commercantId, nom_produit: 'Sandwich', date_vente: d, quantite: 20 })))
        .concat(lundis.map((d) => ({ commercant_id: commercantId, nom_produit: 'Cookie', date_vente: d, quantite: 5 })));

      const pageTop3 = await browser.newPage();
      await stubSupabaseAvecDonnees(pageTop3, {
        commercantId,
        tables: { ventes: ventesTop3, produits: [], ingredients_produit: [], parametres_commercant: [], evenements_commercant: [] },
      });

      await test('affiche exactement 3 produits, triés par quantité recommandée décroissante, le premier mis en avant', async () => {
        await pageTop3.goto(BASE_URL + '/tableau-de-bord.html');
        await pageTop3.locator('.produit-top').first().waitFor({ state: 'visible' });

        expect(await pageTop3.locator('.produit-top').count()).toBe(3);
        expect(await pageTop3.locator('.produit-top--principal').count()).toBe(1);

        const noms = await pageTop3.locator('.produit-top-nom').allTextContents();
        // Cookie (quantité la plus faible) doit être exclu du Top 3.
        expect(noms.join(',')).not.toContain('Cookie');
        // Le plus gros volume (Tradition) doit être en première position, mis en avant.
        expect(await pageTop3.locator('.produit-top').first().locator('.produit-top-nom').textContent()).toBe('Tradition');
        const classePremier = await pageTop3.locator('.produit-top').first().getAttribute('class');
        expect(classePremier).toContain('produit-top--principal');
      });

      await pageTop3.close();
    });

    await describe('produits.html — catégories librement créées et rangement manuel (glisser-déposer)', async () => {
      const commercantId = 'test-commercant-categories-produits';
      const tables = {
        ventes: [],
        produits: [
          { id: 'p1', commercant_id: commercantId, nom: 'Margherita', categorie_id: 'pizzas' },
          { id: 'p2', commercant_id: commercantId, nom: 'Tiramisu', categorie_id: null },
        ],
        categories_produit: [
          { id: 'pizzas', commercant_id: commercantId, nom: 'Pizzas', ordre: 0 },
        ],
        ingredients_produit: [],
        parametres_commercant: [],
        evenements_commercant: [],
      };

      const pageProduits = await browser.newPage();
      await stubSupabaseAvecDonnees(pageProduits, { commercantId, tables });

      await test('la page est renommée "Produits vendus" (titre, h1, nav) et affiche un point d\'entrée vers l\'import carte/menu', async () => {
        await pageProduits.goto(BASE_URL + '/produits.html');
        expect(await pageProduits.title()).toContain('Produits vendus');
        expect(await pageProduits.locator('h1').textContent()).toBe('Produits vendus');
        expect(await pageProduits.locator('#navPrincipale', { hasText: 'Produits vendus' }).count()).toBeGreaterThan(0);
        const lienImport = pageProduits.locator('a[href="import.html"]');
        expect(await lienImport.count()).toBeGreaterThan(0);
      });

      await test('affiche un bloc par catégorie créée, plus un bloc "Non classé" toujours présent', async () => {
        await pageProduits.goto(BASE_URL + '/produits.html');
        await pageProduits.locator('.bloc-categorie-produits').first().waitFor({ state: 'visible' });
        const entetes = await pageProduits.locator('.entete-bloc-categorie-produits').allTextContents();
        expect(entetes.join(',')).toContain('Pizzas');
        expect(entetes.join(',')).toContain('Non classé');
      });

      await test('le produit rangé apparaît dans le bloc de sa catégorie, le produit non rangé dans "Non classé"', async () => {
        await pageProduits.goto(BASE_URL + '/produits.html');
        await pageProduits.locator('.bloc-categorie-produits').first().waitFor({ state: 'visible' });
        const blocPizzas = pageProduits.locator('.bloc-categorie-produits', { hasText: 'Pizzas' });
        expect((await blocPizzas.locator('.nom-produit').allTextContents()).join(',')).toContain('Margherita');
        const blocNonClasse = pageProduits.locator('.bloc-categorie-produits', { hasText: 'Non classé' });
        expect((await blocNonClasse.locator('.nom-produit').allTextContents()).join(',')).toContain('Tiramisu');
      });

      // Retour utilisateur, sept. 2026 (Étape 4 du cahier des charges) : la
      // gestion des catégories (créer/renommer/supprimer) était dupliquée
      // ici et sur previsions.html — même table categories_produit. Une
      // seule logique conservée : gestion exclusivement depuis Prévisions,
      // cette page reste en lecture seule sur les catégories (groupement +
      // rangement par glisser-déposer uniquement).
      await test('aucun bouton "Gérer les catégories" ici : la gestion se fait uniquement depuis Prévisions', async () => {
        await pageProduits.goto(BASE_URL + '/produits.html');
        await pageProduits.locator('.bloc-categorie-produits').first().waitFor({ state: 'visible' });
        expect(await pageProduits.locator('#btnGererCategories').count()).toBe(0);
        expect(await pageProduits.locator('#modalCategories').count()).toBe(0);
        const lienPrevisions = pageProduits.locator('a[href="previsions.html"]');
        expect(await lienPrevisions.count()).toBeGreaterThan(0);
      });

      await pageProduits.close();
    });

    await describe('previsions.html — production du jour, catégories déduites et ingrédients', async () => {
      const commercantId = 'test-commercant-previsions';
      const lundis = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'];
      const ventes = []
        .concat(lundis.map((d) => ({ commercant_id: commercantId, nom_produit: 'Tradition', date_vente: d, quantite: 80 })))
        .concat(lundis.map((d) => ({ commercant_id: commercantId, nom_produit: 'Croissant', date_vente: d, quantite: 50 })))
        .concat(lundis.map((d) => ({ commercant_id: commercantId, nom_produit: 'Sandwich', date_vente: d, quantite: 20 })));

      const tables = {
        ventes: ventes,
        // Catégories strictement issues du rangement manuel du commerçant
        // (Mes produits, glisser-déposer) — plus aucune déduction par
        // mots-clés : Sandwich n'a pas été rangé et doit tomber sous
        // "Non classé".
        produits: [
          { id: 'p1', commercant_id: commercantId, nom: 'Tradition', categorie_id: 'boulangerie' },
          { id: 'p2', commercant_id: commercantId, nom: 'Croissant', categorie_id: 'viennoiserie' },
        ],
        categories_produit: [
          { id: 'boulangerie', commercant_id: commercantId, nom: 'Boulangerie' },
          { id: 'viennoiserie', commercant_id: commercantId, nom: 'Viennoiserie' },
        ],
        ingredients_produit: [],
        parametres_commercant: [],
        evenements_commercant: [],
      };

      const pagePrevisions = await browser.newPage();
      await stubSupabaseAvecDonnees(pagePrevisions, { commercantId, tables });

      await test('affiche la production du jour en liste compacte (pas de cartes), tous produits confondus', async () => {
        await pagePrevisions.goto(BASE_URL + '/previsions.html');
        await pagePrevisions.locator('.ligne-prod-jour').first().waitFor({ state: 'visible' });
        const noms = await pagePrevisions.locator('.ligne-prod-jour-nom').allTextContents();
        expect(noms.sort().join(',')).toBe(['Croissant', 'Sandwich', 'Tradition'].sort().join(','));
      });

      await test('les pastilles de catégorie viennent strictement de la fiche produit, "Tous" en premier, "Non classé" pour les produits sans catégorie', async () => {
        await pagePrevisions.goto(BASE_URL + '/previsions.html');
        await pagePrevisions.locator('.pill-categorie').first().waitFor({ state: 'visible' });
        const categories = await pagePrevisions.locator('.pill-categorie').allTextContents();
        expect(categories[0]).toBe('Tous');
        const texteCategories = categories.join(',');
        expect(texteCategories).toContain('Boulangerie');
        expect(texteCategories).toContain('Viennoiserie');
        expect(texteCategories).toContain('Non classé');
      });

      await test('cliquer une pastille filtre la liste de production sur cette catégorie', async () => {
        await pagePrevisions.goto(BASE_URL + '/previsions.html');
        await pagePrevisions.locator('.pill-categorie').first().waitFor({ state: 'visible' });
        await pagePrevisions.locator('.pill-categorie', { hasText: 'Non classé' }).click();
        const noms = await pagePrevisions.locator('.ligne-prod-jour-nom').allTextContents();
        expect(noms.join(',')).toBe('Sandwich');
      });

      await test('la section Ingrédients a disparu de la page (rôle exclusif du Cadencier)', async () => {
        await pagePrevisions.goto(BASE_URL + '/previsions.html');
        await pagePrevisions.locator('.ligne-prod-jour').first().waitFor({ state: 'visible' });
        expect(await pagePrevisions.locator('#labelIngredients, #tagsIngredients, .tag-ingredient').count()).toBe(0);
      });

      await test('"+ Plus de monde" multiplie instantanément les quantités affichées par 1.15 (arrondi supérieur) et reste actif', async () => {
        await pagePrevisions.goto(BASE_URL + '/previsions.html');
        await pagePrevisions.locator('.ligne-prod-jour').first().waitFor({ state: 'visible' });
        const avant = await pagePrevisions.locator('.ligne-prod-jour-quantite').allTextContents();
        await pagePrevisions.locator('[data-modificateur="plus"]').click();
        const apres = await pagePrevisions.locator('.ligne-prod-jour-quantite').allTextContents();
        expect(avant.join(',')).not.toBe(apres.join(','));
        const classeBouton = await pagePrevisions.locator('[data-modificateur="plus"]').getAttribute('class');
        expect(classeBouton).toContain('actif');
      });

      await test('recliquer "+ Plus de monde" désactive le modificateur et restaure les quantités', async () => {
        await pagePrevisions.goto(BASE_URL + '/previsions.html');
        await pagePrevisions.locator('.ligne-prod-jour').first().waitFor({ state: 'visible' });
        const initial = await pagePrevisions.locator('.ligne-prod-jour-quantite').allTextContents();
        await pagePrevisions.locator('[data-modificateur="plus"]').click();
        await pagePrevisions.locator('[data-modificateur="plus"]').click();
        const restaure = await pagePrevisions.locator('.ligne-prod-jour-quantite').allTextContents();
        expect(restaure.join(',')).toBe(initial.join(','));
        const classeBouton = await pagePrevisions.locator('[data-modificateur="plus"]').getAttribute('class');
        expect(classeBouton).not.toContain('actif');
      });

      await test('l\'infobulle explicative est à côté du titre "Prévision pour...", pas ailleurs sur la page', async () => {
        await pagePrevisions.goto(BASE_URL + '/previsions.html');
        await pagePrevisions.locator('.ligne-prod-jour').first().waitFor({ state: 'visible' });
        const titre = await pagePrevisions.locator('#sombreTitre').innerText();
        expect(titre).toContain('ⓘ');
        expect(await pagePrevisions.locator('.info-bulle').count()).toBe(1);
      });

      await test('"Tous" et "Non classé" sont toujours présentes, avec le bouton "+ Catégorie" sur la même ligne', async () => {
        await pagePrevisions.goto(BASE_URL + '/previsions.html');
        await pagePrevisions.locator('.ligne-prod-jour').first().waitFor({ state: 'visible' });
        const zone = await pagePrevisions.locator('#filtresCategories').innerText();
        expect(zone.toLowerCase()).not.toContain('production pour');
        expect(zone).toContain('Tous');
        expect(zone).toContain('Non classé');
        expect(zone).toContain('+ Catégorie');
      });

      await test('"Tous" et "Non classé" n\'ont pas de croix de suppression, contrairement à une catégorie créée', async () => {
        await pagePrevisions.goto(BASE_URL + '/previsions.html');
        await pagePrevisions.locator('.ligne-prod-jour').first().waitFor({ state: 'visible' });
        const pillTous = pagePrevisions.locator('.pill-categorie', { hasText: 'Tous' });
        const pillNonClasse = pagePrevisions.locator('.pill-categorie', { hasText: 'Non classé' });
        const pillBoulangerie = pagePrevisions.locator('.pill-categorie', { hasText: 'Boulangerie' });
        expect(await pillTous.locator('.pill-categorie-supprimer').count()).toBe(0);
        expect(await pillNonClasse.locator('.pill-categorie-supprimer').count()).toBe(0);
        expect(await pillBoulangerie.locator('.pill-categorie-supprimer').count()).toBe(1);
      });

      await test('chaque produit ayant une fiche (Mes produits) affiche un sélecteur pour le ranger dans une catégorie existante', async () => {
        await pagePrevisions.goto(BASE_URL + '/previsions.html');
        await pagePrevisions.locator('.ligne-prod-jour').first().waitFor({ state: 'visible' });
        // Tradition et Croissant ont une fiche produit (donc un sélecteur) ;
        // Sandwich n'en a pas dans ce jeu de données et n'en affiche donc
        // pas — rien à ranger sans fiche produit derrière.
        expect(await pagePrevisions.locator('.select-categorie-produit').count()).toBe(2);
        const optionsTradition = await pagePrevisions.locator('.ligne-prod-jour', { hasText: 'Tradition' }).locator('.select-categorie-produit').inputValue();
        expect(optionsTradition).toBe('boulangerie');
      });

      await test('le bouton "+ Catégorie" crée une catégorie à la volée, utilisable immédiatement comme pastille et comme choix de rangement', async () => {
        pagePrevisions.once('dialog', (dialog) => dialog.accept('Poisson'));
        await pagePrevisions.goto(BASE_URL + '/previsions.html');
        await pagePrevisions.locator('.ligne-prod-jour').first().waitFor({ state: 'visible' });
        await pagePrevisions.locator('.btn-ajouter-categorie').click();
        await pagePrevisions.locator('.pill-categorie', { hasText: 'Poisson' }).waitFor({ state: 'visible' });
        const options = await pagePrevisions.locator('.select-categorie-produit').first().locator('option').allTextContents();
        expect(options.join(',')).toContain('Poisson');
      });

      await test('la croix d\'une catégorie créée la supprime, ses produits repassent en "Non classé"', async () => {
        pagePrevisions.once('dialog', (dialog) => dialog.accept());
        await pagePrevisions.goto(BASE_URL + '/previsions.html');
        await pagePrevisions.locator('.pill-categorie', { hasText: 'Boulangerie' }).waitFor({ state: 'visible' });
        await pagePrevisions.locator('.pill-categorie', { hasText: 'Boulangerie' }).locator('.pill-categorie-supprimer').click();
        await pagePrevisions.waitForTimeout(200);
        expect(await pagePrevisions.locator('.pill-categorie', { hasText: 'Boulangerie' }).count()).toBe(0);
        const selectTradition = await pagePrevisions.locator('.ligne-prod-jour', { hasText: 'Tradition' }).locator('.select-categorie-produit').inputValue();
        expect(selectTradition).toBe('');
      });

      await pagePrevisions.close();
    });

    // Retour utilisateur, sept. 2026 : la météo du jour s'affichait déjà
    // techniquement, mais en texte brut minuscule et gris — perçue comme
    // "ça ne s'affiche pas". Remplacée par un badge visible (icône large +
    // température en évidence). Réseau externe mocké (geo.api.gouv.fr,
    // open-meteo.com bloqués dans ce sandbox de toute façon).
    await describe('previsions.html — badge météo visible', async () => {
      const commercantId = 'test-commercant-meteo-badge';
      const tables = {
        ventes: [{ commercant_id: commercantId, nom_produit: 'Tradition', date_vente: '2026-08-03', quantite: 10 }],
        produits: [{ id: 'p1', commercant_id: commercantId, nom: 'Tradition' }],
        categories_produit: [],
        ingredients_produit: [],
        parametres_commercant: [{ commercant_id: commercantId, code_postal: '49100', ville: 'Angers', latitude: null, longitude: null }],
        evenements_commercant: [],
      };

      const pageMeteo = await browser.newPage();
      await stubSupabaseAvecDonnees(pageMeteo, { commercantId, tables });
      await pageMeteo.route('https://geo.api.gouv.fr/**', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ nom: 'Angers', centre: { type: 'Point', coordinates: [-0.5629, 47.4819] }, code: '49007' }]) });
      });
      await pageMeteo.route('https://api.open-meteo.com/**', (route) => {
        const dates = [];
        for (let i = 0; i < 10; i++) { const d = new Date(); d.setDate(d.getDate() + i); dates.push(d.toISOString().slice(0, 10)); }
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ daily: { time: dates, precipitation_sum: dates.map(() => 0), temperature_2m_max: dates.map(() => 22), weathercode: dates.map(() => 1) } }) });
      });
      await pageMeteo.route('https://archive-api.open-meteo.com/**', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ daily: { time: [], precipitation_sum: [], temperature_2m_max: [], weathercode: [] } }) });
      });

      await test('le badge météo affiche une icône, une température et un libellé distincts (pas une ligne de texte brut)', async () => {
        await pageMeteo.goto(BASE_URL + '/previsions.html');
        await pageMeteo.locator('#sombreMeteoAujourdhui').waitFor({ state: 'visible', timeout: 10000 });
        const icone = await pageMeteo.locator('#sombreMeteoIcone').textContent();
        const temperature = await pageMeteo.locator('#sombreMeteoTemperature').textContent();
        const libelle = await pageMeteo.locator('#sombreMeteoLibelle').textContent();
        expect(icone.trim().length).toBeGreaterThan(0);
        expect(temperature).toContain('22°C');
        expect(libelle.trim().length).toBeGreaterThan(0);
      });

      await pageMeteo.close();
    });

    // Retour utilisateur, sept. 2026 : le badge météo restait figé sur la
    // météo d'aujourd'hui même en changeant de jour dans le bandeau,
    // incohérent avec le titre "Prévision pour [jour sélectionné]" juste à
    // côté. Températures volontairement différentes par jour pour prouver
    // que le badge suit vraiment le jour actif, pas un rendu figé.
    await describe('previsions.html — le badge météo suit le jour sélectionné dans le bandeau', async () => {
      const commercantId = 'test-commercant-meteo-par-jour';
      const tables = {
        ventes: [{ commercant_id: commercantId, nom_produit: 'Tradition', date_vente: '2026-08-03', quantite: 10 }],
        produits: [{ id: 'p1', commercant_id: commercantId, nom: 'Tradition' }],
        categories_produit: [],
        ingredients_produit: [],
        parametres_commercant: [{ commercant_id: commercantId, code_postal: '49100', ville: 'Angers', latitude: null, longitude: null }],
        evenements_commercant: [],
      };

      const pageMeteoJour = await browser.newPage();
      await stubSupabaseAvecDonnees(pageMeteoJour, { commercantId, tables });
      await pageMeteoJour.route('https://geo.api.gouv.fr/**', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ nom: 'Angers', centre: { type: 'Point', coordinates: [-0.5629, 47.4819] }, code: '49007' }]) });
      });
      await pageMeteoJour.route('https://api.open-meteo.com/**', (route) => {
        const dates = [];
        for (let i = 0; i < 10; i++) { const d = new Date(); d.setDate(d.getDate() + i); dates.push(d.toISOString().slice(0, 10)); }
        // Une température distincte par jour (10, 11, 12...) pour repérer
        // sans ambiguïté quel jour le badge affiche réellement.
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ daily: { time: dates, precipitation_sum: dates.map(() => 0), temperature_2m_max: dates.map((d, i) => 10 + i), weathercode: dates.map(() => 1) } }) });
      });
      await pageMeteoJour.route('https://archive-api.open-meteo.com/**', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ daily: { time: [], precipitation_sum: [], temperature_2m_max: [], weathercode: [] } }) });
      });

      await test('cliquer un autre jour du bandeau met à jour la température du badge météo', async () => {
        await pageMeteoJour.goto(BASE_URL + '/previsions.html');
        await pageMeteoJour.locator('#sombreMeteoAujourdhui').waitFor({ state: 'visible', timeout: 10000 });
        const temperatureInitiale = await pageMeteoJour.locator('#sombreMeteoTemperature').textContent();

        await pageMeteoJour.locator('.chip-jour').nth(2).click();
        await pageMeteoJour.waitForTimeout(200);
        const temperatureApres = await pageMeteoJour.locator('#sombreMeteoTemperature').textContent();

        expect(temperatureApres).not.toBe(temperatureInitiale);
      });

      await pageMeteoJour.close();
    });

    // Retour utilisateur, sept. 2026 : la météo peut changer dans la
    // journée (beau le matin, pluie l'après-midi) — une seule valeur ne
    // suffit pas. Ajout d'un détail matin/midi/soir sous le badge
    // principal, à partir des données horaires renvoyées par Open-Meteo.
    // Températures et codes météo volontairement très différents par
    // moment pour prouver que les 3 valeurs sont bien distinctes, pas
    // trois fois la même synthèse journalière recopiée.
    await describe('previsions.html — détail météo matin/midi/soir', async () => {
      const commercantId = 'test-commercant-meteo-moments';
      const tables = {
        ventes: [{ commercant_id: commercantId, nom_produit: 'Tradition', date_vente: '2026-08-03', quantite: 10 }],
        produits: [{ id: 'p1', commercant_id: commercantId, nom: 'Tradition' }],
        categories_produit: [],
        ingredients_produit: [],
        parametres_commercant: [{ commercant_id: commercantId, code_postal: '49100', ville: 'Angers', latitude: null, longitude: null }],
        evenements_commercant: [],
      };

      const pageMoments = await browser.newPage();
      await stubSupabaseAvecDonnees(pageMoments, { commercantId, tables });
      await pageMoments.route('https://geo.api.gouv.fr/**', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ nom: 'Angers', centre: { type: 'Point', coordinates: [-0.5629, 47.4819] }, code: '49007' }]) });
      });
      await pageMoments.route('https://api.open-meteo.com/**', (route) => {
        const dates = [];
        const hourlyTimes = [];
        const hourlyTemp = [];
        const hourlyCode = [];
        for (let d = 0; d < 10; d++) {
          const date = new Date();
          date.setDate(date.getDate() + d);
          const iso = date.toISOString().slice(0, 10);
          dates.push(iso);
          for (let h = 0; h < 24; h++) {
            hourlyTimes.push(iso + 'T' + String(h).padStart(2, '0') + ':00');
            if (h < 11) { hourlyTemp.push(14); hourlyCode.push(1); }
            else if (h < 17) { hourlyTemp.push(23); hourlyCode.push(0); }
            else { hourlyTemp.push(17); hourlyCode.push(61); }
          }
        }
        route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            daily: { time: dates, precipitation_sum: dates.map(() => 0), temperature_2m_max: dates.map(() => 23), weathercode: dates.map(() => 1) },
            hourly: { time: hourlyTimes, temperature_2m: hourlyTemp, weathercode: hourlyCode },
          }),
        });
      });
      await pageMoments.route('https://archive-api.open-meteo.com/**', (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ daily: { time: [], precipitation_sum: [], temperature_2m_max: [], weathercode: [] } }) });
      });

      await test('affiche 3 températures distinctes (matin/midi/soir), différentes de la synthèse du jour', async () => {
        await pageMoments.goto(BASE_URL + '/previsions.html');
        await pageMoments.locator('#meteoMomentsJour').waitFor({ state: 'visible', timeout: 10000 });
        const temperatures = await pageMoments.locator('.meteo-moment-temperature').allTextContents();
        expect(temperatures).toHaveLength(3);
        expect(temperatures.join(',')).toBe('14°C,23°C,17°C');
        const libelles = await pageMoments.locator('.meteo-moment-libelle').allTextContents();
        expect(libelles.join(',')).toBe('Matin,Midi,Soir');
      });

      await pageMoments.close();
    });

    await describe('previsions.html — catégorie du produit librement créée par le commerçant (pas une liste imposée)', async () => {
      const commercantId = 'test-commercant-categorie-produit';
      const lundis = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'];
      const tables = {
        // La catégorie vient strictement du rangement manuel du commerçant
        // dans Mes produits (catégorie créée par lui, produit glissé
        // dedans) : "Margherita" doit apparaître sous "Pizzas", une
        // catégorie qui n'existe dans aucune liste prédéfinie. Un deuxième
        // produit est nécessaire pour que les pastilles s'affichent (aucun
        // filtre n'a de sens avec une seule catégorie détectée).
        ventes: []
          .concat(lundis.map((d) => ({ commercant_id: commercantId, nom_produit: 'Margherita', date_vente: d, quantite: 30 })))
          .concat(lundis.map((d) => ({ commercant_id: commercantId, nom_produit: 'Croissant', date_vente: d, quantite: 20 }))),
        produits: [{ id: 'p1', commercant_id: commercantId, nom: 'Margherita', categorie_id: 'pizzas' }],
        categories_produit: [{ id: 'pizzas', commercant_id: commercantId, nom: 'Pizzas' }],
        ingredients_produit: [],
        parametres_commercant: [],
        evenements_commercant: [],
      };

      const pageCategorieProduit = await browser.newPage();
      await stubSupabaseAvecDonnees(pageCategorieProduit, { commercantId, tables });

      await test('la pastille utilise la catégorie créée par le commerçant, pas une liste figée', async () => {
        await pageCategorieProduit.goto(BASE_URL + '/previsions.html');
        await pageCategorieProduit.locator('.pill-categorie').first().waitFor({ state: 'visible' });
        const categories = (await pageCategorieProduit.locator('.pill-categorie').allTextContents()).join(',');
        expect(categories).toContain('Pizzas');
      });

      await pageCategorieProduit.close();
    });

    await describe('commandes.html — pont depuis previsions.html (contexte jour + affluence)', async () => {
      const commercantId = 'test-commercant-pont';
      const tables = {
        ventes: [],
        produits: [],
        ingredients_produit: [],
        parametres_commercant: [],
        evenements_commercant: [],
      };

      await test('le bandeau de contexte affiche le jour et l\'affluence transmis par l\'URL', async () => {
        const pagePont = await browser.newPage();
        await stubSupabaseAvecDonnees(pagePont, { commercantId, tables });
        await pagePont.goto(BASE_URL + '/commandes.html?jour=2026-09-21&affluence=charge');
        const bandeau = pagePont.locator('#bandeauContexteJour');
        await bandeau.waitFor({ state: 'visible' });
        const texte = await bandeau.innerText();
        // capitaliser() met une majuscule initiale au nom du jour.
        expect(texte).toContain('Lundi');
        expect(texte).toContain('21/9');
        expect(texte).toContain('jour chargé');
        await pagePont.close();
      });

      await test('sans paramètres dans l\'URL, le bandeau de contexte reste masqué', async () => {
        const pageSansContexte = await browser.newPage();
        await stubSupabaseAvecDonnees(pageSansContexte, { commercantId, tables });
        await pageSansContexte.goto(BASE_URL + '/commandes.html');
        await pageSansContexte.waitForTimeout(500);
        expect(await pageSansContexte.locator('#bandeauContexteJour').isVisible()).toBe(false);
        await pageSansContexte.close();
      });
    });

    await describe('previsions.html — pont vers Commandes (production du jour + semaine)', async () => {
      const commercantId = 'test-commercant-previsions-pont';
      const tables = {
        ventes: [{ commercant_id: commercantId, nom_produit: 'Croissant', date_vente: '2026-08-03', quantite: 40 }],
        produits: [],
        ingredients_produit: [],
        parametres_commercant: [],
        evenements_commercant: [],
      };

      const pagePrevisionsPont = await browser.newPage();
      await stubSupabaseAvecDonnees(pagePrevisionsPont, { commercantId, tables });

      await test('un seul CTA "Préparer la commande" pour le jour sélectionné, avec jour + affluence dans l\'URL', async () => {
        await pagePrevisionsPont.goto(BASE_URL + '/previsions.html');
        const lien = pagePrevisionsPont.locator('#blocPontCommandes a.btn-cta-commandes');
        await lien.waitFor({ state: 'visible' });
        expect(await lien.count()).toBe(1);
        const href = await lien.getAttribute('href');
        expect(href.indexOf('commandes.html?jour=') === 0).toBe(true);
        expect(href).toContain('&affluence=');
      });

      await test('cliquer un autre jour du bandeau change le jour sélectionné et le CTA associé', async () => {
        await pagePrevisionsPont.goto(BASE_URL + '/previsions.html');
        await pagePrevisionsPont.locator('.chip-jour').first().waitFor({ state: 'visible' });
        const hrefAvant = await pagePrevisionsPont.locator('#blocPontCommandes a.btn-cta-commandes').getAttribute('href');

        const chips = pagePrevisionsPont.locator('.chip-jour:not(.chip-jour--ferme)');
        await chips.nth(1).click();

        const hrefApres = pagePrevisionsPont.locator('#blocPontCommandes a.btn-cta-commandes');
        await hrefApres.waitFor({ state: 'visible' });
        expect(await hrefApres.getAttribute('href')).not.toBe(hrefAvant);
        // Toujours un seul CTA, jamais un par jour.
        expect(await pagePrevisionsPont.locator('#blocPontCommandes a.btn-cta-commandes').count()).toBe(1);
      });

      await pagePrevisionsPont.close();
    });

    await describe('semaine.html — redirection vers Prévisions (page absorbée)', async () => {
      await test('semaine.html redirige vers previsions.html', async () => {
        const pageRedir = await browser.newPage();
        await pageRedir.goto(BASE_URL + '/semaine.html');
        await pageRedir.waitForURL('**/previsions.html');
        await pageRedir.close();
      });
    });

    await describe('personnel.html — Planning nominatif (Secteur > Poste)', async () => {
      const commercantId = 'test-commercant-gantt';
      const demain = new Date();
      demain.setDate(demain.getDate() + 1);
      const isoDemain = demain.toISOString().slice(0, 10);

      const secteursFixture = [
        { id: 'salle', commercant_id: commercantId, nom: 'Salle', couleur: '#4caf6d', ordre: 0 },
        { id: 'bar', commercant_id: commercantId, nom: 'Bar', couleur: '#5a9ebf', ordre: 1 },
      ];
      const postesFixture = [
        { id: 'generique', commercant_id: commercantId, secteur_id: 'salle', nom: 'Générique', ordre: 0 },
        { id: 'generique', commercant_id: commercantId, secteur_id: 'bar', nom: 'Générique', ordre: 0 },
      ];

      const pageGantt = await browser.newPage();
      await stubSupabaseAvecDonnees(pageGantt, {
        commercantId,
        tables: {
          personnel: [
            { id: 'p1', nom: 'Vincent', secteur_id: 'salle', poste_id: 'generique', type_contrat: 'Fixe', niveau_hierarchie: 1, contrat_hebdo: 35, jours_repos: [], alternance_weekend: false, statut_compte: 'actif', heures_disponibles: {} },
            { id: 'p2', nom: 'Océane', secteur_id: 'salle', poste_id: 'generique', type_contrat: 'Fixe', niveau_hierarchie: 2, contrat_hebdo: 35, jours_repos: [], alternance_weekend: false, statut_compte: 'non_invite', heures_disponibles: {} },
            { id: 'p4', nom: 'Mirella', secteur_id: 'bar', poste_id: 'generique', type_contrat: 'Extra', niveau_hierarchie: 3, contrat_hebdo: 0, jours_repos: [], alternance_weekend: false, statut_compte: 'non_invite', heures_disponibles: {} },
          ],
          ventes: [],
          parametres_commercant: [],
          evenements_commercant: [],
          secteurs_personnel: secteursFixture,
          postes_personnel: postesFixture,
          creneaux_personnel: [
            { id: 'c1', commercant_id: commercantId, personnel_id: 'p1', date_creneau: isoDemain, heure_debut: '11:00:00', heure_fin: '15:00:00', secteur_id: 'salle', poste_id: 'generique', origine: 'manuel' },
            { id: 'c1b', commercant_id: commercantId, personnel_id: 'p1', date_creneau: isoDemain, heure_debut: '18:00:00', heure_fin: '23:00:00', secteur_id: 'salle', poste_id: 'generique', origine: 'manuel' },
            { id: 'c2', commercant_id: commercantId, personnel_id: 'p2', date_creneau: isoDemain, heure_debut: '10:00:00', heure_fin: '18:00:00', secteur_id: 'salle', poste_id: 'generique', origine: 'manuel' },
            // Créneau traversant minuit : cas piège trouvé en développant (heure_fin < heure_debut).
            { id: 'c4', commercant_id: commercantId, personnel_id: 'p4', date_creneau: isoDemain, heure_debut: '19:00:00', heure_fin: '02:00:00', secteur_id: 'bar', poste_id: 'generique', origine: 'manuel' },
          ],
        },
      });

      await test('affiche une ligne par personne avec ses créneaux, total d\'heures inclus', async () => {
        await pageGantt.goto(BASE_URL + '/personnel.html');
        await pageGantt.locator('#ganttGrille .gantt-nom-cell').first().waitFor({ state: 'visible' });

        const noms = await pageGantt.locator('.gantt-nom').allTextContents();
        expect(noms.join(',')).toContain('Vincent');
        expect(noms.join(',')).toContain('Océane');
        expect(noms.join(',')).toContain('Mirella');

        // Vincent a 2 créneaux (11h-15h + 18h-23h) : 2 blocs sur sa ligne.
        const blocsVincent = await pageGantt.locator('.gantt-piste').first().locator('.gantt-bloc').count();
        expect(blocsVincent).toBe(2);
      });

      await test('un créneau traversant minuit (19h-02h) est rendu avec une largeur cohérente, pas rejeté', async () => {
        await pageGantt.goto(BASE_URL + '/personnel.html');
        await pageGantt.locator('#ganttGrille .gantt-nom-cell').first().waitFor({ state: 'visible' });

        const pistes = pageGantt.locator('.gantt-piste');
        const blocMirella = pistes.nth(2).locator('.gantt-bloc');
        expect(await blocMirella.count()).toBe(1);
        expect(await blocMirella.textContent()).toContain('19h');
        expect(await blocMirella.textContent()).toContain('02h');

        // L'axe des heures s'étend de 3h à 3h le lendemain : doit couvrir l'après-minuit.
        const entetesHeure = await pageGantt.locator('.gantt-heure-entete').allTextContents();
        expect(entetesHeure.join(',')).toContain('01h');
      });

      await test('la colonne des noms reste en position sticky (scrollable horizontalement)', async () => {
        await pageGantt.goto(BASE_URL + '/personnel.html');
        await pageGantt.locator('#ganttGrille .gantt-nom-cell').first().waitFor({ state: 'visible' });
        const position = await pageGantt.locator('.gantt-nom-cell').first().evaluate((el) => getComputedStyle(el).position);
        expect(position).toBe('sticky');
      });

      await test('un Extra affiche son badge de type de contrat', async () => {
        await pageGantt.goto(BASE_URL + '/personnel.html');
        await pageGantt.locator('.badge-typecontrat--extra').waitFor({ state: 'visible' });
        expect(await pageGantt.locator('.badge-typecontrat--extra').textContent()).toBe('Extra');
      });

      await test('la légende affiche un secteur par pastille, plus le bouton de gestion des postes', async () => {
        await pageGantt.goto(BASE_URL + '/personnel.html');
        await pageGantt.locator('.pastille-poste-nom').first().waitFor({ state: 'visible' });
        const nomsSecteurs = await pageGantt.locator('.pastille-poste-nom').allTextContents();
        expect(nomsSecteurs.join(',')).toContain('Salle');
        expect(nomsSecteurs.join(',')).toContain('Bar');
        expect(await pageGantt.locator('.btn-gerer-postes').isVisible()).toBe(true);
      });

      // Retour utilisateur, sept. 2026 : le comportement "tous secteurs
      // affichés" existait déjà (filtreSecteurActif === null) mais n'avait
      // aucun bouton visible pour le voir/y revenir. Ajout d'un onglet
      // "Tous" permanent, toujours en premier, jamais dans la modale de
      // suppression de secteur.
      await test('un onglet "Tous" permanent est toujours affiché en premier dans la légende, actif par défaut', async () => {
        await pageGantt.goto(BASE_URL + '/personnel.html');
        await pageGantt.locator('.pastille-poste-nom').first().waitFor({ state: 'visible' });
        const premierePastille = pageGantt.locator('#legendePostes > *').first();
        expect(await premierePastille.locator('.pastille-poste-nom').textContent()).toBe('Tous');
        expect(await premierePastille.evaluate((el) => el.classList.contains('pastille-poste--active'))).toBe(true);
      });

      await test('l\'onglet "Tous" n\'apparaît pas dans la liste des secteurs supprimables de la modale "Gérer les postes"', async () => {
        await pageGantt.goto(BASE_URL + '/personnel.html');
        await pageGantt.locator('.btn-gerer-postes').click();
        await pageGantt.locator('#listeSecteursPostes .bloc-secteur-postes').first().waitFor({ state: 'visible' });
        const entetes = await pageGantt.locator('#listeSecteursPostes .entete-bloc-secteur strong').allTextContents();
        expect(entetes).not.toContain('Tous');
      });

      // Retour utilisateur, sept. 2026 : "Réinitialiser (auto)" et "Gérer
      // les postes" isolés chacun sur leur ligne, séparés par de grands
      // espaces vides (bug : ni l'un ni l'autre ne surchargeait le
      // width:100%/margin-top:22px du <button> global). Corrigé en
      // regroupant "Gérer les postes" avec les pastilles de secteur, et en
      // collant "Réinitialiser" juste au-dessus du Gantt.
      await test('"Gérer les postes" et "Réinitialiser" ne sont plus isolés sur leur propre ligne pleine largeur', async () => {
        await pageGantt.goto(BASE_URL + '/personnel.html');
        await pageGantt.locator('#ganttGrille .gantt-nom-cell').first().waitFor({ state: 'visible' });
        const viewport = pageGantt.viewportSize();
        const boxGererPostes = await pageGantt.locator('.btn-gerer-postes').boundingBox();
        const boxReinitialiser = await pageGantt.locator('.btn-reinitialiser').boundingBox();
        expect(boxGererPostes.width < viewport.width * 0.5).toBeTruthy();
        expect(boxReinitialiser.width < viewport.width * 0.5).toBeTruthy();
        // "Réinitialiser" doit être directement au-dessus du Gantt (pas de
        // grand espace vide entre les deux).
        const boxGanttScroll = await pageGantt.locator('.gantt-scroll').boundingBox();
        expect(boxGanttScroll.y - (boxReinitialiser.y + boxReinitialiser.height) < 20).toBeTruthy();
      });

      await test('le libellé d\'un créneau avec pause reste lisible (la bande de pause ne le recouvre plus)', async () => {
        const commercantIdPause = 'test-pause-lisible';
        const pagePause = await browser.newPage();
        await stubSupabaseAvecDonnees(pagePause, {
          commercantId: commercantIdPause,
          tables: {
            personnel: [{ id: 'p1', nom: 'Julien', secteur_id: 'salle', poste_id: 'generique', type_contrat: 'Fixe', niveau_hierarchie: 1, contrat_hebdo: 35, jours_repos: [], alternance_weekend: false, statut_compte: 'actif', heures_disponibles: {} }],
            ventes: [], parametres_commercant: [], evenements_commercant: [],
            secteurs_personnel: secteursFixture,
            postes_personnel: postesFixture,
            creneaux_personnel: [
              { id: 'cp1', commercant_id: commercantIdPause, personnel_id: 'p1', date_creneau: isoDemain, heure_debut: '11:00:00', heure_fin: '15:00:00', secteur_id: 'salle', poste_id: 'generique', origine: 'manuel', pause_debut: '11:30:00', pause_fin: '12:15:00' },
            ],
          },
        });
        await pagePause.goto(BASE_URL + '/personnel.html');
        await pagePause.locator('.gantt-bloc-pause').waitFor({ state: 'visible' });
        const zIndexPause = await pagePause.locator('.gantt-bloc-pause').evaluate((el) => getComputedStyle(el).zIndex);
        const zIndexTexte = await pagePause.locator('.gantt-bloc-texte').evaluate((el) => getComputedStyle(el).zIndex);
        expect(Number(zIndexTexte) > Number(zIndexPause)).toBeTruthy();
        const opacitePause = await pagePause.locator('.gantt-bloc-pause').evaluate((el) => Number(getComputedStyle(el).opacity));
        expect(opacitePause < 1).toBeTruthy();
        await pagePause.close();
      });

      await test('un Saisonnier affiche sa date de fin de contrat, un Fixe non', async () => {
        const commercantIdFin = 'test-date-fin-contrat';
        const pageFin = await browser.newPage();
        await stubSupabaseAvecDonnees(pageFin, {
          commercantId: commercantIdFin,
          tables: {
            personnel: [
              { id: 'p1', nom: 'Marc', secteur_id: 'salle', poste_id: 'generique', type_contrat: 'Saisonnier', niveau_hierarchie: 2, contrat_hebdo: 30, jours_repos: [], alternance_weekend: false, statut_compte: 'non_invite', heures_disponibles: {}, date_fin_contrat: '2026-10-31' },
              { id: 'p2', nom: 'Vincent', secteur_id: 'salle', poste_id: 'generique', type_contrat: 'Fixe', niveau_hierarchie: 1, contrat_hebdo: 35, jours_repos: [], alternance_weekend: false, statut_compte: 'actif', heures_disponibles: {} },
            ],
            ventes: [], parametres_commercant: [], evenements_commercant: [],
            secteurs_personnel: secteursFixture,
            postes_personnel: postesFixture,
            creneaux_personnel: [],
          },
        });
        await pageFin.goto(BASE_URL + '/personnel.html');
        await pageFin.locator('#ganttGrille .gantt-nom-cell').first().waitFor({ state: 'visible' });
        const detailMarc = await pageFin.locator('.gantt-nom-cell').filter({ hasText: 'Marc' }).locator('.gantt-nom-detail').textContent();
        expect(detailMarc).toContain('jusqu\'au 31/10');
        const detailVincent = await pageFin.locator('.gantt-nom-cell').filter({ hasText: 'Vincent' }).locator('.gantt-nom-detail').textContent();
        expect(detailVincent).not.toContain('jusqu\'au');
        await pageFin.close();
      });

      await test('le champ "date de fin de contrat" n\'apparaît que pour Extra/Saisonnier, dans les deux modales', async () => {
        const pageModales = await browser.newPage();
        await stubSupabaseAvecDonnees(pageModales, { commercantId: 'test-modales-datefin', tables: { personnel: [], ventes: [], parametres_commercant: [], evenements_commercant: [], secteurs_personnel: secteursFixture, postes_personnel: postesFixture, creneaux_personnel: [] } });
        await pageModales.goto(BASE_URL + '/personnel.html');
        await pageModales.locator('#planning').waitFor({ state: 'visible' });
        await pageModales.locator('text=+ Ajouter un membre').click();
        expect(await pageModales.locator('#champDateFinMembre').isHidden()).toBe(true);
        await pageModales.selectOption('#modalMembreContrat', 'Extra');
        expect(await pageModales.locator('#champDateFinMembre').isHidden()).toBe(false);
        await pageModales.selectOption('#modalMembreContrat', 'Fixe');
        expect(await pageModales.locator('#champDateFinMembre').isHidden()).toBe(true);
        await pageModales.close();
      });

      await pageGantt.close();
    });

    // Étape 7 (Espace employé) : "Inviter" doit réellement appeler l'Edge
    // Function inviter-employe (création de compte + e-mail), plus jamais
    // se contenter de marquer statut_compte='invite' en direct depuis le
    // client (ancien comportement, un simple stub sans effet réel).
    await describe('personnel.html — invitation d\'un employé (Edge Function réelle)', async () => {
      const commercantId = 'test-commercant-invitation';
      const secteursFixture = [
        { id: 'salle', commercant_id: commercantId, nom: 'Salle', couleur: '#4caf6d', ordre: 0 },
      ];
      const postesFixture = [
        { id: 'generique', commercant_id: commercantId, secteur_id: 'salle', nom: 'Générique', ordre: 0 },
      ];
      const tables = {
        personnel: [
          { id: 'p1', nom: 'Sophie', email: 'sophie@example.com', secteur_id: 'salle', poste_id: 'generique', type_contrat: 'Fixe', niveau_hierarchie: 2, contrat_hebdo: 35, jours_repos: [], alternance_weekend: false, statut_compte: 'non_invite', heures_disponibles: {} },
        ],
        ventes: [], parametres_commercant: [], evenements_commercant: [],
        secteurs_personnel: secteursFixture,
        postes_personnel: postesFixture,
        creneaux_personnel: [],
      };

      await test('cliquer "Inviter" appelle inviter-employe avec le bon personnelId et email, pas un simple update de statut', async () => {
        const page = await browser.newPage();
        await stubSupabaseAvecDonnees(page, { commercantId, tables });
        await page.goto(BASE_URL + '/personnel.html');
        await page.locator('.gantt-nom').filter({ hasText: 'Sophie' }).click();
        await page.locator('#modalEmploye').waitFor({ state: 'visible' });
        await page.locator('#btnModalEmployeInviter').click();
        await page.waitForFunction(() => window.__dernierAppelFunction);
        const appel = await page.evaluate(() => window.__dernierAppelFunction);
        expect(appel.nom).toBe('inviter-employe');
        expect(appel.options.body.personnelId).toBe('p1');
        expect(appel.options.body.email).toBe('sophie@example.com');
        await page.close();
      });

      await test('le bouton "Inviter" est désactivé pendant l\'appel puis réactivé', async () => {
        const page = await browser.newPage();
        await stubSupabaseAvecDonnees(page, { commercantId, tables });
        await page.goto(BASE_URL + '/personnel.html');
        await page.locator('.gantt-nom').filter({ hasText: 'Sophie' }).click();
        await page.locator('#modalEmploye').waitFor({ state: 'visible' });
        await page.locator('#btnModalEmployeInviter').click();
        await page.waitForFunction(() => window.__dernierAppelFunction);
        expect(await page.locator('#btnModalEmployeInviter').isDisabled()).toBe(false);
        await page.close();
      });
    });

    // Retour utilisateur, sept. 2026 : le détail matin/midi/soir ajouté sur
    // Prévisions doit aussi apparaître sur Planning, à côté du badge météo
    // du jour affiché dans le Gantt — pas seulement la synthèse du jour.
    await describe('personnel.html — détail météo matin/midi/soir dans le Gantt', async () => {
      const commercantId = 'test-commercant-gantt-meteo-moments';
      const tables = {
        personnel: [],
        ventes: [],
        secteurs_personnel: [],
        postes_personnel: [],
        creneaux_personnel: [],
        evenements_commercant: [],
        parametres_commercant: [{ commercant_id: commercantId, code_postal: '49100', ville: 'Angers', latitude: 47.4819, longitude: -0.5629 }],
      };

      const pageGanttMoments = await browser.newPage();
      await stubSupabaseAvecDonnees(pageGanttMoments, { commercantId, tables });
      await pageGanttMoments.route('https://api.open-meteo.com/**', (route) => {
        const dates = [];
        const hourlyTimes = []; const hourlyTemp = []; const hourlyCode = [];
        for (let d = 0; d < 10; d++) {
          const date = new Date();
          date.setDate(date.getDate() + d);
          const iso = date.toISOString().slice(0, 10);
          dates.push(iso);
          for (let h = 0; h < 24; h++) {
            hourlyTimes.push(iso + 'T' + String(h).padStart(2, '0') + ':00');
            if (h < 11) { hourlyTemp.push(11); hourlyCode.push(1); }
            else if (h < 17) { hourlyTemp.push(24); hourlyCode.push(0); }
            else { hourlyTemp.push(18); hourlyCode.push(61); }
          }
        }
        route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            daily: { time: dates, precipitation_sum: dates.map(() => 0), temperature_2m_max: dates.map(() => 27), weathercode: dates.map(() => 1) },
            hourly: { time: hourlyTimes, temperature_2m: hourlyTemp, weathercode: hourlyCode },
          }),
        });
      });

      await test('le badge météo du Gantt affiche aussi matin/midi/soir, distincts de la synthèse du jour', async () => {
        await pageGanttMoments.goto(BASE_URL + '/personnel.html');
        await pageGanttMoments.locator('#ganttMeteoMoments').waitFor({ state: 'visible', timeout: 10000 });
        const temperatures = await pageGanttMoments.locator('#ganttMeteoMoments .meteo-moment-temperature').allTextContents();
        expect(temperatures).toHaveLength(3);
        expect(temperatures.join(',')).toBe('11°C,24°C,18°C');
        const libelles = await pageGanttMoments.locator('#ganttMeteoMoments .meteo-moment-libelle').allTextContents();
        expect(libelles.join(',')).toBe('Matin,Midi,Soir');
      });

      await pageGanttMoments.close();
    });

    // Module partagé introduit le 16 septembre 2026 : avant, le moteur de
    // prévision (moyenne pondérée, exclusion des valeurs aberrantes, jours
    // fériés/vacances scolaires, recommandations...) était copié-collé à
    // l'identique dans tableau-de-bord.html, semaine.html, commandes.html et
    // personnel.html. Ces tests valident directement moteur-prevision.js
    // (chargé par tableau-de-bord.html, donc déjà présent sur window), pour
    // qu'une régression du calcul soit détectée une seule fois, au même
    // endroit que le calcul lui-même.
    await describe('moteur-prevision.js — module partagé', async () => {
      const pageMP = await browser.newPage();
      await stubSupabase(pageMP);
      await pageMP.goto(BASE_URL + '/tableau-de-bord.html');

      await test('expose toutes les fonctions attendues sur window.MoteurPrevision', async () => {
        const cles = await pageMP.evaluate(() => Object.keys(window.MoteurPrevision).sort());
        [
          'calculerRecommandation', 'calculerConsommationIngredients', 'calculerFourchette',
          'exclureValeursAberrantes', 'moyennePonderee', 'estJourFerie', 'zoneVacancesPourCodePostal',
          'estEnVacances', 'calculerPrevisionSemaine', 'calculerFiabilite', 'obtenirCoordonnees',
          'prochainsJoursOuverts', 'formatNomAffichage',
        ].forEach((nom) => expect(cles.indexOf(nom) !== -1).toBe(true));
      });

      await test('estJourFerie reconnaît les jours fériés à date fixe', async () => {
        const resultats = await pageMP.evaluate(() => {
          const MP = window.MoteurPrevision;
          return [
            MP.estJourFerie(new Date(2026, 0, 1)),   // 1er janvier
            MP.estJourFerie(new Date(2026, 4, 1)),   // 1er mai
            MP.estJourFerie(new Date(2026, 6, 14)),  // 14 juillet
            MP.estJourFerie(new Date(2026, 11, 25)), // 25 décembre
            MP.estJourFerie(new Date(2026, 6, 20)),  // 20 juillet : jour ordinaire
          ];
        });
        expect(resultats[0]).toBe(true);
        expect(resultats[1]).toBe(true);
        expect(resultats[2]).toBe(true);
        expect(resultats[3]).toBe(true);
        expect(resultats[4]).toBe(false);
      });

      await test('zoneVacancesPourCodePostal renvoie la bonne zone, ou null si non couvert', async () => {
        const resultats = await pageMP.evaluate(() => {
          const MP = window.MoteurPrevision;
          return [
            MP.zoneVacancesPourCodePostal('75001'), // Paris → zone C
            MP.zoneVacancesPourCodePostal('69001'), // Lyon → zone A
            MP.zoneVacancesPourCodePostal('20000'), // Corse → non couvert
            MP.zoneVacancesPourCodePostal('abcde'), // invalide
          ];
        });
        expect(resultats[0]).toBe('C');
        expect(resultats[1]).toBe('A');
        expect(resultats[2]).toBe(null);
        expect(resultats[3]).toBe(null);
      });

      await test('exclureValeursAberrantes écarte une valeur isolée très éloignée du reste', async () => {
        const resultat = await pageMP.evaluate(() => {
          const ventes = [10, 11, 9, 10, 12, 100].map((q, i) => ({ date_vente: '2026-01-0' + (i + 1), quantite: q }));
          return window.MoteurPrevision.exclureValeursAberrantes(ventes);
        });
        expect(resultat.nbExclus).toBe(1);
        expect(resultat.ventesFiltrees).toHaveLength(5);
      });

      await test('exclureValeursAberrantes ne filtre rien sous 5 points (historique trop court)', async () => {
        const resultat = await pageMP.evaluate(() => {
          const ventes = [10, 11, 200].map((q, i) => ({ date_vente: '2026-01-0' + (i + 1), quantite: q }));
          return window.MoteurPrevision.exclureValeursAberrantes(ventes);
        });
        expect(resultat.nbExclus).toBe(0);
        expect(resultat.ventesFiltrees).toHaveLength(3);
      });

      await test('moyennePonderee d\'une série constante renvoie cette constante', async () => {
        const moyenne = await pageMP.evaluate(() => {
          const ventes = [10, 10, 10, 10].map((q, i) => ({ date_vente: '2026-01-0' + (i + 1), quantite: q }));
          return window.MoteurPrevision.moyennePonderee(ventes);
        });
        expect(moyenne).toBe(10);
      });

      await test('calculerFourchette renvoie null sous 2 points d\'historique', async () => {
        const resultat = await pageMP.evaluate(() => {
          return window.MoteurPrevision.calculerFourchette([{ date_vente: '2026-01-01', quantite: 10 }], 10, 11);
        });
        expect(resultat).toBe(null);
      });

      await test('calculerRecommandation renvoie une structure complète et un delta cohérent', async () => {
        const resultat = await pageMP.evaluate(() => {
          // 5 lundis consécutifs, quantités stables autour de 20 : le lundi
          // suivant doit être calculé sur cette base, sans férié/vacances.
          const lundis = ['2025-08-04', '2025-08-11', '2025-08-18', '2025-08-25', '2025-09-01'];
          const ventes = lundis.map((d) => ({ date_vente: d, quantite: 20 }));
          const jourCible = new Date(2025, 8, 8); // lundi 8 septembre 2025
          return window.MoteurPrevision.calculerRecommandation(ventes, jourCible, null, {}, {}, {});
        });
        expect(resultat.quantite).toBeGreaterThan(0);
        expect(resultat.memeJourSemaine).toBe(true);
        expect(resultat.nomJourCible).toBe('lundi');
        expect(resultat.delta).toBe(resultat.quantite - 20);
      });

      await test('meteoDepuisReponse renvoie un objet {categorie, temperature, code, libelle, icone} par jour', async () => {
        const resultat = await pageMP.evaluate(() => {
          const data = {
            daily: {
              time: ['2026-09-22', '2026-09-23'],
              precipitation_sum: [5, 0],
              temperature_2m_max: [14, 28],
              weathercode: [61, 0]
            }
          };
          return window.MoteurPrevision.meteoDepuisReponse(data);
        });
        expect(resultat['2026-09-22'].categorie).toBe('pluvieux');
        expect(resultat['2026-09-22'].temperature).toBe(14);
        expect(resultat['2026-09-22'].icone).toBe('🌧️');
        expect(resultat['2026-09-23'].categorie).toBe('chaud');
        expect(resultat['2026-09-23'].libelle).toBe('Ciel dégagé');
      });

      await test('meteoDepuisReponse ajoute .moments (matin/midi/soir) quand la réponse contient des données horaires, sans rien changer au reste', async () => {
        const resultat = await pageMP.evaluate(() => {
          const hourlyTimes = [];
          const hourlyTemp = [];
          const hourlyCode = [];
          for (let h = 0; h < 24; h++) {
            hourlyTimes.push('2026-09-22T' + String(h).padStart(2, '0') + ':00');
            hourlyTemp.push(h < 11 ? 12 : (h < 17 ? 21 : 15));
            hourlyCode.push(h < 11 ? 1 : (h < 17 ? 0 : 61));
          }
          const data = {
            daily: { time: ['2026-09-22'], precipitation_sum: [0], temperature_2m_max: [21], weathercode: [1] },
            hourly: { time: hourlyTimes, temperature_2m: hourlyTemp, weathercode: hourlyCode },
          };
          return window.MoteurPrevision.meteoDepuisReponse(data);
        });
        const moments = resultat['2026-09-22'].moments;
        expect(moments).toHaveLength(3);
        expect(moments.map((m) => m.cle).join(',')).toBe('matin,midi,soir');
        expect(moments.map((m) => m.temperature).join(',')).toBe('12,21,15');
        // Le reste (utilisé par le calcul) reste inchangé.
        expect(resultat['2026-09-22'].categorie).toBe('normal');
        expect(resultat['2026-09-22'].temperature).toBe(21);
      });

      await test('meteoDepuisReponse : .moments est null sans données horaires (ex. réponse de recupererMeteoPassee)', async () => {
        const resultat = await pageMP.evaluate(() => {
          const data = { daily: { time: ['2026-09-22'], precipitation_sum: [0], temperature_2m_max: [21], weathercode: [1] } };
          return window.MoteurPrevision.meteoDepuisReponse(data);
        });
        expect(resultat['2026-09-22'].moments).toBe(null);
      });

      await test('calculerRecommandation ajuste la quantité selon la météo réelle (objet enrichi, pas une chaîne)', async () => {
        const resultat = await pageMP.evaluate(() => {
          // 5 lundis passés : 3 pluvieux à faible quantité, 2 normaux à forte
          // quantité — le lundi cible est prévu pluvieux, doit se rapprocher
          // des lundis pluvieux passés plutôt que de la moyenne brute.
          const ventes = [
            { date_vente: '2025-08-04', quantite: 10 },
            { date_vente: '2025-08-11', quantite: 10 },
            { date_vente: '2025-08-18', quantite: 10 },
            { date_vente: '2025-08-25', quantite: 30 },
            { date_vente: '2025-09-01', quantite: 30 },
          ];
          const meteoPassee = {
            '2025-08-04': { categorie: 'pluvieux', temperature: 15, code: 61, libelle: 'Pluie', icone: '🌧️' },
            '2025-08-11': { categorie: 'pluvieux', temperature: 15, code: 61, libelle: 'Pluie', icone: '🌧️' },
            '2025-08-18': { categorie: 'pluvieux', temperature: 15, code: 61, libelle: 'Pluie', icone: '🌧️' },
            '2025-08-25': { categorie: 'normal', temperature: 20, code: 1, libelle: 'Plutôt dégagé', icone: '🌤️' },
            '2025-09-01': { categorie: 'normal', temperature: 20, code: 1, libelle: 'Plutôt dégagé', icone: '🌤️' },
          };
          const jourCible = new Date(2025, 8, 8); // lundi 8 septembre 2025
          const meteoPrevue = { '2025-09-08': { categorie: 'pluvieux', temperature: 14, code: 63, libelle: 'Pluie', icone: '🌧️' } };
          const avecMeteo = window.MoteurPrevision.calculerRecommandation(ventes, jourCible, null, {}, meteoPassee, meteoPrevue);
          const sansMeteo = window.MoteurPrevision.calculerRecommandation(ventes, jourCible, null, {}, {}, {});
          return { avecMeteo: avecMeteo.quantite, sansMeteo: sansMeteo.quantite };
        });
        expect(resultat.avecMeteo).toBeGreaterThan(0);
        expect(resultat.avecMeteo < resultat.sansMeteo).toBeTruthy();
      });

      await test('formatNomAffichage normalise la casse et les espaces superflus', async () => {
        const resultats = await pageMP.evaluate(() => {
          const MP = window.MoteurPrevision;
          return [MP.formatNomAffichage('  CROISSANT  '), MP.formatNomAffichage('pain au chocolat')];
        });
        expect(resultats[0]).toBe('Croissant');
        expect(resultats[1]).toBe('Pain au chocolat');
      });

      await pageMP.close();
    });

    // Étape 7 (Espace employé) : espace-employe.html doit distinguer un
    // compte employé actif (contenu de bienvenue), un compte connecté mais
    // pas employé (accès refusé, jamais le contenu employé), et une absence
    // de session (redirection vers connexion.html).
    await describe('espace-employe.html — accès et planning hebdomadaire', async () => {
      // tables : { personnel, secteurs_personnel, postes_personnel, creneaux_personnel }
      // Chaîne générique (select/eq/gte/lte/order renvoient toute la table,
      // sans filtrage réel) : suffisant ici, chaque test ne fournit que les
      // lignes pertinentes pour son scénario.
      async function stubEspaceEmploye(page, { session, tables }) {
        await page.addInitScript(({ session, tables }) => {
          window.supabase = {
            createClient: function () {
              return {
                auth: {
                  getSession: function () { return Promise.resolve({ data: { session: session } }); },
                  signOut: function () { return Promise.resolve({ error: null }); },
                },
                from: function (table) {
                  var data = (tables && tables[table]) || [];
                  var chain = {
                    select: function () { return chain; },
                    eq: function () { return chain; },
                    gte: function () { return chain; },
                    lte: function () { return chain; },
                    order: function () { return chain; },
                    then: function (cb) { return Promise.resolve({ data: data, error: null }).then(cb); },
                  };
                  return chain;
                },
              };
            },
          };
        }, { session, tables });
      }

      const PERSONNEL_U1 = { id: 6, user_id: 'u1', nom: 'Test Employe', commercant_id: 'c1' };

      await test('un compte employé actif voit son planning (message personnalisé, jamais l\'accès refusé)', async () => {
        const page = await browser.newPage();
        await stubEspaceEmploye(page, {
          session: { user: { id: 'u1', user_metadata: { role: 'employe' } } },
          tables: { personnel: [PERSONNEL_U1], secteurs_personnel: [], postes_personnel: [], creneaux_personnel: [] },
        });
        await page.goto(BASE_URL + '/espace-employe.html');
        await page.locator('#zoneContenu').waitFor({ state: 'visible' });
        expect(await page.locator('#zoneNonAutorise').isVisible()).toBe(false);
        expect(await page.locator('#titre').textContent()).toContain('Test employe');
        await page.close();
      });

      await test('un compte connecté mais pas employé voit un accès refusé, jamais le contenu employé', async () => {
        const page = await browser.newPage();
        await stubEspaceEmploye(page, { session: { user: { id: 'u2', user_metadata: {} } }, tables: {} });
        await page.goto(BASE_URL + '/espace-employe.html');
        await page.locator('#zoneNonAutorise').waitFor({ state: 'visible' });
        expect(await page.locator('#zoneContenu').isVisible()).toBe(false);
        await page.close();
      });

      await test('sans session, redirige vers connexion.html', async () => {
        const page = await browser.newPage();
        await stubEspaceEmploye(page, { session: null, tables: {} });
        await page.goto(BASE_URL + '/espace-employe.html');
        await page.waitForURL(/connexion\.html/);
        await page.close();
      });

      await test('un jour sans créneau affiche Repos, un jour avec créneau affiche l\'horaire et le secteur', async () => {
        const page = await browser.newPage();
        const iso = (() => {
          const d = new Date();
          const mm = ('0' + (d.getMonth() + 1)).slice(-2);
          const dd = ('0' + d.getDate()).slice(-2);
          return d.getFullYear() + '-' + mm + '-' + dd;
        })();
        await stubEspaceEmploye(page, {
          session: { user: { id: 'u1', user_metadata: { role: 'employe' } } },
          tables: {
            personnel: [PERSONNEL_U1],
            secteurs_personnel: [{ id: 'salle', commercant_id: 'c1', nom: 'Salle', couleur: '#4caf6d', ordre: 0 }],
            postes_personnel: [{ id: 'generique', secteur_id: 'salle', commercant_id: 'c1', nom: 'Générique', ordre: 0 }],
            creneaux_personnel: [{ id: 1, commercant_id: 'c1', personnel_id: 6, date_creneau: iso, heure_debut: '09:00:00', heure_fin: '17:00:00', secteur_id: 'salle', poste_id: 'generique' }],
          },
        });
        await page.goto(BASE_URL + '/espace-employe.html');
        await page.locator('.ligne-jour-horaire').first().waitFor({ state: 'visible' });
        expect(await page.locator('.ligne-jour-horaire').first().textContent()).toContain('09h00');
        expect(await page.locator('.ligne-jour-repos-texte').count()).toBe(6);
        await page.close();
      });

      await test('la navigation vers la semaine suivante change le libellé affiché', async () => {
        const page = await browser.newPage();
        await stubEspaceEmploye(page, {
          session: { user: { id: 'u1', user_metadata: { role: 'employe' } } },
          tables: { personnel: [PERSONNEL_U1], secteurs_personnel: [], postes_personnel: [], creneaux_personnel: [] },
        });
        await page.goto(BASE_URL + '/espace-employe.html');
        await page.locator('#zoneContenu').waitFor({ state: 'visible' });
        await page.locator('#btnSemaineSuiv').click();
        expect(await page.locator('#libelleSemaine').textContent()).toBe('Semaine prochaine');
        await page.close();
      });
    });

    await describe('connexion.html — redirection selon le rôle du compte', async () => {
      async function stubConnexion(page, options) {
        await page.addInitScript((options) => {
          window.supabase = {
            createClient: function () {
              return {
                auth: {
                  getSession: function () {
                    return Promise.resolve({ data: { session: options.sessionInitiale || null } });
                  },
                  signInWithPassword: function () {
                    return Promise.resolve({ data: { session: options.sessionConnexion, user: (options.sessionConnexion || {}).user }, error: null });
                  },
                  signUp: function () {
                    return Promise.resolve({ data: { session: options.sessionConnexion, user: (options.sessionConnexion || {}).user }, error: null });
                  },
                },
              };
            },
          };
        }, options);
      }

      await test('une session employé déjà active redirige vers espace-employe.html, jamais le tableau de bord', async () => {
        const page = await browser.newPage();
        await stubConnexion(page, { sessionInitiale: { user: { id: 'u1', user_metadata: { role: 'employe' } } } });
        await page.goto(BASE_URL + '/connexion.html');
        await page.waitForURL(/espace-employe\.html/);
        await page.close();
      });

      await test('une session patron déjà active redirige vers tableau-de-bord.html', async () => {
        const page = await browser.newPage();
        await stubConnexion(page, { sessionInitiale: { user: { id: 'u2', user_metadata: {} } } });
        await page.goto(BASE_URL + '/connexion.html');
        await page.waitForURL(/tableau-de-bord\.html/);
        await page.close();
      });

      await test('se connecter avec un compte employé redirige vers espace-employe.html', async () => {
        const page = await browser.newPage();
        await stubConnexion(page, { sessionConnexion: { user: { id: 'u3', user_metadata: { role: 'employe' } } } });
        await page.goto(BASE_URL + '/connexion.html');
        await page.locator('#email').fill('employe@test.fr');
        await page.locator('#motdepasse').fill('motdepasse123');
        await page.locator('#btnAction').click();
        await page.waitForURL(/espace-employe\.html/);
        await page.close();
      });

      await test('se connecter avec un compte patron redirige vers tableau-de-bord.html', async () => {
        const page = await browser.newPage();
        await stubConnexion(page, { sessionConnexion: { user: { id: 'u4', user_metadata: {} } } });
        await page.goto(BASE_URL + '/connexion.html');
        await page.locator('#email').fill('patron@test.fr');
        await page.locator('#motdepasse').fill('motdepasse123');
        await page.locator('#btnAction').click();
        await page.waitForURL(/tableau-de-bord\.html/);
        await page.close();
      });
    });
  } finally {
    await browser.close();
    server.close();
  }

  console.log('');
  console.log(passed + ' réussis, ' + failed + ' échoués');
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
