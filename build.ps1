$buildType = $args[0]
function SetNOPUBLISH {
    param (
        [bool]$value
    )
    $env:NOPUBLISH = $value
}
If (Test-Path bin) {
    Remove-Item -Recurse -Force bin
}
If (Test-Path types) {
    Remove-Item -Recurse -Force types
}
If (Test-Path dist) {
    Remove-Item -Recurse -Force dist
}

If ($buildType -eq "cli") {
    Write-Output "Building CLI"
    haxe hxml/only/cli.hxml
}
ElseIf ($buildType -eq "testbed") {
    Write-Output "Building Testbed"
    haxe hxml/only/testbed.hxml
}
ElseIf ($buildType -eq "lib") {
    Write-Output "Building Lib"
    haxe hxml/only/lib.hxml
}
Else {
    Write-Output "Building All"
    haxe hxml/build.hxml
}

if (Test-Path bin) {
    Remove-Item -Recurse -Force bin
}

Copy-Item -Recurse mcblib-src dist/.mcblib

Copy-Item -Recurse template dist/template

Copy-Item -Recurse venv-scripts dist/.venv/scripts