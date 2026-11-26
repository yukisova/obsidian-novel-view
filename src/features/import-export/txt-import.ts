import { Notice, TFile, TFolder, type App } from "obsidian";
import {
  CHAPTER_STATUS_LABELS,
  CHAPTER_STATUS_PROPERTY,
} from "../../core/model/chapter-status";
import { parseNovelTxt } from "../../core/text/txt";

/** TXT 导入所需的最小宿主能力。 */
export interface TxtImportHost {
  app: App;
  /** 按路径获取文件夹对象 */
  getFolder(path: string): TFolder | null;
  /** 清理文件名中的非法字符 */
  sanitizeFileBase(value: string, fallback: string): string;
  /** 判断是否为保留目录名 */
  isReservedNovelFolder(name: string): boolean;
  /** 生成不重名的卷目录路径 */
  getUniqueFolderPath(parentPath: string, base: string): string;
  /** 生成不重名的章节文件路径 */
  getUniqueMarkdownPath(folderPath: string, base: string): string;
  /** 分配卷内下一个文章编号 */
  getNextArticleId(folderPath: string): number;
  /** 重新编排卷内文章序号 */
  renumberFolder(folderPath: string): Promise<void>;
  /** 确保小说组存在卷顺序配置 */
  ensureVolumeOrder(novelRoot: string): Promise<boolean>;
  /** 刷新所有已打开的小说视图 */
  refreshOpenViews(): void;
  /** 刷新已打开的文章列表视图 */
  refreshArticleListViews(): void;
  /** 刷新已打开的小说工作台视图 */
  refreshWorkbenchViews(): void;
  /** 在编辑器中打开指定文章 */
  openNovelEditor(file: TFile): Promise<void>;
}

/**
 * 用文件输入框选一个本地 TXT（移动端同样可用），不依赖 Node 文件选择器。
 */
export function pickTxtFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = createEl("input", {
      cls: "novelview-hidden-file-input",
      attr: {
        type: "file",
        accept: ".txt,text/plain",
        "aria-label": "选择 TXT 文件",
      },
    });
    document.body.appendChild(input);
    let settled = false;
    const finish = (file: File | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => finish(null));
    window.addEventListener("focus", () => {
      window.setTimeout(() => finish(input.files?.[0] ?? null), 500);
    }, { once: true });
    input.click();
  });
}

/**
 * 把 TXT 解析成章节并逐篇落地为 Markdown；卷名会做保留名规避。
 */
export async function importNovelTxt(
  host: TxtImportHost,
  folderPath: string,
): Promise<void> {
  const selected = await pickTxtFile();
  if (!selected) {
    return;
  }
  const text = await selected.text();
  const chapters = parseNovelTxt(text);
  const target = host.getFolder(folderPath);
  if (!target) {
    new Notice("Novel View：小说组不存在。");
    return;
  }
  if (chapters.length === 0) {
    new Notice("Novel View：TXT 中没有可导入的章节。");
    return;
  }
  const touchedFolders = new Set<string>();
  const created: TFile[] = [];
  try {
    for (const chapter of chapters) {
      let targetFolderPath = folderPath;
      if (chapter.volume) {
        let volumeName = host.sanitizeFileBase(chapter.volume, "卷");
        if (host.isReservedNovelFolder(volumeName)) {
          volumeName = `卷-${volumeName.replace(/^-+/u, "") || "设定"}`;
        }
        targetFolderPath = host.getUniqueFolderPath(folderPath, volumeName);
        if (!host.getFolder(targetFolderPath)) {
          await host.app.vault.createFolder(targetFolderPath);
        }
      }
      const base = host.sanitizeFileBase(chapter.title, "无标题");
      const targetPath = host.getUniqueMarkdownPath(targetFolderPath, base);
      const content = [
        "---",
        `novelview-id: ${host.getNextArticleId(targetFolderPath)}`,
        `${CHAPTER_STATUS_PROPERTY}: ${CHAPTER_STATUS_LABELS.todo}`,
        "---",
        "",
        chapter.body,
      ].join("\n");
      const file = await host.app.vault.create(targetPath, content);
      created.push(file);
      touchedFolders.add(targetFolderPath);
    }
    for (const folder of touchedFolders) {
      await host.renumberFolder(folder);
    }
    await host.ensureVolumeOrder(folderPath);
    host.refreshOpenViews();
    host.refreshArticleListViews();
    host.refreshWorkbenchViews();
    if (created[0]) {
      await host.openNovelEditor(created[0]);
    }
    new Notice(`Novel View：已导入 ${created.length} 个章节。`);
  } catch (error) {
    console.error("Novel View: TXT import failed", error);
    new Notice("Novel View：TXT 导入失败。");
  }
}
