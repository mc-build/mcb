#!/usr/bin/env bash

echo "Building TypeScript MCB..."

# Clean dist directory
if [ -d "dist" ]; then
    echo "Cleaning dist directory..."
    rm -rf dist
fi

# Compile TypeScript
echo "Compiling TypeScript..."
yarn tsc

# Make the main script executable
chmod +x dist/main.js

# Copy template directory to distribution
echo "Copying template files..."
cp -r template dist/

# Copy mcblib-src if it exists (for library functionality)
if [ -d "mcblib-src" ]; then
    echo "Copying mcblib-src..."
    cp -r mcblib-src dist/.mcblib
fi

echo "TypeScript build complete!"
echo "Note: This is a partial migration. The following components still need to be migrated:"
echo "- MCL Tokenizer and Parser"
echo "- MCL Compiler core"
echo "- MCL Template system"
echo "- IO system"
echo "- Test suite"