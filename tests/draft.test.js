// Bozza del prospect: unione delle pagine, correzioni a mano, scelta della persona, salvataggio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSnapshot } from '../extension/lib/parser.js';
import {
  applyFindings, editField, emptyDraft, pickAlternative, recordFailure, refreshForms, resetQuickContext,
  restoreDraft, setLegalBasisConfirmed, usePerson,
} from '../extension/lib/draft.js';
import { LEGAL_BASIS } from '../extension/lib/crmModel.js';

const CONFIG = { hubspot: { ownerId: '987654', ownerName: 'Commerciale Agria' } };
const page = (url, pageText, links = [], pageType = 'other') => analyzeSnapshot(
  { url, title: '', links, text: { header: '', footer: '', page: pageText } },
  { pageType },
);
const apply = (draft, findings) => applyFindings(draft, findings, CONFIG);

const HOME = page('https://www.lamora.it/', 'Agriturismo La Mora\nVia Roma 1, 06081 Assisi (PG)\nTel. 075 8123456', [], 'home');
const CONTATTI = page(
  'https://www.lamora.it/contatti',
  'Maria Bianchi – Titolare\nLuca Verdi – Responsabile commerciale\nTel. 075 9999999',
  [{ kind: 'mailto', href: 'mailto:info@lamora.it', text: 'info@lamora.it', zone: 'page' }],
  'contact',
);
const ALTRO_SITO = page('https://www.cantinarossi.it/', 'Mario Rossi – Titolare · mario.rossi@cantinarossi.it\nTel. 0742 123456', [], 'home');

test('prima analisi: i campi HubSpot si riempiono, proprietario dalle Impostazioni', () => {
  const { draft, mode } = apply(emptyDraft(), HOME);
  assert.equal(mode, 'new');
  assert.equal(draft.company.phone.value, '+39 0758123456');
  assert.equal(draft.company.domain.value, 'lamora.it');
  assert.equal(draft.company.hubspot_owner_id.value, '987654');
  assert.equal(draft.contact.hubspot_owner_id.value, '987654');
  assert.equal(draft.company.hs_lead_status.value, 'NEW');
  assert.equal(draft.contact.hs_legal_basis.value, LEGAL_BASIS);
  assert.equal(draft.legalBasisConfirmed, false, 'la base giuridica va confermata dal commerciale');
  assert.equal(draft.site.domain, 'lamora.it');
});

test('stesso sito: i dati si accumulano, le correzioni a mano restano, nessun valore perso', () => {
  let { draft } = apply(emptyDraft(), HOME);
  draft = editField(draft, 'company', 'city', 'Santa Maria degli Angeli');
  const res = apply(draft, CONTATTI);
  assert.equal(res.mode, 'merged');
  assert.equal(res.draft.company.city.value, 'Santa Maria degli Angeli');
  assert.equal(res.draft.company.city.edited, true);
  assert.ok(res.draft.company.city.alternatives.includes('Assisi'), 'il valore trovato resta come alternativa');
  // la pagina Contatti ha la priorità sul testo della home; il numero della home non si perde
  assert.equal(res.draft.company.phone.value, '+39 0759999999');
  assert.ok(res.draft.company.phone.alternatives.includes('+39 0758123456'));
  assert.equal(res.draft.company.email_aziendale_principale.value, 'info@lamora.it');
  assert.equal(res.draft.site.pages.length, 2);
});

test('un campo svuotato a mano non viene riempito di nuovo', () => {
  let { draft } = apply(emptyDraft(), HOME);
  draft = editField(draft, 'company', 'phone', '');
  const res = apply(draft, HOME);
  assert.equal(res.draft.company.phone.value, '');
});

test('persone senza recapiti: mostrate ma non diventano Contatto in automatico', () => {
  const { draft } = apply(emptyDraft(), CONTATTI);
  assert.equal(draft.contact.firstname.value, '');
  assert.equal(draft.mainPerson, null);
  assert.equal(Object.keys(draft.site.people).length, 2);
});

test('stesso sito, persona con recapito: diventa Contatto; i dati delle persone non si mescolano', () => {
  let { draft } = apply(emptyDraft(), CONTATTI);
  const team = page('https://www.lamora.it/team', 'Giorgio Neri – Fondatore', [
    { kind: 'mailto', href: 'mailto:giorgio.neri@lamora.it', text: 'giorgio.neri@lamora.it', zone: 'page' },
  ], 'team');
  draft = apply(draft, team).draft;
  assert.equal(draft.contact.firstname.value, 'Giorgio');
  assert.equal(draft.contact.email.value, 'giorgio.neri@lamora.it');
  assert.equal(draft.site.people.mariabianchi.email, '', "l'email di Giorgio non finisce su Maria");
  assert.ok(![draft.company.email_aziendale_principale.value, draft.company.email_aziendale_secondaria.value].includes('giorgio.neri@lamora.it'),
    "l'email personale resta sul contatto");
});

