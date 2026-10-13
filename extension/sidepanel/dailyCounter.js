// Contatore «Oggi 23 / 20» in fondo al pannello (Home, Scout, Outreach; il Navigatore è a parte) e
// cronologia delle Aziende contattate oggi dal commerciale attivo. 20 è l'obiettivo, non un limite.
// Numero e cronologia vivono nel service worker (lib/dailyOutreach.js, chrome.storage.local): qui si
// leggono e si corregge il numero con − e +, sempre con un messaggio, così un incremento automatico e una
// correzione a mano non si sovrascrivono. La cronologia mostra solo le Aziende registrate davvero; la
// correzione a mano resta una riga a parte («+2 aggiunte manualmente»), mai Aziende inventate.

import { el } from '../ui/dom.js';
import { MESSAGE } from '../lib/hubspotMessages.js';

const REFRESH_MS = 60 * 1000; // a mezzanotte (ora italiana) contatore e cronologia ripartono da zero

// link al record HubSpot (solo quello dato da HubSpot) in una nuova scheda; senza link il solo nome
function recordLink(url, label, className) {
  if (!/^https:\/\//.test(url || '')) return el('span', { class: className }, label);
  return el('a', { class: `src ${className}`, href: url, target: '_blank', rel: 'noopener noreferrer', title: 'Apri in HubSpot (nuova scheda)' },
    label, el('span', { 'aria-hidden': 'true' }, ' ↗'));
}

/** «+2 aggiunte manualmente», «−1 tolta manualmente»; '' senza correzione. */
export function manualLine(adjustment) {
  if (!adjustment) return '';
  const n = Math.abs(adjustment);
  return adjustment > 0 ? `+${n} ${n === 1 ? 'aggiunta' : 'aggiunte'} manualmente` : `−${n} ${n === 1 ? 'tolta' : 'tolte'} manualmente`;
}

/** getOperator: commerciale attivo (registro dei commerciali), oppure null. */
export function createDailyCounterBar({ $, getOperator }) {
  let state = null; // { ownerId, day, count, target, manualAdjustment, entries } dall'ultima risposta
  let busy = false;

  const call = (action, payload = {}) => chrome.runtime.sendMessage({ type: MESSAGE, action, ...payload }).then((r) => r || { ok: false }, () => ({ ok: false }));
  const mine = () => (state && state.ownerId === getOperator()?.hubspotOwnerId ? state : null);
  const keep = (res) => {
    if (res.ok) state = { ownerId: res.ownerId, day: res.day, count: res.count, target: res.target, manualAdjustment: res.manualAdjustment || 0, entries: Array.isArray(res.entries) ? res.entries : [] };
  };

  function renderHistory(current) {
    const entries = current?.entries || [];
    $('#daily-history-toggle').textContent = `Vedi aziende contattate (${entries.length})`;
    const items = entries.map((e) => el('li', { class: 'daily-entry', 'data-company-id': e.companyId },
      el('span', { class: 'daily-time' }, e.time || '—'),
      el('span', { class: 'daily-who' },
        recordLink(e.hubspotUrl, e.companyName || `Azienda · ID ${e.companyId}`, 'daily-company'),
        e.contact ? recordLink(e.contact.url, e.contact.name || `Contatto · ID ${e.contact.id}`, 'daily-contact') : null)));
    $('#daily-history-list').replaceChildren(...(items.length ? items : [el('li', { class: 'daily-empty' }, 'Nessuna Azienda registrata oggi con Agria Commercial.')]));
    const manual = $('#daily-history-manual');
    manual.textContent = manualLine(current?.manualAdjustment || 0);
    manual.hidden = !manual.textContent;
  }

  function render() {
    const bar = $('#daily-counter');
    if (!bar) return;
    const operator = getOperator();
    const current = mine();
    bar.hidden = !operator || !$('#operator-picker')?.hidden; // non durante la scelta del commerciale
    $('#daily-count').textContent = current ? String(current.count) : '–';
    $('#daily-target').textContent = `/ ${current?.target ?? 20}`;
    $('#daily-minus').disabled = busy || !current || current.count <= 0;
    $('#daily-plus').disabled = busy || !current; // nessun massimo: 21 / 20, 40 / 20…
    $('#daily-history-toggle').disabled = !current;
    renderHistory(current);
  }

  function toggleHistory(open) {
    const box = $('#daily-history');
    box.hidden = !open;
    $('#daily-history-toggle').setAttribute('aria-expanded', String(open));
    if (open) $('#daily-history-title').setAttribute('tabindex', '-1');
    if (open) $('#daily-history-title').focus();
    else $('#daily-history-toggle').focus();
  }

  async function refresh() {
    if (!getOperator()) {
      render();
      return;
    }
    keep(await call('dailyCount'));
    render();
  }

  async function adjust(delta) {
    if (busy || !mine()) return;
    busy = true;
    render();
    const res = await call('dailyCountAdjust', { delta });
    busy = false;
    keep(res);
    render();
  }

  return {
    refresh,
    init() {
      $('#daily-minus').addEventListener('click', () => adjust(-1));
      $('#daily-plus').addEventListener('click', () => adjust(1));
      $('#daily-history-toggle').addEventListener('click', () => toggleHistory($('#daily-history').hidden));
      $('#daily-history-close').addEventListener('click', () => toggleHistory(false));
      setInterval(refresh, REFRESH_MS);
      render();
    },
  };
}
