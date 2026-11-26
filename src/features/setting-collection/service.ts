/**
 * 设定集：索引读写、分组目录生命周期、记录与详情文件管理。
 * 从 main.ts 迁出（D8）。
 */

import { Notice, TFile, TFolder } from "obsidian";
import { SETTING_COLLECTION_INDEX, parseSettingGroupMarkdown, settingGroupFolderName, parseSettingRecordMarkdown, serializeSettingRecordMarkdown, SETTING_RECORD_MARKER, SettingCollectionIndex, SettingCollectionTag, SettingGroupTags } from "../../core/model/setting-collection";
import { joinVaultPath, NovelConfig } from "../../core/model/novel-config";
import { SETTING_COLLECTION_VIEW_TYPE, SettingCollectionView } from "./setting-collection-view";
import type { PluginBase } from "../../app/plugin-context";

export interface SettingCollectionHost extends PluginBase {
  /** 刷新小说目录树的装饰显示 */
  scheduleNovelFolderDecoration(): void;
  readonly settingGroups: Map<string, string>;
  /** 刷新设定关键词索引缓存 */
  refreshSettingKeywordIndex(): Promise<void>;
  /** 返回所有小说组根目录路径 */
  novelRoots(): string[];
  /** 读取指定小说组的配置 */
  readNovelConfig(folderPath: string): Promise<NovelConfig>;
  /** 判断路径是否属于设定集索引 */
  isSettingCollectionIndexPath(_path: string): boolean;
  /** 写回小说组的配置数据 */
  writeNovelConfig(folderPath: string, config: NovelConfig): Promise<void>;
  readonly wordCountBaselines: Map<string, number>;
  /** 刷新工作台的相关视图 */
  refreshWorkbenchViews(): void;
  /** 按路径查找库内文件夹 */
  getFolder(path: string): TFolder | null;
  /** 规范化文件夹路径字符串 */
  normalizeFolderPath(path: string): string;
  /** 向上查找所属小说组根目录 */
  findNovelGroupRoot(folderPath: string): string | null;
  /** 获取小说组的设定文件 */
  getNovelSettingFile(folderPath: string): TFile | null;
  /** 打开指定路径的设定集视图 */
  openSettingCollection(folderPath: string, focus?: { group: string; tag: string; keyword: string },): Promise<void>;
  /** 判断是否为特殊小说文件 */
  isSpecialNovelFile(file: TFile): boolean;
  /** 刷新当前已打开的视图 */
  refreshOpenViews(): void;
  /** 刷新已打开的文章列表视图 */
  refreshArticleListViews(): void;
  /** 清理文件名并回退默认值 */
  sanitizeFileBase(value: string, fallback: string): string;
  suppressSettingGroupFolderRename: boolean;
  readonly settingCollectionTimers: Map<string, number>;
}

/** 初始化设定分组索引并调度刷新 */
export async function initializeSettingGroups(host: SettingCollectionHost): Promise<void> {
    await migrateLegacySettingCollections(host);
    loadSettingGroups(host);
    host.scheduleNovelFolderDecoration();
    window.setTimeout(() => {
      host.scheduleNovelFolderDecoration();
    }, 80);
    for (const root of host.settingGroups.keys()) {
      scheduleSettingCollection(host, root);
    }
    await cleanupSettingIndexHistory(host);
    refreshSettingCollectionViews(host);
    void host.refreshSettingKeywordIndex();
  
}

/** 清理历史记录中的设定集索引项 */
export async function cleanupSettingIndexHistory(host: SettingCollectionHost): Promise<void> {
    for (const root of host.novelRoots()) {
      const config = await host.readNovelConfig(root);
      const history = config.history.filter(
        (entry) => !host.isSettingCollectionIndexPath(entry.path),
      );
      if (history.length !== config.history.length) {
        config.history = history;
        await host.writeNovelConfig(root, config);
      }
      for (const path of [...host.wordCountBaselines.keys()]) {
        if (host.isSettingCollectionIndexPath(path)) {
          host.wordCountBaselines.delete(path);
        }
      }
    }
    host.refreshWorkbenchViews();
  
}

/** 从文件夹名解析设定组显示名 */
export function settingGroupNameFromFolder(host: SettingCollectionHost, folder: TFolder): string {
    if (folder.name === "-") {
      return "默认设定";
    }
    return folder.name.replace(/^-+/u, "").trim();
  
}

/** 列出小说组下的全部设定组 */
export function settingGroupsForNovel(host: SettingCollectionHost, novelRoot: string): TFolder[] {
    const folder = host.getFolder(novelRoot);
    if (!folder) {
      return [];
    }
    return folder.children.filter((child): child is TFolder => (
      child instanceof TFolder
      && child.name.startsWith("-")
    ));
  
}

