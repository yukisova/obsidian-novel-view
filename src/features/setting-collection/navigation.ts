/**
 * 设定集的视图导航与模式面板入口。
 * 从 main.ts 迁出（D8 收尾）。
 */

import { Notice, TFolder, WorkspaceLeaf } from "obsidian";
import { SettingCollectionIndex } from "../../core/model/setting-collection";
import { joinVaultPath } from "../../core/model/novel-config";
import { NOVEL_EDITOR_VIEW_TYPE, NovelEditorView } from "../novel-editor/novel-editor-view";
import { SETTING_COLLECTION_VIEW_TYPE, SettingCollectionView } from "./setting-collection-view";
import { SETTING_LIST_VIEW_TYPE } from "./setting-list-view";
import { ModeSettingsPanel } from "./mode-settings-panel";
import type { PluginBase } from "../../app/plugin-context";

export interface SettingNavigationHost extends PluginBase {
  modeSettingsPanel: ModeSettingsPanel | null;
  /** 按路径查找库内文件夹 */
  getFolder(path: string): TFolder | null;
  /** 查找小说组的设定组文件夹 */
  getSettingGroupFolderForNovel(novelRoot: string): TFolder | null;
  /** 查找路径所属小说组根目录 */
  findNovelGroupRoot(folderPath: string): string | null;
  /** 规范化文件夹路径字符串 */
  normalizeFolderPath(path: string): string;
  /** 确保设定集索引已存在 */
  ensureSettingCollection(groupPath: string,): Promise<SettingCollectionIndex>;
  /** 判断视图是否位于左侧栏 */
  isLeftSidebarLeaf(leaf: WorkspaceLeaf): boolean;
  /** 获取左侧栏的工作区叶节点 */
  leftSidebarLeaf(): WorkspaceLeaf;
  /** 生成设定组对应的文件夹名 */
  settingGroupFolderPathName(group: string): string;
  /** 列出小说组下全部设定组 */
  settingGroupsForNovel(novelRoot: string): TFolder[];
  /** 读取指定设定集的索引内容 */
  readSettingCollectionIndex(groupPath: string): Promise<SettingCollectionIndex>;
  /** 实时应用排版格式设置 */
  applyFormatSettingsLive(): void;
  /** 保存插件设置并写回磁盘 */
  saveSettings(): Promise<void>;
}

/** 打开设定集视图并定位记录 */
export async function openSettingCollection(host: SettingNavigationHost, folderPath: string, focus?: { group: string; tag: string; keyword: string },): Promise<void> {
    const folder = host.getFolder(folderPath);
    const settingFolder = folder && folder.name.startsWith("-")
      ? folder
      : host.getSettingGroupFolderForNovel(
        host.findNovelGroupRoot(folderPath)
          ?? host.normalizeFolderPath(folderPath),
      );
    if (!settingFolder) {
      new Notice("Novel View：请右击小说组并选择“新建设定组”。");
      return;
    }
    await host.ensureSettingCollection(settingFolder.path);
    const rightLeaf = host.app.workspace.getLeavesOfType(
      SETTING_COLLECTION_VIEW_TYPE,
    ).find((candidate) => Boolean(
      candidate.view.containerEl.closest(".workspace-split.mod-right-split"),
    ));
    const leaf = rightLeaf
      ?? host.app.workspace.getRightLeaf(false)
      ?? host.app.workspace.getRightLeaf(true);
    if (!leaf) {
      new Notice("Novel View：无法打开设定集。");
      return;
    }
    await leaf.setViewState({
      type: SETTING_COLLECTION_VIEW_TYPE,
      state: { folderPath: settingFolder.path },
      active: true,
    });
    await host.app.workspace.revealLeaf(leaf);
    if (focus && leaf.view instanceof SettingCollectionView) {
      leaf.view.focusRecord(focus.group, focus.tag, focus.keyword);
      await leaf.view.revealRecordDetail(
        focus.group,
        focus.tag,
        focus.keyword,
      );
    }
  
}

