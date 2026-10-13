// Outreach, parte pura: calendario del follow-up (Europe/Rome, +2 giorni lavorativi alle 14:30),
// piano delle scritture del primo contatto (date scritte una sola volta), prospect letto dalla bozza.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSnapshot } from '../extension/lib/parser.js';
import { applyFindings, emptyDraft, updateHubspot } from '../extension/lib/draft.js';
import {
  COMPANY_DATE, CONTACT_DATE, followUpTask, isAlreadyContacted, isSameFollowUp, outreachProspect, planFirstContact, recipientOptions,
  remainingCompanyProperties, sameDateValue, taskBody,
} from '../extension/lib/outreach.js';
import {
  addBusinessDays, followUpSchedule, formatDue, formatHubspotDate, formatRomeDateTime, romeIsoDate, romeParts,
} from '../extension/lib/outreachTime.js';
import { OPERATORS } from '../extension/lib/operators.js';

const [MATTEO, ALESSANDRO] = OPERATORS;
const at = (iso) => Date.parse(iso);
const iso = (ms) => new Date(ms).toISOString();
// martedì 13 ottobre 2026, 10:42 in Italia (CEST, UTC+2)
const TUESDAY = at('2026-10-13T08:42:00Z');
const TYPES = { companyDate: 'datetime', contactDate: 'datetime' };
const COMPANY = { id: '9001', name: 'Cantina Rossi', leadStatus: 'NEW', firstEmailAt: '' };
const ROBERTO = { id: '9002', name: 'Roberto Rossi', jobtitle: 'Titolare', firstEmailAt: '' };

// ---- +2 giorni lavorativi ----

const WEEK = [
  ['lunedì', '2026-10-12T08:00:00Z', 'mercoledì 14/10/2026 alle 14:30'],
  ['martedì', '2026-10-13T08:42:00Z', 'giovedì 15/10/2026 alle 14:30'],
  ['mercoledì', '2026-10-14T08:00:00Z', 'venerdì 16/10/2026 alle 14:30'],
  ['giovedì', '2026-10-15T08:00:00Z', 'lunedì 19/10/2026 alle 14:30'],
  ['venerdì', '2026-10-16T08:00:00Z', 'martedì 20/10/2026 alle 14:30'],
  ['sabato', '2026-10-17T08:00:00Z', 'martedì 20/10/2026 alle 14:30'],
  ['domenica', '2026-10-18T08:00:00Z', 'martedì 20/10/2026 alle 14:30'],
];
for (const [day, when, expected] of WEEK) {
  test(`+2 giorni lavorativi: conferma di ${day} → ${expected}`, () => {
    assert.equal(formatDue(followUpSchedule(at(when)).dueAt), expected);
  });
}

test('+2 giorni lavorativi: funzione pura sul giorno di calendario', () => {
  assert.deepEqual(addBusinessDays({ year: 2026, month: 10, day: 15 }, 2), { year: 2026, month: 10, day: 19, weekday: 1 });
  assert.deepEqual(addBusinessDays({ year: 2026, month: 12, day: 31 }, 2), { year: 2027, month: 1, day: 4, weekday: 1 }, 'cambio anno');
  assert.deepEqual(addBusinessDays({ year: 2026, month: 12, day: 24 }, 2), { year: 2026, month: 12, day: 28, weekday: 1 }, 'le festività non contano: 25/12 è lavorativo');
});

test('scadenza alle 14:30 Europe/Rome, promemoria 30 minuti prima', () => {
  const s = followUpSchedule(TUESDAY);
  assert.deepEqual([romeParts(s.dueAt).hour, romeParts(s.dueAt).minute], [14, 30]);
  assert.equal(s.dueAt - s.reminderAt, 30 * 60 * 1000);
  assert.equal(iso(s.reminderAt), '2026-10-15T12:00:00.000Z');
});

test('CET (inverno): 14:30 in Italia = 13:30 UTC', () => {
  const s = followUpSchedule(at('2026-01-12T09:00:00Z'));
  assert.equal(iso(s.dueAt), '2026-01-14T13:30:00.000Z');
  assert.equal(formatDue(s.dueAt), 'mercoledì 14/01/2026 alle 14:30');
});

test('CEST (estate): 14:30 in Italia = 12:30 UTC', () => {
  assert.equal(iso(followUpSchedule(TUESDAY).dueAt), '2026-10-15T12:30:00.000Z');
  assert.equal(iso(followUpSchedule(at('2026-07-01T07:00:00Z')).dueAt), '2026-07-03T12:30:00.000Z');
});

