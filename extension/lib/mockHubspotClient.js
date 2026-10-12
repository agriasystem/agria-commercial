// HubSpot simulato per la V0: nessuna chiamata di rete, nessuna lettura né scrittura reale.
// Stesso contratto di hubspotClient.js; lo scenario si sceglie nelle Impostazioni.

import { HubspotError, validateCompanyQuery } from './hubspotClient.js';
import { MOCK_SCENARIOS } from './config.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createMockHubspotClient({ mockScenario = 'not_found', mockDelayMs = 700 } = {}) {
  if (!Object.hasOwn(MOCK_SCENARIOS, mockScenario)) throw new Error(`Scenario MOCK sconosciuto: ${mockScenario}`);
  return Object.freeze({
    mode: 'mock',
    scenario: mockScenario,
    async findCompany(query) {
      const { domain, name } = validateCompanyQuery(query);
      await wait(mockDelayMs);
      if (mockScenario === 'error') {
        throw new HubspotError('mock_error', 'Errore simulato: HubSpot non ha risposto. Nessun dato è stato letto o scritto.');
      }
      if (mockScenario === 'not_found') return { found: false, companies: [], mock: true };
      return { found: true, mock: true, companies: [{ id: 'MOCK-1001', name: name || domain, domain }] };
    },
  });
}
