// Vista Outreach del pannello: primo contatto e primo follow-up del prospect che Scout ha portato in
// HubSpot. Il commerciale sceglie i destinatari (Azienda: A = email principale, CC = le altre email
// aziendali utilizzabili, ciascuna si può togliere; oppure il Contatto HubSpot), invia la prima email
// dal suo account aziendale (Agria Commercial non invia e non legge email) e la registra in due passi:
//   1. «Ho inviato l'email»  → nessuna scrittura: si fissano i destinatari e si apre la verifica;
//   2. verifica con A/CC, casella obbligatoria «Confermo di aver realmente inviato…», poi
//      «Conferma invio e crea follow-up» (l'unico clic che scrive) oppure «Indietro».
// Il service worker aggiorna HubSpot e crea il follow-up. Il prospect viene dalla bozza di Scout;
// l'operazione vive nel service worker (sessione di Chrome). Qui c'è solo l'ultima risposta ricevuta.
// Un'Azienda già contattata si mostra soltanto: nessuna azione di primo contatto, nemmeno la sola
// data del Contatto (l'azione outreachContactDate del service worker resta, non esposta).

import { el } from '../../ui/dom.js';
import { feedback } from '../../ui/feedback.js';
import { MESSAGE } from '../../lib/hubspotMessages.js';
import { outreachProspect, outreachRecipients, recipientOptions, statusLabel } from '../../lib/outreach.js';
import { followUpSchedule, formatDue, formatHubspotDate, formatRomeDateTime } from '../../lib/outreachTime.js';
import { openNavigator } from '../navigator/navigator.js';
import { OUTREACH } from './outreach.js';

