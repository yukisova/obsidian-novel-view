import {
  MarkdownView,
  Menu,
  Plugin,
  TAbstractFile,
  TFile,
  TFolder,
  WorkspaceLeaf,
} from "obsidian";
import type {
  NovelFloatingToolbar,
  NovelToolbarScope,
} from "./editor/floating-toolbar";
import type { ArticleListModel } from "./article-list-view";

export interface NovelViewSettings {
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
  firstLineIndent: number;
  paragraphMode: "line" | "blank-line";
  hideMarkdownMarkers: boolean;
  hideLineNumbers: boolean;
}

declare class LegacyNovelViewPlugin extends Plugin {
  settings: NovelViewSettings;
  novelToolbars: Map<MarkdownView, NovelFloatingToolbar>;
  volumeOrder: Map<string, string[]>;
  workbenchFolderPath: string | null;
  lastActiveMarkdownPath: string | null;

  constructor(app: unknown, manifest: unknown);
  onload(): Promise<void>;
  onunload(): void;

  loadSettings(): Promise<void>;
  saveSettings(): Promise<void>;
  getActiveMarkdownView(): MarkdownView | null;
  getLastActiveMarkdownFile(): TFile | null;
  getWorkbenchFolderPath(): string | null;
  setWorkbenchGroup(folderPath: string): void;
  activateWorkbench(): Promise<void>;
  openArticleList(folderPath: string): Promise<void>;
  openWorkbenchForGroup(folderPath: string): Promise<void>;
  restoreFileExplorer(leaf?: WorkspaceLeaf): Promise<void>;
  refreshOpenViews(): void;
  refreshEditor(view: MarkdownView): void;
  isNovelModeEnabled(view: MarkdownView): boolean;
  getNovelToolbarScope(file: TFile | null): NovelToolbarScope;
  insertNovelImage(view: MarkdownView): Promise<void>;
  insertImageFromLibrary(view: MarkdownView): void;
  chooseLocalImage(): Promise<string | null>;
  saveImageToVault(
    localPath: string,
    sourcePath: string,
    folderPath?: string,
  ): Promise<TFile | null>;
  destroyArticleStatus(view: MarkdownView): void;
  getFolder(path: string): TFolder | null;
  normalizeFolderPath(path: string): string;
  sanitizeFileBase(value: string, fallback: string): string;
  getUniqueFilePath(folderPath: string, fileName: string): string;
  getUniqueMarkdownPath(folderPath: string, base: string): string;
  ensureFolder(path: string): Promise<TFolder | null>;
  scheduleNovelFolderDecoration(): void;
  createVolumeInFolder(folderPath: string): Promise<void>;
  applyModeStyles(contentEl: HTMLElement): void;
  decorateNovelFolderTitles(): void;
  addNovelGroupMenuItem(menu: Menu, target: TAbstractFile): void;
  openFileAtLine(file: TFile, line?: number): Promise<void>;
  getArticleListModel(folderPath: string): ArticleListModel | null;
}
export default LegacyNovelViewPlugin;
