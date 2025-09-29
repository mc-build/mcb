#!/usr/bin/env node

import { Cli } from './mcb/cli';

// Main entry point for the CLI application
if (require.main === module) {
  Cli.main();
}