# Removes the Planner Helper (keeps Claude Code, Node.js and your projects).
$t = Get-ScheduledTask -TaskName 'Planner Helper' -ErrorAction SilentlyContinue
if ($t) { $a = $t.Actions[0].Arguments; Stop-ScheduledTask -TaskName 'Planner Helper' -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'Planner Helper' -Confirm:$false
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*helper.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  if ($a -match '"([^"]+helper\.js)"') { Remove-Item -Recurse -Force (Split-Path $Matches[1]) -ErrorAction SilentlyContinue } }
Remove-Item -Recurse -Force (Join-Path $env:USERPROFILE '.claude\skills\planner') -ErrorAction SilentlyContinue
Write-Host 'Natanggal na ang Planner Helper.' -ForegroundColor Green
