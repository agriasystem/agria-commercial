// Pannello laterale di Agria Scout: analisi della pagina, correzione dei dati, verifica HubSpot.
// Tutto il testo che arriva dalla pagina va a schermo con textContent / value, mai come HTML.

import { analyzeSnapshot, COMPANY_FIELDS, CONTACT_FIELDS } from '../lib/parser.js';
import { applyAnalysis, editField, emptyDraft, pickAlternative, restoreDraft, usePerson } from '../lib/draft.js';
import { isValidEmail, isValidPhone, normalizeDomain, normalizeLinkedin, normalizeUrl } from '../lib/validation.js';
import { loadConfig, MOCK_SCENARIOS, normalizeConfig, onConfigChange } from '../lib/config.js';
import { createHubspotClient, HubspotError } from '../lib/hubspotClient.js';
import { createMockHubspotClient } from '../lib/mockHubspotClient.js';
import { PageReadError, readActivePage } from './pageReader.js';

const SECTIONS = { company: COMPANY_FIELDS, contact: CONTACT_FIELDS };
const LABELS = {
  company: { name: 'Nome azienda', website: 'Sito web', domain: 'Dominio', email: 'Email', phone: 'Telefono', address: 'Indirizzo', city: 'Città', region: 'Regione' },
  contact: { firstName: 'Nome', lastName: 'Cognome', role: 'Ruolo', email: 'Email', phone: 'Telefono', linkedin: 'LinkedIn' },
};
const HALF = new Set(['company.city', 'company.region', 'contact.firstName', 'contact.lastName']);
const INPUT_MODE = { email: 'email', phone: 'tel', website: 'url', linkedin: 'url' };
// controlli sulle correzioni a mano: avvisano, non bloccano
const CHECKS = {
  'company.website': [(v) => normalizeUrl(v) !== '', 'Indirizzo web non valido.'],
  'company.domain': [(v) => normalizeDomain(v) !== '', 'Dominio non valido (es. agriturismo.it).'],
  'company.email': [isValidEmail, 'Email non valida.'],
  'company.phone': [isValidPhone, 'Numero non riconosciuto: controlla le cifre.'],
  'contact.email': [isValidEmail, 'Email non valida.'],
  'contact.phone': [isValidPhone, 'Numero non riconosciuto: controlla le cifre.'],
  'contact.linkedin': [(v) => normalizeLinkedin(v)?.kind === 'profile', 'Serve il link a un profilo personale (linkedin.com/in/…).'],
};
const IDLE_TEXT = 'Apri il sito di un prospect e premi «Analizza pagina».';
const STALE = { kind: 'warn', title: 'Verifica da ripetere', text: 'Dati o impostazioni sono cambiati durante la verifica.' };

const $ = (selector) => document.querySelector(selector);
let draft = emptyDraft();
let config = normalizeConfig(null);
let analyzing = false;
let verifying = false;
let dataVersion = 0; // cresce a ogni cambio di dati: una verifica partita prima non vale più
let saveTimer = null;
let clearTimer = null;

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

// ---------------------------------------------------------------------------------------------
// campi

function buildForm() {
  for (const [section, keys] of Object.entries(SECTIONS)) {
    const box = $(`#${section}-fields`);
    for (const key of keys) {
      const id = `${section}-${key}`;
      const wrap = el('div', { id: `${id}-field`, class: HALF.has(`${section}.${key}`) ? 'field half' : 'field' });
      const input = el('input', { id, type: 'text', autocomplete: 'off', spellcheck: 'false', inputmode: INPUT_MODE[key] || 'text', 'aria-describedby': `${id}-meta` });
      input.addEventListener('input', () => onFieldInput(section, key, input.value));
      input.addEventListener('blur', () => renderMeta(section, key));
      wrap.append(el('label', { for: id }, LABELS[section][key]), input, el('div', { id: `${id}-meta`, class: 'meta' }), el('div', { class: 'alts', hidden: '' }));
      box.append(wrap);
    }
  }
}

function renderMeta(section, key, { typing = false } = {}) {
  const f = draft[section][key];
  const check = CHECKS[`${section}.${key}`];
  const invalid = !typing && Boolean(f.value.trim()) && Boolean(check) && !check[0](f.value);
  const parts = [];
  if (invalid) parts.push(['bad', check[1]]);
  if (f.edited) parts.push(['edit', 'Modificato a mano']);
  else if (f.value) {
    parts.push(['', `Fonte: ${f.source}`]);
    if (f.uncertain) parts.push(['unc', 'da verificare']);
  } else if (draft.page) parts.push(['', 'Non trovato nella pagina']);
  $(`#${section}-${key}-meta`).replaceChildren(...parts.flatMap(([cls, text], i) => [
    ...(i ? [document.createTextNode(' · ')] : []),
    el('span', cls ? { class: cls } : {}, text),
  ]));
  $(`#${section}-${key}-field`).classList.toggle('warn', invalid);
}

function renderAlternatives(section, key) {
  const box = $(`#${section}-${key}-field .alts`);
  const alternatives = draft[section][key].alternatives.slice(0, 4);
  const buttons = alternatives.map((value) => {
    const button = el('button', { type: 'button', class: 'alt', title: `Usa questo valore: ${value}` }, value);
    button.addEventListener('click', () => {
      draft = pickAlternative(draft, section, key, value);
      dataChanged(section, key);
      renderField(section, key);
    });
    return button;
  });
  box.replaceChildren(...(buttons.length ? [el('span', { class: 'lbl' }, 'Altri trovati:'), ...buttons] : []));
  box.hidden = !buttons.length;
}

