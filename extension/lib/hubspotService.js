// Operazioni HubSpot del service worker: Service Key, modalità MOCK/REALE, verifica dei doppioni,
// creazione di Azienda e Contatto, associazione, registro locale degli eventi.
//
// Il pannello e le Impostazioni mandano messaggi e ricevono SOLO risultati ripuliti: la Service Key
// si legge qui, si passa al client reale e non compare mai in una risposta, in un errore o nel registro.
//
// Storage
//   chrome.storage.local    hubspotServiceKey (la chiave; mai storage.sync)
//                           hubspotConnection (esito dell'ultimo «Testa connessione», nessun segreto)
//   chrome.storage.session  hubspotAudit (ultimi eventi), hubspotSession (verifiche e record creati
//                           in questa sessione: servono al controllo dei doppioni e ai nuovi tentativi)

import { loadConfig } from './config.js';
import { createHubspotClient, HubspotError, validateCompanyQuery } from './hubspotClient.js';
import { companyKeys, contactKeys } from './hubspotDuplicates.js';
import { companyPayload, contactPayload, lostFields, PREFLIGHT_MESSAGE } from './hubspotPayload.js';
import { createMockHubspotClient } from './mockHubspotClient.js';
import { loadActiveOperator, operatorById, OperatorRequiredError } from './operators.js';
import { COMPANY_PROPS, CONTACT_PROPS, LEAD_STATUS } from './crmModel.js';
import { AUDIT_ITEM } from './hubspotMessages.js';

export { AUDIT_ITEM, MESSAGE, STATUS_CHANGED } from './hubspotMessages.js';

const KEY_ITEM = 'hubspotServiceKey';
const CONNECTION_ITEM = 'hubspotConnection';
const SESSION_ITEM = 'hubspotSession';
const MAX_AUDIT = 40;
const VERIFY_TTL_MS = 30 * 60 * 1000; // una verifica vale mezz'ora; la creazione controlla comunque di nuovo

export const MESSAGES = Object.freeze({
  noKey: 'Configura la Service Key nelle Impostazioni.',
  notConnected: 'Connessione HubSpot non verificata: nelle Impostazioni premi «Testa connessione».',
  race: "L'azienda è stata aggiunta a HubSpot da un'altra operazione. Nessun duplicato è stato creato.",
  certain: 'Azienda già presente in HubSpot: la creazione è bloccata.',
  unconfirmed: 'Possibile azienda già presente: conferma di aver controllato prima di creare.',
  notVerified: 'Premi prima «Verifica HubSpot»: la creazione parte solo dopo il controllo dei doppioni.',
  busy: 'Operazione già in corso: attendi la risposta di HubSpot.',
  keyFormat: 'La Service Key non sembra valida: copiala di nuovo da HubSpot (Sviluppo → Chiavi → Service key).',
});

const COMPANY_FIELD_NAMES = new Set(COMPANY_PROPS.map((p) => p.name));
const CONTACT_FIELD_NAMES = new Set(CONTACT_PROPS.map((p) => p.name));
const isId = (v) => typeof v === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(v);
// errori dopo i quali non si sa se HubSpot ha scritto il record
const UNCERTAIN = new Set(['server', 'timeout', 'network', 'unexpected']);

// solo stringhe, solo le proprietà del modello: il messaggio non può portare altro
function record(raw, names) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const name of names) if (typeof raw[name] === 'string') out[name] = raw[name].slice(0, 66000);
  return out;
}

const OUTCOME_LABELS = { none: 'Non presente', possible: 'Possibile duplicato', certain: 'Già presente', race: 'Bloccata: aggiunta nel frattempo' };
// operazioni che finiscono nel registro anche quando falliscono
const AUDITED = { verifyCompany: 'Verifica HubSpot', createCompany: 'Creazione Azienda', createContact: 'Creazione Contatto', associateContact: 'Associazione Contatto → Azienda' };

