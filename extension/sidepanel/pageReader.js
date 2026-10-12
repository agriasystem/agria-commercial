// Lettura della pagina attiva nella finestra del pannello: inietta il content script e ne
// riceve la fotografia. Nessun dato esce dal browser.

const COLLECTOR = 'content/collector.js';

export class PageReadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PageReadError';
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) return tab;
  const [fallback] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return fallback;
}

/** → { snapshot, stillLoading } oppure PageReadError con un messaggio per il commerciale. */
export async function readActivePage() {
  const tab = await activeTab();
  if (!tab?.id) throw new PageReadError('Nessuna scheda attiva in questa finestra.');
  if (!tab.url || !/^https?:\/\//i.test(tab.url)) {
    throw new PageReadError('La scheda attiva non è un sito web. Apri il sito del prospect in questa finestra e riprova.');
  }
  let results;
  try {
    results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [COLLECTOR] });
  } catch (err) {
    throw new PageReadError(`Chrome non consente di leggere questa pagina (${err?.message || err}).`);
  }
  const snapshot = results?.[0]?.result;
  if (!snapshot || typeof snapshot !== 'object') {
    throw new PageReadError('La pagina non ha restituito dati: attendi che finisca di caricare e riprova.');
  }
  return { snapshot, stillLoading: tab.status === 'loading' };
}
