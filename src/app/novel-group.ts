/**
 * 小说组与其配置（novel.json）：定位、读写、迁移与封面。
 * 从 main.ts 迁出（D3）。
 */

import { Notice, TFile, TFolder } from "obsidian";
import { ARTICLE_LIST_VIEW_TYPE } from "../features/article-list/article-list-view";
import { createNovelConfigContent, getNovelConfigPath, isNovelConfigFile, joinVaultPath, pruneNovelHistory, LEGACY_NOVEL_SETTING_FILENAME, normalizeCoverPath, parseNovelConfig, serializeNovelConfig, NovelConfig, NovelGroupInfo } from "../core/model/novel-config";
import { WORKBENCH_VIEW_TYPE } from "../features/workbench/workbench-view";
import type { PluginBase } from "./plugin-context";

export interface NovelGroupHost extends PluginBase {
  isSpecialNovelFile(file: TFile): boolean;
  findNovelGroupRoot(folderPath: string): string | null;
  /** 把图片写入素材库并返回落盘文件。 */
  saveImageToVault(
    file: File,
    sourcePath: string,
    folderPath?: string,
  ): Promise<TFile | null>;
  normalizeFolderPath(path: string): string;
  getFolder(path: string): TFolder | null;
  readonly novelConfigs: Map<string, NovelConfig>;
  chooseLocalImage(): Promise<File | null>;
  updateVolumeMeta(folderPath: string, volume: string, patch: { description?: string; cover?: string },): Promise<void>;
  refreshWorkbenchViews(): void;
  readonly volumeOrder: Map<string, string[]>;
  sanitizeFileBase(value: string, fallback: string): string;
  workbenchFolderPath: string | null;
  scheduleNovelFolderDecoration(): void;
  readonly settingGroups: Map<string, string>;
  openSettingCollection(folderPath: string, focus?: { group: string; tag: string; keyword: string },): Promise<void>;
  openArticleList(folderPath: string): Promise<void>;
  createSettingGroup(novelPath: string): Promise<void>;
  activateWorkbench(): Promise<void>;
  refreshOpenViews(): void;
  settingRootForPath(path: string): string | null;
}

/** 把封面配置解析为可直接加载的资源地址 */
export function getNovelCoverUrl(host: NovelGroupHost, folderPath: string, value: string): string | null {
    const cover = normalizeCoverPath(value);
    if (!cover) {
      return null;
    }
    if (/^https?:\/\//iu.test(cover)) {
      return cover;
    }
    const group = findNovelGroupRoot(host, folderPath)
      ?? host.normalizeFolderPath(folderPath);
    const candidates = [
      cover,
      joinVaultPath(group, cover),
      joinVaultPath(group, "src", cover),
      joinVaultPath(group, "src", cover.split("/").pop() ?? cover),
    ];
    for (const candidate of [...new Set(candidates)]) {
      const file = host.app.vault.getAbstractFileByPath(candidate);
      if (file instanceof TFile) {
        return host.app.vault.adapter.getResourcePath(file.path);
      }
    }
    return null;
  
}

/** 读取目录下的小说组配置文件对象 */
export function getNovelSettingFile(host: NovelGroupHost, folderPath: string): TFile | null {
    const folder = host.getFolder(folderPath);
    if (!folder) {
      return null;
    }
    const configPath = getNovelConfigPath(folder.path);
    const file = host.app.vault.getAbstractFileByPath(configPath);
    return file instanceof TFile ? file : null;
  
}

/** 自当前目录向上逐级查找小说组根目录 */
export function findNovelGroupRoot(host: NovelGroupHost, folderPath: string): string | null {
    let current = host.normalizeFolderPath(folderPath);
    for (;;) {
      if (getNovelSettingFile(host, current)) {
        return current;
      }
      if (current === "/" || !current) {
        return null;
      }
      const index = current.lastIndexOf("/");
      current = index <= 0 ? "/" : current.slice(0, index);
    }
  
}

/** 汇总小说组名称、简介与封面等信息 */
export function getNovelGroupInfo(host: NovelGroupHost, folderPath: string): NovelGroupInfo | null {
    const folder = host.getFolder(folderPath);
    if (!folder || !getNovelSettingFile(host, folder.path)) {
      return null;
    }
    const config = host.novelConfigs.get(folder.path) ?? parseNovelConfig({});
    return {
      folderPath: folder.path,
      name: folder.name,
      description: config["novel-description"],
      cover: config["novel-cover"],
      state: "writing",
    };
  
}

