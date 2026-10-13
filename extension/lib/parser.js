// Estrattore di Scout (Agria Commercial): da una pagina ai dati che contiene, ognuno con la sua prova.
//
// Riceve la "fotografia" della pagina raccolta da content/collector.js (la pagina aperta nel
// browser oppure una pagina scaricata dalla scansione approfondita) e restituisce:
//   facts   valori trovati (nomi, email, telefoni, WhatsApp, fax, indirizzi, dati societari,
//           social, sistemi esterni) con metodo di rilevazione, punteggio, affidabilità
//           ('high' = Alta affidabilità, 'check' = Da verificare) ed evidenza testuale;
//   people  persone individuate, anche parziali ("Paolo – Host"), con i recapiti vicini al nome;
//   signals parole di settore pesate, per proporre settore e tipo di struttura;
//   links   link interni allo stesso sito, per scoprire le altre pagine.
// La scelta fra valori di pagine diverse la fanno lib/siteData.js e lib/crmModel.js.
//
// Regola fissa: ogni valore viene dalla pagina, mai inventato. Se un dato non c'è, non c'è.

import {
  cleanText, domainFromUrl, formatPhone, normalizeEmail, normalizeLinkedin, normalizePhone,
  normalizeUrl, normKey, sameSite, snippet,
} from './validation.js';
import { isProvinceCode, normalizeCountry, provinceFromName } from './italy.js';
import { FIRST_NAMES } from './names.js';
import { collectCompanyData, collectSignals, hasLegalSuffix, stripLegalSuffix } from './companyData.js';

export const METHOD = {
  jsonld: 'dati strutturati JSON-LD',
  microdata: 'dati strutturati (microdati)',
  ogSiteName: 'meta tag og:site_name',
  metaBusiness: 'meta tag business',
  appName: 'meta tag application-name',
  title: 'titolo della pagina',
  heading: 'intestazione della pagina',
  copyright: 'copyright',
  mailto: 'link email',
  tel: 'link telefono',
  whatsapp: 'link WhatsApp',
  linkedin: 'link LinkedIn',
  addressTag: 'blocco indirizzo',
  footer: 'testo del footer',
  header: "testo dell'intestazione",
  page: 'testo della pagina',
  emailName: 'email con il nome della persona',
  linkedinName: 'profilo LinkedIn con il nome della persona',
  nearName: 'vicino al nome della persona',
};
const TEXT_METHOD = { footer: METHOD.footer, header: METHOD.header, page: METHOD.page };

const CONTACT_KINDS = new Set(['email', 'phone', 'fax', 'whatsapp', 'address']);
const CORPORATE_KINDS = new Set(['legalName', 'piva', 'cf', 'rea', 'cin', 'sdi']);

// priorità delle fonti per tipo di pagina: Contatti per i recapiti, pagine legali per i dati societari
function pageBonus(kind, pageType, extra) {
  // il footer è uguale su tutte le pagine: il premio della pagina legale vale solo per il suo contenuto
  if (extra.fromFooter) return 0;
  if (CORPORATE_KINDS.has(kind) || (kind === 'email' && extra.pec)) {
    return pageType === 'legal' ? 3 : pageType === 'contact' ? 1 : 0;
  }
  if (CONTACT_KINDS.has(kind)) {
    if (pageType === 'contact') return 3;
    if (['about', 'team', 'hospitality', 'home'].includes(pageType)) return 1;
    return pageType === 'blog' ? -1 : 0;
  }
  if (kind === 'name') return pageType === 'home' ? 1 : 0;
  return 0;
}

/** Da fotografia della pagina a { page, facts, people, signals, links, notes }. */
export function analyzeSnapshot(snapshot, { pageType = 'other' } = {}) {
  if (!isObject(snapshot)) throw new TypeError('Dati della pagina mancanti.');
  const pageUrl = normalizeUrl(str(snapshot.url));
  if (!pageUrl) throw new TypeError('La pagina analizzata non ha un indirizzo web valido.');
  const domain = domainFromUrl(pageUrl);
  const text = isObject(snapshot.text) ? snapshot.text : {};
  const ctx = {
    domain,
    pageType,
    title: str(snapshot.title),
    meta: isObject(snapshot.meta) ? snapshot.meta : {},
    links: asArray(snapshot.links).filter(isObject),
    microdata: asArray(snapshot.microdata).filter(isObject),
    addressBlocks: asArray(snapshot.addresses).filter((s) => typeof s === 'string'),
    headings: asArray(snapshot.headings).filter((s) => typeof s === 'string'),
    subheadings: asArray(snapshot.subheadings).filter((s) => typeof s === 'string'),
    resources: asArray(snapshot.resources).filter((s) => typeof s === 'string'),
    text: { header: str(text.header), footer: str(text.footer), page: str(text.page) },
    ld: flattenJsonLd(asArray(snapshot.jsonld)),
  };
  // contenuto proprio della pagina, senza il footer (che di solito è un pezzo del testo intero)
  ctx.text.main = ctx.text.footer && ctx.text.page.includes(ctx.text.footer) ? ctx.text.page.replace(ctx.text.footer, '\n') : ctx.text.page;
  ctx.orgs = rankOrganizations(ctx.ld, domain);

  const facts = [];
  const add = (kind, value, { method, score, high = false, key, evidence = '', extra = {} }) => {
    const v = cleanText(value, 400);
    if (!v) return;
    facts.push({
      kind, value: v, key: key || normKey(v) || v, method,
      score: score + pageBonus(kind, pageType, extra),
      reliability: high ? 'high' : 'check',
      evidence: cleanText(evidence, 240),
      extra,
    });
  };
  collectNames(ctx, add);
  collectEmails(ctx, add);
  collectPhones(ctx, add);
  collectAddresses(ctx, add);
  collectCompanyData(ctx, add);

  const notes = [];
  const errors = Number(snapshot.jsonldErrors) || 0;
  if (errors === 1) notes.push('Un blocco di dati strutturati non era leggibile ed è stato ignorato.');
  if (errors > 1) notes.push(`${errors} blocchi di dati strutturati non erano leggibili e sono stati ignorati.`);
  if (text.truncated === true) notes.push('Pagina molto lunga: è stata letta solo la prima parte del testo.');

  return {
    page: { url: pageUrl, origin: new URL(pageUrl).origin, title: cleanText(ctx.title, 200), domain, type: pageType },
    facts,
    people: findPeople(ctx, facts),
    signals: collectSignals(ctx),
    links: ctx.links
      .filter((l) => l.kind === 'web' && domainFromUrl(str(l.href)) === domain)
      .map((l) => ({ url: str(l.href), text: cleanText(l.text || l.label, 120), zone: str(l.zone) })),
    notes,
  };
}

// ---------------------------------------------------------------------------------------------
// utilità

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const asArray = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
const str = (x) => (typeof x === 'string' ? x : '');
const unique = (list) => [...new Set(list.filter(Boolean))];
const trimSeparators = (s) => s.replace(/^[\s,;:|•·–—-]+|[\s,;:|•·–—-]+$/gu, '');
const isZone = (zone) => zone === 'footer' || zone === 'header';

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
// nome commerciale

