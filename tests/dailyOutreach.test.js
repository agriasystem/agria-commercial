// Contatore giornaliero «Oggi N / 20» e cronologia delle Aziende contattate (lib/dailyOutreach.js), con
// il +1 e la voce registrati dal service worker contro un HubSpot finto. chrome.storage.local finto:
// nessun browser, nessuna rete, nessun CRM reale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adjustCount, cleanEntry, COUNTS_ITEM, createDailyCounter, DAILY_TARGET, readDay, recordFirstContact, romeTime,
} from '../extension/lib/dailyOutreach.js';
import { manualLine } from '../extension/sidepanel/dailyCounter.js';
import { createHubspotService } from '../extension/lib/hubspotService.js';
import { OPERATORS } from '../extension/lib/operators.js';
import { createFakeHubspot } from './support/fakeHubspot.js';

const [MATTEO, ALESSANDRO] = OPERATORS;
const TOKEN = 'fake-counter-key-0123456789abcdef';
const at = (iso) => Date.parse(iso);
const TUESDAY = at('2026-10-13T08:42:00Z'); // martedì 13 ottobre, 10:42 in Italia
const DAY = '2026-10-13';
const URL_OF = (id) => `https://app-eu1.hubspot.com/contacts/149362651/record/0-2/${id}`;
const entry = (id, name = `Azienda ${id}`, iso = '2026-10-13T08:42:00.000Z', extra = {}) => ({ companyId: id, companyName: name, contactedAt: iso, hubspotUrl: URL_OF(id), contact: null, ...extra });

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

// ---- funzioni pure ----

test('20 è un obiettivo, non un limite: 20 → 21 → 22, automatico e a mano', () => {
  assert.equal(DAILY_TARGET, 20);
  let all = {};
  for (let i = 1; i <= 20; i += 1) all = recordFirstContact(all, MATTEO.hubspotOwnerId, DAY, entry(String(9000 + i))).next;
  assert.equal(readDay(all, MATTEO.hubspotOwnerId, DAY).count, 20);
  all = adjustCount(all, MATTEO.hubspotOwnerId, DAY, +1);
  assert.equal(readDay(all, MATTEO.hubspotOwnerId, DAY).count, 21, '«+» oltre 20');
  all = adjustCount(all, MATTEO.hubspotOwnerId, DAY, +1);
  assert.equal(readDay(all, MATTEO.hubspotOwnerId, DAY).count, 22);
  all = recordFirstContact(all, MATTEO.hubspotOwnerId, DAY, entry('9100')).next;
  assert.deepEqual([readDay(all, MATTEO.hubspotOwnerId, DAY).count, readDay(all, MATTEO.hubspotOwnerId, DAY).entries.length], [23, 21], 'automatico oltre 20');
  for (let i = 0; i < 80; i += 1) all = adjustCount(all, MATTEO.hubspotOwnerId, DAY, +1);
  assert.equal(readDay(all, MATTEO.hubspotOwnerId, DAY).count, 103, 'anche 100 / 20 e oltre');
});

