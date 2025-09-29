import * as path from 'path';
import * as fs from 'fs';

export interface DebugFile {
  f: string;
  t: any[]; // Token array - will be properly typed when we migrate Tokenizer
  a: any;   // AstNode - will be properly typed when we migrate AstNode
  s: string;
}

export interface BuildOpts {
  watch: boolean;
  baseDir: string;
  libDir: string;
  configPath: string;
}

export class AppMain {
  public static create(packName: string): void {
    // TODO: Implement pack creation logic
    console.log(`Creating pack: ${packName}`);
    throw new Error('AppMain.create not yet implemented in TypeScript migration');
  }

  public static doBuild(opts: BuildOpts): void {
    // TODO: Implement build logic
    console.log(`Building project with options:`, opts);
    throw new Error('AppMain.doBuild not yet implemented in TypeScript migration');
  }

  public static generate(outfile: string, opts: { libDir: string; baseDir: string; configPath: string }): void {
    // TODO: Implement generate logic
    console.log(`Generating ${outfile} with options:`, opts);
    throw new Error('AppMain.generate not yet implemented in TypeScript migration');
  }

  public static loadDebugProject(file: string, outdir: string): void {
    // TODO: Implement debug project loading
    console.log(`Loading debug project from ${file} to ${outdir}`);
    throw new Error('AppMain.loadDebugProject not yet implemented in TypeScript migration');
  }
}