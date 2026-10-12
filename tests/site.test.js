// Dati accumulati su più pagine e modello HubSpot: deduplica, fonti, persone, dati societari,
// email principale/secondaria, contesto rapido, settore e tipo di struttura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSnapshot } from '../extension/lib/parser.js';
import { addPageFindings, emptySite, factsOf, isContactEligible, peopleOf, summaryOf } from '../extension/lib/siteData.js';
import {
  buildQuickContext, COMPANY_PROPS, CONTACT_PROPS, LEGAL_BASIS, proposeCompany, proposeContact, proposeSector,
  proposeStructure, SETTORE_OPTIONS, TIPO_STRUTTURA_OPTIONS,
} from '../extension/lib/crmModel.js';

const CONFIG = { hubspot: { ownerId: '42', ownerName: 'Commerciale' } };
const ORIGIN = 'https://www.lamora.it';
const page = (path, pageType, { title = '', text = '', footer = '', links = [], jsonld = [], resources = [], headings = [], meta = {} } = {}) => analyzeSnapshot(
  { url: `${ORIGIN}${path}`, title, meta, jsonld, links, resources, headings, text: { header: '', footer, page: [text, footer].filter(Boolean).join('\n') } },
  { pageType },
);
const siteOf = (...pages) => pages.reduce((site, p) => addPageFindings(site, p), emptySite());
const values = (fields) => Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.value]));

const FOOTER = 'Agriturismo La Mora S.r.l. · Via delle Querce 14 · 06081 Assisi (PG) · Tel. 075 812 3456 · info@lamora.it';
const HOME = page('/', 'home', {
  title: 'Agriturismo La Mora | Camere e ristorante ad Assisi',
  text: 'Agriturismo con camere, piscina e ristorante. Soggiorno in agriturismo tra gli ulivi. Colazione con prodotti dell\'agriturismo.',
  footer: FOOTER,
  headings: ['Agriturismo La Mora', 'Le camere'],
  links: [
    { kind: 'mailto', href: 'mailto:INFO@lamora.it', text: 'Scrivici', zone: 'footer' },
    { kind: 'tel', href: 'tel:+390758123456', text: 'Chiama', zone: 'header' },
    { kind: 'whatsapp', href: 'https://wa.me/393331234567', text: 'WhatsApp', zone: 'footer' },
    { kind: 'web', href: 'https://www.instagram.com/lamora.agriturismo/', text: 'Instagram', zone: 'footer' },
    { kind: 'web', href: 'https://www.facebook.com/sharer/sharer.php?u=x', text: 'Condividi', zone: 'page' },
    { kind: 'web', href: 'https://www.facebook.com/agriturismolamora', text: 'Facebook', zone: 'footer' },
    { kind: 'linkedin', href: 'https://www.linkedin.com/company/agriturismo-la-mora/', text: 'LinkedIn', zone: 'footer' },
    { kind: 'web', href: 'https://book.octorate.com/octobook/site/reservation/result.xhtml?codice=1', text: 'Prenota', zone: 'header' },
    { kind: 'web', href: 'https://www.booking.com/hotel/it/la-mora.html', text: 'Booking', zone: 'page' },
  ],
  resources: ['https://www.lamora.it/wp-content/themes/mora/style.css'],
});
const CHI_SIAMO = page('/chi-siamo', 'about', {
  text: 'La famiglia\nMaria Bianchi – Titolare · maria.bianchi@lamora.it\nPaolo – Host\nWhatsApp 347 111 2223\nGiulia Rossi – Chef',
  footer: FOOTER,
});
const CONTATTI = page('/contatti', 'contact', {
  text: 'Contatti\nPrenotazioni: prenotazioni@lamora.it\nTelefono: +39 075 812 3456\nFax 075 812 3457',
  footer: FOOTER,
  links: [{ kind: 'mailto', href: 'mailto:prenotazioni@lamora.it', text: 'prenotazioni@lamora.it', zone: 'page' }],
});
const PRIVACY = page('/privacy', 'legal', {
  text: 'Informativa privacy\nTitolare del trattamento è La Mora Società Agricola S.r.l., con sede legale in Via Roma 1, 06123 Perugia (PG), '
    + 'P.IVA 01234567897, C.F. RSSMRA85T10A562S, REA PG-123456, CIN IT054001C2ABCDEFGH, PEC: lamora@pec.it, Codice SDI: M5UXCR1.',
  footer: FOOTER,
});

