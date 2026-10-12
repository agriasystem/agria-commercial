// Bozza del prospect mostrata nel pannello: i dati del sito accumulati, i form Azienda e
// Contatto con le proprietà HubSpot e le correzioni del commerciale.
// Funzioni pure che restituiscono sempre una bozza nuova: il pannello le usa, i test le provano.
//
// Regole: un campo corretto a mano non viene mai sovrascritto; i campi non toccati si
// ricalcolano dai dati di TUTTE le pagine analizzate; un sito diverso è un nuovo prospect.
// La base giuridica si conferma solo per un Contatto valido, e va confermata di nuovo se il
// contatto cambia persona o smette di essere valido.

import {
  buildQuickContext, COMPANY_PROPS, CONTACT_PROPS, isContactReady, proposeCompany, proposeContact, proposeStructureFor,
} from './crmModel.js';
import { addFailure, addPageFindings, emptySite } from './siteData.js';

export const DRAFT_VERSION = 2;
const MAX_ALTERNATIVES = 12;
const EMAIL_PROPS = ['email_aziendale_principale', 'email_aziendale_secondaria'];

const unique = (list) => [...new Set(list.filter(Boolean))];
const str = (x) => (typeof x === 'string' ? x : '');
const blankField = () => ({ value: '', reliability: '', method: '', url: '', evidence: '', alternatives: [], edited: false });
const blankFields = (props) => Object.fromEntries(props.map((p) => [p.name, blankField()]));
const valuesOf = (fields) => Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.value]));

export function emptyDraft() {
  return {
    version: DRAFT_VERSION,
    site: emptySite(),
    company: blankFields(COMPANY_PROPS),
    contact: blankFields(CONTACT_PROPS),
    mainPerson: null,
    mainPersonChosen: false,
    legalBasisConfirmed: false,
  };
}

// campo non toccato: prende la proposta; campo corretto a mano: resta, e la proposta diventa un'alternativa
function mergeField(field, proposal) {
  if (!field.edited) {
    Object.assign(field, { ...proposal, alternatives: [...proposal.alternatives].slice(0, MAX_ALTERNATIVES) });
    return;
  }
  field.alternatives = unique([...field.alternatives, proposal.value, ...proposal.alternatives])
    .filter((a) => a !== field.value)
    .slice(0, MAX_ALTERNATIVES);
}

function updateQuickContext(draft) {
  const field = draft.company.hs_quick_context;
  if (field.edited) return;
  const value = buildQuickContext(draft.site, valuesOf(draft.company), valuesOf(draft.contact));
  Object.assign(field, { value, reliability: '', method: value ? 'generato dai dati rilevati' : '', url: '', evidence: '', alternatives: [] });
}

/** Il Contatto rispetta la regola HubSpot: nome + cognome + almeno uno tra email, telefono e LinkedIn. */
export const contactReady = (draft) => isContactReady(valuesOf(draft.contact));

function syncLegalBasis(draft) {
  if (!contactReady(draft)) draft.legalBasisConfirmed = false;
}

/** Ricalcola le proposte dai dati del sito (e dalle Impostazioni per il proprietario). */
export function refreshForms(draft, config) {
  const next = structuredClone(draft);
  const fixed = {};
  for (const prop of EMAIL_PROPS) if (next.company[prop].edited && next.company[prop].value) fixed[prop] = next.company[prop].value;
  if (next.company.settore_agria.edited) fixed.settore_agria = next.company.settore_agria.value;
  const company = proposeCompany(next.site, config, { fixed });
  for (const { name } of COMPANY_PROPS) if (name !== 'hs_quick_context') mergeField(next.company[name], company[name]);
  const { fields, mainKey } = proposeContact(next.site, config, next.mainPersonChosen ? next.mainPerson : null);
  next.mainPerson = mainKey;
  for (const { name } of CONTACT_PROPS) mergeField(next.contact[name], fields[name]);
  updateQuickContext(next);
  syncLegalBasis(next);
  return next;
}

/** Risultati di una pagina → { draft, mode: 'new' | 'merged' }. Un altro dominio azzera tutto. */
export function applyFindings(draft, findings, config) {
  const otherSite = Boolean(draft.site.domain) && draft.site.domain !== findings.page.domain;
  const base = otherSite ? emptyDraft() : structuredClone(draft);
  base.site = addPageFindings(base.site, findings);
  return { draft: refreshForms(base, config), mode: draft.site.domain && !otherSite ? 'merged' : 'new' };
}

