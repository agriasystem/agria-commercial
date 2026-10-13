// Patch 0.4.1: nome dell'azienda senza descrittori generici e tipo di struttura Hospitality.
// Caso reale Il Cantico delle Cicale («Agriturismo Il Cantico delle Cicale, con ristorante» nel titolo,
// sezione «Il Ristorante», «Prenota un tavolo») riprodotto con dati di prova: nessun sito reale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSnapshot, cleanCompanyName } from '../extension/lib/parser.js';
import { addPageFindings, emptySite } from '../extension/lib/siteData.js';
import { proposeCompany, proposeStructure } from '../extension/lib/crmModel.js';
import { applyFindings, crmRecords, editField, emptyDraft } from '../extension/lib/draft.js';
import { normKey } from '../extension/lib/validation.js';
import { OPERATORS } from '../extension/lib/operators.js';

const [MATTEO] = OPERATORS;
const CICALE = 'https://ilcanticodellecicale.test';
const TITLE = 'Agriturismo Il Cantico delle Cicale, con ristorante – Alle porte della città di Perugia, a soli 15 km da Assisi e Gubbio';
const nav = (origin, items) => items.map(([text, path]) => ({ kind: 'web', href: `${origin}${path}`, text, zone: 'header' }));
const MENU = nav(CICALE, [['Home', '/'], ['Agriturismo', '/agriturismo/'], ['Camere', '/camere/'], ['Ristorante', '/ristorante-in-agriturismo/'], ['Galleria', '/galleria/'], ['Contatti', '/contatti/']]);
const FOOTER = [
  'Copyright 2021 Tutti i diritti riservati - Agriturismo Il Cantico delle Cicale',
  'Strada per Fratticiola Selvatica, 1 | località Piccione | 06134 Perugia IT',
  'info@ilcanticodellecicale.test', 'P. Iva 02095510380 | PEC: ilcanticodellecicale@pec.it',
].join('\n');
const snap = (url, { title = TITLE, headings = [], subheadings = [], links = [], page = '', header = '', footer = FOOTER, jsonld = [], meta = {} } = {}) => ({
  url, title, meta, jsonld, links, resources: [], microdata: [], addresses: [], headings, subheadings,
  text: { header, footer, page: [header, page, footer].filter(Boolean).join('\n') },
});
// come il sito reale: h1/h2 in headings, h3 in subheadings (marchio e sezioni dei servizi sono h3)
const cicaleHome = (opts = {}) => analyzeSnapshot(snap(`${CICALE}/`, {
  headings: ['La natura non è un posto da visitare, è casa nostra.', 'Prenota un tavolo'],
  subheadings: ['Controlla la disponibilità delle Camere', '“Il Cantico delle Cicale"', 'SU DI NOI', "L'Agriturismo", 'Le Camere', 'Il Ristorante', 'Orari Ristorante'],
  links: MENU,
  header: 'Il Cantico delle Cicale, Umbria IT · Tel. 075 997 8598 · Email: info@ilcanticodellecicale.test',
  page: "Agriturismo immerso nel verde alle porte di Perugia: camere, piscina e il nostro ristorante con i prodotti dell'orto.\nIl Cantico delle Cicale si propone come meta ideale per chi ama la tranquillità.",
  ...opts,
}), { pageType: 'home' });
const cicaleRistorante = () => analyzeSnapshot(snap(`${CICALE}/ristorante-in-agriturismo/`, {
  title: 'Il Ristorante – Il Cantico delle Cicale', headings: ['Il Ristorante', 'Prenota un tavolo', 'Orari Ristorante'], links: MENU,
  page: 'Cucina umbra con i prodotti della nostra terra. Aperto a pranzo e a cena.',
}), { pageType: 'hospitality' });
const company = (...pages) => proposeCompany(pages.reduce((s, p) => addPageFindings(s, p), emptySite()));

