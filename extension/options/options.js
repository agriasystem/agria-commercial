// Impostazioni di Agria Commercial: commerciali disponibili (solo lettura), limite della scansione,
// modalità HubSpot (MOCK o reale), Service Key, scenario MOCK. Ogni scelta si salva da sola, in
// questo browser: i campi di testo mentre si scrive (dopo una breve pausa) e all'uscita dal campo.
// Accanto al campo compare «✓ Salvato» per qualche secondo. Il pannello aperto si aggiorna da solo.
//
// Service Key: si manda una volta al service worker con «Salva chiave», poi il campo si svuota.
// Questa pagina non la legge mai dallo storage e non la mostra più, nemmeno in parte.

import { applySetting, loadConfig, notifyConfigChanged, saveConfig } from '../lib/config.js';
import { MESSAGE, STATUS_CHANGED } from '../lib/hubspotMessages.js';
import { loadActiveOperator, onOperatorChange, OPERATORS } from '../lib/operators.js';
import { BACK_MESSAGES, backToAgria } from './backToAgria.js';

const form = document.querySelector('#settings');
const saved = document.querySelector('#saved');
const FIELDS = ['mockScenario', 'maxPages', 'mode'];
const $ = (selector) => document.querySelector(selector);
let removeTimer = null;
const TYPING_PAUSE_MS = 600;
const FLAG_MS = 3000;
// salvataggi in fila: un cambio fatto mentre il precedente è in corso non si perde
let queue = Promise.resolve();
const typing = new Map(); // campo → timer del salvataggio durante la scrittura
const flags = new Map(); // campo → timer di «✓ Salvato»

function showMessage(text, isError = false) {
  saved.textContent = text;
  saved.classList.toggle('err', isError);
}

function flashSaved(name) {
  const flag = document.querySelector(`[data-saved-for="${name}"]`);
  if (!flag) return;
  flag.hidden = false;
  clearTimeout(flags.get(name));
  flags.set(name, setTimeout(() => { flag.hidden = true; }, FLAG_MS));
}

async function save(name, value) {
  try {
    const current = await loadConfig();
    const { config, error } = applySetting(current, name, value);
    if (error) {
      showMessage(error, true);
      return;
    }
    if (JSON.stringify(config) === JSON.stringify(current)) {
      showMessage('');
      return; // nessun cambiamento: niente da salvare
    }
    await saveConfig(config);
    notifyConfigChanged();
    showMessage('');
    flashSaved(name);
    if (name === 'mode') refreshStatus();
  } catch (err) {
    showMessage(`Salvataggio non riuscito: ${err?.message || err}`, true);
  }
}

function commit(name, value) {
  clearTimeout(typing.get(name));
  typing.delete(name);
  queue = queue.then(() => save(name, value));
  return queue;
}

function valueOf(name) {
  const field = form.elements[name];
  return typeof field?.value === 'string' ? field.value : '';
}

function onInput(event) {
  const { name, type } = event.target;
  if (!FIELDS.includes(name) || type === 'radio') return;
  clearTimeout(typing.get(name));
  typing.set(name, setTimeout(() => commit(name, valueOf(name)), TYPING_PAUSE_MS));
}

function onChange(event) {
  const { name } = event.target;
  if (FIELDS.includes(name)) commit(name, event.target.value);
}

// i commerciali del registro (operators.js), con quello attivo in questa sessione di Chrome
function renderOperators(active) {
  const items = OPERATORS.map((o) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'operator-name';
    name.textContent = o.name;
    const id = document.createElement('span');
    id.className = 'operator-id';
    id.textContent = `Owner ID ${o.hubspotOwnerId}`;
    const email = document.createElement('span');
    email.className = 'operator-id';
    email.textContent = o.email || 'email non indicata';
    li.append(name, id, email);
    if (o.hubspotOwnerId === active?.hubspotOwnerId) {
      const chip = document.createElement('span');
      chip.className = 'chip high';
      chip.textContent = 'attivo ora';
      li.append(chip);
    }
    return li;
  });
  document.querySelector('#operators').replaceChildren(...items);
}

// ---- HubSpot reale: Service Key e connessione (tutto passa dal service worker) ----

const hubspot = (action, payload = {}) => chrome.runtime.sendMessage({ type: MESSAGE, action, ...payload })
  .then((r) => r || { ok: false, error: { message: 'Il servizio HubSpot non risponde: ricarica la pagina.' } })
  .catch(() => ({ ok: false, error: { message: 'Il servizio HubSpot non risponde: ricarica la pagina.' } }));

function setLine(selector, text, kind = '') {
  const line = $(selector);
  line.textContent = text;
  line.dataset.kind = kind;
}

