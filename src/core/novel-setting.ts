
export const NOVEL_SETTING_BASENAME = "NovelSetting";
export const NOVEL_SETTING_FILENAME = "NovelSetting.md";
export const NOVEL_SETTING_TYPE = "novel-setting";

export interface NovelSettingData {
  folderPath: string;
  name: string;
  description: string;
  cover: string;
}

export interface NovelSettingFileLike {
  basename: string;
  path: string;
  extension?: string;
}

export function isNovelSettingFile(file: NovelSettingFileLike): boolean {
  return file.basename === NOVEL_SETTING_BASENAME
    && (file.extension === undefined || file.extension === "md");
}

export function getNovelSettingPath(folderPath: string): string {
  return joinVaultPath(folderPath, NOVEL_SETTING_FILENAME);
}

export function joinVaultPath(...parts: string[]): string {
  return parts
    .map((part) => part.replace(/^\/+|\/+$/gu, ""))
    .filter(Boolean)
    .join("/");
}

export function parseNovelSetting(
  frontmatter: Record<string, unknown> | undefined,
  folderPath: string,
  folderName: string,
): NovelSettingData {
  const name = readStringProperty(frontmatter, [
    "novel-name",
    "novel-title",
    "title",
    "小说名",
    "小说名称",
  ]) || folderName;

  const description = readStringProperty(frontmatter, [
    "novel-description",
    "novel-intro",
    "description",
    "小说简介",
  ]);

  const cover = normalizeCoverPath(readStringProperty(frontmatter, [
    "novel-cover",
    "cover",
    "小说封面",
  ]));
  return {
    folderPath,
    name: name.trim() || folderName,
    description: description.trim(),
    cover,
  };
}

export function createNovelSettingContent(name: string): string {
  return [
    "---",
    `novelview-type: ${NOVEL_SETTING_TYPE}`,
    `novel-name: ${JSON.stringify(name)}`,
    'novel-description: ""',
    'novel-cover: ""',
    "---",
    "",
  ].join("\n");
}

export function normalizeCoverPath(value: string): string {
  let cover = value.trim();
  if (!cover) {
    return "";
  }

  const wiki = cover.match(/^!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/u);
  if (wiki) {
    cover = wiki[1].trim();
  } else {
    const markdown = cover.match(/^!?\[[^\]]*\]\(([^)]+)\)$/u);
    if (markdown) {
      cover = markdown[1].trim();
    }
  }

  return cover.replace(/^["']|["']$/gu, "").replace(/^\/+/u, "");
}

function readStringProperty(
  frontmatter: Record<string, unknown> | undefined,
  keys: string[],
): string {
  if (!frontmatter) {
    return "";
  }

  const lowerKeys = new Set(keys.map((key) => key.toLowerCase()));
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!lowerKeys.has(key.toLowerCase())) {
      continue;
    }

    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (Array.isArray(value) && value.length > 0) {
      return value
        .map((item) => typeof item === "string" ? item : String(item))
        .join(", ");
    }
  }

  return "";
}
