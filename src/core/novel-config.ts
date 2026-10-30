export const NOVEL_CONFIG_FILENAME = "novel.json";
export const LEGACY_NOVEL_SETTING_FILENAME = "NovelSetting.md";

export interface NovelVolumeMeta {
  description: string;
  cover: string;
}

export interface NovelArticleGroup {
  id: string;
  volume: string;
  name: string;
  description: string;
  paths: string[];
}

export interface NovelConfig {
  "novel-description": string;
  "novel-cover": string;
  "volume-order": string[];
  volumes: Record<string, NovelVolumeMeta>;
  "article-groups": NovelArticleGroup[];
}

export interface NovelGroupInfo {
  folderPath: string;
  name: string;
  description: string;
  cover: string;
  state: string;
}

export interface NovelConfigFileLike {
  name: string;
  path: string;
  extension?: string;
}

export function isNovelConfigFile(file: NovelConfigFileLike): boolean {
  return file.name === NOVEL_CONFIG_FILENAME;
}

export function getNovelConfigPath(folderPath: string): string {
  return joinVaultPath(folderPath, NOVEL_CONFIG_FILENAME);
}

export function joinVaultPath(...parts: string[]): string {
  return parts
    .map((part) => part.replace(/^\/+|\/+$/gu, ""))
    .filter(Boolean)
    .join("/");
}

export function createNovelConfigContent(): string {
  const config: NovelConfig = {
    "novel-description": "",
    "novel-cover": "",
    "volume-order": [],
    volumes: {},
    "article-groups": [],
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function parseNovelConfig(value: unknown): NovelConfig {
  const source = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const volumes: Record<string, NovelVolumeMeta> = {};
  const rawVolumes = source.volumes;
  if (rawVolumes && typeof rawVolumes === "object") {
    for (const [name, metaValue] of Object.entries(rawVolumes)) {
      const meta = metaValue && typeof metaValue === "object"
        ? metaValue as Record<string, unknown>
        : {};
      volumes[name] = {
        description: typeof meta.description === "string" ? meta.description : "",
        cover: typeof meta.cover === "string" ? meta.cover : "",
      };
    }
  }
  const groups: NovelArticleGroup[] = [];
  const rawGroups = source["article-groups"];
  if (Array.isArray(rawGroups)) {
    for (const entry of rawGroups) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const paths = Array.isArray(record.paths)
        ? record.paths.filter((path): path is string => typeof path === "string")
        : [];
      if (paths.length === 0) {
        continue;
      }
      groups.push({
        id: typeof record.id === "string" && record.id
          ? record.id
          : `group-${groups.length + 1}`,
        volume: typeof record.volume === "string" ? record.volume : "",
        name: typeof record.name === "string" ? record.name : "未命名文章组",
        description: typeof record.description === "string" ? record.description : "",
        paths,
      });
    }
  }
  return {
    "novel-description": typeof source["novel-description"] === "string"
      ? source["novel-description"]
      : "",
    "novel-cover": typeof source["novel-cover"] === "string"
      ? source["novel-cover"]
      : "",
    "volume-order": Array.isArray(source["volume-order"])
      ? source["volume-order"].filter((name): name is string => typeof name === "string")
      : [],
    volumes,
    "article-groups": groups,
  };
}

export function serializeNovelConfig(config: NovelConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
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
