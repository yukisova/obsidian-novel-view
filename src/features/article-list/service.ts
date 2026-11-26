/**
 * 文章列表与卷章：分组、排序、路径迁移、撤销与右键菜单。
 * 从 main.ts 迁出（D4）。
 */

import { Menu, Notice, TFile, TFolder } from "obsidian";
import { ARTICLE_LIST_VIEW_TYPE, ArticleEntry, ArticleListModel, ArticleListTarget } from "./article-list-view";
import { CHAPTER_STATUS_LABELS, CHAPTER_STATUS_PROPERTY, readChapterStatus, ChapterStatus } from "../../core/model/chapter-status";
import { countNovelCharacters } from "../../core/text/status";
import { joinVaultPath, normalizeCoverPath, NovelArticleGroup, NovelConfig } from "../../core/model/novel-config";
import { confirmAction } from "../../ui/confirm-modal";
import { ArticleGroupModal } from "./article-group-modal";
import { VolumeEditModal } from "./volume-edit-modal";
import { ChapterMeta } from "../../app/types";
import type { PluginBase } from "../../app/plugin-context";

export interface ArticleListHost extends PluginBase {
  getArticleListModel(folderPath: string): ArticleListModel | null;
  readonly chapterMetaCache: Map<string, ChapterMeta>;
  refreshOpenViews(): void;
  getFolder(path: string): TFolder | null;
  sanitizeFileBase(value: string, fallback: string): string;
  getUniqueMarkdownPath(folderPath: string, base: string): string;
  openNovelEditor(file: TFile, line?: number): Promise<void>;
  findNovelGroupRoot(folderPath: string): string | null;
  normalizeFolderPath(path: string): string;
  readNovelConfig(folderPath: string): Promise<NovelConfig>;
  writeNovelConfig(folderPath: string, config: NovelConfig): Promise<void>;
  readonly wordCountBaselines: Map<string, number>;
  refreshWorkbenchViews(): void;
  readonly novelConfigs: Map<string, NovelConfig>;
  getNovelConfig(folderPath: string): NovelConfig;
  isSpecialNovelFile(file: TFile): boolean;
  isReservedNovelFolder(name: string): boolean;
  readonly articleUndoStack: Array<() => Promise<void>>;
  openNovelEditorInNewTab(file: TFile): Promise<void>;
  exportChapterTargets(targets: ArticleListTarget[], folderPath: string,): Promise<void>;
  getNovelCoverUrl(folderPath: string, value: string): string | null;
  editNovelVolumeCover(folderPath: string, volume: string): Promise<void>;
  exportVolumeTarget(target: ArticleListTarget): Promise<void>;
  createVolumeInFolder(folderPath: string): Promise<void>;
}

/** 通知所有打开的文章列表刷新 */
export function refreshArticleListViews(host: ArticleListHost): void {
    for (const leaf of host.app.workspace.getLeavesOfType(ARTICLE_LIST_VIEW_TYPE)) {
      const view = leaf.view as { scheduleRefresh?: () => void };
      view.scheduleRefresh?.();
    }
  
}

/** 读取章节字数、状态与对照组数量 */
export async function getChapterMeta(host: ArticleListHost, path: string): Promise<ChapterMeta> {
    const file = host.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return { wordCount: 0, status: "todo", pendingCount: 0 };
    }
    try {
      const content = await host.app.vault.cachedRead(file);
      const status = readChapterStatus(
        host.app.metadataCache.getFileCache(file)?.frontmatter,
      );
      const meta = {
        wordCount: countNovelCharacters(content),
        status,
        pendingCount: (
          content.match(/```(?:待修改部分|对照组)[^\n]*\n[\s\S]*?```/gu)
          ?? []
        ).length,
      };
      host.chapterMetaCache.set(path, meta);
      return meta;
    } catch (error) {
      console.debug("Novel View: chapter meta read skipped", error);
      return host.chapterMetaCache.get(path)
        ?? { wordCount: 0, status: "todo", pendingCount: 0 };
    }
  
}

/** 写入章节状态并清除元数据缓存 */
export async function setChapterStatus(host: ArticleListHost, file: TFile, status: ChapterStatus): Promise<void> {
    await host.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      frontmatter[CHAPTER_STATUS_PROPERTY] = CHAPTER_STATUS_LABELS[status];
    });
    host.chapterMetaCache.delete(file.path);
    host.refreshOpenViews();
  
}

/** 在指定目录新建带编号的空白章节 */
export async function createArticleInFolder(host: ArticleListHost, folderPath: string, currentPath: string, title: string,): Promise<void> {
    const folder = host.getFolder(currentPath) ?? host.getFolder(folderPath);
    if (!folder) {
      new Notice("Novel View：当前文章目录不存在。");
      return;
    }
    const base = host.sanitizeFileBase(title, "未命名文章");
    const path = host.getUniqueMarkdownPath(folder.path, base);
    const content = [
      "---",
      `novelview-id: ${getNextArticleId(host, folder.path)}`,
      `${CHAPTER_STATUS_PROPERTY}: ${CHAPTER_STATUS_LABELS.todo}`,
      "---",
      "",
    ].join("\n");
    try {
      const file = await host.app.vault.create(path, content);
      await renumberFolder(host, folder.path);
      await host.openNovelEditor(file);
      host.refreshOpenViews();
    } catch (error) {
      console.error("Novel View: failed to create article", error);
      new Notice("Novel View：文章创建失败。");
    }
  
}

