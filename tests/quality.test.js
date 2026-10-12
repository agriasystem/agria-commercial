// Milestone 1.1.1: qualità dei dati sui casi emersi dai test manuali (Agriturismo La Mora,
// Cantina Perticaia). Le pagine sono fotografie equivalenti alle fixture HTML usate nella prova nel
// browser (tests/fixtures/caso-*.html): nessun sito reale, nessuna rete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSnapshot, emailCategory } from '../extension/lib/parser.js';
import { addPageFindings, emptySite, factsOf, peopleOf } from '../extension/lib/siteData.js';
import {
  buildQuickContext, COMPANY_PROPS, isPropVisible, proposeCompany, proposeContact,
} from '../extension/lib/crmModel.js';
import { applyFindings, editField, emptyDraft } from '../extension/lib/draft.js';

const CONFIG = { hubspot: { ownerId: '42', ownerName: 'Commerciale' } };
const snap = (url, { title = '', page = '', footer = '', links = [], headings = [], meta = {} } = {}) => ({
  url, title, meta, jsonld: [], links, resources: [], microdata: [], addresses: [], headings,
  text: { header: '', footer, page: [page, footer].filter(Boolean).join('\n') },
});
const analyze = (s, pageType) => analyzeSnapshot(s, { pageType });
const siteOf = (...pages) => pages.reduce((site, p) => addPageFindings(site, p), emptySite());
const values = (fields) => Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.value]));
const emails = (site) => factsOf(site, 'email').map((f) => f.value);
function quickContextOf(site) {
  const company = values(proposeCompany(site, CONFIG));
  const contact = values(proposeContact(site, CONFIG).fields);
  return { company, contact, text: buildQuickContext(site, company, contact) };
}

// ---------------------------------------------------------------------------------------------
// caso La Mora: telefono ed email in due link attaccati, "Paolo" host senza cognome

const LAMORA = 'https://lamora-caso.test';
const LAMORA_FOOTER = [
  '+39 393 4363917agriturismolamora@gmail.com',
  'Scrivici su WhatsApp',
  'Agriturismo La Mora · P.IVA 01234567897',
  '© 2025 Agriturismo La Mora · Sito realizzato da Studio Web Esempio S.r.l.',
].join('\n');
const LAMORA_LINKS = [
  { kind: 'tel', href: 'tel:+393934363917', text: '+39 393 4363917', zone: 'footer' },
  { kind: 'mailto', href: 'mailto:agriturismolamora@gmail.com', text: 'agriturismolamora@gmail.com', zone: 'footer' },
  { kind: 'whatsapp', href: 'https://wa.me/393934363917', text: 'Scrivici su WhatsApp', zone: 'footer' },
];
const LAMORA_HOME = analyze(snap(`${LAMORA}/`, {
  title: 'Agriturismo La Mora | Agriturismo con camere in Umbria',
  meta: { description: "Agriturismo La Mora: camere, colazione e soggiorno tra gli ulivi." },
  headings: ['Agriturismo La Mora', 'Le camere'],
  page: "Agriturismo La Mora\nAgriturismo con camere immerse nel verde: soggiorno, colazione con prodotti dell'agriturismo, ospiti accolti come in famiglia.\nLe camere\nCamere doppie e appartamenti per il tuo soggiorno in agriturismo.",
  footer: LAMORA_FOOTER,
  links: LAMORA_LINKS,
}), 'home');
const LAMORA_CHI_SIAMO = analyze(snap(`${LAMORA}/chi-siamo`, {
  title: 'Chi siamo | Agriturismo La Mora',
  page: 'Chi siamo\nLa Mora è un agriturismo a conduzione familiare tra gli ulivi.\nPaolo, host di Agriturismo La Mora, vi accoglie e vi consiglia i percorsi più belli.',
  footer: LAMORA_FOOTER,
  links: LAMORA_LINKS,
}), 'about');

test('email corrotta dal telefono adiacente: resta solo quella pulita', () => {
  for (const phone of ['+39 393 436 3917', '+39 393 4363917']) {
    const findings = analyze(snap(`${LAMORA}/`, {
      page: `Contatti\n${phone}agriturismolamora@gmail.com`,
      links: [{ kind: 'mailto', href: 'mailto:agriturismolamora@gmail.com', text: 'Scrivici', zone: 'page' }],
    }), 'home');
    assert.deepEqual(emails(siteOf(findings)), ['agriturismolamora@gmail.com'], `${phone} attaccato all'email`);
  }
  assert.deepEqual(emails(siteOf(LAMORA_HOME, LAMORA_CHI_SIAMO)), ['agriturismolamora@gmail.com']);
});

