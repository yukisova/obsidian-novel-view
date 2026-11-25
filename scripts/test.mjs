import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import esbuild from "esbuild";

const root = resolve(import.meta.dirname, "..");
const outdir = resolve(root, ".test-build");

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

try {
  await esbuild.build({
    absWorkingDir: root,
    entryPoints: {
      "paragraphs": "src/core/text/paragraphs.ts",
      "search": "src/core/search/search.ts",
      "format": "src/core/text/format.ts",
      "format-utils": "src/core/text/format-utils.ts",
      "txt": "src/core/text/txt.ts",
      "setting-collection": "src/core/model/setting-collection.ts",
      "novel-config": "src/core/model/novel-config.ts",
      "status": "src/core/text/status.ts",
      "chapter-status": "src/core/model/chapter-status.ts",
      "settings": "src/app/settings.ts",
    },
    outdir,
    bundle: true,
    platform: "node",
    format: "esm",
    outExtension: { ".js": ".mjs" },
    target: "node20",
    logLevel: "silent",
  });

  const result = spawnSync(
    process.execPath,
    ["--test", "tests/core.test.mjs"],
    {
      cwd: root,
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(outdir, { recursive: true, force: true });
}
