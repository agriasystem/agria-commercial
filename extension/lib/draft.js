// Bozza del prospect mostrata nel pannello: i valori trovati dal parser più le correzioni a mano.
// Funzioni pure che restituiscono sempre una bozza nuova: il pannello le usa, i test le provano.
//
// Regola di unione: una seconda pagina dello STESSO sito (es. «Contatti» dopo la home) riempie
// solo i campi vuoti e non tocca mai quelli corretti a mano. Un sito diverso è un nuovo prospect
// e sostituisce tutto.

import { COMPANY_FIELDS, CONTACT_FIELDS, emptyField } from './parser.js';
import { normKey } from './validation.js';

const SECTIONS = { company: COMPANY_FIELDS, contact: CONTACT_FIELDS };
const MAX_ALTERNATIVES = 8;
const MAX_PEOPLE = 8;
const PERSON_FIELDS = ['firstName', 'lastName', 'role', 'email', 'phone', 'linkedin'];

const unique = (list) => [...new Set(list.filter(Boolean))];
const str = (x) => (typeof x === 'string' ? x : '');
const blankField = () => ({ ...emptyField(), edited: false });
const copyField = (f) => ({ value: f.value, source: f.source, uncertain: f.uncertain, alternatives: [...f.alternatives], edited: false });

export function emptyDraft() {
  const section = (keys) => Object.fromEntries(keys.map((k) => [k, blankField()]));
  return { page: null, company: section(COMPANY_FIELDS), contact: section(CONTACT_FIELDS), people: [], notes: [] };
}

const personKey = (p) => normKey(`${p.firstName}${p.lastName}`);
const contactKey = (contact) => normKey(`${contact.firstName.value}${contact.lastName.value}`);

function personFromContact(contact) {
  const p = { source: contact.firstName.edited ? 'inserito a mano' : contact.firstName.source, uncertain: contact.firstName.uncertain, sources: {} };
  for (const f of PERSON_FIELDS) p[f] = contact[f].value;
  for (const f of ['email', 'phone', 'linkedin']) if (contact[f].value) p.sources[f] = contact[f].edited ? 'inserito a mano' : contact[f].source;
  return p;
}

