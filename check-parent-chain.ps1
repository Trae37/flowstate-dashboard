# Check full parent chain for specific PIDs

function Get-ParentChain {
    param($ProcessId)

    Write-Host "Parent chain for PID ${ProcessId}:" -ForegroundColor Yellow

    $currentPid = $ProcessId
    $depth = 0
    $maxDepth = 10

    while ($currentPid -and $depth -lt $maxDepth) {
        $proc = Get-WmiObject Win32_Process -Filter "ProcessId = $currentPid" -ErrorAction SilentlyContinue

        if (!$proc) {
            Write-Host "  [$depth] PID $currentPid - PROCESS NOT FOUND (dead)" -ForegroundColor Red
            break
        }

        $procInfo = Get-Process -Id $currentPid -ErrorAction SilentlyContinue
        $name = if ($procInfo) { $procInfo.ProcessName } else { "unknown" }

        Write-Host "  [$depth] PID $currentPid - $name" -ForegroundColor Green

        $currentPid = $proc.ParentProcessId
        $depth++
    }

    Write-Host ""
}

# Check the two electron terminal PIDs
Get-ParentChain -ProcessId 20124
Get-ParentChain -ProcessId 44264

# Also check a known working Windows Terminal tab for comparison
Write-Host "For comparison, checking PID 26972 (known Windows Terminal tab):" -ForegroundColor Cyan
Get-ParentChain -ProcessId 26972
