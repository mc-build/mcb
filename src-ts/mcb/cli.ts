import * as path from 'path';
import { Command } from 'commander';
import { AppMain } from './app-main';
import { Venv } from './venv/venv';

export interface BuildOpts {
  watch: boolean;
  baseDir: string;
  libDir: string;
  configPath: string;
}

export class Cli {
  public libPath: string;
  public baseDir: string;
  public configPath: string;
  public ioThreadCount: number = 0;
  private didRun: boolean = false;

  constructor() {
    this.libPath = path.join(path.dirname(process.argv[0]), './.mcblib');
    this.baseDir = process.cwd();
    this.configPath = path.join(this.baseDir, './mcb.config');
  }

  public create(packName: string): void {
    this.didRun = true;
    AppMain.create(packName);
  }

  public build(): void {
    this.didRun = true;
    AppMain.doBuild({
      watch: false,
      libDir: this.libPath,
      baseDir: this.baseDir,
      configPath: this.configPath,
    });
  }

  public generate(outfile: string): void {
    this.didRun = true;
    AppMain.generate(outfile, {
      libDir: this.libPath,
      baseDir: this.baseDir,
      configPath: this.configPath,
    });
  }

  public help(): void {
    console.log('MCB - A Minecraft Data Pack build tool.');
    console.log('');
    console.log('Usage:');
    console.log('mcb build');
    console.log('mcb watch');
    console.log('mcb create <pack-name>');
    console.log('mcb venv setup <name>');
    console.log('mcb venv activate');
    console.log('mcb generate');
    console.log('');
    process.exit(0);
  }

  public runDefault(mode?: string, venvAction?: string, venvName?: string): void {
    if (this.didRun) return;
    
    switch (mode) {
      case 'build':
        this.build();
        break;
      case 'watch':
        this.watch();
        break;
      case 'venv':
        switch (venvAction) {
          case 'setup':
            Venv.create(venvName);
            break;
          case 'activate':
            Venv.activate();
            break;
        }
        break;
      case 'generate':
        this.generate(venvAction || '');
        break;
      case 'create':
        this.create(venvAction || '');
        break;
      default:
        this.help();
    }
  }

  public venv(action?: string, name?: string): void {
    this.didRun = true;
    switch (action) {
      case 'setup':
        Venv.create(name);
        break;
      case 'activate':
        Venv.activate();
        break;
    }
  }

  public watch(): void {
    this.didRun = true;
    AppMain.doBuild({
      watch: true,
      libDir: this.libPath,
      baseDir: this.baseDir,
      configPath: this.configPath,
    });
  }

  public static main(): void {
    const program = new Command();
    const cli = new Cli();

    program
      .name('mcb')
      .description('MCB - A Minecraft Data Pack build tool')
      .version('3.6.7');

    program
      .command('build')
      .description('Build the project')
      .action(() => cli.build());

    program
      .command('watch')
      .description('Watch for changes and rebuild')
      .action(() => cli.watch());

    program
      .command('create <pack-name>')
      .description('Create a new pack')
      .action((packName) => cli.create(packName));

    program
      .command('generate <outfile>')
      .description('Generate output file')
      .action((outfile) => cli.generate(outfile));

    const venvCommand = program
      .command('venv')
      .description('Virtual environment commands');

    venvCommand
      .command('setup <name>')
      .description('Setup virtual environment')
      .action((name) => Venv.create(name));

    venvCommand
      .command('activate')
      .description('Activate virtual environment')
      .action(() => Venv.activate());

    program.parse();
  }

  public init(name: string): void {
    this.didRun = true;
    this.create(name);
  }
}