test('email corrotta: la copia pulita può stare su un\'altra pagina o nel testo; nessuna regola sulle cifre iniziali', () => {
  const glued = analyze(snap(`${LAMORA}/contatti`, { page: 'Tel. +39 393 4363917agriturismolamora@gmail.com' }), 'contact');
  const clean = analyze(snap(`${LAMORA}/`, { page: 'Scrivi a agriturismolamora@gmail.com' }), 'home');
  // in qualunque ordine arrivino le pagine
  assert.deepEqual(emails(siteOf(glued, clean)), ['agriturismolamora@gmail.com']);
  assert.deepEqual(emails(siteOf(clean, glued)), ['agriturismolamora@gmail.com']);
  // senza una copia pulita più affidabile l'email resta, da verificare: non si tagliano cifre a caso
  const alone = factsOf(siteOf(glued), 'email');
  assert.deepEqual(alone.map((f) => f.value), ['4363917agriturismolamora@gmail.com']);
  assert.equal(alone[0].reliability, 'check');
  // un'email che inizia davvero con delle cifre resta
  const digits = analyze(snap(`${LAMORA}/`, {
    page: 'Meteo: 3bmeteo@esempio-meteo.it\nScrivi a info@lamora.it',
    links: [{ kind: 'mailto', href: 'mailto:3bmeteo@esempio-meteo.it', text: '3bmeteo@esempio-meteo.it', zone: 'page' }],
  }), 'home');
  assert.ok(emails(siteOf(digits)).includes('3bmeteo@esempio-meteo.it'));
  // etichetta attaccata: "E-mailinfo@…"
  const label = analyze(snap(`${LAMORA}/`, {
    page: 'E-mailinfo@lamora.it',
    links: [{ kind: 'mailto', href: 'mailto:info@lamora.it', text: 'Scrivici', zone: 'page' }],
  }), 'home');
  assert.deepEqual(emails(siteOf(label)), ['info@lamora.it']);
});

test('alias funzionali: email aziendali generiche, mai prova di una persona', () => {
  assert.equal(emailCategory('visit@perticaia.it'), 'generic');
  assert.equal(emailCategory('info@perticaia.it'), 'generic');
  for (const alias of ['info', 'contact', 'contatti', 'hello', 'visit', 'visite', 'booking', 'book', 'prenotazioni', 'reservation',
    'reservations', 'reception', 'receptionist', 'sales', 'commerciale', 'amministrazione', 'administration', 'office', 'segreteria',
    'marketing', 'eventi', 'events', 'shop', 'store', 'hospitality', 'welcome', 'staff', 'support', 'assistenza']) {
    assert.equal(emailCategory(`${alias}@cantina.it`), 'generic', alias);
  }
  assert.equal(emailCategory('info.cantina@cantina.it'), 'generic', 'alias con un suffisso');
  assert.equal(emailCategory('booking2@hotel.it'), 'generic');
  // personale solo con la forma di un nome
  assert.equal(emailCategory('paolo@lamora.it'), 'personal', 'nome@');
  assert.equal(emailCategory('mario.rossi@cantina.it'), 'personal', 'nome.cognome@');
  assert.equal(emailCategory('m.rossi@cantina.it'), 'personal', 'iniziale.cognome@');
  assert.equal(emailCategory('rossi.mario@cantina.it'), 'personal', 'cognome.nome@');
  assert.equal(emailCategory('agriturismolamora@gmail.com'), 'company', 'casella dell\'azienda, non di una persona');
  assert.equal(emailCategory('perticaia@gmail.com'), 'company');
  assert.equal(emailCategory('lamora@pec.it'), 'pec');
  assert.equal(emailCategory('noreply@lamora.it'), 'system');

  // un alias vicino a una persona resta dell'azienda; un link a info@ con un nome non crea una persona
  const findings = analyze(snap('https://cantina-esempio.test/team', {
    page: 'Mario Rossi – Titolare · visit@cantina-esempio.test\nGiulia Bianchi – Enologa · giulia.bianchi@cantina-esempio.test',
    links: [{ kind: 'mailto', href: 'mailto:info@cantina-esempio.test', text: 'Luca Neri', zone: 'page' }],
  }), 'team');
  const site = siteOf(findings);
  const people = Object.fromEntries(peopleOf(site).map((p) => [`${p.firstName} ${p.lastName}`, p]));
  assert.equal(people['Mario Rossi'].email, '', 'visit@ non è l\'email di Mario');
  assert.equal(people['Giulia Bianchi'].email, 'giulia.bianchi@cantina-esempio.test');
  assert.ok(!people['Luca Neri'], 'nessuna persona da un link a info@');
  const company = values(proposeCompany(site, CONFIG));
  assert.equal(company.email_aziendale_principale, 'info@cantina-esempio.test');
  assert.equal(company.email_aziendale_secondaria, 'visit@cantina-esempio.test');
});