test('cronologia: una voce per Azienda (ID HubSpot), mai per nome; dati minimi', () => {
  let all = recordFirstContact({}, MATTEO.hubspotOwnerId, DAY, { ...entry('9001', 'Cantina Dionigi'), email: 'info@x.it', body: 'testo', note: 'riservata' }).next;
  const [first] = readDay(all, MATTEO.hubspotOwnerId, DAY).entries;
  assert.deepEqual(first, { companyId: '9001', companyName: 'Cantina Dionigi', contactedAt: '2026-10-13T08:42:00.000Z', hubspotUrl: URL_OF('9001'), contact: null });
  assert.ok(!JSON.stringify(all).includes('info@x.it') && !JSON.stringify(all).includes('riservata'), 'niente email, testo o note');
  // stesso ID, anche con un altro nome: nessuna seconda voce
  const again = recordFirstContact(all, MATTEO.hubspotOwnerId, DAY, entry('9001', 'Cantina Dionigi S.r.l.'));
  assert.equal(again.counted, false);
  // stesso nome, altro ID: è un'altra Azienda
  all = recordFirstContact(all, MATTEO.hubspotOwnerId, DAY, entry('9002', 'Cantina Dionigi')).next;
  assert.equal(readDay(all, MATTEO.hubspotOwnerId, DAY).entries.length, 2);
  // link: solo un record di hubspot.com con quell'ID
  assert.equal(cleanEntry(entry('9003', 'X', undefined, { hubspotUrl: 'https://evil.test/record/9003' })).hubspotUrl, '');
  assert.equal(cleanEntry(entry('9003', 'X', undefined, { hubspotUrl: URL_OF('9999') })).hubspotUrl, '');
  assert.equal(cleanEntry({ companyId: '<bad>' }), null);
  // ora italiana: CEST (+2) in ottobre, CET (+1) a dicembre
  assert.equal(romeTime('2026-10-13T08:42:00Z'), '10:42');
  assert.equal(romeTime('2026-12-01T08:42:00Z'), '09:42');
  assert.equal(romeTime(''), '');
});

test('correzione a mano: 7 reali + correzione a 9 → 9, cronologia 7, +2; nuovo contatto → 10, cronologia 8', () => {
  let all = {};
  for (let i = 1; i <= 7; i += 1) all = recordFirstContact(all, MATTEO.hubspotOwnerId, DAY, entry(String(i))).next;
  all = adjustCount(all, MATTEO.hubspotOwnerId, DAY, +1);
  all = adjustCount(all, MATTEO.hubspotOwnerId, DAY, +1);
  let day = readDay(all, MATTEO.hubspotOwnerId, DAY);
  assert.deepEqual([day.count, day.entries.length, day.manualAdjustment], [9, 7, 2]);
  assert.equal(manualLine(day.manualAdjustment), '+2 aggiunte manualmente');
  all = recordFirstContact(all, MATTEO.hubspotOwnerId, DAY, entry('8')).next;
  day = readDay(all, MATTEO.hubspotOwnerId, DAY);
  assert.deepEqual([day.count, day.entries.length, day.manualAdjustment], [10, 8, 2]);
  // correzione verso il basso: le Aziende vere restano, il numero mai sotto zero
  for (let i = 0; i < 15; i += 1) all = adjustCount(all, MATTEO.hubspotOwnerId, DAY, -1);
  day = readDay(all, MATTEO.hubspotOwnerId, DAY);
  assert.deepEqual([day.count, day.entries.length, day.manualAdjustment], [0, 8, -8]);
  assert.equal(manualLine(-1), '−1 tolta manualmente');
  assert.equal(manualLine(-8), '−8 tolte manualmente');
  assert.equal(manualLine(0), '');
  // nessuna Azienda inventata dalla correzione
  assert.ok(day.entries.every((e) => /^[1-8]$/.test(e.companyId)));
  // dopo essere tornati a zero, un nuovo contatto conta di nuovo
  all = recordFirstContact(all, MATTEO.hubspotOwnerId, DAY, entry('9')).next;
  assert.equal(readDay(all, MATTEO.hubspotOwnerId, DAY).count, 1);
});

test('formato della prima versione ({ count, companies }) letto senza migrazione', () => {
  const old = { [MATTEO.hubspotOwnerId]: { [DAY]: { count: 4, companies: ['111', '222'] } } };
  const day = readDay(old, MATTEO.hubspotOwnerId, DAY);
  assert.deepEqual([day.count, day.manualAdjustment, day.entries.map((e) => e.companyId)], [4, 2, ['111', '222']]);
  // si continua a contare, con la stessa idempotenza
  const { next, counted } = recordFirstContact(old, MATTEO.hubspotOwnerId, DAY, entry('111'));
  assert.equal(counted, false);
  const more = recordFirstContact(next, MATTEO.hubspotOwnerId, DAY, entry('333')).next;
  assert.deepEqual(more[MATTEO.hubspotOwnerId][DAY].companies, ['111', '222', '333'], 'il campo companies resta, compatibile');
  assert.equal(readDay(more, MATTEO.hubspotOwnerId, DAY).count, 5);
});

