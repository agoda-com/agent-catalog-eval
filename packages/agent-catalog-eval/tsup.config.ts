import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
  },
  format: ["cjs", "esm"],
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: true,
  shims: true,
  // chalk v5 / yaml are ESM-only; bundling them lets the CJS bin actually run.
  noExternal: ["chalk", "yaml"],
  banner: (ctx) =>
    ctx.format === "cjs" ? { js: "#!/usr/bin/env node" } : { js: "" },
});
