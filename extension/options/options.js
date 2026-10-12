// Impostazioni di Agria Scout: per ora solo lo scenario della simulazione HubSpot.
// Ogni scelta si salva subito; il pannello aperto si aggiorna da solo.

import { loadConfig, saveConfig } from '../lib/config.js';

const form = document.querySelector('#settings');
const saved = document.querySelector('#saved');
let saving = false;

function showSaved(text, isError = false) {
  saved.textContent = text;
  saved.classList.toggle('err', isError);
}

async function onChange(event) {
  if (event.target.name !== 'mockScenario' || saving) return;
  saving = true;
  const radios = form.querySelectorAll('input[name="mockScenario"]');
  radios.forEach((r) => { r.disabled = true; });
  try {
    const config = await loadConfig();
    config.hubspot.mockScenario = event.target.value;
    await saveConfig(config);
    showSaved('Impostazioni salvate.');
  } catch (err) {
    showSaved(`Salvataggio non riuscito: ${err?.message || err}`, true);
  } finally {
    radios.forEach((r) => { r.disabled = false; });
    saving = false;
  }
}

async function init() {
  const config = await loadConfig();
  form.elements.mockScenario.value = config.hubspot.mockScenario;
  form.addEventListener('change', onChange);
}

init().catch((err) => showSaved(`Impostazioni non lette: ${err?.message || err}`, true));
