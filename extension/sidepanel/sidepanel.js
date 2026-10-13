// Pannello laterale di Agria Commercial. Senza un commerciale attivo nella sessione di Chrome mostra
// solo la sua scelta; poi la shell (shell/shell.js): Home, Scout, Outreach e il Navigatore in una
// scheda ampia. Questo file è il modulo Scout: scansione del sito del prospect, form Azienda e
// Contatto con le proprietà HubSpot, persone e dati rilevati, sezione HubSpot (verifica e creazione,
// vedi hubspotPanel.js: passa sempre dal service worker, che custodisce la Service Key). Tiene la
// bozza del prospect, l'unica fonte da cui leggono anche Outreach (modules/outreach) e la Home.

import { analyzeSnapshot } from '../lib/parser.js';
import { pageTypeOf } from '../lib/discovery.js';
import { fetchText } from '../lib/fetchPage.js';
import { scanSite } from '../lib/scanner.js';
import { factsOf, summaryOf } from '../lib/siteData.js';
import { COMPANY_PROPS, CONTACT_PROPS, isPropVisible, LEAD_STATUS, LEGAL_BASIS } from '../lib/crmModel.js';
import {
  applyFindings, editField, emptyDraft, pickAlternative, recordFailure, refreshForms, resetQuickContext,
  legalBasisEffective, restoreDraft, setLegalBasisConfirmed, usePerson,
} from '../lib/draft.js';
import { clearSessionLegalBasis, loadSessionLegalBasis, onSessionLegalBasisChange, setSessionLegalBasis } from '../lib/legalBasisSession.js';
import { isValidEmail, isValidPhone, normalizeDomain, normalizeLinkedin, normalizeUrl } from '../lib/validation.js';
import { loadConfig, normalizeConfig, onConfigChange } from '../lib/config.js';
import { loadActiveOperator, onOperatorChange, OPERATORS, selectOperator } from '../lib/operators.js';
import { createHubspotPanel } from './hubspotPanel.js';
import { createShell, nextStepCard } from '../shell/shell.js';
import { nextStep as computeNextStep } from '../lib/nextStep.js';
import { createOutreachPanel } from '../modules/outreach/outreachPanel.js';
import { PageReadError, readActivePage, readDownloadedPage } from './pageReader.js';
import { RETURN_ITEM as SETTINGS_RETURN_ITEM } from '../options/backToAgria.js';
import { createDailyCounterBar } from './dailyCounter.js';
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
// campi dell'azienda usati nella ricerca dei doppioni: se cambiano, la verifica HubSpot va rifatta
const DUPLICATE_KEYS = new Set(['name', 'domain', 'website', 'phone', 'email_aziendale_principale', 'email_aziendale_secondaria', 'city']);
const SCAN_TIMEOUT_MS = 10000;

const $ = (selector) => document.querySelector(selector);
const valuesOf = (fields) => Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.value]));
let draft = emptyDraft();
let config = normalizeConfig(null);
let operator = null; // commerciale attivo (operators.js): l'unica fonte di hubspot_owner_id
let sessionLegalBasis = false; // base giuridica predefinita confermata per questa sessione e questo commerciale
let busy = ''; // '' | 'scan' | 'analyze'
let scanController = null;
let hub = null; // sezione HubSpot (hubspotPanel.js)
let shell = null; // navigazione fra i moduli (shell/shell.js)
let outreach = null; // vista Outreach (modules/outreach/outreachPanel.js)
let counterBar = null; // contatore «Oggi N / 20» in fondo al pannello (dailyCounter.js)
let saveTimer = null;
let clearTimer = null;

// ---------------------------------------------------------------------------------------------
// form Azienda e Contatto