test('altro sito: nuovo prospect, sostituisce tutto', () => {
  let { draft } = apply(emptyDraft(), CONTATTI);
  draft = editField(draft, 'company', 'name', 'La Mora');
  draft = recordFailure(draft, { url: 'https://www.lamora.it/rotta', code: 'http', reason: 'Errore HTTP 404.' });
  const res = apply(draft, ALTRO_SITO);
  assert.equal(res.mode, 'new');
  assert.equal(res.draft.company.name.edited, false);
  assert.equal(res.draft.company.domain.value, 'cantinarossi.it');
  assert.equal(res.draft.contact.lastname.value, 'Rossi');
  assert.equal(res.draft.site.pages.length, 1);
  assert.equal(res.draft.site.failures.length, 0);
});

test("scelta di un altro valore e di un'altra persona (anche parziale)", () => {
  let { draft } = apply(apply(emptyDraft(), HOME).draft, CONTATTI);
  draft = pickAlternative(draft, 'company', 'phone', '+39 0758123456');
  assert.equal(draft.company.phone.value, '+39 0758123456');
  assert.ok(draft.company.phone.alternatives.includes('+39 0759999999'));
  assert.equal(draft.company.phone.edited, true);

  draft = usePerson(draft, 'lucaverdi', CONFIG);
  assert.equal(draft.mainPerson, 'lucaverdi');
  assert.equal(draft.mainPersonChosen, true);
  assert.equal(draft.contact.firstname.value, 'Luca');
  assert.equal(draft.contact.jobtitle.value, 'Responsabile commerciale');
  // una nuova pagina non cambia la persona scelta a mano
  const team = page('https://www.lamora.it/team', 'Giorgio Neri – Fondatore · giorgio.neri@lamora.it', [], 'team');
  draft = apply(draft, team).draft;
  assert.equal(draft.contact.firstname.value, 'Luca');
});

test('contesto rapido: si aggiorna con i dati, resta se modificato a mano, si rigenera su richiesta', () => {
  let { draft } = apply(emptyDraft(), HOME);
  draft = apply(draft, CONTATTI).draft;
  const quick = draft.company.hs_quick_context.value;
  assert.match(quick, /^DATI AGGIUNTIVI RILEVATI DAL SITO/);
  assert.match(quick, /Maria Bianchi — Titolare/);
  assert.match(quick, /Telefoni aggiuntivi:\n- \+39 0758123456/);

  draft = editField(draft, 'company', 'hs_quick_context', 'Nota mia');
  draft = apply(draft, HOME).draft;
  assert.equal(draft.company.hs_quick_context.value, 'Nota mia');
  draft = resetQuickContext(draft);
  assert.equal(draft.company.hs_quick_context.value, quick);
});

test('base giuridica: suggerita, confermata solo dal commerciale', () => {
  let { draft } = apply(emptyDraft(), HOME);
  draft = setLegalBasisConfirmed(draft, true);
  assert.equal(draft.legalBasisConfirmed, true);
  assert.equal(setLegalBasisConfirmed(draft, 'sì').legalBasisConfirmed, false);
});

test('proprietario: cambia con le Impostazioni, non viene dal sito', () => {
  const { draft } = apply(emptyDraft(), HOME);
  const other = refreshForms(draft, { hubspot: { ownerId: '111', ownerName: 'Altro' } });
  assert.equal(other.company.hubspot_owner_id.value, '111');
  assert.equal(refreshForms(draft, { hubspot: {} }).company.hubspot_owner_id.value, '');
});

test('bozza salvata: si ripristina; dati malformati o versioni vecchie si scartano', () => {
  const { draft } = apply(apply(emptyDraft(), HOME).draft, CONTATTI);
  const back = restoreDraft(JSON.parse(JSON.stringify(draft)));
  assert.deepEqual(back, draft);
  assert.deepEqual(restoreDraft({ version: 2, company: { name: { value: 42 } }, site: null }), emptyDraft());
  assert.deepEqual(restoreDraft({ company: { name: { value: 'Bozza V0' } } }), emptyDraft(), 'bozza della V0: si riparte da zero');
  assert.deepEqual(restoreDraft(undefined), emptyDraft());
});
