// Patch 2.0.3: completezza dei dati prima della scrittura HubSpot e segnali commerciali.
// Caso reale Cantina Berioli riprodotto con la stessa struttura (tests/fixtures/caso-berioli-*.html):
// nessun sito reale, nessuna rete, nessuna chiamata HubSpot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSnapshot } from '../extension/lib/parser.js';
import { addPageFindings, emptySite, peopleOf } from '../extension/lib/siteData.js';
import { buildQuickContext, commercialSignals, proposeCompany, proposeContact, rankPeople, suggestedContact } from '../extension/lib/crmModel.js';
import { applyFindings, crmRecords, editField, emptyDraft, preflightCompany, usePerson } from '../extension/lib/draft.js';
import { companyPayload, lostFields, PREFLIGHT_MESSAGE } from '../extension/lib/hubspotPayload.js';
import { normalizeCountry } from '../extension/lib/italy.js';
import { OPERATORS } from '../extension/lib/operators.js';

const [MATTEO] = OPERATORS;
const values = (fields) => Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.value]));
const snap = (url, { title = '', header = '', page = '', footer = '', links = [] } = {}) => ({
  url, title, meta: {}, jsonld: [], links, resources: [], microdata: [], addresses: [], headings: [],
  text: { header, footer, page: [header, page, footer].filter(Boolean).join('\n') },
});
const siteOf = (...findings) => findings.reduce((site, f) => addPageFindings(site, f), emptySite());
const place = (site) => {
  const c = proposeCompany(site);
  return { city: c.city.value, state: c.state.value, country: c.country.value, stateMethod: c.state.method, stateUrl: c.state.url };
};

// ---------------------------------------------------------------------------------------------
// caso Berioli

const BERIOLI = 'https://berioli-caso.test';
const HEADER = '+39 345 25 86 604 · Via del Moscatello, 3 - Frazione Montesperello, Magione - 06063 (PG) - ITALY\nHome La Cantina Contatti';
const FOOTER = [
  'Via del Moscatello 3, 06063 Magione',
  'Sommelier: Irene Rossi mob. +39 345 2586604',
  'Strada delle Fratte 3M, 06132 Perugia',
  'Export, vendite, acquisti, logistica: Giulio Brandelli +39 349 5241724',
  'Via Gregorovius 54, 06127 Perugia.',
  'Titolare: Dott. Roberto Berioli +39 335 5498173',
  'info@cantinaberioli.it',
  'Sede Operativa: Via del Moscatello, 3 - Frazione Montesperello, Magione - 06063 (PG) - ITALY',
  'Sede Legale: Via F. Gregorovius, 54 - 06127 Perugia (PG) - ITALY',
].join('\n');
const LINKS = [
  { kind: 'tel', href: 'tel:+393452586604', text: '+39 345 25 86 604', zone: 'header' },
  { kind: 'mailto', href: 'mailto:info@cantinaberioli.it', text: 'info@cantinaberioli.it', zone: 'footer' },
];
const BERIOLI_HOME = analyzeSnapshot(snap(`${BERIOLI}/`, {
  title: 'Home - Cantina Berioli', header: HEADER, footer: FOOTER, links: LINKS,
  page: "Cantina Berioli\nSin dai primi del '900 la Famiglia Berioli si dedica con passione alla coltivazione della vite, dell'olivo e del grano.\nI nostri vini nascono da vigneti in agricoltura biologica sulle colline del Lago Trasimeno: degustazioni in cantina su prenotazione.",
}), { pageType: 'home' });
const BERIOLI_CONTATTI = analyzeSnapshot(snap(`${BERIOLI}/contatti/`, {
  title: 'Contatti - Cantina Berioli', header: HEADER, footer: FOOTER,
  page: [
    'Contatti', 'Telefono: +39 345 25 86 604',
    'Indirizzo: Via del Moscatello, 3 - Frazione Montesperello, Magione - 06063 (PG) - ITALY',
    'Email: info@cantinaberioli.it', 'Chi contattare',
    'Sommelier: Irene Rossi +39 345 2586604',
    'Export, vendite, acquisti, logistica: Giulio Brandelli +39 349 5241724',
    'Titolare: Dott. Roberto Berioli +39 335 5498173',
  ].join('\n'),
  links: [...LINKS,
    { kind: 'tel', href: 'tel:+393452586604', text: '+39 345 2586604', zone: 'page' },
    { kind: 'tel', href: 'tel:+393495241724', text: '+39 349 5241724', zone: 'page' },
    { kind: 'tel', href: 'tel:+393355498173', text: '+39 335 5498173', zone: 'page' }],
}), { pageType: 'contact' });
const BERIOLI_CANTINA = analyzeSnapshot(snap(`${BERIOLI}/la-cantina/`, {
  title: 'La Cantina - Cantina Berioli', header: HEADER, footer: FOOTER, links: LINKS,
  page: [
    'La Cantina',
    "Grazie all'esperienza, la volontà e la preparazione del titolare Roberto Berioli, i vini prodotti hanno raggiunto nel corso degli anni un elevato livello qualitativo.",
    'Oggi Roberto Berioli con sua moglie Cristina e con i figli Matteo ed Assunta, con le rispettive famiglie, hanno ripreso in mano questa storia.',
  ].join('\n'),
}), { pageType: 'about' });
const berioli = () => siteOf(BERIOLI_HOME, BERIOLI_CONTATTI, BERIOLI_CANTINA);
const byName = (site) => Object.fromEntries(peopleOf(site).map((p) => [`${p.firstName} ${p.lastName}`, p]));

