import esbuild from "esbuild";
import { resolve } from "path";
esbuild.build({
  entryPoints: [resolve(__dirname, "../src/ioThread/main.ts")],
  bundle: true,
  platform: "node",
  target: "node14",
  outfile: resolve(__dirname, "../src/resources/generated/io-worker.js"),
  minifyIdentifiers: true,
  minifyWhitespace: true,
  minifySyntax: true,
});
