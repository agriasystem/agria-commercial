// Doppioni in HubSpot: corpi delle ricerche e confronto deterministico dei risultati.
// Funzioni pure, nessuna rete: il client (hubspotClient.js) invia le ricerche, qui si decide.
//
// Azienda (vedi companyLevel)
//   - CERTO, blocco assoluto, nessuna conferma possibile:
//       stesso dominio normalizzato (minuscolo, senza protocollo, "www." e barre finali; sottodomini
//       diversi restano diversi); oppure almeno DUE identificatori forti tra email aziendale,
//       telefono normalizzato e sito web coerente col dominio; oppure email, telefono o sito web
//       + stesso nome.
//   - FORTE:    un solo identificatore forte (email, telefono o sito), senza altri segnali.
//   - POSSIBILE: solo il nome: stesso nome nella stessa città, o nome simile nella stessa città.
//   Forte e possibile si mostrano come «possibile duplicato»: il commerciale controlla e conferma.
// Contatto, in quest'ordine: email, telefono, cellulare, LinkedIn. Un contatto trovato non si crea.

import { normalizeDomain, normalizeEmail, normalizeLinkedin, normalizePhone, normKey } from './validation.js';

export const COMPANY_FIELDS = Object.freeze([
  'name', 'domain', 'website', 'city', 'phone', 'email_aziendale_principale', 'email_aziendale_secondaria',
  'hubspot_owner_id', 'hs_lead_status',
]);
export const CONTACT_FIELDS = Object.freeze([
  'firstname', 'lastname', 'email', 'phone', 'mobilephone', 'hs_linkedin_url', 'jobtitle', 'hubspot_owner_id',
]);
export const LEVEL = Object.freeze({ certain: 'certain', strong: 'strong', possible: 'possible' });
const STRONG_LIMIT = 20;
const NAME_LIMIT = 100;
const LEVEL_RANK = { certain: 0, strong: 1, possible: 2 };

// parole che non distinguono un'azienda: forme societarie, tipo di attività, articoli
const GENERIC_NAME_WORDS = new Set([
  'srl', 'srls', 'spa', 'snc', 'sas', 'ss', 'sapa', 'soc', 'societa', 'sociale', 'agricola', 'agricole', 'semplice',
  'azienda', 'az', 'agr', 'ditta', 'cooperativa', 'coop', 'impresa', 'individuale',
  'agriturismo', 'agriturismi', 'cantina', 'cantine', 'tenuta', 'tenute', 'fattoria', 'podere', 'frantoio',
  'oleificio', 'hotel', 'relais', 'resort', 'masseria', 'winery', 'wines', 'vini', 'bb',
  'di', 'del', 'della', 'dello', 'dei', 'degli', 'delle', 'da', 'dal', 'la', 'il', 'lo', 'le', 'gli', 'i', 'e', 'ed',
  'the', 'and',
]);

const uniq = (list) => [...new Set(list.filter(Boolean))];
const words = (name) => String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Parte distintiva del nome: "Perticaia Società Agricola S.r.l." → "perticaia"; "Agriturismo La Mora" → "mora". */
export function companyCore(name) {
  const all = words(name);
  // lettere isolate: sigle societarie scritte con i punti (S.r.l., S.s.)
  const core = all.filter((w) => w.length > 1 && !GENERIC_NAME_WORDS.has(w));
  return (core.length ? core : all).join(' ');
}

/** Il numero in alcune delle forme in cui si scrive a mano: HubSpot confronta il testo, non il numero. */
export function phoneVariants(raw) {
  const compact = normalizePhone(raw);
  if (!compact) return [];
  const out = new Set([compact]);
  const m = compact.match(/^\+(39)(\d+)$/) || compact.match(/^\+(\d{2})(\d+)$/);
  if (!m) return [...out];
  const [, cc, n] = m;
  const national = [n];
  for (const cut of [2, 3, 4]) {
    if (n.length > cut + 3) national.push(`${n.slice(0, cut)} ${n.slice(cut)}`, `${n.slice(0, cut)}-${n.slice(cut)}`);
  }
  if (/^3\d{9}$/.test(n)) national.push(`${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`);
  for (const value of national) {
    for (const prefix of ['', `+${cc} `, `+${cc}`, `00${cc} `, `00${cc}`]) {
      // senza prefisso solo per i numeri italiani: altrove le cifre nazionali sono ambigue
      if (!prefix && cc !== '39') continue;
      out.add(`${prefix}${value}`);
    }
  }
  return [...out];
}

/** Il sito nelle forme più comuni (con e senza protocollo, "www." e barra finale), in minuscolo per l'operatore IN. */
export function websiteVariants(domain) {
  const d = normalizeDomain(domain || '');
  if (!d) return [];
  const out = [];
  for (const host of [d, `www.${d}`]) {
    out.push(host, `${host}/`);
    for (const scheme of ['https://', 'http://']) out.push(`${scheme}${host}`, `${scheme}${host}/`);
  }
  return out;
}

