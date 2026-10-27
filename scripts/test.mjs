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
      "paragraphs": "src/core/paragraphs.ts",
      "cards": "src/core/cards.ts",
      "search": "src/core/search.ts",
      "format": "src/core/format.ts",
      "novel-setting": "src/core/novel-setting.ts",
      "category-file": "src/core/category-file.ts",
      "outline": "src/core/outline.ts",
      "status": "src/core/status.ts",
      "keywords": "src/core/keywords.ts",
      "settings": "src/settings.ts",
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
