// Client HubSpot reale (API 2026-09) contro un HubSpot finto: nessuna chiamata reale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_BASE, API_VERSION, createHubspotClient, HubspotError, validationLines } from '../extension/lib/hubspotClient.js';
import { createFakeHubspot } from './support/fakeHubspot.js';

const TOKEN = 'fake-unit-key-0123456789abcdef';
const setup = ({ token = TOKEN, ...options } = {}) => {
  const fake = createFakeHubspot({ token: TOKEN });
  const waits = [];
  const client = createHubspotClient({ getToken: async () => token, fetchImpl: fake.fetch, sleep: async (ms) => waits.push(ms), ...options });
  return { fake, client, waits };
};
const failsWith = (promise, code) => assert.rejects(promise, (e) => e instanceof HubspotError && e.code === code);
const hasNoToken = (value) => !JSON.stringify(value).includes(TOKEN) && !String(value?.message ?? '').includes(TOKEN);

test('API date-versioned 2026-09 su https://api.hubapi.com', () => {
  assert.equal(API_BASE, 'https://api.hubapi.com');
  assert.equal(API_VERSION, '2026-09');
});

test('test connessione 200: una sola lettura innocua, Bearer, nessun corpo', async () => {
  const { fake, client } = setup();
  assert.deepEqual(await client.testConnection(), { ok: true });
  assert.equal(fake.state.requests.length, 1);
  const [r] = fake.state.requests;
  assert.deepEqual([r.method, r.path, r.query], ['GET', '/crm/objects/2026-09/companies', { limit: '1', archived: 'false' }]);
  assert.equal(r.authorized, true, 'Authorization: Bearer <Service Key>');
  assert.equal(r.body, null);
});

test('test connessione 401 e 403: messaggi chiari, nessun token negli errori', async () => {
  const wrong = setup({ token: 'chiave-sbagliata-123456789' });
  await assert.rejects(wrong.client.testConnection(), (e) => e.code === 'unauthorized' && e.message === 'Service Key non valida o ruotata.' && e.status === 401 && hasNoToken(e));
  const { fake, client } = setup();
  fake.force('GET', /companies$/, fake.response.error(403, 'This app hasn\'t been granted all required scopes', { category: 'MISSING_SCOPES' }));
  await assert.rejects(client.testConnection(), (e) => e.code === 'forbidden' && e.message === 'Service Key valida ma permessi insufficienti.' && hasNoToken(e));
  // la forma mandata al pannello: solo codice, messaggio, stato, correlationId
  const e = new HubspotError('unauthorized', 'x', { status: 401, correlationId: 'c-1' });
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(e))).sort(), ['code', 'correlationId', 'message', 'status']);
});

test('429: si rispetta Retry-After e si riprova; troppe volte → errore leggibile', async () => {
  const { fake, client, waits } = setup();
  fake.force('GET', /companies$/, fake.response.json(429, { status: 'error', errorType: 'RATE_LIMIT', message: 'You have reached your secondly limit.' }, { 'retry-after': '3' }));
  assert.deepEqual(await client.testConnection(), { ok: true });
  assert.deepEqual(waits, [3000], 'attesa dal Retry-After (secondi)');
  assert.equal(fake.state.requests.length, 2);

  const again = setup();
  again.fake.force('GET', /companies$/, again.fake.response.error(429, 'limit'), 5);
  await assert.rejects(again.client.testConnection(), (e) => e.code === 'rate_limited' && /troppe richieste/.test(e.message));
  assert.equal(again.fake.state.requests.length, 3, 'al massimo due nuovi tentativi');
  assert.deepEqual(again.waits, [1000, 2000], 'senza Retry-After: 1 s, poi 2 s');
});

test('5xx: le letture si riprovano, una creazione mai (potrebbe essere arrivata)', async () => {
  const read = setup();
  read.fake.force('GET', /companies$/, read.fake.response.error(502, 'Bad gateway'));
  assert.deepEqual(await read.client.testConnection(), { ok: true });

  const write = setup();
  write.fake.force('POST', /companies$/, write.fake.response.error(500, 'Internal error'), 3);
  await assert.rejects(write.client.createCompany({ name: 'X', domain: 'x.it' }), (e) => e.code === 'server' && /errore 500/.test(e.message) && /potrebbe comunque essere arrivata/.test(e.message));
  assert.equal(write.fake.state.requests.filter((r) => r.method === 'POST').length, 1, 'una sola POST');
});