test('stessi valori su più pagine: una voce sola, con tutte le fonti', () => {
  const site = siteOf(HOME, CHI_SIAMO, CONTATTI, PRIVACY);
  const info = factsOf(site, 'email').filter((f) => f.value === 'info@lamora.it');
  assert.equal(info.length, 1, 'INFO@ e info@ sono la stessa email');
  assert.equal(new Set(info[0].sources.map((s) => s.url)).size, 4);
  assert.equal(info[0].reliability, 'high');
  const phone = factsOf(site, 'phone').filter((f) => f.key === '+390758123456');
  assert.equal(phone.length, 1, '075 812 3456, +39 075 812 3456 e tel:+390758123456 sono lo stesso numero');
  assert.ok(phone[0].sources.some((s) => s.method === 'link telefono'));
  assert.ok(phone[0].sources.every((s) => s.url && s.method && s.reliability && 'evidence' in s), 'ogni fonte: pagina, metodo, affidabilità, evidenza');
  assert.equal(site.pages.length, 4);
  assert.equal(summaryOf(site), '4 pagine · 4 email · 1 telefono · 2 WhatsApp · 3 persone');
});

test('più email: principale e secondaria proposte, personali e PEC fuori, nessuna persa', () => {
  const site = siteOf(HOME, CHI_SIAMO, CONTATTI, PRIVACY);
  const company = proposeCompany(site, CONFIG);
  assert.equal(company.email_aziendale_principale.value, 'info@lamora.it');
  assert.equal(company.email_aziendale_secondaria.value, 'prenotazioni@lamora.it');
  const all = factsOf(site, 'email').map((f) => f.value);
  assert.deepEqual([...all].sort(), ['info@lamora.it', 'lamora@pec.it', 'maria.bianchi@lamora.it', 'prenotazioni@lamora.it']);
  for (const email of all) {
    const shown = [company.email_aziendale_principale.value, ...company.email_aziendale_principale.alternatives];
    assert.ok(shown.includes(email), `${email} resta selezionabile`);
  }
  // scelta a mano della principale: la secondaria non la ripete
  const fixed = proposeCompany(site, CONFIG, { fixed: { email_aziendale_principale: 'prenotazioni@lamora.it' } });
  assert.equal(fixed.email_aziendale_secondaria.value, 'info@lamora.it');
});

test('più persone, persona parziale, regola del Contatto HubSpot', () => {
  const site = siteOf(HOME, CHI_SIAMO);
  const people = peopleOf(site);
  const byName = Object.fromEntries(people.map((p) => [`${p.firstName} ${p.lastName}`.trim(), p]));
  assert.deepEqual(Object.keys(byName).sort(), ['Giulia Rossi', 'Maria Bianchi', 'Paolo']);
  assert.equal(byName.Paolo.role, 'Host');
  assert.equal(byName.Paolo.lastName, '', 'il cognome non si inventa');
  assert.equal(byName.Paolo.whatsapp, '+39 347 111 2223');
  assert.equal(byName.Paolo.mobile, '', 'scritto come WhatsApp: non diventa anche "cellulare"');
  assert.equal(byName.Paolo.partial, true);
  assert.equal(byName.Paolo.eligible, false, 'senza cognome non diventa Contatto');
  assert.equal(byName['Giulia Rossi'].eligible, false, 'senza recapiti non diventa Contatto');
  assert.equal(byName['Maria Bianchi'].eligible, true);
  assert.ok(byName['Maria Bianchi'].sources[0].evidence.includes('Maria Bianchi'), 'evidenza testuale conservata');
  assert.equal(people[0].firstName, 'Maria', 'prima le persone utilizzabili');

  const { fields, mainKey } = proposeContact(site, CONFIG);
  assert.equal(mainKey, 'mariabianchi');
  assert.deepEqual(values(fields), {
    firstname: 'Maria', lastname: 'Bianchi', jobtitle: 'Titolare', email: 'maria.bianchi@lamora.it',
    phone: '', mobilephone: '', hs_linkedin_url: '', hubspot_owner_id: '42', hs_legal_basis: LEGAL_BASIS,
  });
  // scelta a mano di una persona parziale: il WhatsApp non diventa il cellulare, resta proposto
  const paolo = proposeContact(site, CONFIG, 'paolo').fields;
  assert.equal(paolo.firstname.value, 'Paolo');
  assert.equal(paolo.lastname.value, '');
  assert.equal(paolo.mobilephone.value, '');
  assert.equal(paolo.mobilephone.alternatives[0], '+39 347 111 2223');
  assert.equal(isContactEligible({ firstName: 'A', lastName: 'B', linkedin: 'https://www.linkedin.com/in/ab' }), true);
  assert.equal(isContactEligible({ firstName: 'A', lastName: 'B' }), false);
});

