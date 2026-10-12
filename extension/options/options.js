// Impostazioni di Agria Scout: proprietario HubSpot, limite della scansione, scenario MOCK.
// Ogni scelta si salva da sola, in questo browser: i campi di testo mentre si scrive (dopo una
// breve pausa) e all'uscita dal campo. Accanto al campo compare «✓ Salvato» per qualche secondo.
// Il pannello aperto si aggiorna da solo.

import { applySetting, loadConfig, saveConfig } from '../lib/config.js';

const form = document.querySelector('#settings');
const saved = document.querySelector('#saved');
const FIELDS = ['mockScenario', 'ownerId', 'ownerName', 'maxPages'];
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
    showMessage('');
    flashSaved(name);
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

// «← Torna ad Agria Scout»: il pannello laterale resta nella finestra; si salva ciò che manca e si
// chiude questa scheda. sidePanel.open va chiamato subito, dentro il clic.
function backToScout(tab) {
  if (tab?.windowId != null) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  const pending = [...typing.keys()];
  for (const name of pending) commit(name, valueOf(name));
  queue.finally(() => {
    if (tab?.id != null) chrome.tabs.remove(tab.id).catch(() => window.close());
    else window.close();
  });
}

async function init() {
  const tab = await chrome.tabs.getCurrent().catch(() => null);
  document.querySelector('#back').addEventListener('click', () => backToScout(tab));
  const config = await loadConfig();
  form.elements.mockScenario.value = config.hubspot.mockScenario;
  form.elements.ownerName.value = config.hubspot.ownerName;
  form.elements.ownerId.value = config.hubspot.ownerId;
  form.elements.maxPages.value = String(config.scan.maxPages);
  form.addEventListener('input', onInput);
  form.addEventListener('change', onChange);
  form.addEventListener('submit', (e) => e.preventDefault());
}

init().catch((err) => showMessage(`Impostazioni non lette: ${err?.message || err}`, true));
