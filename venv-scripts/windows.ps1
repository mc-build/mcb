
. { function prompt {
        'PS [mc-build@' + $env:MCBVERSION + '] ' + $(Get-Location) +
        $(if ($NestedPromptLevel -ge 1) { '>>' }) + '> '
        # add a entry to the start of the PATH variable
    } 
    $env:PATH = "$env:MCBPATH;$env:PATH"
}
