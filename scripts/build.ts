import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

type CopyOptions = {
  filter?: (srcPath: string, destPath: string) => boolean | Promise<boolean>;
};

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const templateDir = path.join(rootDir, "template");
const cliEntry = path.join(rootDir, "src", "mcb", "Cli.ts");
const testbedEntry = path.join(rootDir, "src", "testbed", "TestMain.ts");
const libEntry = path.join(rootDir, "src", "libmcb.ts");

async function ensureEmptyDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function copyDir(src: string, dest: string, options: CopyOptions = {}): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true });
  await fs.mkdir(dest, { recursive: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (options.filter) {
      const shouldCopy = await options.filter(srcPath, destPath);
      if (!shouldCopy) {
        continue;
      }
    }

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, options);
    } else if (entry.isSymbolicLink()) {
      const linkTarget = await fs.readlink(srcPath);
      await fs.symlink(linkTarget, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function buildTargets(): Promise<void> {
  await Promise.all([
    build({
      entryPoints: [testbedEntry],
      outfile: path.join(distDir, "testbed.js"),
      bundle: true,
      platform: "node",
      target: "node18",
      format: "cjs",
      sourcemap: true,
      logLevel: "info",
      external: ["esbuild"],
    }),
    build({
      entryPoints: [cliEntry],
      outfile: path.join(distDir, "mcb.js"),
      bundle: true,
      platform: "node",
      target: "node18",
      format: "cjs",
      banner: {
        js: "#!/usr/bin/env node",
      },
      sourcemap: true,
      logLevel: "info",
    }),
    build({
      entryPoints: [libEntry],
      outfile: path.join(distDir, "libmcb.js"),
      bundle: true,
      platform: "node",
      target: "node18",
      format: "esm",
      sourcemap: true,
      logLevel: "info",
    }),
  ]);

  await fs.chmod(path.join(distDir, "mcb.js"), 0o755);
}

async function main(): Promise<void> {
  await ensureEmptyDir(distDir);
  await buildTargets();

  await copyDir(templateDir, path.join(distDir, "template"));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
