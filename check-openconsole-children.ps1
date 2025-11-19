# Check children of OpenConsole processes

$openConsoleProcesses = @(29968, 53180, 29396)

foreach ($pid in $openConsoleProcesses) {
    Write-Host "Children of OpenConsole PID $pid:" -ForegroundColor Cyan
    $children = Get-WmiObject Win32_Process -Filter "ParentProcessId = $pid" -ErrorAction SilentlyContinue
    if ($children) {
        $children | Select-Object ProcessId,Name | Format-Table -AutoSize
    } else {
        Write-Host "  No children" -ForegroundColor Gray
    }
    Write-Host ""
}
