/**
 * 文章列表拖拽：拖拽状态机、放置预览与落点执行。
 * 从 main.ts 迁出（D5）。
 */

import { Notice, TFile, type WorkspaceLeaf } from "obsidian";
import { ARTICLE_MIME, ARTICLES_MIME } from "./article-list-view";
import type { PluginBase } from "../../app/plugin-context";

export interface ArticleDragHost extends PluginBase {
  articleDragPaths: string[];
  articleDragCancelled: boolean;
  articleDropHandled: boolean;
  articleDropMode: "split" | "tabs" | "replace" | null;
  articleDropHeader: HTMLElement | null;
  articleDragPreview: HTMLElement | null;
  openNovelEditorInLeaf(
    leaf: WorkspaceLeaf,
    file: TFile,
    active: boolean,
  ): Promise<void>;
}

/** 判断当前拖拽是否来自文章列表 */
export function isArticleDragEvent(host: ArticleDragHost, event: DragEvent): boolean {
    if (host.articleDragPaths.length === 0) {
      return false;
    }
    const types = event.dataTransfer?.types;
    return !!types && (
      types.includes(ARTICLES_MIME)
      || types.includes(ARTICLE_MIME)
    );
  
}

/** 记录本次拖拽的文章路径并重置状态 */
export function setArticleDrag(host: ArticleDragHost, paths: string[]): void {
    host.articleDragPaths = [...new Set(paths)];
    host.articleDragCancelled = false;
    host.articleDropHandled = false;
    host.articleDropMode = null;
    host.articleDropHeader = null;
  
}

/** 清理拖拽路径、预览与放置标记 */
export function clearArticleDrag(host: ArticleDragHost): void {
    hideArticleDragPreview(host);
    host.articleDragPaths = [];
    host.articleDragCancelled = false;
    host.articleDropMode = null;
    host.articleDropHeader = null;
    host.articleDropHandled = false;
  
}

/** 根据落点元素判断放置方式与目标标签 */
export function getArticleDropContext(
  host: ArticleDragHost,
  target: EventTarget | null,
): { mode: "split" | "tabs" | "replace"; header: HTMLElement | null } | null {
    const element = target as HTMLElement | null;
    const root = element?.closest<HTMLElement>(".workspace-split.mod-root");
    if (!element || !root) {
      return null;
    }
    const header = element.closest<HTMLElement>(".workspace-tab-header");
    if (header && root.contains(header)) {
      return { mode: "replace", header };
    }
    if (element.closest(".workspace-tab-header-container")) {
      return { mode: "tabs", header: null };
    }
    if (element.closest(".workspace-leaf-content, .workspace-tab-container, .workspace-split.mod-root")) {
      return { mode: "split", header: null };
    }
    return null;
  
}

/** 在鼠标附近显示投放方式提示浮层 */
export function showArticleDragPreview(host: ArticleDragHost, event: DragEvent, mode: "split" | "tabs" | "replace",): void {
    const labels = {
      split: "在第二栏打开",
      tabs: "添加至标签页栏",
      replace: "替换当前标签页并添加其余",
    };
    let preview = host.articleDragPreview;
    if (!preview) {
      preview = createDiv({ cls: "novelview-article-drop-preview" });
      activeDocument.body.appendChild(preview);
      host.articleDragPreview = preview;
    }
    preview.setText(`${host.articleDragPaths.length} 个文件 · ${labels[mode]}`);
    const width = preview.offsetWidth;
    const height = preview.offsetHeight;
    preview.setCssProps({
      left: `${Math.min(event.clientX + 14, window.innerWidth - width - 8)}px`,
      top: `${Math.min(event.clientY + 16, window.innerHeight - height - 8)}px`,
    });
  
}

/** 移除并清空拖拽提示浮层 */
export function hideArticleDragPreview(host: ArticleDragHost): void {
    host.articleDragPreview?.remove();
    host.articleDragPreview = null;
  
}

/** 统一捕获异常并提示拖拽打开失败 */
export async function performArticleDrop(host: ArticleDragHost, mode: "split" | "tabs" | "replace", header: HTMLElement | null, paths: string[],): Promise<void> {
    try {
      await performArticleDropInner(host, mode, header, paths);
    } catch (error) {
      console.error("Novel View: article drop failed", error);
      new Notice("Novel View：打开拖拽文章失败。");
    }
  
}

/** 按放置方式在分栏或标签页中打开文章 */
export async function performArticleDropInner(host: ArticleDragHost, mode: "split" | "tabs" | "replace", header: HTMLElement | null, paths: string[],): Promise<void> {
    const files = paths
      .map((path) => host.app.vault.getAbstractFileByPath(path))
      .filter((file): file is TFile => file instanceof TFile);
    if (files.length === 0) {
      return;
    }
    const activateMain = async (): Promise<void> => {
      const leaf = host.app.workspace.getMostRecentLeaf(host.app.workspace.rootSplit);
      if (leaf) {
        host.app.workspace.setActiveLeaf(leaf, { focus: false });
      }
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    };
    if (mode === "tabs") {
      await activateMain();
      for (const file of files) {
        const leaf = host.app.workspace.getLeaf("tab");
        await host.openNovelEditorInLeaf(leaf, file, false);
      }
      return;
    }
    if (mode === "replace" && header) {
      header.click();
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      const leaf = host.app.workspace.getMostRecentLeaf(host.app.workspace.rootSplit);
      if (leaf) {
        await host.openNovelEditorInLeaf(leaf, files[0], true);
        for (const file of files.slice(1)) {
          const tab = host.app.workspace.getLeaf("tab");
          await host.openNovelEditorInLeaf(tab, file, false);
        }
      }
      return;
    }
    await activateMain();
    const splitLeaf = host.app.workspace.getLeaf("split", "vertical");
    await host.openNovelEditorInLeaf(splitLeaf, files[0], true);
    for (const file of files.slice(1)) {
      const leaf = host.app.workspace.getLeaf("tab");
      await host.openNovelEditorInLeaf(leaf, file, false);
    }
  
}