import * as fs from "node:fs";
import * as path from "node:path";
import {
  MarkdownView,
  Menu,
  Notice,
  TFile,
  TFolder,
  type WorkspaceLeaf,
} from "obsidian";
import LegacyNovelViewPlugin from "./legacy-main.cjs";
import {
  ARTICLE_LIST_VIEW_TYPE,
  NovelArticleListView,
  type ArticleListTarget,
} from "./article-list-view";
import {
  CHAPTER_STATUSES,
  CHAPTER_STATUS_LABELS,
  CHAPTER_STATUS_PROPERTY,
  readChapterStatus,
  type ChapterStatus,
} from "./core/chapter-status";
import {
  getLinkKeywordEntries,
  LINK_LIBRARY_JSON,
  parseLinkLibrary,
  serializeLinkLibrary,
  type LinkLibraryData,
} from "./core/link-library";
import { countNovelCharacters } from "./core/status";
import { findFrontmatterEnd } from "./core/paragraphs";
import { formatNovelMarkdown } from "./core/format";
import {
  createNovelSettingContent,
  getNovelSettingPath,
  isNovelSettingFile,
  joinVaultPath,
} from "./core/novel-setting";
import { confirmAction } from "./confirm-modal";
import {
  NovelSrcGalleryView,
  SRC_GALLERY_VIEW_TYPE,
} from "./src-gallery-view";
import {
  LinkLibraryView,
  LINK_LIBRARY_VIEW_TYPE,
} from "./link-library-view";
import {
  NovelWorkbenchView,
  WORKBENCH_VIEW_TYPE,
} from "./workbench-view";
import {
  linkKeywordExtension,
  refreshLinkKeywords,
  setLinkKeywords,
} from "./editor/link-keyword-extension";
import { NovelFloatingToolbar } from "./editor/floating-toolbar";
import { ModeSettingsPanel } from "./mode-settings-panel";
import { SearchPanelV2 } from "./search-panel-v2";
import { SectionToc } from "./section-toc";
import { linkKeywordsInElement } from "./link-keyword-dom";

interface ChapterMeta {
  wordCount: number;
  status: ChapterStatus;
}

export default class NovelViewPlugin extends LegacyNovelViewPlugin {
  [key: string]: any;

  private readonly chapterMetaCache = new Map<string, ChapterMeta>();
  private readonly sectionTocs = new Map<MarkdownView, SectionToc>();
  private readonly articleUndoStack: Array<() => Promise<void>> = [];
  private searchPanelV2: SearchPanelV2 | null = null;
  private modeSettingsPanel: ModeSettingsPanel | null = null;

  async onload(): Promise<void> {
    const originalRegisterView = this.registerView.bind(this);
    this.registerView = (type: string, factory: any): void => {
      if (type === ARTICLE_LIST_VIEW_TYPE) {
        originalRegisterView(type, (leaf: WorkspaceLeaf) => (
          new NovelArticleListView(leaf, this)
        ));
        return;
      }
      if (type === SRC_GALLERY_VIEW_TYPE) {
        originalRegisterView(type, (leaf: WorkspaceLeaf) => (
          new NovelSrcGalleryView(leaf, this)
        ));
        return;
      }
      if (type === LINK_LIBRARY_VIEW_TYPE) {
        originalRegisterView(type, (leaf: WorkspaceLeaf) => (
          new LinkLibraryView(leaf, this)
        ));
        return;
      }
      if (type === WORKBENCH_VIEW_TYPE) {
        originalRegisterView(type, (leaf: WorkspaceLeaf) => (
          new NovelWorkbenchView(leaf, this)
        ));
        return;
      }
      originalRegisterView(type, factory);
    };

    await super.onload();
    this.registerView = originalRegisterView;
    this.settings.fontSize ??= 16;
    this.registerEditorExtension(linkKeywordExtension);
    this.cleanupDescriptionData();
    this.cleanupNovelStateProperties();
  }

  async refreshLinkKeywordIndex(): Promise<void> {
    const current = this.getLastActiveMarkdownFile();
    if (!current) {
      setLinkKeywords([]);
      refreshLinkKeywords();
      return;
    }
    const root = this.findNovelGroupRoot(
      this.normalizeFolderPath(current.parent?.path ?? "/"),
    );
    if (!root) {
      setLinkKeywords([]);
      refreshLinkKeywords();
      return;
    }
    const data = await this.readLinkLibrary(root);
    setLinkKeywords(getLinkKeywordEntries(data));
    refreshLinkKeywords();
  }

