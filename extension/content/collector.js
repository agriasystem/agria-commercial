// Content script di Scout (Agria Commercial): la "fotografia" di una pagina.
//
// Una sola funzione, usata in due modi:
//   - iniettata nella scheda attiva con chrome.scripting.executeScript({ func }) quando il
//     commerciale analizza la pagina aperta: legge il testo così come è mostrato (innerText);
//   - chiamata dal pannello su una pagina scaricata dalla scansione e letta con DOMParser
//     (documento inerte: niente script eseguiti, niente risorse caricate): mode 'parsed'.
// Per poter essere iniettata la funzione è autosufficiente: nessun riferimento esterno.
//
// SOLO LETTURA: non modifica il DOM, non aggiunge stili né listener, non invia nulla in rete.
// L'interpretazione dei dati la fa lib/parser.js nel pannello.

export function collectPageSnapshot(sourceDoc, sourceUrl, mode) {
  const doc = sourceDoc || document;
  const pageUrl = sourceUrl || location.href;
  const rendered = mode !== 'parsed';
  const MAX_TEXT = 200000;
  const MAX_LINKS = 800;
  const MAX_JSONLD_CHARS = 500000;
  const MAX_MICRODATA = 100;
  const MAX_RESOURCES = 150;
  const HEADER = 'header, [role="banner"]';
  const FOOTER = 'footer, [role="contentinfo"], #footer, .footer, .site-footer, #colophon';
  const NAV = 'nav, [role="navigation"]';
  const META_KEYS = new Set([
    'og:site_name', 'og:title', 'application-name', 'apple-mobile-web-app-title', 'description', 'generator',
    'business:contact_data:street_address', 'business:contact_data:locality', 'business:contact_data:region',
    'business:contact_data:postal_code', 'business:contact_data:email', 'business:contact_data:phone_number',
  ]);
  const MICRODATA_PROPS = new Set(['telephone', 'email', 'streetAddress', 'postalCode', 'addressLocality', 'addressRegion']);
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'HEAD', 'SELECT', 'OBJECT', 'CANVAS']);
  const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'CAPTION', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIELDSET',
    'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN',
    'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
  ]);

  const clip = (s, max) => (s.length > max ? s.slice(0, max) : s);
  const hidden = (el) => el.hasAttribute('hidden') || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(el.getAttribute('style') || '');
  // nel documento scaricato (non disegnato) innerText non va a capo: si ricostruiscono i blocchi
  const parsedText = (root) => {
    const out = [];
    const walk = (node) => {
      if (node.nodeType === 3) {
        out.push(node.nodeValue);
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName.toUpperCase();
      if (SKIP_TAGS.has(tag) || hidden(node)) return;
      if (tag === 'BR') {
        out.push('\n');
        return;
      }
      const block = BLOCK_TAGS.has(tag);
      if (block) out.push('\n');
      for (const child of node.childNodes) walk(child);
      if (block) out.push('\n');
    };
    walk(root);
    return out.join('').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  };
  const textOf = (el) => {
    if (!el) return '';
    return rendered && typeof el.innerText === 'string' ? el.innerText : parsedText(el);
  };
  // solo gli elementi più esterni, per non leggere due volte un footer annidato in un altro
  const outermost = (selector) => {
    const all = Array.from(doc.querySelectorAll(selector));
    return all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
  };
  const zoneOf = (el) => (el.closest(FOOTER) ? 'footer' : el.closest(HEADER) ? 'header' : el.closest(NAV) ? 'nav' : 'page');
  const base = (() => {
    if (rendered) return doc.baseURI;
    const tag = doc.querySelector('base[href]');
    try {
      return tag ? new URL(tag.getAttribute('href'), pageUrl).href : pageUrl;
    } catch {
      return pageUrl;
    }
  })();
  const absolute = (href) => {
    try {
      return new URL(href, base).href;
    } catch {
      return '';
    }
  };

  const meta = {};
  for (const el of doc.querySelectorAll('meta[name], meta[property]')) {
    const key = (el.getAttribute('property') || el.getAttribute('name') || '').trim().toLowerCase();
    if (META_KEYS.has(key) && !(key in meta)) meta[key] = clip((el.getAttribute('content') || '').trim(), 500);
  }

  const jsonld = [];
  let jsonldErrors = 0;
  let jsonldChars = 0;
  for (const el of doc.querySelectorAll('script[type="application/ld+json" i]')) {
    const raw = el.textContent || '';
    jsonldChars += raw.length;
    if (jsonldChars > MAX_JSONLD_CHARS) break;
    try {
      jsonld.push(JSON.parse(raw));
    } catch {
      jsonldErrors += 1;
    }
  }

  // link: mailto, tel, WhatsApp, LinkedIn e tutti gli altri link web (interni per la scansione,
  // esterni per social e sistemi di prenotazione)
  const links = [];
  const seen = new Set();
  for (const a of doc.querySelectorAll('a[href]')) {
    const raw = (a.getAttribute('href') || '').trim();
    let kind = '';
    let href = raw;
    if (/^mailto:/i.test(raw)) kind = 'mailto';
    else if (/^tel:/i.test(raw)) kind = 'tel';
    else if (/^whatsapp:/i.test(raw)) kind = 'whatsapp';
    else if (!/^(javascript|data|sms|callto|#)/i.test(raw) && raw) {
      href = absolute(raw);
      if (!/^https?:/i.test(href)) continue;
      kind = /(^https?:\/\/(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\/)/i.test(href) ? 'whatsapp'
        : /linkedin\.com\//i.test(href) ? 'linkedin' : 'web';
    }
    if (!kind) continue;
    const text = clip(textOf(a).replace(/\s+/g, ' ').trim(), 200);
    const id = `${kind}|${href}|${text}`;
    if (seen.has(id)) continue;
    seen.add(id);
    links.push({
      kind,
      href: clip(href, 500),
      text,
      label: clip((a.getAttribute('aria-label') || a.getAttribute('title') || '').trim(), 200),
      zone: zoneOf(a),
    });
    if (links.length >= MAX_LINKS) break;
  }

  // script e iframe esterni: rivelano booking engine, e-commerce e CMS
  const resources = [];
  for (const el of doc.querySelectorAll('script[src], iframe[src], link[rel~="stylesheet"][href]')) {
    const src = absolute(el.getAttribute('src') || el.getAttribute('href') || '');
    if (/^https?:/i.test(src) && !resources.includes(src)) resources.push(clip(src, 300));
    if (resources.length >= MAX_RESOURCES) break;
  }

  const microdata = [];
  for (const el of doc.querySelectorAll('[itemprop]')) {
    const prop = (el.getAttribute('itemprop') || '').trim();
    if (!MICRODATA_PROPS.has(prop)) continue;
    const content = el.getAttribute('content') || (el.tagName.toUpperCase() === 'A' ? el.getAttribute('href') : '') || textOf(el);
    microdata.push({ prop, value: clip(String(content || '').trim(), 300) });
    if (microdata.length >= MAX_MICRODATA) break;
  }

  const addresses = Array.from(doc.querySelectorAll('address'), (el) => clip(textOf(el), 1000)).filter(Boolean).slice(0, 20);
  const headingsOf = (selector) => Array.from(doc.querySelectorAll(selector), (el) => clip(textOf(el).replace(/\s+/g, ' ').trim(), 150)).filter(Boolean).slice(0, 30);
  const headings = headingsOf('h1, h2');
  // h3: solo per riconoscere il marchio e le sezioni dei servizi (non pesano nelle parole di settore)
  const subheadings = headingsOf('h3');
  const joinText = (els) => clip(els.map(textOf).join('\n'), MAX_TEXT);
  const pageText = textOf(doc.body);
  const titleTag = doc.querySelector('title');

  return {
    schema: 2,
    url: pageUrl,
    title: clip((rendered ? doc.title : titleTag?.textContent || '').trim(), 500),
    lang: doc.documentElement?.getAttribute('lang') || '',
    meta,
    jsonld,
    jsonldErrors,
    links,
    resources,
    microdata,
    addresses,
    headings,
    subheadings,
    text: {
      header: joinText(outermost(HEADER)),
      footer: joinText(outermost(FOOTER)),
      page: clip(pageText, MAX_TEXT),
      truncated: pageText.length > MAX_TEXT,
    },
  };
}
