// Flusso HubSpot del service worker (hubspotService.js) contro un HubSpot finto: Service Key,
// connessione, doppioni, creazione di Azienda e Contatto, associazione, errori, registro.
// Nessuna chiamata al CRM reale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHubspotService, MESSAGES } from '../extension/lib/hubspotService.js';
import { companyPayload, contactPayload } from '../extension/lib/hubspotPayload.js';
import { OPERATORS } from '../extension/lib/operators.js';
import { createFakeHubspot } from './support/fakeHubspot.js';

const TOKEN = 'fake-flow-key-0123456789abcdef';
const [MATTEO, ALESSANDRO] = OPERATORS;

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

// valori del form come li manda il pannello (crmRecords)
const COMPANY = Object.freeze({
  name: 'Cantina Rossi', domain: 'cantinarossi.it', website: 'https://www.cantinarossi.it/', phone: '+39 0742123456',
  email_aziendale_principale: 'info@cantinarossi.it', email_aziendale_secondaria: '', settore_agria: 'Cantina / Vitivinicolo',
  tipo_struttura_hospitality: 'Agriturismo', city: 'Foligno', state: 'Umbria', country: 'Italia', linkedin_company_page: '',
  hubspot_owner_id: '11111111', hs_lead_status: 'OPEN', hs_quick_context: 'WHATSAPP\n+39 333 123 4567',
});
const CONTACT = Object.freeze({
  firstname: 'Mario', lastname: 'Rossi', jobtitle: 'Titolare', email: 'mario.rossi@cantinarossi.it', phone: '',
  mobilephone: '+39 333 123 4567', hs_linkedin_url: 'https://www.linkedin.com/in/mario-rossi-vino', hubspot_owner_id: '', hs_legal_basis: 'Legitimate interest – prospect/lead',
});

async function setup({ mode = 'real', key = TOKEN, connected = true, operator = MATTEO, mockScenario = 'not_found' } = {}) {
  const fake = createFakeHubspot({ token: TOKEN });
  const local = memoryStorage();
  const session = memoryStorage();
  const responses = [];
  await local.set({ config: { hubspot: { mode, mockScenario }, scan: { maxPages: 30 } } });
  if (operator) await session.set({ activeOperator: operator.hubspotOwnerId });
  const service = createHubspotService({ local, session, fetchImpl: fake.fetch, sleep: async () => {}, mockDelayMs: 0 });
  const call = async (action, payload = {}, from = {}) => {
    const res = await service.handle({ action, ...payload }, from);
    responses.push(res);
    return res;
  };
  const options = (action, payload) => call(action, payload, { fromOptions: true });
  if (key) {
    await options('saveKey', { key });
    if (connected) await options('testConnection');
  }
  const posts = (path) => fake.state.requests.filter((r) => r.method === 'POST' && r.path === path);
  return { fake, local, session, responses, call, options, posts, service };
}
const COMPANIES = '/crm/objects/2026-09/companies';
const CONTACTS = '/crm/objects/2026-09/contacts';

test('Service Key non configurata: modalità reale bloccata con un messaggio chiaro, nessuna richiesta', async () => {
  const { fake, call } = await setup({ key: null });
  const status = await call('status');
  assert.deepEqual([status.keyConfigured, status.ready, status.blocker], [false, false, 'Configura la Service Key nelle Impostazioni.']);
  const res = await call('verifyCompany', { company: COMPANY });
  assert.deepEqual([res.ok, res.error.code, res.error.message], [false, 'no_key', 'Configura la Service Key nelle Impostazioni.']);
  assert.equal(fake.state.requests.length, 0);
});

