// Sezione HubSpot del pannello: 1. Scansione → 2. Verifica HubSpot → 3. Creazione.
//
// Ogni richiesta passa dal service worker con un messaggio: il pannello non vede mai la Service Key
// e non chiama HubSpot. Niente scritture senza un clic esplicito; un doppione certo non si crea;
// i record esistenti si mostrano soltanto. L'esito resta nella bozza del prospect (per modalità),
// così un'operazione a metà si riprende senza creare di nuovo l'Azienda.

import { el } from '../ui/dom.js';
import { feedback } from '../ui/feedback.js';
import {
  clearContactCheck, clearVerification, contactReady, crmRecords, hubspotState, hubspotTarget, legalBasisEffective, preflightCompany,
  updateHubspot,
} from '../lib/draft.js';
import { leadStatusLabel } from '../lib/crmModel.js';
import { MOCK_SCENARIOS } from '../lib/config.js';
import { REASON_LABELS } from '../lib/hubspotDuplicates.js';
import { AUDIT_ITEM, MESSAGE, STATUS_CHANGED } from '../lib/hubspotMessages.js';
import { companyPayload, contactPayload, propertyLabel } from '../lib/hubspotPayload.js';
import { operatorById } from '../lib/operators.js';

const STALE = 'I dati sono cambiati durante la verifica: premi di nuovo «Verifica HubSpot».';
const UNAVAILABLE = { ok: false, error: { code: 'unavailable', message: 'Il servizio HubSpot di Agria Commercial non risponde: chiudi e riapri il pannello.' } };