/** 迁移旧版设定索引与分散记录 */
export async function migrateLegacySettingCollections(host: SettingCollectionHost): Promise<void> {
    for (const novelRoot of host.novelRoots()) {
      const novelFolder = host.getFolder(novelRoot);
      if (!novelFolder) {
        continue;
      }
      const groups = novelFolder.children.filter(
        (child): child is TFolder => (
          child instanceof TFolder && child.name.startsWith("-")
        ),
      );
      for (const group of groups) {
        const indexPath = joinVaultPath(group.path, SETTING_COLLECTION_INDEX);
        const indexFile = host.app.vault.getAbstractFileByPath(indexPath);
        if (!(indexFile instanceof TFile)) {
          continue;
        }
        let tags: SettingGroupTags = [];
        try {
          tags = parseSettingGroupMarkdown(
            await host.app.vault.cachedRead(indexFile),
          );
        } catch (error) {
          console.debug("Novel View: legacy setting index read skipped", error);
        }
        for (const tag of tags) {
          for (const entry of tag.contain) {
            const path = settingRecordPath(host, group, entry.keyword);
            const existing = host.app.vault.getAbstractFileByPath(path);
            if (existing instanceof TFile) {
              const current = parseSettingRecordMarkdown(
                await host.app.vault.cachedRead(existing),
                entry.keyword,
              );
              if (!current.entry.content && (entry.content || entry.fields.length > 0)) {
                await host.app.vault.process(existing, () => (
                  serializeSettingRecordMarkdown(entry, tag.tag, tag.color)
                ));
              }
              continue;
            }
            await host.app.vault.create(
              path,
              serializeSettingRecordMarkdown(entry, tag.tag, tag.color),
            );
          }
        }
        await host.app.fileManager.trashFile(indexFile);
      }
      const legacyDetails = novelFolder.children.filter(
        (child): child is TFile => (
          child instanceof TFile
          && child.extension === "md"
          && child.name.toLocaleLowerCase().endsWith(".d.md")
        ),
      );
      if (legacyDetails.length > 0) {
        const defaultPath = joinVaultPath(novelRoot, "-");
        let defaultFolder = host.getFolder(defaultPath);
        if (!defaultFolder) {
          defaultFolder = await host.app.vault.createFolder(defaultPath);
        }
        for (const detail of legacyDetails) {
          const keyword = detail.basename.replace(/\.d$/iu, "") || "未命名记录";
          const recordPath = settingRecordPath(host, defaultFolder, keyword);
          if (!host.app.vault.getAbstractFileByPath(recordPath)) {
            const content = await host.app.vault.cachedRead(detail);
            await host.app.vault.create(
              recordPath,
              serializeSettingRecordMarkdown(
                { keyword, content, fields: [], marks: [] },
                "未分组",
                "#3498db",
              ),
            );
          }
          await host.app.fileManager.trashFile(detail);
        }
      }
    }
  
}

/** 扫描库内目录重建设定组映射 */
export function loadSettingGroups(host: SettingCollectionHost): void {
    host.settingGroups.clear();
    const novelRoots = new Set<string>();
    for (const file of host.app.vault.getFiles()) {
      if (file.name === "novel.json" && file.parent) {
        novelRoots.add(host.normalizeFolderPath(file.parent.path));
      }
    }
    for (const novelRoot of novelRoots) {
      const folder = host.getFolder(novelRoot);
      if (!folder) {
        continue;
      }
      for (const child of folder.children) {
        if (
          child instanceof TFolder
          && child.name.startsWith("-")
        ) {
          host.settingGroups.set(
            host.normalizeFolderPath(child.path),
            novelRoot,
          );
        }
      }
    }
  
}

/** 查找小说组对应的设定组文件夹 */
export function getSettingGroupFolderForNovel(host: SettingCollectionHost, novelRoot: string): TFolder | null {
    const normalized = host.normalizeFolderPath(novelRoot);
    for (const [settingRoot, targetNovel] of host.settingGroups) {
      if (targetNovel !== normalized) {
        continue;
      }
      const folder = host.getFolder(settingRoot);
      if (folder) {
        return folder;
      }
    }
    const novelFolder = host.getFolder(normalized);
    if (!novelFolder) {
      return null;
    }
    for (const child of novelFolder.children) {
      if (child instanceof TFolder && child.name.startsWith("-")) {
        host.settingGroups.set(
          host.normalizeFolderPath(child.path),
          normalized,
        );
        return child;
      }
    }
    return null;
  
}