// ---- archivio (chrome.storage.local) ----

test('archivio: giorno italiano, giorni passati conservati, riapertura di Chrome, commerciali e browser separati', async () => {
  const local = memoryStorage();
  const clock = { now: at('2026-10-13T21:30:00Z') }; // 23:30 del 13 in Italia
  const counter = createDailyCounter({ local, now: () => clock.now });
  await counter.record(MATTEO.hubspotOwnerId, entry('9001', 'Cantina Dionigi', '2026-10-13T21:30:00.000Z'));
  await counter.adjust(MATTEO.hubspotOwnerId, +1);
  const today = await counter.state(MATTEO.hubspotOwnerId);
  assert.deepEqual([today.day, today.count, today.manualAdjustment, today.target], ['2026-10-13', 2, 1, 20]);
  assert.deepEqual(today.entries.map((e) => [e.companyName, e.time]), [['Cantina Dionigi', '23:30']]);
  assert.deepEqual(Object.keys(local.data), [COUNTS_ITEM], 'una sola voce in chrome.storage.local');
  // Chrome chiuso e riaperto: stesso profilo → stessi dati
  const reopened = createDailyCounter({ local, now: () => clock.now });
  assert.deepEqual((await reopened.state(MATTEO.hubspotOwnerId)).entries.map((e) => e.companyId), ['9001']);
  // mezzanotte in Italia: nuovo giorno, cronologia vuota; il giorno prima resta nello storage
  clock.now = at('2026-10-13T22:05:00Z');
  const tomorrow = await reopened.state(MATTEO.hubspotOwnerId);
  assert.deepEqual([tomorrow.day, tomorrow.count, tomorrow.entries], ['2026-10-14', 0, []]);
  // 40 giorni dopo (mezzogiorno di ogni giorno): i giorni precedenti non si cancellano
  for (let d = 1; d <= 40; d += 1) {
    clock.now = at('2026-10-14T10:00:00Z') + d * 24 * 3600 * 1000;
    await reopened.adjust(MATTEO.hubspotOwnerId, +1);
  }
  const days = Object.keys(local.data[COUNTS_ITEM][MATTEO.hubspotOwnerId]);
  assert.ok(days.includes('2026-10-13'), 'il primo giorno resta');
  assert.equal(days.length, 41);
  // Alessandro: suo contatore; un altro PC: suo storage
  assert.deepEqual((await reopened.state(ALESSANDRO.hubspotOwnerId)).entries, []);
  const otherBrowser = createDailyCounter({ local: memoryStorage(), now: () => clock.now });
  assert.equal((await otherBrowser.state(MATTEO.hubspotOwnerId)).count, 0);
  // la voce più recente in alto
  const order = createDailyCounter({ local: memoryStorage(), now: () => at('2026-10-13T12:00:00Z') });
  await order.record(MATTEO.hubspotOwnerId, entry('1', 'Prima', '2026-10-13T08:14:00.000Z'));
  await order.record(MATTEO.hubspotOwnerId, entry('2', 'Seconda', '2026-10-13T09:31:00.000Z'));
  assert.deepEqual((await order.state(MATTEO.hubspotOwnerId)).entries.map((e) => `${e.time} ${e.companyName}`), ['11:31 Seconda', '10:14 Prima']);
});

// ---- service worker contro un HubSpot finto ----

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
  const confirm = (companyId, extra = {}) => call('outreachConfirm', { companyId, sentConfirmed: true, recipient: { type: 'company', email: 'info@x.it', cc: [] }, ...extra });
  const today = () => call('dailyCount');
  return { fake, local, session, clock, call, add, verify, confirm, today };
}

