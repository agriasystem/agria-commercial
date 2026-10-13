// Outreach: primo contatto e primo follow-up. Modello puro, usato dal pannello (anteprima) e dal
// service worker (scritture): cosa si scrive in HubSpot quando il commerciale conferma di aver
// inviato la prima email.
//
// Proprietà del portale Agria (internal name esatti):
//   Azienda   hs_lead_status                       → ATTEMPTED_TO_CONTACT («Primo contatto inviato»)
//   Azienda   data_del_primo_invio_email           → solo se vuota (si scrive una volta sola)
//   Contatto  data_primo_invio_email_al_contatto   → solo se vuota, e solo se l'email è andata al Contatto
// Task di follow-up (API Tasks 2026-09): tipo CALL, NOT_STARTED, priorità NONE, scadenza hs_timestamp
// e promemoria hs_task_reminders in millisecondi Unix, owner = commerciale attivo alla conferma.
// Associazioni predefinite HubSpot (HUBSPOT_DEFINED): 192 Task → Azienda, 204 Task → Contatto.
//
// Il prospect viene dalla bozza di Scout (una sola fonte): nessuna copia dei suoi dati.

import { hubspotState, hubspotTarget } from './draft.js';
import { COMPANY_FIRST_EMAIL, companyEmails, CONTACT_FIRST_EMAIL, leadStatusLabel } from './crmModel.js';
import { followUpSchedule, hubspotInstant, romeIsoDate } from './outreachTime.js';

export const COMPANY_DATE = COMPANY_FIRST_EMAIL;
export const CONTACT_DATE = CONTACT_FIRST_EMAIL;
export const LEAD_STATUS_PROP = 'hs_lead_status';
export const FIRST_CONTACT_STATUS = 'ATTEMPTED_TO_CONTACT';
/** Stati che dicono che l'Azienda è già stata contattata: niente nuovo «primo contatto». */
export const CONTACTED_STATUSES = Object.freeze(['ATTEMPTED_TO_CONTACT', 'CONNECTED', 'OPEN_DEAL']);
export const DATE_TYPES = Object.freeze(['datetime', 'date']);
export const TASK_ASSOCIATION_TYPES = Object.freeze({ company: 192, contact: 204 });
export const TASK_FIXED = Object.freeze({ hs_task_type: 'CALL', hs_task_status: 'NOT_STARTED', hs_task_priority: 'NONE' });
export const TASK_BODY = 'Primo follow-up dopo email commerciale Agria System.';

const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
// nel titolo e nelle note del task solo testo: niente caratteri che HubSpot potrebbe leggere come HTML
const plain = (v, max = 200) => str(v, max).replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isAlreadyContacted = (company) => Boolean(str(company?.firstEmailAt)) || CONTACTED_STATUSES.includes(company?.leadStatus);
export const taskSubject = (companyName) => `FOLLOW-UP | ${plain(companyName)}`;
/** "Roberto Rossi — Titolare" (o solo il nome se la qualifica manca). */
export const personLabel = (name, jobtitle = '') => [plain(name), plain(jobtitle)].filter(Boolean).join(' — ');

/** Note del task: una riga per l'email all'Azienda, due per l'email al Contatto. */
export function taskBody(contact = null) {
  const who = contact ? personLabel(contact.name, contact.jobtitle) : '';
  return who ? `${TASK_BODY}\nContatto: ${who}` : TASK_BODY;
}

/**
 * Prospect pronto per il primo contatto, letto dalla bozza di Scout: l'Azienda creata da Scout o
 * l'unica trovata con certezza in HubSpot (la stessa regola del Contatto in Scout). null se non c'è.
 * emails: le email aziendali utilizzabili (companyEmails: principale, secondaria e le altre trovate da
 * Scout); excluded: quelle trovate ma non suggerite, col motivo (PEC, privacy, fornitore…).
 * → { companyId, name, existing, leadStatus, url, emails: [{ kind, email }], excluded: [{ email, reason }],
 *     contact: { id, name, jobtitle, email, url } | null }
 */
