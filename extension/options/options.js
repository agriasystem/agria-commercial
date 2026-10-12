// Impostazioni di Agria Scout: proprietario HubSpot, limite della scansione, scenario MOCK.
// Ogni scelta si salva subito (i campi di testo quando si esce dal campo); il pannello aperto
// si aggiorna da solo.

import { loadConfig, saveConfig, SCAN_LIMITS } from '../lib/config.js';

const form = document.querySelector('#settings');
const saved = document.querySelector('#saved');
const FIELDS = ['mockScenario', 'ownerId', 'ownerName', 'maxPages'];
// salvataggi in fila: un cambio fatto mentre il precedente è in corso non si perde
let queue = Promise.resolve();

function showSaved(text, isError = false) {
  saved.textContent = text;
  saved.classList.toggle('err', isError);
}

// controlli sui valori scritti a mano: avvisano e non salvano un valore sbagliato
const CHECKS = {
  ownerId: (v) => (v === '' || /^\d{1,20}$/.test(v) ? '' : "L'ID owner HubSpot contiene solo cifre."),
  maxPages: (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= SCAN_LIMITS.min && n <= SCAN_LIMITS.max ? '' : `Scegli un numero da ${SCAN_LIMITS.min} a ${SCAN_LIMITS.max}.`;
  },
};

async function save(name, value) {
  try {
    const config = await loadConfig();
    if (name === 'mockScenario') config.hubspot.mockScenario = value;
    if (name === 'ownerId') config.hubspot.ownerId = value;
    if (name === 'ownerName') config.hubspot.ownerName = value;
    if (name === 'maxPages') config.scan.maxPages = Number(value);
    await saveConfig(config);
    showSaved('Impostazioni salvate.');
  } catch (err) {
    showSaved(`Salvataggio non riuscito: ${err?.message || err}`, true);
  }
}

function onChange(event) {
  const { name } = event.target;
  if (!FIELDS.includes(name)) return;
  const value = event.target.value.trim();
  const problem = CHECKS[name]?.(value);
  if (problem) {
    showSaved(problem, true);
    return;
  }
  queue = queue.then(() => save(name, value));
}

async function init() {
  const config = await loadConfig();
  form.elements.mockScenario.value = config.hubspot.mockScenario;
  form.elements.ownerName.value = config.hubspot.ownerName;
  form.elements.ownerId.value = config.hubspot.ownerId;
  form.elements.maxPages.value = String(config.scan.maxPages);
  form.addEventListener('change', onChange);
  form.addEventListener('submit', (e) => e.preventDefault());
}

init().catch((err) => showSaved(`Impostazioni non lette: ${err?.message || err}`, true));
