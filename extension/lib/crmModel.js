// Modello HubSpot di Agria: proprietà di Azienda e Contatto e proposte di valori a partire dai
// dati del sito. Nessuna chiamata a HubSpot: qui si prepara soltanto ciò che il commerciale
// controlla nel pannello.
//
// Ogni proposta: { value, reliability ('high' | 'check' | ''), method, url, evidence, alternatives }.
// Quando le pagine contengono valori diversi non si sceglie in silenzio: il principale è il più
// affidabile, gli altri restano come alternative.

import { emailCategory } from './parser.js';
import { factsOf, peopleOf } from './siteData.js';
import { normalizePhone } from './validation.js';
import { isProvinceCode, normalizeRegion, provinceFromName, regionFromProvince } from './italy.js';

export const SETTORE_OPTIONS = ['Hospitality', 'Cantina / Vitivinicolo', 'Frantoio / Olivicolo', 'Altro'];
export const TIPO_STRUTTURA_OPTIONS = [
  'Agriturismo', 'Boutique Hotel', 'Relais', 'Masseria', 'Resort indipendente', 'Hotel',
  'Struttura con ristorante', 'Struttura con spa', 'Altro',
];
export const LEAD_STATUS = Object.freeze({ value: 'NEW', label: 'Da contattare' });
export const LEGAL_BASIS = 'Legitimate interest – prospect/lead';

// proprietà nell'ordine del form HubSpot; label = testo mostrato al commerciale
export const COMPANY_PROPS = [
  { name: 'name', label: 'Nome azienda' },
  { name: 'domain', label: 'Dominio', check: 'domain' },
  { name: 'website', label: 'Sito web', check: 'url' },
  { name: 'phone', label: 'Telefono', check: 'phone' },
  { name: 'email_aziendale_principale', label: 'Email aziendale principale', check: 'email' },
  { name: 'email_aziendale_secondaria', label: 'Email aziendale secondaria', check: 'email' },
  { name: 'settore_agria', label: 'Settore Agria', input: 'select', options: SETTORE_OPTIONS },
  { name: 'tipo_struttura_hospitality', label: 'Tipo struttura Hospitality', input: 'select', options: TIPO_STRUTTURA_OPTIONS },
  { name: 'city', label: 'Città', half: true },
  { name: 'state', label: 'Regione', half: true },
  { name: 'country', label: 'Paese' },
  { name: 'linkedin_company_page', label: 'Pagina LinkedIn aziendale', check: 'linkedinCompany' },
  { name: 'hubspot_owner_id', label: 'Proprietario HubSpot', input: 'owner' },
  { name: 'hs_lead_status', label: 'Lead status', input: 'fixed' },
  { name: 'hs_quick_context', label: 'Contesto rapido', input: 'textarea' },
];
export const CONTACT_PROPS = [
  { name: 'firstname', label: 'Nome', half: true },
  { name: 'lastname', label: 'Cognome', half: true },
  { name: 'jobtitle', label: 'Qualifica' },
  { name: 'email', label: 'Email', check: 'email' },
  { name: 'phone', label: 'Telefono', check: 'phone', half: true },
  { name: 'mobilephone', label: 'Cellulare', check: 'phone', half: true },
  { name: 'hs_linkedin_url', label: 'LinkedIn', check: 'linkedinProfile' },
  { name: 'hubspot_owner_id', label: 'Proprietario HubSpot', input: 'owner' },
  { name: 'hs_legal_basis', label: 'Base giuridica', input: 'legalBasis' },
];

const unique = (list) => [...new Set(list.filter(Boolean))];
const MAX_QUICK_CONTEXT = 65000; // limite di un campo testo multiriga HubSpot: 65.536 caratteri
const HIGH_PERSON_METHODS = new Set(['dati strutturati JSON-LD', 'link email', 'link LinkedIn']);

export const emptyProposal = (alternatives = []) => ({ value: '', reliability: '', method: '', url: '', evidence: '', alternatives: unique(alternatives) });

