// Patch 2.0.4: base giuridica predefinita per la sessione. Serve solo a CREARE un Contatto: la verifica
// HubSpot resta sempre possibile. Nessuna rete, nessuna chiamata HubSpot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSnapshot } from '../extension/lib/parser.js';
import { LEGAL_BASIS } from '../extension/lib/crmModel.js';
import { applyFindings, crmRecords, emptyDraft, legalBasisEffective, restoreDraft, setLegalBasisConfirmed, usePerson } from '../extension/lib/draft.js';
import { clearSessionLegalBasis, loadSessionLegalBasis, setSessionLegalBasis } from '../extension/lib/legalBasisSession.js';
import { OPERATORS } from '../extension/lib/operators.js';

const [MATTEO, ALESSANDRO] = OPERATORS;
const memoryStorage = () => {
  const data = {};
  return {
    data,
    async get(key) { return key in data ? { [key]: structuredClone(data[key]) } : {}; },
    async set(obj) { Object.assign(data, structuredClone(obj)); },
    async remove(key) { delete data[key]; },
  };
};
const TEAM = analyzeSnapshot({
  url: 'https://www.cantinarossi.it/team', title: '', links: [],
  text: { header: '', footer: '', page: 'Mario Rossi – Titolare · mario.rossi@cantinarossi.it\nGiulia Bianchi – Enologa · giulia.bianchi@cantinarossi.it' },
}, { pageType: 'team' });
const withContact = () => applyFindings(emptyDraft(), TEAM).draft; // Mario Rossi: Contatto valido

test('senza conferma la base giuridica non vale: hs_legal_basis non si prepara', () => {
  const draft = withContact();
  assert.equal(legalBasisEffective(draft), false);
  assert.equal(crmRecords(draft, MATTEO).contact.hs_legal_basis, '');
});

test('conferma di sessione: ogni nuovo Contatto valido la eredita', () => {
  let draft = withContact();
  assert.equal(legalBasisEffective(draft, true), true, 'Mario la eredita');
  assert.equal(crmRecords(draft, MATTEO, { sessionLegalBasis: true }).contact.hs_legal_basis, LEGAL_BASIS);
  draft = usePerson(draft, 'giuliabianchi');
  assert.equal(legalBasisEffective(draft, true), true, 'anche il contatto successivo');
  // un contatto non valido non la usa mai
  assert.equal(legalBasisEffective(emptyDraft(), true), false);
});

test('scelta per il singolo contatto: si esclude anche con la base predefinita, e si riconferma', () => {
  let draft = setLegalBasisConfirmed(withContact(), false);
  assert.equal(legalBasisEffective(draft, true), false, 'esclusa per questo contatto');
  assert.equal(crmRecords(draft, MATTEO, { sessionLegalBasis: true }).contact.hs_legal_basis, '');
  draft = setLegalBasisConfirmed(draft, true);
  assert.equal(legalBasisEffective(draft, false), true, 'confermata per questo contatto anche senza base di sessione');
  // la scelta vale per quella persona: con un'altra si riparte dalla base di sessione
  draft = setLegalBasisConfirmed(draft, false);
  draft = usePerson(draft, 'giuliabianchi');
  assert.deepEqual([draft.legalBasisConfirmed, draft.legalBasisDeclined, legalBasisEffective(draft, true)], [false, false, true]);
  // la scelta resta nella bozza salvata
  const back = restoreDraft(JSON.parse(JSON.stringify(setLegalBasisConfirmed(draft, false))));
  assert.equal(back.legalBasisDeclined, true);
});

test('conferma di sessione legata al commerciale: un cambio di commerciale la azzera', async () => {
  const session = memoryStorage();
  assert.equal(await loadSessionLegalBasis(MATTEO, session), false, 'nuova sessione: da confermare');
  await setSessionLegalBasis(MATTEO, true, session);
  assert.deepEqual(session.data.legalBasisDefault, { operatorId: MATTEO.hubspotOwnerId, value: LEGAL_BASIS });
  assert.equal(await loadSessionLegalBasis(MATTEO, session), true);
  assert.equal(await loadSessionLegalBasis(ALESSANDRO, session), false, 'non passa a un altro commerciale');
  await clearSessionLegalBasis(session); // cambio commerciale nel pannello
  assert.equal(await loadSessionLegalBasis(MATTEO, session), false, 'tornando al primo va confermata di nuovo');
  await setSessionLegalBasis(MATTEO, true, session);
  await setSessionLegalBasis(MATTEO, false, session);
  assert.equal(await loadSessionLegalBasis(MATTEO, session), false, 'si può disattivare');
  assert.equal(await loadSessionLegalBasis(null, session), false);
});

test('mai permanente: solo chrome.storage.session, mai storage.local o sync', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'lib', 'legalBasisSession.js'), 'utf8');
  assert.match(src, /storage = chrome\.storage\.session/);
  assert.ok(!/storage\.(local|sync)/.test(src.replace(/^\s*\/\/.*$/gm, '')));
});