  decorateReadingLinkKeywords(
    element: HTMLElement,
    sourcePath: string,
  ): void {
    const source = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(source instanceof TFile) || !this.isForcedNovelMode(source)) {
      return;
    }
    const root = this.findNovelGroupRoot(
      this.normalizeFolderPath(source.parent?.path ?? "/"),
    );
    if (!root) {
      return;
    }
    void this.readLinkLibrary(root).then((data) => {
      if (element.isConnected) {
        linkKeywordsInElement(element, getLinkKeywordEntries(data));
      }
    });
  }

  onunload(): void {
    for (const toc of this.sectionTocs.values()) {
      toc.destroy();
    }
    this.sectionTocs.clear();
    super.onunload();
  }

  async loadSettings(): Promise<void> {
    await super.loadSettings();
    const raw = await this.loadData() as { settings?: { fontSize?: unknown } } | null;
    const size = Number(raw?.settings?.fontSize);
    this.settings.fontSize = Number.isFinite(size) && size >= 12 && size <= 28
      ? size
      : 16;
  }

  syncFloatingToolbar(view: MarkdownView, enabled: boolean): void {
    const existing = this.novelToolbars.get(view);
    if (!enabled) {
      existing?.destroy();
      this.novelToolbars.delete(view);
      return;
    }
    if (existing) {
      return;
    }
    const toolbar = new NovelFloatingToolbar(
      view.containerEl,
      {
        formatDocument: () => this.formatNovelDocument(view),
        addImage: () => { void this.insertNovelImage(view); },
        addImageFromLibrary: () => this.insertImageFromLibrary(view),
        openSearch: () => this.openAdvancedSearch(),
        openModeSettings: () => this.openModeSettings(),
      },
      this.getNovelToolbarScope(view.file),
    );
    this.novelToolbars.set(view, toolbar);
  }

  ensureViewAction(view: MarkdownView): void {
    if (this.observedViews.has(view)) {
      return;
    }
    this.observedViews.add(view);
    view.containerEl.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const keyword = target?.closest<HTMLElement>(".novelview-link-keyword");
      if (keyword) {
        const path = keyword.getAttribute("data-novelview-link-path");
        if (path && view.file) {
          event.preventDefault();
          event.stopPropagation();
          this.openLinkKeywordTarget(path, view.file);
          return;
        }
      }
    }, true);
  }

  registerCommands(): void {}

  openAdvancedSearch(): void {
    if (!this.searchPanelV2) {
      this.searchPanelV2 = new SearchPanelV2(this);
    }
    this.searchPanelV2.open(this.getActiveMarkdownView() ?? undefined);
  }

  openModeSettings(): void {
    if (this.modeSettingsPanel) {
      return;
    }
    this.modeSettingsPanel = new ModeSettingsPanel(
      {
        fontSize: Number(this.settings.fontSize) || 16,
        lineHeight: Number(this.settings.lineHeight) || 1.8,
        paragraphSpacing: Number(this.settings.paragraphSpacing) || 0.65,
        firstLineIndent: Number(this.settings.firstLineIndent) || 2,
      },
      (values) => {
        this.settings.fontSize = values.fontSize;
        this.settings.lineHeight = values.lineHeight;
        this.settings.paragraphSpacing = values.paragraphSpacing;
        this.settings.firstLineIndent = values.firstLineIndent;
        this.applyFormatSettingsLive();
        void this.saveSettings();
      },
      () => { this.modeSettingsPanel = null; },
    );
  }

  private applyFormatSettingsLive(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (!(leaf.view instanceof MarkdownView)) {
        continue;
      }
      const view = leaf.view;
      if (view.contentEl.hasClass("novelview-novel-mode")) {
        this.applyModeStyles(view.contentEl);
        this.refreshEditor(view);
      }
    }
  }

  applyModeStyles(contentEl: HTMLElement): void {
    (LegacyNovelViewPlugin.prototype as any).applyModeStyles.call(this, contentEl);
    contentEl.style.setProperty(
      "--novelview-font-size",
      `${Number(this.settings.fontSize) || 16}px`,
    );
  }

  refreshWorkbenchViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE)) {
      const view = leaf.view as { scheduleRefresh?: () => void };
      view.scheduleRefresh?.();
    }
  }

  async exportChapterTargets(
    targets: ArticleListTarget[],
    folderPath: string,
  ): Promise<void> {
    const articles = targets
      .filter((target) => target.kind === "article")
      .map((target) => this.app.vault.getAbstractFileByPath(target.path))
      .filter((file): file is TFile => file instanceof TFile);
    if (articles.length === 0) {
      new Notice("Novel View：没有可导出的章节。");
      return;
    }
    const info = this.getNovelGroupInfo(folderPath);
    const name = articles.length === 1
      ? articles[0].basename
      : `${info?.name ?? "小说"}-选章`;
    await this.exportTxtFiles(articles, name);
  }

  async exportVolumeTarget(
    target: ArticleListTarget,
    folderPath: string,
  ): Promise<void> {
    const folder = this.getFolder(target.path);
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
          && !this.isSpecialNovelFile(child)
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
    await this.exportTxtFiles(files, target.title);
  }

  private async exportTxtFiles(files: TFile[], suggestedName: string): Promise<void> {
    const dialog = this.getElectronDialog();
    if (!dialog) {
      new Notice("Novel View：当前环境不支持系统文件夹选择器。");
      return;
    }
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    const targetDir = result?.filePaths?.[0];
    if (result?.canceled || !targetDir) {
      return;
    }
    const parts: string[] = [];
    for (const file of files) {
      const raw = await this.app.vault.cachedRead(file);
      parts.push(this.toPlainText(raw, file.basename));
    }
    const safeName = suggestedName.replace(/[\\/:*?"<>|]/gu, "-").trim() || "导出";
    let target = path.join(targetDir, `${safeName}.txt`);
    let index = 2;
    while (fs.existsSync(target)) {
      target = path.join(targetDir, `${safeName}-${index}.txt`);
      index += 1;
    }
    fs.writeFileSync(target, parts.join("\n\n"), "utf8");
    new Notice(`Novel View：已导出到 ${target}`);
  }

  private getElectronDialog(): any {
    try {
      const electron = require("electron");
      return electron?.remote?.dialog
        ?? electron?.dialog
        ?? (globalThis as any).require?.("electron")?.remote?.dialog;
    } catch {
      return null;
    }
  }

  private toPlainText(content: string, title: string): string {
    const source = content.replace(/^\uFEFF/u, "");
    const lines = source.split(/\r?\n/u);
    const end = findFrontmatterEnd(
      (index: number) => lines[index] ?? null,
      lines.length,
    );
    const body = lines.slice(end).join("\n")
      .replace(/^#{1,6}\s+/gmu, "")
      .replace(/!\[\[([^\]]+)\]\]/gu, "$1")
      .trim();
    return `${title}\n${"=".repeat(title.length)}\n\n${body}`;
  }

  formatNovelDocument(view: MarkdownView): void {
    if (!view.file || view.getMode() === "preview") {
      return;
    }
    const editor = view.editor;
    const result = formatNovelMarkdown(editor.getValue());
    if (!result.changed) {
      new Notice("Novel View：文档已经是整洁格式，无需调整。");
      return;
    }
    editor.setValue(result.text);
    const parts: string[] = [];
    if (result.trimmedLines > 0) {
      parts.push(`清理 ${result.trimmedLines} 行行尾空白`);
    }
    if (result.removedBlankLines > 0) {
      parts.push(`删除 ${result.removedBlankLines} 个空行`);
    }
    new Notice(`Novel View：自动排版完成${parts.length ? `，${parts.join("，")}` : ""}。`);
  }

  async getChapterMeta(path: string): Promise<ChapterMeta> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return { wordCount: 0, status: "todo" };
    }
    try {
      const content = await this.app.vault.cachedRead(file);
      const status = readChapterStatus(
        this.app.metadataCache.getFileCache(file)?.frontmatter,
      );
      const meta = {
        wordCount: countNovelCharacters(content),
        status,
      };
      this.chapterMetaCache.set(path, meta);
      return meta;
    } catch (error) {
      console.debug("Novel View: chapter meta read skipped", error);
      return this.chapterMetaCache.get(path) ?? { wordCount: 0, status: "todo" };
    }
  }

  async setChapterStatus(file: TFile, status: ChapterStatus): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter[CHAPTER_STATUS_PROPERTY] = CHAPTER_STATUS_LABELS[status];
    });
    this.chapterMetaCache.delete(file.path);
    this.refreshOpenViews();
  }

  async createArticleInFolder(
    folderPath: string,
    currentPath: string,
    title: string,
  ): Promise<void> {
    const folder = this.getFolder(currentPath) ?? this.getFolder(folderPath);
    if (!folder) {
      new Notice("Novel View：当前文章目录不存在。");
      return;
    }
    const base = this.sanitizeFileBase(title, "未命名文章");
    const path = this.getUniqueMarkdownPath(folder.path, base);
    const content = [
      "---",
      `novelview-id: ${this.getNextArticleId(folder.path)}`,
      `${CHAPTER_STATUS_PROPERTY}: ${CHAPTER_STATUS_LABELS.todo}`,
      "---",
      "",
    ].join("\n");
    try {
      const file = await this.app.vault.create(path, content);
      await this.renumberFolder(folder.path);
      await this.app.workspace.getLeaf("tab").openFile(file, { active: true });
      this.refreshOpenViews();
    } catch (error) {
      console.error("Novel View: failed to create article", error);
      new Notice("Novel View：文章创建失败。");
    }
  }

  getArticleListModel(folderPath: string): any {
    const model = (LegacyNovelViewPlugin.prototype as any)
      .getArticleListModel.call(this, folderPath);
    if (!model) {
      return null;
    }
    const order = this.getNovelVolumeOrder(folderPath);
    const position = (name: string): number => {
      const index = order.indexOf(name);
      return index >= 0 ? index : order.length;
    };
    model.volumes.sort((left: any, right: any) => (
      position(left.name) - position(right.name)
      || left.name.localeCompare(right.name, "zh-CN", { numeric: true })
    ));
    model.volumes.forEach((volume: any, index: number) => {
      volume.volumeNumber = index;
      volume.articles.sort((a: any, b: any) => this.compareChapterOrder(a, b));
      volume.articles.forEach((article: any, articleIndex: number) => {
        article.chapterNumber = articleIndex + 1;
      });
    });
    model.articles.sort((a: any, b: any) => this.compareChapterOrder(a, b));
    model.articles.forEach((article: any, index: number) => {
      article.chapterNumber = index + 1;
    });
    return model;
  }

  private compareChapterOrder(left: any, right: any): number {
    const leftNumber = this.getArticleId(left.path);
    const rightNumber = this.getArticleId(right.path);
    return leftNumber - rightNumber;
  }

  private getArticleId(path: string): number {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return Number.MAX_SAFE_INTEGER;
    }
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const value = frontmatter?.["novelview-id"] ?? frontmatter?.["novelview-chapter"];
    const number = Number(value);
    return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER;
  }

  private getNextArticleId(folderPath: string): number {
    const folder = this.getFolder(folderPath);
    if (!folder) {
      return 1;
    }
    let max = 0;
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === "md") {
        max = Math.max(max, this.getArticleId(child.path) || 0);
      }
    }
    return max + 1;
  }

  private getNovelVolumeOrder(folderPath: string): string[] {
    const setting = this.getNovelSettingFile(folderPath);
    if (!setting) {
      return [];
    }
    const value = this.app.metadataCache.getFileCache(setting)?.frontmatter?.["novelview-volume-order"];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string");
    }
    if (typeof value === "string") {
      return value.split(/[,，]/u).map((item) => item.trim()).filter(Boolean);
    }
    return [];
  }

  private async saveNovelVolumeOrder(folderPath: string, order: string[]): Promise<void> {
    const setting = this.getNovelSettingFile(folderPath);
    if (!setting) {
      return;
    }
    await this.app.fileManager.processFrontMatter(setting, (frontmatter) => {
      frontmatter["novelview-volume-order"] = order;
    });
  }

  private async renumberFolder(folderPath: string): Promise<void> {
    const folder = this.getFolder(folderPath);
    if (!folder) {
      return;
    }
    const files = folder.children
      .filter((child: any): child is TFile => (
        child instanceof TFile
        && child.extension === "md"
        && !this.isSpecialNovelFile(child)
      ))
      .sort((a: any, b: any) => this.compareChapterOrder(
        { path: a.path, basename: a.basename },
        { path: b.path, basename: b.basename },
      ));
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        frontmatter["novelview-id"] = index + 1;
      });
    }
  }

  async renameArticlePath(path: string, value: string): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return "文章不存在。";
    }
    const base = this.sanitizeFileBase(value, file.basename);
    if (!base || base === file.basename) {
      return null;
    }
    const parent = this.normalizeFolderPath(file.parent?.path ?? "/");
    const nextPath = joinVaultPath(parent, `${base}.md`);
    if (this.app.vault.getAbstractFileByPath(nextPath)) {
      return "同名文章已存在。";
    }
    await this.app.fileManager.renameFile(file, nextPath);
    this.articleUndoStack.push(async () => {
      const renamed = this.app.vault.getAbstractFileByPath(nextPath);
      if (renamed instanceof TFile) {
        await this.app.fileManager.renameFile(renamed, path);
      }
    });
    return null;
  }

  async renameVolumePath(path: string, value: string): Promise<string | null> {
    const folder = this.getFolder(path);
    if (!folder || folder.path === "/") {
      return "卷不存在。";
    }
    const base = this.sanitizeFileBase(value, folder.name);
    if (!base || base === folder.name) {
      return null;
    }
    if (this.isReservedNovelFolder(base)) {
      return "该名称是小说组保留名称。";
    }
    const parent = this.normalizeFolderPath(folder.parent?.path ?? "/");
    const nextPath = joinVaultPath(parent, base);
    if (this.app.vault.getAbstractFileByPath(nextPath)) {
      return "同名文件夹已存在。";
    }
    const oldName = folder.name;
    const group = this.findNovelGroupRoot(parent);
    const order = group ? this.getNovelVolumeOrder(group) : [];
    await this.app.fileManager.renameFile(folder, nextPath);
    if (group && order.includes(oldName)) {
      order[order.indexOf(oldName)] = base;
      await this.saveNovelVolumeOrder(group, order);
    }
    this.articleUndoStack.push(async () => {
      const renamed = this.getFolder(nextPath);
      if (renamed) {
        await this.app.fileManager.renameFile(renamed, path);
      }
      if (group && order.includes(base)) {
        order[order.indexOf(base)] = oldName;
        await this.saveNovelVolumeOrder(group, order);
      }
    });
    return null;
  }

  async deleteArticleTargets(
    targets: ArticleListTarget[],
    refresh: () => void,
  ): Promise<void> {
    if (targets.length === 0) {
      return;
    }
    const confirmed = await confirmAction(
      this.app,
      "删除所选内容",
      `确定删除 ${targets.length} 项内容吗？可使用 Cmd/Ctrl+Z 撤销。`,
    );
    if (!confirmed) {
      return;
    }
    const folders = new Set<string>();
    const files: Array<{ path: string; content: ArrayBuffer; binary: boolean }> = [];
    const emptyFolders = new Set<string>();
    for (const target of targets) {
      const abstract = this.app.vault.getAbstractFileByPath(target.path);
      if (abstract instanceof TFile) {
        files.push({
          path: abstract.path,
          content: await this.app.vault.readBinary(abstract),
          binary: abstract.extension !== "md",
        });
        folders.add(abstract.parent?.path ?? "");
        continue;
      }
      if (abstract instanceof TFolder) {
        emptyFolders.add(abstract.path);
        const walk = async (folder: TFolder): Promise<void> => {
          emptyFolders.add(folder.path);
          for (const child of folder.children) {
            if (child instanceof TFolder) {
              await walk(child);
            } else if (child instanceof TFile) {
              files.push({
                path: child.path,
                content: await this.app.vault.readBinary(child),
                binary: child.extension !== "md",
              });
            }
          }
        };
        await walk(abstract);
        folders.add(this.normalizeFolderPath(abstract.parent?.path ?? "/"));
      }
    }
    for (const target of targets) {
      const abstract = this.app.vault.getAbstractFileByPath(target.path);
      if (abstract) {
        await this.app.vault.delete(abstract, true);
      }
    }
    for (const folderPath of folders) {
      if (folderPath) {
        await this.renumberFolder(folderPath);
      }
    }
    this.articleUndoStack.push(async () => {
      const sortedFolders = [...emptyFolders].sort((a, b) => a.length - b.length);
      for (const folderPath of sortedFolders) {
        if (!this.app.vault.getAbstractFileByPath(folderPath)) {
          await this.app.vault.createFolder(folderPath);
        }
      }
      for (const snapshot of files) {
        if (this.app.vault.getAbstractFileByPath(snapshot.path)) {
          continue;
        }
        if (snapshot.binary) {
          await this.app.vault.createBinary(snapshot.path, snapshot.content);
        } else {
          await this.app.vault.create(
            snapshot.path,
            new TextDecoder().decode(snapshot.content),
          );
        }
      }
      for (const folderPath of folders) {
        if (folderPath) {
          await this.renumberFolder(folderPath);
        }
      }
    });
    refresh();
  }

  async importNovelTxt(folderPath: string): Promise<void> {
    const dialog = this.getElectronDialog();
    if (!dialog) {
      new Notice("Novel View：当前环境不支持系统文件选择器。");
      return;
    }
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "TXT", extensions: ["txt"] }],
    });
    const filePath = result?.filePaths?.[0];
    if (result?.canceled || !filePath) {
      return;
    }
    const text = fs.readFileSync(filePath, "utf8");
    const base = path.basename(filePath, path.extname(filePath));
    const name = this.sanitizeFileBase(base, "导入章节");
    const target = this.getFolder(folderPath);
    if (!target) {
      new Notice("Novel View：小说组不存在。");
      return;
    }
    const targetPath = this.getUniqueMarkdownPath(folderPath, name);
    const content = [
      "---",
      `novelview-id: ${this.getNextArticleId(folderPath)}`,
      `${CHAPTER_STATUS_PROPERTY}: ${CHAPTER_STATUS_LABELS.todo}`,
      "---",
      "",
      text,
    ].join("\n");
    try {
      const file = await this.app.vault.create(targetPath, content);
      await this.renumberFolder(folderPath);
      await this.app.workspace.getLeaf("tab").openFile(file, { active: true });
    } catch (error) {
      console.error("Novel View: TXT import failed", error);
      new Notice("Novel View：TXT 导入失败。");
    }
  }

  async undoLastArticleAction(): Promise<void> {
    const action = this.articleUndoStack.pop();
    if (!action) {
      new Notice("Novel View：没有可撤销的文章列表操作。");
      return;
    }
    try {
      await action();
      this.refreshOpenViews();
      new Notice("Novel View：已撤销。");
    } catch (error) {
      console.error("Novel View: undo failed", error);
      new Notice("Novel View：撤销失败。");
    }
  }

  async moveArticlesToVolume(paths: string[], targetFolder: string): Promise<boolean> {
    const target = this.getFolder(targetFolder);
    if (!target) {
      return false;
    }
    const moved: Array<{ oldPath: string; newPath: string; sourceFolder: string }> = [];
    const folders = new Set<string>([target.path]);
    for (const sourcePath of paths) {
      const file = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!(file instanceof TFile)) {
        continue;
      }
      if (file.parent?.path === target.path) {
        continue;
      }
      const sourceFolder = file.parent?.path ?? "";
      folders.add(sourceFolder);
      let nextPath = joinVaultPath(target.path, file.name);
      let index = 2;
      while (this.app.vault.getAbstractFileByPath(nextPath)) {
        nextPath = joinVaultPath(target.path, `${file.basename} ${index}.md`);
        index += 1;
      }
      await this.app.fileManager.renameFile(file, nextPath);
      moved.push({ oldPath: sourcePath, newPath: nextPath, sourceFolder });
    }
    let nextId = this.getNextArticleId(target.path);
    for (const entry of moved) {
      const movedFile = this.app.vault.getAbstractFileByPath(entry.newPath);
      if (movedFile instanceof TFile) {
        await this.app.fileManager.processFrontMatter(movedFile, (frontmatter) => {
          frontmatter["novelview-id"] = nextId;
        });
        nextId += 1;
      }
    }
    if (moved.length > 0) {
      this.articleUndoStack.push(async () => {
        for (const entry of moved) {
          const file = this.app.vault.getAbstractFileByPath(entry.newPath);
          if (file instanceof TFile) {
            await this.app.fileManager.renameFile(file, entry.oldPath);
          }
        }
        for (const folder of folders) {
          if (folder) {
            await this.renumberFolder(folder);
          }
        }
      });
    }
    return true;
  }

  async reorderArticlesAt(
    paths: string[],
    targetPath: string,
    after: boolean,
  ): Promise<boolean> {
    const target = this.app.vault.getAbstractFileByPath(targetPath);
    if (!(target instanceof TFile) || !target.parent) {
      return false;
    }
    const targetFolder = target.parent.path;
    const before = new Map<string, unknown>();
    const targetFolderObj = this.getFolder(targetFolder);
    if (targetFolderObj) {
      for (const child of targetFolderObj.children) {
        if (child instanceof TFile) {
          before.set(child.path, this.app.metadataCache.getFileCache(child)?.frontmatter?.["novelview-id"]);
        }
      }
    }
    await this.moveArticlesToVolume(paths, targetFolder);
    const folder = this.getFolder(targetFolder);
    if (!folder) {
      return false;
    }
    const files = folder.children
      .filter((child: any): child is TFile => child instanceof TFile && child.extension === "md")
      .sort((a: any, b: any) => this.compareChapterOrder(
        { path: a.path, basename: a.basename },
        { path: b.path, basename: b.basename },
      ));
    const moving = files.filter((file: any) => paths.includes(file.path));
    const remaining = files.filter((file: any) => !paths.includes(file.path));
    const targetFile = remaining.find((file: any) => file.path === targetPath);
    if (!targetFile) {
      return false;
    }
    const targetIndex = remaining.indexOf(targetFile) + (after ? 1 : 0);
    remaining.splice(targetIndex, 0, ...moving);
    for (let index = 0; index < remaining.length; index += 1) {
      await this.app.fileManager.processFrontMatter(remaining[index], (frontmatter) => {
        frontmatter["novelview-id"] = index + 1;
      });
    }
    this.articleUndoStack.push(async () => {
      for (const [filePath, chapter] of before) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
            if (chapter === undefined || chapter === null) {
              delete frontmatter["novelview-id"];
            } else {
              frontmatter["novelview-id"] = chapter;
            }
          });
        }
      }
    });
    return true;
  }

  async reorderVolume(folderPath: string, sourcePath: string, targetPath: string): Promise<void> {
    const folder = this.getFolder(folderPath);
    if (!folder) {
      return;
    }
    const names = folder.children
      .filter((child: any): child is TFolder => child instanceof TFolder)
      .filter((child: any) => !this.isReservedNovelFolder(child.name))
      .map((child: any) => child.name);
    const source = sourcePath.split("/").pop();
    const target = targetPath.split("/").pop();
    if (!source || !target || source === target) {
      return;
    }
    const order = this.getNovelVolumeOrder(folderPath).filter((name) => names.includes(name));
    for (const name of names) {
      if (!order.includes(name)) {
        order.push(name);
      }
    }
    const from = order.indexOf(source);
    const to = order.indexOf(target);
    if (from < 0 || to < 0) {
      return;
    }
    order.splice(from, 1);
    order.splice(to, 0, source);
    await this.saveNovelVolumeOrder(folderPath, order);
  }

  async updateNovelInfo(
    folderPath: string,
    patch: { description?: string; cover?: string },
  ): Promise<void> {
    const setting = this.getNovelSettingFile(folderPath);
    if (!setting) {
      return;
    }
    await this.app.fileManager.processFrontMatter(setting, (frontmatter) => {
      if (patch.description !== undefined) {
        frontmatter["novel-description"] = patch.description;
      }
      if (patch.cover !== undefined) {
        frontmatter["novel-cover"] = patch.cover;
      }
    });
    this.refreshWorkbenchViews();
  }

  async editNovelCover(folderPath: string): Promise<void> {
    const setting = this.getNovelSettingFile(folderPath);
    if (!setting) {
      return;
    }
    const cover = await this.pickCoverImage(setting.path);
    if (cover !== null) {
      await this.updateNovelInfo(folderPath, { cover });
    }
  }

  async renameNovelGroupFolder(
    folderPath: string,
    value: string,
  ): Promise<void> {
    const folder = this.getFolder(folderPath);
    if (!folder) {
      return;
    }
    const name = this.sanitizeFileBase(value, folder.name);
    if (!name || name === folder.name) {
      return;
    }
    const parent = this.normalizeFolderPath(folder.parent?.path ?? "/");
    const nextPath = joinVaultPath(parent, name);
    if (this.app.vault.getAbstractFileByPath(nextPath)) {
      new Notice("Novel View：同名文件夹已存在。");
      return;
    }
    await this.app.fileManager.renameFile(folder, nextPath);
    if (this.workbenchFolderPath === folderPath) {
      this.workbenchFolderPath = nextPath;
    }
    for (const leaf of this.app.workspace.getLeavesOfType(ARTICLE_LIST_VIEW_TYPE)) {
      const state = leaf.getViewState().state as { folderPath?: unknown };
      if (state.folderPath === folderPath) {
        await leaf.setViewState({
          type: ARTICLE_LIST_VIEW_TYPE,
          state: { folderPath: nextPath },
          active: true,
        });
      }
    }
    this.refreshWorkbenchViews();
    this.scheduleNovelFolderDecoration();
  }

  isReservedNovelFolder(name: string): boolean {
    return /^(src|设定|伏笔|人物|时间线|分散卷)$/iu.test(name);
  }

  async exportNovelGroup(folderPath: string): Promise<void> {
    const group = this.getFolder(folderPath);
    const info = this.getNovelGroupInfo(folderPath);
    if (!group || !info) {
      new Notice("Novel View：未找到小说组。");
      return;
    }
    const files: TFile[] = [];
    const collect = (current: TFolder): void => {
      for (const child of current.children) {
        if (child instanceof TFolder) {
          if (this.isReservedNovelFolder(child.name)) {
            continue;
          }
          collect(child);
        } else if (
          child instanceof TFile
          && child.extension === "md"
          && !this.isSpecialNovelFile(child)
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
    await this.exportTxtFiles(files, `${info.name}-合并稿`);
  }

  async createNovelGroup(folder: TFolder): Promise<void> {
    const folderPath = this.normalizeFolderPath(folder.path);
    if (folderPath === "/") {
      new Notice("Novel View：仓库根目录不能设置为小说组。");
      return;
    }
    const settingPath = getNovelSettingPath(folderPath);
    const existing = this.app.vault.getAbstractFileByPath(settingPath);
    if (existing instanceof TFile && isNovelSettingFile(existing)) {
      this.workbenchFolderPath = folderPath;
      await this.openArticleList(folderPath);
      await this.activateWorkbench();
      this.refreshWorkbenchViews();
      return;
    }
    if (existing) {
      new Notice("Novel View：无法创建 NovelSetting，同名路径已存在。");
      return;
    }
    try {
      await this.app.vault.create(settingPath, createNovelSettingContent(folder.name));
      this.workbenchFolderPath = folderPath;
      await this.openArticleList(folderPath);
      await this.activateWorkbench();
      this.refreshOpenViews();
      new Notice(`Novel View：已创建小说组“${folder.name}”。`);
    } catch (error) {
      console.error("Novel View: failed to create novel group", error);
      new Notice("Novel View：小说组创建失败。");
    }
  }

  showArticleListContextMenu(
    event: MouseEvent,
    folderPath: string,
    contextPath: string,
    refresh: () => void,
    targets: ArticleListTarget[] = [],
    onRename?: () => void,
  ): void {
    const menu = new Menu();
    if (targets.length > 0) {
      if (targets.length === 1 && onRename) {
        menu.addItem((item) => {
          item.setTitle("重命名").setIcon("pencil").onClick(onRename);
        });
      }
      const articleTargets = targets.filter((target) => target.kind === "article");
      if (targets.length > 1 && articleTargets.length > 0) {
        menu.addItem((item) => {
          item.setTitle("导出所选章节为 TXT").setIcon("download").onClick(() => {
            void this.exportChapterTargets(articleTargets, folderPath);
          });
        });
      }
      if (targets.length === 1 && targets[0].kind === "article") {
        menu.addItem((item) => {
          item.setTitle("导出为 TXT").setIcon("download").onClick(() => {
            void this.exportChapterTargets([targets[0]], folderPath);
          });
        });
      }
      if (targets.length === 1 && targets[0].kind === "volume") {
        menu.addItem((item) => {
          item.setTitle("导出本卷为 TXT").setIcon("download").onClick(() => {
            void this.exportVolumeTarget(targets[0], folderPath);
          });
        });
      }
      menu.addItem((item) => {
        item.setTitle(targets.length === 1 ? "删除" : `删除 ${targets.length} 项`)
          .setIcon("trash")
          .onClick(() => {
            void this.deleteArticleTargets(targets, refresh);
          });
      });
      menu.showAtMouseEvent(event);
      return;
    }
    menu.addItem((item) => {
      item.setTitle("新建文章").setIcon("file-plus").onClick(() => {
        void this.createArticleInFolder(folderPath, contextPath, "无标题")
          .then(refresh);
      });
    });
    menu.addItem((item) => {
      item.setTitle("新建卷").setIcon("folder-plus").onClick(() => {
        void this.createVolumeInFolder(folderPath).then(refresh);
      });
    });
    menu.showAtMouseEvent(event);
  }

  handleNovelFolderClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    const folderTitle = target.closest<HTMLElement>(".nav-folder-title");
    const path = folderTitle?.dataset.path
      ?? folderTitle?.closest<HTMLElement>(".nav-folder")?.dataset.path;
    if (!folderTitle || !path) {
      return;
    }
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!(folder instanceof TFolder) || !this.getNovelSettingFile(folder.path)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.workbenchFolderPath = this.normalizeFolderPath(folder.path);
    void this.openArticleList(folder.path).then(() => {
      const workbenches = this.app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE);
      if (workbenches.length === 0) {
        void this.activateWorkbench();
      } else {
        this.refreshWorkbenchViews();
      }
    });
  }

  syncArticleStatus(view: MarkdownView, enabled: boolean): void {
    if (!enabled || !view.file) {
      this.destroyArticleStatus(view);
      this.sectionTocs.get(view)?.destroy();
      this.sectionTocs.delete(view);
      return;
    }
    let card = this.articleStatusCards.get(view);
    if (!card || !card.isConnected) {
      card?.remove();
      card = view.containerEl.createDiv({
        cls: "novelview-article-status",
      });
      card.setAttr("aria-live", "polite");
      card.addClass("is-clickable");
      card.addEventListener("click", (event: MouseEvent) => {
        if (view.file) {
          this.showChapterStatusMenu(event, view.file);
        }
      });
      view.containerEl.addClass("novelview-status-host");
      this.articleStatusCards.set(view, card);
    }
    if (!this.sectionTocs.has(view)) {
      this.sectionTocs.set(view, new SectionToc(view));
    }
    void this.updateArticleStatus(view);
    if (!this.articleStatusTimers.has(view)) {
      const timer = window.setInterval(() => {
        if (this.unloaded || !view.containerEl.isConnected) {
          this.destroyArticleStatus(view);
          return;
        }
        void this.updateArticleStatus(view);
      }, 800);
      this.articleStatusTimers.set(view, timer);
    }
  }

  async updateArticleStatus(view: MarkdownView): Promise<void> {
    const file = view.file;
    const card = this.articleStatusCards.get(view);
    if (!file || !card) {
      return;
    }
    const meta = await this.getChapterMeta(file.path);
    if (!card.isConnected || view.file?.path !== file.path) {
      return;
    }
    const content = view.editor?.getValue() ?? await this.app.vault.cachedRead(file);
    this.sectionTocs.get(view)?.update(content);
    card.empty();
    card.createSpan({
      cls: "novelview-article-status-count",
      text: `${new Intl.NumberFormat("zh-CN").format(meta.wordCount)} 字`,
    });
    const badge = card.createSpan({
      cls: "novelview-article-status-state",
      text: CHAPTER_STATUS_LABELS[meta.status],
    });
    badge.dataset.state = meta.status;
    card.setAttr(
      "title",
      `当前章节 ${meta.wordCount} 字 · ${CHAPTER_STATUS_LABELS[meta.status]}（点击修改）`,
    );
  }

  private showChapterStatusMenu(event: MouseEvent, file: TFile): void {
    const current = readChapterStatus(
      this.app.metadataCache.getFileCache(file)?.frontmatter,
    );
    const menu = new Menu();
    for (const status of CHAPTER_STATUSES) {
      menu.addItem((item) => {
        item.setTitle(CHAPTER_STATUS_LABELS[status])
          .setIcon(status === current ? "check" : "circle")
          .onClick(() => {
            void this.setChapterStatus(file, status);
          });
      });
    }
    menu.showAtMouseEvent(event);
  }

  async ensureLinkLibrary(
    folderPath: string,
  ): Promise<{ folder: TFolder; json: TFile }> {
    const root = this.normalizeFolderPath(folderPath);
    const jsonPath = joinVaultPath(root, LINK_LIBRARY_JSON);
    const existing = this.app.vault.getAbstractFileByPath(jsonPath);
    let json: TFile;
    if (existing instanceof TFile) {
      json = existing;
    } else {
      const legacyPath = joinVaultPath(root, "link", LINK_LIBRARY_JSON);
      const legacy = this.app.vault.getAbstractFileByPath(legacyPath);
      const initial = legacy instanceof TFile
        ? await this.app.vault.read(legacy)
        : serializeLinkLibrary({ group: {}, tags: {}, links: [] });
      json = await this.app.vault.create(jsonPath, initial);
    }
    const folder = this.getFolder(root);
    if (!folder) {
      throw new Error("Novel group folder missing");
    }
    return { folder, json };
  }

  async readLinkLibrary(folderPath: string): Promise<LinkLibraryData> {
    const library = await this.ensureLinkLibrary(folderPath);
    let data: LinkLibraryData = { group: {}, tags: {}, links: [] };
    try {
      data = parseLinkLibrary(
        JSON.parse(await this.app.vault.read(library.json)) as unknown,
      );
    } catch (error) {
      console.debug("Novel View: link JSON read skipped", error);
    }
    const missing = data.links.filter((link) => (
      !this.getLinkTargetFile(folderPath, link.path)
    ));
    if (missing.length > 0) {
      data.links = data.links.filter((link) => (
        !!this.getLinkTargetFile(folderPath, link.path)
      ));
      await this.writeLinkLibrary(folderPath, data);
    }
    let tagsChanged = false;
    for (const [group, tagMap] of Object.entries(data.tags)) {
      for (const tag of Object.keys(tagMap)) {
        if (!data.links.some((link) => link.belong === group && link.tag === tag)) {
          delete tagMap[tag];
          tagsChanged = true;
        }
      }
      if (Object.keys(tagMap).length === 0) {
        delete data.tags[group];
      }
    }
    if (tagsChanged) {
      await this.writeLinkLibrary(folderPath, data);
    }
    return data;
  }

  async writeLinkLibrary(
    folderPath: string,
    data: LinkLibraryData,
  ): Promise<void> {
    const library = await this.ensureLinkLibrary(folderPath);
    await this.app.vault.process(
      library.json,
      () => serializeLinkLibrary(data),
    );
  }

  getLinkImportCandidates(
    folderPath: string,
  ): Array<{ path: string; label: string }> {
    const result: Array<{ path: string; label: string }> = [];
    for (const file of this.app.vault.getFiles()) {
      if (isNovelSettingFile(file)) {
        continue;
      }
      const group = this.findNovelGroupRoot(
        this.normalizeFolderPath(file.parent?.path ?? "/"),
      );
      if (group !== null) {
        continue;
      }
      result.push({ path: `~/${file.path}`, label: file.path });
    }
    return result.sort((left, right) => left.label.localeCompare(
      right.label,
      "zh-CN",
      { numeric: true, sensitivity: "base" },
    ));
  }

  getLinkTargetFile(
    folderPath: string,
    rawPath: string,
  ): TFile | null {
    const root = this.normalizeFolderPath(folderPath);
    const clean = rawPath.trim().split("#")[0] ?? "";
    if (!clean) {
      return null;
    }
    const candidates = clean.startsWith("~/")
      ? [clean.slice(2)]
      : clean.startsWith("/")
        ? [clean.replace(/^\/+/, "")]
        : [
          joinVaultPath(root, clean),
          joinVaultPath(root, "link", clean),
          clean,
        ];
    for (const candidate of candidates) {
      for (const path of [candidate, `${candidate}.md`]) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          return file;
        }
      }
    }
    return null;
  }

  resolveLinkTarget(rawPath: string, current: TFile): TFile | null {
    const clean = rawPath.trim().split("#")[0] ?? "";
    if (!clean) {
      return null;
    }
    const root = this.findNovelGroupRoot(
      this.normalizeFolderPath(current.parent?.path ?? "/"),
    );
    const candidates: string[] = [];
    if (clean.startsWith("~/")) {
      candidates.push(clean.slice(2));
    } else if (clean.startsWith("/")) {
      candidates.push(clean.replace(/^\/+/, ""));
    } else {
      if (root) {
        const parent = this.normalizeFolderPath(current.parent?.path ?? "/");
        if (parent !== root) {
          candidates.push(joinVaultPath(parent, clean));
        }
        candidates.push(joinVaultPath(root, clean));
        candidates.push(joinVaultPath(root, "link", clean));
      }
      candidates.push(clean);
    }
    for (const candidate of candidates) {
      for (const path of [candidate, `${candidate}.md`]) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          return file;
        }
      }
    }
    return null;
  }

  isInLinkFolder(): boolean {
    return false;
  }

  async openNovelSrcGallery(folderPath: string): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(SRC_GALLERY_VIEW_TYPE)[0];
    const leaf = existing
      ?? this.app.workspace.getRightLeaf(false)
      ?? this.app.workspace.getRightLeaf(true);
    if (!leaf) {
      new Notice("Novel View：无法打开素材库。");
      return;
    }
    await leaf.setViewState({
      type: SRC_GALLERY_VIEW_TYPE,
      state: { folderPath: this.normalizeFolderPath(folderPath) },
      active: true,
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  async openLinkLibrary(folderPath: string): Promise<void> {
    try {
      await this.ensureLinkLibrary(folderPath);
    } catch (error) {
      console.error("Novel View: failed to create link library", error);
      new Notice("Novel View：联动库创建失败。");
      return;
    }
    const existing = this.app.workspace.getLeavesOfType(LINK_LIBRARY_VIEW_TYPE)[0];
    const leaf = existing
      ?? this.app.workspace.getRightLeaf(false)
      ?? this.app.workspace.getRightLeaf(true);
    if (!leaf) {
      new Notice("Novel View：无法打开联动库。");
      return;
    }
    await leaf.setViewState({
      type: LINK_LIBRARY_VIEW_TYPE,
      state: { groupPath: this.normalizeFolderPath(folderPath) },
      active: true,
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  async importMaterialImage(folderPath: string, file: File): Promise<void> {
    const root = this.normalizeFolderPath(folderPath);
    const srcPath = joinVaultPath(root, "src");
    const folder = await this.ensureFolder(srcPath);
    if (!folder) {
      new Notice("Novel View：无法创建素材库目录。");
      return;
    }
    const base = file.name.replace(/\.[^.]+$/u, "");
    const extension = file.name.slice(base.length);
    const path = this.getUniqueFilePath(srcPath, `${base}${extension}`);
    await this.app.vault.createBinary(path, await file.arrayBuffer());
    new Notice(`Novel View：已导入素材“${file.name}”。`);
  }

  private cleanupDescriptionData(): void {
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (isNovelSettingFile(file)) {
        void this.app.vault.read(file).then((content) => {
          const lines = content.split(/\r?\n/u);
          const end = findFrontmatterEnd(
            (index: number) => lines[index] ?? null,
            lines.length,
          );
          const head = lines.slice(0, end).join("\n").trimEnd();
          if (head && content.trim() !== head) {
            return this.app.vault.process(file, () => `${head}\n`);
          }
          return undefined;
        }).catch(() => undefined);
        continue;
      }
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter || !("描述" in frontmatter)) {
        continue;
      }
      void this.app.fileManager.processFrontMatter(file, (data) => {
        delete data["描述"];
      }).catch(() => undefined);
    }
  }

  private cleanupNovelStateProperties(): void {
    for (const file of this.app.vault.getMarkdownFiles()) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter) {
        continue;
      }
      if (
        "novelstate" in frontmatter
        || "状态" in frontmatter
      ) {
        void this.app.fileManager.processFrontMatter(file, (data) => {
          delete data["novelstate"];
          delete data["状态"];
        }).catch(() => undefined);
      }
    }
  }
}
