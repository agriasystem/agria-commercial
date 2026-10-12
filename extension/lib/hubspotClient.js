// Accesso a HubSpot: contratto comune al client reale e a quello simulato (mockHubspotClient.js).
//
//   findCompany({ domain, name })
//     → Promise<{ found: boolean, companies: [{ id, name, domain }], mock: boolean }>
//     errori: HubspotError con code 'invalid_input' | 'not_available' | 'mock_error'
//
// V0: il client reale NON è attivo. Non contiene chiamate di rete né credenziali e non scrive
// nulla. Quando verrà collegato, cambierà solo questo file: il pannello usa già il contratto.

import { cleanText, normalizeDomain } from './validation.js';

export class HubspotError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HubspotError';
    this.code = code;
  }
}

/** Controlla la richiesta prima di qualsiasi chiamata: dominio valido oppure almeno il nome. */
export function validateCompanyQuery(query) {
  const rawDomain = typeof query?.domain === 'string' ? query.domain.trim() : '';
  const domain = normalizeDomain(rawDomain);
  const name = cleanText(typeof query?.name === 'string' ? query.name : '', 200);
  if (rawDomain && !domain) throw new HubspotError('invalid_input', 'Il dominio non è valido: correggilo prima della verifica.');
  if (!domain && !name) throw new HubspotError('invalid_input', "Serve almeno il dominio o il nome dell'azienda.");
  return { domain, name };
}

export function createHubspotClient() {
  return Object.freeze({
    mode: 'real',
    async findCompany(query) {
      validateCompanyQuery(query);
      throw new HubspotError('not_available', 'La connessione reale a HubSpot non è ancora attiva in questa versione.');
    },
  });
}
