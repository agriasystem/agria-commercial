// Vista Outreach del pannello: primo contatto e primo follow-up del prospect che Scout ha portato in
// HubSpot. La prima email è un'operazione dell'AZIENDA: una sola email aziendale, A = email aziendale
// principale, CC = le altre email valide del prospect (anche nominative), ciascuna si toglie e si rimette.
//   1. «Apri email pronta in Gmail»: nuova scheda di Gmail con l'account del commerciale attivo,
//      destinatari, oggetto e testo già compilati (config/outreachTemplates.js). Nessuna scrittura.
//   2. il commerciale controlla e invia DA GMAIL, poi torna qui: «Ho inviato l'email» (nessuna scrittura,
//      si fissano i destinatari e si apre la verifica);
//   3. verifica con A/CC, casella obbligatoria «Confermo di aver realmente inviato…», poi
//      «Conferma invio e crea follow-up» (l'unico clic che scrive) oppure «Indietro».
// Agria Commercial non invia e non legge email: non può sapere se Gmail ha davvero inviato.
// Il service worker aggiorna HubSpot e crea il follow-up (solo sull'Azienda: una persona in CC non rende
// l'email «al Contatto»). Il prospect viene dalla bozza di Scout; l'operazione vive nel service worker
// (sessione di Chrome). Qui c'è solo l'ultima risposta ricevuta.
// Un'Azienda già contattata si mostra soltanto: nessuna azione di primo contatto, nemmeno la sola
// data del Contatto (l'azione outreachContactDate del service worker resta, non esposta).

import { el } from '../../ui/dom.js';
import { feedback } from '../../ui/feedback.js';
import { MESSAGE } from '../../lib/hubspotMessages.js';
import { outreachProspect, outreachRecipients, statusLabel } from '../../lib/outreach.js';
import { followUpSchedule, formatDue, formatHubspotDate, formatRomeDateTime } from '../../lib/outreachTime.js';
import { gmailComposeUrl } from '../../lib/gmail.js';
import { firstContactEmail } from '../../config/outreachTemplates.js';
import { openNavigator } from '../navigator/navigator.js';
import { OUTREACH } from './outreach.js';