export function outreachProspect(draft, mode) {
  const st = hubspotState(draft, mode);
  const target = hubspotTarget(st);
  if (!target?.id) return null;
  const value = (section, name) => str(draft?.[section]?.[name]?.value, 200);
  const company = Object.fromEntries(['name', 'email_aziendale_principale', 'email_aziendale_secondaria'].map((p) => [p, value('company', p)]));
  const edited = ['email_aziendale_principale', 'email_aziendale_secondaria'].filter((p) => draft?.company?.[p]?.edited === true);
  const found = draft?.site ? companyEmails(draft.site, company, { edited }) : [];
  const emails = found.filter((e) => e.usable).map((e) => ({ kind: e.role, email: e.email }));
  const excluded = found.filter((e) => !e.usable).map((e) => ({ email: e.email, reason: e.reason }));
  const email = (v) => (EMAIL_RE.test(str(v).toLowerCase()) ? str(v).toLowerCase() : '');
  let contact = null;
  if (st.contact?.id && (!st.contact.companyId || st.contact.companyId === target.id)) {
    contact = { id: st.contact.id, name: str(st.contact.name), jobtitle: value('contact', 'jobtitle'), email: email(value('contact', 'email')), url: str(st.contact.url) };
  } else if (Array.isArray(st.contactMatches) && st.contactMatches.length === 1 && st.contactMatches[0].id) {
    const m = st.contactMatches[0];
    contact = { id: m.id, name: str(m.name), jobtitle: str(m.jobtitle), email: email(m.email), url: str(m.url) };
  }
  return {
    companyId: target.id,
    name: str(target.name) || value('company', 'name'),
    existing: target.existing === true,
    leadStatus: target.existing ? str(target.leadStatus, 60) : 'NEW',
    url: str(target.url),
    emails,
    excluded,
    contact,
  };
}

/**
 * Destinatari della prima email. È un'operazione dell'AZIENDA: una sola email aziendale, A = l'email
 * aziendale principale, CC = tutte le altre email valide del prospect (secondaria, booking@, anche
 * nominative come carolina@azienda.it) tranne quelle tolte a mano (removed). Una persona in CC non rende
 * l'email «al Contatto»: niente data del Contatto, follow-up solo sull'Azienda.
 * È quello che la verifica mostra, che Gmail riceve e che il service worker registra, identico.
 * → { type: 'company', label, to, cc: [CC rimasti], removed: [CC tolti] } | null senza prospect
 */
export function outreachRecipients(prospect, removed = []) {
  if (!prospect) return null;
  const [to = '', ...others] = prospect.emails.map((e) => e.email);
  const off = new Set(removed);
  return {
    type: 'company', label: to ? `Azienda — ${to}` : 'Azienda',
    to, cc: others.filter((e) => !off.has(e)), removed: others.filter((e) => off.has(e)),
  };
}

/** Elenco di email per i messaggi: solo indirizzi validi, minuscoli, senza doppioni e senza il destinatario A. */
export function cleanCc(list, to = '') {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const e = str(raw, 254).toLowerCase();
    if (EMAIL_RE.test(e) && e !== to && !out.includes(e)) out.push(e);
  }
  return out.slice(0, 20);
}

/**
 * Valore di una data per HubSpot, secondo il tipo della proprietà nel portale (documentazione
 * Properties API): datetime → millisecondi Unix dell'istante; date → giorno completo YYYY-MM-DD
 * (il giorno in Italia). Un altro tipo non si scrive.
 */
export function dateValue(type, ms) {
  if (type === 'datetime') return String(ms);
  if (type === 'date') return romeIsoDate(ms);
  throw new Error(`tipo di proprietà non gestito: ${type}`);
}

/** La data letta da HubSpot è quella che Agria Commercial voleva scrivere? (per riconoscere una scrittura già arrivata) */
export function sameDateValue(hubspotValue, planned) {
  const read = str(hubspotValue, 60);
  if (!read || !planned) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(planned)) return read.slice(0, 10) === planned;
  return hubspotInstant(read) === Number(planned);
}

