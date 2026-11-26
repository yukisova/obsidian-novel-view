/**
 * 视图导航：打开/复用编辑器与侧栏视图、路由小说文件、侧栏判定。
 * 从 main.ts 迁出（D10 主体）。
 */

import { MarkdownView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { ArticleListModel } from "../features/article-list/article-list-view";
import { SRC_GALLERY_VIEW_TYPE } from "../features/src-gallery/src-gallery-view";
import { WORKBENCH_VIEW_TYPE } from "../features/workbench/workbench-view";
import { NOVEL_EDITOR_VIEW_TYPE, NovelEditorView } from "../features/novel-editor/novel-editor-view";
import { ARTICLE_INFO_VIEW_TYPE, ArticleInfoView } from "../features/article-info/article-info-view";
import { SETTING_COLLECTION_VIEW_TYPE } from "../features/setting-collection/setting-collection-view";
import { SETTING_LIST_VIEW_TYPE } from "../features/setting-collection/setting-list-view";
import { TEXT_MARKS_VIEW_TYPE } from "../features/text-marks/mark-collection-view";
import type { PluginBase } from "./plugin-context";

export interface ViewNavigationHost extends PluginBase {
  routingNovelFile: boolean;
  ensureArticleInfoView(): void;
  normalizeFolderPath(path: string): string;
  findNovelGroupRoot(folderPath: string): string | null;
  getArticleListModel(folderPath: string): ArticleListModel | null;
  isNovelArticleFile(file: TFile): boolean;
  getActiveMarkdownView(): MarkdownView | null;
  lastActiveMarkdownPath: string | null;
  workbenchFolderPath: string | null;
  refreshSettingKeywordIndex(): Promise<void>;
  destroyArticleStatus(view: MarkdownView): void;
  isNovelModeEnabled(view: MarkdownView): boolean;
}

/** 等待信息面板就绪后定位到指定脚注 */
export async function focusArticleInfoFootnote(host: ViewNavigationHost, filePath: string, key: string,): Promise<void> {
    host.ensureArticleInfoView();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      for (const leaf of host.app.workspace.getLeavesOfType(
        ARTICLE_INFO_VIEW_TYPE,
      )) {
        if (leaf.view instanceof ArticleInfoView) {
          leaf.view.focusFootnote(filePath, key);
          return;
        }
      }
    }
  
}

/** 按卷与文章顺序返回同组章节文件 */
export function getOrderedNovelChapterFiles(host: ViewNavigationHost, currentPath: string): TFile[] {
    const parent = host.normalizeFolderPath(
      currentPath.split("/").slice(0, -1).join("/"),
    );
    const root = host.findNovelGroupRoot(parent);
    if (!root) {
      return [];
    }
    const model = host.getArticleListModel(root);
    if (!model) {
      return [];
    }
    const paths = [
      ...model.volumes.flatMap((volume) => (
        volume.articles.map((entry) => entry.path)
      )),
      ...model.articles.map((entry) => entry.path),
    ];
    return paths
      .map((path) => host.app.vault.getAbstractFileByPath(path))
      .filter((file): file is TFile => file instanceof TFile);
  
}

/** 刷新所有已打开的文章信息面板 */
export function refreshArticleInfo(host: ViewNavigationHost): void {
    for (const leaf of host.app.workspace.getLeavesOfType(
      ARTICLE_INFO_VIEW_TYPE,
    )) {
      if (leaf.view instanceof ArticleInfoView) {
        leaf.view.refreshNow();
      }
    }
  
}

/** 取得当前聚焦的小说编辑器视图 */
export function getActiveNovelEditorView(host: ViewNavigationHost): NovelEditorView | null {
    const active = host.app.workspace.getActiveViewOfType(NovelEditorView);
    return active ?? null;
  
}

/** 按文件路径查找对应的小说编辑器视图 */
export function getNovelEditorViewForPath(host: ViewNavigationHost, path: string): NovelEditorView | null {
    return findNovelEditorView(host, path);
  
}

