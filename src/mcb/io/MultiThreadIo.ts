import type { IoLike } from "../../mcl/Config";
import { ThreadedIo } from "./ThreadedIo";

export class MultiThreadIo implements IoLike {
  private readonly threads: ThreadedIo[] = [];
  private idx = 0;
  private readonly mask: number;
  private fileData: Map<string, string> = new Map();

  constructor(count: number) {
    if (!MultiThreadIo.isPowerOfTwo(count)) {
      throw new Error("Thread count must be a power of two");
    }
    this.mask = count - 1;
    for (let i = 0; i < count; i += 1) {
      this.threads.push(new ThreadedIo());
    }
  }

  write(path: string, content: string): void {
    this.threads[this.idx++ & this.mask].write(path, content);
  }

  cleanup(): void {
    for (const thread of this.threads) {
      thread.cleanup();
    }
  }

  finished(): boolean {
    return this.threads.every((thread) => thread.finished());
  }

  reportFilesRemoved(oldFiles: Map<string, string>): string[] {
    const metadata = this.collectMetadata();
    const result: string[] = [];
    for (const file of oldFiles.keys()) {
      if (!metadata.has(file)) {
        result.push(file);
      }
    }
    return result;
  }

  reportFilesAdded(oldFiles: Map<string, string>): string[] {
    const metadata = this.collectMetadata();
    const result: string[] = [];
    for (const file of metadata.keys()) {
      if (!oldFiles.has(file)) {
        result.push(file);
      }
    }
    return result;
  }

  reportFilesChanged(oldFiles: Map<string, string>): string[] {
    const metadata = this.collectMetadata();
    const result: string[] = [];
    for (const [file, hash] of metadata.entries()) {
      if (oldFiles.has(file) && oldFiles.get(file) !== hash) {
        result.push(file);
      }
    }
    return result;
  }

  reportFileMetadata(): Map<string, string> {
    return new Map(this.collectMetadata());
  }

  private collectMetadata(): Map<string, string> {
    const combined = new Map<string, string>();
    for (const thread of this.threads) {
      const metadata = thread.reportFileMetadata();
      for (const [file, hash] of metadata.entries()) {
        combined.set(file, hash);
      }
    }
    this.fileData = combined;
    return combined;
  }

  private static isPowerOfTwo(value: number): boolean {
    return value > 0 && (value & (value - 1)) === 0;
  }
}
