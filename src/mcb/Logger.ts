import chalk from "chalk";
import { performance } from "node:perf_hooks";
import { getVersionString } from "./Version";
const prefix = `${chalk.gray("[")}${chalk.greenBright("MCB")} ${chalk.green(getVersionString())}${chalk.gray("] ")}`;

export class Logger {
  static enabled = true;

  static time(message: string): () => void {
    if (!Logger.enabled) {
      return () => undefined;
    }
    const start = performance.now();
    return () => {
      const elapsed = ((performance.now() - start) / 1000).toFixed(2);
      Logger.log(`${message} ${elapsed}s`);
    };
  }

  static log(message: unknown): void {
    if (!Logger.enabled) {
      return;
    }
    console.log(`${prefix}${chalk.white(String(message))}`);
  }

  static error(message: unknown): void {
    if (!Logger.enabled) {
      return;
    }
    console.error(`${prefix}${chalk.redBright(String(message))}`);
  }

  static warn(message: unknown): void {
    if (!Logger.enabled) {
      return;
    }
    console.warn(`${prefix}${chalk.yellow(String(message))}`);
  }
}
