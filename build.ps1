If (Test-Path bin) {
    Remove-Item -Recurse -Force bin
}
If (Test-Path types) {
    Remove-Item -Recurse -Force types
}
If (Test-Path dist) {
    Remove-Item -Recurse -Force dist
}
haxe build.hxml
Remove-Item -Recurse -Force bin