test('Service Key configurata: solo in chrome.storage.local, mai restituita; serve un test della connessione riuscito', async () => {
  const { fake, local, session, call, options, responses } = await setup({ connected: false });
  assert.equal(local.data.hubspotServiceKey, TOKEN, 'salvata in chrome.storage.local');
  assert.ok(!JSON.stringify(session.data).includes(TOKEN), 'mai nello storage di sessione');
  let status = await call('status');
  assert.deepEqual([status.keyConfigured, status.connection.state, status.ready, status.blocker], [true, 'untested', false, MESSAGES.notConnected]);
  assert.equal((await call('verifyCompany', { company: COMPANY })).error.code, 'not_connected', 'nessuna operazione prima del test');
  status = await options('testConnection');
  assert.deepEqual([status.connection.state, status.ready], ['ok', true]);
  // solo le Impostazioni salvano, testano o rimuovono la chiave
  for (const action of ['saveKey', 'removeKey', 'testConnection']) assert.equal((await call(action, { key: 'x'.repeat(30) })).error.code, 'forbidden_sender', action);
  assert.equal((await options('saveKey', { key: 'troppo corta' })).error.code, 'invalid_input');
  assert.equal(local.data.hubspotServiceKey, TOKEN, 'una chiave non valida non sostituisce quella buona');
  assert.ok(responses.every((r) => !JSON.stringify(r).includes(TOKEN)), 'nessuna risposta contiene la chiave');
  // una nuova chiave va testata di nuovo; rimossa, la modalità reale si ferma
  status = await options('saveKey', { key: `${TOKEN}-ruotata` });
  assert.equal(status.connection.state, 'untested');
  status = await options('removeKey');
  assert.deepEqual([status.keyConfigured, local.data.hubspotServiceKey, local.data.hubspotConnection], [false, undefined, undefined]);
  assert.ok(fake.state.requests.every((r) => r.method === 'GET'), 'il test della connessione legge soltanto');
});

test('chiave mai esposta al pannello: risposte, errori e registro non la contengono', async () => {
  const { fake, session, call, responses } = await setup();
  fake.addCompany({ name: 'Cantina Rossi', domain: 'cantinarossi.it' });
  await call('verifyCompany', { company: COMPANY });
  await call('createCompany', { company: COMPANY });
  fake.force('POST', /search$/, fake.response.error(401, 'Authentication credentials not found.'));
  await call('verifyCompany', { company: COMPANY });
  await call('audit');
  assert.ok(responses.length >= 5);
  for (const res of responses) assert.ok(!JSON.stringify(res).includes(TOKEN), JSON.stringify(res));
  assert.ok(!JSON.stringify(session.data).includes(TOKEN), 'nemmeno nel registro');
});

test('test connessione: 200, 401, 403, 429, 5xx', async () => {
  const ok = await setup();
  assert.equal((await ok.call('status')).connection.state, 'ok');
  const cases = [
    [401, 'Service Key non valida o ruotata.'],
    [403, 'Service Key valida ma permessi insufficienti.'],
  ];
  for (const [code, message] of cases) {
    const { fake, options } = await setup({ connected: false });
    fake.force('GET', /companies$/, fake.response.error(code, 'x'));
    const status = await options('testConnection');
    assert.deepEqual([status.connection.state, status.connection.message, status.ready], ['failed', message, false], String(code));
  }
  const busy = await setup({ connected: false });
  busy.fake.force('GET', /companies$/, busy.fake.response.error(429, 'limit'));
  assert.equal((await busy.options('testConnection')).connection.state, 'ok', '429: nuovo tentativo dopo l\'attesa');
  const down = await setup({ connected: false });
  down.fake.force('GET', /companies$/, down.fake.response.error(503, 'down'), 3);
  const status = await down.options('testConnection');
  assert.equal(status.connection.state, 'failed');
  assert.match(status.connection.message, /non è disponibile.*errore 503/);
});

test('401 durante il lavoro: la modalità reale si ferma finché non si testa di nuovo', async () => {
  const { fake, call } = await setup();
  fake.force('POST', /search$/, fake.response.error(401, 'expired'));
  assert.equal((await call('verifyCompany', { company: COMPANY })).error.message, 'Service Key non valida o ruotata.');
  assert.equal((await call('verifyCompany', { company: COMPANY })).error.code, 'not_connected');
});

