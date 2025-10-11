import path from "node:path";
import process from "node:process";

import { create, doBuild, generate, BuildOpts } from "./AppMain";
import { Logger } from "./Logger";
import { getVersionString } from "./Version";

interface ParsedOptions {
  libDir: string;
  baseDir: string;
  configPath: string;
}

function defaultOptions(): ParsedOptions {
  const programPath = process.argv[1] ? path.resolve(process.argv[1]) : __filename;
  const programDir = path.dirname(programPath);
  const baseDir = process.cwd();
  return {
    libDir: path.join(programDir, ".mcblib"),
    baseDir,
    configPath: path.join(baseDir, "mcb.config"),
  };
}

function resolveOptions(argv: string[]): { options: ParsedOptions; positional: string[] } {
  const options = defaultOptions();
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--lib":
        options.libDir = path.resolve(argv[++i] ?? options.libDir);
        break;
      case "--base":
        options.baseDir = path.resolve(argv[++i] ?? options.baseDir);
        break;
      case "--config":
        options.configPath = path.resolve(argv[++i] ?? options.configPath);
        break;
      case "-h":
      case "--help":
        positional.push("help");
        break;
      case "-v":
      case "--version":
        positional.push("version");
        break;
      default:
        positional.push(arg);
        break;
    }
  }

  return { options, positional };
}

function showHelp(): void {
  Logger.log("MCB - A Minecraft Data Pack build tool.");
  Logger.log("");
  Logger.log("Usage:");
  Logger.log("  mcb build");
  Logger.log("  mcb watch");
  Logger.log("  mcb create <pack-name>");
  Logger.log("  mcb generate <file>");
  Logger.log("");
  Logger.log("Flags:");
  Logger.log("  --lib <path>     Override library directory");
  Logger.log("  --base <path>    Override project base directory");
  Logger.log("  --config <path>  Override config file path");
  Logger.log("  -v, --version    Show version information");
  Logger.log("  -h, --help       Show this help message");
}

function showVersion(): void {
  Logger.log(getVersionString());
}

async function runCommand(command: string | undefined, args: string[], options: ParsedOptions): Promise<void> {
  const buildOptions: BuildOpts = {
    watch: command === "watch",
    baseDir: options.baseDir,
    libDir: options.libDir,
    configPath: options.configPath,
  };

  switch (command) {
    case "build":
      await doBuild({ ...buildOptions, watch: false });
      return;
    case "watch":
      await doBuild(buildOptions);
      return;
    case "create": {
      const name = args[0];
      if (!name) {
        throw new Error("Missing pack name for create command");
      }
      await create(name);
      return;
    }
    case "generate": {
      const outfile = args[0];
      if (!outfile) {
        throw new Error("Missing output file for generate command");
      }
      await generate(outfile, buildOptions);
      return;
    }
    case "version":
      showVersion();
      return;
    case "help":
    case undefined:
      showHelp();
      return;
    default:
      Logger.error(`Unknown command: ${command}`);
      showHelp();
  }
}

export async function run(argv = process.argv.slice(2)): Promise<void> {
  const { options, positional } = resolveOptions(argv);
  const [command, ...args] = positional;

  try {
    await runCommand(command, args, options);
  } catch (error) {
    Logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  run();
}
