/**
 * 小说内查找器（finder）：结果列表、定位与关闭。
 * 从 main.ts 迁出（D7）。
 */

import { TFile } from "obsidian";
import { NovelEditorView } from "../novel-editor/novel-editor-view";
import { SearchPanelV2, FinderContext, FinderResult, SearchScope } from "./search-panel-v2";
import { NOVEL_FINDER_VIEW_TYPE, NovelFinderView } from "./novel-finder-view";
import type { PluginBase } from "../../app/plugin-context";
import type { SettingKeywordEntry } from "../../core/model/setting-collection";

export interface FinderHost extends PluginBase {
  readonly settingKeywordEntries: SettingKeywordEntry[];
  /** 获取最近活动的 Markdown 文件 */
  getLastActiveMarkdownFile(): TFile | null;
  /** 按文件路径查找小说编辑器视图 */
  findNovelEditorView(path: string): NovelEditorView | null;
  searchPanelV2: SearchPanelV2 | null;
  finderNavigationUntil: number;
  /** 在编辑器中打开文章并定位行 */
  openNovelEditor(file: TFile, line?: number): Promise<void>;
  /** 打开关键词对应的设定记录 */
  openSettingRecord(sourcePath: string, group: string, tag: string, keyword: string,): Promise<void>;
  /** 打开文件并跳转到指定行 */
  openFileAtLine(file: TFile, line?: number): Promise<void>;
}

/** 提供查找器使用的关键词表 */
export function getSettingKeywordsForFinder(host: FinderHost): SettingKeywordEntry[] {
    return host.settingKeywordEntries;
  
}

/** 把结果推送到侧栏结果视图 */
export async function showNovelFinderResults(host: FinderHost, context: FinderContext, results: FinderResult[],): Promise<void> {
    const existing = host.app.workspace.getLeavesOfType(NOVEL_FINDER_VIEW_TYPE)[0];
    if (context.scope === "chapter") {
      // Whole-chapter results stay in the NovelFinder card. Only update an
      // already-open sidebar; never open it as a side effect of searching.
      if (existing?.view instanceof NovelFinderView) {
        existing.view.setResults(context, results);
      }
      return;
    }
    if (existing?.view instanceof NovelFinderView) {
      existing.view.setResults(context, results);
      return;
    }
    const leaf = existing
      ?? host.app.workspace.getRightLeaf(false)
      ?? host.app.workspace.getRightLeaf(true);
    if (!leaf) {
      return;
    }
    await leaf.setViewState({
      type: NOVEL_FINDER_VIEW_TYPE,
      active: false,
    });
    if (leaf.view instanceof NovelFinderView) {
      leaf.view.setResults(context, results);
    }
    await host.app.workspace.revealLeaf(leaf);
  
}

/** 清除正文里的查找高亮 */
export function clearNovelFinderHighlights(host: FinderHost): void {
    const file = host.getLastActiveMarkdownFile();
    const view = file ? host.findNovelEditorView(file.path) : null;
    view?.clearSearchHighlights();
  
}

/** 计算结果卡片的纵向锚点 */
export function getNovelFinderAnchorY(host: FinderHost): number | undefined {
    const card = host.searchPanelV2?.getCardRect();
    if (!card) {
      return undefined;
    }
    const file = host.getLastActiveMarkdownFile();
    const view = file ? host.findNovelEditorView(file.path) : null;
    const viewport = view?.getScrollViewportRect();
    if (!viewport || viewport.height <= 0) {
      return undefined;
    }
    const spaceAbove = card.top - viewport.top;
    const spaceBelow = viewport.bottom - card.bottom;
    if (spaceAbove >= 120) {
      return Math.max(viewport.top + 40, card.top - 40);
    }
    if (spaceBelow >= 60) {
      return Math.min(viewport.bottom - 24, card.bottom + 28);
    }
    return undefined;
  
}

/** 定位并高亮单个查找结果 */
export async function focusNovelFinderResult(host: FinderHost, result: FinderResult, scope: SearchScope, options: { openChapter?: boolean; scroll?: boolean; focus?: boolean; } = {},): Promise<boolean> {
    if (
      !result.path
      || result.offset === undefined
      || result.length === undefined
    ) {
      return false;
    }
    const file = host.app.vault.getAbstractFileByPath(result.path);
    if (!(file instanceof TFile)) {
      return false;
    }
    let view = host.findNovelEditorView(file.path);
    if (!view && !options.openChapter) {
      return false;
    }
    host.finderNavigationUntil = performance.now() + 5000;
    if (!view) {
      await host.openNovelEditor(file, result.line ?? 1);
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
        view = host.findNovelEditorView(file.path);
        if (view?.isEditorReady()) {
          break;
        }
      }
    }
    if (!view) {
      return false;
    }
    if (options.openChapter) {
      await host.app.workspace.revealLeaf(view.leaf);
    }
    const scroll = options.scroll ?? true;
    view.showSearchHighlight(
      result.offset,
      result.offset + result.length,
      scroll,
      options.focus ?? true,
      scroll ? getNovelFinderAnchorY(host) : undefined,
    );
    if (scroll) {
      window.setTimeout(() => {
        const anchorY = getNovelFinderAnchorY(host);
        if (anchorY !== undefined) {
          view.alignSearchHighlightTo(anchorY);
        }
      }, 80);
    }
    host.finderNavigationUntil = performance.now() + 1000;
    return true;
  
}

/** 打开结果对应文章或设定记录 */
export async function openNovelFinderResult(host: FinderHost, result: FinderResult, scope?: SearchScope,): Promise<void> {
    if (result.kind === "setting" && result.group && result.keyword) {
      const current = host.getLastActiveMarkdownFile();
      if (current) {
        await host.openSettingRecord(
          current.path,
          result.group,
          result.tag ?? "",
          result.keyword,
        );
      }
      return;
    }
    if (!result.path) {
      return;
    }
    if (result.kind === "file") {
      host.searchPanelV2?.syncActiveResult(result);
    }
    const file = host.app.vault.getAbstractFileByPath(result.path);
    if (!(file instanceof TFile)) {
      return;
    }
    if (
      (scope === "chapter" || scope === "volume" || scope === "book")
      && result.offset !== undefined
      && result.length !== undefined
    ) {
      if (await focusNovelFinderResult(host, result, scope, {
        openChapter: true,
        scroll: true,
        focus: true,
      })) {
        return;
      }
    }
    await host.openFileAtLine(file, result.line ?? 1);
  
}

/** 关闭面板并移除结果视图 */
export function closeNovelFinder(host: FinderHost): void {
    host.searchPanelV2?.close();
    for (const leaf of host.app.workspace.getLeavesOfType(NOVEL_FINDER_VIEW_TYPE)) {
      leaf.detach();
    }
  
}

/** 检查查找面板当前是否可见 */
export function isNovelFinderOpen(host: FinderHost): boolean {
    return host.searchPanelV2?.isOpen() ?? false;
  
}
