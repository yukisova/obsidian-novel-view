import { TFolder, type App } from "obsidian";
import { joinVaultPath } from "../core/model/novel-config";

/**
 * 仓库路径工具：从旧包（legacy-main.cjs）接管的 6 个方法。
 * 行为与旧实现逐字对齐——旧包内部的 this.xxx() 调用会派发到这些覆盖实现。
 */

/** 归一化目录路径：空值与 "/" 都返回 "/"，其余去掉首尾斜杠。 */
export function normalizeFolderPath(path: string): string {
  return !path || path === "/" ? "/" : path.replace(/^\/+|\/+$/gu, "");
}

/** 按路径取文件夹；根目录返回 vault 根，非文件夹返回 null。 */
export function getFolder(app: App, path: string): TFolder | null {
  const normalized = normalizeFolderPath(path);
  if (normalized === "/") {
    return app.vault.getRoot();
  }
  const file = app.vault.getAbstractFileByPath(normalized);
  return file instanceof TFolder ? file : null;
}

/** 确保文件夹存在：已存在直接返回，路径被文件占用返回 null，否则创建。 */
export async function ensureFolder(
  app: App,
  path: string,
): Promise<TFolder | null> {
  if (!path || path === "/") {
    return app.vault.getRoot();
  }
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFolder) {
    return existing;
  }
  if (existing) {
    return null;
  }
  try {
    return await app.vault.createFolder(path);
  } catch (error) {
    console.error("Novel View: failed to create folder", error);
    return null;
  }
}

/** 清理文件名中的非法字符，最长 80 字符；清理后为空则用兜底值。 */
export function sanitizeFileBase(value: string, fallback: string): string {
  return value
    .replace(/[\\/:*?"<>|#^[\]]/gu, "-")
    .replace(/[\u0000-\u001f]/gu, "")
    .replace(/\s+/gu, " ")
    .replace(/^\.+|\.+$/gu, "")
    .trim()
    .slice(0, 80) || fallback;
}

/** 在目录内取唯一的 Markdown 路径，冲突时追加「 2」「 3」… */
export function getUniqueMarkdownPath(
  app: App,
  folderPath: string,
  base: string,
): string {
  let index = 1;
  let name = base;
  let path = joinVaultPath(folderPath, `${name}.md`);
  while (app.vault.getAbstractFileByPath(path)) {
    index += 1;
    name = `${base} ${index}`;
    path = joinVaultPath(folderPath, `${name}.md`);
  }
  return path;
}

/** 在目录内取唯一的文件路径，保留扩展名并在主干后追加序号。 */
export function getUniqueFilePath(
  app: App,
  folderPath: string,
  fileName: string,
): string {
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : "";
  let index = 1;
  let name = fileName;
  let path = joinVaultPath(folderPath, name);
  while (app.vault.getAbstractFileByPath(path)) {
    index += 1;
    name = `${stem} ${index}${extension}`;
    path = joinVaultPath(folderPath, name);
  }
  return path;
}
