// Patch 0.4.1: contatore giornaliero «Oggi N / 20» (lib/dailyOutreach.js) e il suo +1 nel service worker,
// contro un HubSpot finto. chrome.storage.local finto: nessun browser, nessuna rete, nessun CRM reale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustCount, COUNTS_ITEM, createDailyCounter, DAILY_TARGET, readDay, recordFirstContact } from '../extension/lib/dailyOutreach.js';
import { createHubspotService } from '../extension/lib/hubspotService.js';
import { OPERATORS } from '../extension/lib/operators.js';
import { createFakeHubspot } from './support/fakeHubspot.js';

const [MATTEO, ALESSANDRO] = OPERATORS;
const TOKEN = 'fake-counter-key-0123456789abcdef';
const at = (iso) => Date.parse(iso);
const TUESDAY = at('2026-10-13T08:42:00Z'); // martedì 13 ottobre, 10:42 in Italia

function memoryStorage() {
  const data = {};
  return {
    data,
    async get(keys) {
      if (keys == null) return structuredClone(data);
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
    },
    async set(obj) { Object.assign(data, structuredClone(obj)); },
    async remove(keys) { for (const k of [].concat(keys)) delete data[k]; },
  };
}

test('funzioni pure: +1 una volta per Azienda e giorno, correzione mai sotto zero, giorni e commerciali separati', () => {
  let all = {};
  let r = recordFirstContact(all, MATTEO.hubspotOwnerId, '2026-10-13', '9001');
  assert.equal(r.counted, true);
  all = r.next;
  r = recordFirstContact(all, MATTEO.hubspotOwnerId, '2026-10-13', '9001');
  assert.equal(r.counted, false, 'la stessa Azienda non conta due volte');
  all = recordFirstContact(all, MATTEO.hubspotOwnerId, '2026-10-13', '9002').next;
  assert.deepEqual(readDay(all, MATTEO.hubspotOwnerId, '2026-10-13'), { count: 2, companies: ['9001', '9002'] });
  assert.deepEqual(readDay(all, ALESSANDRO.hubspotOwnerId, '2026-10-13'), { count: 0, companies: [] }, 'Alessandro separato');
  assert.deepEqual(readDay(all, MATTEO.hubspotOwnerId, '2026-10-14'), { count: 0, companies: [] }, 'giorno nuovo da zero');
  // correzione a mano, poi un nuovo contatto: continua a contare; il registro resta
  all = adjustCount(all, MATTEO.hubspotOwnerId, '2026-10-13', +1);
  all = adjustCount(all, MATTEO.hubspotOwnerId, '2026-10-13', +1);
  assert.equal(readDay(all, MATTEO.hubspotOwnerId, '2026-10-13').count, 4);
  all = recordFirstContact(all, MATTEO.hubspotOwnerId, '2026-10-13', '9003').next;
  assert.equal(readDay(all, MATTEO.hubspotOwnerId, '2026-10-13').count, 5);
  assert.equal(recordFirstContact(all, MATTEO.hubspotOwnerId, '2026-10-13', '9001').counted, false, 'idempotenza anche dopo la correzione');
  for (let i = 0; i < 10; i += 1) all = adjustCount(all, MATTEO.hubspotOwnerId, '2026-10-13', -1);
  assert.equal(readDay(all, MATTEO.hubspotOwnerId, '2026-10-13').count, 0, 'mai negativo');
  assert.equal(DAILY_TARGET, 20);
  // valori sporchi nello storage: letti come zero
  assert.deepEqual(readDay({ x: { '2026-10-13': { count: -3, companies: ['ok', 7, null] } } }, 'x', '2026-10-13'), { count: 0, companies: ['ok'] });
});

