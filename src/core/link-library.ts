export const LINK_LIBRARY_JSON = "links.json";
export const DEFAULT_LINK_GROUP = "分散组";
export const DEFAULT_LINK_COLOR = "#9a5a2d";

export type LinkGroupConfig = Record<string, never>;

export interface LinkFileEntry {
  path: string;
  belong: string;
  tag: string;
  aliases: string[];
  order: number;
}

export interface LinkLibraryData {
  group: Record<string, LinkGroupConfig>;
  tags: Record<string, Record<string, string>>;
  links: LinkFileEntry[];
}

export interface LinkKeywordEntry {
  keyword: string;
  path: string;
  group: string;
  tag: string;
  color: string;
  basename: string;
}

export function parseLinkLibrary(value: unknown): LinkLibraryData {
  const root = isRecord(value) ? value : {};
  const group: Record<string, LinkGroupConfig> = {};
  if (isRecord(root.group)) {
    for (const name of Object.keys(root.group)) {
      if (!name.trim()) {
        continue;
      }
      group[name.trim()] = {};
    }
  }

  const tags: Record<string, Record<string, string>> = {};
  if (isRecord(root.tag)) {
    for (const [groupName, rawTags] of Object.entries(root.tag)) {
      if (!isRecord(rawTags)) {
        continue;
      }
      const map: Record<string, string> = {};
      for (const [tag, color] of Object.entries(rawTags)) {
        if (tag.trim()) {
          map[tag.trim()] = normalizeColor(color);
        }
      }
      tags[groupName] = map;
    }
  }

  const links: LinkFileEntry[] = [];
  if (Array.isArray(root.link)) {
    for (const item of root.link) {
      if (!isRecord(item)) {
        continue;
      }
      for (const [rawPath, rawConfig] of Object.entries(item)) {
        const path = rawPath.trim();
        if (!path) {
          continue;
        }
        const config = isRecord(rawConfig) ? rawConfig : {};
        const rawGroup = typeof config.belong === "string"
          && config.belong.trim()
          ? config.belong.trim()
          : DEFAULT_LINK_GROUP;
        const belong = rawGroup === DEFAULT_LINK_GROUP || group[rawGroup]
          ? rawGroup
          : DEFAULT_LINK_GROUP;
        const aliases = Array.isArray(config.alias)
          ? config.alias
            .filter((alias): alias is string => typeof alias === "string")
            .map((alias) => alias.trim())
            .filter(Boolean)
          : [];
        if (links.some((entry) => entry.path === path)) {
          continue;
        }
        const tag = typeof config.tag === "string" ? config.tag.trim() : "";
        const order = Number(config.order);
        links.push({
          path,
          belong,
          tag,
          aliases: [...new Set(aliases)],
          order: Number.isFinite(order) ? order : links.length,
        });
      }
    }
  }

  return { group, tags, links };
}

export function serializeLinkLibrary(data: LinkLibraryData): string {
  const group: Record<string, LinkGroupConfig> = {};
  for (const name of Object.keys(data.group)) {
    if (name.trim()) {
      group[name] = {};
    }
  }
  const tags: Record<string, Record<string, string>> = {};
  for (const [groupName, map] of Object.entries(data.tags)) {
    if (!data.group[groupName] && groupName !== DEFAULT_LINK_GROUP) {
      continue;
    }
    const cleaned: Record<string, string> = {};
    for (const [tag, color] of Object.entries(map)) {
      if (tag.trim()) {
        cleaned[tag.trim()] = normalizeColor(color);
      }
    }
    if (Object.keys(cleaned).length > 0) {
      tags[groupName] = cleaned;
    }
  }
  const link = data.links.map((entry) => ({
    [entry.path]: {
      ...(entry.belong && entry.belong !== DEFAULT_LINK_GROUP
        ? { belong: entry.belong }
        : {}),
      ...(entry.tag ? { tag: entry.tag } : {}),
      order: entry.order,
      alias: [...new Set(entry.aliases)],
    },
  }));
  return `${JSON.stringify({ group, tag: tags, link }, null, 2)}\n`;
}

export function getLinkGroupNames(data: LinkLibraryData): string[] {
  const names = Object.keys(data.group);
  names.unshift(DEFAULT_LINK_GROUP);
  return [...new Set(names)];
}

export function getLinkTagColor(
  data: LinkLibraryData,
  group: string,
  tag: string,
): string {
  return data.tags[group]?.[tag] ?? DEFAULT_LINK_COLOR;
}

export function getLinkGroupTags(
  data: LinkLibraryData,
  group: string,
): string[] {
  const names = new Set(Object.keys(data.tags[group] ?? {}));
  for (const link of data.links) {
    if (link.belong === group && link.tag) {
      names.add(link.tag);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export function getLinkFileName(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.md$/iu, "");
}

export function getLinkKeywordEntries(
  data: LinkLibraryData,
): LinkKeywordEntry[] {
  const entries: LinkKeywordEntry[] = [];
  const seen = new Set<string>();
  for (const link of data.links) {
    const basename = getLinkFileName(link.path);
    const aliases = link.aliases.map((alias) => alias.trim()).filter(Boolean);
    // An alias replaces the file name as the highlight keyword. A file
    // without aliases falls back to its file name.
    const keywords = aliases.length > 0 ? aliases : [basename];
    for (const keyword of keywords) {
      const normalized = keyword.toLocaleLowerCase();
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      entries.push({
        keyword,
        path: link.path,
        group: link.belong,
        tag: link.tag,
        color: getLinkTagColor(data, link.belong, link.tag),
        basename,
      });
    }
  }
  return entries.sort((left, right) => (
    right.keyword.length - left.keyword.length
  ));
}

export interface LinkKeywordMatch {
  start: number;
  end: number;
  entry: LinkKeywordEntry;
}

export function findLinkKeywordMatches(
  text: string,
  entries: LinkKeywordEntry[],
): LinkKeywordMatch[] {
  if (!text || entries.length === 0) {
    return [];
  }
  const matches: LinkKeywordMatch[] = [];
  const lower = text.toLocaleLowerCase();
  let index = 0;
  while (index < text.length) {
    let matched: LinkKeywordEntry | null = null;
    for (const entry of entries) {
      if (!entry.keyword) {
        continue;
      }
      if (lower.startsWith(entry.keyword.toLocaleLowerCase(), index)) {
        matched = entry;
        break;
      }
    }
    if (matched) {
      matches.push({ start: index, end: index + matched.keyword.length, entry: matched });
      index += matched.keyword.length;
    } else {
      index += 1;
    }
  }
  return matches;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeColor(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_LINK_COLOR;
  }
  const color = value.trim();
  if (/^#[0-9a-f]{3,8}$/iu.test(color)) {
    return color;
  }
  if (/^(?:rgb|hsl)a?\(/iu.test(color)) {
    return color;
  }
  return DEFAULT_LINK_COLOR;
}
