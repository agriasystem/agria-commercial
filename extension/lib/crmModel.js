// Modello HubSpot di Agria: proprietà di Azienda e Contatto e proposte di valori a partire dai
// dati del sito. Nessuna chiamata a HubSpot: qui si prepara soltanto ciò che il commerciale
// controlla nel pannello.
//
// Ogni proposta: { value, reliability ('high' | 'check' | ''), method, url, evidence, alternatives }.
// Quando le pagine contengono valori diversi non si sceglie in silenzio: il principale è il più
// affidabile, gli altri restano come alternative.

import { COMMON_WORDS, emailCategory, METHOD } from './parser.js';
import { factsOf, isContactEligible, peopleOf } from './siteData.js';
import { normalizeEmail, normalizePhone, normKey, sameSite } from './validation.js';
import { comuneFromCap, isProvinceCode, normalizeCountry, normalizeRegion, provinceFromName, regionFromProvince } from './italy.js';

export const SETTORE_OPTIONS = ['Hospitality', 'Cantina / Vitivinicolo', 'Frantoio / Olivicolo', 'Altro'];
export const TIPO_STRUTTURA_OPTIONS = [
  'Agriturismo', 'Boutique Hotel', 'Relais', 'Masseria', 'Resort indipendente', 'Hotel',
  'Struttura con ristorante', 'Struttura con spa', 'Altro',
];
export const LEAD_STATUS = Object.freeze({ value: 'NEW', label: 'Da contattare' });
// etichette del portale Agria per hs_lead_status: solo per mostrarle, i valori API restano quelli
export const LEAD_STATUS_LABELS = Object.freeze({
  NEW: 'Da contattare',
  ATTEMPTED_TO_CONTACT: 'Primo contatto inviato',
  CONNECTED: 'In contatto',
  OPEN_DEAL: 'Opportunità aperta',
  BAD_TIMING: 'Da ricontattare',
  UNQUALIFIED: 'Non da lavorare',
});
/** "ATTEMPTED_TO_CONTACT" → "Primo contatto inviato"; un valore sconosciuto resta com'è. */
export const leadStatusLabel = (value) => LEAD_STATUS_LABELS[value] || String(value || '');
export const LEGAL_BASIS = 'Legitimate interest – prospect/lead';
// proprietà di Outreach nel portale Agria (internal name esatti): Azienda e Contatto hanno nomi diversi
export const COMPANY_FIRST_EMAIL = 'data_del_primo_invio_email';
export const CONTACT_FIRST_EMAIL = 'data_primo_invio_email_al_contatto';
export const OUTREACH_LABELS = Object.freeze({
  [COMPANY_FIRST_EMAIL]: 'Data del primo invio email',
  [CONTACT_FIRST_EMAIL]: 'Data primo invio email al contatto',
});