const time = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
// sempre l'etichetta del portale, mai il valore tecnico quando c'è un nome per il commerciale
const leadLabel = (v) => leadStatusLabel(v) || '—';
const ownerLabel = (id, name = '') => name || operatorById(id)?.name || (id ? `ID owner ${id}` : '—');
const link = (url, text) => (/^https:\/\//.test(url || '') ? el('a', { class: 'src', href: url, target: '_blank', rel: 'noopener noreferrer' }, text) : null);
const lines = (text) => String(text || '').split('\n').filter(Boolean).map((l) => el('p', {}, l));
const mockNote = (text) => el('p', { class: 'mocknote' }, text);
// l'id serve a ritrovare il messaggio (e ai test): feedback(...) con un identificativo
const withId = (id, node) => Object.assign(node, { id });

function recordCard(m, kind) {
  const facts = kind === 'company'
    ? [m.domain && `Dominio: ${m.domain}`, m.city && `Città: ${m.city}`]
    : [m.email, m.phone, m.mobile, m.jobtitle];
  return el('div', { class: 'hs-record' },
    el('strong', {}, m.name || '(senza nome)'),
    facts.some(Boolean) ? el('p', {}, facts.filter(Boolean).join(' · ')) : null,
    el('p', {}, `Proprietario: ${ownerLabel(m.ownerId, m.ownerName)}`, kind === 'company' ? ` · Lead Status: ${leadLabel(m.leadStatus)}` : ''),
    el('p', { class: 'hs-id' }, `Record ID ${m.id}`),
    m.reasons?.length ? el('p', { class: 'person-tags' }, ...m.reasons.filter((r) => REASON_LABELS[r]).map((r) => el('span', { class: 'chip check' }, REASON_LABELS[r]))) : null,
    link(m.url, 'Apri in HubSpot') || el('p', { class: 'meta' }, 'Link non disponibile: cerca il Record ID in HubSpot.'));
}

function preview(properties) {
  const value = (name, v) => {
    if (name === 'hubspot_owner_id') return `${ownerLabel(v)} · ID ${v}`;
    if (name === 'hs_lead_status') return leadLabel(v);
    return v.length > 160 ? `${v.slice(0, 160)}…` : v;
  };
  return el('dl', { class: 'preview' }, ...Object.entries(properties).flatMap(([k, v]) => [
    el('dt', {}, propertyLabel(k)), el('dd', {}, value(k, v)),
  ]));
}

/**
 * $: selettore; getDraft/setDraft: la bozza del pannello (setDraft salva); getOperator: commerciale
 * attivo; needsOperator: apre la scelta del commerciale se manca (true = fermarsi).
 */
export function createHubspotPanel({ $, getDraft, setDraft, getOperator, getSessionLegalBasis = () => false, needsOperator }) {
  let status = { mode: 'mock', mockScenario: 'not_found', ready: true, blocker: '', keyConfigured: false, connection: { state: 'untested' } };
  let busy = ''; // '' | 'verify' | 'company' | 'contact' | 'associate'
  let verifyError = null; // { code, message } dell'ultima verifica non riuscita
  let dataVersion = 0; // cresce a ogni cambio dei dati dell'azienda: una verifica partita prima non vale più

  const call = (action, payload = {}) => chrome.runtime.sendMessage({ type: MESSAGE, action, ...payload }).then((r) => r || UNAVAILABLE, () => UNAVAILABLE);
  const state = () => hubspotState(getDraft(), status.mode);
  const update = (patch) => setDraft(updateHubspot(getDraft(), status.mode, patch));

  // ---- azioni ----

  async function onVerify() {
    if (busy || !status.ready || needsOperator()) return;
    busy = 'verify';
    verifyError = null;
    render();
    const version = dataVersion;
    const res = await call('verifyCompany', { company: crmRecords(getDraft(), getOperator()).company });
    busy = '';
    if (version !== dataVersion) verifyError = { code: 'stale', message: STALE };
    else if (!res.ok) verifyError = res.error;
    else update({ verification: { outcome: res.outcome, matches: res.matches, mock: res.mock, at: new Date().toISOString(), message: '' }, acknowledged: false, companyError: '' });
    render();
  }

  async function onCreateCompany() {
    if (busy || needsOperator()) return;
    const st = state();
    busy = 'company'; // il pulsante si disattiva subito: un secondo clic non parte
    render();
    const acknowledged = st.acknowledged ? st.verification.matches.filter((m) => m.level !== 'certain').map((m) => m.id) : [];
    const res = await call('createCompany', { company: crmRecords(getDraft(), getOperator()).company, acknowledged });
    busy = '';
    if (!res.ok && ['server', 'timeout', 'network', 'unexpected', 'not_verified'].includes(res.error.code)) {
      // esito incerto o verifica scaduta: si riparte dalla verifica, che mostra il messaggio
      verifyError = res.error;
      update({ verification: null, acknowledged: false, companyError: '' });
    } else if (!res.ok) update({ companyError: res.error.message });
    else if (res.outcome === 'race') update({ verification: { outcome: 'race', matches: res.matches, mock: res.mock, at: new Date().toISOString(), message: res.message }, acknowledged: false, companyError: '' });
    else update({ company: { ...res.company, mock: res.mock }, companyError: '' });
    render();
  }

  async function onCreateContact() {
    if (busy || needsOperator()) return;
    const target = hubspotTarget(state());
    if (!target) return;
    busy = 'contact';
    render();
    const draft = getDraft();
    const sessionLegalBasis = getSessionLegalBasis();
    const res = await call('createContact', {
      contact: crmRecords(draft, getOperator(), { sessionLegalBasis }).contact,
      legalBasisConfirmed: legalBasisEffective(draft, sessionLegalBasis), companyId: target.id, companyName: target.name,
    });
    busy = '';
    if (!res.ok) update({ contactError: res.error.message });
    else if (res.outcome === 'exists') update({ contactMatches: res.matches, contactError: '' });
    else if (res.outcome === 'partial') update({ contact: { ...res.contact, mock: res.mock }, contactMatches: null, contactError: res.error?.message || '' });
    else update({ contact: { ...res.contact, mock: res.mock }, contactMatches: null, contactError: '' });
    render();
  }

  async function onAssociate() {
    if (busy || needsOperator()) return;
    const { contact } = state();
    if (!contact) return;
    busy = 'associate';
    render();
    const res = await call('associateContact', { contactId: contact.id, companyId: contact.companyId, companyName: hubspotTarget(state())?.name || '' });
    busy = '';
    if (!res.ok) update({ contactError: res.error.message });
    else update({ contact: { ...state().contact, associated: true }, contactError: '' });
    render();
  }

  // ---- disegno ----

  function renderBadges() {
    const mock = status.mode !== 'real';
    for (const badge of document.querySelectorAll('[data-mode-badge]')) {
      const short = badge.dataset.modeBadge === 'short';
      badge.textContent = `${short ? '' : 'HubSpot '}${mock ? 'MOCK' : 'REALE'}`;
      badge.classList.toggle('mock', mock);
      badge.classList.toggle('real', !mock);
      badge.title = mock ? 'HubSpot simulato: nessun dato viene letto o scritto su HubSpot' : 'HubSpot reale: la verifica legge i dati, le creazioni partono solo con un tuo clic';
    }
  }

  function renderVerify(st) {
    const box = $('#verify-result');
    const v = st.verification;
    // kind: l'esito della verifica (not_found | warn | found | error); tone: il componente di feedback
    const TONE = { not_found: 'success', warn: 'warning', found: 'blocked', error: 'error' };
    const show = (kind, title, ...children) => {
      box.dataset.kind = kind;
      const mock = v?.mock || (kind === 'error' && status.mode === 'mock');
      box.replaceChildren(feedback(TONE[kind], title, ...children, mock ? mockNote('Risposta simulata (MOCK): nessun dato letto o scritto su HubSpot.') : null));
      box.hidden = false;
    };
    if (verifyError?.code === 'stale') return show('warn', 'Verifica da ripetere', ...lines(verifyError.message));
    if (verifyError?.code === 'invalid_input') return show('warn', 'Dati da correggere', ...lines(verifyError.message));
    if (verifyError) return show('error', 'Errore HubSpot', ...lines(verifyError.message));
    // azienda già creata da Scout: l'esito «non presente» o «possibile» non serve più
    if (!v || (st.company && ['none', 'possible'].includes(v.outcome))) {
      box.hidden = true;
      box.replaceChildren();
      delete box.dataset.kind;
      return undefined;
    }
    const cards = v.matches.map((m) => recordCard(m, 'company'));
    if (v.outcome === 'none') return show('not_found', 'Non presente in HubSpot', el('p', {}, 'Nessuna azienda con lo stesso dominio, email, telefono o nome e città.'));
    if (v.outcome === 'possible') return show('warn', 'Possibile duplicato', el('p', {}, 'Possibile azienda già presente (un solo segnale): controlla in HubSpot prima di creare.'), ...cards);
    if (v.outcome === 'race') return show('found', 'Azienda già presente in HubSpot', el('p', {}, v.message), ...cards);
    return show('found', 'Azienda già presente in HubSpot', el('p', {}, 'Duplicato certo: nessuna nuova azienda verrà creata. Lavora sul record esistente.'), ...cards);
  }

  function renderCompanyStep(st) {
    const box = $('#company-step');
    const v = st.verification;
    if (st.company) {
      const c = st.company;
      box.replaceChildren(feedback('success', 'Azienda creata in HubSpot',
        el('p', {}, c.name),
        el('p', { class: 'hs-id' }, `Record ID ${c.id}`),
        el('p', {}, `Creata il ${time(c.createdAt)} · Proprietario: ${ownerLabel(c.ownerId, c.ownerName)}`),
        link(c.url, 'Apri in HubSpot'),
        c.mock ? mockNote('Simulazione (MOCK): nessun record creato davvero.') : null));
      box.hidden = false;
      return;
    }
    if (!v || !['none', 'possible'].includes(v.outcome) || verifyError) {
      box.hidden = true;
      box.replaceChildren();
      return;
    }
    const { properties, errors } = companyPayload(crmRecords(getDraft(), getOperator()).company, getOperator());
    // pre-flight: un dato rilevato che non arriverebbe a HubSpot blocca la scrittura
    const preflight = preflightCompany(getDraft(), getOperator());
    const children = [el('h3', { class: 'step-title' }, 'Crea Azienda in HubSpot')];
    if (v.outcome === 'possible') {
      const ack = el('input', { type: 'checkbox', id: 'ack-duplicate' });
      ack.checked = st.acknowledged;
      ack.addEventListener('change', () => {
        update({ acknowledged: ack.checked });
        render();
      });
      children.push(el('label', { class: 'confirm' }, ack, " Ho controllato in HubSpot: è un'azienda diversa"));
    }
    children.push(el('p', { class: 'hint' }, 'Verranno scritti questi dati (solo i campi compilati):'), preview(properties));
    if (errors.length) children.push(feedback('warning', 'Da correggere prima della creazione', ...errors.map((e) => el('p', {}, e))));
    if (!preflight.ok) children.push(withId('preflight-error', feedback('blocked', preflight.message, el('p', {}, `Campi: ${preflight.missing.join(', ')}.`))));
    if (st.companyError) children.push(feedback('error', 'Azienda non creata', ...lines(st.companyError)));
    const blocked = Boolean(busy) || !status.ready || errors.length > 0 || !preflight.ok || (v.outcome === 'possible' && !st.acknowledged);
    children.push(el('button', { id: 'create-company', class: 'btn primary wide', type: 'button', disabled: blocked, onclick: onCreateCompany },
      busy === 'company' ? 'Creazione in corso…' : 'Crea Azienda in HubSpot'));
    box.replaceChildren(...children);
    box.hidden = false;
  }

  function renderContactStep(st) {
    const box = $('#contact-step');
    const target = hubspotTarget(st);
    if (!target || verifyError) {
      box.hidden = true;
      box.replaceChildren();
      return;
    }
    const children = [el('h3', { class: 'step-title' }, target.existing ? 'Contatto per questa Azienda' : 'Contatto')];
    const draft = getDraft();
    if (st.contact) {
      const c = st.contact;
      const created = [
        el('p', {}, c.name),
        el('p', { class: 'hs-id' }, `Record ID ${c.id}`),
        el('p', {}, `Creato il ${time(c.createdAt)}`),
        link(c.url, 'Apri in HubSpot'),
        c.mock ? mockNote('Simulazione (MOCK): nessun record creato davvero.') : null,
      ];
      children.push(c.associated
        ? feedback('success', "Contatto creato e associato all'Azienda", ...created)
        : feedback('warning', "Contatto creato, associazione all'Azienda non riuscita", ...created));
      if (!c.associated) {
        if (st.contactError) children.push(feedback('error', 'Associazione non riuscita', ...lines(st.contactError)));
        children.push(el('button', { id: 'retry-associate', class: 'btn wide', type: 'button', disabled: Boolean(busy) || !status.ready, onclick: onAssociate },
          busy === 'associate' ? 'Associazione in corso…' : 'Riprova associazione'));
      }
    } else if (st.contactMatches) {
      children.push(feedback('blocked', 'Contatto già presente in HubSpot',
        el('p', {}, 'Nessun nuovo contatto creato e nessuna modifica a quello esistente. Se serve, associalo a questa Azienda direttamente in HubSpot.'),
        ...st.contactMatches.map((m) => recordCard(m, 'contact'))));
    } else if (!contactReady(draft)) {
      children.push(el('p', { class: 'hint' }, 'Per creare il Contatto servono nome, cognome e almeno un recapito (email, telefono o LinkedIn): compila il form Contatto.'));
    } else {
      const legalBasis = legalBasisEffective(draft, getSessionLegalBasis());
      const { properties, errors } = contactPayload(crmRecords(draft, getOperator(), { sessionLegalBasis: getSessionLegalBasis() }).contact, getOperator(), { legalBasisConfirmed: legalBasis });
      children.push(el('p', { class: 'hint' }, 'Prima della creazione Scout cerca il contatto in HubSpot (email, telefono, cellulare, LinkedIn). Verranno scritti questi dati:'), preview(properties));
      // la base giuridica serve solo a creare il Contatto: la verifica HubSpot resta sempre possibile
      if (!legalBasis) {
        children.push(withId('legal-basis-required', feedback('warning', 'Conferma la base giuridica per poter creare il Contatto in HubSpot.',
          el('p', {}, 'Spunta la base giuridica nel form Contatto, oppure attivala per tutta la sessione nella Home.'))));
      }
      if (errors.length) children.push(feedback('warning', 'Da correggere prima della creazione', ...errors.map((e) => el('p', {}, e))));
      if (st.contactError) {
        if (!target.existing) children.push(feedback('success', 'Azienda creata'));
        children.push(feedback('warning', 'Contatto non creato', ...lines(st.contactError)));
      }
      const label = st.contactError ? 'Riprova creazione Contatto' : target.existing ? 'Crea Contatto e associa a questa Azienda' : 'Crea Contatto e associa';
      children.push(el('button', { id: 'create-contact', class: 'btn primary wide', type: 'button', disabled: Boolean(busy) || !status.ready || errors.length > 0 || !legalBasis, onclick: onCreateContact },
        busy === 'contact' ? 'Creazione in corso…' : label));
    }
    box.replaceChildren(...children);
    box.hidden = false;
  }

  function render() {
    renderBadges();
    const mock = status.mode !== 'real';
    $('#hubspot-hint').textContent = mock
      ? `Simulazione: nessun dato viene letto o scritto su HubSpot. Scenario: ${MOCK_SCENARIOS[status.mockScenario] || ''}.`
      : 'HubSpot reale: la verifica legge i dati, le creazioni partono solo con un tuo clic. I record esistenti non vengono mai modificati.';
    const blocker = $('#hubspot-blocker');
    blocker.replaceChildren(...(status.blocker ? [feedback('blocked', status.blocker)] : []));
    blocker.hidden = !status.blocker;
    const verify = $('#verify');
    verify.disabled = Boolean(busy) || !status.ready;
    verify.textContent = busy === 'verify' ? 'Verifica in corso…' : 'Verifica HubSpot';
    verify.setAttribute('aria-busy', String(busy === 'verify'));
    // una sola azione primaria per stato: dopo la scansione la verifica, poi la creazione
    const st0 = state();
    verify.classList.toggle('primary', getDraft().site.pages.length > 0 && !st0.verification && !st0.company);
    if (!getOperator()) {
      // senza commerciale il pannello mostra solo la sua scelta: niente anteprime (servono l'owner)
      for (const id of ['#company-step', '#contact-step']) $(id).hidden = true;
      return;
    }
    const st = state();
    renderVerify(st);
    renderCompanyStep(st);
    renderContactStep(st);
  }

  async function renderAudit() {
    const list = (await chrome.storage.session.get(AUDIT_ITEM).catch(() => ({})))[AUDIT_ITEM];
    const entries = Array.isArray(list) ? list : [];
    $('#audit-count').textContent = entries.length ? String(entries.length) : '';
    $('#audit-list').replaceChildren(...(entries.length ? entries.map((e) => el('li', { class: e.ok ? '' : 'bad' },
      el('span', { class: 'when' }, `${time(e.at)} · ${e.operator || '—'}${e.mock ? ' · MOCK' : ''}`),
      el('span', {}, [e.operation, e.company, e.recordId && `ID ${e.recordId}`, e.outcome].filter(Boolean).join(' · ')))) : [el('li', { class: 'hint' }, 'Nessuna operazione in questa sessione.')]));
  }

  async function refreshStatus() {
    const res = await call('status');
    if (res.ok) status = res;
    else status = { ...status, ready: false, blocker: res.error.message };
    render();
  }

  return {
    render,
    refreshStatus,
    /** Modalità HubSpot attuale, come la dice il service worker (nessuna copia della configurazione). */
    get mode() { return status.mode; },
    /** Dati dell'azienda cambiati (correzione a mano, nuova pagina, Svuota): la verifica va rifatta. */
    dataChanged() {
      dataVersion += 1;
      verifyError = null;
      setDraft(clearVerification(getDraft()));
    },
    /** Contatto cambiato: l'esito del controllo precedente non vale più (un contatto creato resta). */
    contactChanged() {
      setDraft(clearContactCheck(getDraft()));
    },
    init() {
      $('#verify').addEventListener('click', onVerify);
      chrome.runtime.onMessage.addListener((message) => {
        if (message?.type === STATUS_CHANGED) refreshStatus();
      });
      chrome.storage.session.onChanged.addListener((changes) => {
        if (changes[AUDIT_ITEM]) renderAudit();
      });
      renderAudit();
      return refreshStatus();
    },
  };
}