/** 刷新所有设定集视图内容 */
export function refreshSettingCollectionViews(host: SettingCollectionHost): void {
    for (const leaf of host.app.workspace.getLeavesOfType(
      SETTING_COLLECTION_VIEW_TYPE,
    )) {
      const view = leaf.view as { refresh?: () => void };
      void view.refresh?.();
    }
  
}

/** 判断路径所属的设定组根目录 */
export function settingRootForPath(host: SettingCollectionHost, path: string): string | null {
    const normalized = host.normalizeFolderPath(path);
    for (const root of host.settingGroups.keys()) {
      if (normalized === root || normalized.startsWith(`${root}/`)) {
        return root;
      }
    }
    return null;
  
}

/** 新建设定组并打开其视图 */
export async function createSettingGroup(host: SettingCollectionHost, novelPath: string): Promise<void> {
    const novelRoot = host.findNovelGroupRoot(novelPath)
      ?? host.normalizeFolderPath(novelPath);
    const novelFolder = host.getFolder(novelRoot);
    if (!novelFolder || !host.getNovelSettingFile(novelRoot)) {
      new Notice("Novel View：找不到小说组。");
      return;
    }
    let base = "新设定组";
    let suffix = 2;
    let folderPath = joinVaultPath(
      novelRoot,
      `-${settingGroupFolderName(base)}`,
    );
    while (host.app.vault.getAbstractFileByPath(folderPath)) {
      base = `新设定组 ${suffix}`;
      folderPath = joinVaultPath(
        novelRoot,
        `-${settingGroupFolderName(base)}`,
      );
      suffix += 1;
    }
    try {
      const folder = await host.app.vault.createFolder(folderPath);
      host.settingGroups.set(folderPath, novelRoot);
      host.scheduleNovelFolderDecoration();
      await host.openSettingCollection(folder.path);
      new Notice(`Novel View：已新建设定组“${base}”。`);
    } catch (error) {
      console.error("Novel View: failed to create setting group", error);
      new Notice("Novel View：设定组创建失败。");
    }
  
}

/** 批量替换小说内关键词并统计 */
export async function replaceNovelKeyword(host: SettingCollectionHost, novelRoot: string, oldKeyword: string, newKeyword: string,): Promise< {
 records: number; files: number } | null> {
    const root = host.normalizeFolderPath(novelRoot);
    const oldValue = oldKeyword.trim();
    const newValue = newKeyword.trim();
    if (!oldValue || !newValue || oldValue === newValue) {
      return null;
    }
    const groups = settingGroupsForNovel(host, root);
    for (const group of groups) {
      const index = await readSettingCollectionIndex(host, group.path);
      for (const tags of Object.values(index)) {
        for (const tag of tags) {
          if (tag.contain.some((record) => record.keyword === newValue)) {
            return null;
          }
        }
      }
    }
    let records = 0;
    for (const group of groups) {
      const index = await readSettingCollectionIndex(host, group.path);
      let changed = false;
      for (const tags of Object.values(index)) {
        for (const tag of tags) {
          for (const record of tag.contain) {
            if (record.keyword === oldValue) {
              record.keyword = newValue;
              records += 1;
              changed = true;
            }
          }
        }
      }
      if (changed) {
        await writeSettingCollectionIndex(host, group.path, index);
      }
    }
    let files = 0;
    for (const file of host.app.vault.getMarkdownFiles()) {
      if (
        !file.path.startsWith(`${root}/`)
        || host.isSpecialNovelFile(file)
      ) {
        continue;
      }
      let changed = false;
      await host.app.vault.process(file, (text) => {
        if (!text.includes(oldValue)) {
          return text;
        }
        changed = true;
        return text.split(oldValue).join(newValue);
      });
      if (changed) {
        files += 1;
      }
    }
    await host.refreshSettingKeywordIndex();
    refreshSettingCollectionViews(host);
    host.refreshOpenViews();
    host.refreshArticleListViews();
    return { records, files };
  
}

/** 转发到 settingGroupsForNovel */
export function getSettingGroupsForNovel(host: SettingCollectionHost, novelRoot: string): TFolder[] {
    return settingGroupsForNovel(host, novelRoot);
  
}

/** 解析路径对应的设定集文件夹 */
export function getSettingCollectionFolder(host: SettingCollectionHost, path: string): TFolder | null {
    const folder = host.getFolder(path);
    if (folder && folder.name.startsWith("-")) {
      const parent = folder.parent
        ? host.normalizeFolderPath(folder.parent.path)
        : "/";
      if (host.findNovelGroupRoot(parent) === parent) {
        return folder;
      }
    }
    return getSettingGroupFolderForNovel(host, path);
  
}

/** 转发到 ensureSettingCollection */
export async function readSettingCollectionIndex(host: SettingCollectionHost, groupPath: string): Promise<SettingCollectionIndex> {
    return ensureSettingCollection(host, groupPath);
  
}