test('cambio d\'ora fra conferma e scadenza: vale l\'ora del giorno della scadenza', () => {
  // venerdì 23/10 in CEST → martedì 27/10 in CET (ora solare dal 25/10)
  assert.equal(iso(followUpSchedule(at('2026-10-23T09:00:00Z')).dueAt), '2026-10-27T13:30:00.000Z');
  // venerdì 27/03 in CET → martedì 31/03 in CEST (ora legale dal 29/03)
  assert.equal(iso(followUpSchedule(at('2026-03-27T09:00:00Z')).dueAt), '2026-03-31T12:30:00.000Z');
});

test('il giorno è quello italiano, non quello UTC', () => {
  // lunedì 23:30 UTC = martedì 01:30 in Italia → giovedì
  const late = at('2026-10-12T23:30:00Z');
  assert.equal(romeIsoDate(late), '2026-10-13');
  assert.equal(formatDue(followUpSchedule(late).dueAt), 'giovedì 15/10/2026 alle 14:30');
});

test('date in italiano: 13/10/2026, 10:42; valori HubSpot ISO, data o millisecondi', () => {
  assert.equal(formatRomeDateTime(TUESDAY), '13/10/2026, 10:42');
  assert.equal(formatHubspotDate('2026-10-13T08:42:00.000Z'), '13/10/2026, 10:42');
  assert.equal(formatHubspotDate('2026-01-13T09:42:00Z'), '13/01/2026, 10:42', 'CET');
  assert.equal(formatHubspotDate('2026-10-13'), '13/10/2026');
  assert.equal(formatHubspotDate(String(TUESDAY)), '13/10/2026, 10:42');
  assert.equal(formatHubspotDate(''), '');
});

// ---- piano del primo contatto ----

test('email all\'Azienda: Lead Status → ATTEMPTED_TO_CONTACT, data Azienda (vuota) valorizzata, nessun Contatto', () => {
  const plan = planFirstContact({ company: COMPANY, recipient: { type: 'company' }, owner: MATTEO, now: TUESDAY, types: TYPES });
  assert.deepEqual(plan.companyProperties, { hs_lead_status: 'ATTEMPTED_TO_CONTACT', [COMPANY_DATE]: String(TUESDAY) });
  assert.equal(plan.contactProperties, null, 'email all\'Azienda: il Contatto non si tocca');
  assert.deepEqual(plan.writes, { companyDate: true, contactDate: false });
});

test('data Azienda già valorizzata: non si riscrive (write once)', () => {
  const plan = planFirstContact({ company: { ...COMPANY, firstEmailAt: '2026-09-01T08:00:00Z' }, recipient: { type: 'company' }, owner: MATTEO, now: TUESDAY, types: TYPES });
  assert.deepEqual(plan.companyProperties, { hs_lead_status: 'ATTEMPTED_TO_CONTACT' });
  assert.equal(plan.writes.companyDate, false);
});

test('email al Contatto: data del Contatto (vuota) valorizzata; Azienda e Contatto possono avere date diverse', () => {
  const plan = planFirstContact({ company: { ...COMPANY, firstEmailAt: '2026-09-01T08:00:00Z' }, contact: ROBERTO, recipient: { type: 'contact', contactId: '9002' }, owner: MATTEO, now: TUESDAY, types: TYPES });
  assert.deepEqual(plan.contactProperties, { [CONTACT_DATE]: String(TUESDAY) });
  assert.ok(!(COMPANY_DATE in plan.companyProperties), 'la data dell\'Azienda resta quella di prima');
  assert.deepEqual(plan.writes, { companyDate: false, contactDate: true });
});

test('data del Contatto già valorizzata: non si riscrive', () => {
  const plan = planFirstContact({ company: COMPANY, contact: { ...ROBERTO, firstEmailAt: '2026-09-01T08:00:00Z' }, recipient: { type: 'contact', contactId: '9002' }, owner: MATTEO, now: TUESDAY, types: TYPES });
  assert.equal(plan.contactProperties, null);
  assert.equal(plan.writes.contactDate, false);
});

test('proprietà di tipo data (non datetime): giorno italiano YYYY-MM-DD', () => {
  const late = at('2026-10-12T23:30:00Z');
  const plan = planFirstContact({ company: COMPANY, contact: ROBERTO, recipient: { type: 'contact', contactId: '9002' }, owner: MATTEO, now: late, types: { companyDate: 'date', contactDate: 'date' } });
  assert.equal(plan.companyProperties[COMPANY_DATE], '2026-10-13');
  assert.equal(plan.contactProperties[CONTACT_DATE], '2026-10-13');
  assert.throws(() => planFirstContact({ company: COMPANY, recipient: { type: 'company' }, owner: MATTEO, now: TUESDAY, types: { companyDate: 'string' } }), /tipo di proprietà non gestito/);
});