function renderStatus(status) {
  const real = status.mode === 'real';
  for (const badge of document.querySelectorAll('[data-mode-badge]')) {
    badge.textContent = real ? 'HubSpot REALE' : 'HubSpot MOCK';
    badge.classList.toggle('real', real);
    badge.classList.toggle('mock', !real);
  }
  setLine('#key-status', status.keyConfigured ? '✓ Service Key configurata' : 'Nessuna Service Key configurata.', status.keyConfigured ? 'ok' : '');
  const c = status.connection || {};
  if (!status.keyConfigured) setLine('#connection-status', '');
  else if (c.state === 'ok') setLine('#connection-status', '✓ Connessione HubSpot riuscita', 'ok');
  else if (c.state === 'failed') setLine('#connection-status', `${c.message || 'Connessione non riuscita.'}${c.code ? ` (codice: ${c.code})` : ''}`, 'error');
  else setLine('#connection-status', 'Connessione non ancora testata: premi «Testa connessione».', 'warn');
  $('#test-connection').disabled = !status.keyConfigured;
  $('#remove-key').disabled = !status.keyConfigured;
  const warning = $('#mode-warning');
  warning.textContent = real ? status.blocker : '';
  warning.hidden = !(real && status.blocker);
}

async function refreshStatus() {
  const res = await hubspot('status');
  if (res.ok) {
    renderStatus(res);
  } else {
    setLine('#key-status', res.error.message, 'error');
  }
}

async function onSaveKey() {
  const input = $('#service-key');
  const key = input.value;
  if (!key.trim()) {
    setLine('#key-status', 'Incolla la Service Key nel campo, poi premi «Salva chiave».', 'error');
    return;
  }
  $('#save-key').disabled = true;
  const res = await hubspot('saveKey', { key });
  $('#save-key').disabled = false;
  if (!res.ok) {
    setLine('#key-status', res.error.message, 'error');
    return;
  }
  input.value = ''; // la chiave non resta nella pagina e non si rivede più
  renderStatus(res);
}

async function onTestConnection() {
  const button = $('#test-connection');
  button.disabled = true;
  button.textContent = 'Test in corso…';
  setLine('#connection-status', 'Test della connessione in corso (sola lettura)…');
  const res = await hubspot('testConnection');
  button.textContent = 'Testa connessione';
  if (res.ok) renderStatus(res);
  else {
    button.disabled = false;
    setLine('#connection-status', res.error.message, 'error');
  }
}

function disarmRemove() {
  clearTimeout(removeTimer);
  removeTimer = null;
  const button = $('#remove-key');
  button.textContent = 'Rimuovi chiave';
  button.classList.remove('armed');
}

// due clic: il primo chiede conferma, il secondo rimuove
async function onRemoveKey() {
  if (!removeTimer) {
    const button = $('#remove-key');
    button.textContent = 'Conferma rimozione';
    button.classList.add('armed');
    removeTimer = setTimeout(disarmRemove, 4000);
    return;
  }
  disarmRemove();
  const res = await hubspot('removeKey');
  if (res.ok) renderStatus(res);
  else setLine('#key-status', res.error.message, 'error');
}

// «← Torna ad Agria Commercial»: riapre il pannello laterale e torna alla scheda del prospect, senza
// chiudere mai questa pagina né la finestra (vedi backToAgria.js). backToAgria va chiamata per prima,
// dentro il clic: sidePanel.open vale solo durante il gesto dell'utente. Poi si salva ciò che manca.
function onBack(tab) {
  const going = backToAgria({ sidePanel: chrome.sidePanel, tabs: chrome.tabs, session: chrome.storage.session }, tab);
  for (const name of [...typing.keys()]) commit(name, valueOf(name));
  going.then(({ opened }) => {
    const line = $('#back-status');
    line.textContent = opened ? BACK_MESSAGES.opened : BACK_MESSAGES.failed;
    line.dataset.kind = opened ? 'ok' : 'warn';
    line.hidden = false;
  });
}

async function init() {
  const tab = await chrome.tabs.getCurrent().catch(() => null);
  document.querySelector('#back').addEventListener('click', () => onBack(tab));
  renderOperators(null);
  onOperatorChange(renderOperators);
  renderOperators(await loadActiveOperator().catch(() => null));
  $('#save-key').addEventListener('click', onSaveKey);
  $('#service-key').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onSaveKey();
  });
  $('#test-connection').addEventListener('click', onTestConnection);
  $('#remove-key').addEventListener('click', onRemoveKey);
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === STATUS_CHANGED) refreshStatus();
  });
  const config = await loadConfig();
  form.elements.mockScenario.value = config.hubspot.mockScenario;
  form.elements.maxPages.value = String(config.scan.maxPages);
  form.elements.mode.value = config.hubspot.mode;
  await refreshStatus();
  form.addEventListener('input', onInput);
  form.addEventListener('change', onChange);
  form.addEventListener('submit', (e) => e.preventDefault());
}

init().catch((err) => showMessage(`Impostazioni non lette: ${err?.message || err}`, true));
