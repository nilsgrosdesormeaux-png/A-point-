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
          },
          from: function () {
            var chain = {
              select: function () { return chain; },
              eq: function () { return Promise.resolve({ data: [], error: null }); },
            };
            return chain;
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

      await test('import.html redirige vers commandes.html (page absorbée)', async () => {
        await page.goto(BASE_URL + '/import.html', { waitUntil: 'load' });
        await page.waitForURL('**/commandes.html');
        expect(page.url()).toContain('commandes.html');
      });
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

      await test('marque "Commandes" actif sur commandes.html', async () => {
        await page.goto(BASE_URL + '/commandes.html');
        const actif = page.locator('#navPrincipale a.nav-lien-g.actif');
        expect(await actif.textContent()).toBe('Commandes');
      });

      await test('Mes produits / Commandes / Imports sont en repli (cachés sous 720px)', async () => {
        await page.goto(BASE_URL + '/tableau-de-bord.html');
        const liens = await page.locator('#navPrincipale a.nav-lien-g--repli').allTextContents();
        expect(liens.join(',')).toBe('Mes produits,Commandes,Imports');
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
        expect(liensHamburger.join(',')).toContain('Commandes');
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
    });

    await describe('Comportement sans session (non connecté)', async () => {
      const attentes = {
        'tableau-de-bord.html': 'Non connecté',
        'aide.html': "n'es pas connecté",
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

      await test('le bouton "Gérer les catégories" ouvre une fenêtre pour créer/renommer/supprimer des catégories', async () => {
        await pageProduits.goto(BASE_URL + '/produits.html');
        await pageProduits.locator('.bloc-categorie-produits').first().waitFor({ state: 'visible' });
        await pageProduits.locator('#btnGererCategories').click();
        await pageProduits.locator('#modalCategories').waitFor({ state: 'visible' });
        const etiquettes = await pageProduits.locator('#listeCategoriesConfig .etiquette-poste-config').allTextContents();
        expect(etiquettes.join(',')).toContain('Pizzas');
        await pageProduits.locator('#btnFermerModalCategories').click();
        expect(await pageProduits.locator('#modalCategories').isHidden()).toBeTruthy();
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

      await test('l\'infobulle explicative est à côté du titre "Prévision pour...", pas au-dessus de la liste', async () => {
        await pagePrevisions.goto(BASE_URL + '/previsions.html');
        await pagePrevisions.locator('.ligne-prod-jour').first().waitFor({ state: 'visible' });
        const titre = await pagePrevisions.locator('#sombreTitre').innerText();
        expect(titre).toContain('ⓘ');
        expect(await pagePrevisions.locator('#labelProduction .info-bulle').count()).toBe(0);
      });

      await test('le label "Production pour..." a disparu, remplacé par un bouton "+ Catégorie"', async () => {
        await pagePrevisions.goto(BASE_URL + '/previsions.html');
        await pagePrevisions.locator('.ligne-prod-jour').first().waitFor({ state: 'visible' });
        const zone = await pagePrevisions.locator('#labelProduction').innerText();
        expect(zone.toLowerCase()).not.toContain('production pour');
        expect(zone).toContain('+ Catégorie');
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
        await pagePrevisions.locator('#btnAjouterCategorieProduction').click();
        await pagePrevisions.locator('.pill-categorie', { hasText: 'Poisson' }).waitFor({ state: 'visible' });
        const options = await pagePrevisions.locator('.select-categorie-produit').first().locator('option').allTextContents();
        expect(options.join(',')).toContain('Poisson');
      });

      await pagePrevisions.close();
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

      await pageGantt.close();
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