test('task di follow-up: titolo, note, CALL, NOT_STARTED, NONE, scadenza, promemoria, associazione Azienda (192)', () => {
  const { task, dueAt, reminderAt } = planFirstContact({ company: COMPANY, recipient: { type: 'company' }, owner: MATTEO, now: TUESDAY, types: TYPES });
  assert.deepEqual(task.properties, {
    hs_task_subject: 'FOLLOW-UP | Cantina Rossi',
    hs_task_body: 'Primo follow-up dopo email commerciale Agria System.',
    hs_task_type: 'CALL', hs_task_status: 'NOT_STARTED', hs_task_priority: 'NONE',
    hs_timestamp: String(at('2026-10-15T12:30:00Z')),
    hs_task_reminders: String(at('2026-10-15T12:00:00Z')),
    hubspot_owner_id: MATTEO.hubspotOwnerId,
  });
  assert.equal(task.properties.hs_timestamp, String(dueAt));
  assert.equal(task.properties.hs_task_reminders, String(reminderAt));
  assert.deepEqual(task.associations, [{ to: { id: '9001' }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 192 }] }]);
});

test('task per email al Contatto: note con il Contatto, associato anche al Contatto (204)', () => {
  const { task } = planFirstContact({ company: COMPANY, contact: ROBERTO, recipient: { type: 'contact', contactId: '9002' }, owner: ALESSANDRO, now: TUESDAY, types: TYPES });
  assert.equal(task.properties.hs_task_body, 'Primo follow-up dopo email commerciale Agria System.\nContatto: Roberto Rossi — Titolare');
  assert.deepEqual(task.associations.map((a) => [a.to.id, a.types[0].associationTypeId]), [['9001', 192], ['9002', 204]]);
});

test('owner del follow-up: Matteo 99355637, Alessandro 37994989', () => {
  const owner = (o) => planFirstContact({ company: COMPANY, recipient: { type: 'company' }, owner: o, now: TUESDAY, types: TYPES }).task.properties.hubspot_owner_id;
  assert.equal(owner(MATTEO), '99355637');
  assert.equal(owner(ALESSANDRO), '37994989');
  assert.throws(() => planFirstContact({ company: COMPANY, recipient: { type: 'company' }, owner: null, now: TUESDAY, types: TYPES }), /commerciale attivo/);
});

test('note del task: solo testo, nessun carattere HTML', () => {
  assert.equal(taskBody({ name: 'Ro<b>berto</b> Rossi', jobtitle: '' }), 'Primo follow-up dopo email commerciale Agria System.\nContatto: Roberto Rossi');
  assert.equal(followUpTask({ companyId: '1', companyName: 'Cantina <script>', ownerId: '1', dueAt: 1, reminderAt: 0 }).properties.hs_task_subject, 'FOLLOW-UP | Cantina');
});

test('stesso follow-up: stesso titolo e stessa scadenza (ISO o millisecondi)', () => {
  const dueAt = at('2026-10-15T12:30:00Z');
  assert.ok(isSameFollowUp({ hs_task_subject: 'FOLLOW-UP | Cantina Rossi', hs_timestamp: '2026-10-15T12:30:00Z' }, { subject: 'FOLLOW-UP | Cantina Rossi', dueAt }));
  assert.ok(isSameFollowUp({ hs_task_subject: 'FOLLOW-UP | Cantina Rossi', hs_timestamp: String(dueAt) }, { subject: 'FOLLOW-UP | Cantina Rossi', dueAt }));
  assert.ok(!isSameFollowUp({ hs_task_subject: 'FOLLOW-UP | Cantina Rossi', hs_timestamp: '2026-10-16T12:30:00Z' }, { subject: 'FOLLOW-UP | Cantina Rossi', dueAt }));
  assert.ok(!isSameFollowUp({ hs_task_subject: 'FOLLOW-UP | Altra', hs_timestamp: '2026-10-15T12:30:00Z' }, { subject: 'FOLLOW-UP | Cantina Rossi', dueAt }));
});

test('nuovo tentativo: mai una data già presente, solo quello che manca', () => {
  const planned = { hs_lead_status: 'ATTEMPTED_TO_CONTACT', [COMPANY_DATE]: String(TUESDAY) };
  assert.deepEqual(remainingCompanyProperties({ leadStatus: 'NEW', firstEmailAt: '' }, planned), planned);
  assert.deepEqual(remainingCompanyProperties({ leadStatus: 'ATTEMPTED_TO_CONTACT', firstEmailAt: iso(TUESDAY) }, planned), {});
  assert.deepEqual(remainingCompanyProperties({ leadStatus: 'NEW', firstEmailAt: '2026-01-01T00:00:00Z' }, planned), { hs_lead_status: 'ATTEMPTED_TO_CONTACT' });
  assert.ok(sameDateValue(iso(TUESDAY), String(TUESDAY)));
  assert.ok(sameDateValue('2026-10-13', '2026-10-13'));
  assert.ok(!sameDateValue('2026-09-01T00:00:00Z', String(TUESDAY)));
});

