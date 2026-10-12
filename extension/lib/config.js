// Impostazioni di Agria Scout, salvate in chrome.storage.local di questo browser.
// Nessuna credenziale: nella V0/V1 HubSpot è soltanto simulato. Il proprietario HubSpot è il
// commerciale che usa il browser, scritto a mano (nome e ID owner), mai dedotto dal sito.
// Ogni installazione è un commerciale: niente chrome.storage.sync, nessuna condivisione tra
// browser o utenti.

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

/**
 * Un valore cambiato nella pagina Impostazioni → { config, error }. Un valore sbagliato non si
 * salva: resta la configurazione di prima e si spiega perché.
 */
export function applySetting(config, name, value) {
  const next = normalizeConfig(config);
  const v = typeof value === 'string' ? value.trim() : '';
  if (name === 'ownerId') {
    if (v && !/^\d{1,20}$/.test(v)) return { config: next, error: "L'ID owner HubSpot contiene solo cifre." };
    next.hubspot.ownerId = v;
  } else if (name === 'ownerName') {
    next.hubspot.ownerName = v;
  } else if (name === 'maxPages') {
    const n = Number(v);
    if (!v || !Number.isInteger(n) || n < SCAN_LIMITS.min || n > SCAN_LIMITS.max) return { config: next, error: `Scegli un numero da ${SCAN_LIMITS.min} a ${SCAN_LIMITS.max}.` };
    next.scan.maxPages = n;
  } else if (name === 'mockScenario') {
    if (!Object.hasOwn(MOCK_SCENARIOS, v)) return { config: next, error: 'Scenario non previsto.' };
    next.hubspot.mockScenario = v;
  } else {
    return { config: next, error: 'Impostazione sconosciuta.' };
  }
  return { config: normalizeConfig(next), error: '' };
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
