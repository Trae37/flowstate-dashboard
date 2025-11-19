# Check all child processes of Windows Terminal

$wtProcesses = Get-Process WindowsTerminal -ErrorAction SilentlyContinue

if (!$wtProcesses) {
    Write-Host "No Windows Terminal processes found!" -ForegroundColor Red
    exit
}

Write-Host "Windows Terminal Child Processes:" -ForegroundColor Cyan
Write-Host ""

foreach ($wt in $wtProcesses) {
    Write-Host "Windows Terminal PID: $($wt.Id)" -ForegroundColor Yellow

    $children = Get-WmiObject Win32_Process -Filter "ParentProcessId = $($wt.Id)" -ErrorAction SilentlyContinue

    if ($children) {
        foreach ($child in $children) {
            Write-Host "  Child PID $($child.ProcessId): $($child.Name)" -ForegroundColor Green
            $cmdLine = $child.CommandLine
            if ($cmdLine -and $cmdLine.Length -gt 100) {
                $cmdLine = $cmdLine.Substring(0, 100) + "..."
            }
            Write-Host "    Command: $cmdLine" -ForegroundColor Gray
        }
    } else {
        Write-Host "  No child processes" -ForegroundColor Gray
    }
    Write-Host ""
}

Write-Host "Summary:" -ForegroundColor Cyan
Write-Host "Total Windows Terminal processes: $($wtProcesses.Count)"
if ($children) {
    Write-Host "Total child processes: $(@($children).Count)"
}
