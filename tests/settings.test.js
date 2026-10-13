// Patch 0.4.1: «← Torna ad Agria Commercial» nelle Impostazioni non chiude mai una scheda né una
// finestra. Caso reale: su un PC le Impostazioni erano l'unica scheda della finestra e il vecchio
// pulsante (chrome.tabs.remove della scheda, poi window.close) chiudeva la finestra di Chrome.
// API di Chrome finte: nessun browser, nessuna rete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACK_MESSAGES, backToAgria, RETURN_ITEM } from '../extension/options/backToAgria.js';

const EXT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const read = (file) => fs.readFileSync(path.join(EXT, file), 'utf8');
const code = (file) => read(file).replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const CLOSING = /window\.close\s*\(|\.close\s*\(\s*\)|tabs\.remove\s*\(|tabs\.discard\s*\(|windows\.remove\s*\(|chrome\.windows\b|self\.close\s*\(/;

function jsFiles(dir = EXT, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) jsFiles(full, out);
    else if (entry.name.endsWith('.js')) out.push(path.relative(EXT, full).split(path.sep).join('/'));
  }
  return out;
}

/** API finte: registrano ogni chiamata; tabs.remove e windows.remove non devono mai essere usate. */
function fakeChrome({ open = 'ok', stored = null } = {}) {
  const calls = { open: [], update: [], remove: [], windowRemove: [] };
  const sidePanel = {
    open(options) {
      calls.open.push(options);
      if (open === 'throw') throw new Error('sidePanel.open non ammesso');
      return open === 'reject' ? Promise.reject(new Error('No active side panel for windowId')) : Promise.resolve();
    },
  };
  const tabs = {
    update: async (id, props) => { calls.update.push([id, props]); return { id }; },
    remove: async (id) => { calls.remove.push(id); },
  };
  const windows = { remove: async (id) => { calls.windowRemove.push(id); } };
  const session = { get: async (key) => (stored && key === RETURN_ITEM ? { [RETURN_ITEM]: stored } : {}) };
  return { api: { sidePanel, tabs, session, windows }, calls };
}
const SETTINGS_TAB = Object.freeze({ id: 41, windowId: 7 });
const nothingClosed = (calls) => calls.remove.length === 0 && calls.windowRemove.length === 0;

test('Impostazioni unica scheda della finestra: riapre il pannello, non chiude nulla', async () => {
  const { api, calls } = fakeChrome();
  const result = await backToAgria(api, SETTINGS_TAB);
  assert.deepEqual(result, { opened: true, returnedTo: null });
  assert.deepEqual(calls.open, [{ windowId: 7 }], 'pannello della finestra delle Impostazioni');
  assert.deepEqual(calls.update, [], 'nessuna altra scheda da riattivare');
  assert.ok(nothingClosed(calls), 'né la scheda né la finestra');
});

test('con la scheda del prospect: pannello aperto e ritorno a quella scheda (solo attivata)', async () => {
  const { api, calls } = fakeChrome({ stored: { tabId: 12, windowId: 7 } });
  assert.deepEqual(await backToAgria(api, SETTINGS_TAB), { opened: true, returnedTo: 12 });
  assert.deepEqual(calls.update, [[12, { active: true }]]);
  assert.ok(nothingClosed(calls));
  // scheda registrata in un'altra finestra: si usa la scheda che ha aperto le Impostazioni, se c'è
  const other = fakeChrome({ stored: { tabId: 99, windowId: 3 } });
  assert.deepEqual(await backToAgria(other.api, { ...SETTINGS_TAB, openerTabId: 15 }), { opened: true, returnedTo: 15 });
  const none = fakeChrome({ stored: { tabId: 99, windowId: 3 } });
  assert.deepEqual(await backToAgria(none.api, SETTINGS_TAB), { opened: true, returnedTo: null });
  // la scheda registrata è proprio quella delle Impostazioni: niente da fare
  const self = fakeChrome({ stored: { tabId: 41, windowId: 7 } });
  assert.deepEqual(await backToAgria(self.api, SETTINGS_TAB), { opened: true, returnedTo: null });
});

test('la scheda del prospect non esiste più: nessun errore, nulla chiuso', async () => {
  const { api, calls } = fakeChrome({ stored: { tabId: 12, windowId: 7 } });
  api.tabs.update = async (id) => { calls.update.push(id); throw new Error(`No tab with id: ${id}.`); };
  assert.deepEqual(await backToAgria(api, SETTINGS_TAB), { opened: true, returnedTo: null });
  assert.ok(nothingClosed(calls));
});

test('pannello non apribile (rifiuto, eccezione, API assente, finestra sconosciuta): la pagina resta aperta', async () => {
  for (const open of ['reject', 'throw']) {
    const { api, calls } = fakeChrome({ open, stored: { tabId: 12, windowId: 7 } });
    assert.deepEqual(await backToAgria(api, SETTINGS_TAB), { opened: false, returnedTo: null }, open);
    assert.deepEqual(calls.update, [], `${open}: si resta sulle Impostazioni`);
    assert.ok(nothingClosed(calls), open);
  }
  const { api, calls } = fakeChrome();
  assert.deepEqual(await backToAgria({ ...api, sidePanel: undefined }, SETTINGS_TAB), { opened: false, returnedTo: null });
  assert.deepEqual(await backToAgria(api, null), { opened: false, returnedTo: null }, 'scheda corrente non letta');
  assert.deepEqual(await backToAgria(api, { id: 41 }), { opened: false, returnedTo: null });
  assert.ok(nothingClosed(calls));
  assert.match(BACK_MESSAGES.failed, /icona nella barra di Chrome/);
  assert.match(BACK_MESSAGES.opened, /pannello laterale/);
});

test('sidePanel.open parte subito, dentro il gesto del clic (nessuna attesa prima)', () => {
  const { api, calls } = fakeChrome();
  const pending = backToAgria(api, SETTINGS_TAB);
  assert.deepEqual(calls.open, [{ windowId: 7 }], 'chiamata sincrona');
  return pending;
});

test('nessun codice dell\'estensione chiude finestre o schede (window.close, tabs.remove, windows.remove)', () => {
  const files = jsFiles().filter((f) => !f.startsWith('modules/navigator/app/')); // copia generata del Navigatore
  assert.ok(files.includes('options/options.js') && files.includes('options/backToAgria.js'));
  for (const file of files) assert.ok(!CLOSING.test(code(file)), `${file}: chiude una scheda o una finestra`);
  for (const file of ['options/options.html', 'sidepanel/sidepanel.html']) assert.ok(!/window\.close|onclick/i.test(read(file)), file);
});

test('il pulsante delle Impostazioni usa backToAgria, subito nel clic', () => {
  const options = code('options/options.js');
  assert.match(options, /addEventListener\('click', \(\) => onBack\(tab\)\)/);
  const handler = options.slice(options.indexOf('function onBack('), options.indexOf('async function init('));
  assert.match(handler, /^function onBack\(tab\) \{\r?\n\s+const going = backToAgria\(/,'prima istruzione del gestore: nessun await prima di sidePanel.open');
  assert.ok(!/await/.test(handler));
  assert.match(read('options/options.html'), /<p id="back-status"[^>]*role="status"/);
  // il pannello registra la scheda di ritorno prima di aprire le Impostazioni
  const panel = code('sidepanel/sidepanel.js');
  assert.match(panel, /\$\('#open-settings'\)\.addEventListener\('click', openSettings\)/);
  assert.match(panel, /chrome\.storage\.session\.set\(\{ \[SETTINGS_RETURN_ITEM\]: \{ tabId: tab\.id, windowId: tab\.windowId \} \}\)/);
});
