// Scansione approfondita con una rete simulata: priorità, limiti, dominio, errori, annullamento.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSite } from '../extension/lib/scanner.js';
import { FetchError } from '../extension/lib/fetchPage.js';

const ORIGIN = 'https://www.lamora.it';
const nav = (...paths) => paths.map((p) => ({ kind: 'web', href: `${ORIGIN}${p}`, text: p, zone: 'nav' }));
const EXTERNAL = [
  { kind: 'web', href: 'https://www.instagram.com/lamora/', text: 'Instagram', zone: 'footer' },
  { kind: 'web', href: 'https://altrosito.it/contatti', text: 'Contatti partner', zone: 'footer' },
  { kind: 'web', href: 'https://shop.lamora.it/', text: 'Shop', zone: 'nav' },
];

// pagine: { '/percorso': { text, links, redirect } }; errors: { '/percorso': FetchError }
function fakeSite(pages, { errors = {}, sitemap = '' } = {}) {
  const requests = [];
  let active = 0;
  let maxActive = 0;
  const fetchText = async (url, { kind }) => {
    requests.push({ url, kind });
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      await new Promise((r) => setTimeout(r, 1));
      const u = new URL(url);
      assert.equal(u.origin, ORIGIN, `richiesta fuori dominio: ${url}`);
      const path = `${u.pathname}${u.search}`;
      if (kind === 'xml') {
        if (sitemap && path === '/sitemap.xml') return { url, text: sitemap };
        throw new FetchError('http', 'Errore HTTP 404.');
      }
      if (errors[path]) throw errors[path];
      const page = pages[path];
      if (!page) throw new FetchError('http', 'Errore HTTP 404.');
      return { url: page.redirect ? `${ORIGIN}${page.redirect}` : url, text: path };
    } finally {
      active -= 1;
    }
  };
  const snapshot = (path) => ({
    url: `${ORIGIN}${path}`,
    title: pages[path].title || '',
    links: [...(pages[path].links || []), ...EXTERNAL],
    text: { header: '', footer: '', page: pages[path].text || '' },
  });
  return {
    fetchText,
    toSnapshot: (text, url) => snapshot(`${new URL(url).pathname}${new URL(url).search}`),
    snapshot,
    pages: () => requests.filter((r) => r.kind === 'html').map((r) => new URL(r.url).pathname),
    maxActive: () => maxActive,
  };
}

const run = (site, start, options = {}) => {
  const analyzed = [];
  const failures = [];
  const progress = [];
  return scanSite({
    startUrl: `${ORIGIN}${start}`,
    startSnapshot: site.snapshot(start),
    delayMs: 0,
    fetchText: site.fetchText,
    toSnapshot: site.toSnapshot,
    onPage: (f) => analyzed.push(new URL(f.page.url).pathname),
    onFailure: (f) => failures.push(f),
    onProgress: (p) => progress.push(p),
    ...options,
  }).then((result) => ({ result, analyzed, failures, progress }));
};

const ALL = ['/', '/contatti', '/chi-siamo', '/privacy', '/camere', '/galleria'];
const smallSite = () => Object.fromEntries(ALL.map((p) => [p, { text: `pagina ${p}`, links: nav(...ALL) }]));

test('sito piccolo: tutte le pagine, prima le più utili, una alla volta, mai due volte, mai fuori dominio', async () => {
  const site = fakeSite(smallSite());
  const { result, analyzed } = await run(site, '/camere');
  assert.deepEqual(analyzed, ['/camere', '/contatti', '/', '/chi-siamo', '/privacy', '/galleria']);
  assert.deepEqual(site.pages(), ['/contatti', '/', '/chi-siamo', '/privacy', '/galleria'], 'la pagina aperta non si riscarica');
  assert.equal(result.analyzed, 6);
  assert.equal(result.failed, 0);
  assert.equal(site.maxActive(), 1, 'nessuna richiesta in parallelo');
});

test('avanzamento: "pagina N di M" fino alla fine', async () => {
  const { progress } = await run(fakeSite(smallSite()), '/');
  const pages = progress.filter((p) => p.phase === 'page');
  assert.deepEqual(pages.map((p) => p.index), [1, 2, 3, 4, 5, 6]);
  assert.equal(pages.at(-1).total, 6);
  assert.ok(progress.some((p) => p.phase === 'sitemap'));
});