// proprietà nell'ordine del form HubSpot; label = testo mostrato al commerciale;
// visibleIf = il campo si mostra solo quando gli altri campi hanno questi valori;
// input 'owner' = hubspot_owner_id: viene solo dal commerciale attivo, non si propone né si salva nella bozza
export const COMPANY_PROPS = [
  { name: 'name', label: 'Nome azienda' },
  { name: 'domain', label: 'Dominio', check: 'domain' },
  { name: 'website', label: 'Sito web', check: 'url' },
  { name: 'phone', label: 'Telefono', check: 'phone' },
  { name: 'email_aziendale_principale', label: 'Email aziendale principale', check: 'email' },
  { name: 'email_aziendale_secondaria', label: 'Email aziendale secondaria', check: 'email' },
  { name: 'settore_agria', label: 'Settore Agria', input: 'select', options: SETTORE_OPTIONS },
  { name: 'tipo_struttura_hospitality', label: 'Tipo struttura Hospitality', input: 'select', options: TIPO_STRUTTURA_OPTIONS, visibleIf: { settore_agria: 'Hospitality' } },
  { name: 'city', label: 'Città', half: true },
  { name: 'state', label: 'Regione', half: true },
  // solo per i prospect esteri (isItalianProspect): per un italiano bastano città e regione
  { name: 'country', label: 'Paese', visibleIf: (values) => !isItalianProspect(values) },
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

/** Il campo va mostrato? (values: valori attuali del form { proprietà: testo }) */
export function isPropVisible(prop, values = {}) {
  if (typeof prop.visibleIf === 'function') return prop.visibleIf(values);
  return !prop.visibleIf || Object.entries(prop.visibleIf).every(([name, value]) => values[name] === value);
}

/**
 * Prospect italiano, dai valori del form: paese Italia, oppure regione italiana, oppure (senza paese né
 * regione) dominio .it. Un paese o una regione esteri dicono il contrario. Serve a mostrare il campo
 * Paese solo per i prospect esteri: per un italiano `country` non si mostra e non si scrive (basta la regione).
 */
export function isItalianProspect(values = {}) {
  const country = normalizeCountry(values.country || '');
  if (country) return country === 'Italia';
  const state = String(values.state || '').trim();
  if (state) return Boolean(normalizeRegion(state));
  return /\.it$/i.test(String(values.domain || '').trim());
}

/** Valori del form Contatto → persona, per la regola del Contatto HubSpot. */
export const contactPerson = (values = {}) => {
  const v = (name) => String(values[name] || '').trim();
  return { firstName: v('firstname'), lastName: v('lastname'), email: v('email'), phone: v('phone'), mobile: v('mobilephone'), linkedin: v('hs_linkedin_url') };
};

/** Contatto valido: nome + cognome + almeno uno tra email, telefono e LinkedIn. */
export const isContactReady = (values) => isContactEligible(contactPerson(values));

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

// Servizi PROPRI della struttura (vedi companyData.ownServiceSignals): servono almeno due prove di tipo
// diverso. Con un ristorante (o una spa) davvero suoi il tipo è «Struttura con ristorante» («… con spa»),
// che vince sul generico «Agriturismo»; i tipi specifici (Relais, Masseria, Boutique Hotel…) restano.
// Spa prima del ristorante, come nell'ordine già in uso.
const OWN_SERVICES = [['Struttura con spa', 'spa'], ['Struttura con ristorante', 'ristorante']];
const OWN_PROOFS = {
  titolo: (s) => (s === 'spa' ? '«con spa» nel titolo' : '«con ristorante» nel titolo'),
  sezione: (s) => (s === 'spa' ? 'sezione «Spa» del sito' : 'sezione «Ristorante» del sito'),
  uso: (s) => (s === 'spa' ? 'trattamenti / prenotazione spa' : 'prenotazione del tavolo / orari'),
  schema: () => "dati strutturati dell'azienda",
};
const MIN_OWN_PROOFS = 2;
const OVERRIDDEN_BY_SERVICE = new Set(['Agriturismo']);

function ownService(signals) {
  for (const [type, service] of OWN_SERVICES) {
    const proofs = Object.keys(OWN_PROOFS).filter((p) => signals[`proprio:${service}:${p}`] > 0);
    if (proofs.length >= MIN_OWN_PROOFS) {
      return { value: type, reliability: 'check', method: 'servizi propri della struttura', url: '', evidence: `Prove: ${proofs.map((p) => OWN_PROOFS[p](service)).join(', ')}`, alternatives: [] };
    }
  }
  return null;
}
// almeno una prova che il ristorante è della struttura (per la sola parola «ristorante» nel testo non basta)
const hasOwnProof = (signals, service) => Object.keys(OWN_PROOFS).some((p) => signals[`proprio:${service}:${p}`] > 0);

export function proposeStructure(signals = {}, names = []) {
  const own = ownService(signals);
  const withOwn = (proposal) => (own && OVERRIDDEN_BY_SERVICE.has(proposal.value) ? { ...own, alternatives: [proposal.value] } : proposal);
  for (const name of names) {
    const lower = name.toLowerCase();
    const hit = STRUCTURE_TERMS.find(([, terms]) => terms.some((t) => !t.startsWith('schema:') && lower.includes(t)));
    if (hit) return withOwn({ value: hit[0], reliability: 'check', method: 'nome della struttura', url: '', evidence: name, alternatives: [] });
  }
  const best = (group) => group.map(([t, terms]) => [t, termScore(signals, terms)]).sort((a, b) => b[1] - a[1])[0];
  const [type, score] = best(STRUCTURE_TERMS);
  if (score >= MIN_TYPE_SCORE) {
    const terms = STRUCTURE_TERMS.find(([t]) => t === type)[1];
    return withOwn({ value: type, reliability: 'check', method: 'parole chiave del sito', url: '', evidence: evidenceOf(signals, terms), alternatives: [] });
  }
  if (own) return own;
  // solo parole chiave: la spa come prima; il ristorante solo con almeno una prova che è della struttura
  const services = SERVICE_TERMS.filter(([t]) => t !== 'Struttura con ristorante' || hasOwnProof(signals, 'ristorante'));
  const [service, serviceScore] = best(services);
  if (serviceScore >= MIN_TYPE_SCORE) {
    const terms = SERVICE_TERMS.find(([t]) => t === service)[1];
    return { value: service, reliability: 'check', method: 'parole chiave del sito', url: '', evidence: evidenceOf(signals, terms), alternatives: [] };
  }
  return emptyProposal();
}

/** Tipo di struttura per il settore scelto: solo per l'Hospitality, altrimenti nessun valore. */
export function proposeStructureFor(site, settore) {
  return settore === 'Hospitality'
    // il nome com'era scritto: "Agriturismo" tolto dal nome resta un indizio del tipo di struttura
    ? proposeStructure(site.signals, factsOf(site, 'name').slice(0, 3).map((f) => f.extra.full || f.value))
    : emptyProposal();
}

// ---------------------------------------------------------------------------------------------
// luogo

// La località si completa anche con dati di altre pagine, senza servizi esterni:
// "Via … 06063 Magione" su una pagina, "Magione - 06063 (PG) - ITALY" o "(PG)" su un'altra.
const samePlace = (a, b) => a !== b
  && ((a.extra.cap && a.extra.cap === b.extra.cap) || (normKey(a.extra.city) !== '' && normKey(a.extra.city) === normKey(b.extra.city)));
const sourceOf = (fact) => ({ url: fact.best?.url || '', evidence: fact.best?.evidence || '' });

/**
 * Provincia della località scelta → { code, fact, how } | null. In ordine: l'indirizzo stesso; un altro
 * indirizzo della stessa città o con lo stesso CAP; "Città (PR)" per la stessa città; l'unica
 * provincia citata da sola nel sito ("(PG)", "Provincia di Perugia"). Con più province diverse: nessuna.
 */
function provinceOf(site, place) {
  if (place.extra.province) return { code: place.extra.province, fact: place, how: '' };
  const byCap = comuneFromCap(place.extra.cap);
  if (byCap) return { code: byCap.province, fact: place, how: `dal CAP ${place.extra.cap}` };
  const other = factsOf(site, 'address').find((a) => a.extra.province && samePlace(a, place));
  if (other) return { code: other.extra.province, fact: other, how: "da un altro indirizzo della stessa località" };
  const mentions = factsOf(site, 'province');
  const only = (list, how) => (list.length && new Set(list.map((f) => f.extra.code)).size === 1 ? { code: list[0].extra.code, fact: list[0], how } : null);
  const city = normKey(place.extra.city);
  return only(mentions.filter((f) => city && normKey(f.extra.city) === city), `indicata accanto a ${place.extra.city}`)
    || only(mentions.filter((f) => !f.extra.city), 'unica provincia indicata nel sito');
}

// Indirizzo italiano: paese Italia, provincia italiana o CAP di un capoluogo. Il paese serve solo a
// queste regole: per un prospect italiano `country` non si propone (vedi proposeCompany).
const isItalianAddress = (x) => normalizeCountry(x.country) === 'Italia' || isProvinceCode(x.province) || Boolean(comuneFromCap(x.cap));

function regionOf(address, site) {
  const x = address.extra;
  const source = { method: address.best?.method || '', url: address.best?.url || '', evidence: address.best?.evidence || '' };
  // `state` è la regione: "Italia" scritto come regione (succede nel JSON-LD) non lo è mai
  if (x.regionText && normalizeCountry(x.regionText) !== 'Italia') {
    const region = normalizeRegion(x.regionText) || x.regionText.split(/[,;–-]+/).map(normalizeRegion).find(Boolean);
    if (region) return { value: region, reliability: address.reliability, ...source };
    const code = x.regionText.toUpperCase();
    if (isProvinceCode(code)) return { value: regionFromProvince(code), reliability: 'high', ...source, method: `dedotta dalla provincia (${code})` };
    const byName = provinceFromName(x.regionText);
    if (byName) return { value: regionFromProvince(byName), reliability: 'check', ...source, method: `dedotta dalla provincia di ${x.regionText}` };
    // regione estera: com'è scritta; per un indirizzo italiano un testo che non è una regione non si usa
    if (!isItalianAddress(x)) return { value: x.regionText, reliability: address.reliability, ...source };
  }
  const province = provinceOf(site, address);
  if (province) {
    const from = province.fact;
    return {
      value: regionFromProvince(province.code), reliability: from.kind === 'address' ? 'high' : 'check',
      method: `dedotta dalla provincia (${province.code})${province.how ? `, ${province.how}` : ''}`,
      url: from.best?.url || source.url, evidence: from.best?.evidence || source.evidence,
    };
  }
  const capital = provinceFromName(x.city);
  if (capital) return { value: regionFromProvince(capital), reliability: 'check', ...source, method: 'dedotta dalla città (capoluogo di provincia)' };
  return null;
}

/**
 * Comune dell'indirizzo. Quello scritto, salvo un CAP di capoluogo coerente con la provincia: allora il
 * comune è quello del CAP e il nome scritto è una località ("Loc. Pieve Pagliaccia Bosco 06134 (PG)" →
 * Perugia). Mai dalla sola sigla della provincia: "(PG)" non dice in quale comune si trova l'azienda.
 */
function cityOf(address) {
  const x = address.extra;
  const byCap = comuneFromCap(x.cap, x.province);
  if (byCap && normKey(byCap.comune) !== normKey(x.city)) {
    const written = x.city || x.locality;
    return {
      ...fromFact(address), value: byCap.comune, reliability: x.province ? 'high' : 'check',
      method: `comune dal CAP ${x.cap}${x.province ? ` (${x.province})` : ''}${written ? `; località indicata: ${written}` : ''}`,
    };
  }
  return x.city ? { ...fromFact(address), value: x.city } : null;
}

function countryOf(address, region, site) {
  const x = address.extra;
  const source = sourceOf(address);
  if (x.country) return { value: normalizeCountry(x.country), reliability: address.reliability, method: address.best?.method || '', ...source };
  const other = factsOf(site, 'address').find((a) => a.extra.country && samePlace(a, address));
  if (other) return { value: normalizeCountry(other.extra.country), reliability: other.reliability, method: "da un altro indirizzo della stessa località", ...sourceOf(other) };
  const province = provinceOf(site, address);
  if (province) return { value: 'Italia', reliability: province.fact.kind === 'address' ? 'high' : 'check', method: `dedotto dalla provincia (${province.code})`, ...sourceOf(province.fact) };
  if (region && normalizeRegion(region.value)) return { value: 'Italia', reliability: 'check', method: 'dedotto dalla regione', ...source };
  const mention = factsOf(site, 'country')[0]; // "ITALY" scritto da solo, per esempio nel footer
  if (mention) return { value: normalizeCountry(mention.value), reliability: 'check', method: 'indicato nel sito', ...sourceOf(mention) };
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
 * fixed: valori già scelti a mano (email, per non proporre due volte la stessa; settore, per il tipo
 * di struttura). La ragione sociale resta tra i dati rilevati: non è proposta per HubSpot.
 * Nessuna proposta per hubspot_owner_id: è il commerciale attivo (vedi draft.crmRecords).
 */
export function proposeCompany(site, { fixed = {} } = {}) {
  const names = factsOf(site, 'name');
  const phones = factsOf(site, 'phone');
  const people = peopleOf(site);

  const emails = factsOf(site, 'email');
  const personEmails = new Set(people.map((p) => p.email).filter(Boolean));
  // caselle dell'azienda: niente PEC, indirizzi di sistema, email delle persone, caselle dell'hosting
  const candidates = emails.filter((f) => {
    const category = emailCategory(f.value, f.extra);
    return category !== 'pec' && category !== 'system' && !personEmails.has(f.value) && !isHostingEmail(f.value);
  });
  const allEmails = emails.map((f) => f.value);
  const free = candidates.filter((f) => f.value !== fixed.email_aziendale_principale && f.value !== fixed.email_aziendale_secondaria);
  const principal = fixed.email_aziendale_principale ? null : free[0];
  const secondary = free.find((f) => f !== principal) || null;

  const addresses = addressesOf(site);
  const place = addresses[0];
  const city = place ? cityOf(place) : null;
  const cities = unique(addresses.map((a) => cityOf(a)?.value));
  const region = place ? regionOf(place, site) : null;
  const country = place ? countryOf(place, region, site) : null;
  const linkedin = factsOf(site, 'social').filter((f) => f.extra.network === 'LinkedIn');
  const sector = proposeSector(site.signals);

  return {
    name: fromFact(names[0], names.slice(1).map((f) => f.value)),
    domain: fixedValue(site.domain, 'indirizzo del sito', site.origin),
    website: fixedValue(site.origin, 'indirizzo del sito', site.origin),
    phone: fromFact(phones[0], [...phones.slice(1), ...factsOf(site, 'whatsapp')].map((f) => f.value)),
    email_aziendale_principale: fromFact(principal, allEmails),
    email_aziendale_secondaria: fromFact(secondary, allEmails),
    settore_agria: sector,
    tipo_struttura_hospitality: proposeStructureFor(site, fixed.settore_agria ?? sector.value),
    city: city
      ? { ...city, alternatives: cities.filter((c) => c !== city.value) }
      : emptyProposal(cities),
    state: region ? { ...region, alternatives: [] } : emptyProposal(),
    // prospect italiano: il paese non si scrive in HubSpot (basta la regione); un paese estero sì
    country: country && country.value !== 'Italia' ? { ...country, alternatives: [] } : emptyProposal(),
    linkedin_company_page: fromFact(linkedin[0], linkedin.slice(1).map((f) => f.value)),
    hs_lead_status: fixedValue(LEAD_STATUS.value, 'nuovo prospect'),
    hs_quick_context: emptyProposal(),
  };
}

// ---------------------------------------------------------------------------------------------
// Email aziendali per il primo contatto (Outreach): una fonte strutturata, calcolata dalla bozza di
// Scout (tutte le email trovate dal sito, più principale e secondaria del form). Nessuna lettura del
// Contesto rapido. Ogni indirizzo ha il suo esito: utilizzabile come destinatario o escluso, col motivo.

export const EMAIL_EXCLUSION = Object.freeze({
  pec: 'PEC',
  privacy: 'privacy / protezione dati',
  noreply: 'indirizzo automatico',
  technical: 'indirizzo tecnico',
  notCommercial: 'amministrativo, legale o tecnico',
  provider: 'fornitore esterno (sito web, hosting, agenzia)',
  external: "dominio estraneo all'azienda",
});
// domini dei servizi di hosting e dei costruttori di siti: le loro caselle non sono mai del prospect
// (es. info@pietrofl11.sg-host.com, l'indirizzo tecnico di un sito ospitato da SiteGround)
const HOSTING_DOMAINS = /(^|\.)(sg-host\.com|siteground\.(com|it|net|eu)|hostinger\.[a-z.]+|netsons\.(com|it)|register\.it|aruba\.it|staff\.aruba\.it|serverplan\.com|keliweb\.(it|com)|tophost\.it|altervista\.org|ovh\.[a-z.]+|ionos\.[a-z.]+|1and1\.[a-z.]+|godaddy\.com|secureserver\.net|bluehost\.com|hostgator\.com|dreamhost\.com|namecheap\.com|wpengine\.com|kinsta\.(com|cloud)|cloudways\.com|amazonaws\.com|herokuapp\.com|netlify\.app|vercel\.app|wixsite\.com|wix\.com|squarespace\.com|webflow\.io|jimdo\.com|myshopify\.com)$/;
/** Casella di un servizio di hosting o di un costruttore di siti (mai un'email dell'azienda). */
export const isHostingEmail = (email) => HOSTING_DOMAINS.test(String(email).toLowerCase().split('@')[1] || '');
// caselle di posta gratuite: dell'azienda solo se il nome della casella richiama il prospect
const FREE_MAIL = /(^|\.)(gmail\.com|googlemail\.com|libero\.it|hotmail\.[a-z.]+|outlook\.[a-z.]+|live\.[a-z.]+|msn\.com|yahoo\.[a-z.]+|ymail\.com|icloud\.com|me\.com|alice\.it|tin\.it|tim\.it|virgilio\.it|tiscali\.it|fastwebnet\.it|email\.it|inwind\.it|iol\.it|katamail\.com|gmx\.[a-z.]+|proton(?:mail)?\.[a-z.]+)$/;
const PRIVACY_LOCAL = /^(privacy|dpo|gdpr|dataprotection|protezionedati)/;
const NOREPLY_LOCAL = /^(no-?reply|do-?not-?reply|mailer-daemon|bounces?)/;
const TECHNICAL_LOCAL = /^(webmaster|postmaster|hostmaster|abuse)/;
// non sono caselle per una proposta commerciale: amministrazione, fatture, legale, personale, tecnica
const NOT_COMMERCIAL = new Set([
  'amministrazione', 'administration', 'admin', 'fatture', 'fatturazione', 'fattura', 'contabilita', 'accounting', 'billing',
  'invoice', 'invoices', 'legale', 'legal', 'ufficiolegale', 'hr', 'risorseumane', 'lavoraconnoi', 'lavora', 'jobs', 'job',
  'careers', 'career', 'cv', 'recruiting', 'newsletter', 'unsubscribe', 'tech', 'it', 'sistemi', 'developer', 'dev', 'sviluppo',
  'hosting', 'server', 'web', 'website',
]);
// l'email compare solo accanto ai crediti del sito: è del fornitore, non dell'azienda
const PROVIDER_CONTEXT = /realizzat[oa]|powered\s+by|design(?:ed)?\s+by|web\s*agency|credits?\b|sviluppat[oa]\s+da|a\s+cura\s+di|hosting|\bseo\b/i;

const hostLabel = (host) => {
  const parts = String(host).split('.');
  return parts.length >= 2 ? parts.at(-2) : parts[0] || '';
};
// parole distintive del prospect (dal dominio e dal nome), per riconoscere le sue caselle
function prospectTokens(domain, name) {
  const words = [...String(hostLabel(domain)).split(/[^a-z0-9]+/i), ...String(name || '').split(/\s+/)].map(normKey);
  return unique(words).filter((w) => w.length >= 4 && !COMMON_WORDS.has(w));
}

/**
 * company: valori del form Azienda ({ name, email_aziendale_principale, email_aziendale_secondaria });
 * edited: proprietà corrette a mano dal commerciale (un indirizzo scelto da lui vale come riconosciuto).
 * → [{ email, role: 'principale' | 'secondaria' | 'altra', usable, reason }] senza doppioni: prima
 * principale e secondaria, poi le altre nell'ordine di Scout.
 * Sempre esclusi: PEC, privacy, indirizzi automatici e tecnici, caselle dell'hosting.
 * La principale (l'email dell'Azienda in HubSpot) è esclusa solo se è del fornitore del sito.
 * Le altre valgono se appartengono davvero al prospect: stesso dominio, casella che richiama il prospect,
 * oppure email di una persona presentata dal sito con un ruolo nell'azienda. Un indirizzo nominativo
 * (carolina@cantina.it) vale come gli altri: la prima email resta all'Azienda, le persone sono in copia.
 * Escluse anche se amministrative/legali/tecniche, del fornitore del sito o di un dominio estraneo.
 * Un indirizzo corretto a mano nel form vale come riconosciuto (restano solo le esclusioni fisse).
 */
export function companyEmails(site, company = {}, { edited = [] } = {}) {
  const facts = factsOf(site, 'email');
  // persone che il sito presenta con un ruolo nell'azienda (non il «titolare del trattamento»)
  const staff = new Set(peopleOf(site).filter((p) => p.role && !NOT_A_BUSINESS_ROLE.test(p.role)).map((p) => normalizeEmail(p.email || '')).filter(Boolean));
  const tokens = prospectTokens(site.domain, company.name);
  const belongs = (local, host) => {
    if (sameSite(host, site.domain)) return true;
    const where = FREE_MAIL.test(host) ? normKey(local) : normKey(hostLabel(host));
    return tokens.some((t) => where.includes(t));
  };
  const exclusion = (email, role) => {
    const [local, host] = email.split('@');
    const fact = facts.find((f) => f.value === email);
    const category = emailCategory(email, fact?.extra || {});
    if (category === 'pec') return 'pec';
    if (PRIVACY_LOCAL.test(local)) return 'privacy';
    if (NOREPLY_LOCAL.test(local)) return 'noreply';
    if (category === 'system' || TECHNICAL_LOCAL.test(local)) return 'technical';
    if (HOSTING_DOMAINS.test(host)) return 'provider';
    const field = { principale: 'email_aziendale_principale', secondaria: 'email_aziendale_secondaria' }[role];
    if (field && edited.includes(field)) return ''; // scelto a mano dal commerciale
    // casella che non richiama il prospect, vicino ai crediti del sito: è del fornitore
    const own = belongs(local, host);
    const provider = !own && fact?.sources.some((s) => PROVIDER_CONTEXT.test(s.evidence || ''));
    if (role === 'principale') return provider ? 'provider' : ''; // l'email principale dell'Azienda in HubSpot
    if (local.split(/[._+-]+|\d+/).some((part) => NOT_COMMERCIAL.has(part))) return 'notCommercial';
    if (provider) return 'provider';
    if (own || staff.has(email)) return ''; // del prospect, anche se nominativa
    return 'external';
  };
  const out = [];
  const push = (raw, role) => {
    const email = normalizeEmail(raw || '');
    if (!email || out.some((e) => e.email === email)) return;
    const reason = exclusion(email, role);
    out.push({ email, role, usable: !reason, reason: reason ? EMAIL_EXCLUSION[reason] : '' });
  };
  push(company.email_aziendale_principale, 'principale');
  push(company.email_aziendale_secondaria, 'secondaria');
  for (const f of facts) push(f.value, 'altra');
  return out;
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
export function proposeContact(site, chosenKey = null) {
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
    hs_legal_basis: fixedValue(LEGAL_BASIS, 'valore suggerito per i prospect'),
  };
  return { fields, mainKey: main?.key || null };
}

// ---------------------------------------------------------------------------------------------
// Contesto rapido (hs_quick_context): informazioni operative trovate davvero che non hanno un campo
// HubSpot dedicato. Non è una raccolta di dati societari: ragione sociale, codice fiscale, REA, CIN,
// SDI e sede legale restano solo tra i dati rilevati; della parte legale entra soltanto la P.IVA.

// sistemi esterni utili al commerciale, in quest'ordine (CMS e strumenti privacy no)
const COMMERCIAL_SYSTEMS = ['Booking engine', 'Portale', 'Prenotazione ristorante', 'E-commerce'];

// ---------------------------------------------------------------------------------------------
// Segnali commerciali: osservazioni verificabili sul sito, mai deduzioni sul ruolo di una persona.
// «Ruolo decisionale» e «Ruolo commerciale» compaiono solo se il ruolo è scritto così nel sito.

const DECISION_ROLE = /\b(titolar[ei]|co-?titolare|contitolare|proprietari[oa]|owner|founder|co-?founder|fondat(?:ore|rice)|ceo|direttor[ei]|direttrice|general\s+manager|managing\s+director|amministrat(?:ore|rice))\b/i;
const COMMERCIAL_ROLE = /\b(export|vendit[ae]|sales|commercial[ei]|booking|prenotazion[ei]|reservations?)\b/i;
const NOT_A_BUSINESS_ROLE = /trattamento|protezione\s+dei\s+dati|privacy/i; // "Titolare del trattamento" non è il titolare dell'azienda

// peso interno, solo per ordinare le persone: non si mostra e non diventa una probabilità
const SIGNAL_WEIGHT = { decisionRole: 100, commercialRole: 60, companyPhone: 40, companyEmail: 30, whatsapp: 20, companyEmail2: 0, multiPage: 10 };

/**
 * Segnali di una persona rispetto ai dati dell'azienda (company: valori del form Azienda).
 * → [{ type, label, short }] nell'ordine d'importanza; short = forma breve per il Contesto rapido.
 */
export function commercialSignals(person, company = {}, site = null) {
  const signals = [];
  const role = String(person.role || '');
  if (role && !NOT_A_BUSINESS_ROLE.test(role)) {
    if (DECISION_ROLE.test(role)) signals.push({ type: 'decisionRole', label: `Ruolo decisionale esplicito: ${role}`, short: 'Ruolo decisionale esplicito' });
    if (COMMERCIAL_ROLE.test(role)) signals.push({ type: 'commercialRole', label: `Ruolo commerciale esplicito: ${role}`, short: 'Ruolo commerciale esplicito' });
  }
  const numbers = new Set([person.phone, person.mobile, person.whatsapp].map((n) => normalizePhone(n || '')).filter(Boolean));
  const companyPhone = normalizePhone(company.phone || '');
  if (companyPhone && numbers.has(companyPhone)) {
    signals.push({ type: 'companyPhone', label: "Numero coincidente con il telefono principale dell'azienda", short: "Numero coincidente con il telefono principale dell'azienda" });
  }
  const whatsapp = site ? factsOf(site, 'whatsapp').map((f) => normalizePhone(f.value)) : [];
  if (whatsapp.some((n) => numbers.has(n))) signals.push({ type: 'whatsapp', label: 'Numero coincidente con il WhatsApp aziendale', short: 'Numero coincidente con il WhatsApp aziendale' });
  const email = normalizeEmail(person.email || '');
  if (email && email === normalizeEmail(company.email_aziendale_principale || '')) {
    signals.push({ type: 'companyEmail', label: "Email coincidente con l'email principale dell'azienda", short: "Email coincidente con l'email principale dell'azienda" });
  }
  if (email && email === normalizeEmail(company.email_aziendale_secondaria || '')) {
    signals.push({ type: 'companyEmail2', label: "Email coincidente con l'email secondaria dell'azienda", short: "Email coincidente con l'email secondaria dell'azienda" });
  }
  // pagine indipendenti: il footer ripetuto su ogni pagina non conta
  const pages = new Set((person.sources || []).filter((s) => s.method !== METHOD.footer && s.method !== METHOD.header).map((s) => s.url));
  if (pages.size >= 2) signals.push({ type: 'multiPage', label: 'Persona citata in più sezioni del sito', short: 'Persona citata in più sezioni del sito' });
  return signals;
}

/**
 * Persone in ordine di rilevanza commerciale, ciascuna con i suoi commercialSignals. Cambia solo
 * l'ordine (e il «Contatto suggerito»): i dati delle persone e il Contatto scelto restano quelli.
 */
export function rankPeople(site, company = {}) {
  const ranked = peopleOf(site).map((p, i) => {
    const signals = commercialSignals(p, company, site);
    const weight = signals.reduce((n, s) => n + SIGNAL_WEIGHT[s.type], 0);
    return { person: { ...p, commercialSignals: signals }, weight, i };
  });
  return ranked.sort((a, b) => b.weight - a.weight || a.i - b.i).map((r) => r.person);
}

/** La prima persona utilizzabile come Contatto, nell'ordine di rilevanza: solo un suggerimento. */
export const suggestedContact = (ranked) => ranked.find((p) => p.eligible)?.key || null;

/** "Paolo — Host (cognome non trovato)", "Mario Rossi — Proprietario" */
export const personLine = (p) => `${[p.firstName, p.lastName].filter(Boolean).join(' ')}${p.role ? ` — ${p.role}` : ''}${p.lastName ? '' : ' (cognome non trovato)'}`;

/** company/contact: valori attuali del form { proprietà: testo }. */
export function buildQuickContext(site, company = {}, contact = {}) {
  const sections = [];
  // bullets: false per i valori singoli (numero WhatsApp, P.IVA), "- " per gli elenchi
  const section = (title, items, { bullets = true } = {}) => {
    const list = unique(items);
    if (list.length) sections.push([title, ...list.map((i) => (bullets ? `- ${i}` : i))].join('\n'));
  };
  const lower = (v) => String(v || '').trim().toLowerCase();
  const usedEmails = new Set([company.email_aziendale_principale, company.email_aziendale_secondaria, contact.email].map(lower).filter(Boolean));
  const usedPhones = new Set([company.phone, contact.phone, contact.mobilephone].map((p) => normalizePhone(p || '')).filter(Boolean));
  const whatsapp = factsOf(site, 'whatsapp');
  const whatsappKeys = new Set(whatsapp.map((f) => f.key));
  const emails = factsOf(site, 'email').map((f) => ({ ...f, category: emailCategory(f.value, f.extra) }));
  const piva = factsOf(site, 'piva')[0];

  section('WHATSAPP', whatsapp.map((f) => f.value), { bullets: false });
  if (piva) section('P.IVA', [`${piva.value}${piva.extra.invalid ? ' (cifra di controllo non valida: da verificare)' : ''}`], { bullets: false });
  section('ULTERIORI EMAIL', emails
    .filter((f) => !usedEmails.has(f.value) && f.category !== 'pec' && f.category !== 'system')
    .map((f) => f.value));
  // né il telefono già nei campi né un numero che è solo il WhatsApp ripetuto
  section('ULTERIORI TELEFONI', factsOf(site, 'phone')
    .filter((f) => !usedPhones.has(f.key) && !whatsappKeys.has(f.key))
    .map((f) => f.value));
  // persone per rilevanza, con i segnali che contano (in breve; niente punteggi né deduzioni)
  section('POTENZIALI CONTATTI', rankPeople(site, company).map((p) => [
    personLine(p), ...p.commercialSignals.filter((s) => s.type !== 'multiPage').map((s) => `  ${s.short}`),
  ].join('\n')));
  section('ALTRI CANALI', [
    ...factsOf(site, 'social').filter((f) => f.value !== company.linkedin_company_page).map((f) => `${f.extra.network}: ${f.value}`),
    ...factsOf(site, 'fax').map((f) => `Fax: ${f.value}`),
    ...emails.filter((f) => f.category === 'pec').map((f) => `PEC: ${f.value}`),
  ]);
  const systems = factsOf(site, 'system').filter((s) => COMMERCIAL_SYSTEMS.includes(s.extra.category));
  section('ALTRE INFORMAZIONI COMMERCIALI UTILI', COMMERCIAL_SYSTEMS
    .map((category) => [category, systems.filter((s) => s.extra.category === category).map((s) => s.value)])
    .filter(([, names]) => names.length)
    .map(([category, names]) => `${category}: ${names.join(', ')}`));

  return sections.join('\n\n').slice(0, MAX_QUICK_CONTEXT);
}
