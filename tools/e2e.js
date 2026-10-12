// Prova end-to-end di Agria Scout nel Chromium di Playwright.
//
// Carica l'estensione vera, serve in locale le pagine di prova di tests/fixtures con domini
// finti (*.test) e ripercorre il lavoro del commerciale: analisi della home, correzione a mano,
// pagina Contatti dello stesso sito, Verifica HubSpot nei tre scenari MOCK, nuovo prospect,
// cambio di contatto, ripresa dopo la riapertura del pannello, Svuota. Controlla anche che la
// pagina analizzata non venga modificata. Schermate in .tmp/e2e/.
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, 'extension');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
const OUT = path.join(ROOT, '.tmp', 'e2e');
const PROFILE = path.join(ROOT, '.tmp', 'e2e-profile');
const SITES = {
  'agriturismo-lamora.test': { '/': 'agriturismo-home.html', '/contatti': 'agriturismo-contatti.html' },
  'cantinarossi.test': { '/contatti': 'cantina-contatti.html' },
};

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

function startServer() {
  const server = http.createServer((req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    const file = SITES[host]?.[req.url.split('?')[0]];
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('non trovato');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(FIXTURES, file)));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function run(context, site) {
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
      if (m.type() === 'error' && !/fonts\.g(oogleapis|static)\.com|ERR_(INTERNET|NAME|CONNECTION)/.test(m.text())) errors.push(`${name}: ${m.text()}`);
    });
  };
  const panel = await context.newPage();
  watch(panel, 'pannello');
  await panel.setViewportSize({ width: 380, height: 900 });
  await panel.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`);
  await panel.waitForSelector('#company-name');
  await panel.waitForFunction(() => document.querySelector('#status').dataset.state === 'idle');

  const value = (id) => panel.inputValue(`#${id}`);
  const text = (sel) => panel.textContent(sel);
  const press = (sel) => panel.$eval(sel, (b) => b.click());
  const shot = async (name) => {
    await panel.bringToFront();
    await panel.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  };
  async function analyze(tab) {
    await tab.bringToFront();
    await press('#analyze');
    await panel.waitForFunction(() => document.querySelector('#status').dataset.state !== 'busy', null, { timeout: 15000 });
    return { state: await panel.getAttribute('#status', 'data-state'), text: await text('#status-text') };
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

  console.log('\nIntestazione e stato MOCK');
  check('intestazione AGRIA SCOUT', (await text('header')).includes('AGRIA SCOUT'));
  check('badge MOCK visibile in alto', await panel.isVisible('header .badge.mock'));
  equal('scenario MOCK iniziale', await text('#mock-scenario'), 'Azienda non presente');

  console.log('\nPagina che non è un sito web');
  let r = await analyze(panel);
  equal('stato di errore', r.state, 'error');
  check('messaggio chiaro', r.text.includes('non è un sito web'), r.text);

  console.log('\nHome del prospect (JSON-LD)');
  const home = await openTab(site('agriturismo-lamora.test', '/'));
  const htmlBefore = await home.content();
  await home.evaluate(() => {
    window.__agriaMutations = 0;
    new MutationObserver((list) => { window.__agriaMutations += list.length; })
      .observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  r = await analyze(home);
  equal('analisi completata', r.state, 'ok');
  check('testo di stato', r.text.startsWith('Analisi completata'), r.text);
  equal('nome azienda', await value('company-name'), 'Agriturismo La Mora');
  equal('sito web', await value('company-website'), site('agriturismo-lamora.test', ''));
  equal('dominio', await value('company-domain'), 'agriturismo-lamora.test');
  equal('email azienda (non PEC, non agenzia)', await value('company-email'), 'info@agriturismo-lamora.test');
  equal('telefono (non fax)', await value('company-phone'), '+39 0758123456');
  equal('indirizzo', await value('company-address'), 'Via delle Querce 14, 06081 Assisi (PG)');
  equal('città', await value('company-city'), 'Assisi');
  equal('regione', await value('company-region'), 'Umbria');
  check('fonte mostrata', (await text('#company-name-meta')).includes('JSON-LD'));
  equal('nessun contatto inventato', await value('contact-firstName'), '');
  check('avviso sul JSON-LD rotto', (await text('#status-notes')).includes('dati strutturati non era leggibile'));
  equal('nessuna modifica al DOM della pagina', await home.evaluate(() => window.__agriaMutations), 0);
  check('HTML della pagina identico', (await home.content()) === htmlBefore);
  await shot('1-home-analizzata');

  console.log('\nCorrezione a mano');
  await panel.fill('#company-city', 'Santa Maria degli Angeli');
  check('campo segnato come modificato', (await text('#company-city-meta')).includes('Modificato a mano'));
  await panel.fill('#company-email', 'non-una-email');
  await panel.$eval('#company-email', (i) => i.blur());
  check('avviso su email non valida', (await text('#company-email-meta')).includes('Email non valida'));
  await panel.fill('#company-email', 'info@agriturismo-lamora.test');

  console.log('\nPagina Contatti dello stesso sito');
  await home.goto(site('agriturismo-lamora.test', '/contatti'));
  r = await analyze(home);
  equal('analisi completata', r.state, 'ok');
  check('dati integrati', r.text.startsWith('Pagina aggiunta'), r.text);
  equal('correzione a mano conservata', await value('company-city'), 'Santa Maria degli Angeli');
  equal('telefono azienda invariato', await value('company-phone'), '+39 0758123456');
  equal('contatto: nome', await value('contact-firstName'), 'Maria');
  equal('contatto: cognome', await value('contact-lastName'), 'Bianchi');
  equal('contatto: ruolo', await value('contact-role'), 'Titolare');
  equal('contatto: email', await value('contact-email'), 'maria.bianchi@agriturismo-lamora.test');
  equal('contatto: LinkedIn', await value('contact-linkedin'), 'https://www.linkedin.com/in/maria-bianchi-lamora/'.replace(/\/$/, ''));
  check('cellulare proposto come alternativa', (await text('#contact-phone-field .alts')).includes('+39 333 123 4567'));
  check('contatto da verificare', (await text('#contact-firstName-meta')).includes('da verificare'));

  console.log('\nVerifica HubSpot (MOCK)');
  let v = await verify();
  check('pulsante disattivato durante la verifica (niente doppio invio)', v.disabled);
  equal('scenario "non presente"', v.kind, 'not_found');
  check('esito dichiarato come simulato', v.text.includes('MOCK'));
  await shot('2-contatti-e-verifica');

  const options = await context.newPage();
  watch(options, 'impostazioni');
  await options.goto(`chrome-extension://${extId}/options/options.html`);
  await options.waitForFunction(() => document.querySelector('input[name="mockScenario"]:checked'));
  check('impostazioni: scenario iniziale', await options.isChecked('input[value="not_found"]'));
  check('impostazioni: HubSpot reale non attivabile', await options.isDisabled('input[name="mode"][value="real"]'));
  await options.check('input[value="found"]');
  await options.waitForFunction(() => document.querySelector('#saved').textContent.includes('salvate'));
  await options.screenshot({ path: path.join(OUT, '3-impostazioni.png'), fullPage: true });
  await panel.waitForFunction(() => document.querySelector('#mock-scenario').textContent === 'Azienda già presente');
  check('il pannello vede subito il nuovo scenario', true);
  v = await verify();
  equal('scenario "già presente"', v.kind, 'found');
  check('azienda simulata con il dominio', v.text.includes('agriturismo-lamora.test') && v.text.includes('MOCK-1001'), v.text);
  await shot('4-verifica-gia-presente');

  await options.check('input[value="error"]');
  await panel.waitForFunction(() => document.querySelector('#mock-scenario').textContent === 'Errore HubSpot');
  v = await verify();
  equal('scenario "errore"', v.kind, 'error');
  check('messaggio di errore chiaro', v.text.includes('Errore simulato'), v.text);
  await options.check('input[value="not_found"]');
  await panel.waitForFunction(() => document.querySelector('#mock-scenario').textContent === 'Azienda non presente');

  await panel.fill('#company-domain', 'dominio non valido');
  v = await verify();
  equal('dominio non valido: niente verifica', v.kind, 'warn');
  await panel.fill('#company-domain', 'agriturismo-lamora.test');

  console.log('\nNuovo prospect (altro sito, senza JSON-LD)');
  const cantina = await openTab(site('cantinarossi.test', '/contatti'));
  r = await analyze(cantina);
  equal('analisi completata', r.state, 'ok');
  check('nuovo prospect', r.text.startsWith('Analisi completata'), r.text);
  equal('nome dal titolo', await value('company-name'), 'Cantina Rossi');
  equal('dominio', await value('company-domain'), 'cantinarossi.test');
  equal('correzioni del prospect precedente rimosse', await value('company-city'), 'Foligno');
  equal('email', await value('company-email'), 'info@cantinarossi.test');
  equal('telefono', await value('company-phone'), '+39 0742123456');
  equal('indirizzo su più righe', await value('company-address'), 'Via Roma, 12, 06034 Foligno (PG)');
  equal('regione', await value('company-region'), 'Umbria');
  equal('contatto: titolare', `${await value('contact-firstName')} ${await value('contact-lastName')} · ${await value('contact-role')}`, 'Mario Rossi · Titolare');
  equal('contatto: email', await value('contact-email'), 'mario.rossi@cantinarossi.test');
  equal('contatto: LinkedIn', await value('contact-linkedin'), 'https://www.linkedin.com/in/mario-rossi-vino');
  check('altra persona proposta', (await text('#people-list')).includes('Luca Verdi'));
  check('verifica precedente azzerata', await panel.isHidden('#verify-result'));
  await shot('5-nuovo-prospect');

  console.log('\nRiapertura del pannello');
  await panel.reload();
  await panel.waitForFunction(() => document.querySelector('#status').dataset.state === 'ok');
  equal('dati ripresi', await value('company-name'), 'Cantina Rossi');
  equal('contatto ripreso', await value('contact-lastName'), 'Rossi');

  console.log('\nScelta di un altro contatto e Svuota');
  await press('#people-list .person');
  equal('nuovo contatto', `${await value('contact-firstName')} ${await value('contact-lastName')}`, 'Luca Verdi');
  equal('ruolo', await value('contact-role'), 'Responsabile commerciale');
  check('il contatto precedente torna in elenco', (await text('#people-list')).includes('Mario Rossi'));
  await press('#clear');
  equal('primo clic: chiede conferma', (await text('#clear')).trim(), 'Conferma svuota');
  equal('dati ancora presenti', await value('company-name'), 'Cantina Rossi');
  await press('#clear');
  equal('secondo clic: svuotato', await value('company-name'), '');
  equal('stato iniziale', await panel.getAttribute('#status', 'data-state'), 'idle');

  console.log('\nErrori nelle pagine dell\'estensione');
  check('nessun errore JavaScript', errors.length === 0, errors.join(' | '));
}

async function main() {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const { port } = server.address();
  const site = (host, p) => `http://${host}:${port}${p}`;
  const context = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--host-resolver-rules=MAP *.test 127.0.0.1',
      '--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable',
    ],
  });
  try {
    await run(context, site);
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