test('azienda duplicata per dominio: doppione certo, creazione bloccata', async () => {
  const { fake, call, posts } = await setup();
  const id = fake.addCompany({ name: 'Cantina Rossi Srl', domain: 'cantinarossi.it', city: 'Foligno', hubspot_owner_id: ALESSANDRO.hubspotOwnerId, hs_lead_status: 'NEW' });
  const res = await call('verifyCompany', { company: { ...COMPANY, domain: 'https://www.CantinaRossi.it/' } });
  assert.equal(res.outcome, 'certain');
  assert.deepEqual(res.matches.map((m) => [m.id, m.level, m.ownerName, m.leadStatus, m.reasons[0]]), [[id, 'certain', 'Alessandro Poponi', 'NEW', 'domain']]);
  assert.equal(res.matches[0].url, `https://app-eu1.hubspot.com/contacts/149362651/record/0-2/${id}`);
  const create = await call('createCompany', { company: COMPANY, acknowledged: [id] });
  assert.deepEqual([create.ok, create.error.code], [false, 'duplicate'], 'nessuna possibilità di creare un doppione certo');
  assert.equal(posts(COMPANIES).length, 0);
});

test('sottodomini diversi non sono lo stesso dominio', async () => {
  const { fake, call } = await setup();
  fake.addCompany({ name: 'Shop Rossi', domain: 'shop.cantinarossi.it' });
  assert.equal((await call('verifyCompany', { company: COMPANY })).outcome, 'none');
});

test('azienda duplicata per email: doppione forte, da controllare', async () => {
  const { fake, call } = await setup();
  const id = fake.addCompany({ name: 'Vini del Borgo', domain: 'vinidelborgo.it', email_aziendale_secondaria: 'INFO@cantinarossi.it' });
  const res = await call('verifyCompany', { company: COMPANY });
  assert.deepEqual([res.outcome, res.matches[0].id, res.matches[0].level, res.matches[0].reasons], ['possible', id, 'strong', ['email']]);
});

test('azienda duplicata per telefono (scritto in un altro formato)', async () => {
  const { fake, call } = await setup();
  const id = fake.addCompany({ name: 'Vini del Borgo', domain: 'vinidelborgo.it', phone: '0742 123456' });
  const res = await call('verifyCompany', { company: COMPANY });
  assert.deepEqual([res.outcome, res.matches[0].id, res.matches[0].reasons], ['possible', id, ['phone']]);
});

test('possibile duplicato per nome e città; creazione solo dopo la conferma del commerciale', async () => {
  const { fake, call, posts } = await setup();
  const id = fake.addCompany({ name: 'Cantina Rossi S.r.l. Società Agricola', domain: 'vecchio-sito-rossi.it', city: 'FOLIGNO' });
  fake.addCompany({ name: 'Hotel Bellavista', domain: 'bellavista.it', city: 'Foligno' }); // stessa città, altro nome
  fake.addCompany({ name: 'Cantina Rossi', domain: 'altra-rossi.it', city: 'Montalcino' }); // stesso nome, altra città
  const res = await call('verifyCompany', { company: COMPANY });
  assert.deepEqual([res.outcome, res.matches.map((m) => [m.id, m.level, m.reasons[0]])], ['possible', [[id, 'possible', 'name_city']]]);
  const blocked = await call('createCompany', { company: COMPANY });
  assert.deepEqual([blocked.error.code, blocked.error.message], ['duplicate', MESSAGES.unconfirmed]);
  const created = await call('createCompany', { company: COMPANY, acknowledged: [id] });
  assert.equal(created.outcome, 'created');
  assert.equal(posts(COMPANIES).length, 1);
});

test('nessun duplicato; senza verifica la creazione non parte', async () => {
  const { call, posts } = await setup();
  const early = await call('createCompany', { company: COMPANY });
  assert.deepEqual([early.error.code, early.error.message], ['not_verified', MESSAGES.notVerified]);
  const res = await call('verifyCompany', { company: COMPANY });
  assert.deepEqual([res.outcome, res.matches, res.mock], ['none', [], false]);
  assert.equal(posts(COMPANIES).length, 0, 'la verifica non scrive nulla');
});