/** 校正文章组使其成员保持连续 */
export async function normalizeArticleGroups(host: ArticleListHost, folderPath: string): Promise<void> {
    const root = host.findNovelGroupRoot(folderPath)
      ?? host.normalizeFolderPath(folderPath);
    await ensureVolumeOrder(host, root);
    const config = await host.readNovelConfig(root);
    const groups = config["article-groups"];
    if (groups.length === 0) {
      return;
    }
    const model = host.getArticleListModel(root);
    if (!model) {
      return;
    }
    const order = new Map<string, { volume: string; index: number }>();
    model.articles.forEach((article, index) => {
      order.set(article.path, { volume: "", index });
    });
    model.volumes.forEach((volume) => {
      volume.articles.forEach((article, index) => {
        order.set(article.path, { volume: volume.name, index });
      });
    });
    const used = new Set<string>();
    const normalized: NovelArticleGroup[] = [];
    for (const group of groups) {
      const entries = group.paths
        .map((path) => ({ path, position: order.get(path) }))
        .filter((entry): entry is { path: string; position: { volume: string; index: number } } => (
          !!entry.position
          && entry.position.volume === (group.volume || "")
        ))
        .sort((left, right) => left.position.index - right.position.index);
      const runs: Array<Array<{ path: string; position: { volume: string; index: number } }>> = [];
      let current: Array<{ path: string; position: { volume: string; index: number } }> = [];
      for (const entry of entries) {
        const previous = current[current.length - 1];
        if (
          previous
          && (
            previous.position.volume !== entry.position.volume
            || entry.position.index !== previous.position.index + 1
          )
        ) {
          runs.push(current);
          current = [];
        }
        current.push(entry);
      }
      if (current.length > 0) {
        runs.push(current);
      }
      let runIndex = 0;
      for (const run of runs) {
        const paths = run
          .map((entry) => entry.path)
          .filter((path) => !used.has(path));
        if (paths.length < 2) {
          continue;
        }
        const positions = paths.map((path) => order.get(path)!).sort((a, b) => a.index - b.index);
        if (
          positions.some((position, index) => (
            position.volume !== positions[0].volume
            || position.index !== positions[0].index + index
          ))
        ) {
          continue;
        }
        const volume = positions[0].volume;
        const suffix = runIndex === 0 ? "" : `（${runIndex + 1}）`;
        normalized.push({
          ...group,
          id: runIndex === 0 ? group.id : `${group.id}-${runIndex + 1}`,
          name: `${group.name}${suffix}`,
          volume,
          paths,
        });
        for (const path of paths) {
          used.add(path);
        }
        runIndex += 1;
      }
    }
    if (JSON.stringify(normalized) !== JSON.stringify(groups)) {
      config["article-groups"] = normalized;
      await host.writeNovelConfig(root, config);
    }
  
}

