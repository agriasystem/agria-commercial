// Prova end-to-end di Agria Commercial (shell, Scout, Navigatore) nel Chromium di Playwright.
//
// Carica l'estensione vera, serve in locale i siti di prova di tests/fixtures con domini finti
// (*.test) e ripercorre il lavoro del commerciale: analisi della pagina aperta, correzione a mano,
// scansione approfondita di tutto il sito (con sitemap, pagine rotte, file non HTML, link verso
// un altro dominio, blog lungo), persone e dati rilevati, Verifica HubSpot nei tre scenari MOCK,
// annullamento, nuovo prospect, ripresa dopo la riapertura del pannello, Svuota, e i casi emersi
// dai test manuali (La Mora: email attaccata al telefono e host senza cognome; Perticaia: alias
// info@/visit@, cantina, contatto a mano, informativa privacy senza persone false). Scelta del
// commerciale all'apertura, cambio durante la sessione e nuova sessione di Chrome. Impostazioni con
// salvataggio automatico e commerciali disponibili.
// HubSpot REALE contro un HubSpot FINTO (tests/support/fakeHubspot.js): Playwright intercetta ogni
// richiesta del service worker verso https://api.hubapi.com, e in più api.hubapi.com punta a
// 127.0.0.1, così una richiesta sfuggita fallisce invece di raggiungere il CRM vero. Service Key,
// test della connessione (401, 403, 200), 429, errore di validazione, race condition, azienda già
// presente, contatto già presente, creazione di Azienda e Contatto con errore e nuovo tentativo.
// Controlla anche che le pagine analizzate non vengano modificate e che la scansione non esca dal
// dominio né scarichi due volte la stessa pagina. Schermate in .tmp/e2e/.
//
// Il pannello viene aperto come scheda (chrome-extension://…/sidepanel.html): è la stessa
// pagina del pannello laterale, che in modalità automatica non si può aprire con un clic.
//
// Playwright NON è una dipendenza del progetto. Serve una sua installazione con Chromium:
//   npm i --no-save playwright && npx playwright install chromium
// oppure NODE_PATH che punti a una cartella node_modules che lo contiene già.

import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPERATORS } from '../extension/lib/operators.js';
import { followUpSchedule, formatDue } from '../extension/lib/outreachTime.js';
import { createFakeHubspot } from '../tests/support/fakeHubspot.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, 'extension');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
const OUT = path.join(ROOT, '.tmp', 'e2e');
const PROFILE = path.join(ROOT, '.tmp', 'e2e-profile');
const LATENCY_MS = 60;
const SCAN_ACCEPT = new Set(['text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', 'application/xml,text/xml;q=0.9,*/*;q=0.1']);
const SITES = {
  'agriturismo-lamora.test': {
    '/': 'agriturismo-home.html',
    '/contatti': 'agriturismo-contatti.html',
    '/chi-siamo': 'agriturismo-chi-siamo.html',
    '/camere': 'agriturismo-camere.html',
    '/privacy': 'agriturismo-privacy.html',
    '/cookie-policy': 'agriturismo-cookie.html',
    '/dove-siamo': 'agriturismo-dove-siamo.html',
    '/blog/': 'agriturismo-blog.html',
    '/sitemap.xml': 'agriturismo-sitemap.xml',
  },
  'cantinarossi.test': { '/contatti': 'cantina-contatti.html' },
  // casi emersi dai test manuali sui siti reali (Milestone 1.1.1), riprodotti con dati di prova
  'lamora-caso.test': { '/': 'caso-lamora-home.html', '/chi-siamo': 'caso-lamora-chi-siamo.html' },
  'perticaia-caso.test': { '/': 'caso-perticaia.html', '/privacy-policy': 'caso-perticaia-privacy.html' },
  // Patch 2.0.3: località su più formati e pagine, persone con ruoli scritti dal sito
  'berioli-caso.test': {
    '/': 'caso-berioli-home.html',
    '/contatti/': 'caso-berioli-contatti.html', '/contatti': 'caso-berioli-contatti.html',
    '/la-cantina/': 'caso-berioli-la-cantina.html', '/la-cantina': 'caso-berioli-la-cantina.html',
  },
  // Patch 0.4.1: comune dal CAP (Loc. … 06134 (PG)), nome senza «con ristorante», ristorante proprio
  'lalocandadeigolosi.test': { '/': 'caso-locanda-home.html' },
  'ilcanticodellecicale.test': {
    '/': 'caso-cicale-home.html',
    '/ristorante-in-agriturismo/': 'caso-cicale-ristorante.html', '/ristorante-in-agriturismo': 'caso-cicale-ristorante.html',
  },
};
const [MATTEO, ALESSANDRO] = OPERATORS;
// chiavi finte: il finto HubSpot accetta solo FAKE_KEY
const FAKE_KEY = 'e2e-finta-service-key-0000000000000000';
const WRONG_KEY = 'e2e-chiave-sbagliata-11111111111111111';
const ownerText = (o) => `${o.name} · ID ${o.hubspotOwnerId}`;

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  console.error('Playwright non trovato: installalo con «npm i --no-save playwright» oppure imposta NODE_PATH.');
  process.exit(2);
}

const failures = [];
let passed = 0;
function check(name, ok, detail = '') {
  if (ok) passed += 1;
  else failures.push(detail ? `${name} — ${detail}` : name);
  console.log(`  ${ok ? 'ok' : 'NO'}  ${name}${!ok && detail ? ` — ${detail}` : ''}`);
}
const equal = (name, actual, expected) => check(name, actual === expected, `atteso ${JSON.stringify(expected)}, trovato ${JSON.stringify(actual)}`);
const includes = (name, text, part) => check(name, String(text).includes(part), `«${part}» non trovato in ${JSON.stringify(String(text).slice(0, 300))}`);

// ogni richiesta ricevuta: le navigazioni del browser e i download della scansione (fetch dell'estensione)
const requests = [];

