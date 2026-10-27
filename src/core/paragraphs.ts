/**
 * Plain-text paragraph detection for Markdown prose.
 *
 * NovelView deliberately does not reimplement Markdown. It only needs to know
 * which source lines are ordinary prose so it can mark paragraph boundaries for
 * the typography layer. Complex block constructs are treated as "special" and
 * keep Obsidian's native rendering.
 */

export interface LineClassification {
  prose: boolean;
  paragraphStart: boolean;
  paragraphEnd: boolean;
}

const FRONTMATTER_SCAN_LIMIT = 300;

const HEADING = /^#{1,6}(?:[ \t]|$)/;
const BLOCKQUOTE = /^>/;
const LIST_ITEM = /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/;
const FENCE = /^(?:`{3,}|~{3,})/;
const THEMATIC_BREAK = /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const TABLE_ROW = /^\|/;
const HTML_BLOCK = /^</;
const FOOTNOTE_DEFINITION = /^\[\^[^\]]+\]:/;
const OBSIDIAN_COMMENT = /^%%/;
const EMBED_ONLY_LINE = /^!\[/;
const MATH_BLOCK = /^\$\$/;
const INDENTED_CODE = /^(?: {4}|\t)/;

export function isBlankLine(text: string): boolean {
  return text.trim().length === 0;
}

/**
 * Returns true for lines that start a Markdown block where prose indentation
 * and paragraph spacing would look wrong. This is intentionally conservative:
 * if a line is ambiguous, it is treated as prose.
 */
export function isMarkdownSpecialLine(text: string): boolean {
  if (INDENTED_CODE.test(text)) {
    return true;
  }

  const line = text.replace(/^ {0,3}/, "");

  return HEADING.test(line)
    || BLOCKQUOTE.test(line)
    || LIST_ITEM.test(line)
    || FENCE.test(line)
    || THEMATIC_BREAK.test(line)
    || TABLE_ROW.test(line)
    || HTML_BLOCK.test(line)
    || FOOTNOTE_DEFINITION.test(line)
    || OBSIDIAN_COMMENT.test(line)
    || EMBED_ONLY_LINE.test(line)
    || MATH_BLOCK.test(line);
}

export function isProseLine(text: string): boolean {
  return !isBlankLine(text) && !isMarkdownSpecialLine(text);
}

/**
 * Identifies a leading YAML frontmatter block. The callback receives a
 * zero-based line index and returns null once the document is exhausted.
 * Returns the one-based number of the closing frontmatter line, or 0.
 */
export function findFrontmatterEnd(
  getLine: (index: number) => string | null,
  maxLines = FRONTMATTER_SCAN_LIMIT,
): number {
  if (getLine(0)?.trim() !== "---") {
    return 0;
  }

  const lastIndex = Math.min(maxLines, Number.MAX_SAFE_INTEGER);

  for (let index = 1; index < lastIndex; index += 1) {
    const text = getLine(index);
    if (text === null) {
      return 0;
    }

    const trimmed = text.trim();
    if (trimmed === "---" || trimmed === "...") {
      return index + 1;
    }
  }

  return 0;
}

/**
 * Return true when the document contains a YAML frontmatter block at its very
 * beginning. Obsidian exposes "Properties" through this same block.
 */
export function hasFrontmatterBlock(content: string): boolean {
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const lines = text.split(/\r?\n/);

  if ((lines[0] ?? "").trim() !== "---") {
    return false;
  }

  return findFrontmatterEnd(
    (index) => lines[index] ?? null,
    lines.length,
  ) > 0;
}

/**
 * Lines that belong to a Markdown list, blockquote, or callout. Novel mode
 * keeps their native typography and treats the whole run as one block for
 * paragraph spacing.
 */
export function isSpecialBlockLine(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith(">")
    || /^(?:[-*+]|\d+[.)])\s+/u.test(trimmed);
}

/**
 * Classify one line. `previous` and `next` should be null for frontmatter and
 * document edges. Consecutive prose lines form one Markdown paragraph.
 */
export function classifyLine(
  text: string,
  previous: string | null,
  next: string | null,
): LineClassification {
  if (!isProseLine(text)) {
    return {
      prose: false,
      paragraphStart: false,
      paragraphEnd: false,
    };
  }

  return {
    prose: true,
    paragraphStart: previous === null || !isProseLine(previous),
    paragraphEnd: next === null || !isProseLine(next),
  };
}