/** 按索引写回记录文件并清理 */
export async function writeSettingCollectionIndex(host: SettingCollectionHost, groupPath: string, index: SettingCollectionIndex,): Promise<void> {
    const folder = host.getFolder(groupPath);
    if (!folder || !folder.name.startsWith("-")) {
      return;
    }
    const groupName = settingGroupNameFromFolder(host, folder);
    const tags = index[groupName] ?? Object.values(index)[0] ?? [];
    const desired = new Map<string, {
      keyword: string;
      tag: string;
      color: string;
      entry: import("../../core/model/setting-collection").SettingCollectionEntry;
    }>();
    for (const tag of tags) {
      for (const entry of tag.contain) {
        const keyword = entry.keyword.trim();
        if (!keyword || desired.has(keyword)) {
          continue;
        }
        desired.set(keyword, {
          keyword,
          tag: tag.tag,
          color: tag.color,
          entry,
        });
      }
    }
    const existing = await readSettingGroupRecords(host, folder);
    const existingKeywords = new Set(
      existing.flatMap((tag) => tag.contain.map((entry) => entry.keyword)),
    );
    for (const [keyword, data] of desired) {
      const path = settingRecordPath(host, folder, keyword);
      const content = serializeSettingRecordMarkdown(
        data.entry,
        data.tag,
        data.color,
      );
      const file = host.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        const old = await host.app.vault.cachedRead(file);
        if (old !== content) {
          await host.app.vault.process(file, () => content);
        }
      } else {
        await host.app.vault.create(path, content);
      }
    }
    for (const tag of existing) {
      for (const entry of tag.contain) {
        if (desired.has(entry.keyword)) {
          continue;
        }
        if (!existingKeywords.has(entry.keyword)) {
          continue;
        }
        const path = settingRecordPath(host, folder, entry.keyword);
        const file = host.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          await host.app.fileManager.trashFile(file);
        }
      }
    }
    refreshSettingCollectionViews(host);
    void host.refreshSettingKeywordIndex();
  
}

/** 按关键词获取设定记录文件 */
export function getSettingRecordFile(host: SettingCollectionHost, groupPath: string, keyword: string,): TFile | null {
    const folder = host.getFolder(groupPath);
    if (!folder) {
      return null;
    }
    const file = host.app.vault.getAbstractFileByPath(
      settingRecordPath(host, folder, keyword),
    );
    return file instanceof TFile ? file : null;
  
}

/** 删除记录及其全部详细文件 */
export async function deleteSettingRecordFiles(host: SettingCollectionHost, groupPath: string, keyword: string,): Promise<void> {
    const folder = host.getFolder(groupPath);
    if (!folder) {
      return;
    }
    const groupName = settingGroupNameFromFolder(host, folder);
    const details = getSettingRecordDetailFiles(host, groupPath, groupName, keyword);
    for (const detail of details) {
      await host.app.fileManager.trashFile(detail);
    }
    const recordPath = settingRecordPath(host, folder, keyword);
    const record = host.app.vault.getAbstractFileByPath(recordPath);
    if (record instanceof TFile) {
      await host.app.fileManager.trashFile(record);
    }
  
}

/** 生成设定组对应的文件夹名称 */
export function settingGroupFolderPathName(host: SettingCollectionHost, group: string): string {
    return `-${settingGroupFolderName(group)}`;
  
}

/** 转发到 host.sanitizeFileBase */
export function settingDetailPrefix(host: SettingCollectionHost, keyword: string): string {
    return host.sanitizeFileBase(keyword, "设定");
  
}

/** 定位记录所属的设定组文件夹 */
export function getSettingRecordFolder(host: SettingCollectionHost, novelRootOrGroup: string, group: string,): TFolder | null {
    const direct = host.getFolder(novelRootOrGroup);
    if (direct && direct.name.startsWith("-")) {
      return direct;
    }
    return host.getFolder(joinVaultPath(
      novelRootOrGroup,
      settingGroupFolderPathName(host, group),
    ));
  
}

/** 列出记录关联的全部详细文件 */
export function getSettingRecordDetailFiles(host: SettingCollectionHost, novelRoot: string, group: string, keyword: string,): TFile[] {
    const folder = getSettingRecordFolder(host, novelRoot, group);
    if (!folder) {
      return [];
    }
    const prefix = `${settingDetailPrefix(host, keyword)}-`;
    return host.app.vault.getFiles()
      .filter((file) => (
        file.extension === "md"
        && file.parent?.path === folder.path
        && file.basename.startsWith(prefix)
        && file.basename.length > prefix.length
      ))
      .sort((left, right) => left.basename.localeCompare(
        right.basename,
        "zh-CN",
        { numeric: true, sensitivity: "base" },
      ));
  
}