const UNAVAILABLE = { ok: false, error: { code: 'unavailable', message: 'Il servizio HubSpot di Agria Commercial non risponde: chiudi e riapri il pannello.' } };
const SESSION_ITEM = 'hubspotSession';
// { key, removed, gmailBy }: CC tolti a mano e chi ha aperto Gmail per questa Azienda; nessun dato HubSpot
const CHOICE_ITEM = 'outreachChoice';
const lines = (text) => String(text || '').split('\n').filter(Boolean).map((l) => el('p', {}, l));
const link = (url, text) => (/^https:\/\//.test(url || '') ? el('a', { class: 'src', href: url, target: '_blank', rel: 'noopener noreferrer' }, text) : null);
const withId = (id, node) => Object.assign(node, { id });
const sectionTitle = (id, text) => el('h3', { id, class: 'outreach-step-title' }, text);

/**
 * getDraft: bozza di Scout; getOperator: commerciale attivo (registro dei commerciali); getHubspot:
 * () => { mode, ready, blocker } (dal pannello HubSpot di Scout); onNavigate(view): apre un'altra vista;
 * onChange(): l'esito di Outreach è cambiato (Prossimo passo e contatore da ridisegnare).
 */
export function createOutreachPanel({ $, getDraft, getOperator, getHubspot, onNavigate, onChange = () => {} }) {
  let key = ''; // modalità + Azienda a cui si riferisce l'ultima risposta
  let info = null; // { company, contact, contacted, operation, mock } dall'ultima risposta del service worker
  let busy = ''; // '' | 'read' | 'confirm' | 'retry'
  let error = null; // ultimo errore { code, message }
  let removed = []; // CC suggeriti tolti a mano
  let gmailBy = ''; // ID owner del commerciale che ha aperto Gmail per questa Azienda (in questa sessione)
  let touched = false; // scelte fatte prima che arrivassero quelle salvate: vincono queste
  let pending = null; // destinatari fissati con «Ho inviato l'email»: passo di verifica aperto
  let sentChecked = false; // «Confermo di aver realmente inviato l'email…», sempre vuota all'apertura della verifica
  let visible = false;
  let notice = ''; // esito da annunciare (lettori di schermo)

  const call = (action, payload = {}) => chrome.runtime.sendMessage({ type: MESSAGE, action, ...payload }).then((r) => r || UNAVAILABLE, () => UNAVAILABLE);
  const prospect = () => (getOperator() ? outreachProspect(getDraft(), getHubspot().mode) : null);
  const keyOf = (p) => (p ? `${getHubspot().mode}:${p.companyId}` : '');
  const gmailOpened = () => Boolean(gmailBy) && gmailBy === getOperator()?.hubspotOwnerId;
  // il nome dell'Azienda come lo mostra Outreach (HubSpot, altrimenti la bozza di Scout)
  const companyName = (p) => info?.company?.name || p?.name || '';

  // CC tolti e apertura di Gmail: restano nella sessione di Chrome (anche cambiando vista o chiudendo il pannello)
  const saveChoice = () => chrome.storage.session.set({ [CHOICE_ITEM]: { key, removed, gmailBy } }).catch(() => {});
  async function loadChoice(asked) {
    const saved = (await chrome.storage.session.get(CHOICE_ITEM).catch(() => ({})))[CHOICE_ITEM];
    if (asked !== key || saved?.key !== key || touched) return;
    removed = Array.isArray(saved.removed) ? saved.removed.filter((e) => typeof e === 'string') : [];
    gmailBy = typeof saved.gmailBy === 'string' ? saved.gmailBy : '';
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
      removed = [];
      gmailBy = '';
      touched = false;
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
    const res = await call('outreachRead', { companyId: p.companyId });
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

  // email di primo contatto per l'Azienda e il commerciale attivo → { subject, body } | { error }
  function email(p) {
    try {
      return firstContactEmail({ operator: getOperator(), companyName: companyName(p) });
    } catch (err) {
      return { error: err.message };
    }
  }

  // «Apri email pronta in Gmail»: una nuova scheda; il pannello resta aperto. Nessuna scrittura, nessun conteggio.
  function onOpenGmail() {
    const p = prospect();
    const operator = getOperator();
    const plan = outreachRecipients(p, removed);
    const mail = email(p);
    if (!p || !plan?.to || mail.error || !operator?.email || busy) return;
    const url = gmailComposeUrl({ account: operator.email, to: plan.to, cc: plan.cc, subject: mail.subject, body: mail.body });
    chrome.tabs.create({ url, active: true }).catch(() => {});
    gmailBy = operator.hubspotOwnerId;
    touched = true;
    saveChoice();
    render();
    $('#outreach-sent')?.focus();
  }

  // «Ho inviato l'email»: nessuna scrittura, si fissano i destinatari e si apre la verifica
  function onSent() {
    const plan = outreachRecipients(prospect(), removed);
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
      recipient: { type: 'company', email: plan.to, cc: [...plan.cc] },
      // solo per la cronologia di oggi: il Contatto HubSpot già noto (nessuna scrittura sul Contatto)
      knownContact: p.contact ? { id: p.contact.id, name: p.contact.name, jobtitle: p.contact.jobtitle, url: p.contact.url } : null,
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

  // A e CC. editable: i CC si possono togliere e rimettere
  function recipientLines(plan, { editable = false } = {}) {
    const ccItems = plan.cc.map((address) => el('li', { class: 'rcpt' },
      el('span', { class: 'rcpt-email' }, address),
      editable ? el('button', {
        class: 'linkbtn', type: 'button', 'aria-label': `Togli ${address} dal CC`, disabled: Boolean(busy),
        onclick: () => { removed = [...removed, address]; touched = true; saveChoice(); render(); $('#outreach-gmail')?.focus(); },
      }, 'Togli') : null));
    return el('dl', { id: editable ? 'outreach-recipients' : 'outreach-verify-recipients', class: 'facts recipients' },
      el('dt', {}, 'A:'), el('dd', { class: 'rcpt-to' }, plan.to || 'email aziendale non rilevata da Scout'),
      el('dt', {}, 'CC:'), el('dd', {}, ccItems.length ? el('ul', { class: 'rcpt-list' }, ...ccItems) : 'Nessuno'),
      editable && plan.removed.length ? el('dt', {}, 'Tolti dal CC:') : null,
      editable && plan.removed.length ? el('dd', {}, el('ul', { class: 'rcpt-list' }, ...plan.removed.map((address) => el('li', { class: 'rcpt' },
        el('span', { class: 'rcpt-email off' }, address),
        el('button', {
          class: 'linkbtn', type: 'button', 'aria-label': `Rimetti ${address} in CC`, disabled: Boolean(busy),
          onclick: () => { removed = removed.filter((e) => e !== address); touched = true; saveChoice(); render(); },
        }, 'Rimetti'))))) : null);
  }

  // passo 1: chi invia, destinatari, email pronta in Gmail, poi «Ho inviato l'email» (nessuna scrittura)
  function firstContactForm(p) {
    const operator = getOperator();
    const plan = outreachRecipients(p, removed);
    const mail = email(p);
    const opened = gmailOpened();
    const canOpen = Boolean(plan.to && operator?.email && !mail.error);
    const gmailButton = el('button', {
      id: 'outreach-gmail', class: `btn wide ${opened ? 'ghost' : 'primary'}`, type: 'button', disabled: Boolean(busy) || !canOpen,
      'aria-describedby': 'outreach-gmail-note', onclick: onOpenGmail,
    }, opened ? 'Riapri email in Gmail' : 'Apri email pronta in Gmail', el('span', { 'aria-hidden': 'true' }, ' ↗'));
    const sentButton = el('button', {
      id: 'outreach-sent', class: `btn wide ${opened ? 'primary' : 'ghost'}`, type: 'button', disabled: Boolean(busy), onclick: onSent,
    }, "Ho inviato l'email");
    return [
      el('section', { id: 'outreach-sender', class: 'outreach-step', 'aria-labelledby': 'outreach-sender-title' },
        sectionTitle('outreach-sender-title', 'Invia da'),
        operator?.email
          ? el('p', { id: 'outreach-from', class: 'sender' }, `${operator.name} · ${operator.email}`)
          : el('p', { id: 'outreach-from', class: 'sender bad' }, `${operator?.name || '—'}: email aziendale non presente nel registro dei commerciali.`)),
      el('section', { id: 'outreach-recipients-box', class: 'outreach-step', 'aria-labelledby': 'outreach-recipients-title' },
        sectionTitle('outreach-recipients-title', 'Destinatari prima email'),
        recipientLines(plan, { editable: true }),
        p.excluded.length
          ? el('p', { id: 'outreach-excluded', class: 'meta' }, `Non suggeriti: ${p.excluded.map((e) => `${e.email} (${e.reason})`).join(', ')}.`)
          : null),
      el('section', { id: 'outreach-email', class: 'outreach-step', 'aria-labelledby': 'outreach-email-title' },
        sectionTitle('outreach-email-title', 'Email di primo contatto'),
        mail.error
          ? withId('outreach-email-error', feedback('error', 'Email non pronta', el('p', {}, mail.error)))
          : [
            el('p', { class: 'subject' }, el('span', { class: 'subject-label' }, 'Oggetto: '), el('span', { id: 'outreach-subject' }, mail.subject)),
            el('details', { id: 'outreach-text', class: 'email-preview' },
              el('summary', {}, "Testo dell'email"),
              el('pre', { id: 'outreach-text-body', class: 'email-text' }, mail.body)),
          ]),
      opened ? null : gmailButton,
      opened ? el('p', { id: 'outreach-after-gmail', class: 'send-now' }, 'Dopo averla inviata da Gmail, torna qui.') : null,
      sentButton,
      opened ? gmailButton : null,
      el('p', { id: 'outreach-gmail-note', class: 'meta' }, plan.to
        ? "Gmail si apre in una nuova scheda: controlla l'email e premi «Invia» in Gmail. Agria Commercial non invia email e non legge la posta: in HubSpot non si registra nulla finché non confermi."
        : "Nessuna email aziendale per questa Azienda: aggiungila in Scout (Email aziendale principale) per preparare l'email."),
    ];
  }

  // passo 2: verifica. Mostra i destinatari fissati al clic su «Ho inviato l'email» (gli stessi che si
  // registrano), chiede la conferma esplicita; solo «Conferma invio e crea follow-up» scrive in HubSpot.
  function verifyView() {
    const plan = pending;
    const operator = getOperator();
    const { dueAt } = followUpSchedule(Date.now());
    const steps = [
      'Stato lead → Primo contatto inviato',
      'Registra data primo invio Azienda',
      `Crea follow-up per ${formatDue(dueAt)}`,
      `Assegna a ${operator?.name || '—'}`,
    ];
    const confirmBusy = busy === 'confirm';
    return [
      el('section', { id: 'outreach-verify', class: 'verify-box', 'aria-labelledby': 'outreach-verify-title' },
        el('h3', { id: 'outreach-verify-title', tabindex: '-1' }, 'Verifica prima di registrare il contatto'),
        recipientLines(plan),
        el('p', {}, 'Confermando, Agria Commercial registrerà il primo contatto in HubSpot e programmerà il follow-up.'),
        el('section', { id: 'outreach-preview', class: 'preview-box', 'aria-labelledby': 'outreach-preview-title' },
          el('h4', { id: 'outreach-preview-title' }, 'Cosa succederà'),
          el('ul', { class: 'checks' }, ...steps.map((s) => el('li', {}, s)))),
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
