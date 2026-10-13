// Calendario di Outreach: ora italiana (Europe/Rome, CET d'inverno e CEST d'estate), scadenza del
// primo follow-up a +2 giorni lavorativi alle 14:30, promemoria 30 minuti prima.
// Funzioni pure: ricevono un istante (millisecondi Unix, come Date.now()) e non leggono l'orologio.
//
// Giorni lavorativi: da lunedì a venerdì. Le festività non sono considerate.
//   lunedì → mercoledì · martedì → giovedì · mercoledì → venerdì · giovedì → lunedì
//   venerdì → martedì · sabato → martedì · domenica → martedì

export const TIME_ZONE = 'Europe/Rome';
export const FOLLOW_UP_BUSINESS_DAYS = 2;
export const FOLLOW_UP_TIME = Object.freeze({ hour: 14, minute: 30 });
export const REMINDER_MINUTES = 30;

const WEEKDAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const MINUTE = 60 * 1000;
const pad = (n) => String(n).padStart(2, '0');

const romeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** Istante → data e ora come le legge un orologio in Italia; weekday: 0 = domenica … 6 = sabato. */
export function romeParts(ms) {
  const p = Object.fromEntries(romeFormat.formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  const day = { year: p.year, month: p.month, day: p.day };
  return { ...day, hour: p.hour, minute: p.minute, second: p.second, weekday: weekdayOf(day) };
}

const weekdayOf = ({ year, month, day }) => new Date(Date.UTC(year, month - 1, day)).getUTCDay();

// differenza fra l'ora italiana e UTC in quell'istante: +1 h (CET) o +2 h (CEST)
function offsetAt(ms) {
  const p = romeParts(ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** Data e ora italiane → istante. Il secondo passaggio usa l'offset del giorno giusto (cambio d'ora). */
export function romeTimeToInstant({ year, month, day, hour = 0, minute = 0 }) {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const first = wall - offsetAt(wall);
  return wall - offsetAt(first);
}

/** Giorno di calendario + n giorni lavorativi (lunedì-venerdì): sabato e domenica non contano. */
export function addBusinessDays({ year, month, day }, n) {
  const date = new Date(Date.UTC(year, month - 1, day));
  let left = n;
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const wd = date.getUTCDay();
    if (wd !== 0 && wd !== 6) left -= 1;
  }
  const out = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  return { ...out, weekday: weekdayOf(out) };
}

/** Scadenza del primo follow-up a partire dalla conferma: { dueAt, reminderAt, day } (istanti in ms). */
export function followUpSchedule(confirmedAt) {
  const day = addBusinessDays(romeParts(confirmedAt), FOLLOW_UP_BUSINESS_DAYS);
  const dueAt = romeTimeToInstant({ ...day, ...FOLLOW_UP_TIME });
  return { dueAt, reminderAt: dueAt - REMINDER_MINUTES * MINUTE, day };
}

/** "2026-10-13": il giorno in Italia (formato completo delle proprietà HubSpot di tipo data). */
export function romeIsoDate(ms) {
  const p = romeParts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "13/10/2026, 10:42" */
export function formatRomeDateTime(ms) {
  const p = romeParts(ms);
  return `${pad(p.day)}/${pad(p.month)}/${p.year}, ${pad(p.hour)}:${pad(p.minute)}`;
}

/** "giovedì 15/10/2026 alle 14:30" */
export function formatDue(ms) {
  const p = romeParts(ms);
  return `${WEEKDAYS[p.weekday]} ${pad(p.day)}/${pad(p.month)}/${p.year} alle ${pad(p.hour)}:${pad(p.minute)}`;
}

/** "giovedì 15/10/2026" */
export function formatDay(ms) {
  const p = romeParts(ms);
  return `${WEEKDAYS[p.weekday]} ${pad(p.day)}/${pad(p.month)}/${p.year}`;
}

/**
 * Valore di una data letto da HubSpot → testo italiano. HubSpot restituisce le proprietà datetime in
 * ISO 8601 ("2026-10-13T08:42:00Z") e le date come "2026-10-13"; in qualche caso millisecondi.
 */
export function formatHubspotDate(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const day = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) return `${day[3]}/${day[2]}/${day[1]}`;
  const ms = /^\d{10,14}$/.test(text) ? Number(text) : Date.parse(text);
  return Number.isFinite(ms) ? formatRomeDateTime(ms) : text;
}

/** Istante di un valore HubSpot (ISO o millisecondi); NaN se non è una data con ora. */
export function hubspotInstant(value) {
  const text = String(value ?? '').trim();
  if (/^\d{10,14}$/.test(text)) return Number(text);
  return /T/.test(text) ? Date.parse(text) : Number.NaN;
}