/** Il profilo LinkedIn nelle forme più comuni, in minuscolo come chiede HubSpot per l'operatore IN. */
export function linkedinVariants(raw) {
  const li = normalizeLinkedin(raw);
  if (li?.kind !== 'profile') return [];
  const slug = li.url.split('/in/')[1].toLowerCase();
  const out = [];
  for (const base of ['https://www.linkedin.com', 'https://linkedin.com', 'http://www.linkedin.com', 'https://it.linkedin.com', 'www.linkedin.com', 'linkedin.com']) {
    out.push(`${base}/in/${slug}`, `${base}/in/${slug}/`);
  }
  return out;
}

const searchBody = (filterGroups, { limit, properties, query = '' }) => ({
  filterGroups, ...(query ? { query } : {}), properties: [...properties], limit,
});
const inFilter = (propertyName, values) => ({ filters: [{ propertyName, operator: 'IN', values }] });

/** Dati dell'azienda da cercare, già normalizzati. */
export function companyKeys(company = {}) {
  return {
    domain: normalizeDomain(company.domain || company.website || ''),
    emails: uniq([company.email_aziendale_principale, company.email_aziendale_secondaria].map(normalizeEmail)),
    phone: normalizePhone(company.phone || ''),
    core: companyCore(company.name),
    city: normKey(company.city),
  };
}

/** Prima ricerca: dominio, sito web, email aziendali, telefono (gruppi in OR, al massimo 5). null se non c'è niente da cercare. */
export function strongCompanySearch(company) {
  const k = companyKeys(company);
  const groups = [];
  if (k.domain) groups.push(inFilter('domain', [k.domain, `www.${k.domain}`]), inFilter('website', websiteVariants(k.domain)));
  if (k.emails.length) groups.push(inFilter('email_aziendale_principale', k.emails), inFilter('email_aziendale_secondaria', k.emails));
  if (k.phone) groups.push(inFilter('phone', phoneVariants(k.phone)));
  return groups.length ? searchBody(groups, { limit: STRONG_LIMIT, properties: COMPANY_FIELDS }) : null;
}

/** Seconda ricerca: il nome (la parola più distintiva), il resto si confronta qui. null senza nome. */
export function nameCompanySearch(company) {
  const core = companyCore(company?.name);
  if (!core) return null;
  const query = core.split(' ').sort((a, b) => b.length - a.length)[0];
  return searchBody([], { limit: NAME_LIMIT, properties: COMPANY_FIELDS, query });
}

/** Un record HubSpot → dati essenziali mostrati al commerciale (nessun altro campo). */
export function companySummary(record, extra = {}) {
  const p = record?.properties || {};
  return {
    id: String(record?.id ?? ''),
    name: String(p.name ?? ''),
    domain: String(p.domain ?? ''),
    city: String(p.city ?? ''),
    ownerId: String(p.hubspot_owner_id ?? ''),
    leadStatus: String(p.hs_lead_status ?? ''),
    url: safeRecordUrl(record?.url, record?.id),
    ...extra,
  };
}

export function contactSummary(record, extra = {}) {
  const p = record?.properties || {};
  return {
    id: String(record?.id ?? ''),
    name: [p.firstname, p.lastname].filter(Boolean).join(' '),
    email: String(p.email ?? ''),
    phone: String(p.phone ?? ''),
    mobile: String(p.mobilephone ?? ''),
    linkedin: String(p.hs_linkedin_url ?? ''),
    jobtitle: String(p.jobtitle ?? ''),
    ownerId: String(p.hubspot_owner_id ?? ''),
    url: safeRecordUrl(record?.url, record?.id),
    ...extra,
  };
}

/**
 * Link al record solo se arriva da HubSpot nella risposta (campo "url") e punta davvero a quel record
 * su un dominio hubspot.com: nessun URL costruito a mano.
 */
export function safeRecordUrl(url, id) {
  if (typeof url !== 'string' || !id) return '';
  try {
    const u = new URL(url);
    const ok = u.protocol === 'https:' && /(^|\.)hubspot\.com$/i.test(u.hostname) && u.pathname.split('/').includes(String(id));
    return ok ? u.href : '';
  } catch {
    return '';
  }
}

// nome simile ma non conclusivo: le parole distintive dell'uno tutte nell'altro (almeno 5 lettere)
function similarName(a, b) {
  if (!a || !b || a === b) return false;
  const [small, big] = a.length <= b.length ? [a, b] : [b, a];
  const bigWords = new Set(big.split(' '));
  return small.replace(/ /g, '').length >= 5 && small.split(' ').every((w) => bigWords.has(w));
}

/**
 * Gravità di un record trovato, dai motivi della corrispondenza → 'certain' | 'strong' | 'possible' | ''.
 *   certain: dominio; oppure due identificatori forti (email, telefono, sito web); oppure email,
 *            telefono o sito web + nome fortemente coerente (stessa parte distintiva, anche in un'altra città)
 *   strong:  un solo identificatore forte
 *   possible: solo il nome (stesso nome e città, o nome simile nella stessa città)
 */