test('errori di rete e timeout', async () => {
  const offline = createHubspotClient({ getToken: async () => TOKEN, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(offline.testConnection(), (e) => e.code === 'network' && /rete/.test(e.message) && hasNoToken(e));
  const slow = createHubspotClient({
    getToken: async () => TOKEN, timeoutMs: 20,
    fetchImpl: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
  });
  await failsWith(slow.testConnection(), 'timeout');
});

test('senza Service Key nessuna richiesta parte', async () => {
  const { fake, client } = setup({ token: '' });
  await failsWith(client.testConnection(), 'no_key');
  await failsWith(client.searchCompanyDuplicates({ domain: 'cantina.it' }), 'no_key');
  assert.equal(fake.state.requests.length, 0);
});

test('validation error 2026-09 (regole del portale): righe in italiano con la proprietà', async () => {
  const { fake, client } = setup();
  fake.requireProperty('companies', 'settore_agria');
  await assert.rejects(client.createCompany({ name: 'Cantina', domain: 'cantina.it' }), (e) => e.code === 'validation' && e.status === 400
    && e.message.includes('Settore Agria (settore_agria): obbligatorio per una regola condizionale del portale.'));
  assert.deepEqual(validationLines({ category: 'VALIDATION_ERROR', errors: [{ code: 'MISSING_REQUIRED_PROPERTY', message: 'A value for firstname must be provided', context: { propertyName: ['firstname'] } }] }),
    ['Nome (firstname): obbligatorio nel portale HubSpot.']);
  assert.deepEqual(validationLines({ category: 'VALIDATION_ERROR', message: 'Property values were not valid', errors: [{ code: 'ALTRO', message: 'valore\u0000strano' }] }), ['valore strano']);
});

test('404 e 409 (contatto con la stessa email: si legge l\'ID esistente)', async () => {
  const { fake, client } = setup();
  await failsWith(client.getCompany('123'), 'not_found');
  const existing = fake.addContact({ email: 'mario.rossi@cantina.it', firstname: 'Mario', lastname: 'Rossi' });
  await assert.rejects(client.createContact({ email: 'mario.rossi@cantina.it', firstname: 'Mario', lastname: 'Rossi' }), (e) => e.code === 'conflict' && e.existingId === existing);
  await failsWith(client.getCompany('abc'), 'invalid_input');
});

test('ricerca doppioni azienda: dominio (anche con www.), email e telefono in OR; poi nome', async () => {
  const { fake, client } = setup();
  const company = { name: 'Cantina Rossi S.r.l.', domain: 'https://www.cantinarossi.it/', phone: '+39 0742 123456', email_aziendale_principale: 'Info@CantinaRossi.it', city: 'Foligno' };
  assert.deepEqual(await client.searchCompanyDuplicates(company), { outcome: 'none', matches: [] });
  const [strong, byName] = fake.state.requests;
  assert.equal(strong.path, '/crm/objects/2026-09/companies/search');
  const groups = strong.body.filterGroups.map((g) => g.filters[0]);
  assert.deepEqual(groups.map((f) => [f.propertyName, f.operator]), [['domain', 'IN'], ['website', 'IN'], ['email_aziendale_principale', 'IN'], ['email_aziendale_secondaria', 'IN'], ['phone', 'IN']]);
  assert.ok(strong.body.filterGroups.length <= 5, 'al massimo 5 gruppi (limite HubSpot)');
  assert.deepEqual(groups[0].values, ['cantinarossi.it', 'www.cantinarossi.it']);
  assert.ok(['https://www.cantinarossi.it/', 'http://cantinarossi.it', 'www.cantinarossi.it', 'cantinarossi.it/'].every((w) => groups[1].values.includes(w)));
  assert.deepEqual(groups[2].values, ['info@cantinarossi.it']);
  assert.ok(groups[4].values.includes('0742 123456') && groups[4].values.includes('+390742123456'));
  assert.ok(groups.every((f) => f.values.every((v) => v === v.toLowerCase())), 'valori IN in minuscolo, come chiede HubSpot');
  assert.ok(strong.body.properties.includes('hubspot_owner_id') && strong.body.properties.includes('hs_lead_status'));
  assert.equal(byName.body.query, 'rossi', 'seconda ricerca: la parola più distintiva del nome');
  assert.deepEqual(byName.body.filterGroups, []);
});

test('lettura, creazione e associazione: solo endpoint 2026-09, nessun PATCH', async () => {
  const { fake, client } = setup();
  const company = await client.createCompany({ name: 'Cantina Rossi', domain: 'cantinarossi.it' });
  assert.match(company.id, /^\d+$/);
  assert.equal(company.url, `https://app-eu1.hubspot.com/contacts/149362651/record/0-2/${company.id}`, "link dato dall'API");
  assert.equal((await client.getCompany(company.id)).name, 'Cantina Rossi');
  const contact = await client.createContact({ firstname: 'Mario', lastname: 'Rossi', email: 'mario@cantinarossi.it' });
  assert.deepEqual(await client.associateContactToCompany(contact.id, company.id), { ok: true });
  assert.deepEqual(fake.state.requests.map((r) => `${r.method} ${r.path}`), [
    'POST /crm/objects/2026-09/companies',
    `GET /crm/objects/2026-09/companies/${company.id}`,
    'POST /crm/objects/2026-09/contacts',
    `PUT /crm/objects/2026-09/contact/${contact.id}/associations/default/company/${company.id}`,
  ]);
  assert.equal(fake.state.requests.at(-1).body, null, "l'associazione predefinita non ha corpo: nessun associationTypeId inventato");
  assert.deepEqual(fake.state.associations, [{ contactId: contact.id, companyId: company.id }]);
  assert.ok(fake.state.requests.every((r) => r.method !== 'PATCH' && r.method !== 'DELETE'));
});
