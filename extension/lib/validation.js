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

/** Pezzo di testo attorno a un ritrovamento, per mostrare da dove viene un dato. */
export function snippet(text, index, length = 0, around = 60) {
  if (typeof text !== 'string' || index < 0) return '';
  const start = Math.max(0, index - around);
  const end = Math.min(text.length, index + length + around);
  return `${start > 0 ? '…' : ''}${cleanText(text.slice(start, end), 400)}${end < text.length ? '…' : ''}`;
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

/** Partita IVA italiana: 11 cifre con la cifra di controllo corretta. */
export function isValidPartitaIva(value) {
  const s = String(value ?? '').trim().replace(/^IT\s?/i, '');
  if (!/^\d{11}$/.test(s) || /^0+$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    let d = Number(s[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(s[10]);
}

// valori dei caratteri in posizione dispari (1ª, 3ª…) per il carattere di controllo del codice fiscale
const CF_ODD = {
  0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
  N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};

/** Codice fiscale: 16 caratteri con controllo, oppure 11 cifre (società, come la P.IVA). */
export function isValidCodiceFiscale(value) {
  const s = String(value ?? '').trim().toUpperCase();
  if (/^\d{11}$/.test(s)) return isValidPartitaIva(s);
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i += 1) {
    const c = s[i];
    sum += i % 2 === 0 ? CF_ODD[c] : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 65;
  }
  return String.fromCharCode(65 + (sum % 26)) === s[15];
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
