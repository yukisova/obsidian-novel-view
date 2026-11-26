import { compile } from "sass";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const result = compile(resolve(root, "styles.sass"), {
  style: "expanded",
  loadPaths: [root],
});
writeFileSync(resolve(root, "styles.css"), result.css);
console.log(`Novel View: compiled styles.css (${result.css.length} bytes)`);
