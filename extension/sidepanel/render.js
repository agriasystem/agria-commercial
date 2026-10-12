// Costruzione degli elementi del pannello. Tutto il testo che arriva dai siti analizzati va a
// schermo come testo (textContent, value), mai come HTML; i link si creano solo per http/https.

import { emailCategory } from '../lib/parser.js';
import { factsOf, missingForContact, peopleOf } from '../lib/siteData.js';
import { contactPerson, personLine } from '../lib/crmModel.js';

const PAGE_TYPES = {
  home: 'home', contact: 'contatti', about: 'chi siamo', team: 'team', legal: 'legale', hospitality: 'struttura', blog: 'blog', other: 'pagina',
};
const EMAIL_TAGS = { generic: 'aziendale generica', company: 'aziendale', personal: 'personale', pec: 'PEC', system: 'di sistema' };

/** el('p', { class: 'x', text: 'ciao', onclick }, figlio1, figlio2…) */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'text') node.textContent = v;
    else if (k === 'onclick') node.addEventListener('click', v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of children.flat()) {
    if (child == null || child === false || child === '') continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

const isWebUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);

/** Nome breve di una pagina: "contatti", "chi-siamo", "home". */
export function pageLabel(url) {
  try {
    const u = new URL(url);
    let path = u.pathname.replace(/\/+$/, '');
    try { path = decodeURIComponent(path); } catch { /* resta com'è */ }
    const label = `${path.split('/').filter(Boolean).slice(-2).join('/')}${u.search}`;
    return label ? label.slice(0, 40) : 'home';
  } catch {
    return 'pagina';
  }
}

/** Fonti cliccabili, una per pagina (la stessa pagina può aver dato il dato in più modi). */
function sourceLinks(sources, max) {
  const byPage = [];
  for (const s of sources) if (!byPage.some((x) => x.url === s.url)) byPage.push(s);
  const shown = byPage.slice(0, max).flatMap((s, i) => [i ? ', ' : '', sourceLink(s.url, s.evidence)]);
  return byPage.length > max ? [...shown, ` e altre ${byPage.length - max} pagine`] : shown;
}

/** Fonte cliccabile: apre la pagina in una nuova scheda. */
export function sourceLink(url, evidence = '') {
  if (!isWebUrl(url)) return el('span', { class: 'src' }, 'sito');
  return el('a', { class: 'src', href: url, target: '_blank', rel: 'noopener noreferrer', title: evidence || url }, pageLabel(url));
}

export function badge(reliability, edited = false) {
  if (edited) return el('span', { class: 'chip edit' }, 'Modificato a mano');
  if (reliability === 'high') return el('span', { class: 'chip high' }, 'Alta affidabilità');
  if (reliability === 'check') return el('span', { class: 'chip check' }, 'Da verificare');
  return null;
}

/** Riga sotto un campo: affidabilità, fonte, metodo (o il motivo per cui manca). */
export function fieldMeta(field, { invalid = '', analyzed = false, showEvidence = false } = {}) {
  const parts = [];
  if (invalid) parts.push(el('span', { class: 'bad' }, invalid));
  if (field.edited) parts.push(badge('', true));
  else if (field.value) {
    parts.push(badge(field.reliability));
    if (field.url) parts.push(el('span', {}, 'Fonte: ', sourceLink(field.url, field.evidence), field.method ? ` · ${field.method}` : ''));
    else if (field.method) parts.push(el('span', {}, field.method));
    if (showEvidence && field.evidence) parts.push(el('span', { class: 'ev' }, field.evidence));
  } else if (analyzed) parts.push(el('span', {}, 'Non trovato nel sito'));
  return parts.filter(Boolean);
}

/** Chip "Altri trovati" sotto un campo; onPick(valore) quando il commerciale ne sceglie uno. */
export function alternatives(values, onPick, max = 6) {
  const shown = values.slice(0, max);
  if (!shown.length) return [];
  return [
    el('span', { class: 'lbl' }, 'Altri trovati:'),
    ...shown.map((value) => el('button', { type: 'button', class: 'alt', title: `Usa questo valore: ${value}`, onclick: () => onPick(value) }, value)),
  ];
}

/** Stato del Contatto rispetto alla regola: nome + cognome + email, telefono o LinkedIn. */
export function contactReadiness(contact) {
  const person = contactPerson(Object.fromEntries(Object.entries(contact).map(([k, f]) => [k, f.value])));
  if (!Object.values(person).some(Boolean)) {
    return { ready: false, text: 'Nessun contatto: scegli una persona tra quelle rilevate o compila i campi a mano.' };
  }
  const missing = missingForContact(person);
  return missing.length
    ? { ready: false, text: `Contatto incompleto: manca ${missing.join(' e ')}. La base giuridica si conferma quando il contatto è completo.` }
    : { ready: true, text: 'Contatto completo: nome, cognome e almeno un recapito.' };
}

