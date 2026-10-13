<#
  Pubblica la versione stabile di Agria Commercial (SOLO sul PC di sviluppo).
  Si avvia con PUBBLICA-AGRIA-COMMERCIAL.cmd nella cartella del repository.

  1. controlla di essere nel repository agria-scout, con working tree pulito e remote «origin»;
  2. esegue npm test, npm run e2e, npm run navigator:check: al primo errore si ferma e NON pubblica;
  3. git fetch origin, poi git push origin HEAD:stable (mai un force push: se stable contiene
     commit che non sono in questa versione, si ferma);
  4. mostra commit, versione del manifest, data e ora.

  I PC dei commerciali si aggiornano poi con AGGIORNA-AGRIA-COMMERCIAL.cmd (tools/update-workstation.ps1).
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$Root = Split-Path -Parent $PSScriptRoot

function Write-Step([string]$Text) {
  Write-Host ''
  Write-Host "== $Text" -ForegroundColor Cyan
}

function Stop-Publish([string]$Text, [string[]]$Detail = @()) {
  Write-Host ''
  Write-Host "PUBBLICAZIONE ANNULLATA: $Text" -ForegroundColor Red
  foreach ($line in $Detail) { if ($line) { Write-Host "  $line" } }
  Write-Host 'Nessuna versione stabile è stata pubblicata.' -ForegroundColor Red
  exit 1
}

# git nel repository; restituisce lo stdout (testo) o $null se git esce con errore
function Get-GitText([string[]]$GitArgs) {
  $out = & git -C $Root @GitArgs
  if ($LASTEXITCODE -ne 0) { return $null }
  return (($out | ForEach-Object { "$_" }) -join "`n").TrimEnd()
}

function Test-SamePath([string]$A, [string]$B) {
  $norm = { param($p) [System.IO.Path]::GetFullPath($p.Replace('/', '\')).TrimEnd('\') }
  return [string]::Equals((& $norm $A), (& $norm $B), [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-ManifestVersion([string]$Commit) {
  $json = Get-GitText @('show', "${Commit}:extension/manifest.json")
  if (-not $json) { return '?' }
  return ($json | ConvertFrom-Json).version
}

# ---------------------------------------------------------------------------------------------
Write-Host 'Agria Commercial - Pubblica versione stabile' -ForegroundColor White

Write-Step 'Controllo del repository'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Stop-Publish 'Git non è installato o non è nel PATH.' }
$top = Get-GitText @('rev-parse', '--show-toplevel')
if (-not $top -or -not (Test-SamePath $top $Root)) { Stop-Publish "questa cartella non è il repository agria-scout: $Root" }
$package = Join-Path $Root 'package.json'
if (-not (Test-Path -LiteralPath $package) -or (Get-Content -Raw -Encoding UTF8 -LiteralPath $package | ConvertFrom-Json).name -ne 'agria-scout' -or -not (Test-Path -LiteralPath (Join-Path $Root 'extension\manifest.json'))) {
  Stop-Publish "questa cartella non è il repository agria-scout: $Root"
}
$dirty = Get-GitText @('status', '--porcelain')
if ($null -eq $dirty) { Stop-Publish 'git status non riuscito.' }
if ($dirty) { Stop-Publish 'il working tree non è pulito: fai prima il commit (o annulla le modifiche).' ($dirty -split "`n") }
$origin = if (((Get-GitText @('remote')) -split "`n") -contains 'origin') { Get-GitText @('remote', 'get-url', 'origin') } else { $null }
if (-not $origin) { Stop-Publish 'manca il remote «origin» (vedi README, «Distribuzione interna»).' }
$commit = Get-GitText @('rev-parse', 'HEAD')
$branch = Get-GitText @('rev-parse', '--abbrev-ref', 'HEAD')
Write-Host "Repository: $Root"
Write-Host "Ramo: $branch · commit $($commit.Substring(0, 7))"
Write-Host "Remote origin: $origin"

# Playwright per npm run e2e: se non è installato qui, quello del repository del Navigatore (solo lettura)
if (-not $env:NODE_PATH) {
  Push-Location $Root
  & node -e "try { require.resolve('playwright'); process.exit(0) } catch { process.exit(1) }"
  $hasPlaywright = $LASTEXITCODE -eq 0
  Pop-Location
  $navigatorModules = Join-Path (Split-Path -Parent $Root) 'navigatore-agria-sorgenti\navigatore-agria\node_modules'
  if (-not $hasPlaywright -and (Test-Path -LiteralPath (Join-Path $navigatorModules 'playwright'))) {
    $env:NODE_PATH = $navigatorModules
    Write-Host "Playwright: quello del repository del Navigatore ($navigatorModules)"
  }
}

foreach ($check in @(@('test'), @('run', 'e2e'), @('run', 'navigator:check'))) {
  $label = "npm $($check -join ' ')"
  Write-Step $label
  Push-Location $Root
  & npm @check
  $code = $LASTEXITCODE
  Pop-Location
  if ($code -ne 0) { Stop-Publish "controllo non superato: $label (codice $code)." }
}

Write-Step 'Pubblicazione su origin/stable'
# i controlli non devono aver cambiato nulla: si pubblica esattamente il commit provato
if ((Get-GitText @('status', '--porcelain')) -or (Get-GitText @('rev-parse', 'HEAD')) -ne $commit) {
  Stop-Publish 'il repository è cambiato durante i controlli.'
}
& git -C $Root fetch origin
if ($LASTEXITCODE -ne 0) { Stop-Publish 'git fetch origin non riuscito (rete o accesso al repository).' }
$remoteStable = Get-GitText @('rev-parse', '--verify', '--quiet', 'refs/remotes/origin/stable')
if ($remoteStable -eq $commit) {
  Write-Host ''
  Write-Host 'Questa versione è già la versione stabile: niente da pubblicare.' -ForegroundColor Green
  Write-Host "commit: $($commit.Substring(0, 7)) $(Get-GitText @('log', '-1', '--format=%s', $commit))"
  Write-Host "versione manifest: $(Get-ManifestVersion $commit)"
  exit 0
}
if ($remoteStable) {
  & git -C $Root merge-base --is-ancestor $remoteStable $commit
  if ($LASTEXITCODE -ne 0) {
    Stop-Publish 'origin/stable contiene commit che non sono in questa versione. Nessun force push: allinea prima il ramo (git merge origin/stable), prova e pubblica di nuovo.'
  }
}
& git -C $Root push origin "${commit}:refs/heads/stable"
if ($LASTEXITCODE -ne 0) { Stop-Publish 'git push origin HEAD:stable non riuscito.' }
$published = Get-GitText @('ls-remote', 'origin', 'refs/heads/stable')
if (-not $published -or -not $published.StartsWith($commit)) { Stop-Publish 'origin/stable non corrisponde al commit appena inviato.' }

Write-Host ''
Write-Host 'Versione stabile pubblicata' -ForegroundColor Green
Write-Host "commit: $($commit.Substring(0, 7)) $(Get-GitText @('log', '-1', '--format=%s', $commit))"
Write-Host "versione manifest: $(Get-ManifestVersion $commit)"
Write-Host "data/ora: $(Get-Date -Format 'dd/MM/yyyy HH:mm')"
Write-Host ''
Write-Host 'Sui PC dei commerciali: AGGIORNA-AGRIA-COMMERCIAL.cmd, poi ↻ su Agria Commercial in chrome://extensions.'
exit 0
