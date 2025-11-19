# Final check - which PowerShell PIDs would be detected

$targetPIDs = @(20124, 44264, 26972, 48596, 49456)

Write-Host "Checking if your 5 Windows Terminal tabs will be detected:" -ForegroundColor Cyan
Write-Host ""

foreach ($procId in $targetPIDs) {
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if (!$proc) {
        Write-Host "PID $procId - NOT RUNNING" -ForegroundColor Red
        continue
    }

    $wmi = Get-WmiObject Win32_Process -Filter "ProcessId = $procId" -ErrorAction SilentlyContinue
    $parentId = $wmi.ParentProcessId
    $parentProc = Get-Process -Id $parentId -ErrorAction SilentlyContinue
    $parentName = if ($parentProc) { $parentProc.ProcessName } else { "DEAD" }

    $cmdLine = $wmi.CommandLine.ToLower()

    # Check conditions
    $isWindowsTerminalChild = $parentName -eq "WindowsTerminal"
    $hasNpmRun = $cmdLine.Contains("npm run")
    $hasActiveCommand = $hasNpmRun

    $hasWindow = $isWindowsTerminalChild -or $hasActiveCommand

    Write-Host "PID $procId" -ForegroundColor Yellow
    Write-Host "  Parent: $parentName (PID $parentId)"
    Write-Host "  Windows Terminal child: $isWindowsTerminalChild"
    Write-Host "  Has 'npm run': $hasNpmRun"
    Write-Host "  hasActiveCommand: $hasActiveCommand"
    Write-Host "  hasWindow: $hasWindow"

    if ($hasWindow) {
        Write-Host "  RESULT: WILL BE DETECTED" -ForegroundColor Green -BackgroundColor DarkGreen
    } else {
        Write-Host "  RESULT: WILL BE FILTERED" -ForegroundColor Red -BackgroundColor DarkRed
    }

    Write-Host ""
}
