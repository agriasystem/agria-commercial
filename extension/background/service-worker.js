// Service worker di Agria Scout.
// - Apre il pannello laterale al clic sull'icona dell'estensione.
// - È l'unico punto che parla con HubSpot: legge la Service Key, chiama le API e risponde al pannello
//   e alle Impostazioni con risultati già ripuliti (la chiave non lascia mai il service worker).

import { createHubspotService, MESSAGE, STATUS_CHANGED } from '../lib/hubspotService.js';

// a ogni avvio del service worker, non solo all'installazione: così vale sempre
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[Agria Scout] pannello laterale non configurato:', err?.message || err));

const service = createHubspotService({
  local: chrome.storage.local,
  session: chrome.storage.session,
  // avvisa pannello e Impostazioni che lo stato della connessione è cambiato (il messaggio non contiene dati)
  notify: () => chrome.runtime.sendMessage({ type: STATUS_CHANGED }).catch(() => {}),
});

const EXTENSION_ORIGIN = chrome.runtime.getURL('');
const OPTIONS_PAGE = chrome.runtime.getURL('options/options.html');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== MESSAGE) return false;
  // solo dalle pagine di questa estensione (pannello, Impostazioni): mai da pagine web o script iniettati
  const page = typeof sender.url === 'string' ? sender.url.split(/[?#]/)[0] : '';
  if (sender.id !== chrome.runtime.id || !page.startsWith(EXTENSION_ORIGIN)) {
    sendResponse({ ok: false, error: { code: 'forbidden_sender', message: 'Richiesta non ammessa.' } });
    return false;
  }
  service.handle(message, { fromOptions: page === OPTIONS_PAGE }).then(sendResponse);
  return true; // risposta asincrona
});