test('re-check subito prima della create; payload corretto, campi vuoti omessi, tipo omesso per Cantina, owner Matteo, Lead Status NEW', async () => {
  const { fake, call } = await setup();
  await call('verifyCompany', { company: COMPANY });
  const before = fake.state.requests.length;
  const res = await call('createCompany', { company: COMPANY });
  assert.equal(res.outcome, 'created');
  const calls = fake.state.requests.slice(before).map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(calls, [`POST ${COMPANIES}/search`, `POST ${COMPANIES}/search`, `POST ${COMPANIES}`], 'nuovo controllo dei doppioni, poi UNA creazione');
  const { properties } = fake.state.requests.at(-1).body;
  assert.deepEqual(properties, {
    name: 'Cantina Rossi', domain: 'cantinarossi.it', website: 'https://www.cantinarossi.it/', phone: '+39 0742123456',
    email_aziendale_principale: 'info@cantinarossi.it', settore_agria: 'Cantina / Vitivinicolo', city: 'Foligno', state: 'Umbria',
    country: 'Italia', hs_quick_context: 'WHATSAPP\n+39 333 123 4567', hubspot_owner_id: '99355637', hs_lead_status: 'NEW',
  });
  assert.ok(!('tipo_struttura_hospitality' in properties), 'tipo struttura solo per Hospitality');
  assert.ok(!('email_aziendale_secondaria' in properties) && !('linkedin_company_page' in properties), 'nessuna proprietà vuota');
  assert.deepEqual([res.company.ownerName, res.company.ownerId], ['Matteo Garuzzo', '99355637']);
  assert.match(res.company.createdAt, /^\d{4}-\d\d-\d\dT/);
  // Hospitality: il tipo si invia
  assert.equal(companyPayload({ ...COMPANY, settore_agria: 'Hospitality' }, MATTEO).properties.tipo_struttura_hospitality, 'Agriturismo');
});

test('owner Alessandro; cambio commerciale prima della create: vale il nuovo owner', async () => {
  const solo = await setup({ operator: ALESSANDRO });
  await solo.call('verifyCompany', { company: COMPANY });
  await solo.call('createCompany', { company: COMPANY });
  assert.equal(solo.posts(COMPANIES)[0].body.properties.hubspot_owner_id, '37994989');

  const { session, call, posts } = await setup({ operator: MATTEO });
  await call('verifyCompany', { company: COMPANY });
  await session.set({ activeOperator: ALESSANDRO.hubspotOwnerId }); // «Cambia» nel pannello
  const res = await call('createCompany', { company: { ...COMPANY, hubspot_owner_id: MATTEO.hubspotOwnerId } });
  assert.equal(posts(COMPANIES)[0].body.properties.hubspot_owner_id, '37994989', 'owner dalla sessione, non dal messaggio');
  assert.equal(res.company.ownerName, 'Alessandro Poponi');
  assert.equal((await call('audit')).entries[0].operator, 'Alessandro Poponi');
});

test('race condition: un collega crea l\'azienda tra verifica e creazione → nessun duplicato', async () => {
  const { fake, call, posts } = await setup();
  assert.equal((await call('verifyCompany', { company: COMPANY })).outcome, 'none');
  const id = fake.addCompany({ name: 'Cantina Rossi', domain: 'cantinarossi.it', hubspot_owner_id: ALESSANDRO.hubspotOwnerId });
  const res = await call('createCompany', { company: COMPANY });
  assert.deepEqual([res.outcome, res.message], ['race', "L'azienda è stata aggiunta a HubSpot da un'altra operazione. Nessun duplicato è stato creato."]);
  assert.deepEqual(res.matches.map((m) => m.id), [id]);
  assert.equal(posts(COMPANIES).length, 0);
  const entry = (await call('audit')).entries[0];
  assert.deepEqual([entry.operation, entry.outcome, entry.ok], ['Creazione Azienda', 'Bloccata: aggiunta nel frattempo', false]);
});

