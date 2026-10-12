// Controlli statici sull'estensione: manifest, file citati, permessi, sicurezza del codice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const read = (rel) => fs.readFileSync(path.join(EXT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(EXT, rel));
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const full = path.join(dir, d.name);
  return d.isDirectory() ? walk(full) : [path.relative(EXT, full).split(path.sep).join('/')];
});
const FILES = walk(EXT);
const JS = FILES.filter((f) => f.endsWith('.js'));
const HTML = FILES.filter((f) => f.endsWith('.html'));
const manifest = JSON.parse(read('manifest.json'));

test('manifest MV3 completo', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'Agria Scout');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.description.length <= 132, 'descrizione entro 132 caratteri');
  assert.ok(Number(manifest.minimum_chrome_version) >= 116, 'setPanelBehavior richiede Chrome 116');
  assert.equal(manifest.side_panel.default_path, 'sidepanel/sidepanel.html');
  assert.equal(manifest.background.service_worker, 'background/service-worker.js');
  assert.equal(manifest.options_page, 'options/options.html');
});

test('ogni file citato dal manifest esiste', () => {
  const refs = [
    manifest.side_panel.default_path, manifest.background.service_worker, manifest.options_page,
    ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
  ];
  for (const ref of refs) assert.ok(exists(ref), ref);
});

test('permessi minimi, nessun content script fisso, nessuna risorsa esposta alle pagine', () => {
  assert.deepEqual([...manifest.permissions].sort(), ['scripting', 'sidePanel', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['http://*/*', 'https://*/*']);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.equal(manifest.content_security_policy, undefined, 'si usa la CSP predefinita (più restrittiva)');
});

test('le pagine caricano solo script locali esistenti, niente script o gestori inline', () => {
  for (const file of HTML) {
    const html = read(file);
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const src = m[1].match(/\bsrc="([^"]+)"/)?.[1];
      assert.ok(src, `${file}: script inline non ammesso`);
      assert.ok(!/^[a-z]+:/i.test(src), `${file}: script remoto ${src}`);
      assert.ok(exists(path.posix.join(path.posix.dirname(file), src)), `${file}: ${src} non esiste`);
      assert.equal(m[2].trim(), '');
    }
    assert.ok(!/\son[a-z]+=/i.test(html), `${file}: gestore di evento inline`);
    for (const m of html.matchAll(/<link\b[^>]*href="([^"]+)"/gi)) {
      const href = m[1];
      if (/^https:/.test(href)) assert.ok(href.startsWith('https://fonts.googleapis.com/'), `${file}: risorsa esterna ${href}`);
      else assert.ok(exists(path.posix.join(path.posix.dirname(file), href)), `${file}: ${href} non esiste`);
    }
  }
});

test('ogni import punta a un file esistente', () => {
  for (const file of JS) {
    for (const m of read(file).matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) {
      assert.ok(m[1].startsWith('.'), `${file}: import non locale ${m[1]}`);
      assert.ok(exists(path.posix.join(path.posix.dirname(file), m[1])), `${file}: ${m[1]} non esiste`);
    }
  }
});

test('il content script è una funzione autosufficiente, iniettata dal pannello', () => {
  // executeScript({ func }) serializza la funzione: niente import né costanti fuori dal suo corpo
  const src = read('content/collector.js').replace(/^\s*\/\/.*$/gm, '').trim();
  assert.ok(src.startsWith('export function collectPageSnapshot('), 'il file contiene solo la funzione');
  assert.equal((src.match(/^(import|export|const|let|var|function)\b/gm) || []).length, 1, 'nessuna dichiarazione fuori dalla funzione');
  assert.ok(src.endsWith('}'));
  const reader = read('sidepanel/pageReader.js');
  assert.match(reader, /import \{ collectPageSnapshot \} from '\.\.\/content\/collector\.js'/);
  assert.match(reader, /func: collectPageSnapshot/);
});

