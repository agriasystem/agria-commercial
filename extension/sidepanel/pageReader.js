// Lettura delle pagine per il pannello.
//   readActivePage: la scheda attiva, con il content script iniettato (contenuto reso dal browser);
//   readDownloadedPage: una pagina scaricata dalla scansione, letta con DOMParser (inerte).
// Nessun dato esce dal browser.

import { collectPageSnapshot } from '../content/collector.js';

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
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectPageSnapshot,
      args: [null, null, 'rendered'],
    });
  } catch (err) {
    throw new PageReadError(`Chrome non consente di leggere questa pagina (${err?.message || err}).`);
  }
  const snapshot = results?.[0]?.result;
  if (!snapshot || typeof snapshot !== 'object') {
    throw new PageReadError('La pagina non ha restituito dati: attendi che finisca di caricare e riprova.');
  }
  return { snapshot, stillLoading: tab.status === 'loading' };
}

/** HTML scaricato → fotografia, senza eseguire nulla della pagina. */
export function readDownloadedPage(html, url) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return collectPageSnapshot(doc, url, 'parsed');
}
