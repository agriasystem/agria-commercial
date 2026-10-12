// Estrazione da una singola pagina: tutti gli scenari della V0, letti attraverso il modello HubSpot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSnapshot } from '../extension/lib/parser.js';
import { addPageFindings, emptySite, factsOf, peopleOf } from '../extension/lib/siteData.js';
import { proposeCompany, proposeContact } from '../extension/lib/crmModel.js';

const CONFIG = { hubspot: { ownerId: '', ownerName: '' } };

// fotografia della pagina come la produce content/collector.js
const snap = (over = {}) => ({
  schema: 2,
  url: 'https://www.esempio-prospect.it/',
  title: '',
  meta: {},
  jsonld: [],
  jsonldErrors: 0,
  links: [],
  resources: [],
  microdata: [],
  addresses: [],
  headings: [],
  ...over,
  text: { header: '', footer: '', page: '', truncated: false, ...over.text },
});

function analyze(over, pageType = 'home') {
  const findings = analyzeSnapshot(snap(over), { pageType });
  const site = addPageFindings(emptySite(), findings);
  const company = proposeCompany(site, CONFIG);
  const contact = proposeContact(site, CONFIG).fields;
  const v = (fields) => Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.value]));
  return { findings, site, company, contact, c: v(company), p: v(contact), people: peopleOf(site), facts: (kind) => factsOf(site, kind) };
}

test('JSON-LD LocalBusiness: azienda completa, regione e paese dalla provincia', () => {
  const r = analyze({
    url: 'https://www.agriturismolamora.it/camere',
    title: 'Home | Agriturismo La Mora',
    jsonld: [{
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: 'Agriturismo La Mora',
      telephone: '+39 075 812 3456',
      email: 'info@agriturismolamora.it',
      address: { '@type': 'PostalAddress', streetAddress: 'Via delle Querce 14', postalCode: '06081', addressLocality: 'Assisi', addressRegion: 'PG' },
    }],
  });
  assert.equal(r.c.name, 'Agriturismo La Mora');
  assert.equal(r.c.website, 'https://www.agriturismolamora.it');
  assert.equal(r.c.domain, 'agriturismolamora.it');
  assert.equal(r.c.email_aziendale_principale, 'info@agriturismolamora.it');
  assert.equal(r.c.phone, '+39 0758123456');
  assert.equal(r.facts('address')[0].value, 'Via delle Querce 14, 06081 Assisi (PG)');
  assert.equal(r.c.city, 'Assisi');
  assert.equal(r.c.state, 'Umbria');
  assert.equal(r.c.country, 'Italia');
  assert.equal(r.company.name.method, 'dati strutturati JSON-LD');
  assert.equal(r.company.name.reliability, 'high');
  assert.equal(r.company.state.method, 'dedotta dalla provincia (PG)');
  assert.equal(r.findings.page.domain, 'agriturismolamora.it');
});