/**
 * Piano del primo contatto (nessuna scrittura qui).
 * company: { id, name, leadStatus, firstEmailAt } letto ora da HubSpot; contact: { id, name, jobtitle,
 * firstEmailAt } | null; recipient: { type: 'company' | 'contact', contactId }; owner: commerciale
 * attivo { name, hubspotOwnerId }; now: istante della conferma; types: { companyDate, contactDate }.
 * → { companyName, companyProperties, contactProperties | null, task, dueAt, reminderAt, writes }
 */
export function planFirstContact({ company, contact = null, recipient, owner, now, types }) {
  if (!owner?.hubspotOwnerId) throw new Error('commerciale attivo mancante');
  const toContact = recipient?.type === 'contact';
  if (toContact && !contact?.id) throw new Error('contatto mancante');
  const companyProperties = { [LEAD_STATUS_PROP]: FIRST_CONTACT_STATUS };
  const writes = { companyDate: !str(company?.firstEmailAt), contactDate: false };
  if (writes.companyDate) companyProperties[COMPANY_DATE] = dateValue(types.companyDate, now);
  let contactProperties = null;
  if (toContact && !str(contact.firstEmailAt)) {
    contactProperties = { [CONTACT_DATE]: dateValue(types.contactDate, now) };
    writes.contactDate = true;
  }
  const { dueAt, reminderAt } = followUpSchedule(now);
  const companyName = plain(company?.name);
  const task = followUpTask({
    companyId: company.id, contactId: toContact ? contact.id : '', companyName, ownerId: owner.hubspotOwnerId, dueAt, reminderAt,
    contact: toContact ? contact : null,
  });
  return { companyName, companyProperties, contactProperties, task, dueAt, reminderAt, writes };
}

/** Corpo della richiesta di creazione del task (POST /crm/objects/2026-09/tasks). */
export function followUpTask({ companyId, contactId = '', companyName, ownerId, dueAt, reminderAt, contact = null }) {
  const association = (id, typeId) => ({ to: { id: String(id) }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: typeId }] });
  return {
    properties: {
      hs_task_subject: taskSubject(companyName),
      hs_task_body: taskBody(contact),
      ...TASK_FIXED,
      hs_timestamp: String(dueAt),
      hs_task_reminders: String(reminderAt),
      hubspot_owner_id: String(ownerId),
    },
    associations: [association(companyId, TASK_ASSOCIATION_TYPES.company), ...(contactId ? [association(contactId, TASK_ASSOCIATION_TYPES.contact)] : [])],
  };
}

/** Un task letto da HubSpot è il follow-up di questa operazione? (stesso titolo, stessa scadenza) */
export function isSameFollowUp(properties, { subject, dueAt }) {
  return str(properties?.hs_task_subject) === subject && hubspotInstant(properties?.hs_timestamp) === Number(dueAt);
}

/** Proprietà dell'Azienda ancora da scrivere in un nuovo tentativo: mai una data già presente. */
export function remainingCompanyProperties(current, planned) {
  const out = {};
  if (current?.leadStatus !== planned[LEAD_STATUS_PROP]) out[LEAD_STATUS_PROP] = planned[LEAD_STATUS_PROP];
  if (planned[COMPANY_DATE] && !str(current?.firstEmailAt)) out[COMPANY_DATE] = planned[COMPANY_DATE];
  return out;
}

/** Testo del prossimo passo per un'Azienda già contattata, secondo il suo stato. */
export function contactedNextStep(leadStatus) {
  if (leadStatus === 'CONNECTED') return 'Prosegui la conversazione e aggiorna il record in HubSpot.';
  if (leadStatus === 'OPEN_DEAL') return "C'è un'opportunità aperta: seguila in HubSpot.";
  if (leadStatus === 'ATTEMPTED_TO_CONTACT') return 'Follow-up telefonico: usa il Navigatore durante la chiamata.';
  return 'Controlla lo stato del record in HubSpot prima di scrivere di nuovo.';
}

export const statusLabel = (value) => leadStatusLabel(value) || 'Non indicato';
