import type { ReferenceCategory } from "./cards";

export interface KeywordEntry {
  keyword: string;
  path: string;
  basename: string;
  category?: ReferenceCategory;
  line?: number;
  heading?: string;
}

const KEYWORD_KEYS = new Set([
  "novel-keywords",
  "keywords",
  "keyword",
  "关键词",
  "关键词列表",
  "别名",
  "aliases",
]);

export function parseNovelKeywords(
  frontmatter: Record<string, unknown> | undefined,
): string[] {
  if (!frontmatter) {
    return [];
  }

  const keywords: string[] = [];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (!KEYWORD_KEYS.has(key.toLowerCase())) {
      continue;
    }

    for (const item of flatten(value)) {
      for (const part of item.split(/[,，、;；\n]/u)) {
        const keyword = part.trim();
        if (keyword && !keywords.includes(keyword)) {
          keywords.push(keyword);
        }
      }
    }
  }

  return keywords;
}

export function buildKeywordEntries(
  sources: Array<{
    path: string;
    basename: string;
    keywords: string[];
    category?: ReferenceCategory;
    line?: number;
    heading?: string;
  }>,
): KeywordEntry[] {
  const entries: KeywordEntry[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    for (const keyword of source.keywords) {
      const normalized = normalizeKeyword(keyword);
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      entries.push({
        keyword,
        path: source.path,
        basename: source.basename,
        category: source.category,
        line: source.line,
        heading: source.heading,
      });
    }
  }

  return entries.sort((left, right) => right.keyword.length - left.keyword.length);
}

export interface KeywordMatch {
  start: number;
  end: number;
  entry: KeywordEntry;
}

export function findKeywordMatches(
  text: string,
  entries: KeywordEntry[],
): KeywordMatch[] {
  if (!text || entries.length === 0) {
    return [];
  }

  const byNormalized = new Map<string, KeywordEntry>();
  for (const entry of entries) {
    byNormalized.set(normalizeKeyword(entry.keyword), entry);
  }

  const pattern = entries
    .map((entry) => escapeRegExp(entry.keyword))
    .join("|");
  if (!pattern) {
    return [];
  }

  const regex = new RegExp(pattern, "giu");
  const matches: KeywordMatch[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const entry = byNormalized.get(normalizeKeyword(match[0]));
    if (entry) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        entry,
      });
    }
    if (match[0].length === 0) {
      regex.lastIndex += 1;
    }
  }

  return matches;
}

export function normalizeKeyword(keyword: string): string {
  return keyword.trim().toLocaleLowerCase();
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function flatten(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => flatten(item));
  }
  return [];
}
