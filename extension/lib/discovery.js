// Scoperta delle pagine da analizzare nella scansione approfondita.
// Funzioni pure: normalizzano gli URL, restano nello stesso dominio, scartano ciò che non è una
// pagina informativa e danno la priorità alle pagine utili (Contatti, Chi siamo, Team, legali…).

import { domainFromUrl } from './validation.js';

const TRACKING_PARAM = /^(utm_[a-z]+|fbclid|gclid|msclkid|mc_cid|mc_eid|_ga|_gl|ref|srsltid|yclid)$/i;
const NOT_HTML = /\.(pdf|jpe?g|png|gif|webp|svg|avif|ico|bmp|tiff?|zip|rar|7z|gz|docx?|xlsx?|pptx?|odt|ods|csv|mp[34]|m4a|mov|avi|wmv|webm|ogg|wav|css|js|mjs|json|xml|txt|ics|vcf|woff2?|ttf|eot|apk|exe|dmg)$/i;
const SKIP_PATH = /\/(wp-admin|wp-login\.php|wp-json|xmlrpc\.php|feed|rss|cart|carrello|checkout|cassa|my-account|mio-account|account|login|logout|register|registrati|wishlist|cdn-cgi|tag|tags|category|categoria|categorie|author|autore|search|cerca)(\/|$)|\/page\/\d+\/?$/i;
const SKIP_QUERY = /(^|&)(add-to-cart|replytocom|s|share|print|format|orderby|filter_[a-z]+|wc-ajax|action|download)=/i;
const LANGUAGE = /^(it|en|de|fr|es|nl|ru|zh|ja|pt|pl|cs|da|sv|no|fi)$/i;
const BLOG_SECTION = /^(blog|news|notizie|articoli|magazine|journal|press|stampa|archivio)$/i;

// parole che indicano il tipo di pagina (nell'indirizzo, nel titolo o nel testo del link)
const TYPE_TERMS = [
  ['contact', ['contatti', 'contatto', 'contattaci', 'contact', 'contacts', 'contact-us', 'dove-siamo', 'come-raggiungerci', 'raggiungerci', 'kontakt', 'richiedi-informazioni']],
  ['team', ['team', 'staff', 'persone', 'people', 'management', 'direzione', 'host', 'hosts', 'chi-ti-accoglie']],
  ['about', ['chi-siamo', 'chisiamo', 'about', 'about-us', 'azienda', 'storia', 'la-nostra-storia', 'famiglia', 'filosofia', 'who-we-are', 'history', 'company', 'ueber-uns']],
  ['legal', ['privacy', 'privacy-policy', 'cookie', 'cookies', 'cookie-policy', 'terms', 'termini', 'condizioni', 'termini-e-condizioni', 'legal', 'note-legali', 'notelegali', 'impressum', 'informativa', 'gdpr', 'dati-societari']],
  ['hospitality', ['villa', 'struttura', 'la-struttura', 'hospitality', 'hotel', 'agriturismo', 'cantina', 'frantoio', 'ristorante', 'spa', 'camere', 'rooms', 'suite', 'suites', 'appartamenti', 'ospitalita', 'accoglienza', 'wellness', 'benessere', 'relais', 'masseria', 'resort']],
  ['blog', ['blog', 'news', 'notizie', 'articoli', 'articolo', 'magazine', 'eventi', 'events', 'press', 'stampa', 'archivio', 'post', 'prodotto', 'prodotti', 'product', 'products', 'shop', 'negozio']],
];
const TYPE_SCORE = { contact: 100, home: 90, team: 85, about: 80, legal: 70, hospitality: 60, other: 25, blog: 3 };

const tokens = (text) => `-${String(text || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter(Boolean)
  .join('-')}-`;
const TYPE_TOKENS = TYPE_TERMS.map(([type, terms]) => [type, terms.map(tokens)]);