test('doppio click non crea due record', async () => {
  const { call, posts } = await setup();
  await call('verifyCompany', { company: COMPANY });
  const [a, b] = await Promise.all([call('createCompany', { company: COMPANY }), call('createCompany', { company: COMPANY })]);
  assert.deepEqual([a.outcome, b.ok, b.error?.code].sort(), ['busy', 'created', false].sort());
  assert.equal(posts(COMPANIES).length, 1);
  // un altro clic dopo: l'azienda appena creata conta come doppione certo, anche se la ricerca non la vede ancora
  const again = await call('createCompany', { company: COMPANY });
  assert.equal(again.outcome, 'race');
  assert.equal(posts(COMPANIES).length, 1);
  assert.equal((await call('verifyCompany', { company: COMPANY })).outcome, 'certain');
});

test('esito incerto (5xx) sulla creazione: nessun nuovo tentativo senza una nuova verifica', async () => {
  const { fake, call, posts } = await setup();
  await call('verifyCompany', { company: COMPANY });
  fake.force('POST', /companies$/, fake.response.error(500, 'Internal error'));
  const failed = await call('createCompany', { company: COMPANY });
  assert.deepEqual([failed.error.code, /Premi di nuovo «Verifica HubSpot»/.test(failed.error.message)], ['server', true]);
  assert.equal((await call('createCompany', { company: COMPANY })).error.code, 'not_verified', 'la verifica precedente non vale più');
  assert.equal(posts(COMPANIES).length, 1);
  // HubSpot l'aveva creata davvero: la nuova verifica la trova
  fake.addCompany({ name: 'Cantina Rossi', domain: 'cantinarossi.it' });
  assert.equal((await call('verifyCompany', { company: COMPANY })).outcome, 'certain');
});

test('validation error 2026-09: messaggio leggibile, nessun tentativo di aggirarlo', async () => {
  const { fake, call, posts } = await setup();
  fake.requireProperty('companies', 'industry');
  await call('verifyCompany', { company: COMPANY });
  const res = await call('createCompany', { company: COMPANY });
  assert.equal(res.error.code, 'validation');
  assert.match(res.error.message, /^HubSpot ha rifiutato i dati per le regole del portale:\n- industry \(industry\): obbligatorio per una regola condizionale del portale\.$/);
  assert.equal(posts(COMPANIES).length, 1, 'una sola richiesta, non ripetuta');
});

async function createdCompany(opts) {
  const ctx = await setup(opts);
  await ctx.call('verifyCompany', { company: COMPANY });
  const res = await ctx.call('createCompany', { company: COMPANY });
  return { ...ctx, companyId: res.company.id };
}

test('contatto duplicato per email, telefono o LinkedIn: nessun nuovo contatto, nessuna associazione', async () => {
  for (const [props, reason] of [
    [{ email: 'MARIO.ROSSI@cantinarossi.it', firstname: 'Mario', lastname: 'Rossi' }, 'email'],
    [{ phone: '333 1234567', firstname: 'M.', lastname: 'Rossi' }, 'phone'],
    [{ mobilephone: '+393331234567', firstname: 'Mario', lastname: 'R.' }, 'mobilephone'],
    [{ hs_linkedin_url: 'https://it.linkedin.com/in/Mario-Rossi-Vino/', firstname: 'Mario', lastname: 'Rossi' }, 'linkedin'],
  ]) {
    const { fake, call, companyId, posts } = await createdCompany();
    const existing = fake.addContact(props);
    const contact = reason === 'linkedin' ? { ...CONTACT, email: '', mobilephone: '' } : reason === 'email' ? CONTACT : { ...CONTACT, email: '' };
    const res = await call('createContact', { contact, companyId, legalBasisConfirmed: true });
    assert.deepEqual([res.outcome, res.matches[0].id, res.matches[0].reasons[0]], ['exists', existing, reason], reason);
    assert.equal(posts(CONTACTS).length, 0, reason);
    assert.equal(fake.state.associations.length, 0, `${reason}: il contatto esistente non viene associato né modificato`);
    assert.ok(fake.state.requests.every((r) => r.method !== 'PATCH'));
  }
});