function buildForms() {
  for (const [section, props] of Object.entries(PROPS)) {
    const box = $(`#${section}-fields`);
    for (const prop of props) {
      const id = `${section}-${prop.name}`;
      // l'etichetta per il commerciale; il nome tecnico HubSpot resta solo nel suggerimento al passaggio
      const wrap = el('div', { id: `${id}-field`, class: prop.half ? 'field half' : 'field' },
        el('label', { for: id, title: prop.name }, prop.label));
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
          // scelta per questo contatto: vale anche contro la base predefinita di sessione
          draft = setLegalBasisConfirmed(draft, box2.checked);
          box2.checked = legalBasisEffective(draft, sessionLegalBasis);
          renderMeta('contact', prop);
          hub.render();
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
  if (prop.input === 'fixed') {
    meta.replaceChildren('Valore per un nuovo prospect.');
    return;
  }
  if (prop.input === 'legalBasis') {
    let chip = el('span', { class: 'chip check' }, 'Valore suggerito: da confermare');
    if (draft.legalBasisConfirmed) chip = el('span', { class: 'chip high' }, 'Confermata');
    else if (legalBasisEffective(draft, sessionLegalBasis)) chip = el('span', { class: 'chip high' }, 'Predefinita per questa sessione');
    else if (sessionLegalBasis && draft.legalBasisDeclined) chip = el('span', { class: 'chip check' }, 'Non usata per questo contatto');
    meta.replaceChildren(chip);
    return;
  }
  const invalid = typing ? '' : invalidMessage(prop, field);
  meta.replaceChildren(...fieldMeta(field, { invalid, analyzed: draft.site.pages.length > 0, showEvidence: prop.input === 'select' }));
  $(`#${section}-${prop.name}-field`).classList.toggle('warn', Boolean(invalid));
}

// proprietario HubSpot: non sta nella bozza, è sempre il commerciale attivo
function renderOwner(section, prop) {
  $(`#${section}-${prop.name}`).textContent = operator ? `${operator.name} · ID ${operator.hubspotOwnerId}` : '—';
  $(`#${section}-${prop.name}-meta`).replaceChildren(operator ? 'Commerciale attivo in questa sessione.' : el('span', { class: 'bad' }, 'Nessun commerciale attivo.'));
}

function renderField(section, prop) {
  if (prop.input === 'owner') {
    renderOwner(section, prop);
    return;
  }
  const field = draft[section][prop.name];
  const control = $(`#${section}-${prop.name}`);
  if (prop.input === 'fixed') {
    control.textContent = LEAD_STATUS.label;
  } else if (control.value !== field.value) {
    control.value = prop.input === 'select' && !prop.options.includes(field.value) ? '' : field.value;
  }
  if (prop.input === 'legalBasis') $('#legal-basis-confirm').checked = legalBasisEffective(draft, sessionLegalBasis);
  // campi che valgono solo in certi casi (tipo di struttura: solo Hospitality): nascosti del tutto
  if (prop.visibleIf) $(`#${section}-${prop.name}-field`).hidden = !isPropVisible(prop, valuesOf(draft[section]));
  renderMeta(section, prop);
  const alts = $(`#${section}-${prop.name}-field .alts`);
  const chips = ['fixed', 'legalBasis', 'textarea', 'select'].includes(prop.input) ? [] : alternatives(field.alternatives, (value) => {
    draft = pickAlternative(draft, section, prop.name, value);
    afterEdit(section, prop.name);
  });
  alts.replaceChildren(...chips);
  alts.hidden = !chips.length;
}

// la base giuridica compare solo quando il contatto è valido (nome, cognome e un recapito)
function renderReadiness() {
  const { ready, text } = contactReadiness(draft.contact);
  const box = $('#contact-ready');
  box.textContent = text;
  box.dataset.ready = ready ? 'yes' : 'no';
  $('#contact-hs_legal_basis-field').hidden = !ready;
  $('#legal-basis-confirm').disabled = !ready;
  $('#legal-basis-confirm').checked = legalBasisEffective(draft, sessionLegalBasis);
  renderMeta('contact', PROPS.contact.find((p) => p.input === 'legalBasis'));
}

function renderForms() {
  for (const [section, props] of Object.entries(PROPS)) for (const prop of props) renderField(section, prop);
  renderReadiness();
}

function renderPeople() {
  const cards = peopleCards(draft.site, draft.mainPerson, (key) => {
    draft = usePerson(draft, key);
    hub.contactChanged();
    renderForms();
    renderPeople();
    hub.render();
    scheduleSave();
  }, valuesOf(draft.company));
  $('#people-list').replaceChildren(...(cards.length ? cards : [el('p', { class: 'hint' }, 'Nessuna persona individuata finora.')]));
  $('#people-count').textContent = cards.length ? String(cards.length) : '';
}

function renderSiteData() {
  $('#all-data').replaceChildren(...allDataGroups(draft.site));
  const contacts = ['email', 'phone', 'whatsapp'].reduce((n, kind) => n + factsOf(draft.site, kind).length, 0);
  $('#data-count').textContent = contacts ? `${contacts} ${contacts === 1 ? 'recapito' : 'recapiti'}` : '';
  const { pages, failures } = draft.site;
  const details = $('#pages');
  details.hidden = !pages.length && !failures.length;
  $('#pages-title').textContent = `${pages.length} ${pages.length === 1 ? 'pagina analizzata' : 'pagine analizzate'}${failures.length ? ` · ${failures.length} non raggiungibili` : ''}`;
  $('#pages-list').replaceChildren(...pagesList(draft.site));
  const summary = $('#summary');
  summary.hidden = !pages.length;
  summary.textContent = pages.length ? summaryOf(draft.site) : '';
  renderScanButton();
}

function renderAll() {
  renderForms();
  renderPeople();
  renderSiteData();
  hub.render();
  refreshHome();
}

// la Home mostra il prossimo passo calcolato dallo stato attuale (nessuna copia)
function refreshHome() {
  if (shell?.current === 'home') shell.renderHome();
}

function nextStep() {
  return operator ? computeNextStep(draft, { mode: hub.mode, sessionLegalBasis, outreach: outreach?.snapshot() }) : null;
}

// in Scout, quando l'Azienda è in HubSpot: il passaggio a Outreach (primario solo se Scout non ne ha già uno)
function renderHandoff() {
  const step = nextStep();
  const box = $('#scout-next-step');
  if (!shell || !step || step.action?.target !== 'outreach') {
    box.replaceChildren();
    return;
  }
  const createContact = $('#create-contact');
  box.replaceChildren(nextStepCard(step, shell.go, { id: 'scout-next-step', primary: !(createContact && !createContact.disabled) }));
}

// dopo ogni disegno della sezione HubSpot: passaggio a Outreach, vista Outreach e Home allineati
function afterHubspotRender() {
  renderHandoff();
  outreach?.render();
  refreshHome();
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
  // campi condizionali (Paese: solo per un prospect estero) seguono gli altri valori; mai quello che si sta scrivendo
  if (section === 'company') {
    for (const p of PROPS.company) if (p.visibleIf && p.name !== name) $(`#company-${p.name}-field`).hidden = !isPropVisible(p, valuesOf(draft.company));
  }
  renderField('company', PROPS.company.find((p) => p.name === 'hs_quick_context'));
  if (section === 'contact') renderReadiness();
  if (section === 'company' && DUPLICATE_KEYS.has(name)) hub.dataChanged();
  // telefono ed email dell'azienda cambiano i segnali commerciali delle persone
  if (section === 'company' && ['phone', 'email_aziendale_principale', 'email_aziendale_secondaria'].includes(name)) renderPeople();
  if (section === 'contact') hub.contactChanged();
  hub.render(); // anteprima dei dati da scrivere
  scheduleSave();
}

// la bozza sopravvive alla chiusura del pannello fino alla chiusura del browser
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.session.set({ draft }).catch((err) => console.warn('[Agria Commercial] bozza non salvata:', err));
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

// la scansione è l'azione primaria solo finché non ci sono dati: dopo tocca alla verifica HubSpot
function renderScanButton() {
  const scan = $('#deep-scan');
  scan.textContent = busy === 'scan' ? 'Annulla scansione' : 'Scansione approfondita';
  scan.classList.toggle('danger', busy === 'scan');
  scan.classList.toggle('primary', busy !== 'scan' && draft.site.pages.length === 0);
  scan.setAttribute('aria-busy', String(busy === 'scan'));
}

function setBusy(mode) {
  busy = mode;
  renderScanButton();
  const scan = $('#deep-scan');
  scan.disabled = mode === 'analyze';
  $('#analyze').disabled = Boolean(mode);
  $('#clear').disabled = Boolean(mode);
}

function addPage(findings) {
  const { draft: next, mode } = applyFindings(draft, findings);
  draft = next;
  hub.dataChanged();
  renderAll();
  scheduleSave();
  return mode;
}

async function onDeepScan() {
  if (busy === 'scan') {
    scanController?.abort();
    return;
  }
  if (busy || needsOperator()) return;
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
      console.error('[Agria Commercial] scansione non riuscita:', err);
      setStatus('error', `Scansione non riuscita: ${err?.message || err}`);
    }
  } finally {
    scanController = null;
    setProgress(null);
    setBusy('');
  }
}