function fromFact(fact, alternatives = []) {
  if (!fact) return emptyProposal(alternatives);
  return {
    value: fact.value,
    reliability: fact.reliability,
    method: fact.best?.method || '',
    url: fact.best?.url || '',
    evidence: fact.best?.evidence || '',
    alternatives: unique(alternatives).filter((a) => a !== fact.value),
  };
}

const fixedValue = (value, method, url = '') => ({ value, reliability: value ? 'high' : '', method: value ? method : '', url, evidence: '', alternatives: [] });

// ---------------------------------------------------------------------------------------------
// settore e tipo di struttura: parole chiave pesate, sempre «da verificare»

const SECTOR_TERMS = {
  Hospitality: ['agriturismo', 'agriturismi', 'hotel', 'albergo', 'relais', 'resort', 'masseria', 'boutique hotel', 'b&b', 'bed and breakfast', 'camere', 'suite', 'soggiorno', 'soggiorni', 'pernottamento', 'ospiti', 'check-in', 'casa vacanze', 'appartamenti', 'ospitalità', 'colazione', 'schema:alloggio', 'schema:hotel', 'schema:resort', 'schema:b&b'],
  'Cantina / Vitivinicolo': ['cantina', 'cantine', 'vino', 'vini', 'vigneto', 'vigneti', 'vendemmia', 'degustazione', 'degustazioni', 'enoteca', 'winery', 'wine', 'docg', 'vitigno', 'vitigni', 'barrique', 'schema:cantina'],
  'Frantoio / Olivicolo': ['frantoio', 'frantoi', 'olio extravergine', 'extravergine', 'extra vergine', 'olio evo', 'olivicolo', 'olivicola', 'oliveto', 'oliveti', 'olive', 'molitura', 'oleificio'],
};
const STRUCTURE_TERMS = [
  ['Boutique Hotel', ['boutique hotel']],
  ['Relais', ['relais']],
  ['Masseria', ['masseria']],
  ['Agriturismo', ['agriturismo', 'agriturismi']],
  ['Resort indipendente', ['resort', 'schema:resort']],
  ['Hotel', ['hotel', 'albergo', 'schema:hotel']],
];
const SERVICE_TERMS = [
  ['Struttura con spa', ['spa', 'centro benessere', 'wellness']],
  ['Struttura con ristorante', ['ristorante', 'restaurant', 'osteria', 'trattoria', 'schema:ristorante']],
];
const MIN_SECTOR_SCORE = 8;
const MIN_TYPE_SCORE = 5;

const termScore = (signals, terms) => terms.reduce((sum, t) => sum + (signals[t] || 0), 0);
// le parole più presenti, senza numeri: il punteggio è pesato e non è un conteggio
const evidenceOf = (signals, terms) => `Parole trovate: ${terms
  .filter((t) => signals[t])
  .sort((a, b) => signals[b] - signals[a])
  .slice(0, 4)
  .map((t) => t.replace(/^schema:/, 'dati strutturati '))
  .join(', ')}`;

export function proposeSector(signals = {}) {
  const [sector, score] = Object.entries(SECTOR_TERMS)
    .map(([name, terms]) => [name, termScore(signals, terms)])
    .sort((a, b) => b[1] - a[1])[0];
  if (score < MIN_SECTOR_SCORE) return emptyProposal();
  return { value: sector, reliability: 'check', method: 'parole chiave del sito', url: '', evidence: evidenceOf(signals, SECTOR_TERMS[sector]), alternatives: [] };
}

