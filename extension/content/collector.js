// Content script di Agria Scout.
//
// Viene iniettato nella scheda attiva SOLO quando il commerciale preme «Analizza pagina»
// (chrome.scripting.executeScript dal pannello) e gira nel mondo isolato dell'estensione.
// Raccoglie una "fotografia" dei dati utili; l'interpretazione la fa lib/parser.js nel pannello.
//
// SOLO LETTURA: non modifica il DOM, non aggiunge stili né listener, non invia nulla in rete.
// Il valore dell'espressione finale è il risultato che riceve il pannello.
(() => {
  const MAX_TEXT = 200000;
  const MAX_LINKS = 400;
  const MAX_JSONLD_CHARS = 500000;
  const MAX_MICRODATA = 100;
  const HEADER = 'header, [role="banner"]';
  const FOOTER = 'footer, [role="contentinfo"], #footer, .footer, .site-footer, #colophon';
  const META_KEYS = new Set([
    'og:site_name', 'og:title', 'application-name', 'apple-mobile-web-app-title', 'description',
    'business:contact_data:street_address', 'business:contact_data:locality', 'business:contact_data:region',
    'business:contact_data:postal_code', 'business:contact_data:email', 'business:contact_data:phone_number',
  ]);
  const MICRODATA_PROPS = new Set(['telephone', 'email', 'streetAddress', 'postalCode', 'addressLocality', 'addressRegion']);

  const textOf = (el) => (el && typeof el.innerText === 'string' ? el.innerText : '');
  const clip = (s, max) => (s.length > max ? s.slice(0, max) : s);
  // solo gli elementi più esterni, per non leggere due volte un footer annidato in un altro
  const outermost = (selector) => {
    const all = Array.from(document.querySelectorAll(selector));
    return all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
  };
  const zoneOf = (el) => (el.closest(FOOTER) ? 'footer' : el.closest(HEADER) ? 'header' : 'page');

  const meta = {};
  for (const el of document.querySelectorAll('meta[name], meta[property]')) {
    const key = (el.getAttribute('property') || el.getAttribute('name') || '').trim().toLowerCase();
    if (META_KEYS.has(key) && !(key in meta)) meta[key] = clip((el.getAttribute('content') || '').trim(), 500);
  }

  const jsonld = [];
  let jsonldErrors = 0;
  let jsonldChars = 0;
  for (const el of document.querySelectorAll('script[type="application/ld+json" i]')) {
    const raw = el.textContent || '';
    jsonldChars += raw.length;
    if (jsonldChars > MAX_JSONLD_CHARS) break;
    try {
      jsonld.push(JSON.parse(raw));
    } catch {
      jsonldErrors += 1;
    }
  }

  const links = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const href = (a.getAttribute('href') || '').trim();
    const kind = /^mailto:/i.test(href) ? 'mailto' : /^tel:/i.test(href) ? 'tel' : /linkedin\.com\//i.test(href) ? 'linkedin' : '';
    if (!kind) continue;
    links.push({
      kind,
      href: clip(kind === 'linkedin' ? a.href : href, 500),
      text: clip(textOf(a).trim(), 200),
      label: clip((a.getAttribute('aria-label') || a.getAttribute('title') || '').trim(), 200),
      zone: zoneOf(a),
    });
    if (links.length >= MAX_LINKS) break;
  }

  const microdata = [];
  for (const el of document.querySelectorAll('[itemprop]')) {
    const prop = (el.getAttribute('itemprop') || '').trim();
    if (!MICRODATA_PROPS.has(prop)) continue;
    const content = el.getAttribute('content') || (el.tagName === 'A' ? el.getAttribute('href') : '') || textOf(el);
    microdata.push({ prop, value: clip(String(content || '').trim(), 300) });
    if (microdata.length >= MAX_MICRODATA) break;
  }

  const addresses = Array.from(document.querySelectorAll('address'), (el) => clip(textOf(el), 1000)).filter(Boolean).slice(0, 20);
  const joinText = (els) => clip(els.map(textOf).join('\n'), MAX_TEXT);
  const pageText = textOf(document.body);

  return {
    schema: 1,
    url: location.href,
    title: clip(document.title || '', 500),
    lang: document.documentElement.getAttribute('lang') || '',
    readyState: document.readyState,
    meta,
    jsonld,
    jsonldErrors,
    links,
    microdata,
    addresses,
    text: {
      header: joinText(outermost(HEADER)),
      footer: joinText(outermost(FOOTER)),
      page: clip(pageText, MAX_TEXT),
      truncated: pageText.length > MAX_TEXT,
    },
  };
})();
