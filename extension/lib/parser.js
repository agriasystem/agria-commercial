// Estrattore di Agria Scout.
//
// Riceve la "fotografia" della pagina raccolta dal content script (content/collector.js) e
// propone i campi Azienda e Contatto. Regola fissa: ogni valore viene dalla pagina, mai
// inventato. Se un dato non c'è, il campo resta vuoto. Ogni valore porta con sé la fonte e,
// quando è una deduzione debole, il segno «da verificare» (uncertain).
//
// Fonti, dalla più affidabile: dati strutturati (JSON-LD, microdati), link mailto:/tel:,
// meta tag, titolo, testo di footer e intestazione, resto del testo visibile.

import {
  cleanText, domainFromUrl, formatPhone, normalizeEmail, normalizeLinkedin, normalizePhone,
  normalizeUrl, normKey, sameSite,
} from './validation.js';
import { isProvinceCode, normalizeRegion, provinceFromName, regionFromProvince } from './italy.js';

export const COMPANY_FIELDS = ['name', 'website', 'domain', 'email', 'phone', 'address', 'city', 'region'];
export const CONTACT_FIELDS = ['firstName', 'lastName', 'role', 'email', 'phone', 'linkedin'];

const MAX_ALTERNATIVES = 5;
const MAX_PEOPLE = 8;

const SOURCE = {
  url: 'indirizzo della pagina',
  jsonld: 'dati strutturati JSON-LD',
  microdata: 'dati strutturati (microdati)',
  ogSiteName: 'meta tag og:site_name',
  metaBusiness: 'meta tag business',
  appName: 'meta tag application-name',
  title: 'titolo della pagina',
  copyright: 'copyright nel footer',
  mailto: 'link email',
  tel: 'link telefono',
  linkedin: 'link LinkedIn',
  addressTag: 'blocco indirizzo della pagina',
  footer: 'testo del footer',
  header: "testo dell'intestazione",
  page: 'testo della pagina',
  emailName: 'email con il nome della persona',
  linkedinName: 'profilo LinkedIn con il nome della persona',
};

export function emptyField() {
  return { value: '', source: '', uncertain: false, alternatives: [] };
}

/** Da fotografia della pagina a { page, company, contact, people, notes, found }. */
export function analyzeSnapshot(snapshot) {
  if (!isObject(snapshot)) throw new TypeError('Dati della pagina mancanti.');
  const pageUrl = normalizeUrl(str(snapshot.url));
  if (!pageUrl) throw new TypeError('La pagina analizzata non ha un indirizzo web valido.');
  const domain = domainFromUrl(pageUrl);
  const text = isObject(snapshot.text) ? snapshot.text : {};
  const ctx = {
    domain,
    title: str(snapshot.title),
    meta: isObject(snapshot.meta) ? snapshot.meta : {},
    links: asArray(snapshot.links).filter(isObject),
    microdata: asArray(snapshot.microdata).filter(isObject),
    addressBlocks: asArray(snapshot.addresses).filter((s) => typeof s === 'string'),
    text: { header: str(text.header), footer: str(text.footer), page: str(text.page) },
    ld: flattenJsonLd(asArray(snapshot.jsonld)),
  };
  ctx.orgs = rankOrganizations(ctx.ld, domain);

  const emails = collectEmails(ctx);
  const phones = collectPhones(ctx);
  const place = findAddress(ctx);
  const company = {
    name: findCompanyName(ctx),
    website: field(new URL(pageUrl).origin, SOURCE.url),
    domain: field(domain, SOURCE.url),
    email: emails.pool.best(),
    phone: phones.pool.best(),
    address: place.address,
    city: place.city,
    region: place.region,
  };
  const { contact, people } = findPeople(ctx, emails.list, phones.list);
  const found = [...Object.values(company), ...Object.values(contact)].filter((f) => f.value).length;
  return {
    page: { url: pageUrl, title: cleanText(ctx.title, 200), domain },
    company,
    contact,
    people,
    notes: buildNotes(snapshot, company, contact),
    found,
  };
}

// ---------------------------------------------------------------------------------------------
// utilità

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const asArray = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
const str = (x) => (typeof x === 'string' ? x : '');
const unique = (list) => [...new Set(list.filter(Boolean))];
const trimSeparators = (s) => s.replace(/^[\s,;:|•·–—-]+|[\s,;:|•·–—-]+$/gu, '');

function field(value, source, uncertain = false, alternatives = []) {
  const v = cleanText(value);
  const alts = unique(alternatives.map((a) => cleanText(a))).filter((a) => a !== v).slice(0, MAX_ALTERNATIVES);
  return v ? { value: v, source, uncertain, alternatives: alts } : { ...emptyField(), alternatives: alts };
}

// Raccolta di candidati per un campo: vince il punteggio più alto, a parità il primo trovato.
// Lo stesso valore trovato da più fonti guadagna un piccolo bonus.
function makePool() {
  const items = new Map();
  const weight = (item) => item.score + Math.min(item.hits - 1, 2) * 0.5;
  return {
    add(value, score, source, { key, uncertain = false } = {}) {
      const v = cleanText(value);
      if (!v) return;
      const k = key || normKey(v) || v;
      const current = items.get(k);
      if (!current) {
        items.set(k, { value: v, score, source, uncertain, order: items.size, hits: 1 });
        return;
      }
      current.hits += 1;
      if (score > current.score) Object.assign(current, { value: v, score, source, uncertain });
    },
    get size() {
      return items.size;
    },
    best() {
      const ranked = [...items.values()].sort((a, b) => weight(b) - weight(a) || a.order - b.order);
      if (!ranked.length) return emptyField();
      const [top, ...rest] = ranked;
      return field(top.value, top.source, top.uncertain, rest.map((i) => i.value));
    },
  };
}

