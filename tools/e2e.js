// Prova end-to-end di Agria Scout nel Chromium di Playwright.
//
// Carica l'estensione vera, serve in locale i siti di prova di tests/fixtures con domini finti
// (*.test) e ripercorre il lavoro del commerciale: analisi della pagina aperta, correzione a mano,
// scansione approfondita di tutto il sito (con sitemap, pagine rotte, file non HTML, link verso
// un altro dominio, blog lungo), persone e dati rilevati, Verifica HubSpot nei tre scenari MOCK,
// annullamento, nuovo prospect, ripresa dopo la riapertura del pannello, Svuota, e i due casi
// emersi dai test manuali (La Mora: email attaccata al telefono e host senza cognome; Perticaia:
// alias info@/visit@, cantina, contatto a mano). Impostazioni con salvataggio automatico.
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
  'perticaia-caso.test': { '/': 'caso-perticaia.html' },
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
      // le pagine 404 della scansione sono previste e gestite: Chrome le registra comunque come errori di rete
      if (m.type() === 'error' && !/fonts\.g(oogleapis|static)\.com|ERR_(INTERNET|NAME|CONNECTION)|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`);
    });
  };
  const panel = await context.newPage();
  watch(panel, 'pannello');
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`);
  await panel.waitForSelector('#company-name');
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
  check('intestazione AGRIA SCOUT', (await text('header')).includes('AGRIA SCOUT'));
  check('badge MOCK visibile in alto', await panel.isVisible('header .badge.mock'));
  equal('scenario MOCK iniziale', await text('#mock-scenario'), 'Azienda non presente');
  check('pulsante principale «Scansione approfondita»', (await text('#deep-scan')).trim() === 'Scansione approfondita');
  equal('commerciale attivo non ancora impostato', await text('#active-user'), 'Commerciale attivo: non impostato (vedi Impostazioni)');

  console.log('\nImpostazioni: proprietario HubSpot, limite pagine, salvataggio automatico');
  const options = await context.newPage();
  watch(options, 'impostazioni');
  await options.goto(`chrome-extension://${extId}/options/options.html`);
  await options.waitForFunction(() => document.querySelector('input[name="mockScenario"]:checked'));
  equal('limite pagine predefinito', await options.inputValue('#max-pages'), '30');
  includes('salvataggio automatico dichiarato', await options.textContent('#autosave'), 'Impostazioni salvate automaticamente');
  equal('pulsante per tornare al pannello', (await options.textContent('#back')).trim(), '← Torna ad Agria Scout');
  const flagShown = (name) => options.waitForFunction((n) => !document.querySelector(`[data-saved-for="${n}"]`).hidden, name, { timeout: 5000 }).then(() => true, () => false);
  const flagGone = (name) => options.waitForFunction((n) => document.querySelector(`[data-saved-for="${n}"]`).hidden, name, { timeout: 8000 }).then(() => true, () => false);
  await options.fill('#owner-id', 'abc');
  await options.waitForFunction(() => document.querySelector('#saved').textContent.includes('solo cifre'), null, { timeout: 5000 }).catch(() => {});
  includes('ID owner non numerico rifiutato', await options.textContent('#saved'), 'solo cifre');
  check('valore sbagliato: nessun «✓ Salvato»', await options.$eval('[data-saved-for="ownerId"]', (f) => f.hidden));
  // si scrive e basta, senza uscire dal campo: il salvataggio parte da solo
  await options.fill('#owner-name', 'Commerciale Agria');
  check('nome del commerciale: «✓ Salvato» mentre si scrive', await flagShown('ownerName'));
  equal('testo della conferma', (await options.textContent('[data-saved-for="ownerName"]')).trim(), '✓ Salvato');
  await options.fill('#owner-id', '123456789');
  check('ID owner: «✓ Salvato»', await flagShown('ownerId'));
  equal('errore precedente tolto', (await options.textContent('#saved')).trim(), '');
  await options.screenshot({ path: path.join(OUT, '6-impostazioni.png'), fullPage: true });
  check('«✓ Salvato» sparisce dopo qualche secondo', await flagGone('ownerName'));
  await panel.waitForFunction(() => document.querySelector('#company-hubspot_owner_id').textContent.includes('123456789'));
  includes('proprietario Azienda dalle Impostazioni', await text('#company-hubspot_owner_id'), 'Commerciale Agria · ID 123456789');
  includes('proprietario Contatto dalle Impostazioni', await text('#contact-hubspot_owner_id'), '123456789');
  equal('commerciale attivo nel pannello', await text('#active-user'), 'Commerciale attivo: Commerciale Agria');

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
  equal('paese', await value('company-country'), 'Italia');
  includes('lead status', await text('#company-hs_lead_status'), 'Da contattare (NEW)');
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

  console.log('\nVerifica HubSpot (MOCK)');
  let v = await verify();
  check('pulsante disattivato durante la verifica (niente doppio invio)', v.disabled);
  equal('scenario "non presente"', v.kind, 'not_found');
  includes('esito dichiarato come simulato', v.text, 'MOCK');
  await options.check('input[value="found"]');
  await panel.waitForFunction(() => document.querySelector('#mock-scenario').textContent === 'Azienda già presente');
  v = await verify();
  equal('scenario "già presente"', v.kind, 'found');
  check('azienda simulata con il dominio', v.text.includes('agriturismo-lamora.test') && v.text.includes('MOCK-1001'), v.text);
  await options.check('input[value="error"]');
  await panel.waitForFunction(() => document.querySelector('#mock-scenario').textContent === 'Errore HubSpot');
  v = await verify();
  equal('scenario "errore"', v.kind, 'error');
  includes('messaggio di errore chiaro', v.text, 'Errore simulato');
  await options.check('input[value="not_found"]');
  await panel.waitForFunction(() => document.querySelector('#mock-scenario').textContent === 'Azienda non presente');
  check('impostazioni: HubSpot reale non attivabile', await options.isDisabled('input[name="mode"][value="real"]'));
  await panel.fill('#company-domain', 'dominio non valido');
  v = await verify();
  equal('dominio non valido: niente verifica', v.kind, 'warn');
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
  includes('proprietario resta dalle Impostazioni', await text('#company-hubspot_owner_id'), '123456789');

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

  console.log('\nCaso reale Perticaia: alias funzionali, cantina, contatto inserito a mano');
  const perticaia = await openTab(site('perticaia-caso.test', '/'));
  r = await deepScan(perticaia);
  equal('scansione completata', r.state, 'ok');
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

  console.log('\nImpostazioni: «← Torna ad Agria Scout»');
  const closing = options.waitForEvent('close', { timeout: 10000 }).then(() => true, () => false);
  await options.click('#back').catch(() => {}); // la scheda si chiude durante il clic
  check('la scheda delle Impostazioni si chiude e si torna al pannello', await closing);

  console.log("\nErrori nelle pagine dell'estensione");
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
