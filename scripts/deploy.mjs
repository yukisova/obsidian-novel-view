import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_TARGET =
  "/Users/sora/GitLocal/SoraHub_Obsidian/Sora的知识仓库/.obsidian/plugins/novel-view";
const target = resolve(process.env.NOVELVIEW_PLUGIN_DIR || DEFAULT_TARGET);
const root = resolve(import.meta.dirname, "..");

if (process.env.NOVELVIEW_SKIP_DEPLOY === "1") {
  console.log("Novel View: deploy skipped (NOVELVIEW_SKIP_DEPLOY=1)");
  process.exit(0);
}

const files = ["manifest.json", "main.js", "styles.css"];
for (const file of files) {
  const source = resolve(root, file);
  if (!existsSync(source)) {
    console.error(`Novel View: missing build artifact ${source}`);
    process.exit(1);
  }
}

mkdirSync(dirname(target), { recursive: true });
mkdirSync(target, { recursive: true });
for (const file of files) {
  copyFileSync(resolve(root, file), resolve(target, file));
}

const manifest = JSON.parse(
  readFileSync(resolve(root, "manifest.json"), "utf8"),
);
console.log(`Novel View: deployed ${manifest.name} ${manifest.version}`);
console.log(`Novel View: target ${target}`);
for (const file of files) {
  const stat = statSync(resolve(target, file));
  console.log(`  ${file} (${stat.size} bytes)`);
}