test('Berioli: Magione + (PG) + ITALY → città Magione, regione Umbria; paese non scritto (prospect italiano)', () => {
  const company = values(proposeCompany(berioli()));
  assert.deepEqual([company.name, company.city, company.state, company.country], ['Cantina Berioli', 'Magione', 'Umbria', '']);
  assert.equal(company.phone, '+39 345 258 6604');
});

test('Giulio viene rilevato correttamente, con ruolo e telefono, senza regole sul nome', () => {
  const giulio = byName(berioli())['Giulio Brandelli'];
  assert.ok(giulio, 'Giulio Brandelli rilevato');
  assert.deepEqual([giulio.firstName, giulio.lastName, giulio.role, giulio.mobile, giulio.phone], ['Giulio', 'Brandelli', 'Export, vendite, acquisti, logistica', '+39 349 524 1724', '']);
  assert.equal(giulio.eligible, true);
  // stessi schemi con altri nomi e altri ruoli
  const people = (text) => peopleOf(siteOf(analyzeSnapshot(snap(`${BERIOLI}/team/`, { page: text }), { pageType: 'team' }))).map((p) => `${p.firstName} ${p.lastName}|${p.role}|${p.mobile || p.phone}`);
  assert.deepEqual(people('Ufficio export: Anna Neri +39 333 1234567'), ['Anna Neri|Ufficio export|+39 333 123 4567']);
  assert.deepEqual(people('Prenotazioni - Laura Verdi 333 7654321'), ['Laura Verdi|Prenotazioni|+39 333 765 4321']);
  assert.deepEqual(people('Marco Gialli — Accoglienza e degustazioni — +39 347 1112223'), ['Marco Gialli|Accoglienza e degustazioni|+39 347 111 2223']);
  assert.deepEqual(people('Ufficio vendite\nSara Blu\n+39 340 9998887'), ['Sara Blu|Ufficio vendite|+39 340 999 8887']);
  // un'etichetta di recapito o un nome che non è di persona: nessuna persona
  assert.deepEqual(people('Indirizzo: Via Roma 1, 06063 Magione\nTelefono: +39 075 123456'), []);
  assert.deepEqual(people('Vino rosso: Montefalco Sagrantino +39 0742 379014'), []);
});

test('tre persone non fuse; ogni telefono alla persona giusta', () => {
  const people = byName(berioli());
  assert.deepEqual(Object.keys(people).sort(), ['Giulio Brandelli', 'Irene Rossi', 'Roberto Berioli']);
  assert.deepEqual(
    Object.entries(people).map(([name, p]) => [name, p.role, p.mobile, p.phone]).sort(),
    [
      ['Giulio Brandelli', 'Export, vendite, acquisti, logistica', '+39 349 524 1724', ''],
      ['Irene Rossi', 'Sommelier', '+39 345 258 6604', ''],
      ['Roberto Berioli', 'Titolare', '+39 335 549 8173', ''],
    ],
  );
  assert.ok(Object.values(people).every((p) => p.eligible), 'tutte e tre selezionabili come Contatto: nome, cognome, telefono');
  assert.ok(!people['Cristina '] && !people['Matteo '] && !people['Assunta '], 'i familiari citati senza ruolo non sono persone');
});

