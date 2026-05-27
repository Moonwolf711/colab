# Registers a per-user logon task that keeps the ClaudeBar M4L device working:
# it starts the local Collab-Hub server (127.0.0.1:3939) + the Claude bridge so the
# jweb bar can connect the moment Ableton loads it. Idempotent — safe to re-run.
#
#   pwsh -ExecutionPolicy Bypass -File install-claude-bar-autostart.ps1
#
# Port 3939 (not 3000) is deliberate: 3000 collides with Docker Desktop's wildcard
# bind and intermittently fails with WinError 10013.

$ErrorActionPreference = 'Stop'
$pyw      = 'C:\ProgramData\miniconda3\pythonw.exe'   # windowless interpreter
$colab    = Join-Path $HOME 'colab'
$launcher = Join-Path $colab 'claude_bar_launch.py'

if (-not (Test-Path $pyw))      { throw "pythonw not found: $pyw" }
if (-not (Test-Path $launcher)) { throw "launcher not found: $launcher" }

$action  = New-ScheduledTaskAction -Execute $pyw -Argument "`"$launcher`"" -WorkingDirectory $colab
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
              -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
              -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName 'ClaudeBar' -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force `
  -Description 'Starts local Collab-Hub server + Claude bridge for the ClaudeBar M4L device' | Out-Null

Write-Host 'Registered logon task "ClaudeBar". Starting it now...'
Start-ScheduledTask -TaskName 'ClaudeBar'
Write-Host 'Done. Server + bridge will be running on every login.'
