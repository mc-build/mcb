#!/usr/bin/env bash

buildType=$1
echo "Building for $buildType"
if [ ! -d ".haxelib" ]; then
    echo "Haxelib not found, installing haxelib"
    haxelib setup .haxelib
    yarn install
    yarn setup
    # itterate folders in overrides non-recursively
    for folder in overrides/*; do
        if [ -d "$folder" ]; then
            echo "patching $folder"
            folder=${folder#overrides/}
            cp -r overrides/$folder/* ./.haxelib/$folder/*
        fi
    done
fi

if [ -d "bin" ]; then
    rm -rf bin
fi

if [ "$buildType" == "cli" ] || [ "$buildType" == "testbed" ] || [ "$buildType" == "lib" ]; then
    haxe hxml/only/$buildType.hxml
else
    haxe hxml/build.hxml
fi

cp -r mcblib-src dist/.mcblib

cp -r template dist/template

mkdir -p dist/.venv
cp -r venv-scripts dist/.venv/scripts

# check if test-pack does not exist
if [ ! -d "dev-pack" ]; then
    {
        node ./dist/mcb.js create dev-pack
    } || {
        echo "Failed to create dev-pack"
    }
fi
echo "Build complete"
echo "building dev-pack"
CWD=$(pwd)
{
    cd dev-pack
    node ../dist/mcb.js build
}
echo "Running tests"
cd $CWD
node ./dist-testbed/testbed.js > testresults.log
{
    grep FAIL testresults.log
} || {
    echo "All tests passed"
}