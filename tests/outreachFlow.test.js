// Outreach nel service worker (hubspotService.js) contro un HubSpot finto: conferma della prima
// email, Lead Status, date scritte una sola volta, task di follow-up, doppio clic, errori e nuovi
// tentativi. Nessuna chiamata al CRM reale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHubspotService } from '../extension/lib/hubspotService.js';
import { OPERATORS } from '../extension/lib/operators.js';
import { createFakeHubspot } from './support/fakeHubspot.js';

const TOKEN = 'fake-outreach-key-0123456789abcdef';
const [MATTEO, ALESSANDRO] = OPERATORS;
const at = (iso) => Date.parse(iso);
const TUESDAY = at('2026-10-13T08:42:00Z'); // martedì 10:42 in Italia
const DUE = at('2026-10-15T12:30:00Z'); // giovedì 14:30 in Italia
const COMPANY_DATE = 'data_del_primo_invio_email';
const CONTACT_DATE = 'data_primo_invio_email_al_contatto';
const CANTINA = Object.freeze({ name: 'Cantina Rossi', domain: 'cantinarossi.it', city: 'Foligno', email_aziendale_principale: 'info@cantinarossi.it' });
const TASKS = '/crm/objects/2026-09/tasks';

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

/** Service worker con HubSpot finto, Azienda già in HubSpot (doppione certo verificato) e, se serve, un Contatto. */
async function setup({ mode = 'real', operator = MATTEO, company = {}, contact = null, now = TUESDAY } = {}) {
  const fake = createFakeHubspot({ token: TOKEN });
  const local = memoryStorage();
  const session = memoryStorage();
  const clock = { now };
  const responses = [];
  await local.set({ config: { hubspot: { mode, mockScenario: 'found' }, scan: { maxPages: 30 } } });
  if (operator) await session.set({ activeOperator: operator.hubspotOwnerId });
  const service = createHubspotService({ local, session, fetchImpl: fake.fetch, sleep: async () => {}, mockDelayMs: 0, now: () => clock.now });
  const call = async (action, payload = {}, from = {}) => {
    const res = await service.handle({ action, ...payload }, from);
    responses.push(res);
    return res;
  };
  await call('saveKey', { key: TOKEN }, { fromOptions: true });
  await call('testConnection', {}, { fromOptions: true });
  const companyId = mode === 'real' ? fake.addCompany({ ...CANTINA, hs_lead_status: 'NEW', ...company }) : 'MOCK-1001';
  const contactId = contact ? fake.addContact({ firstname: 'Roberto', lastname: 'Rossi', jobtitle: 'Titolare', email: 'roberto@cantinarossi.it', ...contact }) : '';
  const verified = await call('verifyCompany', { company: CANTINA });
  assert.equal(verified.outcome, 'certain', 'Azienda trovata con certezza da Scout');
  fake.state.requests.length = 0;
  const setOperator = (o) => session.set({ activeOperator: o.hubspotOwnerId });
  const req = (method, re) => fake.state.requests.filter((r) => r.method === method && re.test(r.path));
  const patches = () => req('PATCH', /./);
  const taskPosts = () => req('POST', /\/tasks$/);
  return { fake, local, session, clock, call, responses, companyId, contactId, setOperator, req, patches, taskPosts };
}
const toCompany = (t) => ({ companyId: t.companyId, recipient: { type: 'company', email: 'info@cantinarossi.it' } });
const toContact = (t) => ({ companyId: t.companyId, recipient: { type: 'contact', contactId: t.contactId } });
const companyRecord = (t) => t.fake.state.companies.find((c) => c.id === t.companyId).properties;

test('lettura per Outreach: stato e data dell\'Azienda, Contatto, nessuna scrittura', async () => {
  const t = await setup({ contact: {} });
  const res = await t.call('outreachRead', { companyId: t.companyId, contactId: t.contactId });
  assert.equal(res.ok, true);
  assert.deepEqual([res.company.name, res.company.leadStatus, res.company.firstEmailAt, res.contacted], ['Cantina Rossi', 'NEW', '', false]);
  assert.deepEqual([res.contact.name, res.contact.jobtitle, res.contact.firstEmailAt], ['Roberto Rossi', 'Titolare', '']);
  assert.equal(res.operation, null);
  assert.equal(t.fake.writes().length, 0);
  const unknown = await t.call('outreachRead', { companyId: '123456' });
  assert.deepEqual([unknown.ok, unknown.error.code], [false, 'invalid_input'], 'solo Aziende verificate o create in questa sessione');
});

