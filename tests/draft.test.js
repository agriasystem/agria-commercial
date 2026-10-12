import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSnapshot } from '../extension/lib/parser.js';
import { applyAnalysis, editField, emptyDraft, pickAlternative, restoreDraft, usePerson } from '../extension/lib/draft.js';

const page = (url, pageText, links = []) => analyzeSnapshot({ url, title: '', links, text: { header: '', footer: '', page: pageText } });

const HOME = page('https://www.lamora.it/', 'Agriturismo La Mora\nVia Roma 1, 06081 Assisi (PG)\nTel. 075 8123456');
const CONTATTI = page(
  'https://www.lamora.it/contatti',
  'Maria Bianchi – Titolare\nLuca Verdi – Responsabile commerciale\nTel. 075 9999999',
  [{ kind: 'mailto', href: 'mailto:info@lamora.it', text: 'info@lamora.it', zone: 'page' }],
);
const ALTRO_SITO = page('https://www.cantinarossi.it/', 'Mario Rossi – Titolare\nTel. 0742 123456');

test('prima analisi: i campi si riempiono', () => {
  const { draft, mode, added } = applyAnalysis(emptyDraft(), HOME);
  assert.equal(mode, 'new');
  assert.equal(added, HOME.found);
  assert.equal(draft.company.phone.value, '+39 0758123456');
  assert.equal(draft.page.domain, 'lamora.it');
});

test('stessa azienda: si riempiono i vuoti e le correzioni a mano restano', () => {
  let { draft } = applyAnalysis(emptyDraft(), HOME);
  draft = editField(draft, 'company', 'city', 'Santa Maria degli Angeli');
  const res = applyAnalysis(draft, CONTATTI);
  assert.equal(res.mode, 'merged');
  assert.equal(res.draft.company.city.value, 'Santa Maria degli Angeli');
  assert.equal(res.draft.company.city.edited, true);
  assert.equal(res.draft.company.phone.value, '+39 0758123456', 'il valore già trovato non cambia');
  assert.ok(res.draft.company.phone.alternatives.includes('+39 0759999999'), 'il nuovo numero diventa alternativa');
  assert.equal(res.draft.company.email.value, 'info@lamora.it');
  assert.equal(res.draft.contact.firstName.value, 'Maria');
  assert.equal(res.draft.people.length, 1);
  assert.ok(res.added >= 4);
});

test('un campo svuotato a mano non viene riempito di nuovo', () => {
  let { draft } = applyAnalysis(emptyDraft(), HOME);
  draft = editField(draft, 'company', 'phone', '');
  const res = applyAnalysis(draft, HOME);
  assert.equal(res.draft.company.phone.value, '');
});

test('stesso sito ma persona diversa: i dati non si mescolano', () => {
  let { draft } = applyAnalysis(emptyDraft(), CONTATTI);
  const other = page('https://www.lamora.it/team', 'Giorgio Neri – Fondatore', [
    { kind: 'mailto', href: 'mailto:giorgio.neri@lamora.it', text: 'giorgio.neri@lamora.it', zone: 'page' },
  ]);
  const res = applyAnalysis(draft, other);
  assert.equal(res.draft.contact.firstName.value, 'Maria');
  assert.equal(res.draft.contact.email.value, '', "l'email di Giorgio non finisce su Maria");
  assert.equal(res.draft.people[0].firstName, 'Giorgio');
  assert.equal(res.draft.people[0].email, 'giorgio.neri@lamora.it');
});

test('altro sito: nuovo prospect, sostituisce tutto', () => {
  let { draft } = applyAnalysis(emptyDraft(), CONTATTI);
  draft = editField(draft, 'company', 'name', 'La Mora');
  const res = applyAnalysis(draft, ALTRO_SITO);
  assert.equal(res.mode, 'new');
  assert.equal(res.draft.company.name.edited, false);
  assert.equal(res.draft.company.domain.value, 'cantinarossi.it');
  assert.equal(res.draft.contact.lastName.value, 'Rossi');
  assert.equal(res.draft.people.length, 0);
});

test('scelta di un altro valore e di un\'altra persona', () => {
  let { draft } = applyAnalysis(applyAnalysis(emptyDraft(), HOME).draft, CONTATTI);
  draft = pickAlternative(draft, 'company', 'phone', '+39 0759999999');
  assert.equal(draft.company.phone.value, '+39 0759999999');
  assert.ok(draft.company.phone.alternatives.includes('+39 0758123456'));
  assert.equal(draft.company.phone.edited, true);

  draft = usePerson(draft, 0);
  assert.equal(draft.contact.firstName.value, 'Luca');
  assert.equal(draft.contact.role.value, 'Responsabile commerciale');
  assert.equal(draft.people.length, 1);
  assert.equal(draft.people[0].firstName, 'Maria');
});

test('bozza salvata: si ripristina e i dati malformati si scartano', () => {
  const { draft } = applyAnalysis(emptyDraft(), CONTATTI);
  const back = restoreDraft(JSON.parse(JSON.stringify(draft)));
  assert.deepEqual(back, draft);
  const broken = restoreDraft({ company: { name: { value: 42 } }, people: [{ firstName: 1 }], page: { url: 5 } });
  assert.deepEqual(broken, emptyDraft());
  assert.deepEqual(restoreDraft(undefined), emptyDraft());
});