const LOWER_WORDS = new Set(['di', 'del', 'dello', 'della', 'dei', 'degli', 'delle', 'da', 'dal', 'dalla', 'al', 'in', 'sul', 'sulla', 'e']);

/** Testo tutto maiuscolo (es. per text-transform) → iniziali maiuscole: "D'ANGELO" → "D'Angelo". */
function smartCase(text) {
  if (!text || text !== text.toUpperCase() || !/\p{Lu}{2}/u.test(text)) return text;
  return text
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && LOWER_WORDS.has(w) ? w : w.replace(/(^|['’-])(\p{Ll})/gu, (m, p, c) => p + c.toUpperCase())))
    .join(' ');
}

const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
    const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
  });
}

// ---------------------------------------------------------------------------------------------
// JSON-LD

const ORG_TYPES = new Set([
  'Organization', 'Corporation', 'LocalBusiness', 'Winery', 'Brewery', 'Distillery', 'Restaurant',
  'FoodEstablishment', 'Bakery', 'CafeOrCoffeeShop', 'BarOrPub', 'LodgingBusiness', 'Hotel', 'Motel',
  'Resort', 'BedAndBreakfast', 'Hostel', 'Campground', 'NGO', 'ProfessionalService', 'TravelAgency',
  'EducationalOrganization', 'SportsOrganization', 'MedicalOrganization',
]);
const isOrgType = (t) => ORG_TYPES.has(t) || /(?:Business|Organization|Organisation|Store|Establishment|Agency)$/.test(t);
// organizzazioni citate come autore, sponsor, marchio…: probabilmente non sono il prospect
const ORG_ELSEWHERE = new Set(['author', 'creator', 'contributor', 'sponsor', 'funder', 'brand', 'manufacturer']);
// persone citate come autori di un contenuto: non sono contatti commerciali
const AUTHOR_LINKS = new Set(['author', 'creator', 'editor', 'contributor', 'reviewedBy', 'accountablePerson']);
// persone legate all'azienda
const STAFF_LINKS = new Set(['founder', 'founders', 'employee', 'employees', 'member', 'members', 'contactPoint', 'owner']);

