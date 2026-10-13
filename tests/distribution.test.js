// Distribuzione interna: PUBBLICA-AGRIA-COMMERCIAL (tools/publish-stable.ps1) e AGGIORNA-AGRIA-COMMERCIAL
// (tools/update-workstation.ps1) provati su repository temporanei in .tmp/ con un remote finto locale
// (repository «bare» su disco): nessun push reale, nessun GitHub, Chrome mai aperto (-NoBrowser).
// I controlli del repository finto sono script minimi che si possono far fallire. Solo su Windows.
import { after, describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(ROOT, '.tmp', `distribuzione-${process.pid}`);
const SKIP = process.platform !== 'win32' && 'script PowerShell: solo Windows';
const FILES = ['tools/publish-stable.ps1', 'tools/update-workstation.ps1', 'PUBBLICA-AGRIA-COMMERCIAL.cmd', 'AGGIORNA-AGRIA-COMMERCIAL.cmd', '.gitattributes'];
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Agria Test', '-c', 'user.email=test@example.invalid', ...args], {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).trim();
const head = (dir) => git(dir, 'rev-parse', 'HEAD');
const stableOf = (remote) => git(TMP, 'ls-remote', remote, 'refs/heads/stable').split(/\s+/)[0] || '';
const checksRun = (dir) => {
  const log = path.join(dir, '.tmp', 'checks.log');
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split(/\r?\n/) : [];
};

/** Avvia un programma senza bloccare gli altri scenari → { code, stdout, out } */
function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill(), 120000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, out: `${stdout}\n${stderr}` });
    });
  });
}

/** Esegue uno degli script PowerShell del repository finto, come farebbe il lanciatore .cmd. */
const ps = (dir, script, ...args) => run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, 'tools', script), ...args], {
  cwd: dir, env: { ...process.env, NODE_PATH: '' },
});

let counter = 0;
const fresh = (name) => path.join(TMP, `${name}-${(counter += 1)}`);

function makeRemote() {
  const dir = fresh('origin.git');
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '--bare', '-b', 'master');
  return dir;
}

function writeVersion(dir, version) {
  fs.writeFileSync(path.join(dir, 'extension', 'manifest.json'), `${JSON.stringify({ manifest_version: 3, name: 'Agria Commercial', version }, null, 2)}\n`);
}

