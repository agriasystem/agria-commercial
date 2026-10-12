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
// Nessun PATCH, nessuna modifica di record esistenti, nessun associationTypeId scritto a mano.
//
// Un solo wrapper HTTP (request) per tutto: Authorization Bearer, Content-Type, timeout, 401, 403,
// 404, 409, 429 con Retry-After, 5xx, errori di rete, errori di validazione 2026-09.
// Il token non finisce mai in log, errori, URL o risultati.

import {
  classifyCompanies, classifyContacts, COMPANY_FIELDS, companySummary, contactSearch, nameCompanySearch, safeRecordUrl, strongCompanySearch,
} from './hubspotDuplicates.js';
import { propertyLabel } from './hubspotPayload.js';
import { cleanText, normalizeDomain } from './validation.js';

export const API_BASE = 'https://api.hubapi.com';
export const API_VERSION = '2026-09';
const OBJECTS = `/crm/objects/${API_VERSION}`;
const TIMEOUT_MS = 15000;
const MAX_RETRIES = 2; // solo per 429 e, sulle letture, per 5xx
const MAX_WAIT_MS = 10000;

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
  });
}
