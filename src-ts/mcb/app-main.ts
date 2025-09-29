import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';
import * as mustache from 'mustache';
import { Logger } from './logger';

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

interface MinecraftVersion {
  data_pack_version: number;
}

export class AppMain {
  public static async create(packName: string): Promise<void> {
    try {
      Logger.log(`Creating pack: ${packName}`);
      
      const templateDir = path.join(path.dirname(__dirname), '..', 'template');
      const destDir = path.join(process.cwd(), packName);
      
      // Create destination directory
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      
      // Fetch the latest Minecraft version
      Logger.log('Fetching latest Minecraft version...');
      const response = await axios.get<MinecraftVersion>('https://raw.githubusercontent.com/misode/mcmeta/summary/version.json');
      const version = response.data;
      
      // Copy template directory with variable substitution
      const copyDir = (from: string, to: string) => {
        const files = fs.readdirSync(from);
        
        for (const file of files) {
          const fromPath = path.join(from, file);
          const toPath = path.join(to, file);
          
          if (fs.statSync(fromPath).isDirectory()) {
            if (!fs.existsSync(toPath)) {
              fs.mkdirSync(toPath, { recursive: true });
            }
            copyDir(fromPath, toPath);
          } else {
            const content = fs.readFileSync(fromPath, 'utf8');
            // Use mustache-like templating but replace :: with {{ }}
            const processedContent = content
              .replace(/::(\w+)::/g, '{{$1}}');
            
            const renderedContent = mustache.render(processedContent, {
              name: packName || 'MC-Build',
              version: version.data_pack_version
            });
            
            fs.writeFileSync(toPath, renderedContent);
          }
        }
      };
      
      copyDir(templateDir, destDir);
      Logger.log(`Pack '${packName}' created successfully!`);
      
    } catch (error) {
      Logger.error(`Failed to create pack: ${error}`);
      throw error;
    }
  }

  public static doBuild(opts: BuildOpts): void {
    Logger.log(`Starting build at ${new Date().toString()}`);
    Logger.log(`Build options:`, opts);
    
    try {
      // Check if src directory exists
      const srcDir = path.join(opts.baseDir, 'src');
      if (!fs.existsSync(srcDir)) {
        Logger.error(`Source directory not found: ${srcDir}`);
        Logger.log('To create a new pack, run: mcb create <pack-name>');
        return;
      }

      // For now, just log what would happen
      Logger.log(`Source directory: ${srcDir}`);
      Logger.log(`Library directory: ${opts.libDir}`);
      Logger.log(`Config path: ${opts.configPath}`);
      Logger.log(`Watch mode: ${opts.watch}`);
      
      if (opts.watch) {
        Logger.warn('Watch mode not yet implemented in TypeScript migration');
      }
      
      Logger.warn('Full build functionality not yet implemented in TypeScript migration');
      Logger.log('The TypeScript migration is in progress. The following components still need to be migrated:');
      Logger.log('- MCL Tokenizer and Parser');
      Logger.log('- MCL Compiler core');
      Logger.log('- MCL Template system');
      Logger.log('- IO system');
      
    } catch (error) {
      Logger.error(`Build failed: ${error}`);
      throw error;
    }
  }

  public static generate(outfile: string, opts: { libDir: string; baseDir: string; configPath: string }): void {
    Logger.log(`Generating ${outfile}`);
    Logger.log(`Options:`, opts);
    
    if (!fs.existsSync(outfile)) {
      Logger.error(`Output file not found: ${outfile}`);
      return;
    }
    
    Logger.warn('Generate functionality not yet implemented in TypeScript migration');
  }

  public static loadDebugProject(file: string, outdir: string): void {
    // TODO: Implement debug project loading
    console.log(`Loading debug project from ${file} to ${outdir}`);
    throw new Error('AppMain.loadDebugProject not yet implemented in TypeScript migration');
  }
}