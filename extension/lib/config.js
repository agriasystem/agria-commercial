// Impostazioni di Agria Scout, salvate in chrome.storage.local di questo browser.
// Nessuna credenziale: nella V0 HubSpot è soltanto simulato.

export const MOCK_SCENARIOS = Object.freeze({
  not_found: 'Azienda non presente',
  found: 'Azienda già presente',
  error: 'Errore HubSpot',
});

export const DEFAULT_CONFIG = Object.freeze({
  hubspot: Object.freeze({ mode: 'mock', mockScenario: 'not_found', mockDelayMs: 700 }),
});

const KEY = 'config';

/** Completa e corregge una configurazione letta dallo storage. */
export function normalizeConfig(raw) {
  const h = raw && typeof raw === 'object' && raw.hubspot && typeof raw.hubspot === 'object' ? raw.hubspot : {};
  const delay = h.mockDelayMs;
  return {
    hubspot: {
      mode: 'mock', // V0: l'unica modalità disponibile
      mockScenario: Object.hasOwn(MOCK_SCENARIOS, h.mockScenario) ? h.mockScenario : DEFAULT_CONFIG.hubspot.mockScenario,
      mockDelayMs: Number.isInteger(delay) && delay >= 0 && delay <= 5000 ? delay : DEFAULT_CONFIG.hubspot.mockDelayMs,
    },
  };
}

export async function loadConfig(storage = chrome.storage.local) {
  const stored = await storage.get(KEY);
  return normalizeConfig(stored[KEY]);
}

export async function saveConfig(config, storage = chrome.storage.local) {
  const clean = normalizeConfig(config);
  await storage.set({ [KEY]: clean });
  return clean;
}

/** Avvisa quando le impostazioni cambiano (anche da un'altra pagina dell'estensione). */
export function onConfigChange(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) callback(normalizeConfig(changes[KEY].newValue));
  });
}