test('email all\'Azienda: Lead Status, data Azienda, un task associato all\'Azienda; il Contatto non si tocca', async () => {
  const t = await setup({ contact: {} });
  const res = await t.call('outreachConfirm', toCompany(t));
  assert.deepEqual([res.ok, res.outcome, res.operation.complete], [true, 'done', true]);
  assert.deepEqual(t.patches().map((r) => [r.path, r.body.properties]), [
    [`/crm/objects/2026-09/companies/${t.companyId}`, { hs_lead_status: 'ATTEMPTED_TO_CONTACT', [COMPANY_DATE]: String(TUESDAY) }],
  ]);
  assert.equal(companyRecord(t).hs_lead_status, 'ATTEMPTED_TO_CONTACT');
  assert.equal(companyRecord(t)[COMPANY_DATE], '2026-10-13T08:42:00.000Z');
  assert.equal(t.fake.state.contacts[0].properties[CONTACT_DATE], undefined, 'email all\'Azienda: data del Contatto non toccata');
  assert.equal(t.fake.state.tasks.length, 1);
  const [task] = t.fake.state.tasks;
  assert.deepEqual(t.taskPosts()[0].body.properties, {
    hs_task_subject: 'FOLLOW-UP | Cantina Rossi', hs_task_body: 'Primo follow-up dopo email commerciale Agria System.',
    hs_task_type: 'CALL', hs_task_status: 'NOT_STARTED', hs_task_priority: 'NONE',
    hs_timestamp: String(DUE), hs_task_reminders: String(DUE - 30 * 60 * 1000), hubspot_owner_id: MATTEO.hubspotOwnerId,
  });
  assert.deepEqual(t.fake.state.taskLinks.filter((l) => l.taskId === task.id).map((l) => [l.kind, l.id, l.typeId]), [['companies', t.companyId, 192]]);
  assert.deepEqual([res.operation.dueAt, res.operation.ownerName, res.operation.taskId, res.operation.recipient.label], [DUE, MATTEO.name, task.id, 'Azienda — info@cantinarossi.it']);
  assert.deepEqual(res.operation.writes, { companyDate: true, contactDate: false });
});

test('email al Contatto: data Azienda, data Contatto, task associato ad Azienda e Contatto', async () => {
  const t = await setup({ contact: {}, operator: ALESSANDRO });
  const res = await t.call('outreachConfirm', toContact(t));
  assert.deepEqual([res.ok, res.outcome], [true, 'done']);
  assert.deepEqual(t.patches().map((r) => r.body.properties), [
    { hs_lead_status: 'ATTEMPTED_TO_CONTACT', [COMPANY_DATE]: String(TUESDAY) },
    { [CONTACT_DATE]: String(TUESDAY) },
  ]);
  assert.equal(t.fake.state.contacts[0].properties[CONTACT_DATE], '2026-10-13T08:42:00.000Z');
  const [task] = t.fake.state.tasks;
  assert.equal(task.properties.hs_task_body, 'Primo follow-up dopo email commerciale Agria System.\nContatto: Roberto Rossi — Titolare');
  assert.equal(task.properties.hubspot_owner_id, ALESSANDRO.hubspotOwnerId);
  assert.deepEqual(t.fake.state.taskLinks.map((l) => [l.kind, l.typeId]), [['companies', 192], ['contacts', 204]]);
  assert.deepEqual(res.operation.writes, { companyDate: true, contactDate: true });
  assert.equal(res.operation.recipient.label, 'Roberto Rossi — Titolare');
});

test('Azienda già contattata (data presente): nessun primo contatto, data invariata, nessun task', async () => {
  const t = await setup({ company: { [COMPANY_DATE]: '2026-09-01T08:00:00.000Z' } });
  const read = await t.call('outreachRead', { companyId: t.companyId });
  assert.equal(read.contacted, true);
  const res = await t.call('outreachConfirm', toCompany(t));
  assert.deepEqual([res.ok, res.outcome], [true, 'already']);
  assert.equal(companyRecord(t)[COMPANY_DATE], '2026-09-01T08:00:00.000Z', 'data non sovrascritta');
  assert.equal(t.fake.writes().length, 0, 'nessuna scrittura, nessun task');
});

test('Azienda già contattata (CONNECTED, OPEN_DEAL, ATTEMPTED_TO_CONTACT): flusso del primo contatto bloccato', async () => {
  for (const status of ['CONNECTED', 'OPEN_DEAL', 'ATTEMPTED_TO_CONTACT']) {
    const t = await setup({ company: { hs_lead_status: status } });
    const res = await t.call('outreachConfirm', toCompany(t));
    assert.equal(res.outcome, 'already', status);
    assert.equal(t.fake.writes().length, 0, status);
  }
});

