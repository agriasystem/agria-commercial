// Esiti e messaggi di Agria Commercial: un solo componente, cinque toni, sempre con icona e titolo
// (il significato non è affidato al solo colore).
//
//   success  ✓  operazione riuscita            «✓ Azienda creata in HubSpot»
//   warning  ⚠  da controllare, si può andare  «⚠ Possibile duplicato»
//   blocked  ⛔  fermo per una regola           «⛔ Azienda già presente in HubSpot»
//   error    ✕  qualcosa non ha funzionato     «✕ Errore HubSpot»
//   info     ℹ  informazione o prossimo passo

import { el } from './dom.js';

export const TONES = Object.freeze({ success: '✓', warning: '⚠', blocked: '⛔', error: '✕', info: 'ℹ' });

/** feedback('success', 'Azienda creata in HubSpot', el('p', {}, '…'), …) → elemento .fb */
export function feedback(tone, title, ...children) {
  const icon = TONES[tone] || TONES.info;
  return el('div', { class: 'fb', 'data-tone': Object.hasOwn(TONES, tone) ? tone : 'info' },
    el('p', { class: 'fb-title' }, el('span', { class: 'fb-icon', 'aria-hidden': 'true' }, icon), ' ', el('span', { class: 'fb-text' }, title)),
    ...children);
}