/** 提取详细文件的显示标签 */
export function getSettingRecordDetailLabel(host: SettingCollectionHost, keyword: string, file: TFile): string {
    const prefix = `${settingDetailPrefix(host, keyword)}-`;
    return file.basename.startsWith(prefix)
      ? file.basename.slice(prefix.length)
      : file.basename;
  
}

/** 为设定记录新建详细文件 */
export async function createSettingRecordDetail(host: SettingCollectionHost, novelRoot: string, group: string, keyword: string, title: string,): Promise<TFile | null> {
    let folder = getSettingRecordFolder(host, novelRoot, group);
    if (!folder) {
      new Notice("Novel View：设定组不存在。");
      return null;
    }
    const base = `${settingDetailPrefix(host, keyword)}-${host.sanitizeFileBase(title, "详细")}`;
    let targetPath = joinVaultPath(folder.path, `${base}.md`);
    const existing = host.app.vault.getAbstractFileByPath(targetPath);
    if (existing instanceof TFile) {
      return existing;
    }
    let suffix = 2;
    while (host.app.vault.getAbstractFileByPath(targetPath)) {
      targetPath = joinVaultPath(folder.path, `${base} ${suffix}.md`);
      suffix += 1;
    }
    try {
      return await host.app.vault.create(targetPath, `# ${title.trim()}\n\n`);
    } catch (error) {
      console.error("Novel View: detail file creation failed", error);
      new Notice("Novel View：详细文件创建失败。");
      return null;
    }
  
}

/** 重命名设定组文件夹并校验 */
export async function renameSettingGroupFolder(host: SettingCollectionHost, folderPath: string, displayName: string,): Promise<string | null> {
    const folder = host.getFolder(folderPath);
    if (!(folder instanceof TFolder) || !folder.name.startsWith("-")) {
      return "设定组不存在。";
    }
    const name = displayName.trim().replace(/^-+/u, "").trim();
    if (!name) {
      return "设定组名称不能为空。";
    }
    const targetName = `-${settingGroupFolderName(name)}`;
    if (targetName === folder.name) {
      return null;
    }
    const parent = host.normalizeFolderPath(folder.parent?.path ?? "/");
    const targetPath = joinVaultPath(parent, targetName);
    if (host.app.vault.getAbstractFileByPath(targetPath)) {
      return "同名设定组已存在。";
    }
    try {
      await host.app.fileManager.renameFile(folder, targetPath);
      return null;
    } catch (error) {
      console.error("Novel View: setting group rename failed", error);
      return "设定组重命名失败。";
    }
  
}

/** 同步重命名记录的详细文件 */
export async function renameSettingRecordDetails(host: SettingCollectionHost, novelRoot: string, group: string, oldKeyword: string, newKeyword: string,): Promise<void> {
    if (oldKeyword === newKeyword) {
      return;
    }
    const folder = getSettingRecordFolder(host, novelRoot, group);
    if (!folder) {
      return;
    }
    const oldPrefix = `${settingDetailPrefix(host, oldKeyword)}-`;
    const newPrefix = `${settingDetailPrefix(host, newKeyword)}-`;
    if (oldPrefix === newPrefix) {
      return;
    }
    const files = host.app.vault.getFiles().filter((file) => (
      file.extension === "md"
      && file.parent?.path === folder.path
      && file.basename.startsWith(oldPrefix)
      && file.basename.length > oldPrefix.length
    ));
    let index = 2;
    for (const file of files) {
      const suffix = file.basename.slice(oldPrefix.length);
      let targetPath = joinVaultPath(folder.path, `${newPrefix}${suffix}.md`);
      while (host.app.vault.getAbstractFileByPath(targetPath)) {
        targetPath = joinVaultPath(
          folder.path,
          `${newPrefix}${suffix} ${index}.md`,
        );
        index += 1;
      }
      try {
        await host.app.fileManager.renameFile(file, targetPath);
      } catch (error) {
        console.debug("Novel View: detail file rename skipped", error);
      }
    }
  
}

