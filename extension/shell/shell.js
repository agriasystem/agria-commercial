// Shell di Agria Commercial: navigazione fra i moduli (Home, Scout, Outreach) e apertura del
// Navigatore in una scheda ampia. La shell mostra e nasconde le viste e basta: commerciale attivo,
// modalità HubSpot, bozza del prospect e Service Key restano dove già vivono (una sola fonte).
// L'unica cosa che ricorda è la vista aperta, in chrome.storage.session, per riaprire il pannello
// nello stesso punto.

import { el } from '../ui/dom.js';
import { TONES } from '../ui/feedback.js';
import { openNavigator } from '../modules/navigator/navigator.js';
import { OUTREACH } from '../modules/outreach/outreach.js';

export const VIEWS = Object.freeze(['home', 'scout', 'outreach']);
const VIEW_KEY = 'shellView';

/** Componente «Prossimo passo»: { tone, title, detail, action: { label, target } | null } (vedi lib/nextStep.js). */
export function nextStepCard(step, onAction) {
  const tone = Object.hasOwn(TONES, step.tone) ? step.tone : 'info';
  return el('section', { class: 'next-step', 'data-tone': tone, 'aria-labelledby': 'next-step-title' },
    el('p', { class: 'next-step-label' }, 'Prossimo passo'),
    el('h3', { id: 'next-step-title', class: 'next-step-title' }, el('span', { class: 'fb-icon', 'aria-hidden': 'true' }, TONES[tone]), ' ', step.title),
    step.detail ? el('p', { class: 'next-step-detail' }, step.detail) : null,
    step.action ? el('button', { id: 'next-step-action', type: 'button', class: 'btn primary', onclick: () => onAction(step.action.target) }, step.action.label) : null);
}

/**
 * $: selettore; onView(view): la vista appena mostrata (per ridisegnarla); nextStep(): il prossimo
 * passo calcolato dallo stato attuale (o null).
 */
export function createShell({ $, onView = () => {}, nextStep = () => null }) {
  let current = 'home';

  function renderHome() {
    const step = nextStep();
    $('#next-step').replaceChildren(...(step ? [nextStepCard(step, (target) => (target === 'navigator' ? openNavigator() : show(target, { focus: true })))] : []));
  }

  /** Mostra una vista; focus: sposta il focus sul suo titolo (utile da tastiera dopo un'azione). */
  function show(view, { focus = false, remember = true } = {}) {
    if (!VIEWS.includes(view)) return;
    current = view;
    for (const name of VIEWS) $(`#view-${name}`).hidden = name !== view;
    for (const button of document.querySelectorAll('#module-nav [data-view]')) {
      if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    if (view === 'home') renderHome();
    if (remember) chrome.storage.session.set({ [VIEW_KEY]: view }).catch(() => {});
    onView(view);
    if (focus) $(`#view-${view} [data-view-title]`)?.focus();
  }

  return {
    show,
    get current() { return current; },
    renderHome,
    /** Collega navigazione e Home; torna alla vista aperta prima (in questa sessione), altrimenti alla Home. */
    async init() {
      for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => show(button.dataset.view, { focus: button.closest('#module-nav') == null }));
      for (const button of document.querySelectorAll('[data-open="navigator"]')) button.addEventListener('click', () => openNavigator());
      $('#outreach-message').textContent = OUTREACH.message;
      const saved = (await chrome.storage.session.get(VIEW_KEY).catch(() => ({})))[VIEW_KEY];
      show(VIEWS.includes(saved) ? saved : 'home', { remember: false });
    },
  };
}
