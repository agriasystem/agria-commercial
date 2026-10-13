// «← Torna ad Agria Commercial» nelle Impostazioni.
//
// Riapre Agria Commercial nel pannello laterale della finestra di questa pagina (chrome.sidePanel.open,
// sul gesto esplicito del commerciale) e, se c'è ancora, torna alla scheda da cui le Impostazioni erano
// state aperte. Non chiude MAI niente: né questa scheda né la finestra. Fino alla 0.4.0 il pulsante
// chiudeva la scheda: se era l'unica della finestra Chrome chiudeva la finestra intera, e con l'ultima
// finestra si chiudeva Chrome. Se il pannello non si può aprire (versione di Chrome, criteri di un
// profilo gestito, finestra sconosciuta) la pagina resta aperta e spiega come riaprirlo dall'icona.
//
// Le API di Chrome arrivano come parametro: i test usano API finte.

/** Scheda su cui si lavorava quando si sono aperte le Impostazioni (chrome.storage.session). */
export const RETURN_ITEM = 'settingsReturn';

export const BACK_MESSAGES = Object.freeze({
  opened: 'Agria Commercial è aperto nel pannello laterale.',
  failed: 'Non è stato possibile riaprire il pannello da qui. Apri Agria Commercial con la sua icona nella barra di Chrome: le impostazioni sono già salvate.',
});

/**
 * api: { sidePanel, tabs, session } (chrome.sidePanel, chrome.tabs, chrome.storage.session);
 * tab: questa scheda (chrome.tabs.getCurrent). Va chiamata subito nel gestore del clic, senza await
 * prima: sidePanel.open vale solo durante il gesto dell'utente.
 * → Promise<{ opened: boolean, returnedTo: id della scheda riattivata | null }>, mai un errore.
 */
export function backToAgria(api, tab) {
  let opening;
  try {
    opening = tab?.windowId != null && typeof api?.sidePanel?.open === 'function'
      ? Promise.resolve(api.sidePanel.open({ windowId: tab.windowId }))
      : Promise.reject(new Error('pannello laterale non disponibile'));
  } catch (err) {
    opening = Promise.reject(err);
  }
  return opening.then(
    async () => ({ opened: true, returnedTo: await returnToWork(api, tab).catch(() => null) }),
    () => ({ opened: false, returnedTo: null }),
  );
}

// la scheda del prospect: quella registrata dal pannello all'apertura delle Impostazioni (stessa
// finestra), altrimenti quella che ha aperto questa pagina. Solo attivata, mai chiusa né spostata.
async function returnToWork(api, tab) {
  const stored = (await api.session?.get(RETURN_ITEM))?.[RETURN_ITEM];
  const target = stored && stored.windowId === tab.windowId ? stored.tabId : tab.openerTabId;
  if (target == null || target === tab.id || typeof api.tabs?.update !== 'function') return null;
  await api.tabs.update(target, { active: true });
  return target;
}
