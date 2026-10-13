// Patch 0.4.1: località italiane. Caso reale La Locanda dei Golosi ("Strada Eugubina 225 · Loc. Pieve
// Pagliaccia Bosco 06134 (PG)", nessun comune scritto) riprodotto con dati di prova: nessun sito reale.
// `state` è la regione, mai "Italia"; per un prospect italiano `country` non si scrive in HubSpot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSnapshot } from '../extension/lib/parser.js';
import { addPageFindings, emptySite, factsOf } from '../extension/lib/siteData.js';
import { proposeCompany } from '../extension/lib/crmModel.js';
import { applyFindings, crmRecords, emptyDraft, preflightCompany } from '../extension/lib/draft.js';
import { companyPayload } from '../extension/lib/hubspotPayload.js';
import { comuneFromCap } from '../extension/lib/italy.js';
import { OPERATORS } from '../extension/lib/operators.js';

const [MATTEO] = OPERATORS;
const LOCANDA = 'https://www.lalocandadeigolosi.test';
const snap = (url, { title = 'La Locanda dei Golosi', page = '', footer = '', jsonld = [] } = {}) => ({
  url, title, meta: {}, jsonld, links: [], resources: [], microdata: [], addresses: [], headings: [],
  text: { header: '', footer, page: [page, footer].filter(Boolean).join('\n') },
});
const findings = (page, opts = {}) => analyzeSnapshot(snap(`${LOCANDA}/`, { page, ...opts }), { pageType: 'home' });
const place = (f) => {
  const c = proposeCompany(addPageFindings(emptySite(), f));
  return { city: c.city.value, state: c.state.value, country: c.country.value, cityMethod: c.city.method, cityReliability: c.city.reliability };
};

// come il sito reale: indirizzo nella sezione «Dove siamo», città solo nel testo ("a due passi da Perugia")
const LOCANDA_HOME = [
  'Benvenuti alla Locanda dei Golosi', 'Una locanda a due passi da Perugia, tra cucina e camere.',
  'Dove siamo', 'Strada Eugubina 225', 'Loc. Pieve Pagliaccia Bosco 06134 (PG)',
  'Contatti', 'info@lalocandadeigolosi.test',
].join('\n');

test('La Locanda dei Golosi: CAP 06134 + Loc. Pieve Pagliaccia Bosco + (PG) → Perugia, Umbria', () => {
  const f = findings(LOCANDA_HOME);
  const [address] = factsOf(addPageFindings(emptySite(), f), 'address');
  assert.equal(address.value, 'Strada Eugubina 225, Loc. Pieve Pagliaccia Bosco, 06134 (PG)');
  assert.deepEqual([address.extra.cap, address.extra.city, address.extra.locality, address.extra.province], ['06134', '', 'Pieve Pagliaccia Bosco', 'PG'], 'la località non è il comune');
  const p = place(f);
  assert.deepEqual([p.city, p.state, p.country], ['Perugia', 'Umbria', '']);
  assert.equal(p.cityMethod, 'comune dal CAP 06134 (PG); località indicata: Pieve Pagliaccia Bosco');
  assert.equal(p.cityReliability, 'high');
});

test('stesso indirizzo scritto in altri modi: su tre righe, su una riga, frazione dopo il CAP, JSON-LD', () => {
  for (const page of [
    'Strada Eugubina 225\nLoc. Pieve Pagliaccia Bosco\n06134 (PG)',
    'Strada Eugubina 225 Loc. Pieve Pagliaccia Bosco 06134 (PG)',
    'Strada Eugubina 225, Località Pieve Pagliaccia - 06134 (PG)',
    'Strada Eugubina 225, 06134 Pieve Pagliaccia (PG)',
    'Strada Eugubina 225, 06134 Perugia (PG)',
  ]) {
    const p = place(findings(page));
    assert.deepEqual([p.city, p.state, p.country], ['Perugia', 'Umbria', ''], page);
  }
  const ld = findings('', { jsonld: [{ '@type': 'LocalBusiness', name: 'La Locanda dei Golosi', address: { '@type': 'PostalAddress', streetAddress: 'Strada Eugubina 225', addressLocality: 'Pieve Pagliaccia', postalCode: '06134', addressRegion: 'PG' } }] });
  assert.deepEqual(Object.values(place(ld)).slice(0, 3), ['Perugia', 'Umbria', '']);
});