function typesOf(node) {
  return asArray(node['@type'])
    .filter((t) => typeof t === 'string')
    .map((t) => t.replace(/^.*[/#:]/, ''));
}

// Appiattisce i blocchi JSON-LD in nodi tipizzati, risolvendo i riferimenti {"@id": …} e
// ricordando da quale proprietà ogni nodo è stato raggiunto ('' = livello principale).
function flattenJsonLd(roots) {
  const byId = new Map();
  const index = (x, depth) => {
    if (!x || typeof x !== 'object' || depth > 15) return;
    if (Array.isArray(x)) {
      for (const v of x) index(v, depth + 1);
      return;
    }
    if (typeof x['@id'] === 'string' && Object.keys(x).length > 1 && !byId.has(x['@id'])) byId.set(x['@id'], x);
    for (const v of Object.values(x)) index(v, depth + 1);
  };
  index(roots, 0);

  const nodes = new Map();
  const visit = (x, link, depth) => {
    if (!x || typeof x !== 'object' || depth > 15) return;
    if (Array.isArray(x)) {
      for (const v of x) visit(v, link, depth + 1);
      return;
    }
    let node = x;
    if (typeof node['@id'] === 'string' && Object.keys(node).length === 1) {
      node = byId.get(node['@id']);
      if (!node) return;
    }
    const known = nodes.get(node);
    if (known) {
      known.links.add(link);
      return;
    }
    nodes.set(node, { node, types: typesOf(node), links: new Set([link]) });
    for (const [key, value] of Object.entries(node)) {
      if (key !== '@context') visit(value, key === '@graph' ? link : key, depth + 1);
    }
  };
  visit(roots, '', 0);
  return [...nodes.values()].filter((n) => n.types.length);
}

function ldTexts(value) {
  return asArray(value).flatMap((v) => {
    if (typeof v === 'string' || typeof v === 'number') return [decodeEntities(String(v))];
    if (isObject(v) && typeof v['@value'] === 'string') return [decodeEntities(v['@value'])];
    return [];
  });
}
const ldText = (value) => cleanText(ldTexts(value)[0] || '');

function rankOrganizations(nodes, domain) {
  const score = ({ node, types, links }) => {
    let s = 0;
    if (links.has('')) s += 2;
    if ([...links].some((l) => ORG_ELSEWHERE.has(l))) s -= 4;
    if (node.address) s += 2;
    if (node.telephone) s += 1;
    if (node.email) s += 1;
    if (types.some((t) => t !== 'Organization' && isOrgType(t))) s += 1;
    if (sameSite(domainFromUrl(ldText(node.url)), domain)) s += 2;
    return s;
  };
  return nodes
    .filter((n) => n.types.some(isOrgType))
    .map((n) => ({ ...n, score: score(n) }))
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------------------------
// nome dell'azienda

const GENERIC_TITLE = /^(home|home ?page|pagina iniziale|benvenut[io]|welcome|contatti|contattaci|contatto|contacts?|contact us|chi siamo|about|about us|dove siamo|sito ufficiale|official (?:web)?site|news|blog|shop|negozio|privacy policy|cookie policy)$/i;
const WELCOME_PREFIX = /^(?:benvenut[io]|welcome)\s+(?:(?:a|al|all['’]|alla|allo|ai|agli|in|nel|nella|presso|to|at)\s*)?/i;
// parole troppo comuni per collegare un nome al dominio (agriturismo-xyz.it)
const COMMON_WORDS = new Set([
  'agriturismo', 'cantina', 'cantine', 'azienda', 'agricola', 'hotel', 'ristorante', 'tenuta', 'villa',
  'casa', 'podere', 'fattoria', 'frantoio', 'oleificio', 'societa', 'home', 'vini', 'wine', 'winery',
  'resort', 'relais', 'masseria', 'casale', 'borgo', 'osteria', 'trattoria', 'italia', 'italy',
]);

function isPlausibleCompanyName(s) {
  return s.length >= 2 && s.length <= 100 && /\p{L}/u.test(s) && !GENERIC_TITLE.test(s) && !/^https?:/i.test(s);
}

function domainLabel(domain) {
  const parts = domain.split('.');
  if (parts.length >= 3 && /^(co|com|org|net|gov|edu|ac)$/.test(parts.at(-2))) return parts.at(-3);
  return parts.length >= 2 ? parts.at(-2) : parts[0] || '';
}

function matchesDomain(text, label) {
  const k = normKey(text);
  const l = normKey(label);
  if (k.length < 3 || l.length < 3) return false;
  if (l.includes(k) || k.includes(l)) return true;
  return text.split(/\s+/).map(normKey).some((w) => w.length >= 4 && !COMMON_WORDS.has(w) && l.includes(w));
}

function titleSegments(title) {
  return cleanText(title, 300)
    .split(/\s+[|–—•·:»/]\s+|\s+-\s+/)
    .map((s) => cleanText(s.replace(WELCOME_PREFIX, ''), 120))
    .filter(isPlausibleCompanyName);
}

const COPYRIGHT_RE = /(?:copyright\s*(?:©|\(c\))?|©|\(c\)(?=\s*(?:19|20)\d{2}))\s*(?:(?:19|20)\d{2}(?:\s*[-–]\s*(?:19|20)\d{2})?)?\s*[-–,.:]?\s*([^\n]{2,140})/i;
const COPYRIGHT_STOP = /\s[-–|•·]\s|\s*\|\s*|,\s|\b(?:p\.?\s?iva|partita\s+iva|c\.\s?f\.|cod(?:ice)?\.?\s+fiscale|vat|tutti i diritti|all rights|riproduzione|powered by|realizzat[oa] da|designed by|sito (?:web )?realizzato|privacy|cookie)/i;

function copyrightName(text) {
  const m = text.match(COPYRIGHT_RE);
  if (!m) return '';
  let name = m[1].split(COPYRIGHT_STOP)[0];
  name = name.replace(/^(?:(?:19|20)\d{2}\s*[-–]?\s*)+/, '').replace(/[\s,;:–-]+$/, '').trim();
  if (/[a-z]{4,}\.$/i.test(name)) name = name.slice(0, -1);
  return isPlausibleCompanyName(name) && !/^(tutti|all rights)/i.test(name) ? name : '';
}

function findCompanyName(ctx) {
  const pool = makePool();
  const add = (value, score, source, options) => {
    const v = cleanText(value, 120);
    if (isPlausibleCompanyName(v)) pool.add(v, score, source, options);
  };
  ctx.orgs.forEach((org, i) => {
    add(ldText(org.node.name), i === 0 ? 10 : 6, SOURCE.jsonld);
    add(ldText(org.node.legalName), i === 0 ? 7 : 5, SOURCE.jsonld);
  });
  add(str(ctx.meta['og:site_name']), 8, SOURCE.ogSiteName);
  const label = domainLabel(ctx.domain);
  const segments = titleSegments(ctx.title);
  const matching = segments.filter((s) => matchesDomain(s, label));
  for (const s of matching) add(s, 7, SOURCE.title);
  const copyright = copyrightName(ctx.text.footer || ctx.text.page.slice(-3000));
  if (copyright) add(copyright, matchesDomain(copyright, label) ? 6 : 5, SOURCE.copyright);
  add(str(ctx.meta['application-name']), 4, SOURCE.appName);
  add(str(ctx.meta['apple-mobile-web-app-title']), 4, SOURCE.appName);
  for (const n of ctx.ld) if (n.types.includes('WebSite')) add(ldText(n.node.name), 4, SOURCE.jsonld);
  // ultima risorsa: il titolo che non somiglia al dominio, da verificare
  if (!pool.size) {
    segments.filter((s) => !matching.includes(s)).forEach((s, i) => add(s, i === 0 ? 3 : 1, SOURCE.title, { uncertain: true }));
  }
  return pool.best();
}

// ---------------------------------------------------------------------------------------------
// email

const GENERIC_LOCAL = /^(info|informazioni|contatti|contatto|contact|contacts|hello|ciao|commerciale|sales|vendite|vendita|amministrazione|admin|segreteria|ufficio|office|booking|prenotazioni|prenota|reception|ordini|orders|shop|negozio|export|marketing|mail|posta|direzione|accoglienza|eventi|enoteca|wine|staff|agriturismo|cantina|hotel|welcome|support|assistenza|servizioclienti|customercare)$/;
const SYSTEM_LOCAL = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|webmaster|privacy|dpo|gdpr|abuse)/;
const IGNORED_EMAIL_DOMAINS = /(^|\.)(example\.(com|org|net|it)|esempio\.it|domain\.(com|it)|dominio\.it|tuodominio\.it|yourdomain\.com|email\.com|sentry\.io|wixpress\.com|test\.com)$/;

const isPec = (local, host) => /(^|\.)(pec|legalmail|arubapec|postacert|pecmail|cert)\./.test(host) || /(^|[._-])pec([._-]|$)/.test(local);

function isPersonalEmail(email) {
  const [local, host] = email.split('@');
  return !GENERIC_LOCAL.test(local) && !SYSTEM_LOCAL.test(local) && !isPec(local, host);
}

function emailsInText(text) {
  if (!text) return [];
  const t = text
    .replace(/\s*[[(]\s*(?:at|chiocciola)\s*[\])]\s*/gi, '@')
    .replace(/\s*[[(]\s*(?:dot|punto)\s*[\])]\s*/gi, '.');
  return t.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi) || [];
}

function collectEmails(ctx) {
  const pool = makePool();
  const all = new Set();
  const add = (raw, base, source, zone = '') => {
    const email = normalizeEmail(raw);
    if (!email) return;
    const [local, host] = email.split('@');
    if (IGNORED_EMAIL_DOMAINS.test(host)) return;
    let score = base;
    if (sameSite(host, ctx.domain)) score += 4;
    if (GENERIC_LOCAL.test(local)) score += 2;
    if (isPec(local, host)) score -= 4;
    if (SYSTEM_LOCAL.test(local)) score -= 5;
    if (zone === 'footer' || zone === 'header') score += 1;
    pool.add(email, score, source, { key: email });
    all.add(email);
  };
  ctx.orgs.forEach((org, i) => {
    for (const e of ldTexts(org.node.email)) add(e, i === 0 ? 7 : 5, SOURCE.jsonld);
    for (const cp of asArray(org.node.contactPoint)) if (isObject(cp)) for (const e of ldTexts(cp.email)) add(e, 5, SOURCE.jsonld);
  });
  for (const m of ctx.microdata) if (m.prop === 'email') add(str(m.value), 5, SOURCE.microdata);
  add(str(ctx.meta['business:contact_data:email']), 5, SOURCE.metaBusiness);
  for (const link of ctx.links) {
    if (link.kind !== 'mailto') continue;
    for (const part of str(link.href).replace(/^mailto:/i, '').split('?')[0].split(/[,;]/)) add(part, 4, SOURCE.mailto, link.zone);
  }
  for (const [zone, source] of [['footer', SOURCE.footer], ['header', SOURCE.header], ['page', SOURCE.page]]) {
    for (const e of emailsInText(ctx.text[zone])) add(e, 2, source, zone);
  }
  return { pool, list: [...all] };
}

// ---------------------------------------------------------------------------------------------
// telefono

// (?!\d): il numero finisce dove finiscono le cifre, senza tagliare l'ultimo gruppo
const PHONE_NUMBER = String.raw`((?:\(?(?:\+|00)\d{2}\)?[ .]?)?\d{2,5}(?:[ .\/-]?\d{2,6}){1,4})(?!\d)`;
// nel testo libero un numero conta solo dopo una parola come "Tel." o con il prefisso +39
const PHONE_AFTER_KEYWORD = new RegExp(
  String.raw`(?:\b(?:tel(?:efono|ephone)?|phone|cell(?:ulare)?|mobile|mob|whatsapp|t)\b\.?(?:[ \t]*(?:\/|e|&)[ \t]*fax\.?)?[ \t]*[:.]?[ \t]*|[☎📞✆][ \t]*)${PHONE_NUMBER}`,
  'giu',
);
const PHONE_INTERNATIONAL = /(?<![\d+])((?:\+|00)39[ .]?\d{2,5}(?:[ .\/-]?\d{2,6}){1,4})(?!\d)/g;

// "075 8123456 06081" → "075 8123456": la cifra in più appartiene ad altro (es. CAP)
function longestValidPrefix(raw) {
  const groups = raw.split(/(?=[ .\/-]\d)/);
  for (let k = groups.length; k >= 1; k -= 1) {
    const candidate = groups.slice(0, k).join('');
    if (normalizePhone(candidate)) return candidate;
  }
  return '';
}

function phonesInText(text) {
  if (!text) return [];
  const out = [];
  for (const m of text.matchAll(PHONE_AFTER_KEYWORD)) out.push(longestValidPrefix(m[1]));
  for (const m of text.matchAll(PHONE_INTERNATIONAL)) {
    const before = text.slice(Math.max(0, m.index - 12), m.index);
    if (!/fax|\bf\.?\s*:?\s*$/i.test(before)) out.push(longestValidPrefix(m[1]));
  }
  return out.filter(Boolean);
}

function collectPhones(ctx) {
  const pool = makePool();
  const all = new Map();
  const add = (raw, base, source, zone = '') => {
    const compact = normalizePhone(raw);
    if (!compact) return;
    const display = formatPhone(compact);
    pool.add(display, base + (zone === 'footer' || zone === 'header' ? 1 : 0), source, { key: compact });
    all.set(compact, display);
  };
  ctx.orgs.forEach((org, i) => {
    for (const t of ldTexts(org.node.telephone)) add(t, i === 0 ? 7 : 5, SOURCE.jsonld);
    for (const cp of asArray(org.node.contactPoint)) if (isObject(cp)) for (const t of ldTexts(cp.telephone)) add(t, 5, SOURCE.jsonld);
  });
  for (const m of ctx.microdata) if (m.prop === 'telephone') add(str(m.value), 5, SOURCE.microdata);
  add(str(ctx.meta['business:contact_data:phone_number']), 5, SOURCE.metaBusiness);
  for (const link of ctx.links) {
    if (link.kind === 'tel' && !/fax/i.test(`${str(link.text)} ${str(link.label)}`)) add(str(link.href), 4, SOURCE.tel, link.zone);
  }
  for (const [zone, source] of [['footer', SOURCE.footer], ['header', SOURCE.header], ['page', SOURCE.page]]) {
    for (const p of phonesInText(ctx.text[zone])) add(p, 2, source, zone);
  }
  return { pool, list: [...all.values()] };
}

// ---------------------------------------------------------------------------------------------
// indirizzo, città, regione

const STREET_RE = /(?:^|[^\p{L}])(via|viale|v\.le|piazza|p\.zza|p\.za|piazzale|p\.le|piazzetta|corso|c\.so|largo|vicolo|vico|strada|str\.|località|loc\.|frazione|fraz\.|contrada|c\.da|borgo|vocabolo|voc\.|podere|lungomare|lungarno|salita|traversa|cascina)(?=[\s.,])/giu;
// CAP + città + sigla della provincia: "06081 Assisi (PG)", "06081 Assisi - PG", "06081 Assisi PG"
const CAP_CITY_PROVINCE = /^(\d{5})[ \t]*[-–,]?[ \t]*(\p{Lu}[\p{L}'’.-]*(?:[ \t]+[\p{L}'’.-]+){0,5}?)[ \t]*(?:\([ \t]*(\p{Lu}{2})[ \t]*\)|[-–,][ \t]*(\p{Lu}{2})(?!\p{L})|[ \t]+(\p{Lu}{2})(?!\p{L}))/u;
// CAP + città senza provincia: vale solo se c'è anche la via
const CAP_CITY = /^(\d{5})[ \t]*[-–,]?[ \t]*(\p{Lu}[\p{L}'’.-]*(?:[ \t]+(?:(?:di|del|della|dei|degli|delle|al|in|sul|sulla)[ \t]+)?\p{Lu}[\p{L}'’.-]*){0,4})/u;
const CITY_TAIL = /^(tel|telefono|fax|email|e-mail|mail|cell|italia|italy|it|p|partita|piva|c|cf|codice|whatsapp|orari)$/i;

function streetBefore(text) {
  const tail = text.slice(-100);
  let last = null;
  for (const m of tail.matchAll(STREET_RE)) last = m;
  if (!last) return '';
  const street = trimSeparators(tail.slice(last.index + last[0].length - last[1].length));
  return street.length >= 5 && street.length <= 90 && !/[@:]|https?/i.test(street) ? street : '';
}

function cityWithoutTail(city) {
  const words = city.split(' ');
  while (words.length && CITY_TAIL.test(words.at(-1).replace(/\.$/, ''))) words.pop();
  return words.join(' ');
}

function addressesInText(text, baseScore, source, out) {
  if (!text) return;
  const lines = text.split(/\n+/).map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/(?<!\d)\d{5}(?!\d)/g)) {
      const rest = line.slice(m.index);
      let city;
      let province = '';
      const withProvince = rest.match(CAP_CITY_PROVINCE);
      const code = withProvince && (withProvince[3] || withProvince[4] || withProvince[5]);
      if (withProvince && isProvinceCode(code)) {
        city = trimSeparators(withProvince[2]);
        province = code;
      } else {
        const plain = rest.match(CAP_CITY);
        if (!plain) continue;
        city = cityWithoutTail(trimSeparators(plain[2]));
      }
      if (!city) continue;
      const before = line.slice(0, m.index);
      const street = streetBefore(before) || (i > 0 && !trimSeparators(before) ? streetBefore(lines[i - 1]) : '');
      if (!province && !street) continue;
      city = smartCase(city);
      const address = [street, `${m[0]} ${city}${province ? ` (${province})` : ''}`].filter(Boolean).join(', ');
      out.push({ address, city, province, regionText: '', score: baseScore + (street ? 1 : 0) + (province ? 1 : 0), source, uncertain: !street || !province });
    }
  });
}

