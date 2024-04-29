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
  // minifyWhitespace: true,
  // minifyIdentifiers: true,
});
