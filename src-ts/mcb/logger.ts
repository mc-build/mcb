import chalk from 'chalk';

export class Logger {
  public static enabled: boolean = true;
  public static chalk = chalk;

  public static time(message: string): () => void {
    if (!Logger.enabled) {
      return () => {};
    }
    const start = Date.now();
    return function() {
      const end = Date.now();
      Logger.log(message.replace('${end - start}', ((end - start) / 1000).toFixed(2)));
    };
  }

  public static prefix = chalk.gray('[') + chalk.green('MCB') + chalk.gray('] ');

  public static log(...args: any[]): void {
    if (Logger.enabled) {
      console.log(Logger.prefix + chalk.white(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ')));
    }
  }

  public static error(...args: any[]): void {
    if (Logger.enabled) {
      console.log(Logger.prefix + chalk.redBright(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ')));
    }
  }

  public static warn(...args: any[]): void {
    if (Logger.enabled) {
      console.log(Logger.prefix + chalk.yellow(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ')));
    }
  }
}