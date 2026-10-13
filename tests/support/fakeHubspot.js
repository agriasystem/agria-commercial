// HubSpot finto per i test (unitari ed e2e): MAI il CRM reale.
// Riproduce gli endpoint 2026-09 usati da Agria Commercial con un archivio in memoria, controlla il
// Bearer token, registra ogni richiesta e permette di forzare risposte (401, 403, 429, 5xx,
// errori di validazione) per provare la gestione degli errori; con { after: true } la richiesta ha
// effetto e solo la risposta è un errore (es. task creato ma risposta persa).
// Outreach: definizioni delle proprietà (tipo date/datetime, valori di Lead Status), PATCH che accetta
// solo valori validi per il tipo, task con associazioni 192/204, associazioni Azienda → task.

const V = '/crm/objects/2026-09';
const RECORD_URL = (type, id) => `https://app-eu1.hubspot.com/contacts/149362651/record/${type}/${id}`;
const LEAD_OPTIONS = ['NEW', 'OPEN', 'IN_PROGRESS', 'OPEN_DEAL', 'UNQUALIFIED', 'ATTEMPTED_TO_CONTACT', 'CONNECTED', 'BAD_TIMING'];
const TASK_OPTIONS = { hs_task_type: ['EMAIL', 'CALL', 'TODO'], hs_task_status: ['NOT_STARTED', 'IN_PROGRESS', 'WAITING', 'COMPLETED', 'DEFERRED'], hs_task_priority: ['NONE', 'LOW', 'MEDIUM', 'HIGH'] };
const DEFAULT_PROPERTIES = () => ({
  companies: {
    hs_lead_status: { name: 'hs_lead_status', type: 'enumeration', options: LEAD_OPTIONS.map((value) => ({ value, label: value })) },
    data_del_primo_invio_email: { name: 'data_del_primo_invio_email', type: 'datetime', options: [] },
  },
  contacts: { data_primo_invio_email_al_contatto: { name: 'data_primo_invio_email_al_contatto', type: 'datetime', options: [] } },
});