/** 同步文件改名或移动后的配置路径 */
export async function handleArticlePathChange(host: ArticleListHost, oldPath: string, newPath: string, isFolder = false,): Promise<void> {
    if (oldPath === newPath) {
      return;
    }
    const baseline = host.wordCountBaselines.get(oldPath);
    if (baseline !== undefined) {
      host.wordCountBaselines.delete(oldPath);
      host.wordCountBaselines.set(newPath, baseline);
    }
    const oldParent = oldPath.includes("/")
      ? oldPath.slice(0, oldPath.lastIndexOf("/"))
      : "";
    const newParent = newPath.includes("/")
      ? newPath.slice(0, newPath.lastIndexOf("/"))
      : "";
    const oldRoot = host.findNovelGroupRoot(oldParent);
    const newRoot = host.findNovelGroupRoot(newParent);
    const oldName = oldPath.split("/").pop() ?? "";
    const newName = newPath.split("/").pop() ?? "";
    if (oldRoot) {
      const config = await host.readNovelConfig(oldRoot);
      let changed = false;
      if (isFolder) {
        const oldPrefix = `${oldPath}/`;
        const newPrefix = `${newPath}/`;
        for (const [baselinePath, count] of [...host.wordCountBaselines.entries()]) {
          if (baselinePath.startsWith(oldPrefix)) {
            host.wordCountBaselines.delete(baselinePath);
            host.wordCountBaselines.set(
              `${newPrefix}${baselinePath.slice(oldPrefix.length)}`,
              count,
            );
          }
        }
        for (const group of config["article-groups"]) {
          const nextPaths = group.paths.map((path) => (
            path.startsWith(oldPrefix) ? `${newPrefix}${path.slice(oldPrefix.length)}` : path
          ));
          if (nextPaths.some((path, index) => path !== group.paths[index])) {
            group.paths = nextPaths;
            changed = true;
          }
          if (group.volume === oldName) {
            group.volume = newName;
            changed = true;
          }
        }
        for (const entry of config.history) {
          if (entry.path.startsWith(oldPrefix)) {
            entry.path = `${newPrefix}${entry.path.slice(oldPrefix.length)}`;
            changed = true;
          }
        }
        if (config.volumes[oldName]) {
          config.volumes[newName] = config.volumes[oldName];
          delete config.volumes[oldName];
          changed = true;
        }
        const order = config["volume-order"];
        if (order.includes(oldName)) {
          order[order.indexOf(oldName)] = newName;
          changed = true;
        }
      } else {
        const folderGone = !host.getFolder(oldParent);
        if (folderGone && newRoot === oldRoot && oldParent !== newParent) {
          const oldPrefix = `${oldParent}/`;
          const newPrefix = `${newParent}/`;
          const oldVolumeName = oldParent.split("/").pop() ?? "";
          const newVolumeName = newParent.split("/").pop() ?? "";
          for (const group of config["article-groups"]) {
            const nextPaths = group.paths.map((path) => (
              path.startsWith(oldPrefix) ? `${newPrefix}${path.slice(oldPrefix.length)}` : path
            ));
            if (nextPaths.some((path, index) => path !== group.paths[index])) {
              group.paths = nextPaths;
              changed = true;
            }
            if (group.volume === oldVolumeName) {
              group.volume = newVolumeName;
              changed = true;
            }
          }
          for (const entry of config.history) {
            if (entry.path.startsWith(oldPrefix)) {
              entry.path = `${newPrefix}${entry.path.slice(oldPrefix.length)}`;
              changed = true;
            }
          }
          if (config.volumes[oldVolumeName]) {
            config.volumes[newVolumeName] = config.volumes[oldVolumeName];
            delete config.volumes[oldVolumeName];
            changed = true;
          }
          const order = config["volume-order"];
          if (order.includes(oldVolumeName)) {
            order[order.indexOf(oldVolumeName)] = newVolumeName;
            changed = true;
          }
        } else {
          for (const group of config["article-groups"]) {
            const index = group.paths.indexOf(oldPath);
            if (index >= 0) {
              if (newRoot === oldRoot) {
                group.paths[index] = newPath;
              } else {
                group.paths.splice(index, 1);
              }
              changed = true;
            }
          }
          for (const entry of config.history) {
            if (entry.path === oldPath) {
              entry.path = newPath;
              entry.name = newPath.split("/").pop()?.replace(/\.md$/iu, "") ?? entry.name;
              changed = true;
            }
          }
        }
      }
      if (changed) {
        await host.writeNovelConfig(oldRoot, config);
      }
      await normalizeArticleGroups(host, oldRoot);
    }
    if (newRoot && newRoot !== oldRoot) {
      await normalizeArticleGroups(host, newRoot);
    }
    refreshArticleListViews(host);
    host.refreshWorkbenchViews();
  
}

/** 清理被删除路径在文章组中的引用 */
export async function handleArticlePathDeleted(host: ArticleListHost, path: string): Promise<void> {
    host.wordCountBaselines.delete(path);
    const roots = [...host.novelConfigs.keys()];
    for (const root of roots) {
      const config = await host.readNovelConfig(root);
      let changed = false;
      for (const group of config["article-groups"]) {
        const next = group.paths.filter(
          (entry) => entry !== path && !entry.startsWith(`${path}/`),
        );
        if (next.length !== group.paths.length) {
          group.paths = next;
          changed = true;
        }
      }
      if (changed) {
        await host.writeNovelConfig(root, config);
        await normalizeArticleGroups(host, root);
      }
    }
  
}

/** 读取小说组的文章组列表 */
export function getArticleGroups(host: ArticleListHost, folderPath: string): NovelArticleGroup[] {
    return host.getNovelConfig(folderPath)["article-groups"];
  
}

/** 查找包含指定文章的文章组 */
export function getArticleGroupForPath(host: ArticleListHost, folderPath: string, path: string): NovelArticleGroup | null {
    return getArticleGroups(host, folderPath).find((group) => group.paths.includes(path)) ?? null;
  
}

/** 保存新建文章组并移除重复归属 */
export async function saveArticleGroup(host: ArticleListHost, folderPath: string, payload: { volume: string; name: string; description: string; paths: string[] },): Promise<void> {
    const group = host.findNovelGroupRoot(folderPath) ?? host.normalizeFolderPath(folderPath);
    const config = await host.readNovelConfig(group);
    const paths = [...new Set(payload.paths)];
    config["article-groups"] = config["article-groups"].filter((entry) => (
      !entry.paths.some((path) => paths.includes(path))
    ));
    config["article-groups"].push({
      id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      volume: payload.volume,
      name: payload.name,
      description: payload.description,
      paths,
    });
    await host.writeNovelConfig(group, config);
    await normalizeArticleGroups(host, group);
  
}

