#requires -version 5.1
<#
.SYNOPSIS
    Automated TUI test harness for the Claude Terminal M4L bridge, driven by kitlangton's
    `terminal-control` (termctrl) — captures the terminal-side process that feeds the M4L
    Claude Terminal device.

.DESCRIPTION
    SCOPE / HONEST BOUNDARY
    -----------------------
    The Claude Terminal "M4L UI" is a graphical `jsui` panel rendered INSIDE Max for Live
    (claude-terminal-ui.js). terminal-control captures *terminal* (PTY) processes — it cannot
    screenshot a Max GUI window. What it CAN drive and screenshot is the terminal-side harness
    that drives the M4L device: the Python bridges in claude-terminal-m4l/ that emit
    color-coded CoLaB-protocol UDP lines and print to stdout.

    This script therefore:
      1. Runs claude-terminal-m4l/claude_terminal_bridge.py (its __main__ demo sends 12
         tagged lines to UDP 8001 and prints each to stdout) under termctrl and screenshots
         the captured terminal output. That demo IS the terminal-side driver of the M4L device.
      2. Runs claude-terminal-m4l/test_terminal.py (smoke test → UDP 11002) the same way.

    Use this to regression-test the bridge's terminal output without opening Ableton, and to
    capture PNG/text evidence of what the bridge sends to the M4L device.

    termctrl (v0.3.0) builds and runs on Windows via portable-pty/ConPTY — verified with
    `termctrl --help`. Its README notes that *persistent named sessions over Unix sockets* are
    macOS/Linux-only; this script deliberately uses the one-off `save`/`show` PTY-capture path,
    which works on Windows, instead of `start`/`send`/`stop`.

.PARAMETER TermctrlPath
    Path to the termctrl(.exe) binary. Defaults to the vendored release build on E:.

.PARAMETER OutDir
    Directory for captured artifacts (PNG + TXT). Defaults to .\captures under this script.

.PARAMETER PythonExe
    Python interpreter to run the bridges. Defaults to "python".

.EXAMPLE
    pwsh -File scripts/test-m4l-terminal.ps1
    Runs both bridges under termctrl and writes PNG+TXT captures to scripts/captures/.

.NOTES
    Build termctrl first (see "BUILD NOTE" at the bottom of this file) if the default path
    does not exist.
#>
[CmdletBinding()]
param(
    [string]$TermctrlPath = 'E:\Projects\_deps\terminal-control\target\release\termctrl.exe',
    [string]$OutDir,
    [string]$PythonExe = 'python'
)

$ErrorActionPreference = 'Stop'

# --- Resolve paths relative to this script (repo-root independent) ---
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Split-Path -Parent $scriptDir
$m4lDir    = Join-Path $repoRoot 'claude-terminal-m4l'
if (-not $OutDir) { $OutDir = Join-Path $scriptDir 'captures' }

function Write-Tag($tag, $msg, $color = 'Gray') {
    Write-Host "[$tag] " -ForegroundColor $color -NoNewline
    Write-Host $msg
}

# --- Preflight ---
if (-not (Test-Path $TermctrlPath)) {
    Write-Tag 'ERR' "termctrl not found at: $TermctrlPath" 'Red'
    Write-Host ''
    Write-Host 'BUILD IT FIRST (Rust/cargo required):' -ForegroundColor Yellow
    Write-Host '  git clone --depth 1 https://github.com/kitlangton/terminal-control E:\Projects\_deps\terminal-control'
    Write-Host '  cd E:\Projects\_deps\terminal-control'
    Write-Host '  cargo build --release'
    Write-Host '  # binary lands at target\release\termctrl.exe'
    Write-Host 'Then re-run this script, or pass -TermctrlPath <path>.'
    exit 1
}

