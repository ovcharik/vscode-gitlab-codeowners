const esbuild = require("esbuild");

// Bundle the test into a single CJS file so imports resolve extensionless,
// same convention as the main extension build.
esbuild
  .build({
    entryPoints: ["test/lint.test.ts"],
    bundle: true,
    outfile: "out/lint.test.js",
    platform: "node",
    target: "node18",
    format: "cjs",
    logLevel: "info",
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
