import { parentPort } from "node:worker_threads";
import { mkdirSync, writeFileSync } from "node:fs";
import { parse } from "node:path";

type Payload = {
  p: string;
  c: string;
}[];

const dirs: Map<string, true> = new Map();

function output(path: string, content: string): void {
  const parsed = parse(path);
  const dir = parsed.dir;
  if (!dirs.has(dir)) {
    mkdirSync(dir, { recursive: true });
    dirs.set(dir, true);
  }
  writeFileSync(path, content);
}

parentPort!.on("message", function threadedIoMessageHandler(payload: Payload) {
  try {
    payload.map(({ p, c }) => output(p, c));
    parentPort!.postMessage(1);
  } catch (e) {
    console.error(e);
  }
});
