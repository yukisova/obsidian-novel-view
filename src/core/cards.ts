export type ReferenceCategory =
  | "setting"
  | "character"
  | "timeline"
  | "foreshadowing"
  | "inspiration";

export const REFERENCE_CATEGORIES: ReferenceCategory[] = [
  "setting",
  "character",
  "timeline",
  "foreshadowing",
  "inspiration",
];

export const CARD_PROPERTY = "novelview-type";

export const REFERENCE_CATEGORY_LABELS: Record<ReferenceCategory, string> = {
  setting: "设定",
  character: "人物",
  timeline: "时间线",
  foreshadowing: "伏笔",
  inspiration: "灵感",
};

const CATEGORY_ALIASES: Record<string, ReferenceCategory> = {
  setting: "setting",
  settings: "setting",
  worldbuilding: "setting",
  设定: "setting",
  世界观: "setting",
  character: "character",
  characters: "character",
  person: "character",
  people: "character",
  人物: "character",
  角色: "character",
  人物卡: "character",
  人物设定: "character",
  timeline: "timeline",
  "time-line": "timeline",
  时间线: "timeline",
  年表: "timeline",
  foreshadowing: "foreshadowing",
  clue: "foreshadowing",
  clues: "foreshadowing",
  伏笔: "foreshadowing",
  线索: "foreshadowing",
  inspiration: "inspiration",
  inspirations: "inspiration",
  idea: "inspiration",
  ideas: "inspiration",
  灵感: "inspiration",
  灵感便签: "inspiration",
  灵感标签: "inspiration",
  想法: "inspiration",
};

const fileCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

interface FileLike {
  basename: string;
  path: string;
}

/**
 * Read any number of reference categories from a property value.
 * Obsidian properties can be text or list values, so both are accepted.
 */
export function parseReferenceCategories(value: unknown): ReferenceCategory[] {
  const categories = new Set<ReferenceCategory>();

  for (const token of flattenPropertyValue(value)) {
    const normalized = token.trim().toLowerCase();
    if (!normalized) {
      continue;
    }

    for (const part of normalized.split(/[,，;；]/u)) {
      const category = CATEGORY_ALIASES[part.trim()];
      if (category) {
        categories.add(category);
      }
    }
  }

  return [...categories];
}

/**
 * Find `novelview-type` in a frontmatter object. Obsidian normalizes most
 * property names, but matching case-insensitively keeps imported notes working.
 */
export function getReferenceCategories(
  frontmatter: Record<string, unknown> | undefined,
): ReferenceCategory[] {
  const value = getReferencePropertyValue(frontmatter);
  return value === undefined ? [] : parseReferenceCategories(value);
}

export function hasReferenceProperty(
  frontmatter: Record<string, unknown> | undefined,
): boolean {
  return getReferencePropertyValue(frontmatter) !== undefined;
}

function getReferencePropertyValue(
  frontmatter: Record<string, unknown> | undefined,
): unknown {
  if (!frontmatter) {
    return undefined;
  }

  const key = Object.keys(frontmatter)
    .find((candidate) => candidate.toLowerCase() === CARD_PROPERTY);
  return key ? frontmatter[key] : undefined;
}

export function compareFilesNaturally(left: FileLike, right: FileLike): number {
  return fileCollator.compare(left.basename, right.basename)
    || fileCollator.compare(left.path, right.path);
}

function flattenPropertyValue(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenPropertyValue(item));
  }
  return [];
}