export function proposeStructure(signals = {}, names = []) {
  for (const name of names) {
    const lower = name.toLowerCase();
    const hit = STRUCTURE_TERMS.find(([, terms]) => terms.some((t) => !t.startsWith('schema:') && lower.includes(t)));
    if (hit) return { value: hit[0], reliability: 'check', method: 'nome della struttura', url: '', evidence: name, alternatives: [] };
  }
  for (const group of [STRUCTURE_TERMS, SERVICE_TERMS]) {
    const [type, score] = group.map(([t, terms]) => [t, termScore(signals, terms)]).sort((a, b) => b[1] - a[1])[0];
    if (score >= MIN_TYPE_SCORE) {
      const terms = group.find(([t]) => t === type)[1];
      return { value: type, reliability: 'check', method: 'parole chiave del sito', url: '', evidence: evidenceOf(signals, terms), alternatives: [] };
    }
  }
  return emptyProposal();
}

// ---------------------------------------------------------------------------------------------
// luogo

function regionOf(address) {
  const x = address.extra;
  const source = { method: address.best?.method || '', url: address.best?.url || '', evidence: address.best?.evidence || '' };
  if (x.regionText) {
    const region = normalizeRegion(x.regionText);
    if (region) return { value: region, reliability: address.reliability, ...source };
    const code = x.regionText.toUpperCase();
    if (isProvinceCode(code)) return { value: regionFromProvince(code), reliability: 'high', ...source, method: `dedotta dalla provincia (${code})` };
    const byName = provinceFromName(x.regionText);
    if (byName) return { value: regionFromProvince(byName), reliability: 'check', ...source, method: `dedotta dalla provincia di ${x.regionText}` };
    return { value: x.regionText, reliability: address.reliability, ...source }; // regione estera: com'è scritta
  }
  if (x.province) return { value: regionFromProvince(x.province), reliability: 'high', ...source, method: `dedotta dalla provincia (${x.province})` };
  const capital = provinceFromName(x.city);
  if (capital) return { value: regionFromProvince(capital), reliability: 'check', ...source, method: 'dedotta dalla città (capoluogo di provincia)' };
  return null;
}

function countryOf(address, region) {
  const x = address.extra;
  const source = { url: address.best?.url || '', evidence: address.best?.evidence || '' };
  if (x.country) return { value: x.country, reliability: address.reliability, method: address.best?.method || '', ...source };
  if (x.province) return { value: 'Italia', reliability: 'high', method: `dedotto dalla provincia (${x.province})`, ...source };
  if (region && normalizeRegion(region.value)) return { value: 'Italia', reliability: 'check', method: 'dedotto dalla regione', ...source };
  return null;
}

/** Indirizzo principale: la sede operativa conta più della sede legale (spesso è lo studio del commercialista). */
export function addressesOf(site) {
  return factsOf(site, 'address')
    .map((a) => ({ ...a, rank: a.score - (a.extra.legalSeat ? 2 : 0) }))
    .sort((a, b) => b.rank - a.rank);
}

// ---------------------------------------------------------------------------------------------
// Azienda

/**
 * fixed: valori già scelti a mano per le email, per non proporre due volte la stessa email.
 */
