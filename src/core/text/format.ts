import { findFrontmatterEnd } from "./paragraphs";

export interface NovelFormatResult {
  text: string;
  changed: boolean;
  trimmedLines: number;
  removedBlankLines: number;
}

type LineKind = "other" | "list" | "quote" | "table" | "hr";

/**
 * Safe automatic formatting for a novel document:
 * - frontmatter is preserved untouched;
 * - all blank lines are removed except the single blank line inserted before
 *   and after separators, tables, lists, and blockquotes;
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

  const output: Array<{ text: string; kind: LineKind }> = [];
  let inFence = false;
  let trimmedLines = 0;
  let removedBlankLines = 0;
  let previousKind: LineKind = "other";

  for (const line of body) {
    if (inFence) {
      if (line.trim().length === 0) {
        removedBlankLines += 1;
        continue;
      }
      output.push({ text: line, kind: "other" });
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
      output.push({ text: withoutTrailingWhitespace, kind: "other" });
      inFence = true;
      previousKind = "other";
      continue;
    }

    const kind = classifyBlockLine(withoutTrailingWhitespace, previousKind);
    const cleanedLine = kind === "other"
      ? withoutTrailingWhitespace.replace(/^[ \t]+/u, "")
      : withoutTrailingWhitespace;
    if (
      cleanedLine !== withoutTrailingWhitespace
      || withoutTrailingWhitespace !== line
    ) {
      trimmedLines += 1;
    }
    const needsBlockBreak = (
      kind === "hr"
      || previousKind === "hr"
      || (kind !== previousKind && kind !== "other")
      || (kind === "other" && previousKind !== "other")
    );
    if (output.length > 0 && needsBlockBreak) {
      const last = output[output.length - 1];
      if (last.text.trim().length > 0) {
        output.push({ text: "", kind: "other" });
      }
    }
    output.push({ text: cleanedLine, kind });
    previousKind = kind;
  }

  const headText = head.join("\n");
  const bodyText = output.map((entry) => entry.text).join("\n");
  let text = frontmatterEnd > 0
    ? (bodyText ? `${headText}\n${bodyText}` : headText)
    : bodyText;

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

function classifyBlockLine(line: string, previousKind: LineKind): LineKind {
  if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(line)) {
    return "hr";
  }
  if (/^\s*\|.*\|\s*$/u.test(line) || /^\s*\|/u.test(line)) {
    return "table";
  }
  if (/^\s*>/u.test(line)) {
    return "quote";
  }
  if (/^\s*(?:[-*+]|\d+[.)])\s+/u.test(line)) {
    return "list";
  }
  if (previousKind === "list" && /^\s+/u.test(line)) {
    return "list";
  }
  return "other";
}
