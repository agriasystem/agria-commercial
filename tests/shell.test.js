// Shell di Agria Commercial: Home, navigazione fra i moduli, «Prossimo passo», Outreach.
// La shell non duplica lo stato: il prossimo passo si calcola dalla bozza di Scout e dall'ultima
// risposta di Outreach per quell'Azienda.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSnapshot } from '../extension/lib/parser.js';
import { applyFindings, editField, emptyDraft, setLegalBasisConfirmed, updateHubspot } from '../extension/lib/draft.js';
import { nextStep } from '../extension/lib/nextStep.js';
import { OUTREACH } from '../extension/modules/outreach/outreach.js';
import { TONES } from '../extension/ui/feedback.js';

const EXT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const read = (rel) => fs.readFileSync(path.join(EXT, rel), 'utf8');
const PAGE = analyzeSnapshot({
  url: 'https://www.cantinarossi.it/', title: 'Cantina Rossi', links: [],
  text: { header: '', footer: '', page: 'Cantina Rossi: vini e degustazioni.\nMario Rossi – Titolare · mario.rossi@cantinarossi.it\nVia Roma 1, 06034 Foligno (PG)' },
}, { pageType: 'home' });
const scanned = () => applyFindings(emptyDraft(), PAGE).draft;
const step = (draft, opts) => {
  const s = nextStep(draft, opts);
  return [s.tone, s.title, s.action?.target ?? null];
};
const DUE = Date.parse('2026-10-15T12:30:00Z');
const operation = (patch = {}) => ({
  companyId: 'MOCK-1', companyName: 'Cantina Rossi', recipient: { type: 'company', label: 'Azienda' }, ownerId: '99355637', ownerName: 'Matteo Garuzzo',
  confirmedAt: DUE - 1, dueAt: DUE, steps: { company: 'done', contact: 'none', task: 'done' }, errors: {}, taskId: 'T1', writes: { companyDate: true, contactDate: false }, complete: true, ...patch,
});

test('prossimo passo A: Azienda non ancora in HubSpot → i passi di Scout', () => {
  assert.deepEqual(step(emptyDraft()), ['info', 'Analizza un nuovo prospect', 'scout']);
  const draft = scanned();
  assert.deepEqual(step(draft), ['info', 'Verifica Cantina Rossi in HubSpot', 'scout']);
  const verified = (outcome, matches = []) => updateHubspot(draft, 'mock', { verification: { outcome, matches, mock: true, at: '', message: '' } });
  assert.deepEqual(step(verified('none')), ['info', 'Crea Cantina Rossi in HubSpot', 'scout']);
  assert.deepEqual(step(verified('possible')), ['warning', 'Controlla il possibile duplicato di Cantina Rossi', 'scout']);
  // più aziende certe: non si sa quale sia, si resta in Scout
  assert.deepEqual(step(verified('certain', [{ id: 'A', level: 'certain' }, { id: 'B', level: 'certain' }])), ['blocked', 'Cantina Rossi è già presente in HubSpot', 'scout']);
});

test('prossimo passo B: Azienda in HubSpot e non contattata → «Vai al primo contatto» · Apri Outreach', () => {
  let draft = updateHubspot(scanned(), 'mock', { company: { id: 'MOCK-1', name: 'Cantina Rossi', createdAt: '', mock: true } });
  const created = nextStep(draft);
  assert.deepEqual([created.tone, created.title, created.action], ['info', 'Vai al primo contatto', { label: 'Apri Outreach', target: 'outreach' }]);
  assert.match(created.detail, /^Cantina Rossi è in HubSpot: invia la prima email dal tuo account aziendale, poi registrala in Outreach\. Per scrivere a Mario Rossi, crea prima il Contatto in Scout \(serve la base giuridica\)\.$/);
  assert.doesNotMatch(nextStep(draft, { sessionLegalBasis: true }).detail, /base giuridica/);
  assert.doesNotMatch(nextStep(setLegalBasisConfirmed(draft, true)).detail, /base giuridica/);
  draft = updateHubspot(draft, 'mock', { contact: { id: 'MOCK-C1', name: 'Mario Rossi', createdAt: '', associated: true, mock: true } });
  assert.doesNotMatch(nextStep(draft).detail, /crea prima il Contatto/, 'Contatto già in HubSpot');
  // Azienda già presente (un solo doppione certo): stesso passaggio a Outreach
  const existing = updateHubspot(scanned(), 'real', { verification: { outcome: 'certain', matches: [{ id: '77', level: 'certain', name: 'Cantina Rossi', leadStatus: 'NEW' }], mock: false, at: '', message: '' } });
  assert.deepEqual(step(existing, { mode: 'real' }), ['info', 'Vai al primo contatto', 'outreach']);
  // ogni modalità HubSpot ha il suo stato: in REALE si riparte dalla verifica
  assert.deepEqual(step(draft, { mode: 'real' }), ['info', 'Verifica Cantina Rossi in HubSpot', 'scout']);
});

