import { build } from "esbuild";

const outputs = [process.argv[2]];
let header = "";
if (process.argv[2] === "bin/mcb.js") {
  header = "#!/usr/bin/env node";
}
build({
  entryPoints: outputs,
  bundle: true,
  outdir: "dist",
  platform: "node",
  minifySyntax: false,
  banner: { js: header },
  // allowOverwrite: true,
  // minify: true,
  // mangleProps: /./,
  // format: outputs[0].includes("lib") ? "esm" : "cjs",
  // minifyWhitespace: true,
  // minifyIdentifiers: true,
});