/** 把详细文件迁移到目标分组 */
export async function moveSettingRecordDetails(host: SettingCollectionHost, novelRoot: string, sourceGroup: string, targetGroup: string, keyword: string,): Promise<void> {
    if (sourceGroup === targetGroup) {
      return;
    }
    const sourceFolder = getSettingRecordFolder(host, novelRoot, sourceGroup);
    const targetFolder = getSettingRecordFolder(host, novelRoot, targetGroup);
    if (!sourceFolder || !targetFolder) {
      return;
    }
    const prefix = `${settingDetailPrefix(host, keyword)}-`;
    const files = host.app.vault.getFiles().filter((file) => (
      file.extension === "md"
      && file.parent?.path === sourceFolder.path
      && file.basename.startsWith(prefix)
    ));
    let index = 2;
    for (const file of files) {
      let targetPath = joinVaultPath(targetFolder.path, file.name);
      while (host.app.vault.getAbstractFileByPath(targetPath)) {
        targetPath = joinVaultPath(
          targetFolder.path,
          `${file.basename} ${index}.md`,
        );
        index += 1;
      }
      try {
        await host.app.fileManager.renameFile(file, targetPath);
      } catch (error) {
        console.debug("Novel View: detail file move skipped", error);
      }
    }
  
}

/** 重命名分组及其文件夹 */
export async function renameSettingCollectionGroup(host: SettingCollectionHost, settingRoot: string, oldName: string, newName: string,): Promise<string | null> {
    const index = await readSettingCollectionIndex(host, settingRoot);
    if (!Object.prototype.hasOwnProperty.call(index, oldName)) {
      return "设定分组不存在。";
    }
    if (oldName === newName) {
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(index, newName)) {
      return "同名设定分组已存在。";
    }
    const oldFolderPath = joinVaultPath(
      settingRoot,
      settingGroupFolderPathName(host, oldName),
    );
    const newFolderPath = joinVaultPath(
      settingRoot,
      settingGroupFolderPathName(host, newName),
    );
    const oldFolder = host.getFolder(oldFolderPath);
    let renamed = false;
    if (oldFolder && oldFolderPath !== newFolderPath) {
      if (host.app.vault.getAbstractFileByPath(newFolderPath)) {
        return "同名设定分组文件夹已存在。";
      }
      host.suppressSettingGroupFolderRename = true;
      try {
        await host.app.fileManager.renameFile(oldFolder, newFolderPath);
      } finally {
        host.suppressSettingGroupFolderRename = false;
      }
      renamed = true;
    }
    const next: SettingCollectionIndex = {};
    for (const [name, tags] of Object.entries(index)) {
      next[name === oldName ? newName : name] = tags;
    }
    try {
      await writeSettingCollectionIndex(host, settingRoot, next);
      return null;
    } catch (error) {
      if (renamed) {
        const moved = host.getFolder(newFolderPath);
        if (moved) {
          host.suppressSettingGroupFolderRename = true;
          try {
            await host.app.fileManager.renameFile(moved, oldFolderPath);
          } finally {
            host.suppressSettingGroupFolderRename = false;
          }
        }
      }
      console.error("Novel View: setting-group rename failed", error);
      return "设定分组重命名失败。";
    }
  
}

/** 转发到 revealSettingGroup */
export function revealSettingCollectionFolder(host: SettingCollectionHost, folder: TFolder): void {
    revealSettingGroup(host, folder);
  
}

/** 在文件浏览器中定位设定组 */
export function revealSettingGroup(host: SettingCollectionHost, folder: TFolder): void {
    const leaves = host.app.workspace.getLeavesOfType("file-explorer");
    const view = leaves[0]?.view as { revealInFolder?: (target: TFolder) => void };
    if (view?.revealInFolder) {
      try {
        view.revealInFolder(folder);
        return;
      } catch (error) {
        console.debug("Novel View: setting group reveal skipped", error);
      }
    }
    new Notice(`Novel View：设定集位于“${folder.path}”。`);
  
}

/** 防抖调度设定集索引重建 */
export function scheduleSettingCollection(host: SettingCollectionHost, root: string): void {
    const normalized = host.normalizeFolderPath(root);
    const existing = host.settingCollectionTimers.get(normalized);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    const timer = window.setTimeout(() => {
      host.settingCollectionTimers.delete(normalized);
      void ensureSettingCollection(host, normalized);
    }, 120);
    host.settingCollectionTimers.set(normalized, timer);
  
}

/** 生成设定记录文件的完整路径 */
export function settingRecordPath(host: SettingCollectionHost, folder: TFolder, keyword: string): string {
    return joinVaultPath(
      folder.path,
      `${host.sanitizeFileBase(keyword, "设定")}.md`,
    );
  
}