/** 把文章追加到指定文章组末尾 */
export async function addArticlesToGroup(host: ArticleListHost, folderPath: string, groupId: string, paths: string[],): Promise<void> {
    const root = host.findNovelGroupRoot(folderPath) ?? host.normalizeFolderPath(folderPath);
    const config = await host.readNovelConfig(root);
    const group = config["article-groups"].find((entry) => entry.id === groupId);
    if (!group) {
      return;
    }
    for (const entry of config["article-groups"]) {
      if (entry.id !== groupId) {
        entry.paths = entry.paths.filter((path) => !paths.includes(path));
      }
    }
    group.paths = [...new Set([...group.paths, ...paths])];
    await host.writeNovelConfig(root, config);
    await normalizeArticleGroups(host, root);
  
}

/** 更新文章组的名称与描述 */
export async function updateArticleGroup(host: ArticleListHost, folderPath: string, groupId: string, draft: { name: string; description: string },): Promise<void> {
    const root = host.findNovelGroupRoot(folderPath) ?? host.normalizeFolderPath(folderPath);
    const config = await host.readNovelConfig(root);
    const group = config["article-groups"].find((entry) => entry.id === groupId);
    if (!group) {
      return;
    }
    group.name = draft.name;
    group.description = draft.description;
    await host.writeNovelConfig(root, config);
  
}

/** 从文章组移除文章并按需删除组 */
export async function removeArticlesFromGroup(host: ArticleListHost, folderPath: string, groupId: string, paths: string[],): Promise<void> {
    const root = host.findNovelGroupRoot(folderPath) ?? host.normalizeFolderPath(folderPath);
    const config = await host.readNovelConfig(root);
    const group = config["article-groups"].find((entry) => entry.id === groupId);
    if (!group) {
      return;
    }
    group.paths = group.paths.filter((path) => !paths.includes(path));
    if (group.paths.length === 0) {
      config["article-groups"] = config["article-groups"].filter((entry) => entry.id !== groupId);
    }
    await host.writeNovelConfig(root, config);
    await normalizeArticleGroups(host, root);
  
}

/** 按标识删除整个文章组 */
export async function deleteArticleGroup(host: ArticleListHost, folderPath: string, id: string): Promise<void> {
    const group = host.findNovelGroupRoot(folderPath) ?? host.normalizeFolderPath(folderPath);
    const config = await host.readNovelConfig(group);
    config["article-groups"] = config["article-groups"].filter((entry) => entry.id !== id);
    await host.writeNovelConfig(group, config);
  
}

/** 更新卷的简介与海报信息 */
export async function updateVolumeMeta(host: ArticleListHost, folderPath: string, volume: string, patch: { description?: string; cover?: string },): Promise<void> {
    const group = host.findNovelGroupRoot(folderPath) ?? host.normalizeFolderPath(folderPath);
    const config = await host.readNovelConfig(group);
    config.volumes[volume] ??= { description: "", cover: "" };
    if (patch.description !== undefined) {
      config.volumes[volume].description = patch.description;
    }
    if (patch.cover !== undefined) {
      config.volumes[volume].cover = normalizeCoverPath(patch.cover);
    }
    await host.writeNovelConfig(group, config);
    host.refreshWorkbenchViews();
  
}


/** 按章节编号比较两篇文章顺序 */
export function compareChapterOrder(host: ArticleListHost, left: ArticleEntry, right: ArticleEntry): number {
    const leftNumber = getArticleId(host, left.path);
    const rightNumber = getArticleId(host, right.path);
    return leftNumber - rightNumber;
  
}

/** 读取文章属性中的章节编号 */
export function getArticleId(host: ArticleListHost, path: string): number {
    const file = host.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return Number.MAX_SAFE_INTEGER;
    }
    const frontmatter = host.app.metadataCache.getFileCache(file)?.frontmatter;
    const value: unknown = frontmatter?.["novelview-id"]
      ?? frontmatter?.["novelview-chapter"];
    const number = Number(value);
    return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER;
  
}

/** 计算目录内下一个可用章节编号 */
export function getNextArticleId(host: ArticleListHost, folderPath: string): number {
    const folder = host.getFolder(folderPath);
    if (!folder) {
      return 1;
    }
    let max = 0;
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === "md") {
        max = Math.max(max, getArticleId(host, child.path) || 0);
      }
    }
    return max + 1;
  
}

/** 补齐卷排序配置并返回是否变更 */
export async function ensureVolumeOrder(host: ArticleListHost, folderPath: string): Promise<boolean> {
    const group = host.findNovelGroupRoot(folderPath) ?? host.normalizeFolderPath(folderPath);
    const folder = host.getFolder(group);
    if (!folder) {
      return false;
    }
    const names = folder.children
      .filter((child): child is TFolder => child instanceof TFolder)
      .filter((child) => !host.isReservedNovelFolder(child.name))
      .map((child) => child.name);
    const config = await host.readNovelConfig(group);
    const current = config["volume-order"].filter((name) => names.includes(name));
    for (const name of names) {
      if (!current.includes(name)) {
        current.push(name);
      }
    }
    if (
      current.length === config["volume-order"].length
      && current.every((name, index) => name === config["volume-order"][index])
    ) {
      return false;
    }
    config["volume-order"] = current;
    await host.writeNovelConfig(group, config);
    return true;
  
}

