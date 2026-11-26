import { Notice, TFolder, type App } from "obsidian";
import { joinVaultPath } from "../../core/model/novel-config";

/** 素材图片导入所需的最小宿主能力。 */
export interface MaterialImportHost {
  app: App;
  /** 规范化素材目录路径表示 */
  normalizeFolderPath(path: string): string;
  /** 确保目录存在并返回句柄 */
  ensureFolder(path: string): Promise<TFolder | null>;
  /** 生成不重名的素材文件路径 */
  getUniqueFilePath(folderPath: string, fileName: string): string;
}

/**
 * 把浏览器拿到的图片文件写进小说组的 src 素材库。
 */
export async function importMaterialImage(
  host: MaterialImportHost,
  folderPath: string,
  file: File,
): Promise<void> {
  const root = host.normalizeFolderPath(folderPath);
  const srcPath = joinVaultPath(root, "src");
  const folder = await host.ensureFolder(srcPath);
  if (!folder) {
    new Notice("Novel View：无法创建素材库目录。");
    return;
  }
  const base = file.name.replace(/\.[^.]+$/u, "");
  const extension = file.name.slice(base.length);
  const path = host.getUniqueFilePath(srcPath, `${base}${extension}`);
  await host.app.vault.createBinary(path, await file.arrayBuffer());
  new Notice(`Novel View：已导入素材“${file.name}”。`);
}