test('contatto valido: creato con owner e associato all\'azienda (associazione predefinita)', async () => {
  const { fake, call, companyId, posts } = await createdCompany();
  const res = await call('createContact', { contact: CONTACT, companyId, legalBasisConfirmed: true, companyName: 'Cantina Rossi' });
  assert.equal(res.outcome, 'created');
  assert.equal(res.contact.associated, true);
  assert.deepEqual(posts(CONTACTS)[0].body.properties, {
    firstname: 'Mario', lastname: 'Rossi', jobtitle: 'Titolare', email: 'mario.rossi@cantinarossi.it', mobilephone: '+39 333 123 4567',
    hs_linkedin_url: 'https://www.linkedin.com/in/mario-rossi-vino', hubspot_owner_id: '99355637', hs_legal_basis: 'Legitimate interest – prospect/lead',
  });
  assert.deepEqual(fake.state.associations, [{ contactId: res.contact.id, companyId }]);
  const put = fake.state.requests.find((r) => r.method === 'PUT');
  assert.equal(put.path, `/crm/objects/2026-09/contact/${res.contact.id}/associations/default/company/${companyId}`);
});

test('contatto non valido: niente richieste', async () => {
  const { fake, call, companyId } = await createdCompany();
  const before = fake.state.requests.length;
  const res = await call('createContact', { contact: { ...CONTACT, lastname: '' }, companyId });
  assert.equal(res.error.code, 'invalid_input');
  assert.match(res.error.message, /servono nome, cognome e almeno uno tra email, telefono e LinkedIn/);
  assert.equal(fake.state.requests.length, before);
  assert.deepEqual(contactPayload({ firstname: 'Anna', lastname: 'Neri', hs_linkedin_url: 'https://www.linkedin.com/in/anna-neri' }, MATTEO).errors, [], 'basta il LinkedIn');
});

test('base giuridica: non confermata → non inviata; confermata → inviata', async () => {
  const no = await createdCompany();
  await no.call('createContact', { contact: CONTACT, companyId: no.companyId, legalBasisConfirmed: false });
  assert.ok(!('hs_legal_basis' in no.posts(CONTACTS)[0].body.properties));
  const yes = await createdCompany();
  await yes.call('createContact', { contact: CONTACT, companyId: yes.companyId, legalBasisConfirmed: true });
  assert.equal(yes.posts(CONTACTS)[0].body.properties.hs_legal_basis, 'Legitimate interest – prospect/lead');
  assert.equal(contactPayload(CONTACT, MATTEO, { legalBasisConfirmed: 'sì' }).properties.hs_legal_basis, undefined, 'solo un true esplicito');
});

test('azienda creata + contatto fallito: la bozza tiene l\'azienda, il nuovo tentativo non la ricrea', async () => {
  const { fake, call, companyId, posts } = await createdCompany();
  fake.force('POST', /contacts$/, fake.response.error(500, 'Internal error'));
  const failed = await call('createContact', { contact: CONTACT, companyId, legalBasisConfirmed: true });
  assert.deepEqual([failed.ok, failed.error.code], [false, 'server']);
  assert.match(failed.error.message, /cerca di nuovo il contatto in HubSpot prima di crearlo/);
  assert.equal(fake.state.contacts.length, 0);
  const retry = await call('createContact', { contact: CONTACT, companyId, legalBasisConfirmed: true });
  assert.equal(retry.outcome, 'created');
  assert.equal(posts(COMPANIES).length, 1, 'una sola azienda');
  assert.equal(fake.state.contacts.length, 1, 'un solo contatto');
  assert.deepEqual(fake.state.associations, [{ contactId: retry.contact.id, companyId }]);
});

test('contatto creato ma associazione fallita: si riprova solo l\'associazione', async () => {
  const { fake, call, companyId, posts } = await createdCompany();
  fake.force('PUT', /associations/, fake.response.error(503, 'down'));
  const partial = await call('createContact', { contact: CONTACT, companyId });
  assert.deepEqual([partial.outcome, partial.contact.associated], ['partial', false]);
  assert.match(partial.error.message, /errore 503/);
  // un nuovo clic su «Crea» non crea un secondo contatto
  assert.equal((await call('createContact', { contact: CONTACT, companyId })).outcome, 'exists');
  const done = await call('associateContact', { contactId: partial.contact.id, companyId });
  assert.equal(done.outcome, 'associated');
  assert.equal(posts(CONTACTS).length, 1);
  assert.deepEqual(fake.state.associations, [{ contactId: partial.contact.id, companyId }]);
  // solo contatti creati da Scout in questa sessione
  assert.equal((await call('associateContact', { contactId: '123', companyId })).error.code, 'invalid_input');
});