test('senza dati strutturati: titolo, link, footer e persone dal testo', () => {
  const r = analyze({
    url: 'https://cantinarossi.it/contatti',
    title: 'Contatti | Cantina Rossi',
    links: [
      { kind: 'mailto', href: 'mailto:info@cantinarossi.it', text: 'info@cantinarossi.it', zone: 'page' },
      { kind: 'tel', href: 'tel:0742123456', text: '0742 123456', zone: 'page' },
      { kind: 'mailto', href: 'mailto:mario.rossi@cantinarossi.it?subject=Info', text: 'mario.rossi@cantinarossi.it', zone: 'page' },
      { kind: 'linkedin', href: 'https://it.linkedin.com/in/mario-rossi-vino/', text: 'LinkedIn', zone: 'page' },
      { kind: 'linkedin', href: 'https://www.linkedin.com/company/cantina-rossi', text: '', zone: 'footer' },
    ],
    text: {
      footer: '© 2025 Cantina Rossi S.r.l. - P.IVA 12345678903',
      page: [
        'Contatti', 'Cantina Rossi S.r.l.', 'Via Roma, 12', '06034 Foligno (PG)', 'Telefono: 0742 123456',
        'Il nostro team', 'Mario Rossi – Titolare · mario.rossi@cantinarossi.it · LinkedIn',
        'Luca Verdi – Responsabile commerciale · l.verdi@cantinarossi.it',
        '© 2025 Cantina Rossi S.r.l. - P.IVA 12345678903',
      ].join('\n'),
    },
  }, 'contact');
  assert.equal(r.c.name, 'Cantina Rossi');
  assert.ok(r.company.name.alternatives.includes('Cantina Rossi S.r.l.'), 'ragione sociale dal copyright come alternativa');
  assert.equal(r.c.email_aziendale_principale, 'info@cantinarossi.it');
  assert.equal(r.c.phone, '+39 0742123456');
  assert.equal(r.facts('address')[0].value, 'Via Roma, 12, 06034 Foligno (PG)');
  assert.equal(r.c.city, 'Foligno');
  assert.equal(r.c.state, 'Umbria');
  assert.equal(r.c.linkedin_company_page, 'https://www.linkedin.com/company/cantina-rossi');
  assert.equal(r.p.firstname, 'Mario');
  assert.equal(r.p.lastname, 'Rossi');
  assert.equal(r.p.jobtitle, 'Titolare');
  assert.equal(r.p.email, 'mario.rossi@cantinarossi.it');
  assert.equal(r.p.hs_linkedin_url, 'https://www.linkedin.com/in/mario-rossi-vino');
  assert.equal(r.contact.firstname.reliability, 'check', 'dal testo: da verificare');
  const luca = r.people.find((p) => p.firstName === 'Luca');
  assert.equal(luca.lastName, 'Verdi');
  assert.equal(luca.role, 'Responsabile commerciale');
  assert.equal(luca.email, 'l.verdi@cantinarossi.it');
  assert.ok(!r.c.email_aziendale_secondaria.includes('rossi') && !r.c.email_aziendale_secondaria.includes('verdi'), 'le email delle persone restano sulle persone');
});

test('pagina senza dati: nessun valore inventato', () => {
  const r = analyze({
    url: 'https://vuoto-esempio.it/blog/post-1',
    title: 'Benvenuti',
    text: { page: 'Il nostro vino nasce tra le colline.\nScopri la nostra storia e vieni a trovarci.' },
  }, 'blog');
  assert.deepEqual(r.findings.facts, []);
  assert.deepEqual(r.findings.people, []);
  for (const k of ['name', 'phone', 'email_aziendale_principale', 'email_aziendale_secondaria', 'city', 'state', 'country', 'linkedin_company_page', 'settore_agria']) {
    assert.equal(r.c[k], '', k);
  }
  for (const k of ['firstname', 'lastname', 'jobtitle', 'email', 'phone', 'mobilephone', 'hs_linkedin_url']) assert.equal(r.p[k], '', k);
  assert.equal(r.c.domain, 'vuoto-esempio.it');
});

test('falsi positivi: privacy, P.IVA, fax, immagini, PEC, agenzia web, segnaposto', () => {
  const r = analyze({
    url: 'https://www.lamora.it/',
    links: [
      { kind: 'mailto', href: 'mailto:info@webagency.it', text: 'info@webagency.it', zone: 'footer' },
      { kind: 'mailto', href: 'mailto:noreply@lamora.it', text: 'noreply@lamora.it', zone: 'footer' },
    ],
    text: {
      footer: 'La Mora · P.IVA 01234567890 · Fax 075 999 8888\nPEC: lamora@pec.it · amministrazione@lamora.it\nSito realizzato da WebAgency – info@webagency.it',
      page: 'Titolare del trattamento dei dati è La Mora S.r.l.\nlogo@2x.png\nScrivi a nome@example.com\nLa Mora · P.IVA 01234567890 · Fax 075 999 8888\nPEC: lamora@pec.it · amministrazione@lamora.it',
    },
  });
  assert.equal(r.c.email_aziendale_principale, 'amministrazione@lamora.it');
  const emails = r.facts('email').map((f) => f.value);
  assert.ok(!emails.includes('nome@example.com'));
  assert.ok(!emails.some((e) => e.endsWith('.png')));
  assert.ok(![r.c.email_aziendale_principale, r.c.email_aziendale_secondaria].includes('lamora@pec.it'), 'la PEC non è un\'email aziendale');
  assert.ok(![r.c.email_aziendale_principale, r.c.email_aziendale_secondaria].includes('noreply@lamora.it'));
  assert.equal(r.c.phone, '', 'né il fax né la partita IVA sono telefoni');
  assert.deepEqual(r.facts('fax').map((f) => f.value), ['+39 0759998888']);
  const piva = r.facts('piva')[0];
  assert.equal(piva.value, '01234567890');
  assert.equal(piva.extra.invalid, true, 'cifra di controllo sbagliata: riportata ma da verificare');
  assert.equal(piva.reliability, 'check');
  assert.equal(r.facts('legalName')[0].value, 'La Mora S.r.l.');
  assert.equal(r.people.length, 0, 'il titolare del trattamento non è una persona');
});