/** 读取缓存的卷排序列表 */
export function getNovelVolumeOrder(host: ArticleListHost, folderPath: string): string[] {
    const group = host.normalizeFolderPath(folderPath);
    return host.novelConfigs.get(group)?.["volume-order"] ?? [];
  
}

/** 把卷排序写入小说组配置 */
export async function saveNovelVolumeOrder(host: ArticleListHost, folderPath: string, order: string[]): Promise<void> {
    const group = host.normalizeFolderPath(folderPath);
    const config = await host.readNovelConfig(group);
    config["volume-order"] = [...order];
    await host.writeNovelConfig(group, config);
  
}

/** 按当前顺序重排目录内的章节编号 */
export async function renumberFolder(host: ArticleListHost, folderPath: string): Promise<void> {
    const folder = host.getFolder(folderPath);
    if (!folder) {
      return;
    }
    const files = folder.children
      .filter((child): child is TFile => (
        child instanceof TFile
        && child.extension === "md"
        && !host.isSpecialNovelFile(child)
      ))
      .sort((a, b) => compareChapterOrder(host, 
        { path: a.path, basename: a.basename },
        { path: b.path, basename: b.basename },
      ));
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      await host.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        frontmatter["novelview-id"] = index + 1;
      });
    }
  
}

/** 重命名文章并压入撤销栈 */
export async function renameArticlePath(host: ArticleListHost, path: string, value: string): Promise<string | null> {
    const file = host.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return "文章不存在。";
    }
    const base = host.sanitizeFileBase(value, file.basename);
    if (!base || base === file.basename) {
      return null;
    }
    const parent = host.normalizeFolderPath(file.parent?.path ?? "/");
    const nextPath = joinVaultPath(parent, `${base}.md`);
    if (host.app.vault.getAbstractFileByPath(nextPath)) {
      return "同名文章已存在。";
    }
    await host.app.fileManager.renameFile(file, nextPath);
    host.articleUndoStack.push(async () => {
      const renamed = host.app.vault.getAbstractFileByPath(nextPath);
      if (renamed instanceof TFile) {
        await host.app.fileManager.renameFile(renamed, path);
      }
    });
    return null;
  
}

/** 重命名卷目录并校验保留名称 */
export async function renameVolumePath(host: ArticleListHost, path: string, value: string): Promise<string | null> {
    const folder = host.getFolder(path);
    if (!folder || folder.path === "/") {
      return "卷不存在。";
    }
    const base = host.sanitizeFileBase(value, folder.name);
    if (!base || base === folder.name) {
      return null;
    }
    if (base.startsWith("-")) {
      return "卷名不能以 - 开头，该前缀保留给设定集。";
    }
    if (host.isReservedNovelFolder(base)) {
      return "该名称是小说组保留名称。";
    }
    const parent = host.normalizeFolderPath(folder.parent?.path ?? "/");
    const nextPath = joinVaultPath(parent, base);
    if (host.app.vault.getAbstractFileByPath(nextPath)) {
      return "同名文件夹已存在。";
    }
    await host.app.fileManager.renameFile(folder, nextPath);
    host.articleUndoStack.push(async () => {
      const renamed = host.getFolder(nextPath);
      if (renamed) {
        await host.app.fileManager.renameFile(renamed, path);
      }
    });
    return null;
  
}