/** 通知所有工作台视图重新渲染 */
export function refreshWorkbenchViews(host: ViewNavigationHost): void {
    for (const leaf of host.app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE)) {
      const view = leaf.view as { scheduleRefresh?: () => void };
      view.scheduleRefresh?.();
    }
  
}

/** 按路径解析文件并在编辑器中打开 */
export function openArticleFromList(host: ViewNavigationHost, path: string): void {
    const file = host.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      void openNovelEditor(host, file);
    }
  
}


/** 把文件打开请求转交给小说编辑器 */
export function routeNovelFileOpen(host: ViewNavigationHost, file: TFile): void {
    if (host.routingNovelFile) {
      return;
    }
    const activeMarkdown = host.getActiveMarkdownView();
    const existing = host.app.workspace.getLeavesOfType(
      NOVEL_EDITOR_VIEW_TYPE,
    )[0];
    host.routingNovelFile = true;
    const open = async (): Promise<void> => {
      if (existing) {
        await existing.setViewState({
          type: NOVEL_EDITOR_VIEW_TYPE,
          state: { file: file.path, line: 1 },
          active: true,
        });
        await host.app.workspace.revealLeaf(existing);
        if (activeMarkdown?.leaf && activeMarkdown.leaf !== existing) {
          activeMarkdown.leaf.detach();
        }
        return;
      }
      if (activeMarkdown?.file?.path === file.path) {
        await activeMarkdown.leaf.setViewState({
          type: NOVEL_EDITOR_VIEW_TYPE,
          state: { file: file.path, line: 1 },
          active: true,
        });
        return;
      }
      await openNovelEditor(host, file);
    };
    void open().finally(() => {
      host.routingNovelFile = false;
    });
  
}

/** 在新标签页中打开小说编辑器 */
export async function openNovelEditorInNewTab(host: ViewNavigationHost, file: TFile): Promise<void> {
    const leaf = host.app.workspace.getLeaf("tab");
    host.routingNovelFile = true;
    try {
      await leaf.setViewState({
        type: NOVEL_EDITOR_VIEW_TYPE,
        state: { file: file.path, line: 1 },
        active: true,
      });
      await host.app.workspace.revealLeaf(leaf);
    } finally {
      host.routingNovelFile = false;
    }
  
}

/** 复用或新建编辑器并定位到指定行 */
export async function openNovelEditor(host: ViewNavigationHost, file: TFile, line = 1): Promise<void> {
    const existing = host.app.workspace.getLeavesOfType(
      NOVEL_EDITOR_VIEW_TYPE,
    )[0];
    const leaf = existing ?? host.app.workspace.getLeaf("tab");
    host.routingNovelFile = true;
    try {
      await leaf.setViewState({
        type: NOVEL_EDITOR_VIEW_TYPE,
        state: { file: file.path, line },
        active: true,
      });
      await host.app.workspace.revealLeaf(leaf);
    } finally {
      host.routingNovelFile = false;
    }
  
}

/** 读取当前小说编辑器正在编辑的文件 */
export function getActiveNovelEditorFile(host: ViewNavigationHost): TFile | null {
    const view = host.app.workspace.getActiveViewOfType(NovelEditorView);
    return view?.getNovelEditorFile() ?? null;
  
}

/** 遍历编辑器面板查找指定文件视图 */
export function findNovelEditorView(host: ViewNavigationHost, path: string): NovelEditorView | null {
    const normalized = host.normalizeFolderPath(path);
    for (const leaf of host.app.workspace.getLeavesOfType(NOVEL_EDITOR_VIEW_TYPE)) {
      if (!(leaf.view instanceof NovelEditorView)) {
        continue;
      }
      if (host.normalizeFolderPath(leaf.view.getNovelEditorFile()?.path ?? "") === normalized) {
        return leaf.view;
      }
    }
    return null;
  
}

