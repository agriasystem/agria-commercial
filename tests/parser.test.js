import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSnapshot, COMPANY_FIELDS, CONTACT_FIELDS } from '../extension/lib/parser.js';

// fotografia della pagina come la produce content/collector.js
const snap = (over = {}) => ({
  schema: 1,
  url: 'https://www.esempio-prospect.it/',
  title: '',
  meta: {},
  jsonld: [],
  jsonldErrors: 0,
  links: [],
  microdata: [],
  addresses: [],
  ...over,
  text: { header: '', footer: '', page: '', truncated: false, ...over.text },
});
const values = (section) => Object.fromEntries(Object.entries(section).map(([k, f]) => [k, f.value]));

test('JSON-LD LocalBusiness: azienda completa, regione dalla provincia', () => {
  const r = analyzeSnapshot(snap({
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
  }));
  assert.deepEqual(values(r.company), {
    name: 'Agriturismo La Mora',
    website: 'https://www.agriturismolamora.it',
    domain: 'agriturismolamora.it',
    email: 'info@agriturismolamora.it',
    phone: '+39 0758123456',
    address: 'Via delle Querce 14, 06081 Assisi (PG)',
    city: 'Assisi',
    region: 'Umbria',
  });
  assert.equal(r.company.name.source, 'dati strutturati JSON-LD');
  assert.equal(r.company.region.source, 'dedotta dalla provincia (PG)');
  assert.equal(r.company.name.uncertain, false);
  assert.equal(r.page.domain, 'agriturismolamora.it');
});

test('senza dati strutturati: titolo, link, footer e persone dal testo', () => {
  const r = analyzeSnapshot(snap({
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
      footer: '© 2025 Cantina Rossi S.r.l. - P.IVA 09876543210',
      page: [
        'Contatti', 'Cantina Rossi S.r.l.', 'Via Roma, 12', '06034 Foligno (PG)', 'Telefono: 0742 123456',
        'Il nostro team', 'Mario Rossi – Titolare · mario.rossi@cantinarossi.it · LinkedIn',
        'Luca Verdi – Responsabile commerciale · l.verdi@cantinarossi.it',
        '© 2025 Cantina Rossi S.r.l. - P.IVA 09876543210',
      ].join('\n'),
    },
  }));
  assert.equal(r.company.name.value, 'Cantina Rossi');
  assert.equal(r.company.name.source, 'titolo della pagina');
  assert.ok(r.company.name.alternatives.includes('Cantina Rossi S.r.l.'), 'ragione sociale dal copyright come alternativa');
  assert.equal(r.company.email.value, 'info@cantinarossi.it');
  assert.equal(r.company.phone.value, '+39 0742123456');
  assert.equal(r.company.address.value, 'Via Roma, 12, 06034 Foligno (PG)');
  assert.equal(r.company.city.value, 'Foligno');
  assert.equal(r.company.region.value, 'Umbria');
  assert.deepEqual(values(r.contact), {
    firstName: 'Mario', lastName: 'Rossi', role: 'Titolare',
    email: 'mario.rossi@cantinarossi.it', phone: '', linkedin: 'https://www.linkedin.com/in/mario-rossi-vino',
  });
  assert.equal(r.contact.firstName.uncertain, true, 'dal testo: da verificare');
  assert.equal(r.people.length, 1);
  assert.equal(`${r.people[0].firstName} ${r.people[0].lastName}`, 'Luca Verdi');
  assert.equal(r.people[0].role, 'Responsabile commerciale');
  assert.equal(r.people[0].email, 'l.verdi@cantinarossi.it');
});

test('pagina senza dati: nessun valore inventato', () => {
  const r = analyzeSnapshot(snap({
    url: 'https://vuoto-esempio.it/blog/post-1',
    title: 'Benvenuti',
    text: { page: 'Il nostro vino nasce tra le colline.\nScopri la nostra storia e vieni a trovarci.' },
  }));
  for (const k of COMPANY_FIELDS.filter((k) => k !== 'website' && k !== 'domain')) assert.equal(r.company[k].value, '', k);
  for (const k of CONTACT_FIELDS) assert.equal(r.contact[k].value, '', k);
  assert.equal(r.company.domain.value, 'vuoto-esempio.it');
  assert.equal(r.found, 2);
  assert.ok(r.notes.some((n) => n.includes('Nessuna email e nessun telefono')));
  assert.ok(r.notes.some((n) => n.includes('Nessuna persona')));
});

test('falsi positivi: privacy, P.IVA, fax, immagini, PEC, agenzia web, segnaposto', () => {
  const r = analyzeSnapshot(snap({
    url: 'https://www.lamora.it/',
    links: [
      { kind: 'mailto', href: 'mailto:info@webagency.it', text: 'info@webagency.it', zone: 'footer' },
      { kind: 'mailto', href: 'mailto:noreply@lamora.it', text: 'noreply@lamora.it', zone: 'footer' },
    ],
    text: {
      footer: 'La Mora · P.IVA 01234567890 · Fax 075 999 8888\nPEC: lamora@pec.it · amministrazione@lamora.it\nSito realizzato da WebAgency – info@webagency.it',
      page: 'Titolare del trattamento dei dati è La Mora S.r.l.\nlogo@2x.png\nScrivi a nome@example.com\nLa Mora · P.IVA 01234567890 · Fax 075 999 8888\nPEC: lamora@pec.it · amministrazione@lamora.it',
    },
  }));
  assert.equal(r.company.email.value, 'amministrazione@lamora.it');
  assert.ok(!r.company.email.alternatives.includes('nome@example.com'));
  assert.ok(!r.company.email.alternatives.some((e) => e.endsWith('.png')));
  assert.equal(r.company.phone.value, '', 'né il fax né la partita IVA sono telefoni');
  assert.equal(r.contact.firstName.value, '', 'il titolare del trattamento non è una persona');
});

