import { findFrontmatterEnd } from "./paragraphs";

export interface NovelFormatResult {
  text: string;
  changed: boolean;
  trimmedLines: number;
  removedBlankLines: number;
}

/**
 * Automatic formatting for a novel document:
 * - frontmatter is preserved untouched;
 * - all blank lines outside frontmatter are removed, including inside fences;
 * - trailing spaces/tabs are removed outside fenced code;
 * - no paragraph indentation or punctuation is changed.
 */
export function formatNovelMarkdown(content: string): NovelFormatResult {
  const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
  const source = bom ? content.slice(1) : content;
  const endedWithNewline = /\r?\n$/u.test(source);
  const lines = source.split(/\r?\n/u);
  const frontmatterEnd = findFrontmatterEnd(
    (index) => lines[index] ?? null,
    lines.length,
  );
  const head = lines.slice(0, frontmatterEnd);
  const body = lines.slice(frontmatterEnd);

  const output: string[] = [];
  let inFence = false;
  let trimmedLines = 0;
  let removedBlankLines = 0;

  for (const line of body) {
    if (inFence) {
      if (line.trim().length === 0) {
        removedBlankLines += 1;
        continue;
      }
      output.push(line);
      if (/^\s*(```|~~~)\s*$/u.test(line)) {
        inFence = false;
      }
      continue;
    }

    const withoutTrailingWhitespace = line.replace(/[ \t]+$/u, "");
    if (withoutTrailingWhitespace.trim().length === 0) {
      removedBlankLines += 1;
      continue;
    }

    if (/^\s*(```|~~~)/u.test(withoutTrailingWhitespace)) {
      if (withoutTrailingWhitespace !== line) {
        trimmedLines += 1;
      }
      output.push(withoutTrailingWhitespace);
      inFence = true;
      continue;
    }

    if (withoutTrailingWhitespace !== line) {
      trimmedLines += 1;
    }
    output.push(withoutTrailingWhitespace);
  }

  const headText = head.join("\n");
  const bodyText = output.join("\n");
  let text: string;
  if (frontmatterEnd > 0) {
    text = bodyText ? `${headText}\n${bodyText}` : headText;
  } else {
    text = bodyText;
  }

  if (endedWithNewline && text.length > 0 && !text.endsWith("\n")) {
    text += "\n";
  }

  text = `${bom}${text}`;

  return {
    text,
    changed: text !== content,
    trimmedLines,
    removedBlankLines,
  };
}
