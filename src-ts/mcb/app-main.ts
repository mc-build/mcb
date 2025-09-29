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