/**
 * 写作统计：字数基线、历史快照与定时检查。
 * 从 main.ts 迁出（D6）。
 */

import { TFile } from "obsidian";
import { countNovelCharacters } from "../../core/text/status";
import { historyBucketStart, pruneNovelHistory, NovelConfig } from "../../core/model/novel-config";
import { NovelEditorView } from "../novel-editor/novel-editor-view";
import type { PluginBase } from "../../app/plugin-context";

export interface WritingStatsHost extends PluginBase {
  readonly novelConfigs: Map<string, NovelConfig>;
  /** 判断是否为特殊设定文件 */
  isSpecialNovelFile(file: TFile): boolean;
  readonly wordCountBaselines: Map<string, number>;
  /** 查找文件所在的小说组根目录 */
  findNovelGroupRoot(folderPath: string): string | null;
  /** 规范化文件夹路径表示 */
  normalizeFolderPath(path: string): string;
  readonly historyTimers: Map<string, number>;
  /** 判断路径是否为设定集索引 */
  isSettingCollectionIndexPath(_path: string): boolean;
  historySaveChain: Promise<void>;
  /** 读取小说组的写作配置数据 */
  readNovelConfig(folderPath: string): Promise<NovelConfig>;
  /** 写回小说组的写作配置数据 */
  writeNovelConfig(folderPath: string, config: NovelConfig): Promise<void>;
  /** 获取最近活动的 Markdown 文件 */
  getLastActiveMarkdownFile(): TFile | null;
  /** 按文件路径查找小说编辑器视图 */
  findNovelEditorView(path: string): NovelEditorView | null;
}

/** 加载各小说文件的字数基线 */
export async function loadWordCountBaselines(host: WritingStatsHost): Promise<void> {
    for (const root of host.novelConfigs.keys()) {
      for (const file of host.app.vault.getFiles()) {
        if (
          file.extension !== "md"
          || host.isSpecialNovelFile(file)
          || !file.path.startsWith(`${root}/`)
        ) {
          continue;
        }
        try {
          const content = await host.app.vault.cachedRead(file);
          if (!host.wordCountBaselines.has(file.path)) {
            host.wordCountBaselines.set(file.path, countNovelCharacters(content));
          }
        } catch (error) {
          console.debug("Novel View: history baseline skipped", file.path, error);
        }
      }
    }
  
}

/** 为新打开文件初始化字数基线 */
export async function initializeWordCountBaseline(host: WritingStatsHost, file: TFile): Promise<void> {
    if (host.isSpecialNovelFile(file) || file.extension !== "md") {
      return;
    }
    const root = host.findNovelGroupRoot(
      host.normalizeFolderPath(file.parent?.path ?? "/"),
    );
    if (!root) {
      return;
    }
    try {
      const content = await host.app.vault.cachedRead(file);
      host.wordCountBaselines.set(file.path, countNovelCharacters(content));
    } catch (error) {
      console.debug("Novel View: history baseline skipped", file.path, error);
    }
  
}

/** 延迟调度一次写作历史检查 */
export function scheduleHistoryCheck(host: WritingStatsHost, file: TFile): void {
    if (file.extension !== "md" || host.isSpecialNovelFile(file)) {
      return;
    }
    const root = host.findNovelGroupRoot(
      host.normalizeFolderPath(file.parent?.path ?? "/"),
    );
    if (!root) {
      return;
    }
    const existing = host.historyTimers.get(file.path);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    const timer = window.setTimeout(() => {
      host.historyTimers.delete(file.path);
      void recordFileHistory(host, file, root);
    }, 1200);
    host.historyTimers.set(file.path, timer);
  
}

/** 比较字数变化并记录历史快照 */
export async function recordFileHistory(host: WritingStatsHost, file: TFile, root: string): Promise<void> {
    if (
      !(host.app.vault.getAbstractFileByPath(file.path) instanceof TFile)
      || host.isSettingCollectionIndexPath(file.path)
    ) {
      return;
    }
    let content = "";
    try {
      content = await host.app.vault.read(file);
    } catch {
      return;
    }
    const current = countNovelCharacters(content);
    const previous = host.wordCountBaselines.get(file.path);
    if (previous === undefined) {
      host.wordCountBaselines.set(file.path, current);
      return;
    }
    const delta = current - previous;
    if (delta === 0) {
      return;
    }
    host.wordCountBaselines.set(file.path, current);
    const now = Date.now();
    const bucketStart = historyBucketStart(now);
    host.historySaveChain = host.historySaveChain.then(async () => {
      const config = await host.readNovelConfig(root);
      const name = file.basename;
      const existing = config.history.find((entry) => (
        entry.bucketStart === bucketStart && entry.path === file.path
      ));
      if (existing) {
        existing.delta += delta;
        existing.name = name;
        existing.updatedAt = now;
      } else {
        config.history.push({
          bucketStart,
          path: file.path,
          name,
          delta,
          updatedAt: now,
        });
      }
      config.history = pruneNovelHistory(
        config.history.filter((entry) => entry.delta !== 0),
      ).slice(-4000);
      await host.writeNovelConfig(root, config);
    }).catch((error) => {
      console.error("Novel View: history save failed", error);
    });
    await host.historySaveChain;
  
}

/** 读取活动编辑器中的正文内容 */
export function getActiveNovelEditorText(host: WritingStatsHost): string | null {
    const file = host.getLastActiveMarkdownFile();
    const view = file ? host.findNovelEditorView(file.path) : null;
    return view?.getEditorText() ?? null;
  
}