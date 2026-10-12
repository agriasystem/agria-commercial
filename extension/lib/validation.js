// Validazione e normalizzazione dei dati di contatto.
// Funzioni pure, senza dipendenze dal browser: le usano il parser, il pannello (per
// controllare le correzioni manuali) e i test in Node.

// estensioni di file che a volte sembrano email (es. logo@2x.png)
const FILE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'ico', 'bmp', 'tif', 'tiff',
  'css', 'js', 'pdf', 'mp4', 'webm', 'woff', 'woff2',
]);
const EMAIL_RE = /^[a-z0-9._%+-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const DOMAIN_RE = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,24}|xn--[a-z0-9-]{1,59})$/;

/** Spazi compressi, niente a capo, lunghezza massima. */
export function cleanText(value, max = 300) {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Chiave di confronto: minuscole, senza accenti, solo lettere e cifre. */
export function normKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Stesso sito: stesso dominio o sottodominio (shop.cantina.it ↔ cantina.it). */
export function sameSite(a, b) {
  return Boolean(a && b) && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));
}

export function isValidEmail(value) {
  if (typeof value !== 'string') return false;
  const s = value.trim().toLowerCase();
  if (s.length > 254 || !EMAIL_RE.test(s) || s.includes('..')) return false;
  const local = s.slice(0, s.indexOf('@'));
  if (local.startsWith('.') || local.endsWith('.')) return false;
  return !FILE_EXTENSIONS.has(s.slice(s.lastIndexOf('.') + 1));
}

/** Da "mailto:Info@Sito.it?subject=…" a "info@sito.it"; '' se non è un'email valida. */
export function normalizeEmail(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw.trim().replace(/^mailto:/i, '').split('?')[0];
  try { s = decodeURIComponent(s); } catch { /* resta com'è */ }
  s = s.trim().replace(/^[<("'[]+|[>)"'\].,;:]+$/g, '').toLowerCase();
  return isValidEmail(s) ? s : '';
}

/**
 * Numero in forma compatta (+390751234567) oppure '' se non è plausibile.
 * I numeri italiani scritti senza prefisso ricevono +39.
 */
export function normalizePhone(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw.trim().replace(/^(?:tel|callto):/i, '');
  try { s = decodeURIComponent(s); } catch { /* resta com'è */ }
  s = s.replace(/[\s.\-/() ]/g, '');
  if (!/^\+?\d+$/.test(s)) return '';
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (s.startsWith('+')) {
    const digits = s.length - 1;
    return digits >= 8 && digits <= 15 ? s : '';
  }
  // fisso (0…), cellulare (3…), numero verde (80…)
  if (/^0\d{5,10}$/.test(s) || /^3\d{8,9}$/.test(s) || /^80\d{4,8}$/.test(s)) return `+39${s}`;
  return '';
}

/** Forma leggibile di un numero compatto: +39 333 123 4567 / +39 0751234567. */
export function formatPhone(compact) {
  if (typeof compact !== 'string' || !compact.startsWith('+39')) return compact || '';
  const national = compact.slice(3);
  if (/^3\d{9}$/.test(national)) return `+39 ${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
  return `+39 ${national}`;
}

export function isValidPhone(value) {
  return normalizePhone(value) !== '';
}

/** URL http/https assoluto; accetta anche "www.sito.it" scritto a mano. '' se non valido. */
export function normalizeUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  let s = raw.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  try {
    const url = new URL(s);
    return /^https?:$/.test(url.protocol) && url.hostname.includes('.') ? url.href : '';
  } catch {
    return '';
  }
}

/** Dominio senza "www.": https://www.cantina.it/contatti → cantina.it */
export function domainFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\d*\./, '');
  } catch {
    return '';
  }
}

export function isValidDomain(value) {
  return typeof value === 'string' && DOMAIN_RE.test(value);
}

/** Accetta "cantina.it", "www.cantina.it" o un URL intero; '' se non è un dominio valido. */
export function normalizeDomain(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.trim().toLowerCase();
  if (!s) return '';
  const host = /[/:]/.test(s)
    ? domainFromUrl(/^[a-z][a-z0-9+.-]*:\/\//.test(s) ? s : `http://${s}`)
    : s.replace(/^www\d*\./, '');
  return isValidDomain(host) ? host : '';
}

/**
 * Link LinkedIn ripulito: { kind: 'profile' | 'company', url } oppure null.
 * Il profilo personale (/in/…) è quello che serve per il Contatto.
 */
export function normalizeLinkedin(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const s = raw.trim();
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
  const match = url.pathname.match(/^\/(in|company)\/([^/?#]+)/i);
  if (!match) return null;
  const kind = match[1].toLowerCase() === 'company' ? 'company' : 'profile';
  return { kind, url: `https://www.linkedin.com/${kind === 'company' ? 'company' : 'in'}/${match[2]}` };
}