test('persone parziali: Paolo — Host senza cognome inventato, mai Contatto in automatico', () => {
  const cases = [
    ['Paolo, host di Agriturismo La Mora', 'Paolo', 'Host'],
    ['Paolo — Host', 'Paolo', 'Host'],
    ['Host: Paolo', 'Paolo', 'Host'],
    ['Il vostro host Paolo vi accoglierà', 'Paolo', 'Host'],
    ['Il vostro host è Paolo.', 'Paolo', 'Host'],
    ['Paolo, il vostro host', 'Paolo', 'Host'],
    ['Titolare: Mario', 'Mario', 'Titolare'],
    ['Responsabile: Laura', 'Laura', 'Responsabile'],
  ];
  for (const [text, firstName, role] of cases) {
    const people = peopleOf(siteOf(analyze(snap(`${LAMORA}/chi-siamo`, { page: text }), 'about')));
    assert.equal(people.length, 1, text);
    assert.deepEqual([people[0].firstName, people[0].lastName, people[0].role], [firstName, '', role], text);
    assert.equal(people[0].partial, true, text);
    assert.equal(people[0].eligible, false, text);
  }

  const site = siteOf(LAMORA_HOME, LAMORA_CHI_SIAMO);
  const [paolo] = peopleOf(site);
  assert.deepEqual([paolo.firstName, paolo.lastName, paolo.role, paolo.partial], ['Paolo', '', 'Host', true]);
  assert.equal(paolo.sources[0].url, `${LAMORA}/chi-siamo`, 'con la pagina di origine');
  assert.match(paolo.sources[0].evidence, /Paolo, host di Agriturismo La Mora/, "con l'evidenza");
  assert.equal(paolo.mobile, '', 'il numero del footer è dell\'azienda, non di Paolo');
  assert.equal(paolo.email, '');
  const { fields, mainKey } = proposeContact(site, CONFIG);
  assert.equal(mainKey, null, 'nessun Contatto automatico senza cognome');
  assert.equal(fields.firstname.value, '');
});

test('contesto rapido caso La Mora: WhatsApp, P.IVA, Paolo; niente email corrotta, fornitori o doppioni', () => {
  const site = siteOf(LAMORA_HOME, LAMORA_CHI_SIAMO);
  const { company, text } = quickContextOf(site);
  assert.equal(company.email_aziendale_principale, 'agriturismolamora@gmail.com');
  assert.equal(company.email_aziendale_secondaria, '');
  assert.equal(company.phone, '+39 393 436 3917');
  assert.deepEqual(factsOf(site, 'whatsapp').map((f) => f.value), ['+39 393 436 3917']);
  assert.equal(company.settore_agria, 'Hospitality');
  assert.equal(company.tipo_struttura_hospitality, 'Agriturismo');
  assert.equal(text, [
    'WHATSAPP',
    '+39 393 436 3917',
    '',
    'P.IVA',
    '01234567897',
    '',
    'POTENZIALI CONTATTI',
    '- Paolo — Host (cognome non trovato)',
  ].join('\n'));
  assert.ok(!text.includes('4363917agriturismolamora'), 'nessuna email corrotta');
  assert.ok(!text.includes('Studio Web Esempio'), 'nessuna ragione sociale di fornitori');
  // la ragione sociale del fornitore resta solo tra i dati rilevati, mai proposta come nome
  assert.ok(factsOf(site, 'legalName').some((f) => f.value === 'Studio Web Esempio S.r.l.'));
  assert.ok(!proposeCompany(site, CONFIG).name.alternatives.some((a) => a.includes('Studio Web')));
});

// ---------------------------------------------------------------------------------------------
// caso Perticaia: cantina, info@ e visit@, fisso e cellulare WhatsApp

const PERTICAIA = 'https://perticaia-caso.test';
const PERTICAIA_HOME = analyze(snap(`${PERTICAIA}/`, {
  title: 'Perticaia | Cantina a Montefalco',
  meta: { description: 'Cantina a Montefalco: vini, vigneti e degustazioni.' },
  headings: ['Perticaia', 'Visite e degustazioni'],
  page: [
    'Perticaia',
    'La nostra cantina a Montefalco: vini da vigneti di proprietà, vendemmia a mano, Sagrantino DOCG.',
    'Visite e degustazioni',
    'Degustazioni in cantina su prenotazione. Per prenotare una visita scrivi a visit@perticaia.it.',
  ].join('\n'),
  footer: [
    'Perticaia Società Agricola S.r.l. · Località Casale 1, 06036 Montefalco (PG)',
    'Tel. +39 0742 379014',
    'Cellulare e WhatsApp +39 376 255 3216 · Scrivici su WhatsApp',
    'info@perticaia.it',
    'P.IVA 12345678903 · REA PG-654321',
    'Instagram Facebook',
  ].join('\n'),
  links: [
    { kind: 'mailto', href: 'mailto:visit@perticaia.it', text: 'visit@perticaia.it', zone: 'page' },
    { kind: 'tel', href: 'tel:+390742379014', text: '+39 0742 379014', zone: 'footer' },
    { kind: 'tel', href: 'tel:+393762553216', text: '+39 376 255 3216', zone: 'footer' },
    { kind: 'whatsapp', href: 'https://wa.me/393762553216', text: 'Scrivici su WhatsApp', zone: 'footer' },
    { kind: 'mailto', href: 'mailto:info@perticaia.it', text: 'info@perticaia.it', zone: 'footer' },
    { kind: 'web', href: 'https://www.instagram.com/perticaia/', text: 'Instagram', zone: 'footer' },
    { kind: 'web', href: 'https://www.facebook.com/perticaia', text: 'Facebook', zone: 'footer' },
  ],
}), 'home');