test('prossimo passo C: primo contatto registrato e follow-up creato → «Follow-up programmato»', () => {
  const draft = updateHubspot(scanned(), 'mock', { company: { id: 'MOCK-1', name: 'Cantina Rossi', createdAt: '', mock: true } });
  const s = nextStep(draft, { outreach: { companyId: 'MOCK-1', operation: operation(), company: null, contacted: true } });
  assert.deepEqual([s.tone, s.title, s.detail, s.action.target], ['success', 'Follow-up programmato', 'Cantina Rossi: giovedì 15/10/2026 alle 14:30 · Matteo Garuzzo.', 'outreach']);
  const partial = nextStep(draft, { outreach: { companyId: 'MOCK-1', operation: operation({ complete: false, steps: { company: 'done', contact: 'none', task: 'error' } }) } });
  assert.deepEqual([partial.tone, partial.title], ['warning', 'Follow-up non creato']);
  const uncertain = nextStep(draft, { outreach: { companyId: 'MOCK-1', operation: operation({ complete: false, steps: { company: 'uncertain', contact: 'none', task: 'pending' } }) } });
  assert.equal(uncertain.title, 'Primo contatto da verificare');
  // la risposta di Outreach di un'altra Azienda non conta
  assert.equal(nextStep(draft, { outreach: { companyId: 'ALTRA', operation: operation() } }).title, 'Vai al primo contatto');
});

test('prossimo passo D: Azienda già contattata → il suo stato, nessun nuovo primo contatto', () => {
  const existing = updateHubspot(scanned(), 'real', { verification: { outcome: 'certain', matches: [{ id: '77', level: 'certain', name: 'Cantina Rossi', leadStatus: 'CONNECTED' }], mock: false, at: '', message: '' } });
  assert.deepEqual(step(existing, { mode: 'real' }), ['info', 'Cantina Rossi risulta già contattata', 'outreach']);
  assert.equal(nextStep(existing, { mode: 'real' }).detail, 'Stato: In contatto.');
  const read = { companyId: '77', operation: null, company: { leadStatus: 'NEW', firstEmailAt: '2026-09-01T08:00:00Z' }, contacted: true };
  assert.equal(nextStep(existing, { mode: 'real', outreach: read }).detail, 'Stato: Da contattare · Primo invio: 01/09/2026, 10:00.', 'la lettura di HubSpot vale più del dato della verifica');
});

test('prossimo passo: legge la bozza senza cambiarla (nessuna seconda copia dello stato)', () => {
  const draft = editField(scanned(), 'company', 'city', 'Montefalco');
  const before = JSON.stringify(draft);
  nextStep(draft, { mode: 'mock', sessionLegalBasis: true, outreach: { companyId: 'x', operation: operation() } });
  assert.equal(JSON.stringify(draft), before);
});