function startServer() {
  const server = http.createServer((req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    const url = req.url.split('?')[0];
    // i download della scansione hanno l'intestazione Accept di lib/fetchPage.js; le navigazioni
    // del browser e la favicon no (su http Chrome non manda le intestazioni Sec-Fetch-*)
    requests.push({ host, path: url, scan: SCAN_ACCEPT.has(req.headers.accept), cookie: req.headers.cookie || '', method: req.method });
    setTimeout(() => {
      if (host === 'agriturismo-lamora.test' && url === '/listino') {
        res.writeHead(200, { 'content-type': 'application/pdf' });
        res.end('%PDF-1.4 listino');
        return;
      }
      const post = host === 'agriturismo-lamora.test' && url.match(/^\/blog\/([a-z0-9-]+)$/);
      if (post) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${post[1]} | Blog</title></head><body><main><h1>${post[1]}</h1><p>Un articolo del blog.</p><a href="/blog/">Torna al blog</a></main></body></html>`);
        return;
      }
      const file = SITES[host]?.[url];
      if (!file) {
        res.writeHead(404, { 'content-type': 'text/html' });
        res.end('<h1>Pagina non trovata</h1>');
        return;
      }
      res.writeHead(200, { 'content-type': file.endsWith('.xml') ? 'application/xml' : 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(FIXTURES, file)));
    }, LATENCY_MS);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function run(context, site, fake) {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(worker.url()).host;
  console.log(`Estensione caricata (${extId})\n`);

  console.log('Service worker e pannello laterale');
  // il service worker imposta il comportamento appena parte: si aspetta al massimo 5 secondi
  let behavior = {};
  for (let i = 0; i < 50 && !behavior.openPanelOnActionClick; i += 1) {
    behavior = await worker.evaluate(() => chrome.sidePanel.getPanelBehavior());
    if (!behavior.openPanelOnActionClick) await new Promise((r) => setTimeout(r, 100));
  }
  check("il clic sull'icona apre il pannello laterale", behavior.openPanelOnActionClick === true, JSON.stringify(behavior));
  const panelOptions = await worker.evaluate(() => chrome.sidePanel.getOptions({}));
  check('pannello laterale = sidepanel/sidepanel.html', String(panelOptions.path).endsWith('sidepanel/sidepanel.html'), JSON.stringify(panelOptions));

  const errors = [];
  const watch = (page, name) => {
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    page.on('console', (m) => {
      // le pagine 404 della scansione sono previste e gestite: Chrome le registra comunque come errori di rete
      if (m.type() === 'error' && !/fonts\.g(oogleapis|static)\.com|ERR_(INTERNET|NAME|CONNECTION)|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`);
    });
  };
  const panel = await context.newPage();
  watch(panel, 'pannello');
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`);
  await panel.waitForSelector('#company-name', { state: 'attached' });
  await panel.waitForFunction(() => document.querySelector('#status-text').textContent !== 'Caricamento…');

  const value = (id) => panel.inputValue(`#${id}`);
  const text = (sel) => panel.textContent(sel);
  const press = (sel) => panel.$eval(sel, (b) => b.click());
  const shot = async (name) => {
    await panel.bringToFront();
    await panel.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  };
  const waitIdle = () => panel.waitForFunction(() => document.querySelector('#status').dataset.state !== 'busy', null, { timeout: 60000 });
  async function analyze(tab) {
    await tab.bringToFront();
    await press('#analyze');
    await waitIdle();
    return { state: await panel.getAttribute('#status', 'data-state'), text: await text('#status-text') };
  }
  async function deepScan(tab) {
    await tab.bringToFront();
    const seen = [];
    await press('#deep-scan');
    // si registrano i messaggi di avanzamento mentre la scansione procede
    for (let i = 0; i < 600; i += 1) {
      const state = await panel.getAttribute('#status', 'data-state');
      const current = await text('#status-text');
      if (!seen.includes(current)) seen.push(current);
      if (state !== 'busy' && i > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await waitIdle();
    return { state: await panel.getAttribute('#status', 'data-state'), text: await text('#status-text'), seen };
  }
  async function openTab(url) {
    const [page] = await Promise.all([
      context.waitForEvent('page'),
      panel.evaluate((u) => chrome.tabs.create({ url: u, active: true }), url),
    ]);
    await page.waitForLoadState('load');
    return page;
  }
  async function verify() {
    await press('#verify');
    const disabled = await panel.$eval('#verify', (b) => b.disabled);
    await press('#verify'); // secondo clic durante la verifica: deve essere ignorato
    await panel.waitForSelector('#verify-result:not([hidden])', { timeout: 10000 });
    await panel.waitForFunction(() => !document.querySelector('#verify').disabled);
    return { disabled, kind: await panel.getAttribute('#verify-result', 'data-kind'), text: await text('#verify-result') };
  }
  const watchMutations = (tab) => tab.evaluate(() => {
    window.__agriaMutations = 0;
    new MutationObserver((list) => { window.__agriaMutations += list.length; })
      .observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  });

  console.log('\nIntestazione e stato MOCK');
  check('intestazione AGRIA COMMERCIAL', (await text('header')).includes('AGRIA COMMERCIAL') && (await text('header .brand .k')) === 'Agria System');
  equal('titolo della pagina', await panel.title(), 'Agria Commercial');
  check('badge MOCK visibile in alto', await panel.isVisible('header .badge.mock'));
  includes('scenario MOCK iniziale', await text('#hubspot-hint'), 'Scenario: Azienda non presente');
  equal('badge MOCK in alto', (await text('header [data-mode-badge]')).trim(), 'HubSpot MOCK');
  check('pulsante principale «Scansione approfondita»', (await text('#deep-scan')).trim() === 'Scansione approfondita');

  console.log('\nScelta del commerciale: «Chi sta usando Agria Commercial?»');
  check('nuova sessione: schermata di scelta', await panel.isVisible('#operator-picker'));
  equal('domanda', (await text('#picker-title')).trim(), 'Chi sta usando Agria Commercial?');
  check('senza commerciale: nessuna navigazione fra i moduli', await panel.isHidden('#module-nav'));
  check('pannello nascosto finché non si sceglie', await panel.isHidden('#app'));
  equal('una card per ogni commerciale del registro', JSON.stringify(await panel.$$eval('#operator-list .operator .operator-name', (n) => n.map((x) => x.textContent))),
    JSON.stringify(OPERATORS.map((o) => o.name)));
  equal('ID owner in piccolo', await panel.$eval(`#operator-list .operator[data-owner-id="${MATTEO.hubspotOwnerId}"] .operator-id`, (n) => n.textContent), `Owner ID ${MATTEO.hubspotOwnerId}`);
  check('nessun «Annulla» alla prima scelta', await panel.isHidden('#operator-cancel'));
  // senza commerciale: scansione, analisi e verifica non partono nemmeno forzando il clic
  for (const button of ['#deep-scan', '#analyze', '#verify']) await press(button);
  await new Promise((r) => setTimeout(r, 300));
  check('senza commerciale: nessuna scansione', !requests.some((q) => q.scan));
  equal('senza commerciale: stato invariato', await panel.getAttribute('#status', 'data-state'), 'idle');
  check('senza commerciale: nessuna verifica HubSpot', await panel.isHidden('#verify-result'));
  check('senza commerciale: resta la scelta', await panel.isVisible('#operator-picker'));
  await shot('0-chi-sta-usando');
  await panel.click(`#operator-list .operator[data-owner-id="${MATTEO.hubspotOwnerId}"]`);
  check('scelto Matteo: pannello visibile', await panel.isVisible('#app'));
  check('scelta chiusa', await panel.isHidden('#operator-picker'));
  equal('commerciale attivo nel pannello', (await text('#active-user')).replace(/\s+/g, ' ').trim(), 'Commerciale attivo: Matteo Garuzzo · Cambia');
  equal('proprietario Azienda = commerciale attivo', await text('#company-hubspot_owner_id'), ownerText(MATTEO));
  equal('proprietario Contatto = commerciale attivo', await text('#contact-hubspot_owner_id'), ownerText(MATTEO));
  includes('proprietario: fonte dichiarata', await text('#company-hubspot_owner_id-meta'), 'Commerciale attivo');
  equal('scelta salvata solo per la sessione', await panel.evaluate(() => chrome.storage.session.get('activeOperator').then((r) => r.activeOperator)), MATTEO.hubspotOwnerId);
  check('«Base giuridica predefinita per i nuovi prospect» dopo la scelta del commerciale', await panel.isVisible('#session-legal'));
  equal('base predefinita: valore', await text('#session-legal-value'), 'Legitimate interest – prospect/lead');
  includes('base predefinita: casella', await text('#session-legal'), 'Usa questa base giuridica per i nuovi contatti prospect in questa sessione');
  check('base predefinita: non attiva finché il commerciale non la conferma', !(await panel.isChecked('#session-legal-basis')));
  await panel.locator('#session-legal').screenshot({ path: path.join(OUT, '0b-base-giuridica-sessione.png') });

  // ---------------------------------------------------------------------------------------------
  console.log('\nAgria Commercial: Home, navigazione, Outreach, Navigatore');
  const shown = (id) => panel.isVisible(`#view-${id}`);
  const noHorizontalScroll = () => panel.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  check('dopo la scelta del commerciale: la Home', await shown('home') && !(await shown('scout')) && !(await shown('outreach')));
  check('navigazione visibile', await panel.isVisible('#module-nav'));
  equal('voci della navigazione', JSON.stringify(await panel.$$eval('#module-nav .nav-item', (b) => b.map((x) => x.textContent.replace('↗', '').trim()))), JSON.stringify(['Home', 'Scout', 'Outreach', 'Navigatore']));
  equal('Home: voce attiva', await panel.getAttribute('#nav-home', 'aria-current'), 'page');
  includes('commerciale attivo sempre visibile', (await text('#active-user')).replace(/\s+/g, ' '), 'Commerciale attivo: Matteo Garuzzo · Cambia');
  for (const part of ['Prossimo passo', 'Analizza un nuovo prospect', "Apri il sito dell'azienda e avvia la scansione in Scout."]) includes(`prossimo passo: ${part}`, await text('#next-step'), part);
  equal('prossimo passo: azione', (await text('#next-step-action')).trim(), 'Apri Scout');
  const modules = await panel.$$eval('#view-home .module-card', (cards) => cards.map((c) => c.innerText.replace(/\s+/g, ' ').trim()));
  for (const [i, parts] of [
    [0, ['SCOUT', 'Trova, analizza e registra nuovi prospect.', 'Apri Scout']],
    [1, ['OUTREACH', 'Gestisci primo contatto e follow-up.', 'Apri Outreach']],
    [2, ['NAVIGATORE', 'Guida operativa durante le chiamate commerciali.', 'Apri Navigatore', 'Si apre in una nuova scheda.']],
  ]) for (const part of parts) includes(`modulo ${i + 1}: ${part}`, modules[i], part);
  check('Outreach attivo dalla Home', await panel.isEnabled('#home-outreach'));
  check('Home: una sola azione primaria', (await panel.$$eval('#view-home .btn.primary', (b) => b.filter((x) => x.offsetParent).length)) === 1);
  check('Home: nessuno scroll orizzontale (400 px)', await noHorizontalScroll());
  await panel.setViewportSize({ width: 320, height: 900 });
  check('Home: nessuno scroll orizzontale (320 px)', await noHorizontalScroll());
  await panel.setViewportSize({ width: 400, height: 900 });
  await shot('9-home');
  await panel.locator('header').screenshot({ path: path.join(OUT, '9b-navigazione.png') });
  // tastiera: Invio e Spazio sulle voci, Tab fra le voci, focus visibile
  await panel.focus('#nav-outreach');
  await panel.keyboard.press('Enter');
  check('tastiera (Invio): Outreach', await shown('outreach') && !(await shown('home')));
  await panel.waitForSelector('#outreach-empty');
  equal('Outreach senza prospect', (await text('#outreach-empty')).trim(), 'Nessun prospect pronto per il primo contatto.');
  equal('Outreach senza prospect: «Vai a Scout»', (await text('#outreach-to-scout')).trim(), 'Vai a Scout');
  check('Outreach senza prospect: niente da confermare', !(await panel.$('#outreach-confirm')) && !(await panel.$('#outreach-sent')));
  check('Outreach: nessuno scroll orizzontale', await noHorizontalScroll());
  await panel.locator('#view-outreach').screenshot({ path: path.join(OUT, '9c-outreach.png') });
  await panel.focus('#nav-home');
  await panel.keyboard.press('Space');
  check('tastiera (Spazio): Home', await shown('home'));
  await panel.keyboard.press('Tab');
  equal('tastiera (Tab): voce successiva', await panel.evaluate(() => document.activeElement?.id), 'nav-scout');
  check('focus visibile sulla voce', await panel.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'));
  // il Navigatore: nuova scheda ampia, file verificato, comportamento invariato
  const [navigator] = await Promise.all([context.waitForEvent('page'), panel.click('#home-open-navigator')]);
  watch(navigator, 'navigatore');
  await navigator.waitForLoadState('load');
  check('Navigatore: nuova scheda dell\'estensione', navigator.url().endsWith('/modules/navigator/app/navigatore.html'), navigator.url());
  equal('Navigatore: titolo', await navigator.title(), 'Navigatore Chiamata Agria');
  await navigator.setViewportSize({ width: 1280, height: 900 });
  await navigator.waitForFunction(() => document.body.innerText.includes('Prima di chiamare'));
  for (const part of ['Navigatore chiamata', 'Preparazione', 'Prima di chiamare', 'Inizia la chiamata']) includes(`Navigatore: ${part}`, await navigator.evaluate(() => document.body.innerText), part);
  check('Navigatore: contenuti caricati', await navigator.evaluate(() => Array.isArray(window.AGRIA?.phases) || typeof window.AGRIA?.nodes === 'object'));
  await navigator.evaluate(() => localStorage.setItem('agria-e2e-prova', 'ok'));
  await navigator.reload();
  equal('Navigatore: i dati restano nel browser (localStorage)', await navigator.evaluate(() => localStorage.getItem('agria-e2e-prova')), 'ok');
  await navigator.evaluate(() => localStorage.removeItem('agria-e2e-prova'));
  await navigator.screenshot({ path: path.join(OUT, '9d-navigatore.png') });
  await navigator.close();
  await panel.bringToFront();
  check('dopo il Navigatore il pannello resta dov\'era', await shown('home'));
  const [byNav] = await Promise.all([context.waitForEvent('page'), panel.click('#nav-navigator')]);
  check('anche dalla navigazione', byNav.url().endsWith('/modules/navigator/app/navigatore.html'));
  await byNav.close();
  await panel.bringToFront();
  await panel.focus('#next-step-action');
  await panel.keyboard.press('Enter');
  check('«Apri Scout» (prossimo passo): Scout', await shown('scout') && !(await shown('home')));
  equal('Scout: voce attiva', await panel.getAttribute('#nav-scout', 'aria-current'), 'page');
  equal('Scout: il focus passa al modulo', await panel.evaluate(() => document.activeElement?.id), 'scout-title');
  equal('commerciale attivo coerente con il proprietario', await text('#company-hubspot_owner_id'), ownerText(MATTEO));
  check('Scout: nessuno scroll orizzontale', await noHorizontalScroll());
  check('nulla nelle impostazioni permanenti', !JSON.stringify(await panel.evaluate(() => chrome.storage.local.get(null))).includes(MATTEO.hubspotOwnerId));

  console.log('\nImpostazioni: commerciali disponibili, limite pagine, salvataggio automatico');
  const options = await context.newPage();
  watch(options, 'impostazioni');
  await options.goto(`chrome-extension://${extId}/options/options.html`);
  await options.waitForFunction(() => document.querySelector('input[name="mockScenario"]:checked'));
  equal('limite pagine predefinito', await options.inputValue('#max-pages'), '30');
  includes('salvataggio automatico dichiarato', await options.textContent('#autosave'), 'Impostazioni salvate automaticamente');
  equal('pulsante per tornare al pannello', (await options.textContent('#back')).trim(), '← Torna ad Agria Commercial');
  includes('sezione «Commerciali disponibili»', await options.textContent('#operators-title'), 'Commerciali disponibili');
  await options.waitForFunction(() => document.querySelector('#operators .chip'));
  const operatorRows = await options.$$eval('#operators li', (li) => li.map((x) => x.textContent));
  equal('commerciali disponibili: nome, Owner ID ed email (dal registro)', JSON.stringify(operatorRows.map((r) => r.replace('attivo ora', ''))),
    JSON.stringify(OPERATORS.map((o) => `${o.name}Owner ID ${o.hubspotOwnerId}${o.email}`)));
  check('commerciale attivo segnato', operatorRows[0].endsWith('attivo ora') && !operatorRows[1].includes('attivo ora'), JSON.stringify(operatorRows));
  check('nome e Owner ID non più modificabili a mano', !(await options.$('#owner-name')) && !(await options.$('#owner-id')) && !(await options.$('input[name="ownerId"]')));
  const flagShown = (name) => options.waitForFunction((n) => !document.querySelector(`[data-saved-for="${n}"]`).hidden, name, { timeout: 5000 }).then(() => true, () => false);
  const flagGone = (name) => options.waitForFunction((n) => document.querySelector(`[data-saved-for="${n}"]`).hidden, name, { timeout: 8000 }).then(() => true, () => false);
  await options.fill('#max-pages', '500');
  await options.waitForFunction(() => document.querySelector('#saved').textContent.includes('da 5 a 100'), null, { timeout: 5000 }).catch(() => {});
  includes('limite fuori intervallo rifiutato', await options.textContent('#saved'), 'Scegli un numero da 5 a 100');
  check('valore sbagliato: nessun «✓ Salvato»', await options.$eval('[data-saved-for="maxPages"]', (f) => f.hidden));
  // si scrive e basta, senza uscire dal campo: il salvataggio parte da solo
  await options.fill('#max-pages', '35');
  check('limite pagine: «✓ Salvato» mentre si scrive', await flagShown('maxPages'));
  equal('testo della conferma', (await options.textContent('[data-saved-for="maxPages"]')).trim(), '✓ Salvato');
  equal('errore precedente tolto', (await options.textContent('#saved')).trim(), '');
  await options.screenshot({ path: path.join(OUT, '6-impostazioni.png'), fullPage: true });
  check('«✓ Salvato» sparisce dopo qualche secondo', await flagGone('maxPages'));
  equal('limite salvato', await panel.evaluate(() => chrome.storage.local.get('config').then((r) => r.config.scan.maxPages)), 35);

  console.log('\nPagina che non è un sito web');
  let r = await analyze(panel);
  equal('stato di errore', r.state, 'error');
  includes('messaggio chiaro', r.text, 'non è un sito web');

  console.log('\nAnalisi della sola pagina aperta (home con JSON-LD)');
  const home = await openTab(site('agriturismo-lamora.test', '/'));
  const htmlBefore = await home.content();
  await watchMutations(home);
  r = await analyze(home);
  equal('analisi completata', r.state, 'ok');
  equal('nome azienda', await value('company-name'), 'Agriturismo La Mora');
  equal('sito web', await value('company-website'), site('agriturismo-lamora.test', ''));
  equal('dominio', await value('company-domain'), 'agriturismo-lamora.test');
  equal('email aziendale principale (non PEC, non agenzia)', await value('company-email_aziendale_principale'), 'info@agriturismo-lamora.test');
  equal('telefono (non fax)', await value('company-phone'), '+39 0758123456');
  equal('città', await value('company-city'), 'Assisi');
  equal('regione (state)', await value('company-state'), 'Umbria');
  equal('paese: non proposto per un prospect italiano', await value('company-country'), '');
  check('paese: campo non mostrato per un prospect italiano', await panel.isHidden('#company-country-field'));
  equal('lead status: etichetta, non il codice tecnico', (await text('#company-hs_lead_status')).trim(), 'Da contattare');
  check('etichette dei campi senza nomi tecnici HubSpot', !(await text('label[for="company-hs_lead_status"]')).includes('hs_lead_status'));
  includes('fonte e affidabilità mostrate', await text('#company-name-meta'), 'Alta affidabilità');
  equal('nessun contatto inventato', await value('contact-firstname'), '');
  includes('avviso sul JSON-LD rotto', await text('#status-notes'), 'dati strutturati non era leggibile');
  equal('nessuna modifica al DOM della pagina', await home.evaluate(() => window.__agriaMutations), 0);
  check('HTML della pagina identico', (await home.content()) === htmlBefore);
  check('nessun download: la pagina aperta si legge dal browser', !requests.some((q) => q.scan));

  console.log('\nCorrezione a mano');
  await panel.fill('#company-city', 'Santa Maria degli Angeli');
  includes('campo segnato come modificato', await text('#company-city-meta'), 'Modificato a mano');
  const website = await value('company-website');
  await panel.fill('#company-website', 'non è un indirizzo');
  await panel.$eval('#company-website', (i) => i.blur());
  includes('avviso su indirizzo non valido', await text('#company-website-meta'), 'Indirizzo web non valido');
  await panel.fill('#company-website', website);

  console.log('\nScansione approfondita dello stesso sito');
  const before = requests.length;
  r = await deepScan(home);
  const scan = requests.slice(before);
  equal('scansione completata', r.state, 'ok');
  includes('esito', r.text, 'Scansione completata');
  check('avanzamento «Analisi pagina N di M»', r.seen.some((t) => /^Analisi pagina \d+ di \d+…$/.test(t)), JSON.stringify(r.seen));
  check('lettura della sitemap', scan.some((q) => q.path === '/sitemap.xml'));
  const summary = await text('#summary');
  check('riepilogo «N pagine · N email · N telefoni · N WhatsApp · N persone»', /^\d+ pagine · \d+ email · \d+ telefon[oi] · \d+ WhatsApp · \d+ person[ae]$/.test(summary), summary);
  includes('pagine analizzate', summary, '10 pagine');
  includes('persone', summary, '3 persone');
  includes('WhatsApp', summary, '2 WhatsApp');
  check('mai fuori dal dominio del prospect', !requests.some((q) => q.host === 'altro-sito.test'));
  const scanned = scan.filter((q) => q.scan && q.host === 'agriturismo-lamora.test').map((q) => q.path);
  // l'ordine esatto: sitemap, poi le pagine per priorità (Contatti, Dove siamo, Chi siamo, Privacy…),
  // le pagine rotte e il file non HTML, infine al massimo 3 pagine del blog
  equal('pagine scaricate e loro ordine', JSON.stringify(scanned), JSON.stringify([
    '/sitemap.xml', '/contatti', '/dove-siamo', '/chi-siamo', '/privacy', '/camere', '/cookie-policy',
    '/listino', '/pagina-rotta', '/blog/', '/blog/vendemmia-2025', '/blog/raccolta-olive',
  ]));
  check('nessuna pagina scaricata due volte', scanned.length > 0 && new Set(scanned).size === scanned.length, JSON.stringify(scanned));
  check('la pagina aperta non si riscarica', scanned.length > 0 && !scanned.includes('/'));
  check('pagina presente solo nella sitemap', scanned.includes('/dove-siamo'));
  check('blog: al massimo 3 pagine', scanned.filter((p) => p.startsWith('/blog/')).length === 3, JSON.stringify(scanned));
  check('solo GET e nessun cookie', scan.length > 0 && scan.every((q) => q.method === 'GET' && !q.cookie));
  const pagesText = await text('#pages-list');
  includes('pagina rotta segnalata', pagesText, 'Errore HTTP 404');
  includes('file non HTML segnalato', pagesText, 'Non è una pagina web');
  includes('pagine non raggiungibili nel titolo', await text('#pages-title'), '2 non raggiungibili');
  equal('nessuna modifica al DOM durante la scansione', await home.evaluate(() => window.__agriaMutations), 0);

  console.log('\nForm Azienda (HubSpot) dopo la scansione');
  const nameAlternatives = await text('#company-name-field .alts');
  check('i titoli degli articoli non diventano nomi', !/vendemmia|raccolta/i.test(nameAlternatives), nameAlternatives);
  check('ragione sociale non proposta come nome', !nameAlternatives.includes('S.r.l.'), nameAlternatives);
  equal('correzione a mano conservata', await value('company-city'), 'Santa Maria degli Angeli');
  equal('email principale', await value('company-email_aziendale_principale'), 'info@agriturismo-lamora.test');
  equal('email secondaria', await value('company-email_aziendale_secondaria'), 'prenotazioni@agriturismo-lamora.test');
  const altEmails = await text('#company-email_aziendale_principale-field .alts');
  includes('tutte le email selezionabili (PEC)', altEmails, 'lamora@pec.agriturismo-lamora.test');
  includes('tutte le email selezionabili (eventi)', altEmails, 'eventi@agriturismo-lamora.test');
  equal('settore Agria', await value('company-settore_agria'), 'Hospitality');
  includes('settore da verificare', await text('#company-settore_agria-meta'), 'Da verificare');
  equal('tipo struttura', await value('company-tipo_struttura_hospitality'), 'Agriturismo');
  check('tipo struttura visibile per Hospitality', await panel.isVisible('#company-tipo_struttura_hospitality-field'));
  equal('regione', await value('company-state'), 'Umbria');
  equal('pagina LinkedIn aziendale', await value('company-linkedin_company_page'), 'https://www.linkedin.com/company/agriturismo-la-mora');
  const quick = await value('company-hs_quick_context');
  for (const part of [
    'WHATSAPP\n', '+39 347 111 2223', 'P.IVA\n01234567897', 'POTENZIALI CONTATTI\n', 'Paolo — Host (cognome non trovato)',
    'ALTRI CANALI\n', 'Instagram: https://www.instagram.com/lamora.agriturismo/', 'PEC: lamora@pec.agriturismo-lamora.test',
    'ALTRE INFORMAZIONI COMMERCIALI UTILI\n', 'Booking engine: Octorate', 'Portale: Booking.com',
  ]) includes(`contesto rapido: ${part.trim().replace('\n', ' ')}`, quick, part);
  check('contesto rapido: sezioni nell\'ordine concordato', /^WHATSAPP\n[\s\S]*\n\nP\.IVA\n[\s\S]*\n\nPOTENZIALI CONTATTI\n[\s\S]*\n\nALTRI CANALI\n[\s\S]*\n\nALTRE INFORMAZIONI COMMERCIALI UTILI\n/.test(quick), quick);
  check('contesto rapido senza le email già nei campi', !quick.includes('info@agriturismo-lamora.test') && !quick.includes('prenotazioni@'));
  for (const legal of ['Ragione sociale', 'Società Agricola', 'PG-123456', 'IT054001C2ABCDEFGH', 'M5UXCR1', 'Sede legale', 'WordPress']) {
    check(`contesto rapido senza dati societari: ${legal}`, !quick.includes(legal));
  }
  check('fonte cliccabile', await panel.$$eval('#company-email_aziendale_principale-meta a.src', (a) => a.length > 0 && a[0].href.startsWith('http://agriturismo-lamora.test')));
  equal('dopo la scansione l\'azione primaria è la verifica', (await panel.$$eval('#view-scout .btn.primary', (b) => b.filter((x) => x.offsetParent).map((x) => x.id))).join(), 'verify');

  console.log('\nHome durante il lavoro: prossimo passo e ritorno a Scout senza perdere dati');
  await panel.click('#nav-home');
  includes('prossimo passo dopo la scansione', await text('#next-step'), 'Verifica Agriturismo La Mora in HubSpot');
  await panel.click('#next-step-action');
  check('di nuovo in Scout', await panel.isVisible('#view-scout'));
  equal('correzione a mano ancora lì', await value('company-city'), 'Santa Maria degli Angeli');
  includes('riepilogo ancora lì', await text('#summary'), '10 pagine');
  await panel.evaluate(() => window.scrollTo(0, 0));
  await panel.screenshot({ path: path.join(OUT, '9e-scout.png') });

  console.log('\nContatto (HubSpot) e persone rilevate');
  equal('contatto: nome', await value('contact-firstname'), 'Maria');
  equal('contatto: cognome', await value('contact-lastname'), 'Bianchi');
  equal('contatto: qualifica (jobtitle)', await value('contact-jobtitle'), 'Titolare');
  includes('etichetta «Qualifica»', await text('label[for="contact-jobtitle"]'), 'Qualifica');
  equal('contatto: email', await value('contact-email'), 'maria.bianchi@agriturismo-lamora.test');
  equal('contatto: cellulare', await value('contact-mobilephone'), '+39 333 123 4567');
  equal('contatto: LinkedIn', await value('contact-hs_linkedin_url'), 'https://www.linkedin.com/in/maria-bianchi-lamora');
  includes('contatto completo', await text('#contact-ready'), 'Contatto completo');
  check('contatto valido: base giuridica visibile', await panel.isVisible('#contact-hs_legal_basis-field'));
  equal('base giuridica suggerita', await value('contact-hs_legal_basis'), 'Legitimate interest – prospect/lead');
  check('base giuridica non confermata in automatico', !(await panel.isChecked('#legal-basis-confirm')));
  await panel.check('#legal-basis-confirm');
  includes('base giuridica confermata', await text('#contact-hs_legal_basis-meta'), 'Confermata');
  const people = await text('#people-list');
  const paoloCard = await panel.evaluate(() => [...document.querySelectorAll('#people-list .person')].find((c) => c.querySelector('.n').textContent === 'Paolo — Host')?.innerText || '');
  check('persona parziale mostrata come «Paolo — Host»', Boolean(paoloCard), people);
  includes('persona parziale: etichetta', paoloCard, 'Persona parziale');
  includes('persona parziale: cognome non trovato', paoloCard, 'Cognome non trovato');
  includes('persona parziale: fonte', paoloCard, 'Fonte: chi-siamo');
  includes('altra persona', people, 'Giulia Rossi — Chef');
  includes('persona senza recapiti non diventa Contatto', people, 'Non utilizzabile come Contatto HubSpot');
  check("l'autore di un articolo non è una persona rilevata", !people.includes('Paolo Neri'));
  const allData = await text('#all-data');
  for (const part of ['PEC', '01234567897', 'PG-123456', 'IT054001C2ABCDEFGH', 'Instagram', 'Octorate', 'sede legale', 'cellulare', 'aziendale generica', 'persona parziale']) includes(`tutti i dati rilevati: ${part}`, allData, part);
  check('nessun profilo social da pulsanti «condividi»', !allData.includes('sharer'));
  check('tutti i dati rilevati: sezione chiusa all\'inizio', !(await panel.$eval('#all-data-box', (d) => d.open)));
  const groupOrder = await panel.$$eval('#all-data > .group > summary', (s) => s.map((x) => x.firstChild.textContent.trim()));
  equal('tutti i dati rilevati: ordine dei gruppi', JSON.stringify(groupOrder), JSON.stringify([
    'Email', 'Telefoni', 'WhatsApp', 'Persone', 'Indirizzi', 'Social', 'P.IVA', 'Fax', 'Nomi commerciali', 'Profili LinkedIn personali',
    'Sistemi esterni', 'Dati legali (non usati in HubSpot)',
  ]));
  check('dati legali in fondo e chiusi', await panel.$eval('#all-data > .group.legal', (d) => !d.open && d === d.parentElement.lastElementChild));
  await panel.$eval('#all-data-box', (d) => { d.open = true; });
  await shot('1-scansione-approfondita');
  await panel.bringToFront();
  for (const [i, selector] of ['#status', 'section:has(#company-fields)', 'section:has(#contact-fields)', 'section:has(#people-list)', 'section:has(#all-data)'].entries()) {
    await panel.locator(selector).screenshot({ path: path.join(OUT, `1${String.fromCharCode(97 + i)}-sezione.png`) });
  }

  console.log('\nScelta del Contatto principale');
  // clic sul pulsante della scheda il cui nome inizia così (l'elenco si ridisegna dopo ogni scelta)
  const usePersonCard = (name) => panel.evaluate((n) => {
    const card = [...document.querySelectorAll('#people-list .person')].find((c) => c.querySelector('.n').textContent.startsWith(n));
    const button = card?.querySelector('button');
    button?.click();
    return Boolean(button);
  }, name);
  check('pulsante «Usa come contatto»', await usePersonCard('Giulia Rossi'));
  equal('nuovo contatto', `${await value('contact-firstname')} ${await value('contact-lastname')}`, 'Giulia Rossi');
  includes('contatto incompleto segnalato', await text('#contact-ready'), 'manca email, telefono o LinkedIn');
  check('contatto non valido: base giuridica nascosta', await panel.isHidden('#contact-hs_legal_basis-field'));
  await usePersonCard('Maria Bianchi');
  equal('di nuovo Maria', await value('contact-firstname'), 'Maria');
  check('di nuovo valido: base giuridica visibile', await panel.isVisible('#contact-hs_legal_basis-field'));
  check('cambio di persona: base giuridica da confermare di nuovo', !(await panel.isChecked('#legal-basis-confirm')));

  console.log('\nCambio commerciale durante la sessione');
  await panel.click('#change-operator');
  check('«Cambia» riapre la scelta', await panel.isVisible('#operator-picker'));
  check('«Annulla» disponibile', await panel.isVisible('#operator-cancel'));
  equal('commerciale attuale segnato', await panel.getAttribute(`#operator-list .operator[data-owner-id="${MATTEO.hubspotOwnerId}"]`, 'aria-current'), 'true');
  await panel.click('#operator-cancel');
  check('«Annulla»: si torna al pannello', await panel.isVisible('#app'));
  equal('«Annulla»: commerciale invariato', await text('#active-name'), MATTEO.name);
  await panel.click('#change-operator');
  await panel.click(`#operator-list .operator[data-owner-id="${ALESSANDRO.hubspotOwnerId}"]`);
  equal('nuovo commerciale attivo', (await text('#active-user')).replace(/\s+/g, ' ').trim(), 'Commerciale attivo: Alessandro Poponi · Cambia');
  equal('owner Azienda aggiornato subito', await text('#company-hubspot_owner_id'), ownerText(ALESSANDRO));
  equal('owner Contatto aggiornato subito', await text('#contact-hubspot_owner_id'), ownerText(ALESSANDRO));
  equal('prospect invariato: nome', await value('company-name'), 'Agriturismo La Mora');
  equal('prospect invariato: correzione a mano', await value('company-city'), 'Santa Maria degli Angeli');
  equal('prospect invariato: contatto', `${await value('contact-firstname')} ${await value('contact-lastname')}`, 'Maria Bianchi');
  await options.waitForFunction((name) => document.querySelector('#operators li .chip')?.parentElement.textContent.startsWith(name), ALESSANDRO.name, { timeout: 5000 }).catch(() => {});
  includes('Impostazioni: commerciale attivo aggiornato', await options.$eval('#operators li:has(.chip)', (li) => li.textContent), ALESSANDRO.name);
  check('l\'owner non è nella bozza salvata', !JSON.stringify(await panel.evaluate(() => chrome.storage.session.get('draft'))).includes('hubspot_owner_id'));

  console.log('\nVerifica HubSpot (MOCK)');
  // Outreach: lettura di HubSpot finita (stato mostrato) per la vista aperta
  const waitRead = () => panel.waitForFunction(() => {
    const s = document.querySelector('#outreach-status')?.textContent || '';
    return !document.querySelector('#view-outreach').hidden && s !== '' && s !== 'Lettura da HubSpot…' && s !== '—';
  }, null, { timeout: 15000 });
  const primaries = (view) => panel.$$eval(`#view-${view} .btn.primary`, (b) => b.filter((x) => x.offsetParent).map((x) => x.id));
  // Outreach in due passi (Patch 0.4.1): «Ho inviato l'email» → verifica → casella → conferma finale
  const sendAndConfirm = async () => {
    await panel.click('#outreach-sent');
    await panel.waitForSelector('#outreach-verify');
    await panel.check('#outreach-sent-check');
    await panel.click('#outreach-confirm');
  };
  const outreachButtons = () => panel.$$eval('#outreach-body button', (b) => b.map((x) => x.id).filter(Boolean));
  let v = await verify();
  check('pulsante disattivato durante la verifica (niente doppio invio)', v.disabled);
  equal('scenario "non presente"', v.kind, 'not_found');
  includes('esito "non presente"', v.text, '✓ Non presente in HubSpot');
  includes('esito dichiarato come simulato', v.text, 'MOCK');
  check('MOCK: anteprima e «Crea Azienda in HubSpot» (simulata)', await panel.isVisible('#create-company') && (await text('#company-step')).includes('Da contattare'));
  check('anteprima senza codici tecnici', !(await text('#company-step')).includes('hs_lead_status') && !(await text('#company-step')).includes('(NEW)'));
  check('una sola azione primaria: «Crea Azienda»', (await panel.$$eval('#view-scout .btn.primary', (b) => b.filter((x) => x.offsetParent).map((x) => x.id))).join() === 'create-company');
  const hint = (t) => panel.waitForFunction((x) => document.querySelector('#hubspot-hint').textContent.includes(x), t);
  await options.check('input[value="found"]');
  await hint('Azienda già presente');
  v = await verify();
  equal('scenario "già presente"', v.kind, 'found');
  check('azienda simulata con il dominio', v.text.includes('agriturismo-lamora.test') && v.text.includes('MOCK-1001'), v.text);
  check('già presente: nessuna creazione possibile', await panel.isHidden('#company-step'));
  // MOCK: anche Outreach è simulato, nessuna richiesta a HubSpot
  await panel.waitForSelector('#scout-next-step-action');
  includes('Scout → Outreach: «Vai al primo contatto»', await text('#scout-next-step'), 'Vai al primo contatto');
  await panel.click('#scout-next-step-action');
  await waitRead();
  // Patch 0.4.1: prima email aziendale pronta in Gmail, con il commerciale attivo (registro dei commerciali)
  check('contatore visibile in Outreach', await panel.isVisible('#daily-counter'));
  const countBeforeMock = (await text('#daily-count')).trim();
  includes('Invia da: commerciale attivo', await text('#outreach-from'), `${ALESSANDRO.name} · ${ALESSANDRO.email}`);
  check('nessuna scelta Azienda/Contatto: la prima email è dell\'Azienda', !(await panel.$('#outreach-recipient')));
  const subjectMock = (await text('#outreach-subject')).trim();
  check('oggetto con il nome dell\'Azienda', /^Gestione digitale e crescita commerciale per \S/.test(subjectMock) && !subjectMock.includes('{{'), subjectMock);
  check('anteprima del testo richiusa all\'inizio', !(await panel.$eval('#outreach-text', (d) => d.open)));
  await panel.click('#outreach-text summary');
  const bodyMock = await text('#outreach-text-body');
  includes('testo: nome del commerciale attivo', bodyMock, `sono ${ALESSANDRO.name} di Agria System.`);
  check('testo: finisce con «Un cordiale saluto,»', bodyMock.trimEnd().endsWith('Un cordiale saluto,'), bodyMock.slice(-60));
  equal('prima di Gmail: azione primaria «Apri email pronta in Gmail»', (await primaries('outreach')).join(), 'outreach-gmail');
  check("prima di Gmail: «Ho inviato l'email» non è l'azione primaria", await panel.$eval('#outreach-sent', (b) => !b.classList.contains('primary')));
  const openGmail = async () => {
    const before = gmailOpened.length;
    const [tab] = await Promise.all([context.waitForEvent('page'), panel.click('#outreach-gmail')]);
    await tab.waitForLoadState('domcontentloaded').catch(() => {});
    for (let i = 0; i < 50 && gmailOpened.length === before; i += 1) await new Promise((r) => setTimeout(r, 100));
    const url = gmailOpened.at(-1) || tab.url();
    await tab.close();
    await panel.bringToFront();
    return new URL(url);
  };
  let gmailUrl = await openGmail();
  equal('Gmail: indirizzo di composizione', `${gmailUrl.origin}${gmailUrl.pathname}`, 'https://mail.google.com/mail/');
  equal('Gmail: account = commerciale attivo (authuser)', gmailUrl.searchParams.get('authuser'), ALESSANDRO.email);
  equal('Gmail: A', gmailUrl.searchParams.get('to'), (await text('#outreach-recipients .rcpt-to')).trim());
  equal('Gmail: oggetto', gmailUrl.searchParams.get('su'), subjectMock);
  equal('Gmail: testo identico all\'anteprima', gmailUrl.searchParams.get('body'), bodyMock);
  check('Gmail: il pannello resta aperto', !panel.isClosed());
  equal('dopo Gmail: «Ho inviato l\'email» diventa l\'azione primaria', (await primaries('outreach')).join(), 'outreach-sent');
  includes('dopo Gmail: istruzione', await text('#outreach-after-gmail'), 'Dopo averla inviata da Gmail, torna qui.');
  check('nessuna dichiarazione che l\'email sia partita', !/inviata con successo|è stata inviata|email inviata|Gmail ha inviato/i.test(await text('#outreach-body')));
  equal('apertura di Gmail: contatore invariato', (await text('#daily-count')).trim(), countBeforeMock);
  // cambio commerciale: nome nel testo, mittente atteso e account Gmail cambiano subito
  const switchOperator = async (o) => {
    await panel.click('#change-operator');
    await panel.click(`#operator-list .operator[data-owner-id="${o.hubspotOwnerId}"]`);
    await panel.waitForFunction((name) => document.querySelector('#outreach-from')?.textContent.startsWith(name), o.name, { timeout: 5000 });
  };
  await switchOperator(MATTEO);
  includes('cambio commerciale: Invia da', await text('#outreach-from'), `${MATTEO.name} · ${MATTEO.email}`);
  equal('cambio commerciale: Gmail di nuovo azione primaria (non l\'ha ancora aperto Matteo)', (await primaries('outreach')).join(), 'outreach-gmail');
  await panel.click('#outreach-text summary');
  includes('cambio commerciale: testo', await text('#outreach-text-body'), `sono ${MATTEO.name} di Agria System.`);
  gmailUrl = await openGmail();
  equal('cambio commerciale: account Gmail', gmailUrl.searchParams.get('authuser'), MATTEO.email);
  includes('cambio commerciale: testo in Gmail', gmailUrl.searchParams.get('body'), `sono ${MATTEO.name} di Agria System.`);
  await switchOperator(ALESSANDRO);
  includes('di nuovo Alessandro: Invia da', await text('#outreach-from'), `${ALESSANDRO.name} · ${ALESSANDRO.email}`);
  equal('MOCK + Gmail: nessuna richiesta a HubSpot', fake.state.requests.length, 0);
  await sendAndConfirm();
  await panel.waitForSelector('#outreach-follow-up', { timeout: 15000 });
  const mockOutreach = await text('#outreach-body');
  equal('MOCK: il contatore non cambia (niente è registrato davvero)', (await text('#daily-count')).trim(), countBeforeMock);
  includes('MOCK: primo contatto simulato', mockOutreach, 'Primo contatto registrato');
  includes('MOCK: follow-up simulato', mockOutreach, 'Follow-up programmato');
  includes('MOCK: dichiarato', mockOutreach, 'Simulazione (MOCK)');
  equal('MOCK: nessuna richiesta a HubSpot', fake.state.requests.length, 0);
  await panel.click('#nav-scout');
  await options.check('input[value="error"]');
  await hint('Errore HubSpot');
  v = await verify();
  equal('scenario "errore"', v.kind, 'error');
  includes('messaggio di errore chiaro', v.text, 'Errore simulato');
  await options.check('input[value="not_found"]');
  await hint('Azienda non presente');
  check('impostazioni: HubSpot reale ora selezionabile', await options.isEnabled('input[name="mode"][value="real"]'));
  await panel.fill('#company-domain', 'dominio non valido');
  v = await verify();
  equal('dominio non valido: niente verifica', v.kind, 'warn');
  includes('dominio non valido: spiegato', v.text, 'Il dominio non è valido');
  await panel.fill('#company-domain', 'agriturismo-lamora.test');

  console.log('\nAnnullamento della scansione');
  const pagesBefore = await text('#summary');
  await home.bringToFront();
  await press('#deep-scan');
  await panel.waitForFunction(() => /Analisi pagina [2-9]/.test(document.querySelector('#status-text').textContent), null, { timeout: 20000 });
  equal('il pulsante diventa «Annulla scansione»', (await text('#deep-scan')).trim(), 'Annulla scansione');
  check('altre azioni bloccate durante la scansione', await panel.$eval('#analyze', (b) => b.disabled));
  await press('#deep-scan');
  await waitIdle();
  includes('scansione annullata', await text('#status-text'), 'Scansione annullata');
  equal('dati raccolti conservati', await text('#summary'), pagesBefore);
  equal('pulsante di nuovo disponibile', (await text('#deep-scan')).trim(), 'Scansione approfondita');

  console.log('\nNuovo prospect (altro sito, senza JSON-LD)');
  const cantina = await openTab(site('cantinarossi.test', '/contatti'));
  await watchMutations(cantina);
  r = await deepScan(cantina);
  equal('scansione completata', r.state, 'ok');
  equal('nome dal titolo', await value('company-name'), 'Cantina Rossi');
  equal('dominio', await value('company-domain'), 'cantinarossi.test');
  equal('correzioni del prospect precedente rimosse', await value('company-city'), 'Foligno');
  equal('email', await value('company-email_aziendale_principale'), 'info@cantinarossi.test');
  equal('telefono', await value('company-phone'), '+39 0742123456');
  equal('regione', await value('company-state'), 'Umbria');
  equal('settore Agria', await value('company-settore_agria'), 'Cantina / Vitivinicolo');
  check('tipo struttura nascosto fuori dall\'Hospitality', await panel.isHidden('#company-tipo_struttura_hospitality-field'));
  equal('contatto: titolare', `${await value('contact-firstname')} ${await value('contact-lastname')} · ${await value('contact-jobtitle')}`, 'Mario Rossi · Titolare');
  equal('contatto: email', await value('contact-email'), 'mario.rossi@cantinarossi.test');
  equal('contatto: LinkedIn', await value('contact-hs_linkedin_url'), 'https://www.linkedin.com/in/mario-rossi-vino');
  check('base giuridica da confermare di nuovo', !(await panel.isChecked('#legal-basis-confirm')));
  includes('altra persona proposta', await text('#people-list'), 'Luca Verdi');
  check('verifica precedente azzerata', await panel.isHidden('#verify-result'));
  equal('nessuna modifica al DOM della cantina', await cantina.evaluate(() => window.__agriaMutations), 0);
  await shot('2-nuovo-prospect');

  console.log('\nRiapertura del pannello');
  await panel.reload();
  await panel.waitForFunction(() => document.querySelector('#status').dataset.state === 'ok');
  check('commerciale ancora attivo: nessuna nuova scelta', await panel.isVisible('#app') && await panel.isHidden('#operator-picker'));
  equal('commerciale ripreso', await text('#active-name'), ALESSANDRO.name);
  equal('owner ripreso', await text('#company-hubspot_owner_id'), ownerText(ALESSANDRO));
  equal('dati ripresi', await value('company-name'), 'Cantina Rossi');
  equal('contatto ripreso', await value('contact-lastname'), 'Rossi');
  includes('riepilogo ripreso', await text('#summary'), 'pagina');

  console.log('\nSvuota');
  await press('#clear');
  equal('primo clic: chiede conferma', (await text('#clear')).trim(), 'Conferma svuota');
  equal('dati ancora presenti', await value('company-name'), 'Cantina Rossi');
  await press('#clear');
  equal('secondo clic: svuotato', await value('company-name'), '');
  equal('stato iniziale', await panel.getAttribute('#status', 'data-state'), 'idle');
  equal('proprietario resta il commerciale attivo', await text('#company-hubspot_owner_id'), ownerText(ALESSANDRO));

  console.log('\nCaso reale La Mora: email attaccata al telefono, host senza cognome');
  const lamora = await openTab(site('lamora-caso.test', '/'));
  r = await deepScan(lamora);
  equal('scansione completata', r.state, 'ok');
  equal('riepilogo', await text('#summary'), '2 pagine · 1 email · 1 telefono · 1 WhatsApp · 1 persona');
  equal('email principale pulita', await value('company-email_aziendale_principale'), 'agriturismolamora@gmail.com');
  equal('nessuna email secondaria inventata', await value('company-email_aziendale_secondaria'), '');
  check('email corrotta scartata ovunque', !(await panel.evaluate(() => document.body.innerText + [...document.querySelectorAll('input, textarea')].map((i) => i.value).join(' '))).includes('4363917agriturismolamora'));
  equal('telefono', await value('company-phone'), '+39 393 436 3917');
  equal('tipo struttura', await value('company-tipo_struttura_hospitality'), 'Agriturismo');
  check('ragione sociale del fornitore non proposta come nome', !(await text('#company-name-field .alts')).includes('Studio Web'));
  equal('contesto rapido La Mora', await value('company-hs_quick_context'), [
    'WHATSAPP', '+39 393 436 3917', '', 'P.IVA', '01234567897', '', 'POTENZIALI CONTATTI', '- Paolo — Host (cognome non trovato)',
  ].join('\n'));
  const lamoraPeople = await text('#people-list');
  for (const part of ['Paolo — Host', 'Persona parziale', 'Cognome non trovato', 'Paolo, host di Agriturismo La Mora']) includes(`persone rilevate: ${part}`, lamoraPeople, part);
  equal('nessun Contatto automatico senza cognome', await value('contact-firstname'), '');
  check('contatto non valido: base giuridica nascosta', await panel.isHidden('#contact-hs_legal_basis-field'));
  includes('fornitore solo tra i dati legali', await panel.$eval('#all-data > .group.legal', (d) => d.textContent), 'Studio Web Esempio S.r.l.');
  await shot('3-caso-la-mora');

  console.log('\nCaso reale Berioli: località da più formati, tre persone, segnali commerciali, pre-flight');
  const berioli = await openTab(site('berioli-caso.test', '/'));
  r = await deepScan(berioli);
  equal('scansione completata', r.state, 'ok');
  includes('tre pagine', await text('#summary'), '3 pagine');
  includes('tre persone', await text('#summary'), '3 persone');
  equal('nome azienda', await value('company-name'), 'Cantina Berioli');
  equal('città', await value('company-city'), 'Magione');
  equal('regione (da «(PG)»)', await value('company-state'), 'Umbria');
  equal('paese: «ITALY» riconosciuto ma non proposto (prospect italiano)', await value('company-country'), '');
  check('paese: campo non mostrato (Berioli)', await panel.isHidden('#company-country-field'));
  equal('telefono azienda', await value('company-phone'), '+39 345 258 6604');
  const cards = await panel.$$eval('#people-list .person', (list) => list.map((c) => c.innerText));
  equal('persone in ordine di rilevanza', JSON.stringify(cards.map((c) => c.split('\n')[0].split(' — ')[0])), JSON.stringify(['Roberto Berioli', 'Giulio Brandelli', 'Irene Rossi']));
  for (const [i, parts] of [
    [0, ['Roberto Berioli — Titolare', 'Contatto suggerito', 'Cell. +39 335 549 8173', 'SEGNALI COMMERCIALI', 'Ruolo decisionale esplicito: Titolare', 'Persona citata in più sezioni del sito']],
    [1, ['Giulio Brandelli — Export, vendite, acquisti, logistica', 'Cell. +39 349 524 1724', 'Ruolo commerciale esplicito: Export, vendite, acquisti, logistica']],
    [2, ['Irene Rossi — Sommelier', 'Cell. +39 345 258 6604', "Numero coincidente con il telefono principale dell'azienda"]],
  ]) for (const part of parts) includes(`scheda ${i + 1}: ${part}`, cards[i], part);
  check('un solo «Contatto suggerito»', cards.filter((c) => c.includes('Contatto suggerito')).length === 1);
  check('nessun punteggio e nessuna deduzione nelle schede', !cards.some((c) => /punteggio|probabil|decision maker|\b(100|110|60|40)\b/i.test(c)), JSON.stringify(cards));
  check('tutte e tre utilizzabili come Contatto', cards.every((c) => !c.includes('Non utilizzabile')));
  equal('contatto proposto: Roberto', `${await value('contact-firstname')} ${await value('contact-lastname')} · ${await value('contact-mobilephone')}`, 'Roberto Berioli · +39 335 549 8173');
  const quickBerioli = await value('company-hs_quick_context');
  includes('contesto rapido: potenziali contatti con i segnali', quickBerioli, [
    'POTENZIALI CONTATTI',
    '- Roberto Berioli — Titolare',
    '  Ruolo decisionale esplicito',
    '- Giulio Brandelli — Export, vendite, acquisti, logistica',
    '  Ruolo commerciale esplicito',
    '- Irene Rossi — Sommelier',
    "  Numero coincidente con il telefono principale dell'azienda",
  ].join('\n'));
  v = await verify();
  equal('verifica (MOCK): non presente', v.kind, 'not_found');
  const berioliPreview = await text('#company-step');
  for (const part of ['Città', 'Magione', 'Regione', 'Umbria']) includes(`anteprima: ${part}`, berioliPreview, part);
  check('anteprima: nessun paese per un prospect italiano', !berioliPreview.includes('Paese') && !berioliPreview.includes('Italia'), berioliPreview);
  check('pre-flight superato: nessun blocco', !(await panel.$('#preflight-error')) && await panel.isEnabled('#create-company'));
  // scelta manuale: Irene, con lo stesso numero dell'azienda
  await usePersonCard('Irene Rossi');
  equal('Irene scelta a mano', `${await value('contact-firstname')} ${await value('contact-lastname')}`, 'Irene Rossi');
  equal('Irene: cellulare', await value('contact-mobilephone'), '+39 345 258 6604');
  equal('azienda: lo stesso numero resta', await value('company-phone'), '+39 345 258 6604');
  r = await deepScan(berioli);
  equal('nuova scansione: Irene resta il Contatto scelto', await value('contact-firstname'), 'Irene');
  includes('il suggerimento resta su Roberto', await panel.$eval('#people-list .person', (c) => c.innerText), 'Contatto suggerito');
  await panel.locator('section:has(#people-list)').screenshot({ path: path.join(OUT, '8-berioli-persone.png') });

  console.log('\nPatch 0.4.1 — La Locanda dei Golosi: CAP + località + (PG), nessun comune scritto');
  const locanda = await openTab(site('lalocandadeigolosi.test', '/'));
  r = await analyze(locanda);
  equal('analisi completata', r.state, 'ok');
  equal('città dal CAP 06134 (non dalla sola sigla PG)', await value('company-city'), 'Perugia');
  includes('città: metodo dichiarato', await text('#company-city-meta'), 'comune dal CAP 06134 (PG); località indicata: Pieve Pagliaccia Bosco');
  equal('regione (state) = Umbria', await value('company-state'), 'Umbria');
  equal('paese non scritto (prospect italiano)', await value('company-country'), '');
  check('Locanda: campo Paese non mostrato perché Italia', await panel.isHidden('#company-country-field'));
  // regione estera scritta a mano: il campo Paese compare; di nuovo una regione italiana: sparisce
  await panel.fill('#company-state', 'Ticino');
  check('regione estera: campo Paese mostrato', await panel.isVisible('#company-country-field'));
  await panel.fill('#company-state', 'Umbria');
  check('regione italiana: campo Paese di nuovo nascosto', await panel.isHidden('#company-country-field'));
  v = await verify();
  const locandaPreview = await text('#company-step');
  for (const part of ['Città', 'Perugia', 'Regione', 'Umbria']) includes(`anteprima Locanda: ${part}`, locandaPreview, part);
  check('anteprima Locanda: «Italia» mai come regione o paese', !locandaPreview.includes('Italia'), locandaPreview);

  console.log('\nPatch 0.4.1 — Il Cantico delle Cicale: nome senza descrittori, ristorante proprio');
  const cicale = await openTab(site('ilcanticodellecicale.test', '/'));
  r = await deepScan(cicale);
  equal('scansione completata', r.state, 'ok');
  equal('nome azienda: «Il Cantico delle Cicale»', await value('company-name'), 'Il Cantico delle Cicale');
  check('«con ristorante» non entra nel nome né nelle alternative', !(await text('#company-name-field')).includes('con ristorante'));
  equal('settore', await value('company-settore_agria'), 'Hospitality');
  equal('tipo struttura: ristorante proprio prima di «Agriturismo»', await value('company-tipo_struttura_hospitality'), 'Struttura con ristorante');
  includes('tipo struttura: prove mostrate', await text('#company-tipo_struttura_hospitality-meta'), '«con ristorante» nel titolo');
  includes('«Agriturismo» a un clic', await text('#company-tipo_struttura_hospitality-field'), 'Agriturismo');
  equal('città', await value('company-city'), 'Perugia');
  equal('regione', await value('company-state'), 'Umbria');
  check('Cicale: campo Paese non mostrato perché Italia', await panel.isHidden('#company-country-field'));
  equal('email principale (non la PEC)', await value('company-email_aziendale_principale'), 'info@ilcanticodellecicale.test');
  await shot('3b-caso-cicale');

  console.log('\nCaso reale Perticaia: alias funzionali, cantina, informativa privacy, contatto inserito a mano');
  const perticaia = await openTab(site('perticaia-caso.test', '/'));
  const beforePerticaia = requests.length;
  r = await deepScan(perticaia);
  equal('scansione completata', r.state, 'ok');
  check('informativa privacy analizzata', requests.slice(beforePerticaia).some((q) => q.scan && q.path === '/privacy-policy'));
  equal('riepilogo: nessuna persona', await text('#summary'), '2 pagine · 2 email · 2 telefoni · 1 WhatsApp · 0 persone');
  equal('email principale', await value('company-email_aziendale_principale'), 'info@perticaia.it');
  equal('email secondaria', await value('company-email_aziendale_secondaria'), 'visit@perticaia.it');
  equal('telefono principale', await value('company-phone'), '+39 0742379014');
  equal('settore', await value('company-settore_agria'), 'Cantina / Vitivinicolo');
  check('tipo struttura nascosto (cantina)', await panel.isHidden('#company-tipo_struttura_hospitality-field'));
  const visitTag = await panel.evaluate(() => [...document.querySelectorAll('#all-data .facts li')].find((li) => li.querySelector('.v')?.textContent === 'visit@perticaia.it')?.textContent || '');
  includes('visit@ classificata come aziendale generica', visitTag, 'aziendale generica');
  includes('nessuna persona da visit@', await text('#people-list'), 'Nessuna persona');
  equal('contesto rapido Perticaia', await value('company-hs_quick_context'), [
    'WHATSAPP', '+39 376 255 3216', '', 'P.IVA', '12345678903', '',
    'ALTRI CANALI', '- Instagram: https://www.instagram.com/perticaia/', '- Facebook: https://www.facebook.com/perticaia',
  ].join('\n'));
  const everything = await panel.evaluate(() => document.body.textContent + [...document.querySelectorAll('input, textarea')].map((i) => i.value).join(' '));
  check('«Modalità Di Trattamento — Titolare» non compare da nessuna parte', !/Modalit[àa] di trattamento/i.test(everything));
  equal('nessun Contatto dall\'informativa', await value('contact-firstname'), '');
  // settore cambiato a mano: il tipo di struttura compare solo per l'Hospitality
  await panel.selectOption('#company-settore_agria', 'Hospitality');
  check('settore Hospitality: tipo struttura di nuovo visibile', await panel.isVisible('#company-tipo_struttura_hospitality-field'));
  await panel.selectOption('#company-settore_agria', 'Cantina / Vitivinicolo');
  check('settore Cantina: tipo struttura di nuovo nascosto', await panel.isHidden('#company-tipo_struttura_hospitality-field'));
  // contatto inserito a mano: la base giuridica compare solo quando è valido
  check('nessun contatto: base giuridica nascosta', await panel.isHidden('#contact-hs_legal_basis-field'));
  await panel.fill('#contact-firstname', 'Anna');
  await panel.fill('#contact-lastname', 'Verdi');
  check('nome e cognome senza recapito: ancora nascosta', await panel.isHidden('#contact-hs_legal_basis-field'));
  await panel.fill('#contact-email', 'anna.verdi@perticaia.it');
  check('contatto valido: base giuridica visibile', await panel.isVisible('#contact-hs_legal_basis-field'));
  check('base giuridica da confermare', !(await panel.isChecked('#legal-basis-confirm')));
  await panel.check('#legal-basis-confirm');
  includes('base giuridica confermata', await text('#contact-hs_legal_basis-meta'), 'Confermata');
  await panel.fill('#contact-email', '');
  check('contatto di nuovo incompleto: base giuridica nascosta', await panel.isHidden('#contact-hs_legal_basis-field'));
  check('conferma tolta', !(await panel.isChecked('#legal-basis-confirm')));
  await shot('4-caso-perticaia');

  // ---------------------------------------------------------------------------------------------
  console.log('\nHubSpot REALE (finto HubSpot locale: nessuna chiamata al CRM vero)');
  const blocker = () => panel.evaluate(() => document.querySelector('#hubspot-blocker .fb-text')?.textContent.trim() || '');
  const blockerIs = (t) => panel.waitForFunction((x) => (document.querySelector('#hubspot-blocker .fb-text')?.textContent.trim() || '') === x, t, { timeout: 5000 }).then(() => true, () => false);
  const lineIs = (sel, t) => options.waitForFunction(([s, x]) => document.querySelector(s).textContent.includes(x), [sel, t], { timeout: 8000 }).then(() => true, () => false);
  await options.check('input[name="mode"][value="real"]');
  await panel.waitForFunction(() => document.querySelector('header [data-mode-badge]').textContent.trim() === 'HubSpot REALE');
  check('badge «HubSpot REALE» ben distinto', await panel.$eval('header [data-mode-badge]', (b) => b.classList.contains('real') && !b.classList.contains('mock')));
  check('senza chiave: «Configura la Service Key nelle Impostazioni.»', await blockerIs('Configura la Service Key nelle Impostazioni.'), await blocker());
  check('senza chiave: Verifica HubSpot disattivata', await panel.isDisabled('#verify'));
  includes('Impostazioni: stesso avviso', await options.textContent('#mode-warning'), 'Configura la Service Key nelle Impostazioni.');
  equal('campo della chiave di tipo password', await options.getAttribute('#service-key', 'type'), 'password');

  await options.fill('#service-key', WRONG_KEY);
  await options.click('#save-key');
  check('chiave salvata: «✓ Service Key configurata»', await lineIs('#key-status', '✓ Service Key configurata'));
  equal('la chiave non resta nel campo', await options.inputValue('#service-key'), '');
  check('la chiave non si rivede, nemmeno in parte', !(await options.textContent('body')).includes(WRONG_KEY.slice(-6)));
  check('chiave non ancora testata: modalità reale ferma', await blockerIs('Connessione HubSpot non verificata: nelle Impostazioni premi «Testa connessione».'), await blocker());
  await options.click('#test-connection');
  check('test connessione 401: «Service Key non valida o ruotata.»', await lineIs('#connection-status', 'Service Key non valida o ruotata.'));
  await options.fill('#service-key', FAKE_KEY);
  await options.click('#save-key');
  await lineIs('#connection-status', 'Connessione non ancora testata');
  fake.force('GET', /companies$/, fake.response.error(403, 'This app hasn\'t been granted all required scopes'));
  await options.click('#test-connection');
  check('test connessione 403: «Service Key valida ma permessi insufficienti.»', await lineIs('#connection-status', 'Service Key valida ma permessi insufficienti.'));
  const readsBefore = fake.state.requests.length;
  await options.click('#test-connection');
  check('test connessione 200: «✓ Connessione HubSpot riuscita»', await lineIs('#connection-status', '✓ Connessione HubSpot riuscita'));
  const testCall = fake.state.requests.slice(readsBefore);
  check('il test fa una sola lettura innocua', testCall.length === 1 && testCall[0].method === 'GET' && testCall[0].path === '/crm/objects/2026-09/companies', JSON.stringify(testCall));
  check('Bearer con la chiave salvata', testCall[0].authorized);
  await options.screenshot({ path: path.join(OUT, '7-impostazioni-hubspot-reale.png'), fullPage: true });
  check('pannello pronto', await blockerIs(''), await blocker());
  check('Verifica HubSpot attiva', await panel.isEnabled('#verify'));
  const panelText = await panel.evaluate(() => document.body.textContent + [...document.querySelectorAll('input, textarea')].map((i) => i.value).join(' '));
  check('la chiave non arriva mai al pannello', !panelText.includes(FAKE_KEY) && !JSON.stringify(await panel.evaluate(() => chrome.storage.session.get(null))).includes(FAKE_KEY));

  console.log('\nHubSpot REALE: 429 e errore di validazione (Perticaia, cantina)');
  const writes = () => fake.state.requests.filter((r) => r.method !== 'GET' && !r.path.endsWith('/search'));
  fake.force('POST', /companies\/search$/, fake.response.json(429, { status: 'error', errorType: 'RATE_LIMIT', message: 'secondly limit' }, { 'retry-after': '1' }));
  v = await verify();
  equal('429 con Retry-After: si riprova e la verifica riesce', v.kind, 'not_found');
  fake.force('POST', /companies\/search$/, fake.response.json(429, { status: 'error', errorType: 'RATE_LIMIT', message: 'secondly limit' }, { 'retry-after': '1' }), 3);
  v = await verify();
  equal('429 insistente: errore', v.kind, 'error');
  includes('429: messaggio chiaro', v.text, 'troppe richieste');
  v = await verify();
  equal('di nuovo disponibile', v.kind, 'not_found');
  const perticaiaPreview = await text('#company-step');
  check('anteprima: owner del commerciale attivo', perticaiaPreview.includes(`${ALESSANDRO.name} · ID ${ALESSANDRO.hubspotOwnerId}`), perticaiaPreview);
  check('anteprima cantina: niente tipo struttura', !perticaiaPreview.includes('Tipo struttura Hospitality'));
  fake.requireProperty('companies', 'industry');
  await press('#create-company');
  await panel.waitForFunction(() => document.querySelector('#company-step').textContent.includes('Azienda non creata'), null, { timeout: 15000 });
  const validation = await text('#company-step');
  includes('validation error: leggibile', validation, 'HubSpot ha rifiutato i dati per le regole del portale');
  includes('validation error: proprietà indicata', validation, 'industry (industry): obbligatorio per una regola condizionale del portale.');
  equal('validation error: nessuna azienda creata', fake.state.companies.length, 0);
  fake.state.required.companies.length = 0;

  console.log('\nHubSpot REALE: race condition (un collega la crea nel frattempo)');
  const colleague = fake.addCompany({ name: 'Perticaia', domain: 'perticaia-caso.test', hubspot_owner_id: MATTEO.hubspotOwnerId, hs_lead_status: 'NEW' });
  const postsBefore = writes().length;
  await press('#create-company');
  await panel.waitForFunction(() => document.querySelector('#verify-result').textContent.includes("aggiunta a HubSpot da un'altra operazione"), null, { timeout: 15000 });
  includes('race: messaggio', await text('#verify-result'), "L'azienda è stata aggiunta a HubSpot da un'altra operazione. Nessun duplicato è stato creato.");
  includes('race: record del collega', await text('#verify-result'), `Record ID ${colleague}`);
  equal('race: nessuna scrittura', writes().length, postsBefore);
  check('race: nessun pulsante di creazione', await panel.isHidden('#company-step'));

  console.log('\nOutreach REALE: un collega registra il primo invio prima della conferma (Perticaia)');
  v = await verify();
  equal('Perticaia ora è in HubSpot (record del collega)', v.kind, 'found');
  await panel.click('#nav-home');
  for (const part of ['Vai al primo contatto', 'Perticaia è in HubSpot: invia la prima email dal tuo account aziendale']) includes(`Home: ${part}`, await text('#next-step'), part);
  equal('Home: «Apri Outreach»', (await text('#next-step-action')).trim(), 'Apri Outreach');
  await panel.click('#next-step-action');
  await waitRead();
  includes('Outreach: Azienda', await text('#outreach-facts'), 'Perticaia');
  equal('Outreach: stato letto da HubSpot', (await text('#outreach-status')).trim(), 'Da contattare');
  equal('prima email aziendale: A = info@, CC = visit@', (await text('#outreach-recipients')).replace(/\s+/g, ''), 'A:info@perticaia.itCC:visit@perticaia.itTogli');
  equal('una sola azione primaria: «Apri email pronta in Gmail»', (await primaries('outreach')).join(), 'outreach-gmail');
  const colleagueRecord = fake.state.companies.find((c) => c.id === colleague).properties;
  colleagueRecord.data_del_primo_invio_email = '2026-10-12T07:00:00.000Z'; // il collega registra il suo invio
  const writesBeforeColleague = writes().length;
  await sendAndConfirm();
  await panel.waitForSelector('#outreach-contacted', { timeout: 15000 });
  const colleagueView = await text('#outreach-contacted');
  for (const part of ['Questa Azienda risulta già contattata.', '12/10/2026, 09:00']) includes(`rilettura prima di scrivere: ${part}`, colleagueView, part);
  equal('data del collega non sovrascritta', colleagueRecord.data_del_primo_invio_email, '2026-10-12T07:00:00.000Z');
  equal('nessuna scrittura, nessun task', writes().length, writesBeforeColleague);
  check('nessun pulsante di conferma', !(await panel.$('#outreach-confirm')) && !(await panel.$('#outreach-sent')));
  equal('già contattata: nessuna azione (solo «Aggiorna da HubSpot»)', (await outreachButtons()).join(), 'outreach-refresh');
  await panel.click('#nav-scout');

  console.log('\nHubSpot REALE: gravità dei doppioni (La Mora, dominio diverso)');
  // un solo segnale (stesso telefono): possibile duplicato, si crea solo dopo la conferma
  const sharedPhone = fake.addCompany({ name: 'Locanda Vecchia', domain: 'locandavecchia.test', phone: '393 4363917', hs_lead_status: 'CONNECTED' });
  r = await deepScan(lamora);
  equal('scansione completata', r.state, 'ok');
  v = await verify();
  equal('solo telefono: possibile duplicato', v.kind, 'warn');
  includes('solo telefono: «⚠ Possibile duplicato»', v.text, '⚠ Possibile duplicato');
  includes('solo telefono: motivo', v.text, 'stesso telefono');
  includes('Lead Status CONNECTED → «In contatto»', v.text, 'Lead Status: In contatto');
  check('possibile duplicato: conferma presente', await panel.isVisible('#ack-duplicate'));
  check('possibile duplicato: «Crea» bloccato finché non si conferma', await panel.isDisabled('#create-company'));
  await panel.check('#ack-duplicate');
  check('possibile duplicato: dopo la conferma si può creare', await panel.isEnabled('#create-company'));
  // stesso sito web, nome diverso: ancora possibile duplicato
  fake.addCompany({ name: 'Osteria del Ponte', domain: 'osteriadelponte.test', website: 'https://www.lamora-caso.test/' });
  v = await verify();
  equal('stesso sito + nome diverso: possibile duplicato', v.kind, 'warn');
  includes('stesso sito + nome diverso: motivo', v.text, 'stesso sito web');
  check('stesso sito + nome diverso: conferma presente', await panel.isVisible('#ack-duplicate'));
  // stesso sito web + stesso nome: duplicato certo, nessuna conferma e nessuna creazione
  const sameSite = fake.addCompany({ name: 'Agriturismo La Mora', domain: 'vecchia-lamora.test', website: 'http://lamora-caso.test' });
  const writesBeforeSite = writes().length;
  v = await verify();
  equal('stesso sito + stesso nome: duplicato certo', v.kind, 'found');
  for (const part of ['⛔ Azienda già presente in HubSpot', `Record ID ${sameSite}`, 'stesso sito web', 'stesso nome']) includes(`stesso sito + stesso nome: ${part}`, v.text, part);
  check('stesso sito + stesso nome: nessuna casella di conferma', !(await panel.$('#ack-duplicate')));
  check('stesso sito + stesso nome: nessun pulsante «Crea Azienda»', !(await panel.$('#create-company')) && await panel.isHidden('#company-step'));
  equal('stesso sito + stesso nome: nessuna scrittura', writes().length, writesBeforeSite);
  // due identificatori forti (stessa email + stesso telefono): duplicato certo, nessuna via d'uscita
  const hard = fake.addCompany({
    name: 'Agriturismo Il Poggio del Sole', domain: 'poggiodelsole.test', email_aziendale_principale: 'agriturismolamora@gmail.com',
    phone: '+39 393 436 3917', hs_lead_status: 'ATTEMPTED_TO_CONTACT', hubspot_owner_id: MATTEO.hubspotOwnerId,
  });
  const writesBeforeHard = writes().length;
  v = await verify();
  equal('stessa email + stesso telefono: duplicato certo', v.kind, 'found');
  for (const part of ['⛔ Azienda già presente in HubSpot', 'Duplicato certo', 'Agriturismo Il Poggio del Sole', `Record ID ${hard}`, 'stessa email', 'stesso telefono', 'Lead Status: Primo contatto inviato', `Proprietario: ${MATTEO.name}`, `Record ID ${sharedPhone}`]) includes(`duplicato certo: ${part}`, v.text, part);
  check('duplicato certo: nessuna casella di conferma', !(await panel.$('#ack-duplicate')));
  check('duplicato certo: nessun pulsante «Crea Azienda»', !(await panel.$('#create-company')) && await panel.isHidden('#company-step'));
  check('ATTEMPTED_TO_CONTACT non mostrato come valore tecnico', !v.text.includes('ATTEMPTED_TO_CONTACT'));
  equal('duplicato certo: nessuna scrittura', writes().length, writesBeforeHard);
  await panel.locator('section.hubspot').screenshot({ path: path.join(OUT, '5c-duplicato-certo.png') });
  // il record «Agriturismo La Mora» serviva solo qui: lo stesso nome tornerebbe nel prossimo prospect
  fake.state.companies.splice(fake.state.companies.findIndex((c) => c.id === sameSite), 1);

  console.log('\nOutreach REALE: Azienda già contattata (Il Poggio del Sole, Primo contatto inviato)');
  v = await verify();
  equal('un solo doppione certo', v.kind, 'found');
  await panel.click('#nav-home');
  for (const part of ['Agriturismo Il Poggio del Sole risulta già contattata', 'Stato: Primo contatto inviato']) includes(`Home: ${part}`, await text('#next-step'), part);
  await panel.click('#next-step-action');
  await waitRead();
  const alreadyView = await text('#outreach-contacted');
  for (const part of ['Questa Azienda risulta già contattata.', 'Stato attuale', 'Primo contatto inviato', 'Data primo invio', 'Non registrata', 'Nessun nuovo primo contatto e nessun follow-up automatico.']) {
    includes(`già contattata: ${part}`, alreadyView, part);
  }
  check("già contattata: nessun «Ho inviato l'email» né conferma", !(await panel.$('#outreach-confirm')) && !(await panel.$('#outreach-sent')));
  check('già contattata: nessun «Registra email inviata…»', !(await panel.$('#outreach-contact-date')) && !(await text('#outreach-body')).includes('Registra email inviata'));
  equal('già contattata: nessuna azione (solo «Aggiorna da HubSpot»)', (await outreachButtons()).join(), 'outreach-refresh');
  check('già contattata: nessun codice tecnico', !alreadyView.includes('ATTEMPTED_TO_CONTACT'));
  equal('già contattata: nessuna scrittura', writes().length, writesBeforeHard);
  await panel.locator('#view-outreach').screenshot({ path: path.join(OUT, '10c-outreach-gia-contattata.png') });
  await panel.click('#nav-scout');

  console.log('\nHubSpot REALE: azienda già presente (Cantina Rossi) e contatto già presente');
  const existingCompany = fake.addCompany({ name: 'Cantina Rossi', domain: 'cantinarossi.test', city: 'Foligno', hubspot_owner_id: ALESSANDRO.hubspotOwnerId, hs_lead_status: 'NEW' });
  const existingContact = fake.addContact({ firstname: 'Mario', lastname: 'Rossi', email: 'mario.rossi@cantinarossi.test', hubspot_owner_id: ALESSANDRO.hubspotOwnerId });
  r = await deepScan(cantina);
  equal('scansione completata', r.state, 'ok');
  v = await verify();
  equal('azienda esistente: bloccata', v.kind, 'found');
  for (const part of ['⛔ Azienda già presente in HubSpot', 'Cantina Rossi', 'Dominio: cantinarossi.test', 'Città: Foligno', 'Proprietario: Alessandro Poponi', 'Lead Status: Da contattare', `Record ID ${existingCompany}`, 'stesso dominio']) includes(`già presente: ${part}`, v.text, part);
  equal('«Apri in HubSpot»: link dato dall\'API', await panel.$eval('#verify-result a.src', (a) => a.href), `https://app-eu1.hubspot.com/contacts/149362651/record/0-2/${existingCompany}`);
  check('nessuna possibilità di creare un doppione certo', await panel.isHidden('#company-step') && !(await panel.$('#create-company')));
  equal('contatto per l\'azienda esistente', (await text('#create-contact')).trim(), 'Crea Contatto e associa a questa Azienda');
  // base giuridica: serve solo per creare il Contatto, la verifica funziona comunque
  check('senza base giuridica: Verifica HubSpot disponibile', await panel.isEnabled('#verify'));
  check('senza base giuridica: «Crea Contatto» disattivato', await panel.isDisabled('#create-contact'));
  includes('senza base giuridica: messaggio', await text('#legal-basis-required'), 'Conferma la base giuridica per poter creare il Contatto in HubSpot.');
  // la base predefinita di sessione sta nella Home: si attiva lì e si torna a Scout
  await panel.click('#nav-home');
  await panel.check('#session-legal-basis');
  await panel.click('#nav-scout');
  await panel.waitForFunction(() => !document.querySelector('#legal-basis-required'), null, { timeout: 5000 }).catch(() => {});
  check('base di sessione confermata: «Crea Contatto» attivo', await panel.isEnabled('#create-contact'));
  includes('form Contatto: base ereditata', await text('#contact-hs_legal_basis-meta'), 'Predefinita per questa sessione');
  check('form Contatto: casella spuntata dalla base di sessione', await panel.isChecked('#legal-basis-confirm'));
  equal('salvata solo per la sessione', await panel.evaluate(() => chrome.storage.session.get('legalBasisDefault').then((r) => r.legalBasisDefault?.operatorId)), ALESSANDRO.hubspotOwnerId);
  check('mai nelle impostazioni permanenti', !JSON.stringify(await panel.evaluate(() => chrome.storage.local.get(null))).includes('legalBasis'));
  // scelta per il singolo contatto
  await panel.uncheck('#legal-basis-confirm');
  includes('singolo contatto: esclusa', await text('#contact-hs_legal_basis-meta'), 'Non usata per questo contatto');
  check('singolo contatto escluso: «Crea Contatto» disattivato', await panel.isDisabled('#create-contact'));
  await panel.check('#legal-basis-confirm');
  includes('singolo contatto: confermata di nuovo', await text('#contact-hs_legal_basis-meta'), 'Confermata');
  check('di nuovo attivo', await panel.isEnabled('#create-contact'));
  await press('#create-contact');
  await panel.waitForFunction(() => document.querySelector('#contact-step').textContent.includes('Contatto già presente in HubSpot'), null, { timeout: 15000 });
  const contactExists = await text('#contact-step');
  includes('contatto esistente: record', contactExists, `Record ID ${existingContact}`);
  includes('contatto esistente: motivo', contactExists, 'stessa email');
  check('contatto esistente: nessuna creazione, nessuna associazione', fake.state.contacts.length === 1 && fake.state.associations.length === 0);
  check('nessuna modifica a record esistenti', fake.state.requests.every((q) => q.method !== 'PATCH' && q.method !== 'DELETE'));

  console.log('\nOutreach REALE: prima email aziendale con il Contatto in CC, follow-up non creato e nuovo tentativo (Cantina Rossi)');
  const patchCount = () => fake.state.requests.filter((q) => q.method === 'PATCH').length;
  const taskCount = () => fake.state.requests.filter((q) => q.method === 'POST' && q.path === '/crm/objects/2026-09/tasks').length;
  await panel.waitForSelector('#scout-next-step-action');
  includes('Scout propone il primo contatto', await text('#scout-next-step'), 'Vai al primo contatto');
  await panel.click('#scout-next-step-action');
  await waitRead();
  const cantinaShown = (await text('#outreach-recipients')).replace(/\s+/g, '');
  check("A: email aziendale; CC: l'email di Mario Rossi (stesso dominio); nessuna scelta «Contatto»", cantinaShown.startsWith('A:info@cantinarossi.test') && cantinaShown.includes('mario.rossi@cantinarossi.test') && !(await panel.$('#outreach-recipient')), cantinaShown);
  fake.force('POST', /\/tasks$/, fake.response.error(502, 'Bad gateway'), 1, { after: true }); // task creato, risposta persa
  const patchesBeforeCantina = patchCount();
  const tasksBeforeCantina = taskCount();
  const countBeforeCantina = Number((await text('#daily-count')).trim());
  await panel.click('#outreach-sent');
  await panel.waitForSelector('#outreach-verify');
  check("anteprima: nessuna data del Contatto (la prima email resta dell'Azienda)", !(await text('#outreach-preview')).includes('Contatto'));
  equal("«Ho inviato l'email» non scrive nulla", patchCount() + taskCount(), patchesBeforeCantina + tasksBeforeCantina);
  await panel.check('#outreach-sent-check');
  await panel.click('#outreach-confirm');
  await panel.waitForSelector('#outreach-retry', { timeout: 15000 });
  const partialOutreach = await text('#outreach-body');
  includes('✓ Primo contatto registrato', partialOutreach, '✓ Primo contatto registrato');
  includes('⚠ Follow-up non creato', partialOutreach, '⚠ Follow-up non creato');
  includes('esito: CC registrato', partialOutreach, 'CC: mario.rossi@cantinarossi.test');
  equal('«Riprova creazione follow-up»', (await text('#outreach-retry')).trim(), 'Riprova creazione follow-up');
  equal('una sola azione primaria: il nuovo tentativo', (await primaries('outreach')).join(), 'outreach-retry');
  const cantinaRecord = fake.state.companies.find((c) => c.id === existingCompany).properties;
  const marioRecord = fake.state.contacts.find((c) => c.id === existingContact).properties;
  equal('CRM aggiornato: Lead Status', cantinaRecord.hs_lead_status, 'ATTEMPTED_TO_CONTACT');
  check('CRM aggiornato: data primo invio Azienda', /^\d{4}-\d{2}-\d{2}T/.test(cantinaRecord.data_del_primo_invio_email || ''), cantinaRecord.data_del_primo_invio_email);
  equal('Contatto in CC: data primo invio del Contatto NON scritta', marioRecord.data_primo_invio_email_al_contatto, undefined);
  await panel.waitForFunction((n) => Number(document.querySelector('#daily-count').textContent) === n, countBeforeCantina + 1, { timeout: 5000 }).catch(() => {});
  equal("contatore: +1 già alla registrazione dell'Azienda, anche se il task è fallito", Number((await text('#daily-count')).trim()), countBeforeCantina + 1);
  await panel.locator('#view-outreach').screenshot({ path: path.join(OUT, '10d-outreach-follow-up-da-riprovare.png') });
  await panel.click('#nav-home');
  includes('Home: follow-up da riprovare', await text('#next-step'), 'Follow-up non creato');
  check('contatore visibile nella Home', await panel.isVisible('#daily-counter'));
  await panel.click('#next-step-action');
  await panel.waitForSelector('#outreach-retry');
  const dateBefore = cantinaRecord.data_del_primo_invio_email;
  await panel.click('#outreach-retry');
  await panel.waitForFunction(() => document.querySelector('#outreach-follow-up')?.textContent.includes('Follow-up programmato'), null, { timeout: 15000 });
  equal('un solo task finale', fake.tasksOf('companies', existingCompany).length, 1);
  equal('il nuovo tentativo non crea un secondo task', taskCount() - tasksBeforeCantina, 1);
  equal('il nuovo tentativo non riscrive le date', patchCount() - patchesBeforeCantina, 1);
  equal('data invariata', cantinaRecord.data_del_primo_invio_email, dateBefore);
  equal('il nuovo tentativo non conta di nuovo', Number((await text('#daily-count')).trim()), countBeforeCantina + 1);
  const cantinaTask = fake.tasksOf('companies', existingCompany)[0];
  equal("follow-up associato solo all'Azienda (192), non al Contatto in CC", fake.state.taskLinks.filter((l) => l.taskId === cantinaTask.id).map((l) => l.kind + ':' + l.id + ':' + l.typeId).join(), 'companies:' + existingCompany + ':192');
  equal('note del task: prima email aziendale', cantinaTask.properties.hs_task_body, 'Primo follow-up dopo email commerciale Agria System.');
  equal('task: owner del commerciale attivo', cantinaTask.properties.hubspot_owner_id, ALESSANDRO.hubspotOwnerId);
  await panel.click('#nav-scout');

  console.log('\nHubSpot REALE: azienda assente → Azienda, poi Contatto (errore e nuovo tentativo) e associazione');
  r = await deepScan(home);
  equal('scansione completata', r.state, 'ok');
  equal('contatto valido', `${await value('contact-firstname')} ${await value('contact-lastname')}`, 'Maria Bianchi');
  if (!(await panel.isChecked('#legal-basis-confirm'))) await panel.check('#legal-basis-confirm');
  const companiesBefore = fake.state.companies.length;
  const companyPosts = () => writes().filter((q) => q.path === '/crm/objects/2026-09/companies').length;
  const companyPostsBefore = companyPosts();
  v = await verify();
  equal('azienda assente: «✓ Non presente in HubSpot»', v.kind, 'not_found');
  const preview = await text('#company-step');
  for (const part of ['Verranno scritti questi dati', 'Proprietario HubSpot', `${ALESSANDRO.name} · ID ${ALESSANDRO.hubspotOwnerId}`, 'Da contattare', 'Tipo struttura Hospitality', 'Agriturismo']) includes(`anteprima: ${part}`, preview, part);
  equal('la verifica non crea nulla', fake.state.companies.length, companiesBefore);
  // doppio clic: un solo record
  await panel.evaluate(() => {
    const button = document.querySelector('#create-company');
    button.click();
    button.click();
  });
  await panel.waitForFunction(() => document.querySelector('#company-step').textContent.includes('✓ Azienda creata in HubSpot'), null, { timeout: 15000 });
  const created = fake.state.companies.at(-1);
  equal('doppio clic: una sola azienda creata', companyPosts() - companyPostsBefore, 1);
  const createdBox = await text('#company-step');
  for (const part of ['✓ Azienda creata in HubSpot', `Record ID ${created.id}`, `Proprietario: ${ALESSANDRO.name}`, 'Creata il ']) includes(`azienda creata: ${part}`, createdBox, part);
  equal('azienda creata: link', await panel.$eval('#company-step a.src', (a) => a.href), created.url);
  equal('owner = commerciale attivo', created.properties.hubspot_owner_id, ALESSANDRO.hubspotOwnerId);
  equal('Lead Status NEW', created.properties.hs_lead_status, 'NEW');
  check('nessuna proprietà vuota inviata', Object.values(created.properties).every((x) => x !== ''), JSON.stringify(created.properties));
  fake.force('POST', /contacts$/, fake.response.error(500, 'Internal error'));
  equal('contatto: «Crea Contatto e associa»', (await text('#create-contact')).trim(), 'Crea Contatto e associa');
  await press('#create-contact');
  await panel.waitForFunction(() => document.querySelector('#contact-step').textContent.includes('Contatto non creato'), null, { timeout: 15000 });
  const partial = await text('#contact-step');
  includes('operazione parziale: ✓ Azienda creata', partial, '✓ Azienda creata');
  includes('operazione parziale: ⚠ Contatto non creato', partial, '⚠ Contatto non creato');
  equal('«Riprova creazione Contatto»', (await text('#create-contact')).trim(), 'Riprova creazione Contatto');
  await panel.reload();
  await panel.waitForSelector('#app:not([hidden])');
  await panel.waitForFunction(() => document.querySelector('#company-step').textContent.includes('✓ Azienda creata in HubSpot'));
  includes('ID dell\'azienda conservato nella bozza', await text('#company-step'), `Record ID ${created.id}`);
  await press('#create-contact');
  await panel.waitForFunction(() => document.querySelector('#contact-step').textContent.includes('✓ Contatto creato e associato'), null, { timeout: 15000 });
  const contactRecord = fake.state.contacts.at(-1);
  equal('nuovo tentativo: nessuna nuova azienda', companyPosts() - companyPostsBefore, 1);
  equal('un solo contatto creato', fake.state.contacts.filter((c) => c.properties.email === 'maria.bianchi@agriturismo-lamora.test').length, 1);
  equal('contatto: owner', contactRecord.properties.hubspot_owner_id, ALESSANDRO.hubspotOwnerId);
  equal('contatto: base giuridica confermata e inviata', contactRecord.properties.hs_legal_basis, 'Legitimate interest – prospect/lead');
  check('associazione Contatto → Azienda', fake.state.associations.some((a) => a.contactId === contactRecord.id && a.companyId === created.id), JSON.stringify(fake.state.associations));
  await panel.$eval('#audit-box', (d) => { d.open = true; });
  const audit = await text('#audit-list');
  for (const part of ['Verifica HubSpot', 'Creazione Azienda', 'Successo', 'Creazione Contatto e associazione', ALESSANDRO.name, `ID ${created.id}`]) includes(`registro: ${part}`, audit, part);
  check('registro senza chiave', !audit.includes(FAKE_KEY));
  // Home: il prossimo passo segue lo stato di Scout, senza perdere nulla
  const companyBefore = await value('company-name');
  await panel.click('#nav-home');
  for (const part of ['Vai al primo contatto', 'Agriturismo La Mora è in HubSpot']) includes(`Home dopo la creazione: ${part}`, await text('#next-step'), part);
  equal('Home dopo la creazione: «Apri Outreach»', (await text('#next-step-action')).trim(), 'Apri Outreach');
  await panel.click('#nav-scout');
  equal('ritorno a Scout: dati intatti', await value('company-name'), companyBefore);
  includes('ritorno a Scout: azienda ancora creata', await text('#company-step'), '✓ Azienda creata in HubSpot');
  includes('Scout: passaggio a Outreach', await text('#scout-next-step'), 'Vai al primo contatto');
  await shot('5-hubspot-reale');
  await panel.locator('section.hubspot').screenshot({ path: path.join(OUT, '5b-sezione-hubspot.png') });

  console.log("\nOutreach REALE: email all'Azienda, doppio clic, follow-up programmato (La Mora)");
  await panel.click('#nav-home');
  await panel.click('#next-step-action');
  await waitRead();
  equal('stato letto da HubSpot', (await text('#outreach-status')).trim(), 'Da contattare');
  includes('Invia da: commerciale attivo', await text('#outreach-from'), ALESSANDRO.name + ' · ' + ALESSANDRO.email);
  check('nessuna scelta Azienda/Contatto: la prima email è dell\'Azienda', !(await panel.$('#outreach-recipient')));
  const expected = followUpSchedule(Date.now());
  // A e CC: principale in A; secondaria e TUTTE le altre email valide del prospect in CC, anche nominative
  const shownRecipients = await text('#outreach-recipients');
  includes('A: email aziendale principale', shownRecipients, 'A:info@agriturismo-lamora.test');
  for (const cc of ['prenotazioni@agriturismo-lamora.test', 'eventi@agriturismo-lamora.test', 'maria.bianchi@agriturismo-lamora.test']) includes('CC suggerito: ' + cc, shownRecipients, cc);
  for (const out of ['lamora@pec.agriturismo-lamora.test', 'info@webagency.test']) check('non in CC: ' + out, !shownRecipients.includes(out), shownRecipients);
  const excludedNote = await text('#outreach-excluded');
  for (const part of ['PEC', 'fornitore esterno']) includes('non suggeriti, col motivo: ' + part, excludedNote, part);
  check('una persona del prospect non è esclusa', !excludedNote.includes('maria.bianchi'));
  check('anteprima senza codici HubSpot', !/ATTEMPTED_TO_CONTACT|hs_|data_del_primo/.test(await text('#outreach-body')));
  equal('una sola azione primaria: «Apri email pronta in Gmail»', (await primaries('outreach')).join(), 'outreach-gmail');
  equal('Azienda non contattata: Gmail, «Ho inviato l\'email», «Aggiorna da HubSpot»', (await outreachButtons()).join(), 'outreach-gmail,outreach-sent,outreach-refresh');
  check('Azienda non contattata: nessun «Registra email inviata…»', !(await panel.$('#outreach-contact-date')));
  check('nessun «Conferma» prima della verifica', !(await panel.$('#outreach-confirm')));
  // CC tolto a mano (e uno tolto e rimesso): resta tolto anche cambiando vista
  await panel.click('button[aria-label="Togli eventi@agriturismo-lamora.test dal CC"]');
  includes('CC tolto: tra i «Tolti dal CC»', await text('#outreach-recipients'), 'Tolti dal CC:eventi@agriturismo-lamora.test');
  await panel.click('button[aria-label="Togli maria.bianchi@agriturismo-lamora.test dal CC"]');
  await panel.click('button[aria-label="Rimetti maria.bianchi@agriturismo-lamora.test in CC"]');
  check('«Rimetti»: di nuovo in CC', Boolean(await panel.$('button[aria-label="Togli maria.bianchi@agriturismo-lamora.test dal CC"]')) && !(await panel.$('button[aria-label="Rimetti maria.bianchi@agriturismo-lamora.test in CC"]')));
  await panel.click('#nav-home');
  check('contatore visibile nella Home', await panel.isVisible('#daily-counter'));
  await panel.click('#nav-scout');
  check('contatore visibile in Scout', await panel.isVisible('#daily-counter'));
  await panel.click('#nav-outreach');
  await waitRead();
  check('cambio di vista: CC tolto conservato', (await text('#outreach-recipients')).includes('Tolti dal CC:eventi@agriturismo-lamora.test'));
  await panel.setViewportSize({ width: 320, height: 900 });
  check('Outreach: nessuno scroll orizzontale (320 px)', await noHorizontalScroll());
  await panel.locator('#view-outreach').screenshot({ path: path.join(OUT, '10-outreach-primo-contatto.png') });
  await panel.screenshot({ path: path.join(OUT, '10f-outreach-contatore-320.png') });
  await panel.setViewportSize({ width: 400, height: 900 });
  check('Outreach: nessuno scroll orizzontale (400 px)', await noHorizontalScroll());
  // il contatore in fondo non copre nulla: alla fine della pagina sta sotto l'ultimo contenuto
  const overlap = await panel.evaluate(() => {
    window.scrollTo(0, document.scrollingElement.scrollHeight);
    const bar = document.querySelector('#daily-counter').getBoundingClientRect();
    const last = document.querySelector('main .foot').getBoundingClientRect();
    return { bar: bar.top, last: last.bottom };
  });
  check('contatore: non copre i contenuti a fine pagina', overlap.last <= overlap.bar + 0.5, JSON.stringify(overlap));
  // Gmail: email già compilata, account del commerciale attivo; nessuna scrittura e nessun conteggio
  const writesBeforeGmail = writes().length;
  const countBeforeLaMora = Number((await text('#daily-count')).trim());
  await panel.click('#outreach-text summary');
  const laMoraBody = await text('#outreach-text-body');
  const laMoraGmail = await openGmail();
  const gp = laMoraGmail.searchParams;
  equal('Gmail: account', gp.get('authuser'), ALESSANDRO.email);
  equal('Gmail: A', gp.get('to'), 'info@agriturismo-lamora.test');
  equal('Gmail: CC (senza quello tolto)', gp.get('cc'), 'prenotazioni@agriturismo-lamora.test,maria.bianchi@agriturismo-lamora.test');
  equal('Gmail: oggetto', gp.get('su'), 'Gestione digitale e crescita commerciale per Agriturismo La Mora');
  equal('Gmail: testo', gp.get('body'), laMoraBody);
  includes('Gmail: testo con il commerciale', gp.get('body'), 'sono ' + ALESSANDRO.name + ' di Agria System.');
  includes('Gmail: testo con l\'Azienda', gp.get('body'), 'le scrivo per entrare in contatto con Agriturismo La Mora.');
  check('Gmail: nessun segnaposto', !/\{\{|\}\}/.test(gp.get('su') + gp.get('body')));
  equal('apertura di Gmail: nessuna scrittura in HubSpot', writes().length, writesBeforeGmail);
  equal('apertura di Gmail: contatore invariato', Number((await text('#daily-count')).trim()), countBeforeLaMora);
  const historyLabel = async () => (await text('#daily-history-toggle')).trim();
  const historyBeforeLaMora = await historyLabel();
  equal('apertura di Gmail: nessuna voce di cronologia', historyBeforeLaMora, 'Vedi aziende contattate (1)');
  includes('dopo Gmail: istruzione', await text('#outreach-after-gmail'), 'Dopo averla inviata da Gmail, torna qui.');
  equal("dopo Gmail: azione primaria «Ho inviato l'email»", (await primaries('outreach')).join(), 'outreach-sent');
  await panel.click('#nav-home');
  await panel.click('#nav-outreach');
  await waitRead();
  equal("Gmail già aperto (sessione): «Ho inviato l'email» resta l'azione primaria", (await primaries('outreach')).join(), 'outreach-sent');
  // primo clic: nessuna scrittura, solo la verifica
  const writesBeforeLaMora = writes().length;
  await panel.click('#outreach-sent');
  await panel.waitForSelector('#outreach-verify');
  equal("«Ho inviato l'email»: nessuna scrittura in HubSpot", writes().length, writesBeforeLaMora);
  equal('verifica: titolo', (await text('#outreach-verify-title')).trim(), 'Verifica prima di registrare il contatto');
  equal('verifica: il focus va al titolo', await panel.evaluate(() => document.activeElement?.id), 'outreach-verify-title');
  const verifyText = await text('#outreach-verify');
  for (const part of ['A:info@agriturismo-lamora.test', 'CC:prenotazioni@agriturismo-lamora.test', 'maria.bianchi@agriturismo-lamora.test', 'Confermando, Agria Commercial registrerà il primo contatto in HubSpot e programmerà il follow-up.', "Confermo di aver realmente inviato l'email ai destinatari indicati."]) includes('verifica: ' + part, verifyText, part);
  check('verifica: il CC tolto non c\'è', !verifyText.includes('eventi@'));
  const outreachPreview = await text('#outreach-preview');
  for (const part of ['Cosa succederà', 'Stato lead → Primo contatto inviato', 'Registra data primo invio Azienda', 'Crea follow-up per ' + formatDue(expected.dueAt), 'Assegna a ' + ALESSANDRO.name]) includes('anteprima: ' + part, outreachPreview, part);
  check('prima email aziendale: nessuna data del Contatto in anteprima', !outreachPreview.includes('Contatto'));
  check('casella vuota all\'apertura', !(await panel.isChecked('#outreach-sent-check')));
  check('casella vuota: conferma finale disattivata', await panel.isDisabled('#outreach-confirm'));
  equal('conferma finale: testo', (await text('#outreach-confirm')).trim(), 'Conferma invio e crea follow-up');
  equal('verifica: una sola azione primaria', (await primaries('outreach')).join(), 'outreach-confirm');
  await panel.$eval('#outreach-confirm', (b) => b.click()); // clic forzato sul pulsante disattivato
  equal('casella vuota: nessuna scrittura', writes().length, writesBeforeLaMora);
  await panel.setViewportSize({ width: 320, height: 900 });
  check('verifica: nessuno scroll orizzontale (320 px)', await noHorizontalScroll());
  await panel.locator('#view-outreach').screenshot({ path: path.join(OUT, '10e-outreach-verifica.png') });
  await panel.setViewportSize({ width: 400, height: 900 });
  // «Indietro»: nessuna scrittura, si torna ai destinatari con le scelte di prima
  await panel.click('#outreach-back');
  await panel.waitForSelector('#outreach-sent');
  equal('«Indietro»: nessuna scrittura', writes().length, writesBeforeLaMora);
  check('«Indietro»: scelte conservate', (await text('#outreach-recipients')).includes('Tolti dal CC:eventi@agriturismo-lamora.test'));
  await panel.click('#outreach-sent');
  await panel.waitForSelector('#outreach-verify');
  check('di nuovo la verifica: casella ancora vuota', !(await panel.isChecked('#outreach-sent-check')));
  await panel.check('#outreach-sent-check');
  check('casella spuntata: conferma finale attiva', await panel.isEnabled('#outreach-confirm'));
  const verifiedRecipients = await text('#outreach-verify-recipients');
  const patchesBeforeLaMora = fake.state.requests.filter((q) => q.method === 'PATCH').length;
  const tasksBeforeLaMora = fake.state.requests.filter((q) => q.method === 'POST' && q.path === '/crm/objects/2026-09/tasks').length;
  await panel.evaluate(() => {
    const button = document.querySelector('#outreach-confirm');
    button.click();
    button.click(); // doppio clic
  });
  check('pulsante disattivato subito', await panel.evaluate(() => !document.querySelector('#outreach-confirm') || document.querySelector('#outreach-confirm').disabled));
  await panel.waitForFunction(() => document.querySelector('#outreach-follow-up')?.textContent.includes('Follow-up programmato'), null, { timeout: 15000 });
  equal('doppio clic: una sola scrittura dell\'Azienda', fake.state.requests.filter((q) => q.method === 'PATCH').length - patchesBeforeLaMora, 1);
  equal('doppio clic: un solo task', fake.state.requests.filter((q) => q.method === 'POST' && q.path === '/crm/objects/2026-09/tasks').length - tasksBeforeLaMora, 1);
  const laMora = fake.state.companies.find((c) => c.id === created.id).properties;
  equal('Azienda: Lead Status ATTEMPTED_TO_CONTACT', laMora.hs_lead_status, 'ATTEMPTED_TO_CONTACT');
  check('Azienda: data primo invio = ora', Math.abs(Date.parse(laMora.data_del_primo_invio_email) - Date.now()) < 120000, laMora.data_del_primo_invio_email);
  equal('email all\'Azienda: data del Contatto non toccata', contactRecord.properties.data_primo_invio_email_al_contatto, undefined);
  const laMoraTask = fake.tasksOf('companies', created.id)[0];
  equal('task: titolo', laMoraTask.properties.hs_task_subject, 'FOLLOW-UP | Agriturismo La Mora');
  equal('task: note', laMoraTask.properties.hs_task_body, 'Primo follow-up dopo email commerciale Agria System.');
  equal('task: tipo, stato, priorità', [laMoraTask.properties.hs_task_type, laMoraTask.properties.hs_task_status, laMoraTask.properties.hs_task_priority].join(), 'CALL,NOT_STARTED,NONE');
  equal('task: scadenza +2 giorni lavorativi alle 14:30', laMoraTask.properties.hs_timestamp, new Date(expected.dueAt).toISOString());
  equal('task: promemoria 30 minuti prima', laMoraTask.properties.hs_task_reminders, String(expected.reminderAt));
  equal('task: owner', laMoraTask.properties.hubspot_owner_id, ALESSANDRO.hubspotOwnerId);
  equal('task: associato solo all\'Azienda', fake.state.taskLinks.filter((l) => l.taskId === laMoraTask.id).map((l) => `${l.kind}:${l.typeId}`).join(), 'companies:192');
  const doneView = await text('#outreach-body');
  for (const part of ['✓ Primo contatto registrato', 'Stato lead: Primo contatto inviato', 'Data primo invio Azienda: ', 'Destinatario: Azienda — info@agriturismo-lamora.test', 'CC: prenotazioni@agriturismo-lamora.test', '✓ Follow-up programmato', `${formatDue(expected.dueAt)} · assegnato a ${ALESSANDRO.name}`]) includes(`esito: ${part}`, doneView, part);
  // destinatari mostrati nella verifica = destinatari registrati dall'operazione
  const recorded = await panel.evaluate((id) => chrome.storage.session.get('hubspotSession').then((r) => r.hubspotSession.real.outreach[id].recipient), created.id);
  equal('registrati: A', recorded.to, 'info@agriturismo-lamora.test');
  equal('registrati: CC (senza quello tolto)', JSON.stringify(recorded.cc), JSON.stringify(['prenotazioni@agriturismo-lamora.test', 'maria.bianchi@agriturismo-lamora.test']));
  equal('registrati: prima email aziendale', recorded.type, 'company');
  await panel.waitForFunction((n) => Number(document.querySelector('#daily-count').textContent) === n, countBeforeLaMora + 1, { timeout: 5000 }).catch(() => {});
  equal('contatore: +1 dopo la registrazione del primo contatto', Number((await text('#daily-count')).trim()), countBeforeLaMora + 1);
  equal('verifica = registrazione', verifiedRecipients.replace(/\s+/g, ''), `A:${recorded.to}CC:${recorded.cc.join('')}`);
  check('HubSpot: nessuna proprietà per i CC', fake.state.requests.filter((q) => q.method === 'PATCH').slice(-1).every((q) => !JSON.stringify(q.body).includes('prenotazioni@')));
  check('il focus passa all\'esito', await panel.evaluate(() => document.activeElement?.classList.contains('fb')));
  equal('esito annunciato ai lettori di schermo', (await text('#outreach-live')).trim(), `Primo contatto registrato. Follow-up programmato per ${formatDue(expected.dueAt)}.`);
  await panel.locator('#view-outreach').screenshot({ path: path.join(OUT, '10b-outreach-follow-up.png') });
  // Azienda ormai contattata, Contatto HubSpot senza data: nessuna registrazione parziale del Contatto
  check('Azienda contattata: nessun «Registra email inviata a Maria Bianchi»', !doneView.includes('Registra email inviata') && !doneView.includes('Hai scritto anche') && !(await panel.$('#outreach-contact-date')));
  equal('Azienda contattata: data del Contatto ancora vuota', contactRecord.properties.data_primo_invio_email_al_contatto, undefined);
  console.log('\nCronologia di oggi (Alessandro): Aziende registrate davvero, link ai record HubSpot');
  await panel.waitForFunction(() => document.querySelector('#daily-history-toggle').textContent.includes('(2)'), null, { timeout: 5000 }).catch(() => {});
  equal('«Vedi aziende contattate (2)»', await historyLabel(), 'Vedi aziende contattate (2)');
  check('cronologia chiusa all\'inizio', await panel.isHidden('#daily-history'));
  await panel.click('#daily-history-toggle');
  check('cronologia aperta', await panel.isVisible('#daily-history'));
  equal('cronologia: titolo', (await text('#daily-history-title')).trim(), 'Cronologia di oggi');
  const historyRows = await panel.$$eval('#daily-history-list .daily-entry', (li) => li.map((x) => ({
    id: x.dataset.companyId, time: x.querySelector('.daily-time').textContent, company: x.querySelector('.daily-company').textContent.replace(' ↗', ''),
    href: x.querySelector('a.daily-company')?.href || '', target: x.querySelector('a.daily-company')?.target || '',
    contact: x.querySelector('.daily-contact')?.textContent.replace(' ↗', '') || '', contactHref: x.querySelector('a.daily-contact')?.href || '',
  })));
  equal('cronologia: la più recente in alto, solo Aziende registrate', JSON.stringify(historyRows.map((r) => [r.id, r.company])), JSON.stringify([[created.id, 'Agriturismo La Mora'], [existingCompany, 'Cantina Rossi']]));
  const romeNow = (ms) => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
  check('cronologia: ora italiana della conferma', [romeNow(Date.now()), romeNow(Date.now() - 60000), romeNow(Date.now() - 120000)].includes(historyRows[0].time), historyRows[0].time);
  equal('cronologia: link al record dell\'Azienda (dato da HubSpot)', historyRows[0].href, created.url);
  equal('cronologia: il link apre una nuova scheda', historyRows[0].target, '_blank');
  equal('cronologia: Contatto già noto sotto l\'Azienda', historyRows[0].contact, 'Maria Bianchi — Titolare');
  equal('cronologia: link al record del Contatto', historyRows[0].contactHref, contactRecord.url);
  equal('cronologia: Contatto trovato in HubSpot (Cantina Rossi)', historyRows[1].contact, 'Mario Rossi');
  equal('cronologia: nessuna correzione a mano', await panel.isHidden('#daily-history-manual'), true);
  const [recordTab] = await Promise.all([context.waitForEvent('page'), panel.click('#daily-history-list .daily-entry a.daily-company')]);
  await recordTab.waitForLoadState('domcontentloaded').catch(() => {});
  equal('clic sul nome: il record HubSpot in una nuova scheda', hubspotRecordsOpened.at(-1), created.url);
  await recordTab.close();
  await panel.bringToFront();
  check('il pannello resta aperto', !panel.isClosed());
  check('nessuna modifica al Contatto', fake.state.requests.filter((q) => q.method === 'PATCH').every((q) => !q.path.includes('/contacts/')));
  await panel.setViewportSize({ width: 320, height: 900 });
  check('cronologia aperta: nessuno scroll orizzontale (320 px)', await noHorizontalScroll());
  await panel.screenshot({ path: path.join(OUT, '11-cronologia-di-oggi-320.png') });
  await panel.setViewportSize({ width: 400, height: 900 });
  check('cronologia aperta: nessuno scroll orizzontale (400 px)', await noHorizontalScroll());
  await panel.click('#daily-history-close');
  check('«Chiudi»: cronologia chiusa', await panel.isHidden('#daily-history'));
  // riapertura del pannello: niente voci nuove
  await panel.reload();
  await panel.waitForSelector('#app:not([hidden])');
  await panel.waitForFunction(() => document.querySelector('#daily-history-toggle').textContent.includes('('), null, { timeout: 5000 }).catch(() => {});
  equal('riapertura del pannello: stessa cronologia', await historyLabel(), 'Vedi aziende contattate (2)');
  // Home: follow-up programmato; Home → Outreach → Scout → Home senza perdere nulla
  await panel.click('#nav-home');
  for (const part of ['Follow-up programmato', `Agriturismo La Mora: ${formatDue(expected.dueAt)} · ${ALESSANDRO.name}.`]) includes(`Home: ${part}`, await text('#next-step'), part);
  await panel.click('#nav-outreach');
  await waitRead();
  includes('di nuovo in Outreach: esito conservato', await text('#outreach-body'), 'Follow-up programmato');
  await panel.click('#nav-scout');
  equal('Scout: dati intatti', await value('company-name'), companyBefore);
  includes('Scout: Azienda creata ancora lì', await text('#company-step'), '✓ Azienda creata in HubSpot');
  await panel.click('#nav-home');
  includes('Home: ancora «Follow-up programmato»', await text('#next-step'), 'Follow-up programmato');
  await panel.reload();
  await panel.waitForSelector('#app:not([hidden])');
  await panel.click('#nav-outreach');
  await waitRead();
  includes('pannello riaperto: esito conservato (sessione)', await text('#outreach-body'), 'Follow-up programmato');
  check('pannello riaperto: nessun «Registra email inviata…»', !(await panel.$('#outreach-contact-date')));
  equal('pannello riaperto: nessuna nuova scrittura', fake.tasksOf('companies', created.id).length, 1);
  await panel.click('#nav-scout');

  console.log('\nHubSpot REALE: chiave rifiutata durante il lavoro, poi rimossa');
  fake.force('POST', /companies\/search$/, fake.response.error(401, 'expired'));
  await press('#verify');
  await panel.waitForFunction(() => document.querySelector('#verify-result').textContent.includes('Service Key non valida o ruotata.'), null, { timeout: 15000 });
  includes('401 durante la verifica', await text('#verify-result'), 'Service Key non valida o ruotata.');
  check('401: Verifica HubSpot disattivata', await panel.waitForFunction(() => document.querySelector('#verify').disabled, null, { timeout: 5000 }).then(() => true, () => false));
  check('modalità reale ferma fino a un nuovo test', await blockerIs('Connessione HubSpot non verificata: nelle Impostazioni premi «Testa connessione».'), await blocker());
  await options.click('#remove-key');
  equal('rimozione: chiede conferma', (await options.textContent('#remove-key')).trim(), 'Conferma rimozione');
  await options.click('#remove-key');
  check('chiave rimossa', await lineIs('#key-status', 'Nessuna Service Key configurata.'));
  check('chiave rimossa: «Configura la Service Key nelle Impostazioni.»', await blockerIs('Configura la Service Key nelle Impostazioni.'), await blocker());
  check('ogni richiesta verso HubSpot è passata dal finto server', fake.state.requests.length > 0);
  check('solo endpoint 2026-09', fake.state.requests.every((q) => /^\/crm\/(objects|properties)\/2026-09\//.test(q.path)), JSON.stringify(fake.state.requests.map((q) => q.path)));
  check('nessuna cancellazione', fake.state.requests.every((q) => q.method !== 'DELETE'));
  check('modifiche solo su stato e date di primo invio', fake.state.requests.filter((q) => q.method === 'PATCH').every((q) => Object.keys(q.body.properties).every((k) => ['hs_lead_status', 'data_del_primo_invio_email', 'data_primo_invio_email_al_contatto'].includes(k))));

  console.log('\nBase giuridica di sessione: il cambio di commerciale la azzera');
  check('base di sessione attiva prima del cambio', await panel.isChecked('#session-legal-basis'));
  await panel.click('#change-operator');
  await panel.click(`#operator-list .operator[data-owner-id="${MATTEO.hubspotOwnerId}"]`);
  await panel.waitForFunction(() => !document.querySelector('#session-legal-basis').checked, null, { timeout: 5000 }).catch(() => {});
  check('nuovo commerciale: base da confermare di nuovo', !(await panel.isChecked('#session-legal-basis')));
  equal('nessuna conferma in sessione', await panel.evaluate(() => chrome.storage.session.get('legalBasisDefault').then((r) => r.legalBasisDefault ?? null)), null);

  console.log('\nContatore di oggi: per commerciale, correzione a mano, mai negativo');
  const dailyCount = async () => Number((await text('#daily-count')).trim());
  await panel.waitForFunction(() => document.querySelector('#daily-count').textContent.trim() === '0', null, { timeout: 5000 }).catch(() => {});
  equal('Matteo: il suo contatore (quello di Alessandro resta suo)', await dailyCount(), 0);
  includes('obiettivo 20', await text('#daily-target'), '/ 20');
  check('a zero: «−» disattivato', await panel.isDisabled('#daily-minus'));
  const pressCounter = async (sel, expected) => {
    await panel.click(sel);
    await panel.waitForFunction((n) => Number(document.querySelector('#daily-count').textContent) === n, expected, { timeout: 5000 }).catch(() => {});
  };
  await pressCounter('#daily-plus', 1);
  await pressCounter('#daily-plus', 2);
  await pressCounter('#daily-plus', 3);
  await pressCounter('#daily-minus', 2);
  equal('correzione a mano: +3 −1', await dailyCount(), 2);
  equal('Matteo: cronologia sua (vuota), le Aziende di Alessandro non ci sono', (await text('#daily-history-toggle')).trim(), 'Vedi aziende contattate (0)');
  await panel.click('#daily-history-toggle');
  includes('cronologia vuota: nessuna Azienda inventata', await text('#daily-history-list'), 'Nessuna Azienda registrata oggi con Agria Commercial.');
  equal('correzione a mano mostrata a parte', (await text('#daily-history-manual')).trim(), '+2 aggiunte manualmente');
  await panel.click('#daily-history-close');
  // 20 è un obiettivo, non un limite
  for (let n = 3; n <= 21; n += 1) await pressCounter('#daily-plus', n);
  equal('«+» oltre 20: 21 / 20', await dailyCount(), 21);
  includes('obiettivo invariato', await text('#daily-target'), '/ 20');
  check('«+» ancora attivo oltre 20', await panel.isEnabled('#daily-plus'));
  for (let n = 20; n >= 2; n -= 1) await pressCounter('#daily-minus', n);
  equal('di nuovo 2', await dailyCount(), 2);
  const stored = await panel.evaluate(() => chrome.storage.local.get('dailyOutreachCounts').then((r) => r.dailyOutreachCounts || {}));
  const today = Object.keys(stored[MATTEO.hubspotOwnerId] || {}).at(-1);
  equal('in chrome.storage.local per commerciale e giorno', stored[MATTEO.hubspotOwnerId]?.[today]?.count, 2);
  check('Alessandro: i suoi primi contatti di oggi, separati', (stored[ALESSANDRO.hubspotOwnerId]?.[today]?.count ?? 0) >= 2 && (stored[ALESSANDRO.hubspotOwnerId]?.[today]?.companies || []).length >= 2, JSON.stringify(stored));
  check('mai nello storage di sessione', !JSON.stringify(await panel.evaluate(() => chrome.storage.session.get(null))).includes('dailyOutreachCounts'));
  await panel.setViewportSize({ width: 320, height: 900 });
  check('contatore: nessuno scroll orizzontale (320 px)', await noHorizontalScroll());
  await panel.setViewportSize({ width: 400, height: 900 });

  console.log('\nImpostazioni: «← Torna ad Agria Commercial» non chiude mai Chrome (Patch 0.4.1)');
  const backStatus = (page) => page.waitForFunction(() => !document.querySelector('#back-status').hidden, null, { timeout: 10000 })
    .then(() => page.textContent('#back-status'), () => '');
  const BACK_OK = 'Agria Commercial è aperto nel pannello laterale.';
  const BACK_FAILED = 'Non è stato possibile riaprire il pannello da qui.';
  // 1. «Impostazioni» dal pannello (Chrome riusa la scheda già aperta), poi «Torna»
  const settingsUrl = `chrome-extension://${extId}/options/options.html`;
  await panel.click('#open-settings');
  let returnTab = null;
  for (let i = 0; i < 50 && !returnTab; i += 1) {
    returnTab = await panel.evaluate(() => chrome.storage.session.get('settingsReturn').then((r) => r.settingsReturn || null));
    if (!returnTab) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  check('il pannello registra la scheda di ritorno (solo id, nella sessione)', Number.isInteger(returnTab?.tabId) && Number.isInteger(returnTab?.windowId), JSON.stringify(returnTab));
  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const extra of context.pages().filter((p) => p !== options && p.url() === settingsUrl)) await extra.close(); // un'eventuale seconda scheda
  const openPages = context.pages().length;
  let closed = false;
  options.on('close', () => { closed = true; });
  await options.click('#back');
  const msg1 = (await backStatus(options)).trim();
  check('esito mostrato nella pagina', msg1 === BACK_OK || msg1.startsWith(BACK_FAILED), msg1);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  check('la scheda delle Impostazioni resta aperta', !closed && !options.isClosed());
  equal('nessuna scheda chiusa', context.pages().length, openPages);
  // 2. caso del PC di Alessandro: le Impostazioni sono l'unica scheda della loro finestra
  const [alone] = await Promise.all([
    context.waitForEvent('page'),
    panel.evaluate((u) => chrome.windows.create({ url: u, focused: true }), settingsUrl),
  ]);
  watch(alone, 'impostazioni (finestra sola)');
  await alone.waitForSelector('#back');
  const windowId = await alone.evaluate(() => chrome.tabs.getCurrent().then((t) => t.windowId));
  equal('unica scheda della finestra', await panel.evaluate((id) => chrome.tabs.query({ windowId: id }).then((t) => t.length), windowId), 1);
  let aloneClosed = false;
  alone.on('close', () => { aloneClosed = true; });
  await alone.click('#back');
  const msg2 = (await backStatus(alone)).trim();
  check('finestra sola: esito sicuro mostrato', msg2 === BACK_OK || msg2.startsWith(BACK_FAILED), msg2);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  check('finestra sola: la pagina resta aperta', !aloneClosed && !alone.isClosed());
  check('finestra sola: la finestra di Chrome resta aperta', await panel.evaluate((id) => chrome.windows.get(id).then(() => true, () => false), windowId));
  equal('finestra sola: la scheda c\'è ancora', await panel.evaluate((id) => chrome.tabs.query({ windowId: id }).then((t) => t.length), windowId), 1);
  await alone.screenshot({ path: path.join(OUT, '6b-impostazioni-torna.png') });
  await alone.close();
  check('le Impostazioni di prima restano utilizzabili', !options.isClosed());

  console.log("\nErrori nelle pagine dell'estensione");
  check('nessun errore JavaScript', errors.length === 0, errors.join(' | '));
}

// Chrome chiuso e riaperto con lo stesso profilo: il commerciale attivo (chrome.storage.session) va
// scelto di nuovo, le impostazioni (chrome.storage.local) restano.
async function newSession(context) {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(worker.url()).host;
  const errors = [];
  const panel = await context.newPage();
  panel.on('pageerror', (e) => errors.push(e.message));
  await panel.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`);
  await panel.waitForFunction(() => document.querySelector('#status-text').textContent !== 'Caricamento…');
  check('nuova sessione: «Chi sta usando Agria Commercial?» di nuovo', await panel.isVisible('#operator-picker') && await panel.isHidden('#app'));
  equal('nuova sessione: nessun commerciale attivo', await panel.evaluate(() => chrome.storage.session.get('activeOperator').then((r) => r.activeOperator ?? null)), null);
  equal('nuova sessione: le impostazioni restano', await panel.evaluate(() => chrome.storage.local.get('config').then((r) => r.config.scan.maxPages)), 35);
  await panel.click(`#operator-list .operator[data-owner-id="${MATTEO.hubspotOwnerId}"]`);
  equal('nuova sessione: owner del commerciale scelto', await panel.textContent('#company-hubspot_owner_id'), ownerText(MATTEO));
  await panel.waitForFunction(() => document.querySelector('#daily-count').textContent.trim() !== '–', null, { timeout: 5000 }).catch(() => {});
  equal('nuova sessione: contatore di oggi conservato (chrome.storage.local)', (await panel.textContent('#daily-count')).trim(), '2');
  check('nuova sessione: contatore visibile', await panel.isVisible('#daily-counter'));
  await panel.click('#daily-history-toggle');
  equal('nuova sessione: correzione a mano conservata', (await panel.textContent('#daily-history-manual')).trim(), '+2 aggiunte manualmente');
  await panel.click(`#change-operator`);
  await panel.click(`#operator-list .operator[data-owner-id="${ALESSANDRO.hubspotOwnerId}"]`);
  await panel.waitForFunction(() => document.querySelector('#daily-history-toggle').textContent.includes('(2)'), null, { timeout: 5000 }).catch(() => {});
  equal('nuova sessione: cronologia di Alessandro conservata (chrome.storage.local)', (await panel.textContent('#daily-history-toggle')).trim(), 'Vedi aziende contattate (2)');
  includes('nuova sessione: Aziende di Alessandro', await panel.textContent('#daily-history-list'), 'Agriturismo La Mora');
  check('nuova sessione: si riparte dalla Home', await panel.isVisible('#view-home') && await panel.isHidden('#view-scout'));
  check('nuova sessione: nessun errore JavaScript', errors.length === 0, errors.join(' | '));
}

// ogni richiesta verso api.hubapi.com (dal service worker) va al finto HubSpot, mai al CRM vero
// Gmail: nessuna richiesta esce verso Google. La scheda di composizione riceve una pagina finta e
// l'e2e ne legge solo l'URL (destinatari, oggetto, testo, account).
const gmailOpened = [];
// link ai record HubSpot (cronologia di oggi): pagina finta, nessuna richiesta a hubspot.com
const hubspotRecordsOpened = [];
async function routeHubspotRecords(context) {
  await context.route('https://*.hubspot.com/**', (route) => {
    hubspotRecordsOpened.push(route.request().url());
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: '<!doctype html><title>HubSpot (finto)</title><p>Record finto</p>' });
  });
}

async function routeGmail(context) {
  await context.route('https://mail.google.com/**', (route) => {
    gmailOpened.push(route.request().url());
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: '<!doctype html><title>Gmail (finto)</title><p>Composizione finta</p>' });
  });
}

async function routeHubspot(context, fake) {
  await context.route('https://api.hubapi.com/**', (route) => {
    const req = route.request();
    const res = fake.handle({ method: req.method(), url: req.url(), headers: req.headers(), body: req.postData() || '' });
    return route.fulfill({ status: res.status, headers: res.headers, body: res.body });
  });
}

async function main() {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const { port } = server.address();
  const site = (host, p) => `http://${host}:${port}${p}`;
  const launch = () => chromium.launchPersistentContext(PROFILE, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      // api.hubapi.com e mail.google.com su 127.0.0.1: una richiesta non intercettata fallisce, non arriva fuori
      '--host-resolver-rules=MAP *.test 127.0.0.1, MAP api.hubapi.com 127.0.0.1, MAP mail.google.com 127.0.0.1, MAP *.hubspot.com 127.0.0.1',
      '--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable',
    ],
  });
  const fake = createFakeHubspot({ token: FAKE_KEY });
  let context = await launch();
  try {
    await routeHubspot(context, fake);
    await routeGmail(context);
    await routeHubspotRecords(context);
    await run(context, site, fake);
    await context.close();
    console.log('\nNuova sessione di Chrome (stesso profilo)');
    context = await launch();
    await newSession(context);
  } catch (err) {
    failures.push(`interrotto: ${err.message}`);
    console.error(err);
  } finally {
    await context.close();
    server.close();
  }
  console.log(`\n${passed} controlli superati, ${failures.length} falliti. Schermate in ${path.relative(ROOT, OUT)}`);
  if (failures.length) {
    console.log(failures.map((f) => ` - ${f}`).join('\n'));
    process.exitCode = 1;
  }
}

main();