export function companyLevel(reasons) {
  const has = (r) => reasons.includes(r);
  const identifiers = ['email', 'phone', 'website'].filter(has).length;
  const sameName = has('name') || has('name_city');
  if (has('domain') || identifiers >= 2 || (identifiers >= 1 && sameName)) return LEVEL.certain;
  if (identifiers === 1) return LEVEL.strong;
  if (has('name_city') || has('name_similar')) return LEVEL.possible;
  return '';
}

/**
 * Risultati delle ricerche → { outcome: 'none' | 'possible' | 'certain', matches }.
 * Ogni record è confrontato di nuovo qui: la ricerca di HubSpot serve solo a trovare i candidati.
 */
export function classifyCompanies(company, records) {
  const k = companyKeys(company);
  const byId = new Map();
  for (const record of records) {
    const p = record?.properties || {};
    const reasons = [];
    if (k.domain && normalizeDomain(p.domain || '') === k.domain) reasons.push('domain');
    else if (k.domain && normalizeDomain(p.website || '') === k.domain) reasons.push('website');
    const theirEmails = [p.email_aziendale_principale, p.email_aziendale_secondaria].map(normalizeEmail);
    if (k.emails.some((e) => theirEmails.includes(e))) reasons.push('email');
    if (k.phone && normalizePhone(p.phone || '') === k.phone) reasons.push('phone');
    const core = companyCore(p.name);
    const theirCity = normKey(p.city);
    if (k.core && core === k.core) reasons.push(!k.city || !theirCity || theirCity === k.city ? 'name_city' : 'name');
    else if (k.city && theirCity === k.city && similarName(k.core, core)) reasons.push('name_similar');
    const level = companyLevel(reasons);
    if (!level || !record?.id) continue;
    const current = byId.get(String(record.id));
    if (!current || LEVEL_RANK[level] < LEVEL_RANK[current.level]) byId.set(String(record.id), companySummary(record, { level, reasons }));
  }
  const matches = [...byId.values()].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.id.localeCompare(b.id));
  const outcome = matches.some((m) => m.level === LEVEL.certain) ? 'certain' : matches.length ? 'possible' : 'none';
  return { outcome, matches };
}

/** Dati del contatto da cercare, già normalizzati. */
export function contactKeys(contact = {}) {
  return {
    email: normalizeEmail(contact.email || ''),
    phones: uniq([contact.phone, contact.mobilephone].map((p) => normalizePhone(p || ''))),
    linkedin: normalizeLinkedin(contact.hs_linkedin_url || '')?.kind === 'profile' ? normalizeLinkedin(contact.hs_linkedin_url).url.toLowerCase() : '',
  };
}

/** Una sola ricerca, gruppi in OR: email, telefono, cellulare, LinkedIn. null se non c'è niente da cercare. */
export function contactSearch(contact) {
  const k = contactKeys(contact);
  const numbers = uniq(k.phones.flatMap(phoneVariants));
  const groups = [];
  if (k.email) groups.push({ filters: [{ propertyName: 'email', operator: 'EQ', value: k.email }] });
  if (numbers.length) groups.push(inFilter('phone', numbers), inFilter('mobilephone', numbers));
  if (k.linkedin) groups.push(inFilter('hs_linkedin_url', linkedinVariants(k.linkedin)));
  return groups.length ? searchBody(groups, { limit: STRONG_LIMIT, properties: CONTACT_FIELDS }) : null;
}

const CONTACT_REASONS = ['email', 'phone', 'mobilephone', 'linkedin'];

/** Contatti trovati → { outcome: 'none' | 'exists', matches } con il motivo (il primo, nell'ordine stabilito). */
export function classifyContacts(contact, records) {
  const k = contactKeys(contact);
  const matches = [];
  for (const record of records) {
    const p = record?.properties || {};
    const reasons = [];
    if (k.email && normalizeEmail(p.email || '') === k.email) reasons.push('email');
    if (k.phones.includes(normalizePhone(p.phone || ''))) reasons.push('phone');
    if (k.phones.includes(normalizePhone(p.mobilephone || ''))) reasons.push('mobilephone');
    const theirs = normalizeLinkedin(p.hs_linkedin_url || '');
    if (k.linkedin && theirs?.kind === 'profile' && theirs.url.toLowerCase() === k.linkedin) reasons.push('linkedin');
    if (reasons.length && record?.id) matches.push(contactSummary(record, { reasons }));
  }
  matches.sort((a, b) => CONTACT_REASONS.indexOf(a.reasons[0]) - CONTACT_REASONS.indexOf(b.reasons[0]) || a.id.localeCompare(b.id));
  return { outcome: matches.length ? 'exists' : 'none', matches };
}

export const REASON_LABELS = Object.freeze({
  domain: 'stesso dominio', website: 'stesso sito web', email: 'stessa email', phone: 'stesso telefono',
  mobilephone: 'stesso cellulare', linkedin: 'stesso profilo LinkedIn', name_city: 'stesso nome e città',
  name: 'stesso nome', name_similar: 'nome simile, stessa città',
});