test('JSON-LD @graph: organizzazione per riferimento, autore escluso, fondatore incluso', () => {
  const r = analyze({
    url: 'https://www.frantoiosole.it/',
    jsonld: [{
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', '@id': '#site', name: 'Frantoio Sole – Olio extravergine', publisher: { '@id': '#org' } },
        { '@type': 'Organization', '@id': '#org', name: 'Frantoio Sole', url: 'https://www.frantoiosole.it/', founder: { '@id': '#founder' }, address: 'Via Flaminia 22, 06049 Spoleto PG' },
        { '@type': 'Person', '@id': '#founder', givenName: 'Anna', familyName: 'Sole', sameAs: ['https://www.linkedin.com/in/anna-sole'] },
        { '@type': 'Article', headline: 'Raccolta 2025', author: { '@id': '#writer' } },
        { '@type': 'Person', '@id': '#writer', name: 'Paolo Neri' },
      ],
    }],
  });
  assert.equal(r.c.name, 'Frantoio Sole');
  assert.equal(r.facts('address')[0].value, 'Via Flaminia 22, 06049 Spoleto (PG)');
  assert.equal(r.c.city, 'Spoleto');
  assert.equal(r.c.state, 'Umbria');
  assert.equal(r.p.firstname, 'Anna');
  assert.equal(r.p.lastname, 'Sole');
  assert.equal(r.p.jobtitle, 'Fondatore');
  assert.equal(r.p.hs_linkedin_url, 'https://www.linkedin.com/in/anna-sole');
  assert.equal(r.contact.firstname.reliability, 'high');
  assert.equal(r.people.length, 1, "l'autore di un articolo non è un contatto");
});

test('persona in maiuscolo con ruolo sulla riga sotto; il cellulare vicino al nome è suo', () => {
  const r = analyze({
    url: 'https://www.tenutaverde.it/chi-siamo',
    text: { page: 'CHI SIAMO\nMARIA GRAZIA D\'ANGELO\n\nPROPRIETARIA\nCell. 333 1234567' },
  }, 'about');
  assert.equal(r.p.firstname, 'Maria Grazia');
  assert.equal(r.p.lastname, "D'Angelo");
  assert.equal(r.p.jobtitle, 'Proprietaria');
  // V1: un cellulare scritto subito dopo la persona diventa il suo cellulare (prima era solo proposto)
  assert.equal(r.p.mobilephone, '+39 333 123 4567');
  assert.equal(r.contact.mobilephone.method, 'vicino al nome della persona');
  assert.equal(r.contact.mobilephone.reliability, 'check');
  assert.equal(r.p.phone, '');
  assert.equal(r.c.phone, '+39 333 123 4567');
});

test('elenchi di persone: ogni ruolo va al nome giusto, in entrambi gli impaginati', () => {
  const roles = (text) => Object.fromEntries(analyze({ url: 'https://www.team-esempio.it/', text: { page: text } }, 'team')
    .people.map((p) => [`${p.firstName} ${p.lastName}`, p.role]));
  const expected = { 'Maria Bianchi': 'Titolare', 'Luca Verdi': 'Responsabile commerciale' };
  assert.deepEqual(roles('Maria Bianchi – Titolare\nLuca Verdi – Responsabile commerciale'), expected);
  assert.deepEqual(roles('Maria Bianchi\nTitolare\nLuca Verdi\nResponsabile commerciale'), expected);
  assert.deepEqual(roles('Titolare\nMaria Bianchi\nResponsabile commerciale\nLuca Verdi'), expected);
});

