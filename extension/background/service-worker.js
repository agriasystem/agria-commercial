// Service worker di Agria Scout.
// V0: fa aprire il pannello laterale al clic sull'icona dell'estensione.
// Qui arriveranno in seguito i lavori in background (chiamate a HubSpot, promemoria di follow-up).

// a ogni avvio del service worker, non solo all'installazione: così vale sempre
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[Agria Scout] pannello laterale non configurato:', err));
