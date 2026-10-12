// Commerciali: registro, scelta per la sessione di Chrome, proprietario HubSpot di Azienda e Contatto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSnapshot } from '../extension/lib/parser.js';
import { applyFindings, crmRecords, editField, emptyDraft, restoreDraft, setLegalBasisConfirmed } from '../extension/lib/draft.js';
import {
  loadActiveOperator, onOperatorChange, operatorById, OPERATORS, OperatorRequiredError, requireOperator, selectOperator,
} from '../extension/lib/operators.js';

// chrome.storage.session in memoria, con l'evento onChanged come in Chrome
const listeners = [];
globalThis.chrome = { storage: { onChanged: { addListener: (fn) => listeners.push(fn) } } };
function sessionStorage() {
  const data = {};
  return {
    data,
    async get(key) { return key in data ? { [key]: structuredClone(data[key]) } : {}; },
    async set(obj) {
      const changes = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { oldValue: data[k], newValue: v }]));
      Object.assign(data, structuredClone(obj));
      for (const fn of listeners) fn(changes, 'session');
    },
  };
}

const [MATTEO, ALESSANDRO] = OPERATORS;
const HOME = analyzeSnapshot({
  url: 'https://www.cantinarossi.it/',
  title: 'Cantina Rossi',
  links: [],
  text: { header: '', footer: '', page: 'Cantina Rossi: vini, vigneti, vendemmia, degustazioni in cantina.\nMario Rossi – Titolare · mario.rossi@cantinarossi.it\nTel. 0742 123456' },
}, { pageType: 'home' });

test('registro dei commerciali: i due commerciali Agria, ID owner unici, un solo file da modificare', () => {
  assert.deepEqual(OPERATORS.map((o) => [o.name, o.hubspotOwnerId]), [
    ['Matteo Garuzzo', '99355637'],
    ['Alessandro Poponi', '37994989'],
  ]);
  assert.ok(OPERATORS.every((o) => /^\d+$/.test(o.hubspotOwnerId) && o.name.trim()), 'nome e ID owner numerico');
  assert.equal(new Set(OPERATORS.map((o) => o.hubspotOwnerId)).size, OPERATORS.length, 'ID owner unici');
  assert.ok(Object.isFrozen(OPERATORS) && OPERATORS.every(Object.isFrozen), 'non modificabile a runtime');
  // nomi e ID stanno solo nel registro: pannello e Impostazioni li leggono da lì
  const ext = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension');
  const files = fs.readdirSync(ext, { recursive: true }).map(String).filter((f) => /\.(js|html|json|css)$/.test(f));
  for (const o of OPERATORS) {
    for (const value of [o.name, o.hubspotOwnerId]) {
      const found = files.filter((f) => fs.readFileSync(path.join(ext, f), 'utf8').includes(value)).map((f) => f.replace(/\\/g, '/'));
      assert.deepEqual(found, ['lib/operators.js'], `${value} solo nel registro`);
    }
  }
});

test('selezione Matteo: commerciale attivo della sessione', async () => {
  const session = sessionStorage();
  assert.deepEqual(await selectOperator(MATTEO.hubspotOwnerId, session), MATTEO);
  assert.deepEqual(await loadActiveOperator(session), { name: 'Matteo Garuzzo', hubspotOwnerId: '99355637' });
  assert.deepEqual(session.data, { activeOperator: '99355637' }, 'in sessione solo l\'ID: il resto viene dal registro');
});

test('selezione Alessandro: commerciale attivo della sessione', async () => {
  const session = sessionStorage();
  assert.deepEqual(await selectOperator(ALESSANDRO.hubspotOwnerId, session), ALESSANDRO);
  assert.deepEqual(await loadActiveOperator(session), { name: 'Alessandro Poponi', hubspotOwnerId: '37994989' });
});

