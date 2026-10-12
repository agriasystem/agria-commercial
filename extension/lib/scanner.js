// Scansione approfondita: analizza le pagine informative dello STESSO dominio del prospect.
//
// Parte dalla pagina aperta (già letta dal content script, con il contenuto reso dal browser),
// raccoglie i link interni e la sitemap, poi scarica una pagina alla volta in ordine di priorità
// (Contatti, home, Team, Chi siamo, pagine legali…) fino al limite di pagine. Mai fuori dominio,
// mai due volte la stessa pagina, pochi articoli di blog; annullabile in qualsiasi momento.
// Rete e lettura dell'HTML arrivano dall'esterno (fetchText, toSnapshot): così si prova in Node.

import { analyzeSnapshot } from './parser.js';
import { domainFromUrl } from './validation.js';
import {
  isSameSite, languageOf, normalizePageUrl, pageTypeOf, parseSitemap, pickChildSitemaps, scorePage, shouldSkip,
} from './discovery.js';

const MAX_KNOWN_URLS = 2000;
const SITEMAP_PATHS = ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml'];

const wait = (ms, signal) => new Promise((resolve) => {
  if (!ms || signal?.aborted) return resolve();
  const timer = setTimeout(done, ms);
  function done() {
    clearTimeout(timer);
    signal?.removeEventListener('abort', done);
    resolve();
  }
  signal?.addEventListener('abort', done, { once: true });
});

/**
 * @returns {Promise<{ analyzed, failed, cancelled, remaining, sitemap }>}
 *   onPage(findings) per ogni pagina analizzata, onFailure({ url, code, reason }) per quelle
 *   non raggiungibili, onProgress({ phase, index, total, url }) per l'avanzamento.
 */
export async function scanSite({
  startUrl, startSnapshot, maxPages = 30, maxBlogPages = 3, delayMs = 300,
  fetchText, toSnapshot, onPage = () => {}, onFailure = () => {}, onProgress = () => {}, signal,
}) {
  const start = normalizePageUrl(startUrl);
  if (!start) throw new TypeError('Indirizzo di partenza non valido.');
  const domain = domainFromUrl(start.url);
  const origin = new URL(start.url).origin;
  const language = languageOf(start.url);
  const visited = new Set([start.key]);
  const queue = new Map();
  let order = 0;

  const enqueue = (raw, { text = '', zone = '' } = {}) => {
    const n = normalizePageUrl(raw, origin);
    if (!n || !isSameSite(n.url, domain) || shouldSkip(n.url) || visited.has(n.key)) return;
    const { score, type } = scorePage(n.url, { text, zone, language });
    const current = queue.get(n.key);
    if (current) {
      if (score > current.score) Object.assign(current, { score, type });
      return;
    }
    if (queue.size >= MAX_KNOWN_URLS) return;
    // http/https e www/non-www sono la stessa pagina: si scarica sempre dall'origine di partenza
    const u = new URL(n.url);
    queue.set(n.key, { key: n.key, url: `${origin}${u.pathname}${u.search}`, score, type, order: order++ });
  };
  const eligible = (blogLeft) => [...queue.values()].filter((p) => p.type !== 'blog' || blogLeft > 0);
  const pickNext = (blogLeft) => eligible(blogLeft).sort((a, b) => b.score - a.score || a.order - b.order)[0];
  const analyzePage = (snapshot, url) => {
    const findings = analyzeSnapshot(snapshot, { pageType: pageTypeOf(url, snapshot.title) });
    onPage(findings);
    for (const link of findings.links) enqueue(link.url, link);
  };

  // 1. la pagina aperta
  onProgress({ phase: 'page', index: 1, total: maxPages, url: start.url });
  analyzePage(startSnapshot, start.url);
  enqueue(`${origin}/`, { zone: 'nav' });
  let attempts = 1;
  let analyzed = 1;
  let failed = 0;
  let blogLeft = maxBlogPages;

  // 2. la sitemap, se c'è
  let sitemap = false;
  if (maxPages > 1 && !signal?.aborted) {
    onProgress({ phase: 'sitemap', index: attempts, total: maxPages, url: `${origin}/sitemap.xml` });
    for (const path of SITEMAP_PATHS) {
      if (signal?.aborted) break;
      try {
        const { text } = await fetchText(`${origin}${path}`, { kind: 'xml', signal });
        const parsed = parseSitemap(text);
        for (const url of parsed.urls) enqueue(url, { zone: 'sitemap' });
        for (const child of pickChildSitemaps(parsed.sitemaps)) {
          if (signal?.aborted) break;
          const childUrl = normalizePageUrl(child, origin);
          if (!childUrl || !isSameSite(childUrl.url, domain)) continue;
          try {
            const { text: childText } = await fetchText(childUrl.url, { kind: 'xml', signal });
            for (const url of parseSitemap(childText).urls) enqueue(url, { zone: 'sitemap' });
          } catch { /* una sitemap figlia mancante non ferma la scansione */ }
        }
        sitemap = parsed.urls.length > 0 || parsed.sitemaps.length > 0;
        if (sitemap) break;
      } catch { /* niente sitemap a questo indirizzo: si prova il successivo */ }
    }
  }

  // 3. le altre pagine, una alla volta
  while (attempts < maxPages && !signal?.aborted) {
    const next = pickNext(blogLeft);
    if (!next) break;
    queue.delete(next.key);
    visited.add(next.key);
    attempts += 1;
    if (next.type === 'blog') blogLeft -= 1;
    onProgress({ phase: 'page', index: attempts, total: Math.min(maxPages, attempts + eligible(blogLeft).length), url: next.url });
    await wait(delayMs, signal);
    if (signal?.aborted) break;
    try {
      const page = await fetchText(next.url, { kind: 'html', signal, isAllowed: (u) => isSameSite(u, domain) });
      const final = normalizePageUrl(page.url);
      if (final && final.key !== next.key) {
        if (visited.has(final.key)) continue; // redirect verso una pagina già analizzata
        visited.add(final.key);
        queue.delete(final.key);
      }
      analyzePage(toSnapshot(page.text, page.url), page.url);
      analyzed += 1;
    } catch (err) {
      if (signal?.aborted) break;
      failed += 1;
      onFailure({ url: next.url, code: err?.code || 'error', reason: err?.message || String(err) });
    }
  }
  return { analyzed, failed, cancelled: Boolean(signal?.aborted), remaining: queue.size, sitemap };
}
