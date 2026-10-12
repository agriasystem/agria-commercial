// Impostazioni di Agria Scout, salvate in chrome.storage.local di questo browser: modalità HubSpot
// (MOCK o reale), scenario MOCK, limite della scansione. Qui non c'è nessuna credenziale: la Service
// Key la gestisce solo il service worker (hubspotService.js), in una voce a parte.
// Il proprietario HubSpot non è un'impostazione: è il commerciale scelto all'apertura (operators.js).
// Niente chrome.storage.sync, nessuna condivisione tra browser o utenti.

export const HUBSPOT_MODES = Object.freeze({ mock: 'HubSpot MOCK', real: 'HubSpot reale' });

export const MOCK_SCENARIOS = Object.freeze({
  not_found: 'Azienda non presente',
  found: 'Azienda già presente',
  error: 'Errore HubSpot',
});

export const SCAN_LIMITS = Object.freeze({ min: 5, max: 100, default: 30 });

export const DEFAULT_CONFIG = Object.freeze({
  hubspot: Object.freeze({ mode: 'mock', mockScenario: 'not_found', mockDelayMs: 700 }),
  scan: Object.freeze({ maxPages: SCAN_LIMITS.default }),
});

const KEY = 'config';

/** Completa e corregge una configurazione letta dallo storage. */
export function normalizeConfig(raw) {
  const h = raw && typeof raw === 'object' && raw.hubspot && typeof raw.hubspot === 'object' ? raw.hubspot : {};
  const s = raw && typeof raw === 'object' && raw.scan && typeof raw.scan === 'object' ? raw.scan : {};
  const delay = h.mockDelayMs;
  const maxPages = Number(s.maxPages);
  return {
    hubspot: {
      mode: Object.hasOwn(HUBSPOT_MODES, h.mode) ? h.mode : DEFAULT_CONFIG.hubspot.mode,
      mockScenario: Object.hasOwn(MOCK_SCENARIOS, h.mockScenario) ? h.mockScenario : DEFAULT_CONFIG.hubspot.mockScenario,
      mockDelayMs: Number.isInteger(delay) && delay >= 0 && delay <= 5000 ? delay : DEFAULT_CONFIG.hubspot.mockDelayMs,
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
  if (name === 'maxPages') {
    const n = Number(v);
    if (!v || !Number.isInteger(n) || n < SCAN_LIMITS.min || n > SCAN_LIMITS.max) return { config: next, error: `Scegli un numero da ${SCAN_LIMITS.min} a ${SCAN_LIMITS.max}.` };
    next.scan.maxPages = n;
  } else if (name === 'mode') {
    if (!Object.hasOwn(HUBSPOT_MODES, v)) return { config: next, error: 'Modalità non prevista.' };
    next.hubspot.mode = v;
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

// Le altre pagine si avvisano con un messaggio, non con chrome.storage.onChanged: quell'evento
// porterebbe al pannello anche le modifiche della Service Key, che sta nello stesso storage.
const CHANGED = 'agria:config-changed';

/** Dopo un salvataggio: avvisa pannello e service worker (nessun dato nel messaggio). */
export function notifyConfigChanged() {
  return chrome.runtime.sendMessage({ type: CHANGED }).catch(() => {}); // nessun pannello aperto
}

/** Avvisa quando le impostazioni cambiano (anche da un'altra pagina dell'estensione). */
export function onConfigChange(callback) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === CHANGED) loadConfig().then(callback).catch(() => {});
  });
}
