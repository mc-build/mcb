import fs from "node:fs";
import path from "node:path";

import { Compiler, McFile } from "./Compiler";
import { Parser } from "./Parser";
import { Tokenizer } from "./TokenizerImpl";
import { LibraryError } from "./error/LibraryError";
import { ErrorUtil } from "./error/CompilerError";
import type { PosInfo } from "./Tokenizer";

export class LibStore {
  private readonly loadedLibs = new Map<string, Map<string, McFile>>();

  constructor(private readonly dir: string) {}

  lookup(id: string, pos: PosInfo, compiler: Compiler): McFile {
    const cached = this.loadedLibs.get(id);
    if (cached) {
      const entry = cached.get(`mcblib/${id}.mcbt`);
      if (entry) {
        return entry;
      }
    }

    const libraryPath = path.join(this.dir, id);
    if (!fs.existsSync(libraryPath)) {
      throw new LibraryError(ErrorUtil.format(`Library not found: ${id}`, pos));
    }

    return this.loadLib(id, libraryPath, compiler, pos);
  }

  private loadLib(id: string, libraryPath: string, compiler: Compiler, pos: PosInfo): McFile {
    const baseDir = path.join(libraryPath, "src", "mcblib");
    const srcDir = path.join(libraryPath, "src");

    if (!fs.existsSync(baseDir)) {
      throw new LibraryError(`Library ${id} does not have a src/mcblib folder`);
    }

  const files = this.getFilesInDirectory(baseDir);
  const result = new Map<string, McFile>();

    for (const file of files) {
      const ext = path.extname(file);
      if (ext !== ".mcb" && ext !== ".mcbt") {
        continue;
      }

      const content = fs.readFileSync(file, "utf8");
      const tokens = Tokenizer.tokenize(content, file);
      const ast = ext === ".mcb" ? Parser.parseMcbFile(tokens) : Parser.parseMcbtFile(tokens);
  const mcFile = new McFile(file, ast);
  mcFile.setup(compiler);
  const relativePath = Compiler.normalizeProjectPath(path.relative(srcDir, file));
  mcFile.name = relativePath;
  result.set(relativePath, mcFile);
    }

    this.loadedLibs.set(id, result);
    const entry = result.get(`mcblib/${id}.mcbt`);
    if (!entry) {
      throw new LibraryError(ErrorUtil.format(`Library entry not found: ${id}`, pos));
    }
    return entry;
  }

  private getFilesInDirectory(dir: string): string[] {
    const contents = fs.readdirSync(dir, { withFileTypes: true });
    const result: string[] = [];
    for (const entry of contents) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        result.push(...this.getFilesInDirectory(fullPath));
      } else {
        result.push(fullPath);
      }
    }
    return result;
  }
}
