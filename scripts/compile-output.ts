import { build } from "esbuild";

const outputs = [process.argv[2]];
console.log("compiling:", outputs);
let header = "";
if (process.argv[2] === "bin/mcb.js") {
  header = "#!/usr/bin/env node";
}
let outdir = "dist";
if (process.argv[2] === "bin/testbed.js") {
  outdir = "dist-testbed";
}
build({
  entryPoints: outputs,
  bundle: true,
  outdir,
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
