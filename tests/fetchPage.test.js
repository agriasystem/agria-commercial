// Download delle pagine contro un server locale: risposte buone, errori HTTP, non HTML, timeout,
// redirect fuori dominio, dimensione massima, codifica, annullamento. Nessun sito reale.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchText, FetchError } from '../extension/lib/fetchPage.js';

let server;
let base;
const received = [];

before(async () => {
  server = http.createServer((req, res) => {
    received.push({ method: req.method, cookie: req.headers.cookie, url: req.url });
    const port = server.address().port;
    switch (req.url) {
      case '/ok': res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<html><title>Città</title></html>'); break;
      case '/latin': res.writeHead(200, { 'content-type': 'text/html' }); res.end(Buffer.from('<meta charset="iso-8859-1"><p>Città</p>', 'latin1')); break;
      case '/missing': res.writeHead(404, { 'content-type': 'text/html' }); res.end('non trovata'); break;
      case '/pdf': res.writeHead(200, { 'content-type': 'application/pdf' }); res.end('%PDF'); break;
      case '/sitemap.xml': res.writeHead(200, { 'content-type': 'application/xml' }); res.end('<urlset></urlset>'); break;
      case '/slow': setTimeout(() => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('tardi'); }, 1500); break;
      case '/redirect-out': res.writeHead(302, { location: `http://localhost:${port}/ok` }); res.end(); break;
      case '/redirect-in': res.writeHead(301, { location: '/ok' }); res.end(); break;
      case '/big': res.writeHead(200, { 'content-type': 'text/html', 'content-length': '5000000' }); res.end(Buffer.alloc(5000000, 97)); break;
      case '/stream': {
        res.writeHead(200, { 'content-type': 'text/html' });
        for (let i = 0; i < 50; i += 1) res.write('x'.repeat(1000));
        res.end();
        break;
      }
      default: res.writeHead(500); res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections?.();
  server.close();
});

const sameHost = (url) => new URL(url).hostname === '127.0.0.1';
const fails = (promise, code) => assert.rejects(promise, (e) => e instanceof FetchError && e.code === code);

test('pagina HTML: testo, indirizzo finale, solo GET e senza cookie', async () => {
  const res = await fetchText(`${base}/ok`);
  assert.equal(res.status, 200);
  assert.match(res.text, /Città/);
  const req = received.find((r) => r.url === '/ok');
  assert.equal(req.method, 'GET');
  assert.equal(req.cookie, undefined);
});

test('codifica dichiarata nella pagina (ISO-8859-1)', async () => {
  assert.match((await fetchText(`${base}/latin`)).text, /Città/);
});

test('errori: HTTP, non HTML, timeout, redirect fuori dominio, pagina enorme', async () => {
  await fails(fetchText(`${base}/missing`), 'http');
  await fails(fetchText(`${base}/pdf`), 'not_html');
  await fails(fetchText(`${base}/sitemap.xml`), 'not_html');
  await fails(fetchText(`${base}/slow`, { timeoutMs: 200 }), 'timeout');
  await fails(fetchText(`${base}/redirect-out`, { isAllowed: sameHost }), 'offsite');
  await fails(fetchText(`${base}/big`, { maxBytes: 100000 }), 'too_large');
  await fails(fetchText('http://127.0.0.1:1/'), 'network');
});

test('redirect nello stesso sito: indirizzo finale', async () => {
  const res = await fetchText(`${base}/redirect-in`, { isAllowed: sameHost });
  assert.equal(res.url, `${base}/ok`);
});

test('senza dimensione dichiarata si legge al massimo maxBytes', async () => {
  const res = await fetchText(`${base}/stream`, { maxBytes: 5000 });
  assert.equal(res.text.length, 5000);
});

test('sitemap come XML', async () => {
  assert.equal((await fetchText(`${base}/sitemap.xml`, { kind: 'xml' })).text, '<urlset></urlset>');
});

test('annullamento prima e durante il download', async () => {
  const done = new AbortController();
  done.abort();
  await fails(fetchText(`${base}/ok`, { signal: done.signal }), 'aborted');
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  await fails(fetchText(`${base}/slow`, { signal: controller.signal, timeoutMs: 5000 }), 'aborted');
});