/** Pagina non raggiungibile durante la scansione: resta nell'elenco, la scansione continua. */
export function recordFailure(draft, failure) {
  return { ...structuredClone(draft), site: addFailure(draft.site, failure) };
}

/** Correzione a mano di un campo. */
export function editField(draft, section, name, value) {
  const next = structuredClone(draft);
  Object.assign(next[section][name], { value: typeof value === 'string' ? value : '', edited: true });
  // il tipo di struttura vale solo per l'Hospitality: si ripropone quando cambia il settore
  if (section === 'company' && name === 'settore_agria') mergeField(next.company.tipo_struttura_hospitality, proposeStructureFor(next.site, next.company.settore_agria.value));
  if (!(section === 'company' && name === 'hs_quick_context')) updateQuickContext(next);
  syncLegalBasis(next);
  return next;
}

/** Sceglie uno degli altri valori trovati; quello di prima diventa un'alternativa. */
export function pickAlternative(draft, section, name, value) {
  const next = structuredClone(draft);
  const field = next[section][name];
  if (!field.alternatives.includes(value)) return next;
  field.alternatives = unique([field.value, ...field.alternatives.filter((a) => a !== value)]).slice(0, MAX_ALTERNATIVES);
  Object.assign(field, { value, edited: true });
  updateQuickContext(next);
  syncLegalBasis(next);
  return next;
}

/** Usa una delle persone rilevate come Contatto principale (anche parziale: lo decide il commerciale). */
export function usePerson(draft, key, config) {
  if (!draft.site.people[key]) return draft;
  const next = structuredClone(draft);
  // la conferma della base giuridica valeva per la persona di prima
  if (next.mainPerson !== key) next.legalBasisConfirmed = false;
  next.mainPerson = key;
  next.mainPersonChosen = true;
  for (const field of Object.values(next.contact)) field.edited = false;
  return refreshForms(next, config);
}

/** Conferma della base giuridica: possibile solo per un Contatto valido. */
export function setLegalBasisConfirmed(draft, confirmed) {
  return { ...structuredClone(draft), legalBasisConfirmed: confirmed === true && contactReady(draft) };
}

/** Rigenera il contesto rapido, scartando le modifiche a mano. */
export function resetQuickContext(draft) {
  const next = structuredClone(draft);
  next.company.hs_quick_context.edited = false;
  updateQuickContext(next);
  return next;
}

/** Bozza salvata in chrome.storage.session → bozza valida (dati malformati o di versioni vecchie si scartano). */
export function restoreDraft(raw) {
  const draft = emptyDraft();
  if (!raw || typeof raw !== 'object' || raw.version !== DRAFT_VERSION) return draft;
  try {
    const site = raw.site;
    if (!site || typeof site.domain !== 'string' || typeof site.facts !== 'object' || typeof site.people !== 'object' || !Array.isArray(site.pages)) return draft;
    draft.site = { ...emptySite(), ...structuredClone(site) };
    for (const [section, props] of [['company', COMPANY_PROPS], ['contact', CONTACT_PROPS]]) {
      for (const { name } of props) {
        const f = raw[section]?.[name];
        if (!f || typeof f.value !== 'string') continue;
        draft[section][name] = {
          value: f.value,
          reliability: f.reliability === 'high' || f.reliability === 'check' ? f.reliability : '',
          method: str(f.method),
          url: str(f.url),
          evidence: str(f.evidence),
          alternatives: Array.isArray(f.alternatives) ? f.alternatives.filter((a) => typeof a === 'string').slice(0, MAX_ALTERNATIVES) : [],
          edited: f.edited === true,
        };
      }
    }
    draft.mainPerson = typeof raw.mainPerson === 'string' && draft.site.people[raw.mainPerson] ? raw.mainPerson : null;
    draft.mainPersonChosen = raw.mainPersonChosen === true && Boolean(draft.mainPerson);
    draft.legalBasisConfirmed = raw.legalBasisConfirmed === true && contactReady(draft);
    return draft;
  } catch {
    return emptyDraft();
  }
}
