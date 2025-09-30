import path from "node:path";

import type { Compiler, CompilerContext } from "./Compiler";
import { CompilerError } from "./error/CompilerError";

interface TagEntry {
  value: string;
  replace: boolean;
}

interface TagRecord {
  entries: Set<TagEntry>;
  replace: boolean;
}

export class TagManager {
  private readonly tagEntries: Map<string, TagRecord> = new Map();

  ensureTag(tag: string, context: CompilerContext): string {
    const colonIndex = tag.indexOf(":");
    if (colonIndex === -1) {
      tag = `${context.namespace}:${context.path.concat([tag]).join("/")}`;
    } else if (colonIndex !== tag.lastIndexOf(":")) {
      throw CompilerError.create("Invalid tag name: " + tag, null, context);
    }
    if (!this.tagEntries.has(tag)) {
      this.tagEntries.set(tag, {
        entries: new Set<TagEntry>(),
        replace: false,
      });
    }
    return tag;
  }

  addTagEntry(tag: string, entry: string, context: CompilerContext, replace = false): void {
    const ensured = this.ensureTag(tag, context);
    const record = this.tagEntries.get(ensured)!;
    record.entries.add({ value: entry, replace });
  }

  setTagReplace(tag: string, context: CompilerContext, replace: boolean): void {
    const ensured = this.ensureTag(tag, context);
    const record = this.tagEntries.get(ensured)!;
    record.replace = replace;
  }

  writeTagFiles(compiler: Compiler): void {
    for (const [key, record] of this.tagEntries.entries()) {
      const segments = key.split(":");
      if (segments.length !== 2) {
        continue;
      }
      const namespace = segments[0];
      const tag = segments[1];
      const tagPath = path.join(
        "data",
        namespace,
        "tags",
        compiler.config.features.useFolderRenames48 ? "function" : "functions",
        `${tag}.json`
      );
      const values = Array.from(record.entries).map((entry) => entry.value);
  const payload: { values: string[]; replace?: true } = { values };
      if (record.replace) {
        payload.replace = true;
      }
      compiler.io.write(tagPath, JSON.stringify(payload));
    }
  }
}