test('archivio: chrome.storage.local, giorno italiano, chiusura e riapertura di Chrome, due browser separati', async () => {
  const local = memoryStorage();
  const clock = { now: at('2026-10-13T21:30:00Z') }; // 23:30 del 13 in Italia
  const counter = createDailyCounter({ local, now: () => clock.now });
  await counter.record(MATTEO.hubspotOwnerId, '9001', clock.now);
  await counter.adjust(MATTEO.hubspotOwnerId, +1);
  assert.deepEqual(await counter.state(MATTEO.hubspotOwnerId), { ownerId: MATTEO.hubspotOwnerId, day: '2026-10-13', target: 20, count: 2 });
  assert.deepEqual(Object.keys(local.data), [COUNTS_ITEM], 'una sola voce in chrome.storage.local');
  // Chrome chiuso e riaperto: nuovo service worker, stesso profilo → stesso valore
  const reopened = createDailyCounter({ local, now: () => clock.now });
  assert.equal((await reopened.state(MATTEO.hubspotOwnerId)).count, 2);
  // mezzanotte in Italia (22:00 UTC in ottobre): nuovo giorno, 0 / 20
  clock.now = at('2026-10-13T22:05:00Z');
  assert.deepEqual(await reopened.state(MATTEO.hubspotOwnerId), { ownerId: MATTEO.hubspotOwnerId, day: '2026-10-14', target: 20, count: 0 });
  // un altro PC / profilo Chrome: il suo storage, nessuno stato in comune
  const otherBrowser = createDailyCounter({ local: memoryStorage(), now: () => clock.now });
  await otherBrowser.record(ALESSANDRO.hubspotOwnerId, '9001', clock.now);
  assert.equal((await otherBrowser.state(MATTEO.hubspotOwnerId)).count, 0);
  assert.equal((await reopened.state(ALESSANDRO.hubspotOwnerId)).count, 0);
  // incremento automatico e correzione a mano nello stesso istante: entrambi conteggiati
  await Promise.all([reopened.record(MATTEO.hubspotOwnerId, '9100', clock.now), reopened.adjust(MATTEO.hubspotOwnerId, +1)]);
  assert.equal((await reopened.state(MATTEO.hubspotOwnerId)).count, 2);
});

/** Service worker con HubSpot finto e un'Azienda trovata con certezza (come in outreachFlow.test.js). */
async function setup({ mode = 'real', operator = MATTEO, local = memoryStorage() } = {}) {
  const fake = createFakeHubspot({ token: TOKEN });
  const session = memoryStorage();
  const clock = { now: TUESDAY };
  await local.set({ config: { hubspot: { mode, mockScenario: 'found' }, scan: { maxPages: 30 } } });
  await session.set({ activeOperator: operator.hubspotOwnerId });
  const service = createHubspotService({ local, session, fetchImpl: fake.fetch, sleep: async () => {}, mockDelayMs: 0, now: () => clock.now });
  const call = (action, payload = {}, from = {}) => service.handle({ action, ...payload }, from);
  await call('saveKey', { key: TOKEN }, { fromOptions: true });
  await call('testConnection', {}, { fromOptions: true });
  const add = (name, domain) => fake.addCompany({ name, domain, city: 'Foligno', email_aziendale_principale: `info@${domain}`, hs_lead_status: 'NEW' });
  const verify = (name, domain) => call('verifyCompany', { company: { name, domain, city: 'Foligno', email_aziendale_principale: `info@${domain}` } });
  const confirm = (companyId) => call('outreachConfirm', { companyId, sentConfirmed: true, recipient: { type: 'company', email: 'info@x.it', cc: [] } });
  const count = async () => (await call('dailyCount')).count;
  return { fake, local, session, clock, call, add, verify, confirm, count };
}

