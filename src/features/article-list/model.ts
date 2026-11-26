import { TFile, TFolder } from "obsidian";
import type { NovelGroupInfo } from "../../core/model/novel-config";
import { compareFilesNaturally } from "../../core/text/format-utils";
import type {
  ArticleEntry,
  ArticleListModel,
  VolumeEntry,
} from "./article-list-view";

/** 构建文章列表模型所需的最小宿主能力。 */
export interface ArticleModelHost {
  getNovelGroupInfo(folderPath: string): NovelGroupInfo | null;
  normalizeFolderPath(path: string): string;
  getFolder(path: string): TFolder | null;
  isReservedNovelFolder(name: string): boolean;
  isSpecialNovelFile(file: TFile): boolean;
  volumeOrder: Map<string, string[]>;
}

/**
 * 扫描小说组目录，产出「卷 + 散章」模型；卷按保存的卷序排，其余按自然序。
 * 移植自旧包实现。
 */
export function getArticleListModel(
  host: ArticleModelHost,
  folderPath: string,
): ArticleListModel | null {
  const novel = host.getNovelGroupInfo(folderPath);
  if (!novel) {
    return null;
  }
  const normalized = host.normalizeFolderPath(folderPath);
  const folder = host.getFolder(normalized);
  if (!folder) {
    return null;
  }
  const articles: ArticleEntry[] = [];
  const volumes: VolumeEntry[] = [];
  for (const child of folder.children) {
    if (child instanceof TFolder) {
      if (host.isReservedNovelFolder(child.name)) {
        continue;
      }
      const entries: ArticleEntry[] = [];
      for (const file of child.children) {
        if (
          file instanceof TFile
          && file.extension === "md"
          && !host.isSpecialNovelFile(file)
        ) {
          entries.push({ path: file.path, basename: file.basename });
        }
      }
      entries.sort(compareFilesNaturally);
      volumes.push({ path: child.path, name: child.name, articles: entries });
    } else if (
      child instanceof TFile
      && child.extension === "md"
      && !host.isSpecialNovelFile(child)
    ) {
      articles.push({ path: child.path, basename: child.basename });
    }
  }
  const order = host.volumeOrder.get(normalized) ?? [];
  volumes.sort((left, right) => {
    const leftIndex = order.indexOf(left.name);
    const rightIndex = order.indexOf(right.name);
    if (leftIndex !== -1 || rightIndex !== -1) {
      if (leftIndex === -1) {
        return 1;
      }
      if (rightIndex === -1) {
        return -1;
      }
      return leftIndex - rightIndex;
    }
    return compareFilesNaturally(
      { basename: left.name, path: left.path },
      { basename: right.name, path: right.path },
    );
  });
  articles.sort(compareFilesNaturally);
  return { novel, folderPath: normalized, volumes, articles };
}