test('azienda già presente + nuovo contatto: creato e associato a quell\'azienda, azienda non modificata', async () => {
  const { fake, call, posts } = await setup();
  const id = fake.addCompany({ name: 'Cantina Rossi', domain: 'cantinarossi.it', hubspot_owner_id: ALESSANDRO.hubspotOwnerId, hs_lead_status: 'IN_PROGRESS' });
  await call('verifyCompany', { company: COMPANY });
  const res = await call('createContact', { contact: CONTACT, companyId: id });
  assert.equal(res.outcome, 'created');
  assert.deepEqual(fake.state.associations, [{ contactId: res.contact.id, companyId: id }]);
  assert.equal(posts(COMPANIES).length, 0);
  assert.deepEqual(fake.state.companies[0].properties, { name: 'Cantina Rossi', domain: 'cantinarossi.it', hubspot_owner_id: ALESSANDRO.hubspotOwnerId, hs_lead_status: 'IN_PROGRESS' });
  // solo verso aziende verificate o create in questa sessione
  assert.equal((await call('createContact', { contact: { ...CONTACT, email: 'altro@x.it' }, companyId: '424242' })).error.code, 'invalid_input');
});

test('senza commerciale attivo nessuna operazione CRM', async () => {
  const { fake, call } = await setup({ operator: null });
  for (const action of ['verifyCompany', 'createCompany', 'createContact']) {
    assert.equal((await call(action, { company: COMPANY, contact: CONTACT, companyId: '1' })).error.code, 'no_operator', action);
  }
  assert.equal(fake.state.requests.filter((r) => r.method !== 'GET').length, 0);
});

test('registro locale: commerciale, operazione, azienda, ID, esito; niente segreti', async () => {
  const { call, companyId } = await createdCompany();
  const { entries } = await call('audit');
  const [create, verify] = entries;
  assert.deepEqual([create.operator, create.operation, create.company, create.recordId, create.outcome, create.ok], ['Matteo Garuzzo', 'Creazione Azienda', 'Cantina Rossi', companyId, 'Successo', true]);
  assert.deepEqual([verify.operation, verify.outcome], ['Verifica HubSpot', 'Non presente']);
  assert.ok(entries.every((e) => Object.keys(e).sort().join() === 'at,company,mock,ok,operation,operator,outcome,recordId'));
});

test("MOCK e REALE separati: un'azienda creata in simulazione non blocca quella vera", async () => {
  const { local, call, posts } = await setup();
  await local.set({ config: { hubspot: { mode: 'mock', mockScenario: 'not_found' }, scan: { maxPages: 30 } } });
  await call('verifyCompany', { company: COMPANY });
  assert.match((await call('createCompany', { company: COMPANY })).company.id, /^MOCK-/);
  await local.set({ config: { hubspot: { mode: 'real', mockScenario: 'not_found' }, scan: { maxPages: 30 } } });
  assert.equal((await call('createCompany', { company: COMPANY })).error.code, 'not_verified', 'la verifica MOCK non vale per il reale');
  assert.equal((await call('verifyCompany', { company: COMPANY })).outcome, 'none');
  assert.equal((await call('createCompany', { company: COMPANY })).outcome, 'created');
  assert.equal(posts(COMPANIES).length, 1);
});

