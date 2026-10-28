export const LINK_LIBRARY_JSON = "links.json";
export const DEFAULT_LINK_GROUP = "默认联动组";
export const DEFAULT_LINK_COLOR = "#9a5a2d";

export interface LinkFileEntry {
  path: string;
  belong: string;
  aliases: string[];
}

export interface LinkLibraryData {
  group: Record<string, string>;
  links: LinkFileEntry[];
}

export interface LinkKeywordEntry {
  keyword: string;
  path: string;
  group: string;
  color: string;
  basename: string;
}

export function parseLinkLibrary(value: unknown): LinkLibraryData {
  const root = isRecord(value) ? value : {};
  const groups: Record<string, string> = {};
  if (isRecord(root.group)) {
    for (const [name, color] of Object.entries(root.group)) {
      if (typeof name === "string" && name.trim()) {
        groups[name.trim()] = normalizeColor(color);
      }
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
        const belong = rawGroup === DEFAULT_LINK_GROUP || groups[rawGroup]
          ? rawGroup
          : DEFAULT_LINK_GROUP;
        const aliases = Array.isArray(config.alias)
          ? config.alias
            .filter((alias): alias is string => typeof alias === "string")
            .map((alias) => alias.trim())
            .filter(Boolean)
          : [];
        links.push({
          path,
          belong,
          aliases: [...new Set(aliases)],
        });
      }
    }
  }

  return { group: groups, links };
}

export function serializeLinkLibrary(data: LinkLibraryData): string {
  const group: Record<string, string> = {};
  for (const [name, color] of Object.entries(data.group)) {
    if (name.trim()) {
      group[name] = normalizeColor(color);
    }
  }
  const link = data.links.map((entry) => ({
    [entry.path]: {
      ...(entry.belong && entry.belong !== DEFAULT_LINK_GROUP
        ? { belong: entry.belong }
        : {}),
      alias: [...new Set(entry.aliases)],
    },
  }));
  return `${JSON.stringify({ group, link }, null, 2)}\n`;
}

export function getLinkGroupNames(data: LinkLibraryData): string[] {
  const names = Object.keys(data.group);
  if (
    data.links.some((entry) => entry.belong === DEFAULT_LINK_GROUP)
    || !names.includes(DEFAULT_LINK_GROUP)
  ) {
    names.push(DEFAULT_LINK_GROUP);
  }
  return [...new Set(names)];
}

export function getLinkGroupColor(
  data: LinkLibraryData,
  group: string,
): string {
  return data.group[group] ?? DEFAULT_LINK_COLOR;
}

export function getLinkFileName(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.md$/iu, "");
}

export function getLinkKeywordEntries(
  data: LinkLibraryData,
): LinkKeywordEntry[] {
  const entries: LinkKeywordEntry[] = [];
  for (const link of data.links) {
    const basename = getLinkFileName(link.path);
    const keywords = [basename, ...link.aliases]
      .map((keyword) => keyword.trim())
      .filter(Boolean);
    for (const keyword of new Set(keywords)) {
      entries.push({
        keyword,
        path: link.path,
        group: link.belong,
        color: getLinkGroupColor(data, link.belong),
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

function normalizeColor(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_LINK_COLOR;
  }
  const color = value.trim();
  return /^#[0-9a-f]{3,8}$/iu.test(color) ? color : DEFAULT_LINK_COLOR;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