test('stesso numero: resta sia nel telefono dell\'Azienda sia nel cellulare di Irene', () => {
  let { draft } = applyFindings(emptyDraft(), BERIOLI_HOME);
  draft = applyFindings(draft, BERIOLI_CONTATTI).draft;
  draft = applyFindings(draft, BERIOLI_CANTINA).draft;
  draft = usePerson(draft, 'irenerossi');
  assert.equal(draft.company.phone.value, '+39 345 258 6604');
  assert.equal(draft.contact.mobilephone.value, '+39 345 258 6604');
  const records = crmRecords(draft, MATTEO);
  assert.equal(records.company.phone, '+39 345 258 6604');
  assert.equal(records.contact.mobilephone, '+39 345 258 6604');
});

test('segnali commerciali: Irene telefono dell\'azienda, Roberto ruolo decisionale, Giulio ruolo commerciale', () => {
  const site = berioli();
  const company = values(proposeCompany(site));
  const signals = Object.fromEntries(rankPeople(site, company).map((p) => [p.firstName, p.commercialSignals.map((s) => s.label)]));
  assert.deepEqual(signals.Irene, ["Numero coincidente con il telefono principale dell'azienda"]);
  assert.deepEqual(signals.Roberto, ['Ruolo decisionale esplicito: Titolare', 'Persona citata in più sezioni del sito']);
  assert.deepEqual(signals.Giulio, ['Ruolo commerciale esplicito: Export, vendite, acquisti, logistica']);
  // mai deduzioni
  for (const label of Object.values(signals).flat()) assert.ok(!/probabil|decision maker|proprietario/i.test(label), label);
});

test('segnali: email principale/secondaria e WhatsApp; nessun ruolo decisionale dal «titolare del trattamento»', () => {
  const person = { role: 'Titolare del trattamento', email: 'Info@Cantina.it', mobile: '+39 333 1234567', sources: [] };
  const company = { phone: '+39 0742 123456', email_aziendale_principale: 'info@cantina.it', email_aziendale_secondaria: 'visite@cantina.it' };
  const site = siteOf(analyzeSnapshot(snap('https://cantina.test/', { page: 'WhatsApp +39 333 1234567', links: [{ kind: 'whatsapp', href: 'https://wa.me/393331234567', text: 'WhatsApp', zone: 'page' }] }), { pageType: 'home' }));
  assert.deepEqual(commercialSignals(person, company, site).map((s) => s.type), ['whatsapp', 'companyEmail']);
  assert.deepEqual(commercialSignals({ email: 'visite@cantina.it', sources: [] }, company).map((s) => s.label), ["Email coincidente con l'email secondaria dell'azienda"]);
  for (const role of ['Owner', 'Founder', 'CEO', 'Direttore', 'General Manager', 'Amministratore unico']) {
    assert.equal(commercialSignals({ role, sources: [] }, {})[0]?.type, 'decisionRole', role);
  }
  for (const role of ['Export manager', 'Vendite', 'Sales', 'Commerciale', 'Booking', 'Prenotazioni']) {
    assert.equal(commercialSignals({ role, sources: [] }, {})[0]?.type, 'commercialRole', role);
  }
  assert.deepEqual(commercialSignals({ role: 'Sommelier', sources: [] }, {}), [], 'nessun ruolo inventato');
});

test('persona citata in due URL indipendenti → segnale; il footer ripetuto non conta', () => {
  const people = byName(berioli());
  const pages = (p) => new Set(p.sources.map((s) => s.url)).size;
  assert.ok(pages(people['Irene Rossi']) >= 3, 'Irene è nel footer di ogni pagina');
  assert.ok(!commercialSignals(people['Irene Rossi'], {}).some((s) => s.type === 'multiPage'), 'ma solo una pagina la cita nel contenuto');
  assert.ok(commercialSignals(people['Roberto Berioli'], {}).some((s) => s.type === 'multiPage'), 'Contatti + La cantina');
});

test('il punteggio cambia solo l\'ordine: dati identici, Contatto proposto invariato', () => {
  const site = berioli();
  const company = values(proposeCompany(site));
  const ranked = rankPeople(site, company);
  assert.deepEqual(ranked.map((p) => p.firstName), ['Roberto', 'Giulio', 'Irene']);
  const base = Object.fromEntries(peopleOf(site).map((p) => [p.key, p]));
  for (const { commercialSignals: signals, ...p } of ranked) assert.deepEqual(p, base[p.key], `${p.key}: dati invariati`);
  assert.ok(ranked.every((p) => !('score' in p) && !('weight' in p)), 'nessun punteggio esposto');
  assert.equal(suggestedContact(ranked), 'robertoberioli');
  assert.equal(proposeContact(site).mainKey, 'robertoberioli');
});