/** 记录当前文件并同步工作台上下文 */
export function setNovelEditorFile(host: ViewNavigationHost, file: TFile): void {
    host.lastActiveMarkdownPath = file.path;
    const root = host.findNovelGroupRoot(
      host.normalizeFolderPath(file.parent?.path ?? "/"),
    );
    if (root) {
      host.workbenchFolderPath = root;
    }
    void host.refreshSettingKeywordIndex();
    refreshWorkbenchViews(host);
  
}

/** 切换正文状态并同步前置元数据保护 */

/** 为所有小说模式的文档启用源码视图 */

/** 把当前文档切换为源码模式并保持滚动位置 */

/** 判断面板是否位于左侧边栏 */
export function isLeftSidebarLeaf(host: ViewNavigationHost, leaf: WorkspaceLeaf): boolean {
    return Boolean(leaf.view.containerEl.closest(
      ".workspace-split.mod-left-split",
    ));
  
}

/** 判断面板是否位于右侧边栏 */
export function isRightSidebarLeaf(host: ViewNavigationHost, leaf: WorkspaceLeaf): boolean {
    return Boolean(leaf.view.containerEl.closest(
      ".workspace-split.mod-right-split",
    ));
  
}

/** 选择左侧边栏中的设定列表面板 */
export function leftSidebarLeaf(host: ViewNavigationHost): WorkspaceLeaf {
    return host.app.workspace.getLeavesOfType(SETTING_LIST_VIEW_TYPE)
      .find((leaf) => isLeftSidebarLeaf(host, leaf))
      ?? host.app.workspace.getLeftLeaf(false)
      ?? host.app.workspace.getLeftLeaf(true)
      ?? host.app.workspace.getLeaf(false);
  
}

/** 选择右侧边栏中的标注或设定面板 */
export function rightSidebarLeaf(host: ViewNavigationHost): WorkspaceLeaf {
    return host.app.workspace.getLeavesOfType(TEXT_MARKS_VIEW_TYPE)
      .find((leaf) => isRightSidebarLeaf(host, leaf))
      ?? host.app.workspace.getLeavesOfType(SETTING_COLLECTION_VIEW_TYPE)
        .find((leaf) => isRightSidebarLeaf(host, leaf))
      ?? host.app.workspace.getRightLeaf(false)
      ?? host.app.workspace.getRightLeaf(true)
      ?? host.app.workspace.getLeaf(false);
  
}

/** 打开文档并高亮指定文本区间 */
export async function openTextMarkRange(host: ViewNavigationHost, file: TFile, start: number, end: number,): Promise<void> {
    await openNovelEditor(host, file);
    let view = findNovelEditorView(host, file.path);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (view?.isEditorReady()) {
        break;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      view = findNovelEditorView(host, file.path);
    }
    view?.showSearchHighlight(start, end, true, true);
  
}

/** 在右侧边栏打开文本标注面板 */
export async function openTextMarks(host: ViewNavigationHost, folderPath: string, _sourceLeaf?: WorkspaceLeaf,): Promise<void> {
    const novelRoot = host.findNovelGroupRoot(folderPath)
      ?? host.normalizeFolderPath(folderPath);
    const leaf = rightSidebarLeaf(host);
    await leaf.setViewState({
      type: TEXT_MARKS_VIEW_TYPE,
      state: { folderPath: novelRoot },
      active: true,
    });
    await host.app.workspace.revealLeaf(leaf);
  
}

/** 在右侧边栏打开或复用素材库 */
export async function openNovelSrcGallery(host: ViewNavigationHost, folderPath: string): Promise<void> {
    const existing = host.app.workspace.getLeavesOfType(SRC_GALLERY_VIEW_TYPE)[0];
    const leaf = existing
      ?? host.app.workspace.getRightLeaf(false)
      ?? host.app.workspace.getRightLeaf(true);
    if (!leaf) {
      new Notice("Novel View：无法打开素材库。");
      return;
    }
    await leaf.setViewState({
      type: SRC_GALLERY_VIEW_TYPE,
      state: { folderPath: host.normalizeFolderPath(folderPath) },
      active: true,
    });
    await host.app.workspace.revealLeaf(leaf);
  
}