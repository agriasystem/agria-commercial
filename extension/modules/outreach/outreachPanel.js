// Vista Outreach del pannello: primo contatto e primo follow-up del prospect che Scout ha portato in
// HubSpot. Il commerciale invia la prima email dal suo account aziendale (Agria Commercial non invia
// e non legge email), sceglie a chi l'ha inviata e conferma: il service worker aggiorna HubSpot e
// crea il follow-up. Il prospect viene dalla bozza di Scout; l'operazione vive nel service worker
// (sessione di Chrome). Qui c'è solo l'ultima risposta ricevuta, per disegnare la vista.
// Un'Azienda già contattata si mostra soltanto: nessuna azione di primo contatto, nemmeno la sola
// data del Contatto (l'azione outreachContactDate del service worker resta, non esposta).

import { el } from '../../ui/dom.js';
import { feedback } from '../../ui/feedback.js';
import { MESSAGE } from '../../lib/hubspotMessages.js';
import { outreachProspect, recipientOptions, statusLabel } from '../../lib/outreach.js';
import { followUpSchedule, formatDue, formatHubspotDate, formatRomeDateTime } from '../../lib/outreachTime.js';
import { openNavigator } from '../navigator/navigator.js';
import { OUTREACH } from './outreach.js';

const UNAVAILABLE = { ok: false, error: { code: 'unavailable', message: 'Il servizio HubSpot di Agria Commercial non risponde: chiudi e riapri il pannello.' } };
const SESSION_ITEM = 'hubspotSession';
const lines = (text) => String(text || '').split('\n').filter(Boolean).map((l) => el('p', {}, l));
const link = (url, text) => (/^https:\/\//.test(url || '') ? el('a', { class: 'src', href: url, target: '_blank', rel: 'noopener noreferrer' }, text) : null);
const withId = (id, node) => Object.assign(node, { id });

/**
 * getDraft: bozza di Scout; getOperator: commerciale attivo; getHubspot: () => { mode, ready, blocker }
 * (dal pannello HubSpot di Scout); onNavigate(view): apre un'altra vista; onChange(): l'esito di
 * Outreach è cambiato (Prossimo passo da ridisegnare).
 */
export function createOutreachPanel({ $, getDraft, getOperator, getHubspot, onNavigate, onChange = () => {} }) {
  let key = ''; // modalità + Azienda a cui si riferisce l'ultima risposta
  let info = null; // { company, contact, contacted, operation, mock } dall'ultima risposta del service worker
  let busy = ''; // '' | 'read' | 'confirm' | 'retry'
  let error = null; // ultimo errore { code, message }
  let choice = ''; // destinatario scelto (chiave di recipientOptions)
  let visible = false;
  let notice = ''; // esito da annunciare (lettori di schermo)

  const call = (action, payload = {}) => chrome.runtime.sendMessage({ type: MESSAGE, action, ...payload }).then((r) => r || UNAVAILABLE, () => UNAVAILABLE);
  const prospect = () => (getOperator() ? outreachProspect(getDraft(), getHubspot().mode) : null);
  const keyOf = (p) => (p ? `${getHubspot().mode}:${p.companyId}` : '');

  // il prospect di Scout è cambiato (altra Azienda, altra modalità): la risposta precedente non vale più
  function sync() {
    const p = prospect();
    const next = keyOf(p);
    if (next !== key) {
      key = next;
      info = null;
      error = null;
      choice = '';
      if (p) loadOperation(p);
      if (p && visible) read();
    }
    return p;
  }

  async function loadOperation(p) {
    const asked = keyOf(p);
    const res = await call('outreachState', { companyId: p.companyId });
    if (!res.ok || asked !== key) return;
    info = { ...(info || {}), operation: res.operation };
    render();
    onChange();
  }

  async function read() {
    const p = prospect();
    if (!p || busy || !getHubspot().ready) return;
    const asked = keyOf(p);
    busy = 'read';
    render();
    const res = await call('outreachRead', { companyId: p.companyId, contactId: p.contact?.id || '' });
    busy = '';
    if (asked === key) {
      if (res.ok) {
        info = { company: res.company, contact: res.contact, contacted: res.contacted, operation: res.operation, mock: res.mock };
        error = null;
      } else error = res.error;
    }
    render();
    onChange();
  }

  async function onConfirm() {
    const p = prospect();
    const option = recipientOptions(p).find((o) => o.key === choice);
    if (!p || !option || busy) return;
    busy = 'confirm'; // il pulsante si disattiva subito: un secondo clic non parte
    error = null;
    render();
    const res = await call('outreachConfirm', { companyId: p.companyId, recipient: { type: option.type, contactId: option.contactId || '', email: option.email || '' } });
    busy = '';
    if (!res.ok) error = res.error;
    else if (res.outcome === 'already') {
      info = { ...info, company: res.company, contacted: true, operation: null };
      notice = 'Questa Azienda risulta già contattata: nessuna modifica.';
    } else afterOperation(res.operation);
    render({ focusResult: true });
    onChange();
  }

  async function onRetry() {
    const p = prospect();
    if (!p || busy) return;
    busy = 'retry';
    error = null;
    render();
    const res = await call('outreachRetry', { companyId: p.companyId });
    busy = '';
    if (!res.ok) error = res.error;
    else afterOperation(res.operation);
    render({ focusResult: true });
    onChange();
  }

  function afterOperation(op) {
    const companyDone = op?.steps.company === 'done';
    info = {
      ...info, operation: op, contacted: info?.contacted || companyDone,
      company: companyDone ? { ...info?.company, leadStatus: 'ATTEMPTED_TO_CONTACT' } : info?.company,
    };
    notice = op?.complete ? `Primo contatto registrato. Follow-up programmato per ${formatDue(op.dueAt)}.` : 'Primo contatto non completato: controlla il messaggio.';
  }

  // ---- disegno ----

  function emptyView() {
    return [
      el('p', { id: 'outreach-empty', class: 'placeholder-text' }, OUTREACH.empty),
      el('p', { class: 'hint' }, "In Scout analizza il sito del prospect, verifica in HubSpot e crea l'Azienda (o trova quella già presente)."),
      el('button', { id: 'outreach-to-scout', class: 'btn primary', type: 'button', onclick: () => onNavigate('scout') }, 'Vai a Scout'),
    ];
  }

  function facts(p) {
    const company = info?.company;
    return el('dl', { id: 'outreach-facts', class: 'facts' },
      el('dt', {}, 'Azienda'), el('dd', {}, company?.name || p.name || '—'),
      el('dt', {}, 'Stato'), el('dd', { id: 'outreach-status' }, company ? statusLabel(company.leadStatus) : busy === 'read' ? 'Lettura da HubSpot…' : '—'));
  }

  function firstContactForm(p) {
    const options = recipientOptions(p);
    const option = options.find((o) => o.key === choice);
    const operator = getOperator();
    const { dueAt } = followUpSchedule(Date.now());
    const contactDate = option?.type === 'contact' ? info?.contact?.firstEmailAt : '';
    const steps = [
      'Stato lead → Primo contatto inviato',
      'Registra data primo invio Azienda',
      option?.type === 'contact' && !contactDate ? 'Registra data primo invio al Contatto' : null,
      `Crea follow-up per ${formatDue(dueAt)}`,
      `Assegna a ${operator?.name || '—'}`,
    ].filter(Boolean);
    const confirmBusy = busy === 'confirm';
    return [
      el('fieldset', { id: 'outreach-recipient', class: 'choices' },
        el('legend', {}, 'Destinatario prima email'),
        ...options.map((o, i) => el('label', { class: 'choice', for: `outreach-r${i}` },
          el('input', {
            id: `outreach-r${i}`, type: 'radio', name: 'outreach-recipient', value: o.key, checked: o.key === choice, disabled: Boolean(busy),
            onchange: () => { choice = o.key; render(); $(`#outreach-r${i}`)?.focus(); },
          }),
          el('span', {}, o.label)))),
      el('p', { class: 'send-now' }, 'Invia ora la prima email dal tuo account aziendale.'),
      el('section', { id: 'outreach-preview', class: 'preview-box', 'aria-labelledby': 'outreach-preview-title' },
        el('h3', { id: 'outreach-preview-title' }, 'Cosa succederà'),
        el('ul', { class: 'checks' }, ...steps.map((s) => el('li', {}, s))),
        contactDate ? el('p', { class: 'meta' }, `Il Contatto ha già una data di primo invio (${formatHubspotDate(contactDate)}): resta invariata.`) : null),
      error ? withId('outreach-error', feedback('error', 'Primo contatto non registrato', ...lines(error.message))) : null,
      el('button', {
        id: 'outreach-confirm', class: 'btn primary wide', type: 'button', disabled: Boolean(busy) || !option, 'aria-busy': String(confirmBusy),
        'aria-describedby': option ? 'outreach-confirm-note' : 'outreach-choose-note', onclick: onConfirm,
      }, confirmBusy ? 'Registrazione in corso…' : 'Conferma email inviata e crea follow-up'),
      option ? null : el('p', { id: 'outreach-choose-note', class: 'meta' }, 'Scegli prima a chi hai inviato la prima email.'),
      el('p', { id: 'outreach-confirm-note', class: 'meta' }, 'Conferma solo dopo aver inviato davvero l\'email: Agria Commercial non invia email e non legge la posta.'),
    ];
  }

  function operationView(op) {
    const out = [];
    if (op.steps.company === 'done') {
      const contactLine = {
        done: `Data primo invio al Contatto: ${formatRomeDateTime(op.confirmedAt)}`,
        kept: 'Data primo invio al Contatto: già presente, invariata',
      }[op.steps.contact];
      out.push(feedback('success', 'Primo contatto registrato',
        el('p', {}, 'Stato lead: Primo contatto inviato'),
        el('p', {}, op.writes.companyDate ? `Data primo invio Azienda: ${formatRomeDateTime(op.confirmedAt)}` : 'Data primo invio Azienda: già presente, invariata'),
        contactLine ? el('p', {}, contactLine) : null,
        el('p', {}, `Destinatario: ${op.recipient.label}`)));
      if (['error', 'uncertain'].includes(op.steps.contact)) out.push(feedback('warning', 'Data del Contatto non registrata', ...lines(op.errors.contact)));
      if (op.steps.task === 'done') {
        out.push(withId('outreach-follow-up', feedback('success', 'Follow-up programmato',
          el('p', {}, `${formatDue(op.dueAt)} · assegnato a ${op.ownerName}`),
          el('p', {}, 'Chiamata, promemoria 30 minuti prima.'))));
      } else {
        out.push(withId('outreach-follow-up', feedback('warning', 'Follow-up non creato', ...lines(op.errors.task || 'Il follow-up non è ancora stato creato.'),
          el('p', {}, 'Il nuovo tentativo crea solo il follow-up: stato e date restano come sono.'))));
      }
    } else {
      out.push(feedback('warning', 'Registrazione da verificare', ...lines(op.errors.company || "L'operazione si è interrotta prima della risposta di HubSpot."),
        el('p', {}, 'Il nuovo tentativo rilegge HubSpot e non riscrive una data già presente.')));
    }
    if (error) out.push(feedback('error', 'Nuovo tentativo non riuscito', ...lines(error.message)));
    if (!op.complete) {
      const onlyTask = op.steps.company === 'done' && !['error', 'uncertain'].includes(op.steps.contact);
      const label = onlyTask ? 'Riprova creazione follow-up' : 'Riprova registrazione';
      out.push(el('button', { id: 'outreach-retry', class: 'btn primary wide', type: 'button', disabled: Boolean(busy), 'aria-busy': String(busy === 'retry'), onclick: onRetry },
        busy === 'retry' ? 'Nuovo tentativo in corso…' : label));
    } else {
      out.push(el('div', { class: 'next-call' },
        el('p', {}, 'Prossimo passo: la telefonata di follow-up. Durante la chiamata usa il Navigatore.'),
        el('button', { id: 'outreach-navigator', class: 'btn', type: 'button', onclick: () => openNavigator() }, 'Apri Navigatore ', el('span', { 'aria-hidden': 'true' }, '↗'))));
    }
    return out;
  }

  // Azienda già contattata: solo il suo stato e la data del primo invio, nessuna azione
  function contactedView(p) {
    const company = info.company;
    return [
      withId('outreach-contacted', feedback('info', 'Questa Azienda risulta già contattata.',
        el('dl', { class: 'facts' },
          el('dt', {}, 'Stato attuale'), el('dd', {}, statusLabel(company.leadStatus)),
          el('dt', {}, 'Data primo invio'), el('dd', {}, formatHubspotDate(company.firstEmailAt) || 'Non registrata')),
        el('p', {}, 'Nessun nuovo primo contatto e nessun follow-up automatico.'))),
      link(company.url || p.url, 'Apri in HubSpot'),
    ];
  }

  function render({ focusResult = false } = {}) {
    const body = $('#outreach-body');
    if (!body) return;
    const p = sync();
    const hub = getHubspot();
    const children = [];
    if (!p) children.push(...emptyView());
    else {
      children.push(facts(p));
      if (!hub.ready) children.push(feedback('blocked', hub.blocker || 'HubSpot non è pronto.'));
      else if (info?.operation) children.push(...operationView(info.operation));
      else if (!info?.company && busy === 'read') children.push(feedback('info', 'Lettura dello stato in HubSpot…'));
      else if (!info?.company && error) {
        children.push(feedback('error', 'Stato non letto da HubSpot', ...lines(error.message)));
        children.push(el('button', { id: 'outreach-reload', class: 'btn primary', type: 'button', onclick: read }, 'Riprova lettura'));
      } else if (!info?.company) {
        children.push(el('button', { id: 'outreach-reload', class: 'btn primary', type: 'button', onclick: read }, 'Leggi lo stato da HubSpot'));
      } else if (info.contacted) children.push(...contactedView(p), ...(error ? [feedback('error', 'Lettura da HubSpot non riuscita', ...lines(error.message))] : []));
      else children.push(...firstContactForm(p));
      if (info?.mock || (hub.mode === 'mock' && p)) children.push(el('p', { class: 'mocknote' }, 'Simulazione (MOCK): nessun dato letto o scritto su HubSpot.'));
      if (info?.company && !busy) children.push(el('button', { id: 'outreach-refresh', class: 'btn ghost small', type: 'button', onclick: read }, 'Aggiorna da HubSpot'));
    }
    body.replaceChildren(...children.filter(Boolean));
    body.setAttribute('aria-busy', String(Boolean(busy)));
    const live = $('#outreach-live');
    if (live && notice) {
      live.textContent = notice;
      notice = '';
    }
    if (focusResult) body.querySelector('.fb')?.setAttribute('tabindex', '-1');
    if (focusResult) body.querySelector('.fb')?.focus();
  }

  return {
    render,
    /** Vista mostrata: si legge HubSpot (stato e date attuali), mai prima. */
    show() {
      visible = true;
      sync();
      render();
      if (info?.company == null || !busy) read();
    },
    hide() {
      visible = false;
    },
    /** Quello che serve al Prossimo passo: { companyId, operation, company, contacted } | null */
    snapshot() {
      const p = prospect();
      if (!p || keyOf(p) !== key || !info) return null;
      return { companyId: p.companyId, operation: info.operation || null, company: info.company || null, contacted: Boolean(info.contacted) };
    },
    init() {
      // un'operazione cambiata da un altro pannello della sessione (o dal service worker): si ricarica
      chrome.storage.session.onChanged.addListener((changes) => {
        const p = prospect();
        if (changes[SESSION_ITEM] && p && !busy) loadOperation(p);
      });
      render();
    },
  };
}