test('service worker: voce e +1 alla registrazione; nome, ID, ora italiana, link; retry e doppio clic senza seconde voci', async () => {
  const t = await setup();
  const dionigi = t.add('Cantina Dionigi', 'cantinadionigi.it');
  await t.verify('Cantina Dionigi', 'cantinadionigi.it');
  await t.call('outreachRead', { companyId: dionigi });
  assert.deepEqual((await t.today()).entries, [], 'lettura, verifica: nessuna voce');
  // senza «ho inviato davvero»: nessuna registrazione, nessuna voce
  await t.call('outreachConfirm', { companyId: dionigi, recipient: { type: 'company' } });
  assert.equal((await t.today()).count, 0);
  // task fallito dopo la registrazione dell'Azienda: voce e +1 già presenti
  t.fake.force('POST', /\/tasks$/, t.fake.response.error(500, 'Internal error'));
  const partial = await t.confirm(dionigi);
  assert.deepEqual([partial.operation.steps.company, partial.operation.steps.task], ['done', 'uncertain']);
  let day = await t.today();
  assert.equal(day.count, 1);
  assert.deepEqual(day.entries, [{
    companyId: dionigi, companyName: 'Cantina Dionigi', contactedAt: new Date(TUESDAY).toISOString(),
    hubspotUrl: URL_OF(dionigi), contact: null, time: '10:42',
  }]);
  // il link è quello dato da HubSpot nella lettura prima della scrittura: nessuna chiamata in più per averlo
  const reads = t.fake.state.requests.filter((q) => q.method === 'GET' && q.path.endsWith(`/companies/${dionigi}`)).length;
  assert.equal(reads, 2, 'lettura di Outreach + rilettura prima di scrivere: nessuna chiamata in più per il link');
  // nuovo tentativo, doppio clic, conferma ripetuta: una sola voce
  t.clock.now += 5 * 60 * 1000;
  await t.call('outreachRetry', { companyId: dionigi });
  await Promise.all([t.confirm(dionigi), t.confirm(dionigi)]);
  day = await t.today();
  assert.deepEqual([day.count, day.entries.length, day.entries[0].time], [1, 1, '10:42'], 'ora della conferma, non del nuovo tentativo');
  // seconda Azienda: in alto
  const mora = t.add('Agriturismo La Mora', 'lamora.it');
  await t.verify('Agriturismo La Mora', 'lamora.it');
  await t.confirm(mora);
  day = await t.today();
  assert.deepEqual(day.entries.map((e) => [e.companyName, e.time]), [['Agriturismo La Mora', '10:47'], ['Cantina Dionigi', '10:42']]);
  assert.equal(day.count, 2);
  // nello storage: solo dati operativi minimi
  const stored = JSON.stringify(t.local.data[COUNTS_ITEM]);
  assert.ok(!stored.includes(TOKEN) && !stored.includes('info@') && !stored.includes('Gentile Direzione'));
});