const GENERIC_TITLE = /^(home|home ?page|pagina iniziale|benvenut[io]|welcome|contatti|contattaci|contatto|contacts?|contact us|chi siamo|about|about us|dove siamo|sito ufficiale|official (?:web)?site|news|blog|shop|negozio|privacy policy|cookie policy)$/i;
const WELCOME_PREFIX = /^(?:benvenut[io]|welcome)\s+(?:(?:a|al|all['’]|alla|allo|ai|agli|in|nel|nella|presso|to|at)\s*)?/i;
// parole troppo comuni per collegare un nome al dominio (agriturismo-xyz.it)
export const COMMON_WORDS = new Set([
  'agriturismo', 'cantina', 'cantine', 'azienda', 'agricola', 'hotel', 'ristorante', 'tenuta', 'villa',
  'casa', 'podere', 'fattoria', 'frantoio', 'oleificio', 'societa', 'home', 'vini', 'wine', 'winery',
  'resort', 'relais', 'masseria', 'casale', 'borgo', 'osteria', 'trattoria', 'italia', 'italy',
]);

const MAIN_PAGES = new Set(['home', 'contact', 'about', 'team', 'hospitality']);

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
  if (!m) return null;
  let name = m[1].split(COPYRIGHT_STOP)[0];
  name = name.replace(/^(?:(?:19|20)\d{2}\s*[-–]?\s*)+/, '').replace(/[\s,;:–-]+$/, '').trim();
  if (/[a-z]{4,}\.$/i.test(name)) name = name.slice(0, -1);
  return isPlausibleCompanyName(name) && !/^(tutti|all rights)/i.test(name) ? { name, evidence: snippet(text, m.index, m[0].length) } : null;
}

// ---- pulizia del nome: descrittori generici che qualificano la struttura, non ne fanno parte ----
// "Agriturismo Il Cantico delle Cicale, con ristorante" → "Il Cantico delle Cicale". Mai un replace
// globale: si guarda solo la coda dopo «con» o dopo una virgola, e il tipo in testa o in coda.
const FACILITY = String.raw`(?:ristorante|restaurant|piscina|spa|centro\s+benessere|wellness|camere|suites?|cucina|enoteca|cantina|bar)`;
const FACILITY_LIST = String.raw`${FACILITY}(?:\s*(?:,|\be\b|&|\+)\s*${FACILITY})*`;
// «, con ristorante», «con piscina e spa», «– con il nostro ristorante»
const WITH_TAIL = new RegExp(String.raw`(?:\s*[,–—|]\s*|\s+-\s+|\s+)con\s+(?:(?:il|la|un|una)\s+)?(?:(?:propri[oa]|nostr[oa])\s+)?${FACILITY_LIST}\s*\.?$`, 'iu');
// «, ristorante e camere»: elenco di servizi dopo una virgola
const LIST_TAIL = new RegExp(String.raw`\s*,\s*${FACILITY_LIST}\s*\.?$`, 'iu');
const TYPE_WORDS = String.raw`(?:agriturismo|hotel|albergo|relais|resort|ristorante|b\s*&\s*b|bed\s*(?:&|and)\s*breakfast|country\s+house|residence|casa\s+vacanze)`;
const TYPE_LEAD = new RegExp(String.raw`^${TYPE_WORDS}\s+`, 'iu');
const TYPE_TAIL = new RegExp(String.raw`\s*(?:[-–|]\s*)?(?:${TYPE_WORDS}(?:\s*(?:&|e)\s*(?:spa|wellness))?|(?:&|e)\s+(?:spa|wellness))$`, 'iu');
const wordCount = (s) => s.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;

/**
 * Nome commerciale senza i descrittori generici (export per i test).
 * known: chiavi (normKey) dei nomi che il sito scrive da solo, in intestazioni e dati strutturati.
 * 1. qualificatori in coda («con ristorante»): via, se resta un nome di almeno due parole;
 * 2. tipo in testa o in coda («Agriturismo …», «… Relais & Spa»): via SOLO se il sito scrive anche il
 *    nome senza il tipo e mai quello completo; altrimenti il tipo fa parte del nome ("Agriturismo La Mora").
 */
export function cleanCompanyName(raw, { known = new Set() } = {}) {
  let name = cleanText(raw, 120);
  for (const re of [WITH_TAIL, LIST_TAIL]) {
    const cut = trimSeparators(name.replace(re, ''));
    if (cut !== name && (wordCount(cut) >= 2 || known.has(normKey(cut)))) name = cut;
  }
  if (!known.has(normKey(name))) {
    for (const re of [TYPE_LEAD, TYPE_TAIL]) {
      const cut = trimSeparators(name.replace(re, ''));
      if (cut !== name && wordCount(cut) >= 2 && known.has(normKey(cut))) name = cut;
    }
  }
  return name;
}

function collectNames(ctx, add) {
  let found = 0;
  const label = domainLabel(ctx.domain);
  // nomi che il sito scrive da soli: intestazioni (senza «Benvenuti a…»), og:site_name, JSON-LD
  const headings = [...ctx.headings, ...ctx.subheadings].map((h) => cleanText(h.replace(/[“”"«»]/g, ''), 120).replace(WELCOME_PREFIX, '')).filter(isPlausibleCompanyName);
  const known = new Set([...headings, str(ctx.meta['og:site_name']), ...ctx.orgs.map((o) => ldText(o.node.name))].filter(Boolean).map(normKey));
  const addName = (value, score, method, high, evidence) => {
    const full = cleanText(value, 120);
    const v = cleanCompanyName(full, { known });
    if (!isPlausibleCompanyName(v)) return;
    add('name', v, { method, score, high, evidence, extra: v !== full ? { full } : {} });
    found += 1;
  };
  // intestazione che coincide con il dominio: il marchio scritto dal sito ("Il Cantico delle Cicale")
  for (const h of new Set(headings)) {
    if (normKey(h) === normKey(label)) addName(h, 7, METHOD.heading, false, `intestazione: ${h}`);
  }
  ctx.orgs.forEach((org, i) => {
    const types = org.types.join(', ');
    addName(ldText(org.node.name), i === 0 ? 10 : 6, METHOD.jsonld, true, `JSON-LD ${types}: name`);
    const legal = ldText(org.node.legalName);
    if (legal) add('legalName', legal, { method: METHOD.jsonld, score: 9, high: true, evidence: `JSON-LD ${types}: legalName` });
  });
  const siteName = str(ctx.meta['og:site_name']);
  addName(siteName, 8, METHOD.ogSiteName, true, `og:site_name = ${siteName}`);
  const segments = titleSegments(ctx.title);
  const matching = segments.filter((s) => matchesDomain(s, label));
  for (const s of matching) addName(s, 7, METHOD.title, false, `titolo: ${ctx.title}`);
  const copyright = copyrightName(ctx.text.footer || ctx.text.page.slice(-3000));
  if (copyright) {
    const score = matchesDomain(copyright.name, label) ? 6 : 5;
    if (hasLegalSuffix(copyright.name)) {
      add('legalName', copyright.name, { method: METHOD.copyright, score, evidence: copyright.evidence });
      addName(stripLegalSuffix(copyright.name), score - 1, METHOD.copyright, false, copyright.evidence);
    } else {
      addName(copyright.name, score, METHOD.copyright, false, copyright.evidence);
    }
  }
  for (const key of ['application-name', 'apple-mobile-web-app-title']) {
    const v = str(ctx.meta[key]);
    addName(v, 4, METHOD.appName, false, `${key} = ${v}`);
  }
  for (const n of ctx.ld) if (n.types.includes('WebSite')) addName(ldText(n.node.name), 4, METHOD.jsonld, true, 'JSON-LD WebSite: name');
  // ultima risorsa: il titolo che non somiglia al dominio, da verificare; solo nelle pagine
  // principali (il titolo di un articolo o di una pagina legale non è il nome dell'azienda)
  if (!found && MAIN_PAGES.has(ctx.pageType)) {
    segments.filter((s) => !matching.includes(s)).forEach((s, i) => addName(s, i === 0 ? 3 : 1, METHOD.title, false, `titolo: ${ctx.title}`));
  }
}

// ---------------------------------------------------------------------------------------------
// email

// alias funzionali: caselle dell'azienda (info@, visit@, booking@…), mai la prova che esista una persona
const FUNCTIONAL_ALIASES = new Set([
  'info', 'informazioni', 'contatti', 'contatto', 'contact', 'contacts', 'hello', 'ciao', 'visit', 'visits', 'visite',
  'booking', 'book', 'prenotazioni', 'prenotazione', 'prenota', 'reservation', 'reservations', 'reception',
  'receptionist', 'frontoffice', 'accoglienza', 'welcome', 'hospitality', 'sales', 'vendite', 'vendita', 'commerciale',
  'export', 'ordini', 'orders', 'shop', 'store', 'negozio', 'enoteca', 'degustazioni', 'amministrazione',
  'administration', 'admin', 'office', 'ufficio', 'segreteria', 'direzione', 'marketing', 'eventi', 'events', 'staff',
  'support', 'assistenza', 'servizioclienti', 'customercare', 'mail', 'posta', 'agriturismo', 'cantina', 'hotel',
  'ristorante', 'spa', 'wine',
]);
const MAIN_LOCAL = /^(info|contatti|contact|hello)$/;
const SYSTEM_LOCAL = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|webmaster|privacy|dpo|gdpr|abuse)/;
const IGNORED_EMAIL_DOMAINS = /(^|\.)(example\.(com|org|net|it)|esempio\.it|domain\.(com|it)|dominio\.it|tuodominio\.it|yourdomain\.com|email\.com|sentry\.io|wixpress\.com|test\.com)$/;
const EMAIL_IN_TEXT = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;

export const isPec = (local, host) => /(^|\.)(pec|legalmail|arubapec|postacert|pecmail|cert)\./.test(host) || /(^|[._-])pec([._-]|$)/.test(local);

// "info.cantina", "booking2": basta una parte che sia un alias funzionale
const isFunctionalLocal = (local) => local.split(/[._+-]+|\d+/).some((part) => FUNCTIONAL_ALIASES.has(part));

// forma da casella personale: nome@, nome.cognome@, iniziale.cognome@, cognome.nome@
function hasPersonalShape(local) {
  const parts = local.split(/[._-]+/).map((p) => p.replace(/\d+$/, '')).filter(Boolean);
  if (!parts.length || !parts.every((p) => /^[a-z]+$/.test(p))) return false;
  if (parts.length === 1) return FIRST_NAMES.has(parts[0]);
  if (parts.length !== 2) return false;
  const [a, b] = parts;
  return (FIRST_NAMES.has(a) && b.length >= 2) || (a.length === 1 && b.length >= 3) || (FIRST_NAMES.has(b) && a.length >= 3);
}

/**
 * Tipo di email: 'pec' | 'system' | 'generic' (alias funzionale: info@, visit@, booking@…) |
 * 'personal' (forma da persona: nome.cognome@…) | 'company' (casella dell'azienda senza alias, es. agriturismolamora@).
 */
export function emailCategory(email, { pec = false } = {}) {
  const [local = '', host = ''] = String(email).toLowerCase().split('@');
  if (pec || isPec(local, host)) return 'pec';
  if (SYSTEM_LOCAL.test(local)) return 'system';
  if (isFunctionalLocal(local)) return 'generic';
  return hasPersonalShape(local) ? 'personal' : 'company';
}

// Testo di un elemento vicino attaccato all'email: "+39 393 4363917agriturismolamora@gmail.com" (le
// ultime cifre del telefono), "E-mailinfo@…". Si ricordano i possibili prefissi incollati; l'email si
// scarta solo se la stessa senza prefisso ha una fonte più affidabile (vedi lib/siteData.js).
const GLUED_PREFIX = /^(?:(e-?mail|mail|posta|pec|tel|telefono|phone|fax|cell|cellulare|mobile|whatsapp|contatti|contattaci|contacts?|scrivici)[._-]?)?([+\d][\d.+-]*)?$/;
const NUMBER_BEFORE = /(?:\d[ \t.\/-]?|\+|\b(?:tel|telefono|phone|cell|cellulare|mobile|whats\s?app|fax)\.?[ \t]*:?[ \t]*)$/i;

function gluedPrefixes(local, before) {
  const out = [];
  for (let k = 1; k < local.length - 1; k += 1) {
    const m = local.slice(0, k).match(GLUED_PREFIX);
    if (!m || !/^[a-z0-9]/.test(local.slice(k))) continue;
    const [, label, number = ''] = m;
    const digits = number.replace(/\D/g, '').length;
    if (number && !digits) continue;
    // cifre: solo se seguono un numero o un'etichetta di telefono, o se sono già un numero intero
    if (number ? label || digits >= 6 || NUMBER_BEFORE.test(before) : label) out.push(local.slice(0, k));
  }
  return out;
}

const deobfuscate = (text) => text
  .replace(/\s*[[(]\s*(?:at|chiocciola)\s*[\])]\s*/gi, '@')
  .replace(/\s*[[(]\s*(?:dot|punto)\s*[\])]\s*/gi, '.');

function collectEmails(ctx, add) {
  const push = (raw, base, method, { zone = '', evidence = '', pecLabel = false, before = null } = {}) => {
    const email = normalizeEmail(raw);
    if (!email) return;
    const [local, host] = email.split('@');
    if (IGNORED_EMAIL_DOMAINS.test(host)) return;
    const pec = pecLabel || isPec(local, host);
    const category = emailCategory(email, { pec });
    const glued = before === null ? [] : gluedPrefixes(local, before);
    let score = base;
    if (sameSite(host, ctx.domain)) score += 4;
    if (category === 'generic') score += 2;
    if (category === 'company') score += 1; // casella dell'azienda: prima di una personale
    if (MAIN_LOCAL.test(local)) score += 1; // la casella generale per eccellenza
    if (pec) score -= 4;
    if (category === 'system') score -= 5;
    if (glued.length) score -= 2;
    if (isZone(zone)) score += 1;
    add('email', email, { method, score, high: !glued.length, key: email, evidence, extra: glued.length ? { pec, gluedPrefixes: glued } : { pec } });
  };
  ctx.orgs.forEach((org, i) => {
    for (const e of ldTexts(org.node.email)) push(e, i === 0 ? 7 : 5, METHOD.jsonld, { evidence: `JSON-LD ${org.types.join(', ')}: email` });
    for (const cp of asArray(org.node.contactPoint)) if (isObject(cp)) for (const e of ldTexts(cp.email)) push(e, 5, METHOD.jsonld, { evidence: 'JSON-LD contactPoint: email' });
  });
  for (const m of ctx.microdata) if (m.prop === 'email') push(str(m.value), 5, METHOD.microdata, { evidence: 'itemprop="email"' });
  push(str(ctx.meta['business:contact_data:email']), 5, METHOD.metaBusiness, { evidence: 'business:contact_data:email' });
  for (const link of ctx.links) {
    if (link.kind !== 'mailto') continue;
    const label = `${str(link.text)} ${str(link.label)}`;
    for (const part of str(link.href).replace(/^mailto:/i, '').split('?')[0].split(/[,;]/)) {
      push(part, 4, METHOD.mailto, { zone: link.zone, evidence: cleanText(`${label} → ${part}`, 200), pecLabel: /\bpec\b/i.test(label) });
    }
  }
  for (const [zone, method] of Object.entries(TEXT_METHOD)) {
    const text = deobfuscate(ctx.text[zone]);
    for (const m of text.matchAll(EMAIL_IN_TEXT)) {
      // l'etichetta "PEC:" vale solo per l'email che la segue subito, non per la successiva
      const before = text.slice(Math.max(0, m.index - 40), m.index);
      push(m[0], 2, method, {
        zone, before, evidence: snippet(text, m.index, m[0].length),
        pecLabel: /(?:(?<![\w@.-])pec(?![\w@-])|posta\s+elettronica\s+certificata)[^@\n]{0,12}$/i.test(before),
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// telefono, cellulare, WhatsApp, fax

// (?!\d): il numero finisce dove finiscono le cifre, senza tagliare l'ultimo gruppo
const PHONE_NUMBER = String.raw`((?:\(?(?:\+|00)\d{2}\)?[ .]?)?\d{2,5}(?:[ .\/-]?\d{2,6}){1,4})(?!\d)`;
// nel testo libero un numero conta solo dopo una parola come "Tel." o con il prefisso +39
const PHONE_AFTER_KEYWORD = new RegExp(
  String.raw`(?:\b(tel(?:efono|ephone)?|phone|cell(?:ulare)?|mobile|mob|whats\s?app|t)\b\.?(?:[ \t]*(?:\/|e|&)[ \t]*(fax)\.?)?[ \t]*[:.]?[ \t]*|[☎📞✆][ \t]*)${PHONE_NUMBER}`,
  'giu',
);
// "F. 075…" è un fax, "C.F. 0123…" no
const FAX_AFTER_KEYWORD = new RegExp(String.raw`\b(?:fax|(?<!c\.[ \t]?)f)\b\.?[ \t]*[:.]?[ \t]*${PHONE_NUMBER}`, 'giu');
// dopo queste etichette c'è un numero societario, mai un telefono
const ID_LABEL_BEFORE = /(p\.?\s?iva|partita\s+iva|c\.\s?f\.?|fiscale|r\.?\s?e\.?\s?a\.?|vat|cin|sdi)[\s:.n°-]*$/i;
const PHONE_INTERNATIONAL = /(?<![\d+])((?:\+|00)39[ .]?\d{2,5}(?:[ .\/-]?\d{2,6}){1,4})(?!\d)/g;
const BARE_MOBILE = /(?<![\d+])((?:\+39[ .]?)?3\d{2}[ .]?\d{3}[ .]?\d{3,4})(?!\d)/g;

// "075 8123456 06081" → "075 8123456": la cifra in più appartiene ad altro (es. CAP)
function longestValidPrefix(raw) {
  const groups = raw.split(/(?=[ .\/-]\d)/);
  for (let k = groups.length; k >= 1; k -= 1) {
    const candidate = groups.slice(0, k).join('');
    if (normalizePhone(candidate)) return candidate;
  }
  return '';
}

/** Numeri nel testo: [{ number, kind: 'phone' | 'whatsapp' | 'fax', index, length }]. */
function phonesInText(text) {
  if (!text) return [];
  const out = [];
  const push = (raw, kind, m) => {
    const at = m.index + m[0].length - raw.length;
    if (ID_LABEL_BEFORE.test(text.slice(Math.max(0, at - 25), at))) return;
    const number = longestValidPrefix(raw);
    if (number) out.push({ number, kind, index: m.index, length: m[0].length });
  };
  for (const m of text.matchAll(PHONE_AFTER_KEYWORD)) {
    push(m[3], /^whats/i.test(m[1] || '') ? 'whatsapp' : 'phone', m);
    if (m[2]) push(m[3], 'fax', m);
  }
  for (const m of text.matchAll(FAX_AFTER_KEYWORD)) push(m[1], 'fax', m);
  for (const m of text.matchAll(PHONE_INTERNATIONAL)) {
    const before = text.slice(Math.max(0, m.index - 15), m.index);
    if (/fax|\bf\.?\s*:?\s*$/i.test(before)) continue; // già preso come fax
    push(m[1], /whats\s?app/i.test(before) ? 'whatsapp' : 'phone', m);
  }
  return out;
}

function whatsappNumber(href) {
  try {
    const url = new URL(href);
    const raw = /^whatsapp:/i.test(href) || !/(^|\.)wa\.me$/i.test(url.hostname)
      ? url.searchParams.get('phone') || ''
      : url.pathname.replace(/\//g, '');
    const digits = raw.replace(/[^\d+]/g, '');
    return digits && !digits.startsWith('+') && digits.length >= 10 ? `+${digits}` : digits;
  } catch {
    return '';
  }
}

function collectPhones(ctx, add) {
  const push = (raw, kind, base, method, { zone = '', evidence = '', high = true } = {}) => {
    const compact = normalizePhone(raw);
    if (!compact) return;
    add(kind, formatPhone(compact), { method, score: base + (isZone(zone) ? 1 : 0), high, key: compact, evidence, extra: { mobile: compact.startsWith('+393') } });
  };
  ctx.orgs.forEach((org, i) => {
    for (const t of ldTexts(org.node.telephone)) push(t, 'phone', i === 0 ? 7 : 5, METHOD.jsonld, { evidence: `JSON-LD ${org.types.join(', ')}: telephone` });
    for (const t of ldTexts(org.node.faxNumber)) push(t, 'fax', 6, METHOD.jsonld, { evidence: 'JSON-LD faxNumber' });
    for (const cp of asArray(org.node.contactPoint)) if (isObject(cp)) for (const t of ldTexts(cp.telephone)) push(t, 'phone', 5, METHOD.jsonld, { evidence: 'JSON-LD contactPoint: telephone' });
  });
  for (const m of ctx.microdata) if (m.prop === 'telephone') push(str(m.value), 'phone', 5, METHOD.microdata, { evidence: 'itemprop="telephone"' });
  push(str(ctx.meta['business:contact_data:phone_number']), 'phone', 5, METHOD.metaBusiness, { evidence: 'business:contact_data:phone_number' });
  for (const link of ctx.links) {
    const label = `${str(link.text)} ${str(link.label)}`;
    const evidence = cleanText(`${label} → ${str(link.href)}`, 200);
    if (link.kind === 'tel') {
      const kind = /fax/i.test(label) ? 'fax' : /whats\s?app/i.test(label) ? 'whatsapp' : 'phone';
      push(str(link.href), kind, 4, METHOD.tel, { zone: link.zone, evidence });
    } else if (link.kind === 'whatsapp') {
      push(whatsappNumber(str(link.href)), 'whatsapp', 5, METHOD.whatsapp, { zone: link.zone, evidence });
    }
  }
  for (const [zone, method] of Object.entries(TEXT_METHOD)) {
    const text = ctx.text[zone];
    for (const p of phonesInText(text)) push(p.number, p.kind, 2, method, { zone, evidence: snippet(text, p.index, p.length) });
  }
}

// ---------------------------------------------------------------------------------------------
// indirizzi

const STREET_RE = /(?:^|[^\p{L}])(via|viale|v\.le|piazza|p\.zza|p\.za|piazzale|p\.le|piazzetta|corso|c\.so|largo|vicolo|vico|strada|str\.|località|loc\.|frazione|fraz\.|contrada|c\.da|borgo|vocabolo|voc\.|podere|lungomare|lungarno|salita|traversa|cascina)(?=[\s.,])/giu;
// CAP + città + sigla della provincia: "06081 Assisi (PG)", "06081 Assisi - PG", "06081 Assisi PG"
const CAP_CITY_PROVINCE = /^(\d{5})[ \t]*[-–,]?[ \t]*(\p{Lu}[\p{L}'’.-]*(?:[ \t]+[\p{L}'’.-]+){0,5}?)[ \t]*(?:\([ \t]*(\p{Lu}{2})[ \t]*\)|[-–,][ \t]*(\p{Lu}{2})(?!\p{L})|[ \t]+(\p{Lu}{2})(?!\p{L}))/u;
// CAP + città senza provincia: vale solo se c'è anche la via
const CAP_CITY = /^(\d{5})[ \t]*[-–,]?[ \t]*(\p{Lu}[\p{L}'’.-]*(?:[ \t]+(?:(?:di|del|della|dei|degli|delle|al|in|sul|sulla)[ \t]+)?\p{Lu}[\p{L}'’.-]*){0,4})/u;
// città PRIMA del CAP, provincia subito dopo: "…, Magione - 06063 (PG) - ITALY"
const CAP_PROVINCE = /^(\d{5})[ \t]*\([ \t]*(\p{Lu}{2})[ \t]*\)/u;
const CITY_BEFORE = /(?:^|[,\-–])[ \t]*(\p{Lu}[\p{L}'’]+(?:[ \t]+(?:(?:di|del|della|dei|degli|delle|al|in|sul|sulla)[ \t]+)?\p{Lu}[\p{L}'’]+){0,3})[ \t]*[-–,]?[ \t]*$/u;
// paese scritto dopo la città o la provincia: "(PG) - ITALY", "Assisi (PG), Italia"
const COUNTRY_AFTER = /^[ \t]*[-–,·|]?[ \t]*(italia|italy)(?!\p{L})/iu;
const CITY_TAIL = /^(tel|telefono|fax|email|e-mail|mail|cell|italia|italy|it|p|partita|piva|c|cf|codice|whatsapp|orari)$/i;
const LEGAL_SEAT = /sede\s+legale|registered\s+office/i;

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

// la via dal PRIMO indicatore (via, località, frazione…) del tratto prima della città:
// "Via del Moscatello, 3 - Frazione Montesperello" resta intera
function streetFrom(text) {
  const tail = text.slice(-140);
  const first = tail.matchAll(STREET_RE).next().value;
  if (!first) return '';
  const street = trimSeparators(tail.slice(first.index + first[0].length - first[1].length));
  return street.length >= 5 && street.length <= 120 && !/[@:]|https?/i.test(street) ? street : '';
}

// località o frazione (non è il comune): "Loc. Pieve Pagliaccia Bosco" → "Pieve Pagliaccia Bosco"
const LOCALITY_START = /^(?:località|loc\.|frazione|fraz\.|vocabolo|voc\.)\s*/iu;
const LOCALITY_IN = /(?:^|[\s,|])(?:località|loc\.|frazione|fraz\.|vocabolo|voc\.)\s*([^,;|]+)/iu;
const localityOf = (street) => cleanText((String(street).match(LOCALITY_IN)?.[1] || '').split(/\s[-–]\s/)[0], 80);

function addressesInText(text, baseScore, method, out) {
  if (!text) return;
  const lines = text.split(/\n+/).map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/(?<!\d)\d{5}(?!\d)/g)) {
      const rest = line.slice(m.index);
      let before = line.slice(0, m.index);
      let city;
      let province = '';
      let afterPlace = '';
      let cityFirst = false;
      let noCity = false;
      const withProvince = rest.match(CAP_CITY_PROVINCE);
      const code = withProvince && (withProvince[3] || withProvince[4] || withProvince[5]);
      const capProvince = rest.match(CAP_PROVINCE);
      const cityBefore = capProvince && isProvinceCode(capProvince[2]) ? before.match(CITY_BEFORE) : null;
      if (withProvince && isProvinceCode(code)) {
        city = trimSeparators(withProvince[2]);
        province = code;
        afterPlace = rest.slice(withProvince[0].length);
      } else if (cityBefore && !STREET_RE.test(cityBefore[1])) {
        city = cityBefore[1];
        province = capProvince[2];
        afterPlace = rest.slice(capProvince[0].length);
        before = before.slice(0, before.length - cityBefore[0].length);
        cityFirst = true;
      } else if (capProvince && isProvinceCode(capProvince[2])) {
        // "Loc. Pieve Pagliaccia Bosco 06134 (PG)", "06134 (PG)": CAP e provincia senza il comune.
        // La località non è il comune e la sola provincia non lo dice: il comune resta vuoto
        // (lo può dare il CAP, vedi crmModel), la provincia vale per la regione.
        city = '';
        province = capProvince[2];
        afterPlace = rest.slice(capProvince[0].length);
        cityFirst = true;
        noCity = true;
      } else {
        const plain = rest.match(CAP_CITY);
        if (!plain) continue;
        city = cityWithoutTail(trimSeparators(plain[2]));
        afterPlace = rest.slice(plain[0].length);
      }
      STREET_RE.lastIndex = 0;
      city = city.replace(/[.,;:]+$/, '');
      if (!city && !noCity) continue;
      const fromPreviousLine = i > 0 && !trimSeparators(before);
      let street = (cityFirst ? streetFrom(before) : streetBefore(before)) || (fromPreviousLine ? streetBefore(lines[i - 1]) : '');
      // solo la località qui, la via sulla riga prima: "Strada Eugubina 225" + "Loc. Pieve Pagliaccia Bosco"
      if (noCity && LOCALITY_START.test(street)) {
        const above = lines[i - (fromPreviousLine ? 2 : 1)];
        const road = above ? streetBefore(above) : '';
        if (road && !LOCALITY_START.test(road)) street = `${road}, ${street}`;
      }
      STREET_RE.lastIndex = 0;
      if (!province && !street) continue;
      city = smartCase(city);
      const country = COUNTRY_AFTER.test(afterPlace) ? 'Italia' : '';
      const address = [street, `${m[0]}${city ? ` ${city}` : ''}${province ? ` (${province})` : ''}`].filter(Boolean).join(', ');
      const context = `${fromPreviousLine ? lines[i - 1] : ''} ${before}`.slice(-160);
      out.push({
        address, street, cap: m[0], city, locality: localityOf(street), province, regionText: '', country,
        score: baseScore + (street ? 1 : 0) + (province ? 1 : 0),
        method, high: Boolean(street && province), legalSeat: LEGAL_SEAT.test(context),
        evidence: cleanText(`${fromPreviousLine ? `${lines[i - 1]} · ` : ''}${line}`, 240),
      });
    }
  });
}

const countryOf = (value) => normalizeCountry(cleanText(value, 60));

// Province e paese citati fuori da un indirizzo completo, anche su pagine diverse:
// "(PG)" da solo su una riga, "Magione (PG)", "Provincia di Perugia", "ITALY" da solo.
// Servono a completare la località dell'indirizzo principale (vedi crmModel.placeOf).
const PROVINCE_ALONE = /^\([ \t]*(\p{Lu}{2})[ \t]*\)$/u;
const CITY_PROVINCE = /(?<![\p{L}\d])(\p{Lu}[\p{L}'’]+(?:[ \t]+(?:(?:di|del|della|dei|sul|sulla|al|in)[ \t]+)?\p{Lu}[\p{L}'’]+){0,3})[ \t]*\([ \t]*(\p{Lu}{2})[ \t]*\)/gu;
const PROVINCE_NAMED = /provincia[ \t]+di[ \t]+(\p{Lu}[\p{L}'’]+(?:[ \t]+\p{Lu}[\p{L}'’]+)?)/giu;
const COUNTRY_ALONE = /^(?:[-–·|][ \t]*)?(italia|italy)\.?$/iu;

function geoMentions(text, method, add) {
  if (!text) return;
  const lines = text.split(/\n+/).map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean);
  for (const line of lines) {
    const province = (code, city, evidence) => {
      if (!isProvinceCode(code)) return;
      add('province', code, { method, score: 1, key: `${code}:${normKey(city)}`, evidence, extra: { code, city } });
    };
    const alone = line.match(PROVINCE_ALONE);
    if (alone) province(alone[1], '', line);
    for (const m of line.matchAll(CITY_PROVINCE)) {
      const city = smartCase(m[1]);
      if (!STREET_RE.test(city) && !CITY_TAIL.test(city)) province(m[2], city, snippet(line, m.index, m[0].length, 40));
      STREET_RE.lastIndex = 0;
    }
    for (const m of line.matchAll(PROVINCE_NAMED)) {
      const words = m[1].split(' ');
      const code = provinceFromName(m[1]) || provinceFromName(words[0]);
      if (code) province(code, '', snippet(line, m.index, m[0].length, 40));
    }
    if (COUNTRY_ALONE.test(line)) add('country', 'Italia', { method, score: 1, evidence: line });
  }
}

function composeAddress(parts, score, method, evidence) {
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
  if (!address) return null;
  return { address, street, cap, city, locality: localityOf(street), province, regionText, country: countryOf(parts.country), score, method, high: true, legalSeat: false, evidence };
}

function collectAddresses(ctx, add) {
  const found = [];
  const push = (c) => c && found.push(c);
  ctx.orgs.forEach((org, i) => {
    for (const a of asArray(org.node.address)) {
      const score = i === 0 ? 8 : 6;
      const evidence = `JSON-LD ${org.types.join(', ')}: address`;
      if (typeof a === 'string') {
        const before = found.length;
        addressesInText(decodeEntities(a), score, METHOD.jsonld, found);
        if (found.length === before) push(composeAddress({ street: decodeEntities(a) }, score, METHOD.jsonld, evidence));
      } else if (isObject(a)) {
        const country = isObject(a.addressCountry) ? ldText(a.addressCountry.name) : ldText(a.addressCountry);
        push(composeAddress({
          street: ldText(a.streetAddress), cap: ldText(a.postalCode), city: ldText(a.addressLocality), region: ldText(a.addressRegion), country,
        }, score, METHOD.jsonld, evidence));
      }
    }
  });
  const md = (prop) => str(ctx.microdata.find((m) => m.prop === prop)?.value);
  if (md('streetAddress') || md('addressLocality')) {
    push(composeAddress({ street: md('streetAddress'), cap: md('postalCode'), city: md('addressLocality'), region: md('addressRegion') }, 6, METHOD.microdata, 'itemprop="address"'));
  }
  const mb = (k) => str(ctx.meta[`business:contact_data:${k}`]);
  if (mb('street_address') || mb('locality')) {
    push(composeAddress({ street: mb('street_address'), cap: mb('postal_code'), city: mb('locality'), region: mb('region') }, 5, METHOD.metaBusiness, 'business:contact_data'));
  }
  for (const block of ctx.addressBlocks) addressesInText(block, 4, METHOD.addressTag, found);
  addressesInText(ctx.text.footer, 3, METHOD.footer, found);
  addressesInText(ctx.text.header, 2, METHOD.header, found);
  addressesInText(ctx.text.page, 1, METHOD.page, found);

  for (const c of found) {
    const { address, score, method, high, evidence, ...parts } = c;
    add('address', address, { method, score, high, evidence, extra: parts });
  }
  for (const [zone, method] of Object.entries(TEXT_METHOD)) geoMentions(ctx.text[zone === 'page' ? 'main' : zone], method, add);
}

// ---------------------------------------------------------------------------------------------
// persone

// [ruolo, priorità]: 1 = chi decide, 2 = direzione e accoglienza, 3 = commerciale e marketing, 4 = altri ruoli
const ROLES = [
  ['titolare', 1], ['titolari', 1], ['contitolare', 1], ['co-titolare', 1], ['proprietario', 1], ['proprietaria', 1],
  ['proprietari', 1], ['fondatore', 1], ['fondatrice', 1], ['co-fondatore', 1], ['co-fondatrice', 1],
  ['socio fondatore', 1], ['socia fondatrice', 1], ['amministratore unico', 1], ['amministratrice unica', 1],
  ['amministratore delegato', 1], ['amministratrice delegata', 1], ['amministratore', 1], ['amministratrice', 1],
  ['legale rappresentante', 1], ['presidente', 1], ['padrone di casa', 1], ['padrona di casa', 1],
  ['owner', 1], ['founder', 1], ['co-founder', 1], ['ceo', 1],
  ['direttore generale', 2], ['direttrice generale', 2], ['general manager', 2], ['managing director', 2],
  ['hotel manager', 2], ['host', 2], ['director', 2],
  ['direttore commerciale', 3], ['direttrice commerciale', 3], ['direttore marketing', 3], ['direttrice marketing', 3],
  ['responsabile commerciale', 3], ['responsabile vendite', 3], ['responsabile marketing', 3],
  ['responsabile export', 3], ['sales manager', 3], ['marketing manager', 3], ['export manager', 3],
  ['revenue manager', 3], ['event manager', 3], ['commerciale', 3],
  ['direttore', 4], ['direttrice', 4], ['responsabile', 4], ['vicepresidente', 4], ['socio', 4], ['socia', 4],
  ['enologo', 4], ['enologa', 4], ['agronomo', 4], ['agronoma', 4], ['chef', 4], ['sommelier', 4], ['gestore', 4],
  ['gestrice', 4], ['referente', 4], ['manager', 4], ['receptionist', 4], ['reception', 4], ['front office', 4],
  ['concierge', 4],
  // dalle informative privacy: vale solo se accanto c'è un nome vero ("Il titolare del trattamento è Mario Rossi")
  ['titolare del trattamento', 4],
];
const ROLE_PRIORITY = new Map(ROLES.map(([r, p]) => [normKey(r), p]));

// le parole del ruolo senza distinzione di maiuscole; i nomi invece devono avere l'iniziale maiuscola
const caseless = (phrase) => phrase
  .replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`)
  .replace(/-/g, '-?')
  .replace(/ /g, '[ \\t]+');
const ROLE = ROLES.map(([r]) => r).sort((a, b) => b.length - a.length).map(caseless).join('|');
const NAME_WORD = String.raw`(?:\p{Lu}['’]\p{Lu}\p{Ll}+|\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?|\p{Lu}['’]\p{Lu}{2,}|\p{Lu}{2,}(?:-\p{Lu}{2,})?)`;
// da 1 a 4 parole: il solo nome di battesimo vale solo se è un nome noto (vedi nameTokens)
const NAME = String.raw`${NAME_WORD}(?:[ \t]+${NAME_WORD}){0,3}`;
// "Titolare: Mario Rossi" / "Titolare\nMario Rossi" / "Host: Paolo" / "Il vostro host Paolo" / "Il vostro host è Paolo"
// titolo prima del nome: "Titolare: Dott. Roberto Berioli", "Ing. Anna Neri"
const HONORIFIC = String.raw`(?:(?:Dott(?:\.?ssa)?|Dr|Ing|Avv|Arch|Geom|Rag|Prof(?:\.?ssa)?|Sig(?:\.?r?a|\.?na)?|Mr|Mrs|Ms)\.?[ \t]+)?`;
const ROLE_THEN_NAME = new RegExp(String.raw`(?<!\p{L})(${ROLE})(?!\p{L})[ \t]*(?:[:\-–—,]|(?:è|e['’])(?!\p{L}))?[ \t]*(?:\n[ \t]*){0,2}${HONORIFIC}(${NAME})(?!\p{L})`, 'gu');
// "Mario Rossi – Titolare" / "Mario Rossi (titolare)" / "Mario Rossi\nTitolare" / "Paolo – Host" /
// "Paolo, host di …" / "Paolo, il vostro host"
const ROLE_ARTICLE = String.raw`(?:(?:[Ii]l|[Ll][ao])[ \t]+|[Ll]['’][ \t]*)?(?:(?:vostr[oaie]|nostr[oaie]|tu[oa])[ \t]+)?`;
const NAME_THEN_ROLE = new RegExp(String.raw`(?<!\p{L})(${NAME})[ \t]*(?:[,\-–—|:(/][ \t]*|(?:\n[ \t]*){1,2})${ROLE_ARTICLE}(${ROLE})(?!\p{L})`, 'gu');

// Ruoli scritti dal sito con parole proprie, fuori dall'elenco ROLES. Valgono solo in una scheda di
// contatto: il recapito (telefono o email) subito dopo il nome, e un nome di battesimo noto.
//   "Export, vendite, acquisti, logistica: Giulio Brandelli +39 349 5241724"
//   "Prenotazioni - Anna Neri 333 1234567" · "Anna Neri — Ufficio export — +39 …"
//   "Ufficio export\nAnna Neri\n+39 …"
const FREE_LABEL = String.raw`\p{L}[\p{L}'’ ,/&.()]{1,58}?`;
const PHONE_AHEAD = String.raw`(?:(?:tel|telefono|cell|cellulare|mob|mobile|whatsapp)\.?[ \t]*:?[ \t]*)?\+?\d[\d \t./-]{6,}\d`;
const CONTACT_AHEAD = String.raw`(?=[ \t]*(?:[,;·|][ \t]*)?(?:${PHONE_AHEAD}|(?:e-?mail[ \t]*:?[ \t]*)?[\w.+-]+@[\w-]+\.))`;
const LABEL_THEN_CONTACT = new RegExp(String.raw`(?:^|\n)[ \t]*(${FREE_LABEL})[ \t]*(?::|[ \t][-–—][ \t])[ \t]*${HONORIFIC}(${NAME})${CONTACT_AHEAD}`, 'gu');
const NAME_LABEL_CONTACT = new RegExp(String.raw`(?:^|\n)[ \t]*${HONORIFIC}(${NAME})[ \t]+[-–—|][ \t]*(${FREE_LABEL})[ \t]*[-–—|:][ \t]*(?=${PHONE_AHEAD}|[\w.+-]+@[\w-]+\.)`, 'gu');
const HEADING_THEN_CONTACT = new RegExp(String.raw`(?:^|\n)[ \t]*(${FREE_LABEL})[ \t]*:?[ \t]*\n[ \t]*${HONORIFIC}(${NAME})(?=[ \t]*(?:[,;·|][ \t]*)?${PHONE_AHEAD}|[ \t]*\n[ \t]*${PHONE_AHEAD})`, 'gu');
// etichette di un recapito o di una sezione, mai un ruolo
const FIELD_LABELS = new Set([
  'indirizzo', 'telefono', 'tel', 'cellulare', 'cell', 'mobile', 'mob', 'email', 'mail', 'fax', 'pec', 'whatsapp',
  'sede', 'operativa', 'orari', 'orario', 'apertura', 'partita', 'iva', 'piva', 'codice', 'fiscale', 'cap', 'via', 'viale',
  'piazza', 'localita', 'frazione', 'strada', 'contatti', 'contattaci', 'contatto', 'info', 'informazioni', 'scrivici',
  'chiamaci', 'seguici', 'newsletter', 'home', 'menu', 'copyright', 'privacy', 'cookie', 'cookies', 'policy', 'dove', 'siamo',
]);

/** Un'etichetta libera usata come ruolo, oppure '' se è un campo ("Indirizzo", "Tel.") o testo qualsiasi. */
function freeRole(label) {
  const role = cleanText(label, 80).replace(/[\s,.;:/&]+$/, '');
  const words = role.split(/[^\p{L}'’]+/u).filter(Boolean);
  if (role.length < 3 || words.length > 8 || words.some((w) => FIELD_LABELS.has(normKey(w)) || isLegalWord(w))) return '';
  return words.some((w) => normKey(w).length >= 3) ? role : '';
}

// parole che compaiono vicino ai ruoli ma non sono nomi di persona
const NOT_NAME = new Set([
  'chi', 'siamo', 'contatti', 'contattaci', 'contatto', 'contatta', 'scrivi', 'scrivici', 'home', 'menu', 'cerca',
  'news', 'blog', 'shop', 'carrello', 'accedi', 'login', 'area', 'riservata', 'lavora', 'con', 'noi',
  'azienda', 'agricola', 'agriturismo', 'cantina', 'cantine', 'tenuta', 'fattoria', 'podere', 'frantoio', 'oleificio',
  'hotel', 'ristorante', 'osteria', 'trattoria', 'resort', 'relais', 'masseria', 'casale', 'locanda', 'bed', 'breakfast',
  'camere', 'appartamenti', 'srl', 'srls', 'spa', 'snc', 'sas', 'societa', 'soc', 'coop', 'cooperativa', 'gruppo',
  'studio', 'agenzia', 'consorzio', 'il', 'i', 'gli', 'un', 'una', 'uno', 'nostro', 'nostra', 'nostri', 'nostre',
  'vostro', 'vostra', 'vostri', 'vostre', 'tuo', 'tua', 'sono', 'ecco', 'io', 'mi', 'vi', 'ti',
  'dott', 'dottssa', 'dr', 'avv', 'arch', 'geom', 'rag', 'prof', 'profssa', 'sig', 'sigra', 'signa',
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
  'titolare', 'titolari', 'contitolare', 'proprietario', 'proprietaria', 'proprietari', 'fondatore', 'fondatrice',
  'cofondatore', 'cofondatrice', 'socio', 'socia', 'amministratore', 'amministratrice', 'unico', 'unica', 'delegato',
  'delegata', 'legale', 'rappresentante', 'presidente', 'vicepresidente', 'direttore', 'direttrice', 'generale',
  'responsabile', 'manager', 'general', 'managing', 'director', 'sales', 'export', 'owner', 'founder', 'ceo',
  'enologo', 'enologa', 'agronomo', 'agronoma', 'chef', 'gestore', 'gestrice', 'referente', 'vendite', 'host',
  'sommelier', 'revenue', 'event', 'concierge', 'receptionist', 'front', 'office', 'padrone', 'padrona',
  // parole di collegamento dei titoli in maiuscolo ("DIFESA IN GIUDIZIO"), mai parte di un nome
  'in', 'per', 'questa', 'questo', 'non', 'nel', 'nella', 'sul', 'sulla',
]);

// Lessico delle informative privacy e delle note legali (senza accenti). Un "nome" che contiene una
// di queste parole è il titolo di una sezione, non una persona: "MODALITÀ DI TRATTAMENTO" seguito da
// "Il Titolare adotta…", "Dati personali – Titolare", "Base giuridica", "Diritti dell'interessato".
const LEGAL_WORDS = new Set([
  'modalita', 'trattamento', 'trattamenti', 'trattati', 'dati', 'dato', 'personali', 'personale', 'categorie',
  'categoria', 'tipologie', 'tipologia', 'finalita', 'base', 'basi', 'giuridica', 'giuridiche', 'giuridico',
  'interessato', 'interessata', 'interessati', 'diritto', 'diritti', 'periodo', 'conservazione', 'protezione',
  'consenso', 'revoca', 'opposizione', 'reclamo', 'garante', 'autorita', 'gdpr', 'regolamento', 'normativa',
  'decreto', 'legislativo', 'articolo', 'destinatari', 'comunicazione', 'diffusione', 'trasferimento',
  'conferimento', 'profilazione', 'sicurezza', 'misure', 'responsabili', 'incaricati', 'autorizzati', 'luogo',
  'tempi', 'durata', 'difesa', 'giudizio', 'modifiche', 'definizioni', 'riferimenti', 'legali', 'utente', 'utenti',
  'navigazione', 'tracciamento', 'raccolti', 'informazioni', 'titolarita',
  'data', 'personal', 'processing', 'controller', 'processor', 'protection', 'officer', 'purpose', 'purposes',
  'legal', 'basis', 'rights', 'retention', 'subject', 'subjects', 'consent',
]);
// anche dopo un apostrofo: "DELL'INTERESSATO"
const isLegalWord = (word) => word.split(/['’]/).some((part) => LEGAL_WORDS.has(normKey(part)));

/**
 * Validazione semantica di una persona: nome e cognome senza parole del lessico privacy/legale.
 * Vale per ogni persona, anche già salvata o arrivata dai dati strutturati.
 */
export function isPersonName(firstName, lastName = '') {
  const words = `${firstName || ''} ${lastName || ''}`.split(/\s+/).filter(Boolean);
  return words.length > 0 && !words.some(isLegalWord);
}

const PARTICLES = new Set(['de', 'di', 'del', 'della', 'dei', 'degli', 'delle', 'da', 'dal', 'dalla', 'dalle', 'dello', 'lo', 'la', 'le', 'li', 'van', 'von', 'du', 'des']);

// Parole del nome ripulite, oppure null se non sembra un nome di persona.
// anchor 'start': il nome segue il ruolo (si tiene l'inizio); 'end': lo precede (si tiene la fine).
// Una parola sola vale solo se è un nome di battesimo noto (persona parziale, senza cognome).
function nameTokens(raw, anchor = '', { allowSingle = false } = {}) {
  let words = cleanText(raw, 80).split(' ').map((w) => w.replace(/[.,;:]+$/, '')).filter(Boolean);
  const stop = (w) => NOT_NAME.has(normKey(w)) || isLegalWord(w);
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
  if (words.length === 1 && !(allowSingle && FIRST_NAMES.has(normKey(words[0])))) return null;
  if (words.length < 1 || words.length > 4) return null;
  if (words.some((w) => stop(w) || !/^\p{Lu}/u.test(w) || normKey(w).length < 2)) return null;
  return words.map(smartCase);
}

function splitName(words) {
  if (words.length === 1) return { firstName: words[0], lastName: '' };
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

// telefono fisso o cellulare a seconda del numero
function phoneFields(display, method) {
  if (!display) return {};
  const compact = normalizePhone(display);
  return compact.startsWith('+393')
    ? { mobile: formatPhone(compact), fieldMethods: { mobile: method } }
    : { phone: formatPhone(compact), fieldMethods: { phone: method } };
}

const person = (p) => ({
  firstName: '', lastName: '', role: '', priority: 5, email: '', phone: '', mobile: '', whatsapp: '', linkedin: '',
  method: '', reliability: 'check', evidence: '', order: 0, ...p, fieldMethods: { ...(p.fieldMethods || {}) },
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
    if (!firstName) {
      const words = nameTokens(ldText(node.name), '', { allowSingle: true });
      if (!words) return;
      ({ firstName, lastName } = splitName(words));
    }
    const role = ldText(node.jobTitle) || (links.some((l) => l.startsWith('founder')) ? 'Fondatore' : '');
    const linkedin = [...ldTexts(node.sameAs), ...ldTexts(node.url)].map(normalizeLinkedin).find((li) => li?.kind === 'profile')?.url || '';
    const phone = normalizePhone(ldText(node.telephone));
    const phones = phoneFields(phone ? formatPhone(phone) : '', METHOD.jsonld);
    const email = ownEmail(normalizeEmail(ldText(node.email)));
    out.push(person({
      firstName, lastName, role, linkedin, email, ...phones,
      fieldMethods: { ...phones.fieldMethods, ...(email ? { email: METHOD.jsonld } : {}), ...(linkedin ? { linkedin: METHOD.jsonld } : {}) },
      priority: role ? rolePriority(role) : staff ? 3 : 5,
      method: METHOD.jsonld,
      reliability: staff || role ? 'high' : 'check',
      evidence: `JSON-LD Person${links.filter(Boolean).length ? ` (${links.filter(Boolean).join(', ')})` : ''}: ${cleanText(`${firstName} ${lastName}`)}`,
      order: i,
    }));
  });
}

function peopleFromLinks(links, out) {
  links.forEach((link, i) => {
    const words = nameTokens(str(link.text) || str(link.label));
    if (!words) return;
    const { firstName, lastName } = splitName(words);
    const evidence = cleanText(`${str(link.text) || str(link.label)} → ${str(link.href)}`, 200);
    if (link.kind === 'mailto') {
      // un nome scritto su un link a info@ o visit@ non basta a fare una persona
      const email = ownEmail(normalizeEmail(str(link.href)));
      if (email) out.push(person({ firstName, lastName, email, fieldMethods: { email: METHOD.mailto }, method: METHOD.mailto, evidence, order: 500 + i }));
    } else if (link.kind === 'linkedin') {
      const li = normalizeLinkedin(str(link.href));
      if (li?.kind === 'profile') out.push(person({ firstName, lastName, linkedin: li.url, fieldMethods: { linkedin: METHOD.linkedin }, method: METHOD.linkedin, evidence, order: 500 + i }));
    }
  });
}

// le caselle dell'azienda (alias funzionali, PEC, indirizzi di sistema) non sono l'email di una persona
const ownEmail = (email) => (email && ['personal', 'company'].includes(emailCategory(email)) ? email : '');

// recapiti scritti subito dopo una persona (stessa scheda del team): email personale, cellulare,
// WhatsApp; un numero fisso solo sulla stessa riga (sulla riga dopo di solito è quello dell'azienda).
// Un'email senza forma da persona (es. agriturismolamora@) vale solo se contiene il suo nome.
function contactsNear(text, who) {
  const found = { fieldMethods: {} };
  const lineEnd = text.indexOf('\n') < 0 ? text.length : text.indexOf('\n');
  const clean = deobfuscate(text);
  for (const m of clean.matchAll(EMAIL_IN_TEXT)) {
    const email = normalizeEmail(m[0]);
    const category = email ? emailCategory(email) : '';
    if (category === 'personal' || (category === 'company' && emailMatchesPerson(email, who))) {
      found.email = email;
      found.fieldMethods.email = METHOD.nearName;
      break;
    }
  }
  for (const p of phonesInText(text)) {
    const display = formatPhone(normalizePhone(p.number));
    if (p.kind === 'whatsapp' && !found.whatsapp) {
      found.whatsapp = display;
      found.fieldMethods.whatsapp = METHOD.nearName;
    } else if (p.kind === 'phone') {
      const fields = phoneFields(display, METHOD.nearName);
      if (fields.phone && p.index > lineEnd) continue;
      for (const k of ['phone', 'mobile']) {
        if (fields[k] && !found[k]) {
          found[k] = fields[k];
          found.fieldMethods[k] = METHOD.nearName;
        }
      }
    }
  }
  if (!found.mobile) {
    const m = BARE_MOBILE.exec(text);
    BARE_MOBILE.lastIndex = 0;
    const compact = m ? normalizePhone(m[1]) : '';
    // un numero scritto come WhatsApp resta WhatsApp: non lo si chiama anche "cellulare"
    if (compact.startsWith('+393') && formatPhone(compact) !== found.whatsapp) {
      found.mobile = formatPhone(compact);
      found.fieldMethods.mobile = METHOD.nearName;
    }
  }
  return found;
}

// In un elenco "Nome – Ruolo / Nome – Ruolo" lo stesso ruolo può agganciarsi sia al nome prima
// sia a quello dopo: ogni ruolo e ogni nome si usano una volta sola, in ordine di lettura.
function peopleFromText(text, out, method = METHOD.page, orderBase = 1000) {
  if (!text) return;
  const pairs = [];
  for (const m of text.matchAll(ROLE_THEN_NAME)) {
    const nameAt = m.index + m[0].length - m[2].length;
    pairs.push({ rawName: m[2], rawRole: m[1], anchor: 'start', start: m.index, end: m.index + m[0].length, roleAt: m.index, nameAt });
  }
  for (const m of text.matchAll(NAME_THEN_ROLE)) {
    const roleAt = m.index + m[0].length - m[2].length;
    pairs.push({ rawName: m[1], rawRole: m[2], anchor: 'end', start: m.index, end: m.index + m[0].length, roleAt, nameAt: m.index });
  }
  const usedRoles = new Set();
  const usedNames = new Set();
  const accepted = [];
  for (const p of pairs.sort((a, b) => a.start - b.start)) {
    if (usedRoles.has(p.roleAt) || usedNames.has(p.nameAt)) continue;
    const words = nameTokens(p.rawName, p.anchor, { allowSingle: true });
    if (!words) continue;
    usedRoles.add(p.roleAt);
    usedNames.add(p.nameAt);
    accepted.push({ ...p, words });
  }
  // poi le etichette libere, solo per i nomi non già presi da un ruolo dell'elenco
  const free = [];
  const nameAtOf = (m, raw) => m.index + m[0].lastIndexOf(raw);
  for (const m of text.matchAll(LABEL_THEN_CONTACT)) free.push({ rawName: m[2], rawRole: m[1], start: m.index, end: m.index + m[0].length, nameAt: nameAtOf(m, m[2]) });
  for (const m of text.matchAll(NAME_LABEL_CONTACT)) free.push({ rawName: m[1], rawRole: m[2], start: m.index, end: m.index + m[0].length, nameAt: nameAtOf(m, m[1]) });
  for (const m of text.matchAll(HEADING_THEN_CONTACT)) free.push({ rawName: m[2], rawRole: m[1], start: m.index, end: m.index + m[0].length, nameAt: nameAtOf(m, m[2]) });
  for (const p of free.sort((a, b) => a.start - b.start)) {
    if (usedNames.has(p.nameAt)) continue;
    const role = freeRole(p.rawRole);
    const words = role ? nameTokens(p.rawName, 'start') : null;
    if (!words || words.length < 2 || !FIRST_NAMES.has(normKey(words[0]))) continue;
    usedNames.add(p.nameAt);
    // la persona va dal nome in poi: i recapiti si cercano subito dopo il nome
    const nameEnd = p.nameAt + p.rawName.length;
    accepted.push({ ...p, rawRole: role, words, start: p.nameAt, end: Math.max(nameEnd, p.end), roleAt: -1 - p.nameAt });
  }
  accepted.sort((a, b) => a.start - b.start);
  accepted.forEach((p, i) => {
    // i recapiti fino alla persona successiva, al massimo tre righe
    const limit = Math.min(accepted[i + 1]?.start ?? text.length, p.end + 220);
    const name = splitName(p.words);
    const near = contactsNear(text.slice(p.end, limit).split('\n').slice(0, 4).join('\n'), name);
    out.push(person({
      ...name,
      ...near,
      role: displayRole(p.rawRole),
      priority: rolePriority(p.rawRole),
      method,
      evidence: snippet(text, p.start, p.end - p.start, 30),
      order: orderBase + p.start,
    }));
  });
}

const personKey = (p) => normKey(`${p.firstName} ${p.lastName}`);

function mergePeople(list) {
  const byKey = new Map();
  for (const p of [...list].sort((a, b) => a.order - b.order)) {
    const key = personKey(p);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { ...p, fieldMethods: { ...p.fieldMethods } });
      continue;
    }
    for (const f of ['email', 'phone', 'mobile', 'whatsapp', 'linkedin']) {
      if (!current[f] && p[f]) {
        current[f] = p[f];
        current.fieldMethods[f] = p.fieldMethods[f] || p.method;
      }
    }
    if (p.role && (!current.role || p.priority < current.priority)) {
      current.role = p.role;
      current.priority = p.priority;
    }
    if (current.reliability !== 'high' && p.reliability === 'high') {
      Object.assign(current, { reliability: 'high', method: p.method, evidence: p.evidence });
    }
  }
  return [...byKey.values()];
}

// email con il nome della persona: nome@, nome.cognome@, m.rossi@, rossi.mario@; per un'email con
// forma da persona basta il cognome (maria.bianchi@), per le altre serve la combinazione esatta
function emailMatchesPerson(email, p) {
  const flat = normKey(email.split('@')[0].replace(/\d+$/, ''));
  const last = normKey(p.lastName);
  const first = normKey(p.firstName.split(' ')[0]);
  if (first.length >= 3 && flat === first) return true;
  if (last.length < 3) return false;
  if (emailCategory(email) === 'personal' && flat.includes(last)) return true;
  return first.length >= 1 && [first + last, first[0] + last, last + first, last + first[0]].includes(flat);
}

function profileMatchesPerson(url, p) {
  let slug = url.split('/in/')[1] || '';
  try { slug = decodeURIComponent(slug); } catch { /* resta com'è */ }
  slug = normKey(slug);
  const last = normKey(p.lastName);
  const first = normKey(p.firstName.split(' ')[0]);
  return last.length >= 3 && first.length >= 3 && slug.includes(last) && slug.includes(first);
}

function findPeople(ctx, facts) {
  const found = [];
  peopleFromJsonLd(ctx.ld, found);
  peopleFromLinks(ctx.links, found);
  // contenuto e footer separati: i recapiti dell'azienda nel footer non finiscono sull'ultima persona della pagina
  peopleFromText(ctx.text.main, found);
  // le persone del footer restano tali: lo stesso footer su ogni pagina non è «citata in più sezioni»
  // e se la stessa persona è anche nel contenuto, vale la menzione del contenuto (ordine più basso)
  if (ctx.text.main !== ctx.text.page) peopleFromText(ctx.text.footer, found, METHOD.footer, 100000);
  const people = mergePeople(found);

  const personalEmails = unique(facts.filter((f) => f.kind === 'email' && ownEmail(f.value) && !f.extra.gluedPrefixes && !f.extra.pec).map((f) => f.value));
  const profiles = unique(ctx.links
    .filter((l) => l.kind === 'linkedin')
    .map((l) => normalizeLinkedin(str(l.href)))
    .filter((li) => li?.kind === 'profile')
    .map((li) => li.url));
  for (const p of people) {
    if (!p.email) {
      const email = personalEmails.find((e) => emailMatchesPerson(e, p));
      if (email) Object.assign(p, { email, fieldMethods: { ...p.fieldMethods, email: METHOD.emailName } });
    }
    if (!p.linkedin) {
      const url = profiles.find((u) => profileMatchesPerson(u, p));
      if (url) Object.assign(p, { linkedin: url, fieldMethods: { ...p.fieldMethods, linkedin: METHOD.linkedinName } });
    }
  }
  // anche le persone dai dati strutturati e dai link passano la validazione semantica
  return people.filter((p) => isPersonName(p.firstName, p.lastName)).map(({ order, ...p }) => p);
}