/** 让用户选择图片并更新指定卷的封面 */
export async function editNovelVolumeCover(host: NovelGroupHost, folderPath: string, volume: string): Promise<void> {
    const setting = getNovelSettingFile(host, folderPath);
    if (!setting) {
      return;
    }
    const file = await host.chooseLocalImage();
    if (!file) {
      return;
    }
    const group = findNovelGroupRoot(host, folderPath) ?? host.normalizeFolderPath(folderPath);
    const saved = await host.saveImageToVault(
      file,
      setting.path,
      joinVaultPath(group, "src"),
    );
    if (saved) {
      await host.updateVolumeMeta(group, volume, { cover: saved.path });
    }
  
}

/** 收集已被小说组与各卷引用的封面路径 */
export function getUsedNovelCovers(host: NovelGroupHost, folderPath: string): Set<string> {
    const config = getNovelConfig(host, folderPath);
    const used = new Set<string>();
    if (config["novel-cover"]) {
      used.add(config["novel-cover"]);
    }
    for (const meta of Object.values(config.volumes)) {
      if (meta.cover) {
        used.add(meta.cover);
      }
    }
    return used;
  
}

/** 保留旧版设定集入口判断但恒为假 */
export function isSettingCollectionIndexPath(host: NovelGroupHost, _path: string): boolean {
    // 兼容旧数据迁移，但不再把 index.md 当作设定集合入口。
    return false;
  
}

/** 判断文件是否为配置或设定集索引 */
export function isSpecialNovelFile(host: NovelGroupHost, file: TFile): boolean {
    return isNovelConfigFile(file)
      || isSettingCollectionIndexPath(host, file.path);
  
}

/** 读取并缓存小说配置，失败时回退空配置 */
export async function readNovelConfig(host: NovelGroupHost, folderPath: string): Promise<NovelConfig> {
    const group = host.normalizeFolderPath(folderPath);
    const cached = host.novelConfigs.get(group);
    if (cached) {
      return cached;
    }
    const file = getNovelSettingFile(host, group);
    if (!file) {
      const empty = parseNovelConfig({});
      host.novelConfigs.set(group, empty);
      return empty;
    }
    try {
      const raw = await host.app.vault.cachedRead(file);
      const config = parseNovelConfig(JSON.parse(raw));
      host.novelConfigs.set(group, config);
      return config;
    } catch (error) {
      console.error("Novel View: novel.json read failed", error);
      const empty = parseNovelConfig({});
      host.novelConfigs.set(group, empty);
      return empty;
    }
  
}

/** 裁剪历史后写入配置文件并刷新缓存 */
export async function writeNovelConfig(host: NovelGroupHost, folderPath: string, config: NovelConfig): Promise<void> {
    const group = host.normalizeFolderPath(folderPath);
    const path = getNovelConfigPath(group);
    config.history = pruneNovelHistory(config.history);
    const text = serializeNovelConfig(config);
    const existing = host.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await host.app.vault.modify(existing, text);
    } else {
      await host.app.vault.create(path, text);
    }
    host.novelConfigs.set(group, config);
    host.refreshWorkbenchViews();
  
}

/** 把旧版设定文件迁移为新版 JSON 配置 */
export async function migrateNovelConfigs(host: NovelGroupHost): Promise<void> {
    const legacyFiles = host.app.vault.getMarkdownFiles().filter(
      (file) => file.name === LEGACY_NOVEL_SETTING_FILENAME,
    );
    for (const file of legacyFiles) {
      const folder = file.parent;
      if (!folder) {
        continue;
      }
      const configPath = getNovelConfigPath(folder.path);
      const configFile = host.app.vault.getAbstractFileByPath(configPath);
      if (!(configFile instanceof TFile)) {
        const frontmatter = host.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
        const config = parseNovelConfig({});
        config["novel-description"] = typeof frontmatter["novel-description"] === "string"
          ? frontmatter["novel-description"]
          : "";
        config["novel-cover"] = typeof frontmatter["novel-cover"] === "string"
          ? normalizeCoverPath(frontmatter["novel-cover"])
          : "";
        await host.app.vault.create(configPath, serializeNovelConfig(config));
        host.novelConfigs.set(folder.path, config);
      }
    }
  
}