/** 删除所选文件并支持整批撤销 */
export async function deleteArticleTargets(host: ArticleListHost, targets: ArticleListTarget[], refresh: () => void,): Promise<void> {
    if (targets.length === 0) {
      return;
    }
    const confirmed = await confirmAction(
      host.app,
      "删除所选内容",
      `确定删除 ${targets.length} 项内容吗？可使用 Cmd/Ctrl+Z 撤销。`,
    );
    if (!confirmed) {
      return;
    }
    const folders = new Set<string>();
    const files: Array<{ path: string; content: ArrayBuffer; binary: boolean }> = [];
    const emptyFolders = new Set<string>();
    for (const target of targets) {
      const abstract = host.app.vault.getAbstractFileByPath(target.path);
      if (abstract instanceof TFile) {
        files.push({
          path: abstract.path,
          content: await host.app.vault.readBinary(abstract),
          binary: abstract.extension !== "md",
        });
        folders.add(abstract.parent?.path ?? "");
        continue;
      }
      if (abstract instanceof TFolder) {
        emptyFolders.add(abstract.path);
        const walk = async (folder: TFolder): Promise<void> => {
          emptyFolders.add(folder.path);
          for (const child of folder.children) {
            if (child instanceof TFolder) {
              await walk(child);
            } else if (child instanceof TFile) {
              files.push({
                path: child.path,
                content: await host.app.vault.readBinary(child),
                binary: child.extension !== "md",
              });
            }
          }
        };
        await walk(abstract);
        folders.add(host.normalizeFolderPath(abstract.parent?.path ?? "/"));
      }
    }
    for (const target of targets) {
      const abstract = host.app.vault.getAbstractFileByPath(target.path);
      if (abstract) {
        await host.app.fileManager.trashFile(abstract);
      }
    }
    for (const folderPath of folders) {
      if (folderPath) {
        await renumberFolder(host, folderPath);
      }
    }
    host.articleUndoStack.push(async () => {
      const sortedFolders = [...emptyFolders].sort((a, b) => a.length - b.length);
      for (const folderPath of sortedFolders) {
        if (!host.app.vault.getAbstractFileByPath(folderPath)) {
          await host.app.vault.createFolder(folderPath);
        }
      }
      for (const snapshot of files) {
        if (host.app.vault.getAbstractFileByPath(snapshot.path)) {
          continue;
        }
        if (snapshot.binary) {
          await host.app.vault.createBinary(snapshot.path, snapshot.content);
        } else {
          await host.app.vault.create(
            snapshot.path,
            new TextDecoder().decode(snapshot.content),
          );
        }
      }
      for (const folderPath of folders) {
        if (folderPath) {
          await renumberFolder(host, folderPath);
        }
      }
    });
    refresh();
  
}

/** 生成不冲突的文件夹路径 */
export function getUniqueFolderPath(host: ArticleListHost, parentPath: string, base: string): string {
    let candidate = joinVaultPath(parentPath, base);
    let index = 2;
    for (;;) {
      const existing = host.app.vault.getAbstractFileByPath(candidate);
      if (!existing) {
        return candidate;
      }
      if (existing instanceof TFolder) {
        return candidate;
      }
      candidate = joinVaultPath(parentPath, `${base} ${index}`);
      index += 1;
    }
  
}

/** 执行文章列表最近一次操作的反向 */
export async function undoLastArticleAction(host: ArticleListHost): Promise<void> {
    const action = host.articleUndoStack.pop();
    if (!action) {
      new Notice("Novel View：没有可撤销的文章列表操作。");
      return;
    }
    try {
      await action();
      host.refreshOpenViews();
      new Notice("Novel View：已撤销。");
    } catch (error) {
      console.error("Novel View: undo failed", error);
      new Notice("Novel View：撤销失败。");
    }
  
}

/** 把文章移动到目标卷并重新编号 */
export async function moveArticlesToVolume(host: ArticleListHost, paths: string[], targetFolder: string): Promise<boolean> {
    const target = host.getFolder(targetFolder);
    if (!target) {
      return false;
    }
    const moved: Array<{ oldPath: string; newPath: string; sourceFolder: string }> = [];
    const folders = new Set<string>([target.path]);
    for (const sourcePath of paths) {
      const file = host.app.vault.getAbstractFileByPath(sourcePath);
      if (!(file instanceof TFile)) {
        continue;
      }
      if (file.parent?.path === target.path) {
        continue;
      }
      const sourceFolder = file.parent?.path ?? "";
      folders.add(sourceFolder);
      let nextPath = joinVaultPath(target.path, file.name);
      let index = 2;
      while (host.app.vault.getAbstractFileByPath(nextPath)) {
        nextPath = joinVaultPath(target.path, `${file.basename} ${index}.md`);
        index += 1;
      }
      await host.app.fileManager.renameFile(file, nextPath);
      moved.push({ oldPath: sourcePath, newPath: nextPath, sourceFolder });
    }
    let nextId = getNextArticleId(host, target.path);
    for (const entry of moved) {
      const movedFile = host.app.vault.getAbstractFileByPath(entry.newPath);
      if (movedFile instanceof TFile) {
        await host.app.fileManager.processFrontMatter(movedFile, (frontmatter: Record<string, unknown>) => {
          frontmatter["novelview-id"] = nextId;
        });
        nextId += 1;
      }
    }
    if (moved.length > 0) {
      host.articleUndoStack.push(async () => {
        for (const entry of moved) {
          const file = host.app.vault.getAbstractFileByPath(entry.newPath);
          if (file instanceof TFile) {
            await host.app.fileManager.renameFile(file, entry.oldPath);
          }
        }
        for (const folder of folders) {
          if (folder) {
            await renumberFolder(host, folder);
          }
        }
      });
    }
    return true;
  
}