function composeAddress(parts, score, source) {
  const street = cleanText(parts.street, 120);
  const cap = cleanText(parts.cap, 10);
  const city = smartCase(cleanText(parts.city, 60));
  let regionText = cleanText(parts.region, 60);
  let province = '';
  if (regionText.length === 2 && isProvinceCode(regionText.toUpperCase())) {
    province = regionText.toUpperCase();
    regionText = '';
  }
  const place = [cap, city].filter(Boolean).join(' ') + (province ? ` (${province})` : '');
  const address = cap && street.includes(cap) ? street : [street, place].filter(Boolean).join(', ');
  return address ? { address, city, province, regionText, score, source, uncertain: false } : null;
}

function regionOf(candidate) {
  if (candidate.regionText) {
    const region = normalizeRegion(candidate.regionText);
    if (region) return field(region, candidate.source);
    const code = candidate.regionText.toUpperCase();
    if (isProvinceCode(code)) return field(regionFromProvince(code), `dedotta dalla provincia (${code})`);
    const byName = provinceFromName(candidate.regionText);
    if (byName) return field(regionFromProvince(byName), `dedotta dalla provincia di ${candidate.regionText}`);
    return field(candidate.regionText, candidate.source); // regione estera o non riconosciuta: com'è scritta
  }
  if (candidate.province) return field(regionFromProvince(candidate.province), `dedotta dalla provincia (${candidate.province})`);
  const capital = provinceFromName(candidate.city);
  if (capital) return field(regionFromProvince(capital), 'dedotta dalla città (capoluogo di provincia)');
  return null;
}