/** 扫描仓库内全部小说配置并载入缓存 */
export async function loadNovelConfigs(host: NovelGroupHost): Promise<void> {
    host.novelConfigs.clear();
    for (const file of host.app.vault.getFiles()) {
      if (!isNovelConfigFile(file) || !file.parent) {
        continue;
      }
      try {
        const raw: unknown = JSON.parse(await host.app.vault.cachedRead(file));
        const history = (raw as { history?: unknown } | null)?.history;
        const oldHistoryCount = Array.isArray(history) ? history.length : 0;
        const config = parseNovelConfig(raw);
        if (config["volume-order"].length === 0 && host.volumeOrder instanceof Map) {
          const legacyOrder = host.volumeOrder.get(file.parent.path);
          if (Array.isArray(legacyOrder) && legacyOrder.length > 0) {
            config["volume-order"] = [...legacyOrder];
          }
        }
        host.novelConfigs.set(file.parent.path, config);
        if (oldHistoryCount > config.history.length) {
          await writeNovelConfig(host, file.parent.path, config);
        }
      } catch (error) {
        console.error("Novel View: invalid novel.json", file.path, error);
      }
    }
  
}

/** 取缓存的配置，缺失时返回空配置 */
export function getNovelConfig(host: NovelGroupHost, folderPath: string): NovelConfig {
    return host.novelConfigs.get(host.normalizeFolderPath(folderPath))
      ?? parseNovelConfig({});
  
}

/** 按补丁更新小说简介或封面并保存 */
export async function updateNovelInfo(host: NovelGroupHost, folderPath: string, patch: { description?: string; cover?: string },): Promise<void> {
    const group = host.normalizeFolderPath(folderPath);
    const config = await readNovelConfig(host, group);
    if (patch.description !== undefined) {
      config["novel-description"] = patch.description;
    }
    if (patch.cover !== undefined) {
      config["novel-cover"] = normalizeCoverPath(patch.cover);
    }
    await writeNovelConfig(host, group, config);
  
}

/** 选择本地图片保存为小说封面并写入配置 */
export async function editNovelCover(host: NovelGroupHost, folderPath: string): Promise<void> {
    const setting = getNovelSettingFile(host, folderPath);
    if (!setting) {
      return;
    }
    const file = await host.chooseLocalImage();
    if (!file) {
      return;
    }
    const group = findNovelGroupRoot(host, folderPath) ?? host.normalizeFolderPath(folderPath);
    const saved = await host.saveImageToVault(
      file,
      setting.path,
      joinVaultPath(group, "src"),
    );
    if (saved) {
      await updateNovelInfo(host, group, { cover: saved.path });
    }
  
}

/** 安全重命名小说组目录并同步相关状态 */
export async function renameNovelGroupFolder(host: NovelGroupHost, folderPath: string, value: string,): Promise<void> {
    const folder = host.getFolder(folderPath);
    if (!folder) {
      return;
    }
    const name = host.sanitizeFileBase(value, folder.name);
    if (!name || name === folder.name) {
      return;
    }
    const parent = host.normalizeFolderPath(folder.parent?.path ?? "/");
    const nextPath = joinVaultPath(parent, name);
    if (host.app.vault.getAbstractFileByPath(nextPath)) {
      new Notice("Novel View：同名文件夹已存在。");
      return;
    }
    const cachedConfig = host.novelConfigs.get(folderPath);
    await host.app.fileManager.renameFile(folder, nextPath);
    if (cachedConfig) {
      host.novelConfigs.delete(folderPath);
      host.novelConfigs.set(nextPath, cachedConfig);
    }
    if (host.workbenchFolderPath === folderPath) {
      host.workbenchFolderPath = nextPath;
    }
    for (const leaf of host.app.workspace.getLeavesOfType(ARTICLE_LIST_VIEW_TYPE)) {
      const state = leaf.getViewState().state as { folderPath?: unknown };
      if (state.folderPath === folderPath) {
        await leaf.setViewState({
          type: ARTICLE_LIST_VIEW_TYPE,
          state: { folderPath: nextPath },
          active: true,
        });
      }
    }
    host.refreshWorkbenchViews();
    host.scheduleNovelFolderDecoration();
  
}

