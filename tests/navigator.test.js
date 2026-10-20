// Navigatore dentro Agria Commercial: la copia inclusa è esattamente il file buildato del repository
// del Navigatore (source of truth), con i soli <script> inline spostati in file .js (CSP Manifest V3).
// Il repository del Navigatore si legge e basta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { committedFile, joinPage, PAGE, SCRIPTS, sha256, SOURCE_INFO, splitPage } from '../tools/sync-navigator.js';
import { NAVIGATOR_PAGE } from '../extension/modules/navigator/navigator.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'extension', 'modules', 'navigator', 'app');
const SOURCE = path.resolve(ROOT, '..', 'navigatore-agria-sorgenti', 'navigatore-agria-2.0');
const read = (name) => fs.readFileSync(path.join(APP, name), 'utf8');
const info = JSON.parse(read(SOURCE_INFO));

test('Navigatore incluso: Navigator 2.0 5e17aa5, file buildato autonomo dichiarato', () => {
  assert.equal(info.commit, '5e17aa5');
  assert.equal(info.sourceRepository, 'navigatore-agria-sorgenti/navigatore-agria-2.0');
  assert.equal(info.sourceFile, 'dist/navigatore-chiamata-agria.html', 'la pagina autonoma completa, non artifact-body');
  assert.match(info.sourceSha256, /^[0-9a-f]{64}$/);
  assert.equal(NAVIGATOR_PAGE, `modules/navigator/app/${PAGE}`);
});

test('la copia ricompone byte per byte il file buildato del Navigatore', () => {
  const page = read(PAGE);
  const scripts = SCRIPTS.map(read);
  assert.equal(sha256(joinPage(page, scripts)), info.sourceSha256);
  for (const name of [PAGE, ...SCRIPTS]) assert.equal(sha256(read(name)), info.files[name], `${name}: impronta registrata`);
  // solo gli script spostati: nessuno script inline, gli stessi file nell'ordine originale
  assert.ok(!/<script>(?!<\/script>)/.test(page.replace(/<script src="[^"]+"><\/script>/g, '')), 'nessuno script inline');
  assert.deepEqual([...page.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]), SCRIPTS);
  assert.match(page, /<title>Navigatore Chiamata Agria<\/title>/);
});

test('trasformazione reversibile e senza altri cambiamenti', () => {
  const html = '<!doctype html><p>prima</p><script>var a = "<b>x</b>";</script><p>mezzo</p><script>window.B = 2;</script><p>dopo</p>';
  const { page, scripts } = splitPage(html);
  assert.equal(page, '<!doctype html><p>prima</p><script src="navigatore-1.js"></script><p>mezzo</p><script src="navigatore-2.js"></script><p>dopo</p>');
  assert.deepEqual(scripts, ['var a = "<b>x</b>";', 'window.B = 2;']);
  assert.equal(joinPage(page, scripts), html);
  assert.throws(() => splitPage('<script>uno</script>'), /attesi 2/);
});

test('il Navigatore resta isolato: niente API dell\'estensione, niente rete', () => {
  for (const name of SCRIPTS) {
    const src = read(name);
    assert.ok(!/\bchrome\./.test(src), `${name}: nessuna API chrome.*`);
    assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource)\s*\(/.test(src), `${name}: nessuna rete`);
  }
});

test('se il repository del Navigatore è su questo PC: stesso commit, stesso file buildato, repository pulito', { skip: !fs.existsSync(path.join(SOURCE, '.git')) && 'repository del Navigatore non presente' }, () => {
  const git = (...args) => execFileSync('git', ['-C', SOURCE, ...args], { encoding: 'utf8' }).trim();
  assert.equal(git('rev-parse', '--short', 'HEAD'), info.commit);
  assert.equal(git('status', '--porcelain'), '', 'repository del Navigatore invariato');
  // il file buildato com'è nel commit: i CR aggiunti al checkout da core.autocrlf non contano
  assert.equal(sha256(committedFile(SOURCE, info.sourceFile)), info.sourceSha256);
  // --check: ricompila i sorgenti in .tmp/ e confronta, senza scrivere né qui né nel Navigatore
  const out = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'sync-navigator.js'), '--check'], { encoding: 'utf8' });
  assert.match(out, new RegExp(`allineata al commit ${info.commit}`));
  assert.equal(git('status', '--porcelain'), '', 'il controllo non tocca il repository del Navigatore');
});