test('cambio commerciale durante la sessione: tutti i pannelli lo ricevono, la bozza non cambia', async () => {
  const session = sessionStorage();
  const seen = [];
  onOperatorChange((o) => seen.push(o?.name ?? null));
  let { draft } = applyFindings(emptyDraft(), HOME);
  const before = JSON.stringify(draft);
  await selectOperator(MATTEO.hubspotOwnerId, session);
  await selectOperator(ALESSANDRO.hubspotOwnerId, session);
  assert.deepEqual(seen, ['Matteo Garuzzo', 'Alessandro Poponi']);
  assert.deepEqual(await loadActiveOperator(session), ALESSANDRO);
  assert.equal(JSON.stringify(draft), before, 'il prospect resta com\'era: il proprietario non sta nella bozza');
  // un evento di altre aree (Impostazioni in chrome.storage.local) non cambia il commerciale
  for (const fn of listeners) fn({ activeOperator: { newValue: MATTEO.hubspotOwnerId } }, 'local');
  assert.equal(seen.length, 2);
  draft = editField(draft, 'company', 'city', 'Montefalco');
  assert.equal(crmRecords(draft, await loadActiveOperator(session)).company.hubspot_owner_id, ALESSANDRO.hubspotOwnerId);
});

test('owner Azienda: sempre il commerciale attivo, aggiornato subito al cambio', () => {
  const { draft } = applyFindings(emptyDraft(), HOME);
  assert.equal(crmRecords(draft, MATTEO).company.hubspot_owner_id, '99355637');
  assert.equal(crmRecords(draft, ALESSANDRO).company.hubspot_owner_id, '37994989', 'stessa bozza, nuovo commerciale');
  const company = crmRecords(draft, ALESSANDRO).company;
  assert.equal(company.domain, 'cantinarossi.it');
  assert.equal(company.settore_agria, 'Cantina / Vitivinicolo');
  assert.ok(!('tipo_struttura_hospitality' in company), 'campo nascosto fuori dall\'Hospitality: non si invia');
  assert.equal(crmRecords(editField(draft, 'company', 'settore_agria', 'Hospitality'), MATTEO).company.tipo_struttura_hospitality, '');
});

test('owner Contatto: sempre il commerciale attivo, aggiornato subito al cambio', () => {
  let { draft } = applyFindings(emptyDraft(), HOME);
  assert.equal(crmRecords(draft, MATTEO).contact.hubspot_owner_id, '99355637');
  assert.equal(crmRecords(draft, ALESSANDRO).contact.hubspot_owner_id, '37994989');
  const contact = crmRecords(draft, ALESSANDRO).contact;
  assert.equal(`${contact.firstname} ${contact.lastname}`, 'Mario Rossi');
  assert.equal(contact.hs_legal_basis, '', 'la base giuridica parte solo se confermata');
  draft = setLegalBasisConfirmed(draft, true);
  assert.equal(crmRecords(draft, ALESSANDRO).contact.hs_legal_basis, 'Legitimate interest – prospect/lead');
});

test('owner mai dalla bozza: una bozza vecchia con un ID owner salvato non lo conserva', () => {
  const { draft } = applyFindings(emptyDraft(), HOME);
  const old = JSON.parse(JSON.stringify(draft));
  old.company.hubspot_owner_id = { value: '123456789', reliability: 'high', method: 'Impostazioni', url: '', evidence: '', alternatives: [], edited: false };
  old.contact.hubspot_owner_id = { ...old.company.hubspot_owner_id };
  const back = restoreDraft(old);
  assert.equal(back.company.hubspot_owner_id, undefined);
  assert.equal(back.contact.hubspot_owner_id, undefined);
  assert.equal(crmRecords(back, MATTEO).company.hubspot_owner_id, '99355637');
  assert.equal(crmRecords(back, MATTEO).contact.hubspot_owner_id, '99355637');
});

test('nessun utilizzo senza commerciale selezionato', async () => {
  const session = sessionStorage();
  assert.equal(await loadActiveOperator(session), null, 'nuova sessione di Chrome: va scelto');
  assert.throws(() => requireOperator(null), OperatorRequiredError);
  assert.throws(() => requireOperator({ name: 'Ospite', hubspotOwnerId: '123' }), OperatorRequiredError, 'solo commerciali del registro');
  assert.deepEqual(requireOperator(MATTEO), MATTEO);
  const { draft } = applyFindings(emptyDraft(), HOME);
  assert.throws(() => crmRecords(draft, null), OperatorRequiredError, 'nessuna operazione CRM senza commerciale');
  await assert.rejects(selectOperator('123', session));
  assert.deepEqual(session.data, {}, 'una scelta non valida non si salva');
  // un ID rimasto in sessione ma tolto dal registro: si sceglie di nuovo
  session.data.activeOperator = '11111111';
  assert.equal(await loadActiveOperator(session), null);
  assert.equal(operatorById(undefined), null);
});
