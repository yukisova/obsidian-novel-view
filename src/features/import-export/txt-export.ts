import { Notice, TFile, TFolder, type App } from "obsidian";
import { findFrontmatterEnd } from "../../core/text/paragraphs";
import {
  formatNovelTxt,
  type TxtExportChapter,
} from "../../core/text/txt";
import type { NovelGroupInfo } from "../../core/model/novel-config";
import type { ArticleListTarget } from "../article-list/article-list-view";

/** TXT 导出所需的最小宿主能力。 */
export interface TxtExportHost {
  app: App;
  /** 读取小说组的名称等信息 */
  getNovelGroupInfo(folderPath: string): NovelGroupInfo | null;
  /** 按路径获取文件夹对象 */
  getFolder(path: string): TFolder | null;
  /** 判断是否为特殊设定文件 */
  isSpecialNovelFile(file: TFile): boolean;
  /** 判断是否为保留目录名 */
  isReservedNovelFolder(name: string): boolean;
  /** 规范化文件夹路径表示 */
  normalizeFolderPath(path: string): string;
  /** 查找文件所在的小说组根目录 */
  findNovelGroupRoot(folderPath: string): string | null;
  /** 读取小说组设定的卷顺序 */
  getNovelVolumeOrder(novelRoot: string): string[];
  /** 读取文章在卷内的序号 */
  getArticleId(path: string): number;
}

/**
 * 导出选中章节：单章用章节名，多章用「组名-选章」。
 */
export async function exportChapterTargets(
  host: TxtExportHost,
  targets: ArticleListTarget[],
  folderPath: string,
): Promise<void> {
  const articles = targets
    .filter((target) => target.kind === "article")
    .map((target) => host.app.vault.getAbstractFileByPath(target.path))
    .filter((file): file is TFile => file instanceof TFile);
  if (articles.length === 0) {
    new Notice("Novel View：没有可导出的章节。");
    return;
  }
  const info = host.getNovelGroupInfo(folderPath);
  const name = articles.length === 1
    ? articles[0].basename
    : `${info?.name ?? "小说"}-选章`;
  await exportTxtFiles(host, articles, name);
}

/**
 * 导出整卷：递归收集卷内 Markdown 章节。
 */
export async function exportVolumeTarget(
  host: TxtExportHost,
  target: ArticleListTarget,
): Promise<void> {
  const folder = host.getFolder(target.path);
  if (!folder) {
    new Notice("Novel View：卷不存在。");
    return;
  }
  const files: TFile[] = [];
  const collect = (current: TFolder): void => {
    for (const child of current.children) {
      if (child instanceof TFolder) {
        collect(child);
      } else if (
        child instanceof TFile
        && child.extension === "md"
        && !host.isSpecialNovelFile(child)
      ) {
        files.push(child);
      }
    }
  };
  collect(folder);
  if (files.length === 0) {
    new Notice("Novel View：本卷没有可导出的章节。");
    return;
  }
  await exportTxtFiles(host, files, target.title);
}

/**
 * 导出整个小说组（跳过保留目录与特殊设定文件）。
 */
export async function exportNovelGroup(
  host: TxtExportHost,
  folderPath: string,
): Promise<void> {
  const group = host.getFolder(folderPath);
  const info = host.getNovelGroupInfo(folderPath);
  if (!group || !info) {
    new Notice("Novel View：未找到小说组。");
    return;
  }
  const files: TFile[] = [];
  const collect = (current: TFolder): void => {
    for (const child of current.children) {
      if (child instanceof TFolder) {
        if (host.isReservedNovelFolder(child.name)) {
          continue;
        }
        collect(child);
      } else if (
        child instanceof TFile
        && child.extension === "md"
        && !host.isSpecialNovelFile(child)
      ) {
        files.push(child);
      }
    }
  };
  collect(group);
  if (files.length === 0) {
    new Notice("Novel View：小说组中没有可导出的章节。");
    return;
  }
  await exportTxtFiles(host, files, `${info.name}-合并稿`);
}

/**
 * 按「卷 → 章」排序后拼成单一 TXT，用浏览器下载通道落地。
 */
async function exportTxtFiles(
  host: TxtExportHost,
  files: TFile[],
  suggestedName: string,
): Promise<void> {
  interface ExportRow {
    file: TFile;
    root: string | null;
    volume: string | null;
    volumeRank: number;
    volumeNumber: number;
    chapterId: number;
    body: string;
  }
  const rows: ExportRow[] = [];
  const rootOrders = new Map<string, string[]>();
  const fallbackVolumes = new Map<string, string[]>();
  for (const file of files) {
    const parent = host.normalizeFolderPath(file.parent?.path ?? "/");
    const root = host.findNovelGroupRoot(parent);
    const volume = root && parent !== root ? file.parent?.name ?? null : null;
    let volumeRank = -1;
    if (root && volume) {
      if (!rootOrders.has(root)) {
        rootOrders.set(root, host.getNovelVolumeOrder(root));
      }
      if (!fallbackVolumes.has(root)) {
        fallbackVolumes.set(root, []);
      }
      const order = rootOrders.get(root) ?? [];
      const fallback = fallbackVolumes.get(root) ?? [];
      let index = order.indexOf(volume);
      if (index < 0) {
        index = fallback.indexOf(volume);
        if (index < 0) {
          fallback.push(volume);
          index = fallback.length - 1;
        }
        index += order.length;
      }
      volumeRank = index;
    }
    rows.push({
      file,
      root,
      volume,
      volumeRank,
      volumeNumber: 0,
      chapterId: host.getArticleId(file.path),
      body: extractTxtBody(await host.app.vault.cachedRead(file)),
    });
  }
  rows.sort((left, right) => {
    const rootOrder = (left.root ?? "").localeCompare(right.root ?? "", "zh-CN");
    if (rootOrder !== 0) {
      return rootOrder;
    }
    if (left.volume !== right.volume) {
      if (left.volume === null) {
        return -1;
      }
      if (right.volume === null) {
        return 1;
      }
      const rank = left.volumeRank - right.volumeRank;
      if (rank !== 0) {
        return rank;
      }
    }
    return left.chapterId - right.chapterId;
  });
  for (const row of rows) {
    if (!row.volume) {
      continue;
    }
    const order = row.root ? rootOrders.get(row.root) ?? [] : [];
    const fallback = row.root ? fallbackVolumes.get(row.root) ?? [] : [];
    const index = order.indexOf(row.volume);
    row.volumeNumber = index >= 0
      ? index + 1
      : order.length + fallback.indexOf(row.volume) + 1;
  }
  const chapters: TxtExportChapter[] = rows.map((row) => ({
    title: row.file.basename,
    volume: row.volume,
    volumeNumber: row.volumeNumber,
    body: row.body,
  }));
  const text = formatNovelTxt(chapters);
  const safeName = suggestedName.replace(/[\\/:*?"<>|]/gu, "-").trim() || "导出";
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = createEl("a", {
    attr: { href: url, download: `${safeName}.txt` },
  });
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  new Notice(`Novel View：已导出 ${safeName}.txt`);
}

/** 去掉 BOM 与 frontmatter，只留正文。 */
function extractTxtBody(content: string): string {
  const source = content.replace(/^\uFEFF/u, "");
  const lines = source.split(/\r?\n/u);
  const end = findFrontmatterEnd(
    (index: number) => lines[index] ?? null,
    lines.length,
  );
  return lines.slice(end).join("\n")
    .replace(/^\n+/u, "")
    .replace(/\n+$/u, "");
}
