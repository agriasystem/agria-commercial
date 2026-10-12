// Download di una pagina per la scansione approfondita.
// Solo GET, senza cookie né referrer, con tempo massimo e dimensione massima. Rifiuta ciò che
// non è HTML (o XML per le sitemap) e i redirect verso altri domini. Non invia mai dati al sito.

export class FetchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FetchError';
    this.code = code; // 'timeout' | 'aborted' | 'network' | 'http' | 'not_html' | 'too_large' | 'offsite'
  }
}

const ACCEPT = {
  html: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
  xml: 'application/xml,text/xml;q=0.9,*/*;q=0.1',
};
const TYPE_OK = {
  html: (type) => !type || /html/.test(type),
  xml: (type) => !type || /xml|text\/plain/.test(type),
};

async function readCapped(response, maxBytes) {
  if (!response.body?.getReader) {
    const buf = new Uint8Array(await response.arrayBuffer());
    return buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  const out = new Uint8Array(Math.min(size, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, out.length - offset);
    out.set(part, offset);
    offset += part.length;
    if (offset >= out.length) break;
  }
  return out;
}

// i vecchi siti italiani a volte sono in ISO-8859-1: si rispetta la codifica dichiarata
function decode(bytes, contentType) {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (!charset) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] || /encoding=["']([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/**
 * Scarica una pagina → { url (finale, dopo i redirect), text, status }.
 * Errori: FetchError con un messaggio in italiano per l'elenco delle pagine non raggiungibili.
 */
export async function fetchText(url, {
  kind = 'html', signal, timeoutMs = 10000, maxBytes = 3_000_000, isAllowed = () => true, fetchImpl = globalThis.fetch,
} = {}) {
  if (signal?.aborted) throw new FetchError('aborted', 'Scansione annullata.');
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        credentials: 'omit',
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        headers: { Accept: ACCEPT[kind] },
        signal: controller.signal,
      });
    } catch {
      if (timedOut) throw new FetchError('timeout', `Nessuna risposta entro ${Math.round(timeoutMs / 1000)} secondi.`);
      if (signal?.aborted) throw new FetchError('aborted', 'Scansione annullata.');
      throw new FetchError('network', 'Sito non raggiungibile.');
    }
    const finalUrl = response.url || url;
    if (!isAllowed(finalUrl)) throw new FetchError('offsite', 'Reindirizzata fuori dal dominio del prospect.');
    if (!response.ok) throw new FetchError('http', `Errore HTTP ${response.status}.`);
    const type = (response.headers.get('content-type') || '').toLowerCase();
    if (!TYPE_OK[kind](type)) throw new FetchError('not_html', `Non è una pagina web (${type.split(';')[0]}).`);
    const length = Number(response.headers.get('content-length'));
    if (length > maxBytes) throw new FetchError('too_large', 'Pagina troppo grande.');
    let bytes;
    try {
      bytes = await readCapped(response, maxBytes);
    } catch {
      if (timedOut) throw new FetchError('timeout', `Nessuna risposta entro ${Math.round(timeoutMs / 1000)} secondi.`);
      if (signal?.aborted) throw new FetchError('aborted', 'Scansione annullata.');
      throw new FetchError('network', 'Download interrotto.');
    }
    return { url: finalUrl, text: decode(bytes, type), status: response.status };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
