// Impostazioni di Agria Scout, salvate in chrome.storage.local di questo browser.
// Nessuna credenziale: nella V0/V1 HubSpot è soltanto simulato. Il proprietario HubSpot è il
// commerciale che usa il browser, scritto a mano (nome e ID owner), mai dedotto dal sito.

export const MOCK_SCENARIOS = Object.freeze({
  not_found: 'Azienda non presente',
  found: 'Azienda già presente',
  error: 'Errore HubSpot',
});

export const SCAN_LIMITS = Object.freeze({ min: 5, max: 100, default: 30 });

export const DEFAULT_CONFIG = Object.freeze({
  hubspot: Object.freeze({ mode: 'mock', mockScenario: 'not_found', mockDelayMs: 700, ownerId: '', ownerName: '' }),
  scan: Object.freeze({ maxPages: SCAN_LIMITS.default }),
});

const KEY = 'config';

/** Completa e corregge una configurazione letta dallo storage. */
export function normalizeConfig(raw) {
  const h = raw && typeof raw === 'object' && raw.hubspot && typeof raw.hubspot === 'object' ? raw.hubspot : {};
  const s = raw && typeof raw === 'object' && raw.scan && typeof raw.scan === 'object' ? raw.scan : {};
  const delay = h.mockDelayMs;
  const ownerId = typeof h.ownerId === 'string' ? h.ownerId.trim() : '';
  const maxPages = Number(s.maxPages);
  return {
    hubspot: {
      mode: 'mock', // V1: l'unica modalità disponibile
      mockScenario: Object.hasOwn(MOCK_SCENARIOS, h.mockScenario) ? h.mockScenario : DEFAULT_CONFIG.hubspot.mockScenario,
      mockDelayMs: Number.isInteger(delay) && delay >= 0 && delay <= 5000 ? delay : DEFAULT_CONFIG.hubspot.mockDelayMs,
      ownerId: /^\d{1,20}$/.test(ownerId) ? ownerId : '',
      ownerName: typeof h.ownerName === 'string' ? h.ownerName.replace(/\s+/g, ' ').trim().slice(0, 80) : '',
    },
    scan: {
      maxPages: Number.isInteger(maxPages) && maxPages >= SCAN_LIMITS.min && maxPages <= SCAN_LIMITS.max ? maxPages : SCAN_LIMITS.default,
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
