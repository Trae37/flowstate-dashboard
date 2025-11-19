# Terminal Detection Diagnostic Script
# Shows ALL PowerShell processes and their metadata

Write-Host "========================================"
Write-Host "TERMINAL DETECTION DIAGNOSTIC"
Write-Host "========================================"
Write-Host ""

# Get all PowerShell processes
$processes = Get-Process powershell,pwsh -ErrorAction SilentlyContinue |
    Select-Object Id,ProcessName,MainWindowTitle,MainWindowHandle,Path

if ($null -eq $processes) {
    Write-Host "No PowerShell processes found!" -ForegroundColor Red
    exit
}

Write-Host "Found $($processes.Count) PowerShell process(es):" -ForegroundColor Green
Write-Host ""

$terminalCount = 0

foreach ($proc in $processes) {
    $terminalCount++

    Write-Host "[$terminalCount] PowerShell Process" -ForegroundColor Yellow
    Write-Host "  PID: $($proc.Id)"
    Write-Host "  Process Name: $($proc.ProcessName)"
    Write-Host "  Executable Path: $($proc.Path)"

    # Window information
    $hasWindowTitle = ![string]::IsNullOrWhiteSpace($proc.MainWindowTitle)
    $hasWindowHandle = $proc.MainWindowHandle -ne 0

    # Check if Windows Terminal child
    $isWTChild = $false
    if ($parentProc -and ($parentProc.ProcessName -eq 'WindowsTerminal' -or $parentProc.ProcessName -eq 'wt')) {
        $isWTChild = $true
    }

    # Check if has active command
    # Check BOTH parent command line AND the process's own command line
    $hasActiveCommand = $false
    $ownCmdLine = ""
    $parentCmdLine = ""

    # Get the process's own command line
    if ($parentInfo -and $parentInfo.CommandLine) {
        $ownCmdLine = $parentInfo.CommandLine.ToLower()
        # Debug: Show what we're checking
        Write-Host "  DEBUG: Own command line: $ownCmdLine" -ForegroundColor Gray
        if ($ownCmdLine.Contains('npm run') -or $ownCmdLine.Contains('node ')) {
            $hasActiveCommand = $true
            Write-Host "  DEBUG: Detected active command in own command line!" -ForegroundColor Green
        }
    }

    # Also check parent's command line
    if (!$hasActiveCommand -and $parentInfo -and $parentInfo.ParentProcessId) {
        $parentWMI = Get-WmiObject Win32_Process -Filter "ProcessId = $($parentInfo.ParentProcessId)" -ErrorAction SilentlyContinue
        if ($parentWMI) {
            $parentCmdLine = $parentWMI.CommandLine
            $parentCmdLower = $parentCmdLine.ToLower()
            if ($parentCmdLower.Contains('npm run') -or $parentCmdLower.Contains('node ')) {
                $hasActiveCommand = $true
            }
        }
    }

    # Also check if has child processes
    if (!$hasActiveCommand -and $childProcs -and $childProcs.Count -gt 0) {
        $hasActiveCommand = $true
    }

    # Combined check (matches new terminal-capture.ts logic)
    $hasVisibleWindow = $hasWindowTitle -or $hasWindowHandle -or $isWTChild -or $hasActiveCommand

    Write-Host "  Window Title: " -NoNewline
    if ($hasWindowTitle) {
        Write-Host "$($proc.MainWindowTitle)" -ForegroundColor Green
    } else {
        Write-Host "(none)" -ForegroundColor Red
    }

    Write-Host "  Window Handle: " -NoNewline
    if ($hasWindowHandle) {
        Write-Host "$($proc.MainWindowHandle)" -ForegroundColor Green
    } else {
        Write-Host "0 (no visible window)" -ForegroundColor Red
    }

    # Parent process information
    $parentInfo = Get-WmiObject Win32_Process -Filter "ProcessId = $($proc.Id)" -ErrorAction SilentlyContinue
    if ($parentInfo) {
        $parentId = $parentInfo.ParentProcessId
        $parentProc = Get-Process -Id $parentId -ErrorAction SilentlyContinue

        Write-Host "  Parent PID: $parentId"
        Write-Host "  Parent Name: " -NoNewline
        if ($parentProc) {
            Write-Host "$($parentProc.ProcessName)" -ForegroundColor Cyan
        } else {
            Write-Host "(unknown)" -ForegroundColor Gray
        }

        $cmdLine = $parentInfo.CommandLine
        if ($cmdLine -and $cmdLine.Length -gt 100) {
            $cmdLine = $cmdLine.Substring(0, 100) + "..."
        }
        Write-Host "  Parent Command: $cmdLine" -ForegroundColor Gray
    }

    # Working directory
    $childProcs = Get-WmiObject Win32_Process -Filter "ParentProcessId = $($proc.Id)" -ErrorAction SilentlyContinue
    if ($childProcs) {
        $cwdProc = $childProcs | Where-Object { $_.CommandLine -match 'cwd=' } | Select-Object -First 1
        if ($cwdProc -and $cwdProc.CommandLine -match 'cwd=([^;]+)') {
            Write-Host "  Working Directory: $($matches[1])"
        }
    }

    # Filtering analysis
    Write-Host ""
    Write-Host "  FILTERING ANALYSIS:" -ForegroundColor Magenta

    # Check 1: Visible window (with breakdown)
    if ($hasWindowTitle) {
        Write-Host "    + PASS: Has window title" -ForegroundColor Green
    } elseif ($hasWindowHandle) {
        Write-Host "    + PASS: Has window handle" -ForegroundColor Green
    } elseif ($isWTChild) {
        Write-Host "    + PASS: Windows Terminal child (visible tab)" -ForegroundColor Green
    } elseif ($hasActiveCommand) {
        Write-Host "    + PASS: Has active command/processes" -ForegroundColor Green
    } else {
        Write-Host "    X FILTERED: No visible window" -ForegroundColor Red
    }

    # Check 2: IDE parent
    $isIdeChild = $false
    if ($parentProc) {
        $ideNames = @('cursor', 'code', 'vscode', 'atom', 'sublime', 'webstorm', 'intellij', 'windsurf')
        $parentNameLower = $parentProc.ProcessName.ToLower()
        $parentCmdLower = if ($parentInfo.CommandLine) { $parentInfo.CommandLine.ToLower() } else { "" }

        foreach ($ide in $ideNames) {
            if ($parentNameLower.Contains($ide) -or $parentCmdLower.Contains($ide)) {
                $isIdeChild = $true
                break
            }
        }

        if ($isIdeChild) {
            Write-Host "    X FILTERED: Parent is IDE ($($parentProc.ProcessName))" -ForegroundColor Red
        } else {
            Write-Host "    + PASS: Not an IDE child" -ForegroundColor Green
        }
    } else {
        Write-Host "    + PASS: No parent or unknown" -ForegroundColor Green
    }

    # Check 3: FlowState self-capture
    $childProcessNames = $childProcs | Select-Object -ExpandProperty Name
    $hasFlowStateApp = $false
    if ($childProcessNames) {
        foreach ($childName in $childProcessNames) {
            if ($childName -like "*flowstate*" -and $childName -notlike "*node*" -and $childName -notlike "*npm*") {
                $hasFlowStateApp = $true
                break
            }
        }
    }

    if ($hasFlowStateApp) {
        Write-Host "    X FILTERED: Running FlowState" -ForegroundColor Red
    } else {
        Write-Host "    + PASS: Not running FlowState" -ForegroundColor Green
    }

    # Final verdict
    $wouldBeDetected = $hasVisibleWindow -and !$isIdeChild -and !$hasFlowStateApp
    Write-Host ""
    if ($wouldBeDetected) {
        Write-Host "  SHOULD BE DETECTED" -ForegroundColor Green -BackgroundColor DarkGreen
    } else {
        Write-Host "  WILL BE FILTERED OUT" -ForegroundColor White -BackgroundColor Red
    }

    Write-Host ""
    Write-Host "----------------------------------------"
    Write-Host ""
}

Write-Host ""
Write-Host "========================================"
Write-Host "SUMMARY"
Write-Host "========================================"
Write-Host "Total PowerShell processes: $terminalCount"
Write-Host ""
Write-Host "Common filter reasons:"
Write-Host "  1. No visible window (handle=0, no title)"
Write-Host "  2. Child of IDE (VS Code, Cursor, etc)"
Write-Host "  3. Running FlowState itself"
Write-Host ""
