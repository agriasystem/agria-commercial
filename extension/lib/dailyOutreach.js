// Contatore giornaliero «Oggi 7 / 20»: aziende per cui il commerciale ha registrato il primo contatto
// oggi (giorno italiano, Europe/Rome).
//
// Conta +1 solo quando il primo contatto dell'Azienda è registrato davvero in HubSpot (Lead Status e data
// del primo invio): non contano scansioni, apertura di Gmail, bozze, follow-up, nuovi tentativi o
// riaperture del pannello. Se il task di follow-up fallisce dopo la registrazione, il +1 resta; il nuovo
// tentativo non conta di nuovo. La stessa Azienda conta una volta sola al giorno (registro degli ID).
// Il commerciale può correggere il numero a mano (mai sotto zero): gli incrementi successivi continuano.
//
// chrome.storage.local, mai sincronizzato (ogni PC/profilo ha il suo), separato per commerciale e giorno:
//   dailyOutreachCounts: { [hubspotOwnerId]: { 'YYYY-MM-DD': { count, companies: [ID Azienda] } } }
// Si tengono gli ultimi KEEP_DAYS giorni per commerciale.

import { romeIsoDate } from './outreachTime.js';

export const DAILY_TARGET = 20;
export const COUNTS_ITEM = 'dailyOutreachCounts';
const KEEP_DAYS = 31;
const MAX_COMPANIES = 500;

const isId = (v) => typeof v === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(v);
const dayOf = (ms) => romeIsoDate(ms);

/** Giorno pulito dallo storage: { count ≥ 0, companies: [ID] }. */
export function readDay(all, ownerId, day) {
  const raw = all?.[ownerId]?.[day];
  const count = Number.isInteger(raw?.count) && raw.count > 0 ? raw.count : 0;
  const companies = Array.isArray(raw?.companies) ? [...new Set(raw.companies.filter(isId))] : [];
  return { count, companies };
}

function withDay(all, ownerId, day, value) {
  const byOwner = { ...(all?.[ownerId] || {}), [day]: value };
  // solo gli ultimi giorni: il registro non cresce all'infinito
  const kept = Object.keys(byOwner).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(-KEEP_DAYS);
  return { ...(all || {}), [ownerId]: Object.fromEntries(kept.map((d) => [d, byOwner[d]])) };
}

/** Primo contatto registrato per companyId → { next, counted }: una sola volta per Azienda e giorno. */
export function recordFirstContact(all, ownerId, day, companyId) {
  const current = readDay(all, ownerId, day);
  if (!isId(companyId) || current.companies.includes(companyId)) return { next: all || {}, counted: false };
  const value = { count: current.count + 1, companies: [...current.companies, companyId].slice(-MAX_COMPANIES) };
  return { next: withDay(all, ownerId, day, value), counted: true };
}

/** Correzione a mano (+1 / −1): mai sotto zero; il registro delle Aziende contate resta. */
export function adjustCount(all, ownerId, day, delta) {
  const current = readDay(all, ownerId, day);
  const step = delta > 0 ? 1 : delta < 0 ? -1 : 0;
  return withDay(all, ownerId, day, { ...current, count: Math.max(0, current.count + step) });
}

/**
 * Archivio del contatore (nel service worker): letture e scritture in fila, così un incremento automatico
 * e una correzione a mano vicini non si sovrascrivono. local: chrome.storage.local (o finto nei test).
 */
export function createDailyCounter({ local, now = () => Date.now() }) {
  let queue = Promise.resolve();
  const load = async () => (await local.get(COUNTS_ITEM))[COUNTS_ITEM] || {};
  const view = (all, ownerId, day) => ({ ownerId, day, target: DAILY_TARGET, count: readDay(all, ownerId, day).count });
  const serial = (task) => {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  };
  return {
    /** Stato di oggi per il commerciale → { ownerId, day, count, target }. */
    state: (ownerId) => serial(async () => view(await load(), ownerId, dayOf(now()))),
    /** Primo contatto registrato: at = istante della conferma (giorno italiano di quel momento). */
    record: (ownerId, companyId, at = now()) => serial(async () => {
      const all = await load();
      const day = dayOf(at);
      const { next, counted } = recordFirstContact(all, ownerId, day, companyId);
      if (counted) await local.set({ [COUNTS_ITEM]: next });
      return { ...view(next, ownerId, day), counted };
    }),
    adjust: (ownerId, delta) => serial(async () => {
      const day = dayOf(now());
      const next = adjustCount(await load(), ownerId, day, delta);
      await local.set({ [COUNTS_ITEM]: next });
      return view(next, ownerId, day);
    }),
  };
}
