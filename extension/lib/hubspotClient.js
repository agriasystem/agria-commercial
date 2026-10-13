// Client HubSpot REALE (API date-versioned 2026-09). Lo usa solo il service worker: la Service Key
// arriva da getToken() al momento della richiesta e non esce mai da questo file.
//
// Endpoint (documentazione ufficiale HubSpot, versione 2026-09, server https://api.hubapi.com):
//   GET  /crm/objects/2026-09/companies?limit=1                       test della connessione (sola lettura)
//   POST /crm/objects/2026-09/companies/search                        ricerca aziende (doppioni)
//   GET  /crm/objects/2026-09/companies/{companyId}?properties=…      lettura azienda
//   POST /crm/objects/2026-09/companies                               creazione azienda
//   POST /crm/objects/2026-09/contacts/search                         ricerca contatti (doppioni)
//   POST /crm/objects/2026-09/contacts                                creazione contatto
//   PUT  /crm/objects/2026-09/contact/{contactId}/associations/default/company/{companyId}
//                                                                     associazione predefinita Contatto → Azienda
// Outreach (primo contatto e follow-up, solo dopo «Conferma invio e crea follow-up»):
//   GET  /crm/objects/2026-09/{companies|contacts}/{id}?properties=…  lettura di stato e date di primo invio
//   GET  /crm/properties/2026-09/{companies|contacts}/{nome}           tipo della proprietà (date o datetime)
//   PATCH /crm/objects/2026-09/{companies|contacts}/{id}              SOLO le proprietà in UPDATABLE
//   POST /crm/objects/2026-09/tasks                                   task di follow-up con associazioni
//   GET  /crm/objects/2026-09/companies/{id}/associations/tasks       task già associati (nuovo tentativo)
//   POST /crm/objects/2026-09/tasks/batch/read                        titolo e scadenza di quei task
// Scope: crm.objects.companies.read/write e crm.objects.contacts.read/write (i task li richiedono
// secondo la documentazione HubSpot). Nessuna cancellazione; associationTypeId solo 192 (Task → Azienda)
// e 204 (Task → Contatto), i tipi predefiniti documentati da HubSpot.
//
// Un solo wrapper HTTP (request) per tutto: Authorization Bearer, Content-Type, timeout, 401, 403,
// 404, 409, 429 con Retry-After, 5xx, errori di rete, errori di validazione 2026-09.
// Il token non finisce mai in log, errori, URL o risultati.

import {
  classifyCompanies, classifyContacts, COMPANY_FIELDS, companySummary, contactSearch, nameCompanySearch, safeRecordUrl, strongCompanySearch,
} from './hubspotDuplicates.js';
import { propertyLabel } from './hubspotPayload.js';
import { COMPANY_DATE, CONTACT_DATE, LEAD_STATUS_PROP, TASK_ASSOCIATION_TYPES } from './outreach.js';
import { cleanText, normalizeDomain } from './validation.js';

export const API_BASE = 'https://api.hubapi.com';
export const API_VERSION = '2026-09';
const OBJECTS = `/crm/objects/${API_VERSION}`;
const TIMEOUT_MS = 15000;
const MAX_RETRIES = 2; // solo per 429 e, sulle letture, per 5xx
const MAX_WAIT_MS = 10000;

/** Le uniche proprietà che Agria Commercial modifica su record esistenti (Outreach, dopo una conferma). */
export const UPDATABLE = Object.freeze({ companies: Object.freeze([LEAD_STATUS_PROP, COMPANY_DATE]), contacts: Object.freeze([CONTACT_DATE]) });
const OUTREACH_COMPANY_FIELDS = ['name', LEAD_STATUS_PROP, COMPANY_DATE, 'hubspot_owner_id'];
const OUTREACH_CONTACT_FIELDS = ['firstname', 'lastname', 'jobtitle', 'email', CONTACT_DATE];
const TASK_FIELDS = ['hs_task_subject', 'hs_task_body', 'hs_task_type', 'hs_task_status', 'hs_task_priority', 'hs_timestamp', 'hs_task_reminders', 'hubspot_owner_id'];
const TASK_TYPE_IDS = Object.values(TASK_ASSOCIATION_TYPES);
const MAX_TASK_PAGES = 10;

