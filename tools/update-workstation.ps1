<#
  Aggiorna Agria Commercial sul PC di un commerciale alla versione approvata (origin/stable).
  Si avvia con AGGIORNA-AGRIA-COMMERCIAL.cmd nella cartella del repository.

  Pensato per PC che NON sviluppano: il repository locale deve essere identico a origin/stable.
  - Se ci sono modifiche locali (file cambiati, file nuovi, commit locali) si ferma e non cancella nulla.
  - Altrimenti porta il ramo stable a origin/stable solo in avanti (git merge --ff-only): nessun reset,
    nessuna cancellazione.
  - Alla fine apre chrome://extensions: il commerciale preme ↻ su Agria Commercial. Chrome non viene
    chiuso e i dati dell'estensione (Service Key, impostazioni) restano nel profilo di Chrome.

  -NoBrowser: non apre Chrome (per le prove automatiche).
#>
[CmdletBinding()]
param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$Root = Split-Path -Parent $PSScriptRoot
$Blocked = 'Aggiornamento bloccato: sono presenti modifiche locali.'

function Stop-Update([string]$Text, [string[]]$Detail = @()) {
  Write-Host ''
  Write-Host $Text -ForegroundColor Red
  foreach ($line in $Detail) { if ($line) { Write-Host "  $line" } }
  Write-Host 'Non è stato modificato né cancellato nulla. Avvisa il responsabile di Agria Commercial.' -ForegroundColor Red
  exit 1
}

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

function Get-CommitLine([string]$Commit) {
  return "$($Commit.Substring(0, 7)) $(Get-GitText @('log', '-1', '--format=%s', $Commit))"
}

function Find-Chrome {
  $paths = @()
  foreach ($hive in @('HKCU:', 'HKLM:')) {
    try {
      $value = (Get-ItemProperty -LiteralPath "$hive\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" -ErrorAction Stop).'(default)'
      if ($value) { $paths += $value }
    } catch { }
  }
  $paths += @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  )
  foreach ($p in $paths) { if ($p -and (Test-Path -LiteralPath $p)) { return $p } }
  return $null
}

# apre chrome://extensions in una nuova scheda della finestra di Chrome già aperta (nessuna chiusura)
function Open-Extensions {
  if (-not $NoBrowser) {
    $chrome = Find-Chrome
    if ($chrome) { Start-Process -FilePath $chrome -ArgumentList 'chrome://extensions' }
    else { Write-Host 'Chrome non trovato: apri Chrome e scrivi chrome://extensions nella barra degli indirizzi.' -ForegroundColor Yellow }
  }
  Write-Host ''
  Write-Host "Premi ↻ sulla scheda Agria Commercial per applicare l'aggiornamento." -ForegroundColor Green
  Write-Host "(↻ è il pulsante «Ricarica» con la freccia circolare. Non premere «Rimuovi».)"
  Write-Host 'Service Key e impostazioni restano; dopo ↻ scegli di nuovo il tuo nome nel pannello.'
}

# ---------------------------------------------------------------------------------------------
Write-Host 'Agria Commercial - Aggiornamento alla versione stabile' -ForegroundColor White
Write-Host ''

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host 'Git non è installato: installalo da https://git-scm.com/download/win e riprova.' -ForegroundColor Red
  exit 1
}
$top = Get-GitText @('rev-parse', '--show-toplevel')
if (-not $top -or -not (Test-SamePath $top $Root) -or -not (Test-Path -LiteralPath (Join-Path $Root 'extension\manifest.json'))) {
  Write-Host "Questa cartella non è il repository di Agria Commercial: $Root" -ForegroundColor Red
  exit 1
}
if (-not (((Get-GitText @('remote')) -split "`n") -contains 'origin')) {
  Write-Host 'Il repository non ha il remote «origin»: vedi docs/INSTALLAZIONE-COMMERCIALE.md.' -ForegroundColor Red
  exit 1
}

Write-Host 'Scarico la versione stabile…'
& git -C $Root fetch origin '+refs/heads/stable:refs/remotes/origin/stable'
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Download non riuscito: controlla la connessione e l''accesso al repository, poi riprova.' -ForegroundColor Red
  exit 1
}
$target = Get-GitText @('rev-parse', '--verify', '--quiet', 'refs/remotes/origin/stable')
if (-not $target) {
  Write-Host 'Sul repository non c''è ancora una versione stabile (ramo stable).' -ForegroundColor Red
  exit 1
}

# modifiche locali: file cambiati o nuovi (non ignorati) e commit locali sul ramo stable
$dirty = Get-GitText @('status', '--porcelain')
if ($null -eq $dirty) { Stop-Update 'git status non riuscito.' }
if ($dirty) { Stop-Update $Blocked ($dirty -split "`n") }
$localStable = Get-GitText @('rev-parse', '--verify', '--quiet', 'refs/heads/stable')
if ($localStable) {
  & git -C $Root merge-base --is-ancestor $localStable $target
  if ($LASTEXITCODE -ne 0) {
    $extra = Get-GitText @('log', '--format=%h %s', "$target..$localStable")
    Stop-Update $Blocked (@('Commit locali sul ramo stable che non sono nella versione approvata:') + ($extra -split "`n"))
  }
}

$previous = Get-GitText @('rev-parse', 'HEAD')
$branch = Get-GitText @('rev-parse', '--abbrev-ref', 'HEAD')
$previousVersion = Get-ManifestVersion $previous

if ($branch -eq 'stable' -and $previous -eq $target) {
  Write-Host ''
  Write-Host 'Agria Commercial è già aggiornato.' -ForegroundColor Green
  Write-Host "Versione: $previousVersion"
  Write-Host "Commit: $(Get-CommitLine $target)"
  Open-Extensions
  exit 0
}

if (-not $localStable) { & git -C $Root checkout -b stable --track origin/stable }
elseif ($branch -ne 'stable') { & git -C $Root checkout stable }
if ($LASTEXITCODE -ne 0) { Stop-Update 'Passaggio al ramo stable non riuscito.' }
& git -C $Root merge --ff-only refs/remotes/origin/stable
if ($LASTEXITCODE -ne 0) { Stop-Update 'Aggiornamento non riuscito (merge --ff-only).' }
$now = Get-GitText @('rev-parse', 'HEAD')
if ($now -ne $target -or (Get-GitText @('status', '--porcelain'))) { Stop-Update 'Il repository non corrisponde alla versione stabile dopo l''aggiornamento.' }

Write-Host ''
Write-Host "Versione precedente: $previousVersion ($($previous.Substring(0, 7)))"
Write-Host "Nuova versione: $(Get-ManifestVersion $target)"
Write-Host "Commit: $(Get-CommitLine $target)"
Write-Host 'Esito aggiornamento: aggiornato alla versione stabile' -ForegroundColor Green
Open-Extensions
exit 0
