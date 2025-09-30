import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";

import type { IoLike } from "../../mcl/Config";

type IoEntry = {
  p: string;
  c: string;
};

const WORKER_SOURCE = `
const { parentPort } = require("node:worker_threads");
const { mkdirSync, writeFileSync } = require("node:fs");
const { parse } = require("node:path");

const dirs = new Map();

function output(filePath, content) {
  const dir = parse(filePath).dir;
  if (!dirs.has(dir)) {
    mkdirSync(dir, { recursive: true });
    dirs.set(dir, true);
  }
  writeFileSync(filePath, content);
}

parentPort.on("message", (payload) => {
  try {
    for (const entry of payload) {
      output(entry.p, entry.c);
    }
    parentPort.postMessage(1);
  } catch (error) {
    console.error(error);
  }
});
`;

export class ThreadedIo implements IoLike {
  private readonly worker: Worker;
  private queue: IoEntry[] = [];
  private pending = false;
  private done = false;
  private terminated = false;
  private readonly fileData: Map<string, string> = new Map();

  constructor() {
    this.worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        enableLog: false,
      },
    });

    this.worker.on("message", () => {
      this.flush();
    });
    this.worker.on("error", (error) => {
      this.terminated = true;
      throw error;
    });
    this.worker.on("exit", () => {
      this.terminated = true;
    });
  }

  write(path: string, content: string): void {
    if (this.done) {
      throw new Error("Cannot write after cleanup()");
    }
    this.fileData.set(path, this.hash(content));
    this.queue.push({ p: path, c: content });
    if (!this.pending) {
      this.flush();
    }
  }

  cleanup(): void {
    this.done = true;
    if (!this.pending) {
      this.flush();
    }
  }

  finished(): boolean {
    return this.terminated;
  }

  reportFilesRemoved(oldFiles: Map<string, string>): string[] {
    const result: string[] = [];
    for (const file of oldFiles.keys()) {
      if (!this.fileData.has(file)) {
        result.push(file);
      }
    }
    return result;
  }

  reportFilesAdded(oldFiles: Map<string, string>): string[] {
    const result: string[] = [];
    for (const file of this.fileData.keys()) {
      if (!oldFiles.has(file)) {
        result.push(file);
      }
    }
    return result;
  }

  reportFilesChanged(oldFiles: Map<string, string>): string[] {
    const result: string[] = [];
    for (const [file, hash] of this.fileData.entries()) {
      if (oldFiles.has(file) && oldFiles.get(file) !== hash) {
        result.push(file);
      }
    }
    return result;
  }

  reportFileMetadata(): Map<string, string> {
    return new Map(this.fileData);
  }

  private flush(): void {
    if (this.queue.length === 0) {
      this.pending = false;
      if (this.done && !this.terminated) {
        void this.worker.terminate();
      }
      return;
    }

    const packet = this.queue;
    this.queue = [];
    this.pending = true;
    this.worker.postMessage(packet);
  }

  private hash(content: string): string {
    return createHash("sha1").update(content, "utf8").digest("hex");
  }
}
