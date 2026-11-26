import { Notice, TFile, TFolder, type App } from "obsidian";

/** 图片插入所需的最小宿主能力。 */
export interface ImageHost {
  app: App;
  findNovelGroupRoot(folderPath: string): string | null;
  normalizeFolderPath(path: string): string;
  sanitizeFileBase(value: string, fallback: string): string;
  ensureFolder(path: string): Promise<TFolder | null>;
  getUniqueFilePath(folderPath: string, fileName: string): string;
}

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif",
]);

/** 弹出系统文件选择器（浏览器 input，移动端同样可用）。 */
export function chooseLocalImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = createEl("input");
    input.type = "file";
    input.accept = "image/*";
    input.addClass("novelview-hidden-file-input");
    activeDocument.body.appendChild(input);
    let settled = false;
    let focusTimer: number | null = null;
    const finish = (file: File | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (focusTimer !== null) {
        window.clearTimeout(focusTimer);
      }
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => finish(null));
    window.addEventListener("focus", () => {
      focusTimer = window.setTimeout(() => {
        finish(input.files?.[0] ?? null);
      }, 500);
    }, { once: true });
    input.click();
  });
}

/**
 * 把图片写进仓库：指定目录时落到素材库并去重，否则交给 Obsidian 分配附件路径。
 */
export async function saveImageToVault(
  host: ImageHost,
  file: File,
  sourcePath: string,
  folderPath?: string,
): Promise<TFile | null> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!file.type.startsWith("image/") && !IMAGE_EXTENSIONS.has(extension)) {
    new Notice("Novel View：请选择图片文件。");
    return null;
  }
  const base = host.sanitizeFileBase(file.name, "image");
  try {
    const buffer = await file.arrayBuffer();
    if (folderPath) {
      if (!await host.ensureFolder(folderPath)) {
        new Notice("Novel View：无法创建素材库目录。");
        return null;
      }
      const path = host.getUniqueFilePath(folderPath, base);
      return await host.app.vault.createBinary(path, buffer);
    }
    const path = await host.app.fileManager.getAvailablePathForAttachment(
      base,
      sourcePath,
    );
    return await host.app.vault.createBinary(path, buffer);
  } catch (error) {
    console.error("Novel View: failed to save image", error);
    new Notice("Novel View：图片保存失败。");
    return null;
  }
}

/** 从本地选图 → 写入素材库 → 在光标处插入嵌入语法。 */

/** 从素材库选图并插入。 */

/** 工具栏完整度：小说组根目录给「完整」，其余给「基础」。 */

