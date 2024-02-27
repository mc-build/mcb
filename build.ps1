$buildType = $args[0]
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
    haxe hxml/build.hxml
}
Else {
    haxe hxml/build.hxml
}
Remove-Item -Recurse -Force bin

Copy-Item -Recurse mcblib-src dist/.mcblib

Copy-Item -Recurse template dist/template

Copy-Item -Recurse venv-scripts dist/.venv/scripts