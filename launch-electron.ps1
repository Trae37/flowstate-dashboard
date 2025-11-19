$ErrorActionPreference = "Stop"
$appPath = "C:\Users\Trashard Mays\Desktop\flowstate-dashboard"
Set-Location $appPath
$env:ELECTRON_RUN_AS_NODE = "0"
& ".\node_modules\.bin\electron.cmd" $appPath

