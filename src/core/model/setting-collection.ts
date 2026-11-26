export const SETTING_COLLECTION_INDEX = "index.md";
export const SETTING_INDEX_MARKER = "novelview-setting-index";

export interface SettingField {
  name: string;
  value: string;
}

export interface SettingMark {
  start: number;
  end: number;
  attribute: string;
}

export interface SettingCollectionEntry {
  keyword: string;
  content: string;
  icon?: string;
  fields: SettingField[];
  marks: SettingMark[];
}

export interface SettingCollectionTag {
  tag: string;
  color: string;
  contain: SettingCollectionEntry[];
}

export type SettingCollectionIndex = Record<string, SettingCollectionTag[]>;
export type SettingGroupTags = SettingCollectionTag[];

/** 判断值是否为非空普通对象 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 把颜色值统一转换为字符串 */
function normalizeColor(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return "";
}

/** 解析字段数组并过滤无名条目 */
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

/** 解析标注数组并校验区间有效性 */
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

/** 解析标签及其下的设定条目结构 */
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
        const icon = typeof rawEntry.icon === "string"
          ? rawEntry.icon.trim()
          : "";
        const entry: SettingCollectionEntry = {
          keyword,
          content,
          fields: parseFields(rawEntry.fields),
          marks: parseMarks(rawEntry.marks),
        };
        if (icon) {
          entry.icon = icon;
        }
        contain.push(entry);
      }
    }
    tags.push({ tag, color: normalizeColor(rawTag.color), contain });
  }
  return tags;
}

/** 兼容数组与对象两种标签输入格式 */
export function parseSettingGroupTags(value: unknown): SettingGroupTags {
  if (Array.isArray(value)) {
    return parseTags(value);
  }
  if (isRecord(value)) {
    return parseTags(value.tags ?? value.contain ?? []);
  }
  return [];
}

/** 把分组映射解析为设定集合索引 */
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

/** 把设定集合索引输出为格式化文本 */
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

/** 返回空的设定集合索引对象 */
export function emptySettingCollectionIndex(): SettingCollectionIndex {
  return {};
}

/** 清理设定组名称并生成合法目录名 */
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

/** 汇总去重后的设定关键词及配色 */
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

/** 汇总全部设定关键词及其所属分组 */
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

/** 扫描正文并返回命中的关键词区间 */
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



export const SETTING_RECORD_MARKER = "novelview-setting-record";
export const SETTING_RECORD_META = "novelview-setting-meta";

export interface ParsedSettingRecord {
  entry: SettingCollectionEntry;
  tag: string;
  color: string;
}

/** 解析设定记录的前置元数据与正文 */
export function parseSettingRecordMarkdown(
  content: string,
  keyword: string,
): ParsedSettingRecord {
  let tag = "未分组";
  let color = "";
  let icon: string | undefined;
  let fields: SettingField[] = [];
  let marks: SettingMark[] = [];
  let body = content;
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
  if (match) {
    body = content.slice(match[0].length);
    const metaLine = /^novelview-setting-meta:\s*(.+)$/mu.exec(match[1] ?? "");
    if (metaLine) {
      try {
        const meta = JSON.parse(metaLine[1] ?? "") as unknown;
        if (isRecord(meta)) {
          tag = typeof meta.tag === "string" && meta.tag.trim()
            ? meta.tag.trim()
            : tag;
          color = normalizeColor(meta.color);
          icon = typeof meta.icon === "string" && meta.icon.trim()
            ? meta.icon.trim()
            : undefined;
          fields = parseFields(meta.fields);
          marks = parseMarks(meta.marks);
        }
      } catch {
        // 兼容手工编辑错误，保留默认记录。
      }
    }
  }
  return {
    tag,
    color,
    entry: {
      keyword,
      content: body.replace(/\r\n?/gu, "\n").trim(),
      fields,
      marks,
      ...(icon ? { icon } : {}),
    },
  };
}

/** 把设定记录序列化为带元数据的文档 */
export function serializeSettingRecordMarkdown(
  entry: SettingCollectionEntry,
  tag: string,
  color: string,
): string {
  const meta = JSON.stringify({
    tag,
    color,
    ...(entry.icon ? { icon: entry.icon } : {}),
    fields: entry.fields,
    marks: entry.marks,
  });
  return [
    "---",
    `${SETTING_RECORD_MARKER}: true`,
    `${SETTING_RECORD_META}: ${meta}`,
    "---",
    "",
    entry.content,
    "",
  ].join("\n");
}