export function createHubspotService({
  local, session, fetchImpl, sleep, timeoutMs, notify = () => {}, now = () => Date.now(), mockDelayMs,
} = {}) {
  const locks = new Set();
  let sessionQueue = Promise.resolve();

  const readKey = async () => {
    const stored = await local.get(KEY_ITEM);
    return typeof stored[KEY_ITEM] === 'string' ? stored[KEY_ITEM] : '';
  };
  const realClient = () => createHubspotClient({ getToken: readKey, fetchImpl, sleep, timeoutMs });

  async function connection() {
    const raw = (await local.get(CONNECTION_ITEM))[CONNECTION_ITEM];
    const state = ['ok', 'failed'].includes(raw?.state) ? raw.state : 'untested';
    return { state, at: typeof raw?.at === 'string' ? raw.at : '', code: typeof raw?.code === 'string' ? raw.code : '', message: typeof raw?.message === 'string' ? raw.message : '' };
  }
  const setConnection = async (value) => {
    await local.set({ [CONNECTION_ITEM]: value });
    notify();
  };

  async function status() {
    const config = await loadConfig(local);
    const keyConfigured = Boolean(await readKey());
    const conn = await connection();
    let blocker = '';
    if (config.hubspot.mode === 'real') blocker = !keyConfigured ? MESSAGES.noKey : conn.state !== 'ok' ? MESSAGES.notConnected : '';
    return { mode: config.hubspot.mode, mockScenario: config.hubspot.mockScenario, keyConfigured, connection: conn, ready: !blocker, blocker };
  }

  // client della modalità attiva; in modalità reale solo con chiave e connessione verificata
  async function client() {
    const config = await loadConfig(local);
    if (config.hubspot.mode === 'mock') return { api: createMockHubspotClient({ ...config.hubspot, ...(mockDelayMs != null ? { mockDelayMs } : {}) }), mock: true };
    const s = await status();
    if (!s.keyConfigured) throw new HubspotError('no_key', MESSAGES.noKey);
    if (!s.ready) throw new HubspotError('not_connected', MESSAGES.notConnected);
    return { api: realClient(), mock: false };
  }

  async function operatorOrFail() {
    const operator = await loadActiveOperator(session);
    if (!operator) throw new OperatorRequiredError();
    return operator;
  }

  // ---- sessione: verifiche e record creati, separati per modalità (un record MOCK non blocca HubSpot reale) ----
  const readSession = async (mode) => {
    const raw = (await session.get(SESSION_ITEM))[SESSION_ITEM]?.[mode];
    return { verified: { ...(raw?.verified || {}) }, companies: { ...(raw?.companies || {}) }, contacts: { ...(raw?.contacts || {}) } };
  };
  // letture e scritture in fila: due operazioni vicine non si sovrascrivono
  const updateSession = (mode, change) => {
    sessionQueue = sessionQueue.then(async () => {
      const all = (await session.get(SESSION_ITEM))[SESSION_ITEM] || {};
      const current = await readSession(mode);
      change(current);
      await session.set({ [SESSION_ITEM]: { ...all, [mode]: current } });
    });
    return sessionQueue;
  };

  async function audit(entry) {
    const operator = await loadActiveOperator(session).catch(() => null);
    const item = {
      at: new Date(now()).toISOString(), operator: operator?.name || '', operation: entry.operation,
      company: String(entry.company || '').slice(0, 120), recordId: String(entry.recordId || ''), outcome: String(entry.outcome || '').slice(0, 400),
      ok: entry.ok !== false, mock: Boolean(entry.mock),
    };
    const list = (await session.get(AUDIT_ITEM))[AUDIT_ITEM];
    await session.set({ [AUDIT_ITEM]: [item, ...(Array.isArray(list) ? list : [])].slice(0, MAX_AUDIT) });
  }

  const withOwnerNames = (matches) => matches.map((m) => ({ ...m, ownerName: operatorById(m.ownerId)?.name || '' }));

  // le aziende create in questa sessione contano come doppioni certi anche prima che la ricerca di HubSpot le indicizzi
  async function addSessionCompanies(result, domain, mode) {
    const created = (await readSession(mode)).companies[domain];
    if (!created || result.matches.some((m) => m.id === created.id)) return result;
    const match = { id: created.id, name: created.name, domain, city: created.city || '', ownerId: created.ownerId || '', leadStatus: LEAD_STATUS.value, url: created.url || '', level: 'certain', reasons: ['domain'], session: true };
    return { outcome: 'certain', matches: [match, ...result.matches] };
  }

  async function lock(key, run) {
    if (locks.has(key)) throw new HubspotError('busy', MESSAGES.busy);
    locks.add(key);
    try {
      return await run();
    } finally {
      locks.delete(key);
    }
  }

  // ---------------------------------------------------------------------------------------------

  const actions = {
    status,

    async saveKey({ key }, { fromOptions }) {
      if (!fromOptions) throw new HubspotError('forbidden_sender', 'La Service Key si salva solo dalle Impostazioni.');
      const value = typeof key === 'string' ? key.trim() : '';
      if (!/^[\x21-\x7e]{20,512}$/.test(value)) throw new HubspotError('invalid_input', MESSAGES.keyFormat);
      await local.set({ [KEY_ITEM]: value, [CONNECTION_ITEM]: { state: 'untested' } });
      await audit({ operation: 'Service Key salvata', outcome: 'Da testare' });
      notify();
      return status();
    },

    async removeKey(_, { fromOptions }) {
      if (!fromOptions) throw new HubspotError('forbidden_sender', 'La Service Key si rimuove solo dalle Impostazioni.');
      await local.remove([KEY_ITEM, CONNECTION_ITEM]);
      await audit({ operation: 'Service Key rimossa', outcome: 'Rimossa' });
      notify();
      return status();
    },

    // una sola lettura innocua, sempre sul client reale (anche se la modalità attiva è MOCK)
    async testConnection(_, { fromOptions }) {
      if (!fromOptions) throw new HubspotError('forbidden_sender', 'La connessione si testa dalle Impostazioni.');
      if (!(await readKey())) throw new HubspotError('no_key', MESSAGES.noKey);
      const at = new Date(now()).toISOString();
      try {
        await realClient().testConnection();
        await setConnection({ state: 'ok', at });
        await audit({ operation: 'Test connessione', outcome: 'Riuscito' });
      } catch (err) {
        const e = err instanceof HubspotError ? err : new HubspotError('unexpected', 'Errore imprevisto durante il test.');
        await setConnection({ state: 'failed', at, code: e.code, message: e.message });
        await audit({ operation: 'Test connessione', outcome: e.message, ok: false });
      }
      return status();
    },

    async audit() {
      const list = (await session.get(AUDIT_ITEM))[AUDIT_ITEM];
      return { entries: Array.isArray(list) ? list : [] };
    },

    async verifyCompany({ company }) {
      await operatorOrFail();
      const values = record(company, COMPANY_FIELD_NAMES);
      validateCompanyQuery({ domain: values.domain, name: values.name });
      const { api, mock } = await client();
      const mode = mock ? 'mock' : 'real';
      const { domain } = companyKeys(values);
      let result = await api.searchCompanyDuplicates(values);
      if (domain) result = await addSessionCompanies(result, domain, mode);
      if (domain) {
        await updateSession(mode, (s) => {
          s.verified[domain] = { at: now(), ids: result.matches.map((m) => m.id), certain: result.matches.filter((m) => m.level === 'certain').map((m) => m.id) };
        });
      }
      await audit({ operation: 'Verifica HubSpot', company: values.name || domain, recordId: result.matches[0]?.id, outcome: OUTCOME_LABELS[result.outcome], mock });
      return { outcome: result.outcome, matches: withOwnerNames(result.matches), mock };
    },

    async createCompany({ company, acknowledged }) {
      const operator = await operatorOrFail();
      const values = record(company, COMPANY_FIELD_NAMES);
      const { properties, errors, invalid } = companyPayload(values, operator);
      if (errors.length) throw new HubspotError('invalid_input', `Dati da correggere prima della creazione:\n- ${errors.join('\n- ')}`);
      // pre-flight anche qui: nessun dato ricevuto dal pannello deve sparire nel payload
      const lost = lostFields(values, properties, { invalid, ownerId: operator.hubspotOwnerId });
      if (lost.length) throw new HubspotError('invalid_input', `${PREFLIGHT_MESSAGE}\n- ${lost.join('\n- ')}`);
      const { api, mock } = await client();
      const mode = mock ? 'mock' : 'real';
      const domain = properties.domain;
      const verified = (await readSession(mode)).verified[domain];
      if (!verified || now() - verified.at > VERIFY_TTL_MS) throw new HubspotError('not_verified', MESSAGES.notVerified);
      if (verified.certain.length) throw new HubspotError('duplicate', MESSAGES.certain);
      const accepted = new Set((Array.isArray(acknowledged) ? acknowledged : []).filter((id) => isId(id) && verified.ids.includes(id)));

      return lock(`company:${domain}`, async () => {
        // di nuovo, subito prima della scrittura: un collega può averla creata nel frattempo
        const recheck = await addSessionCompanies(await api.searchCompanyDuplicates(values), domain, mode);
        const blocking = recheck.matches.filter((m) => m.level === 'certain' || !accepted.has(m.id));
        if (blocking.length) {
          const appeared = blocking.some((m) => m.level === 'certain' || !verified.ids.includes(m.id));
          await updateSession(mode, (s) => {
            s.verified[domain] = { at: now(), ids: recheck.matches.map((m) => m.id), certain: recheck.matches.filter((m) => m.level === 'certain').map((m) => m.id) };
          });
          await audit({ operation: 'Creazione Azienda', company: properties.name, recordId: blocking[0].id, outcome: appeared ? OUTCOME_LABELS.race : 'Bloccata: duplicato da confermare', ok: false, mock });
          if (!appeared) throw new HubspotError('duplicate', MESSAGES.unconfirmed);
          return { outcome: 'race', message: MESSAGES.race, matches: withOwnerNames(recheck.matches), mock };
        }
        let created;
        try {
          created = await api.createCompany(properties);
        } catch (err) {
          if (!(err instanceof HubspotError) || !UNCERTAIN.has(err.code)) throw err;
          // l'azienda potrebbe essere stata creata: niente nuovo tentativo senza una nuova verifica,
          // che arriva qualche secondo dopo, quando la ricerca di HubSpot la vede
          await updateSession(mode, (s) => { delete s.verified[domain]; });
          throw new HubspotError(err.code, `${err.message} Premi di nuovo «Verifica HubSpot» prima di riprovare.`, err);
        }
        const createdAt = new Date(now()).toISOString();
        await updateSession(mode, (s) => {
          s.companies[domain] = { id: created.id, name: properties.name, city: properties.city || '', ownerId: operator.hubspotOwnerId, url: created.url, at: createdAt };
        });
        await audit({ operation: 'Creazione Azienda', company: properties.name, recordId: created.id, outcome: 'Successo', mock });
        return {
          outcome: 'created', mock,
          company: { id: created.id, url: created.url, name: properties.name, createdAt, ownerId: operator.hubspotOwnerId, ownerName: operator.name },
        };
      });
    },

    async createContact({ contact, legalBasisConfirmed, companyId, companyName }) {
      const operator = await operatorOrFail();
      const values = record(contact, CONTACT_FIELD_NAMES);
      const { properties, errors } = contactPayload(values, operator, { legalBasisConfirmed: legalBasisConfirmed === true });
      if (errors.length) throw new HubspotError('invalid_input', `Dati da correggere prima della creazione:\n- ${errors.join('\n- ')}`);
      const { api, mock } = await client();
      const mode = mock ? 'mock' : 'real';
      const target = String(companyId ?? '');
      const state = await readSession(mode);
      // solo verso un'azienda creata in questa sessione o trovata con certezza dalla verifica
      const known = Object.values(state.companies).some((c) => c.id === target) || Object.values(state.verified).some((v) => v.certain.includes(target));
      if (!isId(target) || !known) throw new HubspotError('invalid_input', "Azienda non verificata: premi di nuovo «Verifica HubSpot».");
      const keys = contactSessionKeys(properties);
      const label = [properties.firstname, properties.lastname].join(' ');

      return lock(`contact:${keys[0] || label}`, async () => {
        await api.getCompany(target); // l'azienda esiste ancora
        // riletto qui, dentro il blocco: un clic arrivato subito dopo vede il contatto appena creato
        const fresh = await readSession(mode);
        const mine = keys.map((k) => fresh.contacts[k]).find(Boolean);
        if (mine) {
          return { outcome: 'exists', mock, matches: [{ id: mine.id, name: label, email: properties.email || '', phone: '', mobile: '', linkedin: '', jobtitle: '', ownerId: operator.hubspotOwnerId, ownerName: operator.name, url: mine.url || '', reasons: ['session'] }] };
        }
        const dup = await api.searchContactDuplicates(properties);
        if (dup.outcome === 'exists') {
          await audit({ operation: 'Creazione Contatto', company: companyName || label, recordId: dup.matches[0].id, outcome: 'Contatto già presente: non creato', ok: false, mock });
          return { outcome: 'exists', matches: withOwnerNames(dup.matches), mock };
        }
        let created;
        try {
          created = await api.createContact(properties);
        } catch (err) {
          // 409: un contatto con questa email esiste già (HubSpot lo garantisce per l'email)
          if (err instanceof HubspotError && err.code === 'conflict') {
            await audit({ operation: 'Creazione Contatto', company: companyName || label, recordId: err.existingId, outcome: 'Contatto già presente: non creato', ok: false, mock });
            return { outcome: 'exists', mock, matches: [{ id: err.existingId, name: '', email: properties.email || '', phone: '', mobile: '', linkedin: '', jobtitle: '', ownerId: '', ownerName: '', url: '', reasons: ['email'] }] };
          }
          if (err instanceof HubspotError && UNCERTAIN.has(err.code)) {
            throw new HubspotError(err.code, `${err.message} «Riprova creazione Contatto» cerca di nuovo il contatto in HubSpot prima di crearlo.`, err);
          }
          throw err;
        }
        const createdAt = new Date(now()).toISOString();
        await updateSession(mode, (s) => {
          for (const k of keys) s.contacts[k] = { id: created.id, url: created.url, companyId: target, at: createdAt };
        });
        const contactInfo = { id: created.id, url: created.url, name: label, createdAt, companyId: target };
        try {
          await api.associateContactToCompany(created.id, target);
        } catch (err) {
          const e = err instanceof HubspotError ? err : new HubspotError('unexpected', 'Associazione non riuscita.');
          await audit({ operation: 'Creazione Contatto', company: companyName || label, recordId: created.id, outcome: `Creato, associazione non riuscita: ${e.message}`, ok: false, mock });
          return { outcome: 'partial', mock, contact: { ...contactInfo, associated: false }, error: e.toJSON() };
        }
        await audit({ operation: 'Creazione Contatto e associazione', company: companyName || label, recordId: created.id, outcome: 'Successo', mock });
        return { outcome: 'created', mock, contact: { ...contactInfo, associated: true } };
      });
    },

    // nuovo tentativo di associazione, solo per un contatto creato da Scout in questa sessione
    async associateContact({ contactId, companyId, companyName }) {
      await operatorOrFail();
      const { api, mock } = await client();
      const mode = mock ? 'mock' : 'real';
      const state = await readSession(mode);
      const mine = Object.values(state.contacts).find((c) => c.id === String(contactId ?? '') && c.companyId === String(companyId ?? ''));
      if (!mine) throw new HubspotError('invalid_input', 'Contatto non creato da Scout in questa sessione: associalo a mano in HubSpot.');
      return lock(`associate:${mine.id}`, async () => {
        await api.associateContactToCompany(mine.id, mine.companyId);
        await audit({ operation: 'Associazione Contatto → Azienda', company: companyName || '', recordId: mine.id, outcome: 'Successo', mock });
        return { outcome: 'associated', mock };
      });
    },
  };

  /** messaggio → risposta { ok: true, ... } oppure { ok: false, error: { code, message, status, correlationId } } */
  async function handle(message, { fromOptions = false } = {}) {
    const action = actions[message?.action];
    if (!action) return { ok: false, error: { code: 'invalid_input', message: 'Operazione HubSpot sconosciuta.' } };
    try {
      return { ok: true, ...(await action(message, { fromOptions })) };
    } catch (err) {
      if (err instanceof OperatorRequiredError) return { ok: false, error: { code: 'no_operator', message: err.message } };
      const e = err instanceof HubspotError ? err : new HubspotError('unexpected', 'Errore imprevisto: riprova.');
      // chiave rifiutata durante il lavoro: la modalità reale si ferma finché non si testa di nuovo
      if (['unauthorized', 'forbidden'].includes(e.code)) await setConnection({ state: 'failed', at: new Date(now()).toISOString(), code: e.code, message: e.message }).catch(() => {});
      if (AUDITED[message.action]) {
        const name = message.company?.name || message.companyName || [message.contact?.firstname, message.contact?.lastname].filter(Boolean).join(' ');
        await audit({ operation: AUDITED[message.action], company: typeof name === 'string' ? name : '', outcome: `Errore: ${e.message}`, ok: false }).catch(() => {});
      }
      return { ok: false, error: e.toJSON() };
    }
  }

  return { handle };
}

// chiavi con cui riconoscere in sessione un contatto già creato da Scout
function contactSessionKeys(properties) {
  const k = contactKeys(properties);
  return [k.email && `email:${k.email}`, ...k.phones.map((p) => `phone:${p}`), k.linkedin && `linkedin:${k.linkedin}`].filter(Boolean);
}
