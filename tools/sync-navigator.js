// Copia del Navigatore Chiamata Agria dentro Agria Commercial.
//
// Fonte unica (source of truth): il repository del Navigatore, di cui si usa SOLO il file buildato
// dist/navigatore-chiamata-agria.html. Il repository si legge e basta: nessun file viene scritto o
// modificato là dentro (la verifica della build gira in .tmp/ di questo progetto, ignorata da git).
//
// Perché una copia trasformata: la pagina autonoma ha due blocchi <script> inline, e Chrome (Manifest
// V3) non esegue script inline nelle pagine di un'estensione. La copia sposta il contenuto di ciascun
// blocco in un file .js, identico carattere per carattere, nello stesso punto e nello stesso ordine.
// Nient'altro cambia. tests/navigator.test.js ricompone la pagina e verifica che sia identica,
// byte per byte, al file buildato registrato (impronta SHA-256).
//
// Uso:
//   node tools/sync-navigator.js            aggiorna la copia in extension/modules/navigator/app/
//   node tools/sync-navigator.js --check    controlla soltanto che la copia sia allineata (non scrive)
//   --source <cartella>                     un altro percorso del repository del Navigatore

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'extension', 'modules', 'navigator', 'app');
const DEFAULT_SOURCE = path.resolve(ROOT, '..', 'navigatore-agria-sorgenti', 'navigatore-agria');
const BUILT = 'dist/navigatore-chiamata-agria.html';
export const PAGE = 'navigatore.html';
export const SCRIPTS = ['navigatore-1.js', 'navigatore-2.js'];
export const SOURCE_INFO = 'navigatore.source.json';
const SCRIPT_RE = /<script>([\s\S]*?)<\/script>/g;

export const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/** Pagina buildata → { page, scripts }: i blocchi inline diventano <script src>, il resto resta identico. */
export function splitPage(html) {
  const scripts = [];
  const page = html.replace(SCRIPT_RE, (m, code) => {
    scripts.push(code);
    return `<script src="${SCRIPTS[scripts.length - 1] || 'in-piu.js'}"></script>`;
  });
  if (scripts.length !== SCRIPTS.length) throw new Error(`attesi ${SCRIPTS.length} blocchi <script>, trovati ${scripts.length}`);
  if (/<script\b(?![^>]*\bsrc=)/i.test(page)) throw new Error('resta uno script inline non previsto');
  return { page, scripts };
}

/** L'inverso di splitPage: la pagina come l'ha prodotta la build del Navigatore. */
export function joinPage(page, scripts) {
  return SCRIPTS.reduce((html, name, i) => html.replace(`<script src="${name}"></script>`, () => `<script>${scripts[i]}</script>`), page);
}

const git = (source, ...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();

// la build dei sorgenti, fatta in una cartella temporanea dentro questo progetto: deve dare esattamente
// il file in dist/
function buildMatchesDist(source, built) {
  fs.mkdirSync(path.join(ROOT, '.tmp'), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(ROOT, '.tmp', 'navigatore-build-'));
  try {
    fs.mkdirSync(path.join(tmp, 'src'));
    // anche il package.json del Navigatore: la build gira con le sue regole (CommonJS), non con le nostre
    for (const f of ['package.json', 'build.js', 'src/page.html', 'src/data.js']) fs.copyFileSync(path.join(source, f), path.join(tmp, f));
    execFileSync(process.execPath, ['build.js'], { cwd: tmp, stdio: 'ignore' });
    return fs.readFileSync(path.join(tmp, BUILT), 'utf8') === built;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const source = args.includes('--source') ? path.resolve(args[args.indexOf('--source') + 1]) : DEFAULT_SOURCE;
  const commit = git(source, 'rev-parse', '--short', 'HEAD');
  if (git(source, 'status', '--porcelain')) throw new Error(`il repository del Navigatore ha modifiche non registrate: ${source}`);
  const built = fs.readFileSync(path.join(source, BUILT), 'utf8');
  if (!buildMatchesDist(source, built)) throw new Error(`${BUILT} non corrisponde ai sorgenti: ricompilalo nel repository del Navigatore`);
  const { page, scripts } = splitPage(built);
  if (joinPage(page, scripts) !== built) throw new Error('la copia non ricompone la pagina originale');
  const info = {
    name: 'Navigatore Chiamata Agria',
    sourceRepository: 'navigatore-agria-sorgenti/navigatore-agria',
    commit,
    sourceFile: BUILT,
    sourceSha256: sha256(built),
    files: Object.fromEntries([[PAGE, page], ...SCRIPTS.map((n, i) => [n, scripts[i]])].map(([n, t]) => [n, sha256(t)])),
    transformation: 'i due blocchi <script> inline spostati in file .js identici (CSP di Manifest V3); nessun altro cambiamento',
  };
  const outputs = [[PAGE, page], ...SCRIPTS.map((n, i) => [n, scripts[i]]), [SOURCE_INFO, `${JSON.stringify(info, null, 2)}\n`]];
  if (check) {
    const stale = outputs.filter(([n, t]) => !fs.existsSync(path.join(OUT, n)) || fs.readFileSync(path.join(OUT, n), 'utf8') !== t).map(([n]) => n);
    if (stale.length) throw new Error(`copia non allineata al Navigatore ${commit}: ${stale.join(', ')}`);
    console.log(`Copia del Navigatore allineata al commit ${commit}.`);
    return;
  }
  fs.mkdirSync(OUT, { recursive: true });
  for (const [n, t] of outputs) fs.writeFileSync(path.join(OUT, n), t);
  console.log(`Navigatore ${commit} copiato in ${path.relative(ROOT, OUT)} (${outputs.map(([n]) => n).join(', ')}).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`sync-navigator: ${err.message}`);
    process.exitCode = 1;
  }
}
