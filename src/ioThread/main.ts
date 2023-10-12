import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { parse } from "node:path";

type Payload = {
  p: string;
  c: string;
}[];
if (isMainThread)
  throw new Error(
    "This module should only be imported from as a worker thread."
  );
if (!parentPort) throw new Error("parentPort is null");
const { enableLog } = workerData;
const logFile = enableLog ? createWriteStream("ioThread.log") : null;
const port = parentPort;
const log = (v: string) => logFile?.write(v + "\n");

const dirs: Map<string, true> = new Map();
function output(path: string, content: string): void {
  log(`[IoThread] ${path} ${content.length}`);
  const parsed = parse(path);
  const dir = parsed.dir;
  log(`ioThread writing ${path} ${content.length} ${dirs.has(dir)}`);
  if (!dirs.has(dir)) {
    mkdirSync(dir, { recursive: true });
    dirs.set(dir, true);
  }
  writeFileSync(path, content);
}
let debounce: NodeJS.Timeout | null = null;
function signalDone() {
  // if (debounce) clearTimeout(debounce);
  // debounce = setTimeout(() => {
  //   debounce = null;
  //   port.postMessage(true);
  // }, 1000);
  port.postMessage(true);
}
port.on("message", function threadedIoMessageHandler(payload: Payload) {
  try {
    log(`ioThread received ${payload.length} requests`);
    payload.map(({ p, c }) => output(p, c));
    signalDone();
  } catch (e) {
    console.error(e);
  }
});

process.on("uncaughtException", (e) => log(e.message + "\n" + e.stack));
log("ioThread started");
log(JSON.stringify(workerData));
