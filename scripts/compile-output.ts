import { build } from "esbuild";

const outputs = [process.argv[2]];

build({
  entryPoints: outputs,
  bundle: true,
  outdir: "dist",
  platform: "node",
  minifySyntax: false,
  minifyWhitespace: true,
  minifyIdentifiers: true,
});