test('persona parziale riconosciuta più avanti con il cognome: diventa una sola persona', () => {
  const team = page('/team', 'team', { text: 'Paolo Neri – Host · paolo.neri@lamora.it' });
  const people = peopleOf(siteOf(CHI_SIAMO, team));
  const paolo = people.filter((p) => p.firstName === 'Paolo');
  assert.equal(paolo.length, 1);
  assert.equal(paolo[0].lastName, 'Neri');
  assert.equal(paolo[0].whatsapp, '+39 347 111 2223', 'i dati della persona parziale si uniscono');
  assert.equal(paolo[0].email, 'paolo.neri@lamora.it');
});

test('dati societari dalle pagine legali', () => {
  const site = siteOf(HOME, PRIVACY);
  const first = (kind) => factsOf(site, kind)[0];
  assert.equal(first('legalName').value, 'La Mora Società Agricola S.r.l.');
  assert.equal(first('legalName').best.url, `${ORIGIN}/privacy`, 'la pagina legale vince sul footer');
  assert.equal(first('piva').value, '01234567897');
  assert.equal(first('piva').reliability, 'high');
  assert.equal(first('cf').value, 'RSSMRA85T10A562S');
  assert.equal(first('rea').value, 'PG-123456');
  assert.equal(first('cin').value, 'IT054001C2ABCDEFGH');
  assert.equal(first('sdi').value, 'M5UXCR1');
  const pec = factsOf(site, 'email').find((f) => f.value === 'lamora@pec.it');
  assert.equal(pec.extra.pec, true);
  const seat = factsOf(site, 'address').find((a) => a.extra.legalSeat);
  assert.equal(seat.value, 'Via Roma 1, 06123 Perugia (PG)');
  const company = proposeCompany(site, CONFIG);
  assert.equal(company.city.value, 'Assisi', 'la città è quella della struttura, non della sede legale');
  assert.equal(company.country.value, 'Italia');
});

test('modello HubSpot: proprietà, opzioni esatte, social, settore e tipo, owner e lead status', () => {
  assert.deepEqual(COMPANY_PROPS.map((p) => p.name), [
    'name', 'domain', 'website', 'phone', 'email_aziendale_principale', 'email_aziendale_secondaria', 'settore_agria',
    'tipo_struttura_hospitality', 'city', 'state', 'country', 'linkedin_company_page', 'hubspot_owner_id', 'hs_lead_status', 'hs_quick_context',
  ]);
  assert.deepEqual(CONTACT_PROPS.map((p) => p.name), [
    'firstname', 'lastname', 'jobtitle', 'email', 'phone', 'mobilephone', 'hs_linkedin_url', 'hubspot_owner_id', 'hs_legal_basis',
  ]);
  assert.equal(CONTACT_PROPS.find((p) => p.name === 'jobtitle').label, 'Qualifica');
  assert.deepEqual(SETTORE_OPTIONS, ['Hospitality', 'Cantina / Vitivinicolo', 'Frantoio / Olivicolo', 'Altro']);
  assert.deepEqual(TIPO_STRUTTURA_OPTIONS, ['Agriturismo', 'Boutique Hotel', 'Relais', 'Masseria', 'Resort indipendente', 'Hotel', 'Struttura con ristorante', 'Struttura con spa', 'Altro']);
  assert.equal(LEGAL_BASIS, 'Legitimate interest – prospect/lead');

  const c = values(proposeCompany(siteOf(HOME, CHI_SIAMO, CONTATTI, PRIVACY), CONFIG));
  assert.equal(c.name, 'Agriturismo La Mora');
  assert.equal(c.domain, 'lamora.it');
  assert.equal(c.website, ORIGIN);
  assert.equal(c.phone, '+39 0758123456');
  assert.equal(c.settore_agria, 'Hospitality');
  assert.equal(c.tipo_struttura_hospitality, 'Agriturismo');
  assert.equal(c.city, 'Assisi');
  assert.equal(c.state, 'Umbria');
  assert.equal(c.country, 'Italia');
  assert.equal(c.linkedin_company_page, 'https://www.linkedin.com/company/agriturismo-la-mora');
  assert.equal(c.hubspot_owner_id, '42', 'dalle Impostazioni, mai dal sito');
  assert.equal(c.hs_lead_status, 'NEW');
  const site = siteOf(HOME);
  assert.deepEqual(factsOf(site, 'social').map((f) => f.extra.network).sort(), ['Facebook', 'Instagram', 'LinkedIn'], 'il pulsante "condividi" non è un profilo');
  assert.deepEqual(factsOf(site, 'system').map((f) => `${f.value} (${f.extra.category})`).sort(), ['Booking.com (Portale)', 'Octorate (Booking engine)', 'WordPress (CMS)']);
});