export class HubspotError extends Error {
  /**
   * code: invalid_input | no_key | not_connected | no_operator | unauthorized | forbidden | not_found |
   *       conflict | rate_limited | server | network | timeout | validation | bad_request | unexpected | mock_error
   */
  constructor(code, message, { status = 0, correlationId = '', existingId = '' } = {}) {
    super(message);
    this.name = 'HubspotError';
    this.code = code;
    this.status = status;
    this.correlationId = correlationId;
    this.existingId = existingId;
  }

  /** Forma sicura da mandare al pannello: niente stack, niente richiesta, niente token. */
  toJSON() {
    return { code: this.code, message: this.message, status: this.status, correlationId: this.correlationId };
  }
}

/** Controlla la richiesta prima di qualsiasi chiamata: dominio valido oppure almeno il nome. */
export function validateCompanyQuery(query) {
  const rawDomain = typeof query?.domain === 'string' ? query.domain.trim() : '';
  const domain = normalizeDomain(rawDomain);
  const name = cleanText(typeof query?.name === 'string' ? query.name : '', 200);
  if (rawDomain && !domain) throw new HubspotError('invalid_input', 'Il dominio non è valido: correggilo prima della verifica.');
  if (!domain && !name) throw new HubspotError('invalid_input', "Serve almeno il dominio o il nome dell'azienda.");
  return { domain, name };
}

const VALIDATION_CODES = {
  MISSING_REQUIRED_PROPERTY: (p) => `${p}: obbligatorio nel portale HubSpot.`,
  MISSING_CONDITIONAL_REQUIRED_PROPERTY: (p) => `${p}: obbligatorio per una regola condizionale del portale.`,
  INVALID_OPTION: (p) => `${p}: valore non ammesso dal portale.`,
  INVALID_EMAIL: (p) => `${p}: email non accettata da HubSpot.`,
  INVALID_INTEGER: (p) => `${p}: serve un numero intero.`,
  PROPERTY_DOESNT_EXIST: (p) => `${p}: proprietà inesistente nel portale.`,
};
const safeText = (value, max = 240) => cleanText(String(value ?? '').replace(/[\u0000-\u001f]+/g, ' '), max);

/** Errore di validazione HubSpot (2026-09: anche le regole impostate dall'amministratore) → righe in italiano. */
export function validationLines(body) {
  const lines = [];
  for (const e of Array.isArray(body?.errors) ? body.errors : []) {
    const props = Array.isArray(e?.context?.propertyName) ? e.context.propertyName : [];
    const name = props.map((p) => `${propertyLabel(String(p))} (${safeText(p, 80)})`).join(', ');
    const known = VALIDATION_CODES[e?.code];
    lines.push(known && name ? known(name) : safeText(e?.message) || 'Valore non accettato.');
  }
  if (!lines.length && body?.message) lines.push(safeText(body.message));
  return [...new Set(lines)].slice(0, 8);
}

function retryDelay(response, attempt) {
  const header = response?.headers?.get?.('retry-after') || '';
  const seconds = Number(header);
  let ms = Number.isFinite(seconds) && header.trim() !== '' ? seconds * 1000 : Date.parse(header) - Date.now();
  if (!Number.isFinite(ms) || ms < 0) ms = 1000 * 2 ** attempt; // senza Retry-After: 1 s, poi 2 s
  return Math.min(ms, MAX_WAIT_MS);
}

async function readJson(response) {
  try {
    const textBody = await response.text();
    return textBody ? JSON.parse(textBody) : null;
  } catch {
    return null;
  }
}

