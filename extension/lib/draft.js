// Bozza del prospect mostrata nel pannello: i dati del sito accumulati, i form Azienda e
// Contatto con le proprietà HubSpot e le correzioni del commerciale.
// Funzioni pure che restituiscono sempre una bozza nuova: il pannello le usa, i test le provano.
//
// Regole: un campo corretto a mano non viene mai sovrascritto; i campi non toccati si
// ricalcolano dai dati di TUTTE le pagine analizzate; un sito diverso è un nuovo prospect.
// La base giuridica si conferma solo per un Contatto valido, e va confermata di nuovo se il
// contatto cambia persona o smette di essere valido.
// Il proprietario HubSpot non sta nella bozza: è sempre il commerciale attivo (vedi crmRecords),
// così cambiando commerciale Azienda e Contatto passano subito al nuovo owner.
// La bozza conserva invece l'esito di HubSpot (verifica, ID dell'Azienda e del Contatto creati),
// separato per MOCK e REALE: un'operazione a metà si riprende senza creare di nuovo l'Azienda.

import {
  buildQuickContext, COMPANY_PROPS, CONTACT_PROPS, isContactReady, isPropVisible, proposeCompany, proposeContact,
  proposeStructureFor,
} from './crmModel.js';
import { requireOperator } from './operators.js';
import { addFailure, addPageFindings, emptySite, peopleOf } from './siteData.js';

export const DRAFT_VERSION = 2;
const MAX_ALTERNATIVES = 12;
const EMAIL_PROPS = ['email_aziendale_principale', 'email_aziendale_secondaria'];

const unique = (list) => [...new Set(list.filter(Boolean))];
const str = (x) => (typeof x === 'string' ? x : '');
const blankField = () => ({ value: '', reliability: '', method: '', url: '', evidence: '', alternatives: [], edited: false });
// campi conservati nella bozza: tutti tranne hubspot_owner_id
const draftProps = (props) => props.filter((p) => p.input !== 'owner');
const blankFields = (props) => Object.fromEntries(draftProps(props).map((p) => [p.name, blankField()]));
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
    hubspot: { mock: emptyHubspotState(), real: emptyHubspotState() },
  };
}

// ---------------------------------------------------------------------------------------------
// HubSpot: esito della verifica e record creati, per modalità

const VERIFY_OUTCOMES = ['none', 'possible', 'certain', 'race'];

/**
 * verification: { outcome, matches, mock, at, message } | null · acknowledged: possibile doppione
 * controllato dal commerciale · company / contact: record creati da Scout · contactMatches: contatti
 * già presenti · companyError / contactError: l'ultimo errore, per riprovare.
 */
export const emptyHubspotState = () => ({
  verification: null, acknowledged: false, company: null, contact: null, contactMatches: null, companyError: '', contactError: '',
});

export const hubspotState = (draft, mode) => draft.hubspot?.[mode] || emptyHubspotState();

export function updateHubspot(draft, mode, patch) {
  const next = structuredClone(draft);
  next.hubspot = { mock: hubspotState(draft, 'mock'), real: hubspotState(draft, 'real'), ...next.hubspot };
  next.hubspot[mode] = { ...hubspotState(draft, mode), ...patch };
  return next;
}

/** I dati dell'azienda sono cambiati: la verifica non vale più (un'azienda già creata resta). */
export function clearVerification(draft) {
  let next = draft;
  for (const mode of ['mock', 'real']) {
    const st = hubspotState(next, mode);
    if (st.verification || st.acknowledged || st.companyError) next = updateHubspot(next, mode, { verification: null, acknowledged: false, companyError: '' });
  }
  return next;
}

/** Il contatto è cambiato: via l'esito del controllo precedente (un contatto già creato resta). */
export function clearContactCheck(draft) {
  let next = draft;
  for (const mode of ['mock', 'real']) {
    const st = hubspotState(next, mode);
    if (st.contactMatches || (st.contactError && !st.contact)) next = updateHubspot(next, mode, { contactMatches: null, contactError: '' });
  }
  return next;
}

/** Azienda a cui collegare il Contatto: quella creata da Scout, oppure l'unica trovata con certezza. */
export function hubspotTarget(state) {
  if (state.company) return { ...state.company, existing: false };
  const certain = (state.verification?.matches || []).filter((m) => m.level === 'certain');
  return state.verification?.outcome === 'certain' && certain.length === 1 ? { ...certain[0], existing: true } : null;
}