test('Azienda già contattata: data del primo invio presente oppure stato ATTEMPTED_TO_CONTACT, CONNECTED, OPEN_DEAL', () => {
  assert.ok(!isAlreadyContacted({ leadStatus: 'NEW', firstEmailAt: '' }));
  assert.ok(!isAlreadyContacted({ leadStatus: 'BAD_TIMING', firstEmailAt: '' }));
  for (const s of ['ATTEMPTED_TO_CONTACT', 'CONNECTED', 'OPEN_DEAL']) assert.ok(isAlreadyContacted({ leadStatus: s, firstEmailAt: '' }), s);
  assert.ok(isAlreadyContacted({ leadStatus: 'NEW', firstEmailAt: '2026-09-01' }));
});

// ---- prospect dalla bozza di Scout ----

const PAGE = analyzeSnapshot({
  url: 'https://www.cantinarossi.it/', title: 'Cantina Rossi', links: [],
  text: { header: '', footer: '', page: 'Cantina Rossi: vini e degustazioni.\nRoberto Rossi – Titolare · roberto.rossi@cantinarossi.it\nScrivici: info@cantinarossi.it · vendite@cantinarossi.it\nVia Roma 1, 06034 Foligno (PG)' },
}, { pageType: 'home' });
const scanned = () => applyFindings(emptyDraft(), PAGE).draft;

test('Outreach senza prospect: nessuna Azienda in HubSpot → nessun prospect', () => {
  assert.equal(outreachProspect(emptyDraft(), 'mock'), null);
  assert.equal(outreachProspect(scanned(), 'mock'), null, 'scansione fatta ma Azienda non ancora in HubSpot');
  const possible = updateHubspot(scanned(), 'real', { verification: { outcome: 'possible', matches: [{ id: '5', level: 'possible', name: 'X' }], mock: false, at: '', message: '' } });
  assert.equal(outreachProspect(possible, 'real'), null, 'possibile duplicato: non è un prospect pronto');
  assert.deepEqual(recipientOptions(null), []);
});

test('Outreach con Azienda creata da Scout: dati dalla stessa bozza, destinatari Azienda', () => {
  const draft = updateHubspot(scanned(), 'real', { company: { id: '9001', name: 'Cantina Rossi', url: 'https://app.hubspot.com/x', createdAt: '', ownerId: MATTEO.hubspotOwnerId, ownerName: MATTEO.name } });
  const p = outreachProspect(draft, 'real');
  assert.deepEqual([p.companyId, p.name, p.existing, p.leadStatus, p.contact], ['9001', 'Cantina Rossi', false, 'NEW', null]);
  assert.deepEqual(p.emails.map((e) => e.email), ['info@cantinarossi.it', 'vendite@cantinarossi.it']);
  assert.deepEqual(recipientOptions(p).map((o) => [o.type, o.label]), [['company', 'Azienda — info@cantinarossi.it'], ['company', 'Azienda — vendite@cantinarossi.it']]);
  assert.equal(outreachProspect(draft, 'mock'), null, 'ogni modalità HubSpot ha il suo prospect');
});

test('Outreach con Azienda già presente (doppione certo) e Contatto HubSpot: destinatari Azienda e Contatto', () => {
  let draft = updateHubspot(scanned(), 'real', { verification: { outcome: 'certain', matches: [{ id: '777', level: 'certain', name: 'Cantina Rossi Srl', leadStatus: 'CONNECTED' }], mock: false, at: '', message: '' } });
  draft = updateHubspot(draft, 'real', { contact: { id: '888', name: 'Roberto Rossi', companyId: '777', associated: true, url: '', createdAt: '' } });
  const p = outreachProspect(draft, 'real');
  assert.deepEqual([p.companyId, p.name, p.existing, p.leadStatus], ['777', 'Cantina Rossi Srl', true, 'CONNECTED']);
  assert.deepEqual(p.contact, { id: '888', name: 'Roberto Rossi', jobtitle: 'Titolare' });
  assert.deepEqual(recipientOptions(p).at(-1), { key: 'contact:888', type: 'contact', contactId: '888', label: 'Roberto Rossi — Titolare' });
  // contatto già presente in HubSpot (trovato da Scout): vale come Contatto HubSpot valido
  const existing = updateHubspot(updateHubspot(draft, 'real', { contact: null }), 'real', { contactMatches: [{ id: '999', name: 'Roberto Rossi', jobtitle: 'Enologo' }] });
  assert.deepEqual(outreachProspect(existing, 'real').contact, { id: '999', name: 'Roberto Rossi', jobtitle: 'Enologo' });
  // più contatti trovati: nessuno scelto in automatico
  const many = updateHubspot(existing, 'real', { contactMatches: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }] });
  assert.equal(outreachProspect(many, 'real').contact, null);
});