/** URL assoluto ripulito → { url, key, host } oppure null. La chiave unisce www/non-www e http/https. */
export function normalizePageUrl(raw, base) {
  let u;
  try {
    u = new URL(raw, base);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  u.hash = '';
  u.username = '';
  u.password = '';
  const params = [...u.searchParams].filter(([k]) => !TRACKING_PARAM.test(k)).sort(([a], [b]) => a.localeCompare(b));
  u.search = params.length ? `?${new URLSearchParams(params)}` : '';
  u.pathname = u.pathname.replace(/\/(index|default)\.(html?|php|aspx?)$/i, '/').replace(/\/{2,}/g, '/');
  const host = u.hostname.toLowerCase().replace(/^www\d*\./, '');
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : '/';
  return { url: u.href, key: `${host}${path}${u.search}`, host };
}

/** Stesso dominio del prospect (www compreso); i sottodomini e gli altri siti no. */
export function isSameSite(url, domain) {
  return Boolean(domain) && domainFromUrl(url) === domain;
}

/** Indirizzi da non scaricare: file, aree riservate, carrello, archivi del blog, ricerche. */
export function shouldSkip(url) {
  try {
    const u = new URL(url);
    return NOT_HTML.test(u.pathname) || SKIP_PATH.test(u.pathname) || SKIP_QUERY.test(u.search.slice(1));
  } catch {
    return true;
  }
}

export function languageOf(url) {
  try {
    const first = new URL(url).pathname.split('/').filter(Boolean)[0] || '';
    return LANGUAGE.test(first) ? first.toLowerCase() : '';
  } catch {
    return '';
  }
}

/** Tipo di pagina: home, contact, team, about, legal, hospitality, blog, other. */
export function pageTypeOf(url, text = '') {
  let path = '/';
  let query = '';
  try {
    const u = new URL(url);
    path = u.pathname;
    query = [...u.searchParams.keys()].filter((k) => k !== 'lang').join('&');
  } catch { /* resta la home */ }
  const segments = path.split('/').filter(Boolean);
  // "/?page_id=7" (WordPress senza permalink) non è la home: decide il testo del link
  const root = !segments.length || (segments.length === 1 && LANGUAGE.test(segments[0]));
  if (root && !query) return 'home';
  // tutto ciò che sta sotto /blog/, /news/… è un articolo, anche se il titolo parla di camere
  if (/\/(19|20)\d{2}\/\d{1,2}(\/|$)/.test(path) || BLOG_SECTION.test(segments[0] || '')) return 'blog';
  const fromPath = tokens(path);
  for (const [type, terms] of TYPE_TOKENS) if (terms.some((t) => fromPath.includes(t))) return type;
  const fromText = tokens(text);
  for (const [type, terms] of TYPE_TOKENS) if (terms.some((t) => fromText.includes(t))) return type;
  return 'other';
}

/** Priorità di una pagina: tipo, posizione del link (menu/footer), profondità, lingua. */
export function scorePage(url, { text = '', zone = '', language = '' } = {}) {
  const type = pageTypeOf(url, text);
  let score = TYPE_SCORE[type];
  const path = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return ''; } })();
  if (type === 'legal') score = /privacy/.test(path) ? 75 : /cookie/.test(path) ? 60 : 70;
  if (zone === 'nav' || zone === 'header' || zone === 'footer') score += 10;
  if (zone === 'sitemap') score -= 5;
  const depth = path.split('/').filter(Boolean).length;
  score -= Math.max(0, depth - 1) * 4;
  const lang = languageOf(url);
  if (lang && lang !== language && !(lang === 'it' && !language)) score -= 40; // stessa pagina in un'altra lingua
  return { score, type };
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Sitemap XML → { urls, sitemaps } (una sitemap indice elenca altre sitemap). */
export function parseSitemap(xml) {
  const text = String(xml || '');
  const locs = [...text.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s][^<\]]*?)\s*(?:\]\]>)?\s*<\/loc>/gi)]
    .map((m) => m[1].trim().replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => XML_ENTITIES[e]));
  return /<sitemapindex[\s>]/i.test(text) ? { urls: [], sitemaps: locs } : { urls: locs, sitemaps: [] };
}

/** Dalle sitemap di un indice, quelle delle pagine prima di quelle di articoli e prodotti. */
export function pickChildSitemaps(sitemaps, max = 3) {
  return sitemaps
    .filter((s) => !/(post|news|blog|product|prodott|category|tag|author|image|video|attachment)/i.test(s))
    .sort((a, b) => Number(/page|pagin/i.test(b)) - Number(/page|pagin/i.test(a)))
    .slice(0, max);
}
