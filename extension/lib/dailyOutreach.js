// Contatore giornaliero «Oggi 7 / 20» e cronologia delle Aziende contattate oggi (giorno italiano,
// Europe/Rome), per il commerciale attivo.
//
// Una voce di cronologia (e il +1) nasce solo quando il primo contatto dell'Azienda è registrato davvero in
// HubSpot (Lead Status e data del primo invio): non contano scansioni, apertura di Gmail, «Ho inviato
// l'email», bozze, MOCK, nuovi tentativi del task o riaperture del pannello. Se il task di follow-up
// fallisce dopo la registrazione, voce e +1 restano; il nuovo tentativo non ne crea altri. La chiave è l'ID
// HubSpot dell'Azienda (mai il nome): la stessa Azienda compare una volta sola al giorno per commerciale.
//
// 20 è l'obiettivo consigliato, non un limite: 21 / 20, 40 / 20 vanno bene. Unico limite: mai sotto zero.
// Correzione a mano (contatti fatti fuori da Agria Commercial): si registra come manualAdjustment, senza
// inventare Aziende e senza cancellare quelle vere. Il numero è sempre voci reali + correzione.
//
// chrome.storage.local, mai sincronizzato (ogni PC/profilo ha il suo), per commerciale e giorno:
//   dailyOutreachCounts[ownerId]['YYYY-MM-DD'] = {
//     count,                 voci reali + correzione (scritto per comodità e compatibilità)
//     companies: [ID],       ID HubSpot delle Aziende contate (formato della prima versione)
//     entries: [{ companyId, companyName, contactedAt, hubspotUrl, contact: { id, name, url } | null }],
//     manualAdjustment,      correzione a mano (può essere negativa, mai sotto le voci reali)
//   }
// Un giorno salvato nel formato precedente ({ count, companies }) si legge così: le Aziende senza voce
// compaiono col solo ID, la differenza fra count e Aziende diventa la correzione a mano.
// I giorni passati non si cancellano: il formato permette in seguito «Ieri», «Ultimi 7 giorni», «Storico».
// Dati minimi: ID, nome dell'Azienda, istante, link del record; del Contatto già noto solo ID, nome e link.

import { romeIsoDate, romeParts } from './outreachTime.js';
import { safeRecordUrl } from './hubspotDuplicates.js';

export const DAILY_TARGET = 20;
export const COUNTS_ITEM = 'dailyOutreachCounts';
const MAX_ENTRIES = 500; // per commerciale e giorno: solo un argine

const isId = (v) => typeof v === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(v);
const text = (v, max) => (typeof v === 'string' ? v.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const dayOf = (ms) => romeIsoDate(ms);
const pad = (n) => String(n).padStart(2, '0');

function cleanContact(raw) {
  if (!raw || !isId(raw.id)) return null;
  return { id: raw.id, name: text(raw.name, 160), url: safeRecordUrl(raw.url, raw.id) };
}

/** Voce di cronologia pulita (dallo storage o da registrare), oppure null. */
export function cleanEntry(raw) {
  if (!raw || !isId(raw.companyId)) return null;
  const at = Date.parse(raw.contactedAt);
  return {
    companyId: raw.companyId,
    companyName: text(raw.companyName, 200),
    contactedAt: Number.isFinite(at) ? new Date(at).toISOString() : '',
    hubspotUrl: safeRecordUrl(raw.hubspotUrl, raw.companyId),
    contact: cleanContact(raw.contact),
  };
}

/**
 * Giorno dallo storage → { count, entries, manualAdjustment }. entries nell'ordine di registrazione;
 * count = voci reali + correzione, mai sotto zero.
 */
export function readDay(all, ownerId, day) {
  const raw = all?.[ownerId]?.[day] || {};
  const entries = [];
  for (const e of Array.isArray(raw.entries) ? raw.entries : []) {
    const entry = cleanEntry(e);
    if (entry && !entries.some((x) => x.companyId === entry.companyId)) entries.push(entry);
  }
  // formato precedente: solo gli ID delle Aziende contate
  for (const id of Array.isArray(raw.companies) ? raw.companies : []) {
    if (isId(id) && !entries.some((x) => x.companyId === id)) entries.push({ companyId: id, companyName: '', contactedAt: '', hubspotUrl: '', contact: null });
  }
  const legacyCount = Number.isInteger(raw.count) && raw.count > 0 ? raw.count : 0;
  const adjustment = Number.isInteger(raw.manualAdjustment) ? raw.manualAdjustment : legacyCount - entries.length;
  const manualAdjustment = Math.max(adjustment, -entries.length); // mai sotto zero
  return { count: entries.length + manualAdjustment, entries, manualAdjustment };
}

function withDay(all, ownerId, day, { entries, manualAdjustment }) {
  const value = {
    count: entries.length + manualAdjustment,
    companies: entries.map((e) => e.companyId),
    entries,
    manualAdjustment,
  };
  return { ...(all || {}), [ownerId]: { ...(all?.[ownerId] || {}), [day]: value } };
}

/**
 * Primo contatto registrato → { next, counted }: una voce e un +1, una sola volta per Azienda (ID) e giorno.
 * entry: { companyId, companyName, contactedAt, hubspotUrl, contact }.
 */
export function recordFirstContact(all, ownerId, day, entry) {
  const clean = cleanEntry(entry);
  const current = readDay(all, ownerId, day);
  if (!clean || current.entries.some((e) => e.companyId === clean.companyId)) return { next: all || {}, counted: false };
  const entries = [...current.entries, clean].slice(-MAX_ENTRIES);
  return { next: withDay(all, ownerId, day, { entries, manualAdjustment: current.manualAdjustment }), counted: true };
}

/** Correzione a mano (+1 / −1): cambia solo la correzione; le Aziende vere restano, il numero mai sotto zero. */
export function adjustCount(all, ownerId, day, delta) {
  const current = readDay(all, ownerId, day);
  const step = delta > 0 ? 1 : delta < 0 ? -1 : 0;
  const manualAdjustment = Math.max(current.manualAdjustment + step, -current.entries.length);
  return withDay(all, ownerId, day, { entries: current.entries, manualAdjustment });
}

/** «10:42» (ora italiana) di un istante ISO; '' se manca. */
export function romeTime(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const p = romeParts(ms);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * Archivio del contatore (nel service worker): letture e scritture in fila, così un incremento automatico
 * e una correzione a mano vicini non si sovrascrivono. local: chrome.storage.local (o finto nei test).
 */
export function createDailyCounter({ local, now = () => Date.now() }) {
  let queue = Promise.resolve();
  const load = async () => (await local.get(COUNTS_ITEM))[COUNTS_ITEM] || {};
  // stato per il pannello: voci dalla più recente, con l'ora italiana già pronta
  const view = (all, ownerId, day) => {
    const { count, entries, manualAdjustment } = readDay(all, ownerId, day);
    const history = entries.map((e) => ({ ...e, time: romeTime(e.contactedAt) })).reverse();
    return { ownerId, day, target: DAILY_TARGET, count, manualAdjustment, entries: history };
  };
  const serial = (task) => {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  };
  return {
    /** Oggi per il commerciale → { ownerId, day, count, target, manualAdjustment, entries }. */
    state: (ownerId) => serial(async () => view(await load(), ownerId, dayOf(now()))),
    /** Primo contatto registrato; il giorno è quello italiano dell'istante della conferma (entry.contactedAt). */
    record: (ownerId, entry) => serial(async () => {
      const all = await load();
      const day = dayOf(Date.parse(entry?.contactedAt) || now());
      const { next, counted } = recordFirstContact(all, ownerId, day, entry);
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