test('service worker: Contatto HubSpot già noto mostrato sotto l\'Azienda, mai modificato; assente → solo l\'Azienda', async () => {
  const t = await setup();
  const rossi = t.add('Cantina Rossi', 'cantinarossi.it');
  const roberto = t.fake.addContact({ firstname: 'Roberto', lastname: 'Rossi', jobtitle: 'Titolare', email: 'roberto@cantinarossi.it' });
  await t.verify('Cantina Rossi', 'cantinarossi.it');
  const res = await t.confirm(rossi, { knownContact: { id: roberto, name: 'Roberto Rossi', jobtitle: 'Titolare', url: URL_OF(roberto).replace('0-2', '0-1') } });
  assert.equal(res.outcome, 'done');
  const [e] = (await t.today()).entries;
  assert.deepEqual(e.contact, { id: roberto, name: 'Roberto Rossi — Titolare', url: URL_OF(roberto).replace('0-2', '0-1') });
  // nessuna scrittura sul Contatto, follow-up solo sull'Azienda
  assert.ok(!t.fake.state.requests.some((q) => q.method === 'PATCH' && q.path.includes('/contacts/')), 'nessuna data del Contatto');
  assert.equal(t.fake.state.contacts.find((c) => c.id === roberto).properties.data_primo_invio_email_al_contatto, undefined);
  const [task] = t.fake.state.tasks;
  assert.deepEqual(t.fake.state.taskLinks.filter((l) => l.taskId === task.id).map((l) => l.kind), ['companies']);
  // Contatto con dati non validi: ignorato; link estraneo: tolto
  const verdi = t.add('Cantina Verdi', 'cantinaverdi.it');
  await t.verify('Cantina Verdi', 'cantinaverdi.it');
  await t.confirm(verdi, { knownContact: { id: '<x>', name: 'X' } });
  const bianchi = t.add('Cantina Bianchi', 'cantinabianchi.it');
  await t.verify('Cantina Bianchi', 'cantinabianchi.it');
  await t.confirm(bianchi, { knownContact: { id: '55', name: 'Anna Bianchi', url: 'https://evil.test/55' } });
  const byId = Object.fromEntries((await t.today()).entries.map((x) => [x.companyId, x]));
  assert.equal(byId[verdi].contact, null);
  assert.deepEqual(byId[bianchi].contact, { id: '55', name: 'Anna Bianchi', url: '' });
});

test('service worker: correzione a mano oltre 20 e mai sotto zero; Azienda già contattata, rifiuto e MOCK senza voci', async () => {
  const t = await setup();
  for (let i = 0; i < 21; i += 1) await t.call('dailyCountAdjust', { delta: 1 });
  let day = await t.today();
  assert.deepEqual([day.count, day.target, day.manualAdjustment, day.entries.length], [21, 20, 21, 0], 'impostazione a mano oltre 20, nessuna Azienda inventata');
  for (let i = 0; i < 30; i += 1) await t.call('dailyCountAdjust', { delta: -1 });
  assert.equal((await t.today()).count, 0, 'mai negativo');
  assert.equal((await t.call('dailyCountAdjust', { delta: 5 })).ok, false, 'solo +1 o −1');
  const verdi = t.fake.addCompany({ name: 'Cantina Verdi', domain: 'cantinaverdi.it', city: 'Foligno', hs_lead_status: 'NEW', data_del_primo_invio_email: '2026-10-01T08:00:00Z' });
  await t.verify('Cantina Verdi', 'cantinaverdi.it');
  assert.equal((await t.confirm(verdi)).outcome, 'already');
  const neri = t.add('Cantina Neri', 'cantinaneri.it');
  await t.verify('Cantina Neri', 'cantinaneri.it');
  t.fake.force('PATCH', /companies\//, t.fake.response.error(400, 'Property values were not valid', { category: 'VALIDATION_ERROR', errors: [] }));
  assert.equal((await t.confirm(neri)).ok, false);
  day = await t.today();
  assert.deepEqual([day.count, day.entries], [0, []]);
  // Alessandro sullo stesso PC: suoi contatore e cronologia
  const rossi = t.add('Cantina Rossi', 'cantinarossi.it');
  await t.verify('Cantina Rossi', 'cantinarossi.it');
  await t.confirm(rossi);
  await t.session.set({ activeOperator: ALESSANDRO.hubspotOwnerId });
  day = await t.today();
  assert.deepEqual([day.ownerId, day.count, day.entries], [ALESSANDRO.hubspotOwnerId, 0, []]);
  await t.session.remove('activeOperator');
  assert.equal((await t.today()).error.code, 'no_operator');
  // MOCK: niente è registrato davvero, nessuna voce
  const mock = await setup({ mode: 'mock' });
  await mock.verify('Cantina Rossi', 'cantinarossi.it');
  assert.equal((await mock.confirm('MOCK-1001')).outcome, 'done');
  assert.deepEqual([(await mock.today()).count, (await mock.today()).entries], [0, []]);
});
