import fs from "node:fs";
import path from "node:path";

import { TemplateRegisterer } from "./mcl/TemplateRegisterer";
import { Compiler, VariableMap } from "./mcl/Compiler";
import { Parser } from "./mcl/Parser";
import { Tokenizer } from "./mcl/TokenizerImpl";
import type { AstNode } from "./mcl/AstNode";
import type { IoLike, UserConfig } from "./mcl/Config";
import type { LibStore } from "./mcl/LibStore";
import { SyncIo } from "./mcb/io/SyncIo";
import { ThreadedIo } from "./mcb/io/ThreadedIo";
import { MultiThreadIo } from "./mcb/io/MultiThreadIo";

export type CompileOptions = Record<string, never>;

function normalizeExtension(filePath: string): string {
  const ext = path.extname(filePath);
  if (!ext) {
    return "";
  }
  return ext.startsWith(".") ? ext.substring(1) : ext;
}

export function main(): void {
  TemplateRegisterer.register();
}

export function createCompiler(baseDir: string, config: UserConfig, libStore?: LibStore | null): Compiler {
  return new Compiler(baseDir, config, libStore ?? null);
}

export function parseFile(filePath: string, content: string): AstNode[] {
  const ext = normalizeExtension(filePath);
  const tokens = Tokenizer.tokenize(content, filePath);
  if (ext === "mcb") {
    return Parser.parseMcbFile(tokens);
  }
  if (ext === "mcbt") {
    return Parser.parseMcbtFile(tokens);
  }
  throw new Error(`Unknown file extension: ${ext || "<none>"}`);
}

export function addFileToCompiler(compiler: Compiler, filePath: string): void {
  const ext = normalizeExtension(filePath);
  if (ext !== "mcb" && ext !== "mcbt") {
    throw new Error(`Unsupported file extension: ${ext || "<none>"}`);
  }
  const content = fs.readFileSync(filePath, "utf8");
  const tokens = Tokenizer.tokenize(content, filePath);
  const ast = ext === "mcb" ? Parser.parseMcbFile(tokens) : Parser.parseMcbtFile(tokens);
  compiler.addFile(filePath, ast);
}

export function compileFromFsLikeMap(baseDir: string, files: Map<string, string>, io: IoLike): void {
  const compiler = createCompiler(baseDir, {}, null);
  for (const [filePath, content] of files.entries()) {
    const ext = normalizeExtension(filePath);
    if (ext !== "mcb" && ext !== "mcbt") {
      throw new Error(`Unsupported file extension: ${ext || "<none>"}`);
    }
    const tokens = Tokenizer.tokenize(content, filePath);
    const ast = ext === "mcb" ? Parser.parseMcbFile(tokens) : Parser.parseMcbtFile(tokens);
    compiler.addFile(filePath, ast);
  }
  compiler.io = io;
  compiler.compile(VariableMap.globals.fork());
}

export function createIoProvider(threadCount: number): IoLike {
  if (threadCount <= 0) {
    return new SyncIo();
  }
  if (threadCount === 1) {
    return new ThreadedIo();
  }
  return new MultiThreadIo(threadCount);
}

export const mcb = {
  main,
  createCompiler,
  parseFile,
  addFileToCompiler,
  compileFromFsLikeMap,
  createIoProvider,
};

export default mcb;