function errorFor(status, body, { write }) {
  const meta = { status, correlationId: typeof body?.correlationId === 'string' ? body.correlationId : '' };
  if (status === 401) return new HubspotError('unauthorized', 'Service Key non valida o ruotata.', meta);
  if (status === 403) return new HubspotError('forbidden', 'Service Key valida ma permessi insufficienti.', meta);
  if (status === 404) return new HubspotError('not_found', 'Record non trovato in HubSpot.', meta);
  if (status === 409) {
    const existingId = String(body?.message ?? '').match(/Existing ID:\s*(\d+)/i)?.[1] || '';
    return new HubspotError('conflict', 'Il record esiste già in HubSpot: nessun duplicato creato.', { ...meta, existingId });
  }
  if (status === 429) return new HubspotError('rate_limited', 'HubSpot ha ricevuto troppe richieste: riprova tra qualche secondo.', meta);
  if (status >= 500) {
    const hint = write ? ' La richiesta potrebbe comunque essere arrivata a HubSpot.' : ' Riprova tra poco.';
    return new HubspotError('server', `HubSpot non è disponibile in questo momento (errore ${status}).${hint}`, meta);
  }
  if (status === 400 && body?.category === 'VALIDATION_ERROR') {
    const lines = validationLines(body);
    return new HubspotError('validation', `HubSpot ha rifiutato i dati per le regole del portale:\n- ${lines.join('\n- ')}`, meta);
  }
  return new HubspotError('bad_request', `Richiesta non accettata da HubSpot (errore ${status}).${body?.message ? ` ${safeText(body.message, 160)}` : ''}`, meta);
}

// hs_timestamp letto da HubSpot: ISO 8601 o millisecondi
const hubspotTime = (value) => {
  const text = String(value ?? '');
  return /^\d{10,14}$/.test(text) ? Number(text) : Date.parse(text);
};

/**
 * getToken: async () → Service Key (letta dallo storage del service worker a ogni richiesta).
 * fetchImpl, sleep, timeoutMs: sostituibili nei test (nessuna chiamata reale).
 */