test('un collega registra il primo invio fra la lettura e la conferma: la rilettura blocca tutto', async () => {
  const t = await setup();
  assert.equal((await t.call('outreachRead', { companyId: t.companyId })).contacted, false);
  companyRecord(t)[COMPANY_DATE] = '2026-10-13T07:00:00.000Z';
  const res = await t.call('outreachConfirm', toCompany(t));
  assert.equal(res.outcome, 'already');
  assert.equal(companyRecord(t)[COMPANY_DATE], '2026-10-13T07:00:00.000Z');
  assert.equal(t.fake.writes().length, 0);
});

test('data del Contatto già presente: non si riscrive; Azienda e follow-up sì', async () => {
  const t = await setup({ contact: { [CONTACT_DATE]: '2026-09-01T08:00:00.000Z' } });
  const res = await t.call('outreachConfirm', toContact(t));
  assert.equal(res.outcome, 'done');
  assert.equal(res.operation.steps.contact, 'kept');
  assert.deepEqual(t.patches().map((r) => r.path), [`/crm/objects/2026-09/companies/${t.companyId}`], 'nessun PATCH sul Contatto');
  assert.equal(t.fake.state.contacts[0].properties[CONTACT_DATE], '2026-09-01T08:00:00.000Z');
  assert.equal(t.fake.state.tasks.length, 1);
});

test('cambio di commerciale prima del clic: owner = chi conferma', async () => {
  const t = await setup({ operator: MATTEO });
  await t.setOperator(ALESSANDRO);
  const res = await t.call('outreachConfirm', toCompany(t));
  assert.equal(res.operation.ownerName, ALESSANDRO.name);
  assert.equal(t.fake.state.tasks[0].properties.hubspot_owner_id, ALESSANDRO.hubspotOwnerId);
});

test('doppio clic: una sola scrittura dell\'Azienda, un solo task; una nuova conferma non riscrive nulla', async () => {
  const t = await setup();
  const [a, b] = await Promise.all([t.call('outreachConfirm', toCompany(t)), t.call('outreachConfirm', toCompany(t))]);
  const outcomes = [a, b].map((r) => (r.ok ? r.outcome : r.error.code)).sort();
  assert.deepEqual(outcomes, ['busy', 'done']);
  assert.equal(t.patches().length, 1);
  assert.equal(t.taskPosts().length, 1);
  t.clock.now += 60 * 1000;
  const again = await t.call('outreachConfirm', toCompany(t));
  assert.deepEqual([again.outcome, again.operation.complete], ['exists', true]);
  assert.equal(t.patches().length, 1, 'nessuna nuova scrittura');
  assert.equal(t.fake.state.tasks.length, 1, 'nessun secondo task');
});

test('task non creato (errore di HubSpot): primo contatto registrato, follow-up da riprovare; il nuovo tentativo crea solo il task', async () => {
  const t = await setup({ contact: {} });
  t.fake.force('POST', /\/tasks$/, t.fake.response.error(500, 'Internal error'));
  const res = await t.call('outreachConfirm', toContact(t));
  assert.deepEqual([res.ok, res.outcome, res.operation.steps.company, res.operation.steps.contact, res.operation.steps.task], [true, 'partial', 'done', 'done', 'uncertain']);
  assert.match(res.operation.errors.task, /HubSpot non è disponibile/);
  assert.equal(companyRecord(t).hs_lead_status, 'ATTEMPTED_TO_CONTACT', 'nessun rollback');
  const dateBefore = companyRecord(t)[COMPANY_DATE];
  const patchesBefore = t.patches().length;
  t.clock.now += 5 * 60 * 1000; // il nuovo tentativo arriva dopo: la scadenza resta quella della conferma
  await t.setOperator(ALESSANDRO); // e anche l'owner
  const retry = await t.call('outreachRetry', { companyId: t.companyId });
  assert.deepEqual([retry.outcome, retry.operation.complete], ['done', true]);
  assert.equal(t.patches().length, patchesBefore, 'il nuovo tentativo non riscrive le date');
  assert.equal(companyRecord(t)[COMPANY_DATE], dateBefore);
  assert.equal(t.fake.state.tasks.length, 1);
  assert.equal(t.fake.state.tasks[0].properties.hs_timestamp, new Date(DUE).toISOString());
  assert.equal(t.fake.state.tasks[0].properties.hubspot_owner_id, MATTEO.hubspotOwnerId, 'owner della conferma');
});

