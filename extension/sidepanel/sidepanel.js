// Pannello laterale di Agria Scout: scansione del sito del prospect, form Azienda e Contatto con
// le proprietà HubSpot, persone e dati rilevati, verifica HubSpot (MOCK).

import { analyzeSnapshot } from '../lib/parser.js';
import { pageTypeOf } from '../lib/discovery.js';
import { fetchText } from '../lib/fetchPage.js';
import { scanSite } from '../lib/scanner.js';
import { summaryOf } from '../lib/siteData.js';
import { COMPANY_PROPS, CONTACT_PROPS, LEAD_STATUS } from '../lib/crmModel.js';
import {
  applyFindings, editField, emptyDraft, pickAlternative, recordFailure, refreshForms, resetQuickContext,
  restoreDraft, setLegalBasisConfirmed, usePerson,
} from '../lib/draft.js';
import { isValidEmail, isValidPhone, normalizeDomain, normalizeLinkedin, normalizeUrl } from '../lib/validation.js';
import { loadConfig, MOCK_SCENARIOS, normalizeConfig, onConfigChange } from '../lib/config.js';
import { createHubspotClient, HubspotError } from '../lib/hubspotClient.js';
import { createMockHubspotClient } from '../lib/mockHubspotClient.js';
import { PageReadError, readActivePage, readDownloadedPage } from './pageReader.js';
import {
  allDataGroups, alternatives, contactReadiness, el, fieldMeta, pagesList, peopleCards,
} from './render.js';

const PROPS = { company: COMPANY_PROPS, contact: CONTACT_PROPS };
// controlli sulle correzioni a mano: avvisano, non bloccano
const CHECKS = {
  url: [(v) => normalizeUrl(v) !== '', 'Indirizzo web non valido.'],
  domain: [(v) => normalizeDomain(v) !== '', 'Dominio non valido (es. agriturismo.it).'],
  email: [isValidEmail, 'Email non valida.'],
  phone: [isValidPhone, 'Numero non riconosciuto: controlla le cifre.'],
  linkedinProfile: [(v) => normalizeLinkedin(v)?.kind === 'profile', 'Serve un profilo personale (linkedin.com/in/…).'],
  linkedinCompany: [(v) => normalizeLinkedin(v)?.kind === 'company', 'Serve una pagina aziendale (linkedin.com/company/…).'],
};
const INPUT_MODE = { email: 'email', phone: 'tel', url: 'url', domain: 'url', linkedinProfile: 'url', linkedinCompany: 'url' };
const IDLE_TEXT = 'Apri il sito di un prospect e premi «Scansione approfondita».';
const STALE = { kind: 'warn', title: 'Verifica da ripetere', text: 'Dati o impostazioni sono cambiati durante la verifica.' };
const SCAN_TIMEOUT_MS = 10000;

const $ = (selector) => document.querySelector(selector);
let draft = emptyDraft();
let config = normalizeConfig(null);
let busy = ''; // '' | 'scan' | 'analyze'
let scanController = null;
let verifying = false;
let dataVersion = 0; // cresce a ogni cambio di dati: una verifica partita prima non vale più
let saveTimer = null;
let clearTimer = null;

// ---------------------------------------------------------------------------------------------
// form Azienda e Contatto