/** 读取目录内记录并聚合标签 */
export async function readSettingGroupRecords(host: SettingCollectionHost, folder: TFolder): Promise<SettingGroupTags> {
    const files = folder.children.filter((child): child is TFile => (
      child instanceof TFile
      && child.extension === "md"
      && child.name !== SETTING_COLLECTION_INDEX
      && !child.name.toLocaleLowerCase().endsWith(".d.md")
    ));
    const contents = new Map<TFile, string>();
    const records = new Map<string, TFile>();
    const details: TFile[] = [];
    for (const file of files) {
      let content = "";
      try {
        content = await host.app.vault.cachedRead(file);
      } catch {
        continue;
      }
      contents.set(file, content);
      if (content.includes(`${SETTING_RECORD_MARKER}: true`) || !file.basename.includes("-")) {
        records.set(file.basename, file);
      } else {
        details.push(file);
      }
    }
    for (const detail of details) {
      const matched = [...records.keys()]
        .filter((name) => detail.basename.startsWith(`${name}-`))
        .sort((left, right) => right.length - left.length)[0];
      const base = matched ?? detail.basename.split("-")[0]?.trim() ?? "";
      if (!base || records.has(base)) {
        continue;
      }
      try {
        const created = await host.app.vault.create(
          settingRecordPath(host, folder, base),
          serializeSettingRecordMarkdown(
            { keyword: base, content: "", fields: [], marks: [] },
            "未分组",
            "#3498db",
          ),
        );
        records.set(base, created);
        contents.set(created, await host.app.vault.cachedRead(created));
      } catch (error) {
        console.debug("Novel View: orphan setting record creation skipped", error);
      }
    }
    const tags = new Map<string, SettingCollectionTag>();
    for (const [keyword, file] of records) {
      const parsed = parseSettingRecordMarkdown(contents.get(file) ?? "", keyword);
      const tagName = parsed.tag || "未分组";
      let tag = tags.get(tagName);
      if (!tag) {
        tag = { tag: tagName, color: parsed.color || "#3498db", contain: [] };
        tags.set(tagName, tag);
      } else if (!tag.color && parsed.color) {
        tag.color = parsed.color;
      }
      tag.contain.push(parsed.entry);
    }
    return [...tags.values()];
  
}

/** 确保索引就绪并返回分组数据 */
export async function ensureSettingCollection(host: SettingCollectionHost, groupPath: string,): Promise<SettingCollectionIndex> {
    const normalized = host.normalizeFolderPath(groupPath);
    const folder = host.getFolder(normalized);
    if (!folder || !folder.name.startsWith("-")) {
      return {};
    }
    const parent = folder.parent
      ? host.normalizeFolderPath(folder.parent.path)
      : "/";
    const novelRoot = host.findNovelGroupRoot(parent);
    if (!novelRoot || parent !== novelRoot) {
      return {};
    }
    host.settingGroups.set(normalized, novelRoot);
    const groupName = settingGroupNameFromFolder(host, folder);
    return { [groupName]: await readSettingGroupRecords(host, folder) };
  
}

/** 登记合法设定组文件夹到映射 */
export function registerSettingGroupFolder(host: SettingCollectionHost, path: string): boolean {
    const folder = host.getFolder(path);
    if (!folder || !folder.name.startsWith("-")) {
      return false;
    }
    const parent = folder.parent;
    if (!parent) {
      return false;
    }
    const novelRoot = host.findNovelGroupRoot(
      host.normalizeFolderPath(parent.path),
    );
    if (!novelRoot || host.normalizeFolderPath(parent.path) !== novelRoot) {
      return false;
    }
    host.settingGroups.set(host.normalizeFolderPath(folder.path), novelRoot);
    host.scheduleNovelFolderDecoration();
    return true;
  
}

/** 响应文件夹路径变化并刷新 */
export function handleSettingGroupPathChange(host: SettingCollectionHost, newPath: string | null, oldPath: string | null,): void {
    if (host.suppressSettingGroupFolderRename) {
      return;
    }
    if (newPath && oldPath && isSettingGroupFolderPath(host, newPath, oldPath)) {
      void handleSettingGroupFolderRename(host, oldPath, newPath);
      return;
    }
    const roots = new Set<string>();
    if (newPath && registerSettingGroupFolder(host, newPath)) {
      roots.add(host.normalizeFolderPath(newPath));
    }
    if (oldPath) {
      const oldRoot = settingRootForPath(host, oldPath);
      if (oldRoot) {
        roots.add(oldRoot);
      }
      if (host.settingGroups.has(oldPath)) {
        const novelRoot = host.settingGroups.get(oldPath);
        host.settingGroups.delete(oldPath);
        if (newPath && novelRoot) {
          host.settingGroups.set(newPath, novelRoot);
          roots.add(newPath);
        }
        host.scheduleNovelFolderDecoration();
      }
    }
    if (newPath) {
      const newRoot = settingRootForPath(host, newPath);
      if (newRoot) {
        roots.add(newRoot);
      }
    }
    for (const root of roots) {
      scheduleSettingCollection(host, root);
    }
  
}