test('service worker: +1 solo alla registrazione del primo contatto; retry, doppio clic e stessa Azienda non contano', async () => {
  const t = await setup();
  const rossi = t.add('Cantina Rossi', 'cantinarossi.it');
  await t.verify('Cantina Rossi', 'cantinarossi.it');
  assert.equal(await t.count(), 0, 'scansione, verifica e lettura non contano');
  await t.call('outreachRead', { companyId: rossi });
  assert.equal(await t.count(), 0);
  // la conferma senza «ho inviato davvero» non registra nulla e non conta
  await t.call('outreachConfirm', { companyId: rossi, recipient: { type: 'company' } });
  assert.equal(await t.count(), 0);
  // task fallito dopo la registrazione dell'Azienda: il +1 c'è già
  t.fake.force('POST', /\/tasks$/, t.fake.response.error(500, 'Internal error'));
  const partial = await t.confirm(rossi);
  assert.deepEqual([partial.outcome, partial.operation.steps.company, partial.operation.steps.task], ['partial', 'done', 'uncertain']);
  assert.equal(await t.count(), 1);
  // il nuovo tentativo crea il task ma non conta di nuovo
  const retry = await t.call('outreachRetry', { companyId: rossi });
  assert.equal(retry.operation.complete, true);
  assert.equal(await t.count(), 1);
  // nuova conferma o doppio clic sulla stessa Azienda: nessun nuovo conteggio
  await Promise.all([t.confirm(rossi), t.confirm(rossi)]);
  assert.equal(await t.count(), 1);
  // un'altra Azienda: +1
  const bianchi = t.add('Agriturismo Bianchi', 'agribianchi.it');
  await t.verify('Agriturismo Bianchi', 'agribianchi.it');
  assert.equal((await t.confirm(bianchi)).outcome, 'done');
  assert.equal(await t.count(), 2);
  // stato salvato in chrome.storage.local per commerciale e giorno italiano, con il registro delle Aziende
  assert.deepEqual(t.local.data[COUNTS_ITEM], { [MATTEO.hubspotOwnerId]: { '2026-10-13': { count: 2, companies: [rossi, bianchi] } } });
});

test('service worker: Azienda già contattata o registrazione rifiutata → nessun conteggio', async () => {
  const t = await setup();
  const done = t.fake.addCompany({ name: 'Cantina Verdi', domain: 'cantinaverdi.it', city: 'Foligno', hs_lead_status: 'NEW', data_del_primo_invio_email: '2026-10-01T08:00:00Z' });
  await t.verify('Cantina Verdi', 'cantinaverdi.it');
  assert.equal((await t.confirm(done)).outcome, 'already');
  const refused = t.add('Cantina Neri', 'cantinaneri.it');
  await t.verify('Cantina Neri', 'cantinaneri.it');
  t.fake.force('PATCH', /companies\//, t.fake.response.error(400, 'Property values were not valid', { category: 'VALIDATION_ERROR', errors: [] }));
  assert.equal((await t.confirm(refused)).ok, false);
  assert.equal(await t.count(), 0);
});

test('service worker: correzione a mano per il commerciale attivo; Matteo e Alessandro separati; MOCK non conta', async () => {
  const local = memoryStorage();
  const t = await setup({ local });
  assert.deepEqual((await t.call('dailyCountAdjust', { delta: -1 })).count, 0, 'mai sotto zero');
  await t.call('dailyCountAdjust', { delta: 1 });
  await t.call('dailyCountAdjust', { delta: 1 });
  assert.equal(await t.count(), 2);
  assert.equal((await t.call('dailyCountAdjust', { delta: 5 })).ok, false, 'solo +1 o −1');
  const rossi = t.add('Cantina Rossi', 'cantinarossi.it');
  await t.verify('Cantina Rossi', 'cantinarossi.it');
  await t.confirm(rossi);
  assert.equal(await t.count(), 3, 'dopo la correzione gli incrementi automatici continuano');
  // Alessandro sullo stesso PC: il suo contatore
  await t.session.set({ activeOperator: ALESSANDRO.hubspotOwnerId });
  assert.deepEqual(await t.call('dailyCount'), { ok: true, ownerId: ALESSANDRO.hubspotOwnerId, day: '2026-10-13', target: 20, count: 0 });
  // senza commerciale attivo: nessun contatore
  await t.session.remove('activeOperator');
  assert.equal((await t.call('dailyCount')).error.code, 'no_operator');
  // MOCK: niente è registrato davvero, niente conta
  const mock = await setup({ mode: 'mock' });
  await mock.verify('Cantina Rossi', 'cantinarossi.it');
  assert.equal((await mock.confirm('MOCK-1001')).outcome, 'done');
  assert.equal(await mock.count(), 0);
});