test('la sola sigla della provincia non inventa il comune', () => {
  // frazione di un comune che non è capoluogo: regione sì, comune no
  assert.deepEqual(Object.values(place(findings('Via del Lago 3\nLoc. San Feliciano 06063 (PG)'))).slice(0, 3), ['', 'Umbria', '']);
  assert.deepEqual(Object.values(place(findings('Strada Eugubina 225\n06063 (PG)'))).slice(0, 3), ['', 'Umbria', '']);
  // "(PG)" da solo, senza indirizzo: nessuna città
  const alone = place(findings('Agriturismo in Umbria\n(PG)'));
  assert.equal(alone.city, '');
  // CAP di Perugia ma provincia diversa: dati incoerenti, il CAP non decide
  assert.deepEqual(Object.values(place(findings('Via Roma 1, 06134 Pieve Pagliaccia (TR)'))).slice(0, 2), ['Pieve Pagliaccia', 'Umbria']);
});

test('CAP dei capoluoghi: tabella fissa, solo intervalli certi, coerenza con la provincia', () => {
  assert.deepEqual(comuneFromCap('06134', 'PG'), { comune: 'Perugia', province: 'PG' });
  assert.deepEqual(comuneFromCap('06121'), { comune: 'Perugia', province: 'PG' });
  assert.deepEqual(comuneFromCap('00144'), { comune: 'Roma', province: 'RM' });
  assert.deepEqual(comuneFromCap('05100'), { comune: 'Terni', province: 'TR' });
  assert.deepEqual(comuneFromCap('47921'), { comune: 'Rimini', province: 'RN' });
  for (const cap of ['06063', '06081', '06036', '06034', '06100', '0613', 'abcde', '']) assert.equal(comuneFromCap(cap), null, cap);
  assert.equal(comuneFromCap('06134', 'TR'), null, 'provincia diversa da quella del CAP');
});

test('state è la regione, mai "Italia"; country Italia non obbligatorio nel payload', () => {
  // JSON-LD con il paese al posto della regione
  const ld = findings('', { jsonld: [{ '@type': 'Hotel', name: 'La Locanda dei Golosi', address: { streetAddress: 'Strada Eugubina 225', postalCode: '06134', addressLocality: 'Perugia', addressRegion: 'Italia', addressCountry: 'IT' } }] });
  const p = place(ld);
  assert.deepEqual([p.city, p.state, p.country], ['Perugia', 'Umbria', '']);
  const odd = findings('', { jsonld: [{ '@type': 'Hotel', name: 'X', address: { streetAddress: 'Via Roma 1', postalCode: '06063', addressLocality: 'Magione', addressRegion: 'Italy' } }] });
  assert.notEqual(place(odd).state, 'Italy');
  assert.notEqual(place(odd).state, 'Italia');
  // payload HubSpot del caso reale: città e regione, nessun paese, pre-flight superato
  const { draft } = applyFindings(emptyDraft(), findings(LOCANDA_HOME));
  const { properties, errors } = companyPayload(crmRecords(draft, MATTEO).company, MATTEO);
  assert.deepEqual(errors, []);
  assert.deepEqual([properties.city, properties.state, 'country' in properties], ['Perugia', 'Umbria', false]);
  assert.deepEqual(preflightCompany(draft, MATTEO), { ok: true, missing: [], message: '' });
});

test('prospect estero: il paese resta (country continua a rappresentare il Paese)', () => {
  const swiss = findings('', { jsonld: [{ '@type': 'Hotel', name: 'Albergo Lago', address: { streetAddress: 'Via Lago 1', postalCode: '6900', addressLocality: 'Lugano', addressRegion: 'Ticino', addressCountry: 'Svizzera' } }] });
  assert.deepEqual(Object.values(place(swiss)).slice(0, 3), ['Lugano', 'Ticino', 'Svizzera']);
});

test('regressioni: Magione, Montefalco, Assisi, Foligno + PG → Umbria; Siena → Toscana', () => {
  for (const [page, city, state] of [
    ['Via del Moscatello 3 - Frazione Montesperello, Magione - 06063 (PG) - ITALY', 'Magione', 'Umbria'],
    ['Località Casale 1, 06036 Montefalco (PG)', 'Montefalco', 'Umbria'],
    ['Via Roma 1, 06081 Assisi (PG)', 'Assisi', 'Umbria'],
    ['Via Roma 1, 06034 Foligno (PG)', 'Foligno', 'Umbria'],
    ['Via di Città 1, 53100 Siena', 'Siena', 'Toscana'],
  ]) {
    const p = place(findings(page));
    assert.deepEqual([p.city, p.state, p.country], [city, state, ''], page);
  }
});