test('task creato ma risposta persa: il nuovo tentativo lo trova e non ne crea un secondo', async () => {
  const t = await setup();
  t.fake.force('POST', /\/tasks$/, t.fake.response.error(502, 'Bad gateway'), 1, { after: true });
  const res = await t.call('outreachConfirm', toCompany(t));
  assert.equal(res.operation.steps.task, 'uncertain');
  assert.equal(t.fake.state.tasks.length, 1, 'in realtà il task esiste');
  const retry = await t.call('outreachRetry', { companyId: t.companyId });
  assert.deepEqual([retry.outcome, retry.operation.taskId], ['done', t.fake.state.tasks[0].id]);
  assert.equal(t.taskPosts().length, 1, 'nessuna seconda creazione');
  assert.equal(t.req('GET', /\/companies\/\d+\/associations\/tasks$/).length, 1, 'cerca fra i task associati all\'Azienda');
});

test('nuovo tentativo senza poter controllare i task esistenti: nessuna creazione alla cieca', async () => {
  const t = await setup();
  t.fake.force('POST', /\/tasks$/, t.fake.response.error(500, 'Internal error'));
  await t.call('outreachConfirm', toCompany(t));
  t.fake.force('GET', /\/associations\/tasks$/, t.fake.response.error(500, 'Internal error'), 3);
  const retry = await t.call('outreachRetry', { companyId: t.companyId });
  assert.equal(retry.outcome, 'partial');
  assert.equal(t.taskPosts().length, 1, 'solo il primo tentativo');
  const again = await t.call('outreachRetry', { companyId: t.companyId });
  assert.equal(again.outcome, 'done');
  assert.equal(t.fake.state.tasks.length, 1);
});

test('task rifiutato da HubSpot (errore di validazione): messaggio leggibile, poi un solo task', async () => {
  const t = await setup();
  t.fake.force('POST', /\/tasks$/, t.fake.response.error(400, 'Property values were not valid', { category: 'VALIDATION_ERROR', errors: [{ code: 'INVALID_OPTION', message: 'x', context: { propertyName: ['hs_task_priority'] } }] }));
  const res = await t.call('outreachConfirm', toCompany(t));
  assert.equal(res.operation.steps.task, 'error');
  assert.match(res.operation.errors.task, /hs_task_priority/);
  await t.call('outreachRetry', { companyId: t.companyId });
  assert.equal(t.fake.state.tasks.length, 1);
});

test('esito incerto sull\'Azienda: nessun task finché non è chiaro; il nuovo tentativo rilegge e non riscrive una data arrivata', async () => {
  const t = await setup();
  t.fake.force('PATCH', /\/companies\/\d+$/, t.fake.response.error(500, 'Internal error'), 1, { after: true });
  const res = await t.call('outreachConfirm', toCompany(t));
  assert.deepEqual([res.outcome, res.operation.steps.company, res.operation.steps.task], ['partial', 'uncertain', 'pending']);
  assert.equal(t.taskPosts().length, 0);
  const retry = await t.call('outreachRetry', { companyId: t.companyId });
  assert.equal(retry.outcome, 'done');
  assert.equal(t.patches().length, 1, 'la modifica era arrivata: niente seconda scrittura');
  assert.equal(retry.operation.writes.companyDate, true);
  assert.equal(t.fake.state.tasks.length, 1);
});

test('Azienda rifiutata da HubSpot (errore definitivo): niente scritto, si può confermare di nuovo', async () => {
  const t = await setup();
  t.fake.force('PATCH', /\/companies\/\d+$/, t.fake.response.error(400, 'Property values were not valid', { category: 'VALIDATION_ERROR', errors: [{ code: 'INVALID_OPTION', message: 'x', context: { propertyName: ['hs_lead_status'] } }] }));
  const res = await t.call('outreachConfirm', toCompany(t));
  assert.deepEqual([res.ok, res.error.code], [false, 'validation']);
  assert.equal(t.taskPosts().length, 0);
  assert.equal((await t.call('outreachState', { companyId: t.companyId })).operation, null, 'nessuna operazione a metà');
  assert.equal((await t.call('outreachConfirm', toCompany(t))).outcome, 'done');
  assert.equal(t.fake.state.tasks.length, 1);
});

