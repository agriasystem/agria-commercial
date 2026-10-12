import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySetting, DEFAULT_CONFIG, loadConfig, MOCK_SCENARIOS, normalizeConfig, saveConfig } from '../extension/lib/config.js';
import { createHubspotClient, HubspotError, validateCompanyQuery } from '../extension/lib/hubspotClient.js';
import { createMockHubspotClient } from '../extension/lib/mockHubspotClient.js';

const memoryStorage = () => {
  const data = {};
  return {
    data,
    async get(key) { return key in data ? { [key]: structuredClone(data[key]) } : {}; },
    async set(obj) { Object.assign(data, structuredClone(obj)); },
  };
};

test('configurazione: valori predefiniti, scenari validi, modalità reale non attivabile', () => {
  assert.deepEqual(normalizeConfig(undefined), structuredClone(DEFAULT_CONFIG));
  assert.equal(normalizeConfig({ hubspot: { mockScenario: 'found' } }).hubspot.mockScenario, 'found');
  assert.equal(normalizeConfig({ hubspot: { mockScenario: 'boh' } }).hubspot.mockScenario, 'not_found');
  assert.equal(normalizeConfig({ hubspot: { mode: 'real' } }).hubspot.mode, 'mock');
  assert.equal(normalizeConfig({ hubspot: { mockDelayMs: -5 } }).hubspot.mockDelayMs, 700);
});

test('configurazione: proprietario HubSpot e limite della scansione', () => {
  const ok = normalizeConfig({ hubspot: { ownerId: ' 123456 ', ownerName: '  Matteo   G. ' }, scan: { maxPages: 50 } });
  assert.equal(ok.hubspot.ownerId, '123456');
  assert.equal(ok.hubspot.ownerName, 'Matteo G.');
  assert.equal(ok.scan.maxPages, 50);
  assert.equal(normalizeConfig({ hubspot: { ownerId: 'abc' } }).hubspot.ownerId, '', "l'ID owner è numerico");
  assert.equal(normalizeConfig({ scan: { maxPages: 1000 } }).scan.maxPages, 30);
  assert.equal(normalizeConfig({ scan: { maxPages: 2 } }).scan.maxPages, 30);
  assert.equal(normalizeConfig(undefined).scan.maxPages, 30);
});

test('impostazioni: salvataggio automatico di ogni campo, valori sbagliati non salvati', async () => {
  const storage = memoryStorage();
  // come fa la pagina Impostazioni: un campo alla volta, letto e salvato subito
  const autosave = async (name, value) => {
    const { config, error } = applySetting(await loadConfig(storage), name, value);
    if (!error) await saveConfig(config, storage);
    return error;
  };
  assert.equal(await autosave('ownerName', '  Matteo Garuzzo '), '');
  assert.equal(await autosave('ownerId', '123456789'), '');
  assert.equal(await autosave('maxPages', '40'), '');
  assert.equal(await autosave('mockScenario', 'found'), '');
  assert.deepEqual((await loadConfig(storage)).hubspot, { ...DEFAULT_CONFIG.hubspot, ownerName: 'Matteo Garuzzo', ownerId: '123456789', mockScenario: 'found' });
  assert.equal((await loadConfig(storage)).scan.maxPages, 40);
  // un valore sbagliato spiega il motivo e lascia il valore salvato prima
  assert.match(await autosave('ownerId', '12ab'), /solo cifre/);
  assert.match(await autosave('maxPages', '500'), /da 5 a 100/);
  assert.ok(await autosave('mockScenario', 'real'));
  assert.ok(await autosave('token', 'segreto'), 'nessun campo estraneo');
  const after = await loadConfig(storage);
  assert.equal(after.hubspot.ownerId, '123456789');
  assert.equal(after.scan.maxPages, 40);
  assert.equal(after.hubspot.mockScenario, 'found');
  // svuotare nome e ID è permesso (nuovo commerciale sullo stesso browser)
  assert.equal(await autosave('ownerId', ''), '');
  assert.equal((await loadConfig(storage)).hubspot.ownerId, '');
});

test('configurazione: salvataggio e lettura', async () => {
  const storage = memoryStorage();
  assert.equal((await loadConfig(storage)).hubspot.mockScenario, 'not_found');
  await saveConfig({ hubspot: { mockScenario: 'error', token: 'non deve restare' } }, storage);
  assert.equal((await loadConfig(storage)).hubspot.mockScenario, 'error');
  assert.equal(storage.data.config.hubspot.token, undefined, 'nessun campo estraneo salvato');
});

test('richiesta: serve un dominio valido o il nome', () => {
  assert.deepEqual(validateCompanyQuery({ domain: 'https://www.lamora.it/x', name: ' La  Mora ' }), { domain: 'lamora.it', name: 'La Mora' });
  assert.deepEqual(validateCompanyQuery({ name: 'La Mora' }), { domain: '', name: 'La Mora' });
  assert.throws(() => validateCompanyQuery({}), (e) => e instanceof HubspotError && e.code === 'invalid_input');
  assert.throws(() => validateCompanyQuery({ domain: 'non un dominio', name: 'La Mora' }), (e) => e.code === 'invalid_input');
});

test('mock: i tre scenari', async () => {
  const q = { domain: 'lamora.it', name: 'Agriturismo La Mora' };
  const absent = await createMockHubspotClient({ mockScenario: 'not_found', mockDelayMs: 0 }).findCompany(q);
  assert.deepEqual(absent, { found: false, companies: [], mock: true });

  const present = await createMockHubspotClient({ mockScenario: 'found', mockDelayMs: 0 }).findCompany(q);
  assert.equal(present.found, true);
  assert.equal(present.mock, true);
  assert.deepEqual(present.companies[0], { id: 'MOCK-1001', name: 'Agriturismo La Mora', domain: 'lamora.it' });

  await assert.rejects(
    createMockHubspotClient({ mockScenario: 'error', mockDelayMs: 0 }).findCompany(q),
    (e) => e instanceof HubspotError && e.code === 'mock_error',
  );
  await assert.rejects(createMockHubspotClient({ mockDelayMs: 0 }).findCompany({}), (e) => e.code === 'invalid_input');
  assert.throws(() => createMockHubspotClient({ mockScenario: 'boh' }));
  assert.deepEqual(Object.keys(MOCK_SCENARIOS), ['not_found', 'found', 'error']);
});

test('client reale: non attivo nella V0, nessuna chiamata', async () => {
  const client = createHubspotClient();
  assert.equal(client.mode, 'real');
  await assert.rejects(client.findCompany({ domain: 'lamora.it' }), (e) => e instanceof HubspotError && e.code === 'not_available');
});
