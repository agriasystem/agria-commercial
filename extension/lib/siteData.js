// Dati del sito accumulati pagina dopo pagina.
// Ogni valore è salvato una volta sola (email, telefoni, URL, indirizzi e persone normalizzati)
// e conserva TUTTE le sue fonti: pagina, metodo di rilevazione, affidabilità ed evidenza.
// Funzioni pure: restituiscono sempre un oggetto nuovo.

import { normKey } from './validation.js';
import { isPersonName, METHOD } from './parser.js';

const MAX_SOURCES = 10;
const MAX_FAILURES = 50;
const MAX_NOTES = 10;
const PERSON_FIELDS = ['email', 'phone', 'mobile', 'whatsapp', 'linkedin'];

export function emptySite() {
  return { domain: '', origin: '', pages: [], failures: [], facts: {}, people: {}, signals: {}, notes: [] };
}

export const personKey = (p) => normKey(`${p.firstName} ${p.lastName}`);

function mergeFact(facts, fact, page) {
  const id = `${fact.kind}:${fact.key}`;
  const current = facts[id] || (facts[id] = { kind: fact.kind, key: fact.key, value: fact.value, extra: {}, sources: [] });
  const source = { url: page.url, pageType: page.type, method: fact.method, score: fact.score, reliability: fact.reliability, evidence: fact.evidence };
  const same = current.sources.find((s) => s.url === source.url && s.method === source.method);
  if (same) {
    if (source.score > same.score) Object.assign(same, source);
  } else {
    current.sources.push(source);
  }
  current.sources.sort((a, b) => b.score - a.score);
  current.sources.length = Math.min(current.sources.length, MAX_SOURCES);
  // forma del valore e dettagli dalla fonte migliore; i contrassegni (PEC, sede legale) si sommano
  const flags = { pec: current.extra.pec || fact.extra.pec, legalSeat: current.extra.legalSeat || fact.extra.legalSeat };
  if (current.sources[0] === same || current.sources[0] === source) {
    current.value = fact.value;
    current.extra = { ...current.extra, ...fact.extra };
  }
  for (const [k, v] of Object.entries(flags)) if (v) current.extra[k] = true;
}

function mergePerson(people, p, page) {
  const key = personKey(p);
  if (!key || !isPersonName(p.firstName, p.lastName)) return;
  const current = people[key] || (people[key] = {
    key, firstName: p.firstName, lastName: p.lastName, role: '', priority: 9,
    email: '', phone: '', mobile: '', whatsapp: '', linkedin: '', fields: {}, sources: [],
  });
  for (const f of PERSON_FIELDS) {
    if (!current[f] && p[f]) {
      current[f] = p[f];
      current.fields[f] = { url: page.url, method: p.fieldMethods?.[f] || p.method };
    }
  }
  if (p.role && (!current.role || p.priority < current.priority)) {
    current.role = p.role;
    current.priority = p.priority;
    current.fields.role = { url: page.url, method: p.method };
  }
  if (!current.sources.some((s) => s.url === page.url && s.method === p.method)) {
    current.sources.push({ url: page.url, pageType: page.type, method: p.method, reliability: p.reliability, evidence: p.evidence });
    current.sources.length = Math.min(current.sources.length, MAX_SOURCES);
  }
}

// "Paolo – Host" su una pagina e "Paolo Neri" su un'altra: se c'è un solo Paolo con cognome,
// sono la stessa persona; se ce ne sono due, la persona parziale resta a parte
function absorbPartials(people) {
  const partials = Object.values(people).filter((p) => !p.lastName);
  for (const partial of partials) {
    const first = normKey(partial.firstName);
    const matches = Object.values(people).filter((p) => p.lastName && normKey(p.firstName.split(' ')[0]) === first);
    if (matches.length !== 1) continue;
    const full = matches[0];
    for (const f of PERSON_FIELDS) {
      if (!full[f] && partial[f]) {
        full[f] = partial[f];
        full.fields[f] = partial.fields[f];
      }
    }
    if (partial.role && (!full.role || partial.priority < full.priority)) {
      Object.assign(full, { role: partial.role, priority: partial.priority });
      full.fields.role = partial.fields.role;
    }
    for (const s of partial.sources) if (!full.sources.some((x) => x.url === s.url && x.method === s.method)) full.sources.push(s);
    delete people[partial.key];
  }
}

/** Aggiunge i risultati di una pagina (vedi parser.analyzeSnapshot). */
export function addPageFindings(site, findings) {
  const next = structuredClone(site);
  const page = findings.page;
  if (!next.domain) Object.assign(next, { domain: page.domain, origin: page.origin });
  const record = { url: page.url, title: page.title, type: page.type, analyzedAt: new Date().toISOString() };
  const index = next.pages.findIndex((p) => p.url === page.url);
  if (index >= 0) next.pages[index] = record;
  else next.pages.push(record);
  next.failures = next.failures.filter((f) => f.url !== page.url);

  for (const fact of findings.facts) mergeFact(next.facts, fact, page);
  for (const p of findings.people) mergePerson(next.people, p, page);
  absorbPartials(next.people);
  for (const [term, n] of Object.entries(findings.signals || {})) next.signals[term] = (next.signals[term] || 0) + n;
  next.notes = [...new Set([...next.notes, ...(findings.notes || [])])].slice(0, MAX_NOTES);
  return next;
}