function findAddress(ctx) {
  const candidates = [];
  const push = (c) => c && candidates.push(c);
  ctx.orgs.forEach((org, i) => {
    for (const a of asArray(org.node.address)) {
      const score = i === 0 ? 8 : 6;
      if (typeof a === 'string') {
        const before = candidates.length;
        addressesInText(decodeEntities(a), score, SOURCE.jsonld, candidates);
        if (candidates.length === before) push(composeAddress({ street: decodeEntities(a) }, score, SOURCE.jsonld));
      } else if (isObject(a)) {
        push(composeAddress({
          street: ldText(a.streetAddress), cap: ldText(a.postalCode), city: ldText(a.addressLocality), region: ldText(a.addressRegion),
        }, score, SOURCE.jsonld));
      }
    }
  });
  const md = (prop) => str(ctx.microdata.find((m) => m.prop === prop)?.value);
  if (md('streetAddress') || md('addressLocality')) {
    push(composeAddress({ street: md('streetAddress'), cap: md('postalCode'), city: md('addressLocality'), region: md('addressRegion') }, 6, SOURCE.microdata));
  }
  const mb = (k) => str(ctx.meta[`business:contact_data:${k}`]);
  if (mb('street_address') || mb('locality')) {
    push(composeAddress({ street: mb('street_address'), cap: mb('postal_code'), city: mb('locality'), region: mb('region') }, 5, SOURCE.metaBusiness));
  }
  for (const block of ctx.addressBlocks) addressesInText(block, 4, SOURCE.addressTag, candidates);
  addressesInText(ctx.text.footer, 3, SOURCE.footer, candidates);
  addressesInText(ctx.text.header, 2, SOURCE.header, candidates);
  addressesInText(ctx.text.page, 1, SOURCE.page, candidates);

  if (!candidates.length) return { address: emptyField(), city: emptyField(), region: emptyField() };
  const ranked = candidates.map((c, order) => ({ ...c, order })).sort((a, b) => b.score - a.score || a.order - b.order);
  const best = ranked[0];
  const withCity = best.city ? best : ranked.find((c) => c.city);
  const region = regionOf(best) || (withCity && withCity !== best ? regionOf(withCity) : null) || emptyField();
  return {
    address: field(best.address, best.source, best.uncertain, ranked.map((c) => c.address)),
    city: withCity ? field(withCity.city, withCity.source, withCity.uncertain, ranked.map((c) => c.city)) : emptyField(),
    region,
  };
}