test('JSON-LD @graph: organizzazione per riferimento, autore escluso, fondatore incluso', () => {
  const r = analyzeSnapshot(snap({
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
  }));
  assert.equal(r.company.name.value, 'Frantoio Sole');
  assert.equal(r.company.address.value, 'Via Flaminia 22, 06049 Spoleto (PG)');
  assert.equal(r.company.city.value, 'Spoleto');
  assert.equal(r.company.region.value, 'Umbria');
  assert.deepEqual(values(r.contact), {
    firstName: 'Anna', lastName: 'Sole', role: 'Fondatore', email: '', phone: '', linkedin: 'https://www.linkedin.com/in/anna-sole',
  });
  assert.equal(r.contact.firstName.uncertain, false);
  assert.equal(r.people.length, 0, "l'autore di un articolo non è un contatto");
});

test('persona in maiuscolo con ruolo sulla riga sotto; cellulare formattato', () => {
  const r = analyzeSnapshot(snap({
    url: 'https://www.tenutaverde.it/chi-siamo',
    text: { page: 'CHI SIAMO\nMARIA GRAZIA D\'ANGELO\n\nPROPRIETARIA\nCell. 333 1234567' },
  }));
  assert.equal(r.contact.firstName.value, 'Maria Grazia');
  assert.equal(r.contact.lastName.value, "D'Angelo");
  assert.equal(r.contact.role.value, 'Proprietaria');
  assert.equal(r.company.phone.value, '+39 333 123 4567');
  assert.deepEqual(r.contact.phone.alternatives, ['+39 333 123 4567'], 'il cellulare è proposto, non assegnato');
  assert.equal(r.contact.phone.value, '');
});

test('elenchi di persone: ogni ruolo va al nome giusto, in entrambi gli impaginati', () => {
  const roles = (text) => {
    const r = analyzeSnapshot(snap({ url: 'https://www.team-esempio.it/', text: { page: text } }));
    const all = [{ firstName: r.contact.firstName.value, lastName: r.contact.lastName.value, role: r.contact.role.value }, ...r.people];
    return Object.fromEntries(all.map((p) => [`${p.firstName} ${p.lastName}`, p.role]));
  };
  const expected = { 'Maria Bianchi': 'Titolare', 'Luca Verdi': 'Responsabile commerciale' };
  assert.deepEqual(roles('Maria Bianchi – Titolare\nLuca Verdi – Responsabile commerciale'), expected);
  assert.deepEqual(roles('Maria Bianchi\nTitolare\nLuca Verdi\nResponsabile commerciale'), expected);
  assert.deepEqual(roles('Titolare\nMaria Bianchi\nResponsabile commerciale\nLuca Verdi'), expected);
});

test('numero seguito dal CAP e prefisso internazionale nel testo', () => {
  const r = analyzeSnapshot(snap({
    url: 'https://www.olivetobianchi.it/',
    text: { footer: 'Tel. 075 8123456 06081 Assisi (PG)\nChiamaci: +39 075 1111111' },
  }));
  assert.equal(r.company.phone.value, '+39 0758123456');
  assert.ok(r.company.phone.alternatives.includes('+39 0751111111'));
  assert.equal(r.company.city.value, 'Assisi');
});

test('regione per esteso, città in maiuscolo, regione dal capoluogo', () => {
  const a = analyzeSnapshot(snap({
    url: 'https://www.vinisenesi.it/',
    jsonld: [{ '@type': 'Winery', name: 'Vini Senesi', address: { streetAddress: 'Strada del Chianti 4', postalCode: '53100', addressLocality: 'SIENA', addressRegion: 'Toscana' } }],
  }));
  assert.equal(a.company.city.value, 'Siena');
  assert.equal(a.company.region.value, 'Toscana');
  assert.equal(a.company.region.source, 'dati strutturati JSON-LD');

  const b = analyzeSnapshot(snap({ url: 'https://www.bottegasiena.it/', text: { footer: 'Bottega · Via di Città 1, 53100 Siena' } }));
  assert.equal(b.company.address.value, 'Via di Città 1, 53100 Siena');
  assert.equal(b.company.region.value, 'Toscana');
  assert.equal(b.company.region.source, 'dedotta dalla città (capoluogo di provincia)');
});

test('indirizzo su due righe e meta og:site_name', () => {
  const r = analyzeSnapshot(snap({
    url: 'https://www.casalerosa.it/',
    title: 'Casale Rosa - Ospitalità in Umbria',
    meta: { 'og:site_name': 'Casale Rosa' },
    text: { footer: 'Casale Rosa\nVocabolo Pian di Monte 3\n06019 Umbertide (PG)\ninfo [at] casalerosa [dot] it' },
  }));
  assert.equal(r.company.name.value, 'Casale Rosa');
  assert.equal(r.company.address.value, 'Vocabolo Pian di Monte 3, 06019 Umbertide (PG)');
  assert.equal(r.company.email.value, 'info@casalerosa.it');
});

test('titolo che non somiglia al dominio: proposto ma da verificare', () => {
  const r = analyzeSnapshot(snap({ url: 'https://www.xyz123.it/', title: 'Agriturismo Il Poggio | Montefalco' }));
  assert.equal(r.company.name.value, 'Agriturismo Il Poggio');
  assert.equal(r.company.name.uncertain, true);
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
