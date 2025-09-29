import { LibStore } from './lib-store';

export interface UserConfig {
  // TODO: Define proper config interface when migrating Config.hx
  [key: string]: any;
}

export class Compiler {
  public success: boolean = true;
  public io: any; // TODO: Type this properly when migrating IO

  constructor(
    public baseDir: string,
    public config: UserConfig,
    public libStore?: LibStore
  ) {}

  // TODO: Implement full compiler functionality
  // This is a stub for the TypeScript migration
  public compile(root: any): void {
    throw new Error('Compiler.compile not yet implemented in TypeScript migration');
  }

  public addFile(name: string, ast: any[]): void {
    throw new Error('Compiler.addFile not yet implemented in TypeScript migration');
  }
}