function buildForms() {
  for (const [section, props] of Object.entries(PROPS)) {
    const box = $(`#${section}-fields`);
    for (const prop of props) {
      const id = `${section}-${prop.name}`;
      const wrap = el('div', { id: `${id}-field`, class: prop.half ? 'field half' : 'field' },
        el('label', { for: id }, prop.label, ' ', el('code', {}, prop.name)));
      let control;
      if (prop.input === 'select') {
        control = el('select', { id }, el('option', { value: '' }, '—'), ...prop.options.map((o) => el('option', { value: o }, o)));
        control.addEventListener('change', () => onEdit(section, prop.name, control.value));
      } else if (prop.input === 'textarea') {
        control = el('textarea', { id, rows: '10', spellcheck: 'false' });
        control.addEventListener('input', () => onEdit(section, prop.name, control.value));
      } else if (prop.input === 'owner' || prop.input === 'fixed') {
        control = el('div', { id, class: 'readonly', role: 'textbox', 'aria-readonly': 'true' });
      } else if (prop.input === 'legalBasis') {
        control = el('input', { id, type: 'text', readonly: true });
      } else {
        control = el('input', { id, type: 'text', autocomplete: 'off', spellcheck: 'false', inputmode: INPUT_MODE[prop.check] || 'text' });
        control.addEventListener('input', () => onEdit(section, prop.name, control.value));
        control.addEventListener('blur', () => renderMeta(section, prop));
      }
      control.setAttribute('aria-describedby', `${id}-meta`);
      wrap.append(control);
      if (prop.input === 'legalBasis') {
        const box2 = el('input', { id: 'legal-basis-confirm', type: 'checkbox' });
        box2.addEventListener('change', () => {
          draft = setLegalBasisConfirmed(draft, box2.checked);
          renderMeta('contact', prop);
          scheduleSave();
        });
        wrap.append(el('label', { class: 'confirm' }, box2, ' Confermo la base giuridica per questo contatto'));
      }
      if (prop.input === 'textarea') {
        wrap.append(el('button', { type: 'button', class: 'btn small', id: 'quick-context-reset', onclick: () => {
          draft = resetQuickContext(draft);
          renderField('company', prop);
          scheduleSave();
        } }, 'Rigenera dai dati rilevati'));
      }
      wrap.append(el('div', { id: `${id}-meta`, class: 'meta' }), el('div', { class: 'alts', hidden: true }));
      box.append(wrap);
    }
  }
}

function invalidMessage(prop, field) {
  const check = CHECKS[prop.check];
  return check && field.value.trim() && !check[0](field.value) ? check[1] : '';
}

function renderMeta(section, prop, { typing = false } = {}) {
  const field = draft[section][prop.name];
  const meta = $(`#${section}-${prop.name}-meta`);
  if (prop.input === 'owner') {
    meta.replaceChildren(field.value ? 'Dalle Impostazioni.' : el('span', { class: 'bad' }, 'Non impostato: indica il tuo ID owner nelle Impostazioni.'));
    return;
  }
  if (prop.input === 'fixed') {
    meta.replaceChildren('Valore per un nuovo prospect.');
    return;
  }
  if (prop.input === 'legalBasis') {
    meta.replaceChildren(draft.legalBasisConfirmed
      ? el('span', { class: 'chip high' }, 'Confermata')
      : el('span', { class: 'chip check' }, 'Valore suggerito: da confermare'));
    return;
  }
  const invalid = typing ? '' : invalidMessage(prop, field);
  meta.replaceChildren(...fieldMeta(field, { invalid, analyzed: draft.site.pages.length > 0, showEvidence: prop.input === 'select' }));
  $(`#${section}-${prop.name}-field`).classList.toggle('warn', Boolean(invalid));
}

function renderField(section, prop) {
  const field = draft[section][prop.name];
  const control = $(`#${section}-${prop.name}`);
  if (prop.input === 'owner') {
    control.textContent = field.value ? `${config.hubspot.ownerName || 'Commerciale'} · ID ${field.value}` : '—';
  } else if (prop.input === 'fixed') {
    control.textContent = `${LEAD_STATUS.label} (${field.value || LEAD_STATUS.value})`;
  } else if (control.value !== field.value) {
    control.value = prop.input === 'select' && !prop.options.includes(field.value) ? '' : field.value;
  }
  if (prop.input === 'legalBasis') $('#legal-basis-confirm').checked = draft.legalBasisConfirmed;
  if (prop.name === 'tipo_struttura_hospitality') control.disabled = draft.company.settore_agria.value !== 'Hospitality';
  renderMeta(section, prop);
  const alts = $(`#${section}-${prop.name}-field .alts`);
  const chips = ['owner', 'fixed', 'legalBasis', 'textarea', 'select'].includes(prop.input) ? [] : alternatives(field.alternatives, (value) => {
    draft = pickAlternative(draft, section, prop.name, value);
    afterEdit(section, prop.name);
  });
  alts.replaceChildren(...chips);
  alts.hidden = !chips.length;
}

