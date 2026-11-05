export const SETTING_COLLECTION_INDEX = "index.json";

export interface SettingCollectionEntry {
  keyword: string;
  content: string;
}

export interface SettingCollectionTag {
  tag: string;
  color: string;
  contain: SettingCollectionEntry[];
}

export type SettingCollectionIndex = Record<string, SettingCollectionTag[]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseSettingCollectionIndex(value: unknown): SettingCollectionIndex {
  const result: SettingCollectionIndex = {};
  if (!isRecord(value)) {
    return result;
  }
  for (const [rawGroup, rawTags] of Object.entries(value)) {
    const group = rawGroup.trim();
    if (!group || !Array.isArray(rawTags)) {
      continue;
    }
    const tags: SettingCollectionTag[] = [];
    for (const rawTag of rawTags) {
      if (!isRecord(rawTag)) {
        continue;
      }
      const tag = typeof rawTag.tag === "string" ? rawTag.tag.trim() : "";
      const colorValue = rawTag.color;
      const color = typeof colorValue === "string" || typeof colorValue === "number"
        ? String(colorValue)
        : "";
      const contain: SettingCollectionEntry[] = [];
      if (Array.isArray(rawTag.contain)) {
        for (const rawEntry of rawTag.contain) {
          if (!isRecord(rawEntry)) {
            continue;
          }
          const keyword = typeof rawEntry.keyword === "string"
            ? rawEntry.keyword.trim()
            : "";
          const content = typeof rawEntry.content === "string"
            ? rawEntry.content.trim()
            : "";
          if (!keyword && !content) {
            continue;
          }
          contain.push({ keyword, content });
        }
      }
      tags.push({ tag, color, contain });
    }
    result[group] = tags;
  }
  return result;
}

export function serializeSettingCollectionIndex(
  index: SettingCollectionIndex,
): string {
  return `${JSON.stringify(index, null, 2)}\n`;
}

export function emptySettingCollectionIndex(): SettingCollectionIndex {
  return {};
}

export function settingGroupFolderName(name: string): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]/gu, "-")
    .replace(/^\.+/u, "")
    || "未命名设定组";
}

export interface SettingKeywordEntry {
  keyword: string;
  content: string;
  group: string;
  tag: string;
  color: string;
}

export interface SettingKeywordMatch {
  start: number;
  end: number;
  entry: SettingKeywordEntry;
}

export function getSettingKeywordEntries(
  index: SettingCollectionIndex,
): SettingKeywordEntry[] {
  const result: SettingKeywordEntry[] = [];
  const seen = new Set<string>();
  for (const [group, tags] of Object.entries(index)) {
    for (const tag of tags) {
      for (const entry of tag.contain) {
        const keyword = entry.keyword.trim();
        if (!keyword) {
          continue;
        }
        const normalized = keyword.toLocaleLowerCase();
        if (seen.has(normalized)) {
          continue;
        }
        seen.add(normalized);
        const color = /^\d+$/u.test(tag.color)
          ? `#${Number(tag.color).toString(16).padStart(6, "0")}`
          : tag.color;
        result.push({
          keyword,
          content: entry.content,
          group,
          tag: tag.tag,
          color: color || "var(--interactive-accent)",
        });
      }
    }
  }
  return result;
}

export function findSettingKeywordMatches(
  text: string,
  entries: SettingKeywordEntry[],
): SettingKeywordMatch[] {
  if (!text || entries.length === 0) {
    return [];
  }
  const matches: SettingKeywordMatch[] = [];
  const lower = text.toLocaleLowerCase();
  let index = 0;
  while (index < text.length) {
    let matched: SettingKeywordEntry | null = null;
    for (const entry of entries) {
      if (entry.keyword && lower.startsWith(entry.keyword.toLocaleLowerCase(), index)) {
        matched = entry;
        break;
      }
    }
    if (matched) {
      matches.push({
        start: index,
        end: index + matched.keyword.length,
        entry: matched,
      });
      index += matched.keyword.length;
    } else {
      index += 1;
    }
  }
  return matches;
}