/** 在侧栏打开设定集列表 */
export async function openSettingCollectionList(host: SettingNavigationHost, folderPath: string, sourceLeaf?: WorkspaceLeaf,): Promise<void> {
    const novelRoot = host.findNovelGroupRoot(folderPath)
      ?? host.normalizeFolderPath(folderPath);
    for (const existing of host.app.workspace.getLeavesOfType(
      SETTING_LIST_VIEW_TYPE,
    )) {
      if (!host.isLeftSidebarLeaf(existing)) {
        existing.detach();
      }
    }
    const sourceInLeft = sourceLeaf && host.isLeftSidebarLeaf(sourceLeaf)
      ? sourceLeaf
      : null;
    const leaf = sourceInLeft ?? host.leftSidebarLeaf();
    await leaf.setViewState({
      type: SETTING_LIST_VIEW_TYPE,
      state: { folderPath: novelRoot },
      active: true,
    });
    await host.app.workspace.revealLeaf(leaf);
  
}

/** 按关键词打开设定记录详情 */
export async function openSettingRecord(host: SettingNavigationHost, sourcePath: string, group: string, tag: string, keyword: string,): Promise<void> {
    const root = host.findNovelGroupRoot(
      host.normalizeFolderPath(sourcePath.split("/").slice(0, -1).join("/")),
    );
    if (!root) {
      return;
    }
    const groupFolder = host.getFolder(joinVaultPath(
      root,
      host.settingGroupFolderPathName(group),
    ));
    if (!groupFolder) {
      return;
    }
    await openSettingCollection(host, groupFolder.path, {
      group,
      tag,
      keyword,
    });
  
}

/** 按关键词跨分组查找并打开 */
export async function openSettingRecordForNovelKeyword(host: SettingNavigationHost, novelRoot: string, keyword: string,): Promise<boolean> {
    const key = keyword.trim().toLocaleLowerCase();
    if (!key) {
      return false;
    }
    for (const group of host.settingGroupsForNovel(novelRoot)) {
      const index = await host.readSettingCollectionIndex(group.path);
      for (const [groupName, tags] of Object.entries(index)) {
        for (const tag of tags) {
          const record = tag.contain.find((entry) => (
            entry.keyword.toLocaleLowerCase() === key
          ));
          if (record) {
            await openSettingCollection(host, group.path, {
              group: groupName,
              tag: tag.tag,
              keyword: record.keyword,
            });
            return true;
          }
        }
      }
    }
    return false;
  
}

/** 打开格式设置浮动面板 */
export function openModeSettings(host: SettingNavigationHost, anchor?: HTMLElement): void {
    if (host.modeSettingsPanel) {
      return;
    }
    host.modeSettingsPanel = new ModeSettingsPanel(
      {
        fontSize: Number(host.settings.fontSize) || 16,
        lineHeight: Number(host.settings.lineHeight) || 1.8,
        paragraphSpacing: Number(host.settings.paragraphSpacing) || 0.65,
        firstLineIndent: Number(host.settings.firstLineIndent) || 2,
        pageMarginMode: window.localStorage.getItem(
          "novelview:page-margin-mode",
        ) === "manual"
          ? "manual"
          : "auto",
        pageChars: Math.min(
          80,
          Math.max(
            24,
            Number(window.localStorage.getItem("novelview:page-chars")) || 42,
          ),
        ),
      },
      (values) => {
        host.settings.fontSize = values.fontSize;
        host.settings.lineHeight = values.lineHeight;
        host.settings.paragraphSpacing = values.paragraphSpacing;
        host.settings.firstLineIndent = values.firstLineIndent;
        window.localStorage.setItem(
          "novelview:page-margin-mode",
          values.pageMarginMode,
        );
        window.localStorage.setItem(
          "novelview:page-chars",
          String(values.pageChars),
        );
        host.applyFormatSettingsLive();
        for (const leaf of host.app.workspace.getLeavesOfType(
          NOVEL_EDITOR_VIEW_TYPE,
        )) {
          if (leaf.view instanceof NovelEditorView) {
            leaf.view.applyPageSettings();
          }
        }
        void host.saveSettings();
      },
      () => { host.modeSettingsPanel = null; },
      anchor,
    );
  
}