/** Pagina non raggiungibile durante la scansione. */
export function addFailure(site, { url, code, reason }) {
  const next = structuredClone(site);
  if (!next.pages.some((p) => p.url === url) && !next.failures.some((f) => f.url === url)) {
    next.failures.push({ url, code, reason });
    next.failures.length = Math.min(next.failures.length, MAX_FAILURES);
  }
  return next;
}

const distinct = (list, by) => new Set(list.map(by)).size;

/** Punteggio complessivo: la fonte migliore, più un piccolo premio se più pagine concordano. */
function rated(fact) {
  const pages = distinct(fact.sources, (s) => s.url);
  const methods = distinct(fact.sources, (s) => s.method);
  const score = (fact.sources[0]?.score ?? 0) + Math.min(pages - 1, 3) * 0.5;
  // un'email con del testo attaccato resta da verificare anche se compare in più punti
  const reliability = !(fact.kind === 'email' && onlyGlued(fact))
    && (fact.sources.some((s) => s.reliability === 'high') || methods >= 2) ? 'high' : 'check';
  return { ...fact, score, reliability, best: fact.sources[0] || null, pages };
}

// fonti che danno l'email da sola, senza testo intorno che le si possa attaccare
const EXACT_EMAIL_METHODS = new Set([METHOD.jsonld, METHOD.microdata, METHOD.metaBusiness, METHOD.mailto]);
const exactSource = (fact) => fact.sources.some((s) => EXACT_EMAIL_METHODS.has(s.method));

// trovata solo con del testo attaccato davanti (vedi parser: gluedPrefixes), mai da sola
const onlyGlued = (fact) => Boolean(fact.extra.gluedPrefixes?.length) && !exactSource(fact);

// "4363917agriturismolamora@gmail.com" accanto a "agriturismolamora@gmail.com": il prefisso viene dal
// testo vicino (le ultime cifre del telefono) e l'email pulita ha una fonte più affidabile (link
// email, JSON-LD, campo strutturato, oppure scritta da sola nel testo) → si scarta.
// Un'email che inizia davvero con delle cifre resta, se non ha una copia pulita più affidabile.
function isGluedCopy(fact, emails) {
  if (!onlyGlued(fact)) return false;
  return emails.some((clean) => clean !== fact
    && fact.extra.gluedPrefixes.some((p) => p + clean.value === fact.value)
    && (exactSource(clean) || !clean.extra.gluedPrefixes?.length));
}

/** Valori di un tipo (email, phone, …) dal più probabile, con affidabilità e fonte migliore. */
export function factsOf(site, kind) {
  // a parità di punteggio vince il primo trovato (l'ordine di inserimento resta: sort è stabile)
  const facts = Object.values(site.facts)
    .filter((f) => f.kind === kind)
    .map(rated)
    .sort((a, b) => b.score - a.score);
  return kind === 'email' ? facts.filter((f) => !isGluedCopy(f, facts)) : facts;
}

/** Contatto HubSpot possibile: nome + cognome + almeno un recapito tra email, telefono, LinkedIn. */
export function isContactEligible(p) {
  return Boolean(p.firstName && p.lastName && (p.email || p.phone || p.mobile || p.linkedin));
}

export function missingForContact(p) {
  const missing = [];
  if (!p.firstName) missing.push('nome');
  if (!p.lastName) missing.push('cognome');
  if (!(p.email || p.phone || p.mobile || p.linkedin)) missing.push('email, telefono o LinkedIn');
  return missing;
}

/**
 * Persone rilevate: prima i contatti utilizzabili, poi per ruolo e affidabilità. Un candidato che non
 * supera la validazione (es. un titolo dell'informativa privacy in una bozza salvata prima) non compare
 * da nessuna parte: né qui, né nel Contesto rapido, né nel Contatto.
 */
export function peopleOf(site) {
  return Object.values(site.people)
    .filter((p) => isPersonName(p.firstName, p.lastName))
    .map((p) => ({
      ...p,
      reliability: p.sources.some((s) => s.reliability === 'high') || distinct(p.sources, (s) => s.url) >= 2 ? 'high' : 'check',
      eligible: isContactEligible(p),
      partial: !p.lastName,
    }))
    .sort((a, b) => Number(b.eligible) - Number(a.eligible)
      || a.priority - b.priority
      || Number(b.reliability === 'high') - Number(a.reliability === 'high')
      || b.sources.length - a.sources.length
      || a.key.localeCompare(b.key));
}

/** "24 pagine · 4 email · 3 telefoni · 1 WhatsApp · 2 persone" */
export function summaryOf(site) {
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  return [
    n(site.pages.length, 'pagina', 'pagine'),
    n(factsOf(site, 'email').length, 'email', 'email'),
    n(factsOf(site, 'phone').length, 'telefono', 'telefoni'),
    n(factsOf(site, 'whatsapp').length, 'WhatsApp', 'WhatsApp'),
    n(peopleOf(site).length, 'persona', 'persone'),
  ].join(' · ');
}
