// Scoperta delle pagine: URL, dominio, priorità, sitemap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSameSite, languageOf, normalizePageUrl, pageTypeOf, parseSitemap, pickChildSitemaps, scorePage, shouldSkip,
} from '../extension/lib/discovery.js';

test('URL normalizzati: ancore, parametri di tracciamento, www, http/https, barra finale', () => {
  const a = normalizePageUrl('https://www.lamora.it/contatti/#mappa');
  const b = normalizePageUrl('http://lamora.it/contatti?utm_source=fb&fbclid=1');
  const c = normalizePageUrl('/contatti', 'https://lamora.it/home');
  assert.equal(a.key, 'lamora.it/contatti');
  assert.equal(b.key, a.key);
  assert.equal(c.key, a.key);
  assert.equal(normalizePageUrl('https://lamora.it/index.php').key, 'lamora.it/');
  assert.equal(normalizePageUrl('https://lamora.it/?page_id=12&lang=it').key, 'lamora.it/?lang=it&page_id=12');
  assert.equal(normalizePageUrl('mailto:info@lamora.it'), null);
  assert.equal(normalizePageUrl('tel:0751234'), null);
  assert.equal(normalizePageUrl('javascript:void(0)'), null);
});

test('mai fuori dal dominio del prospect', () => {
  assert.equal(isSameSite('https://www.lamora.it/x', 'lamora.it'), true);
  assert.equal(isSameSite('http://lamora.it/x', 'lamora.it'), true);
  assert.equal(isSameSite('https://shop.lamora.it/', 'lamora.it'), false, 'sottodominio: altro sistema');
  assert.equal(isSameSite('https://www.booking.com/hotel/it/lamora', 'lamora.it'), false);
  assert.equal(isSameSite('https://lamora.it.truffa.com/', 'lamora.it'), false);
});

test('pagine da non scaricare', () => {
  for (const url of [
    'https://lamora.it/listino.pdf', 'https://lamora.it/foto.JPG', 'https://lamora.it/wp-admin/', 'https://lamora.it/wp-login.php',
    'https://lamora.it/carrello/', 'https://lamora.it/tag/vino/', 'https://lamora.it/category/news/', 'https://lamora.it/blog/page/3/',
    'https://lamora.it/?s=camere', 'https://lamora.it/shop/?add-to-cart=12', 'https://lamora.it/feed/',
  ]) assert.equal(shouldSkip(url), true, url);
  for (const url of ['https://lamora.it/', 'https://lamora.it/contatti', 'https://lamora.it/?page_id=12']) assert.equal(shouldSkip(url), false, url);
});

test('tipo di pagina da indirizzo e testo del link', () => {
  assert.equal(pageTypeOf('https://lamora.it/'), 'home');
  assert.equal(pageTypeOf('https://lamora.it/en/'), 'home');
  assert.equal(pageTypeOf('https://lamora.it/contatti/'), 'contact');
  assert.equal(pageTypeOf('https://lamora.it/dove-siamo'), 'contact');
  assert.equal(pageTypeOf('https://lamora.it/chi-siamo/'), 'about');
  assert.equal(pageTypeOf('https://lamora.it/il-nostro-team'), 'team');
  assert.equal(pageTypeOf('https://lamora.it/privacy-policy/'), 'legal');
  assert.equal(pageTypeOf('https://lamora.it/note-legali'), 'legal');
  assert.equal(pageTypeOf('https://lamora.it/le-camere'), 'hospitality');
  assert.equal(pageTypeOf('https://lamora.it/2024/05/vendemmia/'), 'blog');
  assert.equal(pageTypeOf('https://lamora.it/blog/ricetta'), 'blog');
  assert.equal(pageTypeOf('https://lamora.it/blog/le-nuove-camere'), 'blog', 'un articolo resta un articolo anche se parla di camere');
  assert.equal(pageTypeOf('https://lamora.it/news/contatti-estate'), 'blog');
  assert.equal(pageTypeOf('https://lamora.it/?page_id=7', 'Contattaci'), 'contact');
  assert.equal(pageTypeOf('https://lamora.it/pagina-x'), 'other');
});

test('priorità: Contatti, home, Team, Chi siamo, legali, struttura, poi il resto; blog per ultimo', () => {
  const s = (url, opts) => scorePage(url, opts).score;
  const order = [
    'https://lamora.it/contatti', 'https://lamora.it/', 'https://lamora.it/team', 'https://lamora.it/chi-siamo',
    'https://lamora.it/privacy', 'https://lamora.it/note-legali', 'https://lamora.it/cookie-policy', 'https://lamora.it/camere',
    'https://lamora.it/galleria', 'https://lamora.it/blog/vendemmia-2024',
  ].map((u) => s(u));
  assert.deepEqual([...order].sort((a, b) => b - a), order);
  assert.ok(s('https://lamora.it/contatti', { zone: 'footer' }) > s('https://lamora.it/contatti'), 'link nel menu o nel footer: più importante');
  assert.ok(s('https://lamora.it/en/contact') < s('https://lamora.it/contatti'), "la stessa pagina in un'altra lingua vale meno");
  assert.ok(s('https://lamora.it/en/contact', { language: 'en' }) > s('https://lamora.it/it/contatti', { language: 'en' }));
  assert.equal(languageOf('https://lamora.it/de/kontakt'), 'de');
});

test('sitemap: elenco di pagine, indice, CDATA ed entità', () => {
  const urlset = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url><loc>https://lamora.it/</loc></url>
    <url><loc> https://lamora.it/contatti </loc><lastmod>2025-01-01</lastmod></url>
    <url><loc><![CDATA[https://lamora.it/?page_id=3&lang=it]]></loc></url>
    <url><loc>https://lamora.it/a?x=1&amp;y=2</loc><image:image><image:loc>https://lamora.it/f.jpg</image:loc></image:image></url>
  </urlset>`;
  assert.deepEqual(parseSitemap(urlset), {
    urls: ['https://lamora.it/', 'https://lamora.it/contatti', 'https://lamora.it/?page_id=3&lang=it', 'https://lamora.it/a?x=1&y=2'],
    sitemaps: [],
  });
  const index = '<sitemapindex><sitemap><loc>https://lamora.it/post-sitemap.xml</loc></sitemap><sitemap><loc>https://lamora.it/page-sitemap.xml</loc></sitemap><sitemap><loc>https://lamora.it/local-sitemap.xml</loc></sitemap></sitemapindex>';
  const parsed = parseSitemap(index);
  assert.equal(parsed.urls.length, 0);
  assert.deepEqual(pickChildSitemaps(parsed.sitemaps), ['https://lamora.it/page-sitemap.xml', 'https://lamora.it/local-sitemap.xml']);
  assert.deepEqual(parseSitemap('<html>non è una sitemap</html>'), { urls: [], sitemaps: [] });
});