test('limite di pagine e pochi articoli del blog', async () => {
  const blog = Array.from({ length: 60 }, (_, i) => `/blog/articolo-${i}`);
  const important = ['/contatti', '/chi-siamo', '/team', '/privacy', '/note-legali'];
  const paths = ['/', ...important, ...blog];
  const pages = Object.fromEntries(paths.map((p) => [p, { links: nav(...paths) }]));

  const limited = fakeSite(pages);
  const a = await run(limited, '/', { maxPages: 8 });
  assert.equal(a.result.analyzed, 8);
  assert.deepEqual(a.analyzed.slice(1, 6).sort(), [...important].sort(), 'prima le pagine importanti');

  const generous = fakeSite(pages);
  const b = await run(generous, '/', { maxPages: 30 });
  assert.equal(generous.pages().filter((p) => p.startsWith('/blog/')).length, 3, 'al massimo 3 articoli');
  assert.equal(b.result.analyzed, 1 + important.length + 3, 'il budget non si spreca sul blog');
});

test('sitemap: aggiunge le pagine non collegate, ignora gli indirizzi di altri siti', async () => {
  const pages = { '/': { links: nav('/contatti') }, '/contatti': {}, '/dove-siamo': {}, '/termini': {} };
  const sitemap = `<urlset><url><loc>${ORIGIN}/dove-siamo</loc></url><url><loc>http://lamora.it/termini</loc></url><url><loc>https://altrosito.it/x</loc></url></urlset>`;
  const site = fakeSite(pages, { sitemap });
  const { result, analyzed } = await run(site, '/');
  assert.equal(result.sitemap, true);
  assert.deepEqual(analyzed.sort(), ['/', '/contatti', '/dove-siamo', '/termini']);
});

test('pagine irraggiungibili, lente o non HTML: la scansione continua e le segnala', async () => {
  const pages = { '/': { links: nav('/contatti', '/privacy', '/lenta', '/listino', '/rotta') }, '/contatti': {} };
  const site = fakeSite(pages, {
    errors: {
      '/privacy': new FetchError('http', 'Errore HTTP 500.'),
      '/lenta': new FetchError('timeout', 'Nessuna risposta entro 10 secondi.'),
      '/listino': new FetchError('not_html', 'Non è una pagina web (application/pdf).'),
    },
  });
  const { result, analyzed, failures } = await run(site, '/');
  assert.deepEqual(analyzed, ['/', '/contatti']);
  assert.equal(result.failed, 4);
  assert.deepEqual(failures.map((f) => [new URL(f.url).pathname, f.code]).sort(), [
    ['/lenta', 'timeout'], ['/listino', 'not_html'], ['/privacy', 'http'], ['/rotta', 'http'],
  ]);
});

test('redirect verso una pagina già analizzata: nessun doppione', async () => {
  const pages = { '/': { links: nav('/home', '/contatti') }, '/home': { redirect: '/' }, '/contatti': {} };
  const { analyzed } = await run(fakeSite(pages), '/');
  assert.deepEqual(analyzed, ['/', '/contatti']);
});

test('annullamento: si ferma subito e conserva quanto analizzato', async () => {
  const controller = new AbortController();
  const site = fakeSite(smallSite());
  const analyzed = [];
  const result = await scanSite({
    startUrl: `${ORIGIN}/`,
    startSnapshot: site.snapshot('/'),
    delayMs: 0,
    fetchText: site.fetchText,
    toSnapshot: site.toSnapshot,
    onPage: (f) => {
      analyzed.push(f.page.url);
      if (analyzed.length === 2) controller.abort();
    },
    signal: controller.signal,
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.analyzed, 2);
  assert.equal(site.pages().length, 1, 'nessuna richiesta dopo l\'annullamento');
});

test('una sola pagina se il limite è 1 (analisi della pagina aperta)', async () => {
  const site = fakeSite(smallSite());
  const { result } = await run(site, '/', { maxPages: 1 });
  assert.equal(result.analyzed, 1);
  assert.equal(site.pages().length, 0);
});