function renderReadiness() {
  const { ready, text } = contactReadiness(draft.contact);
  const box = $('#contact-ready');
  box.textContent = text;
  box.dataset.ready = ready ? 'yes' : 'no';
}

function renderForms() {
  for (const [section, props] of Object.entries(PROPS)) for (const prop of props) renderField(section, prop);
  renderReadiness();
}

function renderPeople() {
  const cards = peopleCards(draft.site, draft.mainPerson, (key) => {
    draft = usePerson(draft, key, config);
    renderForms();
    renderPeople();
    scheduleSave();
  });
  $('#people-list').replaceChildren(...(cards.length ? cards : [el('p', { class: 'hint' }, 'Nessuna persona individuata finora.')]));
  $('#people-count').textContent = cards.length ? String(cards.length) : '';
}

function renderSiteData() {
  $('#all-data').replaceChildren(...allDataGroups(draft.site));
  const { pages, failures } = draft.site;
  const details = $('#pages');
  details.hidden = !pages.length && !failures.length;
  $('#pages-title').textContent = `${pages.length} ${pages.length === 1 ? 'pagina analizzata' : 'pagine analizzate'}${failures.length ? ` · ${failures.length} non raggiungibili` : ''}`;
  $('#pages-list').replaceChildren(...pagesList(draft.site));
  const summary = $('#summary');
  summary.hidden = !pages.length;
  summary.textContent = pages.length ? summaryOf(draft.site) : '';
}

function renderAll() {
  renderForms();
  renderPeople();
  renderSiteData();
}

function onEdit(section, name, value) {
  draft = editField(draft, section, name, value);
  const prop = PROPS[section].find((p) => p.name === name);
  renderMeta(section, prop, { typing: true });
  afterEdit(section, name, { rerender: false });
}

function afterEdit(section, name, { rerender = true } = {}) {
  const prop = PROPS[section].find((p) => p.name === name);
  if (rerender) renderField(section, prop);
  if (name === 'settore_agria') renderField('company', PROPS.company.find((p) => p.name === 'tipo_struttura_hospitality'));
  renderField('company', PROPS.company.find((p) => p.name === 'hs_quick_context'));
  if (section === 'contact') renderReadiness();
  if (section === 'company' && (name === 'domain' || name === 'name')) invalidateVerify();
  scheduleSave();
}

// la bozza sopravvive alla chiusura del pannello fino alla chiusura del browser
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.session.set({ draft }).catch((err) => console.warn('[Agria Scout] bozza non salvata:', err));
  }, 300);
}

// ---------------------------------------------------------------------------------------------
// stato, scansione, analisi della singola pagina

function setStatus(state, text, notes = []) {
  $('#status').dataset.state = state;
  $('#status-text').textContent = text;
  const list = $('#status-notes');
  list.replaceChildren(...notes.map((n) => el('li', {}, n)));
  list.hidden = !notes.length;
}

function setProgress(progress) {
  const box = $('#progress');
  box.hidden = !progress;
  if (!progress) return;
  const { index, total, url, phase } = progress;
  const pct = phase === 'sitemap' ? 5 : Math.round((index / Math.max(total, 1)) * 100);
  $('#progress-bar').style.width = `${pct}%`;
  box.querySelector('[role="progressbar"]').setAttribute('aria-valuenow', String(pct));
  $('#progress-url').textContent = url || '';
  setStatus('busy', phase === 'sitemap' ? 'Lettura della sitemap…' : `Analisi pagina ${index} di ${total}…`);
}

