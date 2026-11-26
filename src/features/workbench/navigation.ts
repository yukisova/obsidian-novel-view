import { Notice, type App, type TFolder, type WorkspaceLeaf } from "obsidian";
import { ARTICLE_LIST_VIEW_TYPE } from "../article-list/article-list-view";
import { WORKBENCH_VIEW_TYPE } from "./workbench-view";

/** 工作台打开/切换所需的最小宿主能力。 */
export interface WorkbenchHost {
  app: App;
  workbenchFolderPath: string | null;
  /** 规范化文件夹路径表示 */
  normalizeFolderPath(path: string): string;
  /** 按路径获取文件夹对象 */
  getFolder(path: string): TFolder | null;
  /** 刷新所有已打开的工作台视图 */
  refreshWorkbenchViews(): void;
}

/** leaf 是否挂在左右侧栏里。 */
export function isLeafInSidebar(leaf: WorkspaceLeaf): boolean {
  return Boolean(leaf.view.containerEl.closest(
    ".workspace-split.mod-left-split, .workspace-split.mod-right-split",
  ));
}

/** 当前工作台指向的小说组；目录已不存在时自动清空。 */
export function getWorkbenchFolderPath(host: WorkbenchHost): string | null {
  if (host.workbenchFolderPath === null) {
    return null;
  }
  const normalized = host.normalizeFolderPath(host.workbenchFolderPath);
  if (host.getFolder(normalized)) {
    return normalized;
  }
  host.workbenchFolderPath = null;
  return null;
}

/** 切换工作台指向的小说组并刷新。 */
export function setWorkbenchGroup(
  host: WorkbenchHost,
  folderPath: string,
): void {
  const normalized = host.normalizeFolderPath(folderPath);
  if (host.workbenchFolderPath === normalized) {
    return;
  }
  host.workbenchFolderPath = normalized;
  host.refreshWorkbenchViews();
}

/** 打开（或聚焦）工作台标签页；侧栏里的旧实例先清掉。 */
export async function activateWorkbench(host: WorkbenchHost): Promise<void> {
  const leaves = host.app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE);
  const tabs: WorkspaceLeaf[] = [];
  for (const leaf of leaves) {
    if (isLeafInSidebar(leaf)) {
      leaf.detach();
    } else {
      tabs.push(leaf);
    }
  }
  const existing = tabs[0];
  if (existing) {
    await host.app.workspace.revealLeaf(existing);
    return;
  }
  try {
    const leaf = host.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: WORKBENCH_VIEW_TYPE, active: true });
    await host.app.workspace.revealLeaf(leaf);
  } catch (error) {
    console.error("Novel View: failed to open workbench", error);
    new Notice("Novel View：小说工作台打开失败。");
  }
}

/** 在文件列表位置打开文章列表视图。 */
export async function openArticleList(
  host: WorkbenchHost,
  folderPath: string,
): Promise<void> {
  const normalized = host.normalizeFolderPath(folderPath);
  host.workbenchFolderPath = normalized;
  const leaf = host.app.workspace.getLeavesOfType("file-explorer")[0]
    ?? host.app.workspace.getLeftLeaf(true);
  if (!leaf) {
    new Notice("Novel View：无法打开文章列表。");
    return;
  }
  try {
    await leaf.setViewState({
      type: ARTICLE_LIST_VIEW_TYPE,
      state: { folderPath: normalized },
      active: true,
    });
    await host.app.workspace.revealLeaf(leaf);
  } catch (error) {
    console.error("Novel View: failed to open article list", error);
    new Notice("Novel View：文章列表打开失败。");
  }
}

/** 关闭挂在侧栏里的工作台实例（启动时归一化布局）。 */
export function removeSidebarWorkbenchInstances(host: WorkbenchHost): void {
  for (const leaf of host.app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE)) {
    if (isLeafInSidebar(leaf)) {
      leaf.detach();
    }
  }
}