if (-not (Test-Path $m4lDir)) {
    Write-Tag 'ERR' "claude-terminal-m4l directory not found at: $m4lDir" 'Red'
    exit 1
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# --- Verify the tool itself ---
Write-Tag 'SYS' "Verifying termctrl..." 'Magenta'
$ver = & $TermctrlPath --version 2>&1
Write-Tag 'INFO' "termctrl: $ver"

# --- Capture helper: run a python script under termctrl, save PNG + TXT ---
# Uses one-off `save` (PTY-captures the process, writes requested formats, then exits).
function Invoke-TermctrlCapture {
    param(
        [string]$Name,        # artifact base name (no extension)
        [string]$PyScript,    # python file to run, relative to $m4lDir
        [int]$Cols = 100,
        [int]$Rows = 32
    )

    $scriptPath = Join-Path $m4lDir $PyScript
    if (-not (Test-Path $scriptPath)) {
        Write-Tag 'WARN' "skip $Name — missing $PyScript" 'Yellow'
        return $false
    }

    $outBase = Join-Path $OutDir $Name
    Write-Tag 'CMD' "termctrl save -> $Name (running $PyScript)" 'Blue'

    # `--pipe` reads the process output as a piped stream (the bridges print line-by-line
    # then exit). We request both png (visual evidence) and txt (diffable text).
    # Layout: termctrl save [opts] -- <command> [args]
    & $TermctrlPath save `
        --pipe `
        --format png --format txt `
        --cols $Cols --rows $Rows `
        --out $outBase `
        -- $PythonExe $scriptPath 2>&1 | ForEach-Object { Write-Host "    $_" }

    $png = "$outBase.png"
    $txt = "$outBase.txt"
    $okPng = Test-Path $png
    $okTxt = Test-Path $txt

    if ($okTxt) {
        Write-Tag 'PARAM' "captured text: $txt" 'Cyan'
        # Echo first few captured lines as a quick sanity check.
        Get-Content $txt -TotalCount 6 | ForEach-Object { Write-Host "      | $_" -ForegroundColor DarkGray }
    }
    if ($okPng) { Write-Tag 'PARAM' "captured png:  $png" 'Cyan' }

    if (-not ($okPng -or $okTxt)) {
        Write-Tag 'ERR' "$Name produced no artifacts" 'Red'
        return $false
    }
    return $true
}

# --- Run the two terminal-side drivers of the M4L Claude Terminal device ---
Write-Tag 'SYS' '--- Capturing claude_terminal_bridge.py demo (12 tagged lines -> UDP 8001) ---' 'Magenta'
$r1 = Invoke-TermctrlCapture -Name 'bridge-demo' -PyScript 'claude_terminal_bridge.py'

Write-Tag 'SYS' '--- Capturing test_terminal.py smoke test (9 lines -> UDP 11002) ---' 'Magenta'
$r2 = Invoke-TermctrlCapture -Name 'smoke-test' -PyScript 'test_terminal.py'

# --- Summary ---
Write-Host ''
Write-Tag 'SYS' '=== test-m4l-terminal summary ===' 'Magenta'
Write-Host ("  bridge-demo : {0}" -f ($(if ($r1) { 'OK' } else { 'FAIL' })))
Write-Host ("  smoke-test  : {0}" -f ($(if ($r2) { 'OK' } else { 'FAIL' })))
Write-Host ("  artifacts   : {0}" -f $OutDir)
Write-Host ''
Write-Host 'NOTE: these capture the terminal-side bridge that FEEDS the M4L device, not the' -ForegroundColor DarkYellow
Write-Host '      in-Max graphical jsui panel (terminal-control cannot screenshot a Max GUI).' -ForegroundColor DarkYellow

if ($r1 -and $r2) { exit 0 } else { exit 1 }

# =============================================================================================
# BUILD NOTE — terminal-control (termctrl)
# ---------------------------------------------------------------------------------------------
# Source: https://github.com/kitlangton/terminal-control (MIT). Vendored --depth 1 to
#   E:\Projects\_deps\terminal-control (gitignored, not committed to this repo).
#
# Built on this machine with:
#   cargo build --release        # cargo 1.94.1 — SUCCEEDED, ~2 min
#   target\release\termctrl.exe --version   ->  termctrl 0.3.0   (VERIFIED on Windows)
#
# Windows support: termctrl uses portable-pty (ConPTY) so one-off `show`/`save` PTY capture
# works on Windows. The upstream README notes that ONLY persistent named sessions (the
# `start`/`send`/`stop` socket flow) are limited to macOS/Linux. This script uses the
# Windows-supported `save --pipe` path, so it does not depend on that limitation.
# =============================================================================================