/** 把文章插到目标章节前后并重编号 */
export async function reorderArticlesAt(host: ArticleListHost, paths: string[], targetPath: string, after: boolean,): Promise<boolean> {
    const target = host.app.vault.getAbstractFileByPath(targetPath);
    if (!(target instanceof TFile) || !target.parent) {
      return false;
    }
    const targetFolder = target.parent.path;
    const before = new Map<string, unknown>();
    const targetFolderObj = host.getFolder(targetFolder);
    if (targetFolderObj) {
      for (const child of targetFolderObj.children) {
        if (child instanceof TFile) {
          before.set(child.path, host.app.metadataCache.getFileCache(child)?.frontmatter?.["novelview-id"]);
        }
      }
    }
    await moveArticlesToVolume(host, paths, targetFolder);
    const folder = host.getFolder(targetFolder);
    if (!folder) {
      return false;
    }
    const files = folder.children
      .filter((child): child is TFile => child instanceof TFile && child.extension === "md")
      .sort((a, b) => compareChapterOrder(host, 
        { path: a.path, basename: a.basename },
        { path: b.path, basename: b.basename },
      ));
    const moving = files.filter((file) => paths.includes(file.path));
    const remaining = files.filter((file) => !paths.includes(file.path));
    const targetFile = remaining.find((file) => file.path === targetPath);
    if (!targetFile) {
      return false;
    }
    const targetIndex = remaining.indexOf(targetFile) + (after ? 1 : 0);
    remaining.splice(targetIndex, 0, ...moving);
    for (let index = 0; index < remaining.length; index += 1) {
      await host.app.fileManager.processFrontMatter(remaining[index], (frontmatter: Record<string, unknown>) => {
        frontmatter["novelview-id"] = index + 1;
      });
    }
    host.articleUndoStack.push(async () => {
      for (const [filePath, chapter] of before) {
        const file = host.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          await host.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
            if (chapter === undefined || chapter === null) {
              delete frontmatter["novelview-id"];
            } else {
              frontmatter["novelview-id"] = chapter;
            }
          });
        }
      }
    });
    const root = host.findNovelGroupRoot(targetFolder);
    if (root) {
      await normalizeArticleGroups(host, root);
    }
    return true;
  
}

/** 调整卷在排序列表中的位置 */
export async function reorderVolume(host: ArticleListHost, folderPath: string, sourcePath: string, targetPath: string): Promise<void> {
    const folder = host.getFolder(folderPath);
    if (!folder) {
      return;
    }
    const names = folder.children
      .filter((child): child is TFolder => child instanceof TFolder)
      .filter((child) => !host.isReservedNovelFolder(child.name))
      .map((child) => child.name);
    const source = sourcePath.split("/").pop();
    const target = targetPath.split("/").pop();
    if (!source || !target || source === target) {
      return;
    }
    const order = getNovelVolumeOrder(host, folderPath).filter((name) => names.includes(name));
    for (const name of names) {
      if (!order.includes(name)) {
        order.push(name);
      }
    }
    const from = order.indexOf(source);
    const to = order.indexOf(target);
    if (from < 0 || to < 0) {
      return;
    }
    order.splice(from, 1);
    order.splice(to, 0, source);
    await saveNovelVolumeOrder(host, folderPath, order);
  
}

/** 判断所选文章是否构成连续区间 */
export function getContiguousArticleSelection(host: ArticleListHost, folderPath: string, targets: ArticleListTarget[],): { volume: string; paths: string[] } | null {
    if (targets.length === 0) {
      return null;
    }
    const model = host.getArticleListModel(folderPath);
    if (!model) {
      return null;
    }
    const sections: Array<{ volume: string; articles: ArticleEntry[] }> = [
      { volume: "", articles: model.articles },
      ...model.volumes.map((volume) => ({
        volume: volume.name,
        articles: volume.articles,
      })),
    ];
    const selected = new Set(targets.map((target) => target.path));
    for (const section of sections) {
      const indexes = section.articles
        .map((article, index) => selected.has(article.path) ? index : -1)
        .filter((index: number) => index >= 0);
      if (indexes.length !== selected.size || indexes.length === 0) {
        continue;
      }
      const first = indexes[0];
      const last = indexes[indexes.length - 1];
      if (last - first + 1 === indexes.length) {
        return {
          volume: section.volume,
          paths: section.articles.slice(first, last + 1).map((article) => article.path),
        };
      }
    }
    return null;
  
}

