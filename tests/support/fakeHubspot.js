// HubSpot finto per i test (unitari ed e2e): MAI il CRM reale.
// Riproduce gli endpoint 2026-09 usati da Agria Commercial con un archivio in memoria, controlla il
// Bearer token, registra ogni richiesta e permette di forzare risposte (401, 403, 429, 5xx,
// errori di validazione) per provare la gestione degli errori.

const V = '/crm/objects/2026-09';
const RECORD_URL = (type, id) => `https://app-eu1.hubspot.com/contacts/149362651/record/${type}/${id}`;

export function createFakeHubspot({ token = 'fake-test-service-key-0000000000', firstId = 9001 } = {}) {
  const state = { companies: [], contacts: [], associations: [], requests: [], forced: [], required: { companies: [], contacts: [] } };
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
      return f.response;
    }
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
    /** Le prossime `times` richieste method+path ricevono `response` (es. 429, 500). */
    force(method, path, response, times = 1) {
      state.forced.push({ method, path, response, times });
    },
    requireProperty(kind, property) {
      state.required[kind].push(property);
    },
    writes: () => state.requests.filter((r) => r.method !== 'GET' && !r.path.endsWith('/search')),
    response: { json, error },
  };
}