async function onAnalyze() {
  if (busy || needsOperator()) return;
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
      console.error('[Agria Commercial] analisi non riuscita:', err);
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
  draft = refreshForms(emptyDraft());
  hub.dataChanged();
  renderAll();
  scheduleSave();
  setStatus('idle', IDLE_TEXT);
}

// ---------------------------------------------------------------------------------------------
// commerciale attivo: si sceglie all'apertura e vale per la sessione di Chrome (chrome.storage.session)

function buildPicker() {
  $('#operator-list').replaceChildren(...OPERATORS.map((o) => el('button', {
    type: 'button', class: 'operator', 'data-owner-id': o.hubspotOwnerId, onclick: () => onPickOperator(o.hubspotOwnerId),
  }, el('span', { class: 'operator-name' }, o.name), el('span', { class: 'operator-id' }, `Owner ID ${o.hubspotOwnerId}`))));
  $('#change-operator').addEventListener('click', () => showPicker(true));
  $('#operator-cancel').addEventListener('click', () => showPicker(false));
}

/** La scelta del commerciale al posto del pannello: obbligatoria finché non ce n'è uno attivo. */
function showPicker(open) {
  const picking = open || !operator;
  $('#operator-picker').hidden = !picking;
  $('#app').hidden = picking;
  $('#module-nav').hidden = picking;
  $('#operator-cancel').hidden = !operator;
  $('#daily-counter').hidden = picking;
  $('#operator-error').textContent = '';
  for (const b of document.querySelectorAll('#operator-list .operator')) b.setAttribute('aria-current', String(b.dataset.ownerId === operator?.hubspotOwnerId));
}

