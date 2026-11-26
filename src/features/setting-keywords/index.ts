import { TFolder, type TFile } from "obsidian";
import {
  getAllSettingKeywordEntries,
  getSettingKeywordEntries,
  type SettingCollectionIndex,
  type SettingKeywordEntry,
} from "../../core/model/setting-collection";
import {
  refreshSettingKeywords,
  setSettingKeywords,
} from "../../editor/setting-keyword-extension";

/** 刷新关键词索引所需的最小宿主能力。 */
export interface SettingKeywordIndexHost {
  /** 获取最近活动的 Markdown 文件 */
  getLastActiveMarkdownFile(): TFile | null;
  /** 查找文件所在的小说组根目录 */
  findNovelGroupRoot(folderPath: string): string | null;
  /** 规范化文件夹路径表示 */
  normalizeFolderPath(path: string): string;
  /** 列出小说组内的设定组目录 */
  settingGroupsForNovel(novelRoot: string): TFolder[];
  /** 读取设定组的索引数据 */
  readSettingCollectionIndex(
    folderPath: string,
  ): Promise<SettingCollectionIndex>;
  /** 更新查找器使用的关键词表 */
  setAllSettingKeywords(entries: SettingKeywordEntry[]): void;
}

/**
 * 依据当前小说组的设定集索引，重建正文关键词装饰与浮层用的条目表。
 * 无活动章节 / 不在小说组 / 没有设定组时清空。
 */
export async function refreshSettingKeywordIndex(
  host: SettingKeywordIndexHost,
): Promise<void> {
  const clear = (): void => {
    host.setAllSettingKeywords([]);
    setSettingKeywords([]);
    refreshSettingKeywords();
  };
  const current = host.getLastActiveMarkdownFile();
  if (!current) {
    clear();
    return;
  }
  const root = host.findNovelGroupRoot(
    host.normalizeFolderPath(current.parent?.path ?? "/"),
  );
  if (!root) {
    clear();
    return;
  }
  const groups = host.settingGroupsForNovel(root);
  if (groups.length === 0) {
    clear();
    return;
  }
  const index: SettingCollectionIndex = {};
  for (const group of groups) {
    const groupIndex = await host.readSettingCollectionIndex(group.path);
    Object.assign(index, groupIndex);
  }
  host.setAllSettingKeywords(getAllSettingKeywordEntries(index));
  setSettingKeywords(getSettingKeywordEntries(index));
  refreshSettingKeywords();
}

/** 按关键词打开对应设定记录所需的最小宿主能力。 */
export interface SettingKeywordRecordHost {
  readonly allSettingKeywords: SettingKeywordEntry[];
  /** 打开关键词对应的设定记录 */
  openSettingRecord(
    sourcePath: string,
    group: string,
    tag: string,
    keyword: string,
  ): Promise<void>;
}

/**
 * 打开关键词对应的设定记录；同名关键词有多条时，沿用浮层上次翻到的位置。
 */
export async function openSettingKeywordRecord(
  host: SettingKeywordRecordHost,
  sourcePath: string,
  keyword: string,
  pageFor: (keywordKey: string) => number,
): Promise<void> {
  const key = keyword.toLocaleLowerCase();
  const matches = host.allSettingKeywords.filter(
    (entry) => entry.keyword.toLocaleLowerCase() === key,
  );
  if (matches.length === 0) {
    return;
  }
  const page = Math.min(Math.max(0, pageFor(key)), matches.length - 1);
  const entry = matches[page];
  await host.openSettingRecord(sourcePath, entry.group, entry.tag, entry.keyword);
}
