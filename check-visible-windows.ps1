# Check which PowerShell processes have actual visible windows

Write-Host "Checking for PowerShell processes with visible windows..." -ForegroundColor Cyan
Write-Host ""

Add-Type @"
    using System;
    using System.Runtime.InteropServices;
    public class Win32 {
        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool IsWindowVisible(IntPtr hWnd);
    }
"@

$processes = Get-Process powershell,pwsh -ErrorAction SilentlyContinue

foreach ($proc in $processes) {
    $hwnd = $proc.MainWindowHandle
    $isVisible = $false

    if ($hwnd -ne 0) {
        $isVisible = [Win32]::IsWindowVisible($hwnd)
    }

    $parentInfo = Get-WmiObject Win32_Process -Filter "ProcessId = $($proc.Id)" -ErrorAction SilentlyContinue
    $parentId = $parentInfo.ParentProcessId
    $parentProc = Get-Process -Id $parentId -ErrorAction SilentlyContinue
    $parentName = if ($parentProc) { $parentProc.ProcessName } else { "(dead/unknown)" }

    # Check if Cursor integration
    $isCursor = $parentInfo.CommandLine -and $parentInfo.CommandLine.ToLower().Contains('cursor') -and
                $parentInfo.CommandLine.ToLower().Contains('shellintegration')

    if (!$isCursor) {
        Write-Host "PID $($proc.Id):" -ForegroundColor Yellow
        Write-Host "  Window Handle: $hwnd"
        Write-Host "  Is Visible: " -NoNewline
        if ($isVisible) {
            Write-Host "YES (has actual visible window)" -ForegroundColor Green
        } else {
            Write-Host "NO (not visible)" -ForegroundColor Red
        }
        Write-Host "  Parent: $parentName"
        Write-Host "  Title: $($proc.MainWindowTitle)"
        Write-Host ""
    }
}
