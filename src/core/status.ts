import { findFrontmatterEnd } from "./paragraphs";

/** Count non-whitespace characters in the body, excluding frontmatter. */
export function countNovelCharacters(content: string): number {
  const source = content.charCodeAt(0) === 0xfeff
    ? content.slice(1)
    : content;
  const lines = source.split(/\r?\n/u);
  const frontmatterEnd = findFrontmatterEnd(
    (index) => lines[index] ?? null,
    lines.length,
  );
  const body = lines.slice(frontmatterEnd).join("\n");
  let count = 0;

  for (const character of body) {
    if (!/\s/u.test(character)) {
      count += 1;
    }
  }

  return count;
}