test('Il Cantico delle Cicale: nome senza «Agriturismo» e senza «con ristorante»', () => {
  const c = company(cicaleHome(), cicaleRistorante());
  assert.equal(c.name.value, 'Il Cantico delle Cicale');
  assert.ok(!/ristorante/i.test(c.name.value), '«con ristorante» non entra nel nome');
  assert.ok(!c.name.alternatives.some((a) => /con ristorante/i.test(a)), 'nemmeno tra le alternative');
  assert.equal(c.name.reliability, 'high', 'intestazione e titolo concordano');
  // il solo titolo, senza intestazioni: «con ristorante» via comunque, «Agriturismo» resta (nessuna prova che sia solo un qualificatore)
  const titleOnly = company(analyzeSnapshot(snap(`${CICALE}/`, { headings: [], subheadings: [] }), { pageType: 'home' }));
  assert.equal(titleOnly.name.value, 'Agriturismo Il Cantico delle Cicale');
  // senza virgola, come nel caso segnalato
  const noComma = company(analyzeSnapshot(snap(`${CICALE}/`, { title: 'Il Cantico delle Cicale con ristorante' }), { pageType: 'home' }));
  assert.equal(noComma.name.value, 'Il Cantico delle Cicale');
});

test('pulizia del nome prudente: i nomi veri restano interi', () => {
  const known = (...names) => ({ known: new Set(names.map(normKey)) });
  const cases = [
    ['Agriturismo Il Cantico delle Cicale, con ristorante', known('Il Cantico delle Cicale'), 'Il Cantico delle Cicale'],
    ['Il Poggio, ristorante e camere', known(), 'Il Poggio'],
    ['Agriturismo Il Poggio con piscina e spa', known(), 'Agriturismo Il Poggio'],
    ['Villa Fiorita Relais & Spa', known('Villa Fiorita'), 'Villa Fiorita'],
    // il sito usa il nome completo: il tipo fa parte del nome
    ['Agriturismo La Mora', known('Agriturismo La Mora'), 'Agriturismo La Mora'],
    ['Agriturismo La Mora', known('La Mora', 'Agriturismo La Mora'), 'Agriturismo La Mora'],
    ['Agriturismo La Mora', known(), 'Agriturismo La Mora'],
    ['Hotel Rossi', known('Rossi'), 'Hotel Rossi'],
    ['Ristorante Da Vittorio', known(), 'Ristorante Da Vittorio'],
    ['La Locanda dei Golosi', known(), 'La Locanda dei Golosi'],
    ['Locanda con Cucina', known(), 'Locanda con Cucina'],
    ['Vino e Cucina', known(), 'Vino e Cucina'],
    ['Pane con Tutto', known(), 'Pane con Tutto'],
    ['Cantina Berioli', known('Berioli'), 'Cantina Berioli'],
  ];
  for (const [raw, opts, expected] of cases) assert.equal(cleanCompanyName(raw, opts), expected, raw);
});

test('Il Cantico delle Cicale: ristorante proprio da prove forti → «Struttura con ristorante», prima di «Agriturismo»', () => {
  const c = company(cicaleHome(), cicaleRistorante());
  assert.equal(c.settore_agria.value, 'Hospitality');
  assert.equal(c.tipo_struttura_hospitality.value, 'Struttura con ristorante');
  assert.equal(c.tipo_struttura_hospitality.reliability, 'check', 'resta da verificare');
  assert.equal(c.tipo_struttura_hospitality.evidence, 'Prove: «con ristorante» nel titolo, sezione «Ristorante» del sito, prenotazione del tavolo / orari');
  assert.deepEqual(c.tipo_struttura_hospitality.alternatives, ['Agriturismo'], '«Agriturismo» a un clic');
  // anche dalla sola home
  assert.equal(company(cicaleHome()).tipo_struttura_hospitality.value, 'Struttura con ristorante');
  // nel payload HubSpot
  const { draft } = applyFindings(emptyDraft(), cicaleHome());
  const record = crmRecords(draft, MATTEO).company;
  assert.deepEqual([record.name, record.settore_agria, record.tipo_struttura_hospitality, record.city, record.state, 'country' in record], ['Il Cantico delle Cicale', 'Hospitality', 'Struttura con ristorante', 'Perugia', 'Umbria', false]);
  // scelta a mano: resta
  const manual = editField(draft, 'company', 'tipo_struttura_hospitality', 'Agriturismo');
  assert.equal(applyFindings(manual, cicaleRistorante()).draft.company.tipo_struttura_hospitality.value, 'Agriturismo');
});

