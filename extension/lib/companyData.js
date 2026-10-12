// Dati societari, social, sistemi esterni e segnali di settore di una pagina.
// Le pagine legali (privacy, termini, note legali) sono la fonte migliore per ragione sociale,
// P.IVA, codice fiscale, REA e PEC. Ogni valore viene dal testo o dai link: nessuna deduzione
// diversa da quelle dichiarate nella fonte.

import { cleanText, isValidCodiceFiscale, isValidPartitaIva, normalizeLinkedin, normKey, snippet } from './validation.js';
import { isProvinceCode } from './italy.js';

export const METHOD = {
  label: 'dato etichettato nel testo',
  legalText: 'testo legale',
  suffix: 'denominazione con forma societaria',
  social: 'link social',
  resource: 'codice della pagina',
  link: 'link della pagina',
  generator: 'meta tag generator',
};

// ---------------------------------------------------------------------------------------------
// ragione sociale

// lettere senza distinzione di maiuscole, lasciando intatte le sequenze come \s: il flag i non
// si può usare perché renderebbe \p{Lu} vero anche per le minuscole
const caseless = (source) => source.replace(/(\\)?([a-zà])/g, (m, esc, ch) => (esc ? m : `[${ch}${ch.toUpperCase()}]`));
const LEGAL_SUFFIX = caseless(String.raw`(?:s\.?\s?r\.?\s?l\.?(?:\s?s\.?)?|s\.?\s?p\.?\s?a\.?|s\.?\s?n\.?\s?c\.?|s\.?\s?a\.?\s?s\.?|s\.?\s?c\.?\s?a\.?\s?r\.?\s?l\.?|soc(?:ietà|\.)\s+(?:coop(?:erativa)?\.?|agricola|semplice)(?:\s+(?:agricola|a\s+r\.?\s?l\.?|s\.?\s?r\.?\s?l\.?))?|s\.?\s?s\.?(?=\s|$|[,;·|)]))`);
const LEGAL_SUFFIX_END = new RegExp(String.raw`[\s,]+${LEGAL_SUFFIX}\s*$`, 'u');
const WORD = String.raw`\p{Lu}[\p{L}'’&.-]*`;
const STREET_START = /^(via|viale|piazza|corso|strada|località|loc\.|frazione|vocabolo|contrada|s\.s\.|s\.p\.)\s/i;
const JOIN = String.raw`(?:di|de|del|della|dei|degli|delle|e|&|la|il|le|lo|l['’]|d['’])`;
// "Agriturismo La Mora S.r.l.", "Cantina Rossi Soc. Agricola s.s."
const NAME_WITH_SUFFIX = new RegExp(String.raw`(${WORD}(?:[ \t]+(?:${WORD}|${JOIN})){0,7})[ \t,]+(${LEGAL_SUFFIX})(?=[\s,;·|)–-]|$)`, 'gu');
const LEGAL_LABEL = /(?:ragione\s+sociale|denominazione(?:\s+sociale)?)\s*[:.]\s*([^\n,;|]{3,90})/gi;
const DATA_CONTROLLER = /titolare\s+del\s+trattamento(?:\s+dei\s+(?:suoi\s+|tuoi\s+|vostri\s+)?dati(?:\s+personali)?)?\s*(?:è|e'|:|,)\s*(?:la\s+società\s+|l['’]azienda\s+|la\s+ditta\s+|l['’]impresa\s+)?([^\n,;(]{3,100})/gi;
const CONTROLLER_STOP = /\s(?:con\s+sede|in\s+persona|nella\s+persona|con\b|p\.?\s?iva|c\.\s?f\.|codice\s+fiscale|-|–|·)/i;

export function hasLegalSuffix(text) {
  return LEGAL_SUFFIX_END.test(cleanText(text));
}

export function stripLegalSuffix(text) {
  return cleanText(text).replace(LEGAL_SUFFIX_END, '').trim();
}

function plausibleLegalName(s) {
  return s.length >= 3 && s.length <= 100 && /^\p{Lu}/u.test(s) && !STREET_START.test(s) && !/https?:|@/.test(s);
}

function legalNames(text, add, baseScore, extra = {}) {
  for (const m of text.matchAll(NAME_WITH_SUFFIX)) {
    const name = cleanText(`${m[1]} ${m[2]}`);
    if (plausibleLegalName(name)) add('legalName', name, { method: METHOD.suffix, score: baseScore, evidence: snippet(text, m.index, m[0].length), extra });
  }
  for (const m of text.matchAll(LEGAL_LABEL)) {
    const name = cleanText(m[1]);
    if (plausibleLegalName(name)) add('legalName', name, { method: METHOD.label, score: baseScore + 2, high: true, evidence: snippet(text, m.index, m[0].length), extra });
  }
  for (const m of text.matchAll(DATA_CONTROLLER)) {
    let name = cleanText(m[1].split(CONTROLLER_STOP)[0]).replace(/[\s,;:]+$/, '');
    if (/[a-z]{4,}\.$/i.test(name)) name = name.slice(0, -1); // punto finale della frase, non di "S.r.l."
    if (plausibleLegalName(name) && (hasLegalSuffix(name) || /\p{Lu}\S*\s+\p{Lu}/u.test(name))) {
      add('legalName', name, { method: METHOD.legalText, score: baseScore + 1, high: hasLegalSuffix(name), evidence: snippet(text, m.index, m[0].length), extra });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// identificativi: P.IVA, codice fiscale, REA, CIN, SDI

const PIVA_LABEL = String.raw`(?:p\.?\s?iva|partita\s+iva|p\.\s?i\.|vat(?:\s+(?:no|number|n\.?|id))?)`;
const CF_LABEL = String.raw`(?:c\.\s?f\.?|cod(?:ice)?\.?\s*fisc(?:ale)?\.?|fiscal\s+code|tax\s+code)`;
const ID_RE = new RegExp(
  String.raw`((?:${PIVA_LABEL}|${CF_LABEL})(?:\s*(?:e|\/|-|&|,)\s*(?:${PIVA_LABEL}|${CF_LABEL}))*)\s*[:.\-]?\s*(?:n(?:r|°|\.)?\.?\s*)?[:.]?\s*((?:IT)?[ ]?[A-Z0-9]{11,16})(?![A-Z0-9])`,
  'gi',
);
const REA_RE = /(?:\bR\.?\s?E\.?\s?A\.?|\bREA)(?![A-Za-z])\s*(?:n(?:r|°|\.)?\.?\s*)?[:.]?\s*(?:([A-Za-z]{2})\s*[-–/ ]?\s*)?(\d{4,7})(?!\d)/g;
const CIN_RE = /(?:\bCIN\b|codice\s+identificativo\s+nazionale)\s*[:.]?\s*(IT\s?\d{6}[A-Z0-9]{5,12})(?![A-Z0-9])/gi;
const SDI_RE = /(?:codice\s+(?:sdi|destinatario|univoco)(?:\s+sdi)?|\bSDI\b)\s*[:.]?\s*([A-Z0-9]{7})(?![A-Za-z0-9])/gi;

function identifiers(text, add) {
  for (const m of text.matchAll(ID_RE)) {
    const labels = m[1].toLowerCase();
    const value = m[2].replace(/^IT\s?/i, '').toUpperCase();
    const evidence = snippet(text, m.index, m[0].length);
    if (/iva|vat/.test(labels) && /^\d{11}$/.test(value)) {
      const valid = isValidPartitaIva(value);
      add('piva', value, { method: METHOD.label, score: 6, high: valid, evidence, extra: { invalid: !valid } });
    }
    if (/c\.\s?f|fisc|fiscal|tax/.test(labels)) {
      const valid = isValidCodiceFiscale(value);
      if (valid || /^\d{11}$|^[A-Z0-9]{16}$/.test(value)) add('cf', value, { method: METHOD.label, score: 6, high: valid, evidence, extra: { invalid: !valid } });
    }
  }
  for (const m of text.matchAll(REA_RE)) {
    const province = (m[1] || '').toUpperCase();
    if (m[1] && !isProvinceCode(province)) continue;
    add('rea', province ? `${province}-${m[2]}` : m[2], { method: METHOD.label, score: 6, high: Boolean(province), evidence: snippet(text, m.index, m[0].length) });
  }
  for (const m of text.matchAll(CIN_RE)) {
    add('cin', m[1].replace(/\s/g, '').toUpperCase(), { method: METHOD.label, score: 6, high: true, evidence: snippet(text, m.index, m[0].length) });
  }
  for (const m of text.matchAll(SDI_RE)) {
    if (m[1] !== m[1].toUpperCase() || !/\d/.test(m[1])) continue; // "fattura" non è un codice
    add('sdi', m[1], { method: METHOD.label, score: 6, high: true, evidence: snippet(text, m.index, m[0].length) });
  }
}

// ---------------------------------------------------------------------------------------------
// social

const SOCIAL_SKIP = /^(sharer|sharer\.php|share|share\.php|dialog|plugins|tr|login|l\.php|intent|home|i|p|reel|reels|explore|stories|tv|accounts|watch|embed|hashtag|search|pin)$/i;

/** Link a un profilo social → { network, url } oppure null (i pulsanti "condividi" non contano). */
export function socialProfile(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile|it-it|business|it)\./, '');
  const parts = u.pathname.split('/').filter(Boolean);
  const first = parts[0] || '';
  if (!first || SOCIAL_SKIP.test(first)) return null;
  if (host === 'instagram.com') return { network: 'Instagram', url: `https://www.instagram.com/${first}/` };
  if (host === 'facebook.com' || host === 'fb.com') {
    if (first === 'profile.php') return u.searchParams.get('id') ? { network: 'Facebook', url: `https://www.facebook.com/profile.php?id=${u.searchParams.get('id')}` } : null;
    const path = first === 'pages' ? parts.slice(0, 3).join('/') : first;
    return { network: 'Facebook', url: `https://www.facebook.com/${path}` };
  }
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
    const li = normalizeLinkedin(href);
    return li?.kind === 'company' ? { network: 'LinkedIn', url: li.url } : null;
  }
  if (host === 'youtube.com' && /^(channel|c|user|@.+)$/.test(first)) {
    return { network: 'YouTube', url: `https://www.youtube.com/${first.startsWith('@') ? first : parts.slice(0, 2).join('/')}` };
  }
  if (host === 'tiktok.com' && first.startsWith('@')) return { network: 'TikTok', url: `https://www.tiktok.com/${first}` };
  if (host === 'twitter.com' || host === 'x.com') return { network: 'X (Twitter)', url: `https://x.com/${first}` };
  if (/^pinterest\.[a-z.]+$/.test(host)) return { network: 'Pinterest', url: `https://www.pinterest.com/${first}/` };
  if (/^tripadvisor\.[a-z.]+$/.test(host) && /_Review-/.test(first)) return { network: 'Tripadvisor', url: `https://${u.hostname}/${first}` };
  return null;
}

// ---------------------------------------------------------------------------------------------
// sistemi esterni: booking engine, portali, prenotazione ristorante, e-commerce, CMS

const SYSTEMS = [
  [/(^|\.)octorate\.com$/, 'Octorate', 'Booking engine'],
  [/(^|\.)simplebooking\.(it|travel)$/, 'Simple Booking', 'Booking engine'],
  [/(^|\.)verticalbooking\.com$/, 'Vertical Booking', 'Booking engine'],
  [/(^|\.)krossbooking\.com$/, 'Kross Booking', 'Booking engine'],
  [/(^|\.)scidoo\.com$/, 'Scidoo', 'Booking engine'],
  [/(^|\.)slope\.it$/, 'Slope', 'Booking engine'],
  [/(^|\.)bedzzle\.com$/, 'Bedzzle', 'Booking engine'],
  [/(^|\.)blastness\.(com|biz)$/, 'Blastness', 'Booking engine'],
  [/(^|\.)hotelincloud\.com$/, 'HotelinCloud', 'Booking engine'],
  [/(^|\.)(siteminder\.com|thebookingbutton\.com)$/, 'SiteMinder', 'Booking engine'],
  [/(^|\.)cloudbeds\.com$/, 'Cloudbeds', 'Booking engine'],
  [/(^|\.)beddy\.io$/, 'Beddy', 'Booking engine'],
  [/(^|\.)wubook\.net$/, 'WuBook', 'Booking engine'],
  [/(^|\.)smoobu\.com$/, 'Smoobu', 'Booking engine'],
  [/(^|\.)lodgify\.com$/, 'Lodgify', 'Booking engine'],
  [/(^|\.)avaibook\.com$/, 'AvaiBook', 'Booking engine'],
  [/(^|\.)mews\.(com|li)$/, 'Mews', 'Booking engine'],
  [/(^|\.)synxis\.com$/, 'SynXis', 'Booking engine'],
  [/(^|\.)(d-edge\.com|availpro\.com)$/, 'D-EDGE', 'Booking engine'],
  [/(^|\.)bookassist\.(org|com)$/, 'Bookassist', 'Booking engine'],
  [/(^|\.)booking\.com$/, 'Booking.com', 'Portale'],
  [/(^|\.)airbnb\.[a-z.]+$/, 'Airbnb', 'Portale'],
  [/(^|\.)expedia\.[a-z.]+$/, 'Expedia', 'Portale'],
  [/(^|\.)agriturismo\.it$/, 'Agriturismo.it', 'Portale'],
  [/(^|\.)(thefork\.[a-z.]+|lafourchette\.[a-z.]+)$/, 'TheFork', 'Prenotazione ristorante'],
  [/(^|\.)quandoo\.[a-z.]+$/, 'Quandoo', 'Prenotazione ristorante'],
  [/(^|\.)opentable\.[a-z.]+$/, 'OpenTable', 'Prenotazione ristorante'],
  [/(^|\.)(myshopify\.com|shopify\.com)$/, 'Shopify', 'E-commerce'],
  [/(^|\.)(wix\.com|wixstatic\.com|parastorage\.com)$/, 'Wix', 'CMS'],
  [/(^|\.)(squarespace\.com|squarespace-cdn\.com)$/, 'Squarespace', 'CMS'],
  [/(^|\.)(jimdo\.com|jimdocdn\.com|jimcdn\.com)$/, 'Jimdo', 'CMS'],
  [/(^|\.)webflow\.(com|io)$/, 'Webflow', 'CMS'],
  [/(^|\.)iubenda\.com$/, 'iubenda', 'Privacy e cookie'],
];
const GENERATORS = [[/wordpress/i, 'WordPress'], [/joomla/i, 'Joomla'], [/drupal/i, 'Drupal'], [/wix/i, 'Wix'], [/prestashop/i, 'PrestaShop']];

function systemOf(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  const host = u.hostname.toLowerCase();
  for (const [re, name, category] of SYSTEMS) if (re.test(host)) return { name, category, host };
  if (/\/wp-content\/plugins\/woocommerce\//.test(u.pathname)) return { name: 'WooCommerce', category: 'E-commerce', host };
  if (/\/wp-(content|includes)\//.test(u.pathname)) return { name: 'WordPress', category: 'CMS', host };
  return null;
}

// ---------------------------------------------------------------------------------------------
// segnali di settore: parole contate con un peso (titolo e intestazioni contano di più)

const SIGNAL_TERMS = [
  'agriturismo', 'agriturismi', 'hotel', 'albergo', 'relais', 'resort', 'masseria', 'boutique hotel', 'b&b',
  'bed and breakfast', 'camere', 'suite', 'soggiorno', 'soggiorni', 'pernottamento', 'ospiti', 'check-in',
  'casa vacanze', 'appartamenti', 'ospitalità', 'colazione', 'piscina', 'ristorante', 'restaurant', 'osteria',
  'trattoria', 'spa', 'centro benessere', 'wellness',
  'cantina', 'cantine', 'vino', 'vini', 'vigneto', 'vigneti', 'vendemmia', 'degustazione', 'degustazioni',
  'enoteca', 'winery', 'wine', 'docg', 'vitigno', 'vitigni', 'barrique',
  'frantoio', 'frantoi', 'olio extravergine', 'extravergine', 'extra vergine', 'olio evo', 'olivicolo',
  'olivicola', 'oliveto', 'oliveti', 'olive', 'molitura', 'oleificio',
];
const SIGNAL_RE = new RegExp(String.raw`(?<![\p{L}&])(${SIGNAL_TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|')})(?![\p{L}&])`, 'giu');
const SCHEMA_SIGNALS = {
  LodgingBusiness: 'schema:alloggio', Hotel: 'schema:hotel', Resort: 'schema:resort', BedAndBreakfast: 'schema:b&b',
  Motel: 'schema:alloggio', Hostel: 'schema:alloggio', Campground: 'schema:alloggio', Winery: 'schema:cantina',
  Vineyard: 'schema:cantina', Restaurant: 'schema:ristorante', FoodEstablishment: 'schema:ristorante',
};
const PER_TERM_BODY_CAP = 15;

function countTerms(text, weight, cap, into) {
  if (!text) return;
  const local = {};
  for (const m of text.matchAll(SIGNAL_RE)) {
    const term = m[1].toLowerCase().replace(/\s+/g, ' ');
    local[term] = (local[term] || 0) + 1;
  }
  for (const [term, n] of Object.entries(local)) into[term] = (into[term] || 0) + Math.min(n, cap) * weight;
}

/** Parole di settore pesate: { termine: punteggio }. */
export function collectSignals(ctx) {
  const signals = {};
  countTerms(ctx.title, 5, 3, signals);
  countTerms(ctx.headings.join('\n'), 3, 5, signals);
  countTerms(ctx.meta.description || '', 3, 3, signals);
  countTerms(ctx.text.page, 1, PER_TERM_BODY_CAP, signals);
  for (const n of ctx.ld) for (const t of n.types) if (SCHEMA_SIGNALS[t]) signals[SCHEMA_SIGNALS[t]] = (signals[SCHEMA_SIGNALS[t]] || 0) + 10;
  return signals;
}

// ---------------------------------------------------------------------------------------------

/** Ragione sociale, identificativi, social e sistemi esterni della pagina. */
export function collectCompanyData(ctx, add) {
  // il footer pesa più del resto del testo; le pagine legali ricevono il bonus dal parser
  legalNames(ctx.text.footer, add, 5, { fromFooter: true });
  legalNames(ctx.text.main, add, 4);
  identifiers(ctx.text.page, add);

  for (const link of ctx.links) {
    if (link.kind !== 'web' && link.kind !== 'linkedin') continue;
    const href = typeof link.href === 'string' ? link.href : '';
    const profile = normalizeLinkedin(href);
    if (profile?.kind === 'profile') add('linkedinProfile', profile.url, { method: METHOD.link, score: 4, high: true, key: profile.url.toLowerCase(), evidence: cleanText(`${link.text || link.label || ''} ${href}`, 200) });
    const social = socialProfile(href);
    if (social) add('social', social.url, { method: METHOD.social, score: 5 + (link.zone === 'footer' || link.zone === 'header' ? 1 : 0), high: true, key: social.url.toLowerCase(), evidence: cleanText(`${link.text || link.label || ''} ${href}`, 200), extra: { network: social.network } });
    const system = systemOf(href);
    if (system) add('system', system.name, { method: METHOD.link, score: 5, high: true, key: normKey(system.name), evidence: cleanText(`${link.text || ''} → ${system.host}`, 200), extra: { category: system.category } });
  }
  for (const src of ctx.resources) {
    const system = systemOf(src);
    if (system) add('system', system.name, { method: METHOD.resource, score: 4, high: true, key: normKey(system.name), evidence: system.host, extra: { category: system.category } });
  }
  const generator = String(ctx.meta.generator || '');
  for (const [re, name] of GENERATORS) {
    if (re.test(generator)) add('system', name, { method: METHOD.generator, score: 4, high: true, key: normKey(name), evidence: `generator: ${cleanText(generator, 80)}`, extra: { category: 'CMS' } });
  }
}