test('numero seguito dal CAP e prefisso internazionale nel testo', () => {
  const r = analyze({
    url: 'https://www.olivetobianchi.it/',
    text: { footer: 'Tel. 075 8123456 06081 Assisi (PG)\nChiamaci: +39 075 1111111' },
  });
  assert.equal(r.c.phone, '+39 0758123456');
  assert.ok(r.company.phone.alternatives.includes('+39 0751111111'));
  assert.equal(r.c.city, 'Assisi');
});

test('regione per esteso, città in maiuscolo, regione dal capoluogo', () => {
  const a = analyze({
    url: 'https://www.vinisenesi.it/',
    jsonld: [{ '@type': 'Winery', name: 'Vini Senesi', address: { streetAddress: 'Strada del Chianti 4', postalCode: '53100', addressLocality: 'SIENA', addressRegion: 'Toscana' } }],
  });
  assert.equal(a.c.city, 'Siena');
  assert.equal(a.c.state, 'Toscana');
  assert.equal(a.company.state.method, 'dati strutturati JSON-LD');

  const b = analyze({ url: 'https://www.bottegasiena.it/', text: { footer: 'Bottega · Via di Città 1, 53100 Siena' } });
  assert.equal(b.facts('address')[0].value, 'Via di Città 1, 53100 Siena');
  assert.equal(b.c.state, 'Toscana');
  assert.equal(b.company.state.method, 'dedotta dalla città (capoluogo di provincia)');
  assert.equal(b.company.state.reliability, 'check');
});

test('indirizzo su due righe, meta og:site_name, email offuscata', () => {
  const r = analyze({
    url: 'https://www.casalerosa.it/',
    title: 'Casale Rosa - Ospitalità in Umbria',
    meta: { 'og:site_name': 'Casale Rosa' },
    text: { footer: 'Casale Rosa\nVocabolo Pian di Monte 3\n06019 Umbertide (PG)\ninfo [at] casalerosa [dot] it' },
  });
  assert.equal(r.c.name, 'Casale Rosa');
  assert.equal(r.facts('address')[0].value, 'Vocabolo Pian di Monte 3, 06019 Umbertide (PG)');
  assert.equal(r.c.email_aziendale_principale, 'info@casalerosa.it');
});

test('titolo che non somiglia al dominio: proposto ma da verificare, mai dal titolo di un articolo', () => {
  const r = analyze({ url: 'https://www.xyz123.it/', title: 'Agriturismo Il Poggio | Montefalco' });
  assert.equal(r.c.name, 'Agriturismo Il Poggio');
  assert.equal(r.company.name.reliability, 'check');
  assert.equal(analyze({ url: 'https://www.xyz123.it/blog/vendemmia', title: 'Vendemmia 2025 | Blog' }, 'blog').c.name, '');
  assert.equal(analyze({ url: 'https://www.xyz123.it/privacy', title: 'Informativa privacy' }, 'legal').c.name, '');
});

test('fotografia non valida', () => {
  assert.throws(() => analyzeSnapshot(null), TypeError);
  assert.throws(() => analyzeSnapshot({ url: 'chrome://extensions' }), TypeError);
  assert.throws(() => analyzeSnapshot({}), TypeError);
});

test('JSON-LD non leggibile e testo troncato producono un avviso', () => {
  const r = analyzeSnapshot(snap({ jsonldErrors: 2, text: { page: 'x', truncated: true } }));
  assert.ok(r.notes.some((n) => n.startsWith('2 blocchi')));
  assert.ok(r.notes.some((n) => n.includes('molto lunga')));
});

test('link interni per la scoperta delle pagine: solo stesso dominio', () => {
  const r = analyzeSnapshot(snap({
    url: 'https://www.lamora.it/',
    links: [
      { kind: 'web', href: 'https://www.lamora.it/contatti', text: 'Contatti', zone: 'nav' },
      { kind: 'web', href: 'https://lamora.it/chi-siamo', text: 'Chi siamo', zone: 'footer' },
      { kind: 'web', href: 'https://www.instagram.com/lamora/', text: 'Instagram', zone: 'footer' },
      { kind: 'web', href: 'https://shop.lamora.it/', text: 'Shop', zone: 'nav' },
    ],
  }));
  assert.deepEqual(r.links.map((l) => l.url), ['https://www.lamora.it/contatti', 'https://lamora.it/chi-siamo']);
});
