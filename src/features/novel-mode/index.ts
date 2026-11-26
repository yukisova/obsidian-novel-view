import { MarkdownView, type App } from "obsidian";

/**
 * Markdown 视图上的通用增强：高级查找按钮、侧栏小说文件夹装饰。
 * （小说模式的正文排版由 NovelEditorView 自己负责）
 */

const FOLDER_TITLE_CLASS = "novelview-novel-folder-title";
const FOLDER_CLASS = "novelview-novel-folder";

export interface MarkdownActionHost {
  app: App;
  unloaded: boolean;
  readonly searchActions: Map<MarkdownView, HTMLElement>;
  readonly observedViews: WeakSet<MarkdownView>;
  openAdvancedSearch(): void;
  refreshOpenViews(): void;
}

/** 给 Markdown 视图挂上「高级查找/替换」动作按钮（只挂一次）。 */
export function ensureViewAction(
  host: MarkdownActionHost,
  view: MarkdownView,
): void {
  if (!host.searchActions.has(view)) {
    try {
      const action = view.addAction(
        "search",
        "Novel View：高级查找/替换",
        () => {
          host.openAdvancedSearch();
        },
      );
      action.addClass("novelview-search-action");
      host.searchActions.set(view, action);
    } catch (error) {
      console.debug("Novel View: search action could not be attached", error);
    }
  }
  if (host.observedViews.has(view)) {
    return;
  }
  host.observedViews.add(view);
  view.containerEl.addEventListener("click", () => {
    window.setTimeout(() => {
      if (!host.unloaded) {
        host.refreshOpenViews();
      }
    }, 80);
  }, true);
}

/** 刷新所有已打开的 Markdown 视图（挂搜索按钮）。 */
export function refreshOpenViews(host: MarkdownActionHost): void {
  for (const leaf of host.app.workspace.getLeavesOfType("markdown")) {
    if (leaf.view instanceof MarkdownView) {
      ensureViewAction(host, leaf.view);
    }
  }
}

export interface FolderDecorationHost {
  app: App;
  unloaded: boolean;
  folderDecorationFrame: number | null;
  folderDecorationContainer: HTMLElement | null;
  folderDecorationObserver: MutationObserver | null;
  /** 判断目录是否为小说组文件夹 */
  isNovelGroupFolder(path: string): boolean;
  /** 为小说文件夹标题添加装饰 */
  decorateNovelFolderTitles(): void;
  /** 安排下一帧的文件夹装饰刷新 */
  scheduleNovelFolderDecoration(): void;
}

/** 给侧栏里的小说组文件夹打标记 class。 */
export function decorateNovelFolderTitles(
  host: Pick<FolderDecorationHost, "unloaded" | "isNovelGroupFolder">,
): void {
  if (host.unloaded) {
    return;
  }
  const titles = activeDocument.querySelectorAll<HTMLElement>(
    ".nav-folder-title[data-path]",
  );
  for (const title of titles) {
    const path = title.dataset.path;
    if (!path) {
      continue;
    }
    const isNovel = host.isNovelGroupFolder(path);
    title.toggleClass(FOLDER_TITLE_CLASS, isNovel);
    title.closest(".nav-folder")?.toggleClass(FOLDER_CLASS, isNovel);
  }
}

/** 下一帧统一刷新文件夹装饰（合并多次请求）。 */
export function scheduleNovelFolderDecoration(host: FolderDecorationHost): void {
  if (host.folderDecorationFrame !== null) {
    return;
  }
  host.folderDecorationFrame = window.requestAnimationFrame(() => {
    host.folderDecorationFrame = null;
    host.decorateNovelFolderTitles();
  });
}

/** 监听文件树结构变化，持续维持小说文件夹的标记。 */
export function setupNovelFolderObserver(host: FolderDecorationHost): void {
  if (host.unloaded) {
    return;
  }
  const container = activeDocument.querySelector<HTMLElement>(".nav-files-container");
  if (container === host.folderDecorationContainer && host.folderDecorationObserver) {
    host.scheduleNovelFolderDecoration();
    return;
  }
  host.folderDecorationObserver?.disconnect();
  host.folderDecorationObserver = null;
  host.folderDecorationContainer = container;
  if (container) {
    host.folderDecorationObserver = new MutationObserver(() => {
      host.scheduleNovelFolderDecoration();
    });
    host.folderDecorationObserver.observe(container, {
      childList: true,
      subtree: true,
    });
  }
  host.scheduleNovelFolderDecoration();
}
