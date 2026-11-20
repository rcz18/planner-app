# Planner Helper setup for Windows: lets the Planner app run Claude Code on this computer.
# Run in PowerShell:  irm https://raw.githubusercontent.com/rcz18/planner-app/main/helper/setup.ps1 | iex
# Run it again any time to update. Remove with:  irm https://raw.githubusercontent.com/rcz18/planner-app/main/helper/uninstall.ps1 | iex
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$base = 'https://rcz18.github.io/planner-app/helper'
$port = 47321
function Say($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }
function Ok($t) { Write-Host "  [OK] $t" -ForegroundColor Green }
Say ''
Say '=== Planner Helper setup ===' 'Cyan'
Say 'Ikokonekta nito ang Planner app kay Claude Code sa PC na ito.'
Say ''

Add-Type -AssemblyName System.Windows.Forms
function PickFolder($desc, $start) {
  $d = New-Object System.Windows.Forms.FolderBrowserDialog
  $d.Description = $desc; $d.ShowNewFolderButton = $true
  try { $d.UseDescriptionForTitle = $true } catch {}
  if ($start -and (Test-Path $start)) { $d.SelectedPath = $start }
  $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
  $r = $d.ShowDialog($owner); $owner.Dispose()
  if ($r -eq [System.Windows.Forms.DialogResult]::OK) { return $d.SelectedPath } else { return $null }
}

# --- 1. where things go (you choose) ---
$cfgOld = $null
$taskOld = Get-ScheduledTask -TaskName 'Planner Helper' -ErrorAction SilentlyContinue
if ($taskOld) { $a = $taskOld.Actions[0].Arguments; if ($a -match '"([^"]+helper\.js)"') { $p = Join-Path (Split-Path $Matches[1]) 'config.json'; if (Test-Path $p) { $cfgOld = Get-Content $p -Raw | ConvertFrom-Json; $oldDir = Split-Path $Matches[1] } } }
$defDir = if ($oldDir) { $oldDir } else { Join-Path $env:LOCALAPPDATA 'Planner Helper' }
Say '1) Piliin kung SAAN ILALAGAY ang Planner Helper (may lalabas na window).' 'Yellow'
$parent = PickFolder 'Saan ilalagay ang Planner Helper? (gagawa ng folder na "Planner Helper" dito)' (Split-Path $defDir)
if (-not $parent) { $dir = $defDir } elseif ((Split-Path $parent -Leaf) -eq 'Planner Helper') { $dir = $parent } else { $dir = Join-Path $parent 'Planner Helper' }
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Ok "Helper folder: $dir"

$defRoot = if ($cfgOld -and $cfgOld.root) { $cfgOld.root } elseif (Test-Path 'J:\My Drive\Video Production') { 'J:\My Drive\Video Production' } else { [Environment]::GetFolderPath('MyDocuments') }
Say '2) Piliin ang PROJECTS FOLDER mo (kung nasaan ang mga .planner project).' 'Yellow'
$root = PickFolder 'Piliin ang projects folder (dito lang puwedeng gumawa si Claude Code)' $defRoot
if (-not $root) { $root = $defRoot }
Ok "Projects folder: $root"

# --- 2. Node.js (runs the helper) ---
function FindNode { $c = Get-Command node -ErrorAction SilentlyContinue; if ($c) { return $c.Source }; foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) { if (Test-Path $p) { return $p } }; return $null }
$node = FindNode
if (-not $node) {
  Say 'Ini-install ang Node.js (kailangan ng helper)...'
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent | Out-Host
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  $node = FindNode
  if (-not $node) { throw 'Hindi ma-install ang Node.js. I-install mula sa https://nodejs.org tapos patakbuhin ulit ito.' }
}
Ok "Node.js: $node"

# --- 3. Git for Windows (Claude Code needs it) ---
if (-not (Get-Command git -ErrorAction SilentlyContinue) -and -not (Test-Path "$env:ProgramFiles\Git\bin\bash.exe")) {
  Say 'Ini-install ang Git for Windows (kailangan ni Claude Code)...'
  winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements --silent | Out-Host
}
Ok 'Git for Windows'

# --- 4. Claude Code ---
function FindClaude { foreach ($p in @("$env:USERPROFILE\.local\bin\claude.exe", "$env:APPDATA\npm\claude.cmd")) { if (Test-Path $p) { return $p } }; $c = Get-Command claude -ErrorAction SilentlyContinue; if ($c) { return $c.Source }; return $null }
$claude = FindClaude
if (-not $claude) {
  Say 'Ini-install ang Claude Code...'
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex" | Out-Host
  $claude = FindClaude
  if (-not $claude) { throw 'Hindi ma-install ang Claude Code. Subukan ulit, o tingnan ang https://docs.claude.com/en/docs/claude-code' }
}
Ok "Claude Code: $claude"

# --- 5. helper files + the planner skill for Claude Code ---
$v = [DateTimeOffset]::Now.ToUnixTimeSeconds()
Invoke-WebRequest "$base/helper.js?v=$v" -OutFile (Join-Path $dir 'helper.js') -UseBasicParsing
$skillDir = Join-Path $env:USERPROFILE '.claude\skills\planner'
New-Item -ItemType Directory -Force -Path $skillDir | Out-Null
Invoke-WebRequest "$base/SKILL.md?v=$v" -OutFile (Join-Path $skillDir 'SKILL.md') -UseBasicParsing
$cfg = [ordered]@{ root = $root; port = $port; claude = $claude; node = $node }
if ($cfgOld -and $cfgOld.model) { $cfg.model = $cfgOld.model }
$cfg | ConvertTo-Json | Set-Content -Path (Join-Path $dir 'config.json') -Encoding UTF8
Ok 'Helper at planner skill'

# --- 6. start with Windows, quietly (no window) ---
if ($taskOld) { Stop-ScheduledTask -TaskName 'Planner Helper' -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*helper.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument ("--headless `"$node`" `"" + (Join-Path $dir 'helper.js') + "`"") -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Planner Helper' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Lets the Planner app run Claude Code on this PC' -Force | Out-Null
Start-ScheduledTask -TaskName 'Planner Helper'
Start-Sleep -Seconds 3
try { $st = Invoke-RestMethod "http://127.0.0.1:$port/status" -TimeoutSec 5; Ok "Helper running (v$($st.helper))" } catch { Say '  [!] Hindi pa sumasagot ang helper. I-restart ang PC kung hindi ito gumana.' 'Red' }

# --- 7. log in to Claude Code once ---
if (-not (Test-Path "$env:USERPROFILE\.claude\.credentials.json")) {
  Say ''
  Say 'Huling hakbang: mag-login kay Claude Code gamit ang Claude account mo (walang API).' 'Yellow'
  Say 'Bubukas si Claude Code dito. Sundan ang login, tapos i-type ang /exit para matapos.' 'Yellow'
  Read-Host 'Pindutin ang Enter para magsimula'
  & $claude
}
Say ''
Say '=== Tapos na! ===' 'Cyan'
Say 'Buksan ang Planner app. Kapag nagtanong ang Chrome tungkol sa "local network", piliin ang Allow.'
Say 'Ang Revise / Apply all changes / Export ay diretso na kay Claude Code.'
