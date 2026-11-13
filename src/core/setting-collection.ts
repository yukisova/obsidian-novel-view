export const SETTING_COLLECTION_INDEX = "index.md";
export const SETTING_INDEX_MARKER = "novelview-setting-index";

export interface SettingField {
  name: string;
  value: string;
}

export type SettingRelationDirection = "one-way" | "two-way";

export interface SettingRelation {
  targetGroup: string;
  targetKeyword: string;
  type: string;
  direction: SettingRelationDirection;
  side?: "left" | "right";
  linkId?: string;
  linkSourceGroup?: string;
  linkSourceKeyword?: string;
}

export interface SettingMark {
  start: number;
  end: number;
  attribute: string;
}

export interface SettingCollectionEntry {
  keyword: string;
  content: string;
  fields: SettingField[];
  relations: SettingRelation[];
  marks: SettingMark[];
}

export interface SettingCollectionTag {
  tag: string;
  color: string;
  contain: SettingCollectionEntry[];
}

export type SettingCollectionIndex = Record<string, SettingCollectionTag[]>;
export type SettingGroupTags = SettingCollectionTag[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeColor(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return "";
}

function parseFields(value: unknown): SettingField[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const fields: SettingField[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const fieldValue = typeof item.value === "string"
      ? item.value.trim()
      : typeof item.value === "number"
        ? String(item.value)
        : "";
    if (name) {
      fields.push({ name, value: fieldValue });
    }
  }
  return fields;
}

function parseRelations(value: unknown): SettingRelation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const relations: SettingRelation[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const targetGroup = typeof item.targetGroup === "string"
      ? item.targetGroup.trim()
      : "";
    const targetKeyword = typeof item.targetKeyword === "string"
      ? item.targetKeyword.trim()
      : "";
    const type = typeof item.type === "string" ? item.type.trim() : "";
    const direction = item.direction === "two-way" ? "two-way" : "one-way";
    const side = item.side === "left" ? "left" : item.side === "right" ? "right" : undefined;
    const linkId = typeof item.linkId === "string" && item.linkId.trim()
      ? item.linkId.trim()
      : undefined;
    const linkSourceGroup = typeof item.linkSourceGroup === "string"
      ? item.linkSourceGroup.trim()
      : undefined;
    const linkSourceKeyword = typeof item.linkSourceKeyword === "string"
      ? item.linkSourceKeyword.trim()
      : undefined;
    if (targetGroup && targetKeyword) {
      const relation: SettingRelation = { targetGroup, targetKeyword, type, direction };
      if (side) {
        relation.side = side;
      }
      if (linkId) {
        relation.linkId = linkId;
      }
      if (linkSourceGroup && linkSourceKeyword) {
        relation.linkSourceGroup = linkSourceGroup;
        relation.linkSourceKeyword = linkSourceKeyword;
      }
      relations.push(relation);
    }
  }
  return relations;
}

function parseMarks(value: unknown): SettingMark[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const marks: SettingMark[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const start = Number(item.start);
    const end = Number(item.end);
    const attribute = typeof item.attribute === "string"
      ? item.attribute.trim()
      : "";
    if (Number.isInteger(start) && Number.isInteger(end) && end > start && attribute) {
      marks.push({ start, end, attribute });
    }
  }
  return marks;
}

function parseTags(rawTags: unknown): SettingCollectionTag[] {
  if (!Array.isArray(rawTags)) {
    return [];
  }
  const tags: SettingCollectionTag[] = [];
  for (const rawTag of rawTags) {
    if (!isRecord(rawTag)) {
      continue;
    }
    const tag = typeof rawTag.tag === "string" ? rawTag.tag.trim() : "";
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
        contain.push({
          keyword,
          content,
          fields: parseFields(rawEntry.fields),
          relations: parseRelations(rawEntry.relations),
          marks: parseMarks(rawEntry.marks),
        });
      }
    }
    tags.push({ tag, color: normalizeColor(rawTag.color), contain });
  }
  return tags;
}

export function parseSettingGroupTags(value: unknown): SettingGroupTags {
  if (Array.isArray(value)) {
    return parseTags(value);
  }
  if (isRecord(value)) {
    return parseTags(value.tags ?? value.contain ?? []);
  }
  return [];
}

export function parseSettingCollectionIndex(value: unknown): SettingCollectionIndex {
  const result: SettingCollectionIndex = {};
  if (!isRecord(value)) {
    return result;
  }
  for (const [rawGroup, rawTags] of Object.entries(value)) {
    const group = rawGroup.trim();
    if (!group) {
      continue;
    }
    result[group] = parseTags(rawTags);
  }
  return result;
}

export function serializeSettingCollectionIndex(
  index: SettingCollectionIndex,
): string {
  return `${JSON.stringify(index, null, 2)}\n`;
}

/** Parse the hidden index.md used by a single setting-group folder. */
export function parseSettingGroupMarkdown(content: string): SettingGroupTags {
  const match = /```(?:json)?\s*\n([\s\S]*?)```/u.exec(content);
  const payload = match?.[1] ?? content.replace(/^---[\s\S]*?---/u, "").trim();
  if (!payload) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(payload);
    if (isRecord(parsed)) {
      const tags = parsed.tags;
      if (Array.isArray(tags)) {
        return parseTags(tags);
      }
      const sourceTags = Object.values(parsed).find((value) => Array.isArray(value));
      return parseTags(sourceTags);
    }
    return parseTags(parsed);
  } catch {
    return [];
  }
}

/** Serialize a single setting group into the hidden index.md body. */
export function serializeSettingGroupMarkdown(tags: SettingGroupTags): string {
  return [
    "---",
    `${SETTING_INDEX_MARKER}: true`,
    "---",
    "",
    "```json",
    JSON.stringify({ tags }, null, 2),
    "```",
    "",
  ].join("\n");
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

export function getAllSettingKeywordEntries(
  index: SettingCollectionIndex,
): SettingKeywordEntry[] {
  const result: SettingKeywordEntry[] = [];
  for (const [group, tags] of Object.entries(index)) {
    for (const tag of tags) {
      for (const entry of tag.contain) {
        const keyword = entry.keyword.trim();
        if (!keyword) {
          continue;
        }
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