test('settore e tipo di struttura: proposti dalle parole del sito, mai inventati', () => {
  assert.equal(proposeSector({ cantina: 8, vini: 10, vigneti: 4, camere: 2 }).value, 'Cantina / Vitivinicolo');
  assert.equal(proposeSector({ frantoio: 6, 'olio extravergine': 9 }).value, 'Frantoio / Olivicolo');
  assert.equal(proposeSector({ vino: 2 }).value, '', 'troppo poco per proporre un settore');
  assert.equal(proposeSector({}).reliability, '');
  assert.equal(proposeStructure({}, ['Relais Villa Fiorita']).value, 'Relais');
  assert.equal(proposeStructure({ hotel: 3, 'boutique hotel': 6 }, ['Villa Fiorita']).value, 'Boutique Hotel');
  assert.equal(proposeStructure({ spa: 9, ristorante: 4 }, ['Villa Fiorita']).value, 'Struttura con spa');
  assert.equal(proposeStructure({}, ['Villa Fiorita']).value, '');
  const cantina = proposeCompany(siteOf(page('/', 'home', { title: 'Cantina Rossi', text: 'Cantina e vini. I nostri vini nascono nei vigneti. Degustazione in cantina, vendemmia.' })), CONFIG);
  assert.equal(cantina.settore_agria.value, 'Cantina / Vitivinicolo');
  assert.equal(cantina.settore_agria.reliability, 'check');
  assert.equal(cantina.tipo_struttura_hospitality.value, '', 'il tipo di struttura vale solo per Hospitality');
});

test('contesto rapido: solo dati rilevati senza campo dedicato, nella struttura concordata', () => {
  const site = siteOf(HOME, CHI_SIAMO, CONTATTI, PRIVACY);
  const company = values(proposeCompany(site, CONFIG));
  const contact = values(proposeContact(site, CONFIG).fields);
  const text = buildQuickContext(site, company, contact);
  assert.equal(text, [
    'DATI AGGIUNTIVI RILEVATI DAL SITO',
    '',
    'WhatsApp:',
    '- +39 333 123 4567',
    '- +39 347 111 2223',
    '',
    'Telefoni aggiuntivi:',
    '- Fax +39 0758123457',
    '',
    'Dati societari:',
    '- Ragione sociale: La Mora Società Agricola S.r.l.',
    '- P.IVA: 01234567897',
    '- Codice fiscale: RSSMRA85T10A562S',
    '- REA: PG-123456',
    '- CIN: IT054001C2ABCDEFGH',
    '- PEC: lamora@pec.it',
    '- Codice SDI: M5UXCR1',
    '- Sede legale: Via Roma 1, 06123 Perugia (PG)',
    '',
    'Persone rilevate:',
    '- Maria Bianchi — Titolare',
    '- Paolo — Host [dato parziale]',
    '- Giulia Rossi — Chef',
    '',
    'Social aggiuntivi:',
    '- Instagram: https://www.instagram.com/lamora.agriturismo/',
    '- Facebook: https://www.facebook.com/agriturismolamora',
    '',
    'Altre informazioni utili:',
    '- Indirizzo: Via delle Querce 14, 06081 Assisi (PG)',
    '- Booking engine: Octorate',
    '- Portale: Booking.com',
    '- CMS: WordPress',
  ].join('\n'));
  assert.ok(!text.includes('info@lamora.it') && !text.includes('prenotazioni@'), 'le email già nei campi non si ripetono');
  assert.equal(buildQuickContext(emptySite()), '', 'niente dati, niente contesto');
});
