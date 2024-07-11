#!/usr/bin/env bash

buildType=$1

function SetNOPUBLISH {
    value=$1
    export NOPUBLISH=$value
}

if [ -d "bin" ]; then
    rm -rf bin
fi

if [ -d "types" ]; then
    rm -rf types
fi

if [ -d "dist" ]; then
    rm -rf dist
fi

if [ "$buildType" == "cli" ]; then
    echo "Building CLI"
    haxe hxml/only/cli.hxml
elif [ "$buildType" == "testbed" ]; then
    echo "Building Testbed"
    haxe hxml/only/testbed.hxml
elif [ "$buildType" == "lib" ]; then
    echo "Building Lib"
    haxe hxml/only/lib.hxml
else
    echo "Building All"
    haxe hxml/build.hxml
fi

if [ -d "bin" ]; then
    rm -rf bin
fi

cp -r mcblib-src dist/.mcblib

cp -r template dist/template

mkdir -p dist/.venv
cp -r venv-scripts dist/.venv/scripts