export function createFakeHubspot({ token = 'fake-test-service-key-0000000000', firstId = 9001 } = {}) {
  const state = {
    companies: [], contacts: [], associations: [], tasks: [], taskLinks: [], properties: DEFAULT_PROPERTIES(), requests: [], forced: [], required: { companies: [], contacts: [] },
  };
  let nextId = firstId;

  const lowered = (v) => String(v ?? '').trim().toLowerCase();
  const pick = (record, properties) => ({
    id: record.id, url: record.url, archived: false, createdAt: record.createdAt, updatedAt: record.createdAt,
    properties: Object.fromEntries((properties || Object.keys(record.properties)).map((p) => [p, record.properties[p] ?? null])),
  });
  const json = (status, body, headers = {}) => ({ status, headers: { 'content-type': 'application/json', ...headers }, body: body == null ? '' : JSON.stringify(body) });
  const error = (status, message, extra = {}) => json(status, { status: 'error', message, correlationId: '00000000-0000-4000-8000-000000000000', category: extra.category || 'ERROR', ...extra });

  function matchesFilter(record, f) {
    const value = lowered(record.properties[f.propertyName]);
    if (f.operator === 'EQ') return value !== '' && value === lowered(f.value);
    if (f.operator === 'IN') return value !== '' && (f.values || []).map(lowered).includes(value);
    if (f.operator === 'CONTAINS_TOKEN') return value.includes(lowered(f.value).replace(/\*/g, ''));
    throw new Error(`operatore non simulato: ${f.operator}`);
  }

  function search(list, body, searchable) {
    let results = list;
    const groups = body.filterGroups || [];
    if (groups.length > 5 || groups.reduce((n, g) => n + g.filters.length, 0) > 18) return error(400, 'Too many filters', { category: 'VALIDATION_ERROR' });
    if (groups.length) results = results.filter((r) => groups.some((g) => g.filters.every((f) => matchesFilter(r, f))));
    if (body.query) {
      const q = lowered(body.query);
      results = results.filter((r) => searchable.some((p) => lowered(r.properties[p]).split(/[^a-z0-9.@+]+/).some((t) => t.startsWith(q))));
    }
    const page = results.slice(0, body.limit || 10).map((r) => pick(r, body.properties));
    return json(200, { total: results.length, results: page });
  }

  function create(kind, body) {
    const properties = body?.properties || {};
    const missing = state.required[kind].filter((p) => !properties[p]);
    if (missing.length) {
      return error(400, 'The property values provided are invalid', {
        category: 'VALIDATION_ERROR',
        errors: missing.map((p) => ({ code: 'MISSING_CONDITIONAL_REQUIRED_PROPERTY', message: `${p} is required because of a conditional property rule`, context: { propertyName: [p] } })),
      });
    }
    if (kind === 'contacts' && properties.email) {
      const existing = state.contacts.find((c) => lowered(c.properties.email) === lowered(properties.email));
      if (existing) return error(409, `Contact already exists. Existing ID: ${existing.id}`, { category: 'CONFLICT' });
    }
    const id = String(nextId++);
    const record = { id, properties: { ...properties }, createdAt: new Date().toISOString(), url: RECORD_URL(kind === 'companies' ? '0-2' : '0-1', id) };
    state[kind].push(record);
    return json(201, pick(record));
  }

  const invalid = (property, code, message) => error(400, 'Property values were not valid', {
    category: 'VALIDATION_ERROR', errors: [{ code, message, context: { propertyName: [property] } }],
  });

  // valore di una data come lo salva HubSpot: datetime → ISO 8601 UTC, date → YYYY-MM-DD
  function storedDate(type, value) {
    const text = String(value ?? '');
    if (type === 'datetime') {
      const ms = /^\d{10,14}$/.test(text) ? Number(text) : Date.parse(text);
      return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const ms = Number(text);
    return /^\d{10,14}$/.test(text) && ms % 86400000 === 0 ? new Date(ms).toISOString().slice(0, 10) : null;
  }

  function patch(kind, id, body) {
    const record = state[kind].find((r) => r.id === id);
    if (!record) return error(404, 'Object not found', { category: 'OBJECT_NOT_FOUND' });
    const props = body?.properties || {};
    const next = {};
    for (const [name, value] of Object.entries(props)) {
      const def = state.properties[kind][name];
      if (!def) return invalid(name, 'PROPERTY_DOESNT_EXIST', `Property "${name}" does not exist`);
      if (def.type === 'enumeration' && !def.options.some((o) => o.value === value)) return invalid(name, 'INVALID_OPTION', `${value} was not one of the allowed options`);
      if (def.type === 'datetime' || def.type === 'date') {
        const stored = storedDate(def.type, value);
        if (stored == null) return invalid(name, 'INVALID_DATE', `${value} is not a valid ${def.type}`);
        next[name] = stored;
      } else next[name] = value;
    }
    Object.assign(record.properties, next);
    return json(200, pick(record));
  }

  function createTask(body) {
    const props = body?.properties || {};
    if (!props.hs_timestamp) return invalid('hs_timestamp', 'MISSING_REQUIRED_PROPERTY', 'hs_timestamp is required');
    for (const [name, options] of Object.entries(TASK_OPTIONS)) {
      if (props[name] != null && !options.includes(props[name])) return invalid(name, 'INVALID_OPTION', `${props[name]} was not one of the allowed options`);
    }
    if (props.hs_task_reminders != null && !/^\d{13}$/.test(String(props.hs_task_reminders))) return invalid('hs_task_reminders', 'INVALID_LONG', 'reminders must be Unix milliseconds');
    const links = [];
    for (const a of body?.associations || []) {
      const type = a?.types?.[0];
      const target = type?.associationTypeId === 192 ? 'companies' : type?.associationTypeId === 204 ? 'contacts' : '';
      if (type?.associationCategory !== 'HUBSPOT_DEFINED' || !target) return error(400, 'invalid association type', { category: 'VALIDATION_ERROR' });
      if (!state[target].some((r) => r.id === String(a.to.id))) return error(400, `No ${target} with ID ${a.to.id}`, { category: 'VALIDATION_ERROR' });
      links.push({ kind: target, id: String(a.to.id), typeId: type.associationTypeId });
    }
    const id = String(nextId++);
    const record = { id, properties: { ...props, hs_timestamp: storedDate('datetime', props.hs_timestamp) }, createdAt: new Date().toISOString(), url: RECORD_URL('0-27', id) };
    state.tasks.push(record);
    for (const l of links) state.taskLinks.push({ taskId: id, ...l });
    return json(201, pick(record));
  }

  /** request: { method, url, headers, body (stringa) } → { status, headers, body } */
  function handle({ method, url, headers = {}, body = '' }) {
    const u = new URL(url);
    const auth = headers.authorization || headers.Authorization || '';
    const parsed = body ? JSON.parse(body) : null;
    state.requests.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: parsed, authorized: auth === `Bearer ${token}` });
    const forced = state.forced.findIndex((f) => f.method === method && f.path.test(u.pathname));
    if (forced >= 0) {
      const f = state.forced[forced];
      if (--f.times <= 0) state.forced.splice(forced, 1);
      if (f.after) route(method, u, parsed, auth); // la richiesta ha effetto, la risposta si perde
      return f.response;
    }
    return route(method, u, parsed, auth);
  }

  function route(method, u, parsed, auth) {
    if (u.hostname !== 'api.hubapi.com') return error(404, 'host');
    if (auth !== `Bearer ${token}`) return error(401, 'Authentication credentials not found.', { category: 'INVALID_AUTHENTICATION' });
    let m;
    if (method === 'GET' && u.pathname === `${V}/companies`) return json(200, { results: state.companies.slice(0, Number(u.searchParams.get('limit') || 10)).map((r) => pick(r)) });
    if (method === 'POST' && u.pathname === `${V}/companies/search`) return search(state.companies, parsed, ['name', 'domain', 'website', 'phone']);
    if (method === 'POST' && u.pathname === `${V}/contacts/search`) return search(state.contacts, parsed, ['firstname', 'lastname', 'email', 'phone', 'mobilephone']);
    if (method === 'POST' && u.pathname === `${V}/companies`) return create('companies', parsed);
    if (method === 'POST' && u.pathname === `${V}/contacts`) return create('contacts', parsed);
    if (method === 'GET' && (m = u.pathname.match(/^\/crm\/objects\/2026-09\/companies\/(\d+)$/))) {
      const record = state.companies.find((c) => c.id === m[1]);
      const props = (u.searchParams.get('properties') || '').split(',').filter(Boolean);
      return record ? json(200, pick(record, props.length ? props : null)) : error(404, 'Object not found', { category: 'OBJECT_NOT_FOUND' });
    }
    if (method === 'GET' && (m = u.pathname.match(/^\/crm\/objects\/2026-09\/contacts\/(\d+)$/))) {
      const record = state.contacts.find((c) => c.id === m[1]);
      const props = (u.searchParams.get('properties') || '').split(',').filter(Boolean);
      return record ? json(200, pick(record, props.length ? props : null)) : error(404, 'Object not found', { category: 'OBJECT_NOT_FOUND' });
    }
    if (method === 'PATCH' && (m = u.pathname.match(/^\/crm\/objects\/2026-09\/(companies|contacts)\/(\d+)$/))) return patch(m[1], m[2], parsed);
    if (method === 'GET' && (m = u.pathname.match(/^\/crm\/properties\/2026-09\/(companies|contacts)\/([a-z0-9_]+)$/))) {
      const def = state.properties[m[1]][m[2]];
      return def ? json(200, { ...def, groupName: `${m[1]}information`, fieldType: def.type === 'enumeration' ? 'select' : 'date' }) : error(404, `Unable to find property ${m[2]}`, { category: 'OBJECT_NOT_FOUND' });
    }
    if (method === 'POST' && u.pathname === `${V}/tasks`) return createTask(parsed);
    if (method === 'GET' && (m = u.pathname.match(/^\/crm\/objects\/2026-09\/companies\/(\d+)\/associations\/tasks$/))) {
      const links = state.taskLinks.filter((l) => l.kind === 'companies' && l.id === m[1]);
      return json(200, { results: links.map((l) => ({ toObjectId: Number(l.taskId), associationTypes: [{ category: 'HUBSPOT_DEFINED', typeId: 191, label: null }] })) });
    }
    if (method === 'POST' && u.pathname === `${V}/tasks/batch/read`) {
      const ids = (parsed?.inputs || []).map((i) => String(i.id));
      if (ids.length > 100) return error(400, 'Too many inputs', { category: 'VALIDATION_ERROR' });
      return json(200, { status: 'COMPLETE', results: state.tasks.filter((t) => ids.includes(t.id)).map((t) => pick(t, parsed?.properties)), startedAt: new Date().toISOString(), completedAt: new Date().toISOString() });
    }
    if (method === 'PUT' && (m = u.pathname.match(/^\/crm\/objects\/2026-09\/contact\/(\d+)\/associations\/default\/company\/(\d+)$/))) {
      if (!state.contacts.some((c) => c.id === m[1]) || !state.companies.some((c) => c.id === m[2])) return error(404, 'Object not found', { category: 'OBJECT_NOT_FOUND' });
      state.associations.push({ contactId: m[1], companyId: m[2] });
      return json(200, { status: 'COMPLETE', results: [{ from: { id: m[1] }, to: { id: m[2] }, associationSpec: { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 279 } }], startedAt: new Date().toISOString(), completedAt: new Date().toISOString() });
    }
    return error(405, `Endpoint non simulato: ${method} ${u.pathname}`);
  }

  return {
    state,
    token,
    handle,
    /** fetch finta per i test unitari (stessa firma di fetch; nessuna rete). */
    async fetch(url, init = {}) {
      const res = handle({ method: init.method || 'GET', url, headers: init.headers || {}, body: init.body || '' });
      return new Response(res.status === 204 ? null : res.body, { status: res.status, headers: res.headers });
    },
    addCompany(properties) {
      const id = String(nextId++);
      state.companies.push({ id, properties: { ...properties }, createdAt: new Date().toISOString(), url: RECORD_URL('0-2', id) });
      return id;
    },
    addContact(properties) {
      const id = String(nextId++);
      state.contacts.push({ id, properties: { ...properties }, createdAt: new Date().toISOString(), url: RECORD_URL('0-1', id) });
      return id;
    },
    /** Le prossime `times` richieste method+path ricevono `response` (es. 429, 500); after: la richiesta ha comunque effetto. */
    force(method, path, response, times = 1, { after = false } = {}) {
      state.forced.push({ method, path, response, times, after });
    },
    /** Task associati a un record (kind: 'companies' | 'contacts'). */
    tasksOf(kind, id) {
      return state.tasks.filter((t) => state.taskLinks.some((l) => l.taskId === t.id && l.kind === kind && l.id === String(id)));
    },
    requireProperty(kind, property) {
      state.required[kind].push(property);
    },
    writes: () => state.requests.filter((r) => r.method !== 'GET' && !r.path.endsWith('/search') && !r.path.endsWith('/batch/read')),
    response: { json, error },
  };
}