/** 判断路径是否处于设定组内 */
export function isSettingGroupFolderPath(host: SettingCollectionHost, newPath: string, oldPath: string): boolean {
    const oldGroupPath = host.settingGroups.has(oldPath)
      ? oldPath
      : settingRootForPath(host, oldPath);
    if (!oldGroupPath) {
      return false;
    }
    const novelRoot = host.settingGroups.get(oldGroupPath)
      ?? settingRootForPath(host, oldPath);
    if (!novelRoot) {
      return false;
    }
    const parent = (path: string): string => (
      path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
    );
    return parent(oldPath) === novelRoot
      && parent(newPath) === novelRoot
      && host.getFolder(newPath) instanceof TFolder;
  
}

/** 处理设定组文件夹重命名 */
export async function handleSettingGroupFolderRename(host: SettingCollectionHost, oldPath: string, newPath: string,): Promise<void> {
    const settingRoot = settingRootForPath(host, oldPath);
    if (!settingRoot) {
      return;
    }
    const newFolder = host.getFolder(newPath);
    if (!newFolder) {
      return;
    }
    const oldName = host.normalizeFolderPath(oldPath)
      .split("/").pop()?.replace(/^-+/u, "").trim() ?? "";
    const newName = settingGroupNameFromFolder(host, newFolder);
    if (!newName) {
      await revertSettingGroupFolder(host, newPath, settingRoot, oldName);
      return;
    }
    const desiredPath = joinVaultPath(
      host.normalizeFolderPath(newFolder.parent?.path ?? "/"),
      settingGroupFolderPathName(host, newName),
    );
    if (newFolder.path !== desiredPath) {
      if (host.app.vault.getAbstractFileByPath(desiredPath)) {
        new Notice(`Novel View：设定组“${newName}”已存在。`);
        await revertSettingGroupFolder(host, newPath, settingRoot, oldName);
        return;
      }
      host.suppressSettingGroupFolderRename = true;
      try {
        await host.app.fileManager.renameFile(newFolder, desiredPath);
      } catch (error) {
        console.error("Novel View: setting group prefix failed", error);
        await revertSettingGroupFolder(host, newPath, settingRoot, oldName);
        return;
      } finally {
        host.suppressSettingGroupFolderRename = false;
      }
    }
    host.settingGroups.delete(host.normalizeFolderPath(oldPath));
    const moved = host.getFolder(desiredPath);
    if (moved) {
      host.settingGroups.set(moved.path, settingRoot);
      for (const leaf of host.app.workspace.getLeavesOfType(
        SETTING_COLLECTION_VIEW_TYPE,
      )) {
        if (leaf.view instanceof SettingCollectionView) {
          const state = leaf.getViewState().state as { folderPath?: unknown };
          const current = typeof state.folderPath === "string"
            ? state.folderPath
            : "";
          if (
            current === oldPath
            || current.startsWith(`${oldPath}/`)
          ) {
            await leaf.setViewState({
              type: SETTING_COLLECTION_VIEW_TYPE,
              state: {
                folderPath: moved.path + current.slice(oldPath.length),
              },
              active: false,
            });
          }
        }
      }
    }
    host.scheduleNovelFolderDecoration();
  
}

/** 重命名失败时回滚文件夹名 */
export async function revertSettingGroupFolder(host: SettingCollectionHost, currentPath: string, settingRoot: string, oldKey: string,): Promise<void> {
    if (!oldKey) {
      return;
    }
    const current = host.getFolder(currentPath);
    const targetPath = joinVaultPath(
      settingRoot,
      settingGroupFolderPathName(host, oldKey),
    );
    if (!current || current.path === targetPath) {
      return;
    }
    if (host.app.vault.getAbstractFileByPath(targetPath)) {
      return;
    }
    host.suppressSettingGroupFolderRename = true;
    try {
      await host.app.fileManager.renameFile(current, targetPath);
    } catch (error) {
      console.debug("Novel View: setting group folder revert skipped", error);
    } finally {
      host.suppressSettingGroupFolderRename = false;
    }
  
}

/** 兜底处理设定组文件夹点击 */
export function handleSettingGroupFolderClickFallback(host: SettingCollectionHost, event: MouseEvent): void {
    if (event.defaultPrevented) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!target || target.closest(".nav-folder-collapse-indicator, .collapse-icon")) {
      return;
    }
    const folderTitle = target.closest<HTMLElement>(".nav-folder-title");
    const path = folderTitle?.dataset.path;
    if (!folderTitle || !path) {
      return;
    }
    const folder = host.app.vault.getAbstractFileByPath(path);
    if (
      !(folder instanceof TFolder)
      || !folder.name.startsWith("-")
    ) {
      return;
    }
    const parent = host.normalizeFolderPath(folder.parent?.path ?? "/");
    if (host.findNovelGroupRoot(parent) !== parent) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void host.openSettingCollection(folder.path);
  
}