test('scelta manuale del Contatto: non cambia con una nuova scansione né per il punteggio', () => {
  let { draft } = applyFindings(emptyDraft(), BERIOLI_CONTATTI);
  draft = usePerson(draft, 'irenerossi');
  draft = applyFindings(draft, BERIOLI_CANTINA).draft;
  draft = applyFindings(draft, BERIOLI_HOME).draft;
  assert.deepEqual([draft.mainPerson, draft.mainPersonChosen, draft.contact.firstname.value], ['irenerossi', true, 'Irene']);
  assert.equal(suggestedContact(rankPeople(draft.site, values(draft.company))), 'robertoberioli', 'il suggerimento resta solo un suggerimento');
});

test('Contesto rapido: potenziali contatti con i segnali importanti, senza punteggi né deduzioni', () => {
  const site = berioli();
  const company = values(proposeCompany(site));
  const text = buildQuickContext(site, company, {});
  const block = text.split('\n\n').find((s) => s.startsWith('POTENZIALI CONTATTI'));
  assert.equal(block, [
    'POTENZIALI CONTATTI',
    '- Roberto Berioli — Titolare',
    '  Ruolo decisionale esplicito',
    '- Giulio Brandelli — Export, vendite, acquisti, logistica',
    '  Ruolo commerciale esplicito',
    '- Irene Rossi — Sommelier',
    "  Numero coincidente con il telefono principale dell'azienda",
  ].join('\n'));
  assert.ok(!/\d{2,3}\s*(punti|pt)|probabil/i.test(text));
});

// ---------------------------------------------------------------------------------------------
// località: provincia → regione, paese, unione tra pagine

test('PG → Umbria, Perugia (PG) → Umbria, Provincia di Perugia → Umbria', () => {
  const one = (page) => place(siteOf(analyzeSnapshot(snap('https://cantina.test/contatti', { page }), { pageType: 'contact' })));
  assert.deepEqual(one('Via Roma 1, 06063 Magione (PG)'), { city: 'Magione', state: 'Umbria', country: '', stateMethod: 'dedotta dalla provincia (PG)', stateUrl: 'https://cantina.test/contatti' });
  assert.equal(one('Strada delle Fratte 3, 06132 Perugia (PG)').state, 'Umbria');
  const named = one('Via Roma 1, 06063 Magione\nSiamo in provincia di Perugia, vicino al lago.');
  assert.deepEqual([named.city, named.state, named.country], ['Magione', 'Umbria', '']);
  assert.match(named.stateMethod, /unica provincia indicata nel sito/);
});

test('ITALY / Italy / italy / ITALIA / Italia → Italia', () => {
  for (const v of ['ITALY', 'Italy', 'italy', 'ITALIA', 'Italia', ' it ']) assert.equal(normalizeCountry(v), 'Italia', v);
  assert.equal(normalizeCountry('Svizzera'), 'Svizzera');
  // paese scritto da solo nel footer, senza provincia: riconosciuto, ma per un prospect italiano non si propone
  const site = siteOf(analyzeSnapshot(snap('https://cantina.test/', { page: 'Via Roma 1, 53024 Montalcino', footer: 'ITALY' }), { pageType: 'home' }));
  assert.deepEqual([place(site).city, place(site).country], ['Montalcino', '']);
});

test('località unita tra più pagine: Magione su una, (PG) su un\'altra, ITALY nel footer', () => {
  const a = analyzeSnapshot(snap('https://cantina.test/contatti', { page: 'Contatti\nVia del Moscatello 3, 06063 Magione' }), { pageType: 'contact' });
  const b = analyzeSnapshot(snap('https://cantina.test/dove-siamo', { page: 'Dove siamo\n(PG)' }), { pageType: 'other' });
  const c = analyzeSnapshot(snap('https://cantina.test/', { page: 'Benvenuti', footer: 'ITALY' }), { pageType: 'home' });
  for (const pages of [[a, b, c], [c, b, a], [b, a, c]]) {
    const p = place(siteOf(...pages));
    assert.deepEqual([p.city, p.state, p.country], ['Magione', 'Umbria', '']);
    assert.equal(p.stateUrl, 'https://cantina.test/dove-siamo', 'con la fonte del dato');
  }
});