test('proprietà del portale controllate prima di scrivere: tipo data, valore di Lead Status', async () => {
  let t = await setup();
  delete t.fake.state.properties.companies[COMPANY_DATE];
  let res = await t.call('outreachConfirm', toCompany(t));
  assert.deepEqual([res.ok, res.error.code], [false, 'setup']);
  assert.match(res.error.message, /manca la proprietà «data_del_primo_invio_email».*Nessuna modifica/);
  assert.equal(t.fake.writes().length, 0);

  t = await setup();
  t.fake.state.properties.companies.hs_lead_status.options = [{ value: 'NEW' }];
  res = await t.call('outreachConfirm', toCompany(t));
  assert.deepEqual([res.ok, res.error.code], [false, 'setup']);
  assert.equal(t.fake.writes().length, 0);

  t = await setup({ contact: {} });
  t.fake.state.properties.companies[COMPANY_DATE].type = 'date';
  t.fake.state.properties.contacts[CONTACT_DATE].type = 'date';
  res = await t.call('outreachConfirm', toContact(t));
  assert.equal(res.outcome, 'done');
  assert.deepEqual(t.patches().map((r) => Object.values(r.body.properties).at(-1)), ['2026-10-13', '2026-10-13'], 'giorno italiano YYYY-MM-DD');
});

test('Azienda contattata in passato, poi email a un Contatto: solo la data del Contatto, nessun nuovo follow-up', async () => {
  const t = await setup({ company: { hs_lead_status: 'ATTEMPTED_TO_CONTACT', [COMPANY_DATE]: '2026-09-01T08:00:00.000Z' }, contact: {} });
  const res = await t.call('outreachContactDate', { companyId: t.companyId, contactId: t.contactId });
  assert.deepEqual([res.ok, res.outcome], [true, 'done']);
  assert.deepEqual(t.patches().map((r) => [r.path, r.body.properties]), [[`/crm/objects/2026-09/contacts/${t.contactId}`, { [CONTACT_DATE]: String(TUESDAY) }]]);
  assert.equal(companyRecord(t)[COMPANY_DATE], '2026-09-01T08:00:00.000Z', 'la data dell\'Azienda non cambia');
  assert.equal(t.taskPosts().length, 0);
  const again = await t.call('outreachContactDate', { companyId: t.companyId, contactId: t.contactId });
  assert.equal(again.outcome, 'kept');
  assert.equal(t.patches().length, 1);
  const fresh = await setup({ contact: {} });
  const refused = await fresh.call('outreachContactDate', { companyId: fresh.companyId, contactId: fresh.contactId });
  assert.deepEqual([refused.ok, refused.error.code], [false, 'invalid_input'], 'Azienda non contattata: si usa il flusso normale');
});

test('stato dell\'operazione in sessione, senza chiamate a HubSpot', async () => {
  const t = await setup();
  await t.call('outreachConfirm', toCompany(t));
  const before = t.fake.state.requests.length;
  const res = await t.call('outreachState', { companyId: t.companyId });
  assert.deepEqual([res.mode, res.operation.complete, res.operation.dueAt], ['real', true, DUE]);
  assert.equal(t.fake.state.requests.length, before);
  assert.ok(!('plan' in res.operation), 'il piano interno non esce dal service worker');
});

test('MOCK: stesso flusso simulato, nessuna rete', async () => {
  const t = await setup({ mode: 'mock' });
  const res = await t.call('outreachConfirm', { companyId: 'MOCK-1001', recipient: { type: 'company' } });
  assert.deepEqual([res.ok, res.outcome, res.mock, res.operation.complete], [true, 'done', true, true]);
  assert.match(res.operation.taskId, /^MOCK-T/);
  assert.equal(t.fake.state.requests.length, 0);
});

test('senza commerciale attivo: nessuna operazione', async () => {
  const t = await setup();
  await t.session.remove('activeOperator');
  const res = await t.call('outreachConfirm', toCompany(t));
  assert.deepEqual([res.ok, res.error.code], [false, 'no_operator']);
  assert.equal(t.fake.state.requests.length, 0);
});

test('destinatario obbligatorio; Service Key mai nelle risposte né nel registro', async () => {
  const t = await setup({ contact: {} });
  const none = await t.call('outreachConfirm', { companyId: t.companyId, recipient: null });
  assert.deepEqual([none.ok, none.error.message], [false, 'Scegli a chi hai inviato la prima email.']);
  await t.call('outreachConfirm', toContact(t));
  const audit = await t.call('audit');
  const text = audit.entries.map((e) => `${e.operation} ${e.outcome}`).join('\n');
  assert.match(text, /Primo contatto Lead Status: Primo contatto inviato · data del primo invio registrata · destinatario: Roberto Rossi — Titolare/);
  assert.match(text, /Follow-up Programmato per giovedì 15\/10\/2026 alle 14:30 · Matteo Garuzzo/);
  assert.ok(!JSON.stringify(t.responses).includes(TOKEN));
  assert.ok(!JSON.stringify(t.session.data).includes(TOKEN));
});