test('contesto rapido caso Perticaia: WhatsApp/cellulare, email principali non ripetute, niente ragioni sociali', () => {
  const site = siteOf(PERTICAIA_HOME);
  const { company, text } = quickContextOf(site);
  assert.equal(company.email_aziendale_principale, 'info@perticaia.it');
  assert.equal(company.email_aziendale_secondaria, 'visit@perticaia.it');
  assert.equal(company.phone, '+39 0742379014');
  assert.equal(company.settore_agria, 'Cantina / Vitivinicolo');
  assert.equal(company.tipo_struttura_hospitality, '');
  assert.equal(isPropVisible(COMPANY_PROPS.find((p) => p.name === 'tipo_struttura_hospitality'), company), false, 'tipo struttura nascosto');
  for (const email of ['visit@perticaia.it', 'info@perticaia.it']) {
    assert.equal(emailCategory(email, factsOf(site, 'email').find((f) => f.value === email).extra), 'generic', `${email}: aziendale generica`);
  }
  assert.equal(peopleOf(site).length, 0, 'visit@ non è una persona');
  assert.equal(text, [
    'WHATSAPP',
    '+39 376 255 3216',
    '',
    'P.IVA',
    '12345678903',
    '',
    'ALTRI CANALI',
    '- Instagram: https://www.instagram.com/perticaia/',
    '- Facebook: https://www.facebook.com/perticaia',
  ].join('\n'));
  assert.ok(!text.includes('info@perticaia.it') && !text.includes('visit@perticaia.it'), 'principale e secondaria non si ripetono');
  assert.ok(!/S\.r\.l\.|Società Agricola|REA/.test(text), 'nessuna ragione sociale né REA');
  assert.ok(!text.includes('ULTERIORI TELEFONI'), 'il cellulare è già nel WhatsApp, il fisso è il telefono principale');
});

test('tipo struttura Hospitality: visibile solo con settore Hospitality, riproposto quando il settore cambia', () => {
  const prop = COMPANY_PROPS.find((p) => p.name === 'tipo_struttura_hospitality');
  assert.equal(isPropVisible(prop, { settore_agria: 'Hospitality' }), true);
  for (const settore of ['', 'Cantina / Vitivinicolo', 'Frantoio / Olivicolo', 'Altro']) assert.equal(isPropVisible(prop, { settore_agria: settore }), false, settore || 'vuoto');
  assert.equal(isPropVisible(COMPANY_PROPS.find((p) => p.name === 'city'), {}), true, 'gli altri campi restano sempre visibili');

  // La Mora: Hospitality → Cantina (tipo vuoto e nascosto) → di nuovo Hospitality (tipo riproposto)
  let { draft } = applyFindings(emptyDraft(), LAMORA_HOME, CONFIG);
  assert.equal(draft.company.tipo_struttura_hospitality.value, 'Agriturismo');
  draft = editField(draft, 'company', 'settore_agria', 'Cantina / Vitivinicolo');
  assert.equal(draft.company.tipo_struttura_hospitality.value, '');
  draft = editField(draft, 'company', 'settore_agria', 'Hospitality');
  assert.equal(draft.company.tipo_struttura_hospitality.value, 'Agriturismo');
  // una scelta a mano del tipo resta anche se il settore cambia
  draft = editField(draft, 'company', 'tipo_struttura_hospitality', 'Relais');
  draft = editField(draft, 'company', 'settore_agria', 'Altro');
  assert.equal(draft.company.tipo_struttura_hospitality.value, 'Relais');
  // e una nuova pagina non lo ricalcola contro il settore scelto a mano
  draft = applyFindings(draft, LAMORA_CHI_SIAMO, CONFIG).draft;
  assert.equal(draft.company.settore_agria.value, 'Altro');
});