test('nessuna regione inventata: province diverse o sede legale altrove non decidono', () => {
  const montalcino = analyzeSnapshot(snap('https://cantina.test/contatti', {
    page: 'Via del Poggio 2, 53024 Montalcino\nSede legale: Via Dante 4, 20121 Milano (MI)',
  }), { pageType: 'contact' });
  assert.deepEqual([place(siteOf(montalcino)).city, place(siteOf(montalcino)).state], ['Montalcino', '']);
  const ambiguous = analyzeSnapshot(snap('https://cantina.test/', { page: 'Via Roma 1, 06063 Magione\n(PG)\n(TR)' }), { pageType: 'home' });
  assert.equal(place(siteOf(ambiguous)).state, '');
});

test('regressione: La Mora Assisi → Umbria; Perticaia Montefalco → Umbria (nessun paese per un prospect italiano)', () => {
  const lamora = analyzeSnapshot(snap('https://www.lamora.it/', { page: 'Agriturismo La Mora\nVia Roma 1, 06081 Assisi (PG)\nTel. 075 8123456' }), { pageType: 'home' });
  assert.deepEqual(Object.values(place(siteOf(lamora))).slice(0, 3), ['Assisi', 'Umbria', '']);
  const perticaia = analyzeSnapshot(snap('https://perticaia-caso.test/', { page: 'Perticaia', footer: 'Perticaia Società Agricola S.r.l. · Località Casale 1, 06036 Montefalco (PG)' }), { pageType: 'home' });
  assert.deepEqual(Object.values(place(siteOf(perticaia))).slice(0, 3), ['Montefalco', 'Umbria', '']);
});

// ---------------------------------------------------------------------------------------------
// pre-flight prima della scrittura

function berioliDraft() {
  let { draft } = applyFindings(emptyDraft(), BERIOLI_HOME);
  draft = applyFindings(draft, BERIOLI_CONTATTI).draft;
  return applyFindings(draft, BERIOLI_CANTINA).draft;
}

test('state presente nel modello → presente nel payload; country non scritto per un prospect italiano; pre-flight superato', () => {
  const draft = berioliDraft();
  const { properties, errors } = companyPayload(crmRecords(draft, MATTEO).company, MATTEO);
  assert.deepEqual(errors, []);
  assert.deepEqual([properties.city, properties.state, properties.country], ['Magione', 'Umbria', undefined]);
  assert.deepEqual(preflightCompany(draft, MATTEO), { ok: true, missing: [], message: '' });
});

test('payload incompleto → il pre-flight blocca la scrittura', () => {
  // regione trovata nel sito ma persa nel form (non corretta a mano)
  const lost = berioliDraft();
  Object.assign(lost.company.state, { value: '', edited: false });
  Object.assign(lost.company.country, { value: '', edited: false });
  assert.deepEqual(preflightCompany(lost, MATTEO), { ok: false, missing: ['Regione'], message: 'Alcuni dati rilevati non sono stati trasferiti correttamente al modello HubSpot.' });
  // un payload che perde un dato del form
  const record = crmRecords(berioliDraft(), MATTEO).company;
  const { properties } = companyPayload(record, MATTEO);
  const { state, ...withoutState } = properties;
  assert.deepEqual(lostFields(record, withoutState, { ownerId: MATTEO.hubspotOwnerId }), ['Regione']);
  assert.deepEqual(lostFields(record, { ...properties, hubspot_owner_id: '1' }, { ownerId: MATTEO.hubspotOwnerId }), ['Proprietario HubSpot']);
  assert.equal(PREFLIGHT_MESSAGE, 'Alcuni dati rilevati non sono stati trasferiti correttamente al modello HubSpot.');
});

test('pre-flight: un dato non trovato o svuotato a mano non blocca; il tipo struttura nascosto non conta', () => {
  const draft = editField(berioliDraft(), 'company', 'state', ''); // svuotato a mano dal commerciale
  assert.equal(preflightCompany(draft, MATTEO).ok, true);
  const noPlace = applyFindings(emptyDraft(), analyzeSnapshot(snap('https://cantina.test/', { title: 'Cantina Test', page: 'Cantina e vini.' }), { pageType: 'home' })).draft;
  assert.equal(preflightCompany(noPlace, MATTEO).ok, true, 'niente regione nel sito: niente da perdere');
  const cantina = editField(berioliDraft(), 'company', 'tipo_struttura_hospitality', 'Agriturismo');
  assert.equal(preflightCompany(cantina, MATTEO).ok, true, 'Cantina: tipo struttura escluso per regola');
});
