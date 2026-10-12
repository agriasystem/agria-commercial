// Base giuridica predefinita per i nuovi prospect, confermata dal commerciale per la sessione.
// Sta in chrome.storage.session insieme al commerciale che l'ha confermata: non è permanente (si
// azzera alla chiusura di Chrome) e non passa a un altro commerciale (va confermata di nuovo).

import { LEGAL_BASIS } from './crmModel.js';

const KEY = 'legalBasisDefault';

/** La base giuridica predefinita vale per questo commerciale in questa sessione? */
export async function loadSessionLegalBasis(operator, storage = chrome.storage.session) {
  const stored = (await storage.get(KEY))[KEY];
  return Boolean(operator?.hubspotOwnerId && stored?.operatorId === operator.hubspotOwnerId && stored.value === LEGAL_BASIS);
}

export async function setSessionLegalBasis(operator, on, storage = chrome.storage.session) {
  if (on === true && operator?.hubspotOwnerId) await storage.set({ [KEY]: { operatorId: operator.hubspotOwnerId, value: LEGAL_BASIS } });
  else await storage.remove(KEY);
}

/** Nuovo commerciale, nuova sessione operatore: la conferma precedente non vale più. */
export const clearSessionLegalBasis = (storage = chrome.storage.session) => storage.remove(KEY);

export function onSessionLegalBasisChange(callback) {
  chrome.storage.session.onChanged.addListener((changes) => {
    if (changes[KEY]) callback();
  });
}
