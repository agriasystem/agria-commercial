// HubSpot simulato: nessuna chiamata di rete, nessuna lettura né scrittura reale.
// Stessa interfaccia del client reale (hubspotClient.js), per lo sviluppo e per provare il flusso;
// lo scenario si sceglie nelle Impostazioni. I record "creati" esistono solo nella risposta.

import { HubspotError, validateCompanyQuery } from './hubspotClient.js';
import { MOCK_SCENARIOS } from './config.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let counter = 0;
const nextId = (prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}${(counter += 1)}`;

export function createMockHubspotClient({ mockScenario = 'not_found', mockDelayMs = 700 } = {}) {
  if (!Object.hasOwn(MOCK_SCENARIOS, mockScenario)) throw new Error(`Scenario MOCK sconosciuto: ${mockScenario}`);
  const step = async () => {
    await wait(mockDelayMs);
    if (mockScenario === 'error') throw new HubspotError('mock_error', 'Errore simulato: HubSpot non ha risposto. Nessun dato è stato letto o scritto.');
  };
  return Object.freeze({
    mode: 'mock',
    scenario: mockScenario,
    async testConnection() {
      await step();
      return { ok: true };
    },
    async searchCompanyDuplicates(company) {
      const { domain, name } = validateCompanyQuery({ domain: company?.domain, name: company?.name });
      await step();
      if (mockScenario === 'not_found') return { outcome: 'none', matches: [] };
      return {
        outcome: 'certain',
        matches: [{ id: 'MOCK-1001', name: name || domain, domain, city: String(company?.city || ''), ownerId: '', leadStatus: 'NEW', url: '', level: 'certain', reasons: ['domain'] }],
      };
    },
    async getCompany(companyId) {
      await step();
      return { id: String(companyId), name: '', domain: '', city: '', ownerId: '', leadStatus: '', url: '' };
    },
    async createCompany(properties) {
      await step();
      return { id: nextId('MOCK'), name: properties.name || '', domain: properties.domain || '', city: properties.city || '', ownerId: properties.hubspot_owner_id || '', leadStatus: properties.hs_lead_status || '', url: '' };
    },
    async searchContactDuplicates() {
      await step();
      return { outcome: 'none', matches: [] };
    },
    async createContact() {
      await step();
      return { id: nextId('MOCK-C'), url: '' };
    },
    async associateContactToCompany() {
      await step();
      return { ok: true };
    },
    // Outreach: un'azienda simulata è sempre «Da contattare» e senza data di primo invio
    async getCompanyOutreach(companyId) {
      await step();
      return { id: String(companyId), name: '', leadStatus: 'NEW', firstEmailAt: '', ownerId: '', url: '' };
    },
    async getContactOutreach(contactId) {
      await step();
      return { id: String(contactId), name: '', jobtitle: '', email: '', firstEmailAt: '', url: '' };
    },
    async getProperty(objectType, name) {
      await step();
      return { name, type: name === 'hs_lead_status' ? 'enumeration' : 'datetime', options: name === 'hs_lead_status' ? ['NEW', 'ATTEMPTED_TO_CONTACT', 'CONNECTED', 'OPEN_DEAL'] : [] };
    },
    async updateCompany() {
      await step();
      return { ok: true };
    },
    async updateContact() {
      await step();
      return { ok: true };
    },
    async createTask() {
      await step();
      return { id: nextId('MOCK-T') };
    },
    async findFollowUpTasks() {
      await step();
      return [];
    },
  });
}