function samePeopleList(people, contact) {
  const current = contactKey(contact);
  const seen = new Set();
  return people.filter((p) => {
    const key = personKey(p);
    if (!key || key === current || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_PEOPLE);
}

// riempie il campo solo se è vuoto e non è stato toccato a mano; le alternative si sommano
function mergeField(current, incoming) {
  let added = 0;
  if (!current.value && !current.edited && incoming.value) {
    Object.assign(current, { value: incoming.value, source: incoming.source, uncertain: incoming.uncertain });
    added = 1;
  }
  current.alternatives = unique([...current.alternatives, incoming.value, ...incoming.alternatives])
    .filter((a) => a !== current.value)
    .slice(0, MAX_ALTERNATIVES);
  return added;
}

/** Applica il risultato di un'analisi. → { draft, mode: 'new' | 'merged', added } */
export function applyAnalysis(draft, result) {
  if (draft.page && draft.page.domain !== result.page.domain) {
    const next = {
      page: { ...result.page },
      company: Object.fromEntries(COMPANY_FIELDS.map((k) => [k, copyField(result.company[k])])),
      contact: Object.fromEntries(CONTACT_FIELDS.map((k) => [k, copyField(result.contact[k])])),
      people: result.people.map((p) => ({ ...p, sources: { ...p.sources } })),
      notes: [...result.notes],
    };
    return { draft: next, mode: 'new', added: result.found };
  }

  // stesso sito, oppure prima analisi (si conservano eventuali campi già scritti a mano)
  const next = structuredClone(draft);
  const firstAnalysis = !draft.page;
  next.page = { ...result.page };
  next.notes = [...result.notes];
  let added = 0;
  for (const k of COMPANY_FIELDS) added += mergeField(next.company[k], result.company[k]);

  const current = contactKey(next.contact);
  const incoming = contactKey(result.contact);
  if (!current || !incoming || current === incoming) {
    for (const k of CONTACT_FIELDS) added += mergeField(next.contact[k], result.contact[k]);
  } else {
    // un'altra persona: non si mescolano i dati, la si propone nell'elenco
    next.people.unshift(personFromContact(result.contact));
  }
  next.people = samePeopleList([...next.people, ...result.people], next.contact);
  return { draft: next, mode: firstAnalysis ? 'new' : 'merged', added };
}

/** Correzione a mano di un campo. */
export function editField(draft, section, key, value) {
  const next = structuredClone(draft);
  const f = next[section][key];
  f.value = typeof value === 'string' ? value : '';
  f.edited = true;
  return next;
}

/** Sceglie uno degli altri valori trovati per il campo; quello di prima diventa un'alternativa. */
export function pickAlternative(draft, section, key, value) {
  const next = structuredClone(draft);
  const f = next[section][key];
  if (!f.alternatives.includes(value)) return next;
  f.alternatives = unique([f.value, ...f.alternatives.filter((a) => a !== value)]).slice(0, MAX_ALTERNATIVES);
  f.value = value;
  f.edited = true;
  return next;
}

/** Usa come Contatto una delle altre persone trovate; il contatto di prima torna nell'elenco. */
export function usePerson(draft, index) {
  const next = structuredClone(draft);
  const chosen = next.people[index];
  if (!chosen) return next;
  const previous = contactKey(next.contact) ? personFromContact(next.contact) : null;
  for (const k of CONTACT_FIELDS) {
    const value = str(chosen[k]);
    const source = (chosen.sources && chosen.sources[k]) || chosen.source;
    next.contact[k] = {
      value,
      source: value ? source : '',
      uncertain: value ? Boolean(chosen.uncertain) : false,
      alternatives: next.contact[k].alternatives.filter((a) => a !== value),
      edited: false,
    };
  }
  next.people.splice(index, 1);
  if (previous) next.people.unshift(previous);
  next.people = samePeopleList(next.people, next.contact);
  return next;
}

/** Bozza salvata in chrome.storage.session → bozza valida (i dati malformati si scartano). */
export function restoreDraft(raw) {
  const draft = emptyDraft();
  if (!raw || typeof raw !== 'object') return draft;
  for (const [section, keys] of Object.entries(SECTIONS)) {
    for (const k of keys) {
      const f = raw[section]?.[k];
      if (!f || typeof f.value !== 'string') continue;
      draft[section][k] = {
        value: f.value,
        source: str(f.source),
        uncertain: f.uncertain === true,
        alternatives: Array.isArray(f.alternatives) ? f.alternatives.filter((a) => typeof a === 'string').slice(0, MAX_ALTERNATIVES) : [],
        edited: f.edited === true,
      };
    }
  }
  if (raw.page && typeof raw.page.url === 'string' && typeof raw.page.domain === 'string') {
    draft.page = { url: raw.page.url, title: str(raw.page.title), domain: raw.page.domain };
  }
  if (Array.isArray(raw.people)) {
    draft.people = raw.people
      .filter((p) => p && typeof p.firstName === 'string' && typeof p.lastName === 'string')
      .slice(0, MAX_PEOPLE)
      .map((p) => {
        const clean = { source: str(p.source), uncertain: p.uncertain === true, sources: {} };
        for (const f of PERSON_FIELDS) clean[f] = str(p[f]);
        if (p.sources && typeof p.sources === 'object') for (const f of ['email', 'phone', 'linkedin']) if (typeof p.sources[f] === 'string') clean.sources[f] = p.sources[f];
        return clean;
      });
  }
  if (Array.isArray(raw.notes)) draft.notes = raw.notes.filter((n) => typeof n === 'string').slice(0, 10);
  return draft;
}
