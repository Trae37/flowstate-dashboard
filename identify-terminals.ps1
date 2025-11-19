# Script to help identify which terminals are which
# Run this to see all PowerShell processes with their working directories

Write-Host "========================================"
Write-Host "TERMINAL IDENTIFICATION HELPER"
Write-Host "========================================"
Write-Host ""

$processes = Get-Process powershell,pwsh -ErrorAction SilentlyContinue |
    Select-Object Id,ProcessName,MainWindowTitle,Path

if ($null -eq $processes) {
    Write-Host "No PowerShell processes found!" -ForegroundColor Red
    exit
}

Write-Host "Found $($processes.Count) PowerShell process(es):" -ForegroundColor Green
Write-Host ""

$standaloneTerminals = @()

foreach ($proc in $processes) {
    $parentInfo = Get-WmiObject Win32_Process -Filter "ProcessId = $($proc.Id)" -ErrorAction SilentlyContinue

    if (!$parentInfo) { continue }

    $parentId = $parentInfo.ParentProcessId
    $parentProc = Get-Process -Id $parentId -ErrorAction SilentlyContinue
    $parentName = if ($parentProc) { $parentProc.ProcessName } else { "(unknown)" }

    # Get working directory from child processes
    $workingDir = "Unknown"
    $childProcs = Get-WmiObject Win32_Process -Filter "ParentProcessId = $($proc.Id)" -ErrorAction SilentlyContinue
    if ($childProcs) {
        $cwdProc = $childProcs | Where-Object { $_.CommandLine -match 'cwd=' } | Select-Object -First 1
        if ($cwdProc -and $cwdProc.CommandLine -match 'cwd=([^;]+)') {
            $workingDir = $matches[1]
        }
    }

    # Check if this is a Cursor IDE terminal
    $isCursorIDE = $false
    if ($parentName.ToLower().Contains('cursor')) {
        $isCursorIDE = $true
    }
    if ($parentInfo.CommandLine -and $parentInfo.CommandLine.ToLower().Contains('cursor') -and
        $parentInfo.CommandLine.ToLower().Contains('shellintegration')) {
        $isCursorIDE = $true
    }

    # Check if Windows Terminal
    $isWindowsTerminal = $parentName -eq 'WindowsTerminal' -or $parentName -eq 'wt'

    # Check if has Claude Code running
    $hasClaudeCode = $false
    if ($childProcs) {
        foreach ($child in $childProcs) {
            if ($child.Name -like '*claude*' -or $child.CommandLine -like '*claude*') {
                $hasClaudeCode = $true
                break
            }
        }
    }

    # Check if running npm/node
    $hasNpmNode = $false
    if ($childProcs) {
        foreach ($child in $childProcs) {
            if ($child.Name -eq 'node.exe' -or $child.Name -eq 'npm.cmd' -or $child.Name -eq 'npm') {
                $hasNpmNode = $true
                break
            }
        }
    }

    # Only show standalone terminals (not Cursor IDE)
    if (!$isCursorIDE) {
        $standaloneTerminals += $proc

        Write-Host "PID: $($proc.Id)" -ForegroundColor Yellow
        Write-Host "  Parent: $parentName"
        Write-Host "  Terminal Type: " -NoNewline
        if ($isWindowsTerminal) {
            Write-Host "Windows Terminal Tab" -ForegroundColor Cyan
        } else {
            Write-Host "Standalone PowerShell" -ForegroundColor Cyan
        }
        Write-Host "  Working Directory: $workingDir"
        Write-Host "  Claude Code: " -NoNewline
        if ($hasClaudeCode) {
            Write-Host "YES" -ForegroundColor Green
        } else {
            Write-Host "No" -ForegroundColor Gray
        }
        Write-Host "  npm/node: " -NoNewline
        if ($hasNpmNode) {
            Write-Host "YES (likely electron recovery)" -ForegroundColor Green
        } else {
            Write-Host "No" -ForegroundColor Gray
        }
        Write-Host ""
    }
}

Write-Host "========================================"
Write-Host "SUMMARY"
Write-Host "========================================"
Write-Host "Total standalone terminals: $($standaloneTerminals.Count)" -ForegroundColor Green
Write-Host ""
Write-Host "Expected: 5 terminals" -ForegroundColor Yellow
Write-Host "  - 2 Claude Code terminals"
Write-Host "  - 1 regular terminal"
Write-Host "  - 2 electron recovery terminals (npm run dev)"
Write-Host ""