function setBusy(mode) {
  busy = mode;
  const scan = $('#deep-scan');
  scan.textContent = mode === 'scan' ? 'Annulla scansione' : 'Scansione approfondita';
  scan.classList.toggle('danger', mode === 'scan');
  scan.classList.toggle('primary', mode !== 'scan');
  scan.disabled = mode === 'analyze';
  $('#analyze').disabled = Boolean(mode);
  $('#clear').disabled = Boolean(mode);
}

function addPage(findings) {
  const { draft: next, mode } = applyFindings(draft, findings, config);
  draft = next;
  invalidateVerify();
  renderAll();
  scheduleSave();
  return mode;
}

async function onDeepScan() {
  if (busy === 'scan') {
    scanController?.abort();
    return;
  }
  if (busy) return;
  setBusy('scan');
  scanController = new AbortController();
  setStatus('busy', 'Lettura della pagina aperta…');
  let firstMode = '';
  try {
    const { snapshot } = await readActivePage();
    const result = await scanSite({
      startUrl: snapshot.url,
      startSnapshot: snapshot,
      maxPages: config.scan.maxPages,
      signal: scanController.signal,
      fetchText: (url, options) => fetchText(url, { ...options, timeoutMs: SCAN_TIMEOUT_MS }),
      toSnapshot: readDownloadedPage,
      onPage: (findings) => {
        const mode = addPage(findings);
        firstMode ||= mode;
      },
      onFailure: (failure) => {
        draft = recordFailure(draft, failure);
        renderSiteData();
        scheduleSave();
      },
      onProgress: setProgress,
    });
    const failed = result.failed ? ` ${result.failed} ${result.failed === 1 ? 'pagina non raggiungibile' : 'pagine non raggiungibili'}: vedi l'elenco.` : '';
    const text = result.cancelled
      ? `Scansione annullata: conservati i dati delle ${result.analyzed} pagine già analizzate.`
      : `Scansione completata${firstMode === 'merged' ? ' (dati aggiunti a quelli già raccolti)' : ''}.${failed}`;
    setStatus(result.cancelled ? 'idle' : 'ok', text, draft.site.notes);
  } catch (err) {
    if (err instanceof PageReadError) setStatus('error', err.message);
    else {
      console.error('[Agria Scout] scansione non riuscita:', err);
      setStatus('error', `Scansione non riuscita: ${err?.message || err}`);
    }
  } finally {
    scanController = null;
    setProgress(null);
    setBusy('');
  }
}

async function onAnalyze() {
  if (busy) return;
  setBusy('analyze');
  setStatus('busy', 'Lettura della pagina in corso…');
  try {
    const { snapshot, stillLoading } = await readActivePage();
    const mode = addPage(analyzeSnapshot(snapshot, { pageType: pageTypeOf(snapshot.url, snapshot.title) }));
    const notes = stillLoading ? ["La pagina stava ancora caricando: se manca qualcosa, ripeti l'analisi.", ...draft.site.notes] : draft.site.notes;
    setStatus('ok', mode === 'merged' ? 'Pagina aggiunta ai dati già raccolti. Le tue correzioni restano.' : 'Analisi della pagina completata.', notes);
  } catch (err) {
    if (err instanceof PageReadError) setStatus('error', err.message);
    else {
      console.error('[Agria Scout] analisi non riuscita:', err);
      setStatus('error', `Analisi non riuscita: ${err?.message || err}`);
    }
  } finally {
    setBusy('');
  }
}

function disarmClear() {
  clearTimeout(clearTimer);
  clearTimer = null;
  const button = $('#clear');
  button.textContent = 'Svuota';
  button.classList.remove('armed');
}

// due clic: il primo chiede conferma, il secondo svuota
function onClear() {
  if (busy) return;
  if (!clearTimer) {
    const button = $('#clear');
    button.textContent = 'Conferma svuota';
    button.classList.add('armed');
    clearTimer = setTimeout(disarmClear, 4000);
    return;
  }
  disarmClear();
  draft = refreshForms(emptyDraft(), config);
  invalidateVerify();
  renderAll();
  scheduleSave();
  setStatus('idle', IDLE_TEXT);
}