// ---------------------------------------------------------------------------------------------
// persone

// [ruolo, priorità]: 1 = chi decide, 2 = direzione, 3 = commerciale e marketing, 4 = altri ruoli
const ROLES = [
  ['titolare', 1], ['contitolare', 1], ['co-titolare', 1], ['proprietario', 1], ['proprietaria', 1],
  ['fondatore', 1], ['fondatrice', 1], ['co-fondatore', 1], ['co-fondatrice', 1],
  ['socio fondatore', 1], ['socia fondatrice', 1], ['amministratore unico', 1], ['amministratrice unica', 1],
  ['amministratore delegato', 1], ['amministratrice delegata', 1], ['amministratore', 1], ['amministratrice', 1],
  ['legale rappresentante', 1], ['presidente', 1], ['owner', 1], ['founder', 1], ['co-founder', 1], ['ceo', 1],
  ['direttore generale', 2], ['direttrice generale', 2], ['general manager', 2], ['managing director', 2],
  ['direttore commerciale', 3], ['direttrice commerciale', 3], ['direttore marketing', 3], ['direttrice marketing', 3],
  ['responsabile commerciale', 3], ['responsabile vendite', 3], ['responsabile marketing', 3],
  ['responsabile export', 3], ['sales manager', 3], ['marketing manager', 3], ['export manager', 3],
  ['direttore', 4], ['direttrice', 4], ['responsabile', 4], ['vicepresidente', 4], ['socio', 4], ['socia', 4],
  ['enologo', 4], ['enologa', 4], ['agronomo', 4], ['agronoma', 4], ['chef', 4], ['gestore', 4],
  ['gestrice', 4], ['referente', 4], ['manager', 4],
];
const ROLE_PRIORITY = new Map(ROLES.map(([r, p]) => [normKey(r), p]));

