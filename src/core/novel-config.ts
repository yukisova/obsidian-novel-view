export const NOVEL_CONFIG_FILENAME = "novel.json";

export const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function pruneNovelHistory<T extends { bucketStart: number }>(
  history: T[],
  now = Date.now(),
): T[] {
  const cutoff = now - HISTORY_RETENTION_MS;
  return history.filter((entry) => entry.bucketStart >= cutoff);
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

/**
 * Today uses four-hour writing periods. Earlier days use one period per day.
 * `now` defaults to the entry time so old stored entries normalize to day starts.
 */
export function historyBucketStart(
  timestamp: number,
  now = timestamp,
): number {
  const date = new Date(timestamp);
  const reference = new Date(now);
  if (isSameLocalDay(date, reference)) {
    date.setHours(Math.floor(date.getHours() / 4) * 4, 0, 0, 0);
  } else {
    date.setHours(0, 0, 0, 0);
  }
  return date.getTime();
}

export interface NovelHistoryPeriodGroup {
  bucketStart: number;
  day: boolean;
  entries: NovelHistoryEntry[];
}

/**
 * Group history for the workbench. Today is split into four-hour periods;
 * every earlier calendar day is aggregated into a single period.
 */
export function groupNovelHistory(
  history: NovelHistoryEntry[],
  now = Date.now(),
): NovelHistoryPeriodGroup[] {
  const nowDate = new Date(now);
  const groups = new Map<string, {
    bucketStart: number;
    day: boolean;
    entries: Map<string, NovelHistoryEntry>;
  }>();
  for (const entry of history) {
    const date = new Date(entry.bucketStart);
    const day = !isSameLocalDay(date, nowDate);
    const start = new Date(date);
    if (day) {
      start.setHours(0, 0, 0, 0);
    } else {
      start.setHours(Math.floor(date.getHours() / 4) * 4, 0, 0, 0);
    }
    const bucketStart = start.getTime();
    const key = `${day ? "day" : "hour"}:${bucketStart}`;
    const group = groups.get(key) ?? {
      bucketStart,
      day,
      entries: new Map<string, NovelHistoryEntry>(),
    };
    const existing = group.entries.get(entry.path);
    if (existing) {
      existing.delta += entry.delta;
      existing.updatedAt = Math.max(existing.updatedAt, entry.updatedAt);
      if (entry.updatedAt >= existing.updatedAt) {
        existing.name = entry.name;
      }
    } else {
      group.entries.set(entry.path, { ...entry });
    }
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      bucketStart: group.bucketStart,
      day: group.day,
      entries: [...group.entries.values()]
        .filter((entry) => entry.delta !== 0)
        .sort((left, right) => right.updatedAt - left.updatedAt),
    }))
    .filter((group) => group.entries.length > 0)
    .sort((left, right) => right.bucketStart - left.bucketStart);
}
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

export interface NovelHistoryEntry {
  bucketStart: number;
  path: string;
  name: string;
  delta: number;
  updatedAt: number;
}

export interface NovelConfig {
  "novel-description": string;
  "novel-cover": string;
  "volume-order": string[];
  volumes: Record<string, NovelVolumeMeta>;
  "article-groups": NovelArticleGroup[];
  history: NovelHistoryEntry[];
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
    history: [],
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
  const history: NovelHistoryEntry[] = [];
  if (Array.isArray(source.history)) {
    for (const entry of source.history) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const bucketStart = Number(record.bucketStart);
      const delta = Number(record.delta);
      const updatedAt = Number(record.updatedAt);
      if (
        !Number.isFinite(bucketStart)
        || !Number.isFinite(delta)
        || delta === 0
        || typeof record.path !== "string"
      ) {
        continue;
      }
      if (bucketStart < Date.now() - HISTORY_RETENTION_MS) {
        continue;
      }
      history.push({
        bucketStart,
        path: record.path,
        name: typeof record.name === "string" ? record.name : "",
        delta,
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : bucketStart,
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
    history,
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