/** Repository di sviluppo finto: stessi script e lanciatori, controlli npm minimi (si fanno fallire con .tmp/fail-<nome>). */
function makeDev(remote) {
  const dir = fresh('sviluppo');
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'extension'), { recursive: true });
  for (const f of FILES) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, '.gitignore'), '.tmp/\nnode_modules/\n');
  fs.writeFileSync(path.join(dir, 'tools', 'fake-check.js'), [
    "const fs = require('fs');",
    'const name = process.argv[2];',
    "fs.mkdirSync('.tmp', { recursive: true });",
    "fs.appendFileSync('.tmp/checks.log', name + '\\n');",
    "process.exit(fs.existsSync('.tmp/fail-' + name) ? 1 : 0);",
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({
    name: 'agria-scout', version: '0.4.0', private: true,
    scripts: { test: 'node tools/fake-check.js test', e2e: 'node tools/fake-check.js e2e', 'navigator:check': 'node tools/fake-check.js navigator' },
  }, null, 2)}\n`);
  writeVersion(dir, '0.4.0');
  git(dir, 'init', '-b', 'master');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'Versione 0.4.0');
  if (remote) git(dir, 'remote', 'add', 'origin', remote);
  return dir;
}

/** Nuova versione approvata, spinta direttamente su stable (lo script di pubblicazione è provato a parte). */
function release(dev, version) {
  writeVersion(dev, version);
  git(dev, 'commit', '-am', `Versione ${version}`);
  git(dev, 'push', '-q', 'origin', 'HEAD:stable');
  return head(dev);
}

/** Remote con stable = 0.4.0 e PC del commerciale clonato sul ramo stable. */
function workstation({ branch = 'stable' } = {}) {
  const remote = makeRemote();
  const dev = makeDev(remote);
  git(dev, 'push', '-q', 'origin', 'HEAD:stable', 'HEAD:master');
  const ws = fresh('commerciale');
  git(TMP, 'clone', '-q', '--branch', branch, remote, ws);
  return { remote, dev, ws };
}

// ogni scenario ha i suoi repository: si eseguono in parallelo (gli script impiegano qualche secondo)
describe('script su repository finti', { concurrency: true, skip: SKIP }, () => {
  // ---- PUBBLICA (PC di sviluppo) ----

  it('pubblica: working tree sporco (file modificato o nuovo) → si ferma prima dei controlli, stable non pubblicato', async () => {
    const remote = makeRemote();
    const dev = makeDev(remote);
    fs.appendFileSync(path.join(dev, 'extension', 'manifest.json'), '\n');
    let r = await ps(dev, 'publish-stable.ps1');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /PUBBLICAZIONE ANNULLATA: il working tree non è pulito/);
    assert.match(r.out, /Nessuna versione stabile è stata pubblicata\./);
    git(dev, 'checkout', '--', 'extension/manifest.json');
    fs.writeFileSync(path.join(dev, 'appunti.txt'), 'file nuovo, non registrato');
    r = await ps(dev, 'publish-stable.ps1');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /appunti\.txt/);
    assert.deepEqual(checksRun(dev), [], 'nessun controllo eseguito');
    assert.equal(stableOf(remote), '', 'nessun push');
  });

  it('pubblica: senza remote origin → si ferma', async () => {
    const dev = makeDev(null);
    const r = await ps(dev, 'publish-stable.ps1');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /manca il remote «origin»/);
    assert.deepEqual(checksRun(dev), []);
  });

  it('pubblica: un controllo fallito (npm test, e2e o navigator:check) → stable non pubblicato', async () => {
    for (const [failing, label, ran] of [
      ['test', 'npm test', ['test']],
      ['e2e', 'npm run e2e', ['test', 'e2e']],
      ['navigator', 'npm run navigator:check', ['test', 'e2e', 'navigator']],
    ]) {
      const remote = makeRemote();
      const dev = makeDev(remote);
      fs.mkdirSync(path.join(dev, '.tmp'), { recursive: true });
      fs.writeFileSync(path.join(dev, '.tmp', `fail-${failing}`), '');
      const r = await ps(dev, 'publish-stable.ps1');
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, new RegExp(`PUBBLICAZIONE ANNULLATA: controllo non superato: ${label.replace('.', '\\.')}`));
      assert.deepEqual(checksRun(dev), ran, 'ci si ferma al primo errore');
      assert.equal(stableOf(remote), '', `${label}: nessun push`);
    }
  });

  it('pubblica: tutti i controlli superati → origin/stable = commit provato; commit, versione e data mostrati', async () => {
    const remote = makeRemote();
    const dev = makeDev(remote);
    const r = await ps(dev, 'publish-stable.ps1');
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(checksRun(dev), ['test', 'e2e', 'navigator']);
    assert.equal(stableOf(remote), head(dev));
    assert.match(r.out, /Versione stabile pubblicata/);
    assert.match(r.out, new RegExp(`commit: ${head(dev).slice(0, 7)} Versione 0\\.4\\.0`));
    assert.match(r.out, /versione manifest: 0\.4\.0/);
    assert.match(r.out, /data\/ora: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
    const again = await ps(dev, 'publish-stable.ps1');
    assert.equal(again.code, 0, again.out);
    assert.match(again.out, /Questa versione è già la versione stabile: niente da pubblicare\./);
  });

  it('pubblica: stable con commit non presenti in questa versione → nessun force push', async () => {
    const remote = makeRemote();
    const dev = makeDev(remote);
    git(dev, 'push', '-q', 'origin', 'HEAD:stable');
    const other = fresh('altro-pc');
    git(TMP, 'clone', '-q', '--branch', 'stable', remote, other);
    writeVersion(other, '0.4.9');
    git(other, 'commit', '-am', 'Versione da un altro PC');
    git(other, 'push', '-q', 'origin', 'HEAD:stable');
    const before = stableOf(remote);
    writeVersion(dev, '0.5.0');
    git(dev, 'commit', '-am', 'Versione 0.5.0');
    const r = await ps(dev, 'publish-stable.ps1');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /origin\/stable contiene commit che non sono in questa versione\. Nessun force push/);
    assert.equal(stableOf(remote), before, 'stable invariato');
  });

  // ---- AGGIORNA (PC dei commerciali) ----

  it('aggiorna: porta il PC al commit stable corretto e mostra versione precedente, nuova versione, commit, esito', async () => {
    const { dev, ws } = workstation();
    const target = release(dev, '0.4.1');
    const r = await ps(ws, 'update-workstation.ps1', '-NoBrowser');
    assert.equal(r.code, 0, r.out);
    assert.equal(head(ws), target);
    assert.equal(git(ws, 'rev-parse', '--abbrev-ref', 'HEAD'), 'stable');
    assert.equal(git(ws, 'status', '--porcelain'), '');
    assert.match(r.out, /Versione precedente: 0\.4\.0 \([0-9a-f]{7}\)/);
    assert.match(r.out, /Nuova versione: 0\.4\.1/);
    assert.match(r.out, new RegExp(`Commit: ${target.slice(0, 7)} Versione 0\\.4\\.1`));
    assert.match(r.out, /Esito aggiornamento: aggiornato alla versione stabile/);
    assert.match(r.out, /Premi ↻ sulla scheda Agria Commercial per applicare l'aggiornamento\./);
  });

  it('aggiorna: già aggiornato → «Agria Commercial è già aggiornato.», nessuna modifica', async () => {
    const { ws } = workstation();
    const before = head(ws);
    const r = await ps(ws, 'update-workstation.ps1', '-NoBrowser');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Agria Commercial è già aggiornato\./);
    assert.match(r.out, /Versione: 0\.4\.0/);
    assert.equal(head(ws), before);
  });

  it('aggiorna: modifiche locali (file cambiato, file nuovo, commit locale) → bloccato, nulla cancellato', async () => {
    const { dev, ws } = workstation();
    release(dev, '0.4.1');
    const before = head(ws);
    const manifest = path.join(ws, 'extension', 'manifest.json');
    // file cambiato
    fs.appendFileSync(manifest, '// prova locale\n');
    const changed = fs.readFileSync(manifest, 'utf8');
    let r = await ps(ws, 'update-workstation.ps1', '-NoBrowser');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Aggiornamento bloccato: sono presenti modifiche locali\./);
    assert.match(r.out, /extension\/manifest\.json/);
    assert.equal(fs.readFileSync(manifest, 'utf8'), changed, 'la modifica resta');
    assert.equal(head(ws), before);
    git(ws, 'checkout', '--', 'extension/manifest.json');
    // file nuovo
    fs.writeFileSync(path.join(ws, 'note.txt'), 'appunti del commerciale');
    r = await ps(ws, 'update-workstation.ps1', '-NoBrowser');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Aggiornamento bloccato: sono presenti modifiche locali\./);
    assert.ok(fs.existsSync(path.join(ws, 'note.txt')), 'il file nuovo resta');
    fs.rmSync(path.join(ws, 'note.txt'));
    // commit locale sul ramo stable
    fs.writeFileSync(path.join(ws, 'extra.txt'), 'x');
    git(ws, 'add', 'extra.txt');
    git(ws, 'commit', '-m', 'Commit fatto sul PC del commerciale');
    const local = head(ws);
    r = await ps(ws, 'update-workstation.ps1', '-NoBrowser');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Aggiornamento bloccato: sono presenti modifiche locali\./);
    assert.match(r.out, /Commit fatto sul PC del commerciale/);
    assert.equal(head(ws), local, 'il commit locale resta');
    assert.doesNotMatch(r.out, /Premi ↻/, 'niente invito a ricaricare se l\'aggiornamento non c\'è stato');
  });

  it('aggiorna: PC rimasto su un altro ramo → passa a stable', async () => {
    const { dev, ws } = workstation({ branch: 'master' });
    const target = release(dev, '0.4.1');
    const r = await ps(ws, 'update-workstation.ps1', '-NoBrowser');
    assert.equal(r.code, 0, r.out);
    assert.equal(git(ws, 'rev-parse', '--abbrev-ref', 'HEAD'), 'stable');
    assert.equal(head(ws), target);
  });

  it('lanciatori .cmd: richiamano gli script e restituiscono il loro esito', async () => {
    const { ws } = workstation();
    const cmd = path.join(ws, 'AGGIORNA-AGRIA-COMMERCIAL.cmd');
    const launch = () => run('cmd.exe', ['/d', '/s', '/c', `""${cmd}" -NoBrowser"`], {
      cwd: ws, windowsVerbatimArguments: true, env: { ...process.env, AGRIA_NO_PAUSE: '1' },
    });
    const r = await launch();
    assert.equal(r.code, 0, r.out);
    assert.match(r.stdout, /Agria Commercial è già aggiornato\./);
    fs.appendFileSync(path.join(ws, 'extension', 'manifest.json'), '\n');
    const blocked = await launch();
    assert.equal(blocked.code, 1, 'il codice di uscita arriva dal lanciatore');
  });
});

// ---- controlli statici (tutte le piattaforme) ----

test('script di distribuzione: nessuna operazione distruttiva, nessuna credenziale, Chrome solo su chrome://extensions', () => {
  const publish = read('tools/publish-stable.ps1');
  const update = read('tools/update-workstation.ps1');
  for (const [name, src] of [['publish-stable.ps1', publish], ['update-workstation.ps1', update]]) {
    const code = src.replace(/<#[\s\S]*?#>/g, '').replace(/^\s*#.*$/gm, '');
    assert.ok(!/--force|push\s+-f\b|\+refs\/heads\/stable:refs\/heads|reset\s+--hard|git\s+clean|Remove-Item|Stop-Process|taskkill|SendKeys|chrome\.storage/i.test(code), `${name}: operazione distruttiva`);
    assert.ok(!/(token|password|service.?key)\s*=/i.test(code), `${name}: credenziali`);
    assert.ok(src.startsWith('﻿'), `${name}: UTF-8 con BOM (PowerShell 5.1 legge correttamente accenti e ↻)`);
  }
  assert.equal((publish.match(/& git -C \$Root push\b/g) || []).length, 1, 'un solo push, verso stable');
  assert.match(publish, /& git -C \$Root push origin "\$\{commit\}:refs\/heads\/stable"/);
  assert.match(update, /merge --ff-only refs\/remotes\/origin\/stable/);
  assert.match(update, /Start-Process -FilePath \$chrome -ArgumentList 'chrome:\/\/extensions'/);
  for (const [cmd, script] of [['PUBBLICA-AGRIA-COMMERCIAL.cmd', 'publish-stable.ps1'], ['AGGIORNA-AGRIA-COMMERCIAL.cmd', 'update-workstation.ps1']]) {
    assert.match(read(cmd), new RegExp(`powershell\\.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\\\\${script.replace('.', '\\.')}" %\\*`));
  }
  const ignore = read('.gitignore');
  for (const entry of ['node_modules/', '.tmp/', '.env', '*.pem', '*.key']) assert.ok(ignore.split(/\r?\n/).includes(entry), `.gitignore: ${entry}`);
  assert.match(read('.gitattributes'), /\*\.cmd text eol=crlf/);
  const docs = read('docs/INSTALLAZIONE-COMMERCIALE.md');
  assert.ok(!/pat-(na|eu)\d|ghp_|github_pat_/i.test(docs + publish + update), 'nessun token nei documenti o negli script');
});
