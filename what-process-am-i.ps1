# Run this in a terminal to see what process it is
$myPid = $PID
Write-Host "This terminal's Process ID: $myPid" -ForegroundColor Green
Write-Host "Process Name: $((Get-Process -Id $myPid).Name)" -ForegroundColor Green

$parentInfo = Get-WmiObject Win32_Process -Filter "ProcessId = $myPid"
$parentPid = $parentInfo.ParentProcessId
$parentProc = Get-Process -Id $parentPid -ErrorAction SilentlyContinue

Write-Host "Parent Process ID: $parentPid" -ForegroundColor Cyan
Write-Host "Parent Process Name: $($parentProc.Name)" -ForegroundColor Cyan
Write-Host ""
Write-Host "Full command line:" -ForegroundColor Yellow
Write-Host $parentInfo.CommandLine