// ---------------------------------------------------------------------------------------------
// HubSpot (MOCK)

function hubspotClient() {
  return config.hubspot.mode === 'mock' ? createMockHubspotClient(config.hubspot) : createHubspotClient(config);
}

function showVerify(result) {
  const box = $('#verify-result');
  if (!result) {
    box.hidden = true;
    box.replaceChildren();
    delete box.dataset.kind;
    return;
  }
  box.dataset.kind = result.kind;
  box.replaceChildren(el('strong', {}, result.title), el('p', {}, result.text));
  if (result.detail) box.append(el('p', {}, result.detail));
  if (config.hubspot.mode === 'mock') box.append(el('p', { class: 'mocknote' }, 'Risposta simulata (MOCK): nessun dato letto o scritto su HubSpot.'));
  box.hidden = false;
}

function invalidateVerify() {
  dataVersion += 1;
  showVerify(null);
}

async function onVerify() {
  if (verifying) return;
  verifying = true;
  const button = $('#verify');
  button.disabled = true;
  button.textContent = 'Verifica in corso…';
  showVerify(null);
  const version = dataVersion;
  const query = { domain: draft.company.domain.value, name: draft.company.name.value };
  try {
    const res = await hubspotClient().findCompany(query);
    if (version !== dataVersion) return showVerify(STALE);
    if (res.found) {
      const c = res.companies[0];
      showVerify({ kind: 'found', title: 'Azienda già presente in HubSpot', text: [c.name, c.domain, `ID ${c.id}`].filter(Boolean).join(' · '), detail: 'Non creare un doppione: lavora sulla scheda esistente.' });
    } else {
      showVerify({ kind: 'not_found', title: 'Azienda non presente in HubSpot', text: `Nessuna azienda trovata per ${query.domain || query.name}.`, detail: 'La creazione in HubSpot arriverà in una fase successiva.' });
    }
  } catch (err) {
    if (version !== dataVersion) return showVerify(STALE);
    if (err instanceof HubspotError && err.code === 'invalid_input') showVerify({ kind: 'warn', title: 'Dati insufficienti', text: err.message });
    else showVerify({ kind: 'error', title: 'Verifica non riuscita', text: err instanceof HubspotError ? err.message : `Errore imprevisto: ${err?.message || err}`, detail: 'Riprova tra poco.' });
  } finally {
    verifying = false;
    button.disabled = false;
    button.textContent = 'Verifica HubSpot';
  }
}

function renderConfig() {
  $('#mock-scenario').textContent = MOCK_SCENARIOS[config.hubspot.mockScenario];
}

// ---------------------------------------------------------------------------------------------

async function init() {
  buildForms();
  $('#deep-scan').addEventListener('click', onDeepScan);
  $('#analyze').addEventListener('click', onAnalyze);
  $('#clear').addEventListener('click', onClear);
  $('#verify').addEventListener('click', onVerify);
  $('#open-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('#version').textContent = `v${chrome.runtime.getManifest().version}`;

  onConfigChange((next) => {
    config = next;
    draft = refreshForms(draft, config);
    renderConfig();
    renderForms();
    invalidateVerify();
    scheduleSave();
  });
  try {
    config = await loadConfig();
  } catch (err) {
    console.warn('[Agria Scout] impostazioni non lette, uso quelle predefinite:', err);
  }
  renderConfig();

  const saved = await chrome.storage.session.get('draft').catch(() => ({}));
  draft = refreshForms(restoreDraft(saved.draft), config);
  renderAll();
  if (draft.site.pages.length) setStatus('ok', "Dati ripresi dall'ultima analisi.", draft.site.notes);
  else setStatus('idle', IDLE_TEXT);
}

init().catch((err) => {
  console.error('[Agria Scout] avvio non riuscito:', err);
  setStatus('error', `Avvio non riuscito: ${err?.message || err}`);
});