/** 列出所有含配置文件的小说组根目录 */
export function novelRoots(host: NovelGroupHost): string[] {
    const roots = new Set<string>();
    for (const file of host.app.vault.getFiles()) {
      if (file.name === "novel.json" && file.parent) {
        roots.add(host.normalizeFolderPath(file.parent.path));
      }
    }
    return [...roots];
  
}



/** 判断名称是否为设定集等保留目录 */
export function isReservedNovelFolder(host: NovelGroupHost, name: string): boolean {
    return name.startsWith("-")
      || /^(src|分散卷)$/iu.test(name);
  
}

/** 校验后初始化小说组并打开工作台 */
export async function createNovelGroup(host: NovelGroupHost, folder: TFolder): Promise<void> {
    const folderPath = host.normalizeFolderPath(folder.path);
    if (folder.name.startsWith("-")) {
      new Notice("Novel View：以 - 开头的文件夹保留给设定集，不能构建小说组。");
      return;
    }
    if (folderPath === "/") {
      new Notice("Novel View：仓库根目录不能设置为小说组。");
      return;
    }
    const settingPath = getNovelConfigPath(folderPath);
    const existing = host.app.vault.getAbstractFileByPath(settingPath);
    if (existing instanceof TFile && isNovelConfigFile(existing)) {
      host.workbenchFolderPath = folderPath;
      await host.openArticleList(folderPath);
      await host.activateWorkbench();
      host.refreshWorkbenchViews();
      return;
    }
    if (existing) {
      new Notice("Novel View：无法创建 novel.json，同名路径已存在。");
      return;
    }
    try {
      await host.app.vault.create(settingPath, createNovelConfigContent());
      host.novelConfigs.set(folderPath, parseNovelConfig({}));
      host.workbenchFolderPath = folderPath;
      await host.openArticleList(folderPath);
      await host.activateWorkbench();
      host.refreshOpenViews();
      new Notice(`Novel View：已创建小说组“${folder.name}”。`);
    } catch (error) {
      console.error("Novel View: failed to create novel group", error);
      new Notice("Novel View：小说组创建失败。");
    }
  
}

/** 拦截文件树点击并打开对应小说视图 */
export function handleNovelFolderClick(host: NovelGroupHost, event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    if (target.closest(".nav-folder-collapse-indicator, .collapse-icon")) {
      return;
    }
    const folderTitle = target.closest<HTMLElement>(".nav-folder-title");
    const path = folderTitle?.dataset.path
      ?? folderTitle?.closest<HTMLElement>(".nav-folder")?.dataset.path;
    if (!folderTitle || !path) {
      return;
    }
    const folder = host.app.vault.getAbstractFileByPath(path);
    if (!(folder instanceof TFolder)) {
      return;
    }
    if (folder.name.startsWith("-")) {
      if (target.closest(".nav-folder-collapse-indicator, .collapse-icon")) {
        return;
      }
      const parent = host.normalizeFolderPath(folder.parent?.path ?? "/");
      if (findNovelGroupRoot(host, parent) === parent) {
        event.preventDefault();
        event.stopPropagation();
        void host.openSettingCollection(folder.path);
      }
      return;
    }
    if (!getNovelSettingFile(host, folder.path)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    host.workbenchFolderPath = host.normalizeFolderPath(folder.path);
    void host.openArticleList(folder.path).then(() => {
      const workbenches = host.app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE);
      if (workbenches.length === 0) {
        void host.activateWorkbench();
      } else {
        host.refreshWorkbenchViews();
      }
    });
  
}

/** 判断普通文件是否应强制使用小说模式 */
export function isForcedNovelMode(host: NovelGroupHost, file: TFile): boolean {
  if (!file || host.isSpecialNovelFile(file)) {
    return false;
  }
  const folderPath = host.normalizeFolderPath(file.parent?.path ?? "/");
  return host.findNovelGroupRoot(folderPath) !== null;
}

/** 判断文件是否属于小说正文内容 */
export function isNovelArticleFile(host: NovelGroupHost, file: TFile): boolean {
    if (
      file.extension !== "md"
      || isSpecialNovelFile(host, file)
      || host.settingRootForPath(file.path)
    ) {
      return false;
    }
    const parent = host.normalizeFolderPath(file.parent?.path ?? "/");
    return findNovelGroupRoot(host, parent) !== null;
  
}