function renderField(section, key) {
  const input = $(`#${section}-${key}`);
  if (input.value !== draft[section][key].value) input.value = draft[section][key].value;
  renderMeta(section, key);
  renderAlternatives(section, key);
}

function renderSection(section) {
  for (const key of SECTIONS[section]) renderField(section, key);
}

function renderPeople() {
  const buttons = draft.people.map((p, index) => {
    const button = el('button', { type: 'button', class: 'person', title: 'Usa come contatto' });
    button.append(
      el('span', { class: 'n' }, `${p.firstName} ${p.lastName}`.trim()),
      el('span', { class: 'r' }, [p.role, p.email].filter(Boolean).join(' · ') || `Fonte: ${p.source}`),
    );
    button.addEventListener('click', () => {
      draft = usePerson(draft, index);
      renderSection('contact');
      renderPeople();
      scheduleSave();
    });
    return button;
  });
  $('#people-list').replaceChildren(...buttons);
  $('#people').hidden = !buttons.length;
}

function renderAll() {
  renderSection('company');
  renderSection('contact');
  renderPeople();
}

function onFieldInput(section, key, value) {
  draft = editField(draft, section, key, value);
  renderMeta(section, key, { typing: true });
  dataChanged(section, key);
}

function dataChanged(section, key) {
  if (section === 'company' && (key === 'domain' || key === 'name')) invalidateVerify();
  scheduleSave();
}

// la bozza sopravvive alla chiusura del pannello fino alla chiusura del browser
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.session.set({ draft }).catch((err) => console.warn('[Agria Scout] bozza non salvata:', err));
  }, 250);
}

// ---------------------------------------------------------------------------------------------
// stato e analisi

function setStatus(state, text, { page = '', notes = [] } = {}) {
  $('#status').dataset.state = state;
  $('#status-text').textContent = text;
  const pageLine = $('#status-page');
  pageLine.textContent = page ? `Pagina: ${page}` : '';
  pageLine.hidden = !page;
  const list = $('#status-notes');
  list.replaceChildren(...notes.map((n) => el('li', {}, n)));
  list.hidden = !notes.length;
}

async function onAnalyze() {
  if (analyzing) return;
  analyzing = true;
  const button = $('#analyze');
  button.disabled = true;
  button.textContent = 'Analisi in corso…';
  setStatus('busy', 'Lettura della pagina in corso…');
  try {
    const { snapshot, stillLoading } = await readActivePage();
    const result = analyzeSnapshot(snapshot);
    const { draft: next, mode, added } = applyAnalysis(draft, result);
    draft = next;
    invalidateVerify();
    renderAll();
    scheduleSave();
    const notes = stillLoading ? ["La pagina stava ancora caricando: se manca qualcosa, ripeti l'analisi.", ...result.notes] : result.notes;
    let text = `Analisi completata: ${result.found} dati trovati.`;
    if (mode === 'merged') text = added ? `Pagina aggiunta: ${added} nuovi dati. Le tue correzioni restano.` : 'Pagina aggiunta: nessun dato nuovo. Le tue correzioni restano.';
    setStatus('ok', text, { page: result.page.url, notes });
  } catch (err) {
    if (err instanceof PageReadError) setStatus('error', err.message);
    else {
      console.error('[Agria Scout] analisi non riuscita:', err);
      setStatus('error', `Analisi non riuscita: ${err?.message || err}`);
    }
  } finally {
    analyzing = false;
    button.disabled = false;
    button.textContent = 'Analizza pagina';
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
  if (!clearTimer) {
    const button = $('#clear');
    button.textContent = 'Conferma svuota';
    button.classList.add('armed');
    clearTimer = setTimeout(disarmClear, 4000);
    return;
  }
  disarmClear();
  draft = emptyDraft();
  invalidateVerify();
  renderAll();
  scheduleSave();
  setStatus('idle', IDLE_TEXT);
}

// ---------------------------------------------------------------------------------------------
// HubSpot

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
  buildForm();
  $('#analyze').addEventListener('click', onAnalyze);
  $('#clear').addEventListener('click', onClear);
  $('#verify').addEventListener('click', onVerify);
  $('#open-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('#version').textContent = `v${chrome.runtime.getManifest().version}`;

  onConfigChange((next) => {
    config = next;
    renderConfig();
    invalidateVerify();
  });
  try {
    config = await loadConfig();
  } catch (err) {
    console.warn('[Agria Scout] impostazioni non lette, uso quelle predefinite:', err);
  }
  renderConfig();

  const saved = await chrome.storage.session.get('draft').catch(() => ({}));
  draft = restoreDraft(saved.draft);
  renderAll();
  if (draft.page) setStatus('ok', "Dati ripresi dall'ultima analisi.", { page: draft.page.url, notes: draft.notes });
  else setStatus('idle', IDLE_TEXT);
}

init().catch((err) => {
  console.error('[Agria Scout] avvio non riuscito:', err);
  setStatus('error', `Avvio non riuscito: ${err?.message || err}`);
});