// Azienda e Contatto mostrano subito il nuovo proprietario: la bozza non lo contiene
function applyOperator(next) {
  operator = next;
  $('#active-name').textContent = operator?.name || '';
  for (const [section, props] of Object.entries(PROPS)) for (const prop of props) if (prop.input === 'owner') renderOwner(section, prop);
  showPicker(false);
  hub.render(); // l'anteprima HubSpot mostra il nuovo proprietario
  outreach.render(); // «Invia da», testo dell'email e account Gmail del nuovo commerciale
  counterBar.refresh(); // il contatore è del commerciale attivo
  refreshHome();
  refreshSessionLegalBasis(); // la base predefinita vale solo per il commerciale che l'ha confermata
}

async function onPickOperator(id) {
  try {
    const previous = operator?.hubspotOwnerId || '';
    const next = await selectOperator(id);
    // nuovo commerciale, nuova sessione operatore: la base giuridica va confermata di nuovo
    if (previous !== next.hubspotOwnerId) await clearSessionLegalBasis();
    applyOperator(next);
  } catch (err) {
    $('#operator-error').textContent = `Scelta non salvata: ${err?.message || err}`;
  }
}

// ---------------------------------------------------------------------------------------------
// base giuridica predefinita per i nuovi prospect (solo sessione di Chrome, solo questo commerciale)

async function refreshSessionLegalBasis() {
  sessionLegalBasis = await loadSessionLegalBasis(operator).catch(() => false);
  $('#session-legal-basis').checked = sessionLegalBasis;
  renderReadiness();
  hub.render();
  refreshHome();
}