const s = (v, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');
const strings = (list) => (Array.isArray(list) ? list.filter((x) => typeof x === 'string').slice(0, 10) : []);
const MATCH_FIELDS = ['id', 'name', 'domain', 'city', 'ownerId', 'ownerName', 'leadStatus', 'url', 'level', 'email', 'phone', 'mobile', 'linkedin', 'jobtitle'];
const cleanMatch = (m) => ({ ...Object.fromEntries(MATCH_FIELDS.map((k) => [k, s(m?.[k], 300)])), reasons: strings(m?.reasons) });
const cleanMatches = (list) => (Array.isArray(list) ? list.filter((m) => m && typeof m === 'object').slice(0, 20).map(cleanMatch) : []);

function restoreHubspotState(raw) {
  const state = emptyHubspotState();
  if (!raw || typeof raw !== 'object') return state;
  const v = raw.verification;
  if (v && VERIFY_OUTCOMES.includes(v.outcome)) state.verification = { outcome: v.outcome, matches: cleanMatches(v.matches), mock: v.mock === true, at: s(v.at, 40), message: s(v.message, 300) };
  state.acknowledged = raw.acknowledged === true && state.verification?.outcome === 'possible';
  const c = raw.company;
  if (c && typeof c.id === 'string' && c.id) {
    state.company = { id: s(c.id, 40), url: s(c.url, 300), name: s(c.name, 300), createdAt: s(c.createdAt, 40), ownerId: s(c.ownerId, 40), ownerName: s(c.ownerName, 120), mock: c.mock === true };
  }
  const p = raw.contact;
  if (p && typeof p.id === 'string' && p.id) {
    state.contact = { id: s(p.id, 40), url: s(p.url, 300), name: s(p.name, 300), createdAt: s(p.createdAt, 40), companyId: s(p.companyId, 40), associated: p.associated === true, mock: p.mock === true };
  }
  state.contactMatches = Array.isArray(raw.contactMatches) ? cleanMatches(raw.contactMatches) : null;
  state.companyError = s(raw.companyError, 1000);
  state.contactError = s(raw.contactError, 1000);
  return state;
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

/** Ricalcola le proposte dai dati del sito. */
export function refreshForms(draft) {
  const next = structuredClone(draft);
  const fixed = {};
  for (const prop of EMAIL_PROPS) if (next.company[prop].edited && next.company[prop].value) fixed[prop] = next.company[prop].value;
  if (next.company.settore_agria.edited) fixed.settore_agria = next.company.settore_agria.value;
  const company = proposeCompany(next.site, { fixed });
  for (const { name } of draftProps(COMPANY_PROPS)) if (name !== 'hs_quick_context') mergeField(next.company[name], company[name]);
  const { fields, mainKey } = proposeContact(next.site, next.mainPersonChosen ? next.mainPerson : null);
  next.mainPerson = mainKey;
  for (const { name } of draftProps(CONTACT_PROPS)) mergeField(next.contact[name], fields[name]);
  updateQuickContext(next);
  syncLegalBasis(next);
  return next;
}

/** Risultati di una pagina → { draft, mode: 'new' | 'merged' }. Un altro dominio azzera tutto. */
export function applyFindings(draft, findings) {
  const otherSite = Boolean(draft.site.domain) && draft.site.domain !== findings.page.domain;
  const base = otherSite ? emptyDraft() : structuredClone(draft);
  base.site = addPageFindings(base.site, findings);
  return { draft: refreshForms(base), mode: draft.site.domain && !otherSite ? 'merged' : 'new' };
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
export function usePerson(draft, key) {
  if (!peopleOf(draft.site).some((p) => p.key === key)) return draft;
  const next = structuredClone(draft);
  // la conferma della base giuridica valeva per la persona di prima
  if (next.mainPerson !== key) next.legalBasisConfirmed = false;
  next.mainPerson = key;
  next.mainPersonChosen = true;
  for (const field of Object.values(next.contact)) field.edited = false;
  return refreshForms(next);
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
      for (const { name } of draftProps(props)) {
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
    draft.hubspot = { mock: restoreHubspotState(raw.hubspot?.mock), real: restoreHubspotState(raw.hubspot?.real) };
    return draft;
  } catch {
    return emptyDraft();
  }
}

/**
 * Azienda e Contatto come proprietà HubSpot, pronti per la scrittura (fase successiva): i valori dei
 * form, solo i campi visibili (niente tipo di struttura fuori dall'Hospitality), la base giuridica
 * solo se confermata e hubspot_owner_id preso SOLO dal commerciale attivo. Senza commerciale attivo
 * non si prepara nulla.
 */
export function crmRecords(draft, operator) {
  const { hubspotOwnerId } = requireOperator(operator);
  const valueFor = (p, values) => {
    if (p.input === 'owner') return hubspotOwnerId;
    if (p.input === 'legalBasis') return draft.legalBasisConfirmed ? values[p.name] : '';
    return values[p.name];
  };
  const record = (section, props) => {
    const values = valuesOf(draft[section]);
    return Object.fromEntries(props.filter((p) => isPropVisible(p, values)).map((p) => [p.name, valueFor(p, values)]));
  };
  return { company: record('company', COMPANY_PROPS), contact: record('contact', CONTACT_PROPS) };
}
