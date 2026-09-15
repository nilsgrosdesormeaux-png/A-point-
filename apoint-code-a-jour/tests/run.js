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
  'semaine.html',
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
              then: function (cb) { return Promise.resolve({ data: chain._data, error: null }).then(cb); },
              insert: function () { return Promise.resolve({ data: [], error: null }); },
              delete: function () {
                var d = {
                  eq: function () { return d; },
                  gte: function () { return d; },
                  lte: function () { return Promise.resolve({ data: [], error: null }); },
                };
                return d;
              },
              update: function () {
                return { eq: function () { return Promise.resolve({ data: [], error: null }); } };
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

      await test('marque "Produits" actif sur produits.html', async () => {
        await page.goto(BASE_URL + '/produits.html');
        const actif = page.locator('#navPrincipale a.nav-actif');
        expect(await actif.textContent()).toBe('Produits');
      });

      await test('marque "Commandes" actif sur commandes.html', async () => {
        await page.goto(BASE_URL + '/commandes.html');
        const actif = page.locator('#navPrincipale a.nav-actif, #navPrincipale button.nav-actif');
        await actif.first().waitFor({ state: 'attached' });
        expect(await actif.first().textContent()).toContain('Commandes');
      });

      await test('regroupe Semaine et Personnel sous le menu "Activité"', async () => {
        await page.goto(BASE_URL + '/semaine.html');
        const bouton = page.locator('#navPrincipale button.nav-lien--menu');
        expect(await bouton.textContent()).toContain('Activité');
      });

      await test('menu "Activité" est marqué actif sur semaine.html et personnel.html', async () => {
        await page.goto(BASE_URL + '/semaine.html');
        expect(await page.locator('#navPrincipale button.nav-lien--menu').getAttribute('class')).toContain('nav-actif');

        await page.goto(BASE_URL + '/personnel.html');
        expect(await page.locator('#navPrincipale button.nav-lien--menu').getAttribute('class')).toContain('nav-actif');
      });

      await test('sous-menu Activité contient les liens Affluence, Équipe, Planning', async () => {
        await page.goto(BASE_URL + '/semaine.html');
        const sousLiens = page.locator('#navPrincipale .nav-sous-lien');
        expect(await sousLiens.count()).toBe(3);
        const textes = await sousLiens.allTextContents();
        expect(textes.join(',')).toContain('Affluence');
        expect(textes.join(',')).toContain('Équipe');
        expect(textes.join(',')).toContain('Planning');
      });

      await test('clic sur le bouton "Activité" ouvre le sous-menu', async () => {
        await page.goto(BASE_URL + '/produits.html');
        const menu = page.locator('#navPrincipale .nav-menu');
        const bouton = menu.locator('.nav-lien--menu');
        await bouton.click();
        expect(await menu.getAttribute('class')).toContain('nav-menu--ouvert');
        expect(await bouton.getAttribute('aria-expanded')).toBe('true');
      });

      await test('clic en dehors du menu le referme', async () => {
        await page.goto(BASE_URL + '/produits.html');
        const menu = page.locator('#navPrincipale .nav-menu');
        await menu.locator('.nav-lien--menu').click();
        expect(await menu.getAttribute('class')).toContain('nav-menu--ouvert');
        await page.locator('body').click({ position: { x: 5, y: 5 } });
        expect(await menu.getAttribute('class')).not.toContain('nav-menu--ouvert');
      });

      await test('lien Aide toujours présent et discret', async () => {
        await page.goto(BASE_URL + '/tableau-de-bord.html');
        const lienAide = page.locator('#navPrincipale a.nav-lien--discret');
        expect(await lienAide.textContent()).toContain('Aide');
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

    await describe('personnel.html — couverture par heure', async () => {
      const commercantId = 'test-commercant-couverture';
      const demain = new Date();
      demain.setDate(demain.getDate() + 1);
      const isoDemain = demain.toISOString().slice(0, 10);

      const pageAvecDonnees = await browser.newPage();
      await stubSupabaseAvecDonnees(pageAvecDonnees, {
        commercantId,
        tables: {
          personnel: [
            { id: 'p1', nom: 'Alice', role: 'vendeur', heures_disponibles: {} },
            { id: 'p2', nom: 'Bob', role: 'cuisinier', heures_disponibles: {} },
            { id: 'p3', nom: 'Chloe', role: 'vendeur', heures_disponibles: {} },
          ],
          ventes: [],
          parametres_commercant: [],
          evenements_commercant: [],
          creneaux_personnel: [
            { id: 'c1', commercant_id: commercantId, personnel_id: 'p1', date_creneau: isoDemain, heure_debut: '08:00:00', heure_fin: '12:00:00', role: 'vendeur', origine: 'manuel' },
            { id: 'c2', commercant_id: commercantId, personnel_id: 'p2', date_creneau: isoDemain, heure_debut: '10:30:00', heure_fin: '15:00:00', role: 'cuisinier', origine: 'manuel' },
            { id: 'c3', commercant_id: commercantId, personnel_id: 'p3', date_creneau: isoDemain, heure_debut: '14:00:00', heure_fin: '22:00:00', role: 'vendeur', origine: 'manuel' },
          ],
        },
      });

      await test('affiche une colonne par heure couverte, avec le bon total au pic de chevauchement', async () => {
        await pageAvecDonnees.goto(BASE_URL + '/personnel.html');
        await pageAvecDonnees.locator('#couvertureCreneaux').waitFor({ state: 'visible' });

        const labels = await pageAvecDonnees.locator('.couverture-label').allTextContents();
        expect(labels[0]).toBe('8h');
        expect(labels[labels.length - 1]).toBe('21h');

        const valeurs = await pageAvecDonnees.locator('.couverture-valeur').allTextContents();
        const indexOnzeH = labels.indexOf('11h');
        const indexQuatorzeH = labels.indexOf('14h');
        expect(valeurs[indexOnzeH]).toBe('2');
        expect(valeurs[indexQuatorzeH]).toBe('2');
        expect(valeurs[0]).toBe('1');
      });

      const pageSansCreneaux = await browser.newPage();
      await stubSupabaseAvecDonnees(pageSansCreneaux, {
        commercantId,
        tables: {
          personnel: [],
          ventes: [],
          parametres_commercant: [],
          evenements_commercant: [],
          creneaux_personnel: [],
        },
      });

      await test('reste masquée quand le jour affiché n\'a aucun créneau', async () => {
        await pageSansCreneaux.goto(BASE_URL + '/personnel.html');
        await pageSansCreneaux.waitForTimeout(600);
        expect(await pageSansCreneaux.locator('#couvertureCreneaux').isVisible()).toBe(false);
      });

      await pageAvecDonnees.close();
      await pageSansCreneaux.close();
    });

    await describe('personnel.html — Gantt nominatif par personne', async () => {
      const commercantId = 'test-commercant-gantt';
      const demain = new Date();
      demain.setDate(demain.getDate() + 1);
      const isoDemain = demain.toISOString().slice(0, 10);

      const pageGantt = await browser.newPage();
      await stubSupabaseAvecDonnees(pageGantt, {
        commercantId,
        tables: {
          personnel: [
            { id: 'p1', nom: 'Vincent', role: 'salle', heures_disponibles: {} },
            { id: 'p2', nom: 'Océane', role: 'manager', heures_disponibles: {} },
            { id: 'p4', nom: 'Mirella', role: 'bar', heures_disponibles: {} },
          ],
          ventes: [],
          parametres_commercant: [],
          evenements_commercant: [],
          creneaux_personnel: [
            { id: 'c1', commercant_id: commercantId, personnel_id: 'p1', date_creneau: isoDemain, heure_debut: '11:00:00', heure_fin: '15:00:00', role: 'salle', origine: 'manuel' },
            { id: 'c1b', commercant_id: commercantId, personnel_id: 'p1', date_creneau: isoDemain, heure_debut: '18:00:00', heure_fin: '23:00:00', role: 'salle', origine: 'manuel' },
            { id: 'c2', commercant_id: commercantId, personnel_id: 'p2', date_creneau: isoDemain, heure_debut: '10:00:00', heure_fin: '18:00:00', role: 'manager', origine: 'manuel' },
            // Créneau traversant minuit : cas piège trouvé en développant (heure_fin < heure_debut).
            { id: 'c4', commercant_id: commercantId, personnel_id: 'p4', date_creneau: isoDemain, heure_debut: '19:00:00', heure_fin: '02:00:00', role: 'bar', origine: 'manuel' },
          ],
        },
      });

      await test('affiche une ligne par personne avec ses créneaux, total d\'heures inclus', async () => {
        await pageGantt.goto(BASE_URL + '/personnel.html');
        await pageGantt.locator('#zoneGanttPersonnel').waitFor({ state: 'visible' });

        const noms = await pageGantt.locator('.gantt-cellule-nom:not(.gantt-entete)').allTextContents();
        expect(noms.join(',')).toContain('Vincent');
        expect(noms.join(',')).toContain('Océane');
        expect(noms.join(',')).toContain('Mirella');

        // Vincent a 2 créneaux (11h-15h + 18h-23h) : 2 barres sur sa ligne.
        const barresVincent = await pageGantt.locator('.gantt-piste').first().locator('.gantt-barre').count();
        expect(barresVincent).toBe(2);
      });

      await test('un créneau traversant minuit (19h-02h) est rendu avec une largeur cohérente, pas rejeté', async () => {
        await pageGantt.goto(BASE_URL + '/personnel.html');
        await pageGantt.locator('#zoneGanttPersonnel').waitFor({ state: 'visible' });

        // La ligne de Mirella est la 3e (après Vincent et Océane) : une seule barre, 19:00–02:00.
        const pistes = pageGantt.locator('.gantt-piste');
        const barreMirella = pistes.nth(2).locator('.gantt-barre');
        expect(await barreMirella.count()).toBe(1);
        expect(await barreMirella.textContent()).toContain('19:00');
        expect(await barreMirella.textContent()).toContain('02:00');

        // La grille d'heures doit s'étendre jusqu'après minuit (au moins jusqu'à "1h"),
        // pas s'arrêter à 24h — sinon le créneau de Mirella serait tronqué visuellement.
        const labelsHeure = await pageGantt.locator('.gantt-label-heure').allTextContents();
        expect(labelsHeure.join(',')).toContain('1h');
      });

      await test('la colonne des noms et le total restent en position sticky (scrollables horizontalement)', async () => {
        await pageGantt.goto(BASE_URL + '/personnel.html');
        await pageGantt.locator('#zoneGanttPersonnel').waitFor({ state: 'visible' });
        const position = await pageGantt.locator('.gantt-cellule-nom').first().evaluate((el) => getComputedStyle(el).position);
        expect(position).toBe('sticky');
      });

      await test('reste masqué quand le jour affiché n\'a aucun créneau', async () => {
        await pageGantt.goto(BASE_URL + '/personnel.html');
        await pageGantt.evaluate(() => {
          document.getElementById('btnPlanningJourSuiv').click();
          document.getElementById('btnPlanningJourSuiv').click();
          document.getElementById('btnPlanningJourSuiv').click();
        });
        await pageGantt.waitForTimeout(400);
        expect(await pageGantt.locator('#zoneGanttPersonnel').isVisible()).toBe(false);
      });

      await pageGantt.close();
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
