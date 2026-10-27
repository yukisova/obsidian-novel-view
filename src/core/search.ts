export const MAX_SEARCH_RESULTS = 2000;
export const MAX_FILE_SEARCH_RESULTS = 500;

export interface SearchOptions {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface SearchUiState extends SearchOptions {
  replacement: string;
}

export interface SearchMatch {
  offset: number;
  length: number;
  line: number;
  column: number;
  before: string;
  matchText: string;
  after: string;
}

export interface SearchFileResult {
  path: string;
  basename: string;
  folderPath: string;
  matches: SearchMatch[];
}

export interface SearchResponse {
  query: string;
  options: SearchOptions;
  folderPath: string;
  files: SearchFileResult[];
  totalMatches: number;
  scannedFiles: number;
  truncated: boolean;
  error?: string;
}

export interface CompiledSearch {
  regex: RegExp | null;
  error: string | null;
}

export interface ReplacementResult {
  text: string;
  count: number;
}

/**
 * Build a global regular expression for a search request. Empty-match
 * expressions are rejected so the result count and replacement count always
 * describe the same set of matches.
 */
export function compileSearchExpression(options: SearchOptions): CompiledSearch {
  if (options.query.length === 0) {
    return { regex: null, error: null };
  }

  let source = options.regex
    ? options.query
    : escapeRegExp(options.query);

  if (options.wholeWord) {
    source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  }

  const flags = `g${options.caseSensitive ? "" : "i"}u`;

  try {
    const regex = new RegExp(source, flags);
    const probe = new RegExp(source, flags.replace("g", ""));
    if (probe.test("")) {
      return { regex: null, error: "查找表达式不能匹配空字符串。" };
    }
    return { regex, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      regex: null,
      error: `正则表达式无效：${message}`,
    };
  }
}

export function findSearchMatches(
  text: string,
  regex: RegExp,
  maxMatches = MAX_FILE_SEARCH_RESULTS,
): { matches: SearchMatch[]; truncated: boolean } {
  const matches: SearchMatch[] = [];
  const lineStarts = buildLineStarts(text);
  regex.lastIndex = 0;

  while (matches.length < maxMatches) {
    const match = regex.exec(text);
    if (!match) {
      break;
    }

    if (match[0].length === 0) {
      if (regex.lastIndex === match.index) {
        regex.lastIndex += 1;
      }
      continue;
    }

    const offset = match.index;
    const lineIndex = findLineIndex(lineStarts, offset);
    const lineStart = lineStarts[lineIndex];
    const lineEnd = lineIndex + 1 < lineStarts.length
      ? lineStarts[lineIndex + 1] - 1
      : text.length;
    const lineText = text.slice(lineStart, lineEnd).replace(/\r$/u, "");
    const startInLine = Math.max(0, offset - lineStart);
    const endInLine = Math.min(lineText.length, startInLine + match[0].length);
    const contextLength = 72;
    const beforeStart = Math.max(0, startInLine - contextLength);
    const afterEnd = Math.min(lineText.length, endInLine + contextLength);

    let before = lineText.slice(beforeStart, startInLine);
    let matchText = lineText.slice(startInLine, endInLine);
    let after = lineText.slice(endInLine, afterEnd);

    if (beforeStart > 0) {
      before = `…${before}`;
    }
    if (endInLine < startInLine + match[0].length) {
      matchText = `${matchText}…`;
    }
    if (afterEnd < lineText.length) {
      after = `${after}…`;
    }

    matches.push({
      offset,
      length: match[0].length,
      line: lineIndex + 1,
      column: startInLine + 1,
      before,
      matchText,
      after,
    });
  }

  let truncated = matches.length >= maxMatches;
  if (truncated) {
    truncated = regex.exec(text) !== null;
  }
  regex.lastIndex = 0;

  return { matches, truncated };
}

export function replaceSearchMatches(
  text: string,
  regex: RegExp,
  replacement: string,
  regexMode: boolean,
): ReplacementResult {
  const count = countMatches(text, regex);
  if (count === 0) {
    return { text, count: 0 };
  }

  regex.lastIndex = 0;
  const replaced = regexMode
    ? text.replace(regex, replacement)
    : text.replace(regex, () => replacement);
  regex.lastIndex = 0;

  return { text: replaced, count };
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countMatches(text: string, regex: RegExp): number {
  let count = 0;
  let match: RegExpExecArray | null;
  regex.lastIndex = 0;

  while ((match = regex.exec(text)) !== null) {
    count += 1;
    if (match[0].length === 0) {
      regex.lastIndex += 1;
    }
  }

  regex.lastIndex = 0;
  return count;
}

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 0x0a) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function findLineIndex(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= offset) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return Math.max(0, high);
}
