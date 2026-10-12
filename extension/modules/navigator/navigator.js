// Modulo Navigatore di Agria Commercial: apre il Navigatore Chiamata Agria in una scheda ampia.
// La pagina è la copia verificata del file buildato del suo repository (vedi app/navigatore.source.json
// e tools/sync-navigator.js): qui non si riscrive né si cambia nulla del Navigatore.

export const NAVIGATOR_PAGE = 'modules/navigator/app/navigatore.html';

/** Nuova scheda Chrome con il Navigatore (mai compresso nel pannello laterale). */
export function openNavigator() {
  return chrome.tabs.create({ url: chrome.runtime.getURL(NAVIGATOR_PAGE), active: true });
}