const UNAVAILABLE = { ok: false, error: { code: 'unavailable', message: 'Il servizio HubSpot di Agria Commercial non risponde: chiudi e riapri il pannello.' } };
const SESSION_ITEM = 'hubspotSession';
const CHOICE_ITEM = 'outreachChoice'; // { key, choice, removed }: solo la scelta del destinatario, nessun dato HubSpot
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
  let removed = []; // CC suggeriti tolti a mano
  let pending = null; // destinatari fissati con «Ho inviato l'email»: passo di verifica aperto
  let sentChecked = false; // «Confermo di aver realmente inviato l'email…», sempre vuota all'apertura della verifica
  let visible = false;
  let notice = ''; // esito da annunciare (lettori di schermo)

  const call = (action, payload = {}) => chrome.runtime.sendMessage({ type: MESSAGE, action, ...payload }).then((r) => r || UNAVAILABLE, () => UNAVAILABLE);
  const prospect = () => (getOperator() ? outreachProspect(getDraft(), getHubspot().mode) : null);
  const keyOf = (p) => (p ? `${getHubspot().mode}:${p.companyId}` : '');

  // scelta del destinatario e CC tolti: restano nella sessione di Chrome (anche chiudendo il pannello)
  const saveChoice = () => chrome.storage.session.set({ [CHOICE_ITEM]: { key, choice, removed } }).catch(() => {});
  async function loadChoice(asked) {
    const saved = (await chrome.storage.session.get(CHOICE_ITEM).catch(() => ({})))[CHOICE_ITEM];
    if (asked !== key || saved?.key !== key || choice) return;
    choice = typeof saved.choice === 'string' ? saved.choice : '';
    removed = Array.isArray(saved.removed) ? saved.removed.filter((e) => typeof e === 'string') : [];
    render();
  }

  // il prospect di Scout è cambiato (altra Azienda, altra modalità): la risposta precedente non vale più
  function sync() {
    const p = prospect();
    const next = keyOf(p);
    if (next !== key) {
      key = next;
      info = null;
      error = null;
      choice = '';
      removed = [];
      pending = null;
      sentChecked = false;
      if (p) loadChoice(next);
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

  // «Ho inviato l'email»: nessuna scrittura, si fissano i destinatari e si apre la verifica
  function onSent() {
    const plan = outreachRecipients(prospect(), choice, removed);
    if (!plan || busy) return;
    pending = plan;
    sentChecked = false;
    error = null;
    render();
    $('#outreach-verify-title')?.focus();
  }

  // «Indietro»: si torna ai destinatari, nulla registrato
  function onBack() {
    if (busy) return;
    pending = null;
    sentChecked = false;
    error = null;
    render();
    $('#outreach-sent')?.focus();
  }

  // «Conferma invio e crea follow-up»: l'unica azione che scrive, con esattamente i destinatari verificati
  async function onConfirm() {
    const p = prospect();
    const plan = pending;
    if (!p || !plan || !sentChecked || busy) return;
    busy = 'confirm'; // il pulsante si disattiva subito: un secondo clic non parte
    error = null;
    render();
    const res = await call('outreachConfirm', {
      companyId: p.companyId, sentConfirmed: true,
      recipient: { type: plan.type, contactId: plan.contactId, email: plan.to, cc: [...plan.cc] },
    });
    busy = '';
    if (!res.ok) error = res.error;
    else if (res.outcome === 'already') {
      info = { ...info, company: res.company, contacted: true, operation: null };
      pending = null;
      notice = 'Questa Azienda risulta già contattata: nessuna modifica.';
    } else {
      pending = null;
      afterOperation(res.operation);
    }
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

  // A e CC (contact: il Contatto HubSpot). editable: i CC suggeriti si possono togliere e rimettere
  function recipientLines(plan, { editable = false } = {}) {
    const ccItems = plan.cc.map((email) => el('li', { class: 'rcpt' },
      el('span', { class: 'rcpt-email' }, email),
      editable ? el('button', {
        class: 'linkbtn', type: 'button', 'aria-label': `Togli ${email} dal CC`, disabled: Boolean(busy),
        onclick: () => { removed = [...removed, email]; saveChoice(); render(); $('#outreach-sent')?.focus(); },
      }, 'Togli') : null));
    const to = plan.to || (plan.type === 'contact' ? plan.label : 'email aziendale non rilevata da Scout');
    return el('dl', { id: editable ? 'outreach-recipients' : 'outreach-verify-recipients', class: 'facts recipients' },
      el('dt', {}, 'A:'), el('dd', { class: 'rcpt-to' }, plan.type === 'contact' && plan.to ? `${plan.label} · ${plan.to}` : to),
      el('dt', {}, 'CC:'), el('dd', {}, ccItems.length ? el('ul', { class: 'rcpt-list' }, ...ccItems) : 'Nessuno'),
      editable && plan.removed.length ? el('dt', {}, 'Tolti dal CC:') : null,
      editable && plan.removed.length ? el('dd', {}, el('ul', { class: 'rcpt-list' }, ...plan.removed.map((email) => el('li', { class: 'rcpt' },
        el('span', { class: 'rcpt-email off' }, email),
        el('button', {
          class: 'linkbtn', type: 'button', 'aria-label': `Rimetti ${email} in CC`, disabled: Boolean(busy),
          onclick: () => { removed = removed.filter((e) => e !== email); saveChoice(); render(); },
        }, 'Rimetti'))))) : null);
  }

  // passo 1: destinatari, A/CC, invio dal proprio account, «Ho inviato l'email» (nessuna scrittura)
  function firstContactForm(p) {
    const options = recipientOptions(p);
    const plan = outreachRecipients(p, choice, removed);
    return [
      el('fieldset', { id: 'outreach-recipient', class: 'choices' },
        el('legend', {}, 'Destinatari prima email'),
        ...options.map((o, i) => el('label', { class: 'choice', for: `outreach-r${i}` },
          el('input', {
            id: `outreach-r${i}`, type: 'radio', name: 'outreach-recipient', value: o.key, checked: o.key === choice, disabled: Boolean(busy),
            onchange: () => { choice = o.key; saveChoice(); render(); $(`#outreach-r${i}`)?.focus(); },
          }),
          el('span', {}, o.label)))),
      plan ? recipientLines(plan, { editable: true }) : null,
      plan?.type === 'company' && p.excluded.length
        ? el('p', { id: 'outreach-excluded', class: 'meta' }, `Non suggeriti: ${p.excluded.map((e) => `${e.email} (${e.reason})`).join(', ')}.`)
        : null,
      el('p', { class: 'send-now' }, 'Invia ora la prima email dal tuo account aziendale.'),
      plan ? el('p', { class: 'meta' }, plan.cc.length ? "Scrivi all'indirizzo A e metti in copia gli indirizzi CC." : "Scrivi all'indirizzo A.") : null,
      el('button', {
        id: 'outreach-sent', class: 'btn primary wide', type: 'button', disabled: Boolean(busy) || !plan,
        'aria-describedby': plan ? 'outreach-sent-note' : 'outreach-choose-note', onclick: onSent,
      }, "Ho inviato l'email"),
      plan ? null : el('p', { id: 'outreach-choose-note', class: 'meta' }, 'Scegli prima a chi hai inviato la prima email.'),
      el('p', { id: 'outreach-sent-note', class: 'meta' }, 'Agria Commercial non invia email e non legge la posta: in HubSpot non si registra nulla finché non confermi nel passaggio successivo.'),
    ];
  }

  // passo 2: verifica. Mostra i destinatari fissati al clic su «Ho inviato l'email» (gli stessi che si
  // registrano), chiede la conferma esplicita; solo «Conferma invio e crea follow-up» scrive in HubSpot.
  function verifyView() {
    const plan = pending;
    const operator = getOperator();
    const { dueAt } = followUpSchedule(Date.now());
    const contactDate = plan.type === 'contact' ? info?.contact?.firstEmailAt : '';
    const steps = [
      'Stato lead → Primo contatto inviato',
      'Registra data primo invio Azienda',
      plan.type === 'contact' && !contactDate ? 'Registra data primo invio al Contatto' : null,
      `Crea follow-up per ${formatDue(dueAt)}`,
      `Assegna a ${operator?.name || '—'}`,
    ].filter(Boolean);
    const confirmBusy = busy === 'confirm';
    return [
      el('section', { id: 'outreach-verify', class: 'verify-box', 'aria-labelledby': 'outreach-verify-title' },
        el('h3', { id: 'outreach-verify-title', tabindex: '-1' }, 'Verifica prima di registrare il contatto'),
        recipientLines(plan),
        el('p', {}, 'Confermando, Agria Commercial registrerà il primo contatto in HubSpot e programmerà il follow-up.'),
        el('section', { id: 'outreach-preview', class: 'preview-box', 'aria-labelledby': 'outreach-preview-title' },
          el('h4', { id: 'outreach-preview-title' }, 'Cosa succederà'),
          el('ul', { class: 'checks' }, ...steps.map((s) => el('li', {}, s))),
          contactDate ? el('p', { class: 'meta' }, `Il Contatto ha già una data di primo invio (${formatHubspotDate(contactDate)}): resta invariata.`) : null),
        el('label', { class: 'confirm sent-check', for: 'outreach-sent-check' },
          el('input', {
            id: 'outreach-sent-check', type: 'checkbox', checked: sentChecked, disabled: Boolean(busy),
            onchange: (e) => { sentChecked = e.target.checked; render(); $('#outreach-sent-check')?.focus(); },
          }),
          el('span', {}, "Confermo di aver realmente inviato l'email ai destinatari indicati.")),
        el('p', { class: 'meta' }, "Agria Commercial non può controllare che l'email sia partita: vale la tua conferma.")),
      error ? withId('outreach-error', feedback('error', 'Primo contatto non registrato', ...lines(error.message))) : null,
      el('button', {
        id: 'outreach-confirm', class: 'btn primary wide', type: 'button', disabled: Boolean(busy) || !sentChecked, 'aria-busy': String(confirmBusy),
        'aria-describedby': sentChecked ? null : 'outreach-check-note', onclick: onConfirm,
      }, confirmBusy ? 'Registrazione in corso…' : 'Conferma invio e crea follow-up'),
      sentChecked ? null : el('p', { id: 'outreach-check-note', class: 'meta' }, 'Spunta la conferma per registrare il contatto.'),
      el('button', { id: 'outreach-back', class: 'btn ghost wide', type: 'button', disabled: Boolean(busy), onclick: onBack }, 'Indietro'),
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
        el('p', {}, `Destinatario: ${op.recipient.label}`),
        op.recipient.cc?.length ? el('p', { id: 'outreach-done-cc' }, `CC: ${op.recipient.cc.join(', ')}`) : null));
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
      else if (pending) children.push(...verifyView());
      else children.push(...firstContactForm(p));
      if (info?.mock || (hub.mode === 'mock' && p)) children.push(el('p', { class: 'mocknote' }, 'Simulazione (MOCK): nessun dato letto o scritto su HubSpot.'));
      if (info?.company && !busy && !pending) children.push(el('button', { id: 'outreach-refresh', class: 'btn ghost small', type: 'button', onclick: read }, 'Aggiorna da HubSpot'));
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