export function proposeCompany(site, config, { fixed = {} } = {}) {
  const names = factsOf(site, 'name');
  const legalNames = factsOf(site, 'legalName');
  const phones = factsOf(site, 'phone');
  const people = peopleOf(site);

  const emails = factsOf(site, 'email');
  const personEmails = new Set(people.map((p) => p.email).filter(Boolean));
  const companyEmails = emails.filter((f) => {
    const category = emailCategory(f.value, f.extra);
    return category !== 'pec' && category !== 'system' && !personEmails.has(f.value);
  });
  const allEmails = emails.map((f) => f.value);
  const free = companyEmails.filter((f) => f.value !== fixed.email_aziendale_principale && f.value !== fixed.email_aziendale_secondaria);
  const principal = fixed.email_aziendale_principale ? null : free[0];
  const secondary = free.find((f) => f !== principal) || null;

  const addresses = addressesOf(site);
  const place = addresses[0];
  const region = place ? regionOf(place) : null;
  const country = place ? countryOf(place, region) : null;
  const linkedin = factsOf(site, 'social').filter((f) => f.extra.network === 'LinkedIn');
  const sector = proposeSector(site.signals);

  return {
    name: fromFact(names[0], [...names.slice(1), ...legalNames].map((f) => f.value)),
    domain: fixedValue(site.domain, 'indirizzo del sito', site.origin),
    website: fixedValue(site.origin, 'indirizzo del sito', site.origin),
    phone: fromFact(phones[0], [...phones.slice(1), ...factsOf(site, 'whatsapp')].map((f) => f.value)),
    email_aziendale_principale: fromFact(principal, allEmails),
    email_aziendale_secondaria: fromFact(secondary, allEmails),
    settore_agria: sector,
    tipo_struttura_hospitality: sector.value === 'Hospitality'
      ? proposeStructure(site.signals, names.slice(0, 3).map((f) => f.value))
      : emptyProposal(),
    city: place?.extra.city
      ? { ...fromFact(place), value: place.extra.city, alternatives: unique(addresses.map((a) => a.extra.city)).filter((c) => c !== place.extra.city) }
      : emptyProposal(addresses.map((a) => a.extra.city)),
    state: region ? { ...region, alternatives: [] } : emptyProposal(),
    country: country ? { ...country, alternatives: [] } : emptyProposal(),
    linkedin_company_page: fromFact(linkedin[0], linkedin.slice(1).map((f) => f.value)),
    hubspot_owner_id: fixedValue(config?.hubspot?.ownerId || '', 'Impostazioni'),
    hs_lead_status: fixedValue(LEAD_STATUS.value, 'nuovo prospect'),
    hs_quick_context: emptyProposal(),
  };
}

// ---------------------------------------------------------------------------------------------
// Contatto

function personField(person, field, value) {
  if (!value) return null;
  const from = person.fields[field] || { url: person.sources[0]?.url || '', method: person.sources[0]?.method || '' };
  const reliability = person.reliability === 'high' && HIGH_PERSON_METHODS.has(from.method) ? 'high' : 'check';
  return { value, reliability, method: from.method, url: from.url, evidence: person.sources[0]?.evidence || '' };
}

/**
 * Contatto principale: quello scelto dal commerciale, altrimenti la persona migliore che rispetta
 * la regola (nome + cognome + email, telefono o LinkedIn). Le persone parziali non diventano
 * Contatto in automatico. → { fields, mainKey }
 */
export function proposeContact(site, config, chosenKey = null) {
  const people = peopleOf(site);
  const main = chosenKey ? people.find((p) => p.key === chosenKey) : people.find((p) => p.eligible);
  const personal = factsOf(site, 'email').filter((f) => emailCategory(f.value, f.extra) === 'personal').map((f) => f.value);
  const phones = factsOf(site, 'phone');
  const mobiles = [...phones.filter((f) => f.extra.mobile), ...factsOf(site, 'whatsapp').filter((f) => f.extra.mobile)].map((f) => f.value);
  const landlines = phones.filter((f) => !f.extra.mobile).map((f) => f.value);
  const profiles = factsOf(site, 'linkedinProfile').map((f) => f.value);
  const field = (proposal, alternatives) => ({ ...(proposal || emptyProposal()), alternatives: unique(alternatives).filter((a) => a !== proposal?.value) });

  // il numero WhatsApp non diventa da solo il cellulare: resta tra le alternative, a un clic
  const fields = {
    firstname: field(main && personField(main, 'name', main.firstName), []),
    lastname: field(main && personField(main, 'name', main.lastName), []),
    jobtitle: field(main && personField(main, 'role', main.role), []),
    email: field(main && personField(main, 'email', main.email), personal),
    phone: field(main && personField(main, 'phone', main.phone), landlines),
    mobilephone: field(main && personField(main, 'mobile', main.mobile), [main?.whatsapp, ...mobiles]),
    hs_linkedin_url: field(main && personField(main, 'linkedin', main.linkedin), profiles),
    hubspot_owner_id: fixedValue(config?.hubspot?.ownerId || '', 'Impostazioni'),
    hs_legal_basis: fixedValue(LEGAL_BASIS, 'valore suggerito per i prospect'),
  };
  return { fields, mainKey: main?.key || null };
}