test('Home, navigazione e Outreach nel pannello', () => {
  const html = read('sidepanel/sidepanel.html');
  assert.match(html, /<h1 class="n">AGRIA COMMERCIAL<\/h1>/);
  assert.match(html, /<span class="k">Agria System<\/span>/);
  assert.match(html, /Chi sta usando Agria Commercial\?/);
  assert.deepEqual([...html.matchAll(/<button id="nav-([a-z]+)"/g)].map((m) => m[1]), ['home', 'scout', 'outreach', 'navigator']);
  for (const view of ['home', 'scout', 'outreach']) assert.match(html, new RegExp(`id="view-${view}"`));
  for (const text of ['Trova, analizza e registra nuovi prospect.', 'Gestisci primo contatto e follow-up.', 'Guida operativa durante le chiamate commerciali.', 'Apri Scout', 'Apri Outreach', 'Apri Navigatore']) {
    assert.ok(html.includes(text), text);
  }
  assert.ok(!html.includes('Disponibile prossimamente'));
  assert.match(html, /id="home-outreach" class="btn wide" type="button" data-view="outreach">Apri Outreach</, 'Outreach attivo');
  assert.equal(OUTREACH.available, true);
  assert.equal(OUTREACH.empty, 'Nessun prospect pronto per il primo contatto.');
  // il Navigatore si apre in una scheda, mai dentro il pannello
  assert.ok(!/<iframe/i.test(html));
  assert.match(read('modules/navigator/navigator.js'), /chrome\.tabs\.create\(\{ url: chrome\.runtime\.getURL\(NAVIGATOR_PAGE\)/);
});

test('la shell ricorda solo la vista aperta; il resto dello stato resta nella sua fonte', () => {
  const src = read('shell/shell.js').replace(/^\s*\/\/.*$/gm, '');
  assert.deepEqual([...src.matchAll(/chrome\.storage\.(\w+)/g)].map((m) => m[1]), ['session', 'session'], 'solo storage di sessione');
  assert.match(src, /const VIEW_KEY = 'shellView';/);
  assert.ok(!/draft|hubspotServiceKey|activeOperator|config/.test(src.replace(/@param|nextStep/g, '')), 'nessun dato di Scout, commerciale o configurazione nella shell');
});

test('Outreach, Azienda già contattata: nessuna azione «Registra email inviata…» (Patch 3.0.1)', () => {
  const panel = read('modules/outreach/outreachPanel.js').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/Registra email inviata|Hai scritto anche|outreach-contact-date|outreachContactDate/.test(panel), 'nessun pulsante, nessuna chiamata');
  // vista «già contattata»: solo messaggio, stato e data del primo invio
  const view = panel.slice(panel.indexOf('function contactedView'), panel.indexOf('function render('));
  for (const text of ['Questa Azienda risulta già contattata.', 'Stato attuale', 'Data primo invio']) assert.ok(view.includes(text), text);
  assert.ok(!/el\('button'/.test(view), 'nessun pulsante nella vista');
  // la logica interna resta nel service worker, per una milestone futura
  assert.match(read('lib/hubspotService.js'), /async outreachContactDate\(\{ companyId, contactId \}\)/);
});

test("Outreach, Azienda non contattata: Invia da, A/CC, email pronta in Gmail, «Ho inviato l'email», verifica, conferma", () => {
  const panel = read('modules/outreach/outreachPanel.js');
  for (const text of [
    'Invia da', 'Destinatari prima email', 'A:', 'CC:', 'Togli', 'Rimetti', 'Email di primo contatto', 'Oggetto: ',
    'Apri email pronta in Gmail', 'Dopo averla inviata da Gmail, torna qui.', "Ho inviato l'email",
    'Verifica prima di registrare il contatto', 'Confermando, Agria Commercial registrerà il primo contatto in HubSpot e programmerà il follow-up.',
    "Confermo di aver realmente inviato l'email ai destinatari indicati.", 'Conferma invio e crea follow-up', 'Indietro', 'Cosa succederà',
    'Riprova creazione follow-up',
  ]) assert.ok(panel.includes(text), text);
  assert.ok(!panel.includes('Conferma email inviata e crea follow-up'), "il vecchio pulsante a un clic non c'è più");
  for (const action of ['outreachRead', 'outreachConfirm', 'outreachRetry']) assert.match(panel, new RegExp(`call\\('${action}'`), action);
  // l'unica chiamata che scrive parte dal pulsante finale, con la conferma esplicita e i destinatari verificati
  const code = panel.replace(/^\s*\/\/.*$/gm, '');
  assert.equal([...code.matchAll(/call\('outreachConfirm'/g)].length, 1);
  const confirm = code.slice(code.indexOf('async function onConfirm('), code.indexOf('async function onRetry('));
  assert.match(confirm, /if \(!p \|\| !plan \|\| !sentChecked \|\| busy\) return;/);
  assert.match(confirm, /sentConfirmed: true/);
  assert.match(confirm, /recipient: \{ type: 'company', email: plan\.to, cc: \[\.\.\.plan\.cc\] \}/, "la prima email è sempre dell'Azienda");
  for (const fn of ['onOpenGmail', 'onSent', 'onBack']) {
    const body = panel.match(new RegExp(String.raw`function ${fn}\(\) \{[\s\S]*?\r?\n  \}\r?\n`))?.[0] || '';
    assert.ok(body.length > 0, `${fn}: corpo trovato`);
    assert.ok(!/call\(|sendMessage|outreachConfirm|dailyCount/.test(body), `${fn}: nessuna chiamata al service worker (nessuna scrittura, nessun conteggio)`);
  }
  // Gmail: URL da lib/gmail.js con l'account del commerciale attivo e il testo di config/outreachTemplates.js
  const gmail = panel.match(/function onOpenGmail\(\) \{[\s\S]*?\r?\n  \}\r?\n/)[0];
  assert.match(gmail, /gmailComposeUrl\(\{ account: operator\.email, to: plan\.to, cc: plan\.cc, subject: mail\.subject, body: mail\.body \}\)/);
  assert.match(gmail, /chrome\.tabs\.create\(\{ url, active: true \}\)/);
  // nessun indirizzo email scritto nel modulo Outreach né nella sua logica: vengono dal registro e dalla bozza
  for (const file of ['modules/outreach/outreachPanel.js', 'modules/outreach/outreach.js', 'lib/outreach.js', 'lib/gmail.js', 'config/outreachTemplates.js']) {
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // i commenti possono fare esempi
    assert.ok(!/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(source), `${file}: email scritta nel codice`);
  }
});

test('esiti: cinque toni fissi, ciascuno con un\'icona', () => {
  assert.deepEqual(Object.keys(TONES), ['success', 'warning', 'blocked', 'error', 'info']);
  assert.deepEqual(Object.values(TONES), ['✓', '⚠', '⛔', '✕', 'ℹ']);
  // nessun vecchio riquadro ad hoc: tutti gli esiti HubSpot passano dal componente
  assert.ok(!/class: 'result'/.test(read('sidepanel/hubspotPanel.js')));
});