function buildSessionLegalBasis() {
  $('#session-legal-value').textContent = LEGAL_BASIS;
  $('#session-legal-basis').addEventListener('change', async (event) => {
    await setSessionLegalBasis(operator, event.target.checked).catch(() => {});
    await refreshSessionLegalBasis();
  });
  onSessionLegalBasisChange(refreshSessionLegalBasis); // anche da un altro pannello della sessione
}

// senza commerciale attivo niente scansione, verifica HubSpot o operazioni CRM
function needsOperator() {
  if (operator) return false;
  showPicker(true);
  return true;
}

// Impostazioni: si ricorda la scheda su cui si stava lavorando (solo id, nella sessione), così
// «← Torna ad Agria Commercial» ci riporta lì senza chiudere nulla (options/backToAgria.js).
async function openSettings() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null) await chrome.storage.session.set({ [SETTINGS_RETURN_ITEM]: { tabId: tab.id, windowId: tab.windowId } });
  } catch {
    // senza la scheda di ritorno il pulsante riapre comunque il pannello
  }
  chrome.runtime.openOptionsPage();
}

// ---------------------------------------------------------------------------------------------

async function init() {
  buildForms();
  buildPicker();
  $('#deep-scan').addEventListener('click', onDeepScan);
  $('#analyze').addEventListener('click', onAnalyze);
  $('#clear').addEventListener('click', onClear);
  $('#open-settings').addEventListener('click', openSettings);
  $('#version').textContent = `v${chrome.runtime.getManifest().version}`;

  hub = createHubspotPanel({
    $,
    getDraft: () => draft,
    setDraft: (next) => {
      draft = next;
      scheduleSave();
    },
    getOperator: () => operator,
    getSessionLegalBasis: () => sessionLegalBasis,
    needsOperator,
    afterRender: afterHubspotRender,
  });
  outreach = createOutreachPanel({
    $,
    getDraft: () => draft,
    getOperator: () => operator,
    getHubspot: () => hub.status,
    onNavigate: (view) => shell.show(view, { focus: true }),
    onChange: () => {
      renderHandoff();
      refreshHome();
      counterBar.refresh(); // un primo contatto registrato conta subito
    },
  });
  counterBar = createDailyCounterBar({ $, getOperator: () => operator });
  counterBar.init();
  buildSessionLegalBasis();
  shell = createShell({
    $,
    nextStep,
    onView: (view) => {
      hub.render();
      counterBar.refresh();
      if (view === 'outreach') outreach.show();
      else outreach.hide();
    },
  });
  onConfigChange((next) => {
    // un altro scenario MOCK o un'altra modalità: la verifica fatta prima non vale più
    if (next.hubspot.mode !== config.hubspot.mode || next.hubspot.mockScenario !== config.hubspot.mockScenario) hub.dataChanged();
    config = next;
    hub.refreshStatus();
  });
  onOperatorChange(applyOperator); // anche se lo sceglie un altro pannello di questa sessione
  try {
    config = await loadConfig();
  } catch (err) {
    console.warn('[Agria Commercial] impostazioni non lette, uso quelle predefinite:', err?.message || err);
  }
  operator = await loadActiveOperator().catch((err) => {
    console.warn('[Agria Commercial] commerciale attivo non letto:', err);
    return null;
  });

  const saved = await chrome.storage.session.get('draft').catch(() => ({}));
  draft = refreshForms(restoreDraft(saved.draft));
  await hub.init();
  outreach.init();
  await shell.init(); // la vista aperta prima in questa sessione, altrimenti la Home
  renderAll();
  applyOperator(operator);
  if (draft.site.pages.length) setStatus('ok', "Dati ripresi dall'ultima analisi.", draft.site.notes);
  else setStatus('idle', IDLE_TEXT);
}

init().catch((err) => {
  console.error('[Agria Commercial] avvio non riuscito:', err);
  setStatus('error', `Avvio non riuscito: ${err?.message || err}`);
  $('#app').hidden = false; // l'errore resta visibile; scansione e verifica chiedono comunque il commerciale
});
