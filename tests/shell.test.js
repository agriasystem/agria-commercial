// Shell di Agria Commercial: Home, navigazione fra i moduli, «Prossimo passo», Outreach segnaposto.
// La shell non duplica lo stato: il prossimo passo si calcola dalla bozza di Scout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSnapshot } from '../extension/lib/parser.js';
import { applyFindings, editField, emptyDraft, setLegalBasisConfirmed, updateHubspot } from '../extension/lib/draft.js';
import { scoutNextStep } from '../extension/lib/nextStep.js';
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
  const s = scoutNextStep(draft, opts);
  return [s.tone, s.title, s.action?.target ?? null];
};

test('prossimo passo: dal prospect da analizzare fino all\'azienda salvata, solo con lo stato di Scout', () => {
  assert.deepEqual(step(emptyDraft()), ['info', 'Analizza un nuovo prospect', 'scout']);
  let draft = scanned();
  assert.deepEqual(step(draft), ['info', 'Verifica Cantina Rossi in HubSpot', 'scout']);
  const verified = (outcome) => updateHubspot(draft, 'mock', { verification: { outcome, matches: [], mock: true, at: '', message: '' } });
  assert.deepEqual(step(verified('none')), ['info', 'Crea Cantina Rossi in HubSpot', 'scout']);
  assert.deepEqual(step(verified('possible')), ['warning', 'Controlla il possibile duplicato di Cantina Rossi', 'scout']);
  assert.deepEqual(step(verified('certain')), ['blocked', 'Cantina Rossi è già presente in HubSpot', 'scout']);
  draft = updateHubspot(draft, 'mock', { company: { id: 'MOCK-1', name: 'Cantina Rossi', createdAt: '', mock: true } });
  assert.deepEqual(step(draft), ['info', 'Crea il Contatto per Cantina Rossi', 'scout']);
  assert.match(scoutNextStep(draft).detail, /base giuridica/, 'manca la base giuridica');
  assert.match(scoutNextStep(draft, { sessionLegalBasis: true }).detail, /pronto/);
  assert.match(scoutNextStep(setLegalBasisConfirmed(draft, true)).detail, /pronto/);
  draft = updateHubspot(draft, 'mock', { contact: { id: 'MOCK-C1', name: 'Mario Rossi', createdAt: '', associated: true, mock: true } });
  const done = scoutNextStep(draft);
  assert.deepEqual([done.tone, done.title, done.action], ['success', 'Azienda salvata in HubSpot', null], 'Outreach non c\'è ancora: nessuna azione');
  assert.match(done.detail, /Cantina Rossi: Azienda e Contatto creati/);
  // ogni modalità HubSpot ha il suo stato: in REALE si riparte dalla verifica
  assert.deepEqual(step(draft, { mode: 'real' }), ['info', 'Verifica Cantina Rossi in HubSpot', 'scout']);
});

test('prossimo passo: legge la bozza senza cambiarla (nessuna seconda copia dello stato)', () => {
  const draft = editField(scanned(), 'company', 'city', 'Montefalco');
  const before = JSON.stringify(draft);
  scoutNextStep(draft, { mode: 'mock', sessionLegalBasis: true });
  assert.equal(JSON.stringify(draft), before);
});

test('Home, navigazione e Outreach segnaposto nel pannello', () => {
  const html = read('sidepanel/sidepanel.html');
  assert.match(html, /<h1 class="n">AGRIA COMMERCIAL<\/h1>/);
  assert.match(html, /<span class="k">Agria System<\/span>/);
  assert.match(html, /Chi sta usando Agria Commercial\?/);
  assert.deepEqual([...html.matchAll(/<button id="nav-([a-z]+)"/g)].map((m) => m[1]), ['home', 'scout', 'outreach', 'navigator']);
  for (const view of ['home', 'scout', 'outreach']) assert.match(html, new RegExp(`id="view-${view}"`));
  for (const text of ['Trova, analizza e registra nuovi prospect.', 'Gestisci primo contatto e follow-up.', 'Guida operativa durante le chiamate commerciali.', 'Apri Scout', 'Disponibile prossimamente', 'Apri Navigatore']) {
    assert.ok(html.includes(text), text);
  }
  assert.match(html, /id="home-outreach" class="btn wide" type="button" disabled aria-describedby="home-outreach-note"/, 'Outreach disattivato, con la spiegazione');
  assert.equal(OUTREACH.available, false);
  assert.equal(OUTREACH.message, 'Outreach sarà disponibile nella prossima fase.');
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

test('esiti: cinque toni fissi, ciascuno con un\'icona', () => {
  assert.deepEqual(Object.keys(TONES), ['success', 'warning', 'blocked', 'error', 'info']);
  assert.deepEqual(Object.values(TONES), ['✓', '⚠', '⛔', '✕', 'ℹ']);
  // nessun vecchio riquadro ad hoc: tutti gli esiti HubSpot passano dal componente
  assert.ok(!/class: 'result'/.test(read('sidepanel/hubspotPanel.js')));
});