test('MOCK: stesso flusso simulato, nessuna rete e nessuna chiave', async () => {
  const absent = await setup({ mode: 'mock', key: null });
  assert.equal((await absent.call('status')).ready, true);
  const verify = await absent.call('verifyCompany', { company: COMPANY });
  assert.deepEqual([verify.outcome, verify.mock], ['none', true]);
  const created = await absent.call('createCompany', { company: COMPANY });
  assert.deepEqual([created.outcome, created.mock], ['created', true]);
  assert.match(created.company.id, /^MOCK-/);
  const contact = await absent.call('createContact', { contact: CONTACT, companyId: created.company.id });
  assert.deepEqual([contact.outcome, contact.contact.associated], ['created', true]);
  assert.equal(absent.fake.state.requests.length, 0);

  const present = await setup({ mode: 'mock', key: null, mockScenario: 'found' });
  const found = await present.call('verifyCompany', { company: COMPANY });
  assert.deepEqual([found.outcome, found.matches[0].id], ['certain', 'MOCK-1001']);
  assert.equal((await present.call('createCompany', { company: COMPANY })).error.code, 'duplicate');

  const broken = await setup({ mode: 'mock', key: null, mockScenario: 'error' });
  assert.equal((await broken.call('verifyCompany', { company: COMPANY })).error.code, 'mock_error');
});

// ---------------------------------------------------------------------------------------------
// Patch 2.0.1: un duplicato certo non ha conferma possibile

const POGGIO = Object.freeze({
  ...COMPANY, name: 'Agriturismo Il Poggio del Sole', domain: 'test-fallback-scout.invalid', website: '', city: 'Siena',
  email_aziendale_principale: 'info@poggiodelsole.it', phone: '+39 0577 123456', settore_agria: 'Hospitality',
});

test('caso reale: dominio diverso ma stessa email e stesso telefono → duplicato certo, creazione impossibile', async () => {
  const { fake, call, posts } = await setup();
  const id = fake.addCompany({ name: 'Agriturismo Il Poggio del Sole', domain: 'poggiodelsole.it', email_aziendale_principale: 'info@poggiodelsole.it', phone: '0577 123456', city: 'Siena', hs_lead_status: 'ATTEMPTED_TO_CONTACT' });
  const res = await call('verifyCompany', { company: POGGIO });
  assert.deepEqual([res.outcome, res.matches[0].id, res.matches[0].level], ['certain', id, 'certain']);
  assert.deepEqual(res.matches[0].reasons.slice(0, 2), ['email', 'phone']);
  assert.equal(res.matches[0].leadStatus, 'ATTEMPTED_TO_CONTACT', 'il valore API resta quello di HubSpot');
  // nemmeno una conferma forzata nel messaggio lo sblocca
  const forced = await call('createCompany', { company: POGGIO, acknowledged: [id] });
  assert.deepEqual([forced.ok, forced.error.code, forced.error.message], [false, 'duplicate', MESSAGES.certain]);
  assert.equal(posts(COMPANIES).length, 0);
});

test('stessa email + stesso nome, stesso telefono + stesso nome: duplicato certo', async () => {
  for (const props of [
    { name: 'Il Poggio del Sole S.r.l.', domain: 'altro.it', email_aziendale_secondaria: 'info@poggiodelsole.it' },
    { name: 'POGGIO DEL SOLE', domain: 'altro.it', phone: '+390577123456', city: 'Firenze' },
  ]) {
    const { fake, call, posts } = await setup();
    const id = fake.addCompany(props);
    assert.equal((await call('verifyCompany', { company: POGGIO })).outcome, 'certain', JSON.stringify(props));
    assert.equal((await call('createCompany', { company: POGGIO, acknowledged: [id] })).error.code, 'duplicate');
    assert.equal(posts(COMPANIES).length, 0);
  }
});

test('una sola email in comune: possibile duplicato, si crea solo dopo la conferma', async () => {
  const { fake, call, posts } = await setup();
  const id = fake.addCompany({ name: 'Altra Insegna', domain: 'altro.it', email_aziendale_principale: 'info@poggiodelsole.it' });
  const res = await call('verifyCompany', { company: POGGIO });
  assert.deepEqual([res.outcome, res.matches[0].level], ['possible', 'strong']);
  assert.equal((await call('createCompany', { company: POGGIO })).error.code, 'duplicate', 'senza conferma no');
  assert.equal((await call('createCompany', { company: POGGIO, acknowledged: [id] })).outcome, 'created');
  assert.equal(posts(COMPANIES).length, 1);
});