/** 按选中对象构建文章列表右键菜单 */
export function showArticleListContextMenu(host: ArticleListHost, event: MouseEvent, folderPath: string, contextPath: string, refresh: () => void, targets: ArticleListTarget[] = [], onRename?: () => void,): void {
    const menu = new Menu();
    if (targets.length > 0) {
      if (targets.length === 1 && targets[0].kind === "article") {
        const target = targets[0];
        menu.addItem((item) => {
          item
            .setTitle("在新标签页打开（NovelEditor）")
            .setIcon("external-link")
            .onClick(() => {
              const file = host.app.vault.getAbstractFileByPath(target.path);
              if (file instanceof TFile) {
                void host.openNovelEditorInNewTab(file);
              }
            });
        });
      }
      if (targets.length === 1 && onRename) {
        menu.addItem((item) => {
          item.setTitle("重命名").setIcon("pencil").onClick(onRename);
        });
      }
      const menuPosition = { x: event.clientX, y: event.clientY };
      const articleTargets = targets.filter((target) => target.kind === "article");
      if (targets.length > 1 && articleTargets.length > 0) {
        menu.addItem((item) => {
          item.setTitle("导出所选章节为 TXT").setIcon("download").onClick(() => {
            void host.exportChapterTargets(articleTargets, folderPath);
          });
        });
      }
      if (targets.length === 1 && targets[0].kind === "article") {
        menu.addItem((item) => {
          item.setTitle("导出为 TXT").setIcon("download").onClick(() => {
            void host.exportChapterTargets([targets[0]], folderPath);
          });
        });
      }
      if (targets.length === 1 && targets[0].kind === "volume") {
        const volumeTarget = targets[0];
        menu.addItem((item) => {
          item.setTitle("新建文章").setIcon("file-plus").onClick(() => {
            void createArticleInFolder(host, 
              folderPath,
              volumeTarget.path,
              "无标题",
            ).then(refresh);
          });
        });
        menu.addItem((item) => {
          item.setTitle("编辑").setIcon("pencil").onClick(() => {
            const config = host.getNovelConfig(folderPath);
            const meta = config.volumes[volumeTarget.title] ?? { description: "", cover: "" };
            new VolumeEditModal(host.app, {
              folderPath,
              volume: volumeTarget.title,
              description: meta.description,
              coverUrl: meta.cover
                ? host.getNovelCoverUrl(folderPath, meta.cover)
                : null,
              onSave: (description) => {
                void updateVolumeMeta(host, folderPath, volumeTarget.title, {
                  description,
                }).then(refresh);
              },
              onPickCover: () => {
                void host.editNovelVolumeCover(
                  folderPath,
                  volumeTarget.title,
                ).then(refresh);
              },
            }).open();
          });
        });
        menu.addItem((item) => {
          item.setTitle("导出本卷为 TXT").setIcon("download").onClick(() => {
            void host.exportVolumeTarget(targets[0]);
          });
        });
      }
      if (articleTargets.length > 0) {
        menu.addItem((item) => {
          item.setTitle("修改状态").setIcon("circle-dot").onClick(() => {
            const statusMenu = new Menu();
            for (const status of (Object.keys(CHAPTER_STATUS_LABELS) as ChapterStatus[])) {
              statusMenu.addItem((sub) => {
                sub.setTitle(CHAPTER_STATUS_LABELS[status]).onClick(() => {
                  for (const target of articleTargets) {
                    const file = host.app.vault.getAbstractFileByPath(target.path);
                    if (file instanceof TFile) {
                      void setChapterStatus(host, file, status);
                    }
                  }
                  refresh();
                });
              });
            }
            statusMenu.showAtPosition(menuPosition);
          });
        });
      }
      const contiguous = articleTargets.length > 1
        ? getContiguousArticleSelection(host, folderPath, articleTargets)
        : null;
      if (contiguous) {
        menu.addItem((item) => {
          item.setTitle("归入文章组").setIcon("box-select").onClick(() => {
            new ArticleGroupModal(
              host.app,
              { name: "", description: "" },
              (draft) => {
                void saveArticleGroup(host, folderPath, {
                  volume: contiguous.volume,
                  name: draft.name,
                  description: draft.description,
                  paths: contiguous.paths,
                }).then(refresh);
              },
            ).open();
          });
        });
      }
      if (targets.length === 1 && articleTargets.length === 1) {
        const group = getArticleGroupForPath(host, folderPath, articleTargets[0].path);
        if (group) {
          menu.addItem((item) => {
            item.setTitle("移出文章组").setIcon("ungroup").onClick(() => {
              const index = group.paths.indexOf(articleTargets[0].path);
              if (index < 0) {
                return;
              }
              const removeMenu = new Menu();
              removeMenu.addItem((sub) => {
                sub.setTitle("以下").setIcon("arrow-down").onClick(() => {
                  void removeArticlesFromGroup(host, 
                    folderPath,
                    group.id,
                    group.paths.slice(index),
                  ).then(refresh);
                });
              });
              removeMenu.addItem((sub) => {
                sub.setTitle("以上").setIcon("arrow-up").onClick(() => {
                  void removeArticlesFromGroup(host, 
                    folderPath,
                    group.id,
                    group.paths.slice(0, index + 1),
                  ).then(refresh);
                });
              });
              removeMenu.showAtPosition(menuPosition);
            });
          });
        }
      }
      menu.addItem((item) => {
        item.setTitle(targets.length === 1 ? "删除" : `删除 ${targets.length} 项`)
          .setIcon("trash")
          .onClick(() => {
            void deleteArticleTargets(host, targets, refresh);
          });
      });
      menu.showAtMouseEvent(event);
      return;
    }
    menu.addItem((item) => {
      item.setTitle("新建文章").setIcon("file-plus").onClick(() => {
        void createArticleInFolder(host, folderPath, contextPath, "无标题")
          .then(refresh);
      });
    });
    menu.addItem((item) => {
      item.setTitle("新建卷").setIcon("folder-plus").onClick(() => {
        void host.createVolumeInFolder(folderPath).then(refresh);
      });
    });
    menu.showAtMouseEvent(event);
  
}