export function createHubspotClient({ getToken, fetchImpl = (...args) => globalThis.fetch(...args), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = TIMEOUT_MS } = {}) {
  // safe: richiesta che non cambia dati (si può ripetere anche dopo un 5xx); write: crea o associa
  async function request(method, path, { query = null, body = null, safe = method === 'GET' } = {}) {
    const token = await getToken();
    if (!token) throw new HubspotError('no_key', 'Configura la Service Key nelle Impostazioni.');
    const url = new URL(`${API_BASE}${path}`);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(url.href, {
          method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal,
          credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
        });
      } catch (err) {
        clearTimeout(timer);
        const timedOut = err?.name === 'AbortError';
        const hint = safe ? '' : ' La richiesta potrebbe comunque essere arrivata a HubSpot.';
        throw new HubspotError(timedOut ? 'timeout' : 'network', `${timedOut ? 'HubSpot non ha risposto in tempo.' : 'Connessione a HubSpot non riuscita: controlla la rete.'}${hint}`);
      }
      clearTimeout(timer);
      if (response.ok) return response.status === 204 ? null : readJson(response);
      const retriable = response.status === 429 || (safe && response.status >= 500);
      if (retriable && attempt < MAX_RETRIES) {
        await sleep(retryDelay(response, attempt));
        continue;
      }
      throw errorFor(response.status, await readJson(response), { write: !safe });
    }
  }

  const search = (object, body) => request('POST', `${OBJECTS}/${object}/search`, { body, safe: true });
  const results = (data) => (Array.isArray(data?.results) ? data.results : []);
  const numericId = (value, what) => {
    const id = String(value ?? '');
    if (!/^\d+$/.test(id)) throw new HubspotError('invalid_input', `ID ${what} non valido.`);
    return id;
  };
  const prop = (record, name) => (typeof record?.properties?.[name] === 'string' ? record.properties[name] : '');

  async function readRecord(object, id, fields, what) {
    const record = await request('GET', `${OBJECTS}/${object}/${numericId(id, what)}`, { query: { properties: fields.join(',') } });
    if (!record || record.archived) throw new HubspotError('not_found', `${what === 'azienda' ? 'Azienda' : 'Contatto'} non trovato in HubSpot.`);
    return record;
  }

  // modifica di un record esistente: solo le proprietà ammesse, solo testo, mai altro
  async function update(object, id, properties) {
    const keys = Object.keys(properties || {});
    const allowed = UPDATABLE[object] || [];
    if (!keys.length || keys.some((k) => !allowed.includes(k) || typeof properties[k] !== 'string' || !properties[k])) {
      throw new HubspotError('invalid_input', 'Modifica non ammessa: Agria Commercial aggiorna solo stato e date di primo invio.');
    }
    await request('PATCH', `${OBJECTS}/${object}/${numericId(id, object === 'companies' ? 'azienda' : 'contatto')}`, { body: { properties } });
    return { ok: true };
  }

  return Object.freeze({
    mode: 'real',

    /** Una sola lettura innocua: la prima azienda (nessuna scrittura). */
    async testConnection() {
      await request('GET', `${OBJECTS}/companies`, { query: { limit: 1, archived: false } });
      return { ok: true };
    },

    /** Doppioni dell'azienda: prima dominio, email e telefono; poi, se non c'è altro, nome e città. */
    async searchCompanyDuplicates(company) {
      const strongBody = strongCompanySearch(company);
      const nameBody = nameCompanySearch(company);
      if (!strongBody && !nameBody) throw new HubspotError('invalid_input', "Serve almeno il dominio o il nome dell'azienda.");
      const strong = strongBody ? classifyCompanies(company, results(await search('companies', strongBody))) : { outcome: 'none', matches: [] };
      if (strong.matches.length || !nameBody) return strong;
      return classifyCompanies(company, results(await search('companies', nameBody)));
    },

    async getCompany(companyId) {
      const id = String(companyId ?? '');
      if (!/^\d+$/.test(id)) throw new HubspotError('invalid_input', 'ID azienda non valido.');
      const record = await request('GET', `${OBJECTS}/companies/${id}`, { query: { properties: COMPANY_FIELDS.join(',') } });
      if (!record || record.archived) throw new HubspotError('not_found', 'Azienda non trovata in HubSpot.');
      return companySummary(record);
    },

    async createCompany(properties) {
      const record = await request('POST', `${OBJECTS}/companies`, { body: { properties } });
      if (!record?.id) throw new HubspotError('unexpected', 'Risposta di HubSpot senza ID del record.');
      return companySummary(record);
    },

    /** Doppioni del contatto: email, telefono, cellulare, LinkedIn (una ricerca, gruppi in OR). */
    async searchContactDuplicates(contact) {
      const body = contactSearch(contact);
      if (!body) return { outcome: 'none', matches: [] };
      return classifyContacts(contact, results(await search('contacts', body)));
    },

    async createContact(properties) {
      const record = await request('POST', `${OBJECTS}/contacts`, { body: { properties } });
      if (!record?.id) throw new HubspotError('unexpected', 'Risposta di HubSpot senza ID del record.');
      return { id: String(record.id), url: safeRecordUrl(record.url, record.id) };
    },

    /** Associazione predefinita Contatto → Azienda (l'endpoint "default" non richiede un associationTypeId). */
    async associateContactToCompany(contactId, companyId) {
      const from = String(contactId ?? '');
      const to = String(companyId ?? '');
      if (!/^\d+$/.test(from) || !/^\d+$/.test(to)) throw new HubspotError('invalid_input', 'ID non valido per l\'associazione.');
      await request('PUT', `${OBJECTS}/contact/${from}/associations/default/company/${to}`);
      return { ok: true };
    },

    // ---- Outreach ----

    /** Azienda per Outreach: nome, Lead Status, data del primo invio (letti ora, mai dalla cache). */
    async getCompanyOutreach(companyId) {
      const record = await readRecord('companies', companyId, OUTREACH_COMPANY_FIELDS, 'azienda');
      return {
        id: String(record.id), name: prop(record, 'name'), leadStatus: prop(record, LEAD_STATUS_PROP), firstEmailAt: prop(record, COMPANY_DATE),
        ownerId: prop(record, 'hubspot_owner_id'), url: safeRecordUrl(record.url, record.id),
      };
    },

    async getContactOutreach(contactId) {
      const record = await readRecord('contacts', contactId, OUTREACH_CONTACT_FIELDS, 'contatto');
      return {
        id: String(record.id), name: [prop(record, 'firstname'), prop(record, 'lastname')].filter(Boolean).join(' '), jobtitle: prop(record, 'jobtitle'),
        email: prop(record, 'email'), firstEmailAt: prop(record, CONTACT_DATE), url: safeRecordUrl(record.url, record.id),
      };
    },

    /** Definizione di una proprietà del portale: tipo (date, datetime, enumeration…) e valori ammessi. */
    async getProperty(objectType, name) {
      if (!['companies', 'contacts'].includes(objectType) || !/^[a-z0-9_]{1,100}$/.test(String(name))) throw new HubspotError('invalid_input', 'Proprietà non valida.');
      const p = await request('GET', `/crm/properties/${API_VERSION}/${objectType}/${name}`);
      return {
        name: String(p?.name ?? ''), type: String(p?.type ?? ''),
        options: Array.isArray(p?.options) ? p.options.map((o) => String(o?.value ?? '')).filter(Boolean) : [],
      };
    },

    updateCompany: (companyId, properties) => update('companies', companyId, properties),
    updateContact: (contactId, properties) => update('contacts', contactId, properties),

    /** Task di follow-up con le sue associazioni (solo i tipi predefiniti 192 e 204). */
    async createTask({ properties, associations }) {
      const keys = Object.keys(properties || {});
      const okProps = keys.length && keys.every((k) => TASK_FIELDS.includes(k) && typeof properties[k] === 'string') && properties.hs_timestamp;
      const okAssoc = Array.isArray(associations) && associations.length >= 1 && associations.every((a) => /^\d+$/.test(String(a?.to?.id ?? ''))
        && Array.isArray(a.types) && a.types.length === 1 && a.types[0].associationCategory === 'HUBSPOT_DEFINED' && TASK_TYPE_IDS.includes(a.types[0].associationTypeId));
      if (!okProps || !okAssoc) throw new HubspotError('invalid_input', 'Follow-up non valido: nessuna richiesta inviata.');
      const record = await request('POST', `${OBJECTS}/tasks`, { body: { properties, associations } });
      if (!record?.id) throw new HubspotError('unexpected', 'Risposta di HubSpot senza ID del task.');
      return { id: String(record.id) };
    },

    /**
     * Task già associati all'Azienda con lo stesso titolo e la stessa scadenza: il follow-up di un
     * tentativo precedente arrivato a HubSpot anche se la risposta si è persa. Le associazioni si
     * leggono subito (la ricerca di HubSpot indicizza i nuovi record con qualche secondo di ritardo).
     */
    async findFollowUpTasks(companyId, { subject, dueAt }) {
      const id = numericId(companyId, 'azienda');
      const ids = [];
      let after = '';
      for (let page = 0; page < MAX_TASK_PAGES; page += 1) {
        const data = await request('GET', `${OBJECTS}/companies/${id}/associations/tasks`, { query: after ? { after } : null });
        for (const r of results(data)) {
          const taskId = String(r?.toObjectId ?? r?.id ?? '');
          if (/^\d+$/.test(taskId) && !ids.includes(taskId)) ids.push(taskId);
        }
        after = typeof data?.paging?.next?.after === 'string' ? data.paging.next.after : '';
        if (!after) break;
      }
      if (after) throw new HubspotError('unexpected', 'Troppi task associati a questa Azienda: controllo non completo, nessun nuovo follow-up creato.');
      const found = [];
      for (let i = 0; i < ids.length; i += 100) {
        const data = await request('POST', `${OBJECTS}/tasks/batch/read`, {
          body: { properties: ['hs_task_subject', 'hs_timestamp', 'hubspot_owner_id'], inputs: ids.slice(i, i + 100).map((x) => ({ id: x })) }, safe: true,
        });
        for (const t of results(data)) {
          const p = t?.properties || {};
          if (String(p.hs_task_subject ?? '') === subject && hubspotTime(p.hs_timestamp) === Number(dueAt)) found.push({ id: String(t.id) });
        }
      }
      return found;
    },
  });
}