// ---------------------------------------------------------------------------------------------
// Contesto rapido (hs_quick_context): solo dati trovati davvero che non hanno un campo dedicato

/** company/contact: valori attuali del form { proprietà: testo }. */
export function buildQuickContext(site, company = {}, contact = {}) {
  const lines = ['DATI AGGIUNTIVI RILEVATI DAL SITO'];
  const section = (title, items) => {
    if (items.length) lines.push('', `${title}:`, ...items.map((i) => `- ${i}`));
  };
  const usedEmails = new Set([company.email_aziendale_principale, company.email_aziendale_secondaria, contact.email]
    .filter(Boolean).map((e) => e.trim().toLowerCase()));
  const usedPhones = new Set([company.phone, contact.phone, contact.mobilephone].map((p) => normalizePhone(p || '')).filter(Boolean));
  const emails = factsOf(site, 'email');
  const pecs = emails.filter((f) => emailCategory(f.value, f.extra) === 'pec').map((f) => f.value);
  const flag = (f) => (f.extra.invalid ? ' (cifra di controllo non valida: da verificare)' : '');

  section('WhatsApp', factsOf(site, 'whatsapp').map((f) => f.value));
  section('Email aggiuntive', emails
    .filter((f) => !usedEmails.has(f.value) && emailCategory(f.value, f.extra) !== 'pec' && emailCategory(f.value, f.extra) !== 'system')
    .map((f) => f.value));
  section('Telefoni aggiuntivi', [
    ...factsOf(site, 'phone').filter((f) => !usedPhones.has(f.key)).map((f) => f.value),
    ...factsOf(site, 'fax').map((f) => `Fax ${f.value}`),
  ]);

  const corporate = [];
  const first = (kind) => factsOf(site, kind)[0];
  const legal = first('legalName');
  if (legal) corporate.push(`Ragione sociale: ${legal.value}`);
  const piva = first('piva');
  const cf = first('cf');
  if (piva && cf && piva.value === cf.value) corporate.push(`P.IVA e codice fiscale: ${piva.value}${flag(piva)}`);
  else {
    if (piva) corporate.push(`P.IVA: ${piva.value}${flag(piva)}`);
    if (cf) corporate.push(`Codice fiscale: ${cf.value}${flag(cf)}`);
  }
  const rea = first('rea');
  if (rea) corporate.push(`REA: ${rea.value}`);
  const cin = first('cin');
  if (cin) corporate.push(`CIN: ${cin.value}`);
  for (const pec of pecs) corporate.push(`PEC: ${pec}`);
  const sdi = first('sdi');
  if (sdi) corporate.push(`Codice SDI: ${sdi.value}`);
  const seat = factsOf(site, 'address').find((a) => a.extra.legalSeat);
  if (seat) corporate.push(`Sede legale: ${seat.value}`);
  section('Dati societari', corporate);

  section('Persone rilevate', peopleOf(site).map((p) => `${[p.firstName, p.lastName].filter(Boolean).join(' ')}${p.role ? ` — ${p.role}` : ''}${p.lastName ? '' : ' [dato parziale]'}`));
  section('Social aggiuntivi', factsOf(site, 'social')
    .filter((f) => f.value !== company.linkedin_company_page)
    .map((f) => `${f.extra.network}: ${f.value}`));

  const other = [];
  const place = addressesOf(site).find((a) => !a.extra.legalSeat);
  if (place) other.push(`Indirizzo: ${place.value}`);
  const systems = {};
  for (const s of factsOf(site, 'system')) (systems[s.extra.category] ||= []).push(s.value);
  for (const [category, names] of Object.entries(systems)) other.push(`${category}: ${names.join(', ')}`);
  section('Altre informazioni utili', other);

  return lines.length > 1 ? lines.join('\n').slice(0, MAX_QUICK_CONTEXT) : '';
}