// le parole del ruolo senza distinzione di maiuscole; i nomi invece devono avere l'iniziale maiuscola
const caseless = (phrase) => phrase
  .replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`)
  .replace(/-/g, '-?')
  .replace(/ /g, '[ \\t]+');
const ROLE = ROLES.map(([r]) => r).sort((a, b) => b.length - a.length).map(caseless).join('|');
const NAME_WORD = String.raw`(?:\p{Lu}['’]\p{Lu}\p{Ll}+|\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?|\p{Lu}['’]\p{Lu}{2,}|\p{Lu}{2,}(?:-\p{Lu}{2,})?)`;
const NAME = String.raw`${NAME_WORD}(?:[ \t]+${NAME_WORD}){1,3}`;
// "Titolare: Mario Rossi" / "Titolare\nMario Rossi"
const ROLE_THEN_NAME = new RegExp(String.raw`(?<!\p{L})(${ROLE})(?!\p{L})[ \t]*[:\-–—,]?[ \t]*(?:\n[ \t]*){0,2}(${NAME})`, 'gu');
// "Mario Rossi – Titolare" / "Mario Rossi (titolare)" / "Mario Rossi\nTitolare"
const NAME_THEN_ROLE = new RegExp(String.raw`(${NAME})[ \t]*(?:[,\-–—|:(/][ \t]*|(?:\n[ \t]*){1,2})(${ROLE})(?!\p{L})`, 'gu');

// parole che compaiono vicino ai ruoli ma non sono nomi di persona
const NOT_NAME = new Set([
  'chi', 'siamo', 'contatti', 'contattaci', 'contatto', 'contatta', 'scrivi', 'scrivici', 'home', 'menu', 'cerca',
  'news', 'blog', 'shop', 'carrello', 'accedi', 'login', 'area', 'riservata', 'lavora', 'con', 'noi',
  'azienda', 'agricola', 'agriturismo', 'cantina', 'cantine', 'tenuta', 'fattoria', 'podere', 'frantoio', 'oleificio',
  'hotel', 'ristorante', 'osteria', 'trattoria', 'resort', 'relais', 'masseria', 'casale', 'locanda', 'bed', 'breakfast',
  'camere', 'appartamenti', 'srl', 'srls', 'spa', 'snc', 'sas', 'societa', 'soc', 'coop', 'cooperativa', 'gruppo',
  'studio', 'agenzia', 'consorzio', 'il', 'i', 'gli', 'un', 'una', 'uno', 'nostro', 'nostra', 'nostri', 'nostre',
  'team', 'staff', 'the', 'our', 'and', 'servizi', 'prodotti', 'vini', 'vino', 'olio', 'eventi', 'degustazioni',
  'offerte', 'galleria', 'gallery', 'foto', 'video', 'storia', 'territorio', 'vigneti', 'enoteca', 'ospitalita',
  'privacy', 'cookie', 'policy', 'termini', 'condizioni', 'informativa', 'accetta', 'rifiuta', 'personalizza',
  'impostazioni', 'chiudi', 'prenota', 'prenotazioni', 'prenotazione', 'scopri', 'leggi', 'tutti', 'diritti',
  'riservati', 'partita', 'iva', 'piva', 'codice', 'fiscale', 'tel', 'telefono', 'cell', 'cellulare', 'email', 'mail',
  'fax', 'whatsapp', 'orari', 'orario', 'ufficio', 'commerciale', 'marketing', 'amministrazione', 'direzione',
  'reception', 'booking', 'info', 'assistenza', 'clienti', 'newsletter', 'seguici', 'facebook', 'instagram',
  'linkedin', 'youtube', 'twitter', 'tiktok', 'google', 'maps', 'mappa', 'dove', 'come', 'raggiungerci',
  'benvenuti', 'benvenuto', 'buongiorno', 'grazie', 'via', 'viale', 'piazza', 'corso', 'localita', 'strada',
  'frazione', 'san', 'santa', 'santo', 'sant', 'italia', 'italy',
  'titolare', 'contitolare', 'proprietario', 'proprietaria', 'fondatore', 'fondatrice', 'cofondatore', 'cofondatrice',
  'socio', 'socia', 'amministratore', 'amministratrice', 'unico', 'unica', 'delegato', 'delegata', 'legale',
  'rappresentante', 'presidente', 'vicepresidente', 'direttore', 'direttrice', 'generale', 'responsabile', 'manager',
  'general', 'managing', 'director', 'sales', 'export', 'owner', 'founder', 'ceo', 'enologo', 'enologa', 'agronomo',
  'agronoma', 'chef', 'gestore', 'gestrice', 'referente', 'vendite',
]);
const PARTICLES = new Set(['de', 'di', 'del', 'della', 'dei', 'degli', 'delle', 'da', 'dal', 'dalla', 'dalle', 'dello', 'lo', 'la', 'le', 'li', 'van', 'von', 'du', 'des']);

// Parole del nome ripulite, oppure null se non sembra un nome e cognome.
// anchor 'start': il nome segue il ruolo (si tiene l'inizio); 'end': lo precede (si tiene la fine).
function nameTokens(raw, anchor = '') {
  let words = cleanText(raw, 80).split(' ').map((w) => w.replace(/[.,;:]+$/, '')).filter(Boolean);
  const stop = (w) => NOT_NAME.has(normKey(w));
  if (anchor === 'start') {
    while (words.length && stop(words[0])) words.shift();
    const cut = words.findIndex(stop);
    if (cut >= 0) words = words.slice(0, cut);
  } else if (anchor === 'end') {
    const last = words.map(stop).lastIndexOf(true);
    if (last >= 0) words = words.slice(last + 1);
  } else {
    while (words.length && stop(words[0])) words.shift();
    while (words.length && stop(words.at(-1))) words.pop();
  }
  while (words.length && PARTICLES.has(words[0].toLowerCase())) words.shift();
  if (words.length < 2 || words.length > 4) return null;
  if (words.some((w) => stop(w) || !/^\p{Lu}/u.test(w) || normKey(w).length < 2)) return null;
  return words.map(smartCase);
}

function splitName(words) {
  const particle = words.findIndex((w, i) => i > 0 && PARTICLES.has(w.toLowerCase()));
  const cut = particle > 0 ? particle : words.length >= 3 ? 2 : 1;
  return { firstName: words.slice(0, cut).join(' '), lastName: words.slice(cut).join(' ') };
}

function rolePriority(role) {
  const k = normKey(role);
  if (ROLE_PRIORITY.has(k)) return ROLE_PRIORITY.get(k);
  let best = 4;
  for (const [r, p] of ROLE_PRIORITY) if (r.length >= 3 && k.includes(r)) best = Math.min(best, p);
  return best;
}

function displayRole(raw) {
  let s = cleanText(raw, 80);
  if (s === s.toUpperCase()) s = s.toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const person = (p) => ({
  firstName: '', lastName: '', role: '', priority: 5, email: '', phone: '', linkedin: '',
  source: '', sources: {}, uncertain: true, order: 0, ...p,
});

function peopleFromJsonLd(nodes, out) {
  nodes.forEach((n, i) => {
    if (!n.types.includes('Person')) return;
    const links = [...n.links];
    const staff = links.some((l) => STAFF_LINKS.has(l));
    if (!staff && links.some((l) => AUTHOR_LINKS.has(l))) return;
    const node = n.node;
    let firstName = ldText(node.givenName);
    let lastName = ldText(node.familyName);
    if (!firstName || !lastName) {
      const words = nameTokens(ldText(node.name));
      if (!words) return;
      ({ firstName, lastName } = splitName(words));
    }
    const role = ldText(node.jobTitle) || (links.some((l) => l.startsWith('founder')) ? 'Fondatore' : '');
    const linkedin = [...ldTexts(node.sameAs), ...ldTexts(node.url)].map(normalizeLinkedin).find((li) => li?.kind === 'profile')?.url || '';
    const phone = normalizePhone(ldText(node.telephone));
    out.push(person({
      firstName, lastName, role, linkedin,
      email: normalizeEmail(ldText(node.email)),
      phone: phone ? formatPhone(phone) : '',
      priority: role ? rolePriority(role) : staff ? 3 : 5,
      source: SOURCE.jsonld,
      uncertain: !staff && !role,
      order: i,
    }));
  });
}

function peopleFromLinks(links, out) {
  links.forEach((link, i) => {
    const words = nameTokens(str(link.text) || str(link.label));
    if (!words) return;
    const { firstName, lastName } = splitName(words);
    if (link.kind === 'mailto') {
      const email = normalizeEmail(str(link.href));
      if (email) out.push(person({ firstName, lastName, email, source: SOURCE.mailto, order: 500 + i }));
    } else if (link.kind === 'linkedin') {
      const li = normalizeLinkedin(str(link.href));
      if (li?.kind === 'profile') out.push(person({ firstName, lastName, linkedin: li.url, source: SOURCE.linkedin, order: 500 + i }));
    }
  });
}

// In un elenco "Nome – Ruolo / Nome – Ruolo" lo stesso ruolo può agganciarsi sia al nome prima
// sia a quello dopo: ogni ruolo e ogni nome si usano una volta sola, in ordine di lettura.
function peopleFromText(text, out) {
  if (!text) return;
  const pairs = [];
  for (const m of text.matchAll(ROLE_THEN_NAME)) {
    const nameAt = m.index + m[0].length - m[2].length;
    pairs.push({ rawName: m[2], rawRole: m[1], anchor: 'start', start: m.index, roleAt: m.index, nameAt });
  }
  for (const m of text.matchAll(NAME_THEN_ROLE)) {
    const roleAt = m.index + m[0].length - m[2].length;
    pairs.push({ rawName: m[1], rawRole: m[2], anchor: 'end', start: m.index, roleAt, nameAt: m.index });
  }
  const usedRoles = new Set();
  const usedNames = new Set();
  for (const p of pairs.sort((a, b) => a.start - b.start)) {
    if (usedRoles.has(p.roleAt) || usedNames.has(p.nameAt)) continue;
    const words = nameTokens(p.rawName, p.anchor);
    if (!words) continue;
    usedRoles.add(p.roleAt);
    usedNames.add(p.nameAt);
    out.push(person({ ...splitName(words), role: displayRole(p.rawRole), priority: rolePriority(p.rawRole), source: SOURCE.page, order: 1000 + p.start }));
  }
}

function mergePeople(list) {
  const byKey = new Map();
  for (const p of [...list].sort((a, b) => a.order - b.order)) {
    const key = normKey(p.firstName + p.lastName);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { ...p, sources: { ...p.sources } });
      continue;
    }
    for (const f of ['email', 'phone', 'linkedin']) if (!current[f] && p[f]) current[f] = p[f];
    if (p.role && (!current.role || p.priority < current.priority)) {
      current.role = p.role;
      current.priority = p.priority;
    }
    if (current.uncertain && !p.uncertain) {
      current.uncertain = false;
      current.source = p.source;
    }
  }
  return [...byKey.values()];
}

function emailMatchesPerson(email, p) {
  const local = normKey(email.split('@')[0]);
  const last = normKey(p.lastName);
  const first = normKey(p.firstName.split(' ')[0]);
  return (last.length >= 3 && local.includes(last)) || (first.length >= 3 && local === first);
}

function profileMatchesPerson(url, p) {
  let slug = url.split('/in/')[1] || '';
  try { slug = decodeURIComponent(slug); } catch { /* resta com'è */ }
  slug = normKey(slug);
  const last = normKey(p.lastName);
  const first = normKey(p.firstName.split(' ')[0]);
  return last.length >= 3 && first.length >= 3 && slug.includes(last) && slug.includes(first);
}

function findPeople(ctx, emails, phones) {
  const found = [];
  peopleFromJsonLd(ctx.ld, found);
  peopleFromLinks(ctx.links, found);
  peopleFromText(ctx.text.page, found);
  const people = mergePeople(found);

  const personalEmails = emails.filter(isPersonalEmail);
  const profiles = unique(ctx.links
    .filter((l) => l.kind === 'linkedin')
    .map((l) => normalizeLinkedin(str(l.href)))
    .filter((li) => li?.kind === 'profile')
    .map((li) => li.url));
  const mobiles = phones.filter((p) => p.startsWith('+39 3'));

  for (const p of people) {
    if (!p.email) {
      const email = personalEmails.find((e) => emailMatchesPerson(e, p));
      if (email) Object.assign(p, { email, sources: { ...p.sources, email: SOURCE.emailName } });
    }
    if (!p.linkedin) {
      const url = profiles.find((u) => profileMatchesPerson(u, p));
      if (url) Object.assign(p, { linkedin: url, sources: { ...p.sources, linkedin: SOURCE.linkedinName } });
    }
  }
  people.sort((a, b) => a.priority - b.priority || Number(a.uncertain) - Number(b.uncertain) || a.order - b.order);

  const [main, ...others] = people;
  const sourceOf = (p, f) => p.sources[f] || p.source;
  const contact = main
    ? {
      firstName: field(main.firstName, main.source, main.uncertain),
      lastName: field(main.lastName, main.source, main.uncertain),
      role: field(main.role, main.source, main.uncertain),
      email: field(main.email, sourceOf(main, 'email'), main.uncertain, personalEmails),
      phone: field(main.phone, sourceOf(main, 'phone'), main.uncertain, mobiles),
      linkedin: field(main.linkedin, sourceOf(main, 'linkedin'), main.uncertain, profiles),
    }
    : {
      firstName: emptyField(),
      lastName: emptyField(),
      role: emptyField(),
      email: field('', '', false, personalEmails),
      phone: field('', '', false, mobiles),
      linkedin: field('', '', false, profiles),
    };
  return {
    contact,
    people: others.slice(0, MAX_PEOPLE).map(({ priority, order, ...p }) => p),
  };
}

// ---------------------------------------------------------------------------------------------
// avvisi per il commerciale

function buildNotes(snapshot, company, contact) {
  const notes = [];
  const errors = Number(snapshot.jsonldErrors) || 0;
  if (errors === 1) notes.push('Un blocco di dati strutturati non era leggibile ed è stato ignorato.');
  if (errors > 1) notes.push(`${errors} blocchi di dati strutturati non erano leggibili e sono stati ignorati.`);
  if (snapshot.text?.truncated === true) notes.push('Pagina molto lunga: è stata letta solo la prima parte del testo.');
  if (!company.email.value && !company.phone.value) notes.push('Nessuna email e nessun telefono in questa pagina: prova la pagina «Contatti».');
  if (!contact.firstName.value) notes.push('Nessuna persona individuata: se ne conosci una, compila il Contatto a mano.');
  else if (contact.firstName.uncertain) notes.push('Il contatto è ricavato dal testo della pagina: verifica nome e ruolo.');
  return notes;
}
