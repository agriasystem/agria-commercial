// Commerciali Agria: il registro e il commerciale attivo nella sessione di Chrome.
//
// Il registro qui sotto è l'unico punto in cui stanno i commerciali: nome, ID owner HubSpot ed email
// aziendale (Google Workspace Agria). Per aggiungere un commerciale basta una voce: Scout, Outreach,
// HubSpot, Gmail e il contatore giornaliero leggono tutti da qui. Il commerciale attivo si sceglie
// all'apertura di Agria Commercial e vive in chrome.storage.session: resta se si chiude e riapre il
// pannello, si chiede di nuovo alla prossima sessione di Chrome. Non è una preferenza salvata e non si
// sincronizza.
// È l'unica fonte di hubspot_owner_id per Azienda e Contatto (mai dal sito, mai dalla bozza), del nome
// nel testo della prima email e dell'account Gmail con cui aprirla.

export const OPERATORS = Object.freeze([
  { name: 'Matteo Garuzzo', hubspotOwnerId: '99355637', email: 'matteo.garuzzo@agriasystem.com' },
  { name: 'Alessandro Poponi', hubspotOwnerId: '37994989', email: 'alessandro.poponi@agriasystem.com' },
].map((o) => Object.freeze(o)));

const KEY = 'activeOperator'; // in sessione si salva solo l'ID owner: nome e dati restano nel registro

/** Commerciale del registro con questo ID owner, oppure null. */
export const operatorById = (id) => OPERATORS.find((o) => o.hubspotOwnerId === id) || null;

export class OperatorRequiredError extends Error {
  constructor() {
    super('Scegli prima chi sta usando Agria Commercial.');
    this.name = 'OperatorRequiredError';
  }
}

/** Scansione, verifica HubSpot e operazioni CRM partono solo con un commerciale del registro. */
export function requireOperator(operator) {
  const found = operatorById(operator?.hubspotOwnerId);
  if (!found) throw new OperatorRequiredError();
  return found;
}

/** Commerciale attivo in questa sessione di Chrome, oppure null (va scelto). */
export async function loadActiveOperator(storage = chrome.storage.session) {
  const stored = await storage.get(KEY);
  return operatorById(stored[KEY]);
}

export async function selectOperator(id, storage = chrome.storage.session) {
  const operator = operatorById(id);
  if (!operator) throw new Error('Commerciale non previsto.');
  await storage.set({ [KEY]: operator.hubspotOwnerId });
  return operator;
}

/**
 * Avvisa quando il commerciale attivo cambia (anche da un altro pannello o dalle Impostazioni).
 * Solo lo storage di sessione: gli eventi di chrome.storage.local (dove sta la Service Key) qui non arrivano.
 */
export function onOperatorChange(callback) {
  chrome.storage.session.onChanged.addListener((changes) => {
    if (changes[KEY]) callback(operatorById(changes[KEY].newValue));
  });
}