/** Schede delle persone rilevate, con evidenza e pulsante per farne il Contatto principale. */
export function peopleCards(site, mainKey, onUse) {
  return peopleOf(site).map((p) => {
    const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
    const contacts = [
      p.email && ['Email', p.email],
      p.phone && ['Tel.', p.phone],
      p.mobile && ['Cell.', p.mobile],
      p.whatsapp && ['WhatsApp', p.whatsapp],
    ].filter(Boolean);
    const main = p.key === mainKey;
    const missing = missingForContact(p);
    // persona parziale: si mostra, ma non diventa Contatto da sola (il cognome non si inventa)
    const status = p.partial
      ? [el('p', { class: 'person-tags' }, el('span', { class: 'chip check' }, 'Persona parziale')), el('p', { class: 'person-warn' }, 'Cognome non trovato')]
      : [missing.length ? el('p', { class: 'person-warn' }, `Non utilizzabile come Contatto HubSpot: manca ${missing.join(' e ')}.`) : null];
    return el('article', { class: `person${main ? ' main' : ''}${p.partial ? ' partial' : ''}` },
      el('div', { class: 'person-head' },
        el('span', { class: 'n' }, name, p.role ? ` — ${p.role}` : ''),
        badge(p.reliability)),
      ...status,
      contacts.length ? el('p', { class: 'person-contacts' }, ...contacts.map(([k, v]) => el('span', {}, `${k} ${v}`))) : null,
      isWebUrl(p.linkedin) ? el('p', { class: 'person-contacts' }, el('a', { href: p.linkedin, target: '_blank', rel: 'noopener noreferrer' }, 'Profilo LinkedIn')) : null,
      el('p', { class: 'person-src' },
        'Fonte: ', ...sourceLinks(p.sources, 3),
        p.sources[0]?.evidence ? el('span', { class: 'ev' }, `“${p.sources[0].evidence}”`) : null),
      main
        ? el('p', { class: 'person-main' }, '✓ Contatto principale')
        : el('button', { type: 'button', class: 'btn small', onclick: () => onUse(p.key) }, 'Usa come contatto'));
  });
}

// Ordine per importanza commerciale; i dati legali (non usati in HubSpot) in fondo, chiusi
const GROUPS = [
  ['Email', 'email', { open: true }],
  ['Telefoni', 'phone', { open: true, tag: (f) => (f.extra.mobile ? 'cellulare' : 'fisso') }],
  ['WhatsApp', 'whatsapp', { open: true }],
  ['Persone', 'people'],
  ['Indirizzi', 'address', { tag: (f) => (f.extra.legalSeat ? 'sede legale' : '') }],
  ['Social', 'social', { tag: (f) => f.extra.network }],
  ['P.IVA', 'piva', { tag: (f) => (f.extra.invalid ? 'cifra di controllo non valida' : '') }],
  ['Fax', 'fax'],
  ['Nomi commerciali', 'name'],
  ['Profili LinkedIn personali', 'linkedinProfile'],
  ['Sistemi esterni', 'system', { tag: (f) => f.extra.category }],
  ['Dati legali (non usati in HubSpot)', 'legal'],
];
const LEGAL_KINDS = [
  ['legalName', 'ragione sociale'],
  ['cf', 'codice fiscale', (f) => (f.extra.invalid ? 'controllo non superato' : '')],
  ['rea', 'REA'],
  ['cin', 'CIN'],
  ['sdi', 'codice SDI'],
];

function factItem(f, tags) {
  return el('li', {},
    el('div', { class: 'fact-head' },
      isWebUrl(f.value) ? el('a', { class: 'v', href: f.value, target: '_blank', rel: 'noopener noreferrer' }, f.value) : el('span', { class: 'v' }, f.value),
      ...tags.filter(Boolean).map((t) => el('span', { class: 'chip' }, t)),
      badge(f.reliability)),
    el('div', { class: 'fact-src' },
      'Fonte: ', ...sourceLinks(f.sources, 4),
      f.best?.method ? ` · ${f.best.method}` : ''));
}

function groupItems(site, kind, tag) {
  if (kind === 'people') {
    return peopleOf(site).map((p) => factItem(
      { value: personLine(p), reliability: p.reliability, sources: p.sources, best: p.sources[0] },
      [p.partial ? 'persona parziale' : '', p.eligible ? 'contatto possibile' : ''],
    ));
  }
  if (kind === 'legal') {
    return LEGAL_KINDS.flatMap(([k, label, flag]) => factsOf(site, k).map((f) => factItem(f, [label, flag?.(f)])));
  }
  if (kind === 'email') {
    // un'email assegnata a una persona rilevata è personale, qualunque forma abbia
    const own = new Set(peopleOf(site).map((p) => p.email).filter(Boolean));
    return factsOf(site, kind).map((f) => factItem(f, [own.has(f.value) ? 'personale' : EMAIL_TAGS[emailCategory(f.value, f.extra)]]));
  }
  return factsOf(site, kind).map((f) => factItem(f, [tag?.(f)]));
}

/** Sezione "Tutti i dati rilevati": ogni valore con affidabilità e fonti cliccabili. */
export function allDataGroups(site) {
  const groups = GROUPS.map(([title, kind, { open = false, tag } = {}]) => {
    const items = groupItems(site, kind, tag);
    if (!items.length) return null;
    return el('details', { class: `group${kind === 'legal' ? ' legal' : ''}`, open },
      el('summary', {}, `${title} `, el('span', { class: 'count' }, String(items.length))),
      el('ul', { class: 'facts' }, ...items));
  }).filter(Boolean);
  return groups.length ? groups : [el('p', { class: 'hint' }, 'Ancora nessun dato: avvia una scansione.')];
}

/** Elenco delle pagine analizzate e di quelle non raggiungibili. */
export function pagesList(site) {
  return [
    ...site.pages.map((p) => el('li', {}, sourceLink(p.url, p.title), el('span', { class: 'type' }, PAGE_TYPES[p.type] || 'pagina'))),
    ...site.failures.map((f) => el('li', { class: 'failed' }, sourceLink(f.url), el('span', { class: 'type' }, f.reason))),
  ];
}