test('il content script legge soltanto: nessuna modifica alla pagina, nessuna rete', () => {
  const src = read('content/collector.js').replace(/^\s*\/\/.*$/gm, '');
  const forbidden = [
    /\.(appendChild|removeChild|insertBefore|replaceChild|replaceChildren|replaceWith|append|prepend|remove|before|after|setAttribute|removeAttribute|toggleAttribute|insertAdjacent\w*|addEventListener|dispatchEvent|focus|click|submit)\s*\(/,
    /\.(innerHTML|outerHTML|textContent|innerText|nodeValue|className|value|href|src)\s*=(?!=)/,
    /\.style\b|\.classList\b|\.dataset\b/,
    /document\.(write|open|cookie)|localStorage|sessionStorage|indexedDB/,
    /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts)\b/,
    /\b(eval|Function)\s*\(/,
  ];
  for (const re of forbidden) assert.ok(!re.test(src), `collector.js contiene ${re}`);
});

test('rete solo in lib/fetchPage.js: GET, senza cookie né referrer; niente codice dinamico o HTML da stringhe', () => {
  for (const file of JS) {
    const src = read(file);
    if (file !== 'lib/fetchPage.js') {
      assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource)\s*\(/.test(src), `${file}: chiamata di rete`);
    }
    assert.ok(!/\bmethod\s*:\s*['"](POST|PUT|PATCH|DELETE)/i.test(src), `${file}: richiesta che modifica dati`);
    assert.ok(!/\beval\s*\(|new\s+Function\s*\(/.test(src), `${file}: codice dinamico`);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src), `${file}: HTML da stringhe`);
  }
  const fetcher = read('lib/fetchPage.js');
  assert.match(fetcher, /method: 'GET'/);
  assert.match(fetcher, /credentials: 'omit'/);
  assert.match(fetcher, /referrerPolicy: 'no-referrer'/);
  assert.ok(!/\bbody\s*:/.test(fetcher), 'nessun dato inviato');
});

test("l'HTML scaricato si legge solo con DOMParser (documento inerte, mai inserito nella pagina)", () => {
  const reader = read('sidepanel/pageReader.js');
  assert.match(reader, /new DOMParser\(\)\.parseFromString\(html, 'text\/html'\)/);
  for (const file of JS) assert.ok(!/document\.(open|write)|srcdoc|createContextualFragment/.test(read(file)), file);
});

test('nessuna credenziale nel codice', () => {
  const patterns = [
    /pat-[a-z]{2}\d?-[0-9a-f]{8}-/i, // token private app HubSpot
    /hapikey/i,
    /Bearer\s+[A-Za-z0-9._-]{12,}/,
    /(api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*['"][^'"]{6,}/i,
  ];
  for (const file of FILES.filter((f) => /\.(js|json|html)$/.test(f))) {
    const src = read(file);
    for (const re of patterns) assert.ok(!re.test(src), `${file}: possibile credenziale (${re})`);
  }
});

test('icone PNG valide della dimensione dichiarata', () => {
  for (const [size, rel] of Object.entries(manifest.icons)) {
    const buf = fs.readFileSync(path.join(EXT, rel));
    assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${rel}: non è un PNG`);
    assert.equal(buf.readUInt32BE(16), Number(size), `${rel}: larghezza`);
    assert.equal(buf.readUInt32BE(20), Number(size), `${rel}: altezza`);
  }
});

test('nessun file con nome riservato da Chrome', () => {
  for (const f of FILES) assert.ok(!f.split('/').some((part) => part.startsWith('_')), f);
});

test('le impostazioni offrono esattamente gli scenari MOCK previsti', async () => {
  const { MOCK_SCENARIOS } = await import('../extension/lib/config.js');
  const values = [...read('options/options.html').matchAll(/name="mockScenario" value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(values, Object.keys(MOCK_SCENARIOS));
});
