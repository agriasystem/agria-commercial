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

test('configurazione: valori predefiniti, scenari validi, modalità MOCK o reale', () => {
  assert.deepEqual(normalizeConfig(undefined), structuredClone(DEFAULT_CONFIG));
  assert.equal(DEFAULT_CONFIG.hubspot.mode, 'mock', 'si parte in MOCK');
  assert.equal(normalizeConfig({ hubspot: { mockScenario: 'found' } }).hubspot.mockScenario, 'found');
  assert.equal(normalizeConfig({ hubspot: { mockScenario: 'boh' } }).hubspot.mockScenario, 'not_found');
  assert.equal(normalizeConfig({ hubspot: { mode: 'real' } }).hubspot.mode, 'real');
  assert.equal(normalizeConfig({ hubspot: { mode: 'produzione' } }).hubspot.mode, 'mock');
  assert.equal(normalizeConfig({ hubspot: { mode: 'real', serviceKey: 'non deve restare qui' } }).hubspot.serviceKey, undefined, 'nessuna credenziale nella configurazione');
  assert.equal(normalizeConfig({ hubspot: { mockDelayMs: -5 } }).hubspot.mockDelayMs, 700);
});

test('configurazione: limite della scansione; il proprietario HubSpot non è più un\'impostazione', () => {
  const ok = normalizeConfig({ hubspot: { ownerId: ' 123456 ', ownerName: '  Matteo   G. ' }, scan: { maxPages: 50 } });
  assert.equal(ok.scan.maxPages, 50);
  // nome e ID owner scritti a mano nelle versioni precedenti si scartano: ora c'è il registro dei commerciali
  assert.equal('ownerId' in ok.hubspot, false);
  assert.equal('ownerName' in ok.hubspot, false);
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
  assert.equal(await autosave('maxPages', '40'), '');
  assert.equal(await autosave('mockScenario', 'found'), '');
  assert.equal(await autosave('mode', 'real'), '');
  assert.match(await autosave('mode', 'altro'), /non prevista/);
  assert.deepEqual((await loadConfig(storage)).hubspot, { ...DEFAULT_CONFIG.hubspot, mockScenario: 'found', mode: 'real' });
  assert.equal((await loadConfig(storage)).scan.maxPages, 40);
  // un valore sbagliato spiega il motivo e lascia il valore salvato prima
  assert.match(await autosave('maxPages', '500'), /da 5 a 100/);
  assert.match(await autosave('maxPages', 'abc'), /da 5 a 100/);
  assert.ok(await autosave('mockScenario', 'real'));
  assert.ok(await autosave('token', 'segreto'), 'nessun campo estraneo');
  // nome e ID owner non si impostano più a mano: vengono dal commerciale scelto all'apertura
  assert.match(await autosave('ownerName', 'Matteo Garuzzo'), /sconosciuta/);
  assert.match(await autosave('ownerId', '123456789'), /sconosciuta/);
  const after = await loadConfig(storage);
  assert.equal(after.scan.maxPages, 40);
  assert.equal(after.hubspot.mockScenario, 'found');
  assert.equal('ownerId' in storage.data.config.hubspot, false);
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

test('mock: i tre scenari, stessa interfaccia del client reale', async () => {
  const q = { domain: 'lamora.it', name: 'Agriturismo La Mora' };
  const methods = ['testConnection', 'searchCompanyDuplicates', 'getCompany', 'createCompany', 'searchContactDuplicates', 'createContact', 'associateContactToCompany'];
  const real = createHubspotClient({ getToken: async () => '' });
  const mock = createMockHubspotClient({ mockDelayMs: 0 });
  for (const m of methods) assert.equal(typeof real[m], 'function', `reale: ${m}`);
  for (const m of methods) assert.equal(typeof mock[m], 'function', `mock: ${m}`);

  const absent = await createMockHubspotClient({ mockScenario: 'not_found', mockDelayMs: 0 }).searchCompanyDuplicates(q);
  assert.deepEqual(absent, { outcome: 'none', matches: [] });

  const present = await createMockHubspotClient({ mockScenario: 'found', mockDelayMs: 0 }).searchCompanyDuplicates(q);
  assert.equal(present.outcome, 'certain');
  assert.deepEqual([present.matches[0].id, present.matches[0].name, present.matches[0].domain], ['MOCK-1001', 'Agriturismo La Mora', 'lamora.it']);

  await assert.rejects(
    createMockHubspotClient({ mockScenario: 'error', mockDelayMs: 0 }).searchCompanyDuplicates(q),
    (e) => e instanceof HubspotError && e.code === 'mock_error',
  );
  await assert.rejects(createMockHubspotClient({ mockDelayMs: 0 }).searchCompanyDuplicates({}), (e) => e.code === 'invalid_input');
  assert.throws(() => createMockHubspotClient({ mockScenario: 'boh' }));
  assert.deepEqual(Object.keys(MOCK_SCENARIOS), ['not_found', 'found', 'error']);
});

test('client reale: senza Service Key nessuna chiamata', async () => {
  let calls = 0;
  const client = createHubspotClient({ getToken: async () => '', fetchImpl: async () => { calls += 1; } });
  assert.equal(client.mode, 'real');
  await assert.rejects(client.searchCompanyDuplicates({ domain: 'lamora.it' }), (e) => e instanceof HubspotError && e.code === 'no_key');
  assert.equal(calls, 0);
});
