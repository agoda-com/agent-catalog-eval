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
  // Keep chalk and YAML bundled so the CommonJS CLI can load them.
  noExternal: ["chalk", "yaml"],
  // Bundled YAML uses CommonJS requires for Node built-ins, even in the ESM output.
  banner: (ctx) =>
    ctx.format === "cjs"
      ? { js: "#!/usr/bin/env node" }
      : {
          js: 'import { createRequire as createBundleRequire } from "node:module"; const require = createBundleRequire(import.meta.url);',
        },
});