const POGGIO = 'https://ilpoggio.test';
const poggio = (opts) => analyzeSnapshot(snap(`${POGGIO}/`, {
  title: 'Agriturismo Il Poggio | Camere in Umbria', headings: ['Agriturismo Il Poggio', 'Le camere'], footer: 'Agriturismo Il Poggio · Via Roma 1, 06063 Magione (PG)',
  links: nav(POGGIO, [['Home', '/'], ['Camere', '/camere/'], ['Contatti', '/contatti/']]), ...opts,
}), { pageType: 'home' });

test('nessun falso positivo: ristorante vicino, territorio, link esterno, semplice menzione', () => {
  const cases = {
    'ristorante vicino': { page: 'Agriturismo con camere e piscina. A 2 km trovate il ristorante Da Mario, ottima cucina umbra. Ristorante consigliato!' },
    territorio: { headings: ['Agriturismo Il Poggio', 'Ristoranti nei dintorni', 'Cosa vedere'], page: 'Agriturismo con camere. I migliori ristoranti della zona: Osteria del Lago, Ristorante Il Borgo.' },
    'link esterno': { page: 'Agriturismo con camere.', links: [{ kind: 'web', href: 'https://ristorantedamario.test/', text: 'Ristorante', zone: 'page' }, { kind: 'web', href: 'https://www.tripadvisor.it/Restaurants-g1', text: 'Il Ristorante', zone: 'page' }] },
    'menzione nel testo': { page: 'Agriturismo con camere, colazione e ristorante su prenotazione per gruppi. Prenota un tavolo nei ristoranti del borgo.' },
    'una sola prova (titolo)': { title: 'Agriturismo Il Poggio, con ristorante', page: 'Agriturismo con camere.' },
  };
  for (const [name, opts] of Object.entries(cases)) {
    const c = company(poggio(opts));
    assert.equal(c.settore_agria.value, 'Hospitality', name);
    assert.equal(c.tipo_struttura_hospitality.value, 'Agriturismo', name);
  }
  // nessun tipo dal nome o dalle parole della struttura: la sola parola «ristorante» non basta più
  assert.equal(proposeStructure({ ristorante: 9 }, ['Villa Fiorita']).value, '');
  assert.equal(proposeStructure({ ristorante: 9, 'proprio:ristorante:sezione': 1 }, ['Villa Fiorita']).value, 'Struttura con ristorante');
});

test('due prove bastano; i tipi specifici (Relais, Masseria…) restano', () => {
  const twoProofs = company(poggio({ headings: ['Agriturismo Il Poggio', 'Il nostro ristorante'], links: nav(POGGIO, [['Prenota un tavolo', '/prenota/']]) }));
  assert.equal(twoProofs.tipo_struttura_hospitality.value, 'Struttura con ristorante');
  const relais = proposeStructure({ 'proprio:ristorante:titolo': 1, 'proprio:ristorante:sezione': 1, 'proprio:ristorante:uso': 1 }, ['Relais Villa Fiorita']);
  assert.equal(relais.value, 'Relais');
  const masseria = proposeStructure({ masseria: 9, 'proprio:ristorante:sezione': 1, 'proprio:ristorante:schema': 1 }, ['Villa Fiorita']);
  assert.equal(masseria.value, 'Masseria');
});

test('«Struttura con spa»: comportamento esistente conservato, spa propria prima di «Agriturismo»', () => {
  assert.equal(proposeStructure({ spa: 9, ristorante: 4 }, ['Villa Fiorita']).value, 'Struttura con spa', 'come prima');
  const spa = company(poggio({ title: 'Agriturismo Il Poggio con spa', headings: ['Agriturismo Il Poggio', 'La Spa', 'I trattamenti'] }));
  assert.equal(spa.tipo_struttura_hospitality.value, 'Struttura con spa');
  assert.equal(spa.name.value, 'Agriturismo Il Poggio', '«con spa» non entra nel nome');
  // una spa nei dintorni non conta
  const near = company(poggio({ page: 'Agriturismo con camere. A 10 km le terme e una spa convenzionata.' }));
  assert.equal(near.tipo_struttura_hospitality.value, 'Agriturismo');
});
